"""Researching one company, end to end, with a fake Claude. Free, and the same every time.

Integration tests: they need the database.
"""

from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.api import claude_dependency
from apps.lead_finder.fields import DecisionMaker
from apps.lead_finder.research import LeadCard, ResearchRequest, research_company
from apps.lead_finder.rules import load_rules
from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.config import Settings, get_settings
from core.db.engine import get_session
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.embedder import get_embedder
from core.memory.models import MemoryItem
from core.searches.models import SearchLog
from tests.lead_finder.samples import SITE, FakeClaude, fact, make_facts

pytestmark = pytest.mark.integration

TODAY = date(2026, 10, 26)
ACME = ResearchRequest(company="Acme Software", city="Melbourne")


async def research(
    session: AsyncSession,
    claude: FakeClaude,
    request: ResearchRequest = ACME,
    settings: Settings | None = None,
) -> LeadCard:
    return await research_company(
        session, get_embedder(), claude, load_rules(), settings or get_settings(), request, TODAY
    )


async def count(session: AsyncSession, model: type, **where: object) -> int:
    statement = select(func.count()).select_from(model)
    for name, value in where.items():
        statement = statement.where(getattr(model, name) == value)
    return await session.scalar(statement) or 0


async def test_research_searches_three_angles_and_saves_everything(session: AsyncSession) -> None:
    claude = FakeClaude()
    card = await research(session, claude)

    assert sorted(claude.calls) == ["extract", "search:money", "search:people", "search:property"]
    assert card.result == "pass"
    assert card.score == 51  # see test_scoring: a good lead with nothing found for fit or rivals
    assert (card.score_checked, card.band) == (77, "investigate")
    assert card.research.cost_usd == Decimal("0.400000")  # 3 searches x $0.12 + $0.04
    assert card.research.web_searches == 6
    assert card.hubspot.status == "new"
    assert card.dropped == []
    assert await count(session, SearchLog, job_id=card.id) == 4
    assert await count(session, Lead) == 1
    assert await count(session, MemoryItem, kind="source_note") == 4
    assert await count(session, MemoryItem, kind="company_profile") == 1


async def test_researching_again_uses_memory_and_costs_less(session: AsyncSession) -> None:
    first = await research(session, FakeClaude())
    claude = FakeClaude()
    second = await research(session, claude, ACME.model_copy(update={"company": "acme software"}))

    assert claude.calls == ["extract"]
    assert second.research.angles_from_memory == ["money", "people", "property"]
    assert second.research.cost_usd < first.research.cost_usd
    assert second.result == first.result
    assert await count(session, MemoryItem, kind="source_note") == 4  # no duplicates


async def test_use_memory_false_searches_again(session: AsyncSession) -> None:
    await research(session, FakeClaude())
    claude = FakeClaude()
    await research(session, claude, ACME.model_copy(update={"use_memory": False}))
    assert len(claude.calls) == 4


async def test_the_gap_check_runs_one_more_search_then_stops(session: AsyncSession) -> None:
    claude = FakeClaude(facts=make_facts(office_m2=fact(None), staff_in_city=fact(None)))
    card = await research(session, claude)
    assert claude.calls.count("search:gaps") == 1
    assert claude.calls.count("extract") == 2
    assert card.result == "watch"  # still no size, so a person checks it


async def test_notes_citing_pages_never_read_are_thrown_away(session: AsyncSession) -> None:
    claude = FakeClaude(invented_url=True)
    card = await research(session, claude)
    assert "extract" not in claude.calls  # no notes left, so nothing to fill in
    assert card.facts.city.value is None
    assert card.result == "watch"
    assert await count(session, MemoryItem) == 0


async def test_hubspot_staff_fills_a_gap_the_research_left(session: AsyncSession) -> None:
    link = "https://app.hubspot.com/contacts/1/company/102"
    session.add(
        HubSpotCompany(
            hubspot_id="102", name="Acme Software Pty Ltd", hubspot_url=link, source="export"
        )
    )
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=60))
    await session.commit()  # research ends its transaction first, so uncommitted rows would go

    claude = FakeClaude(facts=make_facts(office_m2=fact(None), staff_in_city=fact(None)))
    card = await research(session, claude)

    assert card.hubspot.status == "in_hubspot"
    assert card.facts.staff_in_city.value == 60
    assert card.facts.staff_in_city.source_url == link
    assert card.from_hubspot == [
        "Staff in Melbourne: 60 on LinkedIn, from HubSpot. The real number is about double."
    ]
    assert card.office_m2 == 1200  # 60 on LinkedIn is about 120 staff, at 10 m² each
    assert card.result == "pass"


async def test_an_open_deal_in_hubspot_is_dropped(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="101", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(
        HubSpotDeal(
            hubspot_deal_id="9", hubspot_company_id="101", name="Acme 2,500 m²", stage="Verified"
        )
    )
    await session.commit()
    card = await research(session, FakeClaude())
    assert card.hubspot.status == "open_deal"
    assert card.hubspot.matched_by == "name"
    assert card.result == "drop"


async def test_the_search_cap_stops_research_cleanly(session: AsyncSession) -> None:
    settings = get_settings().model_copy(update={"company_max_searches": 3})
    claude = FakeClaude()
    card = await research(session, claude, settings=settings)
    assert card.research.web_searches <= 3
    assert any("skipped" in problem for problem in card.problems)


@pytest.fixture
async def client(session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = test_session
    app.dependency_overrides[claude_dependency] = lambda: FakeClaude()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def test_the_research_endpoint_returns_a_card_and_lists_it(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/lead-finder/research", json={"company": "Acme Software"})
    assert response.status_code == 200, response.text
    card = response.json()
    assert card["result"] == "pass"

    listed = (await client.get("/api/v1/lead-finder/leads", params={"result": "pass"})).json()
    assert listed["total"] == 1
    one = await client.get(f"/api/v1/lead-finder/leads/{card['id']}")
    assert one.json()["facts"]["office_m2"]["value"] == 2500
    log = (await client.get("/api/v1/searches", params={"job_id": card["id"]})).json()
    assert log["total"] == 4

    missing = await client.get("/api/v1/lead-finder/leads/00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404


async def test_decision_makers_from_pages_read_reach_the_saved_card(session: AsyncSession) -> None:
    people = [
        DecisionMaker(
            name="Jane Citizen", role="Chief Financial Officer", source_url=SITE, source_date=None
        ),
        DecisionMaker(
            name="Sam Example",
            role="Head of Property",
            source_url="https://www.linkedin.com/in/sam-example",
            source_date=None,
        ),
    ]
    card = await research(session, FakeClaude(facts=make_facts(decision_makers=people)))

    assert [(p.name, p.role, p.source_url) for p in card.facts.decision_makers] == [
        ("Jane Citizen", "Chief Financial Officer", SITE)
    ]
    assert [item for item in card.dropped if item.startswith("a decision maker")] == [
        "a decision maker: link not among the pages read "
        "(https://www.linkedin.com/in/sam-example). Removed."
    ]
    saved = await session.scalar(select(Lead.card).where(Lead.id == card.id))
    assert saved is not None
    assert [p["name"] for p in saved["facts"]["decision_makers"]] == ["Jane Citizen"]
    # The names stay on the card: the search costs and the search log don't change.
    assert card.research.cost_usd == Decimal("0.400000")
    assert await count(session, SearchLog, job_id=card.id) == 4
