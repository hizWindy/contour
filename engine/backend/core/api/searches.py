"""The search log endpoint: every Claude request, what it searched and what it cost."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from core.api.access import AppAccessDep
from core.api.deps import SessionDep
from core.api.models import OFFSET_MAX, OutModel, SafeText
from core.searches.service import list_searches

router = APIRouter(prefix="/searches", tags=["searches"])


class SourceOut(OutModel):
    """A page the web tools returned for a request."""

    url: str
    title: str | None = None
    page_age: str | None = Field(None, description="How old the page says it is, as written")


class SearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    app: str
    job_id: uuid.UUID | None = Field(description="A lead id (research) or a slice id (discovery)")
    run_id: uuid.UUID | None = Field(description="The run that asked, if any")
    subject: str | None
    step: str
    model: str
    prompt_version: str | None
    queries: list[str]
    sources: list[SourceOut]
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
    access: AppAccessDep,
    app: Annotated[SafeText | None, Query(max_length=64, examples=["lead_finder"])] = None,
    job_id: uuid.UUID | None = None,
    run_id: Annotated[uuid.UUID | None, Query(description="Only requests of this run")] = None,
    subject: Annotated[SafeText | None, Query(max_length=300, examples=["Seek"])] = None,
    step: Annotated[
        SafeText | None,
        Query(
            max_length=64,
            description="The start of the step: `search` finds search:property and search:people",
            examples=["search"],
        ),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> SearchPage:
    if app is not None:
        access.check(app)
    else:
        access.check_all()
    rows, total = await list_searches(
        session,
        app=app,
        job_id=job_id,
        run_id=run_id,
        subject=subject,
        step_prefix=step,
        limit=limit,
        offset=offset,
    )
    return SearchPage(total=total, items=[SearchOut.model_validate(row) for row in rows])
