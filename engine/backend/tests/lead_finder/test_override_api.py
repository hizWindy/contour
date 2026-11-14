"""A person overrides an exclusion over HTTP (PLAN-V16 T1-3). Free: no Claude, no search."""

import uuid
from collections.abc import AsyncIterator
from datetime import date
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.research import LeadCard, apply_verdict, verdict_columns
from apps.lead_finder.rules import load_rules
from apps.lead_finder.scoring import judge
from apps.lead_finder.tables import Lead
from core.api.access import signed_in
from core.api.app import create_app
from core.db.engine import get_session
from core.hubspot.matching import HubSpotMatch
from tests.lead_finder.factories import add_all, make_card, make_lead
from tests.lead_finder.samples import fact, make_facts

pytestmark = pytest.mark.integration
BASE = "/api/v1/lead-finder/leads"
RULES = load_rules()


def excluded_lead(company: str = "Acme Legal", **facts: Any) -> Lead:
    """A lead the rules left out: a law firm that would otherwise pass."""
    lead_id = uuid.uuid4()
    changes = {"industry_group": "Law firms", "industry": fact("Law practice"), **facts}
    judged = make_facts(name=company, **changes)
    verdict = judge(judged, HubSpotMatch(status="new"), RULES, date(2026, 10, 26))
    card = LeadCard.model_validate(make_card(lead_id, company))
    card = apply_verdict(card, verdict).model_copy(update={"facts": judged})
    columns = verdict_columns(card)
    return make_lead(
        company,
        id=lead_id,
        card=columns.pop("card"),
        result=columns.pop("result"),
        score=columns.pop("score"),
        trigger_id=columns.pop("trigger_id"),
        trigger_ids=columns.pop("trigger_ids"),
        **columns,
    )


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


async def test_a_lead_a_rule_left_out_is_a_drop_with_its_reason(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = excluded_lead()
    await add_all(session, lead)
    body = (await client.get(f"{BASE}/{lead.id}")).json()
    assert (body["result"], body["score"]) == ("drop", 0)
    assert body["excluded"]["reason_id"] == "law_firm"
    assert body["excluded"]["overridden_by"] is None
    assert [item["id"] for item in body["filters"]][:2] == ["location", "office_size"]


async def test_an_override_judges_the_lead_again_and_says_who_did_it(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = excluded_lead()
    await add_all(session, lead)
    response = await client.post(f"{BASE}/{lead.id}/override-exclusion")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"] == "pass" and body["score"] > 0
    assert body["excluded"]["reason_id"] == "law_firm"  # the card still says it was left out
    assert body["excluded"]["overridden_by"] == "a person on this computer"  # sign-in is off
    assert body["excluded"]["overridden_at"]
    assert any(
        check["rule"] == "Excluded" and check["outcome"] == "flag" for check in body["checks"]
    )
    await session.refresh(lead)  # the row's own columns follow the card
    assert (lead.result, lead.score) == ("pass", body["score"])
    assert lead.trigger_id == "lease_ending"


async def test_a_signed_in_person_is_named_on_the_card(
    app: FastAPI, client: httpx.AsyncClient, session: AsyncSession
) -> None:
    app.dependency_overrides[signed_in] = lambda: SimpleNamespace(
        user=SimpleNamespace(
            name="Al-khair Pama", email="al@example.test", role="admin", apps=["lead_finder"]
        )
    )
    lead = excluded_lead()
    await add_all(session, lead)
    lead_id = lead.id
    body = (await client.post(f"{BASE}/{lead_id}/override-exclusion")).json()
    assert body["excluded"]["overridden_by"] == "Al-khair Pama"


async def test_a_second_override_is_refused_and_changes_nothing(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = excluded_lead()
    await add_all(session, lead)
    lead_id = lead.id  # the route commits, which expires the row we hold
    first = (await client.post(f"{BASE}/{lead_id}/override-exclusion")).json()
    again = await client.post(f"{BASE}/{lead_id}/override-exclusion")
    assert again.status_code == 409 and again.json()["code"] == "already_overridden"
    after = (await client.get(f"{BASE}/{lead_id}")).json()
    assert after["excluded"] == first["excluded"] and after["score"] == first["score"]


async def test_a_lead_no_rule_left_out_has_nothing_to_override(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme Software")  # an ordinary pass: its card has no exclusion
    await add_all(session, lead)
    response = await client.post(f"{BASE}/{lead.id}/override-exclusion")
    assert response.status_code == 409 and response.json()["code"] == "not_excluded"


async def test_an_unknown_lead_is_a_404(client: httpx.AsyncClient) -> None:
    response = await client.post(f"{BASE}/{uuid.uuid4()}/override-exclusion")
    assert response.status_code == 404
