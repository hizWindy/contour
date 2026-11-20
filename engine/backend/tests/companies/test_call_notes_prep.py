"""Call prep knows about the rep's call notes (PLAN-V17 T2-7):

- the facts pack's `my_last_note` is my newest note on the company that isn't in HubSpot yet:
  not a logged one, and never another rep's. It shows the card's summary, or the note's first
  200 characters. None while call notes are off. With sign-in off: the notes nobody signed in
  made;
- a call logged in HubSpot is the last talk on the very next facts read, with no cache between;
- the summary counts my own notes, and "logged today" is the Melbourne day.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from core.api.deps import settings_dependency
from core.hubspot.models import HubSpotCall
from tests.companies.helpers import API, add, signed_in_as
from tests.companies.test_call_notes_api import NOTES, a_company, log_call, notes_settings, set_note
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
FACTS = f"{API}/201/facts"
CALL_URL = "https://app.hubspot.com/made-up/call"


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: call notes on, the AI off. A test changes them."""
    chosen: dict[str, Any] = {}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


def before(minutes: int) -> str:
    """A call this many minutes before the test's now."""
    return (START - timedelta(minutes=minutes)).isoformat()


async def facts(client: httpx.AsyncClient, path: str = FACTS) -> dict[str, Any]:
    response = await client.get(path)
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


# --- My last note -------------------------------------------------------------------------------


async def test_call_prep_shows_my_newest_note_not_yet_in_hubspot(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    long_text = "Jo Sample said the Perth team is growing fast and needs more room. " * 4
    async with signed_in_as(world, "sam", ["companies"]) as client:
        sams = await log_call(client, called_at=before(5), text="Sam's own call.")
        sam_sees = (await facts(client))["my_last_note"]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        await log_call(client, called_at=before(180), text="An older call.")
        newest = await log_call(client, called_at=before(60), text=long_text, outcome=None)
        logged = await log_call(client, called_at=before(30), text="In HubSpot already.")
        await set_note(world, logged["id"], status="logged")
        first = (await facts(client))["my_last_note"]
        summary = {"summary": "Jo is looking at Melbourne.\nShe will ring back.", "outcome": "Busy"}
        await set_note(world, newest["id"], status="failed", card={"call": summary})
        sorted_one = (await facts(client))["my_last_note"]
        elsewhere = (await facts(client, f"{API}/202/facts"))["my_last_note"]
        settings.update(call_notes_enabled=False)
        switched_off = (await facts(client))["my_last_note"]
    # Never another rep's: Sam sees his own, Mia never sees Sam's, though his is newer.
    assert sam_sees["id"] == sams["id"]
    assert first == {
        "id": newest["id"],
        "summary": newest["text"][:200].rstrip(),  # no summary yet: the note's start
        "called_at": newest["called_at"],
        "outcome": None,
        "status": "to_confirm",
    }
    assert len(newest["text"]) > 200
    assert sorted_one == {
        "id": newest["id"],
        "summary": "Jo is looking at Melbourne.\nShe will ring back.",
        "called_at": newest["called_at"],
        "outcome": "Busy",
        "status": "failed",  # not in HubSpot yet, so it still shows
    }
    assert elsewhere is None
    assert switched_off is None


async def test_with_sign_in_off_call_prep_shows_the_notes_nobody_signed_in_made(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        await log_call(client, called_at=before(10), text="Mia's call, signed in.")
    world.settings(auth_required=False)  # sign-in off, as on the laptop
    settings.update(auth_required=False)
    async with world.browser() as client:
        nobodys = await log_call(client, called_at=before(120), text="A call with sign-in off.")
        shown = (await facts(client))["my_last_note"]
    assert nobodys["made_by"] is None
    assert shown["id"] == nobodys["id"]  # not Mia's, though hers is newer


# --- The last talk --------------------------------------------------------------------------------


async def test_a_logged_call_is_the_last_talk_on_the_next_facts_read(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        cold = await facts(client)
        # Core's writer adds a logged call to our copy at once (Track 1's T1-5). Made up here.
        await add(
            world,
            HubSpotCall(
                hubspot_id="900001",
                hubspot_company_id="201",
                hubspot_contact_id="c201",
                called_at=START - timedelta(minutes=10),
                outcome="Connected",
                title="Call with Jo Sample",
                note="Jo is looking at Melbourne.",
                owner="Lee Sample",
                owner_id="o1",
                hubspot_url=CALL_URL,
            ),
        )
        talked = await facts(client)
    assert cold["last_call"] is None
    assert cold["facts"][-1]["text"].startswith("Relationship stage: cold.")
    assert (talked["last_call"]["id"], talked["last_call"]["person"]) == ("900001", "Jo Sample")
    assert talked["facts"][-1]["text"] == (
        "Relationship stage: contacted before. Contacted before: a call with Jo Sample on "
        "4 Nov 2026."
    )
    assert talked["facts"][-1]["source"]["label"] == "HubSpot call, 4 Nov 2026"
    assert any(fact["text"].startswith("Call on 4 Nov 2026") for fact in talked["facts"])


# --- The summary ----------------------------------------------------------------------------------


async def test_the_summary_counts_my_own_notes_by_the_melbourne_day(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    # START is 9:00 on 4 Nov in UTC: 8 pm in Melbourne (summer time, UTC+11). Melbourne's
    # 4 Nov began at 1 pm on 3 Nov, UTC.
    midnight = datetime(2026, 11, 3, 13, 0, tzinfo=UTC)
    async with signed_in_as(world, "sam", ["companies"]) as client:
        sams = await log_call(client)
        await set_note(world, sams["id"], status="logged", finished_at=START)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        notes = [await log_call(client) for _ in range(6)]
        # 12:30 am on 4 Nov in Melbourne, still 3 Nov in UTC: today.
        await set_note(
            world, notes[0]["id"], status="logged", finished_at=midnight + timedelta(minutes=30)
        )
        # 11:30 pm on 3 Nov in Melbourne: yesterday.
        await set_note(
            world, notes[1]["id"], status="logged", finished_at=midnight - timedelta(minutes=30)
        )
        await set_note(world, notes[2]["id"], status="sending")
        await set_note(world, notes[3]["id"], status="partial")
        await set_note(world, notes[4]["id"], status="uncertain")
        counts = (await client.get(f"{NOTES}/summary")).json()
    # Mine only: Sam's note logged today isn't counted. Being sent isn't waiting for me.
    assert counts == {"to_confirm": 1, "needs_look": 2, "logged_today": 1, "needs_company": 0}
