"""The card's own company find (PLAN-V24 T3-2, choice 19), `GET /assistant/companies/find`: a
company said again on the review card is found as the command step finds it, with no AI:

- by our copy, and by a learned name our copy alone can't tell; the same words taught for two
  companies give both as choices;
- by HubSpot's own search when our copy has nothing (a fake HubSpot): the company is then in our
  copy, and HubSpot isn't asked again; several give choices;
- nothing anywhere gives `can_add`; HubSpot not answering, or not connected, doesn't;
- no AI, ever: it works with the AI sort off and no Claude key, and with them on, the command
  step's Claude, the real client and the search log are never touched;
- words over 120 characters or empty give 422, and so do words with nothing to search for, or
  with an email address or a phone number, before anything is searched;
- a Viewer, someone without the Call logs or the Meetings tick, and nobody signed in are refused;
- nothing writes to HubSpot.

Made-up companies only (Sample Logistics Pty Ltd, Northwind Sample Pty Ltd, North Wind).
"""

from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from apps.companies.assistant import Assistant
from apps.companies.tables import LearnedName
from core.api.deps import settings_dependency
from core.claude.client import ClaudeHolder
from core.hubspot.client import HubSpotUnavailable
from core.hubspot.matching import forget_loaded_copy
from core.hubspot.models import HubSpotCompany, HubSpotWrite
from core.searches.models import SearchLog
from tests.companies.helpers import API, add, company
from tests.companies.test_assistant_api import NOT_REAL_KEY, CommandClaude, a_copy, rep
from tests.companies.test_call_notes_api import notes_settings
from tests.core.auth_world import World, all_rows
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration
FIND = f"{API}/assistant/companies/find"
WRITES = ("create", "update", "add_to")
NORTHWIND = "Northwind Sample Pty Ltd"


@pytest.fixture(autouse=True)
def fresh_copy() -> Iterator[None]:
    forget_loaded_copy()  # each test has its own HubSpot copy
    yield
    forget_loaded_copy()


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the route sees: call notes on, the AI sort off and no Claude key, so the
    command step would answer 409. A test changes them with `settings.update(...)`."""
    chosen: dict[str, Any] = {}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


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


async def find(client: httpx.AsyncClient, words: str, *, status: int = 200) -> dict[str, Any]:
    response = await client.get(FIND, params={"words": words})
    assert response.status_code == status, response.text
    found: dict[str, Any] = response.json()
    return found


def keys(found: dict[str, Any]) -> list[str]:
    return [hit["key"] for hit in found["company"]["choices"]]


def writes(fake: FakeHubSpot) -> list[str]:
    return [call for call in fake.calls if call.startswith(WRITES)]


def taught(heard: str, company_key: str, name: str) -> LearnedName:
    return LearnedName(
        heard=heard, heard_key=heard.casefold(), company_key=company_key, company_name=name
    )


# --- Our copy and the learned names ---------------------------------------------------------


async def test_it_finds_by_our_copy_and_asks_hubspot_nothing(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    await add(world, company("301", NORTHWIND, city="Perth"))
    async with rep(world) as client:
        close = await find(client, "Sample Logistic")
        exact = await find(client, "Northwind Sample")
        several = await find(client, "Sample")
    assert close == {
        "company": {
            "heard": "Sample Logistic",
            "from_page": False,
            "found": {
                "key": "201",
                "name": "Sample Logistics Pty Ltd",
                "city": "Perth",
                "industry": "Logistics",
                "source": "hubspot",
            },
            "choices": [],
            "from_hubspot": False,
            "can_add": False,
            "level": "sure",
            "reason": None,  # one match, with no signal
        },
        "line": None,
    }
    assert exact["company"]["found"]["key"] == "301" and exact["line"] is None
    assert several["company"]["found"] is None
    # A word search, then the ranking: at most 3 of the 4 (PLAN-V25 choice 4).
    assert len(keys(several)) == 3 and set(keys(several)) <= {"201", "202", "203", "301"}
    assert several["line"] == "Which Sample?"
    assert hubspot.calls == []  # our copy had them all


async def test_a_learned_name_finds_what_our_copy_alone_cant(
    world: World, settings: dict[str, Any]
) -> None:
    await a_copy(world)
    await add(world, company("301", NORTHWIND, city="Perth"))
    async with rep(world) as client:
        before = await find(client, "North Wind")
        await add(world, taught("North Wind", "301", NORTHWIND))
        after = await find(client, "north  wind")  # case and spaces aside, the same words
        await add(world, taught("North Wind", "201", "Sample Logistics Pty Ltd"))
        both = await find(client, "North Wind")
    # "North Wind" isn't close to "Northwind Sample", and no HubSpot is connected here.
    assert before["company"]["found"] is None and before["company"]["choices"] == []
    assert before["company"]["can_add"] is False
    assert before["line"] == "We couldn't find 'North Wind' in HubSpot. Pick the company."
    assert after["company"]["found"]["key"] == "301"
    assert after["company"]["heard"] == "north wind" and after["line"] is None
    assert sorted(keys(both)) == ["201", "301"] and both["company"]["found"] is None
    assert both["line"] == "Which North Wind?"


# --- HubSpot's own search ------------------------------------------------------------------


async def test_it_finds_by_hubspots_own_search_when_our_copy_has_nothing(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    async with rep(world) as client:
        found = await find(client, "Sample Fresh")
        asked = list(hubspot.calls)
        again = await find(client, "Sample Fresh")
        several = await find(client, "Sample Harbour")
    assert found["company"]["found"] == {
        "key": "950",
        "name": "Sample Fresh Pty Ltd",
        "city": "Adelaide",
        "industry": None,
        "source": "hubspot",
    }
    assert found["company"]["from_hubspot"] is True and found["company"]["can_add"] is False
    assert found["line"] == "Sample Fresh Pty Ltd is new in HubSpot. We'll use it."
    assert asked == ["search_companies", "properties_companies"]  # one search, then pick lists
    assert again["company"]["found"]["key"] == "950" and not again["company"]["from_hubspot"]
    assert again["line"] is None
    assert keys(several) == ["951", "952"] and several["company"]["from_hubspot"] is True
    assert several["line"] == "Which Sample Harbour?"
    copied = {row.hubspot_id for row in await all_rows(world, HubSpotCompany)}
    assert {"950", "951", "952"} <= copied
    assert hubspot.calls.count("search_companies") == 2  # Sample Fresh was in our copy again
    assert writes(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


async def test_nothing_anywhere_gives_can_add_but_hubspot_not_answering_doesnt(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    async with rep(world) as client:
        nowhere = await find(client, "Zebra Holdings")
        hubspot.fail["search_companies"] = [HubSpotUnavailable("HubSpot is down", "Try later.")]
        down = await find(client, "Zebra Holdings")
    assert nowhere == {
        "company": {
            "heard": "Zebra Holdings",
            "from_page": False,
            "found": None,
            "choices": [],
            "from_hubspot": False,
            "can_add": True,
            "level": None,
            "reason": None,
        },
        "line": "Zebra Holdings isn't in HubSpot. Add it, or pick another company.",
    }
    assert down["company"]["can_add"] is False
    assert down["line"] == "We couldn't find 'Zebra Holdings' in HubSpot. Pick the company."
    assert writes(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


# --- No AI -----------------------------------------------------------------------------------


async def test_no_ai_is_ever_called(
    world: World,
    settings: dict[str, Any],
    hubspot: FakeHubSpot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other tests run with the AI sort off and no Claude key, where the command step answers
    409. Here they are on, and every road to Claude is watched while each kind of find runs."""
    settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
    claude = CommandClaude()
    world.app.state.assistant = Assistant(claude=lambda: claude)  # the command step's Claude
    made: list[str] = []

    def no_real_claude(holder: ClaudeHolder) -> Any:
        made.append("the real client")
        raise AssertionError("the find asked for Claude")

    monkeypatch.setattr(ClaudeHolder, "get", no_real_claude)
    await a_copy(world)
    await add(world, taught("North Wind", "201", "Sample Logistics Pty Ltd"))
    async with rep(world) as client:
        answers = [
            await find(client, words)
            for words in ("Sample Logistic", "North Wind", "Sample Fresh", "Zebra Holdings")
        ]
    assert [answer["company"]["found"] is not None for answer in answers] == [
        True,
        True,
        True,
        False,
    ]
    assert claude.asked == [] and made == []
    assert await all_rows(world, SearchLog) == []  # every Claude request leaves a row here


# --- The words' limits -----------------------------------------------------------------------


async def test_words_over_120_characters_or_empty_give_422_before_any_search(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    async with rep(world) as client:
        empty = await find(client, "", status=422)
        missing = await client.get(FIND)
        too_long = await find(client, "N" * 121, status=422)
        spaces = await find(client, "   ", status=422)
        marks = await find(client, "...", status=422)
        phone = await find(client, "North Wind 0412 345 678", status=422)
        email = await find(client, "jo.sample@sample.example", status=422)
        searched_before = list(hubspot.calls)
        just_right = await find(client, "N" * 120)
    for refused in (empty, too_long):
        assert [error["field"] for error in refused["errors"]] == ["query.words"]
    assert missing.status_code == 422
    assert [error["field"] for error in missing.json()["errors"]] == ["query.words"]
    for refused in (spaces, marks):
        assert (refused["code"], refused["title"], refused["detail"]) == (
            "words_empty",
            "No company to find",
            "We didn't hear a company's name. Say it again, or type it.",
        )
    for refused in (phone, email):
        assert (refused["code"], refused["detail"]) == (
            "contact_details",
            "Phone numbers and emails can't be searched for. Take them out of the company's "
            "name, then try again.",
        )
    assert searched_before == []  # nothing refused reached HubSpot
    assert just_right["company"]["heard"] == "N" * 120 and just_right["company"]["can_add"]


# --- Who may ---------------------------------------------------------------------------------


async def test_a_viewer_or_someone_without_the_ticks_is_refused(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    async with rep(world, "vic", role="viewer") as viewer:
        as_viewer = await find(viewer, "Sample Fresh", status=403)
    async with rep(world, "cora", features=["companies.companies"]) as companies_only:
        no_tick = await find(companies_only, "Sample Fresh", status=403)
    async with world.browser() as nobody:
        signed_out = await find(nobody, "Sample Fresh", status=401)
    assert as_viewer["code"] == "viewer_read_only"
    assert no_tick["code"] == "feature_not_allowed"
    assert signed_out["code"] == "auth_required"
    assert hubspot.calls == []  # nothing refused was searched
    # The command step's own access: the Call logs tick or the Meetings tick, either one.
    async with rep(world, "cal", features=["companies.call_logs"]) as call_logs_only:
        by_call_logs = await find(call_logs_only, "Sample Logistic")
    async with rep(world, "meg", features=["companies.meetings"]) as meetings_only:
        by_meetings = await find(meetings_only, "Sample Logistic")
    assert by_call_logs["company"]["found"]["key"] == "201"
    assert by_meetings["company"]["found"]["key"] == "201"
