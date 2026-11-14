"""Levi's dampeners (his section 5, PLAN-V16 T1-5): facts that lower a lead's score. No rule
check fails because of one, and none excludes a lead.

Every lead lists the five. Each is found, not found (checked, nothing shown: never written as
"none") or not checked (nobody could check). The points they take off (strong 20, moderate 10) are
the score's (T1-6, and `test_scoring.py`).
"""

from datetime import UTC, date, datetime
from typing import Any

import pytest

from apps.lead_finder.fields import CompanyFacts, DampenerFinding, TriggerFound
from apps.lead_finder.rules import load_rules
from apps.lead_finder.scoring import Dampener, Override, Verdict, judge
from apps.lead_finder.sources import check_sources
from core.hubspot.matching import HubSpotMatch
from tests.lead_finder.samples import (
    ASX,
    NEWS,
    SITE,
    fact,
    found_dampener,
    make_facts,
    no_dampeners,
    with_dampeners,
)

TODAY = date(2026, 10, 26)
RULES = load_rules()
NEW = HubSpotMatch(status="new")
OTHER_PAGE = "https://www.afr.com/property/another-page"
IDS = ["recent_fitout", "outsourcing", "competitor_tie", "procurement", "financial_stress"]


def verdict(**changes: Any) -> Verdict:
    return judge(make_facts(**changes), NEW, RULES, TODAY)


def one(dampener_id: str, **changes: Any) -> Dampener:
    (found,) = [item for item in verdict(**changes).dampeners if item.id == dampener_id]
    return found


def sign(sign_id: str, when: str = "2026-09-01") -> TriggerFound:
    return TriggerFound(
        id=sign_id,
        what_happened=f"{sign_id} happened",
        date=when,
        source_url=NEWS,
        label="confirmed",
    )


# --- The list -------------------------------------------------------------------------------


def test_every_lead_lists_the_five_dampeners_in_the_rules_order() -> None:
    result = verdict()
    assert [item.id for item in result.dampeners] == IDS
    assert [item.label for item in result.dampeners] == [r.label for r in RULES.criteria.dampeners]


def test_a_dropped_lead_lists_them_too() -> None:
    result = verdict(industry_group="Law firms")
    assert result.result == "drop" and result.excluded is not None
    assert [item.id for item in result.dampeners] == IDS


def test_nothing_found_is_not_found_and_never_none() -> None:
    """All four checks were answered and show nothing, and the company is healthy."""
    result = verdict()
    for item in result.dampeners:
        assert item.state == "not_found", item.id
        assert (item.strength, item.evidence, item.date, item.url) == (None, None, None, None)
        assert (item.can_reverse, item.waived) == (None, None)


def test_a_card_made_before_the_check_says_not_checked_not_not_found() -> None:
    """No answer, no dates: nobody looked, so it says nothing either way."""
    states = {item.id: item.state for item in verdict(dampeners=[], healthy=fact(None)).dampeners}
    assert states == dict.fromkeys(IDS, "not_checked")


def test_a_check_the_answer_missed_is_not_checked() -> None:
    answers = no_dampeners(except_for=["outsourcing"])
    states = {item.id: item.state for item in verdict(dampeners=answers).dampeners}
    assert states["outsourcing"] == "not_checked"
    assert states["competitor_tie"] == "not_found"


def test_a_dampener_adds_no_rule_of_its_own() -> None:
    """All four found: no rule check fails and nothing is excluded. They only cost points, so the
    score falls (the tier, and so the result, follow it)."""
    answers = with_dampeners(
        found_dampener("recent_fitout", date="2026-01"),
        found_dampener("outsourcing"),
        found_dampener("competitor_tie"),
        found_dampener("procurement", kind="offshore_buying"),
    )
    result = verdict(dampeners=answers)
    assert [item.state for item in result.dampeners[:4]] == ["found"] * 4
    assert result.excluded is None
    assert not [
        check for check in result.checks if check.outcome == "fail" and check.rule != "Tier"
    ]
    assert result.score < verdict().score


# --- A fitout or move in that city ----------------------------------------------------------


@pytest.mark.parametrize(
    ("last_fitout", "strength"),
    [
        ("2026-09", "strong"),  # 1 month
        ("2025-06", "strong"),  # about 16 months
        ("2023-10-28", "strong"),  # 2.998 years: inside his 3
        ("2023-10-20", "moderate"),  # 3.02 years
        ("2023-03", "moderate"),
        ("2021-12", "moderate"),  # 4.9 years
        ("2021-01", None),  # 5.8 years: too long ago to count
        ("2016", None),
    ],
)
def test_a_fitout_is_strong_in_3_years_and_moderate_to_5(
    last_fitout: str, strength: str | None
) -> None:
    item = one("recent_fitout", last_fitout=fact(last_fitout))
    if strength is None:
        assert (item.state, item.strength, item.evidence) == ("not_found", None, None)
        return
    assert (item.state, item.strength) == ("found", strength)
    assert item.date == last_fitout and item.url == NEWS
    assert item.evidence is not None and item.evidence.startswith("Last fitout in ")


def test_a_move_in_counts_as_a_move() -> None:
    item = one("recent_fitout", office_since=fact("2025-01"))
    assert (item.state, item.strength) == ("found", "strong")
    assert item.evidence == "Moved into its current office in January 2025."


def test_a_move_in_the_last_year_is_a_watch_and_a_strong_dampener() -> None:
    """PLAN-V11's rule stays: it is the strongest case of the first dampener."""
    result = verdict(office_since=fact("2026-03"))
    assert result.result == "watch"
    assert result.dampeners[0].strength == "strong"


def test_the_newest_date_decides() -> None:
    old_move_new_fitout = one(
        "recent_fitout", office_since=fact("2016"), last_fitout=fact("2025-06")
    )
    assert old_move_new_fitout.evidence == "Last fitout in June 2025."
    new_move_older_fitout = one(
        "recent_fitout", office_since=fact("2025-09"), last_fitout=fact("2025-01")
    )
    assert new_move_older_fitout.evidence == "Moved into its current office in September 2025."


def test_a_date_to_come_is_not_a_fitout_yet() -> None:
    assert one("recent_fitout", last_fitout=fact("2027-03")).state == "not_found"
    # ...and with no answer at all, a date to come tells us nothing about the past
    assert one("recent_fitout", last_fitout=fact("2027-03"), dampeners=[]).state == "not_checked"


def test_an_old_fitout_in_the_facts_is_a_check_that_ran() -> None:
    assert one("recent_fitout", last_fitout=fact("2019"), dampeners=[]).state == "not_found"


def test_claudes_answer_is_the_evidence() -> None:
    answer = found_dampener(
        "recent_fitout",
        "It moved into a new Collins Street office in March 2025.",
        date="2025-03",
        url=ASX,
        can_reverse="Its lease has a break option in 2027.",
    )
    item = one("recent_fitout", dampeners=with_dampeners(answer))
    assert (item.state, item.strength) == ("found", "strong")
    assert item.evidence == "It moved into a new Collins Street office in March 2025."
    assert (item.date, item.url) == ("2025-03", ASX)
    assert item.can_reverse == "Its lease has a break option in 2027."


def test_an_answer_that_is_too_old_does_not_count() -> None:
    answer = found_dampener("recent_fitout", date="2019-05")
    assert one("recent_fitout", dampeners=with_dampeners(answer)).state == "not_found"


def test_an_answer_with_no_date_counts_as_moderate_and_says_so() -> None:
    answer = found_dampener("recent_fitout", "It fitted out its Melbourne office.")
    item = one("recent_fitout", dampeners=with_dampeners(answer))
    assert (item.state, item.strength, item.date) == ("found", "moderate", None)
    assert item.evidence == "It fitted out its Melbourne office. (date not known)"


def test_on_the_same_day_the_answer_wins_over_the_facts() -> None:
    answer = found_dampener("recent_fitout", "Claude's words.", date="2025-06", url=ASX)
    item = one("recent_fitout", dampeners=with_dampeners(answer), last_fitout=fact("2025-06"))
    assert (item.evidence, item.url) == ("Claude's words.", ASX)


# --- The outgrow rule (still listed if hiring would outgrow the space in 24 months) ------------

GROWING: dict[str, Any] = {
    "last_fitout": fact("2025-06"),
    "office_m2": fact(1200),
    "growth_plan": fact(True),
    "size_needed_m2": fact(2400),
    "growth_by": fact("2027-06"),
}


def test_a_strong_fitout_takes_nothing_off_when_hiring_will_outgrow_the_space() -> None:
    item = one("recent_fitout", **GROWING)
    assert (item.state, item.strength) == ("found", "strong")  # it is still shown as found
    assert item.waived == (
        "Takes nothing off: it says it will need about 2,400 m² by 2027-06, "
        "more than the 1,200 m² it has now."
    )


def test_the_space_it_has_now_can_come_from_its_staff() -> None:
    """No floor area known: about 10 m² a person, as the size rule works it out."""
    item = one("recent_fitout", **{**GROWING, "office_m2": fact(None), "staff_in_city": fact(120)})
    assert item.waived is not None and "more than the 1,200 m² it has now" in item.waived


@pytest.mark.parametrize(
    "changes",
    [
        {"growth_by": fact("2029-01")},  # further than 24 months
        {"growth_by": fact(None)},  # when is not known
        {"size_needed_m2": fact(1200)},  # no more than it has
        {"size_needed_m2": fact(900)},
        {"size_needed_m2": fact(None)},
        {"growth_plan": fact(None)},  # no plan to hire a lot
        {"growth_plan": fact(False)},
        {"office_m2": fact(None), "staff_in_city": fact(None)},  # nothing to compare with
    ],
)
def test_the_outgrow_rule_needs_all_of_it(changes: dict[str, Any]) -> None:
    item = one("recent_fitout", **{**GROWING, **changes})
    assert item.state == "found" and item.waived is None


def test_the_24_months_end_after_october_2028() -> None:
    assert one("recent_fitout", **{**GROWING, "growth_by": fact("2028-10")}).waived is not None
    assert one("recent_fitout", **{**GROWING, "growth_by": fact("2028-11")}).waived is None


def test_growth_does_not_make_a_moderate_or_missing_dampener_anything() -> None:
    old = one("recent_fitout", **{**GROWING, "last_fitout": fact("2019")})
    assert (old.state, old.waived) == ("not_found", None)


# --- An outsourcing deal and a tie to a competitor ----------------------------------------------


def test_an_outsourcing_deal_is_strong() -> None:
    answer = found_dampener(
        "outsourcing",
        "CBRE named it as a client of its national outsourcing deal.",
        date="2025-02-10",
        url=OTHER_PAGE,
        can_reverse="The deal's term ends in 2028.",
    )
    item = one("outsourcing", dampeners=with_dampeners(answer))
    assert (item.state, item.strength) == ("found", "strong")
    assert item.evidence == "CBRE named it as a client of its national outsourcing deal."
    assert (item.date, item.url) == ("2025-02-10", OTHER_PAGE)
    assert item.can_reverse == "The deal's term ends in 2028."


def test_a_tie_to_a_competitor_is_moderate() -> None:
    answer = found_dampener("competitor_tie", "Hassell delivered 3 of its projects.")
    item = one("competitor_tie", dampeners=with_dampeners(answer))
    assert (item.state, item.strength) == ("found", "moderate")


@pytest.mark.parametrize("check", ["outsourcing", "competitor_tie"])
def test_a_found_check_with_no_words_says_what_it_is(check: str) -> None:
    item = one(check, dampeners=with_dampeners(found_dampener(check, "")))  # type: ignore[arg-type]
    assert item.evidence == next(r.label for r in RULES.criteria.dampeners if r.id == check)


@pytest.mark.parametrize("check", ["outsourcing", "competitor_tie", "procurement"])
def test_not_found_and_not_checked_are_different(check: str) -> None:
    assert one(check).state == "not_found"
    assert one(check, dampeners=no_dampeners(except_for=[check])).state == "not_checked"  # type: ignore[list-item]


# --- Procurement red flags ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "strength"),
    [
        ("tender_portal", "strong"),
        ("offshore_buying", "strong"),
        ("lowest_price", "moderate"),
        ("separate_design_and_build", "moderate"),
        (None, "moderate"),  # a flag with no kind
        ("made_up", "moderate"),
    ],
)
def test_a_red_flag_is_strong_or_moderate_by_its_kind(kind: str | None, strength: str) -> None:
    answer = found_dampener("procurement", "It buys by tender.", kind=kind)
    item = one("procurement", dampeners=with_dampeners(answer))
    assert (item.state, item.strength) == ("found", strength)


def test_buying_through_tender_portals_only_is_a_strong_flag_from_the_fact() -> None:
    result = verdict(tender_only=fact(True, OTHER_PAGE))
    item = result.dampeners[3]
    assert (item.id, item.state, item.strength, item.url) == (
        "procurement",
        "found",
        "strong",
        OTHER_PAGE,
    )
    assert item.evidence == (
        "A note says it buys its office fitouts only through formal public tender portals."
    )
    assert result.result == "drop" and result.excluded is not None  # the exclusion is separate


def test_a_person_who_overrides_the_tender_exclusion_still_sees_the_flag() -> None:
    now = datetime(2026, 11, 15, 9, 30, tzinfo=UTC)
    result = judge(
        make_facts(tender_only=fact(True, OTHER_PAGE)),
        NEW,
        RULES,
        TODAY,
        overrides={"tender_only": Override(by="A Director", at=now)},
    )
    assert result.excluded is not None and result.excluded.overridden_by == "A Director"
    assert result.result == "watch"  # 72 - 6 - 20 = 46: Tier C
    assert (result.dampeners[3].state, result.dampeners[3].strength) == ("found", "strong")


def test_the_stronger_flag_wins_and_the_answer_wins_a_tie() -> None:
    weak = found_dampener("procurement", "Lowest-price tenders.", kind="lowest_price", url=ASX)
    stronger = one("procurement", dampeners=with_dampeners(weak), tender_only=fact(True, NEWS))
    assert (stronger.strength, stronger.url) == ("strong", NEWS)
    tie = found_dampener("procurement", "A tender portal.", kind="tender_portal", url=ASX)
    same = one("procurement", dampeners=with_dampeners(tie), tender_only=fact(True, NEWS))
    assert (same.evidence, same.url) == ("A tender portal.", ASX)


def test_buying_some_other_way_is_not_a_flag() -> None:
    assert one("procurement", tender_only=fact(False, NEWS)).state == "not_found"


# --- Financial stress ---------------------------------------------------------------------------


def test_financial_stress_comes_from_the_health_fact() -> None:
    stressed = one("financial_stress", healthy=fact(False, ASX))
    assert (stressed.state, stressed.strength, stressed.url) == ("found", "strong", ASX)
    assert stressed.date == "2026-10-01" and stressed.waived is None
    assert stressed.evidence == "A note says it is in administration, or cutting staff fast."
    assert one("financial_stress", healthy=fact(True, ASX)).state == "not_found"
    assert one("financial_stress", healthy=fact(None)).state == "not_checked"


@pytest.mark.parametrize("sign_id", ["office_consolidation", "merger_or_takeover"])
def test_financial_stress_takes_nothing_off_in_a_consolidation_that_creates_a_move(
    sign_id: str,
) -> None:
    item = one("financial_stress", healthy=fact(False, ASX), triggers=[sign(sign_id)])
    label = next(s.label for s in RULES.criteria.triggers.every if s.id == sign_id)
    assert (item.state, item.strength) == ("found", "strong")  # still shown as found
    assert item.waived == (
        f"Takes nothing off: it is part of a consolidation that creates a move ({label})."
    )


def test_a_sign_that_is_not_a_consolidation_does_not_waive_it() -> None:
    item = one(
        "financial_stress", healthy=fact(False, ASX), triggers=[sign("lease_ending", "2028-03")]
    )
    assert item.waived is None


def test_a_waiver_needs_the_sign_to_count() -> None:
    """A consolidation sign older than 18 months is ignored, so it can't waive anything."""
    item = one(
        "financial_stress",
        healthy=fact(False, ASX),
        triggers=[sign("office_consolidation", "2024-01")],
    )
    assert item.waived is None


# --- Claude's answer and the source check --------------------------------------------------------

READ = [NEWS, ASX, SITE, OTHER_PAGE]  # every page the Acme sample's facts cite


def checked(facts: CompanyFacts) -> tuple[list[DampenerFinding], list[str]]:
    result = check_sources(facts, READ, RULES.criteria)
    return result.facts.dampeners, result.dropped


def test_a_found_dampener_needs_a_page_that_was_read() -> None:
    kept = found_dampener("outsourcing", "CBRE's client.", url=OTHER_PAGE)
    unread = found_dampener("competitor_tie", "A tie.", url="https://invented.example.com/page")
    nothing = found_dampener("procurement", "A flag.", url=None, kind="lowest_price")
    findings, dropped = checked(make_facts(dampeners=[kept, unread, nothing]))
    assert [finding.id for finding in findings] == ["outsourcing"]
    assert len(dropped) == 2
    assert dropped[0].startswith("dampener competitor_tie: link not among the pages read")
    assert dropped[1] == "dampener procurement: no source link. Marked not checked."


def test_a_check_with_no_good_source_goes_back_to_not_checked_not_to_not_found() -> None:
    answers = with_dampeners(
        found_dampener("outsourcing", "A claim.", url="https://x.example.com/")
    )
    findings, _ = checked(make_facts(dampeners=answers))
    states = {item.id: item.state for item in verdict(dampeners=findings).dampeners}
    assert states["outsourcing"] == "not_checked"  # nobody showed it either way
    assert states["competitor_tie"] == "not_found"


def test_a_blocked_site_is_no_source() -> None:
    answer = found_dampener("outsourcing", "A claim.", url="https://www.zoominfo.com/c/acme")
    findings, dropped = checked(make_facts(dampeners=[answer]))
    assert findings == [] and "blocked site" in dropped[0]


def test_not_found_keeps_no_text_and_no_link() -> None:
    wordy = DampenerFinding(
        id="outsourcing",
        state="not_found",
        evidence="It might have one.",
        date="2025-01",
        source_url="https://invented.example.com/",
        kind="lowest_price",
        can_reverse="Maybe.",
    )
    findings, dropped = checked(make_facts(dampeners=[wordy]))
    (kept,) = findings
    assert kept.state == "not_found"
    assert (kept.evidence, kept.date, kept.source_url, kept.kind, kept.can_reverse) == (
        None,
        None,
        None,
        None,
        None,
    )
    assert dropped == []


def test_each_check_is_kept_once_the_first_answer() -> None:
    first = found_dampener("outsourcing", "First.", url=NEWS)
    second = found_dampener("outsourcing", "Second.", url=ASX)
    findings, _ = checked(make_facts(dampeners=[first, second]))
    assert [(finding.id, finding.evidence) for finding in findings] == [("outsourcing", "First.")]


def test_only_procurement_has_a_kind_and_it_must_be_one_the_rules_name() -> None:
    answers = [
        found_dampener("procurement", "A flag.", kind="made_up"),
        found_dampener("outsourcing", "A deal.", kind="tender_portal"),
        found_dampener("competitor_tie", "A tie.", url=ASX),
    ]
    by_id = {item.id: item for item in checked(make_facts(dampeners=answers))[0]}
    assert by_id["procurement"].kind is None
    assert by_id["outsourcing"].kind is None
    right = found_dampener("procurement", "A flag.", kind="tender_portal")
    assert checked(make_facts(dampeners=[right]))[0][0].kind == "tender_portal"


# --- The answer form -----------------------------------------------------------------------------


def test_the_answer_cleans_empty_text_and_cuts_long_text() -> None:
    parsed = DampenerFinding.model_validate(
        {
            "id": "outsourcing",
            "state": "found",
            "evidence": "  A  deal\nwith JLL. " + "x" * 400,
            "date": "",
            "source_url": NEWS,
            "kind": " ",
            "can_reverse": "",
        }
    )
    assert parsed.evidence is not None and len(parsed.evidence) == 300
    assert parsed.evidence.startswith("A deal with JLL. xxx")
    assert (parsed.date, parsed.kind, parsed.can_reverse) == (None, None, None)


def test_an_answer_with_a_made_up_check_or_state_does_not_fit_the_form() -> None:
    base = {"evidence": "", "date": "", "source_url": "", "kind": "", "can_reverse": ""}
    with pytest.raises(ValueError, match="id"):
        DampenerFinding.model_validate({**base, "id": "financial_stress", "state": "found"})
    with pytest.raises(ValueError, match="state"):
        DampenerFinding.model_validate({**base, "id": "outsourcing", "state": "none"})


def test_a_card_saved_before_the_check_still_loads() -> None:
    old = make_facts().model_dump(mode="json")
    del old["dampeners"]
    assert CompanyFacts.model_validate(old).dampeners == []
