"""The HTTP layer's defences: host check, origin guard and security headers.

The tests are hermetic: the settings come from the defaults only, with no engine/.env file
and no settings in the environment (see `clean_environment`).
"""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import Message

from core.api.errors import PROBLEM_JSON, add_error_handlers
from core.api.security import (
    SECURITY_HEADERS,
    TRUSTED_HOSTS,
    HostGuard,
    ProblemCORSMiddleware,
    add_security_layers,
    allowed_origins,
)
from core.config import API_HOSTS, Settings, get_settings

HEADERS = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
}
SWAGGER = "http://127.0.0.1:8000"
VITE = "http://localhost:5173"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """The test setup puts a few settings in the environment. Take them out of these tests."""
    for key in Settings.model_fields:
        monkeypatch.delenv(key.upper(), raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()  # so no later test sees values read inside this one


def make_settings(**values: Any) -> Settings:
    """Settings from these values and the defaults only: no .env file, no environment."""
    return Settings(_env_file=None, **values)


def make_app(settings: Settings | None = None, *, handlers: bool = True) -> FastAPI:
    """A tiny app. `calls` records every time a route ran, to prove a refused request didn't."""
    app = FastAPI()
    calls: list[str] = []
    app.state.calls = calls
    if handlers:
        add_error_handlers(app)
    add_security_layers(app, settings or make_settings())

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"ok": "yes"}

    @app.post("/act")
    async def act() -> dict[str, str]:
        calls.append("act")
        return {"ok": "yes"}

    @app.put("/act")
    @app.patch("/act")
    @app.delete("/act")
    async def change() -> dict[str, str]:
        calls.append("change")
        return {"ok": "yes"}

    @app.post("/upload")
    async def upload(file: UploadFile) -> dict[str, str | None]:
        calls.append("upload")
        return {"name": file.filename}

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("the password is hunter2")

    return app


def client_for(app: FastAPI) -> httpx.AsyncClient:
    # raise_app_exceptions=False: a crash answers 500, as a real server does, instead of
    # raising inside the test.
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://localhost")


@pytest.fixture
async def app() -> FastAPI:
    return make_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with client_for(app) as test_client:
        yield test_client


def has_security_headers(response: httpx.Response) -> bool:
    return all(response.headers.get(name) == value for name, value in HEADERS.items())


def test_the_header_list_is_the_three_in_the_design() -> None:
    assert {k.lower(): v for k, v in SECURITY_HEADERS.items()} == HEADERS


# --- The origin guard ----------------------------------------------------------------------


async def test_a_foreign_origin_cannot_post_even_with_no_body(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    response = await client.post("/act", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert (body["title"], body["status"], body["code"]) == (
        "Request blocked",
        403,
        "origin_not_allowed",
    )
    assert "evil.example" not in response.text
    assert app.state.calls == []  # the route never ran


async def test_a_foreign_origin_cannot_send_a_form_upload(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    response = await client.post(
        "/upload",
        files={"file": ("export.xlsx", b"data", "application/octet-stream")},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert app.state.calls == []


async def test_the_same_upload_without_an_origin_works(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    response = await client.post(
        "/upload", files={"file": ("export.xlsx", b"data", "application/octet-stream")}
    )
    assert response.status_code == 200
    assert response.json() == {"name": "export.xlsx"}


async def test_origin_null_is_refused(client: httpx.AsyncClient, app: FastAPI) -> None:
    """A sandboxed page or a cross-site redirect sends Origin: null."""
    response = await client.post("/act", headers={"Origin": "null"})
    assert response.status_code == 403
    assert app.state.calls == []


@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE"])
async def test_every_changing_method_is_guarded(
    client: httpx.AsyncClient, app: FastAPI, method: str
) -> None:
    response = await client.request(method, "/act", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert app.state.calls == []
    assert (await client.request(method, "/act", headers={"Origin": VITE})).status_code == 200


@pytest.mark.parametrize(
    "origin", [SWAGGER, "http://localhost:8000", VITE, "http://127.0.0.1:5173"]
)
async def test_our_own_pages_may_post(client: httpx.AsyncClient, origin: str) -> None:
    """Swagger runs on the API's own address. The website runs on the Vite address."""
    response = await client.post("/act", headers={"Origin": origin})
    assert response.status_code == 200


async def test_a_post_with_no_origin_is_allowed(client: httpx.AsyncClient) -> None:
    """curl, the command line and tests send no Origin."""
    assert (await client.post("/act")).status_code == 200


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5174",  # the wrong port
        "https://localhost:5173",  # the wrong scheme
        "http://localhost",  # no port
        "http://localhost:5173.evil.example",
        "http://evil.example:5173",
        "http://127.0.0.1:8001",
        "",
    ],
)
async def test_a_near_miss_is_refused(client: httpx.AsyncClient, origin: str) -> None:
    response = await client.post("/act", headers={"Origin": origin})
    assert response.status_code == 403


async def test_origin_is_compared_without_regard_to_case(client: httpx.AsyncClient) -> None:
    assert (
        await client.post("/act", headers={"Origin": "HTTP://LOCALHOST:5173"})
    ).status_code == 200


async def test_two_origin_headers_are_refused(client: httpx.AsyncClient) -> None:
    response = await client.post("/act", headers=[("Origin", VITE), ("Origin", VITE)])
    assert response.status_code == 403


async def test_reading_is_not_blocked_by_the_origin_guard(client: httpx.AsyncClient) -> None:
    """Browsers keep other sites from reading the answer (CORS). The guard is for changes."""
    assert (
        await client.get("/ping", headers={"Origin": "https://evil.example"})
    ).status_code == 200


async def test_the_api_port_comes_from_settings() -> None:
    app = make_app(make_settings(api_port=9000, cors_origins=[]))
    async with client_for(app) as client:
        assert (
            await client.post("/act", headers={"Origin": "http://127.0.0.1:9000"})
        ).status_code == 200
        assert (
            await client.post("/act", headers={"Origin": "http://localhost:9000"})
        ).status_code == 200
        assert (await client.post("/act", headers={"Origin": SWAGGER})).status_code == 403
        assert (await client.post("/act", headers={"Origin": VITE})).status_code == 403


def test_the_allowed_origins() -> None:
    allowed = allowed_origins(make_settings())
    assert allowed == {VITE, "http://127.0.0.1:5173", SWAGGER, "http://localhost:8000"}


# --- The host check ------------------------------------------------------------------------


FOREIGN_HOSTS = [
    "evil.example",
    "evil.example:8000",
    "localhost.evil.example",
    "localhost.",  # a closing dot is another name
    "127.0.0.1.evil.example",
    "[::1]:8000",  # not one of the two the engine answers to
    "localhost evil.example",
    "localhost/x",
    "",
]


def assert_host_refused(response: httpx.Response) -> None:
    """A 400 in the engine's own error shape, with the security headers, and no echo of the host."""
    assert response.status_code == 400
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    body = response.json()
    assert body["type"] == "about:blank"
    assert (body["title"], body["status"], body["code"]) == (
        "Request blocked",
        400,
        "host_not_allowed",
    )
    assert body["detail"] == "The engine only answers to localhost or 127.0.0.1."
    assert has_security_headers(response)
    assert "evil" not in response.text


@pytest.mark.parametrize("host", FOREIGN_HOSTS)
async def test_a_foreign_host_name_is_refused(
    client: httpx.AsyncClient, app: FastAPI, host: str
) -> None:
    """DNS rebinding: a web page points its own name at this computer."""
    assert_host_refused(await client.get("/ping", headers={"Host": host}))
    assert_host_refused(await client.post("/act", headers={"Host": host}))
    assert app.state.calls == []  # no route ran


async def test_two_host_headers_are_refused(client: httpx.AsyncClient) -> None:
    response = await client.get("/ping", headers=[("Host", "localhost"), ("Host", "evil.example")])
    assert_host_refused(response)


async def call_asgi(app: FastAPI, scope: dict[str, Any]) -> list[dict[str, Any]]:
    """Calls the app once, by hand, and returns the messages it sent."""
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    await app(scope, receive, send)  # type: ignore[arg-type]
    return sent


async def test_a_missing_host_header_is_refused(app: FastAPI) -> None:
    """HTTP/1.0 and hand-made requests can leave it out."""
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.0",
        "method": "GET",
        "path": "/ping",
        "raw_path": b"/ping",
        "query_string": b"",
        "headers": [],
        "scheme": "http",
        "server": ("localhost", 8000),
        "client": ("127.0.0.1", 50000),
    }
    sent = await call_asgi(app, scope)
    assert sent[0]["status"] == 400
    assert (b"content-type", b"application/problem+json") in sent[0]["headers"]
    assert b'"host_not_allowed"' in sent[1]["body"]


async def test_a_refused_host_gets_the_same_answer_with_no_error_handlers() -> None:
    """The refusal is built by the guard itself, so it doesn't depend on the app's handlers."""
    async with client_for(make_app(handlers=False)) as client:
        assert_host_refused(await client.get("/ping", headers={"Host": "evil.example"}))


async def test_a_websocket_to_a_foreign_host_is_refused_before_it_opens() -> None:
    sent: list[Message] = []
    reached: list[bool] = []

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        reached.append(True)

    async def receive() -> Message:
        return {"type": "websocket.connect"}

    async def send(message: Message) -> None:
        sent.append(message)

    guard = HostGuard(inner, allowed_hosts=["localhost", "127.0.0.1"])
    foreign = {"type": "websocket", "path": "/ws", "headers": [(b"host", b"evil.example")]}
    await guard(foreign, receive, send)
    assert sent == [{"type": "websocket.close", "code": 1008}]
    assert reached == []
    own = {"type": "websocket", "path": "/ws", "headers": [(b"host", b"localhost:1")]}
    await guard(own, receive, send)
    assert reached == [True]


async def test_the_lifespan_passes_through_the_host_check() -> None:
    reached: list[str] = []

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        reached.append(scope["type"])

    guard = HostGuard(inner, allowed_hosts=["localhost"])
    await guard({"type": "lifespan"}, None, None)  # type: ignore[arg-type]
    assert reached == ["lifespan"]


# --- A CORS preflight meets the host check first -----------------------------------------------

PREFLIGHT = {
    "Origin": "https://evil.example",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
}


def app_with_cors(*, cors_first: bool) -> FastAPI:
    """The security layers and a CORS layer, added in either order."""
    app = FastAPI()
    add_error_handlers(app)

    def add_cors() -> None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[VITE],
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )

    if cors_first:
        add_cors()
    add_security_layers(app, make_settings())
    if not cors_first:
        add_cors()  # added after, so it would be the outermost layer without the wrapping

    @app.post("/act")
    async def act() -> dict[str, str]:
        return {"ok": "yes"}

    return app


@pytest.mark.parametrize("cors_first", [True, False])
async def test_a_preflight_from_a_foreign_origin_to_a_foreign_host_gets_the_problem_answer(
    cors_first: bool,
) -> None:
    """The page at evil.example, pointed at this computer, asks permission first. The host check
    answers before the CORS layer can, in the engine's own error shape."""
    async with client_for(app_with_cors(cors_first=cors_first)) as client:
        response = await client.options("/act", headers={**PREFLIGHT, "Host": "evil.example"})
    assert_host_refused(response)
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("cors_first", [True, False])
async def test_a_normal_preflight_still_reaches_the_cors_layer(cors_first: bool) -> None:
    async with client_for(app_with_cors(cors_first=cors_first)) as client:
        response = await client.options(
            "/act", headers={**PREFLIGHT, "Origin": VITE, "Host": "localhost:8000"}
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == VITE


@pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1", "127.0.0.1:5173"])
async def test_this_computer_is_accepted_as_the_host(client: httpx.AsyncClient, host: str) -> None:
    assert (await client.get("/ping", headers={"Host": host})).status_code == 200


def test_the_trusted_hosts_are_the_api_hosts_of_the_settings_from_one_list() -> None:
    """`api_host` may be one of these two, and the host check accepts exactly these two."""
    assert TRUSTED_HOSTS == list(API_HOSTS) == ["localhost", "127.0.0.1"]
    assert isinstance(TRUSTED_HOSTS, list)
    assert tuple(TRUSTED_HOSTS) == API_HOSTS  # a list of its own, with the same names


@pytest.mark.parametrize("host", API_HOSTS)
async def test_every_api_host_the_settings_accept_is_a_host_the_check_accepts(host: str) -> None:
    configured = make_settings(api_host=host).api_host
    async with client_for(make_app()) as client:
        response = await client.get("/ping", headers={"Host": f"{configured}:8000"})
    assert response.status_code == 200


# --- The CORS layer answers a refused preflight in the engine's own shape ----------------------


def make_cors_app(
    cors: type[CORSMiddleware] = ProblemCORSMiddleware,
    *,
    methods: tuple[str, ...] = ("GET", "POST"),
) -> FastAPI:
    """The security layers and a CORS layer of this class, as `create_app` sets them up."""
    app = FastAPI()
    add_error_handlers(app)
    app.add_middleware(
        cors,
        allow_origins=[VITE],
        allow_methods=list(methods),
        allow_headers=["*"],
    )
    add_security_layers(app, make_settings())

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"ok": "yes"}

    @app.post("/act")
    async def act() -> dict[str, str]:
        return {"ok": "yes"}

    return app


async def preflight(app: FastAPI, **headers: str) -> httpx.Response:
    async with client_for(app) as client:
        return await client.options(
            "/act", headers={**PREFLIGHT, "Host": "localhost:8000", **headers}
        )


async def test_a_preflight_from_a_foreign_origin_to_a_valid_host_gets_the_problem_answer() -> None:
    response = await preflight(make_cors_app())
    assert response.status_code == 400
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    assert response.json() == {
        "type": "about:blank",
        "title": "Request blocked",
        "status": 400,
        "detail": "This request came from a web page the engine doesn't trust.",
        "code": "origin_not_allowed",
    }
    assert "evil.example" not in response.text  # the answer never repeats the origin
    assert "access-control-allow-origin" not in response.headers
    assert "Origin" in response.headers["vary"]  # a cache must not reuse it for another origin
    assert has_security_headers(response)


async def test_an_allowed_origins_preflight_is_the_same_as_with_starlettes_own_layer() -> None:
    mine = await preflight(make_cors_app(), Origin=VITE)
    theirs = await preflight(make_cors_app(CORSMiddleware), Origin=VITE)
    assert mine.status_code == theirs.status_code == 200
    assert mine.headers["content-type"] == theirs.headers["content-type"]
    assert mine.text == theirs.text == "OK"
    assert mine.headers["access-control-allow-origin"] == VITE
    assert dict(mine.headers) == dict(theirs.headers)


async def test_a_method_that_is_not_allowed_is_refused_in_the_problem_shape_with_its_own_code() -> (
    None
):
    """The origin is fine here, so the answer must not say the origin is the problem."""
    response = await preflight(
        make_cors_app(methods=("GET",)), Origin=VITE, **{"Access-Control-Request-Method": "DELETE"}
    )
    assert response.status_code == 400
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    assert response.json()["code"] == "cors_not_allowed"
    assert response.json()["status"] == 400
    assert "DELETE" not in response.text


async def test_a_foreign_host_is_still_refused_by_the_host_check_before_the_cors_layer() -> None:
    response = await preflight(make_cors_app(), Host="evil.example")
    assert_host_refused(response)


async def test_other_requests_are_not_changed_by_the_problem_cors_layer() -> None:
    """A normal request from our own page still gets the allow-origin header. A read from a
    foreign page is answered (the browser keeps the page from reading it) without one."""
    async with client_for(make_cors_app()) as client:
        ours = await client.get("/ping", headers={"Origin": VITE})
        foreign = await client.get("/ping", headers={"Origin": "https://evil.example"})
        no_origin = await client.get("/ping")
    assert ours.status_code == foreign.status_code == no_origin.status_code == 200
    assert ours.headers["access-control-allow-origin"] == VITE
    assert "access-control-allow-origin" not in foreign.headers
    assert "access-control-allow-origin" not in no_origin.headers


async def test_the_real_app_uses_the_problem_cors_layer(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.api.app import create_app

    monkeypatch.setattr("core.api.app.setup_logging", lambda: None)  # leave the log handlers alone
    app = create_app()
    layers: list[Any] = [layer.cls for layer in app.user_middleware]
    assert ProblemCORSMiddleware in layers
    assert CORSMiddleware not in layers  # the plain class is not used anywhere
    async with client_for(app) as client:
        refused = await client.options(
            "/api/v1/runs", headers={**PREFLIGHT, "Host": "127.0.0.1:8000"}
        )
        allowed = await client.options(
            "/api/v1/runs", headers={**PREFLIGHT, "Origin": VITE, "Host": "127.0.0.1:8000"}
        )
    assert refused.status_code == 400
    assert refused.headers["content-type"].startswith(PROBLEM_JSON)
    assert refused.json()["code"] == "origin_not_allowed"
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == VITE


# --- Security headers ----------------------------------------------------------------------


async def test_headers_are_on_a_normal_answer(client: httpx.AsyncClient) -> None:
    response = await client.get("/ping")
    assert response.status_code == 200
    assert has_security_headers(response)


async def test_headers_are_on_every_kind_of_error(client: httpx.AsyncClient) -> None:
    refused = await client.post("/act", headers={"Origin": "https://evil.example"})
    not_found = await client.get("/nothing-here")
    wrong_method = await client.put("/ping")
    invalid = await client.post("/upload")  # a missing form field
    for response, status in ((refused, 403), (not_found, 404), (wrong_method, 405), (invalid, 422)):
        assert response.status_code == status
        assert has_security_headers(response), status


async def test_headers_are_on_an_unexpected_error_too(client: httpx.AsyncClient) -> None:
    response = await client.get("/boom")
    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/problem+json")
    assert has_security_headers(response)
    assert "hunter2" not in response.text  # the answer never repeats the error's text


async def test_headers_are_on_an_unexpected_error_even_with_no_error_handlers() -> None:
    """Starlette's own 500 answer sits outside the middleware. The headers still reach it."""
    app = make_app(handlers=False)
    async with client_for(app) as client:
        response = await client.get("/boom")
    assert response.status_code == 500
    assert has_security_headers(response)


async def test_the_headers_replace_a_weaker_value_set_by_a_route() -> None:
    app = make_app()

    @app.get("/weak")
    async def weak(response: Response) -> dict[str, str]:
        response.headers["Cache-Control"] = "public, max-age=3600"
        return {"ok": "yes"}

    async with client_for(app) as client:
        response = await client.get("/weak")
    assert response.headers.get_list("cache-control") == ["no-store"]


async def test_adding_the_layers_twice_changes_nothing() -> None:
    app = make_app()
    add_security_layers(app, make_settings())
    async with client_for(app) as client:
        response = await client.get("/ping")
        assert response.headers.get_list("x-content-type-options") == ["nosniff"]
        assert (await client.post("/act", headers={"Origin": VITE})).status_code == 200
