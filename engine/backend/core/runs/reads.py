"""Reading runs: one run, a page of runs, a run's saved events, and the cost by day.

This is the read side of the run engine. It lives in its own file, apart from `manager.py`
(which starts, stops and watches runs), so the package that builds the reads and the package
that builds the manager never edit the same file. `RunManager.get_run`, `list_runs`, `event_log`
and `summary` only call the functions here. The routes in `core/api/runs_read.py` call the
manager.

Each function takes the session factory and opens its own short session, so a read never holds a
connection while the caller waits, and never shares a session with a running task. Each raises
Problem 404 for an unknown run.

Days are Australia/Melbourne dates. They are worked out in SQL, with `melbourne_date`, which is
`cast(timezone('Australia/Melbourne', <timestamptz column>), Date)`. A date is never turned into a
moment, so an extreme date (year 1 or year 9999) can't overflow, and the two days a year when the
clocks change (a 25-hour and a 23-hour day) come out right.

Two things named `RunEvent` exist: the table row in `core.runs.models` and the typed event in
`core.runs.schemas`. This file imports the row as `RunEventRow` so they can't be mixed up.
"""

from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnClause, ColumnElement, Date, cast, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import QueryableAttribute

from core.api.errors import Problem
from core.api.models import INT32_MAX, OFFSET_MAX
from core.runs.models import Run
from core.runs.models import RunEvent as RunEventRow
from core.runs.schemas import (
    EventLog,
    RunOut,
    RunPage,
    RunStatus,
    RunSummary,
    RunSummaryDay,
    build_event,
)

TIMEZONE = "Australia/Melbourne"
SUMMARY_DEFAULT_DAYS = 30
MAX_PAGE = 200  # the most rows one page returns, as the routes' `limit` allows
# A constant in the SQL text, not a bound value: the same expression then appears in SELECT and
# in GROUP BY, which PostgreSQL needs to treat them as one.
_TIMEZONE_SQL: ColumnClause[Any] = literal_column(f"'{TIMEZONE}'")


def melbourne_date(column: QueryableAttribute[Any] | ColumnElement[Any]) -> ColumnElement[date]:
    """The Australia/Melbourne calendar date of a timestamptz column, worked out in SQL."""
    return cast(func.timezone(_TIMEZONE_SQL, column), Date)


def run_not_found() -> Problem:
    return Problem(404, "Run not found", "There is no run with this id.")


async def get_run(session_factory: async_sessionmaker[AsyncSession], run_id: UUID) -> RunOut:
    """One run. Raises Problem 404 for an unknown id."""
    async with session_factory() as session:
        row = await session.get(Run, run_id)
        if row is None:
            raise run_not_found()
        return RunOut.model_validate(row)


async def list_runs(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    app: str | None = None,
    mode: str | None = None,
    status: Sequence[RunStatus] | None = None,
    since: date | None = None,
    until: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> RunPage:
    """Runs, newest first (ties by id, so a page is stable). `since` and `until` are
    Australia/Melbourne dates (the same kind of date as `summary`'s): a run counts when the
    Melbourne day of its `created_at` is on or after `since` and on or before `until`. The
    compare is in SQL (`melbourne_date`) rather than turning a date into a moment, so an
    extreme date can't overflow."""
    filters: list[ColumnElement[bool]] = []
    if app is not None:
        filters.append(Run.app == app)
    if mode is not None:
        filters.append(Run.mode == mode)
    if status:
        filters.append(Run.status.in_(list(status)))
    if since is not None:
        filters.append(melbourne_date(Run.created_at) >= since)
    if until is not None:
        filters.append(melbourne_date(Run.created_at) <= until)
    limit = min(max(limit, 1), MAX_PAGE)
    offset = min(max(offset, 0), OFFSET_MAX)

    async with session_factory() as session:
        total = await session.scalar(select(func.count()).select_from(Run).where(*filters))
        page = (
            select(Run)
            .where(*filters)
            .order_by(Run.created_at.desc(), Run.id)
            .limit(limit)
            .offset(offset)
        )
        rows = (await session.scalars(page)).all()
        return RunPage(total=total or 0, items=[RunOut.model_validate(row) for row in rows])


async def event_log(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: UUID,
    after: int = 0,
    limit: int = 200,
) -> EventLog:
    """The saved events after seq `after`, oldest first, at most `limit` of them. Raises
    Problem 404 if the run is unknown.

    Each item is built with `core.runs.schemas.build_event`, so it is the same JSON the live
    stream sends. `last_seq` is the highest seq the run has (0 if none). It is read after the
    page, so it is never lower than the last item.
    """
    after = min(max(after, 0), INT32_MAX)
    limit = min(max(limit, 1), MAX_PAGE)
    async with session_factory() as session:
        if await session.scalar(select(Run.id).where(Run.id == run_id)) is None:
            raise run_not_found()
        page = (
            select(RunEventRow)
            .where(RunEventRow.run_id == run_id, RunEventRow.seq > after)
            .order_by(RunEventRow.seq)
            .limit(limit)
        )
        rows = (await session.scalars(page)).all()
        last_seq = await session.scalar(
            select(func.max(RunEventRow.seq)).where(RunEventRow.run_id == run_id)
        )
        return EventLog(
            items=[build_event(row.seq, row.type, row.data, row.created_at) for row in rows],
            last_seq=last_seq or 0,
        )


async def summary(
    session_factory: async_sessionmaker[AsyncSession], since: date | None = None
) -> RunSummary:
    """Cost and run counts by day, oldest first, from `since` (default: 30 days ago). A day is
    the Australia/Melbourne date of the run's `created_at`. Days without a run are left out.
    Every run counts, whatever its status."""
    day = melbourne_date(Run.created_at)
    async with session_factory() as session:
        if since is None:
            today = await session.scalar(select(melbourne_date(func.now())))
            if today is None:  # a SELECT of one value always has a row
                raise RuntimeError("The database gave no date")
            since = today - timedelta(days=SUMMARY_DEFAULT_DAYS)
        found = await session.execute(
            select(day.label("day"), func.sum(Run.cost_usd), func.count())
            .where(day >= since)
            .group_by(day)
            .order_by(day)
        )
        days = [
            RunSummaryDay(date=row_day, cost_usd=Decimal(cost or 0), runs=runs)
            for row_day, cost, runs in found.all()
        ]
    return RunSummary(
        since=since,
        days=days,
        total_cost_usd=sum((item.cost_usd for item in days), Decimal(0)),
        total_runs=sum(item.runs for item in days),
    )
