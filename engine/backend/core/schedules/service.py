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
from datetime import datetime, time
from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.schedules import calc
from core.schedules.calc import Cadence, Unit
from core.schedules.jobs import JobSpec
from core.schedules.models import Schedule
from core.schedules.schemas import EVERY_MAX, ScheduleEdit

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


# --- Changes by a person (the Schedules page) -----------------------------------------------------


class BadEdit(ValueError):
    """A change that can't be made. `field` is the part of the body that is wrong."""

    def __init__(self, field: str, message: str) -> None:
        self.field = field
        self.message = message
        super().__init__(message)


async def get_locked(db: AsyncSession, schedule_id: uuid.UUID) -> Schedule | None:
    """One schedule, locked until the caller commits, so the loop can't claim it half edited."""
    return await db.scalar(select(Schedule).where(Schedule.id == schedule_id).with_for_update())


def clock_of(text: str) -> time:
    """ "07:00" as a time. The text was checked by `ScheduleEdit`."""
    hour, minute = text.split(":")
    return time(int(hour), int(minute))


def edited_cadence(row: Schedule, edit: ScheduleEdit) -> Cadence:
    """The cadence the row would have with this change. Raises `BadEdit` with a plain message.

    Switching to days clears the day. Switching to weeks needs a day (the old one is kept if there
    is one). A day sent with days is refused, not ignored.
    """
    unit = edit.unit or cast(Unit, row.unit)
    every = edit.every if edit.every is not None else row.every
    at = clock_of(edit.at) if edit.at is not None else row.at_time
    if unit == "days":
        if edit.weekday is not None:
            raise BadEdit("weekday", "A schedule in days has no day of the week.")
        weekday = None
    else:
        weekday = edit.weekday if edit.weekday is not None else row.weekday
        if weekday is None:
            raise BadEdit("weekday", "A schedule in weeks needs a day of the week.")
    if every > EVERY_MAX[unit]:
        raise BadEdit("every", f"Use {EVERY_MAX[unit]} {unit} or fewer.")
    try:
        return Cadence(every=every, unit=unit, at=at, weekday=weekday, zone=row.timezone)
    except ValueError as error:
        raise BadEdit("every", str(error)) from None


def apply_edit(
    row: Schedule,
    cadence: Cadence,
    *,
    enabled: bool | None,
    settings: dict[str, Any] | None,
    now: datetime,
) -> None:
    """Puts the change on the row (the caller commits).

    Off: no next time. On: a next time, kept as it is unless it was off or the cadence changed, in
    which case it is the first time from now on. The choices are replaced as a whole.
    """
    changed = cadence != cadence_of(row)
    row.every, row.unit, row.weekday, row.at_time = (
        cadence.every,
        cadence.unit,
        cadence.weekday,
        cadence.at,
    )
    if settings is not None:
        row.settings = settings
    on = row.enabled if enabled is None else enabled
    if not on:
        row.enabled, row.next_run_at = False, None
    elif not row.enabled or changed:
        row.enabled, row.next_run_at = True, calc.first_run(cadence, now)


async def begin_now(db: AsyncSession, schedule_id: uuid.UUID, now: datetime) -> Claimed | None:
    """A start by hand: marks the schedule `starting` like a claim does, but leaves its next time
    alone, so "Run now" never moves the cadence. None for an unknown schedule."""
    row = await get_locked(db, schedule_id)
    if row is None:
        return None
    row.last_run_at = now
    row.last_status, row.last_ref, row.last_error = "starting", None, None
    claimed = Claimed(row.id, row.job, dict(row.settings), now)
    await db.commit()
    return claimed
