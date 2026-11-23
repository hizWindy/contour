"""The command step finds better (PLAN-V23 T1-3, choices 3 to 5), through its route, with a fake
Claude and a fake HubSpot:

- "North Wind" with a learned pair finds Northwind, before the close-name match; the same words
  taught for two companies give both; the company on screen still wins when the words are close
  to it;
- a company only in HubSpot is found by HubSpot's own search and is then in our copy, with "{name}
  is new in HubSpot. We'll use it."; several give choices;
- nothing anywhere gives `can_add`, with "{name} isn't in HubSpot. Add it, or pick another
  company."; with no HubSpot, or HubSpot not answering, the answer is as before;
- garbled words give `unclear` with the words as heard, and words too short to be a command do
  so with no Claude request;
- none of these writes to HubSpot.

Made-up companies and people only (Northwind, Sample Logistics Pty Ltd, Jo Sample).
"""

from collections.abc import Iterator
from typing import Any

import pytest

from apps.companies.assistant import Assistant
from apps.companies.tables import LearnedName
from core.api.deps import settings_dependency
from core.hubspot.client import HubSpotUnavailable
from core.hubspot.matching import forget_loaded_copy
from core.hubspot.models import HubSpotCompany, HubSpotWrite
from tests.companies.helpers import add, company
from tests.companies.test_assistant_api import (
    COMING,
    NOT_REAL_KEY,
    CommandClaude,
    a_copy,
    ask,
    rep,
    said,
)
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_meetings_api import FakeMeetings
from tests.core.auth_world import World, all_rows
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration
WRITES = ("create", "update", "add_to")
UNCLEAR = "We didn't catch that clearly. You said: '{}'. Say it again, or fix the words."


@pytest.fixture(autouse=True)
def fresh_copy() -> Iterator[None]:
    forget_loaded_copy()  # each test has its own HubSpot copy
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
def hubspot(world: World) -> FakeHubSpot:
    """HubSpot itself, with companies our copy doesn't have: Sample Fresh Pty Ltd, and two Sample
    Harbour companies."""
    fake = FakeHubSpot()
    fake.add_company("950", name="Sample Fresh Pty Ltd", city="Adelaide")
    fake.add_company("951", name="Sample Harbour East Pty Ltd")
    fake.add_company("952", name="Sample Harbour West Pty Ltd")
    world.app.state.hubspot_provider = lambda: fake
    return fake


def writes(fake: FakeHubSpot) -> list[str]:
    return [call for call in fake.calls if call.startswith(WRITES)]


async def northwinds(world: World) -> None:
    """Northwind Pty Ltd (found by the close-name match for "North Wind") and Northwind Freight
    Australia (which it can't find)."""
    await add(
        world,
        company("301", "Northwind Pty Ltd", city="Perth"),
        company("302", "Northwind Freight Australia", city="Melbourne"),
    )


def taught(heard: str, company_key: str, name: str) -> LearnedName:
    return LearnedName(
        heard=heard, heard_key=heard.casefold(), company_key=company_key, company_name=name
    )


# --- Learned names come first -------------------------------------------------------------------


async def test_north_wind_with_a_learned_pair_finds_northwind_freight(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    await add(world, company("302", "Northwind Freight Australia", city="Melbourne"))
    claude.replies = [
        said("log_call", company="North Wind"),
        said("log_call", company="North Wind"),
    ]
    async with rep(world) as client:
        before = await ask(client, "Log a call with North Wind")
        await add(world, taught("North Wind", "302", "Northwind Freight Australia"))
        after = await ask(client, "Log a call with North Wind")
    assert before["company"]["found"] is None  # our copy alone can't tell
    assert after["company"]["found"]["key"] == "302"
    assert after["company"]["from_hubspot"] is False and after["unsure"] is None
    assert after["read_back"] == "Log a call with Northwind Freight Australia."


async def test_a_learned_pair_comes_before_the_close_name_match(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await northwinds(world)
    claude.replies = [said("task", company="North Wind", subject="Send the plan")] * 2
    async with rep(world) as client:
        close = await ask(client, "Add a task for North Wind to send the plan")
        await add(world, taught("North Wind", "302", "Northwind Freight Australia"))
        learned = await ask(client, "Add a task for North Wind to send the plan")
    assert close["company"]["found"]["key"] == "301"  # "NorthWind" run together: Northwind
    assert learned["company"]["found"]["key"] == "302"


async def test_the_same_words_taught_for_two_companies_give_both(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await northwinds(world)
    await add(
        world,
        taught("North Wind", "301", "Northwind Pty Ltd"),
        taught("North Wind", "302", "Northwind Freight Australia"),
    )
    claude.replies = [said("log_call", company="North Wind")] * 2
    async with rep(world) as client:
        both = await ask(client, "Log a call with North Wind")
        on_screen = await ask(client, "Log a call with North Wind", on_page={"company_key": "301"})
    assert both["company"]["found"] is None
    assert sorted(hit["key"] for hit in both["company"]["choices"]) == ["301", "302"]
    assert both["unsure"] == "Which North Wind?"
    assert on_screen["company"]["found"]["key"] == "301" and on_screen["company"]["from_page"]


async def test_the_company_on_screen_still_wins_when_the_words_are_close_to_it(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await northwinds(world)
    await add(world, taught("North Wind", "302", "Northwind Freight Australia"))
    claude.replies = [said("log_call", company="North Wind")]
    async with rep(world) as client:
        found = await ask(client, "Log a call with North Wind", on_page={"company_key": "301"})
    assert found["company"]["found"]["key"] == "301" and found["company"]["from_page"]


# --- HubSpot's own search ----------------------------------------------------------------------


async def test_a_company_only_in_hubspot_is_found_and_is_then_in_our_copy(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    hubspot: FakeHubSpot,
) -> None:
    await a_copy(world)
    claude.replies = [said("log_call", company="Sample Fresh", person="Jo")] * 2
    async with rep(world) as client:
        found = await ask(client, "Log a call with Jo at Sample Fresh")
        asked = list(hubspot.calls)
        again = await ask(client, "Log a call with Jo at Sample Fresh")
    company_found = found["company"]
    assert company_found["found"] == {
        "key": "950",
        "name": "Sample Fresh Pty Ltd",
        "city": "Adelaide",
        "industry": None,
        "source": "hubspot",
    }
    assert company_found["from_hubspot"] is True and company_found["can_add"] is False
    assert found["unsure"] == (
        "Sample Fresh Pty Ltd is new in HubSpot. We'll use it. "
        "We couldn't find 'Jo' at Sample Fresh Pty Ltd. Pick the person, or leave them out."
    )
    assert asked == ["search_companies", "properties_companies"]  # one search, then pick lists
    copied = await all_rows(world, HubSpotCompany)
    assert "950" in {row.hubspot_id for row in copied}
    assert again["company"]["found"]["key"] == "950" and not again["company"]["from_hubspot"]
    assert hubspot.calls == asked  # now in our copy: HubSpot isn't asked again
    assert writes(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


async def test_several_in_hubspot_give_choices_all_in_our_copy(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    hubspot: FakeHubSpot,
) -> None:
    await a_copy(world)
    claude.replies = [said("task", company="Sample Harbour", subject="Book a visit")]
    async with rep(world) as client:
        found = await ask(client, "Add a task for Sample Harbour to book a visit")
    assert found["company"]["found"] is None and found["company"]["from_hubspot"] is True
    assert [hit["key"] for hit in found["company"]["choices"]] == ["951", "952"]
    assert found["unsure"].startswith("Which Sample Harbour?")
    copied = {row.hubspot_id for row in await all_rows(world, HubSpotCompany)}
    assert {"951", "952"} <= copied
    assert writes(hubspot) == []


async def test_nothing_anywhere_gives_can_add(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    hubspot: FakeHubSpot,
) -> None:
    await a_copy(world)
    claude.replies = [said("log_call", company="Zebra Holdings")]
    async with rep(world) as client:
        found = await ask(client, "Log a call with Zebra Holdings")
    assert found["company"] == {
        "heard": "Zebra Holdings",
        "from_page": False,
        "found": None,
        "choices": [],
        "from_hubspot": False,
        "can_add": True,
        "level": None,
        "reason": None,
    }
    assert found["unsure"] == "Zebra Holdings isn't in HubSpot. Add it, or pick another company."
    assert hubspot.calls == ["search_companies"]  # "Zebra": one word once Holdings is left out
    assert writes(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


async def test_with_hubspot_not_answering_the_answer_is_as_before(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    hubspot: FakeHubSpot,
) -> None:
    await a_copy(world)
    hubspot.fail["search_companies"] = [HubSpotUnavailable("HubSpot is down", "Try later.")]
    claude.replies = [said("log_call", company="Sample Fresh")]
    async with rep(world) as client:
        found = await ask(client, "Log a call with Sample Fresh")
    assert found["company"]["found"] is None and found["company"]["can_add"] is False
    assert found["unsure"] == "We couldn't find 'Sample Fresh' in HubSpot. Pick the company."
    assert "950" not in {row.hubspot_id for row in await all_rows(world, HubSpotCompany)}


# --- Unclear words ------------------------------------------------------------------------------


async def test_garbled_words_give_unclear_with_the_words_as_heard(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    words = "the uh for at blue Thursday"
    claude.replies = [said("unclear"), said("unclear")]
    async with rep(world) as client:
        found = await ask(client, words)
        on_card = await ask(
            client, words, card={"action": "task", "boxes": ["subject", "due", "owner"]}
        )
    for answer in (found, on_card):
        assert answer["action"] == "unclear"
        assert answer["read_back"] == words
        assert answer["unsure"] == UNCLEAR.format(words)
        assert [answer[part] for part in ("company", "task", "email", "open", "change")] == [
            None
        ] * 5
    assert "unclear" in claude.asked[0]["system"]
    assert "are unclear." in claude.asked[1]["prompt"]


@pytest.mark.parametrize("words", ["um", "Uh, er...", "a", "?", "12", "hmm mm"])
async def test_words_too_short_to_be_a_command_are_unclear_with_no_request(
    world: World,
    settings: dict[str, Any],
    claude: CommandClaude,
    meetings: FakeMeetings,
    words: str,
) -> None:
    async with rep(world) as client:
        found = await ask(client, words)
    assert found["action"] == "unclear"
    assert found["unsure"] == UNCLEAR.format(found["read_back"])
    assert claude.asked == []  # free: no request


async def test_one_real_word_still_goes_to_claude(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    claude.replies = [said("open", page="today")]
    async with rep(world) as client:
        found = await ask(client, "Today")
    assert found["action"] == "open" and len(claude.asked) == 1
