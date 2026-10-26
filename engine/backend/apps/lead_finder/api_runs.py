"""Lead Finder endpoints that start or describe runs: options, re-check and tests.

Every route answers 501 until its package builds it (see core/api/stubs.py). The routes for the
generic run engine (start, watch, stop) are in core/api/runs.py. These are the Lead Finder's
own.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from apps.lead_finder.schemas import RunOptions, TestPage, TestReport
from core.api.models import OFFSET_MAX
from core.api.stubs import stub
from core.runs.schemas import RunOut

router = APIRouter()


@router.get(
    "/run-options",
    response_model=RunOptions,
    summary="What the Start page offers",
    description=(
        "Cities (with their areas and map centres), triggers, the 7 or 30 day choice, the "
        "modes (and whether each is approved), the company list limit, the caps in force, "
        "and the default choices."
    ),
)
@stub
async def get_run_options() -> RunOptions:
    raise NotImplementedError


@router.post(
    "/leads/{lead_id}/recheck",
    status_code=201,
    response_model=RunOut,
    summary="Research this company again",
    description=(
        "Starts a one-company run that searches again even when memory is fresh, and returns "
        "the new run. It costs money, so the website asks first and offers no Undo."
    ),
)
@stub
async def recheck_lead(lead_id: uuid.UUID) -> RunOut:
    raise NotImplementedError


@router.post(
    "/tests/run",
    status_code=201,
    response_model=RunOut,
    summary="Run the test set",
    description="A short way to start a `testset` run. Returns the run.",
)
@stub
async def start_test_run() -> RunOut:
    raise NotImplementedError


@router.get(
    "/tests",
    response_model=TestPage,
    summary="Past test set runs, newest first",
    description="One summary for each run: companies matched out of expected, and the cost.",
)
@stub
async def list_tests(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> TestPage:
    raise NotImplementedError


@router.get(
    "/tests/{run_id}",
    response_model=TestReport,
    summary="The report of one test set run",
    description="Each company: the result that was expected, the result it got, and the cost.",
)
@stub
async def get_test_report(run_id: uuid.UUID) -> TestReport:
    raise NotImplementedError
