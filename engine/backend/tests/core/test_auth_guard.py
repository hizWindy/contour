"""The guard: where sign-in is required, every request needs a session (PLAN-V6 B4).

The first part needs no database: a request with no cookie must be answered before anything
touches one, and the tests make that loud (a database that raises if it is used). The second part
signs in on the test database and checks what a session lets through, and the ways a session ends.
"""

import re
import uuid
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from core.api.app import create_app
from core.api.guard import PUBLIC, document_sign_in, is_public
from core.api.routes import api_routes
from core.api.signin import auth_settings_dependency
from core.auth import sessions
from core.auth.models import UserSession
from core.config import Settings
from core.db.engine import get_session
from tests.core.auth_world import (
    API,
    World,
    all_rows,
    make_account,
    me,
    sign_in,
    token_in,
)
from tests.core.problems import without_id

PREFIX = "/api/v1"
LF = f"{PREFIX}/lead-finder"
PROBLEM = "application/problem+json"
VITE = "http://localhost:5173"
SAMPLE = {
    "run_id": str(uuid.uuid4()),
    "lead_id": str(uuid.uuid4()),
    "write_id": str(uuid.uuid4()),
    "key": "run_cap_usd",
}


class NoDatabase:
    """A session that fails the test if anything uses it."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"this request used the database ({name})")


class NoSessionFactory:
    """The guard's own database look-up. A request with no cookie must never call it."""

    def __call__(self) -> Any:
        raise AssertionError("the guard opened a database session for a request with no cookie")


def guarded_app(**values: Any) -> FastAPI:
    """The real app with sign-in required, and no database a request could reach."""
    app = create_app()
    chosen = Settings(_env_file=None, **{"auth_required": True, **values})
    app.dependency_overrides[auth_settings_dependency] = lambda: chosen

    async def no_database() -> Any:
        yield NoDatabase()

    app.dependency_overrides[get_session] = no_database
    app.state.session_factory = NoSessionFactory()
    return app


def client_for(app: FastAPI, **headers: str) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://localhost", headers=headers)


def filled(path: str) -> str:
    """A route's path with a plausible value for each `{name}`."""
    return re.sub(r"\{(\w+)\}", lambda found: SAMPLE.get(found.group(1), "x"), path)


def is_sign_in_needed(response: httpx.Response) -> bool:
    return (
        response.status_code == 401
        and response.headers["content-type"].startswith(PROBLEM)
        and response.json()["code"] == "auth_required"
    )


# --- No database needed -----------------------------------------------------------------------


async def test_every_route_without_a_session_is_a_401_except_the_two_public_ones() -> None:
    app = guarded_app()
    routes = api_routes(app)
    assert len(routes) > 45  # the list isn't empty by mistake, and includes the auth routes
    refused, open_ones = [], []
    async with client_for(app) as client:
        for route in routes:
            for method in sorted(route.methods):
                response = await client.request(method, filled(route.path))
                if (method, route.path) in PUBLIC:
                    open_ones.append((method, route.path))
                    assert not is_sign_in_needed(response), (method, route.path)
                else:
                    refused.append((method, route.path))
                    assert is_sign_in_needed(response), (method, route.path, response.text)
                    assert without_id(response) == {
                        "type": "about:blank",
                        "title": "Sign in needed",
                        "status": 401,
                        "detail": "Sign in to use Contour HQ.",
                        "code": "auth_required",
                    }
    assert sorted(open_ones) == [("GET", f"{PREFIX}/health"), ("POST", f"{PREFIX}/auth/login")]
    assert len(refused) == sum(len(route.methods) for route in routes) - 2


async def test_the_sign_in_and_the_health_check_are_reached_without_a_session() -> None:
    async with client_for(guarded_app()) as client:
        login = await client.post(f"{PREFIX}/auth/login", json={})
        assert login.status_code == 422  # the route ran and checked its body
        assert login.json()["errors"][0]["field"] == "body.login"
        health = await client.get(f"{PREFIX}/health")
        assert health.status_code == 500  # it ran, and met the database this test took away
        assert not is_sign_in_needed(health)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", f"{PREFIX}/nothing-here"),  # a path no route has
        ("GET", PREFIX),
        ("GET", f"{PREFIX}/"),
        ("GET", "/"),
        ("GET", "/api/v2/runs"),
        ("GET", f"{PREFIX}/health/"),  # not the health check itself
        ("GET", f"{PREFIX}/auth/login"),  # the wrong method for the one public route
        ("PUT", f"{PREFIX}/auth/login"),
        ("DELETE", f"{PREFIX}/health"),
        ("POST", f"{PREFIX}/health"),
        ("OPTIONS", f"{PREFIX}/runs"),  # a plain OPTIONS, not a CORS preflight
        ("GET", f"{PREFIX}/auth/login/../runs"),
        ("GET", f"{PREFIX}//runs"),
    ],
)
async def test_whatever_is_not_public_is_refused_whether_or_not_a_route_exists(
    method: str, path: str
) -> None:
    """Deny by default: a path that doesn't exist answers 401 like one that does, so no one
    without a session can map the routes."""
    async with client_for(guarded_app()) as client:
        response = await client.request(method, path)
    assert is_sign_in_needed(response), (method, path, response.status_code)


async def test_the_swagger_pages_hold_no_data_and_stay_open() -> None:
    async with client_for(guarded_app()) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 200, path
        # Only a GET, and only these pages.
        assert is_sign_in_needed(await client.post("/openapi.json"))
        assert is_sign_in_needed(await client.get("/docs/other"))


def test_what_is_public_is_decided_by_method_and_exact_path() -> None:
    app = guarded_app()

    def public(method: str, path: str) -> bool:
        return is_public({"method": method, "path": path}, app)

    assert public("GET", f"{PREFIX}/health")
    assert public("HEAD", f"{PREFIX}/health")
    assert public("POST", f"{PREFIX}/auth/login")
    assert public("GET", "/docs") and public("GET", "/openapi.json")
    for method, path in (
        ("GET", f"{PREFIX}/health/"),
        ("GET", f"{PREFIX}/HEALTH"),
        ("GET", f"{PREFIX}/auth/login"),
        ("POST", f"{PREFIX}/auth/logout"),
        ("POST", "/docs"),
        ("GET", f"{PREFIX}/auth/login/x"),
    ):
        assert not public(method, path), (method, path)


async def test_a_refused_request_never_reads_its_body() -> None:
    """An anonymous 1 GB upload to the HubSpot import is turned away at its headers."""
    app = guarded_app()
    reads: list[str] = []
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        reads.append("the body was read")
        return {"type": "http.request", "body": b"x" * 1000, "more_body": True}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "path": f"{PREFIX}/hubspot/import",
        "raw_path": f"{PREFIX}/hubspot/import".encode(),
        "query_string": b"",
        "headers": [
            (b"host", b"localhost"),
            (b"content-type", b"multipart/form-data; boundary=x"),
            (b"content-length", b"1073741824"),
        ],
        "scheme": "http",
        "server": ("localhost", 8000),
        "client": ("127.0.0.1", 40000),
    }
    await app(scope, receive, send)  # type: ignore[arg-type]
    assert reads == []
    assert sent[0]["status"] == 401
    assert (b"content-type", PROBLEM.encode()) in sent[0]["headers"]


async def test_a_websocket_without_a_session_is_closed_before_it_opens() -> None:
    app = guarded_app()
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "websocket.connect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0"},
        "path": f"{PREFIX}/runs/x/events",
        "raw_path": b"",
        "query_string": b"",
        "headers": [(b"host", b"localhost")],
        "scheme": "ws",
        "server": ("localhost", 8000),
        "client": ("127.0.0.1", 40000),
        "subprotocols": [],
    }
    await app(scope, receive, send)  # type: ignore[arg-type]
    assert sent == [{"type": "websocket.close", "code": 1008}]


async def test_the_live_run_events_need_a_session_like_every_other_route() -> None:
    async with client_for(guarded_app()) as client:
        response = await client.get(
            f"{PREFIX}/runs/{SAMPLE['run_id']}/events", headers={"Accept": "text/event-stream"}
        )
    assert is_sign_in_needed(response)
    assert not response.headers["content-type"].startswith("text/event-stream")


# --- Where the guard sits ---------------------------------------------------------------------


async def test_a_cors_preflight_is_answered_before_the_guard() -> None:
    """A browser asks permission before it sends a cookie, so the answer can't need one."""
    async with client_for(guarded_app()) as client:
        response = await client.options(
            f"{PREFIX}/runs",
            headers={
                "Origin": VITE,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == VITE


async def test_the_refusal_carries_the_cors_and_security_headers() -> None:
    async with client_for(guarded_app()) as client:
        response = await client.get(f"{LF}/leads", headers={"Origin": VITE})
    assert is_sign_in_needed(response)
    assert response.headers["access-control-allow-origin"] == VITE  # the page can read the 401
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


async def test_the_origin_guard_and_the_host_check_answer_before_the_guard() -> None:
    async with client_for(guarded_app()) as client:
        foreign = await client.post(
            f"{PREFIX}/runs/{SAMPLE['run_id']}/cancel", headers={"Origin": "http://evil.example"}
        )
        assert (foreign.status_code, foreign.json()["code"]) == (403, "origin_not_allowed")
        ours = await client.post(
            f"{PREFIX}/runs/{SAMPLE['run_id']}/cancel", headers={"Origin": VITE}
        )
        assert is_sign_in_needed(ours)  # our own page, but no session
        wrong_host = await client.get(f"{PREFIX}/runs", headers={"Host": "evil.example"})
        assert (wrong_host.status_code, wrong_host.json()["code"]) == (400, "host_not_allowed")


async def test_the_guard_is_the_innermost_layer_so_the_others_still_run_first() -> None:
    """`user_middleware` lists the outermost layer first, and the guard was added first."""
    names = [getattr(layer.cls, "__name__", "") for layer in guarded_app().user_middleware]
    assert names[-1] == "SessionGuard"
    assert {"ProblemCORSMiddleware", "OriginGuard"} <= set(names)


# --- Where sign-in is off ---------------------------------------------------------------------


async def test_where_sign_in_is_off_the_guard_does_nothing() -> None:
    app = guarded_app(auth_required=False)
    async with client_for(app) as client:
        assert (await client.get(f"{LF}/rules")).status_code == 200
        assert (await client.get(f"{PREFIX}/auth/me")).json() == {
            "auth_required": False,
            "user": None,
            "session": None,
        }
        # Nothing was looked up: there was no cookie, and the guard never even asked.
        assert (
            await client.get(f"{LF}/rules", headers={"Cookie": "contour_session=x"})
        ).status_code == 200


# --- The database is down ---------------------------------------------------------------------


async def test_a_cookie_while_the_database_is_down_is_a_503_not_a_500_and_not_a_401() -> None:
    app = guarded_app()

    class Down:
        def __call__(self) -> Any:
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    app.state.session_factory = Down()
    async with client_for(app) as client:
        response = await client.get(f"{LF}/rules", headers={"Cookie": "contour_session=abc"})
        assert response.status_code == 503
        assert response.headers["content-type"].startswith(PROBLEM)
        assert response.json()["title"] == "The database can't be reached"
        assert "connection refused" not in response.text  # nothing about the failure leaks
        # No cookie: the guard never needed the database, so the answer is the plain 401.
        assert is_sign_in_needed(await client.get(f"{LF}/rules"))


# --- What the API file says -------------------------------------------------------------------


def test_the_api_file_says_which_operations_need_the_session_cookie() -> None:
    schema = create_app().openapi()
    scheme = schema["components"]["securitySchemes"]["sessionCookie"]
    assert (scheme["type"], scheme["in"], scheme["name"]) == ("apiKey", "cookie", "contour_session")
    needs: list[tuple[str, str]] = []
    open_ones: list[tuple[str, str]] = []
    for path, item in schema["paths"].items():
        for method, operation in item.items():
            (needs if operation.get("security") else open_ones).append((method.upper(), path))
            if operation.get("security"):
                assert operation["security"] == [{"sessionCookie": []}]
    assert sorted(open_ones) == sorted(
        (method, path) for method, path in PUBLIC if method != "HEAD"
    )
    assert len(needs) > 45
    health = schema["paths"][f"{PREFIX}/health"]["get"]["responses"]
    assert "401" not in health  # it never answers one
    login = schema["paths"][f"{PREFIX}/auth/login"]["post"]["responses"]
    assert {"401", "429"} <= set(login)  # the sign-in's own two
    assert "401" in schema["paths"][f"{LF}/leads"]["get"]["responses"]


def test_marking_the_file_twice_changes_nothing() -> None:
    schema = create_app().openapi()
    before = repr(schema)
    document_sign_in(schema)
    assert repr(schema) == before


# --- With the database: what a session lets through -------------------------------------------


@pytest.mark.integration
async def test_with_a_session_the_guard_lets_the_routes_through(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await sign_in(browser)
    async with world.browser() as stranger:
        for path in (f"{LF}/rules", f"{PREFIX}/searches", f"{API}/me"):
            assert (await browser.get(path)).status_code == 200, path
            assert is_sign_in_needed(await stranger.get(path)), path
        # A change from our own page works with the session, and not without it.
        ours = {"Origin": VITE}
        gone = await browser.post(f"{PREFIX}/runs/{SAMPLE['run_id']}/cancel", headers=ours)
        assert gone.status_code == 503  # past the guard: the run engine isn't started in a test
        assert gone.json()["code"] == "runs_not_ready"
        assert is_sign_in_needed(
            await stranger.post(f"{PREFIX}/runs/{SAMPLE['run_id']}/cancel", headers=ours)
        )
        # The live run events too: the guard is past, and the route says what it has to say.
        events = await browser.get(f"{PREFIX}/runs/{SAMPLE['run_id']}/events")
        assert (events.status_code, events.json()["code"]) == (503, "runs_not_ready")
        assert is_sign_in_needed(await stranger.get(f"{PREFIX}/runs/{SAMPLE['run_id']}/events"))


@pytest.mark.integration
@pytest.mark.parametrize(
    ("advance", "reason", "detail"),
    [
        (timedelta(hours=2), "idle", "You were signed out after 2 hours idle."),
        (timedelta(hours=12), "expired", "Your session ended after 12 hours. Sign in again."),
    ],
)
async def test_a_session_that_ran_out_is_refused_on_any_route_with_the_reason(
    world: World, browser: httpx.AsyncClient, advance: timedelta, reason: str, detail: str
) -> None:
    await make_account(world)
    await sign_in(browser)
    world.clock.advance(seconds=advance.total_seconds())
    late = await browser.get(f"{LF}/rules")  # not an /auth route: the guard itself answers
    assert late.status_code == 401
    assert (late.json()["code"], late.json()["reason"], late.json()["detail"]) == (
        "auth_required",
        reason,
        detail,
    )
    assert late.headers["set-cookie"].startswith("contour_session=;")
    assert "Max-Age=0" in late.headers["set-cookie"]


@pytest.mark.integration
async def test_a_signed_out_session_is_refused_on_any_route(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    token = token_in(await sign_in(browser))
    await browser.post(f"{API}/logout")
    async with world.browser() as thief:
        late = await thief.get(f"{LF}/rules", headers={"Cookie": f"contour_session={token}"})
    assert (late.status_code, late.json()["reason"]) == (401, "ended")


@pytest.mark.integration
async def test_any_route_keeps_the_session_alive_not_only_the_ones_about_signing_in(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await sign_in(browser)
    for _ in range(
        5
    ):  # 5 hours, with a request every hour to a route that has nothing to do with it
        world.clock.advance(hours=1)
        assert (await browser.get(f"{LF}/rules")).status_code == 200
    (row,) = await all_rows(world, UserSession)
    assert row.last_seen_at == world.clock.now


@pytest.mark.integration
async def test_a_request_looks_its_session_up_once(
    world: World, browser: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await make_account(world)
    await sign_in(browser)
    calls: list[str] = []
    real = sessions.resolve

    async def counting(*args: Any, **kwargs: Any) -> Any:
        calls.append("looked up")
        return await real(*args, **kwargs)

    monkeypatch.setattr(sessions, "resolve", counting)
    assert (await me(browser)).status_code == 200  # a route that asks who is signed in
    assert calls == ["looked up"]  # the guard did, and the route used its answer
    assert (await browser.get(f"{LF}/rules")).status_code == 200
    assert calls == ["looked up", "looked up"]
