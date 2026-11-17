"""The test set file loads: a slip in its YAML (a colon in a sentence) must fail a fast test, not
only the database tests that start a test run."""

import pytest
from pydantic import ValidationError

from apps.lead_finder.rules import load_rules
from apps.lead_finder.testing import TIER_RANK, TestCompany, in_range, load_testset


def test_the_test_set_file_loads_with_its_ten_public_companies() -> None:
    companies = load_testset().companies
    assert len(companies) == 10
    assert {"Culture Amp", "Canva", "Bankwest"} <= {company.name for company in companies}


def test_every_test_company_has_a_city_the_rules_list() -> None:
    places = set(load_rules().criteria.cities.every)
    for company in load_testset().companies:
        assert company.city in places, company.name


def test_canva_in_sydney_no_longer_expects_a_director_review() -> None:
    """PLAN-V16 T1-2: Sydney can pass, so no result is certain for it any more."""
    (canva,) = [company for company in load_testset().companies if company.name == "Canva"]
    assert canva.city == "Sydney"
    assert canva.expect is None


# --- The quality bar (PLAN-V21 T2-5) --------------------------------------------------------------


def test_every_test_company_has_a_tier_range_from_low_to_high() -> None:
    for company in load_testset().companies:
        assert company.tier_range is not None, company.name
        low, high = company.tier_range
        assert TIER_RANK[low] <= TIER_RANK[high], company.name


def test_a_tier_is_inside_its_range_or_not() -> None:
    assert in_range("B", ("C", "A")) is True  # C or better
    assert in_range("C", ("C", "A")) is True
    assert in_range("discard", ("C", "A")) is False
    assert in_range("A", ("discard", "C")) is False  # no better than C
    assert in_range(None, ("C", "A")) is None  # the company failed
    assert in_range("A", None) is None  # no range


def test_a_range_written_high_to_low_is_refused() -> None:
    with pytest.raises(ValidationError, match="from the lowest to the highest"):
        TestCompany(name="Acme", why="A test.", tier_range=("A", "C"))
