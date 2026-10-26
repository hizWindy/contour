"""The shared fixtures in tests/conftest.py do what the other tests rely on."""

import os
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import TYPE_CHECKING, Any, TypedDict

import httpx
import pytest
from fastapi import FastAPI
from langchain_core.runnables import RunnableConfig
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sse_starlette.sse import AppStatus, EventSourceResponse

from apps.lead_finder.tables import Lead
from core.config import get_settings
from core.hubspot.models import HubSpotCompany
from core.prefs.models import Setting
from core.runs.models import Run, RunEvent
from core.searches.models import SearchLog
from tests.conftest import LANGGRAPH_SCHEMA, TEST_TABLES

if TYPE_CHECKING:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


def test_tests_never_use_the_real_database() -> None:
    settings = get_settings()
    suffix = os.environ.get("LEADFINDER_TEST_DB_SUFFIX", "")
    assert settings.postgres_db == f"leadfinder_test{suffix}"
    assert os.environ["EMBEDDING_THREADS"]  # set before the settings were read


# --- Database ---------------------------------------------------------------------------------


@pytest.mark.integration
async def test_tables_start_empty_1_fill_every_table(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    run = Run(app="lead_finder", mode="company")
    async with session_factory() as db_session:
        db_session.add_all(
            [
                run,
                Setting(key="run_cap_usd", value="20.00"),
                HubSpotCompany(hubspot_id="1", name="Acme", source="export"),
                SearchLog(
                    app="lead_finder",
                    step="extract",
                    model="m",
                    cost_usd=Decimal("0.1"),
                    answer_ok=True,
                ),
            ]
        )
        await db_session.flush()
        db_session.add_all(
            [
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
        await db_session.commit()


@pytest.mark.integration
async def test_tables_start_empty_2_the_next_test_finds_them_empty(engine: AsyncEngine) -> None:
    """Runs right after the test above, which filled every table."""
    async with engine.connect() as connection:
        for table in TEST_TABLES:
            count = await connection.scalar(text(f"SELECT count(*) FROM {table}"))
            assert count == 0, table


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


@pytest.mark.integration
async def test_the_checkpointer_keeps_a_graph_state_in_its_own_schema(
    checkpointer: "AsyncPostgresSaver", engine: AsyncEngine
) -> None:
    from langgraph.graph import END, START, StateGraph

    def add_one(state: Counter) -> Counter:
        return {"n": state["n"] + 1}

    builder = StateGraph(Counter)
    builder.add_node("add_one", add_one)
    builder.add_edge(START, "add_one")
    builder.add_edge("add_one", END)
    graph = builder.compile(checkpointer=checkpointer)

    thread: RunnableConfig = {"configurable": {"thread_id": str(uuid.uuid4())}}
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
    checkpointer: "AsyncPostgresSaver", engine: AsyncEngine
) -> None:
    async with engine.connect() as connection:
        count = await connection.scalar(
            text(f"SELECT count(*) FROM {LANGGRAPH_SCHEMA}.checkpoints")
        )
    assert count == 0  # the test above left one behind. setup() ran again without trouble.


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
