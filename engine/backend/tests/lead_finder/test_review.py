"""The review page's routes (PLAN-V9 C3): the bar, Watch and Reject for the ticked leads, and
Approve and send to HubSpot, on the fake HubSpot. Nothing reaches the real HubSpot."""

import uuid
from collections.abc import AsyncIterator, Iterator
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.config import get_settings
from core.db.engine import get_session
from core.hubspot.client import HubSpotError
from core.runs.models import Run
from tests.core.hubspot_fake import FakeHubSpot
from tests.lead_finder.factories import add_all, make_lead

pytestmark = pytest.mark.integration
LF = "/api/v1/lead-finder"


@pytest.fixture
def fake() -> FakeHubSpot:
    return FakeHubSpot()


@pytest.fixture
def app(session: AsyncSession, fake: FakeHubSpot) -> FastAPI:
    application = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_session] = test_session
    application.state.hubspot_provider = lambda: fake
    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test:
        yield test


@pytest.fixture
def writing_on(monkeypatch: pytest.MonkeyPatch, fake: FakeHubSpot) -> Iterator[None]:
    monkeypatch.setenv("HUBSPOT_WRITE_ENABLED", "true")
    get_settings.cache_clear()
    fake.grant_writes()
    yield
    monkeypatch.setenv("HUBSPOT_WRITE_ENABLED", "false")
    get_settings.cache_clear()


def a_run(**by_result: int) -> Run:
    return Run(
        app="lead_finder",
        mode="discovery",
        status="done",
        params={"cities": ["Melbourne"]},
        counts={"by_result": by_result},
        cost_usd=Decimal("3.60"),
    )


def lead_of(run: Run, name: str, **changes: object) -> Lead:
    return make_lead(name, run_id=run.id, city="Melbourne", domain=None, **changes)


async def test_the_bar_shows_the_runs_numbers_and_that_writing_is_off(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    run = a_run(**{"pass": 1, "director_review": 2, "watch": 4, "drop": 5})
    await add_all(session, run)

    bar = (await client.get(f"{LF}/review/{run.id}")).json()

    assert bar["cities"] == ["Melbourne"]
    assert (bar["good_leads"], bar["watch"], bar["drop"]) == (3, 4, 5)
    assert (bar["cost_usd"], bar["cost_per_good_lead_usd"]) == ("3.60", "1.20")
    assert bar["hubspot_write_enabled"] is False
    assert bar["hubspot_write_off"] == "HubSpot writing is off"
    assert (await client.get(f"{LF}/review/{uuid.uuid4()}")).status_code == 404


async def test_a_run_with_no_good_leads_has_no_cost_per_good_lead(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    run = a_run(watch=2)
    await add_all(session, run)
    bar = (await client.get(f"{LF}/review/{run.id}")).json()
    assert (bar["good_leads"], bar["cost_per_good_lead_usd"]) == (0, None)


async def test_watch_and_reject_the_ticked_leads_one_line_each(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    run = a_run(**{"pass": 3})
    first, second, sent = lead_of(run, "Alpha"), lead_of(run, "Beta"), lead_of(run, "Gamma")
    sent.status = "sent"
    await add_all(session, run, first, second, sent)

    watched = await client.post(
        f"{LF}/review/status", json={"lead_ids": [str(first.id)], "status": "watching"}
    )
    assert watched.status_code == 200, watched.text
    assert watched.json()["done"] == 1

    no_reason = await client.post(
        f"{LF}/review/status",
        json={"lead_ids": [str(second.id)], "status": "rejected"},
    )
    assert no_reason.status_code == 422  # said once, for the whole request

    rejected = await client.post(
        f"{LF}/review/status",
        json={
            "lead_ids": [str(first.id), str(second.id), str(sent.id)],
            "status": "rejected",
            "reject_reason": "too_small",
        },
    )
    body = rejected.json()
    assert (body["done"], body["failed"]) == (2, 1)
    assert [(item["company"], item["ok"]) for item in body["items"]] == [
        ("Alpha", True),
        ("Beta", True),
        ("Gamma", False),  # already in HubSpot: its status can't change
    ]
    assert "HubSpot" in body["items"][2]["problem"]
    await session.refresh(second)
    assert (second.status, second.reject_reason) == ("rejected", "too_small")


async def test_sending_while_writing_is_off_writes_nothing(
    client: httpx.AsyncClient, session: AsyncSession, fake: FakeHubSpot
) -> None:
    run = a_run(**{"pass": 1})
    lead = lead_of(run, "Alpha")
    await add_all(session, run, lead)
    answer = await client.post(f"{LF}/review/send", json={"lead_ids": [str(lead.id)]})
    assert answer.status_code == 409 and answer.json()["code"] == "hubspot_write_off"
    assert fake.companies == {}


async def test_approve_and_send_reports_a_failed_lead_on_its_own_line(
    client: httpx.AsyncClient, session: AsyncSession, fake: FakeHubSpot, writing_on: None
) -> None:
    run = a_run(**{"pass": 3})
    leads = [lead_of(run, name) for name in ("Alpha", "Beta", "Gamma")]
    await add_all(session, run, *leads)
    fake.fail["create_companies"] = [HubSpotError("HubSpot had a problem", "It answered 500.")]

    answer = await client.post(
        f"{LF}/review/send", json={"lead_ids": [str(lead.id) for lead in leads]}
    )

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert (body["done"], body["failed"]) == (2, 1)
    assert [item["ok"] for item in body["items"]] == [False, True, True]
    assert body["items"][0]["problem"]
    assert len(fake.companies) == 2
    for lead in leads:
        await session.refresh(lead)
    assert [lead.status for lead in leads] == ["new", "sent", "sent"]

    again = await client.post(f"{LF}/review/send", json={"lead_ids": [str(leads[1].id)]})
    assert again.json()["done"] == 1 and len(fake.companies) == 2  # once only
