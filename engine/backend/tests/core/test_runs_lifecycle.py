"""Start-up and shut-down of the run engine: the one-backend lock, recovery at start, a database
that is down, stopping runs at shut-down, and the checkpoint pool.

Integration: they use the test database (the lock and the pool are real).
"""

import asyncio
import logging
import uuid
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import psycopg
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.config import get_settings
from core.runs import lifecycle
from core.runs.checkpoint import CheckpointStoreError, PoolCheckpointer
from core.runs.lifecycle import ANOTHER_BACKEND, WAITING_FOR_LOCK, BackendLock
from core.runs.manager import BACKEND_STOPPED, RunManager, kinds_from_specs
from core.runs.models import Run
from core.runs.schemas import RunCounts
from core.runs.types import make_caps
from tests.core.conftest import MakeManager, MemorySource
from tests.core.runs_fakes import APP, FakeState, run_row, small_settings

pytestmark = pytest.mark.integration
D = Decimal


def unreachable_settings() -> Any:
    """The test settings, but pointing at a port where no database listens."""
    return get_settings().model_copy(update={"postgres_port": 1})


async def insert_run(factory: async_sessionmaker[AsyncSession], status: str) -> uuid.UUID:
    run_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            Run(
                id=run_id,
                app=APP,
                mode="work",
                status=status,
                params={},
                caps=make_caps(small_settings()).model_dump(mode="json"),
                rules_version="",
                prompt_versions="",
                counts=RunCounts().model_dump(mode="json"),
            )
        )
        await session.commit()
    return run_id


@pytest.fixture
async def other_backend() -> Any:
    """The lock as another backend process would hold it. Let go at the end of the test."""
    lock = BackendLock()
    yield lock
    await lock.release()


# --- The one-backend lock -------------------------------------------------------------------------


async def test_only_one_backend_holds_the_lock_at_a_time(other_backend: BackendLock) -> None:
    mine = BackendLock()
    assert await mine.acquire()
    assert mine.held
    assert await mine.acquire()  # already held: still True
    assert not await other_backend.acquire()
    assert not other_backend.held

    await mine.release()
    await mine.release()  # twice is fine
    assert not mine.held
    assert await other_backend.acquire()


async def test_a_lock_on_a_database_that_is_down_raises_a_connection_error() -> None:
    with pytest.raises(psycopg.OperationalError):
        await BackendLock(unreachable_settings()).acquire()


# --- Start-up -------------------------------------------------------------------------------------


def build_with(make_manager: MakeManager, lock: BackendLock) -> Any:
    def build(app: FastAPI) -> RunManager:
        return make_manager(acquire_lock=lock.acquire, release_lock=lock.release)

    return build


async def test_start_up_recovers_runs_and_shut_down_lets_the_lock_go(
    make_manager: MakeManager,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    other_backend: BackendLock,
) -> None:
    left_running = await insert_run(session_factory, "running")
    finished = await insert_run(session_factory, "done")
    monkeypatch.setattr(lifecycle, "build", build_with(make_manager, BackendLock()))
    app = FastAPI()

    await lifecycle.startup(app)

    manager = app.state.run_manager
    assert isinstance(manager, RunManager)
    row = await run_row(session_factory, left_running)
    assert (row.status, row.stop_reason) == ("interrupted", BACKEND_STOPPED)
    assert (await run_row(session_factory, finished)).status == "done"
    assert not await other_backend.acquire()  # this backend holds it

    await lifecycle.shutdown(app)
    assert not hasattr(app.state, "run_manager")
    assert await other_backend.acquire()  # let go
    await lifecycle.shutdown(app)  # twice is fine


async def test_a_second_backend_refuses_to_start(
    make_manager: MakeManager,
    monkeypatch: pytest.MonkeyPatch,
    other_backend: BackendLock,
) -> None:
    """On this computer: the message says to stop the other one."""
    assert await other_backend.acquire()
    monkeypatch.setattr(lifecycle, "build", build_with(make_manager, BackendLock()))
    app = FastAPI()
    with pytest.raises(RuntimeError, match="Another backend is already running"):
        await lifecycle.startup(app)
    assert not hasattr(app.state, "run_manager")
    assert ANOTHER_BACKEND.startswith("Another backend is already running")


# --- In server mode a second backend waits, then takes over (PLAN-V8 B3) --------------------------


@pytest.fixture
def server_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """The test settings in server mode, as the lifecycle reads them (same database)."""
    server = get_settings().model_copy(update={"server_mode": True})
    monkeypatch.setattr(lifecycle, "get_settings", lambda: server)


async def wait_until(condition: Callable[[], bool], seconds: float = 5.0) -> None:
    for _ in range(int(seconds / 0.05)):
        if condition():
            return
        await asyncio.sleep(0.05)
    pytest.fail("waited too long")


async def test_in_server_mode_a_second_backend_waits_then_takes_over_when_the_first_stops(
    make_manager: MakeManager,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    other_backend: BackendLock,
    server_mode: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A deploy on App Platform starts the new backend while the old one still runs, and stops the
    old one only once the new one is up."""
    assert await other_backend.acquire()  # the old backend
    monkeypatch.setattr(lifecycle, "build", build_with(make_manager, BackendLock()))
    app = FastAPI()
    started: list[FastAPI] = []

    async def background_work(received: FastAPI) -> None:
        started.append(received)

    with caplog.at_level(logging.WARNING, logger="core.runs.lifecycle"):
        await lifecycle.startup(app)  # does not refuse
    assert WAITING_FOR_LOCK in caplog.text
    assert lifecycle.waiting(app)
    assert not hasattr(app.state, "run_manager")  # the run routes answer 503 meanwhile

    lifecycle.take_over_later(app, background_work, every=0.05)
    await asyncio.sleep(0.3)
    assert not hasattr(app.state, "run_manager")  # the old one still holds the lock
    assert started == []

    cut_off = await insert_run(session_factory, "running")  # left going by the old one
    await other_backend.release()  # the old backend stops
    await wait_until(lambda: started == [app])

    assert isinstance(app.state.run_manager, RunManager)
    assert not lifecycle.waiting(app)
    row = await run_row(session_factory, cut_off)
    assert (row.status, row.stop_reason) == ("interrupted", BACKEND_STOPPED)
    assert not await other_backend.acquire()  # this backend holds it now

    await lifecycle.stop_waiting(app)  # the wait is over: nothing to stop
    await lifecycle.shutdown(app)
    assert await other_backend.acquire()  # let go at the end, as before


async def test_a_backend_still_waiting_when_the_app_stops_stops_trying(
    make_manager: MakeManager,
    monkeypatch: pytest.MonkeyPatch,
    other_backend: BackendLock,
    server_mode: None,
) -> None:
    assert await other_backend.acquire()
    monkeypatch.setattr(lifecycle, "build", build_with(make_manager, BackendLock()))
    app = FastAPI()

    async def never(received: FastAPI) -> None:
        pytest.fail("a backend that stopped must not take over")

    await lifecycle.startup(app)
    lifecycle.take_over_later(app, never, every=0.05)
    await asyncio.sleep(0.2)

    await lifecycle.stop_waiting(app)
    await lifecycle.stop_waiting(app)  # twice is fine
    await lifecycle.shutdown(app)
    assert not hasattr(app.state, "run_engine_waiter")

    await other_backend.release()
    await asyncio.sleep(0.2)
    assert not hasattr(app.state, "run_manager")  # it stopped trying
    assert await other_backend.acquire()  # and holds nothing


async def test_a_database_that_is_down_turns_runs_off_without_stopping_the_app(
    make_manager: MakeManager,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    down = BackendLock(unreachable_settings())
    monkeypatch.setattr(lifecycle, "build", build_with(make_manager, down))
    app = FastAPI()
    with caplog.at_level(logging.ERROR, logger="core.runs.lifecycle"):
        await lifecycle.startup(app)
    assert not hasattr(app.state, "run_manager")
    (record,) = [r for r in caplog.records if r.name == "core.runs.lifecycle"]
    assert "runs are turned off" in record.getMessage()
    # Refused, or (on Windows) timed out: both are connection errors, named by type only.
    assert record.reason in ("OperationalError", "ConnectionTimeout")  # type: ignore[attr-defined]
    password = get_settings().postgres_password.get_secret_value()
    assert (password in caplog.text) is False


async def test_build_wires_the_real_parts(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    app = create_app()
    source = MemorySource()
    lock = BackendLock()
    manager = lifecycle.build(
        app, session_factory=session_factory, checkpointer_source=source, lock=lock
    )
    try:
        assert manager.kinds == kinds_from_specs(app.state.apps)
        assert manager.checkpointer_source is source
        assert manager.acquire_lock == lock.acquire
        settings = await manager.settings_provider()
        assert settings.run_cap_usd == get_settings().run_cap_usd  # no overrides saved

        sentinel = object()
        app.state.claude_provider = lambda: sentinel  # the fake backend for website tests
        assert manager.claude_provider() is sentinel
    finally:
        await manager.shutdown()


async def test_the_app_lifespan_starts_and_stops_the_real_run_engine(
    other_backend: BackendLock,
) -> None:
    app = create_app()
    async with app.router.lifespan_context(app):
        manager = app.state.run_manager
        assert isinstance(manager, RunManager)
        assert not await other_backend.acquire()
    assert not hasattr(app.state, "run_manager")
    assert await other_backend.acquire()


# --- Shut-down ------------------------------------------------------------------------------------


async def test_shut_down_stops_runs_as_interrupted_and_closes_the_checkpoint_store(
    make_manager: MakeManager,
    session_factory: async_sessionmaker[AsyncSession],
    fakes: FakeState,
    other_backend: BackendLock,
) -> None:
    source = MemorySource()
    lock = BackendLock()
    manager = make_manager(
        checkpointer_source=source, acquire_lock=lock.acquire, release_lock=lock.release
    )
    assert await manager.acquire_backend_lock()
    run = await manager.start(APP, "block", {})
    await fakes.entered.wait()

    await manager.shutdown()

    row = await run_row(session_factory, run.id)
    assert (row.status, row.stop_reason) == ("interrupted", BACKEND_STOPPED)
    assert fakes.cancelled_seen == 1
    assert manager.active_run_ids == []
    assert source.closed
    assert await other_backend.acquire()
    await manager.shutdown()  # twice is fine


# --- The checkpoint pool --------------------------------------------------------------------------


async def test_the_checkpoint_pool_is_made_once_and_can_be_made_again_after_close(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    pool = PoolCheckpointer()
    assert not pool.ready
    try:
        saver = await pool.get()
        assert await pool.get() is saver
        assert pool.ready
        async with session_factory() as session:
            tables = await session.scalar(
                text(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema = :schema AND table_name = 'checkpoints'"
                ),
                {"schema": get_settings().langgraph_schema},
            )
        assert tables == 1  # in its own schema, never in public, core or lead_finder

        await pool.close()
        assert not pool.ready
        assert await pool.get() is not saver  # a new pool and saver
    finally:
        await pool.close()
        await pool.close()  # twice is fine


async def test_two_pools_set_up_at_once_both_work() -> None:
    import asyncio

    first, second = PoolCheckpointer(), PoolCheckpointer()
    try:
        savers = await asyncio.gather(first.get(), second.get())
        assert all(saver is not None for saver in savers)
    finally:
        await first.close()
        await second.close()


async def test_a_checkpoint_store_that_is_down_raises_a_plain_error_and_tries_again() -> None:
    pool = PoolCheckpointer(unreachable_settings())
    password = get_settings().postgres_password.get_secret_value()
    for _ in range(2):  # the second call tries again from the start
        with pytest.raises(CheckpointStoreError) as caught:
            await pool.get()
        message = str(caught.value)
        assert message.startswith("The run checkpoint store couldn't be set up.")
        assert (password in message) is False
        assert caught.value.__cause__ is None  # the connection error (with its text) is dropped
    assert not pool.ready
