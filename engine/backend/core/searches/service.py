"""Write and read the search log."""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.claude.client import Reply
from core.searches.models import SearchLog


def log_reply(
    session: AsyncSession,
    reply: Reply[Any],
    *,
    app: str,
    step: str,
    job_id: uuid.UUID | None = None,
    subject: str | None = None,
    prompt_version: str | None = None,
    note: str | None = None,
) -> SearchLog:
    """Adds one Claude request to the session. The caller commits."""
    row = SearchLog(
        app=app,
        job_id=job_id,
        subject=subject,
        step=step,
        model=reply.model,
        prompt_version=prompt_version,
        queries=list(reply.queries),
        sources=[{"url": s.url, "title": s.title, "page_age": s.page_age} for s in reply.sources],
        web_searches=reply.usage.web_searches,
        web_fetches=reply.usage.web_fetches,
        input_tokens=reply.usage.input_tokens,
        output_tokens=reply.usage.output_tokens,
        cache_read_tokens=reply.usage.cache_read_tokens,
        cache_write_tokens=reply.usage.cache_write_tokens,
        cost_usd=reply.cost_usd,
        stop_reason=reply.stop_reason,
        answer_ok=reply.parsed is not None,
        request_id=reply.request_id,
        note=note,
    )
    session.add(row)
    return row


async def list_searches(
    session: AsyncSession,
    *,
    app: str | None = None,
    job_id: uuid.UUID | None = None,
    subject: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[SearchLog], int]:
    """Newest first. Returns one page and the total count."""
    statement = select(SearchLog)
    if app is not None:
        statement = statement.where(SearchLog.app == app)
    if job_id is not None:
        statement = statement.where(SearchLog.job_id == job_id)
    if subject is not None:
        statement = statement.where(func.lower(SearchLog.subject) == subject.lower())
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    page = statement.order_by(SearchLog.created_at.desc()).limit(limit).offset(offset)
    return list((await session.scalars(page)).all()), total or 0
