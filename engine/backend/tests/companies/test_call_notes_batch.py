"""The batch to HubSpot (PLAN-V17 T2-6), with a fake writer in place of core's (Track 1's T1-5):

- a batch of 10 goes one note after another, in the order given, and one failure fails only its
  note; a break on our side fails only its note too;
- a shutdown half way: the notes sent stay logged, the one in flight follows its write, and the
  rest go back to the rep;
- a second press while a batch runs starts nothing, and says so;
- writing off: nothing is sent, and the answer says what it waits for; switched off part way, the
  rest go back to the rep;
- the preview shows HubSpot's value now; a field that changed in HubSpot after it is held and
  shown again, the parts not in HubSpot can still be edited, and a retry sends only them;
- an unsure step, resolved both ways;
- the request for a note: the title, the body with what wasn't changed, `seen`, a date as
  YYYY-MM-DD, the owner, and the deal only when the company has one open deal; a company not in
  HubSpot yet isn't sent;
- a note a restart left "sending" settles from its write.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.app import stop_background
from apps.companies.note_batch import LEAD_ONLY, ActivityWriter, NoteSender
from apps.companies.note_fields import hubspot_property
from apps.companies.notes import CardCall, CardChange, CardTask, Dropped, NoteCard
from apps.companies.tables import CallNote
from core.api.deps import settings_dependency
from core.hubspot.activities import ActivityRequest, FieldSet, TaskIn
from core.hubspot.client import HubSpot, HubSpotWritesOff
from core.hubspot.models import HubSpotWrite
from core.hubspot.writer import FieldChange, StepResult, WriteOut, WritePlan, WriteStatus
from tests.companies.helpers import add, deal, signed_in_as
from tests.companies.test_call_notes_api import NOTES, a_company, log_call, notes_settings, set_note
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
FAKE_HUBSPOT = cast(HubSpot, SimpleNamespace(writes_allowed=True))
PERTH_LEASE = hubspot_property("lease_end", "Perth")
CANBERRA_STAFF = hubspot_property("staff", "Other Office 2")
OUR_COPY = str(START.date() + timedelta(days=500))  # Perth's lease end in our copy (a_company)
BUSY = "HubSpot was busy."
CALL_URL = "https://app.hubspot.com/made-up/call"
CHECK = "Check HubSpot, then tell us: it's there, or it's not."
TASK = {"subject": "Send the floor plan", "due": "2026-11-24", "kind": "email"}


# --- The fake writer ------------------------------------------------------------------------------


def step(name: str, status: str, detail: str | None = None) -> dict[str, Any]:
    return {"step": name, "status": status, "detail": detail, "hubspot_id": None}


def status_of(steps: list[dict[str, Any]]) -> str:
    found = {item["status"] for item in steps}
    if found <= {"done"}:
        return "done"
    if "uncertain" in found:
        return "uncertain"
    return "partial" if "done" in found else "failed"


def plan_of(company_id: str, fields: list[FieldChange]) -> dict[str, Any]:
    plan = WritePlan(
        action="update",
        company_id=company_id,
        company_name="Sample Logistics Pty Ltd",
        company_url=None,
        domain=None,
        fields=fields,
        list_name=None,
        list_id=None,
    )
    return plan.model_dump(mode="json")


def out_of(row: HubSpotWrite) -> WriteOut:
    """The writer's answer for a row. Built without checks until T1-5 widens StepResult.step to
    the activity steps (call, fields, task:1 ...)."""
    steps = [StepResult.model_construct(**item) for item in (row.result or {}).get("steps", [])]
    return WriteOut.model_construct(
        id=row.id,
        app=row.app,
        subject=row.subject,
        status=cast(WriteStatus, row.status),
        plan=WritePlan.model_validate(row.plan),
        steps=steps,
        hubspot_company_id=row.hubspot_company_id,
        hubspot_url=row.hubspot_url,
        error=row.error,
        created_at=START,
        applied_at=None,
        finished_at=None,
        can_write=True,
        waiting_for=None,
    )


@dataclass
class FakeWriter:
    """Core's activity writer, made up. It saves real write rows (a note points at its write),
    reads "HubSpot" from `hubspot_has`, and answers as a test sets: a call HubSpot refuses or
    doesn't answer, a break on our side, writing switched off, a write that waits part way."""

    hubspot_has: dict[str, str | None] = field(default_factory=dict)  # by HubSpot's field name
    refuse_call: set[uuid.UUID] = field(default_factory=set)
    unsure_call: set[uuid.UUID] = field(default_factory=set)
    breaks: set[uuid.UUID] = field(default_factory=set)
    off_after: int | None = None  # writing is switched off after this many writes
    hold: uuid.UUID | None = None  # this note's write waits part way, until `go` is set
    waiting: asyncio.Event = field(default_factory=asyncio.Event)
    go: asyncio.Event = field(default_factory=asyncio.Event)
    previews: list[ActivityRequest] = field(default_factory=list)
    requests: dict[str, ActivityRequest] = field(default_factory=dict)  # the newest, by subject
    written: list[str] = field(default_factory=list)  # subjects, in the order written
    answers: list[tuple[str, bool]] = field(default_factory=list)

    def writer(self) -> ActivityWriter:
        return ActivityWriter(
            preview=self.preview, apply=self.apply, resolve=self.resolve, owner_of=self.owner_of
        )

    def off(self) -> bool:
        return self.off_after is not None and len(self.written) >= self.off_after

    async def owner_of(self, session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
        return "o1" if user_id is not None else None

    async def preview(
        self, session: AsyncSession, hubspot: HubSpot, request: ActivityRequest
    ) -> WriteOut:
        if self.off():
            raise HubSpotWritesOff()
        self.previews.append(request)
        self.requests[request.subject] = request
        row = await session.scalar(
            select(HubSpotWrite).where(
                HubSpotWrite.subject == request.subject, HubSpotWrite.status == "previewed"
            )
        )
        if row is None:
            row = HubSpotWrite(
                id=uuid.uuid4(),
                app=request.app,
                subject=request.subject,
                status="previewed",
                hubspot_company_id=request.company_id,
                hubspot_url=None,
                error=None,
            )
            session.add(row)
        changes = [
            FieldChange(
                property=item.property,
                label=item.label,
                value=item.value,
                current=self.hubspot_has.get(item.property),
                write=True,
            )
            for item in request.fields
        ]
        row.plan = plan_of(request.company_id, changes)
        row.result = {}
        await session.commit()
        return out_of(row)

    async def apply(self, session: AsyncSession, hubspot: HubSpot, write_id: uuid.UUID) -> WriteOut:
        if self.off():
            raise HubSpotWritesOff()
        row = await session.get(HubSpotWrite, write_id)
        assert row is not None and row.status == "previewed"
        request = self.requests[row.subject]
        note_id = uuid.UUID(row.subject.split(":")[1])
        if note_id in self.breaks:
            raise RuntimeError("a made-up break")
        called: list[dict[str, Any]] = []
        if request.call is not None:
            if note_id in self.refuse_call:
                called.append(step("call", "failed", BUSY))
            elif note_id in self.unsure_call:
                called.append(step("call", "uncertain", "HubSpot didn't answer in time."))
            else:
                called.append(step("call", "done"))
        row.status, row.result = "writing", {"steps": called}  # each step is saved as it lands
        await session.commit()
        if note_id == self.hold:
            self.waiting.set()
            await self.go.wait()
        changes: list[FieldChange] = []
        for item in request.fields:  # HubSpot is read again right before writing
            now = self.hubspot_has.get(item.property)
            write = now == item.seen
            changes.append(
                FieldChange(
                    property=item.property,
                    label=item.label,
                    value=item.value,
                    current=now,
                    write=write,
                    reason=None if write else "It changed in HubSpot since you checked it.",
                )
            )
            if write:
                self.hubspot_has[item.property] = item.value
        steps = [*called, *([step("fields", "done")] if request.fields else [])]
        steps += [step(f"task:{number}", "done") for number in range(1, len(request.tasks) + 1)]
        row.plan = plan_of(request.company_id, changes)
        row.result = {"steps": steps}
        row.status = status_of(steps)
        row.hubspot_url = CALL_URL if step("call", "done") in steps else None
        await session.commit()
        self.written.append(row.subject)
        return out_of(row)

    async def resolve(
        self, session: AsyncSession, write_id: uuid.UUID, name: str, landed: bool
    ) -> WriteOut:
        self.answers.append((name, landed))
        row = await session.get(HubSpotWrite, write_id)
        assert row is not None
        steps = [dict(item) for item in (row.result or {}).get("steps", [])]
        for item in steps:
            if item["step"] == name and item["status"] == "uncertain":
                item["status"] = "done" if landed else "failed"
        row.result = {"steps": steps}
        if steps and row.status != "writing":
            row.status = status_of(steps)
        if name == "call" and landed:
            row.hubspot_url = CALL_URL
        await session.commit()
        return out_of(row)


@asynccontextmanager
async def a_hubspot() -> AsyncIterator[HubSpot | None]:
    yield FAKE_HUBSPOT


# --- Fixtures and helpers -------------------------------------------------------------------------


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: call notes on, the AI off, and writing to HubSpot on."""
    chosen: dict[str, Any] = {"hubspot_write_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def fake() -> FakeWriter:
    return FakeWriter()


@pytest.fixture
def sender(world: World, fake: FakeWriter, settings: dict[str, Any]) -> NoteSender:
    """The backend's sender, with the fake writer. HubSpot is set up."""
    world.app.state.hubspot_provider = lambda: FAKE_HUBSPOT
    made = NoteSender(
        sessions=world.factory,
        hubspot=a_hubspot,
        writer=fake.writer(),
        clock=lambda: world.clock.now,
    )
    world.app.state.note_sender = made
    return made


def ids_of(*notes: dict[str, Any]) -> list[uuid.UUID]:
    return [uuid.UUID(note["id"]) for note in notes]


async def confirm(client: httpx.AsyncClient, *notes: dict[str, Any]) -> dict[str, Any]:
    response = await client.post(f"{NOTES}/confirm", json={"ids": [note["id"] for note in notes]})
    assert response.status_code == 202, response.text
    found: dict[str, Any] = response.json()
    return found


async def one(client: httpx.AsyncClient, note: dict[str, Any]) -> dict[str, Any]:
    response = await client.get(f"{NOTES}/{note['id']}")
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


async def the_row(world: World, note: dict[str, Any]) -> CallNote:
    async with world.factory() as db:
        row = await db.get(CallNote, uuid.UUID(note["id"]))
    assert row is not None
    return row


def subject(note: dict[str, Any], number: int = 1) -> str:
    return f"call_note:{note['id']}" + (f":{number}" if number > 1 else "")


# --- A batch -------------------------------------------------------------------------------------


async def test_a_batch_of_ten_goes_in_order_and_one_failure_fails_only_its_note(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        logged = [
            await log_call(client, text=f"Call {number} with Jo Sample.") for number in range(10)
        ]
        given = list(reversed(logged))  # the order given, not the order logged
        fake.refuse_call.add(uuid.UUID(given[4]["id"]))
        started = await confirm(client, *given)
        await sender.wait()
        after = [await one(client, note) for note in given]
    assert (started["sending"], started["already_sending"], started["skipped"]) == (10, False, [])
    assert started["batch_id"] is not None
    assert [note["id"] for note in started["notes"]] == [note["id"] for note in given]
    assert {note["status"] for note in started["notes"]} == {"sending"}
    assert fake.written == [subject(note) for note in given]  # one after another, in order
    assert [note["status"] for note in after] == ["logged"] * 4 + ["failed"] + ["logged"] * 5
    assert after[4]["steps"] == [
        {
            "step": "call",
            "status": "failed",
            "words": "Call not saved: HubSpot was busy. Try again.",
        }
    ]
    assert after[4]["hubspot_url"] is None and after[4]["call"]["in_hubspot"] is False
    assert after[0]["steps"] == [{"step": "call", "status": "done", "words": "Call logged."}]
    assert (after[0]["hubspot_url"], after[0]["call"]["in_hubspot"]) == (CALL_URL, True)
    row = await the_row(world, given[0])
    assert row.finished_at == START and row.confirmed_at == START and row.write_id is not None


async def test_a_break_on_our_side_fails_only_its_note(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        broken, fine = await log_call(client), await log_call(client)
        fake.breaks.add(uuid.UUID(broken["id"]))
        await confirm(client, broken, fine)
        await sender.wait()
        after = [await one(client, note) for note in (broken, fine)]
    assert [note["status"] for note in after] == ["failed", "logged"]
    assert after[0]["steps"] == [
        {
            "step": "call",
            "status": "failed",
            "words": "Call not saved: Something went wrong on our side while sending this note. "
            "Try again.",
        }
    ]
    assert fake.written == [subject(fine)]


async def test_a_shutdown_half_way_keeps_what_was_sent_and_gives_back_the_rest(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        notes = [await log_call(client) for _ in range(5)]
        for note in notes:  # each with a follow-up
            edit = await client.patch(f"{NOTES}/{note['id']}", json={"tasks": [TASK]})
            assert edit.status_code == 200, edit.text
        fake.hold = uuid.UUID(notes[2]["id"])  # its call is saved, then the backend stops
        await confirm(client, *notes)
        await asyncio.wait_for(fake.waiting.wait(), timeout=10)
        await stop_background(world.app)
        after = [await one(client, note) for note in notes]
        # A person says the follow-up is there.
        resolved = await client.post(
            f"{NOTES}/{notes[2]['id']}/resolve", json={"step": "task:1", "landed": True}
        )
    assert [note["status"] for note in after] == [
        "logged",
        "logged",
        "uncertain",
        "to_confirm",
        "to_confirm",
    ]
    assert after[2]["steps"] == [
        {"step": "call", "status": "done", "words": "Call logged."},
        {
            "step": "task:1",
            "status": "uncertain",
            "words": "Task 'Send the floor plan': Contour stopped while sending this note. "
            + CHECK,
        },
    ]
    assert after[3]["steps"] == [] and after[3]["confirmed_at"] is None
    assert fake.written == [subject(notes[0]), subject(notes[1])]
    assert (await the_row(world, notes[3])).write_id is None
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "logged"
    assert fake.answers == [("task:1", True)]


async def test_a_second_press_while_a_batch_runs_starts_nothing(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first, second = await log_call(client), await log_call(client)
        fake.hold = uuid.UUID(first["id"])
        started = await confirm(client, first)
        await asyncio.wait_for(fake.waiting.wait(), timeout=10)
        again = await confirm(client, second)
        await set_note(world, second["id"], status="failed")
        retry = await client.post(f"{NOTES}/{second['id']}/retry")
        await set_note(world, second["id"], status="to_confirm")
        fake.go.set()
        await sender.wait()
        after = [await one(client, note) for note in (first, second)]
    assert (started["sending"], started["already_sending"]) == (1, False)
    assert (again["sending"], again["already_sending"], again["notes"]) == (0, True, [])
    assert again["batch_id"] == started["batch_id"]
    assert (retry.status_code, retry.json()["code"]) == (409, "already_sending")
    assert retry.json()["detail"] == "Your notes are being sent. Wait for this batch to finish."
    assert [note["status"] for note in after] == ["logged", "to_confirm"]
    assert fake.written == [subject(first)]


# --- Writing off ----------------------------------------------------------------------------------


async def test_with_writing_off_nothing_is_sent_and_the_answer_says_why(
    world: World, settings: dict[str, Any], fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    settings.update(hubspot_write_enabled=False)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        preview = await client.post(f"{NOTES}/preview", json={"ids": [note["id"]]})
        refused = await client.post(f"{NOTES}/confirm", json={"ids": [note["id"]]})
        after = await one(client, note)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert (body["sending_ready"], body["waiting_for"]) == (
        False,
        "Waiting for HubSpot write access.",
    )
    assert [item["id"] for item in body["items"]] == [note["id"]]
    assert body["totals"] == {"calls": 1, "tasks": 0, "changes": 0}
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_writes_off")
    assert refused.json()["detail"] == "Waiting for HubSpot write access."
    assert (after["status"], after["steps"]) == ("to_confirm", [])
    assert fake.previews == [] and fake.written == []


async def test_writing_switched_off_part_way_gives_back_the_rest(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        notes = [await log_call(client) for _ in range(3)]
        fake.off_after = 1
        await confirm(client, *notes)
        await sender.wait()
        after = [await one(client, note) for note in notes]
    assert [note["status"] for note in after] == ["logged", "to_confirm", "to_confirm"]
    assert [note["confirmed_at"] for note in after[1:]] == [None, None]
    assert fake.written == [subject(notes[0])]


# --- A field that changed in HubSpot --------------------------------------------------------------


async def test_a_field_changed_in_hubspot_after_the_preview_is_held_and_a_retry_sends_only_it(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    fake.hubspot_has[PERTH_LEASE] = "2027-03-31"  # HubSpot has a newer value than our copy
    perth = {"field": "lease_end", "office": "Perth", "value": "2028-03-31"}
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client)
        path = f"{NOTES}/{note['id']}"
        edit = await client.patch(path, json={"changes": [perth], "tasks": [TASK]})
        assert edit.status_code == 200, edit.text
        preview = (await client.post(f"{NOTES}/preview", json={"ids": [note["id"]]})).json()
        fake.hubspot_has[PERTH_LEASE] = "2027-06-30"  # it changes again after the rep saw it
        await confirm(client, note)
        await sender.wait()
        partial = await one(client, note)
        again = (await client.post(f"{NOTES}/preview", json={"ids": [note["id"]]})).json()
        # The follow-up is in HubSpot, so it can't change. The held field can.
        frozen = await client.patch(
            path, json={"tasks": [{**TASK, "id": "t1", "subject": "Ring Jo Sample"}]}
        )
        edited = await client.patch(
            path, json={"changes": [{**perth, "id": "c1", "value": "2028-06-30"}]}
        )
        retried = await client.post(f"{path}/retry")
        await sender.wait()
        logged = await one(client, note)
    assert (preview["sending_ready"], preview["waiting_for"]) == (True, None)
    [shown] = preview["items"]
    assert shown["changes"][0]["current"] == "2027-03-31"  # HubSpot's, not our copy's
    assert shown["changes"][0]["current_changed"] is True
    assert preview["totals"] == {"calls": 1, "tasks": 1, "changes": 1}
    # Held: not written, shown again with HubSpot's value. The call and the follow-up landed.
    assert partial["status"] == "partial"
    assert partial["changes"][0]["current"] == "2027-06-30"
    assert partial["changes"][0]["current_changed"] is True
    assert partial["steps"] == [
        {"step": "call", "status": "done", "words": "Call logged."},
        {
            "step": "fields",
            "status": "skipped",
            "words": "Perth lease end changed in HubSpot since you checked it. It is now "
            "30 Jun 2027. Check it, then send again.",
        },
        {"step": "task:1", "status": "done", "words": "Task added: Send the floor plan."},
    ]
    assert [task["in_hubspot"] for task in partial["tasks"]] == [True]
    assert again["totals"] == {"calls": 0, "tasks": 0, "changes": 0}
    assert (frozen.status_code, frozen.json()["code"]) == (409, "part_sent")
    assert edited.status_code == 200, edited.text
    assert edited.json()["changes"][0]["value"] == "2028-06-30"
    assert edited.json()["changes"][0]["current"] == "2027-06-30"  # HubSpot's, kept
    assert retried.status_code == 202 and retried.json()["status"] == "sending"
    # The retry sends only the field, with the value the rep has now seen.
    resent = fake.requests[subject(note, 2)]
    assert (resent.call, resent.tasks) == (None, [])
    assert resent.fields == [
        FieldSet(
            property=PERTH_LEASE, label="Perth lease end", value="2028-06-30", seen="2027-06-30"
        )
    ]
    assert logged["status"] == "logged"
    assert logged["steps"][1] == {
        "step": "fields",
        "status": "done",
        "words": "Perth lease end set to 30 Jun 2028 in HubSpot.",
    }
    assert fake.hubspot_has[PERTH_LEASE] == "2028-06-30"
    row = await the_row(world, note)
    card = NoteCard.model_validate(row.card)
    assert [write.subject for write in card.writes] == [subject(note), subject(note, 2)]
    assert str(row.write_id) == card.writes[-1].id


# --- An unsure step -------------------------------------------------------------------------------


async def test_an_unsure_step_is_resolved_both_ways(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        there, missing = await log_call(client), await log_call(client)
        fake.unsure_call.update(ids_of(there, missing))
        await confirm(client, there, missing)
        await sender.wait()
        unsure = await one(client, there)
        check_first = await client.post(f"{NOTES}/{there['id']}/retry")
        landed = await client.post(
            f"{NOTES}/{there['id']}/resolve", json={"step": "call", "landed": True}
        )
        gone = await client.post(
            f"{NOTES}/{missing['id']}/resolve", json={"step": "call", "landed": False}
        )
        # Not there: the rep may change what isn't in HubSpot, and send it again.
        fake.unsure_call.clear()
        edited = await client.patch(
            f"{NOTES}/{missing['id']}", json={"summary": "Jo will ring back."}
        )
        retried = await client.post(f"{NOTES}/{missing['id']}/retry")
        await sender.wait()
        after = await one(client, missing)
    assert unsure["status"] == "uncertain"
    assert unsure["steps"] == [
        {"step": "call", "status": "uncertain", "words": f"Call: HubSpot didn't answer. {CHECK}"}
    ]
    assert (check_first.status_code, check_first.json()["code"]) == (409, "note_uncertain")
    assert landed.status_code == 200, landed.text
    assert (landed.json()["status"], landed.json()["hubspot_url"]) == ("logged", CALL_URL)
    assert gone.status_code == 200, gone.text
    assert gone.json()["status"] == "failed"
    assert gone.json()["steps"] == [
        {
            "step": "call",
            "status": "failed",
            "words": "Call not saved: You said it isn't in HubSpot. Try again.",
        }
    ]
    assert edited.status_code == 200, edited.text
    assert retried.status_code == 202, retried.text
    assert after["status"] == "logged"
    resent = fake.requests[subject(missing, 2)]
    assert resent.call is not None and resent.call.body.startswith("Jo will ring back.\n\n")
    assert fake.answers == [("call", True), ("call", False)]


# --- The request for a note -----------------------------------------------------------------------


async def test_the_request_for_a_note(world: World, fake: FakeWriter, sender: NoteSender) -> None:
    await a_company(world)
    await add(
        world,
        deal("d1", "201", "Proposal"),
        deal("d2", "201", "Closed lost"),  # one open deal: the call goes on it
        deal("d3", "202", "Proposal"),
        deal("d4", "202", "Negotiation"),  # two open deals: on neither
    )
    card = NoteCard(
        call=CardCall(summary="Jo is looking at Melbourne.", outcome="Connected"),
        changes=[
            CardChange(
                id="c1",
                field="lease_end",
                label="Lease end",
                office="Perth",
                office_label="Perth",
                property=PERTH_LEASE,
                current=OUR_COPY,
                value="2028-03-31",
                said="the end of March 2028",
            ),
            CardChange(
                id="c2",
                field="staff",
                label="Staff",
                office="Canberra",
                office_label="Other Office 2",
                property=CANBERRA_STAFF,
                current=None,
                value="120",
                said="about 120 people",
            ),
        ],
        tasks=[
            CardTask(
                id="t1",
                subject="Send the floor plan",
                due=date(2026, 11, 24),
                due_words="Tuesday week",
                kind="email",
            )
        ],
        dropped=[Dropped(what="Sydney lease end", said="2029", why="only a year was said")],
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client, contact_id="c201")
        other = await log_call(
            client, company_key="202", contact_id="c301", text="Spoke to Ana Other."
        )
        lead = await log_call(client, text="A lead from the Lead Finder.")
        await set_note(world, note["id"], card=card.model_dump(mode="json"))
        await set_note(world, lead["id"], company_key=f"lead:{uuid.uuid4()}")
        preview = await client.post(
            f"{NOTES}/preview", json={"ids": [note["id"], other["id"], lead["id"]]}
        )
        lead_only = await confirm(client, lead)
    assert preview.status_code == 200, preview.text
    assert preview.json()["skipped"] == [{"id": lead["id"], "why": LEAD_ONLY}]
    assert (lead_only["sending"], lead_only["skipped"]) == (
        0,
        [{"id": lead["id"], "why": LEAD_ONLY}],
    )
    first, second = fake.previews
    assert first.model_dump(exclude={"call"}) == {
        "app": "companies",
        "subject": subject(note),
        "company_id": "201",
        "contact_id": "c201",
        "deal_id": "d1",
        "owner_id": "o1",
        "tasks": [
            TaskIn(subject="Send the floor plan", due=date(2026, 11, 24), kind="email").model_dump()
        ],
        "fields": [
            FieldSet(
                property=PERTH_LEASE, label="Perth lease end", value="2028-03-31", seen=OUR_COPY
            ).model_dump(),
            FieldSet(
                property=CANBERRA_STAFF, label="Canberra staff", value="120", seen=None
            ).model_dump(),
        ],
        "note": None,
    }
    assert first.call is not None
    assert (first.call.title, first.call.outcome, first.call.direction) == (
        "Call with Jo Sample",
        "Connected",
        "outbound",
    )
    assert first.call.at == START - timedelta(minutes=10)
    assert first.call.body == (
        f"Jo is looking at Melbourne.\n\n{note['text']}\n"
        "Not changed in HubSpot: Sydney lease end (said: '2029'): only a year was said."
    )
    assert "[number left out]" in first.call.body and "@" not in first.call.body
    assert (second.deal_id, second.contact_id) == (None, "c301")
    assert second.call is not None
    assert (second.call.title, second.call.body) == ("Call with Ana Other", "Spoke to Ana Other.")
    assert fake.written == []  # a preview writes nothing


# --- A restart ------------------------------------------------------------------------------------


async def test_a_note_a_restart_left_sending_settles_from_its_write(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_company(world)
    done = HubSpotWrite(
        id=uuid.uuid4(),
        app="companies",
        subject="call_note:done",
        status="done",
        plan=plan_of("201", []),
        result={"steps": [step("call", "done")]},
        hubspot_url=CALL_URL,
    )
    writing = HubSpotWrite(
        id=uuid.uuid4(),
        app="companies",
        subject="call_note:writing",
        status="writing",
        plan=plan_of("201", []),
        result={"steps": []},
    )
    await add(world, done, writing)
    long_ago, just_now = START - timedelta(minutes=10), START - timedelta(minutes=2)

    def sent_in(write: HubSpotWrite) -> dict[str, Any]:
        return {
            "call": {"outcome": "Connected"},
            "writes": [{"id": str(write.id), "subject": write.subject, "call": True}],
        }

    async with signed_in_as(world, "mia", ["companies"]) as client:
        back, landed, unsure, recent = [await log_call(client) for _ in range(4)]
        await set_note(world, back["id"], status="sending", updated_at=long_ago)
        await set_note(
            world,
            landed["id"],
            status="sending",
            write_id=done.id,
            card=sent_in(done),
            updated_at=long_ago,
        )
        await set_note(
            world,
            unsure["id"],
            status="sending",
            write_id=writing.id,
            card=sent_in(writing),
            updated_at=long_ago,
        )
        await set_note(world, recent["id"], status="sending", updated_at=just_now)
        listed = (await client.get(NOTES)).json()["items"]
        alone = await one(client, unsure)
    status = {note["id"]: note["status"] for note in listed}
    assert status[back["id"]] == "to_confirm"
    assert status[landed["id"]] == "logged"
    assert status[unsure["id"]] == "uncertain"
    assert status[recent["id"]] == "sending"  # maybe still on its way: left alone
    assert alone["steps"] == [
        {
            "step": "call",
            "status": "uncertain",
            "words": f"Call: Contour stopped while sending this note. {CHECK}",
        }
    ]
    assert (await the_row(world, landed)).hubspot_url == CALL_URL
