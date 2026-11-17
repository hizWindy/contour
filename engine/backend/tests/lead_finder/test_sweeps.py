"""PLAN-V21 T1-4 and T1-6: a discovery run a person starts searches again, in a new way, while it
has fewer companies than its target, then tops itself up from the HubSpot watchlist.

Integration: each run writes runs, events, searches and leads on the test database, with a
FakeClaude that answers each sweep from its own samples (`FakeClaude.sweeps`).
"""

import uuid
from datetime import time
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.tables import Lead
from core.config import ENGINE_DIR
from core.hubspot.importer import read_export
from core.hubspot.service import save_export
from core.runs.manager import RunManager
from core.runs.schemas import RunCreate
from core.schedules.models import Schedule
from core.searches.models import SearchLog
from tests.core.conftest import MemorySource
from tests.core.runs_fakes import run_row, stored_json, wait_until_idle
from tests.lead_finder.conftest import APP, MakeLeadFinderManager, lf_settings
from tests.lead_finder.samples import FakeClaude, candidate, sample_scenario, sweep_of

pytestmark = pytest.mark.integration
EXPORT = ENGINE_DIR.parent / "projects" / "leads" / "research" / "COMPANIES.xlsx"
D = Decimal

THREE_CITIES = {
    "cities": ["Melbourne", "Adelaide", "Perth"],
    "triggers": ["lease_ending", "merger_or_takeover", "fast_growth"],
    "since_days": 30,
}
ONE_CITY = {"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30}


async def start(manager: RunManager, params: dict[str, Any]) -> uuid.UUID:
    return (await manager.start(APP, "discovery", params)).id


async def finished(
    manager: RunManager, factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> Any:
    await wait_until_idle(manager, timeout=60)
    return await run_row(factory, run_id)


def of_type(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event["data"] for event in events if event["type"] == kind]


def discover_sweeps(claude: FakeClaude) -> list[int]:
    return [sweep_of(call.prompt) for call in claude.requests if call.step == "discover"]


def one_new_company_a_sweep() -> dict[tuple[int, str, str], list[Any]]:
    """Sweeps 2, 3 and 4 each find one company the sweeps before them didn't."""
    return {
        (sweep, "lease_ending", "Melbourne"): [candidate(f"Sweep {sweep} Software")]
        for sweep in (2, 3, 4)
    }


async def leads_of(factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID) -> list[Lead]:
    async with factory() as session:
        return list((await session.scalars(select(Lead).where(Lead.run_id == run_id))).all())


# --- The sweeps (T1-4) ----------------------------------------------------------------------------


async def test_a_run_that_meets_its_target_in_sweep_1_makes_no_sweep_2(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude(scenario=sample_scenario(), sweeps=one_new_company_a_sweep())
    manager = make_lf_manager(claude)
    run_id = await start(manager, {**THREE_CITIES, "target_companies": 5})
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    assert discover_sweeps(claude) == [1] * 9
    events = await stored_json(session_factory, run_id)
    assert of_type(events, "sweep_started") == [
        {"sweep": 1, "of": 4, "label": "The signs' own searches"}
    ]
    assert of_type(events, "sweep_done") == [{"sweep": 1, "found": 7, "companies": 5, "target": 5}]
    counts = row.counts
    assert (counts["target"], counts["sweeps"], counts["sweeps_done"]) == (5, 4, 1)
    assert counts["researched"] == 5


async def test_a_thin_run_goes_on_to_sweep_4_and_stops(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude(
        scenario={("lease_ending", "Melbourne"): [candidate("Boxhill Software")]},
        sweeps=one_new_company_a_sweep(),
    )
    manager = make_lf_manager(claude)
    run_id = await start(manager, {**ONE_CITY, "target_companies": 20})
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    assert discover_sweeps(claude) == [1, 2, 3, 4]  # one sign in one city: one search a sweep
    events = await stored_json(session_factory, run_id)
    assert [e["sweep"] for e in of_type(events, "sweep_started")] == [1, 2, 3, 4]
    assert [e["label"] for e in of_type(events, "sweep_started")][1:] == [
        "Levi's source groups",
        "By sector",
        "By area",
    ]
    # The run merges after each sweep, so "companies after merging" grows as the searches go
    assert [e["unique"] for e in of_type(events, "merged")] == [1, 2, 3, 4]
    assert [(e["found"], e["companies"]) for e in of_type(events, "sweep_done")] == [
        (1, 1),
        (1, 2),
        (1, 3),
        (1, 4),
    ]
    assert row.counts["slices"] == 4 and row.counts["slices_done"] == 4
    assert row.counts["sweeps_done"] == 4
    assert row.counts["researched"] == 4
    async with session_factory() as session:
        jobs = set(
            (
                await session.scalars(
                    select(SearchLog.job_id).where(
                        SearchLog.run_id == run_id, SearchLog.step == "discover"
                    )
                )
            ).all()
        )
    assert len(jobs) == 4  # each sweep's search has a job of its own in the search log


async def test_a_run_at_its_discovery_money_stops_sweeping_and_says_so(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """A US$4 run gives discovery US$1.60. Two searches at about US$0.58 leave less than the
    US$0.60 a search holds, so the run researches what it has instead of sweeping again."""
    claude = FakeClaude(
        scenario={("lease_ending", "Melbourne"): [candidate("Boxhill Software")]},
        sweeps=one_new_company_a_sweep(),
        discover_cost=D("0.55"),
    )
    settings = lf_settings(run_cap_usd=D("4"))
    manager = make_lf_manager(claude, settings=settings)
    params = {**ONE_CITY, "triggers": ["lease_ending", "fast_growth"], "target_companies": 20}
    run_id = await start(manager, params)
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    assert discover_sweeps(claude) == [1, 1]
    events = await stored_json(session_factory, run_id)
    problems = [e["message"] for e in of_type(events, "problem")]
    assert (
        "Discovery's share of the money (US$1.60) is used up, so the run stops searching after "
        "sweep 1, with 1 of its 20 companies."
    ) in problems
    assert row.counts["researched"] == 1


async def test_a_resume_in_the_middle_of_sweep_3_starts_at_sweep_3(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    scenario = {("lease_ending", "Melbourne"): [candidate("Boxhill Software")]}
    source = MemorySource()  # the checkpoints survive the "process"
    settings = lf_settings(run_discover_concurrency=1)
    dying = FakeClaude(scenario=scenario, sweeps=one_new_company_a_sweep(), crash_on_sweep=3)
    first = make_lf_manager(dying, settings=settings, source=source)
    run_id = await start(first, {**ONE_CITY, "target_companies": 20})
    await wait_until_idle(first, timeout=60)
    assert (await run_row(session_factory, run_id)).status == "running"  # the process died
    assert discover_sweeps(dying) == [1, 2, 3]

    fresh = FakeClaude(scenario=scenario, sweeps=one_new_company_a_sweep())
    second = make_lf_manager(fresh, settings=settings, source=source)
    assert await second.recover() == 1
    await second.resume(run_id)
    row = await finished(second, session_factory, run_id)

    assert row.status == "done"
    assert discover_sweeps(fresh) == [3, 4]  # sweeps 1 and 2 were paid for: never again
    assert row.counts["researched"] == 4


async def test_an_automatic_run_makes_one_sweep_and_no_top_up(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """The automatic runs keep one search for each sign (until Al-khair says so after M2)."""
    claude = FakeClaude(
        scenario={("lease_ending", "Melbourne"): [candidate("Boxhill Software")]},
        sweeps=one_new_company_a_sweep(),
    )
    manager = make_lf_manager(claude, settings=lf_settings(hubspot_names_to_claude_ok=True))
    async with session_factory() as db:
        schedule = Schedule(
            project="test", job="test.city", name="A city", every=1, unit="days", at_time=time(7)
        )
        db.add(schedule)
        await db.commit()
    run = await manager.start(APP, "discovery", ONE_CITY, schedule_id=schedule.id)
    row = await finished(manager, session_factory, run.id)

    assert discover_sweeps(claude) == [1]
    assert (row.counts["target"], row.counts["sweeps"], row.counts["topped_up"]) == (None, 1, 0)
    events = await stored_json(session_factory, run.id)
    assert of_type(events, "sweep_started") == [] and of_type(events, "topped_up") == []


# --- The estimate and the target's ceiling (T1-4) -------------------------------------------------


async def test_the_estimate_gives_a_cost_range_for_the_target(
    make_lf_manager: MakeLeadFinderManager,
) -> None:
    manager = make_lf_manager(FakeClaude())
    estimate = await manager.estimate(
        RunCreate(app=APP, mode="discovery", params={**ONE_CITY, "target_companies": 10})
    )
    assert estimate.valid and estimate.target_companies == 10
    assert estimate.target_cost_usd_low is not None and estimate.target_cost_usd_high is not None
    # the defaults: US$0.40 a search and US$1.00 a company. One sweep, or all four.
    assert estimate.target_cost_usd_low == D("0.40") + 10 * D("1.00")
    assert estimate.target_cost_usd_high == 4 * D("0.40") + 10 * D("1.00")
    assert estimate.target_note is None
    assert estimate.companies_expected == 10


async def test_a_target_the_money_cant_reach_says_so_in_one_sentence(
    make_lf_manager: MakeLeadFinderManager,
) -> None:
    manager = make_lf_manager(FakeClaude(), settings=lf_settings(run_cap_usd=D("5")))
    estimate = await manager.estimate(
        RunCreate(app=APP, mode="discovery", params={**ONE_CITY, "target_companies": 20})
    )
    assert estimate.target_note == (
        "20 companies cost about US$20.40, more than this run's limit of US$5.00, so the run "
        "stops at the limit after about 4."
    )


async def test_a_target_above_the_company_limit_is_refused(
    make_lf_manager: MakeLeadFinderManager,
) -> None:
    manager = make_lf_manager(FakeClaude())  # the code's company limit is 20
    estimate = await manager.estimate(
        RunCreate(app=APP, mode="discovery", params={**ONE_CITY, "target_companies": 50})
    )
    assert not estimate.valid
    assert [error.field for error in estimate.errors] == ["body.params.target_companies"]
    assert "at most 20" in estimate.errors[0].message


# --- The top up (T1-6) ----------------------------------------------------------------------------


@pytest.mark.skipif(not EXPORT.exists(), reason="the HubSpot export is not in the repo")
async def test_a_run_12_short_of_its_target_adds_12_from_the_watchlist(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
) -> None:
    await save_export(session, read_export(EXPORT))
    claude = FakeClaude(
        scenario={
            ("lease_ending", "Melbourne"): [
                candidate("Boxhill Software"),
                candidate("Cremorne Analytics"),
            ]
        }
    )
    settings = lf_settings(hubspot_names_to_claude_ok=True, discovery_max_sweeps=1)
    manager = make_lf_manager(claude, settings=settings)
    run_id = await start(manager, {**ONE_CITY, "target_companies": 14})
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    assert row.counts["topped_up"] == 12
    events = await stored_json(session_factory, run_id)
    topped = of_type(events, "topped_up")
    assert len(topped) == 1 and topped[0]["count"] == 12 and len(topped[0]["names"]) == 12
    leads = await leads_of(session_factory, run_id)
    by_origin = sorted(lead.origin for lead in leads)
    assert by_origin.count("hubspot") == 12 and by_origin.count("web") == 2
    assert all(lead.hubspot_id for lead in leads if lead.origin == "hubspot")
    started = {e["name"]: e["origin"] for e in of_type(events, "company_started")}
    assert {started[name] for name in topped[0]["names"]} == {"hubspot"}
    # Never a dissolved deal, nor a name the research would refuse
    assert "Patties Food Group" not in topped[0]["names"]
    assert "The Conversation Australia + NZ" not in topped[0]["names"]
    assert of_type(events, "company_failed") == []
    assert row.counts["chosen"] == 14


@pytest.mark.skipif(not EXPORT.exists(), reason="the HubSpot export is not in the repo")
@pytest.mark.parametrize(
    ("top_up", "approved"), [(False, True), (True, False)], ids=["asked-off", "not-approved"]
)
async def test_no_top_up_when_it_is_off_or_hubspot_names_may_not_go_to_claude(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    top_up: bool,
    approved: bool,
) -> None:
    await save_export(session, read_export(EXPORT))
    claude = FakeClaude(scenario={("lease_ending", "Melbourne"): [candidate("Boxhill Software")]})
    settings = lf_settings(hubspot_names_to_claude_ok=approved, discovery_max_sweeps=1)
    manager = make_lf_manager(claude, settings=settings)
    run_id = await start(manager, {**ONE_CITY, "target_companies": 14, "top_up": top_up})
    row = await finished(manager, session_factory, run_id)

    assert row.status == "done"
    assert row.counts["topped_up"] == 0
    assert of_type(await stored_json(session_factory, run_id), "topped_up") == []
    assert {lead.origin for lead in await leads_of(session_factory, run_id)} == {"web"}
