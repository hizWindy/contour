"""Researching one company, end to end, with a fake Claude. Free, and the same every time.

Integration tests: they need the database.
"""

import dataclasses
import uuid
from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder import research as research_module
from apps.lead_finder.api import claude_dependency
from apps.lead_finder.context import CreditMeter, ResearchContext, Signal
from apps.lead_finder.fields import DecisionMaker
from apps.lead_finder.rejudge import save_rejudged
from apps.lead_finder.research import LeadCard, ResearchRequest, refill_lead, research_company
from apps.lead_finder.rules import MAX_DAMPENER_SEARCHES, LeadFinderRules, load_rules
from apps.lead_finder.scoring import judge
from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.claude.client import ClaudeError, ClaudeRefused
from core.config import Settings, get_settings
from core.db.engine import get_session
from core.hubspot.matching import HubSpotMatch
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.embedder import get_embedder
from core.memory.models import MemoryItem
from core.searches.models import SearchLog
from core.signalhire.client import (
    CompanyInfo,
    CompanyRef,
    Office,
    SignalHire,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireOutOfQuota,
)
from tests.lead_finder.conftest import lf_settings
from tests.lead_finder.samples import (
    ACME_INFO,
    ACME_SOFTWARE,
    ASX,
    CULTURE_AMP,
    SITE,
    FakeClaude,
    FakeSignalHire,
    fact,
    found_dampener,
    make_facts,
    rules_with_signalhire,
    rules_without_signalhire,
    with_dampeners,
)

pytestmark = pytest.mark.integration

TODAY = date(2026, 10, 26)
ACME = ResearchRequest(company="Acme Software", city="Melbourne")


async def research(
    session: AsyncSession,
    claude: FakeClaude,
    request: ResearchRequest = ACME,
    settings: Settings | None = None,
    *,
    rules: LeadFinderRules | None = None,
    context: ResearchContext | None = None,
    signalhire: SignalHire | None = None,
) -> LeadCard:
    return await research_company(
        session,
        get_embedder(),
        claude,
        rules or load_rules(),
        settings or get_settings(),
        request,
        TODAY,
        context,
        signalhire,
    )


async def count(session: AsyncSession, model: type, **where: object) -> int:
    statement = select(func.count()).select_from(model)
    for name, value in where.items():
        statement = statement.where(getattr(model, name) == value)
    return await session.scalar(statement) or 0


async def test_research_searches_four_angles_and_saves_everything(session: AsyncSession) -> None:
    """Three angles, and the dampener check on top of them (PLAN-V16 T1-5)."""
    claude = FakeClaude()
    card = await research(session, claude)

    assert sorted(claude.calls) == [
        "extract",
        "extract:extras",  # the answer form is asked in two requests (PLAN-V20)
        "search:dampeners",
        "search:money",
        "search:people",
        "search:property",
    ]
    assert card.result == "pass"
    # see test_scoring: a good lead with nothing found for sector or rivals, and half the warm path
    assert card.score == 74
    assert (card.score_before_dampeners, card.tier, card.confidence) == (74, "B", "high")
    assert card.confidence_why.startswith("High:")  # type: ignore[union-attr]
    assert (card.score_checked, card.band) == (None, None)  # the six-part score's fields
    assert [part.id for part in card.score_parts] == ["fit", "change", "access"]
    # 4 searches x $0.12 + $0.04 + $0.01. The dampener check adds one search request, $0.12 here (it
    # was $0.40 with three angles): the extra cost PLAN-V16 T1-5 asked to be measured on the fake.
    # The second answer form (PLAN-V20) adds one short request, $0.01 here.
    assert card.research.cost_usd == Decimal("0.530000")
    assert card.research.web_searches == 8
    assert card.hubspot.status == "new"
    assert card.dropped == []
    assert await count(session, SearchLog, job_id=card.id) == 6
    assert await count(session, Lead) == 1
    lead = await session.scalar(select(Lead))
    assert lead is not None and (lead.tier, lead.confidence) == ("B", "high")  # the columns
    assert await count(session, MemoryItem, kind="source_note") == 5
    assert await count(session, MemoryItem, kind="company_profile") == 1


async def test_saving_a_rejudge_fills_in_the_tier_and_the_confidence_of_a_saved_lead(
    session: AsyncSession,
) -> None:
    """`lead-finder rejudge --save` (PLAN-V16 T1-6): a lead made before the tiers is judged again
    from its card, and its row and its card get the new verdict."""
    card = await research(session, FakeClaude())
    lead = await session.get(Lead, card.id)
    assert lead is not None
    lead.tier, lead.confidence, lead.score, lead.rules_version = None, None, 51, "old"
    lead.card = {**lead.card, "tier": None, "confidence": None, "score": 51, "band": "investigate"}
    note, status = "Call on Monday", "watching"
    lead.note, lead.status = note, status  # a person's work stays
    await session.commit()

    done = await save_rejudged(session, load_rules(), TODAY)

    assert [(item.company, item.now.tier) for item in done] == [("Acme Software", "B")]
    session.expire_all()
    saved = await session.get(Lead, card.id)
    assert saved is not None
    assert (saved.tier, saved.confidence, saved.score, saved.result) == ("B", "high", 74, "pass")
    assert saved.rules_version == load_rules().version
    assert (saved.note, saved.status) == (note, status)
    assert saved.card["tier"] == "B" and saved.card["score_before_dampeners"] == 74
    assert saved.card["band"] is None and saved.card["rules_version"] == load_rules().version


async def test_a_test_set_lead_is_left_alone_by_a_saved_rejudge(session: AsyncSession) -> None:
    card = await research(session, FakeClaude())
    lead = await session.get(Lead, card.id)
    assert lead is not None
    lead.is_test, lead.tier = True, None
    await session.commit()
    assert await save_rejudged(session, load_rules(), TODAY) == []
    session.expire_all()
    assert (await session.get(Lead, card.id)).tier is None  # type: ignore[union-attr]


async def test_the_dampener_check_has_its_own_three_searches_and_its_own_prompt(
    session: AsyncSession,
) -> None:
    claude = FakeClaude()
    await research(session, claude)
    dampeners = next(r for r in claude.requests if r.step == "search:dampeners")
    assert dampeners.web is not None and dampeners.web.max_searches == 3  # Levi: up to 3
    assert "Angle: dampeners. Find facts about anything that makes a new office project" in (
        dampeners.prompt
    )
    assert "- Acme Software office fitout Melbourne" in dampeners.prompt  # the rules' searches
    assert "JLL OR CBRE OR Colliers" in dampeners.prompt
    form = next(r for r in claude.requests if r.step == "extract")
    assert '"angle": "dampeners"' in form.prompt  # its notes reach the answer form
    assert "- recent_fitout: A note says the company moved into a new office" in form.system
    assert 'Never write "none" or "no".' in form.system


async def test_the_card_lists_every_dampener_and_what_the_answer_found(
    session: AsyncSession,
) -> None:
    answers = with_dampeners(
        found_dampener("outsourcing", "JLL names it as a client.", date="2025-02", url=ASX)
    )
    card = await research(session, FakeClaude(facts=make_facts(dampeners=answers)))

    assert {item.id: item.state for item in card.dampeners} == {
        "recent_fitout": "not_found",
        "outsourcing": "found",
        "competitor_tie": "not_found",
        "procurement": "not_found",
        "financial_stress": "not_found",
    }
    outsourcing = card.dampeners[1]
    assert (outsourcing.strength, outsourcing.evidence, outsourcing.url) == (
        "strong",
        "JLL names it as a client.",
        ASX,
    )
    # No rule fails and nothing is excluded, but it costs points: 72 - 10 (the lock-in check) - 20
    assert (card.score, card.tier, card.result) == (44, "C", "watch")
    saved = await session.scalar(select(Lead.card).where(Lead.id == card.id))
    assert saved is not None
    assert [(item["id"], item["state"]) for item in saved["dampeners"]][:2] == [
        ("recent_fitout", "not_found"),
        ("outsourcing", "found"),
    ]


async def test_an_answer_with_no_page_behind_it_is_not_checked_and_says_so(
    session: AsyncSession,
) -> None:
    claim = found_dampener("outsourcing", "A claim.", url="https://invented.example.com/page")
    card = await research(session, FakeClaude(facts=make_facts(dampeners=[claim])))

    assert [item.state for item in card.dampeners][:2] == ["not_checked", "not_checked"]
    assert (
        "dampener outsourcing: link not among the pages read (https://invented.example.com/page). "
        "Marked not checked."
    ) in card.dropped


async def test_each_angle_asks_the_source_groups_levi_names(session: AsyncSession) -> None:
    """His section 7 (PLAN-V16 T1-7): the sites are in the searches the angles start with."""
    claude = FakeClaude()
    await research(session, claude)
    prompts = {r.step: r.prompt for r in claude.requests if r.step.startswith("search:")}
    assert (
        "- Acme Software ACCC acquisitions register notified acquisition" in prompts["search:money"]
    )
    assert "- Acme Software Melbourne lease The Urban Developer" in prompts["search:property"]
    assert "- Acme Software office fitout ArchitectureAU" in prompts["search:property"]
    assert "- Acme Software jobs SEEK Melbourne" in prompts["search:people"]
    assert "- Acme Software annual report 2026" in prompts["search:people"]
    assert "- Acme Software AusTender or state tender portal fitout" in prompts["search:dampeners"]
    assert "- Acme Software Office Snapshots new office" in prompts["search:dampeners"]
    assert (
        "- Acme Software JLL CBRE Cushman and Wakefield Colliers client case study"
        in (prompts["search:dampeners"])
    )


async def test_a_tenure_research_asks_the_office_questions_in_place_of_property(
    session: AsyncSession,
) -> None:
    """PLAN-V11 C2: same cost as a growth research. No move-in date found is a gap to search."""
    claude = FakeClaude()  # the Acme sample has no move-in date
    await research(session, claude, context=ResearchContext(focus="tenure"))
    searches = sorted(call for call in claude.calls if call.startswith("search:"))
    assert searches == [
        "search:dampeners",
        "search:gaps",
        "search:money",
        "search:people",
        "search:tenure",
    ]
    tenure = next(r for r in claude.requests if r.step == "search:tenure")
    assert "Angle: tenure. Find facts about its office in that city" in tenure.prompt
    assert "- Acme Software Melbourne office address" in tenure.prompt
    assert "- how long has Acme Software been at its Melbourne office address" in tenure.prompt
    assert "- Acme Software contact page Melbourne address Wayback Machine" in tenure.prompt
    gaps = next(r for r in claude.requests if r.step == "search:gaps")
    assert "when it moved into its current office in that city" in gaps.prompt


async def test_a_growth_research_keeps_the_property_angle(session: AsyncSession) -> None:
    claude = FakeClaude()
    await research(session, claude, context=ResearchContext(focus="growth"))
    assert "search:property" in claude.calls and "search:tenure" not in claude.calls


async def test_a_company_that_just_moved_is_a_watch_and_says_why(session: AsyncSession) -> None:
    """PLAN-V11 B3: it moved in 4 months ago, so it has probably just set up its office."""
    card = await research(session, FakeClaude(facts=make_facts(office_since=fact("2026-06"))))
    assert card.result == "watch"
    assert card.why_it_fits.endswith(
        "Result: Watch. Because: Moved in June 2026, so probably not in the market yet; "
        "Tier C, a score of 54 (from 40 to 54): watch for a new sign."
    )


async def test_researching_again_uses_memory_and_costs_less(session: AsyncSession) -> None:
    first = await research(session, FakeClaude())
    claude = FakeClaude()
    second = await research(session, claude, ACME.model_copy(update={"company": "acme software"}))

    assert claude.calls == ["extract", "extract:extras"]
    assert second.research.angles_from_memory == ["dampeners", "money", "people", "property"]
    assert second.research.cost_usd < first.research.cost_usd
    assert second.result == first.result
    assert await count(session, MemoryItem, kind="source_note") == 5  # no duplicates


async def test_use_memory_false_searches_again(session: AsyncSession) -> None:
    await research(session, FakeClaude())
    claude = FakeClaude()
    await research(session, claude, ACME.model_copy(update={"use_memory": False}))
    assert len(claude.calls) == 6  # four angles and the two answer forms


async def test_the_gap_check_runs_one_more_search_then_stops(session: AsyncSession) -> None:
    claude = FakeClaude(facts=make_facts(office_m2=fact(None), staff_in_city=fact(None)))
    card = await research(session, claude)
    assert claude.calls.count("search:gaps") == 1
    assert claude.calls.count("extract") == 2
    assert claude.calls.count("extract:extras") == 2  # both forms are asked again with the notes
    assert card.result == "watch"  # still no size, so a person checks it


async def test_notes_citing_pages_never_read_are_thrown_away(session: AsyncSession) -> None:
    claude = FakeClaude(invented_url=True)
    card = await research(session, claude)
    assert "extract" not in claude.calls  # no notes left, so nothing to fill in
    assert card.facts.city.value is None
    assert card.result == "watch"
    assert await count(session, MemoryItem) == 0


async def test_hubspot_staff_fills_a_gap_the_research_left(session: AsyncSession) -> None:
    link = "https://app.hubspot.com/contacts/1/company/102"
    session.add(
        HubSpotCompany(
            hubspot_id="102", name="Acme Software Pty Ltd", hubspot_url=link, source="export"
        )
    )
    await session.flush()
    session.add(
        HubSpotOffice(
            hubspot_company_id="102",
            label="Melbourne",
            linkedin_staff=60,
            last_moved=date(2016, 3, 1),
        )
    )
    await session.commit()  # research ends its transaction first, so uncommitted rows would go

    claude = FakeClaude(facts=make_facts(office_m2=fact(None), staff_in_city=fact(None)))
    card = await research(session, claude)

    assert card.hubspot.status == "in_hubspot"
    assert card.facts.staff_in_city.value == 60
    assert card.facts.staff_in_city.source_url == link
    assert card.from_hubspot == [
        "Staff in Melbourne: 60 on LinkedIn, from HubSpot. The real number is about double.",
        "Moved in March 2016, from HubSpot.",
    ]
    assert card.office_m2 == 1200  # 60 on LinkedIn is about 120 staff, at 10 m² each
    assert card.result == "pass"
    assert card.facts.office_since.value == "2016-03-01"
    assert sorted((e.fact, e.used) for e in card.fact_sources) == [
        ("office_since", "hubspot"),
        ("staff_in_city", "hubspot"),
    ]


# --- Signal Hire next to the research and HubSpot (PLAN-V3 C3, PLAN-V4 C1 to C3) ---------------

NO_STAFF = make_facts(office_m2=fact(None), staff_in_city=fact(None))
SIGNALHIRE_RULES = rules_with_signalhire(load_rules())  # Signal Hire on, the name check required
SIGNALHIRE_NOTE = "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC)."


def acme_on_signalhire(**failures: SignalHireError) -> FakeSignalHire:
    """A Signal Hire that knows Acme Software and has 105 people on file in Melbourne."""
    return FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=105, failures=dict(failures))


def sources_of(card: LeadCard) -> list[tuple[str, str]]:
    return [(entry.fact, entry.used) for entry in card.fact_sources]


async def test_signalhire_gives_the_staff_number_when_nobody_else_found_one(
    session: AsyncSession,
) -> None:
    fake = acme_on_signalhire()
    card = await research(
        session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES, signalhire=fake
    )

    staff = card.facts.staff_in_city
    assert (staff.value, staff.label, staff.source_url) == (210, "estimated", None)
    assert card.facts.staff_from_linkedin is False  # the number is already multiplied
    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    assert card.from_hubspot == [] and card.problems == []
    assert card.office_m2 == 2100  # 210 staff at 10 m² each: the size rule reads it as it is
    assert card.result == "pass"
    assert fake.calls == [
        "find:acme-software",  # who the company is: asked once, for every step
        "info:7",  # its details: 1 company credit
        "people:Acme Software|Melbourne, Australia|",  # the staff count
        "leaders:Acme Software|Melbourne, Australia|5",  # the senior people
    ]
    assert [(p.name, p.title) for p in card.signalhire_people] == [
        ("Pat Example", "Chief Financial Officer"),
        ("Sam Sample", "Head of Workplace"),
    ]
    assert card.signalhire_company is not None and card.signalhire_company.name == "Acme Software"
    assert card.facts.industry.value == "Software Development"  # Signal Hire is main for it
    assert sources_of(card) == [
        ("industry", "signalhire"),
        ("staff_in_city", "signalhire"),
        ("decision_makers", "signalhire"),
    ]
    # The saved lead keeps the number and the note, so the website and the list can show them.
    lead = await session.scalar(select(Lead))
    assert lead is not None and lead.staff_in_city == 210
    assert lead.card["from_signalhire"] == [SIGNALHIRE_NOTE]
    assert lead.industry == "Software Development"


async def test_the_details_reach_claude_as_hints_and_not_as_instructions(
    session: AsyncSession,
) -> None:
    claude = FakeClaude()
    await research(session, claude, rules=SIGNALHIRE_RULES, signalhire=acme_on_signalhire())

    prompts = [call.prompt for call in claude.requests]
    assert len(prompts) == 6  # four angles and the two answer forms
    for prompt in prompts:
        assert "Signal Hire's record of this company (data from a database" in prompt
        assert '- Checked name: "Acme Software"' in prompt
        assert '- Offices: "Melbourne (head office), Sydney"' in prompt


async def test_a_second_research_of_the_company_does_not_pay_for_the_details_again(
    session: AsyncSession,
) -> None:
    first, second = acme_on_signalhire(), acme_on_signalhire()
    await research(session, FakeClaude(), rules=SIGNALHIRE_RULES, signalhire=first)
    card = await research(session, FakeClaude(), rules=SIGNALHIRE_RULES, signalhire=second)

    assert "info:7" in first.calls
    assert "info:7" not in second.calls and "find:acme-software" not in second.calls
    assert card.signalhire_company is not None and card.signalhire_company.name == "Acme Software"


async def test_the_credits_of_a_run_are_shared_by_its_companies(session: AsyncSession) -> None:
    meter = CreditMeter(1)
    context = ResearchContext(signalhire_credits=meter)
    fake = FakeSignalHire([ACME_SOFTWARE, CULTURE_AMP], info=ACME_INFO, people=105)

    one = await research(
        session, FakeClaude(), rules=SIGNALHIRE_RULES, context=context, signalhire=fake
    )
    other = ACME.model_copy(update={"company": "Culture Amp"})
    two = await research(
        session, FakeClaude(), other, rules=SIGNALHIRE_RULES, context=context, signalhire=fake
    )

    assert one.signalhire_company is not None and two.signalhire_company is None
    assert meter.used == 1
    assert sum(call.startswith("info:") for call in fake.calls) == 1  # one credit, one paid call
    assert two.problems[0] == (
        "Signal Hire company details: this run has used its 1 company credits, "
        "so these details were not read."
    )
    assert await count(session, Lead) == 2  # the second company is researched all the same


async def test_a_staff_number_from_the_research_gives_way_to_signal_hire_and_is_kept(
    session: AsyncSession,
) -> None:
    fake = acme_on_signalhire()
    card = await research(session, FakeClaude(), rules=SIGNALHIRE_RULES, signalhire=fake)

    assert card.facts.staff_in_city.value == 210  # the research found 250: the main source wins
    entry = next(e for e in card.fact_sources if e.fact == "staff_in_city")
    assert entry.used == "signalhire"
    assert [(o.source, o.value) for o in entry.others] == [("claude", "250")]
    assert entry.conflict is None  # 250 and 210 are not far apart
    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    assert any(call.startswith("people:") for call in fake.calls)  # it was asked all the same


async def test_numbers_far_apart_are_both_on_the_card_with_a_flag(session: AsyncSession) -> None:
    fake = FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=285)  # about 570
    card = await research(session, FakeClaude(), rules=SIGNALHIRE_RULES, signalhire=fake)

    assert card.facts.staff_in_city.value == 570
    entry = next(e for e in card.fact_sources if e.fact == "staff_in_city")
    assert [(o.source, o.value) for o in entry.others] == [("claude", "250")]
    assert entry.conflict == (
        "The staff numbers are more than 2 times apart: Signal Hire about 570, Claude about 250. "
        "Check which is right."
    )


async def test_signalhire_stays_off_while_headcount_tool_is_not_listed(
    session: AsyncSession,
) -> None:
    fake = acme_on_signalhire()
    rules = rules_without_signalhire(load_rules())
    card = await research(session, FakeClaude(facts=NO_STAFF), rules=rules, signalhire=fake)

    assert fake.calls == []
    assert card.from_signalhire == [] and card.facts.staff_in_city.value is None
    assert card.signalhire_company is None and card.fact_sources == []


async def test_with_the_rules_as_shipped_and_the_company_api_off_the_typed_name_is_counted(
    session: AsyncSession,
) -> None:
    """What a Run does today: criteria.yaml lists headcount_tool and uses the name as typed, because
    Signal Hire's Company API is off for our account. The card says the name was not checked."""
    off = SignalHireCompanyApiOff("Signal Hire said no", "The Company API is off.")
    fake = FakeSignalHire([ACME_SOFTWARE], people=105, failures={"find": off})

    card = await research(session, FakeClaude(facts=NO_STAFF), signalhire=fake)  # the real rules

    assert card.facts.staff_in_city.value == 210
    assert card.from_signalhire == [
        "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC). "
        "The company name was not checked, so the count may include other companies "
        "with a like name.",
        "Senior people: the company name was not checked, so some may work for another "
        "company with a like name.",
    ]
    assert card.problems == []  # a standing condition, not a problem
    assert "people:Acme Software|Melbourne, Australia|" in fake.calls
    assert fake.calls.count("find:acme-software") == 1  # looked up once, not once for each step
    assert not any(call.startswith("info:") for call in fake.calls)  # no details, so no credit
    assert card.signalhire_company is None
    assert len(card.signalhire_people) == 2


async def test_hubspot_wins_the_staff_number_and_signal_hires_is_kept(
    session: AsyncSession,
) -> None:
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=60))
    await session.commit()

    fake = acme_on_signalhire()
    card = await research(
        session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES, signalhire=fake
    )

    assert card.facts.staff_in_city.value == 60  # HubSpot comes first in size.staff_sources
    assert (
        card.from_hubspot and card.from_signalhire == []
    )  # Signal Hire's note is for a number used
    entry = next(e for e in card.fact_sources if e.fact == "staff_in_city")
    assert entry.used == "hubspot"
    assert [(o.source, o.value) for o in entry.others] == [
        ("signalhire", "about 210 (105 people on file x 2)")
    ]
    assert any(call.startswith("people:") for call in fake.calls)  # it was asked, to compare


async def test_an_office_list_with_no_office_in_the_leads_city_is_a_flag(
    session: AsyncSession,
) -> None:
    sydney = (Office("Sydney", "New South Wales", "Australia", True),)
    fake = FakeSignalHire(
        [ACME_SOFTWARE], info=dataclasses.replace(ACME_INFO, offices=sydney), people=105
    )
    card = await research(session, FakeClaude(), rules=SIGNALHIRE_RULES, signalhire=fake)

    entry = next(e for e in card.fact_sources if e.fact == "city")
    assert entry.used == "claude"
    assert entry.conflict == (
        "Signal Hire lists no office in Melbourne. It lists Sydney (head office). Check the city."
    )


async def test_a_signalhire_error_is_a_line_in_the_problems_and_the_lead_is_saved(
    session: AsyncSession,
) -> None:
    quota = SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily.")
    fake = acme_on_signalhire(people=quota)
    card = await research(
        session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES, signalhire=fake
    )

    assert card.facts.staff_in_city.value is None and card.from_signalhire == []
    assert card.problems == [
        "Signal Hire staff count: Signal Hire has no credits or quota left. Resets daily."
    ]
    assert card.result == "watch"  # no size, so a person checks it, as without Signal Hire
    assert await count(session, Lead) == 1


async def test_a_watchlist_company_goes_to_signalhire_only_with_its_own_switch(
    session: AsyncSession,
) -> None:
    from_hubspot = ResearchContext(origin="hubspot")
    fake = acme_on_signalhire()

    off = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        settings=lf_settings(),  # no .env, so the switch is at its default: off
        rules=SIGNALHIRE_RULES,
        context=from_hubspot,
        signalhire=fake,
    )
    assert fake.calls == [] and off.from_signalhire == [] and off.signalhire_company is None

    claude_only = lf_settings(hubspot_names_to_claude_ok=True)
    still_off = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        settings=claude_only,
        rules=SIGNALHIRE_RULES,
        context=from_hubspot,
        signalhire=fake,
    )
    assert fake.calls == [] and still_off.from_signalhire == []  # Claude's OK is not this OK

    approved = lf_settings(hubspot_names_to_signalhire_ok=True)
    on = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        settings=approved,
        rules=SIGNALHIRE_RULES,
        context=from_hubspot,
        signalhire=fake,
    )
    assert on.from_signalhire == [SIGNALHIRE_NOTE]


async def test_no_database_connection_is_held_while_signalhire_answers(
    session: AsyncSession,
) -> None:
    seen: list[bool] = []

    class Watching(FakeSignalHire):
        async def find_company(self, id_or_slug: str) -> CompanyRef | None:
            seen.append(session.in_transaction())
            return await super().find_company(id_or_slug)

        async def company_info(self, company_id: int) -> CompanyInfo | None:
            seen.append(session.in_transaction())
            return await super().company_info(company_id)

        async def count_people(
            self, *, company: str, location: str | None = None, titles: str | None = None
        ) -> int:
            seen.append(session.in_transaction())
            return await super().count_people(company=company, location=location, titles=titles)

    card = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        rules=SIGNALHIRE_RULES,
        signalhire=Watching([ACME_SOFTWARE], info=ACME_INFO, people=105),
    )

    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    assert len(seen) == 3 and not any(seen)  # the transaction had ended before each call


class Owned(FakeSignalHire):
    """A client the research made itself, so the research must close it."""

    closes = 0

    async def aclose(self) -> None:
        self.closes += 1


async def test_a_client_made_from_the_settings_is_used_and_closed(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owned = Owned([ACME_SOFTWARE], info=ACME_INFO, people=105)
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: owned)

    card = await research(session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES)

    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    # one client for the details, and one for the staff count and the people. Signal Hire is read
    # before the search only to check HubSpot's own count under the floor (PLAN-V21 T1-7).
    assert owned.closes == 2


async def test_a_client_made_from_the_settings_is_closed_even_when_it_fails(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    quota = SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily.")
    owned = Owned([ACME_SOFTWARE], info=ACME_INFO, people=105, failures={"people": quota})
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: owned)

    card = await research(session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES)

    assert card.problems and card.from_signalhire == []
    assert owned.closes == 2  # the details, then the staff count and the people (PLAN-V21 T1-7)


async def test_without_a_key_there_is_no_client_and_nothing_happens(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: None)

    card = await research(session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES)

    assert card.from_signalhire == [] and card.problems == []
    assert card.facts.staff_in_city.value is None
    assert card.signalhire_company is None and card.fact_sources == []


async def test_a_refill_uses_the_saved_details_and_never_pays_for_new_ones(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(
        session,
        FakeClaude(extract_error=refused),
        rules=SIGNALHIRE_RULES,
        signalhire=acme_on_signalhire(),  # the details were read, and saved, by the first try
    )
    assert failed.signalhire_company is not None

    owned = Owned([ACME_SOFTWARE], info=ACME_INFO, people=105)
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: owned)
    card = await refill_lead(
        session, get_embedder(), FakeClaude(), SIGNALHIRE_RULES, get_settings(), failed.id, TODAY
    )

    assert card is not None and card.signalhire_company is not None
    assert not any(call.startswith(("info:", "find:")) for call in owned.calls)  # nothing paid
    assert any(call.startswith("people:") for call in owned.calls)  # a search is still free


async def test_a_refill_with_no_saved_details_does_not_read_new_ones(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(session, FakeClaude(extract_error=refused))  # no Signal Hire then

    owned = Owned([ACME_SOFTWARE], info=ACME_INFO, people=105)
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: owned)
    card = await refill_lead(
        session, get_embedder(), FakeClaude(), SIGNALHIRE_RULES, get_settings(), failed.id, TODAY
    )

    assert card is not None and card.signalhire_company is None
    assert not any(call.startswith("info:") for call in owned.calls)  # no credit was spent


async def test_an_old_card_without_the_signalhire_list_still_loads(session: AsyncSession) -> None:
    card = await research(session, FakeClaude())
    saved = card.model_dump(mode="json")
    for name in ("from_signalhire", "signalhire_company", "fact_sources"):
        del saved[name]  # a card saved before these existed

    old = LeadCard.model_validate(saved)
    assert (old.from_signalhire, old.signalhire_company, old.fact_sources) == ([], None, [])


async def test_an_open_deal_in_hubspot_is_dropped(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="101", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(
        HubSpotDeal(
            hubspot_deal_id="9", hubspot_company_id="101", name="Acme 2,500 m²", stage="Verified"
        )
    )
    await session.commit()
    card = await research(session, FakeClaude())
    assert card.hubspot.status == "open_deal"
    assert card.hubspot.matched_by == "name"
    assert card.result == "drop"


async def test_the_search_cap_stops_research_cleanly(session: AsyncSession) -> None:
    """The cap is the setting plus the dampener check's own 3 searches (PLAN-V16 T1-5)."""
    settings = get_settings().model_copy(update={"company_max_searches": 1})
    claude = FakeClaude()
    card = await research(session, claude, settings=settings)
    assert card.research.web_searches <= 1 + MAX_DAMPENER_SEARCHES
    assert any("skipped" in problem for problem in card.problems)


@pytest.fixture
async def client(session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = test_session
    app.dependency_overrides[claude_dependency] = lambda: FakeClaude()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def test_the_research_endpoint_returns_a_card_and_lists_it(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/lead-finder/research", json={"company": "Acme Software"})
    assert response.status_code == 200, response.text
    card = response.json()
    assert card["result"] == "pass"

    listed = (await client.get("/api/v1/lead-finder/leads", params={"result": "pass"})).json()
    assert listed["total"] == 1
    one = await client.get(f"/api/v1/lead-finder/leads/{card['id']}")
    assert one.json()["facts"]["office_m2"]["value"] == 2500
    log = (await client.get("/api/v1/searches", params={"job_id": card["id"]})).json()
    assert log["total"] == 6

    missing = await client.get("/api/v1/lead-finder/leads/00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404


async def test_decision_makers_from_pages_read_reach_the_saved_card(session: AsyncSession) -> None:
    people = [
        DecisionMaker(
            name="Jane Citizen", role="Chief Financial Officer", source_url=SITE, source_date=None
        ),
        DecisionMaker(
            name="Sam Example",
            role="Head of Property",
            source_url="https://www.linkedin.com/in/sam-example",
            source_date=None,
        ),
    ]
    card = await research(session, FakeClaude(facts=make_facts(decision_makers=people)))

    assert [(p.name, p.role, p.source_url) for p in card.facts.decision_makers] == [
        ("Jane Citizen", "Chief Financial Officer", SITE)
    ]
    assert [item for item in card.dropped if item.startswith("a decision maker")] == [
        "a decision maker: link not among the pages read "
        "(https://www.linkedin.com/in/sam-example). Removed."
    ]
    saved = await session.scalar(select(Lead.card).where(Lead.id == card.id))
    assert saved is not None
    assert [p["name"] for p in saved["facts"]["decision_makers"]] == ["Jane Citizen"]
    # The names stay on the card: the search costs and the search log don't change.
    assert card.research.cost_usd == Decimal("0.530000")  # 0.52 and the second form's 0.01
    assert await count(session, SearchLog, job_id=card.id) == 6


# --- A failed answer form is shown, not hidden (PLAN-V4 B4) --------------------------------------


async def test_a_failed_form_marks_the_card_and_says_the_facts_are_missing(
    session: AsyncSession,
) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    card = await research(session, FakeClaude(extract_error=refused))

    assert card.form_failed
    assert card.notes  # the search found notes: only the form failed
    assert card.summary == research_module.FORM_FAILED_SUMMARY
    assert card.facts.city.value is None
    assert "The form couldn't be filled. Every fact is unknown." in card.problems
    lead = await session.scalar(select(Lead))
    assert lead is not None and lead.card["form_failed"] is True


async def test_a_filled_form_is_not_marked(session: AsyncSession) -> None:
    card = await research(session, FakeClaude())
    assert not card.form_failed


# --- The answer form is asked in two requests (PLAN-V20) ----------------------------------------


async def test_the_second_form_failing_keeps_the_facts_of_the_first(
    session: AsyncSession,
) -> None:
    """Only the dampener checks and four more facts are unknown. The card is not a failed form."""
    busy = ClaudeError("Claude is busy right now", "Try again in a minute.")
    claude = FakeClaude(extras_error=busy)
    card = await research(session, claude)

    assert not card.form_failed
    assert card.facts.city.value == "Melbourne"
    assert card.summary != research_module.FORM_FAILED_SUMMARY
    assert card.facts.dampeners == [] and card.facts.contact_roles == []
    assert "Filling the dampener checks: Claude is busy right now. Try again in a minute." in (
        card.problems
    )
    assert (
        "The dampener checks and four more facts couldn't be filled, so they are unknown."
        in card.problems
    )
    assert "The form couldn't be filled. Every fact is unknown." not in card.problems
    assert card.research.claude_requests == 4 + 1  # four angles and the first form


async def test_the_first_form_failing_leaves_every_fact_unknown_even_if_the_second_answered(
    session: AsyncSession,
) -> None:
    refused = ClaudeError("Claude returned an error (500)", "Something broke.")
    card = await research(session, FakeClaude(extract_error=refused))

    assert card.form_failed
    assert card.facts.dampeners == [] and card.facts.contact_roles == []
    assert "Filling the form: Claude returned an error (500). Something broke." in card.problems
    # The second form's answers were paid for and are in the log, so the money adds up: four
    # angles, then the second form, the gap search, and the second form again.
    assert card.research.claude_requests == 4 + 1 + 1 + 1


async def test_a_refusal_of_the_form_stops_the_research_and_keeps_what_was_paid_for(
    session: AsyncSession,
) -> None:
    """16 Nov 2026: a 400 means every company will fail the same way. The research stops, the run
    above it stops (it is `ClaudeUnavailable`), and the searches already paid for are logged and
    their notes kept, so a resume after the fix doesn't pay for them again."""
    refused = ClaudeRefused("Claude refused the request", "Something we send is not accepted.")
    with pytest.raises(ClaudeRefused):
        await research(session, FakeClaude(extract_error=refused))

    assert await count(session, SearchLog) == 5  # four angles and the second form
    assert await count(session, MemoryItem, kind="source_note") > 0
    assert await count(session, Lead) == 0  # nothing was saved as a lead


# --- Refilling a lead whose form failed (PLAN-V4 B5) ---------------------------------------------


async def test_a_failed_lead_is_filled_again_from_its_saved_notes(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(session, FakeClaude(extract_error=refused))
    assert failed.form_failed

    claude = FakeClaude()
    card = await refill_lead(
        session, get_embedder(), claude, load_rules(), get_settings(), failed.id, TODAY
    )

    assert card is not None and not card.form_failed
    assert claude.calls == ["extract", "extract:extras"]  # the saved notes, and no new web search
    assert card.id == failed.id
    assert (card.facts.city.value, card.result) == ("Melbourne", "pass")
    assert card.problems == []  # the old "form couldn't be filled" line is gone
    assert card.created_at == failed.created_at
    assert card.research.claude_requests == failed.research.claude_requests + 2
    assert card.research.web_searches == failed.research.web_searches
    lead = await session.scalar(select(Lead))
    assert lead is not None and (lead.result, lead.card["form_failed"]) == ("pass", False)
    assert await count(session, Lead) == 1
    assert await count(session, MemoryItem, kind="company_profile") == 1  # replaced, not added


async def test_refilling_needs_fresh_notes_and_a_lead(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(session, FakeClaude(extract_error=refused))
    await session.execute(delete(MemoryItem).where(MemoryItem.kind == "source_note"))
    await session.commit()

    claude = FakeClaude()
    rules, settings = load_rules(), get_settings()
    assert await refill_lead(session, get_embedder(), claude, rules, settings, failed.id) is None
    assert await refill_lead(session, get_embedder(), claude, rules, settings, uuid.uuid4()) is None
    assert claude.calls == []  # nothing was paid for


# --- Too small to research (PLAN-V9 B2) -----------------------------------------------------------


async def test_signal_hire_alone_never_stops_a_company_before_research(
    session: AsyncSession,
) -> None:
    """PLAN-V21 T1-7: Signal Hire's 48 is a guess (24 on file x 2), so the company is researched,
    and the count still goes on the card. Agon Environmental was dropped on it alone (18 Nov)."""
    fake = FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=24)
    claude = FakeClaude(facts=NO_STAFF)

    card = await research(session, claude, rules=SIGNALHIRE_RULES, signalhire=fake)

    assert claude.calls  # researched as usual
    assert not card.summary.startswith("Too small")
    assert card.facts.staff_in_city.value == 48  # Signal Hire's count, on the card
    assert any("48" in note for note in card.from_signalhire)
    assert sum(call.startswith("people:") for call in fake.calls) == 1  # counted once, not twice


async def test_hubspot_at_20_staff_is_still_stopped_at_no_cost(session: AsyncSession) -> None:
    """HubSpot's own count, for a sure match (10 on LinkedIn x 2), with Signal Hire saying little
    too."""
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=10))
    await session.commit()
    fake = FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=2)  # 4
    claude = FakeClaude(facts=NO_STAFF)

    card = await research(session, claude, rules=SIGNALHIRE_RULES, signalhire=fake)

    assert claude.calls == []  # no Claude request at all
    assert card.result == "drop"
    assert card.summary.startswith(
        "Too small: 20 staff (HubSpot), 4 staff (Signal Hire), under 30."
    )
    assert card.research.claude_requests == 0 and card.research.cost_usd == 0
    assert not any(call.startswith("leaders:") for call in fake.calls)  # no people search either
    assert await count(session, Lead, result="drop") == 1


async def test_hubspot_small_but_signal_hire_at_the_floor_lets_the_research_go_on(
    session: AsyncSession,
) -> None:
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=10))
    await session.commit()
    fake = FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=150)  # 300
    claude = FakeClaude(facts=NO_STAFF)

    card = await research(session, claude, rules=SIGNALHIRE_RULES, signalhire=fake)

    assert claude.calls
    assert not card.summary.startswith("Too small")


async def test_hubspot_saying_small_stops_it_too(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=6))
    await session.commit()
    claude = FakeClaude(facts=NO_STAFF)

    card = await research(session, claude)

    assert claude.calls == []
    assert card.summary.startswith("Too small: 12 staff (HubSpot), under 30.")
    assert card.result == "drop"


async def test_one_number_at_the_floor_or_more_lets_the_research_go_on(
    session: AsyncSession,
) -> None:
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=40))
    await session.commit()
    fake = FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=2)  # 4, but HubSpot says 80
    claude = FakeClaude(facts=NO_STAFF)

    card = await research(session, claude, rules=SIGNALHIRE_RULES, signalhire=fake)

    assert claude.calls  # researched as usual
    assert not card.summary.startswith("Too small")


async def test_a_growth_sign_from_discovery_is_never_stopped_for_its_size(
    session: AsyncSession,
) -> None:
    from apps.lead_finder.context import Signal

    fake = FakeSignalHire([ACME_SOFTWARE], info=ACME_INFO, people=2)
    claude = FakeClaude(facts=NO_STAFF)
    growth = Signal(
        trigger_id="fast_growth",
        what_happened="Acme raised $40M to hire 150 people.",
        url="https://news.example.com/acme",
    )

    card = await research(
        session,
        claude,
        rules=SIGNALHIRE_RULES,
        signalhire=fake,
        context=ResearchContext(signals=(growth,)),
    )

    assert claude.calls  # a growing company is judged on what it plans
    assert not card.summary.startswith("Too small")


async def test_no_known_number_means_no_stop(session: AsyncSession) -> None:
    claude = FakeClaude(facts=NO_STAFF)
    card = await research(session, claude)  # no HubSpot office and no Signal Hire
    assert claude.calls
    assert not card.summary.startswith("Too small")


# --- Property Daily and Arealytics (PLAN-V16 T1-8) --------------------------------------------

PD_LINK = "https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=101"
AL_LINK = "https://app.arealytics.com.au/tenancy/77"
PD_ADDRESS = "120 Collins Street, Melbourne VIC 3000"
AL_TEXT = (
    "Secret Lane",
    "3333",
    "3,333",
    AL_LINK,
    "arealytics.com.au",
    "Only Arealytics says this",
)


def tool_record(source: Any, **values: Any) -> Any:
    from datetime import UTC, datetime

    from core.sources.types import PropertyRecord

    base: dict[str, Any] = {
        "source": source,
        "kind": "lease",
        "company": "Acme Software",
        "city": "Melbourne",
        "summary": "A lease.",
        "url": PD_LINK if source == "property_daily" else AL_LINK,
        "read_at": datetime(2026, 10, 20, tzinfo=UTC),
    }
    base.update(values)
    return PropertyRecord(**base)


def both_tools(property_daily: Any = "found", arealytics: Any = "found") -> Any:
    from core.sources.types import CompanyProperty, SourceChecks

    return CompanyProperty(
        records=[
            tool_record(
                "property_daily",
                address=PD_ADDRESS,
                floor="Level 12",
                area_m2=1400,
                lease_end=date(2028, 6, 30),
            ),
            tool_record(
                "arealytics",
                address="9 Secret Lane, Melbourne VIC 3000",
                area_m2=3333,
                lease_end=date(2029, 9, 30),
                summary="Only Arealytics says this.",
            ),
        ],
        checked=SourceChecks(property_daily=property_daily, arealytics=arealytics),
    )


def fake_lookup(answer: Any, calls: list[tuple[Any, ...]]) -> Any:
    async def lookup(
        session: AsyncSession,
        name: str,
        city: str | None,
        website: str | None,
        *,
        run_id: uuid.UUID | None = None,
        settings: Settings | None = None,
    ) -> Any:
        calls.append((name, city, website, run_id))
        if isinstance(answer, Exception):
            raise answer
        return answer

    return lookup


async def test_the_tools_records_reach_the_card_and_arealytics_never_reaches_claude(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[Any, ...]] = []
    monkeypatch.setattr(research_module, "lookup_company", fake_lookup(both_tools(), calls))
    claude = FakeClaude()

    card = await research(session, claude, settings=lf_settings(why_now_enabled=True))

    assert calls == [("Acme Software", "Melbourne", None, None)]  # once, before the search
    assert card.property is not None and len(card.property.records) == 2
    # Property Daily first: its floor area, and its lease end as the sign
    assert (card.facts.office_m2.value, card.facts.office_m2.source_url) == (1400, PD_LINK)
    leases = [s.trigger for s in card.triggers if s.trigger.id == "lease_ending"]
    assert [(t.date, t.source_url) for t in leases] == [("2028-06-30", PD_LINK)]
    size = next(entry for entry in card.fact_sources if entry.fact == "office_m2")
    assert size.used == "property_daily"
    assert [(o.source, o.value) for o in size.others] == [
        ("arealytics", "3,333 m²"),
        ("claude", "2,500 m²"),
    ]
    assert size.conflict is not None  # 3,333 against 1,400: a flag for a person
    # What Claude read: Property Daily's hint in every search, and nothing from Arealytics anywhere
    steps = {request.step for request in claude.requests}
    assert {"extract", "why"} <= steps
    for request in claude.requests:
        for text in AL_TEXT:
            assert text not in request.prompt and text not in request.system, (request.step, text)
        hinted = PD_ADDRESS in request.prompt and '"area_m2": 1400' in request.prompt
        assert hinted == request.step.startswith("search:"), request.step
    saved = await session.scalar(select(Lead.card).where(Lead.id == card.id))
    assert saved is not None and saved["property"]["records"][0]["area_m2"] == 1400


async def test_a_lookup_that_fails_is_one_line_and_the_lead_is_still_saved(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.sources.types import CompanyProperty, SourceChecks

    failed = CompanyProperty(checked=SourceChecks(property_daily="error", arealytics="off"))
    monkeypatch.setattr(research_module, "lookup_company", fake_lookup(failed, []))
    card = await research(session, FakeClaude())
    assert card.result == "pass"
    assert (
        "Property Daily: the lookup didn't work this time, so this lead was judged without it."
        in card.problems
    )

    monkeypatch.setattr(research_module, "lookup_company", fake_lookup(RuntimeError("x"), []))
    other = await research(session, FakeClaude(), ResearchRequest(company="Beta", city="Melbourne"))
    assert other.result == "pass" and other.property is None
    assert any(line.startswith("Property Daily and Arealytics:") for line in other.problems)
    assert await count(session, Lead) == 2


async def test_with_both_tools_off_the_research_is_as_before(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The plan's "Done when": a run with both tools off works as today. Our copy may still hold
    their records: a tool that is off is skipped."""
    before = await research(session, FakeClaude(), ResearchRequest(company="Acme One"))
    off = both_tools(property_daily="off", arealytics="off")
    monkeypatch.setattr(research_module, "lookup_company", fake_lookup(off, []))
    claude = FakeClaude()
    after = await research(session, claude, ResearchRequest(company="Acme One"))

    def same(card: LeadCard) -> tuple[Any, ...]:
        return (
            card.result,
            card.score,
            card.tier,
            card.facts.model_dump(exclude={"name"}),
            [s.trigger.id for s in card.triggers],
            card.fact_sources,
            card.problems,
        )

    assert same(after) == same(before)
    assert after.property is not None and after.property.records == []
    assert all(PD_ADDRESS not in request.prompt for request in claude.requests)


async def test_a_company_too_small_to_research_uses_no_lookup(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[Any, ...]] = []
    monkeypatch.setattr(research_module, "lookup_company", fake_lookup(both_tools(), calls))
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=6))
    await session.commit()

    card = await research(session, FakeClaude(facts=NO_STAFF))

    assert card.summary.startswith("Too small")
    assert calls == []  # no pages spent on it
    assert card.property is None


# --- The output (PLAN-V16 T1-10) ---------------------------------------------------------------


async def test_the_card_has_the_office_the_headcount_the_space_and_what_changed(
    session: AsyncSession,
) -> None:
    facts = make_facts(
        office_since=fact("2015-03"),
        staff_projected=fact(320, ASX, "estimated"),
        contour_angle="growth planning",
        contact_roles=["COO", "Head of Property"],
    )
    card = await research(session, FakeClaude(facts=facts))

    assert card.office is not None
    assert (card.office.area_m2, card.office.area_basis) == (2500, "confirmed")
    assert card.office.since_words == "At this address since at least 2015."
    assert (card.office.lease_end, card.office.source) == ("2028-03", "web_research")
    assert card.headcount is not None
    assert (card.headcount.now, card.headcount.projected) == (250, 320)
    assert card.space is not None and card.space.projected_m2 == 3200
    assert (card.contour_angle, card.contact_roles) == (
        "growth planning",
        ["COO", "Head of Property"],
    )
    assert card.what_changed is not None
    assert card.what_changed.text == "New: the first research of this company."

    again = await research(session, FakeClaude(facts=facts))  # the same company, the same facts
    assert again.what_changed is not None
    assert (again.what_changed.kind, again.what_changed.text) == (
        "unchanged",
        f"Unchanged: still Tier {again.tier}.",
    )
    dropped = await research(session, FakeClaude(facts=make_facts(triggers=[])))  # its sign is gone
    assert dropped.what_changed is not None and dropped.what_changed.kind == "downgraded"
    assert "a sign no longer counts" in dropped.what_changed.text


# --- Every card keeps its sign (PLAN-V21 T1-8) ----------------------------------------------------

MERGER = Signal(
    trigger_id="merger_or_takeover",
    what_happened="Acme Software agreed to merge with Boxhill Systems.",
    url="https://www.smh.com.au/business/acme-merger",
    date="2026-10-20",
)
FROM_SEARCH = "Sign from the search, not checked by the research: Acme Software agreed to merge"


async def kept_sign(session: AsyncSession, card: LeadCard) -> None:
    """The card names discovery's sign, marked as the search's, and so does the lead's row."""
    merger = [score for score in card.triggers if score.trigger.id == "merger_or_takeover"]
    assert len(merger) == 1 and merger[0].from_search
    assert merger[0].trigger.label == "estimated"
    lead = await session.scalar(select(Lead).where(Lead.id == card.id))
    assert lead is not None and "merger_or_takeover" in (lead.trigger_ids or [])
    assert lead.trigger_id is not None


async def test_a_failed_form_keeps_the_sign_discovery_found(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    card = await research(
        session,
        FakeClaude(extract_error=refused),
        context=ResearchContext(signals=(MERGER,)),
    )
    assert card.form_failed
    await kept_sign(session, card)
    assert card.triggers[0].trigger.id == "merger_or_takeover"  # the only sign it has
    assert card.why_it_fits.startswith(FROM_SEARCH)


async def test_a_failed_second_form_keeps_the_sign_discovery_found(session: AsyncSession) -> None:
    busy = ClaudeError("Claude is busy right now", "Try again in a minute.")
    card = await research(
        session, FakeClaude(extras_error=busy), context=ResearchContext(signals=(MERGER,))
    )
    assert not card.form_failed
    await kept_sign(session, card)
    assert "lease_ending" in {score.trigger.id for score in card.triggers}  # the research's own
    assert not any(s.from_search for s in card.triggers if s.trigger.id == "lease_ending")


async def test_the_early_size_stop_keeps_the_sign_discovery_found(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=6))
    await session.commit()
    claude = FakeClaude(facts=NO_STAFF)
    card = await research(session, claude, context=ResearchContext(signals=(MERGER,)))

    assert claude.calls == [] and card.summary.startswith("Too small")
    await kept_sign(session, card)
    assert FROM_SEARCH in card.why_it_fits


async def test_a_sign_the_research_found_again_is_not_marked(session: AsyncSession) -> None:
    lease = Signal(
        trigger_id="lease_ending",
        what_happened="Acme's lease ends in 2028.",
        url="https://www.smh.com.au/business/acme-lease",
    )
    card = await research(session, FakeClaude(), context=ResearchContext(signals=(lease,)))
    leases = [score for score in card.triggers if score.trigger.id == "lease_ending"]
    assert len(leases) == 1 and not leases[0].from_search  # the research's own, once
    assert not card.why_it_fits.startswith("Sign from the search")


async def test_the_mark_survives_a_judge_again(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    card = await research(
        session, FakeClaude(extract_error=refused), context=ResearchContext(signals=(MERGER,))
    )
    again = research_module.apply_verdict(
        card, judge(card.facts, HubSpotMatch(status="new"), load_rules(), TODAY)
    )
    assert [s.from_search for s in again.triggers if s.trigger.id == "merger_or_takeover"] == [True]
    assert again.why_it_fits.startswith(FROM_SEARCH)
