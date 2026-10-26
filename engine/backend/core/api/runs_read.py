"""Run endpoints that only read: the estimate, the list, the cost by day, one run, and its log.

They are split from `core/api/runs.py` (start, watch, stop, resume) so the package that builds
these and the package that builds those never edit the same file. The two routers share the
`/runs` prefix and the `runs` tag. They answer 501 until built (see core/api/stubs.py). Each
route will call the matching `RunManager` method, which calls `core/runs/reads.py` or
`core/runs/estimate.py`.

`/runs/summary` and `/runs/estimate` are declared before `/runs/{run_id}`, so the id route can't
swallow them. This router is included before the other one in `create_app`.
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from core.api.models import INT32_MAX, OFFSET_MAX, SafeText
from core.api.stubs import stub
from core.runs.schemas import (
    EventLog,
    RunCreate,
    RunEstimate,
    RunOut,
    RunPage,
    RunStatus,
    RunSummary,
)

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post(
    "/estimate",
    response_model=RunEstimate,
    summary="What would this run cost?",
    description=(
        "Takes the same body as `POST /runs` but never starts anything and never calls Claude. "
        "A body that isn't valid is a normal answer with `valid: false` and the fields in "
        "`errors`. `blocked` says why a valid run can't start."
    ),
)
@stub
async def estimate_run(body: RunCreate) -> RunEstimate:
    raise NotImplementedError


@router.get(
    "",
    response_model=RunPage,
    summary="List runs, newest first",
    description=(
        "`since` and `until` are dates in Australia/Melbourne, the same kind of date as `since` "
        "of `GET /runs/summary`. A run is in when the Melbourne day it was created on is on or "
        "after `since` and on or before `until`. `offset` can't pass 1000000."
    ),
)
@stub
async def list_runs(
    app: Annotated[SafeText | None, Query(max_length=64, examples=["lead_finder"])] = None,
    mode: Annotated[SafeText | None, Query(max_length=32, examples=["discovery"])] = None,
    status: Annotated[
        list[RunStatus] | None, Query(description="Repeat the key to match several")
    ] = None,
    since: Annotated[
        date | None, Query(description="Created on or after this day (Australia/Melbourne)")
    ] = None,
    until: Annotated[
        date | None, Query(description="Created on or before this day (Australia/Melbourne)")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> RunPage:
    raise NotImplementedError


@router.get(
    "/summary",
    response_model=RunSummary,
    summary="Cost and runs by day",
    description=(
        "For the cost chart. Days without a run are left out. Each day is a date in "
        "Australia/Melbourne, by the time the run was created."
    ),
)
@stub
async def run_summary(
    since: Annotated[
        date | None,
        Query(description="First day (Australia/Melbourne). Default: 30 days ago"),
    ] = None,
) -> RunSummary:
    raise NotImplementedError


@router.get("/{run_id}", response_model=RunOut, summary="One run")
@stub
async def get_run(run_id: uuid.UUID) -> RunOut:
    raise NotImplementedError


@router.get(
    "/{run_id}/log",
    response_model=EventLog,
    summary="The events of a run, oldest first",
    description=(
        "The same events the live stream sends, from the saved copy. Read the next page with "
        "`after` set to the last `seq` you have. `last_seq` is the highest `seq` the run has."
    ),
)
@stub
async def get_run_log(
    run_id: uuid.UUID,
    after: Annotated[
        int, Query(ge=0, le=INT32_MAX, description="Only events with a higher seq")
    ] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
) -> EventLog:
    raise NotImplementedError
