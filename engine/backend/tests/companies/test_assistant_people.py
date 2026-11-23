"""Start from the person (PLAN-V25 T2-1, choices 8 to 11): "Log a call with Jo Sample" with no
company finds Jo Sample among the people of every company in our copy, with her company.

- one person found: suggested with their company ("Lee Client at Northwind Sample Pty Ltd?");
- two people with the name: choices, each with their company, ranked by the rep's own companies,
  then the rep's calls with them in the last 30 days, then last activity;
- someone at a company the rep can't open (not in our copy) is never offered: found nowhere,
  the card's people search opens;
- a company said with the person still wins, and so does the one on screen that has them; the one
  on screen that doesn't have them gives way to the person found elsewhere.

The call's deal follows its company when it is sent, as it does now (activities.py).

Made-up names only: Jo Sample, Lee Client, Jo Hidden, Northwind Sample Pty Ltd.
"""

from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest

from apps.companies.assistant import Assistant
from core.api.deps import settings_dependency
from core.hubspot.matching import forget_loaded_copy
from core.hubspot.models import HubSpotCall, HubSpotContact
from tests.companies.helpers import add, company
from tests.companies.test_assistant_api import NOT_REAL_KEY, CommandClaude, a_copy, ask, rep, said
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_meetings_api import FakeMeetings
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
NORTHWIND = "301"


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
    made = FakeMeetings(owners={"mia": "o1"}, coming=[])
    world.app.state.meeting_source = made.source()
    return made


async def people(world: World, **northwind: Any) -> None:
    """Sample Logistics (201) has Jo Sample (c1), as `a_copy` makes it. Northwind (301) has
    another Jo Sample (c10) and Lee Client (c11). Jo Hidden's company isn't in our copy."""
    await a_copy(world)
    await add(world, company(NORTHWIND, "Northwind Sample Pty Ltd", city="Hobart", **northwind))
    await add(
        world,
        HubSpotContact(
            hubspot_id="c10",
            hubspot_company_id=NORTHWIND,
            name="Jo Sample",
            job_title="CFO",
            last_activity=START - timedelta(days=3),
        ),
        HubSpotContact(hubspot_id="c11", hubspot_company_id=NORTHWIND, name="Lee Client"),
        HubSpotContact(hubspot_id="c12", hubspot_company_id="999", name="Jo Hidden"),
    )


async def log_call(
    world: World, claude: CommandClaude, words: str, **answer: Any
) -> dict[str, Any]:
    claude.replies = [said("log_call", **answer)]
    async with rep(world) as client:
        return await ask(client, words)


def choices(found: dict[str, Any]) -> list[tuple[str, str]]:
    return [(hit["id"], hit["company_key"]) for hit in found["person"]["choices"]]


async def test_one_person_found_without_the_company_is_suggested_with_it(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world)
    found = await log_call(world, claude, "Log a call with Lee Client", person="Lee Client")
    person = found["person"]
    assert person["found"] is None and person["level"] == "likely"
    assert person["choices"][0]["company_name"] == "Northwind Sample Pty Ltd"
    assert choices(found) == [("c11", NORTHWIND)]
    assert found["company"]["found"] is None and found["company"]["heard"] == ""
    assert found["unsure"] == "Lee Client at Northwind Sample Pty Ltd?"
    assert len(claude.asked) == 1  # one request, as before: the find is code


async def test_two_people_with_the_name_give_choices_each_with_their_company(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world)
    found = await log_call(world, claude, "Log a call with Jo Sample", person="Jo Sample")
    # No signal: the most recently active first (c10, 3 days ago; c1 has no activity).
    assert choices(found) == [("c10", NORTHWIND), ("c1", "201")]
    assert found["person"]["level"] == "unsure"
    assert found["unsure"] == "Which Jo Sample?"


async def test_the_reps_own_company_then_their_calls_rank_first(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world)
    await add(
        world,
        HubSpotCall(
            hubspot_id="k1",
            hubspot_company_id="201",
            hubspot_contact_id="c1",
            owner_id="o1",
            called_at=START - timedelta(days=2),  # Monday 2 Nov
        ),
    )
    called = await log_call(world, claude, "Log a call with Jo Sample", person="Jo Sample")
    assert choices(called)[0] == ("c1", "201")
    assert called["person"]["level"] == "likely"
    assert called["person"]["reason"] == "You called them on Monday."
    assert called["unsure"] == "Jo Sample at Sample Logistics Pty Ltd? You called them on Monday."


async def test_the_reps_own_company_beats_a_call(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world, owner_id="o1")
    await add(
        world,
        HubSpotCall(
            hubspot_id="k2",
            hubspot_company_id="201",
            hubspot_contact_id="c1",
            owner_id="o1",
            called_at=START - timedelta(days=1),
        ),
    )
    found = await log_call(world, claude, "Log a call with Jo Sample", person="Jo Sample")
    assert choices(found)[0] == ("c10", NORTHWIND)
    assert found["person"]["reason"] == "Yours."


async def test_someone_the_rep_cant_open_is_never_offered(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world)
    found = await log_call(world, claude, "Log a call with Jo Hidden", person="Jo Hidden")
    assert found["person"]["choices"] == [] and found["person"]["found"] is None
    assert found["unsure"] == (
        "There's no 'Jo Hidden' in HubSpot. Say the company, or pick the person."
    )


async def test_a_company_said_with_the_person_still_wins(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world)
    found = await log_call(
        world,
        claude,
        "Log a call with Jo Sample at Sample Logistics",
        person="Jo Sample",
        company="Sample Logistics",
    )
    assert found["company"]["found"]["key"] == "201"
    assert found["person"]["found"]["id"] == "c1"


async def test_the_one_on_screen_wins_when_it_has_them_and_gives_way_when_not(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await people(world)
    claude.replies = [said("log_call", person="Jo Sample"), said("log_call", person="Lee Client")]
    async with rep(world) as client:
        there = await ask(client, "Log a call with Jo Sample", on_page={"company_key": "201"})
        elsewhere = await ask(client, "Log a call with Lee Client", on_page={"company_key": "201"})
    assert there["company"]["found"]["key"] == "201" and there["person"]["found"]["id"] == "c1"
    assert elsewhere["company"]["found"] is None
    assert choices(elsewhere) == [("c11", NORTHWIND)]
