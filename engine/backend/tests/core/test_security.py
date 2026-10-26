"""The HTTP layer's defences: host check, origin guard and security headers."""

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI, Response, UploadFile

from core.api.errors import add_error_handlers
from core.api.security import SECURITY_HEADERS, add_security_layers, allowed_origins
from core.config import Settings

HEADERS = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
}
SWAGGER = "http://127.0.0.1:8000"
VITE = "http://localhost:5173"


def make_app(settings: Settings | None = None, *, handlers: bool = True) -> FastAPI:
    """A tiny app. `calls` records every time a route ran, to prove a refused request didn't."""
    app = FastAPI()
    calls: list[str] = []
    app.state.calls = calls
    if handlers:
        add_error_handlers(app)
    add_security_layers(app, settings or Settings.model_validate({}))

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
    app = make_app(Settings.model_validate({"api_port": 9000, "cors_origins": []}))
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
    allowed = allowed_origins(Settings.model_validate({}))
    assert allowed == {VITE, "http://127.0.0.1:5173", SWAGGER, "http://localhost:8000"}


# --- The host check ------------------------------------------------------------------------


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8000", "localhost.evil.example"])
async def test_a_foreign_host_name_is_refused(client: httpx.AsyncClient, host: str) -> None:
    """DNS rebinding: a web page points its own name at this computer."""
    response = await client.get("/ping", headers={"Host": host})
    assert response.status_code == 400
    assert has_security_headers(response)
    post = await client.post("/act", headers={"Host": host})
    assert post.status_code == 400


@pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1", "127.0.0.1:5173"])
async def test_this_computer_is_accepted_as_the_host(client: httpx.AsyncClient, host: str) -> None:
    assert (await client.get("/ping", headers={"Host": host})).status_code == 200


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
    add_security_layers(app, Settings.model_validate({}))
    async with client_for(app) as client:
        response = await client.get("/ping")
        assert response.headers.get_list("x-content-type-options") == ["nosniff"]
        assert (await client.post("/act", headers={"Origin": VITE})).status_code == 200
