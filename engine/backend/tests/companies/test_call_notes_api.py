"""The call notes routes (PLAN-V17 T2-5, the contract's part 2):

- options, and every other route answers 409 while call notes are off;
- saving a note: with the AI off it waits for the rep at once and Claude gets no request; with it
  on it is sorted in the background;
- a double press is one note (the same Idempotency-Key twice, and two at once);
- no phone number or email address is ever stored, but a typed date is kept;
- a note that is too long, a person of another company, a prep that isn't there, a call in the
  future: refused in plain words;
- another person's note: not theirs to read, change or remove. An Admin reads it, and can't
  change it;
- the list pages and filters, the summary counts my own notes;
- the rep's edits are checked as the sorter checks them;
- removing a note, even one being sorted;
- a note with just an outcome is saved, and Claude gets nothing;
- preview, confirm, retry and resolve wait for HubSpot write access, and say so; with
  writing on, the batch gives a note back while the writer itself still waits (until
  T1-5). The batch itself is in test_call_notes_batch.py.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import asyncio
import re
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from apps.companies.notes import SORT_STOPPED, NoteSorter
from apps.companies.tables import CallNote, Prep
from core.api.deps import settings_dependency
from core.config import Settings
from core.hubspot.activities import OUTCOME_NAMES
from core.hubspot.models import HubSpotContact, HubSpotOffice, HubSpotOwner, HubSpotWrite
from tests.companies.helpers import API, add, company, office, signed_in_as
from tests.companies.test_notes import FakeClaude
from tests.companies.test_script_notes import as_admin
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
NOTES = f"{API}/call-notes"
NOT_REAL_KEY = "not-a-real-key"  # Claude is "set up", and the fake answers
EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
LONG_NUMBER = re.compile(r"\d[\d\s().-]{6,}\d")
TEXT = (
    "Spoke to Jo Sample. The Perth lease ends 31-03-2028. Ring her on 0412 345 678 or email "
    "jo.sample@sample.example."
)
ANOTHER = "11111111-2222-3333-4444-555555555555"


def notes_settings(**changes: Any) -> Settings:
    values: dict[str, Any] = {
        "call_notes_enabled": True,
        "call_notes_ai_enabled": False,
        "anthropic_api_key": None,
        "auth_required": True,
    }
    values.update(changes)
    return Settings(_env_file=None, **values)


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see. A test changes them with `settings.update(...)`."""
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


async def a_company(world: World) -> None:
    """Sample Logistics Pty Ltd (201): offices in Perth and Canberra (HubSpot's Other Office 2),
    Jo Sample and Sam Sample. Sample Freight Pty Ltd (202): Ana Other. One owner, and a prep."""
    await add(
        world,
        company("201", "Sample Logistics Pty Ltd"),
        company("202", "Sample Freight Pty Ltd"),
    )
    await add(
        world,
        office("201", "Perth", city="Perth", lease_expiry=START.date() + timedelta(days=500)),
        office("201", "Other Office 2", city="Canberra"),
        HubSpotContact(
            hubspot_id="c201", hubspot_company_id="201", name="Jo Sample", job_title="Manager"
        ),
        HubSpotContact(hubspot_id="c202", hubspot_company_id="201", name="Sam Sample"),
        HubSpotContact(hubspot_id="c301", hubspot_company_id="202", name="Ana Other"),
        HubSpotOwner(owner_id="o1", name="Lee Sample"),
    )


def note_body(**changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "company_key": "201",
        "text": TEXT,
        "source": "typed",
        "called_at": (START - timedelta(minutes=10)).isoformat(),
        "outcome": "Connected",
    }
    body.update(changes)
    return body


async def log_call(
    client: httpx.AsyncClient, key: str | None = None, **changes: Any
) -> dict[str, Any]:
    headers = {"Idempotency-Key": key} if key else {}
    response = await client.post(NOTES, json=note_body(**changes), headers=headers)
    assert response.status_code == 201, response.text
    found: dict[str, Any] = response.json()
    return found


async def set_note(world: World, note_id: str, **values: Any) -> None:
    async with world.factory() as db:
        note = await db.get(CallNote, uuid.UUID(note_id))
        assert note is not None
        for name, value in values.items():
            setattr(note, name, value)
        await db.commit()


async def stored(world: World) -> list[CallNote]:
    async with world.factory() as db:
        return list(await db.scalars(select(CallNote).order_by(CallNote.created_at)))


# --- Options and the off switch -------------------------------------------------------------


async def test_options_say_what_log_call_offers(world: World, settings: dict[str, Any]) -> None:
    async with signed_in_as(world, "mia", ["companies"]) as client:
        settings.update(call_notes_enabled=False)
        off = await client.get(f"{NOTES}/options")
        assert off.status_code == 200 and off.json()["enabled"] is False
        settings.update(call_notes_enabled=True)
        options = (await client.get(f"{NOTES}/options")).json()
        settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
        ai_on = (await client.get(f"{NOTES}/options")).json()
    assert options["enabled"] is True and options["ai_enabled"] is False
    assert ai_on["ai_enabled"] is True
    assert options["sending_ready"] is False
    assert options["waiting_for"] == "Waiting for HubSpot to be connected."
    assert options["outcomes"] == list(OUTCOME_NAMES)
    assert options["fields"] == [
        {"id": "lease_end", "label": "Lease end", "kind": "date"},
        {"id": "last_move", "label": "Last move", "kind": "date"},
        {"id": "staff", "label": "Staff", "kind": "number"},
    ]
    limits = (options["soft_seconds"], options["max_chars"], options["transcript_max_chars"])
    assert limits == (180, 6000, 58_000)  # a transcript must fit whole in one HubSpot note


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", f"{NOTES}/summary", None),
        ("POST", f"{NOTES}/preview", {"ids": [ANOTHER]}),
        ("POST", f"{NOTES}/confirm", {"ids": [ANOTHER]}),
        ("GET", NOTES, None),
        ("POST", NOTES, "a note"),
        ("GET", f"{NOTES}/{ANOTHER}", None),
        ("PATCH", f"{NOTES}/{ANOTHER}", {"left_out": True}),
        ("DELETE", f"{NOTES}/{ANOTHER}", None),
        ("POST", f"{NOTES}/{ANOTHER}/retry", None),
        ("POST", f"{NOTES}/{ANOTHER}/resolve", {"step": "call", "landed": True}),
    ],
)
async def test_every_route_but_options_answers_409_while_call_notes_are_off(
    world: World, settings: dict[str, Any], method: str, path: str, body: Any
) -> None:
    settings.update(call_notes_enabled=False)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        response = await client.request(
            method, path, json=note_body() if body == "a note" else body
        )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "call_notes_off"
    assert response.json()["detail"] == (
        "Call notes are switched off. An admin can switch them on in Settings."
    )


# --- Saving a note ---------------------------------------------------------------------------


async def test_with_the_ai_off_a_note_waits_for_the_rep_and_claude_gets_nothing(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
    assert (note["status"], note["sorted_by"]) == ("to_confirm", "person")
    assert note["call"] == {"summary": "", "outcome": "Connected", "in_hubspot": False}
    assert (note["changes"], note["tasks"], note["steps"]) == ([], [], [])
    assert note["person"] == {"id": "c201", "name": "Jo Sample", "title": "Manager"}  # named
    assert note["made_by"] == "Mia" and note["company_name"] == "Sample Logistics Pty Ltd"
    assert claude.asked == [] and not sorter.running(uuid.UUID(note["id"]))
    # No phone number or email address is stored, and the typed date is kept.
    [row] = await stored(world)
    assert "31-03-2028" in row.text
    assert "[number left out]" in row.text and "[email left out]" in row.text
    assert not EMAIL.search(row.text) and not LONG_NUMBER.search(row.text.replace("31-03-2028", ""))


async def test_with_the_ai_on_a_note_is_sorted_in_the_background(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        saved = await log_call(client, contact_id="c202", outcome=None)
        assert saved["status"] == "sorting"
        assert saved["person"] == {"id": "c202", "name": "Sam Sample", "title": None}
        await sorter.wait()
        sorted_note = (await client.get(f"{NOTES}/{saved['id']}")).json()
    assert len(claude.asked) == 1
    assert (sorted_note["status"], sorted_note["sorted_by"]) == ("to_confirm", "ai")
    assert sorted_note["call"]["outcome"] == "Connected"  # the fake's, as the rep picked none
    assert [(c["office"], c["value"]) for c in sorted_note["changes"]] == [
        ("Perth", "2028-03-31"),
        ("Canberra", "120"),
    ]
    assert sorted_note["person"]["id"] == "c202"  # the rep's own pick stays


async def test_a_note_with_just_an_outcome_is_saved_and_claude_gets_nothing(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client, text="", outcome="No answer")
        empty = await client.post(NOTES, json=note_body(text="", outcome=None))
    # No words: nothing for Claude to sort, so it waits for the rep at once, free.
    assert (note["status"], note["sorted_by"]) == ("to_confirm", "person")
    assert note["call"] == {"summary": "", "outcome": "No answer", "in_hubspot": False}
    assert claude.asked == [] and not sorter.running(uuid.UUID(note["id"]))
    assert (empty.status_code, empty.json()["code"]) == (422, "note_empty")
    assert empty.json()["detail"] == "Write or say something, or pick how the call went."


async def test_a_double_press_is_one_note(world: World, settings: dict[str, Any]) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first = await client.post(NOTES, json=note_body(), headers={"Idempotency-Key": "press-1"})
        again = await client.post(NOTES, json=note_body(), headers={"Idempotency-Key": "press-1"})
        both = await asyncio.gather(
            client.post(NOTES, json=note_body(), headers={"Idempotency-Key": "press-2"}),
            client.post(NOTES, json=note_body(), headers={"Idempotency-Key": "press-2"}),
        )
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]
    assert sorted(response.status_code for response in both) == [200, 201]
    assert both[0].json()["id"] == both[1].json()["id"]
    async with signed_in_as(world, "sam", ["companies"]) as client:
        # A key belongs to one person: Sam's own press with the same key is a note of his own.
        own = await client.post(NOTES, json=note_body(), headers={"Idempotency-Key": "press-1"})
    assert own.status_code == 201 and own.json()["id"] != first.json()["id"]
    assert len(await stored(world)) == 3


async def test_a_note_that_doesnt_fit_is_refused_in_plain_words(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    await add(world, Prep(company_key="202", company_name="Sample Freight Pty Ltd"))
    async with world.factory() as db:
        other_prep = await db.scalar(select(Prep.id))
    settings.update(notes_max_chars=500)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        cases = {
            "note_too_long": note_body(text="x" * 501),
            "note_empty": note_body(text="   ", outcome=None),
            "person_not_at_company": note_body(contact_id="c301"),
            "prep_not_found": note_body(prep_id=str(other_prep)),
            "called_later": note_body(called_at=(START + timedelta(days=1)).isoformat()),
        }
        answers = {code: await client.post(NOTES, json=body) for code, body in cases.items()}
        unknown = await client.post(NOTES, json=note_body(company_key="999"))
        lead = await client.post(NOTES, json=note_body(company_key=f"lead:{ANOTHER}"))
    for code, response in answers.items():
        assert response.status_code == 422, (code, response.text)
        assert response.json()["code"] == code
    assert answers["note_too_long"].json()["detail"] == (
        "This note is longer than 500 characters. Shorten it, or split it into two notes."
    )
    # A company not in our copy, or a lead without the Lead Finder tick, isn't open to her.
    assert unknown.status_code == lead.status_code == 404
    assert await stored(world) == []


# --- Whose note -------------------------------------------------------------------------------


async def test_another_persons_note_is_not_theirs(world: World, settings: dict[str, Any]) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
    path = f"{NOTES}/{note['id']}"
    async with signed_in_as(world, "sam", ["companies"]) as client:
        read = await client.get(path)
        changed = await client.patch(path, json={"left_out": True})
        removed = await client.delete(path)
        retried = await client.post(f"{path}/retry")
        listed = (await client.get(NOTES, params={"mine": "false"})).json()
    for response in (read, changed, removed, retried):
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "note_not_found"
    assert listed["total"] == 0  # anyone but an Admin gets their own notes only
    async with as_admin(world, "lena") as admin:
        seen = await admin.get(path)
        everyone = (await admin.get(NOTES, params={"mine": "false"})).json()
        own = (await admin.get(NOTES)).json()
        not_hers = await admin.patch(path, json={"left_out": True})
        not_removed = await admin.delete(path)
    assert seen.status_code == 200 and seen.json()["made_by"] == "Mia"
    assert (everyone["total"], own["total"]) == (1, 0)
    assert not_hers.status_code == not_removed.status_code == 403
    assert not_hers.json()["code"] == "not_your_note"
    [row] = await stored(world)
    assert row.left_out is False


# --- Lists and counts -------------------------------------------------------------------------


async def test_the_list_pages_filters_and_puts_unsure_notes_first(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        oldest = await log_call(client, called_at=(START - timedelta(hours=3)).isoformat())
        middle = await log_call(client, called_at=(START - timedelta(hours=2)).isoformat())
        newest = await log_call(
            client, company_key="202", called_at=(START - timedelta(hours=1)).isoformat()
        )
        await set_note(world, newest["id"], card={"call": {}, "unsure": "Two dates were said."})
        await set_note(world, middle["id"], status="logged")
        to_confirm = (await client.get(NOTES, params={"state": "to_confirm"})).json()
        first_page = (await client.get(NOTES, params={"limit": 2})).json()
        second_page = (await client.get(NOTES, params={"limit": 2, "offset": 2})).json()
        logged = (await client.get(NOTES, params={"state": "logged"})).json()
        freight = (await client.get(NOTES, params={"company_key": "202"})).json()
        needs_look = (await client.get(NOTES, params={"state": "needs_look"})).json()
    ids = [item["id"] for item in to_confirm["items"]]
    assert ids == [newest["id"], oldest["id"]]  # the unsure one first, then the oldest call
    assert to_confirm["items"][0]["unsure"] == "Two dates were said."
    assert (first_page["total"], len(first_page["items"]), len(second_page["items"])) == (3, 2, 1)
    assert [item["id"] for item in logged["items"]] == [middle["id"]]
    assert [item["id"] for item in freight["items"]] == [newest["id"]]
    assert needs_look == {"total": 0, "items": []}


async def test_the_summary_counts_my_own_notes(world: World, settings: dict[str, Any]) -> None:
    await a_company(world)
    async with signed_in_as(world, "sam", ["companies"]) as client:
        await log_call(client)  # not Mia's
    async with signed_in_as(world, "mia", ["companies"]) as client:
        notes = [await log_call(client) for _ in range(5)]
        await set_note(world, notes[2]["id"], status="failed")
        await set_note(world, notes[3]["id"], status="logged", finished_at=START)
        await set_note(
            world, notes[4]["id"], status="logged", finished_at=START - timedelta(days=1)
        )
        counts = (await client.get(f"{NOTES}/summary")).json()
    assert counts == {"to_confirm": 2, "needs_look": 1, "logged_today": 1, "needs_company": 0}


# --- The rep's edits ----------------------------------------------------------------------------


async def test_the_reps_edits_are_checked_as_the_sorter_checks_them(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    today = START.date()  # 4 Nov 2026 in Melbourne too
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        path = f"{NOTES}/{note['id']}"
        edit = {
            "summary": "Jo will send the floor plan.\nCall 0412 345 678 after 2pm.",
            "outcome": None,
            "contact_id": "c202",
            "changes": [{"field": "lease_end", "office": "Perth", "value": "2028-03-31"}],
            "tasks": [
                {
                    "subject": "Send the floor plan to jo@sample.example",
                    "due": str(today + timedelta(days=3)),
                    "kind": "email",
                    "owner_id": "o1",
                }
            ],
            "left_out": True,
        }
        edited = await client.patch(path, json=edit)
        assert edited.status_code == 200, edited.text
        kept = await client.patch(
            path,
            json={
                "changes": [
                    {"id": "c1", "field": "lease_end", "office": "perth", "value": "2028-03-31"},
                    {"field": "staff", "office": "Canberra", "value": "120"},
                ]
            },
        )
        refusals = {
            "change_not_possible": {
                "changes": [{"field": "lease_end", "office": "Hobart", "value": "2028-03-31"}]
            },
            "change_twice": {
                "changes": [
                    {"field": "staff", "office": "Perth", "value": "120"},
                    {"field": "staff", "office": "perth", "value": "130"},
                ]
            },
            "task_in_past": {
                "tasks": [{"subject": "Call back", "due": str(today - timedelta(days=1))}]
            },
            "owner_not_found": {
                "tasks": [{"subject": "Call back", "due": str(today), "owner_id": "o9"}]
            },
            "person_not_at_company": {"contact_id": "c301"},
        }
        refused = {code: await client.patch(path, json=body) for code, body in refusals.items()}
        after = (await client.get(path)).json()
    body = edited.json()
    assert body["call"] == {
        "summary": "Jo will send the floor plan.\nCall [number left out] after 2pm.",
        "outcome": None,
        "in_hubspot": False,
    }
    assert body["person"] == {"id": "c202", "name": "Sam Sample", "title": None}
    assert body["changes"] == [
        {
            "id": "c1",
            "field": "lease_end",
            "label": "Lease end",
            "office": "Perth",
            "current": str(START.date() + timedelta(days=500)),
            "value": "2028-03-31",
            "current_changed": False,
            "in_hubspot": False,
        }
    ]
    assert body["tasks"] == [
        {
            "id": "t1",
            "subject": "Send the floor plan to [email left out]",
            "due": str(today + timedelta(days=3)),
            "due_words": "",
            "kind": "email",
            "owner": "Lee Sample",
            "owner_id": "o1",
            "in_hubspot": False,
        }
    ]
    assert body["left_out"] is True
    assert [change["id"] for change in kept.json()["changes"]] == ["c1", "c2"]
    for code, response in refused.items():
        assert response.status_code == 422, (code, response.text)
        assert response.json()["code"] == code
    assert refused["change_not_possible"].json()["detail"] == (
        "Hobart lease end: this company has no Hobart office in HubSpot. Change it, or take it out."
    )
    assert len(after["changes"]) == 2  # a refused edit changes nothing
    [row] = await stored(world)
    assert row.card["edited"] is True and row.sorted is None
    assert not EMAIL.search(str(row.card)) and "0412" not in str(row.card)


async def test_a_note_being_sorted_or_already_sent_cant_be_changed(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        path = f"{NOTES}/{note['id']}"
        await set_note(world, note["id"], status="sorting")
        sorting = await client.patch(path, json={"left_out": True})
        await set_note(world, note["id"], status="logged")
        sent = await client.patch(path, json={"left_out": True})
        not_removed = await client.delete(path)
    assert (sorting.status_code, sorting.json()["code"]) == (409, "note_sorting")
    assert (sent.status_code, sent.json()["code"]) == (409, "note_sent")
    assert (not_removed.status_code, not_removed.json()["code"]) == (409, "note_sent")


async def test_leaving_a_note_out_is_no_edit_of_what_was_sorted(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        left = await client.patch(f"{NOTES}/{note['id']}", json={"left_out": True})
    assert left.status_code == 200 and left.json()["left_out"] is True
    [row] = await stored(world)
    assert row.card["edited"] is False


# --- Removing ----------------------------------------------------------------------------------


async def test_undo_removes_a_note_and_stops_its_sort(
    world: World, settings: dict[str, Any], claude: FakeClaude, sorter: NoteSorter
) -> None:
    await a_company(world)
    claude.gate = asyncio.Event()
    async with signed_in_as(world, "mia", ["companies"]) as client:
        plain = await log_call(client)
        removed = await client.delete(f"{NOTES}/{plain['id']}")
        gone = await client.get(f"{NOTES}/{plain['id']}")
        settings.update(call_notes_ai_enabled=True, anthropic_api_key=NOT_REAL_KEY)
        sorting = await log_call(client)
        await asyncio.wait_for(claude.waiting.wait(), timeout=10)  # its sort waits on Claude
        stopped = await client.delete(f"{NOTES}/{sorting['id']}")
    assert removed.status_code == stopped.status_code == 204
    assert gone.status_code == 404
    assert not sorter.running(uuid.UUID(sorting["id"]))
    assert await stored(world) == []


async def test_a_failed_note_with_nothing_in_hubspot_can_be_removed(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    failed_call = {"outcome": "Connected", "state": "failed", "step": "call", "detail": "Busy."}
    landed_call = {"outcome": "Connected", "state": "landed", "step": "call"}
    unsure_call = {"outcome": "Connected", "state": "uncertain", "step": "call"}
    failed_task = {
        "id": "t1",
        "subject": "Send the floor plan",
        "due": "2026-11-24",
        "due_words": "",
        "kind": "email",
        "state": "failed",
        "step": "task:1",
    }
    cases = {
        "failed": ("failed", {"call": failed_call}),
        "partial": ("partial", {"call": landed_call, "tasks": [failed_task]}),
        "uncertain": ("uncertain", {"call": unsure_call}),
        "sending": ("sending", {"call": {"outcome": "Connected"}}),
        "failed, yet its call landed": ("failed", {"call": landed_call}),  # never kept: checked
    }
    async with signed_in_as(world, "mia", ["companies"]) as client:
        answers: dict[str, httpx.Response] = {}
        for name, (status, card) in cases.items():
            note = await log_call(client)
            await set_note(world, note["id"], status=status, card=card)
            answers[name] = await client.delete(f"{NOTES}/{note['id']}")
    assert answers["failed"].status_code == 204
    for name in ("partial", "uncertain", "sending", "failed, yet its call landed"):
        assert (answers[name].status_code, answers[name].json()["code"]) == (409, "note_sent")
    assert answers["partial"].json()["detail"] == (
        "Part of this note is in HubSpot already, so it can't be removed here. Change it in "
        "HubSpot instead."
    )
    assert answers["uncertain"].json()["detail"] == (
        "Check HubSpot first, then tell us whether it's there."
    )
    assert answers["sending"].json()["detail"] == (
        "This note is being sent to HubSpot. Wait for it to finish."
    )
    assert len(await stored(world)) == 4  # only the failed one with nothing in HubSpot went


async def test_a_note_left_sorting_by_a_restart_goes_to_the_rep(
    world: World, settings: dict[str, Any], sorter: NoteSorter
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        await set_note(
            world, note["id"], status="sorting", created_at=START - timedelta(minutes=10)
        )
        found = (await client.get(f"{NOTES}/{note['id']}")).json()
    assert (found["status"], found["sorted_by"], found["unsure"]) == (
        "to_confirm",
        "person",
        SORT_STOPPED,
    )


# --- Sending waits for HubSpot write access -------------------------------------------------------


async def test_preview_shows_what_our_copy_has_now_and_that_sending_waits(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        change = {"field": "lease_end", "office": "Perth", "value": "2028-03-31"}
        await client.patch(f"{NOTES}/{note['id']}", json={"changes": [change]})
        # The sync brings a new lease end for Perth after the rep saw the old one.
        async with world.factory() as db:
            perth = await db.scalar(select(HubSpotOffice).where(HubSpotOffice.label == "Perth"))
            assert perth is not None
            perth.lease_expiry = START.date() + timedelta(days=600)
            await db.commit()
        preview = await client.post(f"{NOTES}/preview", json={"ids": [note["id"], ANOTHER]})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    [checked] = body["items"]
    assert checked["changes"][0]["current"] == str(START.date() + timedelta(days=600))
    assert checked["changes"][0]["current_changed"] is True
    assert body["skipped"] == [{"id": ANOTHER, "why": "We can't find this note."}]
    assert body["sending_ready"] is False
    assert body["waiting_for"] == "Waiting for HubSpot to be connected."
    assert body["totals"] == {"calls": 1, "meeting_notes": 0, "tasks": 0, "changes": 1}


async def test_confirm_retry_and_resolve_wait_for_write_access(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    await add(world, HubSpotWrite(app="companies", subject="call_note:x", plan={}))
    async with world.factory() as db:
        write_id = await db.scalar(select(HubSpotWrite.id))
    unsure_call = {
        "call": {"summary": "", "outcome": "Connected", "state": "uncertain", "step": "call"},
        "writes": [{"id": str(write_id), "subject": "call_note:x", "call": True}],
    }
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        path = f"{NOTES}/{note['id']}"
        no_key = await client.post(f"{NOTES}/confirm", json={"ids": [note["id"]]})
        nothing_to_retry = await client.post(f"{path}/retry")
        nothing_to_resolve = await client.post(
            f"{path}/resolve", json={"step": "call", "landed": True}
        )
        await set_note(world, note["id"], status="failed")
        retry_waits = await client.post(f"{path}/retry")
        await set_note(world, note["id"], status="uncertain", write_id=write_id, card=unsure_call)
        check_first = await client.post(f"{path}/retry")
        not_unsure = await client.post(f"{path}/resolve", json={"step": "fields", "landed": True})
        resolve_waits = await client.post(f"{path}/resolve", json={"step": "call", "landed": False})
        await set_note(world, note["id"], status="to_confirm", write_id=None, card={})
        # With a key and writing on, the batch starts, and core's writer still waits (until T1-5):
        # the note goes back to the rep, nothing sent.
        world.app.state.hubspot_provider = lambda: None
        settings.update(hubspot_write_enabled=True)
        started = await client.post(f"{NOTES}/confirm", json={"ids": [note["id"]]})
        await world.app.state.note_sender.wait()
        after = (await client.get(path)).json()
    assert (no_key.status_code, no_key.json()["code"]) == (409, "hubspot_writes_off")
    assert no_key.json()["detail"] == "Waiting for HubSpot to be connected."
    assert nothing_to_retry.json()["code"] == "nothing_to_retry"
    assert nothing_to_resolve.json()["code"] == "nothing_to_resolve"
    assert retry_waits.json()["code"] == "hubspot_writes_off"
    assert check_first.json()["code"] == "note_uncertain"
    assert (not_unsure.status_code, not_unsure.json()["code"]) == (409, "step_not_unsure")
    assert (resolve_waits.status_code, resolve_waits.json()["code"]) == (409, "hubspot_writes_off")
    assert resolve_waits.json()["title"] == "Waiting for write access"
    assert started.status_code == 202, started.text
    assert (started.json()["sending"], started.json()["already_sending"]) == (1, False)
    assert (after["status"], after["steps"]) == ("to_confirm", [])  # nothing was sent


async def test_resolve_says_in_words_when_core_cant_settle_the_step(
    world: World, settings: dict[str, Any]
) -> None:
    """PLAN-V17 merge: with writing on, core's writer settles the step itself. A write it can't
    settle (here a bare row that isn't a call note's) answers in plain words, never a 500."""
    await a_company(world)
    await add(world, HubSpotWrite(app="companies", subject="call_note:x", plan={}))
    async with world.factory() as db:
        write_id = await db.scalar(select(HubSpotWrite.id))
    unsure_call = {
        "call": {"summary": "", "outcome": "Connected", "state": "uncertain", "step": "call"},
        "writes": [{"id": str(write_id), "subject": "call_note:x", "call": True}],
    }
    world.app.state.hubspot_provider = lambda: None
    settings.update(hubspot_write_enabled=True)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        await set_note(world, note["id"], status="uncertain", write_id=write_id, card=unsure_call)
        answer = await client.post(
            f"{NOTES}/{note['id']}/resolve", json={"step": "call", "landed": True}
        )
    assert (answer.status_code, answer.json()["code"]) == (409, "nothing_to_resolve")
