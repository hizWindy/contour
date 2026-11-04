"""Sending a lead to HubSpot (PLAN-V5 D3 and D4): what a lead sends, and the routes."""

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.hubspot_send import CITY_STATE, lead_values, send_request
from apps.lead_finder.rules import load_rules
from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.db.engine import get_session
from tests.core.hubspot_fake import FakeHubSpot
from tests.lead_finder.factories import add_all, make_lead

RULES = load_rules()
LF = "/api/v1/lead-finder"


def sample_lead(**changes: object) -> Lead:
    lead = make_lead(
        "Acme Logistics",
        city="Perth",
        score=82,
        result="pass",
        domain="www.acme.com.au",
        industry="Logistics and Supply Chain",
        staff_in_city=320,
        **changes,
    )
    lead.card["triggers"][0]["trigger"]["source_url"] = "https://news.example.com/acme-lease"
    return lead


def test_a_new_lead_sends_every_mapped_field_in_hubspots_form() -> None:
    change = send_request(sample_lead(), RULES, card_url="http://localhost:5173/leads/x")

    assert change.subject.startswith("lead:") and change.company.hubspot_id is None
    assert change.company.domain == "acme.com.au"  # a plain domain
    fields = change.fields
    assert fields["name"] == "Acme Logistics"
    assert (fields["city"], fields["state"]) == ("Perth", "WA")
    assert fields["industry"] == "Logistics and Supply Chain"
    assert fields["numberofemployees"] == "320"
    assert fields["contour_ai_score"] == "82" and fields["contour_ai_result"] == "Pass"
    assert fields["contour_ai_source_url"] == "https://news.example.com/acme-lease"
    assert fields["contour_ai_suggested"] == "true"
    assert change.list_name == "AI suggested"
    assert change.note is not None
    assert "Score: 82" in change.note and "https://news.example.com/acme-lease" in change.note
    assert "http://localhost:5173/leads/x" in change.note
    assert set(fields) <= {f.property for f in RULES.hubspot_map.company.values()}


def test_every_field_in_the_map_has_a_value_or_is_left_out() -> None:
    values = lead_values(sample_lead(), RULES)
    assert set(values) == set(RULES.hubspot_map.company)
    assert set(CITY_STATE) == {"Melbourne", "Adelaide", "Perth", "Sydney", "Brisbane"}


def test_a_lead_already_in_hubspot_updates_that_company_and_open_deals_warn() -> None:
    known = send_request(sample_lead(hubspot_status="in_hubspot", hubspot_id="777"), RULES)
    assert known.company.hubspot_id == "777" and known.warnings == []
    open_deal = send_request(sample_lead(hubspot_status="open_deal", hubspot_id="778"), RULES)
    assert any("open deal" in warning for warning in open_deal.warnings)
    guess = send_request(sample_lead(hubspot_status="possible_match", hubspot_id=None), RULES)
    assert guess.company.hubspot_id is None and "possible match" in guess.warnings[0]


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


@pytest.mark.integration
async def test_preview_then_send_marks_the_lead_sent_once(
    client: httpx.AsyncClient, session: AsyncSession, fake: FakeHubSpot
) -> None:
    lead = sample_lead()
    await add_all(session, lead)

    assert (await client.get(f"{LF}/leads/{lead.id}/hubspot")).json() is None
    preview = await client.post(f"{LF}/leads/{lead.id}/hubspot/preview")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["status"] == "previewed" and body["plan"]["action"] == "create"
    assert body["waiting_for"] == "Waiting for write access"

    refused = await client.post(f"{LF}/leads/{lead.id}/hubspot/send", json={"write_id": body["id"]})
    assert refused.status_code == 409 and refused.json()["code"] == "hubspot_write_off"
    assert fake.companies == {}

    fake.grant_writes()
    sent = await client.post(f"{LF}/leads/{lead.id}/hubspot/send", json={"write_id": body["id"]})
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "done"
    (company_id,) = fake.companies
    await session.refresh(lead)
    assert (lead.status, lead.hubspot_id, lead.hubspot_status) == ("sent", company_id, "in_hubspot")
    assert lead.card["hubspot"]["hubspot_id"] == company_id

    again = await client.post(f"{LF}/leads/{lead.id}/hubspot/send", json={"write_id": body["id"]})
    assert again.json()["id"] == body["id"] and len(fake.companies) == 1
    latest = (await client.get(f"{LF}/leads/{lead.id}/hubspot")).json()
    assert latest["status"] == "done" and latest["hubspot_url"]
    log = (await client.get("/api/v1/hubspot/writes")).json()
    assert [entry["id"] for entry in log] == [body["id"]]


@pytest.mark.integration
async def test_a_preview_for_another_lead_is_refused(
    client: httpx.AsyncClient, session: AsyncSession, fake: FakeHubSpot
) -> None:
    first, second = sample_lead(), sample_lead()
    await add_all(session, first, second)
    preview = (await client.post(f"{LF}/leads/{first.id}/hubspot/preview")).json()
    fake.grant_writes()
    wrong = await client.post(
        f"{LF}/leads/{second.id}/hubspot/send", json={"write_id": preview["id"]}
    )
    assert wrong.status_code == 422 and fake.companies == {}


@pytest.mark.integration
async def test_without_a_key_the_send_says_hubspot_is_not_connected(
    client: httpx.AsyncClient, session: AsyncSession, app: FastAPI
) -> None:
    lead = sample_lead()
    await add_all(session, lead)
    app.state.hubspot_provider = lambda: None
    answer = await client.post(f"{LF}/leads/{lead.id}/hubspot/preview")
    assert answer.status_code == 503 and answer.json()["code"] == "hubspot_key_missing"
    missing = await client.post(
        f"{LF}/leads/{lead.id}/hubspot/send", json={"write_id": str(lead.id)}
    )
    assert missing.status_code == 404  # no such write


@pytest.mark.integration
async def test_the_status_route_reports_the_connection_and_each_project(
    client: httpx.AsyncClient, fake: FakeHubSpot
) -> None:
    status = (await client.get("/api/v1/hubspot/status")).json()
    assert status["key_set"] is True and status["write_enabled"] is False
    states = {scope["scope"]: scope["state"] for scope in status["check"]["scopes"]}
    assert states["crm.objects.companies.read"] == "yes"
    assert states["crm.objects.companies.write"] == "no"
    (project,) = status["projects"]
    assert project["app"] == "lead_finder" and project["sending"] == "waiting"
    assert "SERVICE_KEY" not in str(status) or status["check"]["problem"] is None
    assert status["copy_counts"]["companies"] == 0 and status["recent_syncs"] == []
