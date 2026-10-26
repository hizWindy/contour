"""HubSpot endpoints: load an export file, and see what's loaded."""

import asyncio
import logging

from fastapi import APIRouter, UploadFile
from pydantic import BaseModel, Field

from core.api.deps import EmbedderDep, SessionDep
from core.api.errors import Problem
from core.hubspot.importer import ExportError, read_export
from core.hubspot.profiles import rebuild_profiles as build_profiles
from core.hubspot.service import HubSpotSummary, ImportResult, save_export, summary

router = APIRouter(prefix="/hubspot", tags=["hubspot"])
log = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class RebuildResult(BaseModel):
    profiles_rebuilt: int = Field(description="Company profiles built from the loaded HubSpot data")


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
