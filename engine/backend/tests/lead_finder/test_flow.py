"""End to end over HTTP: what a person does on the website, in the order they do it.

Start from the Start page's defaults, let the run finish, filter the results, open a lead with its
look-alikes, mark it, download the CSV, and read the search log. Claude is the fake backend's
FakeClaude (`tests/e2e/serve.py`), so this also checks the sample world the website is clicked
through with. Plus two rules that cross the API and the run engine: a setting changed on the
Settings page reaches Claude, and a HubSpot watchlist run can't be resumed once the approval is
taken back.

Integration: the test database and the memory model.
"""

import csv
import io
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import date
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.runs import NOT_APPROVED_CODE
from core.api.app import create_app
from core.api.errors import Problem
from core.config import Settings
from core.db.engine import get_session
from core.hubspot.importer import read_export
from core.hubspot.service import save_export
from core.prefs.service import effective_settings
from core.runs.manager import RunManager
from tests.core.conftest import MemorySource
from tests.core.runs_fakes import wait_until_idle
from tests.e2e.serve import EXPORT, fake_claude
from tests.lead_finder.conftest import RUN_DAY, MakeLeadFinderManager, lf_settings
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration

API = "/api/v1"
LF = f"{API}/lead-finder"

type SettingsProvider = Callable[[], Awaitable[Settings]]


def from_database(
    factory: async_sessionmaker[AsyncSession], base: Settings | None = None
) -> SettingsProvider:
    """The settings a run uses: the base, then what the Settings page saved (as the app does)."""

    async def provider() -> Settings:
        async with factory() as session:
            return await effective_settings(session, base=base or lf_settings())

    return provider


def make_app(manager: RunManager, factory: async_sessionmaker[AsyncSession]) -> FastAPI:
    app = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = test_session
    app.state.run_manager = manager
    return app


@pytest.fixture
def claude() -> FakeClaude:
    return fake_claude(date.fromisoformat(RUN_DAY), delay_seconds=0)


@pytest.fixture
def manager(
    make_lf_manager: MakeLeadFinderManager,
    claude: FakeClaude,
    session_factory: async_sessionmaker[AsyncSession],
) -> RunManager:
    return make_lf_manager(claude, settings_provider=from_database(session_factory))


@pytest.fixture
async def client(
    manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=make_app(manager, session_factory))
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def ok(response: Awaitable[httpx.Response], status: int = 200) -> Any:
    answer = await response
    assert answer.status_code == status, answer.text
    return answer.json() if "json" in answer.headers.get("content-type", "") else answer.text


async def run_to_the_end(
    client: httpx.AsyncClient, manager: RunManager, params: dict[str, Any]
) -> dict[str, Any]:
    body = {"app": "lead_finder", "mode": "discovery", "params": params}
    run = await ok(
        client.post(f"{API}/runs", json=body, headers={"Idempotency-Key": str(uuid.uuid4())}),
        201,
    )
    await wait_until_idle(manager, timeout=60)
    finished: dict[str, Any] = await ok(client.get(f"{API}/runs/{run['id']}"))
    return finished


async def test_start_watch_filter_open_mark_and_download(
    client: httpx.AsyncClient, manager: RunManager
) -> None:
    options = await ok(client.get(f"{LF}/run-options"))
    # What the Start page sends for "Find new leads" with nothing changed.
    defaults = options["defaults"]
    params = {key: defaults[key] for key in ("cities", "triggers", "since_days", "area")}
    estimate = await ok(
        client.post(
            f"{API}/runs/estimate",
            json={"app": "lead_finder", "mode": "discovery", "params": params},
        )
    )
    # The worst case is over the run cap (the page says so); the run stops at the cap.
    assert estimate["valid"] and estimate["blocked"] is None, estimate

    run = await run_to_the_end(client, manager, params)
    assert run["status"] == "done"
    assert run["counts"]["slices"] == 12
    assert run["counts"]["researched"] == 8
    run_id = run["id"]

    # The results of this run, best first: every result is there, all sample companies.
    page = await ok(client.get(f"{LF}/leads", params={"run_id": run_id}))
    assert page["total"] == 8
    assert all(row["company"].startswith("Sample ") for row in page["items"])
    assert {row["result"] for row in page["items"]} == {
        "pass",
        "director_review",
        "watch",
        "drop",
    }
    scores = [row["score"] for row in page["items"]]
    assert scores == sorted(scores, reverse=True)

    # Filters as the Results page sends them, with the facets and the map agreeing.
    passing = await ok(client.get(f"{LF}/leads", params={"run_id": run_id, "result": "pass"}))
    assert passing["total"] >= 1 and all(row["result"] == "pass" for row in passing["items"])
    perth = await ok(client.get(f"{LF}/leads", params={"run_id": run_id, "city": "Perth"}))
    assert {row["company"] for row in perth["items"]} == {
        "Sample Energy",
        "Sample Mining Services",
    }
    facets = await ok(client.get(f"{LF}/leads/facets", params={"run_id": run_id}))
    assert sum(item["count"] for item in facets["result"]) == 8
    pins = await ok(client.get(f"{LF}/leads/map", params={"run_id": run_id}))
    assert pins["total"] == 8 and len(pins["items"]) == 8

    # Open the best lead: its card, and its look-alikes.
    best = page["items"][0]
    card = await ok(client.get(f"{LF}/leads/{best['id']}"))
    assert card["company"] == best["company"]
    assert card["checks"] and card["notes"]
    similar = await ok(client.get(f"{LF}/leads/{best['id']}/similar"))
    assert similar["basis"] in {"profile", "none"}

    # Mark it, and find it under the Watching filter.
    marked = await ok(client.patch(f"{LF}/leads/{best['id']}", json={"status": "watching"}))
    assert marked["status"] == "watching"
    watching = await ok(client.get(f"{LF}/leads", params={"run_id": run_id, "status": "watching"}))
    assert [row["id"] for row in watching["items"]] == [best["id"]]

    # The CSV of what the table shows.
    text = await ok(client.get(f"{LF}/leads/export", params={"run_id": run_id}))
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    assert len(rows) == 8
    assert {row["company"] for row in rows} == {row["company"] for row in page["items"]}

    # The search log: every request of the run, counted once, and the cost adds up.
    log = await ok(client.get(f"{API}/searches", params={"run_id": run_id, "limit": 200}))
    assert log["total"] == run["claude_requests"]
    assert all(item["run_id"] == run_id for item in log["items"])


async def test_a_model_changed_on_the_settings_page_reaches_claude(
    client: httpx.AsyncClient, manager: RunManager, claude: FakeClaude
) -> None:
    await ok(
        client.patch(f"{API}/settings", json={"values": {"model_discover": "claude-haiku-5-5"}})
    )

    run = await run_to_the_end(
        client, manager, {"cities": ["Perth"], "triggers": ["fast_growth"], "since_days": 30}
    )

    assert run["status"] == "done"
    log = await ok(client.get(f"{API}/searches", params={"run_id": run["id"], "limit": 200}))
    models = {(item["step"].split(":")[0], item["model"]) for item in log["items"]}
    assert ("discover", "claude-haiku-5-5") in models
    assert ("search", "claude-opus-5-5") in models
    assert {call.model for call in claude.requests if call.step == "discover"} == {
        "claude-haiku-5-5"
    }


@pytest.mark.skipif(not EXPORT.exists(), reason="the HubSpot export is not in the repo")
async def test_a_watchlist_run_is_not_resumed_once_the_hubspot_ok_is_taken_back(
    make_lf_manager: MakeLeadFinderManager,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
) -> None:
    await save_export(session, read_export(EXPORT))
    source = MemorySource()  # the checkpoints survive the "process"
    approved = lf_settings(hubspot_names_to_claude_ok=True, run_max_companies=3)
    first = make_lf_manager(FakeClaude(crash_after_extracts=1), settings=approved, source=source)
    run = await first.start("lead_finder", "watchlist", {})
    await wait_until_idle(first, timeout=60)

    taken_back = lf_settings(hubspot_names_to_claude_ok=False, run_max_companies=3)
    second = make_lf_manager(FakeClaude(), settings=taken_back, source=source)
    assert await second.recover() == 1
    with pytest.raises(Problem) as refused:
        await second.resume(run.id)

    assert (refused.value.status, refused.value.code) == (409, NOT_APPROVED_CODE)
