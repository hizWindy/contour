"""A short memory (PLAN-V25 T5-1, choice 21): the conversation's last turn, as the bar keeps it.

- "same company" uses the last turn's company;
- "and Jo too" logs a second call with the same company, even with another company on screen;
- "her" is the last turn's person, at the same company;
- a new conversation (no last turn) remembers nothing;
- a last company this person can't open is never used;
- Claude gets the last turn's names as heard, and nothing more: no id, no other turn.

Made-up names only: Sample Logistics Pty Ltd, Sample Freight Pty Ltd, Jo Sample.
"""

from collections.abc import Iterator
from typing import Any

import pytest

from apps.companies.assistant import Assistant
from core.api.deps import settings_dependency
from core.hubspot.matching import forget_loaded_copy
from tests.companies.test_assistant_api import (
    NOT_REAL_KEY,
    CommandClaude,
    a_copy,
    ask,
    rep,
    said,
)
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_meetings_api import FakeMeetings
from tests.core.auth_world import World

pytestmark = pytest.mark.integration
LAST = {
    "action": "log_call",
    "company_key": "201",
    "company_heard": "Sample Logistics",
    "person_id": "c1",
    "person_heard": "Jo Sample",
}


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


async def test_same_company_uses_the_last_turns_company(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    claude.replies = [said("task", company="same company", subject="Send the quote")]
    async with rep(world) as client:
        found = await ask(client, "Add a task for the same company: send the quote", last_turn=LAST)
    assert found["company"]["found"]["key"] == "201"
    assert found["company"]["level"] == "sure"
    assert found["company"]["reason"] == "Same as before."


async def test_and_jo_too_adds_a_second_call_with_the_same_company(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    last = {**LAST, "person_id": "c2", "person_heard": "James Sample"}
    claude.replies = [said("log_call", person="Jo")]
    async with rep(world) as client:
        found = await ask(client, "And Jo too", last_turn=last, on_page={"company_key": "202"})
    assert found["action"] == "log_call"
    assert found["company"]["found"]["key"] == "201"  # the last turn's, not the one on screen
    assert found["person"]["found"]["id"] == "c1"


async def test_her_is_the_last_turns_person(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    claude.replies = [said("log_call", person="her", company="same company")]
    async with rep(world) as client:
        found = await ask(client, "Log another call with her, no answer", last_turn=LAST)
    assert found["company"]["found"]["key"] == "201"
    assert found["person"]["found"]["id"] == "c1"
    assert found["person"]["reason"] == "Same as before."


async def test_a_new_conversation_remembers_nothing(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    claude.replies = [said("task", company="same company", subject="Send the quote")]
    async with rep(world) as client:
        found = await ask(client, "Add a task for the same company: send the quote")
    assert found["company"]["found"] is None
    assert "last command" not in claude.asked[0]["prompt"]


async def test_a_last_company_i_cant_open_is_never_used(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    claude.replies = [said("log_call", person="Jo")]
    async with rep(world) as client:
        found = await ask(client, "And Jo too", last_turn={**LAST, "company_key": "999"})
    assert found["company"]["found"] is None


async def test_claude_gets_only_the_last_turns_names_as_heard(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    last = {**LAST, "company_heard": "Sample Logistics, call 0412 345 678"}
    claude.replies = [said("log_call", person="Jo")]
    async with rep(world) as client:
        await ask(client, "And Jo too", last_turn=last)
    prompt = claude.asked[0]["prompt"]
    assert "the company 'Sample Logistics, call [number left out]'" in prompt
    assert "the person 'Jo Sample'" in prompt
    assert "201" not in prompt and "c1" not in prompt  # no id ever
    assert "0412" not in prompt


async def test_an_unsaid_company_from_the_last_turn_is_only_a_suggestion(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    # M1 review: no company said and nothing on screen: the last turn's company is suggested,
    # never sure, so "No answer, Jo" never becomes a quick log to it.
    await a_copy(world)
    claude.replies = [said("log_call", person="Jo")]
    async with rep(world) as client:
        found = await ask(client, "No answer, Jo", last_turn=LAST)
    assert found["company"]["found"]["key"] == "201"
    assert found["company"]["level"] == "likely"
    assert found["quick"] is False


async def test_a_follow_up_said_is_never_a_quick_log(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    await a_copy(world)
    claude.replies = [said("log_call", person="her", company="same company")]
    async with rep(world) as client:
        found = await ask(client, "No answer from her, follow up", last_turn=LAST)
    assert found["company"]["level"] == "sure"
    assert found["quick"] is False
