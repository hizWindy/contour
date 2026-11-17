"""What the Start page offers, built from the rules (PLAN-V16 T1-2: all of Australia)."""

from decimal import Decimal

from apps.lead_finder.options import build_run_options
from apps.lead_finder.rules import load_rules
from apps.lead_finder.schemas import RunOptions
from core.config import Settings

RULES = load_rules()


def options() -> RunOptions:
    return build_run_options(RULES, Settings(_env_file=None), Decimal("50"))


def test_all_of_australia_comes_first_then_every_place_in_its_group() -> None:
    cities = options().cities
    assert [city.name for city in cities] == ["Australia", *RULES.criteria.cities.every]
    assert [city.group for city in cities[:6]] == [
        "national",
        "priority",
        "priority",
        "priority",
        "secondary",
        "secondary",
    ]
    for city in cities:
        assert city.kind == "pass"  # no place goes to a Director any more


def test_the_national_choice_has_only_the_whole_country() -> None:
    national = options().cities[0]
    assert [(area.id, area.suburbs) for area in national.areas] == [("all", [])]
    assert -45 < national.lat < -10 and 112 < national.lng < 155


def test_a_place_with_no_inner_suburbs_is_not_offered_an_empty_area() -> None:
    by_name = {city.name: city for city in options().cities}
    assert [area.id for area in by_name["Melbourne"].areas] == ["cbd", "inner", "all"]
    assert [area.id for area in by_name["Brisbane"].areas] == ["cbd", "inner", "all"]
    assert [area.id for area in by_name["Geelong"].areas] == ["cbd", "all"]
    assert by_name["Gold Coast"].areas[0].suburbs == ["Southport", "Surfers Paradise"]


def test_every_place_has_a_map_centre() -> None:
    for city in options().cities:
        assert (city.lat, city.lng) != (0, 0), city.name


# --- PLAN-V21: how many companies, and the top up -----------------------------------------------


def test_the_target_starts_at_50_and_its_top_is_the_runs_company_limit() -> None:
    settings = Settings(_env_file=None, run_max_companies=70)
    target = build_run_options(RULES, settings, Decimal("50")).target_companies
    assert (target.default, target.min, target.max) == (50, 5, 70)
    assert target.presets == [25, 50, 70]  # 100 is over the limit, so the limit is offered


def test_a_small_company_limit_pulls_the_target_and_its_presets_down() -> None:
    target = options().target_companies  # the code's company limit is 20
    assert (target.default, target.min, target.max, target.presets) == (20, 5, 20, [20])
    tiny = build_run_options(RULES, Settings(_env_file=None, run_max_companies=3), Decimal("1"))
    assert (tiny.target_companies.min, tiny.target_companies.max) == (3, 3)


def test_the_top_up_waits_for_the_ok_on_hubspot_names() -> None:
    off = options().top_up
    assert (off.default, off.allowed) == (True, False)
    assert off.message is not None and "Levi" in off.message
    on = build_run_options(
        RULES, Settings(_env_file=None, hubspot_names_to_claude_ok=True), Decimal("50")
    ).top_up
    assert (on.allowed, on.message) == (True, None)


def test_how_far_back_offers_7_30_90_and_180_days_with_90_first() -> None:
    since = options().since_days  # PLAN-V21 T1-2
    assert (since.choices, since.default) == ([7, 30, 90, 180], 90)
