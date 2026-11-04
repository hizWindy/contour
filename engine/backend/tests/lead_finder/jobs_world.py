"""What the tests of the Lead Finder's scheduled run share (PLAN-V6 D2, D3): a stand-in for a run's
work that waits at a gate, past prices and spending in the search log, and the job's schedule row.

See `test_jobs_runs.py` for why past prices matter: a new database has none, so the estimate uses
its placeholders (US$1.00 a company, US$0.40 a slice).
"""

import asyncio
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.jobs import APP, DISCOVERY, JOBS, MODE
from apps.lead_finder.params import DiscoveryParams
from apps.lead_finder.runs import RUN_KINDS
from core.runs.models import Run
from core.runs.types import KindKey, RunContext, RunKind, RunOutcome
from core.schedules import service
from core.schedules.models import Schedule
from core.searches.models import SearchLog

D = Decimal
Factory = async_sessionmaker[AsyncSession]
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)  # Wednesday 4 Nov, 8:00 pm in Melbourne
FIRST_MONDAY = datetime(2026, 11, 8, 20, 0, tzinfo=UTC)  # Monday 9 Nov, 7:00 am in Melbourne
SMALL = {
    "cities": ["Perth"],
    "triggers": ["fast_growth"],
    "since_days": 14,
    "caps": {"max_companies": 3},
}
# At the placeholder prices: 1 slice (US$0.40) and 3 companies (US$3.00) are US$3.40 a typical run.


@dataclass
class Gate:
    """The stand-in for a run's work: it waits here until the test lets it go."""

    entered: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)


def waiting_kinds(gate: Gate) -> dict[KindKey, RunKind[Any]]:
    async def wait_here(ctx: RunContext[DiscoveryParams]) -> RunOutcome:
        gate.entered.set()
        await gate.release.wait()
        return RunOutcome()

    discovery = next(kind for kind in RUN_KINDS if kind.mode == MODE)
    return {(APP, MODE): replace(discovery, handler=wait_here)}


def log_row(step: str, cost: str, *, job: bool = True, when: datetime | None = None) -> SearchLog:
    return SearchLog(
        app=APP,
        job_id=uuid.uuid4() if job else None,
        step=step,
        model="claude-test",
        cost_usd=D(cost),
        answer_ok=True,
        **({"created_at": when} if when else {}),
    )


async def add_past_prices(factory: Factory) -> None:
    """6 finished companies at US$0.30 and 6 slices at US$0.15, 3 days ago (so none of it counts
    toward today's limit)."""
    then = datetime.now(UTC) - timedelta(days=3)
    async with factory() as db:
        for _ in range(6):
            db.add(log_row("extract", "0.30", when=then))
            db.add(log_row("discover", "0.15", when=then))
        await db.commit()


async def spend_today(factory: Factory, dollars: str) -> None:
    async with factory() as db:
        db.add(log_row("search:property", dollars, job=False))
        await db.commit()


async def the_schedule(factory: Factory, choices: dict[str, Any] | None = None) -> Schedule:
    """The job's default schedule, made the way the first start makes it. `choices` replaces the
    saved choices."""
    async with factory() as db:
        await service.ensure_defaults(db, JOBS, NOW)
        row = await db.scalar(select(Schedule).where(Schedule.job == DISCOVERY))
        assert row is not None
        if choices is not None:
            row.settings = choices
            await db.commit()
    return row


async def get_schedule(factory: Factory, schedule_id: uuid.UUID) -> Schedule:
    async with factory() as db:
        row = await db.get(Schedule, schedule_id, populate_existing=True)
        assert row is not None
        return row


async def switch_on(factory: Factory, schedule: Schedule, first: datetime = FIRST_MONDAY) -> None:
    async with factory() as db:
        await db.execute(
            update(Schedule)
            .where(Schedule.id == schedule.id)
            .values(enabled=True, next_run_at=first)
        )
        await db.commit()


async def all_runs(factory: Factory) -> list[Run]:
    async with factory() as db:
        return list(await db.scalars(select(Run).order_by(Run.created_at)))
