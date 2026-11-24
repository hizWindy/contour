"""A research the Assistant starts (PLAN-V27 T4-2, T4-3): a Lead Finder run of one company, on the
real test database with a FakeClaude.

- each finding reaches the run's events as it arrives, one plain line with its link, and the
  company's `company_done` says its tier;
- a run nobody started from the Assistant sends no findings, so other feeds stay as they are;
- it gets a run's caps, waits for the run limit, and the daily limit stops it as it stops any
  run.

Made-up names only (Acme Software is the samples' own).
"""

import asyncio
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.company_leads import research_params
from core.api.errors import Problem
from core.claude.daily import DailyLimitReached
from core.runs.manager import RunManager
from tests.core.runs_fakes import run_row, stored_json, wait_until_idle
from tests.lead_finder.conftest import APP, MakeLeadFinderManager, lf_settings
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration
NAME = "Acme Software"


async def researched(
    manager: RunManager,
    factory: async_sessionmaker[AsyncSession],
    params: dict[str, Any],
) -> tuple[Any, list[dict[str, Any]]]:
    run = await manager.start(APP, "company", params)
    await wait_until_idle(manager, timeout=60)
    return await run_row(factory, run.id), await stored_json(factory, run.id)


def of_type(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event["data"] for event in events if event["type"] == kind]


async def test_each_finding_arrives_as_an_event_and_the_end_says_the_tier(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    manager = make_lf_manager(FakeClaude())
    row, events = await researched(manager, session_factory, research_params(NAME, "Melbourne"))

    assert row.status == "done"
    assert row.params["from_assistant"] is True
    findings = of_type(events, "finding")
    assert findings, "the research found notes, so the Assistant sees them"
    for finding in findings:
        assert finding["company"] == NAME
        assert finding["text"] and len(finding["text"]) <= 300
        assert finding["source_url"].startswith(("https://", "http://"))
        assert "@" not in finding["text"]
        assert finding["next_question"] is None  # today's research asks its angles side by side
    types = [event["type"] for event in events]
    assert types.index("company_started") < types.index("finding") < types.index("company_done")
    done = of_type(events, "company_done")[0]
    assert "tier" in done  # A, B, C, discard, or None for a card with no tier
    assert of_type(events, "run_finished")[0]["status"] == "done"


async def test_a_run_not_from_the_assistant_sends_no_findings(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    manager = make_lf_manager(FakeClaude())
    params = {"companies": [{"name": NAME, "city": "Melbourne"}]}
    row, events = await researched(manager, session_factory, params)

    assert row.status == "done"
    assert of_type(events, "finding") == []


async def test_the_assistants_research_gets_a_runs_caps_and_waits_for_the_run_limit(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """It is a run like any other: the settings' run cap and company cap, and only
    `max_concurrent_runs` at once (409 `run_already_active` for another)."""
    claude = FakeClaude()
    let_go = claude.hold(NAME)
    settings = lf_settings(run_cap_usd=Decimal("6.00"), company_cap_usd=Decimal("1.50"))
    manager = make_lf_manager(claude, settings=settings)
    first = await manager.start(APP, "company", research_params(NAME, "Melbourne"))
    async with asyncio.timeout(30):
        await claude.reached(NAME).wait()
    with pytest.raises(Problem) as busy:
        await manager.start(APP, "company", research_params("Boxhill Software", None))
    assert (busy.value.status, busy.value.code) == (409, "run_already_active")
    let_go.set()
    await wait_until_idle(manager, timeout=60)
    row = await run_row(session_factory, first.id)
    assert row.status == "done"
    assert (Decimal(row.caps["run_cap_usd"]), Decimal(row.caps["company_cap_usd"])) == (
        Decimal("6.00"),
        Decimal("1.50"),
    )
    assert row.cost_usd <= Decimal("1.50")


async def test_the_daily_limit_stops_the_assistants_research_as_it_stops_a_run(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    limit = DailyLimitReached(
        cap=Decimal("40"), spent=Decimal("40"), held=Decimal("0"), needed=Decimal("0.8")
    )
    manager = make_lf_manager(FakeClaude(error=limit))
    row, events = await researched(manager, session_factory, research_params(NAME, None))

    assert row.status == "done"
    skipped = of_type(events, "company_skipped")
    assert [item["reason"] for item in skipped] == ["Claude's daily limit is reached"]
    assert of_type(events, "finding") == []


async def test_a_second_company_is_refused_before_anything_starts(
    make_lf_manager: MakeLeadFinderManager,
) -> None:
    manager = make_lf_manager(FakeClaude())
    params = {
        "companies": [{"name": NAME}, {"name": "Boxhill Software"}],
        "from_assistant": True,
    }
    with pytest.raises(Problem) as refused:
        await manager.start(APP, "company", params)
    assert refused.value.status == 422
    assert manager.active_run_ids == []


# --- Quick Deep Research (PLAN-V27 T5-1) ---------------------------------------------------------


async def test_deep_style_makes_the_assistants_research_use_the_loop_with_the_same_card(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude()
    deep = lf_settings(assistant_research_style="deep", model_deep="claude-sonnet-5-5")
    manager = make_lf_manager(claude, settings=deep)
    row, events = await researched(manager, session_factory, research_params(NAME, "Melbourne"))
    # The angles' card for another Acme, for the comparison (memory is per company)
    manager = make_lf_manager(FakeClaude())
    _, plain = await researched(
        manager, session_factory, research_params("Acme Works", "Melbourne")
    )

    assert row.status == "done"
    searches = [call for call in claude.requests if call.step.startswith("search:")]
    assert searches and {call.step for call in searches} == {"search:deep"}
    assert len(searches) <= 3  # the sample answers ask no follow-up
    assert {call.model for call in searches} == {"claude-sonnet-5-5"}  # model_deep
    extracts = [call for call in claude.requests if call.step.startswith("extract")]
    assert extracts and all(call.model != "claude-sonnet-5-5" for call in extracts)
    # The same facts form, so the same kind of card: the same result as the angles' card
    done, done_plain = of_type(events, "company_done")[0], of_type(plain, "company_done")[0]
    assert (done["result"], done["tier"]) == (done_plain["result"], done_plain["tier"])
    assert of_type(events, "finding")


async def test_deep_style_leaves_every_other_run_on_the_angles(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude()
    manager = make_lf_manager(claude, settings=lf_settings(assistant_research_style="deep"))
    params = {"companies": [{"name": NAME, "city": "Melbourne"}]}
    row, _ = await researched(manager, session_factory, params)

    assert row.status == "done"
    assert "search:deep" not in claude.calls
    assert "search:property" in claude.calls
