"""The pre-read's copy in HubSpot (PLAN-V17 T1-9): a note on the company and its deal, by the rep,
and, while the switch is on, the same text at the end of the meeting's internal notes. On the
fake HubSpot (and once on the real client over a mock transport) and the test database.

Every company, person, meeting and address here is made up.
"""

import asyncio
import json
import logging
from collections.abc import Callable, Iterator, Mapping
from datetime import timedelta
from typing import Any

import httpx2
import pytest
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import get_settings
from core.hubspot.activities import (
    FOUND_DETAIL,
    LOOKED_UNSURE_DETAIL,
    MEETING_BREAK,
    MEETING_DONE_DETAIL,
    MEETING_GONE_DETAIL,
    MEETING_OFF_DETAIL,
    MEETING_PLAN_DETAIL,
    MEETING_THERE_DETAIL,
    MEETING_UNREAD_DETAIL,
    NOT_A_MEETING_DETAIL,
    PATCH_UNSURE_DETAIL,
    ActivityRequest,
    NoteIn,
    apply_activity,
    planned_steps,
    preview_activity,
    resolve_step,
)
from core.hubspot.client import HttpHubSpot, HubSpotObject, HubSpotRejected, Link, ObjectType
from core.hubspot.models import HubSpotWrite
from core.hubspot.writer import StepResult, WriteOut, latest_write, note_html
from tests.core.hubspot_fake import FakeHubSpot
from tests.core.test_hubspot_activities import (
    COMPANY,
    DEAL,
    NO_ANSWER,
    OTHER_REP,
    PERSON,
    REFUSED,
    REP,
    TIMED_OUT,
    Waits,
    a_request,
    contour,
    left_writing,
    only,
    row_of,
)

Factory = async_sessionmaker[AsyncSession]
Switch = Callable[[bool], None]
db = pytest.mark.integration

MEETING_ID, OTHER_MEETING = "601", "602"
NOTES = "hs_internal_meeting_notes"
# Rich text as HubSpot keeps it, with a non-breaking space, a line break and a trailing space:
# all of it is kept, byte for byte.
BEFORE = "<p>Agenda: the <strong>level 3</strong> fitout</p>\n<div>Bring the samples&nbsp;</div> "
BODY = "<p>Looking forward to seeing you on level 3.</p>"  # the text the client sees
LOCATION = "Level 3, 1 Sample Street, Melbourne VIC 3000"
PRE_READ = "Pre-read for Sample Logistics Pty Ltd\nThey lease level 3 until June 2027."
ADDED = note_html(PRE_READ)
NOTE_DONE = StepResult(step="note", status="done", detail="Added the note.", hubspot_id="900000888")


@pytest.fixture
def switch(monkeypatch: pytest.MonkeyPatch) -> Iterator[Switch]:
    """The switch that adds the note to the meeting too (an environment setting): off unless the
    test turns it on, whatever the engine's own settings file says."""

    def turn(on: bool) -> None:
        monkeypatch.setenv("MEETING_NOTE_ON_MEETING", "true" if on else "false")
        get_settings.cache_clear()

    turn(False)
    yield turn
    monkeypatch.delenv("MEETING_NOTE_ON_MEETING", raising=False)
    get_settings.cache_clear()  # no later test sees the switch


def with_meeting(
    fake: FakeHubSpot, *, notes: str | None = BEFORE, meeting_id: str = MEETING_ID
) -> dict[str, str | None]:
    """A meeting with Sample Logistics, in HubSpot. Gives its fields as they were."""
    record = fake.add_meeting(
        meeting_id,
        companies=[COMPANY],
        contacts=[PERSON],
        hs_meeting_title="Fitout chat with Sample Logistics",
        hs_meeting_body=BODY,
        hs_meeting_location=LOCATION,
        hs_meeting_start_time="2026-11-18T23:00:00Z",
        hs_internal_meeting_notes=notes,
    )
    return dict(record.properties)


def pre_read(**parts: Any) -> ActivityRequest:
    """What Track 2 sends when a pre-read goes out: a note on the company and its one open deal,
    by the rep who sent it, about the meeting."""
    base: dict[str, Any] = {
        "subject": "meeting_form:7:1",
        "contact_id": None,
        "note": NoteIn(body=PRE_READ),
        "meeting_id": MEETING_ID,
    }
    return only(**(base | parts))


async def sent(session: AsyncSession, fake: FakeHubSpot, request: ActivityRequest) -> WriteOut:
    """Previewed, then written, as Track 2's send does."""
    out = await preview_activity(session, fake, request)
    return await apply_activity(session, fake, out.id, pause=Waits())


def meeting_calls(fake: FakeHubSpot) -> list[str]:
    return [name for name in fake.calls if name.endswith("_meetings")]


def notes_of(fake: FakeHubSpot, meeting_id: str = MEETING_ID) -> str | None:
    return fake.meetings[meeting_id].properties[NOTES]


# --- The rules, in pure code (fast) ----------------------------------------------------------


def test_only_a_note_goes_on_a_meeting() -> None:
    # A meeting with no note is the caller's mistake: refused, never dropped quietly.
    with pytest.raises(ValidationError, match="needs a note"):
        a_request(note=None, meeting_id=MEETING_ID)
    assert planned_steps(pre_read()) == ["note"]  # the switch was off at the preview
    assert planned_steps(pre_read(), on_meeting=True) == ["note", "meeting"]
    # A call note names no meeting, so it never plans the step (Track 2's batch).
    assert "meeting" not in planned_steps(a_request(), on_meeting=True)


# --- The note: the rep's, on the company and the deal ----------------------------------------


@db
async def test_the_note_is_the_reps_on_the_company_and_the_deal(session: AsyncSession) -> None:
    fake = contour()
    done = await sent(session, fake, pre_read(meeting_id=None))

    assert done.status == "done"
    (note,) = fake.notes.values()
    assert (note.companies, note.contacts, note.deals) == ((COMPANY,), (), (DEAL,))
    assert (note.properties["hubspot_owner_id"], note.properties["hs_note_body"]) == (REP, ADDED)

    # A note with no owner stays as it was: HubSpot shows it as unassigned, and nothing warns.
    request = pre_read(meeting_id=None, owner_id=None, subject="meeting_form:7:2")
    out = await preview_activity(session, fake, request)
    assert out.plan.warnings == []
    await apply_activity(session, fake, out.id, pause=Waits())
    (unowned,) = [record for record in fake.notes.values() if record.id != note.id]
    assert "hubspot_owner_id" not in unowned.properties


@db
async def test_a_note_that_timed_out_is_looked_for_by_its_owner(session: AsyncSession) -> None:
    fake = contour()
    out = await preview_activity(session, fake, pre_read(meeting_id=None))
    at = "1763251200000"  # the note's time, fixed in the plan so another note can share it
    plan = (await row_of(session, out.id)).plan
    await session.execute(
        update(HubSpotWrite).where(HubSpotWrite.id == out.id).values(plan={**plan, "note_at": at})
    )
    await session.commit()
    # Another rep's note on the same company at the same moment.
    await fake.create_object(
        "notes",
        {"hs_timestamp": at, "hs_note_body": "<p>Their note</p>", "hubspot_owner_id": OTHER_REP},
        links=[Link("companies", COMPANY)],
    )
    fake.fail["create_notes"] = [TIMED_OUT]  # ours never reached HubSpot

    unsure = await apply_activity(session, fake, out.id, pause=Waits())

    assert (unsure.status, unsure.steps[0].hubspot_id) == ("uncertain", None)
    assert unsure.steps[0].detail == LOOKED_UNSURE_DETAIL

    # Ours lands this time, then times out: found by its owner, and the other rep's isn't ours.
    await resolve_step(session, out.id, "note", landed=False)
    fake.fail_after["create_notes"] = [TIMED_OUT]

    found = await apply_activity(session, fake, out.id, pause=Waits())

    (ours,) = [n for n in fake.notes.values() if n.properties.get("hubspot_owner_id") == REP]
    assert (found.status, found.steps[0].hubspot_id) == ("done", ours.id)
    assert found.steps[0].detail == FOUND_DETAIL


# --- The meeting -------------------------------------------------------------------------------


@db
async def test_the_switch_off_leaves_the_meeting_untouched(
    session: AsyncSession, switch: Switch
) -> None:
    fake = contour()
    kept = with_meeting(fake)
    out = await preview_activity(session, fake, pre_read())
    assert (out.plan.meeting_id, out.plan.meeting) == (MEETING_ID, None)

    done = await apply_activity(session, fake, out.id, pause=Waits())

    assert done.status == "done"
    assert [(step.step, step.status) for step in done.steps] == [("note", "done")]
    assert meeting_calls(fake) == []
    assert fake.meetings[MEETING_ID].properties == kept


@db
async def test_the_switch_on_adds_the_note_at_the_end_and_keeps_what_is_there(
    session: AsyncSession, switch: Switch
) -> None:
    switch(True)
    fake = contour()
    kept = with_meeting(fake)
    out = await preview_activity(session, fake, pre_read())
    assert (out.plan.meeting_id, out.plan.meeting) == (MEETING_ID, MEETING_PLAN_DETAIL)
    assert meeting_calls(fake) == []  # the preview reads only the company

    done = await apply_activity(session, fake, out.id, pause=Waits())

    assert done.status == "done"
    assert [(step.step, step.status) for step in done.steps] == [
        ("note", "done"),
        ("meeting", "done"),
    ]
    assert done.steps[1].detail == MEETING_DONE_DETAIL
    after = fake.meetings[MEETING_ID].properties
    # What was there, byte for byte, then an empty line, then the note.
    assert after[NOTES] == BEFORE + MEETING_BREAK + ADDED
    assert {name: value for name, value in after.items() if name != NOTES} == {
        name: value for name, value in kept.items() if name != NOTES
    }  # the body the client sees, the location and the rest are as they were
    assert meeting_calls(fake) == ["get_meetings", "update_meetings"]
    assert len(fake.notes) == 1  # and the note on the company

    # A meeting with no internal notes yet gets the note alone.
    with_meeting(fake, notes=None, meeting_id=OTHER_MEETING)
    request = pre_read(meeting_id=OTHER_MEETING, subject="meeting_form:8:1")
    assert (await sent(session, fake, request)).status == "done"
    assert notes_of(fake, OTHER_MEETING) == ADDED


@db
async def test_notes_that_already_hold_the_note_are_left_as_they_are(
    session: AsyncSession, switch: Switch
) -> None:
    switch(True)
    fake = contour()
    # Someone pasted it already, laid out another way: other tags, spaces and line breaks.
    pasted = (
        BEFORE + "<div>Pre-read for  Sample Logistics Pty Ltd<br>They lease level 3 until "
        "June&nbsp;2027.</div>"
    )
    with_meeting(fake, notes=pasted)

    done = await sent(session, fake, pre_read())

    assert (done.status, done.steps[1].status) == ("done", "done")
    assert done.steps[1].detail == MEETING_THERE_DETAIL
    assert meeting_calls(fake) == ["get_meetings"]
    assert notes_of(fake) == pasted


@db
async def test_applying_again_never_adds_it_twice(session: AsyncSession, switch: Switch) -> None:
    switch(True)
    fake = contour()
    with_meeting(fake)
    fake.fail["update_meetings"] = [REFUSED]
    out = await preview_activity(session, fake, pre_read())

    first = await apply_activity(session, fake, out.id, pause=Waits())

    assert first.status == "partial"  # the note still counts
    assert {step.step: step.status for step in first.steps} == {"note": "done", "meeting": "failed"}
    assert notes_of(fake) == BEFORE

    again = await apply_activity(session, fake, out.id, pause=Waits())

    assert again.status == "done"
    assert notes_of(fake) == BEFORE + MEETING_BREAK + ADDED
    assert len(fake.notes) == 1  # the note isn't sent again
    finished = await apply_activity(session, fake, out.id, pause=Waits())
    assert finished.status == "done" and fake.calls.count("update_meetings") == 2


@db
async def test_a_write_taken_over_never_adds_it_twice(
    session: AsyncSession, switch: Switch
) -> None:
    switch(True)
    fake = contour()
    with_meeting(fake)
    out = await preview_activity(session, fake, pre_read())
    # The backend stopped while the meeting's change was on its way, after it landed.
    fake.meetings[MEETING_ID].properties[NOTES] = BEFORE + MEETING_BREAK + ADDED
    six = timedelta(minutes=6)
    await left_writing(session, out.id, ago=six, steps=[NOTE_DONE], sending="meeting")

    taken = await apply_activity(session, fake, out.id, pause=Waits())

    # Not "uncertain", and nothing to look for: the meeting is read, and it has the note.
    assert taken.status == "done"
    assert (taken.steps[1].status, taken.steps[1].detail) == ("done", MEETING_THERE_DETAIL)
    assert "update_meetings" not in fake.calls and "create_notes" not in fake.calls
    assert not [name for name in fake.calls if name.startswith("search_")]
    assert notes_of(fake) == BEFORE + MEETING_BREAK + ADDED

    # It hadn't landed: the write taken over adds it, once.
    fake.meetings[MEETING_ID].properties[NOTES] = BEFORE
    out = await preview_activity(session, fake, pre_read(subject="meeting_form:7:2"))
    await left_writing(session, out.id, ago=six, steps=[NOTE_DONE], sending="meeting")

    taken = await apply_activity(session, fake, out.id, pause=Waits())

    assert (taken.status, taken.steps[1].detail) == ("done", MEETING_DONE_DETAIL)
    assert notes_of(fake) == BEFORE + MEETING_BREAK + ADDED
    assert fake.calls.count("update_meetings") == 1


@db
async def test_a_change_cut_off_on_its_way_is_settled_and_never_added_twice(
    session_factory: Factory, switch: Switch, monkeypatch: pytest.MonkeyPatch
) -> None:
    switch(True)
    fake = contour()
    with_meeting(fake)
    async with session_factory() as session:
        out = await preview_activity(session, fake, pre_read())
    landed, never = asyncio.Event(), asyncio.Event()
    change = fake.update_object

    async def lands_then_stops(
        kind: ObjectType, record_id: str, properties: Mapping[str, str]
    ) -> HubSpotObject:
        made = await change(kind, record_id, properties)
        landed.set()
        await never.wait()  # the backend stops before HubSpot's answer comes back
        return made

    monkeypatch.setattr(fake, "update_object", lands_then_stops)
    async with session_factory() as session:
        sending = asyncio.create_task(apply_activity(session, fake, out.id, pause=Waits()))
        await landed.wait()
        sending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await sending
    monkeypatch.setattr(fake, "update_object", change)

    async with session_factory() as session:
        row = await row_of(session, out.id)
        states = {step["step"]: step["status"] for step in row.result["steps"]}
        assert (row.status, states) == ("uncertain", {"note": "done", "meeting": "uncertain"})
        again = await apply_activity(session, fake, out.id, pause=Waits())

    assert (again.status, again.steps[1].detail) == ("done", MEETING_THERE_DETAIL)
    assert notes_of(fake) == BEFORE + MEETING_BREAK + ADDED
    assert fake.calls.count("update_meetings") == 1


@db
async def test_a_change_that_timed_out_and_landed_is_found(
    session: AsyncSession, switch: Switch
) -> None:
    switch(True)
    fake = contour()
    with_meeting(fake)
    fake.fail_after["update_meetings"] = [TIMED_OUT]  # saved, then no answer

    done = await sent(session, fake, pre_read())

    assert (done.status, done.steps[1].status, done.steps[1].detail) == (
        "done",
        "done",
        FOUND_DETAIL,
    )
    assert meeting_calls(fake) == ["get_meetings", "update_meetings", "get_meetings"]
    assert notes_of(fake) == BEFORE + MEETING_BREAK + ADDED


@db
async def test_a_change_that_timed_out_and_did_not_land_fails_and_can_be_sent_again(
    session: AsyncSession, switch: Switch, monkeypatch: pytest.MonkeyPatch
) -> None:
    switch(True)
    fake = contour()
    with_meeting(fake)
    fake.fail["update_meetings"] = [TIMED_OUT]  # no answer, and not saved
    out = await preview_activity(session, fake, pre_read())

    failed = await apply_activity(session, fake, out.id, pause=Waits())

    assert (failed.status, failed.steps[1].status) == ("partial", "failed")
    assert failed.steps[1].detail == PATCH_UNSURE_DETAIL
    assert notes_of(fake) == BEFORE
    again = await apply_activity(session, fake, out.id, pause=Waits())
    assert again.status == "done"
    assert notes_of(fake) == BEFORE + MEETING_BREAK + ADDED

    # HubSpot doesn't answer the read after it either: failed, and safe to send again.
    with_meeting(fake, meeting_id=OTHER_MEETING)
    change = fake.update_object

    async def no_answer(
        kind: ObjectType, record_id: str, properties: Mapping[str, str]
    ) -> HubSpotObject:
        fake.fail["get_meetings"] = [NO_ANSWER]  # the read after it fails too
        raise TIMED_OUT

    monkeypatch.setattr(fake, "update_object", no_answer)
    request = pre_read(meeting_id=OTHER_MEETING, subject="meeting_form:8:1")
    out = await preview_activity(session, fake, request)

    unread = await apply_activity(session, fake, out.id, pause=Waits())

    assert (unread.steps[1].status, unread.steps[1].detail) == ("failed", MEETING_UNREAD_DETAIL)
    monkeypatch.setattr(fake, "update_object", change)
    assert (await apply_activity(session, fake, out.id, pause=Waits())).status == "done"
    assert notes_of(fake, OTHER_MEETING) == BEFORE + MEETING_BREAK + ADDED


@db
async def test_the_switch_turned_off_after_the_preview_sends_nothing_to_the_meeting(
    session: AsyncSession, switch: Switch
) -> None:
    switch(True)
    fake = contour()
    kept = with_meeting(fake)
    out = await preview_activity(session, fake, pre_read())
    assert out.plan.meeting == MEETING_PLAN_DETAIL
    switch(False)

    done = await apply_activity(session, fake, out.id, pause=Waits())

    assert done.status == "done"  # nothing left to send
    assert [(step.step, step.status, step.detail) for step in done.steps] == [
        ("note", "done", "Added the note."),
        ("meeting", "skipped", MEETING_OFF_DETAIL),
    ]
    assert meeting_calls(fake) == []
    assert fake.meetings[MEETING_ID].properties == kept


@db
async def test_a_meeting_not_in_hubspot_fails_in_plain_words_and_the_note_still_counts(
    session: AsyncSession, switch: Switch
) -> None:
    switch(True)
    fake = contour()  # no meeting

    done = await sent(session, fake, pre_read())

    steps = {step.step: step for step in done.steps}
    assert (done.status, steps["note"].status, len(fake.notes)) == ("partial", "done", 1)
    assert (steps["meeting"].status, steps["meeting"].detail) == ("failed", MEETING_GONE_DETAIL)
    assert meeting_calls(fake) == ["get_meetings"]

    # A meeting id that isn't HubSpot's is refused in plain words, before anything is saved.
    with pytest.raises(HubSpotRejected) as caught:
        await preview_activity(session, fake, pre_read(meeting_id="mtg-601", subject="x:1"))
    assert caught.value.detail == NOT_A_MEETING_DETAIL
    assert await latest_write(session, "companies", "x:1") is None


@db
async def test_hubspot_gets_only_the_internal_notes_and_the_notes_links(
    session: AsyncSession, switch: Switch
) -> None:
    """The real client over a mock transport: the requests HubSpot gets."""
    switch(True)
    meeting: dict[str, str | None] = {NOTES: BEFORE, "hs_meeting_body": BODY}
    meeting["hs_meeting_location"] = LOCATION
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        path = request.url.path
        if path == f"/crm/objects/2026-09/companies/{COMPANY}":
            company = {"name": "Sample Logistics Pty Ltd", "domain": "samplelogistics.com.au"}
            return httpx2.Response(200, json={"id": COMPANY, "properties": company})
        if path == "/crm/objects/2026-09/notes" and request.method == "POST":
            return httpx2.Response(201, json={"id": "5001", "properties": {}})
        if path == f"/crm/objects/2026-09/meetings/{MEETING_ID}":
            if request.method == "PATCH":
                meeting.update(json.loads(request.content)["properties"])
            asked = request.url.params.get("properties", NOTES).split(",")
            shown = {name: meeting.get(name) for name in asked}
            return httpx2.Response(200, json={"id": MEETING_ID, "properties": shown})
        return httpx2.Response(404, json={"category": "OBJECT_NOT_FOUND"})

    async def no_wait(_: float) -> None:
        return None

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as transport:
        client = HttpHubSpot(
            "made-up-key-for-tests",
            writes_allowed=True,
            client=transport,
            pause=no_wait,
            requests_per_second=1000,
            searches_per_second=1000,
        )
        out = await preview_activity(session, client, pre_read())
        done = await apply_activity(session, client, out.id, pause=Waits())
    assert done.status == "done", done.error

    writes = [request for request in seen if request.method in ("POST", "PATCH")]
    assert [(request.method, request.url.path) for request in writes] == [
        ("POST", "/crm/objects/2026-09/notes"),
        ("PATCH", f"/crm/objects/2026-09/meetings/{MEETING_ID}"),
    ]
    note, change = (json.loads(request.content) for request in writes)
    links = [
        (item["to"]["id"], item["types"][0]["associationTypeId"]) for item in note["associations"]
    ]
    assert links == [(COMPANY, 190), (DEAL, 214)]
    assert note["properties"]["hubspot_owner_id"] == REP
    # The meeting is read for its internal notes only, and only they are sent back.
    reads = [r for r in seen if r.method == "GET" and "/meetings/" in r.url.path]
    assert [request.url.params["properties"] for request in reads] == [NOTES]
    assert change == {"properties": {NOTES: BEFORE + MEETING_BREAK + ADDED}}


@db
async def test_no_note_text_reaches_a_log_line(
    session: AsyncSession, switch: Switch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, logger="core")
    switch(True)
    fake = contour()
    with_meeting(fake)
    fake.fail_after["update_meetings"] = [TIMED_OUT]
    email, phone = "jo.sample@samplelogistics.com.au", "0412 345 678"
    body = f"Their budget is about 2.4 million.\nCall {phone} or {email}"

    done = await sent(session, fake, pre_read(note=NoteIn(body=body)))

    assert done.status == "done"
    standard = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message"}
    lines = [
        f"{record.getMessage()} {[(k, v) for k, v in record.__dict__.items() if k not in standard]}"
        for record in caplog.records
        if record.name.startswith("core.")
    ]
    assert any("hubspot_activity_step" in line and "meeting" in line for line in lines)
    for line in lines:
        for secret in (email, "@", phone, "0412", "budget", "2.4 million"):
            assert secret not in line, line
