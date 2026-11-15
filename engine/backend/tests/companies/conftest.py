"""Fixtures for the Companies tests."""

from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from psycopg import sql

from core.config import get_settings
from tests.conftest import server_conninfo
from tests.core.auth_world import World, build_world


@pytest.fixture
def world(session_factory: Any) -> World:
    return build_world(session_factory)


@pytest.fixture
def scratch_url(database_url: str) -> Iterator[tuple[str, str]]:
    """A throwaway database for a migration test to move up and down: (Alembic's url, psycopg's
    conninfo). The shared test database is never rolled back."""
    settings = get_settings()
    name = f"{settings.postgres_db}_migc"
    server = server_conninfo(settings)
    drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
    with psycopg.connect(server, autocommit=True) as connection:
        connection.execute(drop)
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield settings.database_url(name), server_conninfo(settings, name)
    finally:
        with psycopg.connect(server, autocommit=True) as connection:
            connection.execute(drop)
