"""Server mode (PLAN-V6 B5): the engine on a server, behind Caddy and HTTPS.

Off, nothing changes: the laptop keeps its 127.0.0.1 lock. On, it answers to one named domain, and
it refuses to start without what makes that safe. The settings are checked first (no database),
then the app they make, then `serve`, and last a real uvicorn server proves that only the trusted
proxy's word is taken for a client's IP address.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable, Generator, Iterator
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Request
from pydantic import ValidationError

from core import cli
from core.api.app import create_app
from core.api.security import (
    LOCAL_HOST_DETAIL,
    SERVER_HOST_DETAIL,
    allowed_origins,
    trusted_hosts,
)
from core.config import Settings, get_settings
from tests.core.auth_world import World, build_world, make_account, me, sign_in
from tests.core.test_auth_guard import NoSessionFactory

ORIGIN = "https://hq.example.com.au"
HOST = "hq.example.com.au"
PROXIES = "172.18.0.0/16"
SERVER: dict[str, Any] = {"server_mode": True, "public_origin": ORIGIN, "trusted_proxies": PROXIES}
SERVER_ENV_NAMES = (
    "SERVER_MODE",
    "PUBLIC_ORIGIN",
    "TRUSTED_PROXIES",
    "AUTH_REQUIRED",
    "SESSION_COOKIE_SECURE",
    "AUTO_MIGRATE",
    "API_HOST",
)


def make(**values: Any) -> Settings:
    """Settings from these values and the defaults only: no .env file, no environment."""
    return Settings(_env_file=None, **values)


def problems(**values: Any) -> dict[str, str]:
    """What the settings refuse, by field, or {} if they accept it."""
    try:
        make(**values)
    except ValidationError as error:
        return {
            ".".join(str(part) for part in item["loc"]): item["msg"]
            for item in error.errors(include_input=False, include_url=False)
        }
    return {}


@pytest.fixture(autouse=True)
def no_sign_in_switches_in_the_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """The shared test setup turns sign-in off in the environment, and server mode (rightly) refuses
    an explicit AUTH_REQUIRED=false. These tests set what they need themselves."""
    for name in SERVER_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def server_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., None]]:
    """Sets the environment the app reads its settings from (and takes the test setup's own
    sign-in switches out of it). Only these names: nothing here touches the database name."""

    def put(**values: str) -> None:
        for name in SERVER_ENV_NAMES:
            monkeypatch.delenv(name, raising=False)
        for name, value in values.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()

    yield put
    get_settings.cache_clear()


def client_for(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://localhost")


# --- Off by default, and nothing changes -----------------------------------------------------


def test_server_mode_is_off_by_default_and_the_laptop_keeps_its_lock() -> None:
    settings = make()
    assert (settings.server_mode, settings.public_origin, settings.trusted_proxies) == (
        False,
        None,
        [],
    )
    assert (settings.listen_host, settings.public_host) == ("127.0.0.1", None)
    assert (settings.auth_required, settings.session_cookie_secure) == (False, False)
    assert settings.auto_migrate is True
    assert trusted_hosts(settings) == ["localhost", "127.0.0.1"]
    assert "https" not in "".join(allowed_origins(settings))
    # The address the backend may listen on is still this computer's.
    with pytest.raises(ValidationError, match="api_host"):
        make(api_host="0.0.0.0")


def test_the_public_settings_do_nothing_when_server_mode_is_off() -> None:
    settings = make(public_origin=ORIGIN, trusted_proxies=PROXIES)
    assert settings.listen_host == "127.0.0.1"
    assert (settings.auth_required, settings.session_cookie_secure) == (False, False)
    assert trusted_hosts(settings) == ["localhost", "127.0.0.1"]  # not the public host
    assert ORIGIN not in allowed_origins(settings)


def test_server_mode_needs_the_exact_text_true() -> None:
    for text in ("yes", "1", "on", "TRUE!", "tru", "enabled"):
        assert "server_mode" in problems(server_mode=text, public_origin=ORIGIN), text
    for text in ("true", "TRUE", " true ", "True "):  # case and spaces don't matter, as elsewhere
        assert problems(server_mode=text, public_origin=ORIGIN, trusted_proxies=PROXIES) == {}


# --- What server mode sets up -----------------------------------------------------------------


def test_server_mode_turns_on_what_it_needs() -> None:
    settings = make(**SERVER)
    assert settings.public_origin == ORIGIN
    assert settings.public_host == HOST
    assert settings.listen_host == "0.0.0.0"  # inside the container: only the proxy reaches it
    assert settings.auth_required is True
    assert settings.session_cookie_secure is True
    assert settings.auto_migrate is False  # the migrate step runs first, as its own step
    assert settings.trusted_proxies == [PROXIES]


def test_what_server_mode_needs_may_also_be_said_out_loud() -> None:
    assert (
        problems(**SERVER, auth_required=True, session_cookie_secure=True, auto_migrate=False) == {}
    )


def test_the_origin_is_written_the_same_way_whatever_the_case_or_the_slash() -> None:
    assert make(public_origin="HTTPS://HQ.Example.COM.au/").public_origin == ORIGIN
    assert make(public_origin=f"{ORIGIN}:8443").public_origin == f"{ORIGIN}:8443"
    assert make(public_origin="https://localhost").public_origin == "https://localhost"  # the trial
    assert make(public_origin="").public_origin is None


# --- What server mode refuses -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("changes", "field", "words"),
    [
        ({"public_origin": None}, "public_origin", "needs PUBLIC_ORIGIN"),
        ({"public_origin": ""}, "public_origin", "needs PUBLIC_ORIGIN"),
        ({"public_origin": "   "}, "public_origin", "needs PUBLIC_ORIGIN"),
        ({"trusted_proxies": ""}, "trusted_proxies", "needs TRUSTED_PROXIES"),
        ({"trusted_proxies": []}, "trusted_proxies", "needs TRUSTED_PROXIES"),
        ({"auth_required": False}, "auth_required", "always requires sign-in"),
        ({"session_cookie_secure": False}, "session_cookie_secure", "Secure cookie"),
        ({"auto_migrate": True}, "auto_migrate", "doesn't change the database at start"),
    ],
)
def test_server_mode_refuses_to_start_without_what_it_needs(
    changes: dict[str, Any], field: str, words: str
) -> None:
    refused = problems(**{**SERVER, **changes})
    assert words in refused[field]
    assert set(refused) == {field}


def test_server_mode_lists_every_problem_at_once() -> None:
    refused = problems(server_mode=True, auth_required=False, session_cookie_secure=False)
    assert set(refused) == {
        "public_origin",
        "trusted_proxies",
        "auth_required",
        "session_cookie_secure",
    }


@pytest.mark.parametrize(
    "origin",
    [
        "http://hq.example.com.au",  # not HTTPS
        "hq.example.com.au",  # no scheme
        "ftp://hq.example.com.au",
        "https://hq.example.com.au/app",  # a path
        "https://user:pass@hq.example.com.au",  # a login
        "https://hq.example.com.au?x=1",
        "https://hq.example.com.au#top",
        "https://",  # no host
        "https://hq.example.com.au:99999",  # a bad port
    ],
)
def test_the_public_origin_must_be_a_plain_https_address(origin: str) -> None:
    refused = problems(**{**SERVER, "public_origin": origin})
    assert "public_origin" in refused, origin
    if origin.startswith("http://"):
        assert "https://" in refused["public_origin"]


@pytest.mark.parametrize(
    "proxies",
    ["*", "0.0.0.0/0", "::/0", "caddy", "999.1.1.1", "172.18.0.0/33", "172.18.0.0/16, *"],
)
def test_a_trusted_proxy_is_an_address_or_a_network_and_never_everyone(proxies: str) -> None:
    assert "trusted_proxies" in problems(**{**SERVER, "trusted_proxies": proxies}), proxies
    assert "trusted_proxies" in problems(trusted_proxies=proxies)  # also with server mode off


def test_the_trusted_proxies_are_read_from_text_a_json_list_or_a_list() -> None:
    expected = ["172.18.0.0/16", "10.0.0.5/32", "fd00::/8"]
    assert make(trusted_proxies="172.18.0.0/16, 10.0.0.5 fd00::/8").trusted_proxies == expected
    assert make(trusted_proxies='["172.18.0.0/16", "10.0.0.5", "fd00::/8"]').trusted_proxies == (
        expected
    )
    assert make(trusted_proxies=["172.18.0.0/16", "10.0.0.5", "fd00::/8"]).trusted_proxies == (
        expected
    )
    assert make(trusted_proxies="10.0.0.5, 10.0.0.5").trusted_proxies == ["10.0.0.5/32"]
    assert make(trusted_proxies="").trusted_proxies == []
    assert "trusted_proxies" in problems(trusted_proxies="[not json")


def test_the_settings_come_from_the_environment_the_way_the_server_gives_them(
    server_env: Callable[..., None],
) -> None:
    server_env(SERVER_MODE="true", PUBLIC_ORIGIN=ORIGIN, TRUSTED_PROXIES="172.18.0.0/16,10.0.0.5")
    settings = get_settings()
    assert (settings.server_mode, settings.public_origin) == (True, ORIGIN)
    assert settings.trusted_proxies == ["172.18.0.0/16", "10.0.0.5/32"]
    assert (settings.auth_required, settings.session_cookie_secure, settings.auto_migrate) == (
        True,
        True,
        False,
    )


# --- The host check and the origin guard ------------------------------------------------------


def test_in_server_mode_the_host_and_origin_are_the_public_ones() -> None:
    settings = make(**SERVER)
    assert trusted_hosts(settings) == [
        HOST,
        "localhost",
        "127.0.0.1",
    ]  # the last two: health checks
    assert allowed_origins(settings) == frozenset({ORIGIN})  # not localhost:5173, not the API's own


def server_app(server_env: Callable[..., None], **env: str) -> FastAPI:
    server_env(
        **{"SERVER_MODE": "true", "PUBLIC_ORIGIN": ORIGIN, "TRUSTED_PROXIES": PROXIES, **env}
    )
    app = create_app()
    app.state.session_factory = NoSessionFactory()  # a request with no cookie never needs it
    return app


@pytest.mark.parametrize(
    "host", [HOST, f"{HOST}:443", "HQ.EXAMPLE.COM.AU", "localhost", "127.0.0.1:8000"]
)
async def test_the_public_host_and_the_containers_own_names_are_answered(
    server_env: Callable[..., None], host: str
) -> None:
    async with client_for(server_app(server_env)) as client:
        response = await client.get("/api/v1/lead-finder/rules", headers={"Host": host})
    assert response.status_code == 401  # past the host check: it is the sign-in that says no


@pytest.mark.parametrize(
    "host",
    ["evil.example", f"{HOST}.evil.example", f"evil.{HOST}", "hq.example.com", "[::1]", ""],
)
async def test_any_other_host_is_refused_in_the_engines_own_words(
    server_env: Callable[..., None], host: str
) -> None:
    async with client_for(server_app(server_env)) as client:
        response = await client.get("/api/v1/lead-finder/rules", headers={"Host": host})
    assert response.status_code == 400
    assert response.json()["code"] == "host_not_allowed"
    assert response.json()["detail"] == SERVER_HOST_DETAIL
    assert "evil" not in response.text


async def test_without_server_mode_the_public_host_is_not_a_host_here(
    server_env: Callable[..., None],
) -> None:
    server_env(PUBLIC_ORIGIN=ORIGIN, TRUSTED_PROXIES=PROXIES)  # set, but SERVER_MODE is off
    app = create_app()
    async with client_for(app) as client:
        refused = await client.get("/api/v1/lead-finder/rules", headers={"Host": HOST})
        ours = await client.get("/api/v1/lead-finder/rules", headers={"Host": "localhost:8000"})
    assert (refused.status_code, refused.json()["detail"]) == (400, LOCAL_HOST_DETAIL)
    assert ours.status_code == 200  # and sign-in is off here, as it always was


@pytest.mark.parametrize(
    ("origin", "passes"),
    [
        (ORIGIN, True),
        ("HTTPS://HQ.EXAMPLE.COM.AU", True),
        ("http://localhost:5173", False),  # the laptop's website
        ("http://127.0.0.1:8000", False),  # the API's own page
        ("http://hq.example.com.au", False),  # the wrong scheme
        (f"{ORIGIN}.evil.example", False),
        ("https://evil.example", False),
        ("null", False),
    ],
)
async def test_a_change_may_only_come_from_the_public_origin(
    server_env: Callable[..., None], origin: str, passes: bool
) -> None:
    async with client_for(server_app(server_env)) as client:
        response = await client.post(
            "/api/v1/auth/login", json={}, headers={"Host": HOST, "Origin": origin}
        )
    if passes:
        assert response.status_code == 422  # it reached the sign-in route, which checked its body
    else:
        assert (response.status_code, response.json()["code"]) == (403, "origin_not_allowed")


async def test_without_server_mode_the_laptops_origins_are_the_allowed_ones(
    server_env: Callable[..., None],
) -> None:
    server_env(PUBLIC_ORIGIN=ORIGIN)
    async with client_for(create_app()) as client:
        ours = await client.post(
            "/api/v1/auth/login", json={}, headers={"Origin": "http://localhost:5173"}
        )
        theirs = await client.post("/api/v1/auth/login", json={}, headers={"Origin": ORIGIN})
    assert ours.status_code == 422
    assert theirs.status_code == 403


# --- Swagger, the contract and the sign-in on a server ----------------------------------------


async def test_the_swagger_pages_are_not_served_on_a_server(
    server_env: Callable[..., None],
) -> None:
    app = server_app(server_env)
    assert (app.docs_url, app.redoc_url, app.openapi_url) == (None, None, None)
    async with client_for(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            answer = await client.get(path, headers={"Host": HOST})
            assert (answer.status_code, answer.json()["code"]) == (401, "auth_required"), path
    # The contract file for the website is still made from the app itself.
    written = cli.render_openapi(app)
    assert '"/auth/login"' in written
    assert '"sessionCookie"' in written


async def test_on_this_computer_the_swagger_pages_are_served(
    server_env: Callable[..., None],
) -> None:
    server_env()
    app = create_app()
    async with client_for(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 200, path


async def test_every_route_needs_a_session_on_a_server_without_anyone_asking_for_it(
    server_env: Callable[..., None],
) -> None:
    app = server_app(server_env)  # AUTH_REQUIRED is not set: server mode turns it on
    async with client_for(app) as client:
        for path in ("/api/v1/lead-finder/rules", "/api/v1/runs", "/api/v1/auth/me"):
            answer = await client.get(path, headers={"Host": HOST})
            assert (answer.status_code, answer.json()["code"]) == (401, "auth_required"), path


# --- serve ------------------------------------------------------------------------------------


class Capture:
    """Stands in for uvicorn's Server, and for `migrate`, and records what `serve` asked for."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.config: dict[str, Any] = {}
        self.migrations: list[str] = []
        self.reload: dict[str, Any] = {}
        capture = self

        class FakeServer:
            def __init__(self, config: uvicorn.Config) -> None:
                capture.config = {
                    "host": config.host,
                    "port": config.port,
                    "proxy_headers": config.proxy_headers,
                    "allow": config.forwarded_allow_ips,
                }

            async def serve(self) -> None: ...

        def fake_run(target: str, **kwargs: Any) -> None:
            capture.reload = kwargs

        monkeypatch.setattr(uvicorn, "Server", FakeServer)
        monkeypatch.setattr(uvicorn, "run", fake_run)
        monkeypatch.setattr(cli, "migrate", lambda: self.migrations.append("migrated"))


def test_serve_on_a_server_listens_everywhere_trusts_only_the_proxy_and_does_not_migrate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture = Capture(monkeypatch)
    monkeypatch.setattr(cli, "get_settings", lambda: make(**SERVER))
    assert cli.serve() == 0
    assert capture.config == {
        "host": "0.0.0.0",
        "port": 8000,
        "proxy_headers": True,
        "allow": PROXIES,
    }
    assert capture.migrations == []  # the migrate step is its own step, before the backend


def test_serve_with_reload_gives_the_same_answers_to_uvicorn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture = Capture(monkeypatch)
    monkeypatch.setattr(cli, "get_settings", lambda: make(**SERVER))
    assert cli.serve(reload=True) == 0
    assert capture.reload["host"] == "0.0.0.0"
    assert (capture.reload["proxy_headers"], capture.reload["forwarded_allow_ips"]) == (
        True,
        PROXIES,
    )


def test_serve_on_this_computer_is_as_it_always_was(monkeypatch: pytest.MonkeyPatch) -> None:
    capture = Capture(monkeypatch)
    monkeypatch.setattr(cli, "get_settings", lambda: make())
    assert cli.serve() == 0
    assert capture.config["host"] == "127.0.0.1"
    assert capture.config["proxy_headers"] is False  # no one's word is taken for an address
    assert capture.migrations == ["migrated"]  # it still migrates at start


def test_serve_says_what_is_missing_and_does_not_start(
    server_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    server_env(SERVER_MODE="true", AUTH_REQUIRED="false")
    assert cli.main(["serve"]) == 1
    err = capsys.readouterr().err
    for name in ("PUBLIC_ORIGIN", "TRUSTED_PROXIES", "AUTH_REQUIRED=false"):
        assert name in err
    server_env(SERVER_MODE="true", PUBLIC_ORIGIN="http://hq.example.com.au", TRUSTED_PROXIES="*")
    assert cli.main(["serve"]) == 1
    err = capsys.readouterr().err
    assert "https://" in err
    assert "can't be *" in err


# --- The cookie, end to end -------------------------------------------------------------------


@pytest.fixture
def server_world(session_factory: Any, server_env: Callable[..., None]) -> World:
    server_env(SERVER_MODE="true", PUBLIC_ORIGIN=ORIGIN, TRUSTED_PROXIES=PROXIES)
    world = build_world(session_factory)  # the app and its layers read the environment above
    world.settings(**SERVER)  # and the routes and the guard read the same settings
    return world


@pytest.mark.integration
async def test_on_a_server_the_cookie_is_host_prefixed_and_secure_and_only_our_origin_may_post(
    server_world: World,
) -> None:
    await make_account(server_world)
    async with server_world.browser(base_url=ORIGIN) as site:
        site.headers["Origin"] = ORIGIN
        signed_in = await sign_in(site)
        assert signed_in.status_code == 200
        cookie = signed_in.headers["set-cookie"]
        assert cookie.startswith("__Host-contour_session=")
        assert cookie.endswith("; Path=/; HttpOnly; SameSite=Strict; Secure")
        assert "Domain" not in cookie
        assert (await me(site)).status_code == 200  # the jar sends it back over https
        assert (await site.get("/api/v1/lead-finder/rules")).status_code == 200

        site.headers["Origin"] = "http://localhost:5173"  # the laptop's page, on a server
        refused = await site.post("/api/v1/auth/logout")
        assert (refused.status_code, refused.json()["code"]) == (403, "origin_not_allowed")
        site.headers["Origin"] = ORIGIN
        assert (await site.post("/api/v1/auth/logout")).status_code == 204


# --- Whose word is taken for a client's address (a real uvicorn server) -----------------------


def echo_app() -> FastAPI:
    app = FastAPI()

    @app.get("/who")
    async def who(request: Request) -> dict[str, str | None]:
        return {
            "client": request.client.host if request.client else None,
            "scheme": request.url.scheme,
        }

    return app


@contextlib.asynccontextmanager
async def serving(**config: Any) -> AsyncIterator[str]:
    """The echo app on a real uvicorn server on a free port, with these proxy settings."""

    class Local(uvicorn.Server):
        @contextlib.contextmanager
        def capture_signals(self) -> Generator[None, None, None]:
            yield  # leave Ctrl+C to pytest

    server = Local(
        uvicorn.Config(
            echo_app(),
            host="127.0.0.1",
            port=0,
            log_config=None,
            lifespan="off",
            ws="none",
            **config,
        )
    )
    task = asyncio.create_task(server.serve())
    try:
        for _ in range(500):
            if server.started:
                break
            await asyncio.sleep(0.02)
        else:
            raise RuntimeError("The test server didn't start within 10 seconds")
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        await asyncio.wait({task}, timeout=15)


async def who(base: str, **headers: str) -> dict[str, str]:
    async with httpx.AsyncClient(base_url=base, trust_env=False) as client:
        response = await client.get("/who", headers=headers)
    found: dict[str, str] = response.json()
    return found


async def test_a_trusted_proxy_may_say_who_the_client_is_and_what_it_asked_for() -> None:
    async with serving(proxy_headers=True, forwarded_allow_ips="127.0.0.1/32") as base:
        found = await who(base, **{"X-Forwarded-For": "203.0.113.9", "X-Forwarded-Proto": "https"})
    assert found == {"client": "203.0.113.9", "scheme": "https"}


async def test_the_proxys_own_entry_counts_and_what_the_client_made_up_does_not() -> None:
    """Caddy adds the real address at the end of the list. A client can only write before it."""
    async with serving(proxy_headers=True, forwarded_allow_ips="127.0.0.1/32") as base:
        found = await who(base, **{"X-Forwarded-For": "198.51.100.77, 203.0.113.9"})
    assert found["client"] == "203.0.113.9"


async def test_anyone_else_may_not_say_who_the_client_is() -> None:
    """The proxy is 10.0.0.0/8. This request comes from 127.0.0.1, so its headers are ignored."""
    async with serving(proxy_headers=True, forwarded_allow_ips="10.0.0.0/8") as base:
        found = await who(base, **{"X-Forwarded-For": "203.0.113.9", "X-Forwarded-Proto": "https"})
    assert found == {"client": "127.0.0.1", "scheme": "http"}


async def test_on_this_computer_no_header_is_believed() -> None:
    async with serving(proxy_headers=False) as base:
        found = await who(base, **{"X-Forwarded-For": "203.0.113.9"})
    assert found["client"] == "127.0.0.1"
