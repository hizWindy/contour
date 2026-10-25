"""The rules and the score, including the edge cases: 99 vs 100 staff, Sydney, an open deal."""

from datetime import date

import pytest

from apps.lead_finder.fields import BoosterFound, TriggerFound
from apps.lead_finder.rules import load_rules
from apps.lead_finder.scoring import judge, parse_date
from core.hubspot.matching import HubSpotMatch
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


@pytest.mark.parametrize(
    ("staff", "expected"),
    [(99, "director_review"), (100, "pass"), (600, "pass"), (601, "director_review"), (79, "drop")],
)
def test_staff_limits_when_the_office_size_is_unknown(staff: int, expected: str) -> None:
    result = verdict(office_m2=fact(None), staff_in_city=fact(staff))
    assert result.result == expected
    assert result.office_m2 == staff * 10
    assert result.office_m2_estimated


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


def test_industries() -> None:
    assert verdict(industry_group="Law firms").result == "director_review"
    builder = verdict(industry_group="Construction")
    assert builder.result == "pass"
    assert any(check.outcome == "flag" for check in builder.checks)


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
