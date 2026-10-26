"""Map places: every suburb the rules search has a place, and pins are stable and approximate."""

import math
import uuid

import pytest

from apps.lead_finder.geo import (
    CITY_CENTRES,
    CITY_JITTER,
    SUBURB_CENTRES,
    SUBURB_JITTER,
    approximate_point,
    find_suburb,
    jitter,
)
from apps.lead_finder.rules import load_rules

RULES = load_rules()
AREA_SUBURBS = [
    (city, suburb)
    for city, areas in RULES.queries.areas.items()
    for suburbs in areas.values()
    for suburb in suburbs
]


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    """The straight-line distance between two (lat, lng) points, in metres."""
    radius = 6_371_000
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlng = lat2 - lat1, math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def test_every_city_in_the_rules_has_a_centre() -> None:
    cities = [*RULES.criteria.cities.pass_, *RULES.criteria.cities.director_review]
    assert {"Melbourne", "Adelaide", "Perth", "Sydney"} <= set(cities)
    for city in cities:
        assert city in CITY_CENTRES, city


def test_every_suburb_in_the_rules_areas_has_a_place() -> None:
    assert AREA_SUBURBS  # the rules do list suburbs
    for city, suburb in AREA_SUBURBS:
        assert suburb in SUBURB_CENTRES.get(city, {}), f"{city}: {suburb}"


def test_every_suburb_in_the_table_belongs_to_a_city_with_a_centre() -> None:
    assert set(SUBURB_CENTRES) <= set(CITY_CENTRES)


@pytest.mark.parametrize(("city", "suburb"), AREA_SUBURBS)
def test_a_suburb_is_in_its_own_city(city: str, suburb: str) -> None:
    """Catches a mistyped sign or digit: no suburb is more than 8 km from its city's centre."""
    assert metres(SUBURB_CENTRES[city][suburb], CITY_CENTRES[city]) < 8_000


def test_the_city_centres_are_in_australia() -> None:
    for lat, lng in CITY_CENTRES.values():
        assert -45 < lat < -10
        assert 112 < lng < 155


def test_the_city_centres_are_in_the_right_places() -> None:
    assert metres(CITY_CENTRES["Melbourne"], CITY_CENTRES["Sydney"]) == pytest.approx(
        713_000, rel=0.02
    )
    assert CITY_CENTRES["Perth"][1] < 120 < CITY_CENTRES["Sydney"][1]  # Perth is far west


def test_the_jitter_is_stable_and_small() -> None:
    key = uuid.UUID("11111111-2222-3333-4444-555555555555")
    assert jitter(key, SUBURB_JITTER) == jitter(key, SUBURB_JITTER)
    assert jitter(key, SUBURB_JITTER) == jitter(str(key), SUBURB_JITTER)
    lat, lng = jitter(key, SUBURB_JITTER)
    assert abs(lat) <= SUBURB_JITTER
    assert abs(lng) <= SUBURB_JITTER


def test_different_ids_move_to_different_places() -> None:
    shifts = {jitter(uuid.UUID(int=i), CITY_JITTER) for i in range(200)}
    assert len(shifts) == 200
    assert max(abs(lat) for lat, _ in shifts) <= CITY_JITTER


def test_a_known_suburb_is_pinned_near_its_centre() -> None:
    key = uuid.uuid4()
    point = approximate_point("Melbourne", "Docklands", key)
    assert point is not None
    assert metres(point, SUBURB_CENTRES["Melbourne"]["Docklands"]) < 400


def test_an_unknown_suburb_is_pinned_near_the_city_centre() -> None:
    point = approximate_point("Perth", "Joondalup", uuid.uuid4())
    assert point is not None
    assert metres(point, CITY_CENTRES["Perth"]) < 2_000
    no_suburb = approximate_point("Perth", None, uuid.uuid4())
    assert no_suburb is not None
    assert metres(no_suburb, CITY_CENTRES["Perth"]) < 2_000


def test_a_city_that_is_not_known_has_no_place() -> None:
    assert approximate_point(None, "Docklands", uuid.uuid4()) is None
    assert approximate_point("Brisbane", None, uuid.uuid4()) is None


def test_the_same_lead_is_always_in_the_same_place() -> None:
    key = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    assert approximate_point("Sydney", "Pyrmont", key) == approximate_point(
        "Sydney", "Pyrmont", key
    )
    other = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef")
    assert approximate_point("Sydney", "Pyrmont", key) != approximate_point(
        "Sydney", "Pyrmont", other
    )


def test_two_leads_in_one_suburb_do_not_share_a_pin() -> None:
    first = approximate_point("Melbourne", "Southbank", uuid.UUID(int=1))
    second = approximate_point("Melbourne", "Southbank", uuid.UUID(int=2))
    assert first != second


def test_suburb_text_is_matched_loosely_but_only_as_whole_words() -> None:
    docklands = SUBURB_CENTRES["Melbourne"]["Docklands"]
    assert find_suburb("Melbourne", "docklands") == docklands
    assert find_suburb("Melbourne", "  DOCKLANDS  ") == docklands
    assert find_suburb("Melbourne", "Docklands VIC") == docklands
    assert find_suburb("Melbourne", "Collins St, Docklands, Victoria") == docklands
    assert find_suburb("Melbourne", "Richmondville") is None
    assert find_suburb("Melbourne", "Subiaco") is None  # a Perth suburb, not a Melbourne one
    assert find_suburb("Melbourne", None) is None
    assert find_suburb("Melbourne", "") is None


def test_the_longest_name_wins() -> None:
    south = SUBURB_CENTRES["Melbourne"]["South Melbourne"]
    assert find_suburb("Melbourne", "South Melbourne VIC 3205") == south
    north = SUBURB_CENTRES["Sydney"]["North Sydney"]
    assert find_suburb("Sydney", "North Sydney NSW") == north
