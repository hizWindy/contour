"""The card's office, headcount, space and "what changed" (Levi's section 9, PLAN-V16 T1-10).
Pure code, free."""

from datetime import UTC, date, datetime
from typing import Any

import pytest

from apps.lead_finder.output import headcount_of, office_of, space_of, what_changed
from apps.lead_finder.rules import load_rules
from apps.lead_finder.sourcing import FactSource
from core.sources.types import CompanyProperty, PropertyRecord, SourceChecks
from tests.lead_finder.samples import NEWS, fact, make_facts

RULES = load_rules()
TODAY = date(2026, 10, 26)
PD = "https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=101"


def tools() -> CompanyProperty:
    record = PropertyRecord(
        source="property_daily",
        kind="lease",
        company="Acme Software",
        city="Melbourne",
        address="120 Collins Street, Melbourne VIC 3000",
        building="Collins Tower",
        floor="Level 12",
        area_m2=1400,
        lease_end=date(2028, 6, 30),
        summary="A lease.",
        url=PD,
        read_at=datetime(2026, 10, 20, tzinfo=UTC),
    )
    return CompanyProperty(records=[record], checked=SourceChecks(property_daily="found"))


def test_the_office_has_the_tools_address_and_the_facts_the_rules_used() -> None:
    facts = make_facts(office_since=fact("2017-03"), fitout_contractors=["Sample Fitouts"])
    sources = [FactSource(fact="office_m2", used="property_daily", others=[], conflict=None)]
    office = office_of(facts, sources, tools(), "Melbourne", 1400, False, RULES, TODAY)
    assert office is not None
    assert office.model_dump() == {
        "address": "120 Collins Street, Melbourne VIC 3000",
        "building": "Collins Tower",
        "floor": "Level 12",
        "area_m2": 1400,
        "area_basis": "confirmed",
        "since": "2017-03",
        "since_words": "At this address since at least 2017.",
        "lease_end": "2028-03",  # the facts' lease sign
        "lease_end_basis": "confirmed",
        "fitout_by": "Sample Fitouts",
        "source": "property_daily",
    }


def test_an_office_from_the_web_alone_has_no_address_and_nothing_known_is_no_office() -> None:
    office = office_of(make_facts(), [], None, "Melbourne", 2500, True, RULES, TODAY)
    assert office is not None
    assert (office.address, office.area_basis, office.source) == (None, "estimated", "web_research")
    bare = make_facts(triggers=[], office_m2=fact(None))
    assert office_of(bare, [], None, "Melbourne", None, False, RULES, TODAY) is None


def test_headcount_and_space_mark_what_is_confirmed_and_what_is_estimated() -> None:
    facts = make_facts(staff_projected=fact(320, NEWS, "estimated"))  # 250 staff now, confirmed
    headcount = headcount_of(facts, RULES)
    assert headcount is not None
    assert (headcount.now, headcount.now_basis) == (250, "confirmed")
    assert (headcount.projected, headcount.projected_basis) == (320, "estimated")
    space = space_of(headcount, RULES)
    assert space is not None and (space.now_m2, space.projected_m2) == (2500, 3200)  # 10 m² each
    linkedin = make_facts(staff_in_city=fact(60), staff_from_linkedin=True)
    doubled = headcount_of(linkedin, RULES)
    assert doubled is not None and (doubled.now, doubled.now_basis) == (120, "estimated")
    unknown = make_facts(staff_in_city=fact(None))
    assert headcount_of(unknown, RULES) is None and space_of(None, RULES) is None


def card(
    tier: str | None, result: str, score: int, *signs: str, damped: bool = False
) -> dict[str, Any]:
    return {
        "tier": tier,
        "result": result,
        "score": score,
        "triggers": [{"trigger": {"id": sign}} for sign in signs],
        "dampeners": [
            {"id": "outsourcing", "label": "A real estate outsourcing deal", "state": "found"}
        ]
        if damped
        else [],
    }


@pytest.mark.parametrize(
    ("now", "before", "kind", "text"),
    [
        (card("B", "pass", 60), None, "new", "New: the first research of this company."),
        (
            card("A", "pass", 80, "new_ceo", "lease_ending"),
            card("B", "pass", 60, "new_ceo"),
            "upgraded",
            "Up from B to A: a new sign, lease ending in 1 to 3 years, or a relocation.",
        ),
        (
            card("C", "watch", 45, "new_ceo", damped=True),
            card("B", "pass", 65, "new_ceo"),
            "downgraded",
            "Down from B to C: a dampener was found, a real estate outsourcing deal.",
        ),
        (card("B", "pass", 62), card("B", "pass", 60), "unchanged", "Unchanged: still Tier B."),
        (
            card("discard", "drop", 20),
            card("C", "watch", 45, "new_ceo"),
            "downgraded",
            "Down from C to Discard: a sign no longer counts, leadership change that changes "
            "direction or strategy.",
        ),
        # An old card has no tier: the results are compared
        (
            card("B", "pass", 60, "new_ceo"),
            card(None, "watch", 40, "new_ceo"),
            "upgraded",
            "Up from Watch to Pass: the score went from 40 to 60.",
        ),
        (card("C", "watch", 45), card(None, "watch", 45), "unchanged", "Unchanged: still Watch."),
    ],
)
def test_what_changed_since_the_last_research(
    now: dict[str, Any], before: dict[str, Any] | None, kind: str, text: str
) -> None:
    changed = what_changed(now, before, RULES)
    assert (changed.kind, changed.text) == (kind, text)


def test_the_form_keeps_short_roles_once_and_no_contact_details() -> None:
    from apps.lead_finder.fields import CompanyFacts

    data = make_facts().model_dump()
    data["contact_roles"] = ["COO", "coo", "Head of Property", "jane@acme.com.au", "", *"abcdef"]
    data["contour_angle"] = "  growth   planning "
    facts = CompanyFacts.model_validate(data)
    assert facts.contact_roles == ["COO", "Head of Property", "a", "b", "c"]  # at most five
    assert facts.contour_angle == "growth planning"
    old_card = {
        k: v
        for k, v in data.items()
        if k not in ("contact_roles", "contour_angle", "staff_projected")
    }
    older = CompanyFacts.model_validate(old_card)  # a card saved before PLAN-V16 T1-10
    assert (older.contact_roles, older.contour_angle, older.staff_projected.value) == (
        [],
        None,
        None,
    )
