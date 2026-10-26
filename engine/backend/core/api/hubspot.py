"""HubSpot endpoints: load an export file, and see what's loaded."""

import asyncio

from fastapi import APIRouter, UploadFile
from pydantic import BaseModel, Field

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.stubs import stub
from core.hubspot.importer import ExportError, read_export
from core.hubspot.service import HubSpotSummary, ImportResult, save_export, summary

router = APIRouter(prefix="/hubspot", tags=["hubspot"])

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
async def import_export(file: UploadFile, session: SessionDep) -> ImportResult:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise Problem(422, "Upload an .xlsx file", "Export the companies from HubSpot as Excel.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise Problem(413, "The file is too large", "The limit is 20 MB.")
    try:
        export = await asyncio.to_thread(read_export, data)
    except ExportError as error:
        raise Problem(422, "This file can't be loaded", str(error)) from error
    return await save_export(session, export)


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
@stub
async def rebuild_profiles(session: SessionDep) -> RebuildResult:
    raise NotImplementedError
