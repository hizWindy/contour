"""Levi's exclusions and filters (his sections 3 and 2, PLAN-V16 T1-3).

An excluded lead is a Drop that says why. A person can override it. The five filters are pass,
fail or estimated, and a fact nobody found is never a fail.
"""

from datetime import UTC, date, datetime
from typing import Any

import pytest

from apps.lead_finder.prompts import extract_prompt
from apps.lead_finder.rejudge import overrides_of
from apps.lead_finder.rules import load_rules
from apps.lead_finder.scoring import FilterResult, Override, Verdict, judge
from core.hubspot.matching import HubSpotMatch
from tests.lead_finder.samples import NEWS, fact, make_facts

TODAY = date(2026, 10, 26)
NEW = HubSpotMatch(status="new")
RULES = load_rules()
WHEN = datetime(2026, 11, 15, 9, 30, tzinfo=UTC)


def verdict(**changes: Any) -> Verdict:
    return judge(make_facts(**changes), NEW, RULES, TODAY)


def check_of(result: Verdict, rule: str) -> Any:
    (found,) = [check for check in result.checks if check.rule == rule]
    return found


def filters_of(result: Verdict) -> dict[str, FilterResult]:
    return {item.id: item for item in result.filters}


# --- The exclusions (section 3) -------------------------------------------------------------


@pytest.mark.parametrize(
    ("group", "reason_id", "label"),
    [
        ("Government", "government", "Government department or agency"),
        (
            "Standard not-for-profits",
            "not_for_profit",
            "Not-for-profit or charity that relies on grants or donations",
        ),
        ("Law firms", "law_firm", "Law firm"),
        (
            "Premium banks and finance",
            "big_bank",
            "Big four bank or tier-one financial institution",
        ),
    ],
)
def test_each_industry_exclusion_leaves_the_lead_out_with_its_reason(
    group: str, reason_id: str, label: str
) -> None:
    result = verdict(industry_group=group, industry=fact("Some industry"))
    assert (result.result, result.stage, result.score) == ("drop", "Not a target", 0)
    assert result.parts == []  # not scored
    excluded = result.excluded
    assert excluded is not None
    assert (excluded.reason_id, excluded.label) == (reason_id, label)
    assert group in excluded.evidence and "Some industry" in excluded.evidence
    assert excluded.url == NEWS  # the page that says what the industry is
    assert (excluded.overridden_by, excluded.overridden_at) == (None, None)
    failed = check_of(result, "Excluded")
    assert failed.outcome == "fail" and label in failed.detail


def test_an_office_that_does_not_matter_in_a_site_heavy_industry_is_left_out() -> None:
    result = verdict(
        industry_group="Retail", industry=fact("Retail"), office_matters=fact(False, NEWS)
    )
    assert result.result == "drop"
    assert result.excluded is not None and result.excluded.reason_id == "office_incidental"
    assert result.excluded.url == NEWS
    assert "mostly not office staff" in result.excluded.evidence


def test_an_office_that_does_not_matter_elsewhere_is_only_a_flag() -> None:
    """Version 2's rule stays outside the site-heavy industries: the AI's judgement is a flag."""
    result = verdict(industry_group=None, office_matters=fact(False))
    assert result.excluded is None and result.result == "pass"
    assert check_of(result, "Office").outcome == "flag"


def test_a_site_heavy_company_whose_office_matters_is_not_left_out() -> None:
    result = verdict(industry_group="Mining and metals", office_matters=fact(True))
    assert result.excluded is None


def test_a_company_that_buys_only_through_tender_portals_is_left_out() -> None:
    result = verdict(tender_only=fact(True, NEWS))
    assert result.result == "drop"
    assert result.excluded is not None and result.excluded.reason_id == "tender_only"
    assert "tender portals" in result.excluded.evidence
    assert result.excluded.url == NEWS
    assert verdict(tender_only=fact(False)).excluded is None
    assert verdict(tender_only=fact(None)).excluded is None  # not known: never a reason


def test_a_government_owned_corporation_is_flagged_not_left_out() -> None:
    """Levi: government-owned corporations are not excluded but must be flagged."""
    result = verdict(
        industry_group="Government",
        industry=fact("Postal services"),
        owner=fact("Government-owned corporation"),
    )
    assert result.excluded is None and result.result == "pass"
    flagged = check_of(result, "Excluded")
    assert flagged.outcome == "flag"
    assert flagged.detail == "A government-owned or commercialised body. Flagged, not left out"


@pytest.mark.parametrize(
    ("industry", "owner"),
    [("Industry super fund", "Member-owned"), ("Insurance", "A member-owned insurer")],
)
def test_an_industry_super_fund_or_a_member_owned_insurer_is_not_a_not_for_profit(
    industry: str, owner: str
) -> None:
    """Levi: large, well-funded member-owned organisations are not NFPs for this purpose."""
    result = verdict(
        industry_group="Standard not-for-profits", industry=fact(industry), owner=fact(owner)
    )
    assert result.excluded is None and result.result == "pass"
    flagged = check_of(result, "Excluded")
    assert flagged.outcome == "flag" and "member-owned" in flagged.detail


@pytest.mark.parametrize(
    "industry",
    [
        "Insurance",  # Budget Direct: insurance is one of Levi's priority sectors
        "Diversified financial services (wealth management, stockbroking, funds management)",
        "Investment management, annuities and retirement products",
        "Customer-owned (mutual) banking",
    ],
)
def test_an_insurer_a_fund_manager_or_a_customer_owned_bank_is_not_a_big_bank(
    industry: str,
) -> None:
    """The old group "Premium banks and finance" held all of them. Only the big four banks and
    other tier-one institutions are left out (Levi's section 3)."""
    result = verdict(industry_group="Premium banks and finance", industry=fact(industry))
    assert result.excluded is None and result.result == "pass"
    flagged = check_of(result, "Excluded")
    assert flagged.outcome == "flag" and "not a big bank" in flagged.detail


def test_a_real_charity_is_still_left_out() -> None:
    result = verdict(
        industry_group="Standard not-for-profits",
        industry=fact("Disability charity"),
        owner=fact("Not-for-profit, donations and grants"),
    )
    assert result.excluded is not None and result.excluded.reason_id == "not_for_profit"


def test_no_exclusion_leaves_the_card_without_one() -> None:
    result = verdict()
    assert result.excluded is None
    assert [c for c in result.checks if c.rule == "Excluded"] == []


def test_education_real_estate_and_hospitals_stay_a_director_review() -> None:
    """They aren't in Levi's list (TBC), so they are still a Director's decision."""
    for group in ("Education", "Real estate agencies", "Hospitals and healthcare"):
        result = verdict(industry_group=group)
        assert (result.result, result.excluded) == ("director_review", None), group


# --- The override ----------------------------------------------------------------------------


def test_an_override_judges_the_lead_as_if_the_exclusion_did_not_apply() -> None:
    facts = make_facts(industry_group="Law firms", industry=fact("Law practice"))
    left_out = judge(facts, NEW, RULES, TODAY)
    assert left_out.result == "drop"
    overridden = judge(
        facts, NEW, RULES, TODAY, overrides={"law_firm": Override(by="Al-khair Pama", at=WHEN)}
    )
    assert overridden.result == "pass" and overridden.score > 0
    assert overridden.parts  # scored now
    excluded = overridden.excluded
    assert excluded is not None  # the card still says it was left out
    assert (excluded.overridden_by, excluded.overridden_at) == ("Al-khair Pama", WHEN)
    flagged = check_of(overridden, "Excluded")
    assert flagged.outcome == "flag" and "Al-khair Pama overrode" in flagged.detail


def test_an_override_of_another_reason_changes_nothing() -> None:
    facts = make_facts(industry_group="Law firms")
    other = {"government": Override(by="Someone", at=WHEN)}
    assert judge(facts, NEW, RULES, TODAY, overrides=other).result == "drop"


def test_a_saved_override_is_found_again_when_the_lead_is_judged_again() -> None:
    card = {
        "excluded": {
            "reason_id": "law_firm",
            "label": "Law firm",
            "evidence": "x",
            "url": None,
            "overridden_by": "Al-khair Pama",
            "overridden_at": WHEN.isoformat(),
        }
    }
    found = overrides_of(card)
    assert list(found) == ["law_firm"] and found["law_firm"].by == "Al-khair Pama"
    assert found["law_firm"].at == WHEN
    assert overrides_of({"excluded": {"reason_id": "law_firm", "overridden_by": None}}) == {}
    assert overrides_of({}) == overrides_of({"excluded": None}) == {}


# --- The filters (section 2) -----------------------------------------------------------------


def test_a_good_lead_has_the_five_filters_in_levis_order() -> None:
    result = verdict()
    assert [f.id for f in result.filters] == [
        "location",
        "office_size",
        "headcount",
        "office_relevance",
        "sector",
    ]
    assert [f.label for f in result.filters] == [
        "Location",
        "Office size",
        "Headcount",
        "Office relevance",
        "Sector",
    ]
    by_id = filters_of(result)
    assert (by_id["location"].state, by_id["location"].basis) == (
        "pass",
        "Melbourne, a priority city",
    )
    assert (by_id["office_size"].state, by_id["office_size"].basis) == ("pass", "2,500 m²")
    assert (by_id["headcount"].state, by_id["headcount"].basis) == (
        "pass",
        "250 staff in the city",
    )
    assert by_id["office_relevance"].state == "estimated"  # nobody said: assumed from the industry
    assert by_id["sector"].state == "pass"


@pytest.mark.parametrize(
    ("place", "state", "words"),
    [
        ("Perth", "pass", "a priority city"),
        ("Sydney", "pass", "a secondary city"),
        ("Darwin", "pass", "a capital city"),
        ("Geelong", "pass", "a regional centre"),
        ("Albury NSW", "pass", "Check the city"),
        (None, "estimated", "City not known"),
    ],
)
def test_the_location_filter_passes_every_place_and_estimates_an_unknown_one(
    place: str | None, state: str, words: str
) -> None:
    result = verdict(city=fact(place), triggers=[])
    found = filters_of(result)["location"]
    assert (found.state, words in found.basis) == (state, True)


def test_the_location_filter_never_fails() -> None:
    for place in ("Melbourne", "Albury NSW", "Atlantis", None):
        assert filters_of(verdict(city=fact(place)))["location"].state != "fail"


@pytest.mark.parametrize(
    ("changes", "state", "words"),
    [
        ({}, "pass", "2,500 m²"),
        ({"office_m2": fact(2500, label="estimated")}, "estimated", "2,500 m²"),
        (
            {"office_m2": fact(None), "staff_in_city": fact(120)},
            "estimated",
            "1,200 m² (estimated: 120 staff x 10 m²)",  # Levi's own example
        ),
        ({"office_m2": fact(None), "staff_in_city": fact(None)}, "estimated", "not known"),
        ({"office_m2": fact(700)}, "fail", "too small"),
        ({"office_m2": fact(900)}, "estimated", "just under the minimum"),
        ({"office_m2": fact(7000)}, "pass", "over the top limit"),
    ],
)
def test_the_office_size_filter(changes: dict[str, Any], state: str, words: str) -> None:
    found = filters_of(verdict(**changes))["office_size"]
    assert found.state == state and words in found.basis


@pytest.mark.parametrize(
    ("changes", "state", "words"),
    [
        ({"staff_in_city": fact(100)}, "pass", "100 staff in the city"),
        ({"staff_in_city": fact(50), "office_m2": fact(None)}, "pass", "50 staff in the city"),
        (
            {"staff_in_city": fact(49), "office_m2": fact(None)},
            "fail",
            "49 staff in the city, under 50",
        ),
        (
            {"staff_in_city": fact(30), "staff_from_linkedin": True, "office_m2": fact(None)},
            "estimated",
            "60 staff in the city, estimated",  # a LinkedIn count is doubled, and is an estimate
        ),
        (
            {"staff_in_city": fact(100, label="estimated")},
            "estimated",
            "100 staff in the city, estimated",
        ),
        ({"staff_in_city": fact(None), "office_m2": fact(None)}, "estimated", "not known"),
        # A small company with a known big office isn't failed for its staff (version 2's rule)
        ({"staff_in_city": fact(20), "office_m2": fact(2000)}, "estimated", "carries it"),
    ],
)
def test_the_headcount_filter(changes: dict[str, Any], state: str, words: str) -> None:
    found = filters_of(verdict(**changes))["headcount"]
    assert found.state == state and words in found.basis


def grows(staff: int, needed_m2: int) -> dict[str, Any]:
    """A company with `staff` people that has raised money and plans an office of `needed_m2`."""
    return {
        "office_m2": fact(None),
        "staff_in_city": fact(staff),
        "growth_plan": fact(True),
        "size_needed_m2": fact(needed_m2),
        "growth_by": fact("2027-06"),
    }


def test_50_staff_hiring_100_qualifies_and_10_staff_hiring_20_does_not() -> None:
    """Levi's own two examples (section 2). 100 people need 1,000 m² at 10 m² each."""
    small = verdict(**grows(30, 1000))  # a path to 100 people
    found = filters_of(small)
    assert found["headcount"].state == "estimated" and "carries it" in found["headcount"].basis
    assert found["office_size"].state == "estimated" and "Growing into the range" in (
        found["office_size"].basis
    )
    assert small.result == "pass"
    tiny = verdict(**grows(10, 200))  # 20 people: no path to the size
    assert filters_of(tiny)["headcount"].state == "fail"
    assert tiny.result == "drop"


@pytest.mark.parametrize(
    ("changes", "state", "words"),
    [
        ({"office_matters": fact(True), "industry": fact("Software")}, "pass", "matters"),
        ({"office_matters": fact(False)}, "estimated", "may not matter"),
        (
            {"industry_group": "Hospitality", "industry": fact("Hotels")},
            "estimated",
            "site-heavy industry",
        ),
        ({}, "estimated", "Assumed from its industry (Software)"),
        ({"industry": fact(None)}, "estimated", "Not known"),
    ],
)
def test_the_office_relevance_filter(changes: dict[str, Any], state: str, words: str) -> None:
    found = filters_of(verdict(**changes))["office_relevance"]
    assert found.state == state and words in found.basis


def test_an_incidental_office_fails_the_relevance_filter_until_a_person_overrides() -> None:
    facts = make_facts(industry_group="Retail", office_matters=fact(False))
    assert filters_of(judge(facts, NEW, RULES, TODAY))["office_relevance"].state == "fail"
    override = {"office_incidental": Override(by="Al-khair Pama", at=WHEN)}
    after = judge(facts, NEW, RULES, TODAY, overrides=override)
    assert filters_of(after)["office_relevance"].state == "estimated"


def test_the_sector_filter_never_fails_and_a_priority_sector_is_named() -> None:
    priority = filters_of(verdict(tier_group="Technology and telecommunications"))["sector"]
    assert (priority.state, priority.basis) == (
        "pass",
        "Priority sector: Technology and telecommunications",
    )
    other = filters_of(verdict(tier_group=None))["sector"]
    assert other.state == "pass" and "not a priority sector" in other.basis
    assert filters_of(verdict(industry=fact(None), tier_group=None))["sector"].state == "estimated"


def test_an_unknown_fact_is_estimated_and_never_a_fail() -> None:
    """Choice 3: loose gates, strict evidence. Nothing known means nothing fails."""
    result = verdict(
        city=fact(None),
        office_m2=fact(None),
        staff_in_city=fact(None),
        industry=fact(None),
        triggers=[],
    )
    assert {f.state for f in result.filters} == {"estimated"}
    assert result.result == "watch"


def test_an_excluded_lead_still_shows_its_five_filters() -> None:
    result = verdict(industry_group="Law firms")
    assert len(result.filters) == 5
    assert result.result == "drop"


def test_the_extract_prompt_tells_claude_what_each_left_out_group_means() -> None:
    text = extract_prompt(RULES).text
    assert "- Law firms: a law firm of any size" in text
    assert "an industry super fund or a member-owned insurer, is not in it" in text
    assert "A government-owned corporation or a commercialised body is not in it" in text
    assert "- Premium banks and finance: only the big four banks" in text
    assert "- Education\n" in text  # a Director group has no meaning line
    assert "- tender_only:" in text and "Member-owned" in text
