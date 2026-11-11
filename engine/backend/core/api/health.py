"""Health endpoints.

- `GET /api/v1/health`: is the backend up, and can it reach the database and pgvector? Anyone with
  a session (and the platform's own check) may ask. Unchanged.
- `GET /api/v1/health/details` (PLAN-V13 T1-2): every system's check, for Admin's Health tab. For
  Admins only. The answer is kept for `FRESH_SECONDS` (60), so a page refresh doesn't check again;
  `refresh=true` checks again now. Every check is free (see `core.health`).
"""

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OutModel
from core.api.signin import AdminDep, NowDep
from core.config import get_settings
from core.db.engine import get_sessionmaker
from core.health.checks import Context, Probes, ScheduleState, all_checks
from core.health.run import Result, run_checks
from core.health.traffic import Traffic

router = APIRouter(tags=["health"])

FRESH_SECONDS = 60.0

HealthState = Literal["ok", "problem", "off"]
SystemId = Literal["database", "claude", "hubspot", "signalhire", "email", "schedules", "api"]


class HealthOut(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
    pgvector: str
    apps: list[str]


@router.get(
    "/health",
    summary="Check the backend and the database",
    response_model=HealthOut,
    responses={503: {"description": "The database or pgvector isn't ready"}},
)
async def health(request: Request, session: SessionDep) -> HealthOut:
    try:
        version = await session.scalar(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        )
    except (DBAPIError, OSError) as error:
        raise Problem(
            503, "The database can't be reached", "Start it with: docker compose up -d"
        ) from error
    if version is None:
        raise Problem(503, "pgvector isn't turned on", "Run: uv run engine migrate")
    return HealthOut(
        status="ok",
        database="ok",
        pgvector=str(version),
        apps=[spec.name for spec in request.app.state.apps],
    )


# --- The details, for Admin's Health tab -------------------------------------------------------


class SystemCheckOut(OutModel):
    id: SystemId
    name: str = Field(examples=["HubSpot"])
    state: HealthState = Field(description="ok, problem, or off (not set up here)")
    sentence: str = Field(
        description="What the check found, in one plain sentence",
        examples=["Last sync 6:02 am, 13,913 companies."],
    )
    next_step: str | None = Field(description="What to do about it. Set for a problem or off")
    took_ms: int = Field(description="How long the check took, in milliseconds")
    checked_at: datetime


class ScheduleCheckOut(OutModel):
    id: uuid.UUID
    job: str
    name: str
    enabled: bool
    state: HealthState
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_status: Literal["starting", "started", "skipped", "failed"] | None
    note: str | None = Field(description="Why it is a problem, in plain words")


class EndpointTrafficOut(OutModel):
    method: str = Field(examples=["GET"])
    path: str = Field(examples=["/api/v1/runs/{run_id}"])
    requests: int
    errors: int = Field(description="Answers of 500 and above: faults")
    refused: int = Field(description="Answers of 400 to 499: not allowed, or not valid")
    average_ms: int = Field(description="The average time to start the answer")
    slowest_ms: int


class ApiTrafficOut(OutModel):
    since: datetime = Field(
        description="The start of the counts: an hour ago, or when the backend started"
    )
    requests: int
    errors: int
    endpoints: list[EndpointTrafficOut] = Field(
        description="Each endpoint with requests: errors first, then the slowest"
    )


class HealthDetails(OutModel):
    checked_at: datetime
    fresh_until: datetime = Field(description="Until then, the same answer is sent again")
    checks: list[SystemCheckOut]
    schedules: list[ScheduleCheckOut]
    api: ApiTrafficOut | None = Field(description="Empty when this backend doesn't count")


def _check_out(result: Result) -> SystemCheckOut:
    return SystemCheckOut(
        id=result.id,
        name=result.name,
        state=result.finding.state,
        sentence=result.finding.sentence,
        next_step=result.finding.next_step,
        took_ms=result.took_ms,
        checked_at=result.checked_at,
    )


def _schedules_out(results: list[Result]) -> list[ScheduleCheckOut]:
    for result in results:
        if result.id == "schedules" and isinstance(result.finding.data, list):
            return [
                ScheduleCheckOut.model_validate(item.__dict__)
                for item in result.finding.data
                if isinstance(item, ScheduleState)
            ]
    return []


def _api_out(results: list[Result]) -> ApiTrafficOut | None:
    for result in results:
        if result.id == "api" and isinstance(result.finding.data, Traffic):
            traffic = result.finding.data
            return ApiTrafficOut(
                since=datetime.fromtimestamp(traffic.since, tz=UTC),
                requests=traffic.requests,
                errors=traffic.errors,
                endpoints=[
                    EndpointTrafficOut.model_validate(item.__dict__) for item in traffic.endpoints
                ],
            )
    return None


def _probes(app: FastAPI) -> Probes:
    """The calls to the outside: the real ones, or a test's fakes in `app.state.health_probes`."""
    probes = getattr(app.state, "health_probes", None)
    return probes if isinstance(probes, Probes) else Probes()


def _lock(app: FastAPI) -> asyncio.Lock:
    lock = getattr(app.state, "health_lock", None)
    if lock is None:
        lock = asyncio.Lock()
        app.state.health_lock = lock
    return lock


async def health_details_of(app: FastAPI, now: datetime, *, refresh: bool) -> HealthDetails:
    """The checks, or the answer kept from less than a minute ago. One check at a time: a second
    request waits for the first and gets its answer."""
    async with _lock(app):
        kept: tuple[HealthDetails, float] | None = getattr(app.state, "health_details", None)
        if kept is not None and not refresh and time.monotonic() - kept[1] < FRESH_SECONDS:
            return kept[0]
        sessions = getattr(app.state, "session_factory", None) or get_sessionmaker()
        context = Context(
            app=app,
            settings=getattr(app.state, "health_settings", None) or get_settings(),
            sessions=sessions,
            now=now,
            refresh=refresh,
            probes=_probes(app),
        )
        results = await run_checks(all_checks(context), clock=lambda: now)
        details = HealthDetails(
            checked_at=now,
            fresh_until=now + timedelta(seconds=FRESH_SECONDS),
            checks=[_check_out(result) for result in results],
            schedules=_schedules_out(results),
            api=_api_out(results),
        )
        app.state.health_details = (details, time.monotonic())
        return details


@router.get(
    "/health/details",
    response_model=HealthDetails,
    summary="Every system's health, for Admin's Health tab",
    description=(
        "One check for each system: the database, Claude, HubSpot, Signal Hire, email, the "
        "schedules and the API. Each is free (no paid Claude request, no email sent), runs at the "
        "same time as the others and stops at 5 seconds. The answer is kept for 60 seconds; "
        "`refresh=true` checks again now. For Admins only."
    ),
)
async def health_details(
    request: Request,
    now: NowDep,
    admin: AdminDep,
    refresh: Annotated[bool, Query(description="Check again now")] = False,
) -> HealthDetails:
    return await health_details_of(request.app, now, refresh=refresh)
