"""A person settles a possible HubSpot match on the lead card (PLAN-V27 T1-3). Free."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.relabel import relabel
from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.db.engine import get_session
from core.hubspot.models import HubSpotCompany, HubSpotDeal
from tests.lead_finder.factories import add_all, make_lead

pytestmark = pytest.mark.integration
BASE = "/api/v1/lead-finder/leads"


def maybe_lead(company: str = "Northwind") -> Lead:
    lead = make_lead(company)
    lead.hubspot_status = "possible_match"
    card = dict(lead.card)
    card["hubspot"] = {
        **card["hubspot"],
        "status": "possible_match",
        "matched_by": "close_name",
        "candidates": [
            {
                "hubspot_id": "501",
                "name": "Northwind Group",
                "owner": None,
                "reason": "close_name",
                "score": 0.93,
                "open_deals": [],
                "last_dissolved": None,
            },
            {
                "hubspot_id": "502",
                "name": "Northwind Freight",
                "owner": "Jo Sample",
                "reason": "close_name",
                "score": 0.91,
                "open_deals": [],
                "last_dissolved": None,
            },
        ],
    }
    lead.card = card
    return lead


@pytest.fixture
def app(session: AsyncSession) -> FastAPI:
    application = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_session] = test_session
    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def add_companies(session: AsyncSession) -> None:
    session.add_all(
        [
            HubSpotCompany(
                hubspot_id="501",
                name="Northwind Group",
                source="export",
                last_activity=datetime.now(UTC) - timedelta(days=40),
            ),
            HubSpotCompany(
                hubspot_id="502", name="Northwind Freight", owner="Jo Sample", source="export"
            ),
        ]
    )
    await session.commit()


async def test_same_company_links_the_lead_and_it_is_hidden_unless_quiet(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_companies(session)
    worked, quiet = maybe_lead("Northwind"), maybe_lead("Northwind Freight Co")
    await add_all(session, worked, quiet)
    worked_id, quiet_id = worked.id, quiet.id

    linked = await client.post(
        f"{BASE}/{worked_id}/hubspot-match", json={"pick": "same", "hubspot_id": "501"}
    )
    assert linked.status_code == 200, linked.text
    body = linked.json()
    assert (body["hubspot"]["status"], body["hubspot"]["hubspot_id"]) == ("in_hubspot", "501")
    assert body["hubspot"]["candidates"] == []
    assert body["hubspot"]["confirmed_by"]
    assert body["hubspot"]["last_activity"] is not None

    # No activity date at all: nobody has worked it, so it is quiet and stays with the new leads
    kept = await client.post(
        f"{BASE}/{quiet_id}/hubspot-match", json={"pick": "same", "hubspot_id": "502"}
    )
    assert kept.json()["hubspot"]["status"] == "quiet"
    assert kept.json()["hubspot"]["owner"] == "Jo Sample"

    # The choice stays after a reload
    again = (await client.get(f"{BASE}/{worked_id}")).json()
    assert again["hubspot"]["status"] == "in_hubspot"
    row = await session.get(Lead, worked_id, populate_existing=True)
    assert row is not None and row.hubspot_status == "in_hubspot"


async def test_its_new_keeps_the_lead_and_a_second_click_is_refused(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_companies(session)
    lead = maybe_lead()
    await add_all(session, lead)
    lead_id = lead.id
    new = await client.post(f"{BASE}/{lead_id}/hubspot-match", json={"pick": "new"})
    assert new.status_code == 200, new.text
    assert (new.json()["hubspot"]["status"], new.json()["hubspot"]["hubspot_id"]) == ("new", None)
    assert new.json()["hubspot"]["candidates"] == []

    twice = await client.post(f"{BASE}/{lead_id}/hubspot-match", json={"pick": "new"})
    assert (twice.status_code, twice.json()["code"]) == (409, "not_a_maybe")

    # A HubSpot sync's relabel leaves a settled lead as it is
    await relabel(session, write=True)
    row = await session.get(Lead, lead_id, populate_existing=True)
    assert row is not None and row.hubspot_status == "new"


async def test_an_open_deal_fails_the_hubspot_rule_as_at_research(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_companies(session)
    session.add(
        HubSpotDeal(
            hubspot_deal_id="d501",
            hubspot_company_id="501",
            name="Northwind fitout",
            stage="Qualified Deal",
        )
    )
    await session.commit()
    lead = maybe_lead()
    await add_all(session, lead)
    body = (
        await client.post(
            f"{BASE}/{lead.id}/hubspot-match", json={"pick": "same", "hubspot_id": "501"}
        )
    ).json()
    assert body["hubspot"]["status"] == "open_deal"
    hubspot = [check for check in body["checks"] if check["rule"] == "HubSpot"]
    assert hubspot and hubspot[0]["outcome"] == "fail"


async def test_only_one_of_its_candidates_can_be_picked(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_companies(session)
    lead = maybe_lead()
    plain = make_lead("Sample Logistics")
    await add_all(session, lead, plain)
    lead_id, plain_id = lead.id, plain.id
    other = await client.post(
        f"{BASE}/{lead_id}/hubspot-match", json={"pick": "same", "hubspot_id": "999"}
    )
    assert (other.status_code, other.json()["code"]) == (422, "not_a_candidate")
    missing = await client.post(f"{BASE}/{lead_id}/hubspot-match", json={"pick": "same"})
    assert missing.status_code == 422
    unknown = await client.post(f"{BASE}/{uuid.uuid4()}/hubspot-match", json={"pick": "new"})
    assert unknown.status_code == 404
    settled = await client.post(f"{BASE}/{plain_id}/hubspot-match", json={"pick": "new"})
    assert (settled.status_code, settled.json()["code"]) == (409, "not_a_maybe")
