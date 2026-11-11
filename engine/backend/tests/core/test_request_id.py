"""PLAN-V15 T1-2: a request id on every answer, error body and log line; one `request_done`
line per request; the event-loop lag warning; and no doubled access log."""

import asyncio
import logging
import re
import time
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from core import cli
from core.api.app import EngineApp
from core.api.errors import Problem, add_error_handlers
from core.api.request_id import ALPHABET, ID_LENGTH, current_request_id, install_log_ids
from core.health.loop_lag import watch_loop_lag

ID_SHAPE = re.compile(rf"[{ALPHABET}]{{{ID_LENGTH}}}")


def extra(record: logging.LogRecord, name: str) -> Any:
    """A field the app added to a log record (`extra=` or the request id)."""
    return record.__dict__[name]


@pytest.fixture
def app() -> FastAPI:
    install_log_ids()
    app = EngineApp()
    add_error_handlers(app)

    @app.get("/ok")
    async def ok() -> dict[str, bool]:
        logging.getLogger("tests.request_id").info("inside_ok")
        return {"ok": True}

    @app.get("/busy")
    async def busy() -> None:
        raise Problem(409, "Busy", "Try later.", code="busy_now")

    @app.get("/crash")
    async def crash() -> None:
        raise RuntimeError("a bug")

    @app.get("/companies/{key}")
    async def company(key: str) -> dict[str, str]:
        return {"key": key}

    return app


async def get(app: FastAPI, path: str, headers: dict[str, str] | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        return await client.get(path, headers=headers)


def done_lines(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.getMessage() == "request_done"]


async def test_every_answer_has_a_short_readable_id(app: FastAPI) -> None:
    first = await get(app, "/ok")
    second = await get(app, "/ok")
    assert ID_SHAPE.fullmatch(first.headers["x-request-id"])
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


async def test_log_lines_during_a_request_carry_its_id(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    response = await get(app, "/ok")
    inside = [record for record in caplog.records if record.getMessage() == "inside_ok"]
    assert [extra(record, "request_id") for record in inside] == [response.headers["x-request-id"]]


async def test_an_error_body_and_its_log_line_share_the_id(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    response = await get(app, "/busy")
    request_id = response.headers["x-request-id"]
    assert response.status_code == 409
    assert response.json()["request_id"] == request_id
    [line] = done_lines(caplog)
    assert extra(line, "request_id") == request_id
    assert [getattr(line, key) for key in ("method", "route", "status")] == ["GET", "/busy", 409]
    assert isinstance(extra(line, "ms"), float)


async def test_a_crash_still_carries_the_id_and_says_it_in_plain_words(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    response = await get(app, "/crash")
    request_id = response.headers["x-request-id"]
    body = response.json()
    assert response.status_code == 500
    assert body["request_id"] == request_id
    assert body["title"] == "Something went wrong on our side"
    assert request_id in body["detail"]
    assert "log" not in body["detail"]
    crash = [record for record in caplog.records if record.getMessage() == "Unexpected error"]
    assert [extra(record, "request_id") for record in crash] == [request_id]
    assert [extra(line, "status") for line in done_lines(caplog)] == [500]


async def test_the_log_line_names_the_route_never_the_real_path(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    await get(app, "/companies/acme-pty-ltd")
    await get(app, "/nowhere")
    routes = [extra(line, "route") for line in done_lines(caplog)]
    assert routes == ["/companies/{key}", "(no route)"]
    assert "acme" not in " ".join(str(record.__dict__) for record in done_lines(caplog))


async def test_a_safe_edge_id_is_logged_but_never_used_as_the_code(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    edge = "3f2a1b4c-0000-4d4d-9e9e-123456789abc"
    response = await get(app, "/ok", headers={"X-Request-ID": edge})
    assert ID_SHAPE.fullmatch(response.headers["x-request-id"])
    await get(app, "/ok", headers={"X-Request-ID": "not safe; drop table"})
    first, second = done_lines(caplog)
    assert extra(first, "edge_request_id") == edge
    assert not hasattr(second, "edge_request_id")


def test_there_is_no_id_outside_a_request() -> None:
    assert current_request_id() is None


async def test_a_blocked_loop_is_logged_as_loop_lag(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    watch = asyncio.create_task(watch_loop_lag(every=0.05, warn_ms=100))
    await asyncio.sleep(0.07)
    time.sleep(0.3)  # noqa: ASYNC251 - blocks the loop on purpose, like heavy work would
    await asyncio.sleep(0.12)
    watch.cancel()
    with pytest.raises(asyncio.CancelledError):
        await watch
    lags = [record for record in caplog.records if record.getMessage() == "loop_lag"]
    assert lags
    assert max(extra(record, "lag_ms") for record in lags) >= 150


async def test_a_quiet_loop_logs_nothing(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    watch = asyncio.create_task(watch_loop_lag(every=0.02, warn_ms=200))
    await asyncio.sleep(0.15)
    watch.cancel()
    with pytest.raises(asyncio.CancelledError):
        await watch
    assert not [record for record in caplog.records if record.getMessage() == "loop_lag"]


def test_serve_turns_off_uvicorns_own_access_log(monkeypatch: pytest.MonkeyPatch) -> None:
    import uvicorn

    seen: dict[str, Any] = {}

    class FakeServer:
        def __init__(self, config: object) -> None:
            pass

        async def serve(self) -> None:
            return None

    def fake_config(*args: Any, **kwargs: Any) -> object:
        seen.update(kwargs)
        return object()

    monkeypatch.setattr(uvicorn, "Config", fake_config)
    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    monkeypatch.setattr(cli, "migrate", lambda: 0)
    assert cli.serve() == 0
    assert seen["access_log"] is False
