"""Our copy of the tools, the reader and the jobs (PLAN-V16 T2-7), on the test database.

The live lookup is a fake (no browser): it says what the tool would have answered, or fails the
way a real one can. Every company here is made up.
"""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.browser.reader import PageProblem, Read, RunLimitReached, SourcePaused
from core.config import Settings
from core.schedules.jobs import JobContext, JobSkipped
from core.sources import jobs, reader, service, store
from core.sources.models import PropertyLookup, SourceRead
from core.sources.property_daily.parse import Parsed, parse_daily
from core.sources.property_daily.read import Lookup
from core.sources.types import PropertyRecord
from tests.core.property_daily_pages import DAILY

pytestmark = pytest.mark.integration

NOW = datetime.now(UTC)
ON = Settings(
    _env_file=None,
    property_daily_enabled=True,
    property_daily_username="sample-user",
    property_daily_password="sample-pass",
)


def parsed(company: str = "Sample Logistics Pty Ltd", **values: Any) -> Parsed:
    record = PropertyRecord(
        source="property_daily",
        kind=values.pop("kind", "lease"),
        company=company,
        summary="A lease.",
        url="https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=1",
        read_at=NOW,
        **values,
    )
    return Parsed(record, "report:1", uuid.uuid4().hex)


@dataclass
class FakeSources:
    """Stands in for the live lookup."""

    answer: Lookup | Exception = field(default_factory=Lookup)
    asked: list[tuple[str, str | None, uuid.UUID | None]] = field(default_factory=list)

    async def lookup(
        self, settings: Settings, name: str, city: str | None, *, run_id: uuid.UUID | None = None
    ) -> Lookup:
        self.asked.append((name, city, run_id))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeSources]:
    sources = FakeSources()
    monkeypatch.setattr(reader, "get_sources", lambda: sources)
    yield sources


# --- Records ---------------------------------------------------------------------------------


async def test_a_fact_read_twice_is_saved_once(session: AsyncSession) -> None:
    items = parse_daily(DAILY, url="u", read_at=NOW, published_on=date(2026, 11, 13))
    assert await store.save_records(session, items, via="feed") == len(items)
    assert await store.save_records(session, items, via="feed") == 0
    await session.commit()
    assert await store.count_records(session, "property_daily") == len(items)


async def test_a_companys_records_are_in_its_city_or_have_none_newest_first(
    session: AsyncSession,
) -> None:
    await store.save_records(
        session,
        [
            parsed(city="Perth", lease_end=date(2028, 6, 30), published_on=date(2025, 1, 1)),
            parsed(city=None, kind="requirement", published_on=date(2026, 11, 1)),
            parsed(city="Melbourne", lease_end=date(2027, 1, 1)),
            parsed(company="Another Sample Co", city="Perth"),
        ],
        via="lookup",
    )
    found = await store.records_for(session, "sample logistics", "Perth")
    assert [(record.kind, record.city) for record in found] == [
        ("requirement", None),
        ("lease", "Perth"),
    ]


async def test_recent_items_are_feed_items_with_their_sign(session: AsyncSession) -> None:
    await store.save_records(
        session,
        [parsed(city="Perth", lease_end=NOW.date() + timedelta(days=500))],
        via="lease_endings",
    )
    await store.save_records(
        session, [parsed(company="Lookup Only Co", city="Perth")], via="lookup"
    )
    await session.commit()
    items = await reader.recent_items(session, ["Perth"], NOW - timedelta(days=1))
    assert [(item.company, item.sign_id) for item in items] == [
        ("Sample Logistics Pty Ltd", "lease_ending")
    ]
    assert await reader.recent_items(session, ["Darwin"], NOW - timedelta(days=1)) == []
    assert len(await reader.recent_items(session, ["Australia"], NOW - timedelta(days=1))) == 1
    assert await reader.recent_items(session, None, NOW + timedelta(days=1)) == []


# --- lookup_company --------------------------------------------------------------------------


async def test_off_asks_nothing_live_and_still_gives_our_copy(
    session: AsyncSession, fake: FakeSources
) -> None:
    await store.save_records(session, [parsed(city="Perth")], via="feed")
    await session.commit()
    found = await reader.lookup_company(
        session, "Sample Logistics", "Perth", None, settings=Settings(_env_file=None)
    )
    assert found.checked.model_dump() == {"property_daily": "off", "arealytics": "off"}
    assert len(found.records) == 1 and fake.asked == []


async def test_a_live_lookup_is_saved_and_reused_for_30_days(
    session: AsyncSession, fake: FakeSources
) -> None:
    fake.answer = Lookup(records=[parsed(city="Perth")], website="www.sample.example", pages=3)
    run = uuid.uuid4()
    first = await reader.lookup_company(
        session, "Sample Logistics", "Perth", None, run_id=run, settings=ON
    )
    assert first.checked.property_daily == "found"
    assert len(first.records) == 1 and first.looked_up_at is not None
    assert fake.asked == [("Sample Logistics", "Perth", run)]
    again = await reader.lookup_company(session, "Sample Logistics", "Perth", None, settings=ON)
    assert again.checked.property_daily == "found" and len(fake.asked) == 1  # reused
    stale = datetime.now(UTC) - timedelta(days=31)
    async with session.begin():
        row = await session.get(PropertyLookup, ("property_daily", "sample logistics"))
        assert row is not None
        row.looked_up_at = stale
    await reader.lookup_company(session, "Sample Logistics", "Perth", None, settings=ON)
    assert len(fake.asked) == 2  # older than 30 days: asked again


async def test_nothing_found_is_remembered_too(session: AsyncSession, fake: FakeSources) -> None:
    found = await reader.lookup_company(session, "Nobody Sample", "Perth", None, settings=ON)
    assert found.checked.property_daily == "not_found" and found.records == []
    await reader.lookup_company(session, "Nobody Sample", "Perth", None, settings=ON)
    assert len(fake.asked) == 1


@pytest.mark.parametrize(
    ("problem", "status"),
    [
        (RunLimitReached("60 pages"), "not_checked"),
        (SourcePaused("captcha", NOW + timedelta(hours=24)), "error"),
        (PageProblem("timeout"), "error"),
    ],
)
async def test_a_live_problem_is_a_status_never_an_error_and_is_not_remembered(
    session: AsyncSession, fake: FakeSources, problem: Exception, status: str
) -> None:
    fake.answer = problem
    found = await reader.lookup_company(session, "Sample Logistics", "Perth", None, settings=ON)
    assert found.checked.property_daily == status
    remembered = await session.scalar(select(func.count()).select_from(PropertyLookup))
    assert remembered == 0  # the next lookup tries again


async def test_lookup_company_never_raises(session: AsyncSession, fake: FakeSources) -> None:
    fake.answer = RuntimeError("anything at all")
    found = await reader.lookup_company(session, "Sample Logistics", "Perth", None, settings=ON)
    assert found.checked.property_daily == "error"


# --- The ledger ------------------------------------------------------------------------------


async def test_the_ledger_counts_pages_and_keeps_the_pause(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    ledger = store.DbLedger(session_factory)
    run = uuid.uuid4()
    await ledger.record(Read("property_daily", "search", "ok", 900, NOW, run_id=run))
    await ledger.record(Read("property_daily", "report", "captcha", 800, NOW))
    assert await ledger.pages_since("property_daily", NOW - timedelta(minutes=1)) == 2
    assert await ledger.pages_in_run("property_daily", run) == 1
    assert await ledger.pause_state("property_daily") is None
    await ledger.pause("property_daily", "captcha", NOW + timedelta(hours=24))
    await ledger.problem("property_daily", "captcha", NOW)
    pause = await ledger.pause_state("property_daily")
    assert pause is not None and pause.reason == "captcha"
    async with session_factory.begin() as own:
        await store.resume(own, "property_daily")
    assert await ledger.pause_state("property_daily") is None
    await ledger.problem("property_daily", "signin_failed", NOW)
    await ledger.signed_in("property_daily", NOW)  # a good sign-in clears a sign-in problem
    async with session_factory() as own:
        state = await store.get_state(own, "property_daily")
    assert state is not None and state.last_problem is None and state.signed_in_at is not None
    kinds = (await session.scalars(select(SourceRead.kind).order_by(SourceRead.id))).all()
    assert kinds == ["search", "report"]


# --- Availability and the jobs ---------------------------------------------------------------


async def test_availability_says_why_a_tool_isnt_ready(session: AsyncSession) -> None:
    found = await service.availability(session, Settings(_env_file=None))
    assert not found["property_daily"].on and not found["arealytics"].ready
    assert found["arealytics"].sentence == service.AREALYTICS_SENTENCE
    no_login = await service.availability(
        session, Settings(_env_file=None, property_daily_enabled=True)
    )
    assert no_login["property_daily"].sentence == service.NO_LOGIN_SENTENCE
    assert (await service.availability(session, ON))["property_daily"].ready
    await store.DbLedger(async_sessionmaker(session.bind)).pause(
        "property_daily", "lockout", NOW + timedelta(hours=24)
    )
    paused = (await service.availability(session, ON))["property_daily"]
    assert not paused.ready and paused.sentence and "paused until" in paused.sentence


def job_context(now: datetime) -> JobContext:
    return JobContext(app=None, schedule_id=uuid.uuid4(), settings={}, now=now)  # type: ignore[arg-type]


async def test_the_jobs_skip_while_property_daily_is_off_or_on_a_weekend(
    session: AsyncSession,
) -> None:
    monday = datetime(2026, 11, 16, 6, 15, tzinfo=UTC) - timedelta(hours=11)  # 6:15 am Melbourne
    feed, leases = jobs.SOURCE_JOBS
    with pytest.raises(JobSkipped, match="switched off"):
        await feed.start(job_context(monday))
    with pytest.raises(JobSkipped, match="switched off"):
        await leases.start(job_context(monday))
    with pytest.raises(JobSkipped, match="weekend"):
        await feed.start(job_context(monday - timedelta(days=1)))
    assert feed.default is not None and not feed.default.enabled
    assert leases.default is not None and not leases.default.enabled
    assert (await feed.estimate(job_context(monday))).typical_usd == 0  # type: ignore[misc]


@dataclass
class FakeJobSources:
    tasks: dict[str, Any] = field(default_factory=dict)
    ran: list[str] = field(default_factory=list)

    async def feed(self, settings: Settings) -> str:
        self.ran.append("feed")
        return "done"

    async def lease_endings(self, settings: Settings) -> int:
        self.ran.append("lease_endings")
        return 2


async def test_a_ready_job_starts_its_work_and_says_while_it_runs(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_sources = FakeJobSources()
    monkeypatch.setattr(jobs, "get_sources", lambda: fake_sources)

    async def settings_on(context: JobContext) -> Settings:
        return ON

    monkeypatch.setattr(jobs, "_settings", settings_on)
    monday = datetime(2026, 11, 15, 19, 15, tzinfo=UTC)  # 6:15 am Monday in Melbourne
    for spec in jobs.SOURCE_JOBS:
        result = await spec.start(job_context(monday))
        assert result.ref.endswith("2026-11-16")
        task = fake_sources.tasks[spec.key]
        await task
        assert spec.running is not None and not await spec.running(job_context(monday))
    assert fake_sources.ran == ["feed", "lease_endings"]
