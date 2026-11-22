"""Settings a person can change (core.prefs): which rows count, how values are read and checked,
and saving them all-or-nothing.

The fast tests use `resolve_settings` and `build_settings_out`, which are pure. The integration
tests save to and read from `core.settings` in the test database.
"""

import asyncio
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.config import CEILINGS, EDITABLE_KEYS, Settings
from core.prefs import service
from core.prefs.models import Setting
from core.prefs.service import (
    BROWSER_SPEECH_OFF_DETAIL,
    BROWSER_SPEECH_OFF_TITLE,
    ENV_ONLY_KEYS,
    TEXT,
    build_settings_out,
    decimal_text,
    effective_settings,
    patch_settings,
    reset_setting,
    resolve_settings,
    setting_type,
)
from core.runs.lifecycle import BackendLock

D = Decimal


def base(**values: Any) -> Settings:
    """Settings as .env would give them, without reading the developer's own .env."""
    return Settings(_env_file=None, **values)


def fields_of(out: Any) -> dict[str, Any]:
    return {field.key: field for field in out.fields}


# --- Which stored rows count (fast) ------------------------------------------------------------


def test_rows_for_env_only_or_unknown_keys_are_ignored() -> None:
    rows = {
        "hubspot_names_to_claude_ok": True,  # the Levi data OK: only .env can turn it on
        "hard_daily_cap_usd": "5000",
        "hard_run_cap_usd": "999",
        "anthropic_api_key": "sk-ant-x",
        "nonsense": 1,
        "run_max_companies": 7,
    }
    resolved = resolve_settings(base(), rows)
    assert resolved.settings.hubspot_names_to_claude_ok is False
    assert resolved.settings.hard_daily_cap_usd == D("300")
    assert resolved.settings.hard_run_cap_usd == D("50")
    assert resolved.settings.run_max_companies == 7
    assert dict(resolved.used) == {"run_max_companies": 7}
    assert resolved.ignored == ()  # unknown keys are not even reported: they never count


def test_decimals_are_stored_as_text_and_a_number_written_by_hand_is_read_too() -> None:
    resolved = resolve_settings(base(), {"run_cap_usd": "15.00", "company_cap_usd": 3})
    assert resolved.settings.run_cap_usd == D("15.00")
    assert resolved.settings.company_cap_usd == D("3")


@pytest.mark.parametrize(
    "rows",
    [
        {"run_cap_usd": "lots"},
        {"run_cap_usd": "NaN"},
        {"run_max_companies": "7"},  # an int stored as text
        {"run_max_companies": True},
        {"claude_model": "gpt-4"},
        {"run_cap_usd": "9999"},  # above its own bound
    ],
)
def test_a_bad_row_is_left_out_and_never_stops_the_backend(rows: dict[str, Any]) -> None:
    resolved = resolve_settings(base(), rows)
    assert resolved.settings == resolved.base
    assert resolved.ignored == tuple(rows)


def test_a_row_that_breaks_a_rule_between_settings_is_left_out_and_the_rest_kept() -> None:
    # A reserve above the company cap would make every request fail.
    resolved = resolve_settings(base(), {"request_reserve_usd": "3.00", "run_max_companies": 9})
    assert resolved.settings.request_reserve_usd == D("0.80")
    assert resolved.settings.run_max_companies == 9
    assert resolved.ignored == ("request_reserve_usd",)


def test_the_ceilings_from_env_clamp_the_result() -> None:
    env = base(hard_run_cap_usd=D("10"), hard_concurrency=2, run_cap_usd=D("10"))
    resolved = resolve_settings(env, {"run_cap_usd": "40.00", "claude_people_concurrency": 4})
    assert resolved.settings.run_cap_usd == D("10")
    assert resolved.settings.claude_people_concurrency == 2


def test_a_model_override_and_null_for_use_the_main_model() -> None:
    resolved = resolve_settings(
        base(model_search="claude-sonnet-5-5"),
        {"model_discover": "claude-haiku-5-5", "model_search": None},
    )
    assert resolved.settings.model_for("discover") == "claude-haiku-5-5"
    assert resolved.settings.model_for("search") == "claude-opus-5-5"  # null: the main model
    assert resolved.settings.model_for("extract") == "claude-opus-5-5"


# --- The Settings page (fast) ------------------------------------------------------------------


def test_every_editable_key_has_words_a_type_and_shows_as_editable() -> None:
    out = build_settings_out(resolve_settings(base(), {}), D("50.00"))
    fields = fields_of(out)
    assert list(fields) == [*EDITABLE_KEYS, *ENV_ONLY_KEYS]
    for key in EDITABLE_KEYS:
        assert key in TEXT
        assert fields[key].editable is True
        assert fields[key].type == setting_type(key)
    for key in ENV_ONLY_KEYS:
        assert fields[key].editable is False
        assert fields[key].overridden is False
        assert "engine/.env" in fields[key].description
    assert out.daily_left_usd == D("50.00")


def test_todays_quiet_days_is_on_the_settings_page_in_plain_words() -> None:
    """PLAN-V22 T1-3 and T1-6: a whole number of days, 14 to start (TBC with Levi)."""
    out = build_settings_out(resolve_settings(base(), {}), D("50.00"))
    field = fields_of(out)["today_quiet_days"]
    label, words = TEXT["today_quiet_days"]
    assert (field.type, field.value, field.min, field.max) == ("int", 14, 1, 365)
    assert label == "Days without contact before Today lists a deal"
    assert "close date has passed" in words and "TBC with Levi" in words


def test_no_secret_is_ever_on_the_page() -> None:
    env = base(anthropic_api_key="sk-ant-api03-secret-key", postgres_password="pw-secret-1")
    text = build_settings_out(resolve_settings(env, {}), D("1")).model_dump_json()
    assert "sk-ant" not in text
    assert "pw-secret-1" not in text
    assert "anthropic_api_key" not in text
    assert "postgres_password" not in text


def test_decimals_are_text_ints_are_numbers_and_choices_list_their_values() -> None:
    fields = fields_of(build_settings_out(resolve_settings(base(), {}), D("1")))
    assert (fields["run_cap_usd"].value, fields["run_cap_usd"].type) == ("20.00", "decimal")
    assert (fields["run_cap_usd"].min, fields["run_cap_usd"].max) == ("1.00", "50.00")
    assert fields["discovery_share"].value == "0.40"
    assert (fields["run_max_companies"].value, fields["run_max_companies"].max) == (20, 100)
    assert fields["model_discover"].type == "choice_or_null"
    assert fields["model_discover"].value is None
    assert fields["model_discover"].choices == [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
    ]
    assert fields["claude_model"].type == "choice"
    assert fields["hubspot_names_to_claude_ok"].type == "bool"


def test_the_top_shown_is_the_lower_of_the_bound_and_the_ceiling() -> None:
    env = base(hard_run_cap_usd=D("30"), hard_concurrency=3)
    fields = fields_of(build_settings_out(resolve_settings(env, {}), D("1")))
    assert fields["run_cap_usd"].max == "30.00"
    for lane in ("people", "runs", "jobs"):  # PLAN-V26 T1-1: each from 1 to the ceiling
        field = fields[f"claude_{lane}_concurrency"]
        assert (field.min, field.max) == (1, 3)
    assert fields["company_cap_usd"].max == "5.00"  # the bound, at or below its ceiling
    assert set(CEILINGS) <= set(EDITABLE_KEYS)


def test_overridden_means_saved_and_different_from_the_default() -> None:
    resolved = resolve_settings(base(), {"run_max_companies": 7})
    fields = fields_of(build_settings_out(resolved, D("1")))
    assert (fields["run_max_companies"].value, fields["run_max_companies"].default) == (7, 20)
    assert fields["run_max_companies"].overridden is True
    assert fields["run_cap_usd"].overridden is False


# --- The mic's browser speech service (PLAN-V18 M1, fast) ---------------------------------------
# It sends each rep's voice to Google or Microsoft, so it waits for Levi's OK: browser_speech_ok,
# set only on the server.


def test_the_browser_speech_service_is_offered_only_once_the_server_allows_it() -> None:
    off = fields_of(build_settings_out(resolve_settings(base(), {}), D("1")))
    on = fields_of(build_settings_out(resolve_settings(base(browser_speech_ok=True), {}), D("1")))
    assert off["voice_tool"].choices == ["browser_model", "typing"]
    assert on["voice_tool"].choices == ["browser_model", "browser_service", "typing"]
    assert (off["browser_speech_ok"].value, off["browser_speech_ok"].editable) == (False, False)
    assert on["browser_speech_ok"].value is True


@pytest.mark.parametrize("allowed", [False, True])
def test_a_saved_browser_speech_service_waits_for_the_ok(allowed: bool) -> None:
    resolved = resolve_settings(base(browser_speech_ok=allowed), {"voice_tool": "browser_service"})
    field = fields_of(build_settings_out(resolved, D("1")))["voice_tool"]
    used = "browser_service" if allowed else "browser_model"
    assert resolved.settings.voice_tool == used
    # The speech service is the default (PLAN-V22 T1-6), so a saved one is never an override.
    assert (field.value, field.default, field.overridden) == (used, used, False)
    assert resolved.ignored == ()  # kept, for when the OK comes


@pytest.mark.parametrize("allowed", [False, True])
def test_a_browser_speech_service_set_on_the_server_waits_for_the_ok(allowed: bool) -> None:
    env = base(voice_tool="browser_service", browser_speech_ok=allowed)
    resolved = resolve_settings(env, {})
    field = fields_of(build_settings_out(resolved, D("1")))["voice_tool"]
    used = "browser_service" if allowed else "browser_model"
    assert resolved.settings.voice_tool == used
    assert (field.value, field.default, field.overridden) == (used, used, False)


def test_a_row_written_straight_into_the_table_cant_give_the_ok() -> None:
    resolved = resolve_settings(
        base(), {"browser_speech_ok": True, "voice_tool": "browser_service"}
    )
    assert resolved.settings.browser_speech_ok is False
    assert resolved.settings.voice_tool == "browser_model"


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (D("2.5"), "2.50"),
        (D("2"), "2.00"),
        (D("0.455"), "0.455"),
        (0.4, "0.40"),
        (D("10.00"), "10.00"),
    ],
)
def test_decimal_text(value: Any, text: str) -> None:
    assert decimal_text(value) == text


# --- Saving (integration) ---------------------------------------------------------------------


async def stored(session: AsyncSession) -> dict[str, Any]:
    rows = await session.execute(select(Setting.key, Setting.value))
    return {key: value for key, value in rows.all()}


async def problem_of(call: Any) -> Problem:
    with pytest.raises(Problem) as caught:
        await call
    return caught.value


def errors_of(problem: Problem) -> dict[str, str]:
    assert problem.status == 422
    return {error["field"]: error["message"] for error in problem.extra["errors"]}


@pytest.mark.integration
async def test_a_change_is_saved_as_plain_json_and_used_from_then_on(
    session: AsyncSession,
) -> None:
    out = await patch_settings(
        session,
        {"run_cap_usd": "15.00", "run_max_companies": 10, "model_discover": "claude-haiku-5-5"},
    )
    assert await stored(session) == {
        "run_cap_usd": "15.00",
        "run_max_companies": 10,
        "model_discover": "claude-haiku-5-5",
    }
    fields = fields_of(out)
    assert (fields["run_cap_usd"].value, fields["run_cap_usd"].overridden) == ("15.00", True)
    settings = await effective_settings(session)
    assert settings.run_cap_usd == D("15.00")
    assert settings.model_for("discover") == "claude-haiku-5-5"


@pytest.mark.integration
async def test_a_value_equal_to_the_default_removes_its_row(session: AsyncSession) -> None:
    await patch_settings(session, {"run_max_companies": 10})
    await patch_settings(session, {"run_max_companies": 20})  # the default
    assert await stored(session) == {}


@pytest.mark.integration
async def test_null_puts_a_step_model_back_to_the_main_model(session: AsyncSession) -> None:
    await patch_settings(session, {"model_search": "claude-sonnet-5-5"})
    out = await patch_settings(session, {"model_search": None})
    assert fields_of(out)["model_search"].value is None
    assert await stored(session) == {}


@pytest.mark.integration
@pytest.mark.parametrize(
    ("values", "field", "message"),
    [
        ({"nope": 1}, "body.values.nope", "No setting has this name."),
        (
            {"hubspot_names_to_claude_ok": True},
            "body.values.hubspot_names_to_claude_ok",
            "engine/.env",
        ),
        ({"hard_daily_cap_usd": "1.00"}, "body.values.hard_daily_cap_usd", "engine/.env"),
        ({"browser_speech_ok": True}, "body.values.browser_speech_ok", "engine/.env"),
        (
            {"voice_tool": "shouting"},
            "body.values.voice_tool",
            "Send one of: browser_model, typing.",
        ),
        ({"run_cap_usd": 15}, "body.values.run_cap_usd", 'Send this as a string, like "2.50".'),
        ({"run_cap_usd": "lots"}, "body.values.run_cap_usd", "This isn't a number."),
        ({"run_cap_usd": "0.50"}, "body.values.run_cap_usd", "Must be at least 1.00."),
        ({"run_max_companies": 101}, "body.values.run_max_companies", "Must be at most 100."),
        (
            {"run_max_companies": "10"},
            "body.values.run_max_companies",
            "Send a whole number, like 12.",
        ),
        ({"run_max_companies": True}, "body.values.run_max_companies", "Send a whole number"),
        ({"claude_model": "gpt-5"}, "body.values.claude_model", "Send one of: claude-opus-5-5"),
        ({"claude_model": None}, "body.values.claude_model", "Send one of"),
    ],
)
async def test_a_bad_change_is_a_422_that_names_the_key_and_saves_nothing(
    session: AsyncSession, values: dict[str, Any], field: str, message: str
) -> None:
    problem = await problem_of(patch_settings(session, {"run_max_companies": 9, **values}))
    errors = errors_of(problem)
    assert message in errors[field]
    assert problem.title == "The settings aren't valid"
    assert await stored(session) == {}  # all or nothing: the good key was not saved either


@pytest.mark.integration
async def test_a_change_that_breaks_a_rule_between_settings_names_every_setting_in_it(
    session: AsyncSession,
) -> None:
    problem = await problem_of(patch_settings(session, {"company_cap_usd": "0.50"}))
    errors = errors_of(problem)
    assert set(errors) == {"body.values.request_reserve_usd", "body.values.company_cap_usd"}
    assert (
        "request_reserve_usd ($0.80) is more than company_cap_usd ($0.50)"
        in errors["body.values.company_cap_usd"]
    )


@pytest.mark.integration
async def test_a_value_above_its_ceiling_is_refused(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    low = base(hard_run_cap_usd=D("10"), run_cap_usd=D("10"))
    monkeypatch.setattr(service, "get_settings", lambda: low)
    problem = await problem_of(patch_settings(session, {"run_cap_usd": "12.00"}))
    assert errors_of(problem) == {
        "body.values.run_cap_usd": "Must be at most 10.00. The ceiling on the server is lower."
    }


@pytest.mark.integration
async def test_the_browser_speech_service_cant_be_saved_until_the_server_allows_it(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    alone = await problem_of(patch_settings(session, {"voice_tool": "browser_service"}))
    assert (alone.code, alone.title, alone.detail) == (
        "browser_speech_off",
        BROWSER_SPEECH_OFF_TITLE,
        BROWSER_SPEECH_OFF_DETAIL,
    )
    assert errors_of(alone) == {"body.values.voice_tool": BROWSER_SPEECH_OFF_DETAIL}
    # With other changes, all or nothing still holds, and another wrong value is listed too.
    both = await problem_of(
        patch_settings(
            session,
            {"voice_tool": "browser_service", "run_max_companies": 9, "run_cap_usd": 15},
        )
    )
    assert both.code == "browser_speech_off"
    assert set(errors_of(both)) == {"body.values.voice_tool", "body.values.run_cap_usd"}
    assert await stored(session) == {}

    monkeypatch.setattr(service, "get_settings", lambda: base(browser_speech_ok=True))
    out = await patch_settings(session, {"voice_tool": "browser_service"})
    assert fields_of(out)["voice_tool"].value == "browser_service"
    assert await stored(session) == {}  # the default since PLAN-V22 T1-6: nothing to keep
    out = await patch_settings(session, {"voice_tool": "browser_model"})
    assert fields_of(out)["voice_tool"].overridden is True
    assert await stored(session) == {"voice_tool": "browser_model"}  # the model, by choice


@pytest.mark.integration
async def test_a_row_written_straight_into_the_table_cant_turn_on_hubspot_names(
    session: AsyncSession,
) -> None:
    session.add(Setting(key="hubspot_names_to_claude_ok", value=True))
    session.add(Setting(key="hard_run_cap_usd", value="1000"))
    await session.commit()
    settings = await effective_settings(session)
    assert settings.hubspot_names_to_claude_ok is False
    assert settings.hard_run_cap_usd == D("50")


@pytest.mark.integration
async def test_reset_removes_one_override_and_refuses_an_unknown_key(session: AsyncSession) -> None:
    await patch_settings(session, {"run_max_companies": 10, "run_cap_usd": "15.00"})
    out = await reset_setting(session, "run_max_companies")
    assert fields_of(out)["run_max_companies"].value == 20
    assert await stored(session) == {"run_cap_usd": "15.00"}
    await reset_setting(session, "run_max_companies")  # not overridden: fine
    for key in ("nope", "hubspot_names_to_claude_ok", "hard_daily_cap_usd"):
        problem = await problem_of(reset_setting(session, key))
        assert (problem.status, problem.code) == (404, "setting_not_found")


@pytest.mark.integration
async def test_two_changes_at_once_cant_save_a_pair_that_breaks_a_rule(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def change(values: dict[str, Any]) -> Any:
        async with session_factory() as own:
            return await patch_settings(own, values)

    # Each one fits the defaults on its own (reserve 0.80, cap 2.50). Together they don't.
    results = await asyncio.gather(
        change({"request_reserve_usd": "2.00"}),
        change({"company_cap_usd": "1.00"}),
        return_exceptions=True,
    )
    assert sum(isinstance(result, Problem) for result in results) == 1
    async with session_factory() as check:
        settings = await effective_settings(check)
    assert settings.request_reserve_usd <= settings.company_cap_usd


@pytest.mark.integration
async def test_a_change_does_not_wait_for_the_lock_a_running_backend_holds(
    session: AsyncSession,
) -> None:
    """The settings lock and the one-backend lock once had the same key, so every change waited
    for ever while the backend ran."""
    backend = BackendLock()
    assert await backend.acquire()
    try:
        async with asyncio.timeout(10):
            await patch_settings(session, {"run_max_companies": 11})
            await reset_setting(session, "run_max_companies")
    finally:
        await backend.release()
