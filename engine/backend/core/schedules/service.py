"""The schedules table: reads and writes. PLAN-V6 D1.

These add to the caller's transaction, except `claim_due` and `record`, which commit: a claim must
be saved before the job starts, and the result after it.

**Claimed before it starts.** `claim_due` moves a due schedule's next time forward (to the first
time still to come: a missed time is never run twice) and marks it `starting`, in one transaction,
before anything starts. The rows are locked while that happens (`SKIP LOCKED`), so even two loops
could not both take one. If the backend stops after the claim and before the result, the schedule
is left `starting`, and the next start marks it failed (`recover_unfinished`): it is not started
again for the same time.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.schedules import calc
from core.schedules.calc import Cadence, Unit
from core.schedules.jobs import JobSpec
from core.schedules.models import Schedule

NOT_FINISHED = "The backend stopped while it was starting this. It was not started again."


@dataclass(frozen=True)
class Claimed:
    """A schedule that was due and is now being started."""

    id: uuid.UUID
    job: str
    settings: dict[str, object]
    scheduled_for: datetime  # the time it was meant to run (it may be earlier than now)


def cadence_of(row: Schedule) -> Cadence:
    return Cadence(
        every=row.every,
        unit=cast(Unit, row.unit),  # the table's check keeps it days or weeks
        at=row.at_time,
        weekday=row.weekday,
        zone=row.timezone,
    )


async def all_schedules(db: AsyncSession) -> list[Schedule]:
    return list(await db.scalars(select(Schedule).order_by(Schedule.project, Schedule.name)))


async def ensure_defaults(db: AsyncSession, specs: Iterable[JobSpec], now: datetime) -> list[str]:
    """Makes the default schedule of each job that has one and has no schedule yet. Returns the
    keys it made. A schedule that exists is never touched, whatever it says now."""
    have = set(await db.scalars(select(Schedule.job)))
    made: list[str] = []
    for spec in specs:
        if spec.default is None or spec.key in have:
            continue
        cadence = spec.default.cadence
        db.add(
            Schedule(
                project=spec.project,
                job=spec.key,
                name=spec.title,
                settings=dict(spec.default.settings),
                every=cadence.every,
                unit=cadence.unit,
                weekday=cadence.weekday,
                at_time=cadence.at,
                timezone=cadence.zone,
                enabled=spec.default.enabled,
                next_run_at=calc.first_run(cadence, now) if spec.default.enabled else None,
            )
        )
        made.append(spec.key)
    await db.commit()
    return made


async def recover_unfinished(db: AsyncSession, now: datetime) -> int:
    """At start-up: a schedule left `starting` by a backend that stopped is marked failed."""
    result = await db.execute(
        update(Schedule)
        .where(Schedule.last_status == "starting")
        .values(last_status="failed", last_error=NOT_FINISHED)
    )
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


async def claim_due(db: AsyncSession, now: datetime) -> list[Claimed]:
    """Takes every schedule that is on and due: moves its next time on, marks it `starting` and
    commits. The jobs start after, from what this returns."""
    rows = await db.scalars(
        select(Schedule)
        .where(Schedule.enabled, Schedule.next_run_at <= now)
        .order_by(Schedule.next_run_at)
        .with_for_update(skip_locked=True)
    )
    claimed: list[Claimed] = []
    for row in rows:
        scheduled = row.next_run_at
        assert scheduled is not None  # the table's check: on means it has a next time
        row.next_run_at = calc.next_after(cadence_of(row), scheduled, now)
        row.last_run_at = now
        row.last_status, row.last_ref, row.last_error = "starting", None, None
        claimed.append(Claimed(row.id, row.job, dict(row.settings), scheduled))
    await db.commit()
    return claimed


async def record(
    db: AsyncSession,
    schedule_id: uuid.UUID,
    status: str,
    *,
    ref: str | None = None,
    error: str | None = None,
) -> None:
    """How a start went: `started` (with the run or sync id), `skipped` or `failed` (with why)."""
    await db.execute(
        update(Schedule)
        .where(Schedule.id == schedule_id)
        .values(last_status=status, last_ref=ref, last_error=error)
    )
    await db.commit()
