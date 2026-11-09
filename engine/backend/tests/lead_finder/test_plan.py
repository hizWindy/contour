"""The plan of a discovery run: slices, focus places, watchlist batches and the size check."""

import uuid
from decimal import Decimal
from typing import Any

import pytest

from apps.lead_finder.params import DiscoveryParams, LeadFinderRunParams
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.steps.plan import (
    WATCHLIST_BATCH_SIZE,
    Slice,
    area_text,
    check_discovery_size,
    discovery_reserve_usd,
    focus_places,
    make_slices,
    slice_job_id,
    watchlist_batches,
)
from core.api.errors import Problem
from core.config import Settings
from core.runs.schemas import RunCaps
from core.runs.types import CapsOverride, make_caps

RULES = load_rules()


def settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def with_areas(areas: dict[str, dict[str, list[str]]]) -> LeadFinderRules:
    """The rules with other places, to try an empty list."""
    queries = RULES.queries.model_copy(update={"areas": areas})
    return RULES.model_copy(update={"queries": queries})


# --- Slices ---------------------------------------------------------------------------------


def test_the_default_run_is_one_city_times_the_six_main_signs() -> None:
    slices = make_slices(DiscoveryParams(), RULES)
    assert len(slices) == 6
    assert [s.city for s in slices] == ["Melbourne"] * 6
    assert [s.trigger_id for s in slices] == [
        "lease_ending",
        "merger_or_takeover",
        "big_new_contract",
        "fast_growth",
        "new_to_australia",
        "hot_industry_growth",
    ]


def test_three_cities_go_city_by_city() -> None:
    params = DiscoveryParams(cities=["Melbourne", "Adelaide", "Perth"], triggers=["fast_growth"])
    assert [s.city for s in make_slices(params, RULES)] == ["Melbourne", "Adelaide", "Perth"]


def test_the_first_default_slice_is_melbournes_lease_ending() -> None:
    slices = make_slices(DiscoveryParams(), RULES)
    assert slices[0] == Slice(
        id="melbourne:lease_ending",
        trigger_id="lease_ending",
        city="Melbourne",
        area="all",
        label="Melbourne: lease ending",
    )


def test_a_slice_follows_the_order_the_person_gave() -> None:
    params = DiscoveryParams(cities=["Perth", "Melbourne"], triggers=["new_ceo", "lease_ending"])
    assert [s.id for s in make_slices(params, RULES)] == [
        "perth:new_ceo",
        "perth:lease_ending",
        "melbourne:new_ceo",
        "melbourne:lease_ending",
    ]


def test_every_slice_id_is_different_and_the_same_params_give_the_same_slices() -> None:
    params = DiscoveryParams(
        cities=["Melbourne", "Adelaide", "Perth", "Sydney"],
        triggers=[item.id for item in RULES.criteria.searchable_triggers],
    )
    first = make_slices(params, RULES)
    assert len({s.id for s in first}) == len(first) == 4 * len(RULES.criteria.searchable_triggers)
    assert make_slices(params, RULES) == first


def test_area_narrows_a_city_and_a_city_not_listed_is_searched_whole() -> None:
    params = DiscoveryParams(
        cities=["Melbourne", "Perth"], triggers=["lease_ending"], area={"Melbourne": "cbd"}
    )
    melbourne, perth = make_slices(params, RULES)
    assert melbourne.area == "cbd"
    assert melbourne.label == "Melbourne (CBD): lease ending"
    assert perth.area == "all"
    assert perth.label == "Perth: lease ending"


def test_the_inner_label_says_inner_suburbs() -> None:
    params = DiscoveryParams(
        cities=["Adelaide"], triggers=["restructure"], area={"Adelaide": "inner"}
    )
    assert make_slices(params, RULES)[0].label == "Adelaide (inner suburbs): restructure"


def test_the_full_params_model_works_too() -> None:
    assert len(make_slices(LeadFinderRunParams(), RULES)) == 6


def test_sydney_is_a_slice_like_any_city() -> None:
    params = DiscoveryParams(cities=["Sydney"], triggers=["lease_ending"])
    assert make_slices(params, RULES)[0].id == "sydney:lease_ending"


@pytest.mark.parametrize(
    ("changes", "message"),
    [({"cities": ["Atlantis"]}, "Atlantis"), ({"triggers": ["moon_base"]}, "moon_base")],
)
def test_a_city_or_trigger_the_rules_do_not_know_is_a_bug_and_raises(
    changes: dict[str, Any], message: str
) -> None:
    values: dict[str, Any] = {
        "cities": ["Melbourne"],
        "area": {},
        "triggers": ["lease_ending"],
        "since_days": 30,
    } | changes
    params = DiscoveryParams.model_construct(**values)
    with pytest.raises(ValueError, match=message):
        make_slices(params, RULES)


def test_a_slice_is_json_simple_and_frozen() -> None:
    first = make_slices(DiscoveryParams(), RULES)[0]
    assert Slice.model_validate(first.model_dump(mode="json")) == first
    with pytest.raises(ValueError, match="frozen"):
        first.city = "Perth"  # type: ignore[misc]


def test_a_slice_job_id_is_stable_for_a_run_and_different_between_slices_and_runs() -> None:
    run = uuid.UUID("11111111-2222-3333-4444-555555555555")
    other = uuid.UUID("11111111-2222-3333-4444-555555555556")
    first, second = make_slices(DiscoveryParams(), RULES)[:2]
    assert slice_job_id(run, first) == slice_job_id(run, first)
    assert slice_job_id(run, first) != slice_job_id(run, second)
    assert slice_job_id(run, first) != slice_job_id(other, first)
    assert isinstance(slice_job_id(run, first), uuid.UUID)


# --- Where to focus -------------------------------------------------------------------------


def test_cbd_and_inner_give_their_own_places_and_all_gives_both() -> None:
    assert focus_places(RULES, "Melbourne", "cbd") == ["Melbourne CBD", "Docklands", "Southbank"]
    assert focus_places(RULES, "Perth", "inner") == [
        "West Perth",
        "East Perth",
        "Subiaco",
        "Northbridge",
    ]
    assert focus_places(RULES, "Adelaide", "all") == [
        "Adelaide CBD",
        "North Adelaide",
        "Kent Town",
        "Keswick",
        "Mile End",
    ]


def test_a_city_with_no_places_for_the_area_is_focused_by_its_own_name() -> None:
    rules = with_areas({"Melbourne": {"cbd": [], "inner": ["Richmond"]}})
    assert focus_places(rules, "Melbourne", "cbd") == ["Melbourne"]
    assert focus_places(rules, "Melbourne", "inner") == ["Richmond"]
    assert focus_places(rules, "Melbourne", "all") == ["Richmond"]
    assert focus_places(with_areas({"Melbourne": {}}), "Melbourne", "all") == ["Melbourne"]


def test_a_place_in_both_lists_is_said_once() -> None:
    rules = with_areas({"Melbourne": {"cbd": ["Richmond", "Docklands"], "inner": ["Richmond"]}})
    assert focus_places(rules, "Melbourne", "all") == ["Richmond", "Docklands"]


def test_the_area_in_a_template_is_the_city_for_all_and_the_places_otherwise() -> None:
    assert area_text(RULES, "Melbourne", "all") == "Melbourne"
    assert area_text(RULES, "Melbourne", "cbd") == "Melbourne CBD, Docklands, Southbank"


# --- Watchlist batches ----------------------------------------------------------------------


def test_the_watchlist_is_cut_into_batches_of_twenty_in_order() -> None:
    items = list(range(47))
    batches = watchlist_batches(items)
    assert WATCHLIST_BATCH_SIZE == 20
    assert [len(batch) for batch in batches] == [20, 20, 7]
    assert [x for batch in batches for x in batch] == items


@pytest.mark.parametrize(
    ("count", "size", "expected"),
    [(0, 20, []), (1, 20, [1]), (20, 20, [20]), (21, 20, [20, 1]), (5, 2, [2, 2, 1])],
)
def test_batch_sizes(count: int, size: int, expected: list[int]) -> None:
    assert [len(b) for b in watchlist_batches(list(range(count)), size)] == expected


def test_a_batch_needs_at_least_one_item() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        watchlist_batches([1, 2, 3], 0)


def test_batches_are_copies() -> None:
    items = [1, 2, 3]
    watchlist_batches(items, 2)[0].append(9)
    assert items == [1, 2, 3]


# --- The size check -------------------------------------------------------------------------


def caps_of(base: Settings, **override: Any) -> RunCaps:
    return make_caps(base, CapsOverride(**override) if override else None)


def params_of(cities: int, triggers: int) -> DiscoveryParams:
    return DiscoveryParams(
        cities=["Melbourne", "Adelaide", "Perth", "Sydney"][:cities],
        triggers=[t.id for t in RULES.criteria.searchable_triggers][:triggers],
    )


@pytest.mark.parametrize(
    ("cities", "triggers", "fits"),
    [
        (1, 1, True),
        (2, 4, True),  # 8 slices x US$0.60 = US$4.80
        (3, 4, True),  # 12 slices, US$7.20: the default Start page choice fits the defaults
        (2, 7, False),  # 14 slices, US$8.40: over the discovery cap of US$8.00
        (4, 9, False),
    ],
)
def test_the_slices_must_fit_the_discovery_cap_with_the_default_settings(
    cities: int, triggers: int, fits: bool
) -> None:
    base = settings()
    assert caps_of(base).discovery_cap_usd == Decimal("8.00")
    params = params_of(cities, triggers)
    if fits:
        check_discovery_size(params, base, caps_of(base))
        return
    with pytest.raises(Problem) as caught:
        check_discovery_size(params, base, caps_of(base))
    assert caught.value.status == 422
    assert caught.value.code == "discovery_too_large"
    assert caught.value.title == "The run is too big"


def test_the_message_has_the_numbers_and_what_to_do() -> None:
    base = settings()
    with pytest.raises(Problem) as caught:
        check_discovery_size(params_of(4, 4), base, caps_of(base))
    problem = caught.value
    assert problem.detail == (
        "This run would make 16 discovery searches. Each can cost up to US$0.60, so up to "
        "US$9.60 in all. Discovery may spend US$8.00 of the run's US$20.00 limit. "
        "At most 13 fit. Choose fewer cities or triggers, or raise the run limit in Settings."
    )
    assert problem.extra["errors"] == [
        {
            "field": "body.params.cities",
            "message": "16 searches is too many (the most that fit is 13). Choose fewer.",
        },
        {
            "field": "body.params.triggers",
            "message": "16 searches is too many (the most that fit is 13). Choose fewer.",
        },
    ]


def test_the_reserve_and_the_run_cap_change_the_answer() -> None:
    params = params_of(3, 4)  # 12 slices
    cheap = settings(slice_reserve_usd=Decimal("0.60"))  # 12 x 0.60 = 7.20 <= 8.00
    check_discovery_size(params, cheap, caps_of(cheap))
    dear = Decimal("1.00")
    with pytest.raises(Problem):  # 12 x 1.00 = 12.00 is over the default 8.00
        check_discovery_size(params, settings(slice_reserve_usd=dear), caps_of(settings()))
    bigger = settings(run_cap_usd=Decimal("30"), slice_reserve_usd=dear)  # cap 12.00: fits
    check_discovery_size(params, bigger, caps_of(bigger))
    share = settings(discovery_share=0.60, slice_reserve_usd=dear)  # 20 x 0.6 = 12.00
    check_discovery_size(params, share, caps_of(share))


def test_a_lower_run_cap_chosen_by_the_person_lowers_what_fits() -> None:
    base = settings()
    caps = caps_of(base, run_cap_usd=Decimal("10"))  # discovery cap 4.00
    check_discovery_size(params_of(2, 3), base, caps)  # 6 x 0.60 = 3.60
    with pytest.raises(Problem) as caught:
        check_discovery_size(params_of(2, 4), base, caps)  # 8 x 0.60 = 4.80
    assert "At most 6 fit" in str(caught.value.detail)
    assert "US$4.00 of the run's US$10.00 limit" in str(caught.value.detail)


def test_when_not_even_one_slice_fits_it_says_so() -> None:
    base = settings(slice_reserve_usd=Decimal("1.00"))
    caps = RunCaps(
        run_cap_usd=Decimal("1.00"),
        max_companies=1,
        company_cap_usd=Decimal("1.00"),
        discovery_cap_usd=Decimal("0.50"),
    )
    with pytest.raises(Problem) as caught:
        check_discovery_size(params_of(1, 1), base, caps)
    assert "Not even one fits. Raise the run limit in Settings." in str(caught.value.detail)
    assert "(the most that fit is 0)" in caught.value.extra["errors"][0]["message"]


def test_the_check_takes_the_rules_it_is_given() -> None:
    base = settings()
    check_discovery_size(params_of(2, 4), base, caps_of(base), RULES)


def test_the_reserve_is_slices_times_the_slice_reserve() -> None:
    assert discovery_reserve_usd(12, settings()) == Decimal("7.20")
    assert discovery_reserve_usd(0, settings()) == Decimal("0")
    assert discovery_reserve_usd(3, settings(slice_reserve_usd=Decimal("0.25"))) == Decimal("0.75")


def test_the_check_fits_the_run_kind_hook() -> None:
    """RunKind.check is called with (params, settings, caps): the extra argument is optional."""
    base = settings()
    hook = check_discovery_size
    hook(params_of(1, 1), base, caps_of(base))
