"""The Lead Finder's run routes: run options, re-check, and the test set (start, list, report).

Integration: the routes read and start runs on the test database, with a FakeClaude.
"""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.db.engine import get_session
from core.runs.manager import RunManager
from tests.core.runs_fakes import wait_until_idle
from tests.lead_finder.conftest import MakeLeadFinderManager
from tests.lead_finder.factories import add_all, make_lead
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration

LF = "/api/v1/lead-finder"


@pytest.fixture
def manager(make_lf_manager: MakeLeadFinderManager) -> RunManager:
    return make_lf_manager(FakeClaude())


@pytest.fixture
def app(manager: RunManager, session_factory: async_sessionmaker[AsyncSession]) -> FastAPI:
    created = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    created.dependency_overrides[get_session] = test_session
    created.state.run_manager = manager
    return created


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def test_the_run_options_have_everything_the_start_page_draws(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(f"{LF}/run-options")
    assert response.status_code == 200
    body = response.json()
    cities = {city["name"]: city for city in body["cities"]}
    assert list(cities) == ["Melbourne", "Adelaide", "Perth", "Sydney"]
    assert cities["Sydney"]["kind"] == "director_review"
    assert cities["Melbourne"]["kind"] == "pass"
    assert round(cities["Perth"]["lat"], 2) == -31.95
    areas = {area["id"]: area for area in cities["Melbourne"]["areas"]}
    assert list(areas) == ["cbd", "inner", "all"]
    assert "Docklands" in areas["cbd"]["suburbs"] and areas["all"]["suburbs"] == []
    defaults = [t["id"] for t in body["triggers"] if t["default"]]
    assert defaults == ["lease_ending", "merger_or_takeover", "big_new_contract", "fast_growth"]
    assert body["since_days"] == {"choices": [7, 30], "default": 30}
    modes = {mode["mode"]: mode for mode in body["modes"]}
    assert modes["watchlist"]["needs_approval"] is True
    assert modes["watchlist"]["approved"] is False  # no OK from Levi in the test settings
    assert modes["discovery"]["approved"] is True
    assert body["companies_limit"] == {"min": 1, "max": 25}
    assert body["defaults"]["cities"] == ["Melbourne", "Adelaide", "Perth"]
    assert set(body["caps"]) == {
        "run_cap_usd",
        "max_companies",
        "company_cap_usd",
        "daily_left_usd",
    }


async def test_a_recheck_starts_a_one_company_run_that_searches_again(
    client: httpx.AsyncClient, manager: RunManager, session: AsyncSession
) -> None:
    lead = make_lead("Acme Software", city="Melbourne", domain="acme.com.au")
    await add_all(session, lead)

    response = await client.post(f"{LF}/leads/{lead.id}/recheck")

    assert response.status_code == 201, response.text
    run = response.json()
    assert response.headers["location"] == f"/api/v1/runs/{run['id']}"
    assert (run["app"], run["mode"]) == ("lead_finder", "company")
    assert run["params"]["recheck"] is True
    assert run["params"]["companies"] == [
        {"name": "Acme Software", "city": "Melbourne", "website": "acme.com.au"}
    ]
    await wait_until_idle(manager, timeout=60)


async def test_a_recheck_of_an_unknown_lead_is_a_404(client: httpx.AsyncClient) -> None:
    response = await client.post(f"{LF}/leads/{uuid.uuid4()}/recheck")
    assert response.status_code == 404


async def test_a_recheck_of_a_hubspot_company_waits_for_the_ok(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Patties Food Group", origin="hubspot")
    await add_all(session, lead)
    response = await client.post(f"{LF}/leads/{lead.id}/recheck")
    assert response.status_code == 409
    assert response.json()["code"] == "hubspot_names_not_approved"


async def test_the_test_set_starts_lists_and_reports(
    client: httpx.AsyncClient, manager: RunManager
) -> None:
    started = await client.post(f"{LF}/tests/run")
    assert started.status_code == 201, started.text
    run_id = started.json()["id"]
    assert started.json()["mode"] == "testset"
    await wait_until_idle(manager, timeout=120)

    listed = (await client.get(f"{LF}/tests")).json()
    assert listed["total"] == 1
    summary: dict[str, Any] = listed["items"][0]
    assert (summary["run_id"], summary["companies"], summary["expected"]) == (run_id, 10, 1)

    report = (await client.get(f"{LF}/tests/{run_id}")).json()
    assert len(report["items"]) == 10
    assert {item["name"] for item in report["items"]} >= {"Culture Amp", "Canva"}
    assert all(item["lead_id"] for item in report["items"])

    missing = await client.get(f"{LF}/tests/{uuid.uuid4()}")
    assert missing.status_code == 404
    paged = await client.get(f"{LF}/tests", params={"limit": 1, "offset": 1})
    assert paged.json() == {"total": 1, "items": []}


async def test_a_run_that_is_not_a_test_set_has_no_test_report(
    client: httpx.AsyncClient, session: AsyncSession, manager: RunManager
) -> None:
    run = await manager.start("lead_finder", "company", {"companies": [{"name": "Acme Software"}]})
    await wait_until_idle(manager, timeout=60)
    response = await client.get(f"{LF}/tests/{run.id}")
    assert response.status_code == 404
    assert await session.get(Lead, uuid.uuid4()) is None
