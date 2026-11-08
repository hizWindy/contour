"""Start-up and shut-down of the run engine. The app's lifespan calls these two functions.

`startup` builds the real run manager, takes the Postgres advisory lock that keeps a second
backend off the same database, marks the runs the last process left going as `interrupted`
(`recover`), and puts the manager in `app.state.run_manager`:
- If another backend holds the lock, two backends would both resume and both spend, so this one
  never runs the engine at the same time:
  - On this computer the app refuses to start ("Another backend is already running").
  - In server mode it starts without the run engine and waits (`take_over_later`). A deploy on
    DigitalOcean App Platform starts the new backend while the old one still runs, and stops the
    old one only once the new one is up (PLAN-V8 B3). Until then the run routes answer 503
    (`runs_not_ready`) and the website and sign-in work. Every few seconds the new backend tries
    the lock again. Once the old one has stopped and let it go, the new one recovers the runs,
    starts the run engine, and then the scheduler and the HubSpot copy.
- If the database is down, that is NOT fatal. It logs a plain message and leaves
  `app.state.run_manager` unset, so the run routes answer 503 (`runs_not_ready`) until the
  backend is restarted with the database up.

`shutdown` lets go of the manager: `manager.shutdown()` stops active runs (they end `interrupted`),
closes the checkpoint pool and releases the lock. It is safe to call when `startup` failed part
way. The lifespan calls it before the engine is disposed.

The lock lives on its own connection (autocommit), held for the life of the process. If that
connection is lost, Postgres lets the lock go; the backend does not notice. TBC: watch it.
"""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any, cast

import psycopg
from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.claude import client as claude_client
from core.claude.client import Claude, configure_claude
from core.config import Settings, get_settings
from core.db import engine as db_engine
from core.memory.embedder import get_embedder
from core.prefs import service as prefs_service
from core.runs.checkpoint import PoolCheckpointer
from core.runs.manager import RunManager, kinds_from_specs
from core.runs.types import CheckpointerSource, ClaudeProvider, SettingsProvider

log = logging.getLogger(__name__)

RUN_ENGINE_LOCK = 7_244_002  # a Postgres advisory lock key: one backend per database
ANOTHER_BACKEND = (
    "Another backend is already running on this database. Stop it first, then start this one."
)
# In server mode, how often a backend that waits for the lock tries it again (PLAN-V8 B3).
LOCK_RETRY_SECONDS = 5.0
WAITING_FOR_LOCK = (
    "Another backend holds the run engine on this database (during a deploy, the old one). This "
    "one starts without it and takes it over when the other one stops."
)
# What a database that is down looks like at start-up.
DATABASE_DOWN = (psycopg.Error, SQLAlchemyError, OSError, TimeoutError, Problem)


class BackendLock:
    """The Postgres advisory lock on a dedicated, autocommit connection.

    `acquire` and `release` are the hooks the manager takes. `release` is safe to call twice,
    or when the lock was never taken.
    """

    def __init__(self, settings: Settings | None = None, key: int = RUN_ENGINE_LOCK) -> None:
        self._settings = settings
        self._key = key
        self._connection: psycopg.AsyncConnection[Any] | None = None

    @property
    def held(self) -> bool:
        return self._connection is not None

    async def acquire(self) -> bool:
        """True when this process now holds the lock (also when it already did)."""
        if self._connection is not None:
            return True
        settings = self._settings or get_settings()
        connection = await psycopg.AsyncConnection.connect(
            settings.psycopg_conninfo(), autocommit=True
        )
        try:
            found = await connection.execute("SELECT pg_try_advisory_lock(%s)", (self._key,))
            row = await found.fetchone()
            taken = bool(row and row[0])
        except BaseException:
            await connection.close()
            raise
        if not taken:
            await connection.close()
            return False
        self._connection = connection
        return True

    async def release(self) -> None:
        connection, self._connection = self._connection, None
        if connection is None:
            return
        try:
            with contextlib.suppress(Exception):  # closing the connection lets it go anyway
                await connection.execute("SELECT pg_advisory_unlock(%s)", (self._key,))
        finally:
            with contextlib.suppress(Exception):
                await connection.close()


def build(
    app: FastAPI,
    *,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    claude_provider: ClaudeProvider | None = None,
    settings_provider: SettingsProvider | None = None,
    checkpointer_source: CheckpointerSource | None = None,
    lock: BackendLock | None = None,
) -> RunManager:
    """Builds the run manager from the engine's real parts (database, embedder, Claude).

    Every part can be replaced (tests do). The session factory is made now, at start-up time,
    from the engine. The Claude provider is the shared client (`core.claude.client.get_claude`),
    unless the app has its own in `app.state.claude_provider` (the fake backend for the website
    tests sets one).
    """
    factory = session_factory or db_engine.get_sessionmaker()
    backend_lock = lock or BackendLock()
    return RunManager(
        session_factory=factory,
        embedder=get_embedder(),
        claude_provider=claude_provider or _claude_provider(app),
        checkpointer_source=checkpointer_source or PoolCheckpointer(),
        settings_provider=settings_provider or _settings_provider(factory),
        kinds=kinds_from_specs(app.state.apps),
        acquire_lock=backend_lock.acquire,
        release_lock=backend_lock.release,
    )


def _claude_provider(app: FastAPI) -> ClaudeProvider:
    def provider() -> Claude:
        own = getattr(app.state, "claude_provider", None)
        if own is not None:
            return cast(Claude, own())
        return claude_client.get_claude()  # looked up now, so a replaced client is used

    return provider


def _settings_provider(factory: async_sessionmaker[AsyncSession]) -> SettingsProvider:
    """The settings a run starts with: .env with the Settings page on top. The shared Claude gets
    them too (the daily limit, the model), so a run a schedule starts after a restart, with no
    page opened since, still uses what the Settings page says."""

    async def provider() -> Settings:
        async with factory() as session:
            settings = await prefs_service.effective_settings(session)
        configure_claude(settings)
        return settings

    return provider


async def startup(app: FastAPI) -> None:
    """Called once when the app starts. See the module text for what it does and refuses."""
    manager = build(app)
    try:
        taken = await manager.acquire_backend_lock()
    except DATABASE_DOWN as error:
        _runs_off(error)
        return
    if not taken:
        await manager.shutdown()
        if not get_settings().server_mode:
            raise RuntimeError(ANOTHER_BACKEND)
        app.state.run_engine_waiting = True  # the lifespan then calls take_over_later
        log.warning(WAITING_FOR_LOCK)
        return
    await _start_engine(app, manager)


async def _start_engine(app: FastAPI, manager: RunManager) -> bool:
    """With the lock held: recovers the runs and puts the manager in `app.state`. False (and the
    lock let go) when the database is down."""
    try:
        recovered = await manager.recover()
    except DATABASE_DOWN as error:
        await manager.shutdown()  # lets the lock go
        _runs_off(error)
        return False
    app.state.run_manager = manager
    log.info("run_engine_ready", extra={"recovered": recovered})
    return True


def waiting(app: FastAPI) -> bool:
    """True when this backend started without the run engine because another one holds it."""
    return bool(getattr(app.state, "run_engine_waiting", False))


def take_over_later(
    app: FastAPI,
    then: Callable[[FastAPI], Awaitable[None]],
    *,
    every: float = LOCK_RETRY_SECONDS,
) -> None:
    """Tries the lock again every `every` seconds in the background. When it is free, starts the
    run engine here, then calls `then` (the scheduler and the HubSpot copy). `stop_waiting` ends
    the wait when the app stops first."""

    async def wait() -> None:
        manager = build(app)
        try:
            while True:
                await asyncio.sleep(every)
                try:
                    if await manager.acquire_backend_lock():
                        break
                except DATABASE_DOWN:
                    continue  # the database may be back by the next try
        except asyncio.CancelledError:
            await manager.shutdown()
            raise
        app.state.run_engine_waiting = False
        if await _start_engine(app, manager):
            log.info("run_engine_taken_over")
            await then(app)

    app.state.run_engine_waiter = asyncio.create_task(wait(), name="take-over-run-engine")


async def stop_waiting(app: FastAPI) -> None:
    """Ends the wait for the lock, if there is one. Safe to call when there is none."""
    task: asyncio.Task[None] | None = getattr(app.state, "run_engine_waiter", None)
    if task is None:
        return
    del app.state.run_engine_waiter
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


def _runs_off(error: BaseException) -> None:
    # Only the kind of error is logged: the text of a connection error can hold the host or user.
    log.error(
        "The database can't be reached, so runs are turned off. "
        "Start the database, then restart the backend.",
        extra={"reason": type(error).__name__},
    )


async def shutdown(app: FastAPI) -> None:
    """Called once when the app stops. Safe when `startup` failed part way."""
    manager: RunManager | None = getattr(app.state, "run_manager", None)
    if manager is None:
        return
    with contextlib.suppress(AttributeError):
        del app.state.run_manager  # new requests get a 503 from now on
    await manager.shutdown()
