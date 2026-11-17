"""PLAN-V21 T1-5: a run that picked Property Daily reads its new emails first, so its items become
companies before sweep 1 even while the daily email job is switched off.

Integration: runs, events, the copy of Property Daily's records and leads, on the test database,
with a FakeClaude and a fake reader (no browser).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder import run_sources
from apps.lead_finder.tables import Lead
from core.config import Settings
from core.runs.manager import RunManager
from core.sources import store
from core.sources.models import SourceState
from core.sources.property_daily.parse import Parsed
from core.sources.service import FeedDone
from core.sources.types import PropertyRecord
from tests.core.runs_fakes import run_row, stored_json, wait_until_idle
from tests.lead_finder.conftest import APP, MakeLeadFinderManager, lf_settings
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration
MELBOURNE = ZoneInfo("Australia/Melbourne")
READY = {
    "property_daily_enabled": True,
    "property_daily_username": "someone",
    "property_daily_password": "something",
}
BOTH = {
    "cities": ["Melbourne"],
    "triggers": ["lease_ending"],
    "since_days": 30,
    "sources": ["web", "property_daily"],
    "target_companies": 5,
}
COMPANY = "Sample Logistics Pty Ltd"


def a_lease(today: date) -> Parsed:
    """One daily email item: a Melbourne lease that ends in two years (the lease_ending sign)."""
    record = PropertyRecord(
        source="property_daily",
        kind="lease",
        company=COMPANY,
        city="Melbourne",
        address="120 Collins Street, Melbourne VIC 3000",
        lease_end=today + timedelta(days=730),
        published_on=today,
        summary=f"{COMPANY}'s lease at 120 Collins Street ends in two years.",
        url="https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=101",
        read_at=datetime.now(UTC),
    )
    return Parsed(record, "report:101", uuid.uuid4().hex)


@dataclass
class EmailReader:
    """Reads today's email into our copy, like `Sources.feed`, with no browser."""

    factory: async_sessionmaker[AsyncSession]
    feeds: list[Settings] = field(default_factory=list)

    async def feed(self, settings: Settings) -> FeedDone:
        self.feeds.append(settings)
        today = datetime.now(MELBOURNE).date()
        async with self.factory.begin() as session:
            new = await store.save_records(session, [a_lease(today)], via="feed")
        return FeedDone(new_records=new, last_day=today)


@pytest.fixture
def reader(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> EmailReader:
    fake = EmailReader(session_factory)
    monkeypatch.setattr(run_sources, "get_sources", lambda: fake)
    return fake


async def run(
    manager: RunManager,
    factory: async_sessionmaker[AsyncSession],
    params: dict[str, Any],
) -> Any:
    run_id = (await manager.start(APP, "discovery", params)).id
    await wait_until_idle(manager, timeout=60)
    return await run_row(factory, run_id)


async def test_the_plan_reads_the_new_email_once_and_its_item_comes_before_sweep_1(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    reader: EmailReader,
) -> None:
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(**READY))
    row = await run(manager, session_factory, BOTH)

    assert row.status == "done"
    assert len(reader.feeds) == 1
    events = await stored_json(session_factory, row.id)
    kinds = [event["type"] for event in events]
    plan = next(event["data"] for event in events if event["type"] == "plan_ready")
    assert plan["companies"] == 1  # the email's item, found before any search
    assert kinds.index("plan_ready") < kinds.index("slice_started")
    async with session_factory() as session:
        leads = (await session.scalars(select(Lead).where(Lead.run_id == row.id))).all()
    assert [lead.company for lead in leads] == [COMPANY]
    assert row.counts["by_source"]["property_daily"] == 1

    # The copy has today's email now, so the next run reads nothing
    again = await run(manager, session_factory, BOTH)
    assert again.status == "done"
    assert len(reader.feeds) == 1


@pytest.mark.parametrize(
    ("settings", "sources"),
    [
        ({}, ["web"]),  # switched off
        (READY, ["web"]),  # ready, but not picked on Start
    ],
    ids=["off", "not-picked"],
)
async def test_no_email_is_read_when_property_daily_is_off_or_not_picked(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    reader: EmailReader,
    settings: dict[str, Any],
    sources: list[str],
) -> None:
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(**settings))
    row = await run(manager, session_factory, {**BOTH, "sources": sources})

    assert row.status == "done"
    assert reader.feeds == []


async def test_no_email_is_read_while_property_daily_is_paused(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    reader: EmailReader,
) -> None:
    async with session_factory.begin() as session:
        session.add(
            SourceState(
                source="property_daily",
                paused_until=datetime.now(UTC) + timedelta(hours=20),
                pause_reason="captcha",
            )
        )
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(**READY))
    row = await run(manager, session_factory, {**BOTH, "sources": ["web"]})
    assert row.status == "done" and reader.feeds == []
    # Picked while paused: the run starts (the copy still works) and reads no page
    paused = await run(manager, session_factory, {**BOTH, "sources": ["property_daily"]})
    assert (paused.status, reader.feeds) == ("done", [])


async def test_a_failed_read_is_one_line_in_the_feed_and_the_run_goes_on(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Blocked:
        async def feed(self, settings: Settings) -> FeedDone:
            raise RuntimeError("the site showed a block")

    monkeypatch.setattr(run_sources, "get_sources", lambda: Blocked())
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(**READY))
    row = await run(manager, session_factory, BOTH)

    assert row.status == "done"
    events = await stored_json(session_factory, row.id)
    problems = [e["data"]["message"] for e in events if e["type"] == "problem"]
    assert run_sources.EMAILS_NOT_READ in problems
