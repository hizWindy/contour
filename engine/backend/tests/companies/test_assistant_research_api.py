"""Research in the Assistant through its routes (PLAN-V27 T4-1, the backend of T4-2, and T4-3),
with a fake Claude that records every request and a fake run engine:

- "Research Northwind" says what we know before any Claude request: HubSpot's view, the last
  lead card and Property Daily's lease end and size from our copy, each with its day and source;
- each next step: a lead card from the last 30 days opens, a HubSpot company with recent activity
  opens its call prep, a new or quiet one asks first with the cost, a maybe asks which, and
  "research" alone asks for a name;
- Claude gets no more than the words said, when the words need it at all;
- without the Lead Finder's Start a run tick the card says so and the route starts nothing (403),
  and a Viewer can't start one;
- the start route hands the run engine one company marked `from_assistant`, so its caps, the run
  limit and the daily limit apply as to any run (tests/lead_finder/test_assistant_runs.py runs it).

Made-up names only (Northwind, Sample Logistics, Jo Sample).
"""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from apps.companies.assistant import Assistant
from apps.companies.assistant_research import NEEDS_LEAD_FINDER, NO_NAME, SAY_THE_NAME
from apps.lead_finder.params import CompanyParams
from core.api.deps import settings_dependency
from core.api.errors import Problem
from core.hubspot.matching import forget_loaded_copy
from core.runs.schemas import RunCreate, RunEstimate
from core.runs.validation import parse_params
from core.sources.models import PropertyRecordRow
from tests.companies.helpers import API, add, company
from tests.companies.test_assistant_api import (
    COMING,
    COMPANIES,
    NOT_REAL_KEY,
    CommandClaude,
    a_copy,
    ask,
    rep,
    said,
)
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_meetings_api import FakeMeetings
from tests.core.auth_world import START, World
from tests.lead_finder.factories import make_lead

pytestmark = pytest.mark.integration
RESEARCH = f"{API}/assistant/research"
LEAD_FINDER = ("lead_finder.start_run", "lead_finder.results")
WITH_LEAD_FINDER = (*COMPANIES, *LEAD_FINDER)
RUN_ID = "00000000-0000-4000-8000-000000000001"


class FakeRuns:
    """The run engine: `start` checks the params as the real one does and keeps each start, and
    `estimate` says what one company costs."""

    def __init__(self) -> None:
        self.started: list[tuple[str, str, dict[str, Any], str | None]] = []
        self.refuse: Problem | None = None

    async def start(
        self,
        app: str,
        mode: str,
        params: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> Any:
        parse_params(CompanyParams, params)  # 422 with the fields, as the real one
        if self.refuse is not None:
            raise self.refuse
        self.started.append((app, mode, params, idempotency_key))
        return SimpleNamespace(id=RUN_ID, status="queued")

    async def estimate(self, body: RunCreate, *, scheduled: bool = False) -> RunEstimate:
        return RunEstimate(valid=True, cost_usd_low=Decimal("0.3712"))


@pytest.fixture(autouse=True)
def fresh_copy() -> Iterator[None]:
    forget_loaded_copy()
    yield
    forget_loaded_copy()


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    chosen: dict[str, Any] = {
        "call_notes_ai_enabled": True,
        "anthropic_api_key": NOT_REAL_KEY,
        "meeting_forms_enabled": True,
    }
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def claude(world: World) -> CommandClaude:
    made = CommandClaude()
    world.app.state.assistant = Assistant(claude=lambda: made)
    return made


@pytest.fixture
def meetings(world: World) -> FakeMeetings:
    made = FakeMeetings(owners={"mia": "o1"}, coming=list(COMING))
    world.app.state.meeting_source = made.source()
    return made


@pytest.fixture
def runs(world: World) -> FakeRuns:
    made = FakeRuns()
    world.app.state.run_manager = made
    return made


def lease_record(name: str = "Northwind") -> PropertyRecordRow:
    return PropertyRecordRow(
        source="property_daily",
        kind="lease",
        via="lookup",
        company=name,
        company_key=name.casefold(),
        city=None,
        area_m2=1400,
        lease_end=date(2028, 3, 31),
        published_on=date(2026, 10, 3),
        summary="Leased 1,400 m2 on level 12, ending in March 2028.",
        url="https://propertydaily.example/report/1",
        record_key="northwind-lease",
        read_at=datetime(2026, 10, 3, 1, tzinfo=UTC),
    )


def lines(found: dict[str, Any]) -> list[str]:
    return [fact["text"] for fact in found["research"]["known"]]


# --- What we know, and what happens next (T4-1) --------------------------------------------------


async def test_a_new_company_says_what_we_know_and_asks_with_no_claude_request(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(world, lease_record())
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    assert claude.asked == []  # plainly research and a name: free
    assert found["action"] == "research"
    assert found["read_back"] == "Research Northwind? About US$0.38."
    research = found["research"]
    assert lines(found) == [
        "Northwind: not in HubSpot.",
        "Property Daily, 3 Oct: lease ends March 2028.",
        "Property Daily, 3 Oct: an office of 1,400 m².",
    ]
    assert research["known"][1]["url"] == "https://propertydaily.example/report/1"
    assert research["known"][1]["day"] == "2026-10-03"
    assert (research["next"], research["hubspot"], research["company"]) == (
        "ask",
        "new",
        "Northwind",
    )
    assert (research["lease_end"], research["area_m2"]) == ("2028-03-31", 1400)
    assert research["question"] == "Research Northwind? About US$0.38."
    assert research["cost_usd"] == "0.38"
    assert (research["can_start"], research["blocked"]) == (True, None)
    assert runs.started == []  # asking starts nothing


async def test_a_lead_card_from_the_last_30_days_opens_with_no_research(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(world, make_lead("Northwind", created_at=START - timedelta(days=5), tier="B"))
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    assert claude.asked == []
    research = found["research"]
    assert research["next"] == "open_lead"
    assert found["read_back"] == "Northwind has a lead card from 30 Oct. Opening it."
    assert research["lead"]["tier"] == "B"
    assert research["lead"]["link"] == f"/leads/{research['lead']['lead_id']}"
    assert lines(found) == ["Northwind: not in HubSpot.", "Lead Finder, 30 Oct: a B lead."]
    assert (research["question"], research["cost_usd"]) == (None, None)


async def test_a_lead_card_older_than_30_days_asks_again(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(world, make_lead("Northwind", created_at=START - timedelta(days=31), tier="B"))
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    assert found["research"]["next"] == "ask"
    assert found["research"]["lead"] is None


async def test_a_hubspot_company_worked_lately_opens_its_call_prep(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(
        world,
        company("301", "Northwind Pty Ltd", city="Perth", last_activity=START - timedelta(days=60)),
    )
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    assert claude.asked == []
    research = found["research"]
    assert found["read_back"] == "Northwind Pty Ltd is in HubSpot. Opening its call prep."
    assert (research["next"], research["hubspot"], research["company_key"]) == (
        "open_prep",
        "in_hubspot",
        "301",
    )
    assert research["last_activity"] == "2026-09-05"
    assert lines(found)[0] == "Northwind Pty Ltd is in HubSpot. Last activity 5 Sep."
    assert found["company"]["found"]["key"] == "301"


async def test_a_quiet_hubspot_company_asks_first(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    quiet_since = datetime(2025, 9, 1, 2, tzinfo=UTC)  # 14 months before START
    await add(world, company("301", "Northwind Pty Ltd", city="Perth", last_activity=quiet_since))
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    research = found["research"]
    assert (research["next"], research["hubspot"]) == ("ask", "quiet")
    assert lines(found)[0] == "Northwind Pty Ltd is in HubSpot, quiet since September 2025."
    assert found["read_back"] == "Research Northwind Pty Ltd? About US$0.38."
    # The run gets the words as said: HubSpot's name stays out of Claude while
    # hubspot_names_to_claude_ok is off (the rule-change skill's line)
    assert research["company"] == "Northwind"


async def test_with_levis_ok_the_run_gets_the_hubspot_name(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    settings["hubspot_names_to_claude_ok"] = True
    await a_copy(world)
    quiet_since = datetime(2025, 9, 1, 2, tzinfo=UTC)
    await add(world, company("301", "Northwind Pty Ltd", city="Perth", last_activity=quiet_since))
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    assert found["research"]["company"] == "Northwind Pty Ltd"


async def test_a_maybe_asks_which_company_best_guess_first(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(
        world,
        company("301", "Northwind Freight Pty Ltd", city="Perth"),
        company("302", "Northwind Logistics Pty Ltd", city="Melbourne"),
    )
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")

    assert claude.asked == []
    research = found["research"]
    assert (research["next"], research["hubspot"], research["company"]) == (
        "choose",
        "possible_match",
        "",
    )
    assert {choice["key"] for choice in found["company"]["choices"]} == {"301", "302"}
    assert found["company"]["level"] in ("likely", "unsure")
    assert research["question"] is None


async def test_research_alone_asks_for_a_name_and_uses_the_company_on_screen(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        alone = await ask(client, "Research")
        on_screen = await ask(client, "research it", on_page={"company_key": "201"})

    assert claude.asked == []
    assert alone["read_back"] == NO_NAME
    assert alone["research"]["next"] == "needs_name"
    assert alone["research"]["known"] == []
    # A HubSpot company's name never goes to Claude while the switch is off, so "research it"
    # on its page asks for the name, and starts nothing
    assert on_screen["research"]["company"] == ""
    assert (on_screen["research"]["can_start"], on_screen["research"]["blocked"]) == (
        False,
        SAY_THE_NAME,
    )
    assert on_screen["research"]["hubspot"] == "quiet"  # never worked: no activity date
    assert on_screen["company"]["from_page"] is True


async def test_claude_gets_only_the_words_said_when_they_need_it(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    claude.replies = [said("research", company="North Wind")]
    words = "What do we know about North Wind? Call me on 0412 345 678"
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, words)

    assert len(claude.asked) == 1
    prompt = claude.asked[0]["prompt"]
    assert "What do we know about North Wind?" in prompt
    assert "0412 345 678" not in prompt  # scrubbed before Claude
    for name in ("Sample Logistics", "Sample Freight", "Jo Sample", "Mia Sample"):
        assert name not in prompt  # nothing from our copy
    assert "research:" in claude.asked[0]["system"]
    assert found["research"]["next"] == "ask"
    assert found["research"]["company"] == "North Wind"


# --- Access and limits (T4-3) --------------------------------------------------------------------


async def test_without_the_lead_finder_the_card_says_so_and_the_route_starts_nothing(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(world, lease_record())
    async with rep(world, features=COMPANIES) as client:
        found = await ask(client, "Research Northwind")
        refused = await client.post(RESEARCH, json={"company": "Northwind"})

    research = found["research"]
    assert (research["can_start"], research["blocked"]) == (False, NEEDS_LEAD_FINDER)
    assert research["question"] is None and research["cost_usd"] is None
    assert lines(found) == ["Northwind: not in HubSpot."]  # the Lead Finder's facts stay hidden
    assert (found["read_back"], found["unsure"]) == (
        "Northwind: not in HubSpot.",
        NEEDS_LEAD_FINDER,
    )
    assert refused.status_code == 403
    assert refused.json()["code"] == "feature_not_allowed"
    assert refused.json()["detail"] == NEEDS_LEAD_FINDER
    assert runs.started == []


async def test_seeing_results_is_not_enough_to_start_one(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    async with rep(world, features=(*COMPANIES, "lead_finder.results")) as client:
        found = await ask(client, "Research Northwind")
        refused = await client.post(RESEARCH, json={"company": "Northwind"})

    assert found["research"]["can_start"] is False
    assert refused.status_code == 403
    assert runs.started == []


async def test_a_viewer_cant_start_a_research(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    async with rep(world, "vic", role="viewer", features=WITH_LEAD_FINDER) as client:
        refused = await client.post(RESEARCH, json={"company": "Northwind"})
        command = await client.post(
            f"{API}/assistant/command", json={"text": "Research Northwind", "source": "typed"}
        )

    assert refused.status_code == 403
    assert refused.json()["code"] == "viewer_read_only"
    assert command.status_code == 403
    assert runs.started == []


async def test_the_start_hands_the_run_engine_one_company_from_the_assistant(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    body = {"company": "Northwind", "city": "Perth"}
    headers = {"Idempotency-Key": "card-1"}
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        started = await client.post(RESEARCH, json=body, headers=headers)
        nobody = await client.post(RESEARCH)  # no body: 422 before anything starts

    assert started.status_code == 201, started.text
    assert started.json() == {"run_id": RUN_ID, "company": "Northwind", "status": "queued"}
    assert runs.started == [
        (
            "lead_finder",
            "company",
            {"companies": [{"name": "Northwind", "city": "Perth"}], "from_assistant": True},
            "card-1",
        )
    ]
    assert nobody.status_code == 422
    assert claude.asked == []  # starting asks the command step nothing


async def test_a_hubspot_company_starts_under_the_reps_words_never_hubspots_name(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    """The review's blocker: whatever name the card sends for a HubSpot company, the run gets
    the rep's own words while hubspot_names_to_claude_ok is off, and nothing without them."""
    await a_copy(world)
    await add(world, company("302", "Northwind Logistics Pty Ltd", city="Melbourne"))
    picked = {"company": "Northwind Logistics Pty Ltd", "company_key": "302"}
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        with_words = await client.post(RESEARCH, json={**picked, "said": "Northwind"})
        without = await client.post(RESEARCH, json=picked)

    assert with_words.status_code == 201, with_words.text
    assert runs.started[0][2]["companies"][0]["name"] == "Northwind"
    assert without.status_code == 422
    assert without.json()["detail"] == SAY_THE_NAME
    assert len(runs.started) == 1  # the refused one started nothing


async def test_with_levis_ok_a_hubspot_company_starts_under_its_hubspot_name(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    settings["hubspot_names_to_claude_ok"] = True
    await a_copy(world)
    await add(world, company("302", "Northwind Logistics Pty Ltd", city="Melbourne"))
    body = {"company": "Northwind", "company_key": "302", "said": "Northwind"}
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        started = await client.post(RESEARCH, json=body)

    assert started.status_code == 201, started.text
    assert runs.started[0][2]["companies"][0]["name"] == "Northwind Logistics Pty Ltd"


async def test_the_run_engines_refusals_come_back_in_plain_words(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        bad = await client.post(RESEARCH, json={"company": "!!"})
        runs.refuse = Problem(
            409,
            "A run is already going",
            "Wait for it to finish, or stop it, then start this one.",
            code="run_already_active",
        )
        busy = await client.post(RESEARCH, json={"company": "Northwind"})

    assert bad.status_code == 422
    assert bad.json()["code"] == "research_name"
    assert bad.json()["detail"].startswith("Use the company's name: 2 to 80 characters")
    assert busy.status_code == 409
    assert busy.json()["code"] == "run_already_active"
    assert runs.started == []


async def test_without_the_run_engine_the_start_says_it_isnt_ready(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        found = await ask(client, "Research Northwind")
        refused = await client.post(RESEARCH, json={"company": "Northwind"})

    assert found["research"]["cost_usd"] == "0.40"  # no estimate: the plan's figure
    assert refused.status_code == 503


# --- The block for a settled company (GET /assistant/research) ----------------------------------


async def test_the_block_for_a_choice_picked_or_a_new_name_is_free(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    runs: FakeRuns,
) -> None:
    await a_copy(world)
    await add(
        world,
        company("301", "Northwind Freight Pty Ltd", last_activity=START - timedelta(days=10)),
        company("302", "Northwind Logistics Pty Ltd"),
    )
    async with rep(world, features=WITH_LEAD_FINDER) as client:
        picked = (await client.get(RESEARCH, params={"company_key": "301"})).json()
        quiet = (
            await client.get(RESEARCH, params={"company_key": "302", "name": "Northwind"})
        ).json()
        no_words = (await client.get(RESEARCH, params={"company_key": "302"})).json()
        new = (await client.get(RESEARCH, params={"name": "Northwind"})).json()
        gone = await client.get(RESEARCH, params={"company_key": "999"})
        nothing = (await client.get(RESEARCH)).json()

    assert claude.asked == []
    assert (picked["next"], picked["hubspot"]) == ("open_prep", "in_hubspot")
    assert (quiet["next"], quiet["hubspot"]) == ("ask", "quiet")
    assert quiet["question"] == "Research Northwind Logistics Pty Ltd? About US$0.38."
    assert quiet["company"] == "Northwind"  # the words as said go to the run, not HubSpot's name
    # With no words, a HubSpot company can't be researched: its name stays out of Claude
    assert (no_words["can_start"], no_words["blocked"], no_words["question"]) == (
        False,
        SAY_THE_NAME,
        None,
    )
    assert (new["next"], new["hubspot"], new["company"]) == ("ask", "new", "Northwind")
    assert gone.status_code == 404
    assert nothing["next"] == "needs_name"
