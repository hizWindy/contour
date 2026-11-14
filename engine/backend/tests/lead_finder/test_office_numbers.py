"""HubSpot's office size, lease end and move-in date take their place in `data_sources`: after the
two property tools and before the web research (PLAN-V16 T1-8; before it, HubSpot only filled the
gaps the research left). Its staff count is a candidate: the rules pick it or not (PLAN-V4 C3)."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.fields import CompanyFacts
from apps.lead_finder.office_numbers import OfficeNumbers, hubspot_staff, office_numbers
from apps.lead_finder.property import apply_office_sources
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.scoring import judge
from apps.lead_finder.sourcing import FactSource, OtherValue, choose_staff
from core.hubspot.matching import HubSpotMatch
from core.hubspot.models import HubSpotCompany, HubSpotOffice
from tests.lead_finder.samples import NEWS, fact, make_facts

RULES = load_rules()
TODAY = date(2026, 10, 26)
LINK = "https://app.hubspot.com/contacts/1/company/102"
NUMBERS = OfficeNumbers(
    city="Melbourne",
    linkedin_staff=60,
    lease_expiry=date(2028, 3, 31),
    last_moved=date(2016, 3, 1),
    record_url=LINK,
)
NOTHING_FOUND = make_facts(office_m2=fact(None), staff_in_city=fact(None), triggers=[])


def fill(
    facts: CompanyFacts, numbers: OfficeNumbers | None, rules: LeadFinderRules = RULES
) -> tuple[CompanyFacts, list[str]]:
    """HubSpot's numbers in the order, with no property tool: the facts and the HubSpot notes."""
    out = apply_office_sources(facts, None, numbers, "Melbourne", rules, TODAY)
    return out.facts, out.from_hubspot


def test_hubspot_fills_the_gaps_the_research_left() -> None:
    facts, notes = fill(NOTHING_FOUND, NUMBERS)
    assert facts.staff_in_city.value is None  # the staff count is chosen with the other sources'
    assert (facts.office_since.value, facts.office_since.source_url) == ("2016-03-01", LINK)
    (lease,) = facts.triggers
    assert (lease.id, lease.date, lease.source_url) == ("lease_ending", "2028-03-31", LINK)
    assert notes == [
        "Moved in March 2016, from HubSpot.",
        "Lease in Melbourne ends March 2028, from HubSpot.",
    ]
    out = apply_office_sources(NOTHING_FOUND, None, NUMBERS, "Melbourne", RULES, TODAY)
    assert [(entry.fact, entry.used) for entry in out.entries] == [
        ("office_since", "hubspot"),
        ("lease_end", "hubspot"),
    ]


def test_hubspot_now_comes_before_the_web_research_and_the_research_stays_on_the_card() -> None:
    """PLAN-V16 T1-8: the order is the tools, HubSpot, then the web research."""
    found = make_facts(office_since=fact("2019"))  # and a lease sign of its own: March 2028
    out = apply_office_sources(found, None, NUMBERS, "Melbourne", RULES, TODAY)
    assert out.facts.office_since.value == "2016-03-01"
    (lease,) = out.facts.triggers  # HubSpot's lease sign in place of the research's
    assert (lease.date, lease.source_url) == ("2028-03-31", LINK)
    since, ends = out.entries
    assert since == FactSource(
        fact="office_since",
        used="hubspot",
        others=[OtherValue(source="claude", value="2019", url=NEWS)],
        conflict="The move-in dates are more than 12 months apart: HubSpot March 2016, "
        "Claude 2019. Check which is right.",
    )
    assert ends == FactSource(
        fact="lease_end",
        used="hubspot",
        others=[OtherValue(source="claude", value="March 2028", url=NEWS)],
        conflict=None,
    )
    assert out.from_hubspot == [
        "Moved in March 2016, from HubSpot.",
        "Lease in Melbourne ends March 2028, from HubSpot.",
    ]


def test_the_research_wins_again_when_the_rules_put_it_first() -> None:
    """How to go back to the order before PLAN-V16 T1-8, with no code change."""
    order = ["web_research", "hubspot"]
    sources = RULES.criteria.data_sources.model_copy(
        update={"office_m2": order, "lease_end": order, "office_since": order}
    )
    criteria = RULES.criteria.model_copy(update={"data_sources": sources})
    rules = RULES.model_copy(update={"criteria": criteria})
    found = make_facts(office_since=fact("2019"))
    facts, notes = fill(found, NUMBERS, rules)
    assert facts == found
    assert notes == []
    filled, _ = fill(NOTHING_FOUND, NUMBERS, rules)  # HubSpot still fills a gap
    assert filled.office_since.value == "2016-03-01"


def test_a_lease_that_has_ended_is_not_a_trigger() -> None:
    ended = OfficeNumbers("Melbourne", 60, date(2026, 1, 31), None, LINK)
    facts, notes = fill(NOTHING_FOUND, ended)
    assert facts.triggers == []
    assert notes == []


def test_a_fact_from_hubspot_needs_a_safe_link() -> None:
    odd = OfficeNumbers("Melbourne", 60, date(2028, 3, 31), None, "javascript:alert(1)")
    facts, notes = fill(NOTHING_FOUND, odd)
    candidate = hubspot_staff(odd, RULES)
    assert candidate is not None
    assert candidate.fact.source_url is None  # no link, rather than an unsafe one
    assert facts.triggers == []  # a trigger needs a link
    assert notes == []


def test_hubspots_office_size_is_used_when_no_tool_has_one() -> None:
    """HubSpot's "Office Space Size" (PLAN-V16 T1-8): before the web research's."""
    numbers = OfficeNumbers("Melbourne", None, None, None, LINK, office_m2=1800)
    facts, notes = fill(make_facts(), numbers)  # the research found 2,500 m²
    assert (facts.office_m2.value, facts.office_m2.source_url) == (1800, LINK)
    assert facts.office_m2.label == "confirmed"
    assert notes == ["Office of 1,800 m² in Melbourne, from HubSpot."]


def test_nothing_changes_without_numbers_or_when_the_rules_leave_hubspot_out() -> None:
    assert fill(NOTHING_FOUND, None) == (NOTHING_FOUND, [])
    assert hubspot_staff(None, RULES) is None
    order = ["property_daily", "arealytics", "web_research"]
    sources = RULES.criteria.data_sources.model_copy(
        update={"office_m2": order, "lease_end": order, "office_since": order}
    )
    size = RULES.criteria.size.model_copy(update={"staff_sources": ["web_research"]})
    criteria = RULES.criteria.model_copy(update={"size": size, "data_sources": sources})
    without = RULES.model_copy(update={"criteria": criteria})
    assert fill(NOTHING_FOUND, NUMBERS, without) == (NOTHING_FOUND, [])
    assert hubspot_staff(NUMBERS, without) is None
    assert hubspot_staff(OfficeNumbers("Melbourne", None, None, None, LINK), RULES) is None


def test_the_staff_from_hubspot_goes_through_the_size_rule() -> None:
    facts, _ = fill(NOTHING_FOUND, NUMBERS)  # adds the lease trigger
    facts = choose_staff(facts, [hubspot_staff(NUMBERS, RULES)], RULES).facts
    result = judge(facts, HubSpotMatch(status="in_hubspot"), RULES, TODAY)
    assert result.office_m2 == 60 * 2 * 10  # 60 on LinkedIn is about 120 staff
    assert result.result == "pass"


@pytest.mark.integration
async def test_the_numbers_come_from_the_offices_in_that_city(session: AsyncSession) -> None:
    session.add(
        HubSpotCompany(hubspot_id="102", name="Acme Software", hubspot_url=LINK, source="export")
    )
    await session.flush()
    session.add_all(
        [
            HubSpotOffice(
                hubspot_company_id="102",
                label="Melbourne",
                linkedin_staff=60,
                lease_expiry=date(2028, 3, 31),
                last_moved=date(2016, 3, 1),
            ),
            HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=40),
            HubSpotOffice(hubspot_company_id="102", label="Sydney", linkedin_staff=500),
            HubSpotOffice(hubspot_company_id="102", label="Other Office 2", linkedin_staff=900),
        ]
    )
    await session.flush()

    assert await office_numbers(session, "102", "Melbourne") == NUMBERS
    assert await office_numbers(session, "102", "Perth") is None
    assert await office_numbers(session, None, "Melbourne") is None
    assert await office_numbers(session, "102", None) is None

    session.add_all(
        [
            HubSpotOffice(hubspot_company_id="102", label="Melbourne", office_m2=Decimal("1250.4")),
            HubSpotOffice(hubspot_company_id="102", label="Melbourne", office_m2=Decimal("0.5")),
            HubSpotOffice(hubspot_company_id="102", label="Sydney", office_m2=Decimal("9000")),
        ]
    )
    await session.flush()
    numbers = await office_numbers(session, "102", "Melbourne")
    assert numbers is not None and numbers.office_m2 == 1250  # the largest there, whole m²
