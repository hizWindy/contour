"""Save text to memory, and search it by meaning."""

from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from core.memory.embedder import Embedder
from core.memory.models import MemoryItem

DELETE_CHUNK = 5000  # ids in one delete
# Notes embedded and saved together. Small enough that a stop (a cancelled HubSpot sync) waits
# for one short batch, not a long one: an embedding batch can't be stopped part way (PLAN-V15).
EMBED_BATCH = 64
# Told how many notes are embedded so far, and how many in all.
EmbedProgress = Callable[[int, int], Awaitable[None]]


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
    apps: Sequence[str] | None = None,
    kind: str | None = None,
    limit: int = 5,
) -> list[MemoryHit]:
    vector = await embedder.embed_query(query)
    distance = MemoryItem.embedding.cosine_distance(vector).label("distance")
    statement = select(MemoryItem, distance).order_by(distance).limit(limit)
    if app is not None:
        statement = statement.where(MemoryItem.app == app)
    if apps is not None:
        statement = statement.where(MemoryItem.app.in_(list(apps)))
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
    progress: EmbedProgress | None = None,
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
    await _embed_and_add(session, embedder, notes, app=app, kind=kind, progress=progress)
    return len(notes)


async def replace_changed_items(
    session: AsyncSession,
    embedder: Embedder,
    notes: list[Note],
    *,
    app: str,
    kind: str,
    meta_key: str,
    scope: Collection[str] | None = None,
    progress: EmbedProgress | None = None,
) -> int:
    """Brings the items of one app and kind in line with `notes`, one item for each value of
    `meta[meta_key]`: all of them, or only those whose value is in `scope`. Returns how many
    texts were embedded (PLAN-V15 T1-4).

    Embedding is the slow part (about 14,000 company profiles), and most texts don't change from
    one sync to the next. So an item whose text is the same keeps its embedding: only its
    subject, address, date and meta are updated, if they changed. A new or changed text is
    embedded and saved; an item with no note any more (or a second one for the same value) is
    deleted. Like `replace_items`, it all happens in the caller's transaction: the caller
    commits.
    """
    key = MemoryItem.meta[meta_key].astext
    columns = (
        MemoryItem.id,
        key,
        MemoryItem.content,
        MemoryItem.subject,
        MemoryItem.url,
        MemoryItem.source_date,
        MemoryItem.meta,
    )
    mine = (MemoryItem.app == app, MemoryItem.kind == kind)
    rows: list[Any] = []
    if scope is None:
        rows = list(await session.execute(select(*columns).where(*mine)))
    else:
        wanted = list(dict.fromkeys(scope))
        for start in range(0, len(wanted), DELETE_CHUNK):
            chunk = wanted[start : start + DELETE_CHUNK]
            rows += list(await session.execute(select(*columns).where(*mine, key.in_(chunk))))
    existing: dict[str | None, Any] = {}
    drop: list[UUID] = []
    for row in rows:
        if row[1] in existing:
            drop.append(row[0])  # a second item for one value: only one is kept
        else:
            existing[row[1]] = row
    to_embed: list[Note] = []
    for note in notes:
        meta = note.meta or {}
        value = meta.get(meta_key)
        old = existing.pop(None if value is None else str(value), None)
        if old is not None and old[2] == note.content:
            if (old[3], old[4], old[5], old[6]) != (note.subject, note.url, note.source_date, meta):
                await session.execute(
                    update(MemoryItem)
                    .where(MemoryItem.id == old[0])
                    .values(
                        subject=note.subject, url=note.url, source_date=note.source_date, meta=meta
                    )
                )
            continue
        if old is not None:
            drop.append(old[0])
        to_embed.append(note)
    drop += [row[0] for row in existing.values()]
    for start in range(0, len(drop), DELETE_CHUNK):
        await session.execute(
            delete(MemoryItem).where(MemoryItem.id.in_(drop[start : start + DELETE_CHUNK]))
        )
    await _embed_and_add(session, embedder, to_embed, app=app, kind=kind, progress=progress)
    return len(to_embed)


async def _embed_and_add(
    session: AsyncSession,
    embedder: Embedder,
    notes: list[Note],
    *,
    app: str,
    kind: str,
    progress: EmbedProgress | None = None,
) -> None:
    """Embeds and adds the notes a batch at a time, so 14,000 company profiles never sit in
    memory as numbers all at once. `progress`, if given, hears how far it has got after each
    batch (and 0 before the first)."""
    if progress is not None:
        await progress(0, len(notes))
    for start in range(0, len(notes), EMBED_BATCH):
        batch = notes[start : start + EMBED_BATCH]
        vectors = await embedder.embed_passages([note.content for note in batch])
        added = _add_all(session, batch, vectors, app=app, kind=kind)
        await session.flush()
        for item in added:  # saved: the session needn't keep thousands of them in memory
            session.expunge(item)
        if progress is not None:
            await progress(start + len(batch), len(notes))


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
    session: AsyncSession,
    embedder: Embedder,
    notes: list[Note],
    *,
    app: str,
    kind: str,
    progress: EmbedProgress | None = None,
) -> int:
    """Swaps every item of one app and kind for `notes`. Returns how many were saved.

    The delete and the new items are in the caller's transaction: the caller commits, and
    nobody ever sees the old items gone and the new ones missing. If embedding fails part way,
    the error goes up and the caller's rollback keeps the old items.
    """
    await delete_items(session, app=app, kind=kind)
    await _embed_and_add(session, embedder, notes, app=app, kind=kind, progress=progress)
    return len(notes)
