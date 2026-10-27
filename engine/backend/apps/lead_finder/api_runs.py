"""Lead Finder endpoints that start or describe runs: options, re-check and tests.

The routes for the generic run engine (start, watch, stop) are in core/api/runs.py. These are the
Lead Finder's own. Like those, the routes that start a run look the run manager up inside the
route (`manager_of`), so a bad request is a 422 before an engine that isn't running is a 503.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from apps.lead_finder.options import build_run_options
from apps.lead_finder.rules import load_rules
from apps.lead_finder.runs import not_approved
from apps.lead_finder.sanitize import clean_company_name
from apps.lead_finder.schemas import RunOptions, TestPage, TestReport
from apps.lead_finder.tables import Lead
from apps.lead_finder.testing import list_testset_runs, report_of_testset
from core.api.deps import SessionDep, SettingsDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX
from core.api.runs import manager_of
from core.runs.estimate import daily_left, spent_last_24h
from core.runs.schemas import RunOut

router = APIRouter()
APP = "lead_finder"


def _run_location(request: Request, run: RunOut) -> str:
    """The address of a run (`/api/v1/runs/<id>`), from this route's own address."""
    prefix = request.url.path.split("/lead-finder/", 1)[0]
    return f"{prefix}/runs/{run.id}"


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
async def get_run_options(session: SessionDep, settings: SettingsDep) -> RunOptions:
    left = daily_left(settings.daily_cap_usd, await spent_last_24h(session))
    return build_run_options(load_rules(), settings, left)


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
async def recheck_lead(
    lead_id: uuid.UUID,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> RunOut:
    lead = await session.get(Lead, lead_id)
    if lead is None:
        raise Problem(404, "Lead not found", "There is no lead with this id.")
    if lead.origin == "hubspot" and not settings.hubspot_names_to_claude_ok:
        raise not_approved()
    # The name Claude wrote first, else the cleaned name that was asked for.
    name = clean_company_name(lead.company) or clean_company_name(lead.company_key)
    if name is None:
        raise Problem(
            422,
            "This lead can't be researched again",
            "Its company name isn't usable. Start a new run with the name typed in.",
        )
    company = {"name": name, "city": lead.city, "website": lead.domain}
    await session.rollback()  # no connection is held while the run starts
    run = await manager_of(request).start(APP, "company", {"companies": [company], "recheck": True})
    response.headers["Location"] = _run_location(request, run)
    return run


@router.post(
    "/tests/run",
    status_code=201,
    response_model=RunOut,
    summary="Run the test set",
    description="A short way to start a `testset` run. Returns the run.",
)
async def start_test_run(request: Request, response: Response) -> RunOut:
    run = await manager_of(request).start(APP, "testset", {})
    response.headers["Location"] = _run_location(request, run)
    return run


@router.get(
    "/tests",
    response_model=TestPage,
    summary="Past test set runs, newest first",
    description="One summary for each run: companies matched out of expected, and the cost.",
)
async def list_tests(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> TestPage:
    return await list_testset_runs(session, limit, offset)


@router.get(
    "/tests/{run_id}",
    response_model=TestReport,
    summary="The report of one test set run",
    description="Each company: the result that was expected, the result it got, and the cost.",
)
async def get_test_report(run_id: uuid.UUID, session: SessionDep) -> TestReport:
    return await report_of_testset(session, run_id)
