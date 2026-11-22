"""Smart choices (PLAN-V25 T1-1, choices 1 to 4): several companies that match are ranked by
what's likely, by code on our copy, and each find carries its level and one reason.

- each signal puts its company first, in choice 2's order: a meeting with the rep today or
  tomorrow, the rep's own company, a call by the rep in the last 30 days, an open deal, then
  HubSpot's last contacted date;
- the levels: one match is sure; the only one of the rep's own is sure, used at once; a signal
  only the top match has is likely, with its reason; no signal, or one shared, is unsure;
- the one on screen and a learned name stay sure;
- each choice tells itself apart by its city, else its owner, else its last call; at most 3;
- the card's own find ranks the same way, and nothing new is asked of Claude.

Made-up companies only: Harbour One, Harbour Two and Harbour Three Pty Ltd.
"""

from collections.abc import Iterator
from datetime import date, datetime, timedelta
from typing import Any

import pytest

from apps.companies.assistant import Assistant
from apps.companies.assistant_rank import Signals, day_said, details, level_of, meeting_words
from apps.companies.notes import MELBOURNE
from apps.companies.schemas import CompanyHit
from apps.companies.tables import LearnedName
from core.api.deps import settings_dependency
from core.hubspot.matching import forget_loaded_copy
from core.hubspot.models import HubSpotCall
from tests.companies.helpers import API, add, company, deal
from tests.companies.test_assistant_api import NOT_REAL_KEY, CommandClaude, a_copy, ask, rep, said
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_meetings_api import FakeMeetings, meeting, melbourne
from tests.core.auth_world import START, World

FIND = f"{API}/assistant/companies/find"
ONE, TWO, THREE = "401", "402", "403"


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
    """Mia (o1) has no meetings until a test gives her some."""
    made = FakeMeetings(owners={"mia": "o1"}, coming=[])
    world.app.state.meeting_source = made.source()
    return made


async def harbours(world: World, **three: Any) -> None:
    """Three companies a rep may mean by "Harbour", with no signal but what a test adds to
    Harbour Three, the last by name."""
    await a_copy(world)  # the team, and Mia as owner o1
    await add(
        world,
        company(ONE, "Harbour One Pty Ltd", city="Perth"),
        company(TWO, "Harbour Two Pty Ltd", city="Adelaide"),
        company(THREE, "Harbour Three Pty Ltd", city="Hobart", **three),
    )


def a_call(call_id: str, company_key: str, *, owner_id: str, days_ago: int) -> HubSpotCall:
    return HubSpotCall(
        hubspot_id=call_id,
        hubspot_company_id=company_key,
        owner_id=owner_id,
        called_at=START - timedelta(days=days_ago),
        outcome="No answer",
    )


async def log_call_with_harbour(world: World, claude: CommandClaude) -> dict[str, Any]:
    claude.replies = [said("log_call", company="Harbour")]
    async with rep(world) as client:
        return await ask(client, "Log a call with Harbour")


def keys(found: dict[str, Any]) -> list[str]:
    return [hit["key"] for hit in found["company"]["choices"]]


# --- Each signal, strongest first -------------------------------------------------------------


@pytest.mark.integration
async def test_no_signal_is_unsure_with_up_to_three_choices_told_apart_by_city(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = []
    await harbours(world)
    found = await log_call_with_harbour(world, claude)
    company = found["company"]
    assert company["level"] == "unsure" and company["found"] is None
    assert set(keys(found)) == {ONE, TWO, THREE}
    assert found["unsure"] == "Which Harbour?"
    assert {hit["key"]: hit["detail"] for hit in company["choices"]} == {
        ONE: "Perth",
        TWO: "Adelaide",
        THREE: "Hobart",
    }
    assert all(hit["reason"] is None for hit in company["choices"])
    assert len(claude.asked) == 1  # the ranking asks Claude nothing


@pytest.mark.integration
async def test_a_meeting_today_or_tomorrow_makes_it_likely_with_its_reason(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = [meeting("9200", THREE, "o1", melbourne(5, 14), title="Brief")]
    await harbours(world)
    found = await log_call_with_harbour(world, claude)
    company = found["company"]
    assert keys(found)[0] == THREE
    assert company["level"] == "likely" and company["found"] is None
    assert company["reason"] == "You meet them tomorrow at 2 pm."
    assert found["unsure"] == "Harbour Three Pty Ltd? You meet them tomorrow at 2 pm."


@pytest.mark.integration
async def test_someone_elses_meeting_or_a_later_one_doesnt_count(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = [
        meeting("9201", THREE, "o2", melbourne(5, 14)),  # Lee's, not Mia's
        meeting("9202", TWO, "o1", melbourne(9, 10)),  # Monday: not today or tomorrow
    ]
    await harbours(world)
    found = await log_call_with_harbour(world, claude)
    assert found["company"]["level"] == "unsure"


@pytest.mark.integration
async def test_the_only_one_of_the_reps_own_is_sure_and_used_at_once(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = []
    await harbours(world, owner_id="o1", owner="Mia Sample")
    found = await log_call_with_harbour(world, claude)
    company = found["company"]
    assert company["level"] == "sure" and company["reason"] == "Yours."
    assert company["found"]["key"] == THREE
    assert keys(found)[0] == THREE  # the others stay, for Change
    assert found["unsure"] is None
    assert found["read_back"] == "Log a call with Harbour Three Pty Ltd."


@pytest.mark.integration
async def test_a_call_by_the_rep_in_the_last_30_days_is_likely(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = []
    await harbours(world)
    await add(
        world,
        a_call("c-1", THREE, owner_id="o1", days_ago=2),  # Monday 2 Nov
        a_call("c-2", TWO, owner_id="o2", days_ago=1),  # Lee's: not Mia's
        a_call("c-3", ONE, owner_id="o1", days_ago=31),  # too long ago
    )
    found = await log_call_with_harbour(world, claude)
    assert keys(found)[0] == THREE
    assert found["company"]["level"] == "likely"
    assert found["company"]["reason"] == "You called them on Monday."


@pytest.mark.integration
async def test_an_open_deal_is_likely_and_a_closed_one_doesnt_count(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = []
    await harbours(world)
    await add(world, deal("d1", THREE, "Qualified Deal"), deal("d2", ONE, "Closed lost"))
    found = await log_call_with_harbour(world, claude)
    assert keys(found)[0] == THREE
    assert found["company"]["level"] == "likely"
    assert found["company"]["reason"] == "Open deal."


@pytest.mark.integration
async def test_a_stronger_signal_wins(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = [meeting("9203", TWO, "o1", melbourne(4, 21, 30))]  # tonight
    await harbours(world, owner_id="o1")
    found = await log_call_with_harbour(world, claude)
    assert keys(found)[:2] == [TWO, THREE]  # the meeting beats the rep's own
    assert found["company"]["level"] == "likely"
    assert found["company"]["reason"] == "You meet them at 9:30 pm."


@pytest.mark.integration
async def test_a_signal_two_share_is_unsure(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = []
    await harbours(world)
    await add(world, deal("d3", ONE, "Lead"), deal("d4", TWO, "Lead"))
    found = await log_call_with_harbour(world, claude)
    assert found["company"]["level"] == "unsure"
    assert set(keys(found)[:2]) == {ONE, TWO}  # both open deals come first
    assert found["company"]["choices"][0]["reason"] == "Open deal."


@pytest.mark.integration
async def test_last_contacted_orders_those_with_no_signal(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = []
    await harbours(world, last_contacted=date(2026, 11, 1))
    found = await log_call_with_harbour(world, claude)
    assert keys(found)[0] == THREE and found["company"]["level"] == "unsure"


# --- What stays sure ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_the_one_on_screen_and_a_learned_name_stay_sure(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = [meeting("9204", THREE, "o1", melbourne(5, 14))]
    await harbours(world)
    await add(
        world,
        LearnedName(heard="Harbr", heard_key="harbr", company_key=ONE, company_name="Harbour One"),
    )
    claude.replies = [said("log_call", company="Harbour"), said("log_call", company="Harbr")]
    async with rep(world) as client:
        on_screen = await ask(client, "Log a call with Harbour", on_page={"company_key": TWO})
        learned = await ask(client, "Log a call with Harbr")
    assert on_screen["company"]["found"]["key"] == TWO
    assert on_screen["company"]["level"] == "sure"
    assert on_screen["company"]["reason"] == "On screen."
    assert learned["company"]["found"]["key"] == ONE
    assert learned["company"]["level"] == "sure"
    assert learned["company"]["reason"] == "Picked for these words before."


@pytest.mark.integration
async def test_the_cards_own_find_ranks_the_same_way(
    world: World, settings: dict[str, Any], claude: CommandClaude, meetings: FakeMeetings
) -> None:
    meetings.coming = [meeting("9205", THREE, "o1", melbourne(5, 14))]
    await harbours(world)
    async with rep(world) as client:
        response = await client.get(FIND, params={"words": "Harbour"})
    assert response.status_code == 200, response.text
    found = response.json()
    assert found["company"]["level"] == "likely"
    assert found["company"]["choices"][0]["key"] == THREE
    assert found["line"] == "Harbour Three Pty Ltd? You meet them tomorrow at 2 pm."
    assert claude.asked == []


# --- The words, pure code -------------------------------------------------------------------------


def hit(key: str, city: str | None) -> CompanyHit:
    return CompanyHit(key=key, name=f"Harbour {key}", city=city, industry=None, source="hubspot")


def test_the_detail_is_the_city_else_the_owner_else_the_last_call() -> None:
    today = date(2026, 11, 4)
    called = datetime(2026, 11, 2, 1, tzinfo=MELBOURNE)
    signals = {
        "a": Signals(owner="Mia Sample", last_call=called),
        "b": Signals(owner="Lee Sample"),
    }
    assert details([hit("a", "Perth"), hit("b", "Hobart")], signals, today) == ["Perth", "Hobart"]
    assert details([hit("a", "Perth"), hit("b", "Perth")], signals, today) == [
        "Owner: Mia Sample",
        "Owner: Lee Sample",
    ]
    same = {"a": Signals(last_call=called), "b": Signals()}
    assert details([hit("a", None), hit("b", None)], same, today) == [
        "Last call 2 Nov",
        "No calls yet",
    ]


def test_the_levels() -> None:
    soon = datetime(2026, 11, 5, 14, tzinfo=MELBOURNE)
    assert level_of([Signals()]) == "sure"
    assert level_of([Signals(), Signals()]) == "unsure"
    assert level_of([Signals(mine=True), Signals()]) == "sure"
    assert level_of([Signals(mine=True), Signals(mine=True)]) == "unsure"
    assert level_of([Signals(meeting_at=soon), Signals(mine=True)]) == "likely"
    assert level_of([Signals(open_deal=True), Signals()]) == "likely"


def test_the_reasons_words() -> None:
    today = date(2026, 11, 4)  # a Wednesday
    assert meeting_words(datetime(2026, 11, 4, 14, tzinfo=MELBOURNE), today) == (
        "You meet them at 2 pm."
    )
    assert meeting_words(datetime(2026, 11, 5, 9, 30, tzinfo=MELBOURNE), today) == (
        "You meet them tomorrow at 9:30 am."
    )
    assert day_said(today, today) == "today"
    assert day_said(date(2026, 11, 3), today) == "yesterday"
    assert day_said(date(2026, 11, 2), today) == "on Monday"
    assert day_said(date(2026, 10, 20), today) == "on 20 Oct"
