"""Lead Finder runs end to end: discovery, watchlist, typed companies and the test set, on the
real test database with a FakeClaude. Stop, caps, crash and resume, and the run invariants.

Integration: every run writes runs, events, searches, leads and memory.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.runs import NOT_APPROVED_CODE
from apps.lead_finder.tables import Lead, company_key
from apps.lead_finder.testing import report_of_testset
from core.api.errors import Problem
from core.config import ENGINE_DIR
from core.hubspot.importer import read_export
from core.hubspot.models import HubSpotCompany, HubSpotDeal
from core.hubspot.service import save_export
from core.memory.models import MemoryItem
from core.runs.manager import RunManager
from core.runs.schemas import RunCreate
from core.searches.models import SearchLog
from tests.core.conftest import MemorySource
from tests.core.runs_fakes import (
    assert_totals_match_log,
    event_types,
    run_row,
    stored_json,
    wait_for_status,
    wait_until_idle,
)
from tests.lead_finder.conftest import APP, MakeLeadFinderManager, lf_settings
from tests.lead_finder.factories import add_all, make_lead
from tests.lead_finder.samples import FakeClaude, sample_scenario

pytestmark = pytest.mark.integration
D = Decimal
EXPORT = ENGINE_DIR.parent / "projects" / "leads" / "research" / "COMPANIES.xlsx"

DISCOVERY = {
    "cities": ["Melbourne", "Adelaide", "Perth"],
    "triggers": ["lease_ending", "merger_or_takeover", "fast_growth"],
    "since_days": 30,
}
FOUND = [
    "Boxhill Software",
    "Harbour Foods",
    "Kent Town Legal",
    "Unyte",
    "West Perth Mining Services",
]


async def start(manager: RunManager, mode: str, params: dict[str, Any] | None = None) -> uuid.UUID:
    run = await manager.start(APP, mode, params or {})
    return run.id


async def finished(
    manager: RunManager, factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> Any:
    await wait_until_idle(manager, timeout=60)
    return await run_row(factory, run_id)


async def leads_of(factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID) -> list[Lead]:
    async with factory() as session:
        return list(
            (
                await session.scalars(
                    select(Lead).where(Lead.run_id == run_id).order_by(Lead.company)
                )
            ).all()
        )


async def searches_of(
    factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> list[SearchLog]:
    async with factory() as session:
        return list(
            (await session.scalars(select(SearchLog).where(SearchLog.run_id == run_id))).all()
        )


def of_type(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event["data"] for event in events if event["type"] == kind]


def companies(*names: str) -> dict[str, Any]:
    return {"companies": [{"name": name, "city": "Melbourne"} for name in names]}


# --- Discovery ---------------------------------------------------------------------------------


async def test_a_discovery_run_finds_merges_chooses_and_researches(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude(scenario=sample_scenario())
    manager = make_lf_manager(claude)
    run_id = await start(manager, "discovery", DISCOVERY)
    row = await finished(manager, session_factory, run_id)

    assert (row.status, row.stop_reason, row.error) == ("done", None, None)
    events = await stored_json(session_factory, run_id)
    assert of_type(events, "plan_ready") == [
        {"slices": 9, "companies": 0, "labels": of_type(events, "plan_ready")[0]["labels"]}
    ]
    assert len(of_type(events, "slice_started")) == len(of_type(events, "slice_done")) == 9
    assert of_type(events, "merged") == [{"candidates": 7, "unique": 5}]
    assert sorted(e["name"] for e in of_type(events, "company_done")) == FOUND
    assert (await event_types(session_factory, run_id))[-1] == "run_finished"

    leads = await leads_of(session_factory, run_id)
    assert sorted(lead.company_key for lead in leads) == sorted(company_key(n) for n in FOUND)
    assert {lead.origin for lead in leads} == {"web"}
    assert all(not lead.is_test for lead in leads)

    row = await assert_totals_match_log(session_factory, run_id)
    assert row.cost_usd <= D(str(row.caps["run_cap_usd"]))
    searches = await searches_of(session_factory, run_id)
    assert len(searches) == row.claude_requests
    assert sum(1 for search in searches if search.step == "discover") == 9
    counts = row.counts
    assert (counts["slices"], counts["slices_done"], counts["unique"]) == (9, 9, 5)
    assert (counts["chosen"], counts["researched"]) == (5, 5)
    assert sum(counts["by_result"].values()) == 5


async def test_discovery_signals_become_notes_under_the_researched_name(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()))
    run_id = await start(manager, "discovery", DISCOVERY)
    await finished(manager, session_factory, run_id)
    async with session_factory() as session:
        notes = (
            await session.scalars(
                select(MemoryItem).where(
                    MemoryItem.kind == "source_note", MemoryItem.subject == "Unyte"
                )
            )
        ).all()
    discovery = [note for note in notes if note.meta.get("origin") == "discovery"]
    # Unyte was found twice (as Unyte and Unyte Health): both signals, under the chosen name.
    assert sorted(note.meta["trigger_id"] for note in discovery) == [
        "lease_ending",
        "merger_or_takeover",
    ]


async def test_the_step_models_from_the_settings_reach_claude_and_the_log(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude(scenario=sample_scenario())
    settings = lf_settings(model_discover="claude-haiku-5-5", model_search="claude-sonnet-5-5")
    manager = make_lf_manager(claude, settings=settings)
    run_id = await start(manager, "discovery", DISCOVERY)
    await finished(manager, session_factory, run_id)

    models = {(call.step.split(":")[0], call.model) for call in claude.requests}
    assert models == {
        ("discover", "claude-haiku-5-5"),
        ("search", "claude-sonnet-5-5"),
        ("extract", "claude-opus-5-5"),
    }
    logged = {
        (row.step.split(":")[0], row.model) for row in await searches_of(session_factory, run_id)
    }
    assert logged == models


async def test_the_choose_rules_skip_open_deals_and_fresh_leads(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    run_day: str,
) -> None:
    session.add(HubSpotCompany(hubspot_id="501", name="Kent Town Legal", source="export"))
    await session.flush()
    session.add(
        HubSpotDeal(
            hubspot_deal_id="d501",
            hubspot_company_id="501",
            name="Kent Town Legal ADEL",
            stage="Verified",
        )
    )
    await session.commit()
    two_days_ago = datetime.fromisoformat(run_day).replace(tzinfo=UTC) - timedelta(days=2)
    await add_all(session, make_lead("Boxhill Software", created_at=two_days_ago))

    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()))
    run_id = await start(manager, "discovery", DISCOVERY)
    row = await finished(manager, session_factory, run_id)

    skipped = {
        e["name"]: e["reason"]
        for e in of_type(await stored_json(session_factory, run_id), "company_skipped")
    }
    assert skipped["Kent Town Legal"].startswith("Open deal in HubSpot")
    assert skipped["Boxhill Software"].startswith("researched 2 days ago")
    assert row.counts["researched"] == 3


async def test_the_default_start_choice_fits_the_default_caps_and_ends_under_them(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """The Start page's defaults: Melbourne and the six main signs, 6 slices (PLAN-V9 C4)."""
    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()))
    estimate = await manager.estimate(RunCreate(app=APP, mode="discovery", params={}))
    assert (estimate.valid, estimate.slices, estimate.blocked) == (True, 6, None)
    run_id = await start(manager, "discovery", {})
    row = await finished(manager, session_factory, run_id)
    assert row.status == "done"
    assert row.counts["slices"] == 6
    await assert_totals_match_log(session_factory, run_id)
    assert row.cost_usd <= D("20")


# --- Typed companies, re-check, test set -------------------------------------------------------


async def test_a_company_run_researches_the_names_typed(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude()
    manager = make_lf_manager(claude)
    run_id = await start(manager, "company", companies("Acme Software", "Boxhill Software"))
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    leads = await leads_of(session_factory, run_id)
    assert [lead.company_key for lead in leads] == ["acme software", "boxhill software"]
    assert {lead.origin for lead in leads} == {"typed"}
    assert of_type(await stored_json(session_factory, run_id), "plan_ready")[0]["companies"] == 2
    # Each lead's id is fixed by the run and the company, so a resume can never make a second.
    from apps.lead_finder.research import run_lead_id

    assert {lead.id for lead in leads} == {run_lead_id(run_id, lead.company_key) for lead in leads}


async def test_a_recheck_searches_again_even_with_fresh_memory(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    first = make_lf_manager(FakeClaude())
    await finished(
        first, session_factory, await start(first, "company", companies("Acme Software"))
    )

    reuse = FakeClaude()
    second = make_lf_manager(reuse)
    await finished(
        second, session_factory, await start(second, "company", companies("Acme Software"))
    )
    assert reuse.calls == ["extract"]  # memory was fresh: only the form

    again = FakeClaude()
    third = make_lf_manager(again)
    params = {**companies("Acme Software"), "recheck": True}
    await finished(third, session_factory, await start(third, "company", params))
    assert sorted(again.calls) == ["extract", "search:money", "search:people", "search:property"]


async def test_the_test_set_run_marks_its_leads_and_reports_against_expectations(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
) -> None:
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(run_company_concurrency=4))
    run_id = await start(manager, "testset")
    row = await finished(manager, session_factory, run_id)
    assert row.status == "done"
    leads = await leads_of(session_factory, run_id)
    assert len(leads) == 10
    assert all(lead.is_test for lead in leads)

    report = await report_of_testset(session, run_id)
    assert (report.summary.companies, report.summary.expected) == (10, 1)
    canva = next(item for item in report.items if item.name == "Canva")
    assert canva.expected == ["director_review", "watch", "drop"]
    assert canva.ok is (canva.result in canva.expected)
    assert report.summary.total_cost_usd == row.cost_usd
    with pytest.raises(Problem) as missing:
        await report_of_testset(session, uuid.uuid4())
    assert missing.value.status == 404


# --- The watchlist and Levi's OK ------------------------------------------------------------------


@pytest.mark.skipif(not EXPORT.exists(), reason="the HubSpot export is not in the repo")
async def test_a_watchlist_run_waits_for_the_ok_to_send_hubspot_names(
    make_lf_manager: MakeLeadFinderManager, session: AsyncSession
) -> None:
    await save_export(session, read_export(EXPORT))
    manager = make_lf_manager(FakeClaude())

    with pytest.raises(Problem) as refused:
        await start(manager, "watchlist")
    assert (refused.value.status, refused.value.code) == (409, NOT_APPROVED_CODE)

    estimate = await manager.estimate(RunCreate(app=APP, mode="watchlist", params={}))
    assert estimate.valid
    assert estimate.blocked is not None and estimate.blocked.code == NOT_APPROVED_CODE
    assert estimate.companies_expected == 47
    assert "47 companies, but the run limit is 20." in " ".join(estimate.warnings)


@pytest.mark.skipif(not EXPORT.exists(), reason="the HubSpot export is not in the repo")
async def test_a_watchlist_run_skips_the_dissolved_deal_and_keeps_the_watch_order(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
) -> None:
    await save_export(session, read_export(EXPORT))
    settings = lf_settings(hubspot_names_to_claude_ok=True, run_max_companies=3)
    claude = FakeClaude()
    manager = make_lf_manager(claude, settings=settings)
    run_id = await start(manager, "watchlist")
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    events = await stored_json(session_factory, run_id)
    skipped = of_type(events, "company_skipped")
    patties = next(e for e in skipped if e["name"] == "Patties Food Group")
    assert (
        patties["reason"]
        == "Deal dissolved 2026-10-07. Wait until 2027-10-07, unless a new trigger"
    )
    over = next(e for e in skipped if e.get("count"))
    assert over["count"] == 47 - 1 - 3
    leads = await leads_of(session_factory, run_id)
    assert len(leads) == 3
    assert {lead.origin for lead in leads} == {"hubspot"}
    assert all(lead.hubspot_id for lead in leads)
    # The first three of the watch list, most likely first (EXPORT.md section 8).
    researched = [e["name"] for e in of_type(events, "company_started")]
    assert sorted(researched) == sorted(["Synechron Australia", "SME Powered Services", "JAM TV"])


# --- Stop, caps, failures, crash and resume ------------------------------------------------------


async def test_stop_keeps_the_companies_that_finished(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude()
    held = claude.hold("Cobalt Partners")
    manager = make_lf_manager(claude, settings=lf_settings(run_company_concurrency=1))
    run_id = await start(
        manager, "company", companies("Acme Software", "Boxhill Software", "Cobalt Partners")
    )
    await asyncio.wait_for(claude.reached("Cobalt Partners").wait(), 30)

    out = await manager.cancel(run_id)

    assert out.status == "cancelled"
    leads = await leads_of(session_factory, run_id)
    assert [lead.company_key for lead in leads] == ["acme software", "boxhill software"]
    await assert_totals_match_log(session_factory, run_id)
    held.set()


async def test_the_run_cap_stops_the_run_cleanly(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(run_company_concurrency=1))
    params = {
        **companies("Acme Software", "Boxhill Software", "Cobalt Partners"),
        "caps": {"run_cap_usd": "1.00"},
    }
    run_id = await start(manager, "company", params)
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    assert row.stop_reason == "The run reached its limit of US$1.00"
    events = await stored_json(session_factory, run_id)
    assert of_type(events, "cap_reached")[0]["kind"] == "run_cost"
    assert row.counts["researched"] >= 1 and row.counts["skipped"] >= 1
    row = await assert_totals_match_log(session_factory, run_id)
    assert row.cost_usd <= D("1.00")


async def test_claude_unavailable_fails_the_run_in_plain_words(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    manager = make_lf_manager(FakeClaude(unavailable=True))
    run_id = await start(manager, "company", companies("Acme Software"))
    row = await wait_for_status(session_factory, run_id, "failed", timeout=30)
    assert row.stop_reason == "No Claude API key"
    assert row.error_id is None


async def test_one_company_failing_never_stops_the_others(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.hubspot.matching import match_company as real

    async def broken_for_boxhill(
        session: AsyncSession, name: str, *args: Any, **kwargs: Any
    ) -> Any:
        if name == "Boxhill Software":
            raise RuntimeError("password=hunter2 in a broken query")
        return await real(session, name, *args, **kwargs)

    monkeypatch.setattr("apps.lead_finder.research.match_company", broken_for_boxhill)
    manager = make_lf_manager(FakeClaude())
    run_id = await start(manager, "company", companies("Acme Software", "Boxhill Software"))
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    failed = of_type(await stored_json(session_factory, run_id), "company_failed")
    assert [e["name"] for e in failed] == ["Boxhill Software"]
    assert "hunter2" not in failed[0]["reason"]
    assert row.counts["failed"] == 1 and row.counts["researched"] == 1


async def test_after_a_crash_the_resume_researches_only_what_was_left(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    names = ("Acme Software", "Boxhill Software", "Cobalt Partners", "Delta Logistics")
    source = MemorySource()  # the checkpoints survive the "process"
    dying = FakeClaude(crash_after_extracts=2)
    first = make_lf_manager(dying, settings=lf_settings(run_company_concurrency=1), source=source)
    run_id = await start(first, "company", companies(*names))
    await wait_until_idle(first, timeout=60)
    row = await run_row(session_factory, run_id)
    assert row.status == "running"  # the process died: nothing more was written
    done_before = {lead.company_key for lead in await leads_of(session_factory, run_id)}
    assert len(done_before) == 2

    fresh = FakeClaude()
    second = make_lf_manager(fresh, settings=lf_settings(run_company_concurrency=1), source=source)
    assert await second.recover() == 1
    await second.resume(run_id)
    row = await finished(second, session_factory, run_id)

    assert row.status == "done"
    leads = await leads_of(session_factory, run_id)
    assert {lead.company_key for lead in leads} == {company_key(name) for name in names}
    for name in names:
        if company_key(name) in done_before:
            assert fresh.requests_for(name) == [], f"{name} was researched twice"
    assert row.counts["resumes"] == 1
    assert row.counts["researched"] == 4
    await assert_totals_match_log(session_factory, run_id)


async def test_every_search_of_a_run_is_counted_once(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()))
    run_id = await start(manager, "discovery", DISCOVERY)
    await finished(manager, session_factory, run_id)
    async with session_factory() as session:
        orphans = await session.scalar(
            select(func.count()).select_from(SearchLog).where(SearchLog.run_id.is_(None))
        )
    assert orphans == 0  # every Claude request of the run carries the run id
    row = await assert_totals_match_log(session_factory, run_id)
    assert row.claude_requests == len(await searches_of(session_factory, run_id))
