"""HubSpot endpoints: the connection (status, syncs), the export upload (the backup), and
what's loaded."""

import asyncio
import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, UploadFile
from pydantic import BaseModel, Field

from core.api.deps import EmbedderDep, SessionDep
from core.api.errors import Problem
from core.hubspot.client import HubSpotError, HubSpotWritesOff
from core.hubspot.connection import (
    HubSpotStatus,
    connection_status,
    open_hubspot,
    sync_runner,
    written_hook,
)
from core.hubspot.importer import ExportError, read_export
from core.hubspot.profiles import rebuild_profiles as build_profiles
from core.hubspot.service import HubSpotSummary, ImportResult, save_export, summary
from core.hubspot.sync import SyncAlreadyRunning, SyncOut, recent_syncs
from core.hubspot.writer import (
    WriteInProgress,
    WriteNotFound,
    WriteOut,
    apply_write,
    get_write,
    recent_writes,
)

KEY_MISSING = Problem(
    503,
    "HubSpot isn't connected",
    "Set HUBSPOT_SERVICE_KEY in engine/.env, then restart the backend.",
    code="hubspot_key_missing",
)


def write_problem(error: Exception) -> Problem:
    """The answer for a write that can't go ahead. Shared with the projects' send routes."""
    if isinstance(error, WriteNotFound):
        return Problem(404, "No such HubSpot write", "Preview the change again.")
    if isinstance(error, WriteInProgress):
        return Problem(
            409,
            "This is being written to HubSpot now",
            "Wait a moment, then look again. It is written once only.",
            code="hubspot_write_in_progress",
        )
    if isinstance(error, HubSpotWritesOff):
        return Problem(409, error.title, error.detail, code="hubspot_write_off")
    if isinstance(error, HubSpotError):
        return Problem(503, error.title, error.detail, code="hubspot_unavailable")
    raise error


router = APIRouter(prefix="/hubspot", tags=["hubspot"])
log = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class RebuildResult(BaseModel):
    profiles_rebuilt: int = Field(description="Company profiles built from the loaded HubSpot data")


@router.get(
    "/status",
    response_model=HubSpotStatus,
    summary="The HubSpot connection: the key, its permissions, each project, the syncs",
    description=(
        "Never shows the key, only whether one is set. The permission check is free and "
        "changes nothing in HubSpot; its answer is kept for 10 minutes unless refresh=true."
    ),
)
async def get_hubspot_status(
    request: Request,
    session: SessionDep,
    refresh: Annotated[bool, Query(description="Check HubSpot again now")] = False,
) -> HubSpotStatus:
    return await connection_status(request.app, session, refresh=refresh)


@router.post(
    "/sync",
    status_code=202,
    response_model=SyncOut,
    summary="Start a HubSpot sync in the background",
    description=(
        "Copies HubSpot's companies, offices, deals and owners into our copy. Reading is free. "
        "auto reads everything once a week and only what changed otherwise. Only one sync runs "
        "at a time. Follow it with GET /hubspot/syncs."
    ),
)
async def start_hubspot_sync(
    request: Request,
    mode: Annotated[Literal["auto", "full", "changes"], Query(description="What to read")] = "auto",
) -> SyncOut:
    try:
        return await sync_runner(request.app).start(trigger="website", mode=mode)
    except LookupError as error:
        raise KEY_MISSING from error
    except SyncAlreadyRunning as error:
        raise Problem(
            409,
            "A HubSpot sync is already running",
            "Wait for it to finish. The Admin page shows it.",
            code="hubspot_sync_running",
            sync_id=error.sync_id,
        ) from error


@router.get("/syncs", response_model=list[SyncOut], summary="The newest HubSpot syncs")
async def list_hubspot_syncs(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=50)] = 10
) -> list[SyncOut]:
    return await recent_syncs(session, limit=limit)


@router.get(
    "/writes",
    response_model=list[WriteOut],
    summary="The log of writes to HubSpot, newest first",
    description="Every write a person confirmed, with what it changed. Previews are left out.",
)
async def list_hubspot_writes(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[WriteOut]:
    return await recent_writes(session, limit=limit)


@router.post(
    "/writes/{write_id}/apply",
    response_model=WriteOut,
    summary="Write a previewed change to HubSpot",
    description=(
        "Writes once only: applying a finished write returns its result. Needs the write "
        "scopes and HUBSPOT_WRITE_ENABLED=true; until then it answers 409 hubspot_write_off."
    ),
)
async def apply_hubspot_write(
    request: Request, session: SessionDep, write_id: uuid.UUID
) -> WriteOut:
    try:
        row = await get_write(session, write_id)
        async with open_hubspot(request.app) as client:
            if client is None:
                raise KEY_MISSING
            return await apply_write(
                session, client, write_id, on_written=written_hook(request.app, row.app)
            )
    except (WriteNotFound, WriteInProgress, HubSpotError) as error:
        raise write_problem(error) from error


@router.post(
    "/import",
    response_model=ImportResult,
    summary="Load a HubSpot export file (.xlsx)",
    description=(
        "Updates companies that are already loaded, and never duplicates them. "
        "Skips any Contacts sheet, because it holds personal data."
    ),
)
async def import_export(
    file: UploadFile, session: SessionDep, embedder: EmbedderDep
) -> ImportResult:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise Problem(422, "Upload an .xlsx file", "Export the companies from HubSpot as Excel.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise Problem(413, "The file is too large", "The limit is 20 MB.")
    try:
        export = await asyncio.to_thread(read_export, data)
    except ExportError as error:
        raise Problem(422, "This file can't be loaded", str(error)) from error
    result = await save_export(session, export)
    # The companies are saved. Their profiles (for possible matches and look-alikes) follow.
    try:
        rebuilt = await build_profiles(session, embedder)
    except Exception as error:  # the import itself worked, so say what is left to do
        log.exception("profiles_not_rebuilt_after_import")
        raise Problem(
            503,
            "The companies were loaded, but their profiles weren't built",
            "Run the rebuild again from the Admin page, or with: uv run engine rebuild-profiles. "
            "The reason is in the backend log.",
        ) from error
    return result.model_copy(update={"profiles_rebuilt": rebuilt})


@router.get("/summary", response_model=HubSpotSummary, summary="How much HubSpot data is loaded")
async def get_summary(session: SessionDep) -> HubSpotSummary:
    return await summary(session)


@router.post(
    "/profiles/rebuild",
    response_model=RebuildResult,
    summary="Rebuild the HubSpot company profiles in memory",
    description=(
        "Builds one profile for each loaded company (industry, office cities, estimated staff, "
        "deal names and stages) and replaces the old ones. These let the engine spot a "
        "possible match and find look-alike companies. No contacts, phones or streets go in."
    ),
)
async def rebuild_profiles(session: SessionDep, embedder: EmbedderDep) -> RebuildResult:
    return RebuildResult(profiles_rebuilt=await build_profiles(session, embedder))
