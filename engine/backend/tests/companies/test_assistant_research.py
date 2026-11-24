"""Research in the Assistant (PLAN-V27 T4-1), the parts that need no database: the free shortcut,
the card's words, what happens next, and the run's params.

Made-up names only (Northwind, Sample Logistics).
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from apps.companies.assistant_form import research_shortcut
from apps.companies.assistant_research import (
    NEEDS_LEAD_FINDER,
    card_line,
    cost_of_one,
    dollars,
    hubspot_line,
    may_start,
    next_step,
)
from apps.companies.assistant_schemas import AssistantCardIn, ResearchHubSpot
from apps.lead_finder.company_leads import COMPANY_LEADS, RESEARCH, research_params
from apps.lead_finder.params import CompanyParams, LeadFinderRunParams
from core.company_leads import RecentCard
from core.runs.schemas import RunCreate, RunEstimate

TODAY = date(2026, 11, 24)
CURLY = chr(0x2019)  # a typographic apostrophe, as a phone types it
CARD = AssistantCardIn(action="task", boxes=["subject", "due"])


# --- The free shortcut ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("words", "company"),
    [
        ("Research Northwind", "Northwind"),
        ("research north wind.", "north wind"),
        ("Please research Sample Logistics Pty Ltd", "Sample Logistics Pty Ltd"),
        ("research Northwind, please", "Northwind"),
        (f"Research O{CURLY}Brien & Sons", f"O{CURLY}Brien & Sons"),
        ("Research", ""),  # the card asks for a name
        ("research?", ""),
    ],
)
def test_plain_research_and_a_name_needs_no_claude_request(words: str, company: str) -> None:
    answer = research_shortcut(words, None)
    assert answer is not None
    assert (answer.action, answer.company) == ("research", company)


@pytest.mark.parametrize(
    "words",
    [
        "Can you research Northwind",  # Claude reads it
        "research Northwind then email Lee Sample",
        "Research Northwind and log a call",
        "researching Northwind",
        "research Northwind Sample Logistics Freight Group Holdings Australia Pacific Ltd",  # 9
        "research Northwind: jo@sample.example",
        "Log a call with Jo Sample",
    ],
)
def test_anything_more_than_research_and_a_name_goes_to_claude(words: str) -> None:
    assert research_shortcut(words, None) is None


def test_on_an_open_card_research_is_not_a_shortcut() -> None:
    assert research_shortcut("Research Northwind", CARD) is None


# --- The card's words ----------------------------------------------------------------------------


def test_the_hubspot_line_says_each_status_in_plain_words() -> None:
    worked = date(2026, 10, 12)
    assert hubspot_line("Northwind", "new", None, TODAY) == "Northwind: not in HubSpot."
    assert hubspot_line("Northwind", "in_hubspot", worked, TODAY) == (
        "Northwind is in HubSpot. Last activity 12 Oct."
    )
    assert hubspot_line("Northwind", "in_hubspot", None, TODAY) == "Northwind is in HubSpot."
    assert hubspot_line("Northwind", "open_deal", worked, TODAY) == (
        "Northwind is in HubSpot, with an open deal."
    )
    assert hubspot_line("Northwind", "quiet", date(2025, 3, 2), TODAY) == (
        "Northwind is in HubSpot, quiet since March 2025."
    )
    assert hubspot_line("Northwind", "quiet", None, TODAY) == (
        "Northwind is in HubSpot, never worked."
    )
    assert hubspot_line("Northwind", "dissolved_deal", date(2025, 1, 9), TODAY) == (
        "Northwind is in HubSpot. Last activity 9 Jan 2025."
    )


def recent(tier: str | None, result: str = "pass") -> RecentCard:
    return RecentCard(
        lead_id=uuid.uuid4(),
        company="Northwind",
        found_at=datetime(2026, 11, 20, 2, tzinfo=UTC),
        result=result,
        tier=tier,
        link="/leads/x",
    )


def test_the_lead_line_says_the_tier_or_else_the_result() -> None:
    assert card_line(recent("B"), TODAY) == "Lead Finder, 20 Nov: a B lead."
    assert card_line(recent("A"), TODAY) == "Lead Finder, 20 Nov: an A lead."
    assert card_line(recent("discard", "drop"), TODAY) == "Lead Finder, 20 Nov: discarded."
    assert card_line(recent(None, "director_review"), TODAY) == (
        "Lead Finder, 20 Nov: Director review."
    )


def test_money_rounds_up_to_the_cent() -> None:
    assert dollars(Decimal("0.4")) == "US$0.40"
    assert dollars(Decimal("0.341")) == "US$0.35"


# --- What happens next (choice 18) ---------------------------------------------------------------


def test_a_recent_lead_card_opens_first_then_prep_then_the_question() -> None:
    card = recent("B")
    worked: tuple[ResearchHubSpot, ...] = ("in_hubspot", "open_deal", "dissolved_deal")
    for status in ("new", "quiet", *worked):
        assert next_step(status, card) == "open_lead"
    for status in worked:
        assert next_step(status, None) == "open_prep"
    assert next_step("new", None) == "ask"
    assert next_step("quiet", None) == "ask"


def test_without_the_lead_finder_nobody_can_start_and_the_words_say_why() -> None:
    assert may_start(None, []) is False  # no Lead Finder at all
    assert may_start(None, [COMPANY_LEADS]) is True  # sign-in off: anyone
    assert NEEDS_LEAD_FINDER == (
        "Researching a new company needs the Lead Finder. Ask your Platform admin."
    )


async def test_the_cost_comes_from_the_run_estimate_else_the_plans_figure() -> None:
    seen: list[RunCreate] = []

    async def estimate(body: RunCreate) -> RunEstimate:
        seen.append(body)
        return RunEstimate(valid=True, cost_usd_low=Decimal("0.3712"))

    async def broken(body: RunCreate) -> RunEstimate:
        raise RuntimeError("the run engine is restarting")

    async def nothing(body: RunCreate) -> RunEstimate:
        return RunEstimate(valid=False)

    assert await cost_of_one(estimate, "lead_finder", RESEARCH, "Northwind") == Decimal("0.38")
    assert seen[0].mode == "company"
    assert seen[0].params == {"companies": [{"name": "Northwind"}], "from_assistant": True}
    assert await cost_of_one(broken, "lead_finder", RESEARCH, "Northwind") == Decimal("0.40")
    assert await cost_of_one(nothing, "lead_finder", RESEARCH, "Northwind") == Decimal("0.40")
    assert await cost_of_one(None, "lead_finder", RESEARCH, "Northwind") == Decimal("0.40")


# --- The run's params (T4-2) ---------------------------------------------------------------------


def test_the_assistants_run_is_one_company_marked_from_the_assistant() -> None:
    params = CompanyParams.model_validate(research_params("Northwind", "Perth"))
    assert params.from_assistant is True
    assert [(c.name, c.city) for c in params.companies] == [("Northwind", "Perth")]
    assert CompanyParams.model_validate({"companies": [{"name": "Northwind"}]}).from_assistant is (
        False
    )
    with pytest.raises(ValidationError, match="one company at a time"):
        CompanyParams.model_validate(
            {
                "companies": [{"name": "Northwind"}, {"name": "Sample Logistics"}],
                "from_assistant": True,
            }
        )
    assert LeadFinderRunParams().from_assistant is False
