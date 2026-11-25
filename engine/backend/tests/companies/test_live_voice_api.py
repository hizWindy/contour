"""PLAN-V28 T1-2 to T1-5 on the test database: starting a talk, the socket end to end through a
real server and a fake Google, a backend restart, and the month's line.

Sign-in is on (the World harness), so every check runs as it does live. The key is made up and no
test reaches Google. Names are made up ("Jo Sample", "Sample Logistics").
"""

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable, Generator
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import InvalidStatus

from apps.companies.live_voice.models import VoiceSession
from apps.companies.live_voice.relay import RelayLimits
from apps.companies.live_voice.service import month_bounds, talks_of
from apps.companies.live_voice.talks import Ready
from core.auth import admin
from core.auth.models import User
from tests.companies.live_voice_fakes import FAKE_KEY, FakeConnection, FakeGoogle, frames
from tests.core.auth_world import FAST, GOOD, World, build_world, make_platform_admin, sign_in

pytestmark = pytest.mark.integration

VOICE = "/api/v1/companies/assistant/voice"
ORIGIN = "http://localhost:5173"
LIMITS = RelayLimits(
    tool_seconds=0.5,
    save_every_seconds=0.3,
    open_seconds=3,
    limit_finish_seconds=0.5,
    quiet_seconds=0.05,
    move_lead_seconds=0.4,
    old_drain_seconds=0.1,
    tick_seconds=0.02,
)


@pytest.fixture
def live_voice_on(server_env: Callable[..., None]) -> None:
    server_env(LIVE_VOICE_OK="true", GEMINI_API_KEY=FAKE_KEY)


@pytest.fixture
async def google() -> AsyncIterator[FakeGoogle]:
    async with FakeGoogle() as fake:
        yield fake


def ready_app(world: World, google: FakeGoogle) -> FastAPI:
    world.app.state.live_voice_endpoint = google.endpoint()
    world.app.state.live_voice_limits = LIMITS
    return world.app


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


async def test_the_month_line_adds_up_every_talk_started_this_month(
    world: World, live_voice_on: None
) -> None:
    await make_platform_admin(world)
    await account(world, "jo.sample")
    start_, end, name = month_bounds(world.clock.now)
    async with world.factory() as db:
        for created, seconds, cost in (
            (start_, 1800, "0.300000"),  # this month
            (end - timedelta(seconds=1), 720, "0.205000"),  # this month, its last second
            (start_ - timedelta(seconds=1), 9999, "3.000000"),  # last month
            (end, 9999, "3.000000"),  # next month
        ):
            db.add(
                VoiceSession(
                    status="ended",
                    end_reason="stopped",
                    service="gemini_api",
                    model="gemini-3.8-live",
                    prompt_version="t",
                    created_at=created,
                    ended_at=created,
                    talk_seconds=seconds,
                    cost_usd=Decimal(cost),
                )
            )
        await db.commit()
    async with world.browser() as boss, world.browser() as staff:
        assert (await sign_in(boss)).status_code == 200
        assert (await sign_in(staff, login="jo.sample")).status_code == 200
        line = (await boss.get(f"{VOICE}/month")).json()
        refused_ = await staff.get(f"{VOICE}/month")
    assert line == {
        "month": name,
        "minutes": 42,
        "talks": 2,
        "spent_usd": "0.51",
        "cap_usd": "4.00",
        "line": "Live voice this month: 42 minutes, about US$0.51 of US$4.00.",
    }
    assert (refused_.status_code, refused_.json()["code"]) == (403, "platform_admin_only")


# --- The socket, end to end (T1-3, T1-4) ---------------------------------------------------------


class _Server(uvicorn.Server):
    @contextlib.contextmanager
    def capture_signals(self) -> Generator[None, None, None]:
        yield  # leave Ctrl+C to pytest


@dataclass
class Served:
    host: str
    server: _Server
    task: "asyncio.Task[None]"

    async def stop(self) -> None:
        """Stops the server the way a deploy does: every open socket gets 1012 first."""
        self.server.should_exit = True
        await asyncio.wait_for(self.task, 20)


async def serve(app: FastAPI) -> Served:
    server = _Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=0,
            log_config=None,
            access_log=False,
            lifespan="off",
            ws="auto",
            timeout_graceful_shutdown=10,
        )
    )
    task = asyncio.create_task(server.serve())
    for _ in range(500):
        if server.started:
            break
        await asyncio.sleep(0.02)
    port = server.servers[0].sockets[0].getsockname()[1]
    return Served(f"127.0.0.1:{port}", server, task)


@contextlib.asynccontextmanager
async def served(app: FastAPI) -> AsyncIterator[Served]:
    running = await serve(app)
    try:
        yield running
    finally:
        if not running.task.done():
            await running.stop()


async def signed_in(served_: Served, login: str) -> tuple[httpx.AsyncClient, str]:
    client = httpx.AsyncClient(base_url=f"http://{served_.host}", timeout=10)
    response = await sign_in(client, login=login)
    assert response.status_code == 200, response.text
    return client, f"contour_session={client.cookies['contour_session']}"


def socket_of(
    served_: Served, talk_id: str, cookie: str | None, *, origin: str | None = ORIGIN
) -> Any:
    headers = {"Cookie": cookie} if cookie else None
    return connect(
        f"ws://{served_.host}{VOICE}/live?session={talk_id}",
        origin=origin,  # type: ignore[arg-type]
        additional_headers=headers,
        open_timeout=5,
        proxy=None,
    )


async def next_json(socket: ClientConnection, kind: str, seconds: float = 5) -> dict[str, Any]:
    async with asyncio.timeout(seconds):
        while True:
            raw = await socket.recv()
            if isinstance(raw, str):
                message = json.loads(raw)
                if message["type"] == kind:
                    return dict(message)


async def refused_socket(served_: Served, talk_id: str, cookie: str | None, **options: Any) -> None:
    with pytest.raises(InvalidStatus) as caught:
        async with socket_of(served_, talk_id, cookie, **options):
            pass
    assert caught.value.response.status_code == 403  # closed before it opened


async def test_the_socket_carries_a_whole_talk_and_writes_its_row(
    world: World, google: FakeGoogle, live_voice_on: None
) -> None:
    await account(world, "jo.sample")
    async with served(ready_app(world, google)) as live:
        client, cookie = await signed_in(live, "jo.sample")
        talk_id = (await start(client)).json()["id"]
        async with socket_of(live, talk_id, cookie) as socket:
            assert (await next_json(socket, "ready"))["resumed"] is False
            conn = await google.next()
            assert conn.headers["x-goog-api-key"] == FAKE_KEY
            pieces = frames(0.2)
            for piece in pieces:
                await socket.send(piece)
            await conn.wait_for(lambda c: bytes(c.audio) == b"".join(pieces))
            await conn.sound(b"\x02\x00" * 1200)
            assert await socket.recv() == b"\x02\x00" * 1200
            await conn.tool_call("call-1", "Log a call with Jo at Sample Logistics")
            call = await next_json(socket, "tool_call")
            assert call["request"] == "Log a call with Jo at Sample Logistics"
            await socket.send(
                json.dumps(
                    {"type": "tool_answer", "id": "call-1", "status": "ok", "message": "Ready."}
                )
            )
            await conn.wait_for(lambda c: bool(c.sent("toolResponse")))
            await conn.handle("handle-1")
            await conn.usage(promptTokenCount=1000, responseTokenCount=100)
            await socket.send(json.dumps({"type": "stop"}))
            ended = await next_json(socket, "ended")
            assert ended == {"type": "ended", "reason": "stopped", "line": None}
        await client.aclose()
    (row,) = await rows(world)
    assert (row.status, row.end_reason, row.resume_handle) == ("ended", "stopped", None)
    assert (row.tool_calls, row.tokens_in_other, row.tokens_out_other) == (1, 1000, 100)
    assert row.cost_usd == Decimal("0.004200")  # 1,000 in at US$3, 100 out at US$12 a million
    assert row.opened_at is not None and row.ended_at is not None


async def test_a_wrong_origin_no_session_and_another_persons_talk_are_refused(
    world: World, google: FakeGoogle, live_voice_on: None
) -> None:
    await account(world, "jo.sample")
    await account(world, "sam.sample")
    async with served(ready_app(world, google)) as live:
        jo, jo_cookie = await signed_in(live, "jo.sample")
        sam, sam_cookie = await signed_in(live, "sam.sample")
        talk_id = (await start(jo)).json()["id"]
        await refused_socket(live, talk_id, jo_cookie, origin="https://evil.example")
        await refused_socket(live, talk_id, jo_cookie, origin=None)
        await refused_socket(live, talk_id, None)  # no session: the sign-in guard
        await refused_socket(live, talk_id, sam_cookie)  # not Sam's talk
        await refused_socket(live, str(uuid.uuid4()), jo_cookie)
        await refused_socket(live, "not-an-id", jo_cookie)
        assert google.connections == []
        async with socket_of(live, talk_id, jo_cookie) as socket:  # still Jo's to open
            await next_json(socket, "ready")
            await refused_socket(live, talk_id, jo_cookie)  # a talk opens once
            await socket.send(json.dumps({"type": "stop"}))
            await next_json(socket, "ended")
        await refused_socket(live, talk_id, jo_cookie)  # and never again once ended
        await jo.aclose()
        await sam.aclose()


async def test_a_ready_talk_older_than_60_seconds_cant_be_opened(
    world: World, google: FakeGoogle, live_voice_on: None
) -> None:
    await account(world, "jo.sample")
    async with served(ready_app(world, google)) as live:
        client, cookie = await signed_in(live, "jo.sample")
        talk_id = (await start(client)).json()["id"]
        world.clock.advance(seconds=61)
        await refused_socket(live, talk_id, cookie)
        await client.aclose()
    (row,) = await rows(world)
    assert (row.status, row.end_reason) == ("ended", "expired")


async def test_a_second_start_closes_the_first_talks_socket_as_replaced(
    world: World, google: FakeGoogle, live_voice_on: None
) -> None:
    await account(world, "jo.sample")
    async with served(ready_app(world, google)) as live:
        client, cookie = await signed_in(live, "jo.sample")
        first = (await start(client)).json()["id"]
        async with socket_of(live, first, cookie) as socket:
            await next_json(socket, "ready")
            assert (await start(client)).status_code == 201
            ended = await next_json(socket, "ended")
            assert ended["reason"] == "replaced"
            assert ended["line"] == "Live voice moved to your newer window."
        await client.aclose()
        await asyncio.sleep(0.2)
    by_id = {str(row.id): row for row in await rows(world)}
    assert (by_id[first].status, by_id[first].end_reason) == ("ended", "replaced")


async def test_after_a_backend_restart_the_browser_carries_on_with_the_same_talk(
    world: World,
    google: FakeGoogle,
    live_voice_on: None,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await account(world, "jo.sample")
    first_backend = await serve(ready_app(world, google))
    client, cookie = await signed_in(first_backend, "jo.sample")
    talk_id = (await start(client)).json()["id"]
    await client.aclose()
    async with socket_of(first_backend, talk_id, cookie) as socket:
        await next_json(socket, "ready")
        before: FakeConnection = await google.next()
        await before.handle("handle-restart")
        await before.usage(promptTokenCount=500)
        await asyncio.sleep(0.4)  # the counts and the handle are written
        await first_backend.stop()  # a deploy: the socket gets 1012
    (row,) = await rows(world)
    assert (row.status, row.end_reason, row.resume_handle) == (
        "dropped",
        "restart",
        "handle-restart",
    )
    assert row.tokens_in_other == 500

    second = build_world(session_factory)  # a new backend: a new app, the same database
    second.clock.now = world.clock.now
    second_backend = await serve(ready_app(second, google))
    try:
        async with socket_of(second_backend, talk_id, cookie) as socket:
            assert (await next_json(socket, "ready"))["resumed"] is True
            after = await google.next()
            assert after.setup["sessionResumption"] == {"handle": "handle-restart"}
            await after.usage(promptTokenCount=200)
            await socket.send(json.dumps({"type": "stop"}))
            await next_json(socket, "ended")
    finally:
        await second_backend.stop()
    (row,) = await rows(world)
    assert (row.status, row.end_reason, row.resume_handle) == ("ended", "stopped", None)
    assert row.tokens_in_other == 700  # the counts carried on


async def test_the_key_is_in_no_log_line_and_no_message_to_the_browser(
    world: World, google: FakeGoogle, live_voice_on: None, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    await account(world, "jo.sample")
    received: list[str | bytes] = []
    async with served(ready_app(world, google)) as live:
        client, cookie = await signed_in(live, "jo.sample")
        talk_id = (await start(client)).json()["id"]
        async with socket_of(live, talk_id, cookie) as socket:
            await next_json(socket, "ready")
            conn = await google.next()
            await conn.handle("handle-secret")
            await conn.heard("Jo Sample at Sample Logistics", finished=True)
            await socket.send(json.dumps({"type": "stop"}))
            async for message in socket:
                received.append(message)
        await client.aclose()
    logged = "\n".join(json.dumps(record.__dict__, default=str) for record in caplog.records)
    sent = json.dumps([m if isinstance(m, str) else m.hex() for m in received])
    for secret in (FAKE_KEY, "handle-secret"):
        assert secret not in logged
        assert secret not in sent
    assert "Sample Logistics" not in logged
    assert any(record.getMessage() == "live_voice_end" for record in caplog.records)


async def left_by_a_dead_backend(
    world: World, owner: User, *, status: str, seconds_ago: float
) -> uuid.UUID:
    """A talk a backend held when it stopped: `dropped` (it said so) or still `open` (it died)."""
    now = world.clock.now
    then = now - timedelta(seconds=seconds_ago)
    talk_id = uuid.uuid4()
    async with world.factory() as db:
        db.add(
            VoiceSession(
                id=talk_id,
                user_id=owner.id,
                status=status,
                end_reason="restart" if status == "dropped" else None,
                service="gemini_api",
                model="gemini-3.8-live",
                prompt_version="t",
                resume_handle="handle-left",
                created_at=now - timedelta(minutes=5),
                opened_at=now - timedelta(minutes=5),
                ended_at=then if status == "dropped" else None,
                updated_at=then,
                tokens_in_other=100,
                cost_usd=Decimal("0.000300"),
            )
        )
        await db.commit()
    return talk_id


async def test_an_open_talk_no_backend_holds_carries_on_for_its_owner_only(
    world: World, google: FakeGoogle, live_voice_on: None
) -> None:
    jo = await account(world, "jo.sample")
    await account(world, "sam.sample")
    talk_id = str(await left_by_a_dead_backend(world, jo, status="open", seconds_ago=20))
    async with served(ready_app(world, google)) as live:
        sam, sam_cookie = await signed_in(live, "sam.sample")
        await refused_socket(live, talk_id, sam_cookie)  # not Sam's
        jo_client, jo_cookie = await signed_in(live, "jo.sample")
        async with socket_of(live, talk_id, jo_cookie) as socket:
            assert (await next_json(socket, "ready"))["resumed"] is True
            conn = await google.next()
            assert conn.setup["sessionResumption"] == {"handle": "handle-left"}
            await socket.send(json.dumps({"type": "stop"}))
            await next_json(socket, "ended")
        await sam.aclose()
        await jo_client.aclose()
    (row,) = await rows(world)
    assert (row.status, row.end_reason, row.resume_handle) == ("ended", "stopped", None)
    assert row.tokens_in_other == 100  # what it had counted stays


@pytest.mark.parametrize(("status", "seconds_ago"), [("dropped", 61), ("open", 91)])
async def test_a_talk_too_old_to_carry_on_is_refused_and_ended(
    world: World, google: FakeGoogle, live_voice_on: None, status: str, seconds_ago: float
) -> None:
    jo = await account(world, "jo.sample")
    talk_id = str(await left_by_a_dead_backend(world, jo, status=status, seconds_ago=seconds_ago))
    async with served(ready_app(world, google)) as live:
        client, cookie = await signed_in(live, "jo.sample")
        await refused_socket(live, talk_id, cookie)
        await client.aclose()
    (row,) = await rows(world)
    assert (row.status, row.end_reason, row.resume_handle) == ("ended", "expired", None)
    assert google.connections == []
