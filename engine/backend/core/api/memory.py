"""Memory endpoints: save a note, and search notes by meaning."""

import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from core.api.deps import EmbedderDep, SessionDep
from core.memory.service import remember, search

router = APIRouter(prefix="/memory", tags=["memory"])

Kind = Literal["source_note", "company_profile", "lead_outcome", "note"]


class MemoryIn(BaseModel):
    app: str = Field(max_length=64, examples=["lead_finder"])
    kind: Kind = Field(examples=["source_note"])
    content: str = Field(
        min_length=1,
        max_length=20_000,
        examples=["ABC Dairy is moving its Melbourne head office to Docklands next year."],
    )
    subject: str | None = Field(default=None, max_length=300, examples=["ABC Dairy"])
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
    created_at: datetime


class MemoryHitOut(MemoryOut):
    similarity: float = Field(description="1 is the same meaning, 0 is unrelated")


@router.post("", status_code=201, response_model=MemoryOut, summary="Save a note to memory")
async def save_note(body: MemoryIn, session: SessionDep, embedder: EmbedderDep) -> MemoryOut:
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
    q: str = Query(min_length=2, max_length=500, examples=["dairy company moving offices"]),
    app: str | None = Query(default=None, examples=["lead_finder"]),
    kind: Kind | None = None,
    limit: int = Query(default=5, ge=1, le=50),
) -> list[MemoryHitOut]:
    hits = await search(session, embedder, q, app=app, kind=kind, limit=limit)
    return [
        MemoryHitOut.model_validate(
            MemoryOut.model_validate(hit.item).model_dump() | {"similarity": hit.similarity}
        )
        for hit in hits
    ]
