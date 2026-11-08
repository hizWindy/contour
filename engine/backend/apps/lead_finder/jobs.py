"""The Lead Finder's scheduled runs: one job for each city, like `lead_finder.discovery.melbourne`.
PLAN-V6 D2, and PLAN-V9 C4 (Levi, 5 Nov: Perth, Adelaide, Melbourne and Sydney, every 2 weeks).

A schedule starts a discovery run on its own, from the choices saved in the schedule (its
`settings`). They are the Start page's choices: `cities`, `triggers` (the signs), `area`,
`since_days` (how far back) and `caps`. What a schedule leaves out gets the Start page's starting
value. Each default saves its city, the signs, the look-back and its own company limit.

**The four default schedules:** one for each city, every 2 weeks at 7:00 am Melbourne time, on
different days of the same fortnight: Melbourne on Monday, Adelaide on Tuesday, Perth on Wednesday
and Sydney on Thursday (Sydney's leads still go to a Director). All are **off**: each run costs
money, so Al-khair switches them on. Each searches its city for the 6 main signs (6 searches),
looks back 14 days, the time between two runs, so no day is missed and none is read twice. **TBC**
with Levi (the days, the time and the signs).

**An automatic run's limits** (9 Nov, Al-khair). It has no company limit of its own: it stops at its
share of the goal (`goal.py`: 100 good leads a round by default), or when no company is left. Its
money limit is `scheduled_run_cap_usd` (US$150), a brake against a fault; a city run usually costs
about US$25 to US$30 (TBC). Both are on the Settings page, under ceilings in .env. A run a person
starts keeps its own limits (US$20 and 20 companies).

**Why separate days.** Only one run goes at a time; the daily limit is US$50; the server's memory
is small; and each email stays short.

**The schedule before PLAN-V9.** It was one job, `lead_finder.discovery` (Mondays, 3 cities). Its
job stays known here with no default, so an old schedule that someone switched on still starts
runs; migration 0013 removes it where it was still off and had never run.

**Money, before it starts.** The run's estimate is checked, the same one the Start page shows. The
run doesn't start when a typical run (`cost_usd_low`, never the worst case) costs more than the run
limit or more than what is left of today's limit; the schedule says why, in plain words, and waits
for its next time. The worst case isn't used: it is above the run limit for every discovery run, and
the run limit and the daily limit still stop the run while it works, whatever this check said.

**One run at a time.** A schedule whose last run is still going is skipped (`running`), and so is a
start while any other run holds the slot (the run manager says 409).
"""

from datetime import time
from decimal import ROUND_UP, Decimal
from typing import Any

from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy import exists, select

from apps.lead_finder.params import DiscoveryParams, default_triggers
from core.api.errors import Problem
from core.runs.manager import RunManager
from core.runs.models import TERMINAL_RUN_STATUSES, Run
from core.runs.schemas import RunCreate, RunEstimate
from core.schedules.calc import Cadence
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSettingsError,
    JobSkipped,
    JobSpec,
)

APP = "lead_finder"
MODE = "discovery"
DISCOVERY = "lead_finder.discovery"  # the job's key, and the `job` of its schedule

# The default choices, kept here in full so a change in the rules can't change a schedule without
# a decision. A test keeps the signs the same as the main signs, and each city inside the default
# limits.
CITY_DAYS: tuple[tuple[str, int], ...] = (
    ("Melbourne", 0),  # 0 is Monday
    ("Adelaide", 1),
    ("Perth", 2),
    ("Sydney", 3),  # Sydney's leads still go to a Director
)
SCHEDULED_CITIES = tuple(city for city, _ in CITY_DAYS)
SCHEDULED_SIGNS = (
    "lease_ending",
    "merger_or_takeover",
    "big_new_contract",
    "fast_growth",
    "new_to_australia",
    "hot_industry_growth",
)
LOOK_BACK_DAYS = 14
AT = time(7, 0)
LEGACY_DISCOVERY = "lead_finder.discovery"  # the one schedule before PLAN-V9 C4


def job_key(city: str) -> str:
    """The job of one city's schedule, like `lead_finder.discovery.melbourne`."""
    return f"{LEGACY_DISCOVERY}.{city.lower()}"


def cadence_for(weekday: int) -> Cadence:
    return Cadence(every=2, unit="weeks", weekday=weekday, at=AT)


def settings_for(city: str) -> dict[str, Any]:
    """What one city's default schedule saves: no limits of its own, so the automatic run's limits
    on the Settings page apply (`make_caps(..., scheduled=True)`)."""
    return {
        "cities": [city],
        "triggers": list(SCHEDULED_SIGNS),
        "since_days": LOOK_BACK_DAYS,
    }


DISCOVERY = job_key("Melbourne")  # the first city's job
DISCOVERY_KEYS = tuple(job_key(city) for city in SCHEDULED_CITIES)
DEFAULT_CADENCE = cadence_for(0)  # Melbourne's
DEFAULT_SETTINGS: dict[str, Any] = settings_for("Melbourne")

CENT = Decimal("0.01")
SLOT_TAKEN = "A run is already going, so this time was skipped."
NOT_READY = "The run engine isn't ready, so this time was skipped."
BODY_PARAMS = "body.params."


def usd(amount: Decimal) -> str:
    """Money in a sentence. Rounded up, so it never shows less than it is."""
    return f"US${amount.quantize(CENT, ROUND_UP):.2f}"


def _problems(estimate: RunEstimate) -> str:
    """The first 3 problems with the saved choices. Fields with the same words are joined, so
    "cities, triggers: 16 searches is too many" is said once."""
    fields_by_message: dict[str, list[str]] = {}
    for error in estimate.errors:
        where = error.field.removeprefix(BODY_PARAMS)
        fields_by_message.setdefault(error.message, []).append(where)
    return "; ".join(
        f"{', '.join(fields)}: {message}" for message, fields in list(fields_by_message.items())[:3]
    )


def doesnt_fit(estimate: RunEstimate) -> str | None:
    """Why this run shouldn't start, in plain words, or None when it fits.

    Pure: it reads only the estimate. A run that is blocked or can't be read is refused first; then
    the typical cost must be within the run limit, then within what is left of today's limit.
    """
    if not estimate.valid:
        return f"The saved choices can't be used. {_problems(estimate)}".rstrip()
    if estimate.blocked is not None:
        return estimate.blocked.message
    typical = estimate.cost_usd_low
    if typical > estimate.cap_usd:
        prices = f" Prices used: {estimate.basis}." if estimate.basis else ""
        return (
            f"A typical run costs about {usd(typical)}, which is more than the run limit of "
            f"{usd(estimate.cap_usd)}.{prices} Pick fewer cities or signs, or raise the run "
            "limit in Settings."
        )
    if typical > estimate.daily_left_usd:
        return (
            f"A typical run costs about {usd(typical)}, but only {usd(estimate.daily_left_usd)} "
            "is left of today's limit."
        )
    return None


def _manager(app: FastAPI) -> RunManager:
    manager: RunManager | None = getattr(app.state, "run_manager", None)
    if manager is None:
        raise JobSkipped(NOT_READY)
    return manager


def _refusal(problem: Problem) -> str:
    """What the run manager's refusal means for a schedule, in plain words."""
    if problem.code == "run_already_active":
        return SLOT_TAKEN
    return problem.detail or problem.title


async def _estimate(context: JobContext) -> RunEstimate:
    """The run's estimate for the saved choices: the one the Start page shows."""
    manager = _manager(context.app)
    return await manager.estimate(
        RunCreate(app=APP, mode=MODE, params=context.settings), scheduled=True
    )


async def start_discovery(context: JobContext) -> JobResult:
    """Starts a discovery run from the schedule's saved choices, if it fits the limits."""
    manager = _manager(context.app)
    reason = doesnt_fit(await _estimate(context))
    if reason is not None:
        raise JobSkipped(reason)
    try:
        run = await manager.start(APP, MODE, context.settings, schedule_id=context.schedule_id)
    except Problem as problem:
        if problem.status in (409, 422):  # not a fault: the choices or the slot, said plainly
            raise JobSkipped(_refusal(problem)) from None
        raise
    return JobResult(ref=str(run.id))


async def estimate_discovery_job(context: JobContext) -> JobEstimate:
    """What a run costs, for the Schedules page: typical, and the most it can (its limit)."""
    estimate = await _estimate(context)
    cap = estimate.cap_usd
    return JobEstimate(
        valid=estimate.valid,
        problem=doesnt_fit(estimate),
        typical_usd=estimate.cost_usd_low,
        worst_usd=min(estimate.cost_usd_high, cap) if cap > 0 else estimate.cost_usd_high,
        cap_usd=cap,
        daily_left_usd=estimate.daily_left_usd,
        basis=estimate.basis,
    )


def _and_list(words: list[str]) -> str:
    """ "Melbourne, Adelaide and Perth"."""
    if len(words) <= 1:
        return "".join(words)
    return f"{', '.join(words[:-1])} and {words[-1]}"


def describe_discovery(settings: dict[str, Any]) -> str:
    """The saved choices in a sentence, for the Schedules page."""
    try:
        params = DiscoveryParams.model_validate(settings)
    except ValidationError:
        return "The saved choices can't be read."
    if params.triggers == default_triggers():
        signs = f"the {len(params.triggers)} main signs"
    else:
        signs = f"{len(params.triggers)} {'sign' if len(params.triggers) == 1 else 'signs'}"
    return (
        f"Searches {_and_list(params.cities)} for {signs}, looking back {params.since_days} days."
    )


def check_discovery_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """The choices a person saved, cleaned (like the spelling of a city), or a plain message."""
    try:
        params = DiscoveryParams.model_validate(settings)
    except ValidationError as error:
        found = "; ".join(
            f"{'.'.join(str(part) for part in problem['loc'])}: {problem['msg']}"
            for problem in error.errors()[:3]
        )
        raise JobSettingsError(found) from None
    return params.model_dump(mode="json", exclude_unset=True)


async def discovery_running(context: JobContext) -> bool:
    """True while a run this schedule started is queued or going."""
    manager = _manager(context.app)
    async with manager.session_factory() as session:
        return bool(
            await session.scalar(
                select(
                    exists().where(
                        Run.schedule_id == context.schedule_id,
                        Run.status.not_in(TERMINAL_RUN_STATUSES),
                    )
                )
            )
        )


def _discovery_job(key: str, title: str, default: DefaultSchedule | None) -> JobSpec:
    return JobSpec(
        key=key,
        project=APP,
        title=title,
        start=start_discovery,
        running=discovery_running,
        estimate=estimate_discovery_job,
        describe=describe_discovery,
        check_settings=check_discovery_settings,
        default=default,
    )


JOBS = (
    *(
        _discovery_job(
            job_key(city),
            f"Find new leads: {city}",
            DefaultSchedule(cadence=cadence_for(day), enabled=False, settings=settings_for(city)),
        )
        for city, day in CITY_DAYS
    ),
    _discovery_job(LEGACY_DISCOVERY, "Find new leads", None),
)
