"""What a person can ask a run to do: defaults, limits and refusals."""

import inspect
from decimal import Decimal
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from apps.lead_finder import prompts
from apps.lead_finder.app import APP
from apps.lead_finder.params import (
    CompanyIn,
    CompanyParams,
    DiscoveryParams,
    LeadFinderRunParams,
    RunCapsIn,
    TestsetParams,
    WatchlistOptions,
    WatchlistParams,
    clean_typed_city,
    clean_typed_domain,
    default_cities,
    default_triggers,
    known_cities,
    known_trigger_ids,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.runs import RUN_KINDS, run_versions
from core.runs.types import CapsOverride


def first_error(model: type[BaseModel], data: dict[str, Any]) -> dict[str, Any]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(data)
    return dict(caught.value.errors()[0])


def test_the_defaults_are_the_pass_cities_and_the_main_triggers() -> None:
    params = LeadFinderRunParams()
    rules = load_rules().criteria
    assert params.cities == rules.cities.pass_ == ["Melbourne", "Adelaide", "Perth"]
    assert params.triggers == [t.id for t in rules.triggers.main]
    assert params.since_days == 30
    assert params.area == {}
    assert params.companies == []
    assert params.recheck is False
    assert params.watchlist == WatchlistOptions(include_unlikely=True, include_director=False)
    assert params.caps == RunCapsIn(run_cap_usd=None, max_companies=None)
    assert default_cities() == params.cities
    assert default_triggers() == params.triggers


def test_defaults_are_not_shared_between_instances() -> None:
    first = LeadFinderRunParams()
    first.cities.append("Sydney")
    assert LeadFinderRunParams().cities == ["Melbourne", "Adelaide", "Perth"]


def test_sydney_is_allowed_as_a_director_review_city() -> None:
    assert "Sydney" in known_cities()
    assert DiscoveryParams(cities=["Sydney"]).cities == ["Sydney"]


def test_a_city_is_matched_to_the_rules_spelling() -> None:
    assert DiscoveryParams(cities=["melbourne", " ADELAIDE "]).cities == ["Melbourne", "Adelaide"]


def test_a_city_can_be_listed_only_once() -> None:
    error = first_error(DiscoveryParams, {"cities": ["Melbourne", "melbourne"]})
    assert error["loc"] == ("cities",)
    assert error["msg"] == "List each city once (Melbourne is there twice)"


def test_an_unknown_city_is_refused_and_the_message_lists_the_choices() -> None:
    error = first_error(DiscoveryParams, {"cities": ["Atlantis"]})
    assert error["loc"] == ("cities",)
    assert error["msg"].startswith("Unknown city Atlantis. Choose from: Melbourne")


def test_there_must_be_at_least_one_city_and_one_trigger() -> None:
    assert first_error(DiscoveryParams, {"cities": []})["loc"] == ("cities",)
    assert first_error(DiscoveryParams, {"triggers": []})["loc"] == ("triggers",)


def test_triggers_must_exist_and_appear_once() -> None:
    assert set(default_triggers()) <= set(known_trigger_ids())
    assert DiscoveryParams(triggers=["new_ceo", "lease_ending"]).triggers == [
        "new_ceo",
        "lease_ending",
    ]
    assert first_error(DiscoveryParams, {"triggers": ["moon_landing"]})["msg"].startswith(
        "Unknown trigger moon_landing."
    )
    assert first_error(DiscoveryParams, {"triggers": ["new_ceo", "new_ceo"]})["msg"] == (
        "List each trigger once"
    )


@pytest.mark.parametrize("days", [7, 30])
def test_since_days_is_7_or_30(days: int) -> None:
    assert DiscoveryParams(since_days=days).since_days == days


@pytest.mark.parametrize("days", [0, 1, 14, 31, 90])
def test_since_days_refuses_other_numbers(days: int) -> None:
    assert first_error(DiscoveryParams, {"since_days": days})["loc"] == ("since_days",)


def test_area_keys_must_be_cities_of_the_run() -> None:
    ok = DiscoveryParams(cities=["Melbourne", "Perth"], area={"Melbourne": "cbd", "Perth": "inner"})
    assert ok.area == {"Melbourne": "cbd", "Perth": "inner"}
    error = first_error(DiscoveryParams, {"cities": ["Melbourne"], "area": {"Perth": "cbd"}})
    assert error["msg"] == "area names a city that isn't in cities: Perth"
    assert error["loc"] == ("area",)  # so the API's field is body.params.area


def errors_of(model: type[BaseModel], data: dict[str, Any]) -> list[tuple[tuple[Any, ...], str]]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(data)
    return [(tuple(e["loc"]), e["msg"]) for e in caught.value.errors()]


@pytest.mark.parametrize("model", [DiscoveryParams, LeadFinderRunParams])
def test_a_bad_area_names_the_area_field_in_every_model_that_has_it(
    model: type[BaseModel],
) -> None:
    errors = errors_of(
        model, {"cities": ["Melbourne"], "area": {"Perth": "cbd", "Adelaide": "all"}}
    )
    assert errors == [(("area",), "area names a city that isn't in cities: Adelaide, Perth")]
    # The input order doesn't matter: cities are always checked before area.
    reordered = {"area": {"Perth": "cbd"}, "cities": ["Melbourne"]}
    assert errors_of(model, reordered) == [
        (("area",), "area names a city that isn't in cities: Perth")
    ]


def test_area_keys_are_spelled_like_the_cities_are() -> None:
    params = DiscoveryParams(
        cities=["melbourne", "PERTH"], area={"MELBOURNE": "cbd", "perth": "all"}
    )
    assert params.cities == ["Melbourne", "Perth"]
    assert params.area == {"Melbourne": "cbd", "Perth": "all"}
    assert LeadFinderRunParams(area={"melbourne": "inner"}).area == {"Melbourne": "inner"}


def test_one_city_cannot_be_in_area_twice_under_two_spellings() -> None:
    errors = errors_of(DiscoveryParams, {"area": {"Melbourne": "cbd", "melbourne": "all"}})
    assert errors == [(("area",), "List each city once in area (Melbourne is there twice)")]


def test_an_area_for_a_city_nobody_knows_is_an_area_error_even_when_cities_failed() -> None:
    errors = errors_of(DiscoveryParams, {"cities": ["Atlantis"], "area": {"Atlantis": "cbd"}})
    assert [loc for loc, _ in errors] == [("cities",), ("area",)]
    # With no valid list of cities to compare to, a known city is not blamed twice.
    only_cities = errors_of(DiscoveryParams, {"cities": ["Atlantis"], "area": {"Melbourne": "cbd"}})
    assert [loc for loc, _ in only_cities] == [("cities",)]


def test_the_default_area_is_empty_and_each_instance_has_its_own() -> None:
    first, second = DiscoveryParams(), DiscoveryParams()
    assert first.area == {}
    assert first.area is not second.area


def test_an_area_is_cbd_inner_or_all() -> None:
    assert DiscoveryParams(area={"Melbourne": "all"}).area == {"Melbourne": "all"}
    error = first_error(DiscoveryParams, {"area": {"Melbourne": "suburbs"}})
    assert error["loc"] == ("area", "Melbourne")


def test_unknown_keys_are_refused_in_every_model() -> None:
    assert first_error(DiscoveryParams, {"city": ["Melbourne"]})["type"] == "extra_forbidden"
    assert first_error(WatchlistParams, {"cities": ["Melbourne"]})["type"] == "extra_forbidden"
    assert first_error(TestsetParams, {"anything": 1})["type"] == "extra_forbidden"
    assert first_error(LeadFinderRunParams, {"typo": 1})["type"] == "extra_forbidden"
    assert first_error(WatchlistOptions, {"everything": True})["type"] == "extra_forbidden"
    assert first_error(RunCapsIn, {"cap": 5})["type"] == "extra_forbidden"


def test_companies_belong_to_the_company_mode_only() -> None:
    assert first_error(DiscoveryParams, {"companies": [{"name": "Acme"}]})["type"] == (
        "extra_forbidden"
    )
    assert first_error(WatchlistParams, {"companies": [{"name": "Acme"}]})["type"] == (
        "extra_forbidden"
    )
    assert first_error(CompanyParams, {"cities": ["Melbourne"], "companies": [{"name": "Acme"}]})[
        "type"
    ] == ("extra_forbidden")
    assert CompanyParams(companies=[CompanyIn(name="Acme Software")]).companies[0].name == (
        "Acme Software"
    )


def test_the_company_mode_needs_between_1_and_25_companies() -> None:
    assert first_error(CompanyParams, {"companies": []})["loc"] == ("companies",)
    assert first_error(CompanyParams, {})["loc"] == ("companies",)
    names = [{"name": f"Company {chr(65 + i)}"} for i in range(25)]
    assert len(CompanyParams.model_validate({"companies": names}).companies) == 25
    too_many = [*names, {"name": "Company Z"}]
    assert first_error(CompanyParams, {"companies": too_many})["loc"] == ("companies",)
    assert first_error(LeadFinderRunParams, {"companies": too_many})["loc"] == ("companies",)


def test_each_company_is_listed_once() -> None:
    twice = {"companies": [{"name": "Acme Software"}, {"name": "ACME software Pty Ltd"}]}
    error = first_error(CompanyParams, twice)
    assert error["loc"] == ("companies",)
    assert error["msg"].startswith("List each company once")


@pytest.mark.parametrize(
    "name",
    [
        "",
        "A",
        "<script>alert(1)</script>",
        "Acme; DROP TABLE leads",
        "Acme\x00<b>",
        "one two three four five six seven eight nine",
        "x" * 81,
        "!!!",
    ],
)
def test_a_name_that_is_not_usable_is_a_422_on_that_field(name: str) -> None:
    error = first_error(CompanyParams, {"companies": [{"name": name}]})
    assert error["loc"] == ("companies", 0, "name")
    assert "Value error" not in error["msg"]  # plain words, no pydantic prefix
    assert "2 to 80 characters" in error["msg"]


def test_a_good_name_is_cleaned() -> None:
    company = CompanyIn(name="  Alvarez &   Marsal ")
    assert company.name == "Alvarez & Marsal"
    assert CompanyIn(name="O\N{RIGHT SINGLE QUOTATION MARK}Connor (Melbourne) Pty. Ltd.").name == (
        "O\N{RIGHT SINGLE QUOTATION MARK}Connor (Melbourne) Pty. Ltd."
    )


def test_a_typed_city_is_the_rules_spelling_or_plain_place_text() -> None:
    assert clean_typed_city(" melbourne ") == "Melbourne"
    assert clean_typed_city("Brisbane") == "Brisbane"  # not in the rules: a Director looks
    assert clean_typed_city(None) is None
    assert clean_typed_city("   ") is None
    for bad in ["Melb0urne", "<b>x</b>", "Perth; DROP TABLE", "x" * 61]:
        with pytest.raises(ValueError):
            clean_typed_city(bad)


def test_line_breaks_and_hidden_characters_in_typed_text_never_survive() -> None:
    """The sanitiser turns a line break into a space and drops invisible characters, so typed
    text can't start a new line in a prompt or hide a reversed word in a name."""
    assert clean_typed_city("Perth\nSydney") == "Perth Sydney"
    assert CompanyIn(name="Acme\nSoftware").name == "Acme Software"
    assert CompanyIn(name="Ac\N{RIGHT-TO-LEFT OVERRIDE}me").name == "Acme"


def test_a_typed_website_becomes_a_bare_domain() -> None:
    assert clean_typed_domain("cultureamp.com") == "cultureamp.com"
    assert clean_typed_domain("https://www.CultureAmp.com/about?x=1") == "cultureamp.com"
    assert clean_typed_domain("http://seek.com.au") == "seek.com.au"
    assert clean_typed_domain(None) is None
    assert clean_typed_domain("  ") is None
    for bad in ["javascript:alert(1)", "not a domain", "acme", "acme.com/path", "a" * 120 + ".com"]:
        with pytest.raises(ValueError):
            clean_typed_domain(bad)


def test_bad_city_and_website_name_their_fields() -> None:
    body = {"companies": [{"name": "Acme", "city": "Perth;", "website": "x y"}]}
    with pytest.raises(ValidationError) as caught:
        CompanyParams.model_validate(body)
    locs = {error["loc"] for error in caught.value.errors()}
    assert locs == {("companies", 0, "city"), ("companies", 0, "website")}


def test_caps_must_be_above_zero_and_have_cents() -> None:
    assert RunCapsIn(run_cap_usd=Decimal("5.50"), max_companies=3).run_cap_usd == Decimal("5.50")
    assert first_error(RunCapsIn, {"run_cap_usd": 0})["loc"] == ("run_cap_usd",)
    assert first_error(RunCapsIn, {"run_cap_usd": "-1"})["loc"] == ("run_cap_usd",)
    assert first_error(RunCapsIn, {"run_cap_usd": "1.234"})["loc"] == ("run_cap_usd",)
    assert first_error(RunCapsIn, {"max_companies": 0})["loc"] == ("max_companies",)
    assert first_error(RunCapsIn, {"max_companies": -2})["loc"] == ("max_companies",)
    assert first_error(RunCapsIn, {"max_companies": 101})["loc"] == ("max_companies",)


def test_caps_are_checked_inside_every_mode() -> None:
    bad = {"caps": {"run_cap_usd": 0}}
    for model in (DiscoveryParams, WatchlistParams, TestsetParams, LeadFinderRunParams):
        assert first_error(model, bad)["loc"] == ("caps", "run_cap_usd")
    error = first_error(CompanyParams, {"companies": [{"name": "Acme"}], **bad})
    assert error["loc"] == ("caps", "run_cap_usd")


def test_the_watchlist_limit_is_between_1_and_200() -> None:
    assert WatchlistParams.model_validate({"watchlist": {"limit": 200}}).watchlist.limit == 200
    assert WatchlistParams().watchlist.limit is None
    for bad in (0, 201, -1):
        assert first_error(WatchlistParams, {"watchlist": {"limit": bad}})["loc"] == (
            "watchlist",
            "limit",
        )


def test_the_testset_needs_nothing() -> None:
    assert TestsetParams().caps == RunCapsIn(run_cap_usd=None, max_companies=None)


def test_recheck_defaults_to_false_and_is_part_of_the_company_mode() -> None:
    assert CompanyParams(companies=[CompanyIn(name="Acme")]).recheck is False
    assert CompanyParams(companies=[CompanyIn(name="Acme")], recheck=True).recheck is True
    assert first_error(DiscoveryParams, {"recheck": True})["type"] == "extra_forbidden"


def test_the_params_survive_a_json_round_trip() -> None:
    params = LeadFinderRunParams(
        cities=["Perth"],
        area={"Perth": "inner"},
        companies=[CompanyIn(name="Acme", city="Perth", website="acme.com.au")],
        caps=RunCapsIn(run_cap_usd=Decimal("7.25"), max_companies=4),
    )
    dumped = params.model_dump(mode="json")
    assert dumped["caps"]["run_cap_usd"] == "7.25"
    assert LeadFinderRunParams.model_validate(dumped) == params


def test_the_run_kinds_cover_the_four_modes_with_their_models() -> None:
    models = {kind.mode: kind.params_model for kind in RUN_KINDS}
    assert models == {
        "discovery": DiscoveryParams,
        "watchlist": WatchlistParams,
        "company": CompanyParams,
        "testset": TestsetParams,
    }
    assert APP.run_kinds == RUN_KINDS
    for kind in RUN_KINDS:
        assert kind.title
        assert inspect.iscoroutinefunction(kind.handler)
        assert inspect.iscoroutinefunction(kind.estimate)


# --- The hooks that tell the run manager what only this project knows -------------------------

SAMPLE_PARAMS: dict[str, dict[str, Any]] = {
    "discovery": {},
    "watchlist": {},
    "company": {"companies": [{"name": "Culture Amp"}]},
    "testset": {},
}


def test_every_kind_hands_over_the_limits_a_person_chose() -> None:
    """Each mode has `params.caps`, and `caps_override` is the one typed way to read it."""
    for kind in RUN_KINDS:
        assert kind.caps_override is not None, kind.mode
        plain = kind.params_model.model_validate(SAMPLE_PARAMS[kind.mode])
        assert kind.caps_override(plain) == CapsOverride(None, None), kind.mode
        chosen = kind.params_model.model_validate(
            SAMPLE_PARAMS[kind.mode] | {"caps": {"run_cap_usd": "7.50", "max_companies": 5}}
        )
        assert kind.caps_override(chosen) == CapsOverride(Decimal("7.50"), 5), kind.mode


def test_every_kind_gives_the_rules_and_prompt_versions() -> None:
    rules = load_rules()
    for kind in RUN_KINDS:
        assert kind.versions is run_versions, kind.mode
    versions = run_versions()
    assert versions.rules == rules.version
    assert versions.prompts == prompts.run_versions(rules)  # research, extract and discover
    assert versions.prompts.startswith(prompts.versions(rules))
    assert versions.prompts.startswith("research ")
    assert 0 < len(versions.rules) <= 32  # the sizes of the run row's columns
    assert 0 < len(versions.prompts) <= 128
