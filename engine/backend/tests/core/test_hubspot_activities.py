"""The activity writer (PLAN-V17 T1-5): a call, field changes, follow-up tasks and a note, written
to HubSpot once only, on the fake HubSpot (and once on the real client over a mock transport) and
the test database.

Every company, person and address here is made up.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import httpx2
import pytest
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.auth import admin
from core.db.engine import get_session
from core.hubspot.activities import (
    FOUND_DETAIL,
    LANDED_DETAIL,
    LOOK_GAP_SECONDS,
    LOOKED_UNSURE_DETAIL,
    LOOKS,
    NOT_A_CHOICE_DETAIL,
    NOT_A_DATE_DETAIL,
    NOT_A_NUMBER_DETAIL,
    NOT_IN_HUBSPOT_DETAIL,
    NOT_LANDED_DETAIL,
    PATCH_UNSURE_DETAIL,
    SENDING,
    STOPPED_DETAIL,
    ActivityRequest,
    CallIn,
    FieldSet,
    NoteIn,
    StepNotUncertain,
    TaskIn,
    activity_status,
    apply_activity,
    planned_steps,
    preview_activity,
    resolve_step,
)
from core.hubspot.client import (
    Choice,
    HttpHubSpot,
    HubSpotNotFound,
    HubSpotObject,
    HubSpotRejected,
    HubSpotUnavailable,
    HubSpotWritesOff,
    HubSpotWriteUncertain,
    Link,
    ObjectType,
    PropertyInfo,
)
from core.hubspot.models import (
    HubSpotCall,
    HubSpotCompany,
    HubSpotOffice,
    HubSpotOwner,
    HubSpotWrite,
)
from core.hubspot.writer import (
    StepResult,
    WriteInProgress,
    WriteNotFound,
    WriteOut,
    apply_write,
    write_out,
)
from tests.core.auth_world import FAST, GOOD, World, make_platform_admin, sign_in
from tests.core.hubspot_fake import FakeHubSpot, _plain

Factory = async_sessionmaker[AsyncSession]
db = pytest.mark.integration

MELBOURNE = ZoneInfo("Australia/Melbourne")
COMPANY, PERSON, DEAL, REP, OTHER_REP = "101", "201", "401", "301", "302"
OTHER_COMPANY = "102"
WRITES = "/api/v1/hubspot/writes"
LEASE = "lease_expiry_melbourne_"
MOVED = "last_moved_melbourne_"
STAFF = "number_of_staff_melbourne_office_"
EMPLOYEES = "numberofemployees"
QUALITY = "quality_of_office_melbourne_"
AT = datetime(2026, 11, 16, 9, 30, tzinfo=MELBOURNE)  # a Monday
CONNECTED = "f240bbac-87c9-4f6e-bf70-924b57d47db7"  # HubSpot's id for "Connected"
TIMED_OUT = HubSpotWriteUncertain("HubSpot didn't answer", "It timed out.")
REFUSED = HubSpotRejected("HubSpot didn't accept the request", "It answered 400 VALIDATION_ERROR.")
# Three 429 answers in a row: the client gives up with this.
BUSY = HubSpotUnavailable("HubSpot is busy", "Too many requests (429), even after waiting.")
NO_ANSWER = HubSpotUnavailable("HubSpot didn't answer", "It timed out or the connection broke.")


def ms(moment: datetime) -> str:
    return str(int(moment.timestamp()) * 1000)


def due_ms(day: date) -> str:
    return ms(datetime.combine(day, time(9, 0), tzinfo=MELBOURNE))


def company_fields() -> list[PropertyInfo]:
    return [
        _plain("name"),
        _plain("domain"),
        PropertyInfo(LEASE, "Lease Expiry (Melbourne)", "date", "date", None, False),
        PropertyInfo(MOVED, "Last Moved (Melbourne)", "date", "date", None, False),
        PropertyInfo(STAFF, "Number of Staff (Melbourne)", "string", "text", None, False),
        PropertyInfo(EMPLOYEES, "Number of Employees", "number", "number", None, True),
        PropertyInfo(
            QUALITY,
            "Quality of Office (Melbourne)",
            "enumeration",
            "select",
            None,
            False,
            (Choice("Needs an Upgrade", "needs_an_upgrade"), Choice("Good", "good")),
        ),
    ]


def contour(*, writes: bool = True) -> FakeHubSpot:
    """Contour's HubSpot, made up: one company with a Melbourne office."""
    fake = FakeHubSpot()
    fake.company_fields = company_fields()
    fake.add_company(
        COMPANY,
        name="Sample Logistics Pty Ltd",
        domain="samplelogistics.com.au",
        **{LEASE: "2027-06-30", STAFF: "120", QUALITY: "good"},
    )
    if writes:
        fake.grant_writes()
    return fake


def a_request(**parts: Any) -> ActivityRequest:
    base: dict[str, Any] = {
        "app": "companies",
        "subject": "call_note:1",
        "company_id": COMPANY,
        "contact_id": PERSON,
        "deal_id": DEAL,
        "owner_id": REP,
        "call": CallIn(
            at=AT,
            title="Call with Jo Sample",
            body="Lease ends June 2027.\nWants a floor plan.",
            outcome="Connected",
        ),
        "fields": [
            FieldSet(
                property=LEASE, label="Melbourne lease end", value="2028-03-31", seen="2027-06-30"
            )
        ],
        "tasks": [
            TaskIn(
                subject="Send the floor plan",
                body="The level 3 plan",
                due=date(2026, 11, 20),
                kind="email",
                priority="high",
            ),
            TaskIn(
                subject="Call back about the lease",
                due=date(2026, 11, 27),
                kind="call",
                owner_id=OTHER_REP,
            ),
        ],
        "note": NoteIn(body="Pre-read for Sample Logistics Pty Ltd"),
    }
    return ActivityRequest.model_validate(base | parts)


def only(**parts: Any) -> ActivityRequest:
    """A request with only the parts given."""
    empty: dict[str, Any] = {"call": None, "fields": [], "tasks": [], "note": None}
    return a_request(**(empty | parts))


class Waits:
    """The writer's pause between looks, without the wait."""

    def __init__(self) -> None:
        self.seconds: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.seconds.append(seconds)


def writes_of(fake: FakeHubSpot) -> list[str]:
    return [name for name in fake.calls if name.startswith(("create_", "update_"))]


async def add_owners(session: AsyncSession) -> None:
    session.add_all(
        [
            HubSpotOwner(owner_id=REP, name="Jo Sample"),
            HubSpotOwner(owner_id=OTHER_REP, name="Sam Example"),
        ]
    )
    await session.commit()


async def row_of(session: AsyncSession, write_id: uuid.UUID) -> HubSpotWrite:
    row = await session.get(HubSpotWrite, write_id, populate_existing=True)
    assert row is not None
    return row


async def left_writing(
    session: AsyncSession,
    write_id: uuid.UUID,
    *,
    ago: timedelta,
    steps: list[StepResult],
    sending: str | None = None,
    old_row: bool = False,
) -> None:
    """The write as a backend that stopped part way leaves it. `sending`: the step it had saved
    as on its way to HubSpot, or None. `old_row`: a row saved before the plan kept that step."""
    plan = dict((await row_of(session, write_id)).plan)
    if old_row:
        plan.pop(SENDING, None)
    else:
        plan[SENDING] = sending
    await session.execute(
        update(HubSpotWrite)
        .where(HubSpotWrite.id == write_id)
        .values(
            status="writing",
            applied_at=datetime.now(UTC) - ago,
            result={"steps": [step.model_dump() for step in steps]},
            plan=plan,
        )
    )
    await session.commit()


async def five_minutes_on(session: AsyncSession, write_id: uuid.UUID) -> None:
    """The write's claim was last kept 6 minutes ago: its apply has stopped."""
    await session.execute(
        update(HubSpotWrite)
        .where(HubSpotWrite.id == write_id)
        .values(applied_at=datetime.now(UTC) - timedelta(minutes=6))
    )
    await session.commit()


class Killed(BaseException):
    """The backend dies: nothing runs after it, not even the writer's own settling."""


CALL_DONE = StepResult(
    step="call", status="done", detail="Logged the call.", hubspot_id="900000777"
)


# --- The rules, in pure code (fast) ----------------------------------------------------------


def test_the_steps_go_call_fields_tasks_then_note() -> None:
    assert planned_steps(a_request()) == ["call", "fields", "task:1", "task:2", "note"]
    assert planned_steps(only(note=NoteIn(body="A pre-read"))) == ["note"]


def test_a_writes_status_counts_every_planned_step() -> None:
    planned = ["call", "task:1", "note"]

    def steps(**states: str) -> dict[str, StepResult]:
        return {
            name.replace("_", ":"): StepResult(step=name.replace("_", ":"), status=state)
            for name, state in states.items()
        }

    assert activity_status(planned, steps(call="done", task_1="done", note="done")) == "done"
    assert activity_status(planned, steps(call="done", task_1="failed", note="done")) == "partial"
    assert activity_status(planned, steps(call="done", task_1="uncertain")) == "uncertain"
    # A step not tried yet (a write taken over part way) isn't finished.
    assert activity_status(planned, steps(call="done", task_1="done")) == "partial"
    assert activity_status(planned, steps()) == "failed"
    # Nothing to send (every field already there, or held): done.
    assert activity_status(["fields"], steps(fields="skipped")) == "done"


def test_a_step_name_is_one_the_writers_know() -> None:
    for name in ("company", "note", "list", "call", "fields", "task:1", "task:12", "meeting"):
        assert StepResult(step=name, status="done").step == name
    for wrong in ("task:0", "task:", "tasks", "Call", "task:1 ", "meetings"):
        with pytest.raises(ValueError):
            StepResult(step=wrong, status="done")


# --- Preview -----------------------------------------------------------------------------------


@db
async def test_the_preview_reads_the_company_and_says_what_each_field_would_do(
    session: AsyncSession,
) -> None:
    fake = contour(writes=False)  # the preview only reads, so it works while writing is off
    await add_owners(session)
    request = a_request(
        fields=[
            # Written, over HubSpot's value: the rep sees both and confirms (choice 4).
            FieldSet(
                property=LEASE, label="Melbourne lease end", value="2028-03-31", seen="2027-06-30"
            ),
            FieldSet(property=MOVED, label="Melbourne last move", value="31/03/2026"),
            FieldSet(property=EMPLOYEES, label="Staff", value="about 300"),
            FieldSet(property=STAFF, label="Melbourne staff", value=" 120 ", seen="120"),
            # A pick list goes as HubSpot's code, and what the rep saw is read the same way.
            FieldSet(
                property=QUALITY, label="Melbourne office", value="Needs an Upgrade", seen="Good"
            ),
            FieldSet(property="contour_ai_trigger", label="AI trigger", value="Lease expiry"),
        ]
    )
    out = await preview_activity(session, fake, request)

    assert (out.status, out.plan.kind, out.plan.action) == ("previewed", "activity", "update")
    assert (out.can_write, out.waiting_for) == (False, "Waiting for write access")
    by = {change.property: change for change in out.plan.fields}
    lease = by[LEASE]
    assert (lease.write, lease.value, lease.current, lease.seen) == (
        True,
        "2028-03-31",
        "2027-06-30",
        "2027-06-30",
    )
    assert not lease.changed_since
    assert (by[MOVED].write, by[MOVED].reason) == (False, NOT_A_DATE_DETAIL)
    assert (by[EMPLOYEES].write, by[EMPLOYEES].reason) == (False, NOT_A_NUMBER_DETAIL)
    assert (by[STAFF].write, by[STAFF].reason) == (False, "HubSpot already has this value.")
    quality = by[QUALITY]
    assert (quality.write, quality.value, quality.seen, quality.changed_since) == (
        True,
        "needs_an_upgrade",
        "good",
        False,
    )
    assert (by["contour_ai_trigger"].write, by["contour_ai_trigger"].reason) == (
        False,
        "HubSpot has no such field.",
    )
    assert out.plan.call == "Call with Jo Sample. Connected. 16 Nov 2026, 9:30 am."
    assert out.plan.tasks == [
        "Send the floor plan: an email, high priority, due Fri 20 Nov 2026, for Jo Sample.",
        "Call back about the lease: a call, medium priority, due Fri 27 Nov 2026, for Sam Example.",
    ]
    assert (out.plan.contact_id, out.plan.deal_id, out.plan.owner_id) == (PERSON, DEAL, REP)
    assert out.plan.note == "Pre-read for Sample Logistics Pty Ltd"
    assert out.plan.company_name == "Sample Logistics Pty Ltd"
    assert (
        out.hubspot_url == out.plan.company_url and out.hubspot_url
    )  # the company's, until a call
    assert writes_of(fake) == []
    # The request rides along, so the write sends exactly what was previewed.
    row = await row_of(session, out.id)
    assert ActivityRequest.model_validate(row.plan["request"]) == request

    # One open write per subject: a second preview plans the same write again.
    again = await preview_activity(session, fake, request)
    assert again.id == out.id and again.status == "previewed"


@db
async def test_the_preview_says_when_hubspot_differs_from_what_the_rep_saw(
    session: AsyncSession,
) -> None:
    fake = contour()
    seen_other = FieldSet(
        property=LEASE, label="Melbourne lease end", value="2028-03-31", seen="2026-12-31"
    )
    saw_empty = FieldSet(property=STAFF, label="Melbourne staff", value="150")
    bad_choice = FieldSet(property=QUALITY, label="Melbourne office", value="Shiny")
    out = await preview_activity(session, fake, only(fields=[seen_other, saw_empty, bad_choice]))
    by = {change.property: change for change in out.plan.fields}
    assert (by[LEASE].write, by[LEASE].changed_since, by[LEASE].current) == (
        True,
        True,
        "2027-06-30",
    )
    assert (by[STAFF].write, by[STAFF].changed_since) == (True, True)  # the rep saw it empty
    assert (by[QUALITY].write, by[QUALITY].reason) == (False, NOT_A_CHOICE_DETAIL)


@db
async def test_a_company_not_in_hubspot_is_refused_in_plain_words(session: AsyncSession) -> None:
    fake = contour()
    for company in ("999", "lead:5d0c"):
        with pytest.raises(HubSpotNotFound) as caught:
            await preview_activity(session, fake, a_request(company_id=company))
        assert caught.value.detail == NOT_IN_HUBSPOT_DETAIL
    with pytest.raises(HubSpotRejected):  # a person or deal id that isn't HubSpot's
        await preview_activity(session, fake, a_request(contact_id="jo-sample"))
    assert writes_of(fake) == []
    assert (await session.scalars(select(HubSpotWrite))).all() == []


# --- Write -------------------------------------------------------------------------------------


@db
async def test_writing_off_refuses_and_claims_nothing(session: AsyncSession) -> None:
    fake = contour(writes=False)
    out = await preview_activity(session, fake, a_request())
    with pytest.raises(HubSpotWritesOff):
        await apply_activity(session, fake, out.id, pause=Waits())
    row = await row_of(session, out.id)
    assert (row.status, row.applied_at, row.result) == ("previewed", None, {})
    assert writes_of(fake) == []


@db
async def test_each_step_goes_in_order_with_its_fields_and_links(session: AsyncSession) -> None:
    fake = contour()
    await add_owners(session)
    out = await preview_activity(session, fake, a_request())
    done = await apply_activity(session, fake, out.id, pause=Waits())

    assert done.status == "done"
    assert [(step.step, step.status) for step in done.steps] == [
        ("call", "done"),
        ("fields", "done"),
        ("task:1", "done"),
        ("task:2", "done"),
        ("note", "done"),
    ]
    assert writes_of(fake) == [
        "create_calls",
        "update_companies",
        "create_tasks",
        "create_tasks",
        "create_notes",
    ]
    (call,) = fake.call_log.values()
    assert call.properties == {
        "hs_timestamp": ms(AT),
        "hs_call_title": "Call with Jo Sample",
        "hs_call_body": "<p>Lease ends June 2027.</p><p>Wants a floor plan.</p>",
        "hs_call_direction": "OUTBOUND",
        "hs_call_status": "COMPLETED",
        "hs_call_disposition": CONNECTED,
        "hubspot_owner_id": REP,
    }
    assert (call.companies, call.contacts, call.deals) == ((COMPANY,), (PERSON,), (DEAL,))
    first, second = sorted(fake.tasks.values(), key=lambda record: int(record.id))
    assert first.properties == {
        "hs_timestamp": due_ms(date(2026, 11, 20)),  # 9:00 am Melbourne time on the day
        "hs_task_subject": "Send the floor plan",
        "hs_task_body": "<p>The level 3 plan</p>",
        "hs_task_status": "NOT_STARTED",
        "hs_task_priority": "HIGH",
        "hs_task_type": "EMAIL",
        "hubspot_owner_id": REP,  # the rep's, as the task names nobody
    }
    assert (first.companies, first.contacts, first.deals) == ((COMPANY,), (PERSON,), (DEAL,))
    assert second.properties["hubspot_owner_id"] == OTHER_REP  # the task's own owner
    assert "hs_task_body" not in second.properties  # never an empty text
    (note,) = fake.notes.values()
    assert note.properties["hs_note_body"] == "<p>Pre-read for Sample Logistics Pty Ltd</p>"
    assert (note.properties["hs_timestamp"] or "").isdigit()
    assert (note.companies, note.contacts, note.deals) == ((COMPANY,), (), (DEAL,))
    assert fake.companies[COMPANY].properties[LEASE] == "2028-03-31"
    # "Open in HubSpot" opens the call once it has landed.
    assert done.hubspot_url is not None and done.hubspot_url.endswith(f"/{call.id}")
    assert done.hubspot_url != out.hubspot_url

    # Our copy has the call at once ...
    copy = await session.get(HubSpotCall, call.id)
    assert copy is not None
    assert (copy.hubspot_company_id, copy.hubspot_contact_id, copy.called_at) == (
        COMPANY,
        PERSON,
        AT,
    )
    assert (copy.outcome, copy.title, copy.owner, copy.owner_id) == (
        "Connected",
        "Call with Jo Sample",
        "Jo Sample",
        REP,
    )
    assert copy.note == "Lease ends June 2027.\nWants a floor plan." and copy.hubspot_url
    # ... and the company and its offices, as HubSpot has them now.
    company = await session.get(HubSpotCompany, COMPANY)
    assert company is not None and company.source == "api"
    office = await session.scalar(
        select(HubSpotOffice).where(
            HubSpotOffice.hubspot_company_id == COMPANY, HubSpotOffice.label == "Melbourne"
        )
    )
    assert office is not None and office.lease_expiry == date(2028, 3, 31)

    # Once only: applying a finished write returns it, and nothing is sent again.
    again = await apply_activity(session, fake, out.id, pause=Waits())
    assert again.id == done.id and again.status == "done"
    assert len(writes_of(fake)) == 5
    assert (await preview_activity(session, fake, a_request())).id == out.id


@db
async def test_hubspot_gets_the_link_numbers_and_one_change_of_the_fields(
    session: AsyncSession,
) -> None:
    """The real client over a mock transport: the request bodies HubSpot gets."""
    company: dict[str, str | None] = {
        "name": "Sample Logistics Pty Ltd",
        "domain": "samplelogistics.com.au",
        LEASE: "2027-06-30",
    }
    made = iter(range(5001, 5100))
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        path = request.url.path
        if path == "/crm/properties/2026-09/companies":
            kinds = {LEASE: "date"}
            fields = [{"name": n, "label": n, "type": kinds.get(n, "string")} for n in company]
            return httpx2.Response(200, json={"results": fields})
        if path == f"/crm/objects/2026-09/companies/{COMPANY}":
            if request.method == "PATCH":
                company.update(json.loads(request.content)["properties"])
            url = f"https://app.hubspot.com/contacts/1/record/0-2/{COMPANY}"
            return httpx2.Response(200, json={"id": COMPANY, "properties": company, "url": url})
        if request.method == "POST" and path.split("/")[-1] in ("calls", "tasks", "notes"):
            record = str(next(made))
            url = f"https://app.hubspot.com/contacts/1/record/0-48/{record}"
            return httpx2.Response(201, json={"id": record, "properties": {}, "url": url})
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
        out = await preview_activity(session, client, a_request())
        done = await apply_activity(session, client, out.id, pause=Waits())
    assert done.status == "done", done.error

    sent = [(r.method, r.url.path.split("/")[-1]) for r in seen if r.method in ("POST", "PATCH")]
    assert sent == [
        ("POST", "calls"),
        ("PATCH", COMPANY),
        ("POST", "tasks"),
        ("POST", "tasks"),
        ("POST", "notes"),
    ]
    bodies = [json.loads(r.content) for r in seen if r.method in ("POST", "PATCH")]

    def links(body: dict[str, Any]) -> list[tuple[str, int]]:
        return [
            (item["to"]["id"], item["types"][0]["associationTypeId"])
            for item in body.get("associations", [])
        ]

    assert links(bodies[0]) == [(COMPANY, 182), (PERSON, 194), (DEAL, 206)]
    assert bodies[1] == {"properties": {LEASE: "2028-03-31"}}  # one change, the field only
    assert links(bodies[2]) == links(bodies[3]) == [(COMPANY, 192), (PERSON, 204), (DEAL, 216)]
    assert links(bodies[4]) == [(COMPANY, 190), (DEAL, 214)]
    assert bodies[0]["properties"]["hs_call_disposition"] == CONNECTED
    assert done.hubspot_url == "https://app.hubspot.com/contacts/1/record/0-48/5001"


@db
async def test_a_field_changed_in_hubspot_since_the_preview_is_held_and_the_rest_go_in_one_change(
    session: AsyncSession,
) -> None:
    fake = contour()
    fields = [
        FieldSet(
            property=LEASE, label="Melbourne lease end", value="2028-03-31", seen="2027-06-30"
        ),
        FieldSet(property=STAFF, label="Melbourne staff", value="150", seen="120"),
    ]
    out = await preview_activity(session, fake, only(fields=fields))
    fake.companies[COMPANY].properties[LEASE] = "2027-12-31"  # someone changed it since

    done = await apply_activity(session, fake, out.id, pause=Waits())

    (step,) = done.steps
    assert (step.step, step.status, step.held) == ("fields", "done", [LEASE])
    assert "Changed in HubSpot since the preview" in (step.detail or "")
    assert "Melbourne lease end" in (step.detail or "")
    assert fake.calls.count("update_companies") == 1
    record = fake.companies[COMPANY].properties
    assert (record[LEASE], record[STAFF]) == ("2027-12-31", "150")
    # The held field shows in the plan: not written, with HubSpot's value now.
    by = {change.property: change for change in done.plan.fields}
    assert (by[LEASE].write, by[LEASE].current, by[LEASE].changed_since) == (
        False,
        "2027-12-31",
        True,
    )
    assert by[LEASE].reason
    assert (by[STAFF].write, by[STAFF].current) == (True, "120")
    saved = (await row_of(session, out.id)).plan[
        "fields"
    ]  # saved, as Track 2 reads it from the row
    assert {item["property"]: item["write"] for item in saved} == {LEASE: False, STAFF: True}


@db
async def test_a_field_hubspot_had_otherwise_than_the_rep_saw_is_held_too(
    session: AsyncSession,
) -> None:
    fake = contour()
    saw_empty = FieldSet(property=LEASE, label="Melbourne lease end", value="2028-03-31")
    out = await preview_activity(session, fake, only(fields=[saw_empty]))
    assert out.plan.fields[0].changed_since  # HubSpot has 2027-06-30; the rep saw it empty

    done = await apply_activity(session, fake, out.id, pause=Waits())

    (step,) = done.steps
    assert (step.status, step.held) == ("skipped", [LEASE])
    assert "update_companies" not in fake.calls
    assert fake.companies[COMPANY].properties[LEASE] == "2027-06-30"
    assert done.status == "done"  # nothing this write may send is left


@db
async def test_a_change_that_timed_out_is_checked_by_reading_the_company(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.fail_after["update_companies"] = [TIMED_OUT]  # saved, then no answer
    out = await preview_activity(session, fake, only(fields=a_request().fields))
    done = await apply_activity(session, fake, out.id, pause=Waits())
    assert (done.status, done.steps[0].status) == ("done", "done")

    fake = contour()
    fake.fail["update_companies"] = [TIMED_OUT]  # no answer, and not saved
    out = await preview_activity(
        session, fake, only(fields=a_request().fields, subject="call_note:2")
    )
    failed = await apply_activity(session, fake, out.id, pause=Waits())
    assert (failed.status, failed.steps[0].detail) == ("failed", PATCH_UNSURE_DETAIL)
    again = await apply_activity(session, fake, out.id, pause=Waits())  # the same values: safe
    assert again.status == "done" and fake.calls.count("update_companies") == 2
    assert fake.companies[COMPANY].properties[LEASE] == "2028-03-31"


@db
async def test_a_create_that_timed_out_and_landed_is_found_and_never_sent_again(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.search_lag = 1  # the new call shows in the second search
    fake.fail_after["create_calls"] = [TIMED_OUT]
    waits = Waits()
    out = await preview_activity(session, fake, only(call=a_request().call))

    done = await apply_activity(session, fake, out.id, pause=waits)

    (call,) = fake.call_log.values()
    assert done.status == "done"
    assert (done.steps[0].hubspot_id, done.steps[0].detail) == (call.id, FOUND_DETAIL)
    assert fake.calls.count("create_calls") == 1 and fake.calls.count("search_calls") == 2
    assert waits.seconds == [LOOK_GAP_SECONDS]
    assert done.hubspot_url is not None and done.hubspot_url.endswith(f"/{call.id}")
    assert await session.get(HubSpotCall, call.id) is not None


@db
async def test_another_call_at_the_same_moment_is_never_taken_for_ours(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.fail["create_calls"] = [TIMED_OUT]  # ours never reached HubSpot
    fake.add_call("900000555", COMPANY, hs_timestamp=ms(AT), hs_call_title="Call with Sam Example")
    out = await preview_activity(session, fake, only(call=a_request().call, owner_id=None))

    written = await apply_activity(session, fake, out.id, pause=Waits())

    assert (written.status, written.steps[0].status) == ("uncertain", "uncertain")
    assert written.steps[0].hubspot_id is None


@db
async def test_another_companys_task_due_the_same_day_is_never_taken_for_ours(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.add_company(OTHER_COMPANY, name="Example Freight Pty Ltd")
    task = a_request().tasks[0]
    # The rep's task for another company: the same subject, owner and day, so the same time.
    theirs = await fake.create_object(
        "tasks",
        {
            "hs_timestamp": due_ms(task.due),
            "hs_task_subject": task.subject,
            "hubspot_owner_id": REP,
        },
        links=[Link("companies", OTHER_COMPANY)],
    )
    fake.fail["create_tasks"] = [TIMED_OUT]  # ours never reached HubSpot
    out = await preview_activity(session, fake, only(tasks=[task]))

    unsure = await apply_activity(session, fake, out.id, pause=Waits())

    assert (unsure.status, unsure.steps[0].hubspot_id) == ("uncertain", None)
    assert unsure.steps[0].detail == LOOKED_UNSURE_DETAIL

    # Ours lands this time, then times out: both match the search, and only ours is linked to
    # our company.
    fake.fail_after["create_tasks"] = [TIMED_OUT]
    out = await preview_activity(session, fake, only(tasks=[task], subject="call_note:2"))

    found = await apply_activity(session, fake, out.id, pause=Waits())

    (ours,) = [record for record in fake.tasks.values() if record.id != theirs.id]
    assert (found.status, found.steps[0].hubspot_id) == ("done", ours.id)
    assert found.steps[0].detail == FOUND_DETAIL


@db
async def test_a_look_whose_links_hubspot_does_not_answer_is_no_answer(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.fail_after["create_tasks"] = [TIMED_OUT]  # ours landed, then no answer
    fake.fail["linked_tasks_companies"] = [NO_ANSWER]  # the first look's links: no answer
    waits = Waits()
    out = await preview_activity(session, fake, only(tasks=a_request().tasks[:1]))

    found = await apply_activity(session, fake, out.id, pause=waits)

    assert (found.status, found.steps[0].detail) == ("done", FOUND_DETAIL)
    assert fake.calls.count("linked_tasks_companies") == 2  # looked again, and confirmed it
    assert waits.seconds == [LOOK_GAP_SECONDS]

    # The links never answer: it is never confirmed, so it stays uncertain and isn't sent again.
    fake.fail_after["create_tasks"] = [TIMED_OUT]
    fake.fail["linked_tasks_companies"] = [NO_ANSWER] * LOOKS
    later = only(tasks=a_request().tasks[1:], subject="call_note:2")
    out = await preview_activity(session, fake, later)

    unsure = await apply_activity(session, fake, out.id, pause=Waits())

    assert (unsure.status, unsure.steps[0].detail) == ("uncertain", LOOKED_UNSURE_DETAIL)
    assert fake.calls.count("create_tasks") == 2  # one each: neither was sent again


@db
async def test_a_create_that_timed_out_and_is_not_found_stays_uncertain_until_a_person_says(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.fail["create_calls"] = [TIMED_OUT]  # it never reached HubSpot
    waits = Waits()
    out = await preview_activity(session, fake, only(call=a_request().call))

    first = await apply_activity(session, fake, out.id, pause=waits)
    assert (first.status, first.steps[0].status) == ("uncertain", "uncertain")
    assert first.steps[0].detail == LOOKED_UNSURE_DETAIL
    assert fake.calls.count("search_calls") == LOOKS
    assert waits.seconds == [LOOK_GAP_SECONDS] * (LOOKS - 1)  # about 30 seconds in all

    second = await apply_activity(session, fake, out.id, pause=waits)  # looks again, never sends
    assert second.status == "uncertain"
    assert fake.calls.count("create_calls") == 1 and fake.calls.count("search_calls") == 2 * LOOKS

    told = await resolve_step(session, out.id, "call", landed=False)
    assert (told.status, told.steps[0].status, told.steps[0].detail) == (
        "failed",
        "failed",
        NOT_LANDED_DETAIL,
    )
    assert fake.calls.count("create_calls") == 1  # a person's word never calls HubSpot

    sent = await apply_activity(session, fake, out.id, pause=waits)
    assert sent.status == "done" and len(fake.call_log) == 1
    assert fake.calls.count("create_calls") == 2


@db
async def test_a_person_can_say_an_uncertain_step_is_in_hubspot(session: AsyncSession) -> None:
    fake = contour()
    fake.fail["create_tasks"] = [TIMED_OUT]
    out = await preview_activity(session, fake, only(tasks=a_request().tasks[:1]))
    assert (await apply_activity(session, fake, out.id, pause=Waits())).status == "uncertain"

    told = await resolve_step(session, out.id, "task:1", landed=True)

    assert (told.status, told.steps[0].status, told.steps[0].detail) == (
        "done",
        "done",
        LANDED_DETAIL,
    )
    assert (await apply_activity(session, fake, out.id, pause=Waits())).status == "done"
    assert fake.calls.count("create_tasks") == 1 and fake.tasks == {}


@db
async def test_resolve_on_a_step_that_is_not_uncertain_raises_its_own_error(
    session: AsyncSession,
) -> None:
    fake = contour()
    out = await preview_activity(session, fake, only(call=a_request().call))
    with pytest.raises(StepNotUncertain):  # only previewed
        await resolve_step(session, out.id, "call", landed=True)
    await apply_activity(session, fake, out.id, pause=Waits())
    for step in ("call", "task:9", "nonsense"):
        with pytest.raises(StepNotUncertain):
            await resolve_step(session, out.id, step, landed=False)
    assert (await row_of(session, out.id)).status == "done"
    with pytest.raises(WriteNotFound):
        await resolve_step(session, uuid.uuid4(), "call", landed=True)


@db
async def test_two_clicks_at_once_write_once(
    session: AsyncSession, session_factory: Factory
) -> None:
    fake = contour()
    out = await preview_activity(session, fake, a_request())
    results: list[str] = []

    async def click() -> None:
        async with session_factory() as own:
            try:
                results.append((await apply_activity(own, fake, out.id, pause=Waits())).status)
            except WriteInProgress:
                results.append("in progress")

    await asyncio.gather(click(), click())

    assert sorted(results) in (["done", "in progress"], ["done", "done"])
    assert (len(fake.call_log), len(fake.tasks), len(fake.notes)) == (1, 2, 1)
    assert fake.calls.count("update_companies") == 1


@db
async def test_two_previews_at_once_make_one_write(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = contour()
    both = asyncio.Barrier(2)
    read = fake.get_object

    async def together(
        object_type: ObjectType, object_id: str, *, properties: Sequence[str]
    ) -> HubSpotObject | None:
        await both.wait()  # each preview has looked for the subject's write, and found none
        return await read(object_type, object_id, properties=properties)

    monkeypatch.setattr(fake, "get_object", together)

    async def preview() -> WriteOut:
        async with session_factory() as own:
            return await preview_activity(own, fake, a_request())

    first, second = await asyncio.wait_for(asyncio.gather(preview(), preview()), timeout=30)

    assert first.id == second.id
    async with session_factory() as check:
        rows = (await check.scalars(select(HubSpotWrite))).all()
    assert [(row.subject, row.status) for row in rows] == [("call_note:1", "previewed")]


@db
async def test_a_failed_task_never_stops_the_note_and_applying_again_redoes_only_it(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.fail["create_tasks"] = [REFUSED]
    out = await preview_activity(session, fake, a_request())

    first = await apply_activity(session, fake, out.id, pause=Waits())

    states = {step.step: step.status for step in first.steps}
    assert first.status == "partial"
    assert states == {
        "call": "done",
        "fields": "done",
        "task:1": "failed",
        "task:2": "done",
        "note": "done",
    }
    assert first.error and first.error.startswith("task:1: HubSpot didn't accept the request.")

    again = await apply_activity(session, fake, out.id, pause=Waits())

    assert again.status == "done"
    assert writes_of(fake).count("create_tasks") == 3  # the refused one, the second, the retry
    assert (len(fake.call_log), len(fake.notes), fake.calls.count("update_companies")) == (1, 1, 1)


@db
async def test_a_write_left_writing_is_taken_over_after_five_minutes(session: AsyncSession) -> None:
    fake = contour()
    waits = Waits()
    out = await preview_activity(session, fake, a_request(fields=[]))
    assert (await row_of(session, out.id)).plan[SENDING] is None  # nothing on its way yet
    # The backend stopped while sending task:1: the call is in HubSpot; task:1 never landed.
    minute = timedelta(minutes=1)
    await left_writing(session, out.id, ago=minute, steps=[CALL_DONE], sending="task:1")
    with pytest.raises(WriteInProgress):  # a younger one is still being written
        await apply_activity(session, fake, out.id, pause=waits)
    with pytest.raises(WriteInProgress):
        await resolve_step(session, out.id, "task:1", landed=False)

    await left_writing(session, out.id, ago=6 * minute, steps=[CALL_DONE], sending="task:1")
    taken = await apply_activity(session, fake, out.id, pause=waits)

    steps = {step.step: step for step in taken.steps}
    assert steps["call"].hubspot_id == "900000777"  # done before: not sent again
    assert (steps["task:1"].status, steps["task:1"].detail) == ("uncertain", LOOKED_UNSURE_DETAIL)
    assert (steps["task:2"].status, steps["note"].status) == ("done", "done")
    assert taken.status == "uncertain"
    assert fake.calls.count("create_calls") == 0 and fake.calls.count("search_tasks") == LOOKS
    assert fake.calls.count("create_tasks") == 1  # task:2 only: task:1 is looked for, not sent

    told = await resolve_step(session, out.id, "task:1", landed=False)
    assert told.status == "partial"
    done = await apply_activity(session, fake, out.id, pause=waits)
    assert done.status == "done" and fake.calls.count("create_tasks") == 2 and len(fake.tasks) == 2


@db
async def test_a_task_that_landed_before_the_backend_stopped_is_found_not_sent_again(
    session: AsyncSession,
) -> None:
    fake = contour()
    out = await preview_activity(session, fake, a_request(fields=[]))
    landed = await fake.create_object(
        "tasks",
        {
            "hs_timestamp": due_ms(date(2026, 11, 20)),
            "hs_task_subject": "Send the floor plan",
            "hubspot_owner_id": REP,
        },
        links=[Link("companies", COMPANY)],
    )
    fake.calls.clear()
    await left_writing(
        session, out.id, ago=timedelta(minutes=6), steps=[CALL_DONE], sending="task:1"
    )

    taken = await apply_activity(session, fake, out.id, pause=Waits())

    steps = {step.step: step for step in taken.steps}
    assert (steps["task:1"].status, steps["task:1"].hubspot_id) == ("done", landed.id)
    assert taken.status == "done" and fake.calls.count("create_tasks") == 1  # task:2 only


@db
async def test_a_person_can_answer_for_a_write_left_writing(session: AsyncSession) -> None:
    fake = contour()
    out = await preview_activity(session, fake, a_request(fields=[]))
    six = timedelta(minutes=6)
    await left_writing(session, out.id, ago=six, steps=[CALL_DONE], sending="task:1")

    told = await resolve_step(session, out.id, "task:1", landed=True)

    steps = {step.step: step for step in told.steps}
    assert (steps["task:1"].status, steps["task:1"].detail) == ("done", LANDED_DETAIL)
    assert "task:2" not in steps and told.status == "partial"  # not sent yet
    done = await apply_activity(session, fake, out.id, pause=Waits())
    assert done.status == "done"
    assert writes_of(fake) == ["create_tasks", "create_notes"]  # task:2 and the note only

    # A step that isn't the one left unsure: the write is settled all the same.
    out = await preview_activity(session, fake, a_request(fields=[], subject="call_note:2"))
    await left_writing(session, out.id, ago=six, steps=[CALL_DONE], sending="task:1")
    with pytest.raises(StepNotUncertain):
        await resolve_step(session, out.id, "note", landed=True)
    row = await row_of(session, out.id)
    assert row.status == "uncertain"
    assert [step["status"] for step in row.result["steps"]] == ["done", "uncertain"]
    assert row.result["steps"][1]["detail"] == STOPPED_DETAIL


@db
async def test_a_send_stopped_by_a_shutdown_is_settled_at_once(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = contour()
    async with session_factory() as session:
        out = await preview_activity(session, fake, a_request())
    started, never = asyncio.Event(), asyncio.Event()
    create = fake.create_object

    async def slow(
        kind: ObjectType, properties: Mapping[str, str], *, links: Sequence[Link] = ()
    ) -> HubSpotObject:
        if kind == "tasks":
            started.set()
            await never.wait()  # the backend stops while this task is on its way
        return await create(kind, properties, links=links)

    monkeypatch.setattr(fake, "create_object", slow)
    async with session_factory() as session:
        sending = asyncio.create_task(apply_activity(session, fake, out.id, pause=Waits()))
        await started.wait()
        sending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await sending
    async with session_factory() as session:
        row = await row_of(session, out.id)
        states = [(step["step"], step["status"]) for step in row.result["steps"]]
    assert row.status == "uncertain"  # not left "writing" for 5 minutes
    assert states == [("call", "done"), ("fields", "done"), ("task:1", "uncertain")]


@db
async def test_a_retry_cut_off_while_sending_is_looked_for_and_never_sent_twice(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = contour()
    fake.fail["create_tasks"] = [BUSY]
    out = await preview_activity(session, fake, a_request())
    first = await apply_activity(session, fake, out.id, pause=Waits())
    assert first.status == "partial"
    assert {step.step: step.status for step in first.steps}["task:1"] == "failed"

    # The rep presses Retry: task:1 lands in HubSpot, then the backend dies before its answer is
    # saved.
    create = fake.create_object

    async def lands_then_dies(
        kind: ObjectType, properties: Mapping[str, str], *, links: Sequence[Link] = ()
    ) -> HubSpotObject:
        await create(kind, properties, links=links)
        raise Killed

    monkeypatch.setattr(fake, "create_object", lands_then_dies)
    with pytest.raises(Killed):
        await apply_activity(session, fake, out.id, pause=Waits())
    monkeypatch.setattr(fake, "create_object", create)
    row = await row_of(session, out.id)
    assert (row.status, row.plan[SENDING]) == ("writing", "task:1")  # saved before the send
    assert {step["step"]: step["status"] for step in row.result["steps"]}["task:1"] == "failed"

    # Five minutes on, the next apply takes it over: task:1 was on its way, so it looks first.
    await five_minutes_on(session, out.id)
    taken = await apply_activity(session, fake, out.id, pause=Waits())

    steps = {step.step: step for step in taken.steps}
    assert taken.status == "done"
    assert (steps["task:1"].status, steps["task:1"].detail) == ("done", FOUND_DETAIL)
    subjects = sorted(task.properties["hs_task_subject"] or "" for task in fake.tasks.values())
    assert subjects == ["Call back about the lease", "Send the floor plan"]  # one of each
    assert fake.calls.count("create_tasks") == 3  # refused, task:2, the retry: never a fourth
    assert (await row_of(session, out.id)).plan[SENDING] is None


@db
async def test_a_takeover_with_nothing_on_its_way_marks_nothing(session: AsyncSession) -> None:
    fake = contour()
    out = await preview_activity(session, fake, a_request(fields=[]))
    # The backend stopped after the call's answer was saved, before task:1 was on its way.
    await left_writing(session, out.id, ago=timedelta(minutes=6), steps=[CALL_DONE])

    taken = await apply_activity(session, fake, out.id, pause=Waits())

    assert taken.status == "done"
    assert [(step.step, step.status) for step in taken.steps] == [
        ("call", "done"),
        ("task:1", "done"),
        ("task:2", "done"),
        ("note", "done"),
    ]
    assert not [name for name in fake.calls if name.startswith("search_")]  # nothing to look for
    assert writes_of(fake) == ["create_tasks", "create_tasks", "create_notes"]

    # The fields' change on its way is safe to send twice: it is sent again, not looked for.
    out = await preview_activity(
        session, fake, only(fields=a_request().fields, subject="call_note:2")
    )
    await left_writing(session, out.id, ago=timedelta(minutes=6), steps=[], sending="fields")
    fake.calls.clear()

    taken = await apply_activity(session, fake, out.id, pause=Waits())

    assert (taken.status, taken.steps[0].step, taken.steps[0].status) == ("done", "fields", "done")
    assert fake.calls.count("update_companies") == 1
    assert fake.companies[COMPANY].properties[LEASE] == "2028-03-31"


@db
async def test_a_row_saved_before_the_plan_kept_the_step_on_its_way_keeps_the_old_rule(
    session: AsyncSession,
) -> None:
    fake = contour()
    out = await preview_activity(session, fake, a_request(fields=[]))
    six = timedelta(minutes=6)
    await left_writing(session, out.id, ago=six, steps=[CALL_DONE], old_row=True)

    taken = await apply_activity(session, fake, out.id, pause=Waits())

    # The first step it didn't record may have been sent: it is looked for, never sent blind.
    steps = {step.step: step for step in taken.steps}
    assert (steps["task:1"].status, steps["task:1"].detail) == ("uncertain", LOOKED_UNSURE_DETAIL)
    assert fake.calls.count("search_tasks") == LOOKS
    assert fake.calls.count("create_tasks") == 1  # task:2 only


@db
async def test_each_writer_refuses_the_others_rows(session: AsyncSession) -> None:
    fake = contour()
    out = await preview_activity(session, fake, a_request())
    with pytest.raises(WriteNotFound):
        await apply_write(session, fake, out.id)
    lead = HubSpotWrite(app="lead_finder", subject="lead:1", status="previewed", plan=OLD_PLAN)
    session.add(lead)
    await session.commit()
    with pytest.raises(WriteNotFound):
        await apply_activity(session, fake, lead.id, pause=Waits())
    with pytest.raises(WriteNotFound):
        await resolve_step(session, lead.id, "note", landed=True)
    assert writes_of(fake) == []


@db
async def test_no_email_or_phone_reaches_a_log_line_or_an_error(
    session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, logger="core")
    fake = contour()
    fake.fail["create_calls"] = [TIMED_OUT]
    fake.fail["create_tasks"] = [REFUSED]
    email, phone = "jo.sample@samplelogistics.com.au", "0412 345 678"
    request = a_request(
        call=CallIn(at=AT, title="Call with Jo Sample", body=f"Call {phone} or {email}"),
        tasks=[TaskIn(subject=f"Email {email} the plan", due=date(2026, 11, 20))],
        note=NoteIn(body=f"Mobile {phone}"),
    )
    out = await preview_activity(session, fake, request)
    written = await apply_activity(session, fake, out.id, pause=Waits())

    assert written.status == "uncertain" and written.error
    shown = [written.error, *(step.detail or "" for step in written.steps)]
    # Each line's words and the fields our code adds (not the record's own times and ids).
    standard = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message"}
    lines = [
        f"{record.getMessage()} {[(k, v) for k, v in record.__dict__.items() if k not in standard]}"
        for record in caplog.records
        if record.name.startswith("core.")
    ]
    assert any("hubspot_activity_step" in line for line in lines)
    for text in [*shown, *lines]:
        for secret in (email, "@", phone, "0412"):
            assert secret not in text, text


# --- An old Lead Finder write still reads ------------------------------------------------------

# Stored by today's Lead Finder writer: no kind, no seen, no held.
OLD_PLAN: dict[str, Any] = {
    "action": "update",
    "company_id": "777",
    "company_name": "Acme Logistics",
    "company_url": "https://app.hubspot.com/contacts/1234567/record/0-2/777",
    "domain": "acme.com.au",
    "fields": [
        {
            "property": "city",
            "label": "City",
            "value": "Perth",
            "current": "Fremantle",
            "write": False,
            "reason": "HubSpot already has a value. It is kept.",
        }
    ],
    "note": "Trigger: lease ends June 2027.",
    "list_name": "AI suggested",
    "list_id": "9",
    "warnings": [],
}
OLD_RESULT: dict[str, Any] = {
    "steps": [
        {
            "step": "company",
            "status": "done",
            "detail": "Filled 0 empty fields.",
            "hubspot_id": "777",
        },
        {"step": "note", "status": "done", "detail": "Added the note.", "hubspot_id": "900000002"},
        {
            "step": "list",
            "status": "failed",
            "detail": "The HubSpot key is missing a permission.",
            "hubspot_id": None,
        },
    ]
}


@pytest.fixture
def app(session: AsyncSession) -> FastAPI:
    application = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_session] = test_session
    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test:
        yield test


@db
async def test_an_old_lead_finder_write_still_reads(
    session: AsyncSession, client: httpx.AsyncClient
) -> None:
    now = datetime.now(UTC)
    row = HubSpotWrite(
        app="lead_finder",
        subject="lead:1",
        status="partial",
        plan=OLD_PLAN,
        result=OLD_RESULT,
        hubspot_company_id="777",
        hubspot_url=OLD_PLAN["company_url"],
        created_at=now,
        applied_at=now,
        finished_at=now,
    )
    session.add(row)
    await session.commit()

    out = write_out(await row_of(session, row.id))
    assert (out.plan.kind, out.plan.contact_id, out.plan.call, out.plan.tasks) == (
        "company",
        None,
        None,
        [],
    )
    assert (out.plan.fields[0].seen, out.plan.fields[0].changed_since) == (None, False)
    assert [(step.step, step.held) for step in out.steps] == [
        ("company", []),
        ("note", []),
        ("list", []),
    ]

    log = (await client.get("/api/v1/hubspot/writes")).json()
    assert [entry["id"] for entry in log] == [str(row.id)]
    assert log[0]["plan"]["kind"] == "company" and log[0]["steps"][2]["status"] == "failed"
    WriteOut.model_validate(log[0])


@db
async def test_the_admins_apply_sends_an_activity_through_its_own_writer(
    session: AsyncSession, client: httpx.AsyncClient, app: FastAPI
) -> None:
    fake = contour()
    app.state.hubspot_provider = lambda: fake
    out = await preview_activity(session, fake, only(call=a_request().call))

    answer = await client.post(f"/api/v1/hubspot/writes/{out.id}/apply")

    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "done" and answer.json()["plan"]["kind"] == "activity"
    assert len(fake.call_log) == 1 and fake.calls.count("create_companies") == 0
    log = (await client.get("/api/v1/hubspot/writes")).json()
    assert [entry["steps"][0]["step"] for entry in log] == ["call"]


@db
async def test_only_an_admin_may_read_the_write_log_or_apply_a_write(
    world: World, browser: httpx.AsyncClient
) -> None:
    fake = contour()
    world.app.state.hubspot_provider = lambda: fake
    async with world.factory() as session:
        out = await preview_activity(session, fake, only(call=a_request().call))
    apply = f"{WRITES}/{out.id}/apply"
    async with world.browser() as stranger:  # no session: the guard answers
        assert (await stranger.get(WRITES)).status_code == 401
        assert (await stranger.post(apply)).status_code == 401

    await make_platform_admin(world)  # the Platform admin
    async with world.factory() as session:
        await admin.create_person(
            session,
            email="jo.sample@example.test",
            username="josample",
            name="Jo Sample",
            role="staff",
            apps=["companies"],
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
        await admin.create_person(
            session,
            email="ada.admin@example.test",
            username="adaadmin",
            name="Ada Admin",
            role="admin",
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
    assert (await sign_in(browser, login="josample")).status_code == 200
    for answer in (await browser.get(WRITES), await browser.post(apply)):
        assert answer.status_code == 403, answer.text
        assert answer.json()["code"] == "platform_admin_only"
    async with world.browser() as admin_browser:
        assert (await sign_in(admin_browser, login="adaadmin")).status_code == 200
        for answer in (await admin_browser.get(WRITES), await admin_browser.post(apply)):
            assert answer.status_code == 403 and answer.json()["code"] == "platform_admin_only"
    assert writes_of(fake) == []
    async with world.factory() as session:
        assert (await row_of(session, out.id)).status == "previewed"

    async with world.browser() as desk:
        assert (await sign_in(desk)).status_code == 200
        applied = await desk.post(apply)
        assert applied.status_code == 200, applied.text
        assert applied.json()["status"] == "done"
        log = await desk.get(WRITES)
    assert log.status_code == 200
    assert [entry["id"] for entry in log.json()] == [str(out.id)]
