"""Researching one company, end to end, with a fake Claude. Free, and the same every time.

Integration tests: they need the database.
"""

import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import date
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder import research as research_module
from apps.lead_finder.api import claude_dependency
from apps.lead_finder.context import ResearchContext
from apps.lead_finder.fields import DecisionMaker
from apps.lead_finder.research import LeadCard, ResearchRequest, refill_lead, research_company
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.tables import Lead
from core.api.app import create_app
from core.claude.client import ClaudeError
from core.config import Settings, get_settings
from core.db.engine import get_session
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.embedder import get_embedder
from core.memory.models import MemoryItem
from core.searches.models import SearchLog
from core.signalhire.client import (
    CompanyRef,
    SignalHire,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireOutOfQuota,
)
from tests.lead_finder.conftest import lf_settings
from tests.lead_finder.samples import (
    ACME_SOFTWARE,
    SITE,
    FakeClaude,
    FakeSignalHire,
    fact,
    make_facts,
    rules_with_signalhire,
    rules_without_signalhire,
)

pytestmark = pytest.mark.integration

TODAY = date(2026, 10, 26)
ACME = ResearchRequest(company="Acme Software", city="Melbourne")


async def research(
    session: AsyncSession,
    claude: FakeClaude,
    request: ResearchRequest = ACME,
    settings: Settings | None = None,
    *,
    rules: LeadFinderRules | None = None,
    context: ResearchContext | None = None,
    signalhire: SignalHire | None = None,
) -> LeadCard:
    return await research_company(
        session,
        get_embedder(),
        claude,
        rules or load_rules(),
        settings or get_settings(),
        request,
        TODAY,
        context,
        signalhire,
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


# --- Signal Hire fills a staff number nobody else found (PLAN-V3 C3) ---------------------------

NO_STAFF = make_facts(office_m2=fact(None), staff_in_city=fact(None))
SIGNALHIRE_RULES = rules_with_signalhire(load_rules())  # Signal Hire on, the name check required
SIGNALHIRE_NOTE = "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC)."


def acme_on_signalhire(**failures: SignalHireError) -> FakeSignalHire:
    """A Signal Hire that knows Acme Software and has 105 people on file in Melbourne."""
    return FakeSignalHire([ACME_SOFTWARE], people=105, failures=dict(failures))


async def test_signalhire_fills_a_staff_gap_nobody_else_filled(session: AsyncSession) -> None:
    fake = acme_on_signalhire()
    card = await research(
        session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES, signalhire=fake
    )

    staff = card.facts.staff_in_city
    assert (staff.value, staff.label, staff.source_url) == (210, "estimated", None)
    assert card.facts.staff_from_linkedin is False  # the number is already multiplied
    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    assert card.from_hubspot == [] and card.problems == []
    assert card.office_m2 == 2100  # 210 staff at 10 m² each: the size rule reads it as it is
    assert card.result == "pass"
    assert fake.calls == ["find:acme-software", "people:Acme Software|Melbourne, Australia|"]
    # The saved lead keeps the number and the note, so the website and the list can show them.
    lead = await session.scalar(select(Lead))
    assert lead is not None and lead.staff_in_city == 210
    assert lead.card["from_signalhire"] == [SIGNALHIRE_NOTE]


async def test_signalhire_stays_off_while_headcount_tool_is_not_listed(
    session: AsyncSession,
) -> None:
    fake = acme_on_signalhire()
    rules = rules_without_signalhire(load_rules())
    card = await research(session, FakeClaude(facts=NO_STAFF), rules=rules, signalhire=fake)

    assert fake.calls == []
    assert card.from_signalhire == [] and card.facts.staff_in_city.value is None


async def test_with_the_rules_as_shipped_and_the_company_api_off_the_typed_name_is_counted(
    session: AsyncSession,
) -> None:
    """What a Run does today: criteria.yaml lists headcount_tool and uses the name as typed, because
    Signal Hire's Company API is off for our account. The card says the name was not checked."""
    off = SignalHireCompanyApiOff("Signal Hire said no", "The Company API is off.")
    fake = FakeSignalHire([ACME_SOFTWARE], people=105, failures={"find": off})

    card = await research(session, FakeClaude(facts=NO_STAFF), signalhire=fake)  # the real rules

    assert card.facts.staff_in_city.value == 210
    assert card.from_signalhire == [
        "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC). "
        "The company name was not checked, so the count may include other companies "
        "with a like name."
    ]
    assert card.problems == []
    assert fake.calls[-1] == "people:Acme Software|Melbourne, Australia|"


async def test_signalhire_is_not_asked_for_a_number_the_research_found(
    session: AsyncSession,
) -> None:
    fake = acme_on_signalhire()
    card = await research(session, FakeClaude(), rules=SIGNALHIRE_RULES, signalhire=fake)

    assert card.facts.staff_in_city.value == 250  # make_facts has 250 staff
    assert card.from_signalhire == [] and fake.calls == []


async def test_signalhire_is_not_asked_when_hubspot_filled_the_gap(session: AsyncSession) -> None:
    session.add(HubSpotCompany(hubspot_id="102", name="Acme Software Pty Ltd", source="export"))
    await session.flush()
    session.add(HubSpotOffice(hubspot_company_id="102", label="Melbourne", linkedin_staff=60))
    await session.commit()

    fake = acme_on_signalhire()
    card = await research(
        session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES, signalhire=fake
    )

    assert card.facts.staff_in_city.value == 60
    assert card.from_hubspot and card.from_signalhire == []
    assert fake.calls == []


async def test_a_signalhire_error_is_a_line_in_the_problems_and_the_lead_is_saved(
    session: AsyncSession,
) -> None:
    quota = SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily.")
    fake = acme_on_signalhire(people=quota)
    card = await research(
        session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES, signalhire=fake
    )

    assert card.facts.staff_in_city.value is None and card.from_signalhire == []
    assert card.problems == [
        "Signal Hire staff count: Signal Hire has no credits or quota left. Resets daily."
    ]
    assert card.result == "watch"  # no size, so a person checks it, as without Signal Hire
    assert await count(session, Lead) == 1


async def test_a_watchlist_company_goes_to_signalhire_only_with_its_own_switch(
    session: AsyncSession,
) -> None:
    from_hubspot = ResearchContext(origin="hubspot")
    fake = acme_on_signalhire()

    off = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        settings=lf_settings(),  # no .env, so the switch is at its default: off
        rules=SIGNALHIRE_RULES,
        context=from_hubspot,
        signalhire=fake,
    )
    assert fake.calls == [] and off.from_signalhire == []

    claude_only = lf_settings(hubspot_names_to_claude_ok=True)
    still_off = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        settings=claude_only,
        rules=SIGNALHIRE_RULES,
        context=from_hubspot,
        signalhire=fake,
    )
    assert fake.calls == [] and still_off.from_signalhire == []  # Claude's OK is not this OK

    approved = lf_settings(hubspot_names_to_signalhire_ok=True)
    on = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        settings=approved,
        rules=SIGNALHIRE_RULES,
        context=from_hubspot,
        signalhire=fake,
    )
    assert on.from_signalhire == [SIGNALHIRE_NOTE]


async def test_no_database_connection_is_held_while_signalhire_answers(
    session: AsyncSession,
) -> None:
    seen: list[bool] = []

    class Watching(FakeSignalHire):
        async def find_company(self, id_or_slug: str) -> CompanyRef | None:
            seen.append(session.in_transaction())
            return await super().find_company(id_or_slug)

        async def count_people(
            self, *, company: str, location: str | None = None, seniority: Sequence[str] = ()
        ) -> int:
            seen.append(session.in_transaction())
            return await super().count_people(
                company=company, location=location, seniority=seniority
            )

    card = await research(
        session,
        FakeClaude(facts=NO_STAFF),
        rules=SIGNALHIRE_RULES,
        signalhire=Watching([ACME_SOFTWARE], people=105),
    )

    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    assert seen == [False, False]  # the transaction had ended before each call


class Owned(FakeSignalHire):
    """A client the research made itself, so the research must close it."""

    closed = False

    async def aclose(self) -> None:
        self.closed = True


async def test_a_client_made_from_the_settings_is_used_and_closed(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owned = Owned([ACME_SOFTWARE], people=105)
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: owned)

    card = await research(session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES)

    assert card.from_signalhire == [SIGNALHIRE_NOTE]
    assert owned.closed


async def test_a_client_made_from_the_settings_is_closed_even_when_it_fails(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    quota = SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily.")
    owned = Owned([ACME_SOFTWARE], people=105, failures={"people": quota})
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: owned)

    card = await research(session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES)

    assert card.problems and card.from_signalhire == []
    assert owned.closed


async def test_without_a_key_there_is_no_client_and_nothing_happens(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(research_module, "get_signalhire", lambda settings: None)

    card = await research(session, FakeClaude(facts=NO_STAFF), rules=SIGNALHIRE_RULES)

    assert card.from_signalhire == [] and card.problems == []
    assert card.facts.staff_in_city.value is None


async def test_an_old_card_without_the_signalhire_list_still_loads(session: AsyncSession) -> None:
    card = await research(session, FakeClaude())
    saved = card.model_dump(mode="json")
    del saved["from_signalhire"]  # a card saved before this list existed

    assert LeadCard.model_validate(saved).from_signalhire == []


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


# --- A failed answer form is shown, not hidden (PLAN-V4 B4) --------------------------------------


async def test_a_failed_form_marks_the_card_and_says_the_facts_are_missing(
    session: AsyncSession,
) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    card = await research(session, FakeClaude(extract_error=refused))

    assert card.form_failed
    assert card.notes  # the search found notes: only the form failed
    assert card.summary == research_module.FORM_FAILED_SUMMARY
    assert card.facts.city.value is None
    assert "The form couldn't be filled. Every fact is unknown." in card.problems
    lead = await session.scalar(select(Lead))
    assert lead is not None and lead.card["form_failed"] is True


async def test_a_filled_form_is_not_marked(session: AsyncSession) -> None:
    card = await research(session, FakeClaude())
    assert not card.form_failed


# --- Refilling a lead whose form failed (PLAN-V4 B5) ---------------------------------------------


async def test_a_failed_lead_is_filled_again_from_its_saved_notes(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(session, FakeClaude(extract_error=refused))
    assert failed.form_failed

    claude = FakeClaude()
    card = await refill_lead(
        session, get_embedder(), claude, load_rules(), get_settings(), failed.id, TODAY
    )

    assert card is not None and not card.form_failed
    assert claude.calls == ["extract"]  # the saved notes, and no new web search
    assert card.id == failed.id
    assert (card.facts.city.value, card.result) == ("Melbourne", "pass")
    assert card.problems == []  # the old "form couldn't be filled" line is gone
    assert card.created_at == failed.created_at
    assert card.research.claude_requests == failed.research.claude_requests + 1
    assert card.research.web_searches == failed.research.web_searches
    lead = await session.scalar(select(Lead))
    assert lead is not None and (lead.result, lead.card["form_failed"]) == ("pass", False)
    assert await count(session, Lead) == 1
    assert await count(session, MemoryItem, kind="company_profile") == 1  # replaced, not added


async def test_refilling_needs_fresh_notes_and_a_lead(session: AsyncSession) -> None:
    refused = ClaudeError("Claude returned an error (400)", "The compiled grammar is too large.")
    failed = await research(session, FakeClaude(extract_error=refused))
    await session.execute(delete(MemoryItem).where(MemoryItem.kind == "source_note"))
    await session.commit()

    claude = FakeClaude()
    rules, settings = load_rules(), get_settings()
    assert await refill_lead(session, get_embedder(), claude, rules, settings, failed.id) is None
    assert await refill_lead(session, get_embedder(), claude, rules, settings, uuid.uuid4()) is None
    assert claude.calls == []  # nothing was paid for
