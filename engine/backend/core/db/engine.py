"""The async database connection (SQLAlchemy 2 with psycopg 3)."""

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.config import CONNECT_TIMEOUT_SECONDS, Settings, get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    # The timeout matters on Windows: there, psycopg's async connect waits forever on a
    # refused connection unless it has one.
    return create_async_engine(
        settings.database_url(),
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        # SQLAlchemy's error text shows the SQL but not its list of parameters. That is all
        # this hides. Postgres's own `DETAIL:` line can still quote the values of the failed
        # row (`Key (company_key)=(Acme) already exists.`), so the log formatter hides that
        # line too (core/logs.py: hide_detail). Values can be company names, notes or keys.
        hide_parameters=True,
        connect_args={
            "connect_timeout": CONNECT_TIMEOUT_SECONDS,
            "options": connection_limits(settings),
        },
    )


def connection_limits(settings: Settings) -> str:
    """The time limits every app connection starts with (PLAN-V15 T1-6): a statement, a wait
    for a lock, and an open transaction that does nothing. Postgres ends the one that runs over,
    and the request gets an error instead of hanging."""
    return " ".join(
        [
            f"-c statement_timeout={settings.db_statement_timeout_ms}",
            f"-c lock_timeout={settings.db_lock_timeout_ms}",
            f"-c idle_in_transaction_session_timeout={settings.db_idle_in_transaction_timeout_ms}",
        ]
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with get_sessionmaker()() as session:
        yield session
