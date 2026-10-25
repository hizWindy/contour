"""The search log endpoint: every Claude request, what it searched and what it cost."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict

from core.api.deps import SessionDep
from core.searches.service import list_searches

router = APIRouter(prefix="/searches", tags=["searches"])


class SearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    app: str
    job_id: uuid.UUID | None
    subject: str | None
    step: str
    model: str
    prompt_version: str | None
    queries: list[str]
    sources: list[dict[str, Any]]
    web_searches: int
    web_fetches: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    cost_usd: Decimal
    stop_reason: str | None
    answer_ok: bool
    note: str | None
    created_at: datetime


class SearchPage(BaseModel):
    total: int
    items: list[SearchOut]


@router.get("", response_model=SearchPage, summary="The search log, newest first")
async def get_searches(
    session: SessionDep,
    app: str | None = Query(default=None, examples=["lead_finder"]),
    job_id: uuid.UUID | None = None,
    subject: str | None = Query(default=None, examples=["Seek"]),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> SearchPage:
    rows, total = await list_searches(
        session, app=app, job_id=job_id, subject=subject, limit=limit, offset=offset
    )
    return SearchPage(total=total, items=[SearchOut.model_validate(row) for row in rows])
