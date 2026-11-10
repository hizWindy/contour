"""The goal and the budget of the automatic runs (9 Nov, Al-khair; Levi 5 Nov: about 100 good leads
every 2 weeks; the budget is PLAN-V13 T1-3).

The city schedules run one after another, one day apart: by default every 2 weeks, Melbourne on
Monday, Adelaide on Tuesday, Perth on Wednesday and Sydney on Thursday (`round.py` sets them as one
control). One such set of runs is a **round**.

**The goal.** The round aims for `lead_finder_goal_good_leads` (100) good leads: a Pass or a
Director review. Each automatic run aims for its share of what is still needed, split over the city
runs still to come in the round, itself included. So a city that falls short leaves more for the
cities after it. Example: the goal is 100 and 4 cities are on. Melbourne aims for 25 and finds 18;
Adelaide then aims for 82 / 3 = 28 (rounded up). When the goal is already met, a city still aims
for its plain share (100 / 4 = 25): more good leads are welcome, it just has nothing to make up.

**The budget.** All of a round's automatic runs together may spend `lead_finder_round_cap_usd`
(US$150, TBC). Before a run starts, its money limit becomes the smaller of `scheduled_run_cap_usd`
and what is left of the budget (`run_cap_in_round`). Example: Melbourne spent US$40 of US$150, so
Adelaide may spend US$110. When nothing is left, the run doesn't start, and its schedule says why:
"This round's budget (US$150) is spent. Next round: 30 Nov." It can only lower a run's limit, never
raise it, and the daily limit still applies.

**What counts as this round** (`round_window`): the runs a city schedule started since the round
began. The round begins at the first picked city's time (the first city in the order Melbourne,
Adelaide, Perth, Sydney that is switched on): the latest of its times that has come. So Adelaide on
Tuesday counts Melbourne's run of Monday, and Melbourne's next run starts a new round. This works
for any "every N days or weeks", even every week, where a fixed number of days would mix two rounds.
When no city schedule is on, the round is the last `ROUND_DAYS` (7) days, as before.

Manual runs (started by a person) don't count, and have no goal: they keep their own limits. A
"Run now" on a city schedule is an automatic run: it counts, and the budget applies to it.
"""

import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.jobs import DISCOVERY_KEYS
from core.runs.models import Run
from core.schedules.calc import slot
from core.schedules.models import Schedule
from core.schedules.service import cadence_of

APP = "lead_finder"
DISCOVERY_JOB = "lead_finder.discovery"  # every city's job starts with this
ROUND_DAYS = 7
GOOD_RESULTS = ("pass", "director_review")
# A run made a moment before its time (the database's clock and ours can differ a little) still
# belongs to the round that starts then.
CLOCK_SLACK = timedelta(minutes=1)
CENT = Decimal("0.01")


def good_of(counts: dict[str, Any] | None) -> int:
    """Good leads in a run's counts: Pass and Director review."""
    by_result = (counts or {}).get("by_result") or {}
    return sum(int(by_result.get(result, 0) or 0) for result in GOOD_RESULTS)


def run_goal(goal: int, found: int, runs_left: int, schedules_on: int) -> int:
    """This run's share of the round's goal. Pure.

    - `found`: good leads the round's earlier automatic runs found.
    - `runs_left`: the city runs still to come in the round, this one included (at least 1).
    - `schedules_on`: the city schedules that are switched on (at least 1).
    """
    share = math.ceil(goal / max(schedules_on, 1))
    still = goal - found
    if still <= 0:
        return share
    return max(1, math.ceil(still / max(runs_left, 1)))


# --- The round's window -------------------------------------------------------------------------


@dataclass(frozen=True)
class Window:
    """When this round began, and when the next one begins (None when no city schedule is on)."""

    start: datetime
    next_start: datetime | None


def leader_of(rows: Sequence[Schedule]) -> Schedule | None:
    """The first city schedule that is on, in the fixed order (Melbourne, Adelaide, Perth,
    Sydney): its time starts each round."""
    by_job = {row.job: row for row in rows}
    for key in DISCOVERY_KEYS:
        row = by_job.get(key)
        if row is not None and row.enabled and row.next_run_at is not None:
            return row
    return None


def round_window(rows: Sequence[Schedule], now: datetime) -> Window:
    """The round `now` is in. Pure: `rows` are the city schedules.

    The leader's next time, one period back, is when its last time was (or would have been). If
    that hasn't come yet (the round was just planned), it goes back one more period. The times are
    worked out on the wall clock in the zone, so a change of daylight saving moves nothing.
    """
    leader = leader_of(rows)
    if leader is None or leader.next_run_at is None:
        return Window(now - timedelta(days=ROUND_DAYS), None)
    cadence = cadence_of(leader)
    step = timedelta(days=cadence.step)
    day = leader.next_run_at.astimezone(cadence.tz).date() - step
    while slot(day, cadence.at, cadence.tz) > now:
        day -= step
    return Window(slot(day, cadence.at, cadence.tz), slot(day + step, cadence.at, cadence.tz))


async def city_schedules(session: AsyncSession) -> list[Schedule]:
    return list(
        await session.scalars(select(Schedule).where(Schedule.job.startswith(DISCOVERY_JOB)))
    )


# --- The round so far ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Round:
    """Where the round stands, for the run email, the goal and the budget of a new run."""

    goal: int  # the round's goal (lead_finder_goal_good_leads)
    found: int  # good leads the round's automatic runs found
    spent_usd: Decimal  # what those runs cost
    runs: int  # how many automatic runs the round has had
    schedules_on: int  # city schedules switched on
    runs_left: int  # city runs still to come in the round, the asking run's own included
    started_at: datetime | None = None  # when the round began
    next_round_at: datetime | None = None  # when the next one begins (None: no city is on)


async def round_so_far(
    session: AsyncSession,
    goal: int,
    now: datetime,
    *,
    exclude_run: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> Round:
    """The round so far: the automatic runs since the round began (`round_window`).

    `exclude_run` leaves one run out (the run that asks, when it starts). `schedule_id` is the
    asking run's schedule: it counts as still to come.
    """
    schedules = await city_schedules(session)
    window = round_window(schedules, now)
    rows = (
        await session.execute(
            select(Run.id, Run.schedule_id, Run.counts, Run.cost_usd).where(
                Run.app == APP,
                Run.schedule_id.is_not(None),
                Run.created_at >= window.start - CLOCK_SLACK,
            )
        )
    ).all()
    runs = [row for row in rows if row.id != exclude_run]
    on = {row.id for row in schedules if row.enabled}
    if schedule_id is not None:
        on.add(schedule_id)  # "Run now" on a schedule that is off still counts as one city
    ran = {row.schedule_id for row in runs}
    left = {sid for sid in on if sid not in ran}
    if schedule_id is not None:
        left.add(schedule_id)
    return Round(
        goal=goal,
        found=sum(good_of(row.counts) for row in runs),
        spent_usd=sum((row.cost_usd for row in runs), Decimal(0)),
        runs=len(runs),
        schedules_on=max(len(on), 1),
        runs_left=max(len(left), 1),
        started_at=window.start,
        next_round_at=window.next_start,
    )


async def goal_for_run(
    session: AsyncSession, goal: int, now: datetime, run_id: uuid.UUID, schedule_id: uuid.UUID
) -> int:
    """The good leads an automatic run aims for (see the module text)."""
    state = await round_so_far(session, goal, now, exclude_run=run_id, schedule_id=schedule_id)
    return run_goal(goal, state.found, state.runs_left, state.schedules_on)


# --- The round's budget -------------------------------------------------------------------------


def usd_words(amount: Decimal) -> str:
    """US$150, or US$37.50: whole dollars without cents."""
    cents = amount.quantize(CENT, ROUND_DOWN)
    return f"US${cents:,.0f}" if cents == cents.to_integral_value() else f"US${cents:,.2f}"


def day_words(moment: datetime, zone: Any) -> str:
    """ "30 Nov", in the zone."""
    local = moment.astimezone(zone)
    return f"{local.day} {local.strftime('%b')}"


def budget_left(budget_usd: Decimal, spent_usd: Decimal) -> Decimal:
    """What is left of the round's budget, in whole cents rounded down. Never below 0."""
    return max(Decimal(0), (budget_usd - spent_usd).quantize(CENT, ROUND_DOWN))


def run_cap_in_round(run_cap_usd: Decimal, budget_usd: Decimal, spent_usd: Decimal) -> Decimal:
    """An automatic run's money limit: the smaller of its own cap and what is left of the round's
    budget. Pure. 0 means nothing is left."""
    return min(run_cap_usd, budget_left(budget_usd, spent_usd))


def spent_reason(budget_usd: Decimal, next_round_at: datetime | None, zone: Any) -> str:
    """Why a city didn't start, on its schedule."""
    nxt = f" Next round: {day_words(next_round_at, zone)}." if next_round_at is not None else ""
    return f"This round's budget ({usd_words(budget_usd)}) is spent.{nxt}"


def too_little_reason(
    left_usd: Decimal, budget_usd: Decimal, next_round_at: datetime | None, zone: Any
) -> str:
    """Why a city didn't start when a little is left, but not enough for one run's searches."""
    nxt = f" Next round: {day_words(next_round_at, zone)}." if next_round_at is not None else ""
    return (
        f"Only {usd_words(left_usd)} is left of this round's budget ({usd_words(budget_usd)}), "
        f"too little for a run.{nxt}"
    )
