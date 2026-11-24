"""PLAN-V28 T1-1: live voice's settings and switches.

- The server's switches are exact text only: a stray "1" never turns one on.
- The key is a secret: blank is no key, and it never shows in the settings' text or a log line.
- The Agent Platform needs its project and region, or the backend refuses to start.
- The month's limit (Settings page) can't go over its ceiling (engine/.env).
- Each person's switch: only the Platform admin sets it, and `GET /auth/me` says live voice is on
  only when the person's switch, V's tick, the server's switch and the key are all there.

The key in every test is made up. No test reaches Google.
"""

import logging
import uuid
from collections.abc import AsyncIterator, Callable
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.api.auth import live_voice_for
from core.auth.features import can_talk
from core.auth.models import User
from core.config import CEILINGS, EDITABLE_KEYS, Settings, clamp_to_ceilings, field_bounds
from core.db.engine import get_session
from core.logs import JsonFormatter, redact
from tests.core.auth_world import World, make_account, make_platform_admin, me, sign_in

FAKE_KEY = "test-key-not-real"
SHAPED_KEY = "AIza" + "x" * 35  # shaped like a Google key, made up
PEOPLE = "/api/v1/people"
SETTINGS = "/api/v1/settings"


def make(**values: Any) -> Settings:
    """Settings from these values and the defaults only: no .env file."""
    return Settings(_env_file=None, **values)


# --- The server's switches -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["LIVE_VOICE_OK", "LIVE_VOICE_NAMES_OK", "LIVE_VOICE_USAGE_TOTALS"]
)
def test_a_switch_starts_off_and_only_the_exact_text_true_turns_it_on(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    field = name.lower()
    monkeypatch.delenv(name, raising=False)
    assert getattr(Settings(_env_file=None), field) is False
    monkeypatch.setenv(name, "true")
    assert getattr(Settings(_env_file=None), field) is True
    monkeypatch.setenv(name, "FALSE")
    assert getattr(Settings(_env_file=None), field) is False
    for stray in ("1", "yes", "on", "t", "2"):
        monkeypatch.setenv(name, stray)
        with pytest.raises(ValidationError):
            Settings(_env_file=None)


def test_the_key_is_a_secret_and_blank_is_no_key() -> None:
    assert make().gemini_api_key is None
    assert make(gemini_api_key="   ").gemini_api_key is None
    settings = make(gemini_api_key=f"  {FAKE_KEY} ")
    assert settings.gemini_api_key is not None
    assert settings.gemini_api_key.get_secret_value() == FAKE_KEY
    assert FAKE_KEY not in repr(settings)
    assert FAKE_KEY not in str(settings.model_dump())


def test_live_voice_is_ready_only_with_the_switch_the_key_and_the_companies_project() -> None:
    assert not make().live_voice_ready
    assert not make(live_voice_ok=True).live_voice_ready  # no key
    assert not make(gemini_api_key=FAKE_KEY).live_voice_ready  # the switch is off
    assert make(live_voice_ok=True, gemini_api_key=FAKE_KEY).live_voice_ready
    no_companies = make(live_voice_ok=True, gemini_api_key=FAKE_KEY, apps=["lead_finder"])
    assert not no_companies.live_voice_ready


def test_the_model_is_locked_by_name() -> None:
    assert make().live_voice_model == "gemini-3.8-live"
    for other in ("gemini-3.8-live-extended-thinking", "gemini-live-latest", ""):
        with pytest.raises(ValidationError):
            make(live_voice_model=other)


def test_the_agent_platform_needs_its_project_and_region_or_the_backend_wont_start() -> None:
    assert make().live_voice_service == "gemini_api"
    with pytest.raises(ValidationError) as caught:
        make(live_voice_service="agent_platform")
    text = str(caught.value)
    assert "LIVE_VOICE_PROJECT" in text and "LIVE_VOICE_LOCATION" in text
    with pytest.raises(ValidationError) as one:
        make(live_voice_service="agent_platform", live_voice_project="sample-voice-01")
    assert [item["loc"] for item in one.value.errors()] == [("live_voice_location",)]
    ok = make(
        live_voice_service="agent_platform",
        live_voice_project=" Sample-Voice-01 ",
        live_voice_location="us-central1",
    )
    assert (ok.live_voice_project, ok.live_voice_location) == ("sample-voice-01", "us-central1")


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("live_voice_location", "evil.example/x"),
        ("live_voice_location", "us central1"),
        ("live_voice_project", "1starts-with-a-digit"),
        ("live_voice_project", "a/b"),
        ("live_voice_project", "short"),
    ],
)
def test_the_project_and_region_go_into_googles_address_so_only_plain_names_pass(
    field: str, bad: str
) -> None:
    with pytest.raises(ValidationError):
        make(**{field: bad})


# --- The month's limit ---------------------------------------------------------------------------


def test_the_month_limit_is_on_the_settings_page_under_its_ceiling() -> None:
    settings = make()
    assert "live_voice_month_cap_usd" in EDITABLE_KEYS
    assert CEILINGS["live_voice_month_cap_usd"] == "hard_live_voice_month_cap_usd"
    assert settings.live_voice_month_cap_usd == Decimal("4")
    assert settings.hard_live_voice_month_cap_usd == Decimal("5")
    assert field_bounds("live_voice_month_cap_usd") == (Decimal("0"), Decimal("5"))
    assert isinstance(
        make(hard_live_voice_month_cap_usd="5.00").hard_live_voice_month_cap_usd, Decimal
    )


def test_a_lower_ceiling_pulls_the_month_limit_down() -> None:
    clamped = clamp_to_ceilings(make(hard_live_voice_month_cap_usd="2.50"))
    assert clamped.live_voice_month_cap_usd == Decimal("2.50")
    assert clamp_to_ceilings(make()).live_voice_month_cap_usd == Decimal("4")


def test_the_limits_have_the_plans_defaults() -> None:
    settings = make()
    assert settings.live_voice_max_talks == 10
    assert settings.live_voice_talk_minutes == 30
    assert settings.live_voice_tool_timeout_seconds == 20
    assert settings.live_voice_idle_minutes == 5
    assert settings.live_voice_usage_totals is False  # per message: the safe side


# --- Who may use it ------------------------------------------------------------------------------


def person(role: str, *, switch: bool = True, features: list[str] | None = None) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{role}@example.test",
        name="Jo Sample",
        role=role,
        password_hash="x",
        features=features or [],
        live_voice=switch,
    )


ON = make(live_voice_ok=True, gemini_api_key=FAKE_KEY)


def test_v_needs_the_call_logs_or_meetings_tick_and_never_a_viewer() -> None:
    assert can_talk("staff", ["companies.call_logs"])
    assert can_talk("staff", ["companies.meetings"])
    assert not can_talk("staff", ["companies.companies", "lead_finder.results"])
    assert not can_talk("viewer", ["companies.call_logs", "companies.meetings"])
    assert can_talk("admin", [])  # an Admin gets every tick
    assert can_talk("platform_admin", None)


def test_live_voice_is_on_only_with_every_switch() -> None:
    staff = person("staff", features=["companies.call_logs"])
    assert live_voice_for(ON, staff)
    assert not live_voice_for(make(), staff)  # the server's switch is off
    assert not live_voice_for(make(live_voice_ok=True), staff)  # no key
    assert not live_voice_for(ON, person("staff", switch=False, features=["companies.call_logs"]))
    assert not live_voice_for(ON, person("staff", features=["companies.companies"]))
    assert not live_voice_for(ON, person("viewer", features=["companies.call_logs"]))
    assert not live_voice_for(ON, person("admin", switch=False))  # every tick, but no switch
    assert live_voice_for(ON, person("admin"))


def test_with_sign_in_off_the_server_alone_decides() -> None:
    assert live_voice_for(ON, None)
    assert not live_voice_for(make(), None)


# --- The key never reaches a log line ------------------------------------------------------------


def test_the_key_is_redacted_from_any_log_text(server_env: Callable[..., None]) -> None:
    server_env(GEMINI_API_KEY=FAKE_KEY)
    assert FAKE_KEY not in redact(f"setup failed with {FAKE_KEY} in it")
    assert FAKE_KEY not in redact(f'{{"x-goog-api-key": "{FAKE_KEY}"}}')
    assert SHAPED_KEY not in redact(f"a pasted key {SHAPED_KEY}.")  # shaped like one, any key


def test_a_log_line_never_holds_the_key(server_env: Callable[..., None]) -> None:
    server_env(GEMINI_API_KEY=FAKE_KEY)
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "key %s", (FAKE_KEY,), None)
    assert FAKE_KEY not in JsonFormatter().format(record)


# --- On the database: the Settings page, People and who am I -------------------------------------


@pytest.fixture
def settings_app(session_factory: async_sessionmaker[AsyncSession]) -> FastAPI:
    created = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    created.dependency_overrides[get_session] = test_session
    return created


async def patch(app: FastAPI, values: dict[str, Any]) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        return await client.patch(SETTINGS, json={"values": values})


@pytest.mark.integration
async def test_the_month_limit_can_be_changed_but_never_over_its_ceiling(
    settings_app: FastAPI, server_env: Callable[..., None]
) -> None:
    changed = await patch(settings_app, {"live_voice_month_cap_usd": "4.50"})
    assert changed.status_code == 200, changed.text
    fields = {field["key"]: field for field in changed.json()["fields"]}
    limit = fields["live_voice_month_cap_usd"]
    assert (limit["value"], limit["max"], limit["min"]) == ("4.50", "5.00", "0.00")
    assert limit["label"] == "Live voice: monthly limit (US$)"
    for key in ("live_voice_ok", "live_voice_names_ok", "hard_live_voice_month_cap_usd"):
        assert fields[key]["editable"] is False, key
    over = await patch(settings_app, {"live_voice_month_cap_usd": "5.01"})
    assert over.status_code == 422
    assert over.json()["errors"][0]["field"] == "body.values.live_voice_month_cap_usd"
    server_env(HARD_LIVE_VOICE_MONTH_CAP_USD="3")  # a lower ceiling on the server
    lower = await patch(settings_app, {"live_voice_month_cap_usd": "3.50"})
    assert lower.status_code == 422
    assert lower.json()["errors"] == [
        {
            "field": "body.values.live_voice_month_cap_usd",
            "message": "Must be at most 3.00. The ceiling on the server is lower.",
        }
    ]


@pytest.mark.integration
async def test_only_the_platform_admin_sets_a_persons_switch(world: World) -> None:
    await make_platform_admin(world)
    jo = await make_account(
        world, email="jo@example.test", username="jsample", name="Jo Sample", role="staff"
    )
    await make_account(
        world, email="sam@example.test", username="sample.admin", name="Sam Admin", role="admin"
    )
    path = f"{PEOPLE}/{jo.id}"
    async with world.browser() as boss, world.browser() as admin, world.browser() as staff:
        assert (await sign_in(boss)).status_code == 200
        assert (await sign_in(admin, login="sample.admin")).status_code == 200
        assert (await sign_in(staff, login="jsample")).status_code == 200
        listed = await boss.get(PEOPLE)
        assert {item["live_voice"] for item in listed.json()} == {False}  # off for everyone
        for other in (admin, staff):
            refused = await other.patch(path, json={"live_voice": True})
            assert refused.status_code == 403
            assert refused.json()["code"] == "platform_admin_only"
        turned = await boss.patch(path, json={"live_voice": True})
        assert turned.status_code == 200, turned.text
        assert turned.json()["live_voice"] is True
        off = await boss.patch(path, json={"live_voice": False})
        assert off.json()["live_voice"] is False


@pytest.mark.integration
async def test_an_admin_without_the_switch_reads_live_voice_false(world: World) -> None:
    world.settings(live_voice_ok=True, gemini_api_key=FAKE_KEY)
    boss = await make_platform_admin(world)
    async with world.browser() as browser:
        assert (await sign_in(browser)).status_code == 200
        before = await me(browser)
        assert before.json()["live_voice"] is False  # every tick, but no switch
        async with world.factory() as db:
            row = await db.get(User, boss.id)
            assert row is not None
            row.live_voice = True
            await db.commit()
        assert (await me(browser)).json()["live_voice"] is True
        world.settings(live_voice_ok=False, gemini_api_key=FAKE_KEY)  # the server's switch off
        assert (await me(browser)).json()["live_voice"] is False
        world.settings(live_voice_ok=True)  # no key
        assert (await me(browser)).json()["live_voice"] is False


@pytest.mark.integration
async def test_a_viewer_with_the_switch_reads_live_voice_false(world: World) -> None:
    world.settings(live_voice_ok=True, gemini_api_key=FAKE_KEY)
    viewer = await make_account(
        world, email="vi@example.test", username="viewer.one", name="Vi Sample", role="viewer"
    )
    async with world.factory() as db:
        row = await db.get(User, viewer.id)
        assert row is not None
        row.live_voice = True
        row.features = ["companies.call_logs", "companies.meetings"]
        await db.commit()
    async with world.browser() as browser:
        assert (await sign_in(browser, login="viewer.one")).status_code == 200
        assert (await me(browser)).json()["live_voice"] is False


@pytest.mark.integration
async def test_with_sign_in_off_who_am_i_follows_the_server(world: World) -> None:
    world.settings(auth_required=False, live_voice_ok=True, gemini_api_key=FAKE_KEY)
    async with world.browser() as browser:
        body = (await me(browser)).json()
        assert (body["user"], body["live_voice"]) == (None, True)
        world.settings(auth_required=False)
        assert (await me(browser)).json()["live_voice"] is False
