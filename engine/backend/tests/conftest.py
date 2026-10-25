"""Shared test setup.

Fast tests need nothing. Integration tests (marked `integration`) need the database running
(`docker compose up -d` in engine/). They use their own database, leadfinder_test, which
is emptied before each test.
"""

from collections.abc import AsyncIterator, Iterator

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from psycopg import sql
from psycopg.conninfo import make_conninfo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import BACKEND_DIR, get_settings
from core.runtime import use_selector_loop_on_windows

use_selector_loop_on_windows()

TEST_TABLES = (
    "lead_finder.leads",
    "core.searches",
    "core.memory",
    "core.hubspot_deals",
    "core.hubspot_offices",
    "core.hubspot_companies",
)


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    config.attributes["skip_logging_config"] = True
    return config


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """Makes the test database if needed, and applies every migration to it."""
    settings = get_settings()
    name = f"{settings.postgres_db}_test"
    server = make_conninfo(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_password.get_secret_value(),
        dbname="postgres",
        connect_timeout=3,
    )
    try:
        with psycopg.connect(server, autocommit=True) as connection:
            found = connection.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s", (name,)
            ).fetchone()
            if found is None:
                connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    except psycopg.OperationalError:
        pytest.skip("The database isn't running. Start it with: docker compose up -d")
    url = settings.database_url(name)
    command.upgrade(alembic_config(url), "head")
    yield url


@pytest.fixture
async def session(database_url: str) -> AsyncIterator[AsyncSession]:
    """A session on the test database, with every core table emptied first."""
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE {', '.join(TEST_TABLES)}"))
    async with async_sessionmaker(engine, expire_on_commit=False)() as db_session:
        yield db_session
    await engine.dispose()
