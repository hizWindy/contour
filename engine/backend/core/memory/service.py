"""Save text to memory, and search it by meaning."""

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from core.memory.embedder import Embedder
from core.memory.models import MemoryItem

DELETE_CHUNK = 5000  # ids in one delete
EMBED_BATCH = 512  # notes embedded and saved together


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


async def search_similar(
    session: AsyncSession,
    vector: list[float],
    *,
    app: str,
    kind: str,
    meta_filter: Mapping[str, Any] | None = None,
    exclude_ids: Collection[UUID] = (),
    limit: int = 10,
) -> list[MemoryHit]:
    """The items of one app and kind closest to `vector`, best first.

    `meta_filter` keeps only items whose `meta` contains all of its keys and values (a JSONB
    contains test), like `{"has_deal": True}`. `exclude_ids` leaves items out (a lead's own
    profile). The filters are applied FIRST and the distances are worked out exactly over what
    is left. A vector index (HNSW) would pick its nearest items before the filters and could
    return too few, which silently hides look-alikes once memory holds many other items. The
    set after the filters is small (the company profiles of one app), so the exact scan is cheap.
    """
    candidates = select(MemoryItem).where(MemoryItem.app == app, MemoryItem.kind == kind)
    if meta_filter:
        candidates = candidates.where(MemoryItem.meta.contains(dict(meta_filter)))
    if exclude_ids:
        candidates = candidates.where(MemoryItem.id.not_in(list(exclude_ids)))
    # MATERIALIZED makes Postgres filter first. Without it the planner may fold the filter into
    # the vector index scan.
    pool = candidates.cte("candidates").prefix_with("MATERIALIZED")
    item = aliased(MemoryItem, pool)
    distance = item.embedding.cosine_distance(vector).label("distance")
    statement = select(item, distance).order_by(distance, item.id).limit(limit)
    rows = (await session.execute(statement)).all()
    return [MemoryHit(item=row[0], similarity=round(1 - float(row[1]), 4)) for row in rows]


async def delete_items(
    session: AsyncSession,
    *,
    app: str,
    kind: str,
    meta_filter: Mapping[str, Any] | None = None,
) -> int:
    """Deletes every item of one app and kind (or only those whose meta contains
    `meta_filter`). Returns how many. The caller commits."""
    statement = delete(MemoryItem).where(MemoryItem.app == app, MemoryItem.kind == kind)
    if meta_filter:
        statement = statement.where(MemoryItem.meta.contains(dict(meta_filter)))
    result = await session.execute(statement)
    return cast("CursorResult[Any]", result).rowcount


async def replace_items_where(
    session: AsyncSession,
    embedder: Embedder,
    notes: list[Note],
    *,
    app: str,
    kind: str,
    meta_key: str,
    values: Collection[str],
) -> int:
    """Swaps the items of one app and kind whose `meta[meta_key]` is one of `values` for
    `notes`, and leaves every other item alone. Returns how many were saved.

    Like `replace_items`, the caller commits. A value with no note is just deleted (a company
    that is gone).
    """
    wanted = list(dict.fromkeys(values))
    for start in range(0, len(wanted), DELETE_CHUNK):
        await session.execute(
            delete(MemoryItem).where(
                MemoryItem.app == app,
                MemoryItem.kind == kind,
                MemoryItem.meta[meta_key].astext.in_(wanted[start : start + DELETE_CHUNK]),
            )
        )
    await _embed_and_add(session, embedder, notes, app=app, kind=kind)
    return len(notes)


async def _embed_and_add(
    session: AsyncSession,
    embedder: Embedder,
    notes: list[Note],
    *,
    app: str,
    kind: str,
) -> None:
    """Embeds and adds the notes a batch at a time, so 14,000 company profiles never sit in
    memory as numbers all at once."""
    for start in range(0, len(notes), EMBED_BATCH):
        batch = notes[start : start + EMBED_BATCH]
        vectors = await embedder.embed_passages([note.content for note in batch])
        added = _add_all(session, batch, vectors, app=app, kind=kind)
        await session.flush()
        for item in added:  # saved: the session needn't keep thousands of them in memory
            session.expunge(item)


def _add_all(
    session: AsyncSession,
    notes: list[Note],
    vectors: list[list[float]],
    *,
    app: str,
    kind: str,
) -> list[MemoryItem]:
    items = [
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
        for note, vector in zip(notes, vectors, strict=True)
    ]
    session.add_all(items)
    return items


async def replace_items(
    session: AsyncSession, embedder: Embedder, notes: list[Note], *, app: str, kind: str
) -> int:
    """Swaps every item of one app and kind for `notes`. Returns how many were saved.

    The delete and the new items are in the caller's transaction: the caller commits, and
    nobody ever sees the old items gone and the new ones missing. If embedding fails part way,
    the error goes up and the caller's rollback keeps the old items.
    """
    await delete_items(session, app=app, kind=kind)
    await _embed_and_add(session, embedder, notes, app=app, kind=kind)
    return len(notes)
