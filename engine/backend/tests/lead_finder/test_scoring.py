"""The rules and the score, including the edge cases: 99 vs 100 staff, Sydney, an open deal."""

from datetime import date
from typing import Any

import pytest

from apps.lead_finder.fields import BoosterFound, TriggerFound
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.scoring import (
    RuleCheck,
    ScoreCheck,
    ScorePart,
    Verdict,
    band_of,
    judge,
    parse_date,
)
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


def with_size(**changes: object) -> LeadFinderRules:
    """The rules with some size numbers changed, like the 75-staff hint of 5 Nov."""
    rules = load_rules()
    size = rules.criteria.size.model_copy(update=changes)
    criteria = rules.criteria.model_copy(update={"size": size})
    return rules.model_copy(update={"criteria": criteria})


def verdict_under(rules: LeadFinderRules, **changes: object) -> Verdict:
    return judge(make_facts(**changes), NEW, rules, TODAY)


# Before 9 Nov: 75+ staff fit, and 50 to 74 was a Watch (PLAN-V9 B1). The code keeps that band
# for when the rules open it again; since 9 Nov the hint and the floor are both 50 (PLAN-V11 B2).
HINT_75 = with_size(staff_hint_min=75, staff_min=100)


def test_a_good_lead_passes_with_its_score() -> None:
    result = verdict()
    assert result.result == "pass"
    # trigger part: main trigger 15 + other news 5. Size: 2,500 m² confirmed 20. Timing: a lease
    # 1 to 3 years out 6. Access: a contact role 5. Nothing found for fit or competition.
    assert result.score == 15 + 5 + 20 + 6 + 5
    assert result.fitout_aud == 2500 * 1500


def part_of(result: Verdict, id: str) -> ScorePart:
    return next(part for part in result.parts if part.id == id)


def score_check(result: Verdict, id: str) -> ScoreCheck:
    return next(check for part in result.parts for check in part.checks if check.id == id)


def test_the_score_has_the_profiles_six_parts() -> None:
    result = verdict()
    assert [(p.id, p.max) for p in result.parts] == [
        ("trigger", 25),
        ("size", 20),
        ("timing", 15),
        ("access", 15),
        ("fit", 15),
        ("competition", 10),
    ]
    assert [p.earned for p in result.parts] == [20, 20, 6, 5, 0, 0]
    assert sum(p.earned for p in result.parts) == result.score == 51
    # Checked: trigger 15 + 10, size 20, recency 6, contact role 5, strategy 8, tier 7, rival 6.
    assert result.score_checked == 77
    assert result.band == "investigate"  # 51 of 77 checked counts as 66
    assert result.score <= result.score_checked <= 100


def test_the_trigger_points_are_the_sum_of_their_three_parts() -> None:
    (best,) = verdict().triggers
    assert (best.group_points, best.source_points, best.timing_points) == (15, 5, 6)
    assert best.points == 15 + 5 + 6


def test_checks_the_tool_cannot_judge_are_not_known_yet() -> None:
    result = verdict()
    for id in ("hubspot_contact", "customer_link", "no_contractor_relationship"):
        check = score_check(result, id)
        assert (check.known, check.earned) == (False, 0)
    # Nothing is said about the years at the address or a recent move, so they are not known either.
    assert not score_check(result, "years_at_address").known
    assert not score_check(result, "no_recent_move").known


def test_the_years_at_the_address_and_a_quiet_office_earn_timing_points() -> None:
    base = verdict()
    due = verdict(office_since=fact("2015"))
    assert score_check(due, "years_at_address").earned == 5
    assert score_check(due, "no_recent_move").earned == 4
    assert part_of(due, "timing").earned == 6 + 5 + 4
    assert due.score_checked == base.score_checked + 5 + 4  # both checks are now known
    # Moved in last year: known, but it earns nothing for years or a quiet office.
    moved = verdict(office_since=fact("2026-02"))
    assert (
        score_check(moved, "years_at_address").known,
        score_check(moved, "years_at_address").earned,
    ) == (True, 0)
    assert score_check(moved, "no_recent_move").earned == 0


@pytest.mark.parametrize(
    ("group", "points"),
    [
        ("Technology and telecommunications", 7),
        ("Defence and advanced manufacturing", 4),
        (None, 0),
    ],
)
def test_the_industry_tier_adds_points_to_strategic_fit(group: str | None, points: int) -> None:
    assert score_check(verdict(tier_group=group), "industry_tier").earned == points


def test_the_industry_tier_is_not_known_when_the_industry_is_not() -> None:
    assert not score_check(verdict(industry=fact(None)), "industry_tier").known


@pytest.mark.parametrize(
    ("changes", "points"),
    [
        ({}, 20),  # 2,500 m², confirmed
        ({"office_m2": fact(2500, label="estimated")}, 16),
        ({"office_m2": fact(None), "staff_in_city": fact(100)}, 16),  # worked out from staff
        ({"office_m2": fact(900)}, 10),  # just under the minimum: a Director decides
        ({"office_m2": fact(None), "staff_in_city": fact(60)}, 16),  # 50+ fits since 9 Nov
    ],
)
def test_the_size_check_follows_what_the_size_rests_on(
    changes: dict[str, Any], points: int
) -> None:
    check = score_check(verdict(**changes), "size")
    assert (check.earned, check.known, check.max) == (points, True, 20)


def test_a_growing_company_earns_the_growing_points() -> None:
    assert score_check(growing(), "size").earned == 14


def test_an_unknown_size_is_not_known_yet() -> None:
    check = score_check(verdict(office_m2=fact(None), staff_in_city=fact(None)), "size")
    assert (check.known, check.earned) == (False, 0)


@pytest.mark.parametrize(
    ("changes", "result", "stage"),
    [
        ({}, "pass", "Active prospect"),
        ({"city": fact("Sydney")}, "director_review", "Active prospect"),
        ({"triggers": []}, "watch", "Target account"),
        ({"healthy": fact(False)}, "drop", "Not a target"),
    ],
)
def test_every_result_has_the_profiles_stage(
    changes: dict[str, Any], result: str, stage: str
) -> None:
    verdict_ = verdict(**changes)
    assert (verdict_.result, verdict_.stage) == (result, stage)


def test_a_drop_scores_zero_and_has_no_parts() -> None:
    result = verdict(healthy=fact(False))
    assert (result.result, result.score, result.score_checked) == ("drop", 0, 0)
    assert (result.parts, result.band) == ([], None)


@pytest.mark.parametrize(
    ("basis", "score", "checked", "band"),
    [
        ("scaled", 60, 60, "research_first"),  # 60 of 60 counts as 100
        ("scaled", 48, 60, "research_first"),  # 80
        ("scaled", 36, 60, "investigate"),  # 60
        ("scaled", 20, 60, "nurture"),  # 33
        ("scaled", 0, 0, "nurture"),
        ("raw", 48, 60, "nurture"),  # the points earned, as they are: under 50
        ("raw", 60, 60, "investigate"),
        ("raw", 75, 80, "research_first"),
    ],
)
def test_the_band_follows_the_profile(basis: str, score: int, checked: int, band: str) -> None:
    rules = load_rules()
    changed = rules.criteria.score.model_copy(update={"band_basis": basis})
    criteria = rules.criteria.model_copy(update={"score": changed})
    assert band_of(score, checked, rules.model_copy(update={"criteria": criteria})) == band


def size_check(result: Verdict) -> RuleCheck:
    (check,) = [check for check in result.checks if check.rule == "Size"]
    return check


@pytest.mark.parametrize(
    ("staff", "expected", "outcome"),
    [
        (4, "drop", "fail"),  # under the floor (50): too small (PLAN-V9 B1)
        (49, "drop", "fail"),
        (50, "pass", "ok"),  # 50+ fits (Levi, 9 Nov, PLAN-V11 B2): no Watch band any more
        (74, "pass", "ok"),
        (75, "pass", "ok"),
        (99, "pass", "ok"),
        (100, "pass", "ok"),
        (600, "pass", "ok"),
        (601, "director_review", "director"),
    ],
)
def test_staff_numbers_set_the_result_when_the_office_size_is_unknown(
    staff: int, expected: str, outcome: str
) -> None:
    result = verdict(office_m2=fact(None), staff_in_city=fact(staff))
    assert result.result == expected
    assert size_check(result).outcome == outcome
    assert result.office_m2 == staff * 10
    assert result.office_m2_estimated


@pytest.mark.parametrize(
    ("staff", "expected", "outcome"),
    [(49, "drop", "fail"), (50, "watch", "flag"), (74, "watch", "flag"), (75, "pass", "ok")],
)
def test_a_band_between_the_floor_and_the_hint_is_a_watch(
    staff: int, expected: str, outcome: str
) -> None:
    """The 5 Nov rules (hint 75): 50 to 74 staff is a Watch with a "check office size" flag."""
    result = verdict_under(HINT_75, office_m2=fact(None), staff_in_city=fact(staff))
    assert (result.result, size_check(result).outcome) == (expected, outcome)


def test_the_size_words_say_why() -> None:
    small = size_check(verdict(office_m2=fact(None), staff_in_city=fact(12)))
    assert small.detail == "120 m² (estimated: 12 staff x 10 m²): under 50 staff, too small"
    fits = size_check(verdict(office_m2=fact(None), staff_in_city=fact(60)))
    assert fits.detail == "600 m² (estimated: 60 staff x 10 m²): at the staff hint (50+)"
    watch = size_check(verdict_under(HINT_75, office_m2=fact(None), staff_in_city=fact(60)))
    assert watch.detail.endswith("under 75 staff, so a Watch. Check the office size")


def test_a_watch_by_size_stays_a_watch_in_sydney() -> None:
    result = verdict_under(
        HINT_75, office_m2=fact(None), staff_in_city=fact(60), city=fact("Sydney")
    )
    assert result.result == "watch"


def test_60_staff_in_sydney_go_to_a_director_since_9_nov() -> None:
    result = verdict(office_m2=fact(None), staff_in_city=fact(60), city=fact("Sydney"))
    assert result.result == "director_review"


def test_a_known_office_keeps_todays_rule_whatever_the_staff() -> None:
    result = verdict(office_m2=fact(2000), staff_in_city=fact(20))
    assert result.result == "pass"
    assert size_check(result).outcome == "ok"


def test_a_growing_company_of_30_staff_fits() -> None:
    result = growing(staff_in_city=fact(30))
    assert result.result == "pass"
    assert size_check(result).outcome == "ok"


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
    result = growing(**changes)
    check = size_check(result)
    assert "Growing" not in check.detail
    assert check.outcome == "fail"  # 35 staff is under the floor of 50 (PLAN-V9 B1)
    assert result.result == "drop"


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
    weak = verdict(triggers=[trigger("hiring_push", "2026-10-10")])
    assert weak.result == "pass"
    assert weak.score < verdict().score


@pytest.mark.parametrize(
    ("trigger_id", "group"),
    [
        ("new_ceo", "other"),  # a leadership change that changes strategy: moved up from weak
        ("new_business_unit", "other"),
        ("new_facility", "other"),
        ("underperforming_workplace", "other"),
        ("culture_change", "weak"),
        ("hiring_push", "weak"),
    ],
)
def test_the_version_2_triggers_have_their_group(trigger_id: str, group: str) -> None:
    result = verdict(triggers=[trigger(trigger_id, "2026-10-10")])
    assert result.result == "pass"
    assert result.triggers[0].group == group


def test_old_or_finished_triggers_dont_count() -> None:
    assert verdict(triggers=[trigger("merger_or_takeover", "2024-05")]).result == "watch"
    assert verdict(triggers=[trigger("lease_ending", "2026-01")]).result == "watch"
    assert verdict(triggers=[trigger("lease_ending", "2031-01")]).result == "watch"


def test_an_official_source_scores_higher_than_news() -> None:
    news = verdict(triggers=[trigger("big_new_contract", "2026-10-01", NEWS)])
    asx = verdict(triggers=[trigger("big_new_contract", "2026-10-01", ASX)])
    assert asx.score > news.score
    assert asx.triggers[0].source_kind == "asx_or_official_news"


def test_evidence_earns_points_in_the_check_it_belongs_to() -> None:
    boosters = [
        BoosterFound(id=b, evidence=f"{b} found", source_url=NEWS)
        for b in ("buys_strategy", "can_pay", "no_rival_in_place")
    ]
    result = verdict(boosters=boosters)
    assert score_check(result, "buys_strategy").earned == 8
    assert score_check(result, "buys_strategy").detail == "buys_strategy found"
    assert score_check(result, "no_rival_in_place").earned == 6
    assert (
        result.score == verdict().score + 8 + 6
    )  # can_pay earns nothing: the Profile has no place for it


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


def history_check(result: Verdict) -> RuleCheck | None:
    found = [check for check in result.checks if check.rule == "Office history"]
    return found[0] if found else None


def test_office_history_is_left_out_when_nothing_is_known() -> None:
    assert history_check(verdict()) is None


@pytest.mark.parametrize(
    ("changes", "outcome", "phrases"),
    [
        (
            {"office_since": fact("2015")},
            "ok",
            ["At this address since 2015", "Due for a new fitout"],
        ),
        ({"office_since": fact("2022-01")}, "ok", ["At this address since 2022 (4.8 years)"]),
        (
            {"office_since": fact("2025-03")},
            "flag",
            ["since 2025", "in the last 3 years", "less likely"],
        ),
        (
            {"office_since": fact("2015"), "last_fitout": fact("2024-05")},
            "flag",
            ["Last fitout 2024", "less likely"],
        ),
        ({"last_fitout": fact("2019-06")}, "ok", ["Last fitout 2019"]),
    ],
)
def test_office_history_notes_how_long_and_whether_it_moved_lately(
    changes: dict[str, Any], outcome: str, phrases: list[str]
) -> None:
    check = history_check(verdict(**changes))
    assert check is not None
    assert check.outcome == outcome
    for phrase in phrases:
        assert phrase in check.detail


def test_office_history_never_changes_the_result() -> None:
    recent = verdict(office_since=fact("2025-03"))
    assert (recent.result, recent.score) == (verdict().result, verdict().score)


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


# --- New to Australia (PLAN-V9 B3) ---------------------------------------------------------------


def new_to_australia(**changes: Any) -> Verdict:
    """Sample Nordic Energy: an overseas company with 120 staff planned in Adelaide by 2027, and
    nobody here yet."""
    facts = make_facts(
        name="Sample Nordic Energy",
        city=fact("Adelaide"),
        industry=fact("Renewable energy"),
        tier_group="Energy and infrastructure",
        office_m2=fact(None),
        staff_in_city=fact(None),
        growth_plan=fact(True, NEWS),
        size_needed_m2=fact(1200, NEWS, "estimated"),
        growth_by=fact("2027", NEWS),
        triggers=[
            TriggerFound(
                id="new_to_australia",
                what_happened="Sample Nordic Energy opens its first Australian office in "
                "Adelaide, with 120 staff by 2027.",
                date="2026-10",
                source_url=NEWS,
                label="confirmed",
            )
        ],
    )
    return judge(facts.model_copy(update=changes), NEW, load_rules(), TODAY)


def test_an_overseas_company_new_to_adelaide_passes_as_growing() -> None:
    result = new_to_australia()
    assert result.result == "pass"
    check = size_check(result)
    assert check.outcome == "ok"
    assert check.detail == "Growing into the range: will need about 1,200 m² by 2027"
    assert result.triggers[0].group == "main"
    assert score_check(result, "industry_tier").earned == 7  # energy is tier 1


def test_new_to_australia_with_no_city_goes_to_a_director() -> None:
    result = new_to_australia(city=fact(None))
    assert result.result == "director_review"
    (city,) = [check for check in result.checks if check.rule == "City"]
    assert city.outcome == "director"
    assert "no Australian city is named yet" in city.detail


def test_another_sign_with_no_city_is_still_a_watch() -> None:
    assert verdict(city=fact(None)).result == "watch"


def test_a_booming_industry_sign_counts_as_a_main_sign() -> None:
    result = verdict(
        triggers=[
            TriggerFound(
                id="hot_industry_growth",
                what_happened="Acme is hiring 80 engineers for the energy transition.",
                date="2026-10",
                source_url=NEWS,
                label="confirmed",
            )
        ]
    )
    assert result.result == "pass"
    assert result.triggers[0].trigger.id == "hot_industry_growth"
    assert result.triggers[0].group == "main"
