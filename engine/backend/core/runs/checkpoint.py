"""Where a run's LangGraph progress is saved: a Postgres schema of its own, behind a small pool.

`PoolCheckpointer` is the real `CheckpointerSource` (`core.runs.types`). It makes the connection
pool and the saver lazily, inside the running event loop, on the first `get()`. So a database
that is down when the backend starts is not fatal: `get()` raises a plain error, the run routes
answer 503, and the next `get()` tries again from the start.

Rules it follows (each one was proved by an experiment):
- A POOL of connections, never one shared `AsyncConnection`. One shared connection broke after a
  cancel and after a database restart.
- The pool opens with `wait=False` and checks a connection before it hands it out.
- Setting up the tables runs under a Postgres advisory lock (`pg_advisory_lock`), so two
  backends can't both create them. A second `setup()` after a `UniqueViolation` is safe.
- The connection string holds the database password. It is never logged and never put in an
  error: a failure is reported as a plain, fixed sentence.
- LangGraph is imported only when the first `get()` runs, after `disable_tracing()` has switched
  LangSmith off (importing it earlier could read the tracing variables first).
"""

import asyncio
import contextlib
import logging
from typing import TYPE_CHECKING, Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from core.config import Settings, get_settings

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

log = logging.getLogger(__name__)

CHECKPOINT_SETUP_LOCK = 7_244_001  # a Postgres advisory lock key: one saver.setup() at a time
POOL_MIN_SIZE = 1
POOL_MAX_SIZE = 4
POOL_WAIT_SECONDS = 10  # how long a request waits for a free connection before it gives up
CONNECT_TIMEOUT_SECONDS = 5


class CheckpointStoreError(RuntimeError):
    """The run checkpoint store couldn't be made. The text is fixed and safe to show."""


class PoolCheckpointer:
    """A `CheckpointerSource` on a `psycopg_pool.AsyncConnectionPool`."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings
        self._lock = asyncio.Lock()
        self._pool: AsyncConnectionPool[Any] | None = None
        self._saver: BaseCheckpointSaver[Any] | None = None

    @property
    def ready(self) -> bool:
        """True once the pool and the saver exist."""
        return self._saver is not None

    async def get(self) -> "BaseCheckpointSaver[Any]":
        """The saver, made on the first call. Raises `CheckpointStoreError` when it can't be
        made, and the next call tries again."""
        saver = self._saver
        if saver is not None:
            return saver
        async with self._lock:
            if self._saver is not None:
                return self._saver
            self._saver = await self._make()
            return self._saver

    async def _make(self) -> "BaseCheckpointSaver[Any]":
        from core.runtime import disable_tracing

        disable_tracing()  # before LangGraph is imported
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        settings = self._settings or get_settings()
        pool: AsyncConnectionPool[Any] = AsyncConnectionPool(
            settings.psycopg_conninfo(connect_timeout=CONNECT_TIMEOUT_SECONDS),
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
                "options": f"-c search_path={settings.langgraph_schema}",
            },
            min_size=POOL_MIN_SIZE,
            max_size=POOL_MAX_SIZE,
            timeout=POOL_WAIT_SECONDS,
            open=False,
            check=AsyncConnectionPool.check_connection,
        )
        try:
            await pool.open(wait=False)
            saver = AsyncPostgresSaver(pool)
            async with pool.connection() as connection:
                await connection.execute(
                    sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(
                        sql.Identifier(settings.langgraph_schema)
                    )
                )
                await connection.execute("SELECT pg_advisory_lock(%s)", (CHECKPOINT_SETUP_LOCK,))
                try:
                    try:
                        await saver.setup()
                    except psycopg.errors.UniqueViolation:  # two setups raced. The second is safe.
                        await saver.setup()
                finally:
                    # If the connection died, the lock went with it, so a failed unlock is fine.
                    with contextlib.suppress(Exception):
                        await connection.execute(
                            "SELECT pg_advisory_unlock(%s)", (CHECKPOINT_SETUP_LOCK,)
                        )
        except BaseException as error:
            await self._discard(pool)
            if not isinstance(error, Exception):
                raise  # a cancel or an exit: let it through
            # The reason can hold the host, the user or the password. Only its type is logged.
            log.warning("checkpoint_store_unavailable", extra={"reason": type(error).__name__})
            raise CheckpointStoreError(
                "The run checkpoint store couldn't be set up. Check that the database is running."
            ) from None
        self._pool = pool
        return saver

    @staticmethod
    async def _discard(pool: AsyncConnectionPool[Any]) -> None:
        with contextlib.suppress(Exception):
            await asyncio.shield(pool.close(timeout=2))

    async def close(self, seconds: float = 5) -> None:
        """Closes the pool. Safe to call twice, or before `get()` ever ran."""
        pool, self._pool, self._saver = self._pool, None, None
        if pool is not None:
            with contextlib.suppress(Exception):
                await pool.close(timeout=seconds)
