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
    assert s.slice_reserve_usd == Decimal("1.00")
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


def nudge(value: Any, direction: int) -> Any:
    """A little above (1) or below (-1) a bound, in the bound's own type."""
    if isinstance(value, Decimal):
        return value + direction * Decimal("0.01")
    if isinstance(value, int):
        return value + direction
    return value + direction * 0.01


@pytest.mark.parametrize("key", [k for k in EDITABLE_KEYS if k not in CHOICE_KEYS])
def test_values_outside_the_bounds_are_refused(key: str) -> None:
    low, high = field_bounds(key)
    for bad in (nudge(low, -1), nudge(high, 1)):
        with pytest.raises(ValidationError) as error:
            make(**{key: bad})
        assert key in str(error.value)
    make(**{key: low})  # the ends themselves are fine
    make(**{key: high})


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


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "LOCALHOST", "::1", "127.0.0.2"])
def test_the_api_host_may_be_this_computer(host: str) -> None:
    assert make(api_host=host).api_host == host.lower()


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.5", "example.com", "", "10.0.0.1"])
def test_the_api_host_may_not_face_a_network(host: str) -> None:
    with pytest.raises(ValidationError):
        make(api_host=host)


@pytest.mark.parametrize("name", ["Langgraph", "a;drop", "1abc", "a" * 64, "", "two words", "x-y"])
def test_the_checkpoint_schema_is_a_plain_name(name: str) -> None:
    with pytest.raises(ValidationError):
        make(langgraph_schema=name)


def test_a_plain_checkpoint_schema_name_is_kept() -> None:
    assert make(langgraph_schema="run_state2").langgraph_schema == "run_state2"


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
    assert clamped.slice_reserve_usd == Decimal("1.00")  # equal to it
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
