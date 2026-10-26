"""The async database connection (SQLAlchemy 2 with psycopg 3)."""

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.config import CONNECT_TIMEOUT_SECONDS, get_settings


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
        connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with get_sessionmaker()() as session:
        yield session
