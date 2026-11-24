"""PLAN-V28 T1-2 on the test database: starting a talk.

Sign-in is on (the World harness), so every check runs as it does live. The key is made up and no
test reaches Google. Names are made up ("Jo Sample", "Sample Logistics").
"""

import uuid
from collections.abc import Callable
from datetime import timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from apps.companies.live_voice.models import VoiceSession
from apps.companies.live_voice.service import month_bounds, talks_of
from apps.companies.live_voice.talks import Ready
from core.auth import admin
from core.auth.models import User
from tests.core.auth_world import FAST, GOOD, World, make_platform_admin, sign_in

pytestmark = pytest.mark.integration

FAKE_KEY = "test-key-not-real-7Q2Z"  # made up: no test reaches Google

VOICE = "/api/v1/companies/assistant/voice"


@pytest.fixture
def live_voice_on(server_env: Callable[..., None]) -> None:
    server_env(LIVE_VOICE_OK="true", GEMINI_API_KEY=FAKE_KEY)


async def account(
    world: World,
    login: str,
    *,
    role: str = "staff",
    features: list[str] | None = None,
    switch: bool = True,
) -> User:
    async with world.factory() as db:
        user = await admin.create_person(
            db,
            email=f"{login}@example.test",
            username=login,
            name=login.replace(".", " ").title(),
            role=role,
            features=["companies.call_logs"] if features is None else features,
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
    async with world.factory() as db:
        row = await db.get(User, user.id)
        assert row is not None
        row.live_voice = switch
        await db.commit()
    return user


async def rows(world: World) -> list[VoiceSession]:
    async with world.factory() as db:
        found = await db.scalars(select(VoiceSession).order_by(VoiceSession.created_at))
        return list(found)


async def start(client: httpx.AsyncClient, **body: Any) -> httpx.Response:
    return await client.post(f"{VOICE}/session", json=body or None)


# --- Starting a talk (T1-2) ----------------------------------------------------------------------


async def test_a_start_makes_a_ready_talk_and_answers_its_socket_and_limits(
    world: World, live_voice_on: None
) -> None:
    jo = await account(world, "jo.sample")
    async with world.browser() as browser:
        assert (await sign_in(browser, login="jo.sample")).status_code == 200
        response = await start(browser)
    assert response.status_code == 201, response.text
    body = response.json()
    talk_id = body["id"]
    assert body["socket"] == f"/api/v1/companies/assistant/voice/live?session={talk_id}"
    assert body["limits"] == {
        "talk_seconds": 1800,
        "idle_seconds": 300,
        "tool_seconds": 20,
        "sample_rate_in": 16000,
        "sample_rate_out": 24000,
        "frame_bytes": 640,
        "max_binary_bytes": 4096,
        "max_text_bytes": 8192,
        "audio_rate_max": 1.5,
    }
    (row,) = await rows(world)
    assert (str(row.id), row.user_id, row.status) == (talk_id, jo.id, "ready")
    assert (row.service, row.model) == ("gemini_api", "gemini-3.8-live")
    assert row.prompt_version.startswith("voice-") and row.resume_handle is None


async def refused(world: World, login: str | None, code: str, status: int) -> httpx.Response:
    async with world.browser() as browser:
        if login is not None:
            assert (await sign_in(browser, login=login)).status_code == 200
        response = await start(browser)
    assert (response.status_code, response.json().get("code")) == (status, code), response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    return response


async def test_each_refusal_comes_in_the_plans_order(
    world: World, server_env: Callable[..., None]
) -> None:
    await make_platform_admin(world)
    await account(world, "viewer.one", role="viewer", switch=False)
    await account(world, "no.ticks", features=["companies.companies"])
    await account(world, "no.switch", switch=False)
    await account(world, "jo.sample")
    server_env(LIVE_VOICE_OK="false")  # and no key: every later check would refuse too
    await refused(world, "viewer.one", "viewer_read_only", 403)
    await refused(world, "no.ticks", "feature_not_allowed", 403)
    switch_off = await refused(world, "no.switch", "live_voice_not_allowed", 403)
    assert "Ask Al Khair to turn it on" in switch_off.json()["detail"]
    await refused(world, "jo.sample", "live_voice_off", 409)
    server_env(LIVE_VOICE_OK="true")  # still no key
    await refused(world, "jo.sample", "live_voice_off", 409)
    server_env(GEMINI_API_KEY=FAKE_KEY)
    start_, _, _ = month_bounds(world.clock.now)
    async with world.factory() as db:
        spent = VoiceSession(
            status="ended",
            end_reason="stopped",
            service="gemini_api",
            model="gemini-3.8-live",
            prompt_version="t",
            created_at=start_,
            ended_at=start_,
            cost_usd=Decimal("4.000001"),
        )
        db.add(spent)
        await db.commit()
    server_env(LIVE_VOICE_MAX_TALKS="1")  # busy as well: the limit still comes first
    talks_of(world.app).reserve(
        Ready(uuid.uuid4(), uuid.uuid4(), world.clock.now + timedelta(minutes=1))
    )
    limit = await refused(world, "jo.sample", "live_voice_limit", 429)
    assert int(limit.headers["retry-after"]) > 0
    assert "this month's limit is reached" in limit.json()["detail"]
    async with world.factory() as db:
        row = await db.get(VoiceSession, spent.id)
        assert row is not None
        row.cost_usd = Decimal("1")
        await db.commit()
    busy = await refused(world, "jo.sample", "live_voice_busy", 503)
    assert busy.headers["retry-after"] == "30"


async def test_a_second_start_ends_the_first_talk(world: World, live_voice_on: None) -> None:
    await account(world, "jo.sample")
    async with world.browser() as browser:
        assert (await sign_in(browser, login="jo.sample")).status_code == 200
        first = (await start(browser)).json()["id"]
        second = (await start(browser)).json()["id"]
    by_id = {str(row.id): row for row in await rows(world)}
    assert (by_id[first].status, by_id[first].end_reason) == ("ended", "replaced")
    assert by_id[second].status == "ready"


async def test_with_sign_in_off_the_laptop_is_one_person(world: World, live_voice_on: None) -> None:
    world.settings(auth_required=False)
    async with world.browser() as browser:
        response = await start(browser, company_key="101")
        again = await start(browser)
    assert (response.status_code, again.status_code) == (201, 201)
    first, second = await rows(world)
    assert (first.user_id, first.status, first.end_reason) == (None, "ended", "replaced")
    assert second.status == "ready"


# --- The month's line (T1-5) ---------------------------------------------------------------------


# --- The socket, end to end (T1-3, T1-4) ---------------------------------------------------------
