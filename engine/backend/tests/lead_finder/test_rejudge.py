"""Judging a saved lead again with the current rules, from its card (PLAN-V2 D1)."""

from datetime import date
from typing import Any

from apps.lead_finder.rejudge import rejudge, table
from apps.lead_finder.rules import load_rules
from tests.lead_finder.samples import fact, make_facts

RULES = load_rules()
TODAY = date(2026, 10, 30)
NEW_FACTS = (
    "growth_plan",
    "size_needed_m2",
    "growth_by",
    "office_matters",
    "tier_group",
    "office_since",
    "last_fitout",
    "fitout_contractors",
    "talking_points",
)


def version_1_card(industry_check: str = "ok", **changes: Any) -> dict[str, Any]:
    """A card as version 1 saved it: no newer facts, and an Industry check."""
    facts = make_facts(**changes).model_dump(mode="json")
    for name in NEW_FACTS:
        del facts[name]
    return {
        "facts": facts,
        "hubspot": {
            "status": "new",
            "hubspot_id": None,
            "name": None,
            "owner": None,
            "matched_by": None,
            "open_deals": [],
            "last_dissolved": None,
            "candidates": [],
        },
        "checks": [
            {"rule": "Size", "outcome": "director", "detail": "990 m²: just under the minimum"},
            {"rule": "Industry", "outcome": industry_check, "detail": "saved by version 1"},
            {"rule": "City", "outcome": "ok", "detail": "Melbourne"},
        ],
    }


def test_an_older_card_is_judged_by_the_current_rules() -> None:
    card = version_1_card(office_m2=fact(None), staff_in_city=fact(99))
    item = rejudge("Acme Software", "director_review", 70, card, RULES, TODAY)
    assert item.now.result == "pass"  # 99 staff meets the hint (version 1 sent it to a Director)
    assert item.now.score_checked > 0
    assert item.now.stage == "Active prospect"
    assert (item.was_result, item.was_score) == ("director_review", 70)


def test_it_says_which_rule_checks_changed_in_plain_words() -> None:
    card = version_1_card(office_m2=fact(None), staff_in_city=fact(99))
    item = rejudge("Acme Software", "director_review", 70, card, RULES, TODAY)
    # Size went from a Director's call to met. The old Industry check was met and the Office
    # check is met too, so it isn't reported.
    assert item.changes == ["Size: Director review to met"]


def test_the_old_industry_check_is_compared_with_the_office_check() -> None:
    # A site-heavy industry was a flag. A version 1 card has no "the office matters", so the
    # Office check is a flag too, and nothing changed. If the old check had been met, it would.
    mining = {"industry": fact("Mining"), "industry_group": "Mining and metals"}
    same = rejudge("Acme Mining", "pass", 78, version_1_card("flag", **mining), RULES, TODAY)
    assert not any(change.startswith("Office") for change in same.changes)
    moved = rejudge("Acme Mining", "pass", 78, version_1_card("ok", **mining), RULES, TODAY)
    assert "Office: met to check" in moved.changes


def test_a_dropped_small_company_may_no_longer_be_dropped() -> None:
    card = version_1_card(office_m2=fact(None), staff_in_city=fact(60))
    item = rejudge("Small Co", "drop", 0, card, RULES, TODAY)
    assert item.now.result == "watch"  # 50 to 74 staff: a Watch with a flag (PLAN-V9 B1)
    assert item.now.band is not None


def test_a_pass_under_the_staff_floor_becomes_a_drop() -> None:
    card = version_1_card(office_m2=fact(None), staff_in_city=fact(28))
    item = rejudge("Tiny Co", "pass", 60, card, RULES, TODAY)
    assert item.now.result == "drop"  # under 50 staff: too small (PLAN-V9 B1)


def test_the_table_lists_each_lead_and_counts_the_moves() -> None:
    card = version_1_card(office_m2=fact(None), staff_in_city=fact(99))
    items = [
        rejudge("Acme Software", "director_review", 70, card, RULES, TODAY),
        rejudge("Same Co", "pass", 78, version_1_card(), RULES, TODAY),
    ]
    text = table(items)
    assert "Acme Software" in text and "Same Co" in text
    assert "Size: Director review to met" in text
    assert text.endswith("2 leads, 1 with a different result.")
