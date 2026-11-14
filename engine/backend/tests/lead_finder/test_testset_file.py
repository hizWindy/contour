"""The test set file loads: a slip in its YAML (a colon in a sentence) must fail a fast test, not
only the database tests that start a test run."""

from apps.lead_finder.rules import load_rules
from apps.lead_finder.testing import load_testset


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
