"""The Schedules endpoints with the Lead Finder's real job (PLAN-V6 D3): what the Admin page reads
and does. The run's own work is the stand-in from `jobs_world.py`; the estimate, the limits, the
slot and the start are the real ones.
"""

import uuid
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.jobs import DISCOVERY
from core.api.app import create_app
from core.db.engine import get_session
from core.runs.manager import RunManager
from core.schedules.runner import Scheduler
from core.schedules.runtime import all_jobs
from tests.core.auth_world import Clock
from tests.core.runs_fakes import wait_until_idle
from tests.lead_finder.conftest import MakeLeadFinderManager, lf_settings
from tests.lead_finder.jobs_world import (
    NOW,
    Factory,
    Gate,
    add_past_prices,
    all_runs,
    the_schedule,
    waiting_kinds,
)
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration

URL = "/api/v1/schedules"


@pytest.fixture
def gate() -> Gate:
    return Gate()


@pytest.fixture
def limits() -> dict[str, Any]:
    """Settings for the test's manager. A test that needs a lower limit overrides this with
    `@pytest.mark.parametrize("limits", [...])`."""
    return {}


@pytest.fixture
def manager(
    make_lf_manager: MakeLeadFinderManager, gate: Gate, limits: dict[str, Any]
) -> RunManager:
    return make_lf_manager(FakeClaude(), kinds=waiting_kinds(gate), settings=lf_settings(**limits))


# An automatic run's limit of US$50, under a typical run at the placeholder prices (US$62.40:
# 6 searches at US$0.40 and 60 companies at US$1.00), so a test can see a run refused.
LOW = [{"scheduled_run_cap_usd": Decimal("50")}]


@pytest.fixture
async def client(manager: RunManager, session_factory: Factory) -> AsyncIterator[httpx.AsyncClient]:
    app: FastAPI = create_app()
    clock = Clock()
    clock.now = NOW

    async def a_session_for_each_request() -> AsyncIterator[AsyncSession]:
        async with session_factory() as db:
            yield db

    app.dependency_overrides[get_session] = a_session_for_each_request
    app.state.run_manager = manager
    app.state.clock = clock
    await the_schedule(session_factory)  # makes the default schedules, as the first start does
    app.state.scheduler = Scheduler(
        app=app, sessions=session_factory, jobs=all_jobs(app), clock=clock
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as made:
        yield made


async def the_item(client: httpx.AsyncClient) -> dict[str, Any]:
    answer = await client.get(URL)
    assert answer.status_code == 200, answer.text
    items: list[dict[str, Any]] = answer.json()["items"]
    (item,) = [item for item in items if item["job"] == DISCOVERY]
    return item


async def change(client: httpx.AsyncClient, body: dict[str, Any]) -> httpx.Response:
    item = await the_item(client)
    return await client.patch(f"{URL}/{item['id']}", json=body)


# --- What the page reads ------------------------------------------------------------


async def test_the_page_reads_the_default_schedule_with_its_estimate(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)

    item = await the_item(client)

    assert item["name"] == "Find new leads: Melbourne"
    assert item["when"] == "Every 2 weeks on Monday at 7:00 am"
    assert item["enabled"] is False and item["next_run_at"] is None
    assert item["summary"] == ("Searches Melbourne for the 6 main signs, looking back 14 days.")
    assert item["estimate"] == {
        "valid": True,
        "problem": None,
        # 6 searches at US$0.15, and 60 companies at US$0.30: the most 6 searches can find,
        # since an automatic run has no company limit of its own (9 Nov)
        "typical_usd": "18.90",
        "worst_usd": "150.00",  # the automatic run's own limit stops it there
        "per_month_usd": "41.10",  # 18.90 x 30.4375 / 14 days, rounded up
        "cap_usd": "150.00",
        "daily_left_usd": "150.00",
        "basis": (
            "US$0.30 a company, the average of 6 past companies; "
            "US$0.15 a slice, the average of 6 past slices"
        ),
    }


async def test_without_past_prices_an_automatic_run_still_fits_its_limit(
    client: httpx.AsyncClient,
) -> None:
    estimate = (await the_item(client))["estimate"]
    assert estimate["valid"] is True
    assert estimate["typical_usd"] == "62.40"  # the placeholder prices
    assert estimate["problem"] is None  # under the automatic run's US$150


@pytest.mark.parametrize("limits", LOW)
async def test_without_past_prices_the_page_says_a_run_over_the_limit_would_not_start(
    client: httpx.AsyncClient,
) -> None:
    estimate = (await the_item(client))["estimate"]

    assert estimate["valid"] is True  # the choices are fine
    assert estimate["typical_usd"] == "62.40"  # the placeholder prices
    assert estimate["problem"].startswith(
        "A typical run costs about US$62.40, which is more than the run limit of US$50.00."
    )
    assert "US$1.00 a company, a default" in estimate["problem"]


async def test_adding_three_cities_is_saved_and_fits_an_automatic_run(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)

    answer = await change(
        client,
        {"settings": {"cities": ["Melbourne", "Adelaide", "Perth", "Sydney"], "since_days": 14}},
    )

    assert answer.status_code == 200, answer.text
    item = answer.json()
    assert item["summary"] == (
        "Searches Melbourne, Adelaide, Perth and Sydney for the 6 main signs, looking back 14 days."
    )
    # 24 searches x US$0.60 = US$14.40 fits discovery's share of US$150 (US$60). A run a person
    # starts with the same choices would be too large (13 searches at most).
    assert item["estimate"]["valid"] is True
    assert item["estimate"]["problem"] is None


async def test_choices_are_checked_and_saved_cleaned(client: httpx.AsyncClient) -> None:
    saved = await change(client, {"settings": {"cities": ["perth"], "since_days": 7}})
    assert saved.status_code == 200, saved.text
    assert saved.json()["settings"] == {"cities": ["Perth"], "since_days": 7}
    assert saved.json()["summary"] == ("Searches Perth for the 6 main signs, looking back 7 days.")


@pytest.mark.parametrize(
    ("choices", "said"),
    [
        ({"cities": ["Atlantis"]}, "cities: Unknown city Atlantis."),
        ({"cities": ["Perth"], "since_days": 10}, "since_days: Input should be 7, 14 or 30"),
        ({"cities": ["Perth"], "cites": []}, "cites: Extra inputs are not permitted"),
    ],
)
async def test_choices_that_cant_be_used_are_refused_in_plain_words(
    client: httpx.AsyncClient, choices: dict[str, Any], said: str
) -> None:
    answer = await change(client, {"settings": choices})

    assert answer.status_code == 422
    (error,) = answer.json()["errors"]
    assert error["field"] == "body.settings" and said in error["message"]
    assert (await the_item(client))["settings"]["cities"] == ["Melbourne"]


# --- What the page does ------------------------------------------------------------


async def test_switching_on_then_run_now_starts_a_run_the_runs_list_marks(
    client: httpx.AsyncClient, session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    await add_past_prices(session_factory)
    switched = await change(client, {"enabled": True})
    assert switched.json()["next_run_at"] == "2026-11-08T20:00:00Z"  # Monday 9 Nov, 7:00 am

    item = await the_item(client)
    started = await client.post(f"{URL}/{item['id']}/run")

    assert started.status_code == 200, started.text
    body = started.json()
    assert body["status"] == "started" and body["reason"] is None
    run_id = body["ref"]
    uuid.UUID(run_id)  # a run id

    after = await the_item(client)
    assert (after["last_status"], after["last_kind"], after["last_id"]) == (
        "started",
        "run",
        run_id,
    )
    assert after["running"] is True
    assert after["next_run_at"] == "2026-11-08T20:00:00Z"  # "Run now" didn't move it

    run = (await client.get(f"/api/v1/runs/{run_id}")).json()
    assert run["schedule_id"] == item["id"]
    listing = (await client.get("/api/v1/runs", params={"app": "lead_finder"})).json()
    assert [(row["id"], row["schedule_id"]) for row in listing["items"]] == [(run_id, item["id"])]

    gate.release.set()
    await wait_until_idle(manager)
    assert (await the_item(client))["running"] is False


@pytest.mark.parametrize("limits", LOW)
async def test_run_now_over_the_limit_says_why_and_starts_nothing(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    item = await the_item(client)  # no past prices: the default run looks like US$62.40

    answer = await client.post(f"{URL}/{item['id']}/run")

    assert answer.status_code == 200
    body = answer.json()
    assert body["status"] == "skipped" and body["ref"] is None
    assert body["reason"].startswith("A typical run costs about US$62.40, which is more than")
    assert await all_runs(session_factory) == []
    assert (await the_item(client))["last_error"] == body["reason"]


async def test_changing_the_cadence_of_a_schedule_that_is_on_moves_its_next_run(
    client: httpx.AsyncClient,
) -> None:
    await change(client, {"enabled": True})
    moved = await change(client, {"every": 1})
    assert moved.json()["when"] == "Every week on Monday at 7:00 am"
    assert (
        moved.json()["next_run_at"] == "2026-11-08T20:00:00Z"
    )  # the first Monday 7:00 am from now
