"""The rules and the score, including the edge cases: 99 vs 100 staff, Sydney, an open deal."""

from datetime import date
from typing import Any

import pytest

from apps.lead_finder.fields import BoosterFound, DampenerCheck, TriggerFound
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.scoring import (
    JUST_MOVED,
    TIER_CHECK,
    VERIFY_CHECK,
    RuleCheck,
    ScoreCheck,
    ScorePart,
    TriggerScore,
    Verdict,
    judge,
    parse_date,
    tier_of,
)
from core.hubspot.matching import CandidateReason, HubSpotMatch, MatchCandidate
from tests.lead_finder.samples import (
    ASX,
    NEWS,
    fact,
    found_dampener,
    make_facts,
    no_dampeners,
    with_dampeners,
)

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
    # Fit: 250 staff 12, no priority sector 0, Melbourne 5, the office matters 5. Change: a lease
    # end (a very high sign) 25, no other sign, a lease within 3 years 9. Access: no outsourcing
    # deal or tie to a competitor 10, favourable procurement 6, a warm path can't be judged yet.
    assert result.score == result.score_before_dampeners == 22 + 34 + 16 == 72
    assert result.tier == "B"
    assert result.fitout_aud == 2500 * 1500


def part_of(result: Verdict, id: str) -> ScorePart:
    return next(part for part in result.parts if part.id == id)


def score_check(result: Verdict, id: str) -> ScoreCheck:
    return next(check for part in result.parts for check in part.checks if check.id == id)


def test_the_score_has_levis_three_parts_and_ten_checks() -> None:
    result = verdict()
    assert [(p.id, p.max) for p in result.parts] == [("fit", 30), ("change", 50), ("access", 20)]
    assert [p.earned for p in result.parts] == [22, 34, 16]
    assert [c.id for p in result.parts for c in p.checks] == [
        "local_staff",
        "priority_sector",
        "city",
        "office_relevance",
        "strongest_sign",
        "other_signs",
        "office_constrained",
        "no_lock_in",
        "procurement",
        "warm_path",
    ]
    assert sum(p.max for p in result.parts) == 100
    assert sum(p.earned for p in result.parts) == result.score == 72


def test_the_trigger_points_are_the_sum_of_their_three_parts() -> None:
    """The group, the source and the timing still rank signs against each other (they are no
    longer points of the lead's score)."""
    (best,) = verdict().triggers
    assert (best.group_points, best.source_points, best.timing_points) == (15, 5, 6)
    assert best.points == 15 + 5 + 6


def test_a_warm_path_in_cannot_be_judged_yet() -> None:
    check = score_check(verdict(), "warm_path")
    assert (check.known, check.earned, check.max) == (False, 0, 4)


# --- Fit (30) ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("staff", "points"),
    [(50, 2), (99, 2), (100, 5), (149, 5), (150, 10), (249, 10), (250, 12), (600, 12)],
)
def test_local_staff_earns_the_points_of_the_highest_step_it_reaches(
    staff: int, points: int
) -> None:
    check = score_check(verdict(office_m2=fact(None), staff_in_city=fact(staff)), "local_staff")
    assert (check.earned, check.known, check.max) == (points, True, 12)
    assert check.detail == f"{staff:,} staff in the city"


def test_the_larger_of_the_staff_and_the_projected_size_counts() -> None:
    """Levi: "local office headcount and projected size"."""
    big_office = score_check(verdict(office_m2=fact(3000), staff_in_city=fact(120)), "local_staff")
    assert big_office.earned == 12
    assert big_office.detail == "About 300 staff: a 3,000 m² office at 10 m² a person"
    # Southern Launch: 35 staff today and the funding for an office of 1,500 m², about 150 staff
    assert score_check(growing(), "local_staff").earned == 10


def test_local_staff_is_not_known_when_neither_staff_nor_size_is() -> None:
    check = score_check(verdict(office_m2=fact(None), staff_in_city=fact(None)), "local_staff")
    assert (check.known, check.earned) == (False, 0)


@pytest.mark.parametrize("group", load_rules().criteria.industries.priority_sectors)
def test_a_priority_sector_earns_8(group: str) -> None:
    check = score_check(verdict(tier_group=group), "priority_sector")
    assert (check.earned, check.known, check.detail) == (8, True, group)


@pytest.mark.parametrize("group", [None, "Life sciences and medtech", "Retail"])
def test_any_other_sector_earns_nothing(group: str | None) -> None:
    check = score_check(verdict(tier_group=group), "priority_sector")
    assert (check.earned, check.known) == (0, True)


def test_the_priority_sectors_are_levis_list_in_our_seven_groups() -> None:
    assert load_rules().criteria.industries.priority_sectors == [
        "Energy and infrastructure",
        "Defence and advanced manufacturing",
        "Engineering and technical services",
        "Selected financial and corporate services",
        "Technology and telecommunications",
        "Other corporate professional services",
        "Mining and resources",
    ]


def test_the_sector_is_not_known_when_the_industry_is_not() -> None:
    assert not score_check(verdict(industry=fact(None)), "priority_sector").known


@pytest.mark.parametrize(
    ("place", "points"),
    [
        ("Melbourne", 5),
        ("Adelaide", 5),
        ("Perth", 5),
        ("Sydney", 2),
        ("Brisbane", 2),
        ("Hobart", 1),  # a capital
        ("Geelong", 1),  # a regional centre
        ("Albury", 1),  # not on the list: it passes with a flag, and earns 1
    ],
)
def test_the_city_earns_by_its_group(place: str, points: int) -> None:
    check = score_check(verdict(city=fact(place)), "city")
    assert (check.earned, check.known, check.max) == (points, True, 5)


def test_an_unknown_city_is_not_known_yet() -> None:
    assert not score_check(verdict(city=fact(None)), "city").known


@pytest.mark.parametrize(
    ("matters", "points", "known"), [(True, 5, True), (False, 0, True), (None, 0, False)]
)
def test_the_office_relevance_follows_what_the_research_says(
    matters: bool | None, points: int, known: bool
) -> None:
    check = score_check(verdict(office_matters=fact(matters)), "office_relevance")
    assert (check.earned, check.known) == (points, known)


# --- Change and timing (50) --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sign", "when", "points"),
    [
        ("lease_ending", "2028-03", 25),  # very high
        ("merger_or_takeover", "2026-09-01", 18),  # high
        ("restructure", "2026-09-01", 10),  # medium
        ("culture_change", "2026-09-01", 4),  # low
    ],
)
def test_the_strongest_sign_earns_by_its_strength(sign: str, when: str, points: int) -> None:
    check = score_check(verdict(triggers=[trigger(sign, when)]), "strongest_sign")
    assert (check.earned, check.max) == (points, 25)


def test_the_strongest_sign_decides_whatever_the_order_or_the_date() -> None:
    result = verdict(
        triggers=[
            trigger("culture_change", "2026-10-20"),
            trigger("merger_or_takeover", "2026-04-01"),
        ]
    )
    assert [item.trigger.id for item in result.triggers] == ["merger_or_takeover", "culture_change"]
    assert score_check(result, "strongest_sign").earned == 18


def test_no_sign_earns_nothing_for_the_strongest_sign() -> None:
    check = score_check(verdict(triggers=[]), "strongest_sign")
    assert (check.earned, check.known) == (0, True)
    assert check.detail == "No sign of an office change yet"


SIGNS_OVER_TIME = [
    trigger("merger_or_takeover", "2026-09-01"),  # the strongest: high
    trigger("restructure", "2026-08-01"),
    trigger("return_to_office", "2026-07-01"),
    trigger("new_ceo", "2026-06-01"),
]


@pytest.mark.parametrize(("signs", "points"), [(1, 0), (2, 8), (3, 16), (4, 16)])
def test_other_independent_signs_earn_8_each_and_at_most_2(signs: int, points: int) -> None:
    result = verdict(triggers=SIGNS_OVER_TIME[:signs])
    assert score_check(result, "other_signs").earned == points
    assert score_check(result, "other_signs").max == 16


def test_a_sign_older_than_12_months_is_a_sign_but_not_another_one() -> None:
    old = trigger("restructure", "2025-06-01")  # 16 months: inside the 18, outside the 12
    result = verdict(triggers=[trigger("merger_or_takeover", "2026-09-01"), old])
    assert len(result.triggers) == 2
    assert score_check(result, "other_signs").earned == 0


def test_a_sign_with_no_date_or_still_to_come_counts_as_another() -> None:
    undated = verdict(
        triggers=[trigger("merger_or_takeover", "2026-09-01"), trigger("restructure", None)]
    )
    assert score_check(undated, "other_signs").earned == 8
    lease = verdict(
        triggers=[trigger("merger_or_takeover", "2026-09-01"), trigger("lease_ending", "2028-03")]
    )
    assert lease.triggers[0].trigger.id == "lease_ending"  # very high is the strongest
    assert score_check(lease, "other_signs").earned == 8  # the merger is the other sign


def test_the_same_sign_twice_is_not_an_independent_one() -> None:
    twice = verdict(
        triggers=[
            trigger("merger_or_takeover", "2026-09-01"),
            trigger("merger_or_takeover", "2026-08-01"),
            trigger("restructure", "2026-08-01"),
            trigger("restructure", "2026-07-01"),
        ]
    )
    assert score_check(twice, "other_signs").earned == 8  # only the restructure


def test_a_lease_within_3_years_or_8_years_at_the_address_is_a_constrained_office() -> None:
    assert score_check(verdict(), "office_constrained").earned == 9  # a lease end in March 2028
    quiet = [trigger("restructure", "2026-09-01")]
    unknown = score_check(verdict(triggers=quiet), "office_constrained")
    assert (unknown.known, unknown.earned) == (False, 0)
    old = score_check(verdict(triggers=quiet, office_since=fact("2015")), "office_constrained")
    assert (old.known, old.earned) == (True, 9)
    assert old.detail == "11.3 years at this address"
    young = score_check(verdict(triggers=quiet, office_since=fact("2019-06")), "office_constrained")
    assert (young.known, young.earned) == (True, 0)  # 7.4 years: not 8


# --- Access (20) -------------------------------------------------------------------------------


def test_no_lock_in_earns_10_only_when_both_checks_ran_and_found_nothing() -> None:
    assert score_check(verdict(), "no_lock_in").earned == 10
    checks: tuple[DampenerCheck, ...] = ("outsourcing", "competitor_tie")
    for check in checks:
        found = score_check(
            verdict(dampeners=with_dampeners(found_dampener(check, "A deal."))), "no_lock_in"
        )
        assert (found.earned, found.known, found.detail) == (0, True, "A deal.")
        missing = score_check(verdict(dampeners=no_dampeners(except_for=[check])), "no_lock_in")
        assert (missing.earned, missing.known) == (0, False)
    assert not score_check(verdict(dampeners=[]), "no_lock_in").known


def test_favourable_procurement_needs_the_evidence_and_no_red_flag() -> None:
    assert score_check(verdict(), "procurement").earned == 6
    flag = found_dampener("procurement", "It buys by tender.", kind="lowest_price")
    flagged = score_check(verdict(dampeners=with_dampeners(flag)), "procurement")
    assert (flagged.earned, flagged.known) == (0, True)
    assert flagged.detail == "A red flag: It buys by tender."
    plain = score_check(verdict(boosters=[]), "procurement")
    assert (plain.earned, plain.known) == (0, True)  # checked, and nothing says how it buys
    assert not score_check(verdict(boosters=[], dampeners=[]), "procurement").known


# --- The dampeners take points off, and the score sets the tier -----------------------------------


def test_a_strong_dampener_takes_20_off_and_a_moderate_one_10() -> None:
    fitout: dict[str, Any] = {"last_fitout": fact("2025-06")}  # 16 months ago: strong
    older: dict[str, Any] = {"last_fitout": fact("2023-03")}  # 3.6 years ago: moderate
    assert verdict(**fitout).score_before_dampeners == 72
    assert verdict(**fitout).score == 72 - 20
    assert verdict(**older).score == 72 - 10


def test_a_found_outsourcing_deal_costs_its_check_and_its_dampener() -> None:
    result = verdict(dampeners=with_dampeners(found_dampener("outsourcing")))
    assert result.score_before_dampeners == 72 - 10  # the no lock-in check earns nothing
    assert result.score == 72 - 10 - 20  # and the strong dampener


def test_dampeners_add_up_and_the_score_stops_at_zero() -> None:
    answers = with_dampeners(
        found_dampener("outsourcing"),
        found_dampener("competitor_tie"),
        found_dampener("procurement", kind="lowest_price"),
    )
    several = verdict(dampeners=answers)
    # lock-in 10 and procurement 6 are gone, and 20 + 10 + 10 come off
    assert (several.score_before_dampeners, several.score) == (72 - 16, 72 - 16 - 40)
    assert verdict(dampeners=answers, healthy=fact(False, ASX)).score == 0  # 16 - 20, not below 0


def test_a_waived_dampener_takes_nothing_off() -> None:
    growing_fast: dict[str, Any] = {
        "last_fitout": fact("2025-06"),
        "growth_plan": fact(True),
        "size_needed_m2": fact(4000),
        "growth_by": fact("2027-06"),
    }
    result = verdict(**growing_fast)
    assert result.dampeners[0].waived is not None
    assert result.score == result.score_before_dampeners == 72


@pytest.mark.parametrize(
    ("score", "tier"),
    [
        (0, "discard"),
        (39, "discard"),
        (40, "C"),
        (54, "C"),
        (55, "B"),
        (74, "B"),
        (75, "A"),
        (100, "A"),
    ],
)
def test_the_tier_edges_are_levis(score: int, tier: str) -> None:
    assert tier_of(score, load_rules()) == tier


STRONG_LEAD: dict[str, Any] = {
    "tier_group": "Technology and telecommunications",
    "triggers": [trigger("lease_ending", "2028-03"), trigger("merger_or_takeover", "2026-09-01")],
}
WEAK_LEAD: dict[str, Any] = {
    "office_m2": fact(None),
    "staff_in_city": fact(50),
    "office_matters": fact(False),
    "boosters": [],
    "triggers": [trigger("culture_change", "2026-09-01")],
}


def test_tiers_a_and_b_are_a_pass() -> None:
    a = verdict(**STRONG_LEAD)
    # Fit 30, change 25 + 8 + 9, access 16
    assert (a.score, a.tier, a.result) == (88, "A", "pass")
    b = verdict()
    assert (b.tier, b.result) == ("B", "pass")


def test_tier_c_is_a_watch_that_says_why() -> None:
    result = verdict(triggers=[trigger("restructure", "2026-09-01")])
    assert (result.score, result.tier, result.result) == (22 + 10 + 16, "C", "watch")
    (check,) = [c for c in result.checks if c.rule == TIER_CHECK]
    assert check.outcome == "flag"
    assert check.detail == "Tier C, a score of 48 (from 40 to 54): watch for a new sign"


def test_discard_is_a_drop_that_says_why() -> None:
    result = verdict(**WEAK_LEAD)
    assert result.score == 7 + 4 + 10  # fit 2 + 5, change 4, access 10
    assert (result.tier, result.result, result.stage) == ("discard", "drop", "Not a target")
    (check,) = [c for c in result.checks if c.rule == TIER_CHECK]
    assert (check.outcome, check.detail) == ("fail", "A score of 21 is under 40: Discard")


def test_an_unknown_fact_never_drops_a_lead_it_stays_a_watch() -> None:
    """A Discard with the city unknown, or with the dampener checks not run, is a Watch."""
    unknown_city = verdict(**WEAK_LEAD, city=fact(None))
    assert (unknown_city.tier, unknown_city.result) == ("discard", "watch")
    unchecked = verdict(**WEAK_LEAD, dampeners=[])
    assert (unchecked.tier, unchecked.result) == ("discard", "watch")
    (check,) = [c for c in unchecked.checks if c.rule == TIER_CHECK]
    assert check.outcome == "flag"
    assert "the dampener checks haven't run, so a person checks it" in check.detail


def test_a_rule_that_holds_a_lead_at_watch_wins_over_tier_b() -> None:
    """It moved in 4 months ago, so it is a Watch whatever the tier (PLAN-V11 B3)."""
    result = verdict(**STRONG_LEAD, office_since=fact("2026-06"))
    assert (result.score, result.tier, result.result) == (88 - 20, "B", "watch")


# --- Confidence --------------------------------------------------------------------------------


def test_confidence_is_high_when_the_headcount_the_signs_and_the_checks_are_sourced() -> None:
    result = verdict()
    assert result.confidence == "high"
    assert result.confidence_why == (
        "High: the headcount and the signs are confirmed, and every dampener check ran."
    )


@pytest.mark.parametrize(
    ("changes", "level", "why"),
    [
        (
            {"staff_in_city": fact(250, label="estimated"), "office_m2": fact(None)},
            "medium",
            "Medium: the headcount is estimated.",
        ),
        (
            {"staff_in_city": fact(250), "staff_from_linkedin": True, "office_m2": fact(None)},
            "medium",  # a LinkedIn count, doubled, is an estimate
            "Medium: the headcount is estimated.",
        ),
        ({"dampeners": []}, "medium", "Medium: the dampener checks haven't all run."),
        (
            {
                "triggers": [
                    TriggerFound(
                        id="lease_ending",
                        what_happened="x",
                        date="2028-03",
                        source_url=NEWS,
                        label="estimated",
                    )
                ]
            },
            "medium",
            "Medium: a sign is only estimated.",
        ),
        (
            {
                "staff_in_city": fact(250, label="estimated"),
                "office_m2": fact(None),
                "dampeners": [],
            },
            "low",
            "Low: the headcount is estimated and the dampener checks haven't all run.",
        ),
        (
            {"staff_in_city": fact(None), "office_m2": fact(None), "triggers": []},
            "low",
            "Low: the headcount isn't known and no sign was found.",
        ),
    ],
)
def test_confidence_falls_with_each_estimated_fact_or_check_that_didnt_run(
    changes: dict[str, Any], level: str, why: str
) -> None:
    result = verdict(**changes)
    assert (result.confidence, result.confidence_why) == (level, why)


def test_a_confirmed_office_size_is_enough_for_the_headcount() -> None:
    result = verdict(staff_in_city=fact(None))  # the office is 2,500 m², confirmed
    assert result.confidence == "high"


def test_tier_a_on_estimated_facts_says_to_verify_before_outreach() -> None:
    estimated = {
        **STRONG_LEAD,
        "staff_in_city": fact(250, label="estimated"),
        "office_m2": fact(None),
        "dampeners": [],  # the checks didn't run: no lock-in and procurement earn nothing
        "triggers": [
            trigger("lease_ending", "2028-03"),
            trigger("merger_or_takeover", "2026-09-01"),
            trigger("restructure", "2026-08-01"),
            trigger("return_to_office", "2026-07-01"),
        ],
    }
    result = verdict(**estimated)
    assert (result.tier, result.confidence) == ("A", "low")
    (flag,) = [c for c in result.checks if c.rule == VERIFY_CHECK]
    assert flag.outcome == "flag"
    assert flag.detail.startswith("A high score on facts that are mostly estimated. Low:")
    assert not [c for c in verdict(**STRONG_LEAD).checks if c.rule == VERIFY_CHECK]


@pytest.mark.parametrize(
    ("changes", "result", "stage"),
    [
        ({}, "pass", "Active prospect"),
        ({"office_m2": fact(7000)}, "director_review", "Active prospect"),  # over the top limit
        # no sign yet, and a strong fit: Tier C, so watch for one
        (
            {"triggers": [], "tier_group": "Technology and telecommunications"},
            "watch",
            "Target account",
        ),
        ({"office_m2": fact(500), "staff_in_city": fact(None)}, "drop", "Not a target"),
    ],
)
def test_every_result_has_the_profiles_stage(
    changes: dict[str, Any], result: str, stage: str
) -> None:
    verdict_ = verdict(**changes)
    assert (verdict_.result, verdict_.stage) == (result, stage)


def test_a_drop_scores_zero_and_has_no_parts() -> None:
    result = verdict(office_m2=fact(500), staff_in_city=fact(None))  # too small
    assert (result.result, result.score, result.score_before_dampeners) == ("drop", 0, 0)
    assert (result.tier, result.parts) == ("discard", [])


def test_a_lead_with_no_sign_and_a_middling_fit_is_a_discard() -> None:
    """No sign yet and 38 points: under Levi's 40, so it isn't listed."""
    result = verdict(triggers=[])
    assert (result.score, result.tier, result.result) == (38, "discard", "drop")


def test_an_unhealthy_company_is_a_strong_dampener_not_a_drop() -> None:
    """Version 2 dropped a company in administration or cutting staff fast. Levi's notes make it a
    dampener (PLAN-V16 T1-6): 20 points off, and a flag on the card."""
    result = verdict(healthy=fact(False, ASX))
    assert result.result == "watch"  # 72 - 20 = 52: Tier C
    assert (result.score_before_dampeners, result.score, result.tier) == (72, 52, "C")
    (check,) = [c for c in result.checks if c.rule == "Healthy"]
    assert check.outcome == "flag"


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


def test_60_staff_in_sydney_pass_since_plan_v16() -> None:
    """Sydney was a Director's decision until PLAN-V16 T1-2: Levi's notes call it secondary."""
    result = verdict(office_m2=fact(None), staff_in_city=fact(60), city=fact("Sydney"))
    assert result.result == "pass"


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
        # All of Australia (PLAN-V16 T1-2): any place on the list passes, Sydney included
        ("Sydney", "pass"),
        ("North Sydney", "pass"),
        ("Brisbane", "pass"),
        ("Darwin", "pass"),
        ("Geelong VIC", "pass"),
        ("Hobart", "pass"),
        ("Surfers Paradise", "pass"),
        ("Albury", "pass"),  # not on the list: it still passes, with a flag (below)
    ],
)
def test_cities(place: str, expected: str) -> None:
    assert verdict(city=fact(place)).result == expected


@pytest.mark.parametrize("place", ["Brisbane", "Darwin", "Geelong", "Mackay"])
def test_a_place_on_the_list_passes_the_location_check(place: str) -> None:
    (check,) = [c for c in verdict(city=fact(place)).checks if c.rule == "City"]
    assert (check.outcome, check.detail) == ("ok", place)


def test_a_place_that_is_not_listed_passes_with_a_check_the_city_flag() -> None:
    (check,) = [c for c in verdict(city=fact("Albury NSW")).checks if c.rule == "City"]
    assert check.outcome == "flag"
    assert "Check the city" in check.detail
    assert "Albury NSW" in check.detail


def test_no_sign_means_watch_when_the_fit_is_strong() -> None:
    result = verdict(triggers=[], tier_group="Technology and telecommunications")
    assert result.result == "watch"  # Tier C: 46 points of fit and access
    assert result.triggers == []


def test_a_weak_trigger_still_counts_but_scores_lower() -> None:
    weak = verdict(triggers=[trigger("hiring_push", "2026-10-10")])
    assert [item.trigger.id for item in weak.triggers] == ["hiring_push"]
    assert weak.score == 22 + 4 + 16  # a low sign is worth 4, and nothing says the office is tight
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
    assert result.triggers[0].group == group


def test_old_or_finished_triggers_dont_count() -> None:
    assert verdict(triggers=[trigger("merger_or_takeover", "2024-05")]).triggers == []
    assert verdict(triggers=[trigger("lease_ending", "2026-01")]).triggers == []
    assert verdict(triggers=[trigger("lease_ending", "2031-01")]).triggers == []


@pytest.mark.parametrize(
    ("when", "counts"),
    [
        ("2026-10-20", True),
        ("2025-09-01", True),  # 13 months: 12 months was the limit until PLAN-V16 T1-4
        ("2025-05-01", True),  # 17 months
        ("2025-04-01", False),  # 19 months: older than Levi's 18
        ("2024-05", False),
    ],
)
def test_a_sign_older_than_18_months_is_ignored(when: str, counts: bool) -> None:
    """Levi's section 4: ignore anything older than 18 months, unless it is a lease or tenure
    date. The lease sign (a date to come) and the tenure sign (no date) are not held to it."""
    result = verdict(triggers=[trigger("merger_or_takeover", when)])
    assert (len(result.triggers) == 1) is counts
    assert (result.result == "pass") is counts


def test_an_old_sign_that_still_counts_earns_no_recency_points() -> None:
    (merger,) = verdict(triggers=[trigger("merger_or_takeover", "2025-09-01")]).triggers
    assert merger.timing_points == 0  # recency steps stop at a year


def test_a_lease_date_is_not_held_to_the_18_months() -> None:
    far = verdict(triggers=[trigger("lease_ending", "2028-03")])
    assert [score.trigger.id for score in far.triggers] == ["lease_ending"]
    assert verdict(triggers=[trigger("lease_ending", "2024-03")]).triggers == []  # already ended


def test_each_sign_on_the_card_says_how_strong_it_is() -> None:
    result = verdict(
        triggers=[
            trigger("capital_raise", "2026-10-01"),
            trigger("culture_change", "2026-10-01"),
            trigger("lease_ending", "2028-03"),
            trigger("new_ceo", "2026-10-01"),
        ]
    )
    assert {score.trigger.id: score.strength for score in result.triggers} == {
        "lease_ending": "very_high",
        "capital_raise": "high",
        "new_ceo": "medium",
        "culture_change": "low",
    }


def test_the_new_signs_are_signs_like_the_others() -> None:
    for sign in ("capital_raise", "tenant_advisor", "growth_list"):
        result = verdict(triggers=[trigger(sign, "2026-10-10")])
        assert [score.trigger.id for score in result.triggers] == [sign]


def test_an_official_source_scores_higher_than_news() -> None:
    news = verdict(triggers=[trigger("big_new_contract", "2026-10-01", NEWS)])
    asx = verdict(triggers=[trigger("big_new_contract", "2026-10-01", ASX)])
    # The source ranks signs against each other. It is no longer points of the score: it is part
    # of the confidence now
    assert asx.triggers[0].points > news.triggers[0].points
    assert asx.triggers[0].source_kind == "asx_or_official_news"


def test_evidence_earns_points_in_the_check_it_belongs_to() -> None:
    boosters = [
        BoosterFound(id=b, evidence=f"{b} found", source_url=NEWS)
        for b in ("buys_strategy", "can_pay", "no_rival_in_place")
    ]
    result = verdict(boosters=boosters)
    assert score_check(result, "procurement").earned == 6
    assert score_check(result, "procurement").detail == "buys_strategy found"
    # can_pay earns nothing (the Profile has no place for it), and neither does no_rival_in_place
    # (the competitor check covers it)
    assert result.score == verdict().score
    assert verdict(boosters=boosters[1:]).score == verdict().score - 6  # without buys_strategy


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


def test_unhealthy_is_a_dampener_not_a_drop_and_a_local_team_that_cant_is() -> None:
    assert verdict(healthy=fact(False)).result == "watch"  # 72 - 20: Tier C (it was a Drop)
    assert verdict(local_team_runs_project=fact(None)).result == "pass"
    assert verdict(local_team_runs_project=fact(False)).result == "drop"


def office_check(result: Verdict) -> RuleCheck:
    (check,) = [check for check in result.checks if check.rule == "Office"]
    return check


def test_the_director_sectors_go_to_a_director() -> None:
    for group in (
        "Education",
        "Industry consultants",
        "Real estate agencies",
        "Hospitals and healthcare",
    ):
        result = verdict(industry_group=group)
        assert result.result == "director_review", group
        assert office_check(result).outcome == "director"


def test_law_firms_are_left_out_not_sent_to_a_director() -> None:
    """PLAN-V16 T1-3 (Levi's section 3): a law firm is an exclusion, with a person's override."""
    result = verdict(industry_group="Law firms")
    assert (result.result, result.stage) == ("drop", "Not a target")
    assert result.excluded is not None and result.excluded.reason_id == "law_firm"
    assert office_check(result).outcome == "ok"  # no Director check: the exclusion decides


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
    unclear: dict[str, Any] = {"office_matters": fact(None)}
    mining = verdict(industry=fact("Mining"), industry_group="Mining and metals", **unclear)
    assert office_check(mining).outcome == "flag"
    assert office_check(verdict(**unclear)).outcome == "ok"  # software, nothing known about it
    assert office_check(verdict(industry=fact(None), **unclear)).outcome == "unknown"


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


def test_a_move_more_than_12_months_ago_never_changes_the_result() -> None:
    """It is no rule: it costs points as a strong dampener, and never makes the lead a Watch by
    itself."""
    recent = verdict(office_since=fact("2025-03"))
    assert just_moved(recent) is None
    assert recent.dampeners[0].strength == "strong"
    assert recent.score_before_dampeners == verdict().score
    assert recent.score == verdict().score - 20


# --- A company that just moved (Levi, 9 Nov, PLAN-V11 B3) -------------------------------------


def just_moved(result: Verdict) -> RuleCheck | None:
    found = [check for check in result.checks if check.rule == JUST_MOVED]
    return found[0] if found else None


def test_a_sign_and_a_move_4_months_ago_is_a_watch() -> None:
    assert verdict().result == "pass"  # the sample passes, with a lease sign
    growing = [trigger("fast_growth", "2026-10")]  # a growth sign, like Budget Direct's
    assert verdict(triggers=growing).result == "pass"
    # The rule holds even a strong lead (Tier B after the strong dampener's 20 points: 88 - 20)
    held = verdict(**STRONG_LEAD, office_since=fact("2026-06"))
    assert (held.tier, held.result) == ("B", "watch")
    result = verdict(office_since=fact("2026-06"))
    assert result.result == "watch"
    check = just_moved(result)
    assert check is not None
    assert (check.outcome, check.detail) == (
        "flag",
        "Moved in June 2026, so probably not in the market yet",
    )
    assert history_check(result) is None  # one check says it all
    assert result.parts and result.tier == "C"  # a Watch keeps its score and its tier (72 - 20)


def test_a_move_14_months_ago_is_not_just_moved() -> None:
    result = verdict(office_since=fact("2025-08"))
    assert just_moved(result) is None  # the 12-month rule doesn't apply
    check = history_check(result)
    assert check is not None and check.outcome == "flag"  # still in the last 3 years
    assert result.dampeners[0].strength == "strong"  # so a strong dampener: 72 - 20 = 52
    assert (result.tier, result.result) == ("C", "watch")


def test_a_drop_stays_a_drop_when_it_just_moved() -> None:
    result = verdict(office_since=fact("2026-06"), office_m2=fact(500), staff_in_city=fact(None))
    assert result.result == "drop"  # too small


def test_a_fitout_4_months_ago_counts_too_and_says_so() -> None:
    result = verdict(office_since=fact("2015"), last_fitout=fact("2026-06"))
    assert result.result == "watch"
    check = just_moved(result)
    assert check is not None
    assert check.detail == "Fitted out in June 2026, so probably not in the market yet"


def test_a_director_review_that_just_moved_is_a_watch() -> None:
    assert verdict(office_m2=fact(7000)).result == "director_review"
    assert verdict(office_m2=fact(7000), office_since=fact("2026-06")).result == "watch"


def test_a_year_alone_counts_from_1_july() -> None:
    check = just_moved(verdict(office_since=fact("2026")))  # 1 July 2026: under 4 months ago
    assert check is not None
    assert check.detail == "Moved in 2026, so probably not in the market yet"


def test_a_move_still_to_come_is_not_just_moved() -> None:
    result = verdict(office_since=fact("2027-03"))
    assert (result.result, just_moved(result)) == ("pass", None)


def test_just_moved_follows_the_rules_months() -> None:
    rules = load_rules()
    age = rules.criteria.office_age.model_copy(update={"just_moved_months": 3})
    shorter = rules.model_copy(
        update={"criteria": rules.criteria.model_copy(update={"office_age": age})}
    )
    assert rules.criteria.office_age.just_moved_months == 12
    assert just_moved(verdict_under(shorter, office_since=fact("2026-06"))) is None  # 4 > 3


# --- An old office: 8+ years at the same address (Levi, 9 Nov, PLAN-V11 C1) ----------------------


def old_office(result: Verdict) -> TriggerScore | None:
    found = [score for score in result.triggers if score.trigger.id == "long_tenure"]
    return found[0] if found else None


def test_9_years_with_no_fitout_gets_the_old_office_sign() -> None:
    result = verdict(triggers=[], office_since=fact("2017-06"))  # 9.4 years, no other sign
    sign = old_office(result)
    assert sign is not None
    assert sign.group == "main"
    assert sign.trigger.what_happened == (
        "At this address since at least June 2017 (9 years), "
        "with no known fitout there in the last 5 years."
    )
    assert (sign.trigger.date, sign.trigger.source_url) == (None, NEWS)  # the move-in's source
    assert sign.timing_points == 1  # undated: the years at the address earn their own points
    assert result.result == "pass"  # a main sign, alone enough (TBC with Levi: or a Director)
    assert score_check(result, "strongest_sign").earned == 25  # very high
    assert score_check(result, "office_constrained").earned == 9  # 8+ years at the address


def test_9_years_with_a_fitout_in_2022_has_no_old_office_sign() -> None:
    result = verdict(triggers=[], office_since=fact("2017-06"), last_fitout=fact("2022"))
    assert old_office(result) is None
    assert result.triggers == []  # no sign of an office change at all


def test_6_years_has_no_old_office_sign() -> None:
    assert old_office(verdict(triggers=[], office_since=fact("2020-06"))) is None


def test_levis_tenure_rule_looks_only_at_the_last_5_years_for_a_fitout() -> None:
    """Section 4 (PLAN-V16 T1-4): 8+ years at the address and no known fitout there in the last 5
    years. A fitout longer ago than that doesn't stop the sign."""
    moved = fact("2012")  # at the address 14 years
    inside = verdict(triggers=[], office_since=moved, last_fitout=fact("2022-01"))  # 4.8 years ago
    assert old_office(inside) is None
    outside = verdict(triggers=[], office_since=moved, last_fitout=fact("2021-06"))  # 5.4 years
    assert old_office(outside) is not None
    long_ago = verdict(triggers=[], office_since=moved, last_fitout=fact("2016"))  # 10 years ago
    assert old_office(long_ago) is not None


def test_an_exact_move_in_date_is_not_needed_a_year_is_enough() -> None:
    """Levi: "at this address since at least 2017" is enough."""
    result = verdict(triggers=[], office_since=fact("2017"))  # a year alone counts from 1 July
    sign = old_office(result)
    assert sign is not None
    assert sign.trigger.what_happened.startswith("At this address since at least 2017 (9 years)")


def test_8_years_is_the_edge_of_the_tenure_sign() -> None:
    assert old_office(verdict(triggers=[], office_since=fact("2018-10-01"))) is not None  # 8.07
    assert old_office(verdict(triggers=[], office_since=fact("2018-11-01"))) is None  # 7.99


def test_a_company_that_is_not_stable_has_no_tenure_sign() -> None:
    """The company must be stable or growing (no layoffs, losses or contraction)."""
    stable = verdict(triggers=[], office_since=fact("2012"), healthy=fact(True))
    assert old_office(stable) is not None
    unhealthy = verdict(triggers=[], office_since=fact("2012"), healthy=fact(False))
    assert old_office(unhealthy) is None  # it is a strong dampener, too
    assert (
        old_office(verdict(triggers=[], office_since=fact("2012"), healthy=fact(None))) is not None
    )


def test_a_fitout_before_the_move_in_was_part_of_the_move() -> None:
    result = verdict(triggers=[], office_since=fact("2017-06"), last_fitout=fact("2017-03"))
    assert old_office(result) is not None


def test_claude_never_gives_the_old_office_sign() -> None:
    claimed = trigger("long_tenure", None)  # only the code adds it, from the dates
    assert old_office(verdict(triggers=[claimed])) is None
    result = verdict(triggers=[claimed], office_since=fact("2017-06"))
    assert [score.trigger.id for score in result.triggers] == ["long_tenure"]
    assert result.triggers[0].trigger.what_happened.startswith(
        "At this address since at least June 2017"
    )


def test_real_news_ranks_above_the_old_office_sign() -> None:
    result = verdict(office_since=fact("2017-06"))  # with the sample's fresh lease sign
    assert [score.trigger.id for score in result.triggers] == ["lease_ending", "long_tenure"]


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
    assert score_check(result, "priority_sector").earned == 8  # energy is a priority sector


def test_new_to_australia_with_no_city_goes_to_a_director() -> None:
    # A second sign lifts it to Tier B: a Director decides only for A and B (choice 1)
    signs = [trigger("new_to_australia", "2026-10"), trigger("capital_raise", "2026-09-01")]
    result = new_to_australia(city=fact(None), triggers=signs)
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
    assert result.triggers[0].trigger.id == "hot_industry_growth"
    assert result.triggers[0].group == "main"
    assert result.triggers[0].strength == "medium"  # a sector tailwind
