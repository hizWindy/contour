"""A call saved before its company was found (PLAN-V24 T3-1, choices 17, 18 and 21):

- a call with no company is saved `needs_company`, with the name as heard, and isn't sorted:
  Claude gets nothing, even with the AI on; a double press is one call; the name as heard keeps no
  phone number; with neither the company nor its name it is refused, and so is a person or a prep
  it can't be checked against;
- picking its company (the PATCH) starts the sort as a new call's does: the same card from the
  same words, the rep's outcome and person kept; with the AI off it waits in To confirm at once,
  with the person the note names;
- a company the person can't see gives 422; a company on a call that has one gives 409, once
  picked too;
- before its company, the call takes only its outcome: anything else is refused, and nothing
  changes;
- it has its own list and count, History shows it, and a search finds it by the name as heard;
  the rep can remove it;
- picking teaches the mic the words heard, once, but not the company's own name or words that
  held a phone number;
- a Viewer, someone without the Call logs tick, and nobody signed in can do none of it.

The send leaving it out is in test_call_notes_batch.py, and the migration in
test_call_notes_company_table.py. Made-up companies and people only (Sample Logistics Pty Ltd,
Jo Sample, North Wind).
"""

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from apps.companies.notes import NoteSorter
from apps.companies.tables import CallNote, LearnedName, Prep
from core.api.deps import settings_dependency
from core.config import Settings
from tests.companies.helpers import add, signed_in_as
from tests.companies.test_assistant_api import rep
from tests.companies.test_call_notes_api import (
    ANOTHER,
    NOT_REAL_KEY,
    NOTES,
    a_company,
    log_call,
    note_body,
    notes_settings,
    set_note,
)
from tests.companies.test_notes import FakeClaude
from tests.core.auth_world import START, World, all_rows

pytestmark = pytest.mark.integration


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: call notes on, the AI off, sign-in on. A test changes them."""
    chosen: dict[str, Any] = {}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def claude() -> FakeClaude:
    return FakeClaude()


@pytest.fixture
def sorter(world: World, claude: FakeClaude) -> NoteSorter:
    async def ai_on(_: Any) -> Settings:
        return notes_settings(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)

    made = NoteSorter(
        sessions=world.factory,
        claude=lambda: claude,
        settings=ai_on,
        clock=lambda: world.clock.now,
    )
    world.app.state.note_sorter = made
    return made


def waiting_body(heard: str = "North Wind", **changes: Any) -> dict[str, Any]:
    """A call whose company wasn't found: no company key, only the name as heard."""
    body = note_body(company_heard=heard, **changes)
    del body["company_key"]
    return body


async def log_waiting(
    client: httpx.AsyncClient, heard: str = "North Wind", *, key: str | None = None, **more: Any
) -> dict[str, Any]:
    headers = {"Idempotency-Key": key} if key else {}
    response = await client.post(NOTES, json=waiting_body(heard, **more), headers=headers)
    assert response.status_code == 201, response.text
    found: dict[str, Any] = response.json()
    return found


async def the_row(world: World, note_id: str) -> CallNote:
    async with world.factory() as db:
        row = await db.get(CallNote, uuid.UUID(note_id))
    assert row is not None
    return row


async def pairs(world: World) -> list[tuple[str, str]]:
    rows: list[LearnedName] = await all_rows(world, LearnedName)
    return sorted((row.heard, row.company_key) for row in rows)


# --- Saving --------------------------------------------------------------------------------------


async def test_a_call_with_no_company_is_saved_with_the_name_as_heard_and_isnt_sorted(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        saved = await log_waiting(client, "  North   Wind ", key="press-1")
        again = await client.post(
            NOTES, json=waiting_body("North Wind"), headers={"Idempotency-Key": "press-1"}
        )
        number = await log_waiting(client, "North Wind 0412 345 678", outcome=None)
        read = (await client.get(f"{NOTES}/{saved['id']}")).json()
    assert saved["status"] == "needs_company"
    assert (saved["company_key"], saved["company_name"]) == (None, None)
    assert saved["company_heard"] == "North Wind"
    assert (saved["person"], saved["steps"], saved["changes"], saved["tasks"]) == (None, [], [], [])
    assert saved["call"] == {"summary": "", "outcome": "Connected", "in_hubspot": False}
    assert read == saved
    assert (again.status_code, again.json()["id"]) == (200, saved["id"])  # a double press
    assert number["company_heard"] == "North Wind [number left out]"
    # Not sorted: Claude got nothing, and no sort runs.
    assert claude.asked == [] and not sorter.running(uuid.UUID(saved["id"]))
    row = await the_row(world, saved["id"])
    assert (row.company_key, row.company_name, row.company_heard) == (None, None, "North Wind")
    assert "[number left out]" in row.text and "0412" not in row.text


async def test_a_call_with_neither_its_company_nor_its_name_or_one_that_cant_be_checked_is_refused(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    await add(world, Prep(company_key="201", company_name="Sample Logistics Pty Ltd"))
    async with world.factory() as db:
        prep_id = await db.scalar(select(Prep.id))
    async with signed_in_as(world, "mia", ["companies"]) as client:
        no_key = note_body()
        del no_key["company_key"]
        cases = {
            "company_needed": no_key,
            "company_needed, as spaces": waiting_body("   "),
            "person_not_at_company": waiting_body(contact_id="c201"),
            "prep_not_found": waiting_body(prep_id=str(prep_id)),
        }
        answers = {name: await client.post(NOTES, json=body) for name, body in cases.items()}
        too_long = await client.post(NOTES, json=waiting_body("N" * 121))
    for name, response in answers.items():
        assert response.status_code == 422, (name, response.text)
        assert response.json()["code"] == name.split(",")[0]
    assert answers["company_needed"].json()["detail"] == (
        "A call needs its company, or the company's name as you said it. Say or type the name, "
        "or pick the company."
    )
    assert too_long.status_code == 422
    assert [error["field"] for error in too_long.json()["errors"]] == ["body.company_heard"]
    assert await all_rows(world, CallNote) == []


# --- Picking the company -------------------------------------------------------------------------


async def test_picking_the_company_sorts_the_call_as_a_new_call_is_sorted(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        known = await log_call(client, outcome=None)  # the same words, with the company at once
        waiting = await log_waiting(client, "Sample Logistic", outcome=None)
        await sorter.wait()
        assert len(claude.asked) == 1  # the known call's sort only
        path = f"{NOTES}/{waiting['id']}"
        picked = await client.patch(
            path, json={"company_key": "201", "contact_id": "c202", "outcome": "Left voicemail"}
        )
        assert picked.status_code == 200, picked.text
        assert picked.json()["status"] == "sorting"
        await sorter.wait()
        after = (await client.get(path)).json()
        made = (await client.get(f"{NOTES}/{known['id']}")).json()
    assert len(claude.asked) == 2
    assert claude.asked[0]["prompt"] == claude.asked[1]["prompt"]  # the same request as a new call
    # Claude gets no phone number or email, and neither the company's name nor the name as heard.
    sent = claude.asked[1]["prompt"]
    assert "0412" not in sent and "@" not in sent and "Sample Logistic" not in sent
    assert (after["status"], after["sorted_by"]) == ("to_confirm", "ai")
    assert (after["company_key"], after["company_name"]) == ("201", "Sample Logistics Pty Ltd")
    assert after["company_heard"] == "Sample Logistic"  # kept once the company is picked
    assert after["call"]["outcome"] == "Left voicemail"  # the rep's own pick wins
    assert after["person"] == {"id": "c202", "name": "Sam Sample", "title": None}
    assert after["changes"] == made["changes"] and after["tasks"] == made["tasks"]
    assert after["call"]["summary"] == made["call"]["summary"]


async def test_with_the_ai_off_a_picked_call_waits_in_to_confirm_at_once(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        waiting = await log_waiting(client)
        picked = await client.patch(f"{NOTES}/{waiting['id']}", json={"company_key": "201"})
    assert picked.status_code == 200, picked.text
    body = picked.json()
    assert (body["status"], body["sorted_by"]) == ("to_confirm", "person")
    assert body["person"] == {"id": "c201", "name": "Jo Sample", "title": "Manager"}  # named
    assert body["call"] == {"summary": "", "outcome": "Connected", "in_hubspot": False}
    assert claude.asked == [] and not sorter.running(uuid.UUID(waiting["id"]))
    row = await the_row(world, waiting["id"])
    assert row.sorted_at == START


async def test_a_company_the_person_cant_see_gives_422_and_a_second_pick_409(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        waiting = await log_waiting(client)
        known = await log_call(client)
        path = f"{NOTES}/{waiting['id']}"
        unknown = await client.patch(path, json={"company_key": "999"})
        lead = await client.patch(path, json={"company_key": f"lead:{ANOTHER}"})  # no tick
        not_there = await client.patch(path, json={"company_key": "201", "contact_id": "c301"})
        still = (await client.get(path)).json()
        on_a_sorted_call = await client.patch(f"{NOTES}/{known['id']}", json={"company_key": "202"})
        first = await client.patch(path, json={"company_key": "201"})
        second = await client.patch(path, json={"company_key": "202"})
        await set_note(world, waiting["id"], status="logged")
        logged = await client.patch(path, json={"company_key": "201"})
    for response in (unknown, lead):
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "company_not_found"
        assert response.json()["detail"] == (
            "It may have been removed, or it isn't open to your account. Pick another company, "
            "or search for it again."
        )
    assert (not_there.status_code, not_there.json()["code"]) == (422, "person_not_at_company")
    assert (still["status"], still["company_key"]) == ("needs_company", None)
    assert first.status_code == 200, first.text
    for response in (on_a_sorted_call, second, logged):
        assert (response.status_code, response.json()["code"]) == (409, "company_set")
    assert second.json()["detail"] == (
        "This call has its company already, so it can't be picked again. Reload Call logs to see "
        "it."
    )
    assert (await the_row(world, waiting["id"])).company_key == "201"
    assert (await the_row(world, known["id"])).company_key == "201"


async def test_before_its_company_a_call_takes_only_its_outcome(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    today = START.date()
    async with signed_in_as(world, "mia", ["companies"]) as client:
        waiting = await log_waiting(client)
        path = f"{NOTES}/{waiting['id']}"
        outcome = await client.patch(path, json={"outcome": "No answer"})
        refusals = [
            {"summary": "Jo will send the floor plan."},
            {"left_out": True},
            {"contact_id": "c201"},
            {"changes": [{"field": "staff", "office": "Perth", "value": "120"}]},
            {"tasks": [{"subject": "Call back", "due": str(today + timedelta(days=1))}]},
            {"company_key": "201", "summary": "Jo will send the floor plan."},
            {"company_key": "201", "left_out": True},
        ]
        refused = [await client.patch(path, json=body) for body in refusals]
    assert outcome.status_code == 200, outcome.text
    assert outcome.json()["call"]["outcome"] == "No answer"
    assert outcome.json()["status"] == "needs_company"
    for body, response in zip(refusals, refused, strict=True):
        assert (response.status_code, response.json()["code"]) == (409, "company_first"), body
    assert refused[0].json()["detail"] == (
        "This call needs its company before anything else on it can change. Pick the company on "
        "its own, then make the other changes."
    )
    row = await the_row(world, waiting["id"])
    assert (row.status, row.company_key, row.left_out, row.contact_id) == (
        "needs_company",
        None,
        False,
        None,
    )
    assert row.card["call"]["outcome"] == "No answer" and row.card.get("edited") is not True


# --- Lists, counts and removing ------------------------------------------------------------------


async def test_calls_that_need_a_company_have_their_own_list_and_count(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "sam", ["companies"]) as client:
        await log_waiting(client, "Sample Other")  # not Mia's
    async with signed_in_as(world, "mia", ["companies"]) as client:
        older = await log_waiting(
            client, "North Wind", called_at=(START - timedelta(hours=2)).isoformat()
        )
        newer = await log_waiting(
            client, "Sample Logistic", called_at=(START - timedelta(hours=1)).isoformat()
        )
        known = await log_call(client)
        waiting = (await client.get(NOTES, params={"state": "needs_company"})).json()
        to_confirm = (await client.get(NOTES, params={"state": "to_confirm"})).json()
        history = (await client.get(NOTES, params={"state": "history"})).json()
        found = (await client.get(NOTES, params={"state": "history", "q": "north"})).json()
        counts = (await client.get(f"{NOTES}/summary")).json()
        removed = await client.delete(f"{NOTES}/{older['id']}")
        gone = await client.get(f"{NOTES}/{older['id']}")
    assert waiting["total"] == 2
    assert [item["id"] for item in waiting["items"]] == [newer["id"], older["id"]]  # newest first
    assert [item["id"] for item in to_confirm["items"]] == [known["id"]]
    assert {item["id"] for item in history["items"]} == {older["id"], newer["id"], known["id"]}
    assert [item["id"] for item in found["items"]] == [older["id"]]  # by the name as heard
    assert counts == {"to_confirm": 1, "needs_look": 0, "logged_today": 0, "needs_company": 2}
    assert removed.status_code == 204 and gone.status_code == 404


# --- Teaching the mic ----------------------------------------------------------------------------


async def test_picking_teaches_the_mic_the_words_heard_once(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        for heard in (
            "Sample Logistic",  # taught
            "Sample Logistic",  # the same words again: one pair
            "sample  logistics pty ltd",  # the company's own name: nothing to teach
            "Sample 0412 345 678",  # held a phone number: never taught
        ):
            waiting = await log_waiting(client, heard)
            picked = await client.patch(f"{NOTES}/{waiting['id']}", json={"company_key": "201"})
            assert picked.status_code == 200, picked.text
    assert await pairs(world) == [("Sample Logistic", "201")]
    [pair] = await all_rows(world, LearnedName)
    assert pair.company_name == "Sample Logistics Pty Ltd" and pair.made_by is not None


# --- Who may -------------------------------------------------------------------------------------


async def test_a_viewer_or_someone_without_the_call_logs_tick_can_do_none_of_it(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        waiting = await log_waiting(client)
    path = f"{NOTES}/{waiting['id']}"
    tries = [
        ("POST", NOTES, waiting_body()),
        ("PATCH", path, {"company_key": "201"}),
        ("POST", f"{NOTES}/preview", {"ids": [waiting["id"]]}),
        ("POST", f"{NOTES}/confirm", {"ids": [waiting["id"]]}),
        ("DELETE", path, None),
    ]
    async with rep(world, "vic", role="viewer") as viewer:
        as_viewer = [await viewer.request(method, url, json=body) for method, url, body in tries]
    async with rep(world, "cora", features=["companies.companies"]) as no_tick:
        no_call_logs = [
            await no_tick.request(method, url, json=body) for method, url, body in tries
        ]
    async with world.browser() as nobody:
        signed_out = [await nobody.request(method, url, json=body) for method, url, body in tries]
    for response in as_viewer:
        assert (response.status_code, response.json()["code"]) == (403, "viewer_read_only")
    for response in no_call_logs:
        assert (response.status_code, response.json()["code"]) == (403, "feature_not_allowed")
    for response in signed_out:
        assert (response.status_code, response.json()["code"]) == (401, "auth_required")
    [row] = await all_rows(world, CallNote)
    assert (row.status, row.company_key) == ("needs_company", None)
    assert await pairs(world) == []
