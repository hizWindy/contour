"""Memory endpoints: save a note, and search notes by meaning."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from core.api.access import AppAccessDep
from core.api.deps import EmbedderDep, SessionDep, SettingsDep
from core.api.errors import Problem
from core.api.models import SafeText
from core.config import Settings
from core.memory.service import remember, search

router = APIRouter(prefix="/memory", tags=["memory"])

Kind = Literal["source_note", "company_profile", "lead_outcome", "note"]


class MemoryIn(BaseModel):
    app: SafeText = Field(max_length=64, examples=["lead_finder"])
    kind: Kind = Field(examples=["source_note"])
    content: SafeText = Field(
        min_length=1,
        max_length=20_000,
        examples=["ABC Dairy is moving its Melbourne head office to Docklands next year."],
    )
    subject: SafeText | None = Field(default=None, max_length=300, examples=["ABC Dairy"])
    url: HttpUrl | None = Field(default=None, examples=["https://example.com/news/abc-dairy"])
    source_date: date | None = Field(default=None, examples=["2026-10-20"])


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    app: str
    kind: str
    subject: str | None
    content: str
    url: str | None
    source_date: date | None
    meta: dict[str, Any] = Field(description="Extra facts about the item, like its angle or lead")
    created_at: datetime


class MemoryHitOut(MemoryOut):
    similarity: float = Field(description="1 is the same meaning, 0 is unrelated")


def check_note_limits(body: MemoryIn, settings: Settings) -> None:
    """Only a person's NOTE, only for a project this engine runs, and never the HubSpot copy.

    The engine writes the other kinds itself (source notes, profiles, lead outcomes), and a
    note saved over them could mislead matching and look-alikes. Each wrong field is listed.
    """
    errors: list[dict[str, str]] = []
    if body.kind != "note":
        errors.append(
            {
                "field": "body.kind",
                "message": "Only notes can be saved here. The engine writes the other kinds.",
            }
        )
    if body.app.casefold() == "hubspot":
        errors.append(
            {
                "field": "body.app",
                "message": "Notes can't be saved to the HubSpot data. It comes from the import.",
            }
        )
    elif body.app not in settings.apps:
        errors.append(
            {
                "field": "body.app",
                "message": f"That isn't a project this engine runs. Use one of: "
                f"{', '.join(settings.apps)}.",
            }
        )
    if errors:
        raise Problem(
            422, "The request isn't valid", "Check the fields listed in errors.", errors=errors
        )


@router.post("", status_code=201, response_model=MemoryOut, summary="Save a note to memory")
async def save_note(
    body: MemoryIn,
    session: SessionDep,
    embedder: EmbedderDep,
    settings: SettingsDep,
    access: AppAccessDep,
) -> MemoryOut:
    access.check(body.app)
    check_note_limits(body, settings)
    item = await remember(
        session,
        embedder,
        app=body.app,
        kind=body.kind,
        content=body.content,
        subject=body.subject,
        url=str(body.url) if body.url else None,
        source_date=body.source_date,
    )
    return MemoryOut.model_validate(item)


@router.get(
    "/search",
    response_model=list[MemoryHitOut],
    summary="Search memory by meaning",
    description="Finds notes with a similar meaning, even when the words differ.",
)
async def search_memory(
    session: SessionDep,
    embedder: EmbedderDep,
    access: AppAccessDep,
    q: Annotated[
        SafeText, Query(min_length=2, max_length=500, examples=["dairy company moving offices"])
    ],
    app: Annotated[SafeText | None, Query(max_length=64, examples=["lead_finder"])] = None,
    kind: Kind | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 5,
) -> list[MemoryHitOut]:
    if app is not None:
        access.check(app)
    else:
        access.check_all()
    hits = await search(session, embedder, q, app=app, kind=kind, limit=limit)
    return [
        MemoryHitOut.model_validate(
            MemoryOut.model_validate(hit.item).model_dump() | {"similarity": hit.similarity}
        )
        for hit in hits
    ]
