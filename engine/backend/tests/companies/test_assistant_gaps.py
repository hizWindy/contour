"""Fill the gaps (PLAN-V25 Part 3), the command step's side:

- T3-1: a call command carries the call type: Prospecting Call by default, Follow Up Call or the
  networking type when the command words say so; on an open card, "make it a follow-up call"
  changes it, and a type HubSpot doesn't list isn't taken.
- T3-2: a task with no day gets a suggested one (the next working day) with "in a week" beside
  it; with no subject, a suggestion from the company; two teammates with one name give choices;
  a call gives the day a follow-up nudge suggests.
- T3-3: a call that is only an outcome, with a sure company and person, is a quick log; words,
  a follow-up, or any doubt still open the card.

Made-up names only: Sample Logistics Pty Ltd, Jo Sample, Lee Sample, Lee Other.
"""

from collections.abc import Iterator
from datetime import date
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
ON_SCREEN = {"company_key": "201"}  # Sample Logistics Pty Ltd, with Jo Sample (c1)
NEXT_WORKING_DAY = date(2026, 11, 5)  # START is Wednesday 4 Nov, 8 pm in Melbourne


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


async def commands(
    world: World, claude: CommandClaude, *asked: tuple[str, dict[str, Any]], **more: Any
) -> list[dict[str, Any]]:
    """Each (words, Claude's answer) in turn, with Sample Logistics on screen."""
    await a_copy(world)
    claude.replies = [said(**answer) for _, answer in asked]
    async with rep(world) as client:
        return [await ask(client, words, on_page=ON_SCREEN, **more) for words, _ in asked]


# --- T3-1: the call type --------------------------------------------------------------------------


async def test_a_call_carries_its_call_type_prospecting_by_default(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    plain, follow_up, networking = await commands(
        world,
        claude,
        ("Log a call with Jo Sample", {"action": "log_call", "person": "Jo Sample"}),
        (
            "Log a follow-up call with Jo Sample",
            {
                "action": "log_call",
                "person": "Jo Sample",
                "note_cut": "Log a follow-up call with Jo Sample",
            },
        ),
        ("Networking call with Jo Sample", {"action": "log_call", "person": "Jo Sample"}),
    )
    assert plain["call_type"] == "Prospecting Call"
    assert follow_up["call_type"] == "Follow Up Call"
    assert networking["call_type"] == "Agent/Networking Phone Call"


async def test_make_it_a_follow_up_call_changes_it_on_the_card(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    card = {"action": "log_call", "boxes": ["outcome", "call_type", "follow-up"]}
    changed, refused = await commands(
        world,
        claude,
        (
            "Make it a follow-up call",
            {"action": "change", "box": "call_type", "value": "follow-up call"},
        ),
        ("Make it a sales call", {"action": "change", "box": "call_type", "value": "sales call"}),
        card=card,
    )
    assert changed["action"] == "change"
    assert changed["change"] == {"box": "call_type", "value": "Follow Up Call", "day": None}
    assert refused["action"] == "unknown"
    assert refused["unsure"].startswith("That isn't one of HubSpot's call types")


# --- T3-3: the quick log --------------------------------------------------------------------------


async def test_only_an_outcome_with_a_sure_company_and_person_is_a_quick_log(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    (quick,) = await commands(
        world,
        claude,
        ("No answer, Jo Sample", {"action": "log_call", "person": "Jo Sample"}),
    )
    assert quick["quick"] is True and quick["outcome"] == "No answer"
    assert quick["company"]["found"]["key"] == "201" and quick["person"]["found"]["id"] == "c1"
    assert quick["unsure"] is None


async def test_words_a_follow_up_or_doubt_still_open_the_card(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    words, follow_up, no_person, connected = await commands(
        world,
        claude,
        (
            "Jo Sample didn't answer, she's moving in March",
            {"action": "log_call", "person": "Jo Sample"},
        ),
        (
            "No answer from Jo Sample, follow up Friday",
            {"action": "log_call", "person": "Jo Sample", "when": "this friday"},
        ),
        ("No answer from James", {"action": "log_call", "person": "James"}),  # two James
        ("Spoke to Jo Sample", {"action": "log_call", "person": "Jo Sample"}),
    )
    assert words["quick"] is False and words["outcome"] is None
    assert follow_up["quick"] is False
    assert no_person["quick"] is False and no_person["outcome"] == "No answer"
    assert connected["quick"] is False
    assert connected["follow_up_day"] == NEXT_WORKING_DAY.isoformat()  # the nudge's day


# --- T3-2: a clear task ---------------------------------------------------------------------------


async def test_a_task_with_no_day_suggests_one_and_with_no_subject_suggests_one(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    no_day, no_subject, said_day = await commands(
        world,
        claude,
        ("Remind me to send the quote", {"action": "task", "subject": "Send the quote"}),
        ("Add a task", {"action": "task"}),
        (
            "Remind me Friday to send the quote",
            {"action": "task", "subject": "Send the quote", "when": "this friday"},
        ),
    )
    task = no_day["task"]
    assert task["due_level"] == "likely"
    assert task["due"] == NEXT_WORKING_DAY.isoformat()
    assert task["due_choices"] == ["2026-11-05", "2026-11-12"]  # then in a week
    assert no_day["unsure"] is None  # a suggestion, not a "check the date"
    assert no_subject["task"]["subject"] == "Follow up with Sample Logistics Pty Ltd"
    assert no_subject["task"]["subject_suggested"] is True
    assert said_day["task"]["due_level"] == "sure" and said_day["task"]["due_choices"] == []
    assert said_day["task"]["subject_suggested"] is False


async def test_two_teammates_with_one_name_give_choices(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    (task,) = await commands(
        world,
        claude,
        (
            "Remind Lee to send the quote",
            {"action": "task", "subject": "Send the quote", "task_for": "Lee"},
        ),
    )
    owner = task["task"]["owner"]
    assert owner["found"] is None and owner["level"] == "unsure"
    assert [member["name"] for member in owner["choices"]] == ["Lee Sample", "Lee Other"]
    assert task["unsure"] == "Which Lee?"
