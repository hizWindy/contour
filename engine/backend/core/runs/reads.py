"""Reading runs: one run, a page of runs, a run's saved events, and the cost by day.

This is the read side of the run engine. It lives in its own file, apart from `manager.py`
(which starts, stops and watches runs), so the package that builds the reads and the package
that builds the manager never edit the same file. `RunManager.get_run`, `list_runs`, `event_log`
and `summary` only call the functions here. The routes in `core/api/runs_read.py` call the
manager.

These are stubs. Package B1b writes the bodies. Each takes the session factory and opens its own
short session, and each raises Problem 404 for an unknown run.

Two things named `RunEvent` exist: the table row in `core.runs.models` and the typed event in
`core.runs.schemas`. Import one of them under another name (for example
`from core.runs.models import RunEvent as RunEventRow`) so they can't be mixed up.
"""

from collections.abc import Sequence
from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.runs.schemas import EventLog, RunOut, RunPage, RunStatus, RunSummary


async def get_run(session_factory: async_sessionmaker[AsyncSession], run_id: UUID) -> RunOut:
    """One run. Raises Problem 404 for an unknown id."""
    raise NotImplementedError


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
    """Runs, newest first. `since` and `until` are Australia/Melbourne dates (the same kind of
    date as `summary`'s): a run counts when the Melbourne day of its `created_at` is on or after
    `since` and on or before `until`. Compare in SQL (`cast(func.timezone(tz, created_at), Date)`)
    rather than turning a date into a moment, so an extreme date can't overflow."""
    raise NotImplementedError


async def event_log(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: UUID,
    after: int = 0,
    limit: int = 200,
) -> EventLog:
    """The saved events after seq `after`, oldest first. Raises Problem 404 if unknown.

    Build each item with `core.runs.schemas.build_event`, so it is the same JSON the live
    stream sends.
    """
    raise NotImplementedError


async def summary(
    session_factory: async_sessionmaker[AsyncSession], since: date | None = None
) -> RunSummary:
    """Cost and run counts by day, from `since` (default: 30 days ago). A day is the
    Australia/Melbourne date of the run's `created_at`."""
    raise NotImplementedError
