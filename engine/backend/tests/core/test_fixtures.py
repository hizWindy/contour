"""The shared fixtures in tests/conftest.py do what the other tests rely on."""

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, time
from decimal import Decimal
from typing import TYPE_CHECKING, Any, TypedDict

import httpx
import psycopg
import pytest
from fastapi import FastAPI
from langchain_core.runnables import RunnableConfig
from psycopg import sql
from psycopg.rows import dict_row
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sse_starlette.sse import AppStatus, EventSourceResponse

from apps.lead_finder.tables import Lead, Rival, SignalHireDetails
from core.auth.models import AuditEntry, User, UserSession
from core.config import get_settings
from core.hubspot.models import (
    HubSpotCompany,
    HubSpotDeal,
    HubSpotOffice,
    HubSpotOwner,
    HubSpotSync,
    HubSpotWrite,
)
from core.memory.models import EMBEDDING_DIM, MemoryItem
from core.prefs.models import Setting
from core.runs.models import Run, RunEvent
from core.schedules.models import Schedule
from core.searches.models import SearchLog
from tests.conftest import CHECKPOINT_SETUP_LOCK, LANGGRAPH_SCHEMA, TEST_TABLES

if TYPE_CHECKING:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from langgraph.graph.state import CompiledStateGraph


def test_tests_never_use_the_real_database() -> None:
    settings = get_settings()
    suffix = os.environ.get("LEADFINDER_TEST_DB_SUFFIX", "")
    assert settings.postgres_db == f"leadfinder_test{suffix}"
    assert os.environ["EMBEDDING_THREADS"]  # set before the settings were read


# --- Database ---------------------------------------------------------------------------------

CHECKPOINT_TABLES = ("checkpoints", "checkpoint_blobs", "checkpoint_writes")


async def fill_every_table(factory: async_sessionmaker[AsyncSession]) -> None:
    """One row in each of the tables in TEST_TABLES, committed."""
    run = Run(app="lead_finder", mode="company")
    person = User(email="al@example.test", name="Al", password_hash="$argon2id$not-a-real-hash")
    async with factory() as db_session:
        db_session.add_all(
            [
                run,
                person,
                Setting(key="run_cap_usd", value="20.00"),
                Schedule(
                    project="test",
                    job="test.job",
                    name="A job",
                    every=1,
                    unit="days",
                    at_time=time(6, 0),
                ),
                SignalHireDetails(
                    signalhire_id=7, slug="acme", details={}, fetched_at=datetime.now(UTC)
                ),
                HubSpotCompany(hubspot_id="1", name="Acme", source="export"),
                HubSpotOwner(owner_id="11", name="Pat Lee"),
                HubSpotSync(mode="full", trigger="command", status="running"),
                HubSpotWrite(app="lead_finder", subject="lead:1", plan={}),
                SearchLog(
                    app="lead_finder",
                    step="extract",
                    model="m",
                    cost_usd=Decimal("0.1"),
                    answer_ok=True,
                ),
                MemoryItem(
                    app="lead_finder",
                    kind="note",
                    content="Acme is thinking about a move.",
                    embedding=[0.1] * EMBEDDING_DIM,
                ),
            ]
        )
        await db_session.flush()
        db_session.add_all(
            [
                UserSession(
                    token_hash="0" * 64,
                    user_id=person.id,
                    expires_at=datetime.now(UTC),
                ),
                AuditEntry(event="sign_in", user_id=person.id),
                HubSpotOffice(hubspot_company_id="1", label="Melbourne"),
                HubSpotDeal(hubspot_deal_id="9", hubspot_company_id="1", name="Acme fit-out"),
                RunEvent(run_id=run.id, seq=1, type="run_started", data={}),
                Lead(
                    run_id=run.id,
                    company="Acme",
                    company_key="acme",
                    result="pass",
                    score=1,
                    hubspot_status="new",
                    card={},
                    cost_usd=Decimal("0.1"),
                    web_searches=0,
                    rules_version="v1",
                    prompt_version="p",
                ),
            ]
        )
        await db_session.flush()
        lead_id = await db_session.scalar(select(Lead.id).where(Lead.company_key == "acme"))
        db_session.add(
            Rival(
                lead_id=lead_id,
                lead_company="Acme",
                name="Rival Co",
                company_key="rival co",
                city="Melbourne",
                url="https://example.com",
                why="It competes with Acme.",
                found_at=datetime.now(UTC),
            )
        )
        await db_session.commit()


async def row_counts(connection: AsyncConnection) -> dict[str, int]:
    return {
        table: int(await connection.scalar(text(f"SELECT count(*) FROM {table}")) or 0)
        for table in TEST_TABLES
    }


@pytest.fixture
async def leftover_rows(database_url: str) -> None:
    """Rows in every table, left behind as an earlier test would leave them.

    A test that asks for this BEFORE `engine` gets them put there first, so what it sees
    afterwards shows what the `engine` fixture did, whatever order the tests run in.
    """
    own = create_async_engine(database_url, connect_args={"connect_timeout": 5})
    try:
        await fill_every_table(async_sessionmaker(own, expire_on_commit=False))
        async with own.connect() as connection:
            counts = await row_counts(connection)
    finally:
        await own.dispose()
    assert all(count > 0 for count in counts.values()), counts  # the set-up itself worked


@pytest.mark.integration
async def test_every_test_table_is_listed_in_the_guard(engine: AsyncEngine) -> None:
    """A table nobody added to TEST_TABLES would keep its rows from one test to the next."""
    async with engine.connect() as connection:
        found = (
            await connection.execute(
                text(
                    "SELECT table_schema || '.' || table_name FROM information_schema.tables "
                    "WHERE table_schema IN ('core', 'lead_finder') AND table_type = 'BASE TABLE'"
                )
            )
        ).scalars()
        assert set(found) == set(TEST_TABLES)


@pytest.mark.integration
async def test_the_engine_fixture_empties_every_table_first(
    leftover_rows: None, engine: AsyncEngine
) -> None:
    """The rows are there before the engine fixture starts. None are left after it."""
    async with engine.connect() as connection:
        assert await row_counts(connection) == dict.fromkeys(TEST_TABLES, 0)


@pytest.mark.integration
async def test_session_and_session_factory_share_the_engine(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await session.execute(select(func.count()).select_from(Run))
    async with session_factory() as another:
        assert (await another.scalar(select(func.count()).select_from(Run))) == 0


# --- LangGraph --------------------------------------------------------------------------------


class Counter(TypedDict):
    n: int


def counter_graph(
    saver: "AsyncPostgresSaver",
) -> "CompiledStateGraph[Counter, Any, Counter, Counter]":
    """A graph of one step that adds 1, saving its state with `saver`."""
    from langgraph.graph import END, START, StateGraph

    def add_one(state: Counter) -> Counter:
        return {"n": state["n"] + 1}

    builder = StateGraph(Counter)
    builder.add_node("add_one", add_one)
    builder.add_edge(START, "add_one")
    builder.add_edge("add_one", END)
    return builder.compile(checkpointer=saver)


def new_thread() -> RunnableConfig:
    return {"configurable": {"thread_id": str(uuid.uuid4())}}


async def checkpoint_counts(connection: AsyncConnection) -> dict[str, int]:
    return {
        name: int(
            await connection.scalar(text(f"SELECT count(*) FROM {LANGGRAPH_SCHEMA}.{name}")) or 0
        )
        for name in CHECKPOINT_TABLES
    }


@pytest.fixture
async def leftover_checkpoint(database_url: str) -> None:
    """A saved graph state in the `langgraph` schema, left behind as an earlier test would.

    Like `leftover_rows`: a test that asks for this BEFORE `checkpointer` sees what that
    fixture did to it.
    """
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    conninfo = get_settings().psycopg_conninfo(options=f"-c search_path={LANGGRAPH_SCHEMA}")
    async with await psycopg.AsyncConnection.connect(
        conninfo, autocommit=True, prepare_threshold=0, row_factory=dict_row
    ) as connection:
        await connection.execute(
            sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(LANGGRAPH_SCHEMA))
        )
        await connection.execute("SELECT pg_advisory_lock(%s)", (CHECKPOINT_SETUP_LOCK,))
        try:
            saver = AsyncPostgresSaver(connection)
            try:
                await saver.setup()
            except psycopg.errors.UniqueViolation:  # two setups raced. The second is safe.
                await saver.setup()
        finally:
            await connection.execute("SELECT pg_advisory_unlock(%s)", (CHECKPOINT_SETUP_LOCK,))
        assert (await counter_graph(saver).ainvoke({"n": 1}, new_thread()))["n"] == 2
        found = await connection.execute(
            f"SELECT count(*) AS n FROM {LANGGRAPH_SCHEMA}.checkpoints"
        )
        row = await found.fetchone()
    assert row is not None
    assert row["n"] > 0  # the set-up itself worked


@pytest.mark.integration
async def test_the_checkpointer_keeps_a_graph_state_in_its_own_schema(
    checkpointer: "AsyncPostgresSaver", engine: AsyncEngine
) -> None:
    graph = counter_graph(checkpointer)
    thread = new_thread()
    assert (await graph.ainvoke({"n": 1}, thread))["n"] == 2
    assert (await graph.aget_state(thread)).values == {"n": 2}

    async with engine.connect() as connection:
        schemas = (
            await connection.scalars(
                text("SELECT table_schema FROM information_schema.tables WHERE table_name = :t"),
                {"t": "checkpoints"},
            )
        ).all()
    assert schemas == [LANGGRAPH_SCHEMA]  # never in public, core or lead_finder


@pytest.mark.integration
async def test_each_checkpointer_starts_clean_and_can_run_again(
    leftover_checkpoint: None, checkpointer: "AsyncPostgresSaver", engine: AsyncEngine
) -> None:
    """A state was saved before the fixture started. None is left after it, and the saver
    works: its `setup()` ran a second time on tables that already existed."""
    async with engine.connect() as connection:
        assert await checkpoint_counts(connection) == dict.fromkeys(CHECKPOINT_TABLES, 0)
    assert (await counter_graph(checkpointer).ainvoke({"n": 5}, new_thread()))["n"] == 6


# --- The live server --------------------------------------------------------------------------


@pytest.fixture
def app() -> FastAPI:
    app = FastAPI()

    @app.get("/count")
    async def count(to: int) -> EventSourceResponse:
        async def events() -> AsyncIterator[dict[str, Any]]:
            for number in range(1, to + 1):
                yield {"id": str(number), "event": "tick", "data": f"n={number}"}

        return EventSourceResponse(events())

    @app.get("/forever")
    async def forever() -> EventSourceResponse:
        async def events() -> AsyncIterator[dict[str, Any]]:
            import asyncio

            while True:
                yield {"event": "tick", "data": "again"}
                await asyncio.sleep(0.05)

        return EventSourceResponse(events())

    @app.get("/plain")
    async def plain() -> dict[str, bool]:
        return {"ok": True}

    return app


async def read_events(client: httpx.AsyncClient, path: str, limit: int) -> list[str]:
    seen: list[str] = []
    async with client.stream("GET", path) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                seen.append(line.removeprefix("data:").strip())
                if len(seen) == limit:
                    break
    return seen


async def test_live_server_streams_real_server_sent_events(live_server: httpx.AsyncClient) -> None:
    assert str(live_server.base_url).startswith("http://127.0.0.1:")
    assert (await live_server.get("/plain")).json() == {"ok": True}
    assert await read_events(live_server, "/count?to=3", 3) == ["n=1", "n=2", "n=3"]


async def test_live_server_works_again_in_the_next_test(live_server: httpx.AsyncClient) -> None:
    """A stream open when the test ends must not hang the teardown or poison the next test."""
    assert await read_events(live_server, "/forever", 2) == ["again", "again"]


async def test_live_server_leaves_no_shutdown_flag_behind(live_server: httpx.AsyncClient) -> None:
    assert AppStatus.should_exit is False
    assert await read_events(live_server, "/count?to=2", 2) == ["n=1", "n=2"]
