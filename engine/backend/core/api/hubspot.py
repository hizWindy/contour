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
from core.hubspot.profiles import RebuildRunning
from core.hubspot.profiles import rebuild_profiles as build_profiles
from core.hubspot.service import HubSpotSummary, ImportResult, save_export, summary
from core.hubspot.sync import (
    SyncAlreadyRunning,
    SyncNotFound,
    SyncNotRunning,
    SyncOut,
    recent_syncs,
)
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
    "An admin needs to add the HubSpot key.",
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


@router.post(
    "/syncs/{sync_id}/cancel",
    status_code=202,
    response_model=SyncOut,
    summary="Stop a running HubSpot sync",
    description=(
        "Saves the Stop on the sync, then stops it, within about 5 seconds when this backend "
        "runs it. Stopped before its save, our copy doesn't change. Stopped after it, the "
        "companies stay, and people and profiles update with the next sync. The answer is the "
        "sync: `cancelled` once it has stopped, or still `running` with `cancel_requested_at` "
        "while the other backend (during a deploy) stops it. Follow it with GET /hubspot/syncs."
    ),
)
async def cancel_hubspot_sync(request: Request, sync_id: int) -> SyncOut:
    try:
        return await sync_runner(request.app).cancel(sync_id)
    except SyncNotFound as error:
        raise Problem(
            404, "No such HubSpot sync", "Look at the list of syncs again.", code="sync_not_found"
        ) from error
    except SyncNotRunning as error:
        raise Problem(
            409,
            "This sync has already finished",
            "There is nothing to stop.",
            code="not_running",
        ) from error


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
        rebuilt = await build_profiles(session, embedder, wait=False)
    except RebuildRunning as error:
        raise Problem(
            409,
            "The companies were loaded, but another rebuild of the profiles is running",
            "Press Rebuild profiles on the Admin page in a minute, so the new companies get "
            "theirs.",
            code="rebuild_running",
        ) from error
    except Exception as error:  # the import itself worked, so say what is left to do
        log.exception("profiles_not_rebuilt_after_import")
        raise Problem(
            503,
            "The companies were loaded, but their profiles weren't built",
            "Press Rebuild profiles on the Admin page.",
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
    try:
        built = await build_profiles(session, embedder, wait=False)
    except RebuildRunning as error:  # a second press, or a sync rebuilding them now
        raise Problem(
            409,
            "The company profiles are being rebuilt now",
            "Wait a minute, then look again.",
            code="rebuild_running",
        ) from error
    return RebuildResult(profiles_rebuilt=built)
