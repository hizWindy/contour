"""The goal of the automatic runs (9 Nov, Al-khair; Levi 5 Nov: about 100 good leads every 2 weeks).

The city schedules run one after another, every 2 weeks: Melbourne on Monday, Adelaide on Tuesday,
Perth on Wednesday and Sydney on Thursday. One such set of runs is a **round**. The round's goal is
`lead_finder_goal_good_leads` (100) good leads: a Pass or a Director review.

Each automatic run aims for its share of what is still needed, split over the city runs still to
come in the round, itself included. So a city that falls short leaves more for the cities after
it. Example: the goal is 100 and 4 cities are on. Melbourne aims for 25 and finds 18; Adelaide then
aims for 82 / 3 = 28 (rounded up). When the goal is already met, a city still aims for its plain
share (100 / 4 = 25): more good leads are welcome, it just has nothing to make up.

**What counts as this round:** runs that a city schedule started in the last `ROUND_DAYS` (7) days.
The runs of one round sit inside one week (Monday to Thursday), and the next round starts 2 weeks
after the last one, so 7 days never mixes two rounds. If the schedules' days are spread over more
than a week, the carry-over counts less than it should (TBC: only if the days change).

Manual runs (started by a person) don't count, and have no goal: they keep their own limits.
"""

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.runs.models import Run
from core.schedules.models import Schedule

APP = "lead_finder"
DISCOVERY_JOB = "lead_finder.discovery"  # every city's job starts with this
ROUND_DAYS = 7
GOOD_RESULTS = ("pass", "director_review")


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


@dataclass(frozen=True)
class Round:
    """Where the round stands, for the run email and the goal of a new run."""

    goal: int  # the round's goal (lead_finder_goal_good_leads)
    found: int  # good leads the round's automatic runs found
    spent_usd: Decimal  # what those runs cost
    runs: int  # how many automatic runs the round has had
    schedules_on: int  # city schedules switched on
    runs_left: int  # city runs still to come in the round, the asking run's own included


async def round_so_far(
    session: AsyncSession,
    goal: int,
    now: datetime,
    *,
    exclude_run: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> Round:
    """The round so far: the automatic runs of the last `ROUND_DAYS` days.

    `exclude_run` leaves one run out (the run that asks, when it starts). `schedule_id` is the
    asking run's schedule: it counts as still to come.
    """
    since = now - timedelta(days=ROUND_DAYS)
    rows = (
        await session.execute(
            select(Run.id, Run.schedule_id, Run.counts, Run.cost_usd).where(
                Run.app == APP,
                Run.schedule_id.is_not(None),
                Run.created_at >= since,
            )
        )
    ).all()
    runs = [row for row in rows if row.id != exclude_run]
    on = set(
        await session.scalars(
            select(Schedule.id).where(
                Schedule.job.startswith(DISCOVERY_JOB), Schedule.enabled.is_(True)
            )
        )
    )
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
    )


async def goal_for_run(
    session: AsyncSession, goal: int, now: datetime, run_id: uuid.UUID, schedule_id: uuid.UUID
) -> int:
    """The good leads an automatic run aims for (see the module text)."""
    state = await round_so_far(session, goal, now, exclude_run=run_id, schedule_id=schedule_id)
    return run_goal(goal, state.found, state.runs_left, state.schedules_on)
