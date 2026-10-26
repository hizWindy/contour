"""Reading runs: one run, the list, the log, the cost by day, and the SQL of the estimate.

The first part is fast: the five read routes, with a stand-in manager, check the wiring (which
arguments reach the manager, the errors and the order of the routes). The rest is marked
`integration` and runs against the test database. It is where the dates matter: a run's day is
its Australia/Melbourne date, worked out in SQL, including on the two days a year the clocks
change (2026-04-05, 25 hours long, and 2026-10-04, 23 hours long).
"""

import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.api.errors import Problem
from core.api.routes import api_routes
from core.config import Settings
from core.runs import reads
from core.runs.estimate import (
    SAMPLE_WINDOW,
    estimate_run,
    load_unit_costs,
    spent_last_24h,
)
from core.runs.manager import RunManager
from core.runs.models import Run
from core.runs.models import RunEvent as RunEventRow
from core.runs.reads import event_log, get_run, list_runs, summary
from core.runs.schemas import (
    EventLog,
    MergedData,
    PlanReadyData,
    RunCaps,
    RunCounts,
    RunCreate,
    RunEstimate,
    RunFinishedData,
    RunOut,
    RunPage,
    RunStartedData,
    RunStatus,
    RunSummary,
    SliceDoneData,
    build_event,
    dump_event,
    event_data,
    event_type_of,
)
from core.runs.types import DEFAULT_COMPANY_USD, DEFAULT_SLICE_USD, EstimateContext, RunKind
from core.searches.models import SearchLog

D = Decimal
integration = pytest.mark.integration
MISSING = uuid.UUID(int=0xDEAD)
CAPS = RunCaps(
    run_cap_usd=D("20.00"),
    max_companies=20,
    company_cap_usd=D("2.50"),
    discovery_cap_usd=D("8.00"),
)


def at(moment: str) -> datetime:
    """'2026-04-04T13:00:00Z' as an aware datetime."""
    return datetime.fromisoformat(moment)


# --- The five routes, with a stand-in manager (fast) ----------------------------------------------


def make_run_out(**changes: Any) -> RunOut:
    fields: dict[str, Any] = {
        "id": uuid.UUID(int=7),
        "app": "lead_finder",
        "mode": "discovery",
        "status": "done",
        "params": {"cities": ["Melbourne"]},
        "caps": CAPS,
        "rules_version": "rules1",
        "prompt_versions": "research 1a2b",
        "cost_usd": D("1.5"),
        "web_searches": 4,
        "claude_requests": 6,
        "counts": RunCounts(researched=2, by_result={"pass": 1, "watch": 1}),
        "stop_reason": None,
        "error": None,
        "error_id": None,
        "cancel_requested_at": None,
        "created_at": at("2026-05-01T00:00:00Z"),
        "started_at": None,
        "finished_at": None,
    }
    return RunOut(**(fields | changes))


class FakeManager:
    """Remembers what the routes asked, and answers with fixed objects."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def list_runs(self, **filters: Any) -> RunPage:
        self.calls.append(("list_runs", filters))
        return RunPage(total=1, items=[make_run_out()])

    async def summary(self, since: date | None = None) -> Any:
        self.calls.append(("summary", since))
        return RunSummary(since=date(2026, 1, 1), days=[], total_cost_usd=D(0), total_runs=0)

    async def get_run(self, run_id: uuid.UUID) -> RunOut:
        self.calls.append(("get_run", run_id))
        if run_id == MISSING:
            raise reads.run_not_found()
        return make_run_out(id=run_id)

    async def event_log(self, run_id: uuid.UUID, after: int = 0, limit: int = 200) -> Any:
        self.calls.append(("event_log", (run_id, after, limit)))
        return EventLog(items=[], last_seq=0)

    async def estimate(self, body: RunCreate) -> RunEstimate:
        self.calls.append(("estimate", body))
        return RunEstimate(
            valid=True, cost_usd_low=D("1.25"), cost_usd_high=D("3"), cap_usd=D("20")
        )


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


@pytest.fixture
def manager(app: FastAPI) -> FakeManager:
    fake = FakeManager()
    app.state.run_manager = fake
    return fake


READ_ROUTES = {
    "POST /api/v1/runs/estimate",
    "GET /api/v1/runs",
    "GET /api/v1/runs/summary",
    "GET /api/v1/runs/{run_id}",
    "GET /api/v1/runs/{run_id}/log",
}


def test_the_five_read_routes_are_built() -> None:
    routes = {label: route for route in api_routes(create_app()) for label in route.labels}
    assert set(routes) >= READ_ROUTES
    assert [label for label in READ_ROUTES if routes[label].is_stub] == []
    assert {label: routes[label].unique_id for label in READ_ROUTES} == {
        "POST /api/v1/runs/estimate": "estimate_run",
        "GET /api/v1/runs": "list_runs",
        "GET /api/v1/runs/summary": "run_summary",
        "GET /api/v1/runs/{run_id}": "get_run",
        "GET /api/v1/runs/{run_id}/log": "get_run_log",
    }


async def test_the_list_route_passes_every_filter_on(
    client: httpx.AsyncClient, manager: FakeManager
) -> None:
    response = await client.get(
        "/api/v1/runs",
        params=[
            ("app", "lead_finder"),
            ("mode", "discovery"),
            ("status", "done"),
            ("status", "failed"),
            ("since", "2026-04-05"),
            ("until", "2026-04-06"),
            ("limit", "10"),
            ("offset", "5"),
        ],
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["cost_usd"] == "1.5"  # money is text in JSON
    assert manager.calls == [
        (
            "list_runs",
            {
                "app": "lead_finder",
                "mode": "discovery",
                "status": ["done", "failed"],
                "since": date(2026, 4, 5),
                "until": date(2026, 4, 6),
                "limit": 10,
                "offset": 5,
            },
        )
    ]


async def test_the_list_route_defaults(client: httpx.AsyncClient, manager: FakeManager) -> None:
    await client.get("/api/v1/runs")
    assert manager.calls == [
        (
            "list_runs",
            {
                "app": None,
                "mode": None,
                "status": None,
                "since": None,
                "until": None,
                "limit": 50,
                "offset": 0,
            },
        )
    ]


@pytest.mark.parametrize(
    "query",
    [
        "limit=0",
        "limit=201",
        "offset=-1",
        "offset=1000001",
        "status=sleeping",
        "since=yesterday",
        "until=2026-13-45",
        "app=%00",
    ],
)
async def test_a_bad_list_query_is_a_422(
    client: httpx.AsyncClient, manager: FakeManager, query: str
) -> None:
    response = await client.get(f"/api/v1/runs?{query}")
    assert response.status_code == 422
    assert manager.calls == []


async def test_summary_is_not_taken_for_a_run_id(
    client: httpx.AsyncClient, manager: FakeManager
) -> None:
    response = await client.get("/api/v1/runs/summary", params={"since": "2026-03-01"})
    assert response.status_code == 200
    assert manager.calls == [("summary", date(2026, 3, 1))]
    assert (await client.get("/api/v1/runs/summary")).status_code == 200
    assert manager.calls[-1] == ("summary", None)


async def test_one_run_and_an_unknown_run(client: httpx.AsyncClient, manager: FakeManager) -> None:
    found = await client.get(f"/api/v1/runs/{uuid.UUID(int=5)}")
    assert found.status_code == 200
    assert found.json()["id"] == str(uuid.UUID(int=5))

    missing = await client.get(f"/api/v1/runs/{MISSING}")
    assert missing.status_code == 404
    assert missing.headers["content-type"].startswith("application/problem+json")
    assert missing.json()["title"] == "Run not found"

    assert (await client.get("/api/v1/runs/not-a-uuid")).status_code == 422


async def test_the_log_route_passes_after_and_limit_on(
    client: httpx.AsyncClient, manager: FakeManager
) -> None:
    run_id = uuid.UUID(int=9)
    response = await client.get(f"/api/v1/runs/{run_id}/log", params={"after": 3, "limit": 25})
    assert response.status_code == 200
    assert response.json() == {"items": [], "last_seq": 0}
    await client.get(f"/api/v1/runs/{run_id}/log")
    assert manager.calls == [("event_log", (run_id, 3, 25)), ("event_log", (run_id, 0, 200))]
    for query in ("after=-1", "after=2147483648", "limit=0", "limit=201"):
        assert (await client.get(f"/api/v1/runs/{run_id}/log?{query}")).status_code == 422


async def test_the_estimate_route_takes_the_body_of_post_runs(
    client: httpx.AsyncClient, manager: FakeManager
) -> None:
    body = {"app": "lead_finder", "mode": "discovery", "params": {"since_days": 7}}
    response = await client.post("/api/v1/runs/estimate", json=body)
    assert response.status_code == 200
    assert response.json()["cost_usd_low"] == "1.25"
    assert manager.calls == [("estimate", RunCreate(**body))]

    wrong = await client.post("/api/v1/runs/estimate", json={**body, "extra": 1})
    assert wrong.status_code == 422  # RunCreate refuses keys it doesn't know


async def test_the_routes_say_so_when_there_is_no_run_manager(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/runs")
    assert response.status_code == 503
    assert response.json()["code"] == "runs_not_ready"


# --- Rows to read (integration) -------------------------------------------------------------------

Factory = async_sessionmaker[AsyncSession]


async def add_run(
    factory: Factory,
    *,
    created_at: datetime | None = None,
    id: uuid.UUID | None = None,
    app: str = "lead_finder",
    mode: str = "discovery",
    status: RunStatus = "done",
    cost: str = "0",
    **fields: Any,
) -> uuid.UUID:
    run_id = id or uuid.uuid4()
    async with factory() as session:
        session.add(
            Run(
                id=run_id,
                app=app,
                mode=mode,
                status=status,
                cost_usd=D(cost),
                created_at=created_at or datetime.now(UTC),
                **fields,
            )
        )
        await session.commit()
    return run_id


async def add_events(factory: Factory, run_id: uuid.UUID, items: Sequence[BaseModel]) -> None:
    async with factory() as session:
        for seq, data in enumerate(items, start=1):
            kind = event_type_of(data)
            session.add(
                RunEventRow(
                    run_id=run_id,
                    seq=seq,
                    type=kind,
                    data=event_data(kind, data),
                    created_at=at("2026-05-01T00:00:00Z") + timedelta(seconds=seq),
                )
            )
        await session.commit()


async def add_search(
    factory: Factory,
    *,
    cost: str,
    step: str = "search:property",
    job_id: uuid.UUID | None = None,
    app: str = "lead_finder",
    created_at: datetime | None = None,
) -> None:
    async with factory() as session:
        session.add(
            SearchLog(
                app=app,
                job_id=job_id,
                step=step,
                model="claude-sonnet-5-5",
                cost_usd=D(cost),
                answer_ok=True,
                created_at=created_at or datetime.now(UTC),
            )
        )
        await session.commit()


async def add_company(
    factory: Factory, costs: Sequence[str], *, app: str = "lead_finder", **when: Any
) -> None:
    """One researched company: a request for each cost, all under one job id (the lead's)."""
    job = uuid.uuid4()
    for index, cost in enumerate(costs):
        step = "extract" if index == len(costs) - 1 else "search:property"
        await add_search(factory, cost=cost, step=step, job_id=job, app=app, **when)


async def add_slice(factory: Factory, costs: Sequence[str], *, app: str = "lead_finder") -> None:
    job = uuid.uuid4()
    for cost in costs:
        await add_search(factory, cost=cost, step="discover", job_id=job, app=app)


# --- One run --------------------------------------------------------------------------------------


@integration
async def test_one_run_comes_back_with_every_field(session_factory: Factory) -> None:
    run_id = await add_run(
        session_factory,
        mode="watchlist",
        status="running",
        cost="1.234567",
        params={"watchlist": {"limit": 5}},
        caps=CAPS.model_dump(mode="json"),
        counts=RunCounts(researched=3, by_result={"pass": 2, "watch": 1}).model_dump(mode="json"),
        rules_version="rules1",
        prompt_versions="research 1a2b",
        web_searches=4,
        claude_requests=6,
        stop_reason="A cap",
        error="Plain words",
        error_id="abc123",
        cancel_requested_at=at("2026-05-01T01:00:00Z"),
        created_at=at("2026-05-01T00:00:00Z"),
        started_at=at("2026-05-01T00:00:05Z"),
        finished_at=at("2026-05-01T02:00:00Z"),
    )
    run = await get_run(session_factory, run_id)
    assert run.id == run_id
    assert (run.app, run.mode, run.status) == ("lead_finder", "watchlist", "running")
    assert run.params == {"watchlist": {"limit": 5}}
    assert run.caps == CAPS
    assert run.counts.researched == 3 and run.counts.by_result == {"pass": 2, "watch": 1}
    assert run.cost_usd == D("1.234567")
    assert (run.web_searches, run.claude_requests) == (4, 6)
    assert (run.rules_version, run.prompt_versions) == ("rules1", "research 1a2b")
    assert (run.stop_reason, run.error, run.error_id) == ("A cap", "Plain words", "abc123")
    assert run.cancel_requested_at == at("2026-05-01T01:00:00Z")
    assert run.created_at == at("2026-05-01T00:00:00Z")
    assert run.started_at == at("2026-05-01T00:00:05Z")
    assert run.finished_at == at("2026-05-01T02:00:00Z")


@integration
async def test_a_run_with_empty_json_columns_still_reads(session_factory: Factory) -> None:
    run_id = await add_run(session_factory)  # caps and counts are `{}` in the row
    run = await get_run(session_factory, run_id)
    assert run.caps == RunCaps()
    assert run.counts == RunCounts()
    assert (run.started_at, run.finished_at, run.stop_reason) == (None, None, None)


@integration
async def test_an_unknown_run_is_a_404_problem(session_factory: Factory) -> None:
    with pytest.raises(Problem) as raised:
        await get_run(session_factory, MISSING)
    assert (raised.value.status, raised.value.title) == (404, "Run not found")


# --- The list -------------------------------------------------------------------------------------


@integration
async def test_runs_are_newest_first_and_ties_break_by_id(session_factory: Factory) -> None:
    same = at("2026-05-01T00:00:00Z")
    for number in (3, 1, 2):
        await add_run(session_factory, id=uuid.UUID(int=number), created_at=same)
    newer = await add_run(session_factory, created_at=at("2026-05-02T00:00:00Z"))
    older = await add_run(session_factory, created_at=at("2026-04-30T00:00:00Z"))

    page = await list_runs(session_factory)
    assert page.total == 5
    assert [run.id for run in page.items] == [
        newer,
        uuid.UUID(int=1),
        uuid.UUID(int=2),
        uuid.UUID(int=3),
        older,
    ]


@integration
async def test_the_list_filters_by_app_mode_and_status(session_factory: Factory) -> None:
    base = at("2026-05-01T00:00:00Z")
    kinds = [
        ("lead_finder", "discovery", "done"),
        ("lead_finder", "discovery", "failed"),
        ("lead_finder", "watchlist", "done"),
        ("lead_finder", "company", "cancelled"),
        ("other_app", "discovery", "done"),
        ("lead_finder", "discovery", "interrupted"),
    ]
    ids: dict[tuple[str, str, str], uuid.UUID] = {}
    for index, (app, mode, status) in enumerate(kinds):
        ids[(app, mode, status)] = await add_run(
            session_factory,
            app=app,
            mode=mode,
            status=cast(RunStatus, status),
            created_at=base + timedelta(minutes=index),
        )

    async def found(**filters: Any) -> set[tuple[str, str, str]]:
        page = await list_runs(session_factory, **filters)
        assert page.total == len(page.items)
        by_id = {value: key for key, value in ids.items()}
        return {by_id[run.id] for run in page.items}

    assert len(await found()) == 6
    assert await found(app="other_app") == {("other_app", "discovery", "done")}
    assert await found(app="nothing") == set()
    assert len(await found(mode="discovery")) == 4
    assert await found(mode="company") == {("lead_finder", "company", "cancelled")}
    assert await found(status=["done"]) == {
        ("lead_finder", "discovery", "done"),
        ("lead_finder", "watchlist", "done"),
        ("other_app", "discovery", "done"),
    }
    assert await found(status=["failed", "interrupted"]) == {
        ("lead_finder", "discovery", "failed"),
        ("lead_finder", "discovery", "interrupted"),
    }
    assert await found(app="lead_finder", mode="discovery", status=["done", "failed"]) == {
        ("lead_finder", "discovery", "done"),
        ("lead_finder", "discovery", "failed"),
    }
    assert len(await found(status=[])) == 6  # no status chosen is no filter


@integration
async def test_pages_follow_one_another_and_the_total_stays(session_factory: Factory) -> None:
    base = at("2026-05-01T00:00:00Z")
    ids = [
        await add_run(session_factory, created_at=base + timedelta(hours=hour)) for hour in range(7)
    ]
    newest_first = list(reversed(ids))

    first = await list_runs(session_factory, limit=3, offset=0)
    second = await list_runs(session_factory, limit=3, offset=3)
    third = await list_runs(session_factory, limit=3, offset=6)
    beyond = await list_runs(session_factory, limit=3, offset=7)
    assert [page.total for page in (first, second, third, beyond)] == [7, 7, 7, 7]
    assert [run.id for run in first.items] == newest_first[0:3]
    assert [run.id for run in second.items] == newest_first[3:6]
    assert [run.id for run in third.items] == newest_first[6:7]
    assert beyond.items == []


@integration
async def test_a_page_is_the_total_of_the_filtered_runs(session_factory: Factory) -> None:
    for index in range(5):
        await add_run(session_factory, mode="company" if index < 2 else "discovery")
    page = await list_runs(session_factory, mode="discovery", limit=1)
    assert (page.total, len(page.items)) == (3, 1)


@integration
async def test_limit_and_offset_out_of_range_are_clamped_not_a_crash(
    session_factory: Factory,
) -> None:
    for _ in range(3):
        await add_run(session_factory)
    assert len((await list_runs(session_factory, limit=0)).items) == 1
    assert len((await list_runs(session_factory, limit=10_000)).items) == 3
    assert len((await list_runs(session_factory, offset=-4)).items) == 3
    assert (await list_runs(session_factory, offset=10**12)).items == []


# --- Melbourne days -------------------------------------------------------------------------------


async def runs_at(factory: Factory, moments: dict[str, str]) -> dict[uuid.UUID, str]:
    """One run for each label, created at the UTC moment. Returns label by run id."""
    return {
        await add_run(factory, created_at=at(moment)): label for label, moment in moments.items()
    }


async def labels_in(
    factory: Factory, names: dict[uuid.UUID, str], since: date | None, until: date | None
) -> set[str]:
    page = await list_runs(factory, since=since, until=until)
    assert page.total == len(page.items)
    return {names[run.id] for run in page.items}


# Clocks go back at 3:00 AEDT on 2026-04-05: that Melbourne day has 25 hours. AEDT is UTC+11
# before it and AEST UTC+10 after it, so the day runs from 04T13:00Z to 05T14:00Z.
DAYLIGHT_ENDS = {
    "apr4_last_second": "2026-04-04T12:59:59Z",  # 23:59:59 on the 4th
    "apr5_first_second": "2026-04-04T13:00:00Z",  # 00:00:00 on the 5th
    "apr5_0230_first": "2026-04-04T15:30:00Z",  # 02:30 AEDT, before the clocks change
    "apr5_0230_second": "2026-04-04T16:30:00Z",  # 02:30 AEST, the same time on the clock again
    "apr5_last_second": "2026-04-05T13:59:59Z",  # 23:59:59 on the 5th
    "apr6_first_second": "2026-04-05T14:00:00Z",  # 00:00:00 on the 6th
}
APR5 = {"apr5_first_second", "apr5_0230_first", "apr5_0230_second", "apr5_last_second"}


@integration
async def test_the_day_the_clocks_go_back_has_25_hours(session_factory: Factory) -> None:
    names = await runs_at(session_factory, DAYLIGHT_ENDS)
    day = date(2026, 4, 5)
    assert await labels_in(session_factory, names, day, day) == APR5
    # both ends are in, and the days next to it are out
    assert await labels_in(session_factory, names, day, None) == APR5 | {"apr6_first_second"}
    assert await labels_in(session_factory, names, None, day) == APR5 | {"apr4_last_second"}
    assert await labels_in(session_factory, names, date(2026, 4, 4), date(2026, 4, 4)) == {
        "apr4_last_second"
    }
    assert await labels_in(session_factory, names, date(2026, 4, 6), date(2026, 4, 6)) == {
        "apr6_first_second"
    }


# Clocks go forward at 2:00 AEST on 2026-10-04: that Melbourne day has 23 hours. It runs from
# 03T14:00Z (AEST, UTC+10) to 04T13:00Z (AEDT, UTC+11).
DAYLIGHT_STARTS = {
    "oct3_last_second": "2026-10-03T13:59:59Z",  # 23:59:59 on the 3rd
    "oct4_first_second": "2026-10-03T14:00:00Z",  # 00:00:00 on the 4th
    "oct4_0159": "2026-10-03T15:59:00Z",  # 01:59 AEST, the last minute before the jump
    "oct4_0300": "2026-10-03T16:00:00Z",  # 03:00 AEDT, the first minute after it
    "oct4_last_second": "2026-10-04T12:59:59Z",  # 23:59:59 on the 4th
    "oct5_first_second": "2026-10-04T13:00:00Z",  # 00:00:00 on the 5th
}
OCT4 = {"oct4_first_second", "oct4_0159", "oct4_0300", "oct4_last_second"}


@integration
async def test_the_day_the_clocks_go_forward_has_23_hours(session_factory: Factory) -> None:
    names = await runs_at(session_factory, DAYLIGHT_STARTS)
    day = date(2026, 10, 4)
    assert await labels_in(session_factory, names, day, day) == OCT4
    assert await labels_in(session_factory, names, day, None) == OCT4 | {"oct5_first_second"}
    assert await labels_in(session_factory, names, None, day) == OCT4 | {"oct3_last_second"}
    assert await labels_in(session_factory, names, date(2026, 10, 3), date(2026, 10, 3)) == {
        "oct3_last_second"
    }
    assert await labels_in(session_factory, names, date(2026, 10, 5), date(2026, 10, 5)) == {
        "oct5_first_second"
    }


@integration
async def test_a_utc_evening_is_already_the_next_day_in_melbourne(session_factory: Factory) -> None:
    """Created 2026-07-01 20:00 UTC, which is 06:00 on the 2nd in Melbourne (UTC+10 in winter)."""
    run_id = await add_run(session_factory, created_at=at("2026-07-01T20:00:00Z"))
    first = date(2026, 7, 1)
    second = date(2026, 7, 2)
    assert (await list_runs(session_factory, since=first, until=first)).items == []
    page = await list_runs(session_factory, since=second, until=second)
    assert [run.id for run in page.items] == [run_id]


@integration
async def test_a_range_of_days_is_inclusive_at_both_ends(session_factory: Factory) -> None:
    names = await runs_at(
        session_factory,
        {
            "before": "2026-06-09T13:59:59Z",  # 23:59:59 on 9 June in Melbourne (UTC+10)
            "start": "2026-06-09T14:00:00Z",  # 00:00:00 on 10 June
            "middle": "2026-06-11T03:00:00Z",
            "end": "2026-06-12T13:59:59Z",  # 23:59:59 on 12 June
            "after": "2026-06-12T14:00:00Z",  # 00:00:00 on 13 June
        },
    )
    found = await labels_in(session_factory, names, date(2026, 6, 10), date(2026, 6, 12))
    assert found == {"start", "middle", "end"}
    assert await labels_in(session_factory, names, date(2026, 6, 12), date(2026, 6, 10)) == set()


@integration
async def test_extreme_dates_do_not_overflow(session_factory: Factory) -> None:
    names = await runs_at(
        session_factory, {"one": "2026-04-05T00:00:00Z", "two": "2026-10-04T00:00:00Z"}
    )
    everything = {"one", "two"}
    assert await labels_in(session_factory, names, date.min, date.max) == everything
    assert await labels_in(session_factory, names, date.min, None) == everything
    assert await labels_in(session_factory, names, None, date.max) == everything
    assert await labels_in(session_factory, names, date.max, None) == set()
    assert await labels_in(session_factory, names, None, date.min) == set()
    assert await labels_in(session_factory, names, date.max, date.max) == set()
    assert (await summary(session_factory, date.max)).days == []
    assert len((await summary(session_factory, date.min)).days) == 2


# --- The log --------------------------------------------------------------------------------------

EVENTS: list[BaseModel] = [
    RunStartedData(mode="discovery", caps=CAPS, rules_version="rules1"),
    PlanReadyData(slices=2, companies=0, labels=["Melbourne: lease", "Perth: lease"]),
    SliceDoneData(slice_id="s1", label="Melbourne: lease", found=3, cost_usd=D("0.31"), searches=2),
    MergedData(candidates=5, unique=4),
    RunFinishedData(status="done", stop_reason=None, cost_usd=D("1.5"), counts=RunCounts()),
]


@integration
async def test_the_log_is_oldest_first_and_typed(session_factory: Factory) -> None:
    run_id = await add_run(session_factory)
    await add_events(session_factory, run_id, EVENTS)

    log = await event_log(session_factory, run_id)
    assert [item.seq for item in log.items] == [1, 2, 3, 4, 5]
    assert [item.type for item in log.items] == [
        "run_started",
        "plan_ready",
        "slice_done",
        "merged",
        "run_finished",
    ]
    assert log.last_seq == 5
    assert [dump_event(item)["data"] for item in log.items] == [
        data.model_dump(mode="json") for data in EVENTS
    ]
    # the same JSON the live stream sends: built from the model, it is identical
    live = build_event(3, "slice_done", EVENTS[2], at("2026-05-01T00:00:03Z"))
    assert dump_event(log.items[2]) == dump_event(live)
    assert dump_event(log.items[2])["data"]["cost_usd"] == "0.31"  # money is text


@integration
async def test_the_log_reads_on_after_a_seq_and_stops_at_the_limit(
    session_factory: Factory,
) -> None:
    run_id = await add_run(session_factory)
    await add_events(session_factory, run_id, EVENTS)

    first = await event_log(session_factory, run_id, after=0, limit=2)
    assert [item.seq for item in first.items] == [1, 2]
    assert first.last_seq == 5  # the run has more: read on
    second = await event_log(session_factory, run_id, after=first.items[-1].seq, limit=2)
    assert [item.seq for item in second.items] == [3, 4]
    third = await event_log(session_factory, run_id, after=4, limit=2)
    assert [item.seq for item in third.items] == [5]
    done = await event_log(session_factory, run_id, after=5)
    assert (done.items, done.last_seq) == ([], 5)
    far = await event_log(session_factory, run_id, after=2_147_483_647)
    assert (far.items, far.last_seq) == ([], 5)


@integration
async def test_the_log_only_has_the_events_of_its_own_run(session_factory: Factory) -> None:
    mine = await add_run(session_factory)
    other = await add_run(session_factory)
    await add_events(session_factory, mine, EVENTS[:2])
    await add_events(session_factory, other, EVENTS)
    log = await event_log(session_factory, mine)
    assert [item.seq for item in log.items] == [1, 2]
    assert log.last_seq == 2


@integration
async def test_a_run_with_no_events_has_an_empty_log(session_factory: Factory) -> None:
    run_id = await add_run(session_factory)
    log = await event_log(session_factory, run_id)
    assert (log.items, log.last_seq) == ([], 0)


@integration
async def test_the_log_of_an_unknown_run_is_a_404(session_factory: Factory) -> None:
    with pytest.raises(Problem) as raised:
        await event_log(session_factory, MISSING)
    assert raised.value.status == 404


# --- Cost by day ----------------------------------------------------------------------------------


@integration
async def test_the_summary_groups_by_melbourne_day_and_leaves_empty_days_out(
    session_factory: Factory,
) -> None:
    for moment, cost, status in [
        ("2026-04-04T12:59:59Z", "1", "done"),  # the 4th, 23:59:59
        ("2026-04-04T13:00:00Z", "2", "done"),  # the 5th, 00:00:00
        ("2026-04-05T13:59:59Z", "3.5", "failed"),  # the 5th, 23:59:59
        ("2026-04-05T14:00:00Z", "4", "cancelled"),  # the 6th
        ("2026-04-10T00:00:00Z", "0.25", "queued"),  # the 10th: 7th to 9th have no run
    ]:
        await add_run(
            session_factory,
            created_at=at(moment),
            cost=cost,
            status=cast(RunStatus, status),
        )

    result = await summary(session_factory, since=date(2026, 4, 4))
    assert result.since == date(2026, 4, 4)
    assert [(day.date, day.cost_usd, day.runs) for day in result.days] == [
        (date(2026, 4, 4), D("1"), 1),
        (date(2026, 4, 5), D("5.5"), 2),
        (date(2026, 4, 6), D("4"), 1),
        (date(2026, 4, 10), D("0.25"), 1),
    ]
    assert (result.total_cost_usd, result.total_runs) == (D("10.75"), 5)

    later = await summary(session_factory, since=date(2026, 4, 5))
    assert [day.date for day in later.days] == [
        date(2026, 4, 5),
        date(2026, 4, 6),
        date(2026, 4, 10),
    ]
    assert (later.total_cost_usd, later.total_runs) == (D("9.75"), 4)


@integration
async def test_the_summary_of_no_runs_is_empty_with_zero_totals(session_factory: Factory) -> None:
    result = await summary(session_factory, since=date(2026, 1, 1))
    assert (result.days, result.total_cost_usd, result.total_runs) == ([], D(0), 0)
    assert (await summary(session_factory)).days == []


@integration
async def test_the_summary_starts_30_days_ago_by_default(session_factory: Factory) -> None:
    now = datetime.now(UTC)
    await add_run(session_factory, created_at=now, cost="1")
    await add_run(session_factory, created_at=now - timedelta(days=20), cost="2")
    await add_run(session_factory, created_at=now - timedelta(days=40), cost="4")

    result = await summary(session_factory)
    # Melbourne is 10 or 11 hours ahead of UTC, so its date is today's UTC date or the next one.
    today_utc = now.date()
    assert result.since in {today_utc - timedelta(days=30), today_utc - timedelta(days=29)}
    assert (result.total_runs, result.total_cost_usd) == (2, D("3"))
    assert [day.cost_usd for day in result.days] == [D("2"), D("1")]  # oldest first


@integration
async def test_the_summary_counts_every_app_and_status(session_factory: Factory) -> None:
    moment = at("2026-05-01T00:00:00Z")
    await add_run(session_factory, created_at=moment, cost="1", app="lead_finder")
    await add_run(session_factory, created_at=moment, cost="2", app="other_app")
    await add_run(session_factory, created_at=moment, cost="4", status="interrupted")
    result = await summary(session_factory, since=date(2026, 5, 1))
    assert [(day.runs, day.cost_usd) for day in result.days] == [(3, D("7"))]


# --- The estimate's reads: the last 24 hours and the history --------------------------------------


@integration
async def test_what_was_spent_in_the_last_24_hours(session_factory: Factory) -> None:
    now = datetime.now(UTC)
    async with session_factory() as session:
        assert await spent_last_24h(session) == D(0)  # nothing logged

    await add_search(session_factory, cost="1.5", created_at=now - timedelta(hours=23, minutes=55))
    await add_search(session_factory, cost="2.25", created_at=now - timedelta(hours=1))
    await add_search(session_factory, cost="0.25", app="other_app", created_at=now)
    await add_search(session_factory, cost="9", created_at=now - timedelta(hours=24, minutes=5))
    await add_search(session_factory, cost="9", created_at=now - timedelta(days=3))
    async with session_factory() as session:
        assert await spent_last_24h(session) == D("4.0")


@integration
async def test_an_average_needs_five_finished_companies_and_five_slices(
    session_factory: Factory,
) -> None:
    # Four companies: not enough.
    for costs in (["0.20", "0.30"], ["1.00"], ["1.50"], ["2.00"]):
        await add_company(session_factory, costs)
    for costs in (["0.20"], ["0.30"], ["0.40"], ["0.50"]):
        await add_slice(session_factory, costs)
    async with session_factory() as session:
        four = await load_unit_costs(session, "lead_finder")
    assert (four.company_usd, four.company_samples) == (DEFAULT_COMPANY_USD, 0)
    assert (four.slice_usd, four.slice_samples) == (DEFAULT_SLICE_USD, 0)
    assert not four.from_history

    # The fifth of each: the average is used. A company's cost is all its requests together.
    await add_company(session_factory, ["1.00"])
    await add_slice(session_factory, ["0.05", "0.05"])  # one slice, two requests: 0.10
    async with session_factory() as session:
        five = await load_unit_costs(session, "lead_finder")
    assert (five.company_samples, five.company_usd) == (5, D("1.2"))  # (0.5+1+1.5+2+1)/5
    assert (five.slice_samples, five.slice_usd) == (5, D("0.3"))  # (0.2+0.3+0.4+0.5+0.1)/5
    assert five.from_history


@integration
async def test_the_average_ignores_other_apps_and_rows_with_no_job(
    session_factory: Factory,
) -> None:
    for _ in range(5):
        await add_company(session_factory, ["1.00"])
        await add_company(session_factory, ["50"], app="other_app")
        await add_slice(session_factory, ["0.20"], app="other_app")
        await add_search(session_factory, cost="40", job_id=None)  # no job: a loose request
        await add_search(session_factory, cost="40", step="discover", job_id=None)
    async with session_factory() as session:
        costs = await load_unit_costs(session, "lead_finder")
        other = await load_unit_costs(session, "other_app")
    assert (costs.company_usd, costs.company_samples) == (D("1"), 5)
    assert (costs.slice_usd, costs.slice_samples) == (DEFAULT_SLICE_USD, 0)  # no slices of its own
    assert (other.company_usd, other.company_samples) == (D("50"), 5)
    assert (other.slice_usd, other.slice_samples) == (D("0.2"), 5)


@integration
async def test_the_average_looks_at_the_latest_companies_only(session_factory: Factory) -> None:
    start = datetime.now(UTC) - timedelta(days=2)
    for index in range(SAMPLE_WINDOW + 5):
        old = index < 5  # the five oldest were costly, with an older prompt
        await add_company(
            session_factory, ["100" if old else "1"], created_at=start + timedelta(minutes=index)
        )
    async with session_factory() as session:
        costs = await load_unit_costs(session, "lead_finder")
    assert (costs.company_samples, costs.company_usd) == (SAMPLE_WINDOW, D("1"))


# --- estimate_run on the real database ------------------------------------------------------------


class ToyParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    names: list[str] = Field(default_factory=list)


def toy_kind(seen: list[EstimateContext[ToyParams]]) -> RunKind[ToyParams]:
    async def handler(ctx: Any) -> Any:
        raise AssertionError("an estimate never runs a handler")

    async def estimate(ctx: EstimateContext[ToyParams]) -> RunEstimate:
        seen.append(ctx)
        return RunEstimate(
            valid=True,
            companies_expected=len(ctx.params.names),
            cost_usd_low=ctx.unit_costs.company_usd * len(ctx.params.names),
            cost_usd_high=ctx.unit_costs.company_usd * len(ctx.params.names) * 2,
        )

    return RunKind(
        mode="toy", title="A toy", params_model=ToyParams, handler=handler, estimate=estimate
    )


def settings_of(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


async def estimate_with(
    factory: Factory,
    seen: list[EstimateContext[ToyParams]],
    params: dict[str, Any],
    settings: Settings,
) -> RunEstimate:
    async def provider() -> Settings:
        return settings

    return await estimate_run(
        RunCreate(app="lead_finder", mode="toy", params=params),
        kinds={("lead_finder", "toy"): toy_kind(seen)},
        session_factory=factory,
        settings_provider=provider,
    )


@integration
async def test_the_estimate_uses_the_history_and_the_daily_total(session_factory: Factory) -> None:
    for costs in (["1.00"], ["2.00"], ["1.50"], ["0.50"], ["1.00"]):  # average 1.20
        await add_company(session_factory, costs)
    seen: list[EstimateContext[ToyParams]] = []
    settings = settings_of(run_cap_usd=D("20"), daily_cap_usd=D("12.00"))
    result = await estimate_with(session_factory, seen, {"names": ["A", "B", "C"]}, settings)

    # 6.00 was logged in the last 24 hours (the five companies), so 6.00 of the 12.00 is left.
    assert result.daily_left_usd == D("6.00")
    assert result.cap_usd == D("20.00")
    assert (result.companies_expected, result.cost_usd_low) == (3, D("3.600000"))
    assert (seen[0].unit_costs.company_usd, seen[0].unit_costs.company_samples) == (D("1.2"), 5)
    assert seen[0].daily_left_usd == D("6.00")
    assert "the average of 5 past companies" in result.basis


@integration
async def test_the_estimate_with_no_history_uses_the_defaults(session_factory: Factory) -> None:
    seen: list[EstimateContext[ToyParams]] = []
    result = await estimate_with(
        session_factory, seen, {"names": ["A"]}, settings_of(daily_cap_usd=D("50"))
    )
    assert result.daily_left_usd == D("50")
    assert seen[0].unit_costs.company_usd == DEFAULT_COMPANY_USD
    assert result.cost_usd_low == DEFAULT_COMPANY_USD
    assert "a default" in result.basis


@integration
async def test_nothing_left_today_is_zero_not_negative(session_factory: Factory) -> None:
    await add_company(session_factory, ["7.50"])
    seen: list[EstimateContext[ToyParams]] = []
    result = await estimate_with(session_factory, seen, {}, settings_of(daily_cap_usd=D("5")))
    assert result.daily_left_usd == D(0)
    assert result.valid is True


@integration
async def test_an_invalid_estimate_still_shows_the_daily_total(session_factory: Factory) -> None:
    await add_company(session_factory, ["1.25"])
    seen: list[EstimateContext[ToyParams]] = []
    result = await estimate_with(
        session_factory, seen, {"names": "not a list"}, settings_of(daily_cap_usd=D("5"))
    )
    assert result.valid is False
    assert [error.field for error in result.errors] == ["body.params.names"]
    assert result.daily_left_usd == D("3.75")
    assert seen == []


@integration
async def test_an_estimate_never_starts_a_run_or_writes_a_row(session_factory: Factory) -> None:
    await add_company(session_factory, ["1"])
    seen: list[EstimateContext[ToyParams]] = []
    await estimate_with(session_factory, seen, {"names": ["A"]}, settings_of())
    async with session_factory() as session:
        assert (await session.scalars(select(Run.id))).all() == []
        assert len((await session.scalars(select(SearchLog.id))).all()) == 1
    assert (await list_runs(session_factory)).total == 0


# --- The routes, with the real manager and the real database --------------------------------------


@pytest.fixture
async def live_client(app: FastAPI, session_factory: Factory) -> AsyncIterator[httpx.AsyncClient]:
    seen: list[EstimateContext[ToyParams]] = []

    async def provider() -> Settings:
        return settings_of(run_cap_usd=D("20"), daily_cap_usd=D("50"))

    app.state.run_manager = RunManager(
        session_factory=session_factory,
        embedder=cast(Any, None),
        claude_provider=lambda: cast(Any, None),
        checkpointer_source=cast(Any, None),
        settings_provider=provider,
        kinds={("lead_finder", "toy"): toy_kind(seen)},
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


@integration
async def test_the_read_routes_end_to_end(
    live_client: httpx.AsyncClient, session_factory: Factory
) -> None:
    older = await add_run(session_factory, created_at=at("2026-04-04T13:00:00Z"), cost="2.5")
    newer = await add_run(
        session_factory, created_at=at("2026-06-01T00:00:00Z"), cost="1", status="failed"
    )
    await add_events(session_factory, newer, EVENTS)

    listed = (await live_client.get("/api/v1/runs")).json()
    assert [item["id"] for item in listed["items"]] == [str(newer), str(older)]
    assert listed["total"] == 2
    assert listed["items"][1]["cost_usd"] == "2.500000"

    one_day = (
        await live_client.get("/api/v1/runs", params={"since": "2026-04-05", "until": "2026-04-05"})
    ).json()
    assert [item["id"] for item in one_day["items"]] == [str(older)]  # the 5th in Melbourne
    failed = (await live_client.get("/api/v1/runs", params={"status": ["failed", "queued"]})).json()
    assert [item["id"] for item in failed["items"]] == [str(newer)]

    one = await live_client.get(f"/api/v1/runs/{older}")
    assert one.status_code == 200 and one.json()["status"] == "done"
    assert (await live_client.get(f"/api/v1/runs/{MISSING}")).status_code == 404

    log = (await live_client.get(f"/api/v1/runs/{newer}/log", params={"after": 2})).json()
    assert [item["seq"] for item in log["items"]] == [3, 4, 5]
    assert log["last_seq"] == 5
    assert log["items"][-1]["type"] == "run_finished"
    assert (await live_client.get(f"/api/v1/runs/{MISSING}/log")).status_code == 404

    days = (await live_client.get("/api/v1/runs/summary", params={"since": "2026-01-01"})).json()
    assert days["since"] == "2026-01-01"
    assert [(day["date"], day["cost_usd"], day["runs"]) for day in days["days"]] == [
        ("2026-04-05", "2.500000", 1),
        ("2026-06-01", "1.000000", 1),
    ]
    assert (days["total_cost_usd"], days["total_runs"]) == ("3.500000", 2)


@integration
async def test_the_estimate_route_end_to_end(live_client: httpx.AsyncClient) -> None:
    good = await live_client.post(
        "/api/v1/runs/estimate",
        json={"app": "lead_finder", "mode": "toy", "params": {"names": ["A", "B"]}},
    )
    assert good.status_code == 200
    body = good.json()
    assert body["valid"] is True and body["errors"] == []
    assert (body["cost_usd_low"], body["cost_usd_high"]) == ("2.00", "4.00")
    assert (D(body["cap_usd"]), D(body["daily_left_usd"])) == (D("20"), D("50"))

    bad = await live_client.post(
        "/api/v1/runs/estimate",
        json={"app": "lead_finder", "mode": "toy", "params": {"names": 5, "oops": 1}},
    )
    assert bad.status_code == 200  # an invalid body is a normal answer
    assert bad.json()["valid"] is False
    assert {error["field"] for error in bad.json()["errors"]} == {
        "body.params.names",
        "body.params.oops",
    }

    unknown = await live_client.post(
        "/api/v1/runs/estimate", json={"app": "lead_finder", "mode": "nope", "params": {}}
    )
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "unknown_run_kind"
