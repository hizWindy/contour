"""Shared test setup.

Fast tests need nothing: no database, no memory model. Integration tests (marked `integration`)
need the database running (`docker compose up -d` in engine/). They use their own database,
leadfinder_test, which is emptied before each test.

Several people can run tests at once on one database server. Each sets
LEADFINDER_TEST_DB_SUFFIX (like `_fa`) and gets its own database, leadfinder_test_fa.
Run one pytest process for each suffix at a time. Tests never touch the real `leadfinder`
database: the name is forced below, before the settings are read.

Fixtures for integration tests: `engine`, `session_factory`, `session`, `embedder`,
`checkpointer` and `live_server` (which needs an `app` fixture from the test). A test that
uses the database or the memory model without the `integration` marker fails at once with
"mark this test integration", so the fast suite stays fast and never needs Docker.

The guard has two parts. It refuses a test that asks for one of these fixtures (unless the
test file or a nearer conftest has replaced the fixture with its own). And it refuses any
database connection or embedder load that an unmarked test starts by another road, like an
app built with `create_app()` that calls a route reaching the database.
"""

import asyncio
import contextlib
import os
import re
from collections.abc import AsyncIterator, Generator, Iterator
from typing import TYPE_CHECKING, Literal, NoReturn

import httpx
import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from psycopg import sql
from psycopg.conninfo import make_conninfo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.config import BACKEND_DIR, Settings, get_settings
from core.memory.embedder import Embedder, get_embedder
from core.runtime import use_selector_loop_on_windows

if TYPE_CHECKING:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

use_selector_loop_on_windows()

# The test database and the embedding threads go into the environment BEFORE anything reads the
# settings. The environment wins over engine/.env, so no test can reach the real database.
TEST_DB_SUFFIX = os.environ.get("LEADFINDER_TEST_DB_SUFFIX", "")
if not re.fullmatch(r"[A-Za-z0-9_]{0,32}", TEST_DB_SUFFIX):
    raise RuntimeError("LEADFINDER_TEST_DB_SUFFIX may only hold letters, digits and underscores")
os.environ["POSTGRES_DB"] = f"leadfinder_test{TEST_DB_SUFFIX}"
os.environ.setdefault("EMBEDDING_THREADS", "2")
os.environ["SIGNALHIRE_API_KEY"] = ""  # whatever engine/.env holds, no test reaches Signal Hire
os.environ["HUBSPOT_SERVICE_KEY"] = ""  # nor HubSpot
os.environ["HUBSPOT_WRITE_ENABLED"] = "false"  # and nothing can write to it
os.environ["HUBSPOT_SYNC_MAX_AGE_HOURS"] = "0"  # a test backend never syncs when it starts
os.environ["AUTH_REQUIRED"] = "false"  # nor does engine/.env turn the sign-in on under a test
os.environ["SESSION_COOKIE_SECURE"] = "false"
get_settings.cache_clear()

TEST_TABLES = (
    "core.audit_log",
    "core.sessions",
    "core.users",
    "lead_finder.leads",
    "lead_finder.signalhire_details",
    "core.searches",
    "core.memory",
    "core.hubspot_writes",
    "core.hubspot_syncs",
    "core.hubspot_owners",
    "core.hubspot_deals",
    "core.hubspot_offices",
    "core.hubspot_companies",
    "core.run_events",
    "core.runs",
    "core.settings",
)
LANGGRAPH_SCHEMA = "langgraph"
CHECKPOINT_SETUP_LOCK = 7_244_001  # a Postgres advisory lock key: one saver.setup() at a time
INTEGRATION_FIXTURES = frozenset(
    {"database_url", "engine", "session_factory", "session", "embedder", "checkpointer"}
)
NOT_INTEGRATION = "mark this test integration"


# --- The guard: fast tests stay fast --------------------------------------------------------


def _is_the_shared_fixture(item: pytest.Item, name: str) -> bool:
    """False when a test file or a nearer conftest has replaced the fixture `name`.

    A fast test may define its own fake `session` or `engine`. That fake is not a database.
    If the replacement itself asks for a shared fixture, that one is found on its own.
    """
    info = getattr(item, "_fixtureinfo", None)
    definitions = getattr(info, "name2fixturedefs", {}).get(name)
    if not definitions:
        return True  # nothing to compare with (a stand-in item in a test about the guard)
    return bool(getattr(definitions[-1].func, "__module__", None) == __name__)


def check_integration_marker(item: pytest.Item) -> None:
    """Fails a test that uses the database or the embedder but isn't marked `integration`."""
    if item.get_closest_marker("integration") is not None:
        return
    asked_for = INTEGRATION_FIXTURES & set(getattr(item, "fixturenames", ()))
    used = sorted(name for name in asked_for if _is_the_shared_fixture(item, name))
    if used:
        pytest.fail(f"{NOT_INTEGRATION}: it uses {', '.join(used)}", pytrace=False)


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item: pytest.Item) -> None:
    check_integration_marker(item)  # before any fixture starts, so no database is touched


# The real functions, kept so a test about the guard can put them back.
REAL_EMBEDDER_LOAD = Embedder._load
REAL_CONNECTIONS = (
    # `psycopg.connect` is its own copy of `Connection.connect`, so both are replaced.
    # SQLAlchemy, the checkpoint pool and Alembic reach the database through one of these.
    (psycopg, "connect", psycopg.connect),
    (psycopg.Connection, "connect", vars(psycopg.Connection)["connect"]),
    (psycopg.AsyncConnection, "connect", vars(psycopg.AsyncConnection)["connect"]),
)


def _refuse_to_load_embedder(self: Embedder) -> NoReturn:
    pytest.fail(f"{NOT_INTEGRATION}: it loads the embedder", pytrace=False)


def _refuse_to_connect(*args: object, **kwargs: object) -> NoReturn:
    # `Failed` is a BaseException, so a handler that catches `Exception` (like the health
    # check does when the database is down) can't swallow it.
    pytest.fail(f"{NOT_INTEGRATION}: it opens a database connection", pytrace=False)


def put_back_the_real_connections(monkeypatch: pytest.MonkeyPatch) -> None:
    """For a test about the guard: a pytest run started inside it begins with real functions."""
    monkeypatch.setattr(Embedder, "_load", REAL_EMBEDDER_LOAD)
    for target, name, real in REAL_CONNECTIONS:
        monkeypatch.setattr(target, name, real)


@pytest.fixture(autouse=True)
def _fast_tests_need_no_database(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An unmarked test can neither load the memory model nor open a database connection."""
    if request.node.get_closest_marker("integration") is None:
        monkeypatch.setattr(Embedder, "_load", _refuse_to_load_embedder)
        for target, name, _ in REAL_CONNECTIONS:
            monkeypatch.setattr(target, name, _refuse_to_connect)


@pytest.fixture(scope="session", autouse=True)
def _only_the_test_database() -> None:
    name = get_settings().postgres_db
    assert name.startswith("leadfinder_test"), f"tests must use a leadfinder_test* database: {name}"


# --- Database -------------------------------------------------------------------------------


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))  # % is special in .ini files
    config.attributes["skip_logging_config"] = True
    return config


def server_conninfo(settings: Settings, database: str = "postgres") -> str:
    """How to connect to one database on the server, as a psycopg connection string."""
    return make_conninfo(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_password.get_secret_value(),
        dbname=database,
        connect_timeout=3,
    )


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """Makes the test database if needed, and applies every migration to it."""
    settings = get_settings()
    name = settings.postgres_db
    try:
        with psycopg.connect(server_conninfo(settings), autocommit=True) as connection:
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
async def engine(database_url: str) -> AsyncIterator[AsyncEngine]:
    """An engine on the test database, with every table emptied first."""
    created = create_async_engine(
        database_url,
        pool_size=10,
        max_overflow=20,
        pool_timeout=10,
        connect_args={"connect_timeout": 5},
    )
    assert (created.url.database or "").startswith("leadfinder_test")
    try:
        async with created.begin() as connection:
            # One statement, so tables that point at each other can be emptied together.
            # A leaked connection makes this fail after 10 s, not hang.
            await connection.execute(text("SET LOCAL lock_timeout = '10s'"))
            await connection.execute(text(f"TRUNCATE {', '.join(TEST_TABLES)}"))
        yield created
    finally:
        await created.dispose()


@pytest.fixture
def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """A session on the test database, with every table emptied first."""
    async with session_factory() as db_session:
        yield db_session


# --- Memory ---------------------------------------------------------------------------------


@pytest.fixture(scope="session")
def embedder() -> Embedder:
    """The real memory model, shared by the whole run. It loads on first use."""
    return get_embedder()


# --- LangGraph checkpoints ------------------------------------------------------------------


@pytest.fixture
async def checkpointer(engine: AsyncEngine) -> AsyncIterator["AsyncPostgresSaver"]:
    """A LangGraph saver on its own connection pool, in the `langgraph` schema."""
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    settings = get_settings()
    pool = AsyncConnectionPool(
        make_conninfo(
            host=settings.postgres_host,
            port=settings.postgres_port,
            user=settings.postgres_user,
            password=settings.postgres_password.get_secret_value(),
            dbname=settings.postgres_db,
            connect_timeout=5,
        ),
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": dict_row,
            "options": f"-c search_path={LANGGRAPH_SCHEMA}",
        },
        min_size=1,
        max_size=4,
        open=False,
        check=AsyncConnectionPool.check_connection,
    )
    await pool.open(wait=False)
    try:
        saver = AsyncPostgresSaver(pool)  # type: ignore[arg-type]
        async with pool.connection() as connection:
            await connection.execute(
                sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(LANGGRAPH_SCHEMA))
            )
            await connection.execute("SELECT pg_advisory_lock(%s)", (CHECKPOINT_SETUP_LOCK,))
            try:
                try:
                    await saver.setup()
                except psycopg.errors.UniqueViolation:  # two setups raced. The second is safe.
                    await saver.setup()
            finally:
                await connection.execute("SELECT pg_advisory_unlock(%s)", (CHECKPOINT_SETUP_LOCK,))
            tables = sql.SQL(", ").join(
                sql.Identifier(LANGGRAPH_SCHEMA, name)
                for name in ("checkpoints", "checkpoint_blobs", "checkpoint_writes")
            )
            await connection.execute(sql.SQL("TRUNCATE {}").format(tables))
        yield saver
    finally:
        await pool.close(timeout=5)


# --- A real server for streaming tests ------------------------------------------------------


@pytest.fixture
def live_server_lifespan() -> Literal["on", "off", "auto"]:
    """Does the app's start-up and shut-down code run? Off, because tests build their own
    state (like `app.state.run_manager`). A test file can override this fixture."""
    return "off"


@pytest.fixture
async def live_server(
    app: FastAPI, live_server_lifespan: Literal["on", "off", "auto"]
) -> AsyncIterator[httpx.AsyncClient]:
    """The test's `app` served on a free local port, inside the test's event loop.

    Use it for streaming (SSE) tests. httpx.ASGITransport collects whole responses, so it
    can't show a stream. It yields a client that calls the server over real HTTP.
    """
    import uvicorn
    from sse_starlette.sse import AppStatus

    class LocalServer(uvicorn.Server):
        @contextlib.contextmanager
        def capture_signals(self) -> Generator[None, None, None]:
            yield  # leave Ctrl+C to pytest

    server = LocalServer(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=0,
            log_config=None,
            access_log=False,
            ws="none",
            lifespan=live_server_lifespan,
            timeout_graceful_shutdown=5,
        )
    )
    task = asyncio.create_task(server.serve())
    try:
        for _ in range(500):
            if server.started:
                break
            if task.done():
                task.result()  # raises why it stopped
            await asyncio.sleep(0.02)
        else:
            raise RuntimeError("The test server didn't start within 10 seconds")
        port = server.servers[0].sockets[0].getsockname()[1]
        async with httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}", timeout=httpx.Timeout(30)
        ) as client:
            yield client
    finally:
        server.should_exit = True
        _, pending = await asyncio.wait({task}, timeout=15)
        if pending:
            server.force_exit = True
            _, pending = await asyncio.wait({task}, timeout=5)
        if pending:
            task.cancel()
            await asyncio.wait({task}, timeout=5)
        AppStatus.should_exit = False  # a stale flag would end the next test's streams at once
