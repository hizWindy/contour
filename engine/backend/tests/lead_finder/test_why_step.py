"""Why now inside the research (PLAN-V12 C2) and for saved leads (C3), with a fake Claude.

Free, and the same every time. Integration tests: they need the database.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder import cli
from apps.lead_finder.research import (
    LeadCard,
    ResearchRequest,
    refill_lead,
    research_company,
    why_now_for_lead,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.tables import Lead
from apps.lead_finder.why import WhyNowAnswer
from core.claude.client import ClaudeError
from core.config import Settings, get_settings
from core.hubspot.models import HubSpotCompany, HubSpotDeal
from core.memory.embedder import get_embedder
from core.searches.models import SearchLog
from tests.lead_finder.factories import make_lead
from tests.lead_finder.samples import NEWS, WHY_COST, FakeClaude

pytestmark = pytest.mark.integration

TODAY = date(2026, 10, 26)
ACME = ResearchRequest(company="Acme Software", city="Melbourne")


def why_on(**values: object) -> Settings:
    return get_settings().model_copy(update={"why_now_enabled": True, **values})


async def research(
    session: AsyncSession, claude: FakeClaude, settings: Settings | None = None
) -> LeadCard:
    return await research_company(
        session, get_embedder(), claude, load_rules(), settings or why_on(), ACME, TODAY
    )


async def why_rows(session: AsyncSession) -> list[SearchLog]:
    rows = await session.scalars(select(SearchLog).where(SearchLog.step.like("why%")))
    return list(rows)


async def test_a_pass_gets_a_why_now_after_the_judging(session: AsyncSession) -> None:
    claude = FakeClaude()
    card = await research(session, claude)

    assert card.result == "pass"
    why = card.why_now
    assert why is not None and card.why_now_skipped is None
    assert why.reason.startswith("Acme Software's lease ends in March 2028")
    assert why.links == [NEWS]
    assert why.when.text.startswith("Lease ends March 2028 (confirmed).")
    assert why.size.text.startswith("2,500 m² (confirmed: afr.com)")
    assert why.confidence == "high"
    assert why.cost_usd == WHY_COST
    # one short request after the form, with no web search, on the default model
    assert claude.calls[-1] == "why"
    request = claude.requests[-1]
    assert request.web is None
    assert request.model == "claude-opus-5-5"
    # the card is saved with it
    lead = await session.scalar(select(Lead))
    assert lead is not None and lead.card["why_now"]["reason"] == why.reason


async def test_its_cost_is_added_to_the_leads_cost_and_logged(session: AsyncSession) -> None:
    card = await research(session, FakeClaude())
    assert card.why_now is not None

    rows = list(await session.scalars(select(SearchLog).where(SearchLog.job_id == card.id)))
    assert card.research.cost_usd == sum(row.cost_usd for row in rows)
    assert card.research.claude_requests == len(rows)
    why = [row for row in rows if row.step.startswith("why")]
    assert [(row.step, row.cost_usd) for row in why] == [("why", WHY_COST)]
    assert why[0].prompt_version == card.why_now.prompt_version
    lead = await session.scalar(select(Lead))
    assert lead is not None and lead.cost_usd == card.research.cost_usd


async def test_its_own_model_setting_is_used(session: AsyncSession) -> None:
    claude = FakeClaude()
    await research(session, claude, settings=why_on(model_why="claude-sonnet-5-5"))
    assert claude.requests[-1].model == "claude-sonnet-5-5"


async def test_switched_off_there_is_no_request_and_the_card_says_so(
    session: AsyncSession,
) -> None:
    claude = FakeClaude()
    card = await research(session, claude, settings=get_settings())
    assert get_settings().why_now_enabled is False  # off until E2
    assert "why" not in claude.calls
    assert (card.why_now, card.why_now_skipped) == (None, "switched_off")


async def test_a_drop_gets_no_why_now(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="101", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(
        HubSpotDeal(
            hubspot_deal_id="9", hubspot_company_id="101", name="Acme 2,500 m²", stage="Verified"
        )
    )
    await session.commit()
    claude = FakeClaude()
    card = await research(session, claude)
    assert card.result == "drop"
    assert "why" not in claude.calls
    assert (card.why_now, card.why_now_skipped) == (None, "drop")


async def test_a_card_whose_form_failed_gets_no_why_now(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    claude = FakeClaude(extract_error=refused)
    card = await research(session, claude)
    assert card.form_failed
    assert "why" not in claude.calls
    assert card.why_now_skipped in ("no_facts", "drop")


async def test_a_spent_budget_skips_it_with_a_line_in_the_problems(session: AsyncSession) -> None:
    # 3 angles at US$0.12 and a form at US$0.70: US$1.06 of a US$1.00 cap is spent
    claude = FakeClaude(extract_cost=Decimal("0.70"))
    settings = why_on(company_cap_usd=Decimal("1.00"), request_reserve_usd=Decimal("0.10"))
    card = await research(session, claude, settings=settings)
    assert card.result == "pass"
    assert "why" not in claude.calls
    assert (card.why_now, card.why_now_skipped) == (None, "budget")
    assert "Why now: skipped. Spent $1.06 of the $1.00 cap." in card.problems


async def test_a_made_up_year_is_removed(session: AsyncSession) -> None:
    claude = FakeClaude(
        why_answer=WhyNowAnswer(
            reason="Acme Software's lease ends in March 2028. It moved in 2014.",
            likely_next="It will likely sign a new lease in 2031.",
            ask=["Is a move planned for 2027?"],  # 2027 is a fact Claude read: it stays
            links=[NEWS, "https://made-up.example/page"],
        )
    )
    card = await research(session, claude)
    why = card.why_now
    assert why is not None
    assert why.reason == "Acme Software's lease ends in March 2028."
    assert why.likely_next is None
    assert why.ask == ["Is a move planned for 2027?"]
    assert why.links == [NEWS]
    assert any("2014 isn't in the facts" in line for line in why.dropped)
    assert any("2031 isn't in the facts" in line for line in why.dropped)
    assert any("made-up.example" in line for line in why.dropped)


async def test_a_failed_form_is_retried_once_then_the_card_says_so(session: AsyncSession) -> None:
    once = FakeClaude(why_off_form=1)
    card = await research(session, once)
    assert once.calls[-2:] == ["why", "why"]
    assert card.why_now is not None  # the second try fitted the form
    assert len(await why_rows(session)) == 2

    await session.execute(delete(Lead))
    await session.commit()
    twice = FakeClaude(why_off_form=2)
    card = await research(session, twice)
    assert twice.calls.count("why") == 2  # no third try
    assert (card.why_now, card.why_now_skipped) == (None, "failed")
    assert "Why now couldn't be written: the answer didn't fit the form." in card.problems


async def test_a_claude_error_is_a_problem_line_and_the_lead_is_saved(
    session: AsyncSession,
) -> None:
    busy = ClaudeError("Claude is busy", "Try again in a minute.")
    card = await research(session, FakeClaude(why_error=busy))
    assert (card.why_now, card.why_now_skipped) == (None, "failed")
    assert "Why now couldn't be written: Claude is busy. Try again in a minute." in card.problems
    assert await session.scalar(select(Lead)) is not None


async def test_a_recheck_writes_it_again(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(session, FakeClaude(extract_error=refused))
    claude = FakeClaude()
    card = await refill_lead(
        session, get_embedder(), claude, load_rules(), why_on(), failed.id, TODAY
    )
    assert card is not None and card.why_now is not None
    assert claude.calls == ["extract", "why"]
    assert card.research.cost_usd == failed.research.cost_usd + Decimal("0.04") + WHY_COST


# --- C3: Why now for a saved lead -----------------------------------------------------------


async def test_a_saved_lead_gets_a_why_now_from_its_card_and_notes(session: AsyncSession) -> None:
    saved = await research(session, FakeClaude(), settings=get_settings())  # switched off
    assert saved.why_now is None

    claude = FakeClaude()
    card = await why_now_for_lead(session, claude, load_rules(), get_settings(), saved.id, TODAY)
    assert card is not None and card.why_now is not None
    assert claude.calls == ["why"]  # no web search, no form
    assert card.why_now_skipped is None
    assert card.research.cost_usd == saved.research.cost_usd + WHY_COST
    assert card.result == saved.result and card.score == saved.score  # never changes them
    lead = await session.scalar(select(Lead))
    assert lead is not None
    assert lead.card["why_now"]["reason"] == card.why_now.reason
    assert lead.cost_usd == card.research.cost_usd
    rows = await why_rows(session)
    assert [(row.job_id, row.run_id) for row in rows] == [(saved.id, None)]


async def test_a_saved_drop_is_skipped_and_nothing_is_paid(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="101", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(
        HubSpotDeal(
            hubspot_deal_id="9", hubspot_company_id="101", name="Acme 2,500 m²", stage="Verified"
        )
    )
    await session.commit()
    saved = await research(session, FakeClaude(), settings=get_settings())
    assert saved.result == "drop"
    claude = FakeClaude()
    card = await why_now_for_lead(session, claude, load_rules(), get_settings(), saved.id, TODAY)
    assert card is not None and card.why_now is None and card.why_now_skipped == "drop"
    assert claude.calls == []
    assert await why_rows(session) == []


async def test_an_old_card_without_why_now_still_loads(session: AsyncSession) -> None:
    card = await research(session, FakeClaude(), settings=get_settings())
    saved = card.model_dump(mode="json")
    del saved["why_now"], saved["why_now_skipped"]  # a card saved before PLAN-V12
    old = LeadCard.model_validate(saved)
    assert (old.why_now, old.why_now_skipped) == (None, None)


async def test_the_command_shows_each_lead_and_its_cost_then_writes(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    saved = await research(session, FakeClaude(), settings=get_settings())
    dropped = make_lead("Dropped Co", result="drop")
    session.add(dropped)
    await session.commit()
    claude = FakeClaude()
    monkeypatch.setattr(cli, "get_claude", lambda: claude)
    monkeypatch.setattr(cli, "configure_claude", lambda settings: None)

    async def keep_open() -> None:
        return None

    monkeypatch.setattr(cli, "close_claude", keep_open)

    items, unknown = await cli._why_now_leads([saved.id, dropped.id, uuid.uuid4()], None)
    by_name = {item.company: item for item in items}  # oldest first: the made-up lead is older
    assert (by_name["Acme Software"].action, by_name["Dropped Co"].action) == (
        "write",
        "skip: a Drop",
    )
    assert len(unknown) == 1
    assert Decimal("0.02") < by_name["Acme Software"].estimate_usd < Decimal("0.10")
    assert by_name["Dropped Co"].estimate_usd == 0
    assert claude.calls == []  # listing costs nothing

    spent = await cli._write_why_now([by_name["Acme Software"]])
    assert spent == WHY_COST
    assert claude.calls == ["why"]
    shown = capsys.readouterr().out
    assert "Why now (high confidence): Acme Software's lease ends in March 2028" in shown
    assert "  When: Lease ends March 2028 (confirmed)." in shown
