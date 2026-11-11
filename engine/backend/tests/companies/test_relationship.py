"""The relationship stage (PLAN-V15 T3-3): where we stand with a company, the first match wins.

- each stage, and the edges: 12 and 24 months exactly, a won and a lost deal together, a lifecycle
  "Customer" with no deal, a lead not in HubSpot;
- the company panel carries it, and the facts pack ends with it and the lifecycle stage;
- the prompt says "don't introduce" for every stage but cold.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

from apps.companies.facts import FactsPack, _stage_facts
from apps.companies.prep import PROMPT_VERSION, SYSTEM, PrepContext, _prompt
from apps.companies.relationship import (
    CONTACT_MONTHS,
    CUSTOMER_MONTHS,
    LOST_MONTHS,
    Pieces,
    months_before,
    relationship_of,
)
from apps.companies.schemas import (
    CompanyCall,
    CompanyDeal,
    CompanyDetail,
    CompanyPerson,
    Relationship,
)

TODAY = date(2026, 11, 12)


def a_deal(
    name: str, state: str, close: date | None = None, stage: str | None = None
) -> CompanyDeal:
    return CompanyDeal(
        name=name,
        stage=stage,
        state=state,
        pipeline=None,
        amount_aud=None,
        close_date=close,
        owner=None,
        next_step=None,
        hubspot_url=None,
    )


def a_call(on: date, person: str | None = "Sarah Lee") -> CompanyCall:
    return CompanyCall(
        id="k1",
        called_at=datetime(on.year, on.month, on.day, 1, tzinfo=UTC),
        person=person,
        owner="Levi",
        minutes=5,
        outcome="Connected",
        note=None,
        hubspot_url=None,
    )


def stage(**pieces: Any) -> Relationship:
    return relationship_of(Pieces(**{"source": "hubspot", **pieces}), TODAY)


# --- Each stage ---------------------------------------------------------------------------------


def test_an_open_deal_comes_first() -> None:
    found = stage(
        deals=[
            a_deal("Melbourne refresh", "won", date(2024, 3, 1)),
            a_deal("Perth fitout", "open", stage="Proposal"),
        ],
        last_talk=date(2026, 10, 1),
    )
    assert found == Relationship(
        stage="open_deal",
        since=None,
        reason="Open deal: Perth fitout, at Proposal.",
        source="HubSpot deal",
    )


def test_a_customer_with_a_recent_talk_and_a_past_customer_without() -> None:
    won = [a_deal("Perth fitout", "won", date(2023, 5, 1))]
    customer = stage(deals=won, calls=[a_call(date(2026, 3, 3))])
    assert customer.stage == "customer"
    assert customer.since == date(2026, 3, 3)
    assert customer.source == "HubSpot call, 3 Mar 2026"
    assert "we won Perth fitout in 2023" in customer.reason
    assert "a call with Sarah Lee on 3 Mar 2026" in customer.reason
    past = stage(deals=won, last_talk=date(2024, 1, 10))
    assert past.stage == "past_customer"
    assert past.since == date(2023, 5, 1)
    assert past.reason == (
        "A past customer: we won Perth fitout in 2023. No talk since 10 Jan 2024."
    )


def test_12_months_exactly_is_still_a_customer() -> None:
    won = [a_deal("Perth fitout", "won", date(2023, 5, 1))]
    edge = months_before(TODAY, CUSTOMER_MONTHS)
    assert edge == date(2025, 11, 12)
    assert stage(deals=won, last_talk=edge).stage == "customer"
    assert stage(deals=won, last_talk=date(2025, 11, 11)).stage == "past_customer"


def test_lifecycle_customer_with_no_deal() -> None:
    recent = stage(lifecycle_stage="Customer", last_talk=date(2026, 9, 1))
    assert recent.stage == "customer"
    assert "HubSpot lists them as a customer" in recent.reason
    quiet = stage(lifecycle_stage="customer")
    assert quiet.stage == "past_customer"
    assert quiet.source == "HubSpot: lifecycle stage"
    assert quiet.reason.endswith("No talk on record.")


def test_a_won_and_a_lost_deal_together_is_a_customer() -> None:
    both = stage(
        deals=[
            a_deal("Lost bid", "lost", date(2026, 8, 1)),
            a_deal("Perth fitout", "won", date(2022, 2, 1)),
        ],
        last_talk=date(2026, 8, 1),
    )
    assert both.stage == "customer"


def test_a_lost_deal_counts_for_24_months_exactly() -> None:
    edge = months_before(TODAY, LOST_MONTHS)
    assert edge == date(2024, 11, 12)
    lost = stage(deals=[a_deal("Perth fitout", "lost", edge)])
    assert lost == Relationship(
        stage="lost_deal",
        since=edge,
        reason="Lost deal: Perth fitout, closed 12 Nov 2024.",
        source="HubSpot deal",
    )
    older = stage(deals=[a_deal("Perth fitout", "lost", date(2024, 11, 11))])
    assert older.stage == "cold"
    # A lost deal with no close date can't be dated, so it doesn't count.
    assert stage(deals=[a_deal("Perth fitout", "lost")]).stage == "cold"
    # A dissolved deal isn't a lost one.
    assert stage(deals=[a_deal("Perth fitout", "dissolved", TODAY)]).stage == "cold"


def test_contacted_before_by_a_call_a_last_talk_or_a_contact() -> None:
    by_call = stage(calls=[a_call(date(2026, 3, 3))], last_talk=date(2026, 1, 1))
    assert by_call.stage == "contacted"
    assert by_call.reason == "Contacted before: a call with Sarah Lee on 3 Mar 2026."
    assert by_call.source == "HubSpot call, 3 Mar 2026"
    by_talk = stage(last_talk=date(2026, 4, 2))
    assert by_talk.reason == "Contacted before: the last talk on record, on 2 Apr 2026."
    assert by_talk.source == "HubSpot: last contacted"
    person = CompanyPerson(
        id="c1",
        name="Sarah Lee",
        title=None,
        phone=None,
        last_activity=datetime(2026, 5, 6, 3, tzinfo=UTC),
    )
    by_contact = stage(people=[person])
    assert by_contact.reason == "Contacted before: HubSpot activity with Sarah Lee on 6 May 2026."
    assert by_contact.since == date(2026, 5, 6)


def test_contacted_counts_for_24_months_exactly_then_it_is_cold() -> None:
    edge = months_before(TODAY, CONTACT_MONTHS)
    assert stage(last_talk=edge).stage == "contacted"
    cold = stage(last_talk=date(2024, 11, 11))
    assert cold == Relationship(
        stage="cold",
        since=None,
        reason="No deal, and no talk on record in the last 24 months.",
        source="HubSpot copy",
    )


def test_a_lead_not_in_hubspot_is_cold() -> None:
    lead = relationship_of(Pieces(source="lead"), TODAY)
    assert lead.stage == "cold"
    assert lead.source == "Lead Finder"


def test_months_before_keeps_to_the_end_of_a_short_month() -> None:
    assert months_before(date(2028, 2, 29), 12) == date(2027, 2, 28)
    assert months_before(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert months_before(date(2026, 1, 15), 24) == date(2024, 1, 15)


# --- The prompt ---------------------------------------------------------------------------------


def a_company(relationship: Relationship, **more: Any) -> CompanyDetail:
    values: dict[str, Any] = {
        "key": "101",
        "source": "hubspot",
        "name": "ABC Logistics",
        "domain": None,
        "website": None,
        "city": "Perth",
        "state": None,
        "industry": None,
        "staff": None,
        "linkedin_staff": None,
        "description": None,
        "owner": None,
        "lifecycle_stage": "Customer",
        "last_talk": None,
        "last_talk_note": None,
        "next_lease_end": None,
        "deal": "none",
        "hubspot_url": None,
        "offices": [],
        "deals": [],
        "notes": [],
        "people": [],
        "calls": [],
        "people_status": "ready",
        "lead": None,
        "relationship": relationship,
    }
    values.update(more)
    return CompanyDetail(**values)


STAGES = ("open_deal", "customer", "past_customer", "lost_deal", "contacted", "cold")


@pytest.mark.parametrize("name", STAGES)
def test_the_prompt_says_dont_introduce_for_every_stage_but_cold(name: str) -> None:
    where = Relationship(stage=name, since=None, reason="Why.", source="HubSpot deal")
    pack = FactsPack(
        company=a_company(where), person=None, phone=None, last_call=None, leads_used=False
    )
    pack.add("About 300 staff.", "hubspot", "HubSpot: company")
    _stage_facts(pack, pack.company)
    # The lifecycle stage and the relationship stage come last, so the other facts keep their ids.
    assert pack.facts[1].text.startswith("HubSpot's lifecycle stage")
    assert pack.stage_fact == "F3"
    assert pack.facts[-1].label == "HubSpot deal"
    context = PrepContext(
        hooks=[],
        names_ok=True,
        cap_usd=Decimal("0.25"),
        max_searches=3,
        reuse_days=7,
        model="claude-sonnet-5-5",
    )
    prompt = _prompt(pack, context, web=False)
    assert "Relationship stage:" in prompt and "(F3)" in prompt
    if name == "cold":
        assert "A cold call: say who you are and what Contour does." in prompt
        assert "Don't introduce" not in prompt
    else:
        assert "Don't introduce Contour or say what we do" in prompt
    assert "If the stage isn't cold, don't say who Contour is or what we do." in SYSTEM
    assert "On a switchboard call that isn't cold, ask for the person we last spoke with" in SYSTEM
    assert PROMPT_VERSION == "prep-5"


# --- The company panel and the facts pack -------------------------------------------------------


@pytest.mark.integration
async def test_the_panel_and_the_facts_pack_carry_the_stage(world: Any) -> None:
    from tests.companies.helpers import API, a_small_copy, signed_in_as

    await a_small_copy(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        abc = (await client.get(f"{API}/101")).json()["relationship"]
        nimbus = (await client.get(f"{API}/104")).json()["relationship"]
        zed = (await client.get(f"{API}/103")).json()["relationship"]
        facts = (await client.get(f"{API}/104/facts")).json()["facts"]
    assert abc == {
        "stage": "open_deal",
        "since": None,
        "reason": "Open deal: Deal d1, at Qualified Deal.",
        "source": "HubSpot deal",
    }
    # Lifecycle "Customer", a lost deal, and no talk since Jan 2025: a past customer.
    assert nimbus["stage"] == "past_customer"
    assert nimbus["source"] == "HubSpot: lifecycle stage"
    assert zed["stage"] == "cold"
    assert facts[-2]["text"] == "HubSpot's lifecycle stage for Nimbus Software is 'Customer'."
    assert facts[-1]["text"].startswith("Relationship stage: past customer. A past customer:")
    assert facts[-1]["source"]["label"] == "HubSpot: lifecycle stage"
