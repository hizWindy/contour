"""HubSpot's move-in year and lease end fill the gaps the research left, and never overwrite a
figure. Its staff count is a candidate: the rules pick it or not (PLAN-V4 C3)."""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.office_numbers import (
    OfficeNumbers,
    fill_gaps,
    hubspot_staff,
    office_numbers,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.scoring import judge
from apps.lead_finder.sourcing import choose_staff
from core.hubspot.matching import HubSpotMatch
from core.hubspot.models import HubSpotCompany, HubSpotOffice
from tests.lead_finder.samples import fact, make_facts

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


def test_hubspot_fills_the_gaps_the_research_left() -> None:
    facts, notes = fill_gaps(NOTHING_FOUND, NUMBERS, RULES, TODAY)
    assert facts.staff_in_city.value is None  # the staff count is chosen with the other sources'
    assert (facts.office_since.value, facts.office_since.source_url) == ("2016-03-01", LINK)
    (lease,) = facts.triggers
    assert (lease.id, lease.date, lease.source_url) == ("lease_ending", "2028-03-31", LINK)
    assert notes == [
        "Moved in March 2016, from HubSpot.",
        "Lease in Melbourne ends March 2028, from HubSpot.",
    ]


def test_hubspot_gives_its_staff_count_as_a_candidate() -> None:
    candidate = hubspot_staff(NUMBERS, RULES)
    assert candidate is not None
    staff = candidate.fact
    assert (staff.value, staff.source_url, staff.label) == (60, LINK, "estimated")
    assert candidate.kind == "hubspot"
    assert candidate.from_linkedin  # the size rule doubles it
    assert candidate.staff == 120  # 60 on LinkedIn is about 120 staff
    assert candidate.text == "about 120 (60 on LinkedIn x 2, from HubSpot)"
    assert candidate.note == (
        "Staff in Melbourne: 60 on LinkedIn, from HubSpot. The real number is about double."
    )


def test_it_never_overwrites_what_the_research_found() -> None:
    found = make_facts(office_since=fact("2019"))  # staff 250, and a lease trigger of its own
    facts, notes = fill_gaps(found, NUMBERS, RULES, TODAY)
    assert facts == found
    assert notes == []


def test_a_lease_that_has_ended_is_not_a_trigger() -> None:
    ended = OfficeNumbers("Melbourne", 60, date(2026, 1, 31), None, LINK)
    facts, notes = fill_gaps(NOTHING_FOUND, ended, RULES, TODAY)
    assert facts.triggers == []
    assert notes == []


def test_a_fact_from_hubspot_needs_a_safe_link() -> None:
    odd = OfficeNumbers("Melbourne", 60, date(2028, 3, 31), None, "javascript:alert(1)")
    facts, notes = fill_gaps(NOTHING_FOUND, odd, RULES, TODAY)
    candidate = hubspot_staff(odd, RULES)
    assert candidate is not None
    assert candidate.fact.source_url is None  # no link, rather than an unsafe one
    assert facts.triggers == []  # a trigger needs a link
    assert notes == []


def test_nothing_changes_without_numbers_or_when_the_rules_skip_hubspot() -> None:
    assert fill_gaps(NOTHING_FOUND, None, RULES, TODAY) == (NOTHING_FOUND, [])
    assert hubspot_staff(None, RULES) is None
    size = RULES.criteria.size.model_copy(update={"staff_sources": ["web_research"]})
    criteria = RULES.criteria.model_copy(update={"size": size})
    without = RULES.model_copy(update={"criteria": criteria})
    assert fill_gaps(NOTHING_FOUND, NUMBERS, without, TODAY) == (NOTHING_FOUND, [])
    assert hubspot_staff(NUMBERS, without) is None
    assert hubspot_staff(OfficeNumbers("Melbourne", None, None, None, LINK), RULES) is None


def test_the_staff_from_hubspot_goes_through_the_size_rule() -> None:
    facts, _ = fill_gaps(NOTHING_FOUND, NUMBERS, RULES, TODAY)  # adds the lease trigger
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
