"""The city schedules as one control (PLAN-V13 T1-3): on or off, the cities, how often, the first
day and time, and the round's budget.

The four city schedules (`jobs.py`: Melbourne, Adelaide, Perth and Sydney) stay four rows in the
schedules table, so the scheduler, "Run now" and the Runs page work as before. This file reads them
as one plan and writes one plan to all four, in one transaction.

**How a plan becomes the four schedules.** Picked cities are on, one day apart in the fixed order
(Melbourne, Adelaide, Perth, Sydney), starting on the first day. The others are off. Example: Perth
and Sydney, every 2 weeks from Wednesday at 7:00 am, gives Perth on Wednesday and Sydney on
Thursday. The first round is the next first day still to come.
- **Every N weeks:** each city's schedule has its own weekday (Perth Wednesday, Sydney Thursday),
  the way `core.schedules.calc` keeps a schedule in weeks.
- **Every N days:** a schedule in days has no weekday (`calc.first_run` would put it on the next
  time of day), so the first time of each city is set here: the first day, then one day later for
  each city after it. `calc.next_after` keeps them one day apart from then on.
- **A round must end before the next starts:** 4 cities take 4 days, so every 4 days or more.
- **The look-back** (`since_days`) follows how often: 7 days for a round every week or less, 14
  for up to every 2 weeks, else 30 (the longest a run may look back).

**When the plan is kept.** A save that changes only the budget, or saves the same plan again, keeps
each schedule's next time. Any other change (cities, how often, the day or the time, or switching
it on) plans the next round from now.

**While the round is off,** the four schedules are off, and the picked cities and the first day are
kept in one record (`lead_finder_round` in the settings table, never read as a setting), so
switching it on again brings them back.

**The budget** is the setting `lead_finder_round_cap_usd` (`goal.py` applies it), saved through the
Settings code, so its bounds and its ceiling are checked the same way.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.goal import (
    Round,
    budget_left,
    city_schedules,
    good_of,
    round_so_far,
    spent_reason,
    usd_words,
)
from apps.lead_finder.jobs import JOBS, SCHEDULED_CITIES, job_key
from core.api.errors import Problem
from core.api.models import OutModel
from core.config import Settings
from core.prefs.models import Setting
from core.runs.models import Run
from core.schedules import service
from core.schedules.calc import DEFAULT_ZONE, WEEKDAYS, Cadence, Unit, describe, slot
from core.schedules.models import Schedule
from core.schedules.schemas import CLOCK, EVERY_MAX

PLAN_KEY = "lead_finder_round"
CITIES = SCHEDULED_CITIES  # the fixed order
ZONE = ZoneInfo(DEFAULT_ZONE)
LOOK_BACKS = (7, 14, 30)  # what a discovery run may look back (params.SinceDays)
DEFAULT_WEEKDAY = 0  # Monday, as the four default schedules

City = Literal["Melbourne", "Adelaide", "Perth", "Sydney"]


# --- What the endpoints take and send -------------------------------------------------------------


class RoundIn(BaseModel):
    """The whole plan. Every field is needed: the page always sends what it shows."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(description="On or off, for the whole round. On spends money")
    cities: list[City] = Field(
        min_length=1, max_length=4, description="The cities to search, in any order"
    )
    every: int = Field(ge=1, le=365, description="Every how many days or weeks")
    unit: Unit
    weekday: int = Field(ge=0, le=6, description="The first day: 0 Monday to 6 Sunday")
    at: str = Field(description="The time of day, 24-hour, Melbourne time", examples=["07:00"])
    budget_usd: Decimal = Field(
        gt=0, max_digits=7, decimal_places=2, description="The most a whole round may spend"
    )

    @field_validator("at")
    @classmethod
    def _clock(cls, value: str) -> str:
        if not CLOCK.fullmatch(value):
            raise ValueError("Use a 24-hour time like 07:00")
        return value

    @field_validator("cities")
    @classmethod
    def _once_each(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Pick each city once")
        return value


class RoundRunOut(OutModel):
    """A city's newest automatic run."""

    id: uuid.UUID
    created_at: datetime
    status: str
    good_leads: int = Field(description="Pass and Director review leads")
    cost_usd: Decimal


class RoundCityOut(OutModel):
    city: City
    picked: bool
    schedule_id: uuid.UUID | None = Field(description="Empty until the scheduler made it")
    enabled: bool
    day: str | None = Field(description="Its day of the week, for a round in weeks")
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_status: Literal["starting", "started", "skipped", "failed"] | None
    last_error: str | None = Field(description="Why its last start didn't happen")
    last_run: RoundRunOut | None


class RoundSoFarOut(OutModel):
    started_at: datetime | None = Field(description="When this round began")
    next_round_at: datetime | None = Field(description="When the next one begins, while it is on")
    runs: int
    good_leads: int
    goal: int = Field(description="The good leads a round aims for (Settings)")
    spent_usd: Decimal
    left_usd: Decimal = Field(description="What is left of the round's budget")


class RoundOut(OutModel):
    enabled: bool
    cities: list[City] = Field(description="The picked cities, in the fixed order")
    every: int
    unit: Unit
    weekday: int = Field(description="The first day: 0 Monday to 6 Sunday")
    at: str = Field(examples=["07:00"])
    timezone: str = Field(examples=["Australia/Melbourne"])
    when: str = Field(examples=["Every 2 weeks from Monday at 7:00 am"])
    summary: str = Field(
        description="The plan in a sentence",
        examples=[
            "Next round: Mon 16 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, "
            "Sydney Thu. Up to US$150."
        ],
    )
    budget_usd: Decimal = Field(description="The most a whole round may spend")
    budget_max_usd: Decimal = Field(description="The highest budget allowed (the ceiling)")
    run_cap_usd: Decimal = Field(description="The most one automatic run may spend")
    note: str | None = Field(description="Why the next city won't start, when the budget is spent")
    round: RoundSoFarOut
    city_plan: list[RoundCityOut] = Field(description="The four cities, in the fixed order")


# --- The plan, pure ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Plan:
    enabled: bool
    cities: tuple[str, ...]  # in the fixed order
    every: int
    unit: Unit
    weekday: int
    at: time

    @property
    def step(self) -> int:
        return self.every * 7 if self.unit == "weeks" else self.every

    def same_times(self, other: "Plan") -> bool:
        return (self.cities, self.every, self.unit, self.weekday, self.at) == (
            other.cities,
            other.every,
            other.unit,
            other.weekday,
            other.at,
        )


@dataclass(frozen=True)
class CityTime:
    weekday: int | None  # for a schedule in weeks
    first: datetime  # its first time


def in_order(cities: Sequence[str]) -> tuple[str, ...]:
    return tuple(city for city in CITIES if city in cities)


def look_back(step_days: int) -> int:
    """How far back a run looks: the shortest look-back that covers the time between rounds."""
    return next((days for days in LOOK_BACKS if step_days <= days), LOOK_BACKS[-1])


def round_times(plan: Plan, now: datetime) -> dict[str, CityTime]:
    """Each picked city's first time: the first day still to come, then a day later for each
    city after it. Pure."""
    day = now.astimezone(ZONE).date()
    day += timedelta(days=(plan.weekday - day.weekday()) % 7)
    if slot(day, plan.at, ZONE) <= now:
        day += timedelta(days=7)
    return {
        city: CityTime(
            weekday=(plan.weekday + index) % 7 if plan.unit == "weeks" else None,
            first=slot(day + timedelta(days=index), plan.at, ZONE),
        )
        for index, city in enumerate(in_order(plan.cities))
    }


def clock_words(at: time) -> str:
    return at.strftime("%I:%M %p").lstrip("0").replace("AM", "am").replace("PM", "pm")


def when_words(plan: Plan) -> str:
    """ "Every 2 weeks from Monday at 7:00 am"."""
    base = describe(
        Cadence(
            every=plan.every,
            unit=plan.unit,
            at=plan.at,
            weekday=plan.weekday if plan.unit == "weeks" else None,
        )
    )
    first = WEEKDAYS[plan.weekday]
    if plan.unit == "weeks":
        return base.replace(f" on {first} ", f" from {first} ")
    return base.replace(" at ", f" from {first} at ", 1)


def summary_words(plan: Plan, starts: dict[str, datetime], budget_usd: Decimal) -> str:
    """ "Next round: Mon 16 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to
    US$150." `starts` are the cities' next times in this plan."""
    order = [city for city in in_order(plan.cities) if city in starts]
    if not order:
        return "No city is picked."
    first = starts[order[0]].astimezone(ZONE)
    label = "Next round" if plan.enabled else "When it is on, the next round would be"
    days = ", ".join(f"{city} {starts[city].astimezone(ZONE).strftime('%a')}" for city in order)
    return (
        f"{label}: {first.strftime('%a')} {first.day} {first.strftime('%b')}, "
        f"{clock_words(first.time())}. {days}. Up to {usd_words(budget_usd)}."
    )


def check_plan(body: RoundIn) -> None:
    """The rules a plan must keep beyond each field's own. Raises a 422 that names the field."""
    if body.every > EVERY_MAX[body.unit]:
        raise not_valid("body.every", f"Use {EVERY_MAX[body.unit]} {body.unit} or fewer.")
    step = body.every * 7 if body.unit == "weeks" else body.every
    count = len(body.cities)
    if step < count:
        raise not_valid(
            "body.every",
            f"{count} cities run on {count} days in a row, so a round can repeat every "
            f"{count} days at most often.",
        )


def not_valid(field: str, message: str) -> Problem:
    return Problem(
        422, "The change isn't valid", message, errors=[{"field": field, "message": message}]
    )


# --- Reading -------------------------------------------------------------------------------------


async def saved_record(session: AsyncSession) -> dict[str, Any]:
    value = await session.scalar(select(Setting.value).where(Setting.key == PLAN_KEY))
    return value if isinstance(value, dict) else {}


def plan_of(rows: dict[str, Schedule], record: dict[str, Any]) -> Plan:
    """The plan the four schedules hold. While any city is on, the schedules are the truth. While
    all are off, the record says which cities and which first day."""
    on = [city for city in CITIES if (row := rows.get(job_key(city))) is not None and row.enabled]
    picked = in_order(on) or in_order([c for c in record.get("cities", []) if c in CITIES])
    picked = picked or CITIES
    sample = rows.get(job_key(picked[0])) or next(iter(rows.values()), None)
    every: int = 2
    unit: Unit = "weeks"
    at = time(7, 0)
    weekday = DEFAULT_WEEKDAY
    if sample is not None:
        every, unit, at = (
            sample.every,
            cast(Unit, sample.unit),
            sample.at_time,
        )  # checked: days or weeks
        if sample.unit == "weeks" and sample.weekday is not None:
            weekday = sample.weekday  # the first picked city's day is the round's first day
    if not on or unit == "days":
        weekday = int(record.get("weekday", weekday))
    return Plan(bool(on), picked, every, unit, weekday, at)


async def newest_runs(session: AsyncSession, schedule_ids: list[uuid.UUID]) -> dict[Any, Run]:
    """Each schedule's newest run."""
    if not schedule_ids:
        return {}
    newest = (
        select(Run.schedule_id, func.max(Run.created_at).label("at"))
        .where(Run.schedule_id.in_(schedule_ids))
        .group_by(Run.schedule_id)
        .subquery()
    )
    rows = await session.scalars(
        select(Run).join(
            newest, (Run.schedule_id == newest.c.schedule_id) & (Run.created_at == newest.c.at)
        )
    )
    return {row.schedule_id: row for row in rows}


def _city_out(city: str, row: Schedule | None, picked: bool, run: Run | None) -> RoundCityOut:
    day = None
    if row is not None and row.unit == "weeks" and row.weekday is not None:
        day = WEEKDAYS[row.weekday]
    return RoundCityOut.model_validate(
        {
            "city": city,
            "picked": picked,
            "schedule_id": row.id if row is not None else None,
            "enabled": bool(row is not None and row.enabled),
            "day": day,
            "next_run_at": row.next_run_at if row is not None else None,
            "last_run_at": row.last_run_at if row is not None else None,
            "last_status": row.last_status if row is not None else None,
            "last_error": row.last_error if row is not None else None,
            "last_run": None
            if run is None
            else {
                "id": run.id,
                "created_at": run.created_at,
                "status": run.status,
                "good_leads": good_of(run.counts),
                "cost_usd": run.cost_usd,
            },
        }
    )


async def read_round(session: AsyncSession, settings: Settings, now: datetime) -> RoundOut:
    """The control as the page shows it. `settings` are the effective ones."""
    rows = {row.job: row for row in await city_schedules(session)}
    record = await saved_record(session)
    plan = plan_of(rows, record)
    state: Round = await round_so_far(session, settings.lead_finder_goal_good_leads, now)
    ids = [row.id for row in rows.values()]
    runs = await newest_runs(session, ids)
    budget = settings.lead_finder_round_cap_usd
    if plan.enabled:
        starts = {
            city: row.next_run_at
            for city in plan.cities
            if (row := rows.get(job_key(city))) is not None and row.next_run_at is not None
        }
    else:
        starts = {city: item.first for city, item in round_times(plan, now).items()}
    left = budget_left(budget, state.spent_usd)
    note = spent_reason(budget, state.next_round_at, ZONE) if plan.enabled and left <= 0 else None
    return RoundOut(
        enabled=plan.enabled,
        cities=cast(list[City], list(plan.cities)),
        every=plan.every,
        unit=plan.unit,
        weekday=plan.weekday,
        at=plan.at.strftime("%H:%M"),
        timezone=DEFAULT_ZONE,
        when=when_words(plan),
        summary=summary_words(plan, _next_round(plan, starts), budget),
        budget_usd=budget,
        budget_max_usd=settings.hard_scheduled_run_cap_usd,
        run_cap_usd=settings.scheduled_run_cap_usd,
        note=note,
        round=RoundSoFarOut(
            started_at=state.started_at if plan.enabled else None,
            next_round_at=state.next_round_at,
            runs=state.runs,
            good_leads=state.found,
            goal=state.goal,
            spent_usd=state.spent_usd,
            left_usd=left,
        ),
        city_plan=[
            _city_out(
                city,
                rows.get(job_key(city)),
                city in plan.cities,
                runs.get(row.id) if (row := rows.get(job_key(city))) is not None else None,
            )
            for city in CITIES
        ],
    )


def _next_round(plan: Plan, starts: dict[str, datetime]) -> dict[str, datetime]:
    """The next whole round's times. Mid-round, a city that already ran has its time in the next
    round and one still to run has its time in this one: the next round is the one the first city
    is in, so a city before it in this round is moved on one period."""
    order = [city for city in in_order(plan.cities) if city in starts]
    if not order:
        return {}
    first = starts[order[0]]
    step = timedelta(days=plan.step)
    moved: dict[str, datetime] = {}
    for city in order:
        moment = starts[city]
        while moment < first:
            moment = slot(moment.astimezone(ZONE).date() + step, plan.at, ZONE)
        moved[city] = moment
    return moved


# --- Writing -------------------------------------------------------------------------------------


async def _locked_rows(session: AsyncSession, now: datetime) -> dict[str, Schedule]:
    """The four city schedules, locked until the commit, so the scheduler can't claim one half
    changed. Any that the scheduler hasn't made yet is made first, off."""
    keys = [job_key(city) for city in CITIES]
    have = set(await session.scalars(select(Schedule.job).where(Schedule.job.in_(keys))))
    if len(have) < len(keys):
        await service.ensure_defaults(session, [job for job in JOBS if job.key in keys], now)
    rows = await session.scalars(select(Schedule).where(Schedule.job.in_(keys)).with_for_update())
    return {row.job: row for row in rows}


async def _save_record(session: AsyncSession, plan: Plan) -> None:
    value = {"cities": list(plan.cities), "weekday": plan.weekday}
    statement = insert(Setting).values(key=PLAN_KEY, value=value)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[Setting.key],
            set_={"value": statement.excluded.value, "updated_at": func.now()},
        )
    )


def apply_plan(rows: dict[str, Schedule], old: Plan, new: Plan, now: datetime) -> None:
    """Puts the plan on the four schedules (the caller commits). Pure apart from the rows."""
    replan = new.enabled and not (old.enabled and old.same_times(new))
    times = round_times(new, now)
    since = look_back(new.step)
    for index, city in enumerate(CITIES):
        row = rows[job_key(city)]
        picked = city in new.cities
        row.every, row.unit, row.at_time = new.every, new.unit, new.at
        if new.unit == "weeks":
            item = times.get(city)
            row.weekday = item.weekday if item is not None else (new.weekday + index) % 7
        else:
            row.weekday = None
        row.settings = {**row.settings, "since_days": since}
        if new.enabled and picked:
            if replan or not row.enabled or row.next_run_at is None:
                row.next_run_at = times[city].first
            row.enabled = True
        else:
            row.enabled, row.next_run_at = False, None


async def save_round(session: AsyncSession, body: RoundIn, now: datetime) -> None:
    """Saves the plan to the four schedules and the budget to Settings, in one transaction.
    Raises Problem 422 for a plan that can't be kept or a budget out of bounds."""
    from core.prefs.service import patch_settings

    check_plan(body)
    hour, minute = body.at.split(":")
    new = Plan(
        enabled=body.enabled,
        cities=in_order(body.cities),
        every=body.every,
        unit=body.unit,
        weekday=body.weekday,
        at=time(int(hour), int(minute)),
    )
    rows = await _locked_rows(session, now)
    old = plan_of(rows, await saved_record(session))
    apply_plan(rows, old, new, now)
    await _save_record(session, new)
    try:  # checks the budget's bounds and ceiling, and commits everything above with it
        await patch_settings(session, {"lead_finder_round_cap_usd": f"{body.budget_usd:.2f}"})
    except Problem as problem:
        await session.rollback()
        errors = problem.extra.get("errors") or [{}]
        message = errors[0].get("message") or problem.detail or problem.title
        raise not_valid("body.budget_usd", str(message)) from None
