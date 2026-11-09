"""The HubSpot sync (PLAN-V5 B4) on the fake HubSpot and the test database."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import Settings
from core.hubspot.client import HubSpotUnavailable, Owner
from core.hubspot.importer import CompanyRow, DealRow, HubSpotExport, OfficeRow
from core.hubspot.models import (
    HubSpotCompany,
    HubSpotDeal,
    HubSpotOffice,
    HubSpotOwner,
    HubSpotSync,
)
from core.hubspot.service import save_export
from core.hubspot.sync import (
    STALE_MINUTES,
    SyncAlreadyRunning,
    SyncOut,
    SyncRunner,
    begin,
    mark_stale,
    run,
)
from core.memory.embedder import Embedder
from core.memory.models import MemoryItem
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration
SETTINGS = Settings()


class CountingEmbedder:
    """Stands in for FastEmbed: same-length vectors, and it remembers what it embedded."""

    def __init__(self) -> None:
        self.texts: list[str] = []

    async def embed_passages(self, texts: list[str]) -> list[list[float]]:
        self.texts += texts
        return [[0.01 * (i % 7 + 1)] * 384 for i in range(len(texts))]


def contour(fake: FakeHubSpot | None = None) -> FakeHubSpot:
    """Three companies, three deals and two owners, as Contour's HubSpot has them."""
    fake = fake or FakeHubSpot(page_size=2)  # small pages, so paging is used
    fake.owners_active = [Owner("11", "Pat Lee", False)]
    fake.owners_archived = [Owner("12", "Sam Old", True)]
    fake.add_company(
        "101",
        name="Acme Logistics",
        domain="acme.com.au",
        industry="LOGISTICS_AND_SUPPLY_CHAIN",
        hubspot_owner_id="12",
        city_other_office_1_="Perth",
        staff_on_linkedin__perth_="150",
    )
    fake.add_company("102", name="Beta Law", industry="LAW_PRACTICE", hubspot_owner_id="11")
    fake.add_company("103", name="Gamma Soft", city_melbourne_="Cremorne")
    fake.add_deal(
        "501", "101", dealname="Acme - Perth", dealstage="contractsent", pipeline="default"
    )
    fake.add_deal(
        "502", "102", dealname="Beta - New Office", dealstage="34700939", pipeline="default"
    )
    fake.add_deal("503", None, dealname="A deal with no company", dealstage="closedlost")
    return fake


async def sync(
    sessions: async_sessionmaker[AsyncSession],
    fake: FakeHubSpot,
    *,
    mode: str = "auto",
    embedder: CountingEmbedder | None = None,
) -> SyncOut:
    plan = await begin(sessions, trigger="command", mode=mode, settings=SETTINGS)  # type: ignore[arg-type]
    return await run(
        plan,
        sessions=sessions,
        hubspot=fake,
        embedder=embedder or CountingEmbedder(),  # type: ignore[arg-type]
    )


async def test_the_first_sync_reads_everything_and_saves_it_like_an_export(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    embedder = CountingEmbedder()
    out = await sync(session_factory, contour(), embedder=embedder)

    assert (out.status, out.mode, out.error) == ("done", "full", None)
    assert (out.companies_read, out.companies_saved, out.offices_saved) == (3, 3, 2)
    assert (out.deals_read, out.deals_saved, out.deals_skipped) == (3, 2, 1)
    assert out.owners_read == 2 and out.profiles_rebuilt == 3
    assert any("no company" in line for line in out.warnings)

    acme = await session.get(HubSpotCompany, "101")
    assert acme is not None
    assert (acme.source, acme.industry, acme.owner, acme.owner_id) == (
        "api",
        "Logistics and Supply Chain",
        "Sam Old",  # an owner who left still names the company
        "12",
    )
    assert acme.offices_on_record == "Perth"
    assert acme.hubspot_url and acme.hubspot_url.endswith("/101")
    deal = await session.get(HubSpotDeal, "501")
    assert deal is not None
    assert (deal.stage, deal.stage_id, deal.pipeline, deal.source) == (
        "Dissolved",
        "contractsent",
        "Sales Pipeline",
        "api",
    )
    owners = (await session.scalars(select(HubSpotOwner).order_by(HubSpotOwner.owner_id))).all()
    assert [(o.owner_id, o.name, o.archived) for o in owners] == [
        ("11", "Pat Lee", False),
        ("12", "Sam Old", True),
    ]
    profiles = await session.scalar(
        select(func.count()).select_from(MemoryItem).where(MemoryItem.app == "hubspot")
    )
    assert profiles == 3 and len(embedder.texts) == 3


class WatchingHubSpot(FakeHubSpot):
    """Reads the sync's row before each page, to see the progress saved so far."""

    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        super().__init__(page_size=2)
        self.sessions = sessions
        self.seen: list[tuple[int, int]] = []

    async def list_objects(self, object_type, **kwargs):  # type: ignore[no-untyped-def]
        async with self.sessions() as session:
            row = await session.scalar(select(HubSpotSync).order_by(HubSpotSync.id.desc()).limit(1))
            if row is not None:
                self.seen.append((row.companies_read, row.deals_read))
        return await super().list_objects(object_type, **kwargs)


async def test_a_sync_saves_how_far_it_has_read_as_it_goes(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """PLAN-V10 F2: the website's "Sync with HubSpot" shows the counts climb."""
    monkeypatch.setattr("core.hubspot.sync.PROGRESS_EVERY", 1)
    watching = WatchingHubSpot(session_factory)
    out = await sync(session_factory, contour(watching))

    assert out.status == "done"
    assert (out.companies_read, out.deals_read) == (3, 3)
    # Before each page: nothing yet, 2 companies, all 3, then 3 companies and 2 deals.
    assert watching.seen[:4] == [(0, 0), (2, 0), (3, 0), (3, 2)]


async def test_a_progress_save_that_fails_never_stops_the_sync(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(session: AsyncSession, sync_id: int, **values: object) -> None:
        if set(values) == {"companies_read", "deals_read"}:
            raise RuntimeError("the database blinked")
        await real_set(session, sync_id, **values)  # type: ignore[arg-type]

    from core.hubspot import sync as module

    real_set = module._set
    monkeypatch.setattr(module, "PROGRESS_EVERY", 1)
    monkeypatch.setattr(module, "_set", broken)
    out = await sync(session_factory, contour())

    assert (out.status, out.companies_saved, out.deals_saved) == ("done", 3, 2)


async def test_an_export_row_is_replaced_by_the_api_one_with_the_same_id(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    await save_export(
        session,
        HubSpotExport(
            companies=[
                CompanyRow(hubspot_id="101", name="Acme (export)", industry="Logistics"),
                CompanyRow(hubspot_id="999", name="Deleted Since"),
            ],
            offices=[
                OfficeRow(hubspot_company_id="101", label="Sydney"),
                OfficeRow(hubspot_company_id="999", label="Perth"),
            ],
            deals=[DealRow(hubspot_deal_id="900", hubspot_company_id="101", name="Old deal")],
            skipped_sheets=[],
            skipped_rows=0,
        ),
    )

    out = await sync(session_factory, contour())

    session.expire_all()
    acme = await session.get(HubSpotCompany, "101")
    assert acme is not None and (acme.name, acme.source) == ("Acme Logistics", "api")
    offices = (
        await session.scalars(
            select(HubSpotOffice.label).where(HubSpotOffice.hubspot_company_id == "101")
        )
    ).all()
    assert offices == ["Perth"]  # the export's Sydney office went with the export row
    # A full sync removes what HubSpot no longer has, whatever brought it in.
    assert await session.get(HubSpotCompany, "999") is None
    assert await session.get(HubSpotDeal, "900") is None
    assert (out.companies_removed, out.deals_removed) == (1, 1)


async def test_a_changes_sync_reads_only_what_changed_and_keeps_the_rest(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    fake = contour()
    first = await sync(session_factory, fake)
    assert first.mode == "full"

    long_ago = datetime.now(UTC) - timedelta(days=3)
    for record in [*fake.companies.values(), *fake.deals.values()]:
        record.updated_at = long_ago
    fake.companies["102"].properties["name"] = "Beta Law Group"
    fake.companies["102"].updated_at = datetime.now(UTC)
    fake.add_deal(
        "504",
        "103",
        dealname="Gamma - Fitout",
        dealstage="presentationscheduled",
        pipeline="default",
    )
    del fake.companies["103"].properties["city_melbourne_"]  # not read: 103 didn't change
    fake.calls.clear()
    embedder = CountingEmbedder()

    out = await sync(session_factory, fake, embedder=embedder)

    assert out.mode == "changes" and out.changed_since is not None
    assert (out.companies_read, out.deals_read, out.deals_saved) == (1, 1, 1)
    assert "list_companies" not in fake.calls and "search_companies" in fake.calls
    assert "primary_companies" in fake.calls  # a search answer has no links
    session.expire_all()
    beta = await session.get(HubSpotCompany, "102")
    assert beta is not None and beta.name == "Beta Law Group"
    gamma_offices = await session.scalar(
        select(func.count())
        .select_from(HubSpotOffice)
        .where(HubSpotOffice.hubspot_company_id == "103")
    )
    assert gamma_offices == 1  # untouched: 103 wasn't part of this sync
    new_deal = await session.get(HubSpotDeal, "504")
    assert new_deal is not None and new_deal.stage == "Qualified Deal"
    # Only the companies that changed (102, and 103 through its new deal) get new profiles.
    assert out.profiles_rebuilt == 2 and len(embedder.texts) == 2
    assert out.companies_removed == 0  # a changes sync never removes anything


async def test_a_busy_hubspot_in_the_middle_saves_nothing(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    fake = contour()
    fake.fail["list_deals"] = [HubSpotUnavailable("HubSpot is busy", "Too many requests (429).")]

    out = await sync(session_factory, fake)

    assert out.status == "failed" and out.error == "HubSpot is busy. Too many requests (429)."
    assert out.finished_at is not None
    assert await session.scalar(select(func.count()).select_from(HubSpotCompany)) == 0
    # The next sync is a full one again: a failed sync is never the base for a changes sync.
    assert (await sync(session_factory, fake)).mode == "full"


async def test_only_one_sync_runs_at_a_time_and_a_left_over_one_is_cleared(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    plan = await begin(session_factory, trigger="website", mode="auto", settings=SETTINGS)
    with pytest.raises(SyncAlreadyRunning) as caught:
        await begin(session_factory, trigger="command", mode="auto", settings=SETTINGS)
    assert caught.value.sync_id == plan.id

    async with session_factory() as other:
        row = await other.get(HubSpotSync, plan.id)
        assert row is not None
        row.started_at = datetime.now(UTC) - timedelta(minutes=STALE_MINUTES + 1)
        await other.commit()
    again = await begin(session_factory, trigger="command", mode="auto", settings=SETTINGS)
    assert again.id != plan.id
    left = await session.get(HubSpotSync, plan.id)
    assert left is not None and left.status == "interrupted" and left.finished_at is not None


async def test_the_database_refuses_a_second_running_sync(session: AsyncSession) -> None:
    from sqlalchemy.exc import IntegrityError

    session.add_all(
        [
            HubSpotSync(mode="full", trigger="command", status="running"),
            HubSpotSync(mode="full", trigger="website", status="running"),
        ]
    )
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_a_finished_sync_must_have_an_end_time(session: AsyncSession) -> None:
    from sqlalchemy.exc import IntegrityError

    session.add(HubSpotSync(mode="full", trigger="command", status="done"))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_the_runner_starts_in_the_background_and_says_when_no_key_is_set(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    fake = contour()
    runner = SyncRunner(
        sessions=session_factory,
        hubspot=lambda: fake,
        embedder=lambda: CountingEmbedder(),  # type: ignore[arg-type, return-value]
        settings=lambda: SETTINGS,
    )
    started = await runner.start(trigger="website")
    assert started.status == "running"
    await runner._task  # type: ignore[misc]
    assert fake.closed
    done = await session.get(HubSpotSync, started.id)
    assert done is not None and done.status == "done"

    no_key = SyncRunner(
        sessions=session_factory,
        hubspot=lambda: None,
        embedder=lambda: CountingEmbedder(),  # type: ignore[arg-type, return-value]
        settings=lambda: SETTINGS,
    )
    with pytest.raises(LookupError):
        await no_key.start(trigger="website")
    assert await no_key.start_if_due() is None


async def test_a_sync_at_start_up_runs_only_when_the_last_one_is_old(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    fake = contour()
    every_day = Settings(hubspot_sync_max_age_hours=24)
    runner = SyncRunner(
        sessions=session_factory,
        hubspot=lambda: fake,
        embedder=lambda: CountingEmbedder(),  # type: ignore[arg-type, return-value]
        settings=lambda: every_day,
    )
    first = await runner.start_if_due()
    assert first is not None and first.trigger == "startup"
    await runner._task  # type: ignore[misc]
    assert await runner.start_if_due() is None  # the last good one is minutes old
    never = SyncRunner(
        sessions=session_factory,
        hubspot=lambda: fake,
        embedder=lambda: CountingEmbedder(),  # type: ignore[arg-type, return-value]
        settings=lambda: Settings(hubspot_sync_max_age_hours=0),
    )
    async with session_factory() as s:
        await mark_stale(s, older_than=timedelta(0))
        await s.commit()
    assert await never.start_if_due() is None


async def test_a_stopped_runner_leaves_the_sync_interrupted(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    import asyncio

    fake = contour()
    gate = asyncio.Event()
    original = fake.list_objects

    async def slow(*args, **kwargs):  # type: ignore[no-untyped-def]
        await gate.wait()
        return await original(*args, **kwargs)

    fake.list_objects = slow  # type: ignore[method-assign]
    runner = SyncRunner(
        sessions=session_factory,
        hubspot=lambda: fake,
        embedder=lambda: CountingEmbedder(),  # type: ignore[arg-type, return-value]
        settings=lambda: SETTINGS,
    )
    started = await runner.start(trigger="website")
    await asyncio.sleep(0.05)
    assert runner.busy
    await runner.stop()
    row = await session.get(HubSpotSync, started.id)
    assert row is not None and row.status == "interrupted" and fake.closed


def test_the_embedder_stand_in_matches_the_real_signature() -> None:
    assert hasattr(Embedder, "embed_passages")
