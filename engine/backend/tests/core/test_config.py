"""Settings: defaults, bounds, the loopback checks, the ceilings and the connection string."""

from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from psycopg.conninfo import conninfo_to_dict
from pydantic import ValidationError

from core.config import (
    CEILINGS,
    EDITABLE_KEYS,
    EFFORT_CHOICES,
    MODEL_CHOICES,
    Settings,
    clamp_to_ceilings,
    discovery_cap_usd,
    field_bounds,
    get_settings,
)
from core.memory.embedder import Embedder, get_embedder

ENV_ONLY = [
    "hubspot_names_to_claude_ok",
    "hard_run_cap_usd",
    "hard_company_cap_usd",
    "hard_concurrency",
    "daily_cap_usd",
    "embedding_threads",
    "langgraph_schema",
    "db_pool_size",
    "db_max_overflow",
    "db_pool_timeout",
    "cors_origins",
    "api_host",
]
CHOICE_KEYS = {"claude_model", "model_discover", "model_search", "model_extract", "claude_effort"}


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """The test setup puts a few settings in the environment. Take them out of these tests."""
    for key in Settings.model_fields:
        monkeypatch.delenv(key.upper(), raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()  # so no later test sees values read inside this one


def make(**values: Any) -> Settings:
    """Settings from these values and the defaults only: no .env file, no environment."""
    return Settings(_env_file=None, **values)


def test_defaults_are_the_ones_in_the_design() -> None:
    s = make()
    assert s.company_cap_usd == Decimal("2.50")
    assert s.run_cap_usd == Decimal("20.00")
    assert (s.company_max_searches, s.searches_per_request, s.fetches_per_request) == (12, 3, 3)
    assert s.request_reserve_usd == Decimal("0.80")
    assert (s.run_max_companies, s.slice_max_searches) == (20, 6)
    assert s.slice_reserve_usd == Decimal("0.60")  # TBC: 12 default slices fit $8.00
    assert s.discovery_share == 0.40
    assert (s.run_company_concurrency, s.run_discover_concurrency) == (2, 3)
    assert (s.max_concurrent_runs, s.claude_concurrency) == (1, 2)
    assert (s.memory_fresh_days, s.match_fuzzy_min, s.match_profile_min) == (30, 90, 0.90)
    assert (s.model_discover, s.model_search, s.model_extract) == (None, None, None)
    assert (s.hard_run_cap_usd, s.hard_company_cap_usd) == (Decimal("50"), Decimal("5"))
    assert (s.hard_concurrency, s.daily_cap_usd) == (4, Decimal("50"))
    assert (s.db_pool_size, s.db_max_overflow, s.db_pool_timeout) == (10, 10, 10)
    assert s.langgraph_schema == "langgraph"
    assert s.embedding_threads is None
    assert s.hubspot_names_to_claude_ok is False
    assert s.cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert s.api_host == "127.0.0.1"


def test_editable_keys_exist_and_env_only_keys_are_not_editable() -> None:
    assert len(EDITABLE_KEYS) == len(set(EDITABLE_KEYS))
    for key in EDITABLE_KEYS:
        assert key in Settings.model_fields, key
    assert not set(ENV_ONLY) & set(EDITABLE_KEYS)
    for key in ENV_ONLY:
        assert key in Settings.model_fields, key


def test_every_editable_number_has_a_min_and_a_max_and_the_default_sits_inside() -> None:
    defaults = make()
    for key in EDITABLE_KEYS:
        if key in CHOICE_KEYS:
            continue
        low, high = field_bounds(key)
        assert low is not None and high is not None, key
        assert low <= getattr(defaults, key) <= high, key


def test_the_max_of_a_capped_setting_is_at_or_below_its_ceiling() -> None:
    defaults = make()
    for key, ceiling in CEILINGS.items():
        assert key in EDITABLE_KEYS
        assert field_bounds(key)[1] <= getattr(defaults, ceiling), key


def test_a_ceiling_never_has_a_lower_minimum_than_the_settings_it_caps() -> None:
    """A ceiling below an editable minimum would clamp a valid value to one that setting itself
    refuses. So every ceiling is bounded below by at least the biggest minimum it caps."""
    for key, ceiling in CEILINGS.items():
        key_min = field_bounds(key)[0]
        ceiling_min = field_bounds(ceiling)[0]
        assert key_min is not None, key
        assert ceiling_min is not None, f"{ceiling} has no minimum"
        assert ceiling_min >= key_min, f"{ceiling} (min {ceiling_min}) caps {key} (min {key_min})"


def test_the_two_money_ceilings_have_the_lower_bounds_of_the_settings_they_cap() -> None:
    assert field_bounds("hard_company_cap_usd")[0] == Decimal("0.10")
    assert field_bounds("hard_run_cap_usd")[0] == Decimal("1")


@pytest.mark.parametrize(
    ("key", "low", "just_below"),
    [
        ("hard_company_cap_usd", "0.10", "0.09"),
        ("hard_run_cap_usd", "1", "0.99"),
        ("hard_concurrency", 1, 0),
    ],
)
def test_a_ceiling_below_its_lower_bound_is_refused(key: str, low: Any, just_below: Any) -> None:
    make(**{key: low})  # the bound itself is fine
    for bad in (just_below, 0, -1):
        with pytest.raises(ValidationError):
            make(**{key: bad})


def test_a_ceiling_at_its_lower_bound_pulls_every_capped_setting_down_to_a_valid_value() -> None:
    """Even at the lowest ceilings, what the clamp makes is something the settings accept."""
    s = make(hard_company_cap_usd="0.10", hard_run_cap_usd="1", hard_concurrency=1)
    clamped = clamp_to_ceilings(s)
    Settings.model_validate(clamped.model_dump())
    assert (clamped.company_cap_usd, clamped.request_reserve_usd) == (Decimal("0.10"),) * 2
    assert (clamped.slice_reserve_usd, clamped.run_cap_usd) == (Decimal("0.10"), Decimal("1"))


def nudge(value: Any, direction: int) -> Any:
    """A little above (1) or below (-1) a bound, in the bound's own type."""
    if isinstance(value, Decimal):
        return value + direction * Decimal("0.01")
    if isinstance(value, int):
        return value + direction
    return value + direction * 0.01


# A bound of one setting that the reserve rules refuse on their own, so the test sets the
# other side of the rule as well (see "A reserve can't be more than the cap it comes from").
PARTNER_AT_THE_END: dict[tuple[str, str], dict[str, Any]] = {
    ("company_cap_usd", "low"): {"request_reserve_usd": "0.10"},
    ("request_reserve_usd", "high"): {"company_cap_usd": "5"},
    ("run_cap_usd", "low"): {"slice_reserve_usd": "0.10"},
}


@pytest.mark.parametrize("key", [k for k in EDITABLE_KEYS if k not in CHOICE_KEYS])
def test_values_outside_the_bounds_are_refused(key: str) -> None:
    low, high = field_bounds(key)
    for bad in (nudge(low, -1), nudge(high, 1)):
        with pytest.raises(ValidationError) as error:
            make(**{key: bad})
        assert key in str(error.value)
    make(**{key: low}, **PARTNER_AT_THE_END.get((key, "low"), {}))  # the ends are fine
    make(**{key: high}, **PARTNER_AT_THE_END.get((key, "high"), {}))


# --- A reserve can't be more than the cap it comes from ---------------------------------------


def problems(error: ValidationError) -> list[tuple[str, str, str]]:
    """Each error as (setting, type, message), so a test can see where it is shown."""
    return [(str(item["loc"][0]), item["type"], item["msg"]) for item in error.errors()]


RESERVE_PROBLEM = (
    "request_reserve_usd ($0.80) is more than company_cap_usd ($0.50), "
    "so no request could start. Lower the reserve or raise the cap."
)
SLICE_PROBLEM = (
    "slice_reserve_usd ($0.60) is more than discovery may spend in a run ($0.40: "
    "discovery_share 0.4 of run_cap_usd $1.00), so no discovery request could start. "
    "Lower the reserve, or raise the run cap or the discovery share."
)


def test_a_lone_lower_company_cap_is_refused_as_a_field_error() -> None:
    """The request reserve is $0.80. A cap of $0.50 would make every request fail."""
    with pytest.raises(ValidationError) as caught:
        make(company_cap_usd="0.50")
    assert problems(caught.value) == [
        ("request_reserve_usd", "reserve_too_big", RESERVE_PROBLEM),
        ("company_cap_usd", "reserve_too_big", RESERVE_PROBLEM),
    ]


def test_a_lone_higher_request_reserve_is_refused_too() -> None:
    with pytest.raises(ValidationError, match=r"request_reserve_usd \(\$2\.60\) is more than"):
        make(request_reserve_usd="2.60")


def test_a_reserve_equal_to_its_cap_is_fine_and_so_are_both_lowered_together() -> None:
    assert make(company_cap_usd="0.80").company_cap_usd == Decimal("0.80")
    lowered = make(company_cap_usd="0.50", request_reserve_usd="0.50")
    assert (lowered.company_cap_usd, lowered.request_reserve_usd) == (Decimal("0.50"),) * 2


def test_the_same_check_runs_when_the_settings_page_validates_the_overrides() -> None:
    """`effective_settings` is `Settings.model_validate` of the values with the overrides."""
    values = make().model_dump() | {"company_cap_usd": "0.50"}
    with pytest.raises(ValidationError) as caught:
        Settings.model_validate(values)
    assert {name for name, _, _ in problems(caught.value)} == {
        "request_reserve_usd",
        "company_cap_usd",
    }
    values["request_reserve_usd"] = "0.50"  # the reserve comes down with the cap
    assert Settings.model_validate(values).company_cap_usd == Decimal("0.50")


def test_a_lone_lower_run_cap_is_refused_because_discovery_could_not_afford_a_slice() -> None:
    """Discovery may spend 40 percent of $1.00. The slice reserve is $0.60."""
    with pytest.raises(ValidationError) as caught:
        make(run_cap_usd="1")
    assert problems(caught.value) == [
        ("slice_reserve_usd", "reserve_too_big", SLICE_PROBLEM),
        ("run_cap_usd", "reserve_too_big", SLICE_PROBLEM),
        ("discovery_share", "reserve_too_big", SLICE_PROBLEM),
    ]


def test_a_lone_lower_discovery_share_is_refused_too() -> None:
    with pytest.raises(ValidationError, match=r"discovery_share 0.05 of run_cap_usd \$10\.00"):
        make(run_cap_usd="10", discovery_share=0.05)  # 0.05 of $10.00 is $0.50
    assert make(run_cap_usd="12", discovery_share=0.05).discovery_share == 0.05  # exactly $0.60


def test_the_slice_reserve_is_compared_with_the_discovery_cap_in_whole_cents() -> None:
    """`make_caps` rounds the discovery cap down to the cent, so the check does too."""
    assert make(run_cap_usd="1.50", discovery_share=0.40).slice_reserve_usd == Decimal("0.60")
    with pytest.raises(ValidationError, match=r"may spend in a run \(\$0\.59:"):
        make(run_cap_usd="1.49", discovery_share=0.40)  # 0.596 is $0.59


def test_a_lone_lower_cap_in_the_environment_stops_the_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("COMPANY_CAP_USD", "0.50")
    with pytest.raises(ValidationError, match="request_reserve_usd"):
        Settings(_env_file=None)
    with pytest.raises(ValidationError, match="request_reserve_usd"):
        get_settings()


def test_both_problems_come_in_one_answer() -> None:
    with pytest.raises(ValidationError) as caught:
        make(company_cap_usd="0.50", run_cap_usd="1")
    assert len(caught.value.errors()) == 5
    assert {name for name, _, _ in problems(caught.value)} == {
        "request_reserve_usd",
        "company_cap_usd",
        "slice_reserve_usd",
        "run_cap_usd",
        "discovery_share",
    }


@pytest.mark.parametrize(
    ("run_cap", "share", "expected"),
    [
        ("20.00", 0.40, "8.00"),
        ("7.33", 0.40, "2.93"),  # 2.932, cut to the cent
        ("1", 0.05, "0.05"),
        ("2.49", 0.40, "0.99"),
        ("50", 0.90, "45.00"),
    ],
)
def test_the_discovery_cap_is_the_share_of_the_run_cap_in_whole_cents_rounded_down(
    run_cap: str, share: float, expected: str
) -> None:
    assert discovery_cap_usd(Decimal(run_cap), share) == Decimal(expected)


def test_the_embedding_thread_count_is_none_or_a_small_positive_number() -> None:
    assert make().embedding_threads is None
    assert make(embedding_threads=2).embedding_threads == 2
    for bad in (0, -1, 65):
        with pytest.raises(ValidationError):
            make(embedding_threads=bad)


def test_the_pool_and_port_settings_have_sane_limits() -> None:
    for key, bad in (
        ("db_pool_size", 0),
        ("db_max_overflow", -1),
        ("db_pool_timeout", 0),
        ("api_port", 0),
        ("api_port", 70000),
    ):
        with pytest.raises(ValidationError):
            make(**{key: bad})
    assert make(db_max_overflow=0).db_max_overflow == 0


def test_models_and_effort_are_a_fixed_list() -> None:
    assert MODEL_CHOICES == ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")
    assert EFFORT_CHOICES == ("low", "medium", "high", "xhigh", "max")
    for key in ("claude_model", "model_discover", "model_search", "model_extract"):
        with pytest.raises(ValidationError):
            make(**{key: "gpt-9"})
    with pytest.raises(ValidationError):
        make(claude_effort="extreme")
    assert make(model_extract="claude-haiku-5-5").model_extract == "claude-haiku-5-5"


def test_each_step_uses_its_own_model_or_the_main_one() -> None:
    s = make(claude_model="claude-sonnet-5-5", model_discover="claude-haiku-5-5")
    assert s.model_for("discover") == "claude-haiku-5-5"
    assert s.model_for("search") == "claude-sonnet-5-5"
    assert s.model_for("extract") == "claude-sonnet-5-5"


# --- The HubSpot approval switch: env-only and strict ----------------------------------


def test_the_hubspot_switch_turns_on_only_with_the_exact_text_true(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HUBSPOT_NAMES_TO_CLAUDE_OK", "true")
    assert Settings(_env_file=None).hubspot_names_to_claude_ok is True
    monkeypatch.setenv("HUBSPOT_NAMES_TO_CLAUDE_OK", "FALSE")
    assert Settings(_env_file=None).hubspot_names_to_claude_ok is False
    for stray in ("1", "yes", "on", "t", "y", "2"):
        monkeypatch.setenv("HUBSPOT_NAMES_TO_CLAUDE_OK", stray)
        with pytest.raises(ValidationError):
            Settings(_env_file=None)


@pytest.mark.parametrize("value", [1, 0, "yes", "on", None, "1"])
def test_the_hubspot_switch_refuses_anything_but_a_real_bool(value: object) -> None:
    with pytest.raises(ValidationError):
        make(hubspot_names_to_claude_ok=value)
    assert make(hubspot_names_to_claude_ok=True).hubspot_names_to_claude_ok is True


# --- Loopback only -----------------------------------------------------------------------


def test_cors_origins_are_cleaned_and_listed_once() -> None:
    s = make(
        cors_origins=["HTTP://LOCALHOST:5173/", "http://localhost:5173", "https://127.0.0.1:4443"]
    )
    assert s.cors_origins == ["http://localhost:5173", "https://127.0.0.1:4443"]
    assert make(cors_origins=[]).cors_origins == []


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "http://*",
        "http://evil.example",
        "http://localhost.evil.example:5173",
        "http://evil.example/localhost",
        "http://localhost@evil.example",
        "http://user:pw@localhost:5173",
        "http://localhost:5173/app",
        "http://localhost:5173?x=1",
        "http://localhost:99999",
        "http://0.0.0.0:5173",
        "http://192.168.1.10:5173",
        "ftp://localhost",
        "localhost:5173",
        "",
        "null",
    ],
)
def test_cors_origins_refuse_anything_but_this_computer(origin: str) -> None:
    with pytest.raises(ValidationError):
        make(cors_origins=["http://localhost:5173", origin])


def test_cors_origins_can_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", '["http://127.0.0.1:5199"]')
    assert Settings(_env_file=None).cors_origins == ["http://127.0.0.1:5199"]
    monkeypatch.setenv("CORS_ORIGINS", '["*"]')
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    ("host", "kept"),
    [
        ("127.0.0.1", "127.0.0.1"),
        ("localhost", "localhost"),
        ("LOCALHOST", "localhost"),
        (" 127.0.0.1 ", "127.0.0.1"),
    ],
)
def test_the_api_host_is_localhost_or_127_0_0_1_and_nothing_else(host: str, kept: str) -> None:
    assert make(api_host=host).api_host == kept


@pytest.mark.parametrize(
    "host",
    [
        # Other addresses of this computer. The host check in core/api accepts only the two.
        "::1",
        "[::1]",
        "127.0.0.2",
        "127.1",
        "0:0:0:0:0:0:0:1",
        # Addresses that face a network.
        "0.0.0.0",
        "::",
        "192.168.1.5",
        "example.com",
        "localhost.example.com",
        "",
        "10.0.0.1",
    ],
)
def test_the_api_host_may_not_be_anything_else(host: str) -> None:
    with pytest.raises(ValidationError):
        make(api_host=host)


@pytest.mark.parametrize("name", ["Langgraph", "a;drop", "1abc", "a" * 64, "", "two words", "x-y"])
def test_the_checkpoint_schema_is_a_plain_name(name: str) -> None:
    with pytest.raises(ValidationError):
        make(langgraph_schema=name)


def test_a_plain_checkpoint_schema_name_is_kept() -> None:
    assert make(langgraph_schema="run_state2").langgraph_schema == "run_state2"


@pytest.mark.parametrize(
    "name",
    [
        "public",
        "core",
        "lead_finder",
        "information_schema",
        " public ",  # spaces are trimmed first
        "pg_catalog",
        "pg_toast",
        "pg_temp_1",
        "pg_",
        "pg_langgraph",  # any name that starts with pg_
    ],
)
def test_the_checkpoint_schema_may_not_be_a_schema_that_belongs_to_something_else(
    name: str,
) -> None:
    with pytest.raises(ValidationError, match="langgraph_schema"):
        make(langgraph_schema=name)


@pytest.mark.parametrize("name", ["langgraph", "pgstate", "xpg_state", "core2", "public_state"])
def test_names_that_only_look_like_the_reserved_ones_are_kept(name: str) -> None:
    assert make(langgraph_schema=name).langgraph_schema == name


# --- The ceilings ------------------------------------------------------------------------


def test_the_ceilings_pull_values_down() -> None:
    s = make(
        hard_company_cap_usd="1",
        hard_run_cap_usd="10",
        hard_concurrency=1,
        run_company_concurrency=3,
        claude_concurrency=4,
    )
    clamped = clamp_to_ceilings(s)
    assert clamped.company_cap_usd == Decimal("1")  # 2.50 was above the ceiling
    assert clamped.request_reserve_usd == Decimal("0.80")  # already below it
    assert clamped.slice_reserve_usd == Decimal("0.60")  # already below it
    assert clamped.run_cap_usd == Decimal("10")
    assert (clamped.run_company_concurrency, clamped.run_discover_concurrency) == (1, 1)
    assert (clamped.max_concurrent_runs, clamped.claude_concurrency) == (1, 1)
    assert s.company_cap_usd == Decimal("2.50")  # the original is not changed


def test_values_inside_the_ceilings_pass_through_untouched() -> None:
    s = make()
    assert clamp_to_ceilings(s) is s
    assert clamp_to_ceilings(clamp_to_ceilings(s)) is s


def test_a_clamped_copy_is_still_valid() -> None:
    clamped = clamp_to_ceilings(make(hard_company_cap_usd="0.50"))
    Settings.model_validate(clamped.model_dump())
    assert clamped.company_cap_usd == Decimal("0.50")


def test_a_lower_run_ceiling_brings_the_slice_reserve_down_with_the_discovery_cap() -> None:
    """A $1 run leaves discovery $0.40. The $1.00 slice reserve comes down to it, not above."""
    clamped = clamp_to_ceilings(make(hard_run_cap_usd="1"))
    assert clamped.run_cap_usd == Decimal("1")
    assert clamped.slice_reserve_usd == Decimal("0.40")
    assert clamped.request_reserve_usd == Decimal("0.80")  # not part of this
    Settings.model_validate(clamped.model_dump())  # the copy is still a valid set of settings


def test_a_lower_company_ceiling_brings_both_reserves_down_with_the_cap() -> None:
    clamped = clamp_to_ceilings(make(hard_company_cap_usd="0.50"))
    assert clamped.company_cap_usd == Decimal("0.50")
    assert clamped.request_reserve_usd == Decimal("0.50")
    assert clamped.slice_reserve_usd == Decimal("0.50")
    Settings.model_validate(clamped.model_dump())


def test_the_clamp_keeps_a_reserve_that_is_already_small_enough() -> None:
    clamped = clamp_to_ceilings(make(hard_company_cap_usd="1", hard_run_cap_usd="10"))
    assert clamped.request_reserve_usd == Decimal("0.80")
    assert clamped.slice_reserve_usd == Decimal("0.60")  # discovery has $4.00


def test_the_clamp_pulls_a_reserve_down_with_a_cap_that_was_lowered_outside_the_checks() -> None:
    """A copy made with `model_copy` is not checked. The clamp still leaves the pair right."""
    odd = make().model_copy(update={"company_cap_usd": Decimal("0.50")})
    assert clamp_to_ceilings(odd).request_reserve_usd == Decimal("0.50")


@pytest.mark.parametrize("company_ceiling", ["0.10", "0.50", "1", "5"])
@pytest.mark.parametrize("run_ceiling", ["1", "2", "10", "50"])
@pytest.mark.parametrize("share", [0.10, 0.40, 0.90])
def test_whatever_the_ceilings_the_clamped_copy_is_valid(
    company_ceiling: str, run_ceiling: str, share: float
) -> None:
    clamped = clamp_to_ceilings(
        make(
            hard_company_cap_usd=company_ceiling,
            hard_run_cap_usd=run_ceiling,
            discovery_share=share,
        )
    )
    assert clamped.request_reserve_usd <= clamped.company_cap_usd
    assert clamped.slice_reserve_usd <= discovery_cap_usd(clamped.run_cap_usd, share)
    Settings.model_validate(clamped.model_dump())


def test_a_run_ceiling_too_low_for_the_share_cuts_the_slice_reserve_below_its_own_minimum() -> None:
    """The one case a copy can't be whole: a $1 run with a share of 0.05 leaves discovery $0.05,
    and a slice reserve is at least $0.10. The reserve is cut to the $0.05, so a slice can start."""
    clamped = clamp_to_ceilings(make(hard_run_cap_usd="1", discovery_share=0.05))
    assert clamped.slice_reserve_usd == Decimal("0.05")
    with pytest.raises(ValidationError, match="slice_reserve_usd"):
        Settings.model_validate(clamped.model_dump())  # below its own minimum, as the docs say


def test_get_settings_applies_the_ceilings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HARD_COMPANY_CAP_USD", "1")
    assert get_settings().company_cap_usd == Decimal("1")


def test_the_embedder_gets_its_thread_count_from_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_embedder.cache_clear()
    try:
        monkeypatch.setenv("EMBEDDING_THREADS", "2")
        embedder = get_embedder()  # nothing is loaded until the first use
        assert embedder.threads == 2
        assert Embedder("m", get_settings().embedding_cache_dir).threads is None
    finally:
        get_embedder.cache_clear()


# --- The connection string ---------------------------------------------------------------


def test_the_connection_string_has_a_timeout_and_escapes_the_password() -> None:
    s = make(postgres_password="p w'd\\x", postgres_user="lead finder", postgres_db="main")
    info = conninfo_to_dict(s.psycopg_conninfo())
    assert info["password"] == "p w'd\\x"
    assert info["user"] == "lead finder"
    assert info["dbname"] == "main"
    assert info["host"] == "127.0.0.1"
    assert info["port"] == "5433"
    assert info["connect_timeout"] == "5"


def test_the_connection_string_takes_another_database_and_options() -> None:
    s = make()
    info = conninfo_to_dict(
        s.psycopg_conninfo(
            "leadfinder_test", options="-c search_path=langgraph", application_name="x"
        )
    )
    assert info["dbname"] == "leadfinder_test"
    assert info["options"] == "-c search_path=langgraph"
    assert info["application_name"] == "x"
    assert conninfo_to_dict(s.psycopg_conninfo(connect_timeout=2))["connect_timeout"] == "2"


def test_the_password_is_not_in_the_settings_text() -> None:
    s = make(postgres_password="hunter2-secret", anthropic_api_key="sk-secret-key")
    text = f"{s!r} {s}"
    assert "hunter2-secret" not in text
    assert "sk-secret-key" not in text
