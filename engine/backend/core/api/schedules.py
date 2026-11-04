"""Schedule endpoints, for the Admin page's Schedules tab. PLAN-V6 D3.

Reading needs a session, like every route. Changing a schedule and starting a job by hand spend
money (a Lead Finder run), so they need the Admin role (`AdminDep`).

A schedule is made by its job's default at the first start, never here: a person switches it on or
off, changes when it runs and what it looks for, and can start it once now. "Run now" goes through
the same loop code as a start on time (`Scheduler.run_now`), so it has the same checks and the same
record, and it never moves the next time.
"""

import logging
import uuid
from collections.abc import Awaitable
from datetime import datetime
from decimal import ROUND_DOWN, ROUND_UP, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Path, Request

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.signin import AdminDep, NowDep
from core.schedules import service
from core.schedules.calc import Cadence, describe
from core.schedules.jobs import JobContext, JobEstimate, JobSettingsError, JobSkipped, JobSpec
from core.schedules.models import Schedule
from core.schedules.runner import Scheduler
from core.schedules.runtime import all_jobs
from core.schedules.schemas import (
    RunNow,
    ScheduleEdit,
    ScheduleEstimate,
    ScheduleList,
    ScheduleOut,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["schedules"])

CENT = Decimal("0.01")
MONTH_DAYS = Decimal("30.4375")  # a year of 365.25 days in 12
NOT_AVAILABLE = "The estimate isn't available right now. The details are in the backend log."


def specs_of(request: Request) -> dict[str, JobSpec]:
    return {spec.key: spec for spec in all_jobs(request.app)}


def kind_and_id(ref: str | None) -> tuple[str | None, str | None]:
    """What a start made, from its `last_ref`: a HubSpot sync is "sync:<id>", a run is its id."""
    if not ref:
        return None, None
    if ref.startswith("sync:"):
        return "sync", ref.removeprefix("sync:")
    return "run", ref


async def attempt[T](work: Awaitable[T], fallback: T, what: str) -> T:
    """A job's hook, whose failure must not take the whole list down."""
    try:
        return await work
    except JobSkipped:
        return fallback
    except Exception:
        log.exception("schedule_hook_failed", extra={"what": what})
        return fallback


def estimate_out(estimate: JobEstimate, cadence: Cadence) -> ScheduleEstimate:
    """The job's estimate in whole cents. What a start costs is rounded up and what is left to
    spend is rounded down, so no number is kinder than the truth."""
    per_month = estimate.typical_usd * MONTH_DAYS / cadence.step
    return ScheduleEstimate(
        valid=estimate.valid,
        problem=estimate.problem,
        typical_usd=estimate.typical_usd.quantize(CENT, ROUND_UP),
        worst_usd=estimate.worst_usd.quantize(CENT, ROUND_UP),
        per_month_usd=per_month.quantize(CENT, ROUND_UP),
        cap_usd=estimate.cap_usd.quantize(CENT, ROUND_DOWN),
        daily_left_usd=estimate.daily_left_usd.quantize(CENT, ROUND_DOWN),
        basis=estimate.basis,
    )


async def estimate_of(
    spec: JobSpec, context: JobContext, cadence: Cadence
) -> ScheduleEstimate | None:
    if spec.estimate is None:
        return None
    try:
        estimate = await spec.estimate(context)
    except JobSkipped as skipped:  # the run engine isn't ready: say so instead of a number
        zero = Decimal("0.00")
        return ScheduleEstimate(
            valid=False,
            problem=skipped.reason,
            typical_usd=zero,
            worst_usd=zero,
            per_month_usd=zero,
            cap_usd=zero,
            daily_left_usd=zero,
            basis="",
        )
    except Exception:
        log.exception("schedule_hook_failed", extra={"what": "estimate"})
        zero = Decimal("0.00")
        return ScheduleEstimate(
            valid=False,
            problem=NOT_AVAILABLE,
            typical_usd=zero,
            worst_usd=zero,
            per_month_usd=zero,
            cap_usd=zero,
            daily_left_usd=zero,
            basis="",
        )
    return estimate_out(estimate, cadence)


async def build_out(
    request: Request, row: Schedule, spec: JobSpec | None, now: datetime
) -> ScheduleOut:
    """The row as the page reads it, with what its job says about the choices, the cost and
    whether it is going."""
    cadence = service.cadence_of(row)
    context = JobContext(request.app, row.id, dict(row.settings), now)
    summary, running, estimate = "", False, None
    if spec is not None:
        if spec.describe is not None:
            summary = spec.describe(context.settings)
        if spec.running is not None:
            running = await attempt(spec.running(context), False, "running")
        estimate = await estimate_of(spec, context, cadence)
    kind, last_id = kind_and_id(row.last_ref)
    return ScheduleOut.model_validate(
        {
            "id": row.id,
            "project": row.project,
            "job": row.job,
            "name": row.name,
            "enabled": row.enabled,
            "every": row.every,
            "unit": row.unit,
            "weekday": row.weekday,
            "at": row.at_time.strftime("%H:%M"),
            "timezone": row.timezone,
            "when": describe(cadence),
            "settings": row.settings,
            "summary": summary,
            "next_run_at": row.next_run_at,
            "last_run_at": row.last_run_at,
            "last_status": row.last_status,
            "last_kind": kind,
            "last_id": last_id,
            "last_error": row.last_error,
            "running": running,
            "installed": spec is not None,
            "estimate": estimate,
        }
    )


@router.get(
    "",
    response_model=ScheduleList,
    summary="Every schedule, with its next run, its last run and what one start costs",
)
async def list_schedules(request: Request, session: SessionDep, now: NowDep) -> ScheduleList:
    specs = specs_of(request)
    rows = await service.all_schedules(session)
    return ScheduleList(
        items=[await build_out(request, row, specs.get(row.job), now) for row in rows]
    )


@router.patch(
    "/{schedule_id}",
    response_model=ScheduleOut,
    summary="Switch a schedule on or off, change when it runs, or change what it looks for",
    description=(
        "Only what is sent changes. Off has no next run; on has one, kept as it is unless the "
        "schedule was off or `every`, `unit`, `weekday` or `at` changed, when it is the first "
        "time from now on. `weekday` is for `weeks` only (0 Monday to 6 Sunday). `at` is a "
        "24-hour time in Melbourne time, like `07:00`. `settings` replaces the saved choices as "
        "a whole and is checked by the job. A change that can't be made is a 422 whose error "
        "field is `body.<name>`."
    ),
)
async def edit_schedule(
    schedule_id: Annotated[uuid.UUID, Path()],
    body: ScheduleEdit,
    request: Request,
    session: SessionDep,
    now: NowDep,
    admin: AdminDep,
) -> ScheduleOut:
    row = await service.get_locked(session, schedule_id)
    if row is None:
        raise Problem(404, "Schedule not found", "There is no schedule with this id.")
    spec = specs_of(request).get(row.job)
    try:
        cadence = service.edited_cadence(row, body)
    except service.BadEdit as bad:
        raise not_valid(f"body.{bad.field}", bad.message) from None
    settings: dict[str, Any] | None = None
    if body.settings is not None:
        if spec is None or spec.check_settings is None:
            raise not_valid("body.settings", "This job takes no choices.")
        try:
            settings = spec.check_settings(dict(body.settings))
        except JobSettingsError as error:
            raise not_valid("body.settings", str(error)) from None
    service.apply_edit(row, cadence, enabled=body.enabled, settings=settings, now=now)
    await session.commit()
    await session.refresh(row)
    return await build_out(request, row, spec, now)


@router.post(
    "/{schedule_id}/run",
    response_model=RunNow,
    summary="Start the job now, once",
    description=(
        "The same start as on time, with the same checks: a Lead Finder run that doesn't fit the "
        "limits, or a job that is still going, answers `skipped` with the reason. The next run "
        "doesn't move. It works for a schedule that is switched off. Spending money is the "
        "Admin's call, so it needs the Admin role."
    ),
)
async def run_schedule_now(
    schedule_id: Annotated[uuid.UUID, Path()], request: Request, admin: AdminDep
) -> RunNow:
    scheduler: Scheduler | None = getattr(request.app.state, "scheduler", None)
    if scheduler is None:
        raise Problem(
            503,
            "Schedules aren't ready",
            "The scheduler hasn't started. Check the backend log.",
            code="schedules_not_ready",
        )
    try:
        fired = await scheduler.run_now(schedule_id)
    except LookupError:
        raise Problem(404, "Schedule not found", "There is no schedule with this id.") from None
    return RunNow(status=fired.status, ref=fired.ref, reason=fired.reason)


def not_valid(field: str, message: str) -> Problem:
    return Problem(
        422,
        "The change isn't valid",
        message,
        errors=[{"field": field, "message": message}],
    )
