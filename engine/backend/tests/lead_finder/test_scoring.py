"""The rules and the score, including the edge cases: 99 vs 100 staff, Sydney, an open deal."""

from datetime import date
from typing import Any

import pytest

from apps.lead_finder.fields import BoosterFound, TriggerFound
from apps.lead_finder.rules import load_rules
from apps.lead_finder.scoring import RuleCheck, Verdict, judge, parse_date
from core.hubspot.matching import CandidateReason, HubSpotMatch, MatchCandidate
from tests.lead_finder.samples import ASX, NEWS, fact, make_facts

TODAY = date(2026, 10, 26)
NEW = HubSpotMatch(status="new")


def trigger(id: str, when: str | None, url: str = NEWS) -> TriggerFound:
    return TriggerFound(
        id=id, what_happened=f"{id} happened", date=when, source_url=url, label="confirmed"
    )


def verdict(hubspot: HubSpotMatch = NEW, **changes: object):  # type: ignore[no-untyped-def]
    return judge(make_facts(**changes), hubspot, load_rules(), TODAY)


def test_a_good_lead_passes_with_its_score() -> None:
    result = verdict()
    assert result.result == "pass"
    # main trigger 35 + lease 1 to 3 years out 20 + other news 8 + pass 15
    assert result.score == 78
    assert result.fitout_aud == 2500 * 1500


def size_check(result: Verdict) -> RuleCheck:
    (check,) = [check for check in result.checks if check.rule == "Size"]
    return check


@pytest.mark.parametrize(
    ("staff", "expected", "outcome"),
    [
        (74, "pass", "flag"),  # below the hint: check the office size, never a Drop
        (75, "pass", "ok"),
        (99, "pass", "ok"),
        (100, "pass", "ok"),
        (600, "pass", "ok"),
        (601, "director_review", "director"),
    ],
)
def test_staff_is_only_a_hint_when_the_office_size_is_unknown(
    staff: int, expected: str, outcome: str
) -> None:
    result = verdict(office_m2=fact(None), staff_in_city=fact(staff))
    assert result.result == expected
    assert size_check(result).outcome == outcome
    assert result.office_m2 == staff * 10
    assert result.office_m2_estimated


GROWING: dict[str, Any] = {
    "office_m2": fact(None),
    "staff_in_city": fact(35),
    "growth_plan": fact(True),
    "size_needed_m2": fact(1500),
    "growth_by": fact("2027-06"),
}


def growing(**changes: Any) -> Verdict:
    """Like Southern Launch: 35 staff and no known office, but funding to grow to 150 staff."""
    return judge(make_facts(**{**GROWING, **changes}), NEW, load_rules(), TODAY)


def test_a_small_company_that_is_growing_into_the_range_fits() -> None:
    result = growing()
    assert result.result == "pass"
    assert (result.office_m2, result.office_m2_estimated) == (1500, True)
    assert result.fitout_aud == 1500 * 1500
    check = size_check(result)
    assert check.outcome == "ok"
    assert check.detail == "Growing into the range: will need about 1,500 m² by 2027-06"


@pytest.mark.parametrize(
    "changes",
    [
        {"growth_plan": fact(False)},
        {"growth_plan": fact(None)},
        {"size_needed_m2": fact(900)},  # still under the range
        {"size_needed_m2": fact(None)},
        {"growth_by": fact("2030-01")},  # further away than 24 months
    ],
)
def test_growth_needs_a_plan_a_big_enough_office_and_a_near_date(changes: dict[str, Any]) -> None:
    check = size_check(growing(**changes))
    assert "Growing" not in check.detail
    assert check.outcome == "flag"  # 35 staff is 350 m², below the staff hint


def test_growth_with_no_date_is_a_flag_to_check() -> None:
    result = growing(growth_by=fact(None))
    check = size_check(result)
    assert check.outcome == "flag"
    assert check.detail.endswith("When is not known, so check")
    assert result.result == "pass"  # a flag never changes the result


def test_growth_rescues_a_known_small_office_but_not_one_over_the_limit() -> None:
    small = {"office_m2": fact(400), "staff_in_city": fact(None)}
    assert growing(**small).result == "pass"  # 400 m² alone would be a Drop
    assert growing(**small, growth_plan=fact(False)).result == "drop"
    over = growing(office_m2=fact(7000), staff_in_city=fact(None))
    assert over.result == "director_review"
    assert size_check(over).detail == "7,000 m²: over the top limit"


def test_linkedin_staff_count_is_doubled() -> None:
    result = verdict(office_m2=fact(None), staff_in_city=fact(60), staff_from_linkedin=True)
    assert result.office_m2 == 1200
    assert result.result == "pass"


@pytest.mark.parametrize(
    ("m2", "expected"),
    [
        (799, "drop"),
        (800, "director_review"),
        (999, "director_review"),
        (1000, "pass"),
        (6000, "pass"),
        (6001, "director_review"),
    ],
)
def test_office_size_limits(m2: int, expected: str) -> None:
    assert verdict(office_m2=fact(m2), staff_in_city=fact(None)).result == expected


@pytest.mark.parametrize(
    ("place", "expected"),
    [
        ("Melbourne", "pass"),
        ("Cremorne, VIC", "pass"),
        ("West Perth", "pass"),
        ("Sydney", "director_review"),
        ("North Sydney", "director_review"),
        ("Brisbane", "director_review"),
    ],
)
def test_cities(place: str, expected: str) -> None:
    assert verdict(city=fact(place)).result == expected


def test_no_trigger_means_watch() -> None:
    result = verdict(triggers=[])
    assert result.result == "watch"
    assert result.triggers == []


def test_a_weak_trigger_still_counts_but_scores_lower() -> None:
    weak = verdict(triggers=[trigger("new_ceo", "2026-10-10")])
    assert weak.result == "pass"
    assert weak.score < verdict().score


def test_old_or_finished_triggers_dont_count() -> None:
    assert verdict(triggers=[trigger("merger_or_takeover", "2024-05")]).result == "watch"
    assert verdict(triggers=[trigger("lease_ending", "2026-01")]).result == "watch"
    assert verdict(triggers=[trigger("lease_ending", "2031-01")]).result == "watch"


def test_an_official_source_scores_higher_than_news() -> None:
    news = verdict(triggers=[trigger("big_new_contract", "2026-10-01", NEWS)])
    asx = verdict(triggers=[trigger("big_new_contract", "2026-10-01", ASX)])
    assert asx.score > news.score
    assert asx.triggers[0].source_kind == "asx_or_official_news"


def test_boosters_add_up_to_a_cap() -> None:
    boosters = [
        BoosterFound(id=b, evidence="yes", source_url=NEWS)
        for b in ("office_is_due", "buys_strategy", "can_pay", "no_rival_in_place")
    ]
    assert verdict(boosters=boosters).score == 78 + 15


def test_an_open_deal_is_never_suggested() -> None:
    hubspot = HubSpotMatch(status="open_deal", open_deals=["Acme 2,000 m²"])
    result = verdict(hubspot)
    assert result.result == "drop"
    assert result.score == 0


def test_a_recent_dissolved_deal_waits_unless_a_new_trigger_appears() -> None:
    hubspot = HubSpotMatch(status="dissolved_deal", last_dissolved=date(2026, 10, 1))
    assert verdict(hubspot, triggers=[trigger("fast_growth", "2026-09-01")]).result == "drop"
    assert verdict(hubspot, triggers=[trigger("fast_growth", "2026-10-20")]).result == "pass"
    old = HubSpotMatch(status="dissolved_deal", last_dissolved=date(2025, 6, 1))
    assert verdict(old).result == "pass"


def test_unhealthy_is_dropped_but_unknown_local_team_is_not() -> None:
    assert verdict(healthy=fact(False)).result == "drop"
    assert verdict(local_team_runs_project=fact(None)).result == "pass"


def office_check(result: Verdict) -> RuleCheck:
    (check,) = [check for check in result.checks if check.rule == "Office"]
    return check


def test_law_firms_and_other_director_sectors_go_to_a_director() -> None:
    result = verdict(industry_group="Law firms")
    assert result.result == "director_review"
    assert office_check(result).outcome == "director"


def test_a_miners_head_office_is_not_flagged_for_its_industry() -> None:
    miner = verdict(
        industry=fact("Mining"), industry_group="Mining and metals", office_matters=fact(True)
    )
    check = office_check(miner)
    assert (check.outcome, check.detail) == ("ok", "Mining: the office matters to how they work")
    assert miner.result == "pass"


def test_a_company_that_works_from_sites_is_flagged_to_check_the_office() -> None:
    result = verdict(industry=fact("Warehousing"), office_matters=fact(False))
    check = office_check(result)
    assert check.outcome == "flag"
    assert check.detail.endswith("Check the office size")
    assert result.result == "pass"  # a flag, never a Drop


def test_when_it_is_unclear_only_a_site_heavy_industry_is_flagged() -> None:
    mining = verdict(industry=fact("Mining"), industry_group="Mining and metals")
    assert office_check(mining).outcome == "flag"
    assert office_check(verdict()).outcome == "ok"  # software, nothing known about the office
    assert office_check(verdict(industry=fact(None))).outcome == "unknown"


def test_unknown_size_with_a_trigger_needs_a_check() -> None:
    assert verdict(office_m2=fact(None), staff_in_city=fact(None)).result == "watch"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-10-14", date(2026, 10, 14)),
        ("2026-10", date(2026, 10, 1)),
        ("2027", date(2027, 7, 1)),
        ("soon", None),
        (None, None),
    ],
)
def test_parse_date(text: str | None, expected: date | None) -> None:
    assert parse_date(text) == expected


# --- A possible match in HubSpot: a flag a person confirms, never a drop -----------------------


def candidate(
    name: str, reason: CandidateReason = "close_name", open_deals: list[str] | None = None
) -> MatchCandidate:
    return MatchCandidate(
        hubspot_id=name,
        name=name,
        owner=None,
        reason=reason,
        score=0.92,
        open_deals=open_deals or [],
    )


def hubspot_check(result: Verdict) -> RuleCheck:
    (check,) = [check for check in result.checks if check.rule == "HubSpot"]
    return check


@pytest.mark.parametrize(
    ("reason", "words"),
    [
        ("close_name", "close name"),
        ("name_in_deal", "name in a deal"),
        ("similar_profile", "similar profile"),
    ],
)
def test_a_possible_match_is_flagged_and_changes_nothing_else(
    reason: CandidateReason, words: str
) -> None:
    hubspot = HubSpotMatch(status="possible_match", candidates=[candidate("Acme Group", reason)])
    result = verdict(hubspot)
    assert (result.result, result.score) == (verdict().result, verdict().score)  # pass, 78
    check = hubspot_check(result)
    assert check.outcome == "flag"
    assert check.detail == f"Possible match with Acme Group ({words}). A person confirms."


def test_a_possible_match_says_when_a_candidate_has_an_open_deal() -> None:
    hubspot = HubSpotMatch(
        status="possible_match",
        candidates=[
            candidate("Acme Group", open_deals=["Acme MEL 2,000m2 Office"]),
            candidate("Acme Holdings"),
            candidate("Acme Partners", open_deals=["Acme Partners fitout"]),
        ],
    )
    result = verdict(hubspot)
    assert result.result == "pass"  # an open deal of a maybe-match never drops the lead
    assert hubspot_check(result).detail == (
        "Possible match with Acme Group (close name). A person confirms. It has an open deal."
        " Acme Partners has an open deal."
    )


def test_a_possible_match_with_no_candidate_still_asks_a_person() -> None:
    check = hubspot_check(verdict(HubSpotMatch(status="possible_match")))
    assert (check.outcome, check.detail) == (
        "flag",
        "Possible match in HubSpot. A person confirms.",
    )
