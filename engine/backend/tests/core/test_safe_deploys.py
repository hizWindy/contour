"""PLAN-V15 T1-6: safe deploys and limits. Every 503 says when to try again, a busy pool is a 503
`busy`, connections have time limits, error texts are plain, a lost one-backend lock stops the
run engine, and each project hears when the backend stops."""

import ast
import asyncio
import re
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.exc import TimeoutError as PoolTimeout

from core.api.app import stop_apps
from core.api.errors import Problem, add_error_handlers, problem
from core.config import Settings
from core.db.engine import connection_limits
from core.runs import lifecycle
from core.runs.lifecycle import BackendLock

BACKEND = Path(__file__).resolve().parents[2]


async def get(app: FastAPI, path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        return await client.get(path)


def test_every_503_says_when_to_try_again() -> None:
    assert problem(503, "Not ready").headers["retry-after"] == "10"
    own = problem(503, "Restarting", headers={"Retry-After": "30"})
    assert own.headers["retry-after"] == "30"
    assert "retry-after" not in problem(409, "Busy").headers


async def test_a_pool_that_stays_busy_is_a_503_busy_not_a_500() -> None:
    app = FastAPI()
    add_error_handlers(app)

    @app.get("/page")
    async def page() -> None:
        raise PoolTimeout("QueuePool limit of size 4 overflow 0 reached")

    @app.get("/planned")
    async def planned() -> None:
        raise Problem(503, "Runs are restarting", code="runs_not_ready")

    busy = await get(app, "/page")
    assert (busy.status_code, busy.json()["code"]) == (503, "busy")
    assert busy.headers["retry-after"] == "5"
    assert busy.json()["title"] == "Contour is busy"
    assert "QueuePool" not in busy.text
    assert (await get(app, "/planned")).headers["retry-after"] == "10"


def test_the_connections_start_with_time_limits() -> None:
    limits = connection_limits(Settings())
    assert "-c statement_timeout=30000" in limits
    assert "-c lock_timeout=10000" in limits
    assert "-c idle_in_transaction_session_timeout=600000" in limits


@pytest.mark.integration
async def test_a_real_connection_has_the_limits() -> None:
    """Postgres takes the limits at connect time (the test database, made like `get_engine`)."""
    from sqlalchemy.ext.asyncio import create_async_engine

    from core.config import CONNECT_TIMEOUT_SECONDS, get_settings

    settings = get_settings()
    engine = create_async_engine(
        settings.database_url(),
        connect_args={
            "connect_timeout": CONNECT_TIMEOUT_SECONDS,
            "options": connection_limits(settings),
        },
    )
    try:
        async with engine.connect() as connection:
            assert await connection.scalar(text("SHOW statement_timeout")) == "30s"
            assert await connection.scalar(text("SHOW lock_timeout")) == "10s"
            assert (
                await connection.scalar(text("SHOW idle_in_transaction_session_timeout")) == "10min"
            )
    finally:
        await engine.dispose()


# --- Plain words: no command, file name, local address or setting name on screen -------------

FORBIDDEN = re.compile(
    r"engine/\.env|\.env\b|uv run|docker|localhost|127\.0\.0\.1"
    r"|\b(?:ANTHROPIC|HUBSPOT|SIGNALHIRE|EMAIL|DAILY|DB|POSTGRES)_[A-Z_]+\b"
)
# What raises or builds an error a person can see.
ERROR_MAKERS = {
    "Problem",
    "problem",
    "ClaudeError",
    "ClaudeUnavailable",
    "EmailNotSetUp",
    "HubSpotError",
    "HubSpotUnavailable",
    "SignalHireUnavailable",
}
# Developer-only text: the command line and the settings checks at start-up.
NOT_SHOWN = {"core/cli.py", "core/config.py", "apps/lead_finder/cli.py"}
# Left on purpose, each for its reason:
# - the host check answers only on the laptop (a server checks its own public address);
# - the Settings page's texts (Admins only) are mirrored in the website's own checks, which are
#   Track 2's files: changed together at the merge (PLAN-V15 M1).
LEFT = {
    ("core/api/security.py", "The engine only answers to localhost or 127.0.0.1."),
    (
        "core/prefs/service.py",
        "No setting a person can change has this name. Settings that come from engine/.env "
        "can't be reset here.",
    ),
}
NAMED_TEXTS = ("TITLE", "DETAIL", "DOWN", "FAILED", "ERROR", "MISSING", "INTERRUPTED")


def _texts(node: ast.AST) -> list[str]:
    return [
        part.value
        for part in ast.walk(node)
        if isinstance(part, ast.Constant) and isinstance(part.value, str)
    ]


def _caller(call: ast.Call) -> str:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def shown_texts() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for path in [*BACKEND.glob("core/**/*.py"), *BACKEND.glob("apps/lead_finder/**/*.py")]:
        name = path.relative_to(BACKEND).as_posix()
        if name in NOT_SHOWN:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _caller(node) in ERROR_MAKERS:
                found += [(name, value) for value in _texts(node)]
            elif isinstance(node, ast.Assign):
                targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
                if any(t.isupper() and t.endswith(NAMED_TEXTS) for t in targets):
                    found += [(name, value) for value in _texts(node.value)]
    return found


def test_no_error_a_person_sees_names_a_command_a_file_or_a_setting() -> None:
    texts = shown_texts()
    assert len(texts) > 100  # the scan really reads the errors
    bad = [(name, value) for name, value in texts if FORBIDDEN.search(value)]
    assert set(bad) <= LEFT


# --- The one-backend lock ----------------------------------------------------------------------


class FakeManager:
    def __init__(self, alive: bool) -> None:
        self.alive = alive
        self.stopped = False

    async def lock_alive(self) -> bool:
        return self.alive

    async def shutdown(self) -> None:
        self.stopped = True


async def test_a_lost_lock_stops_the_run_engine_and_the_scheduler_and_waits_to_take_it_back(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    app = FastAPI()
    calls: list[str] = []

    async def stop(received: FastAPI) -> None:
        calls.append("scheduler stopped")

    async def restart(received: FastAPI) -> None:
        calls.append("restarted")

    def take_over_later(received: FastAPI, then: Any, **kwargs: Any) -> None:
        calls.append(f"taking over, then {then.__name__}")

    monkeypatch.setattr(lifecycle, "take_over_later", take_over_later)
    lifecycle.when_engine_is_lost(app, stop=stop, restart=restart)
    manager: Any = FakeManager(alive=True)
    app.state.run_manager = manager
    lifecycle.watch_lock(app, manager, every=0.01)
    await asyncio.sleep(0.05)
    assert app.state.run_manager is manager and calls == []  # it still holds the lock

    manager.alive = False  # the database restarted: the lock's connection is gone
    await asyncio.sleep(0.05)
    assert not hasattr(app.state, "run_manager")  # runs answer 503 meanwhile
    assert manager.stopped
    assert calls == ["scheduler stopped", "taking over, then restart"]
    assert lifecycle.engine_state(app).mode == "waiting"
    assert "run_engine_lost" in caplog.text
    await lifecycle.shutdown(app)  # nothing left to stop, and no error


async def test_a_manager_that_cant_say_never_gets_a_watch() -> None:
    app = FastAPI()
    manager: Any = FakeManager(alive=False)
    manager.lock_alive = None
    lifecycle.watch_lock(app, manager, every=0.01)
    assert not hasattr(app.state, "run_engine_watch")


@pytest.mark.integration
async def test_the_real_lock_says_whether_it_is_still_held() -> None:
    lock = BackendLock()
    assert not await lock.still_held()  # not taken yet
    assert await lock.acquire()
    try:
        assert await lock.still_held()
        assert lock._connection is not None
        await lock._connection.close()  # as when the database drops the connection
        assert not await lock.still_held()
    finally:
        await lock.release()


# --- Each project hears when the backend stops -------------------------------------------------


async def test_each_project_is_told_when_the_backend_stops_and_one_failure_stops_none() -> None:
    from dataclasses import replace

    from core.apps import load_apps

    told: list[str] = []

    async def broken(app: FastAPI) -> None:
        raise RuntimeError("it broke")

    async def fine(app: FastAPI) -> None:
        told.append("companies")

    specs = load_apps(Settings().apps)
    app = FastAPI()
    app.state.apps = [
        replace(spec, on_shutdown=broken if index == 0 else fine)
        for index, spec in enumerate(specs)
    ]
    await stop_apps(app)
    assert told == ["companies"] * (len(specs) - 1)
