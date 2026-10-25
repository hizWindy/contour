"""Save text to memory, and search it by meaning."""

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
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
