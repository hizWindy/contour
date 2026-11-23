"""Add many leads to HubSpot at once (PLAN-V27 T3-1), with the fake HubSpot. Free."""

import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.api_hubspot import _owner
from apps.lead_finder.hubspot_batch import OWNER_FIELD, SendOwner, preview_batch
from apps.lead_finder.rules import load_rules
from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.db.engine import get_session
from core.hubspot.client import HubSpotError
from tests.core.hubspot_fake import FakeHubSpot
from tests.lead_finder.factories import add_all, make_lead

RULES = load_rules()
MANY = "/api/v1/lead-finder/leads/hubspot"


def lead(name: str, domain: str) -> Lead:
    return make_lead(name, city="Perth", domain=domain, industry="Logistics and Supply Chain")


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


def test_the_owner_is_the_person_who_sends_when_they_have_a_hubspot_user() -> None:
    """Choice 15 (TBC with Levi): their owner id, or none."""
    rep = SimpleNamespace(
        user=SimpleNamespace(
            name="Jo Sample", email="jo@example.test", hubspot_owner_id="77", no_hubspot_user=False
        )
    )
    assert _owner(rep) == SendOwner(name="Jo Sample", hubspot_owner_id="77")
    without = SimpleNamespace(
        user=SimpleNamespace(name=None, email="x@example.test", hubspot_owner_id=None)
    )
    assert _owner(without).hubspot_owner_id is None
    marked = SimpleNamespace(
        user=SimpleNamespace(
            name="Sam", email="s@example.test", hubspot_owner_id="9", no_hubspot_user=True
        )
    )
    assert _owner(marked).hubspot_owner_id is None
    assert _owner(None).hubspot_owner_id is None  # this computer, no sign-in


@pytest.mark.integration
async def test_the_owner_goes_in_the_preview_only_when_there_is_one(
    session: AsyncSession, fake: FakeHubSpot
) -> None:
    one = lead("Northwind Freight", "northwind.example")
    await add_all(session, one)
    owned = await preview_batch(
        session,
        fake,
        [one.id],
        RULES,
        owner=SendOwner(name="Jo Sample", hubspot_owner_id="77"),
        card_url_of=lambda _: None,
    )
    write = owned.items[0].write
    assert write is not None
    fields = {change.property: change.value for change in write.plan.fields}
    assert fields[OWNER_FIELD] == "77"


@pytest.mark.integration
async def test_preview_then_send_many_each_with_its_own_result_and_never_twice(
    client: httpx.AsyncClient, session: AsyncSession, fake: FakeHubSpot
) -> None:
    first = lead("Northwind Freight", "northwind.example")
    second = lead("Sample Logistics", "samplelogistics.example")
    await add_all(session, first, second)
    ids = [str(first.id), str(second.id)]
    gone = str(uuid.uuid4())

    preview = await client.post(f"{MANY}/preview-many", json={"lead_ids": [*ids, gone]})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    items = {item["lead_id"]: item for item in body["items"]}
    assert [item["lead_id"] for item in body["items"]] == [*ids, gone]  # the order asked
    assert items[ids[0]]["write"]["plan"]["action"] == "create"
    assert items[gone]["problem"] and items[gone]["write"] is None
    assert body["owner"]["hubspot_owner_id"] is None  # no sign-in in the tests: no owner
    assert (body["can_write"], body["waiting_for"]) == (False, "Waiting for write access")

    pairs = [{"lead_id": i, "write_id": items[i]["write"]["id"]} for i in ids]
    refused = await client.post(f"{MANY}/send-many", json={"items": pairs})
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_write_off")
    assert fake.companies == {}  # nothing written

    fake.grant_writes()
    sent = await client.post(f"{MANY}/send-many", json={"items": pairs})
    assert sent.status_code == 200, sent.text
    result = sent.json()
    assert (result["sent"], result["failed"], result["already_sent"]) == (2, 0, 0)
    assert len(fake.companies) == 2
    statuses = (
        await session.scalars(select(Lead.status).where(Lead.id.in_([first.id, second.id])))
    ).all()
    assert set(statuses) == {"sent"}

    again = (await client.post(f"{MANY}/send-many", json={"items": pairs})).json()
    assert (again["sent"], again["already_sent"]) == (0, 2)
    assert len(fake.companies) == 2  # the once-only key: nothing twice

    # A batch previewed again gives the sends back, marked already sent
    back = (await client.post(f"{MANY}/preview-many", json={"lead_ids": ids})).json()
    assert [item["already_sent"] for item in back["items"]] == [True, True]


@pytest.mark.integration
async def test_one_failure_does_not_stop_the_rest(
    client: httpx.AsyncClient, session: AsyncSession, fake: FakeHubSpot
) -> None:
    first = lead("Northwind Freight", "northwind.example")
    second = lead("Sample Logistics", "samplelogistics.example")
    other = lead("Jo Sample Advisory", "josample.example")
    await add_all(session, first, second, other)
    ids = [str(first.id), str(second.id)]
    body = (await client.post(f"{MANY}/preview-many", json={"lead_ids": ids})).json()
    items = {item["lead_id"]: item for item in body["items"]}
    pairs = [{"lead_id": i, "write_id": items[i]["write"]["id"]} for i in ids]
    # A write id that belongs to another lead fails that lead only
    other_preview = (
        await client.post(f"{MANY}/preview-many", json={"lead_ids": [str(other.id)]})
    ).json()
    pairs[1]["write_id"] = other_preview["items"][0]["write"]["id"]
    fake.grant_writes()
    fake.fail["create_companies"] = [
        HubSpotError("HubSpot said no", "HubSpot refused the website.")
    ]
    result = (await client.post(f"{MANY}/send-many", json={"items": pairs})).json()
    by_id = {item["lead_id"]: item for item in result["items"]}
    assert by_id[ids[0]]["result"] == "failed"
    assert by_id[ids[1]]["result"] == "failed" and "another lead" in by_id[ids[1]]["problem"]
    assert result["failed"] == 2


@pytest.mark.integration
async def test_twenty_six_leads_are_refused(client: httpx.AsyncClient) -> None:
    many = [str(uuid.uuid4()) for _ in range(26)]
    answer = await client.post(f"{MANY}/preview-many", json={"lead_ids": many})
    assert answer.status_code == 422
    pairs = [{"lead_id": i, "write_id": i} for i in many]
    assert (await client.post(f"{MANY}/send-many", json={"items": pairs})).status_code == 422
    assert (await client.post(f"{MANY}/preview-many", json={"lead_ids": []})).status_code == 422
