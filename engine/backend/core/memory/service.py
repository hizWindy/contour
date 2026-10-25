"""Save text to memory, and search it by meaning."""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.memory.embedder import Embedder
from core.memory.models import MemoryItem


@dataclass(frozen=True)
class MemoryHit:
    item: MemoryItem
    similarity: float  # 1 is the same meaning, 0 is unrelated


async def remember(
    session: AsyncSession,
    embedder: Embedder,
    *,
    app: str,
    kind: str,
    content: str,
    subject: str | None = None,
    url: str | None = None,
    source_date: date | None = None,
    meta: dict[str, Any] | None = None,
) -> MemoryItem:
    [vector] = await embedder.embed_passages([content])
    item = MemoryItem(
        app=app,
        kind=kind,
        content=content,
        subject=subject,
        url=url,
        source_date=source_date,
        meta=meta or {},
        embedding=vector,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@dataclass(frozen=True)
class Note:
    """One piece of text to save with remember_many."""

    content: str
    subject: str | None = None
    url: str | None = None
    source_date: date | None = None
    meta: dict[str, Any] | None = None


async def remember_many(
    session: AsyncSession, embedder: Embedder, notes: list[Note], *, app: str, kind: str
) -> None:
    """Saves several notes in one go. The caller commits."""
    if not notes:
        return
    vectors = await embedder.embed_passages([note.content for note in notes])
    for note, vector in zip(notes, vectors, strict=True):
        session.add(
            MemoryItem(
                app=app,
                kind=kind,
                content=note.content,
                subject=note.subject,
                url=note.url,
                source_date=note.source_date,
                meta=note.meta or {},
                embedding=vector,
            )
        )


async def recent(
    session: AsyncSession,
    *,
    app: str,
    kind: str,
    subject: str,
    since: datetime,
) -> list[MemoryItem]:
    """Items about one subject saved after `since`, newest first. No embedding needed."""
    statement = (
        select(MemoryItem)
        .where(
            MemoryItem.app == app,
            MemoryItem.kind == kind,
            func.lower(MemoryItem.subject) == subject.lower(),
            MemoryItem.created_at >= since,
        )
        .order_by(MemoryItem.created_at.desc())
    )
    return list((await session.scalars(statement)).all())


async def search(
    session: AsyncSession,
    embedder: Embedder,
    query: str,
    *,
    app: str | None = None,
    kind: str | None = None,
    limit: int = 5,
) -> list[MemoryHit]:
    vector = await embedder.embed_query(query)
    distance = MemoryItem.embedding.cosine_distance(vector).label("distance")
    statement = select(MemoryItem, distance).order_by(distance).limit(limit)
    if app is not None:
        statement = statement.where(MemoryItem.app == app)
    if kind is not None:
        statement = statement.where(MemoryItem.kind == kind)
    rows = (await session.execute(statement)).all()
    return [MemoryHit(item=row[0], similarity=round(1 - float(row[1]), 4)) for row in rows]
