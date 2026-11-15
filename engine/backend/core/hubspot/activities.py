"""Writing activities to HubSpot (PLAN-V17 T1-5): a call, field changes, follow-up tasks and a note,
on one company, each written once only. The note can also go on a meeting (T1-9, the pre-read's
copy): see 6.

It is the Lead Finder's writer (`writer.py`) for activities, built on the same parts, not copies:
the one open write per subject, the claim (two clicks can't both write), the step log,
`note_html`, `choice_code`, `refresh_copy` and the `core.hubspot_writes` table. A project asks
with an `ActivityRequest`. The rep's HubSpot owner id comes from `owner_of` (T1-4: the account's
link to a HubSpot owner, or None, and HubSpot then shows the call as unassigned).

1. **Preview** (`preview_activity`): one open write per subject, as `preview_write` does. It reads
   the company now and says, for each field, what HubSpot has and what would be written. Not
   written, with the reason: a field HubSpot doesn't have, a value its pick list doesn't offer
   (a pick list takes HubSpot's code), a date that isn't YYYY-MM-DD, a number that isn't one, and
   the value HubSpot has already. Any other value is written, even over one HubSpot has (choice
   4: the rep sees the old and the new value, and confirms). `changed_since` says HubSpot's value
   isn't what the rep saw (`seen`; None means the rep saw the field empty). The request is kept
   in the plan, so the write sends exactly what was previewed. It works while writing is off.
2. **Write** (`apply_activity`), after a person confirms: `call`, `fields`, `task:1`, `task:2`
   ..., `note`, `meeting`, in that order, each saved as it lands. A failed step never stops the
   others (each record is separate), and the write's status comes from all of them. Applying a
   partial or uncertain write again redoes only the steps that aren't done. The note is the
   rep's: it carries the owner, as the call and the tasks do.
   - The fields: the company is read again right before writing. A field is written only while
     HubSpot still has the value the preview showed and the rep saw. Otherwise it is held: not
     written, named in the step's `held`, and its plan entry shows HubSpot's value now. The
     rest go in one change. A change that timed out is checked by reading the company: a change
     sent twice can't double anything.
3. **Never twice.** A create that timed out may have landed, so it is never sent again blind.
   The writer looks for it 3 times over about 30 seconds (search lags): by the exact
   `hs_timestamp` it sent, the owner, and a call's title or a task's subject. Only a record
   linked to this write's company counts: every task due on one day has the same time, so the
   rep's task for another company could match. One found: done. None, or more than one:
   "uncertain", until a person says whether it is in HubSpot (`resolve_step`). Only "it isn't"
   makes it sendable again. A look HubSpot doesn't answer (the search or the links) isn't an
   answer: it looks again.
4. **A write cut off part way** stays "writing". Every save keeps its claim fresh, so one not
   kept for 5 minutes (TBC) has stopped (the backend stopped). The save right before a send
   names the step on its way (`sending` in the plan), and the save of its answer clears it. The
   next `apply_activity` or `resolve_step` takes the write over: the create that was on its way
   may be in HubSpot, so it is "uncertain" and the look-first rule applies to it, even when it
   had failed before (a retry). The fields and the meeting read HubSpot before they send, so
   they are just run again (`RUN_AGAIN`). A row saved before the plan kept `sending`: the first
   step it didn't record is "uncertain". An apply stopped by a cancel (the backend shutting
   down) or an error settles its write at once, the same way.
5. **Our copy at once:** a call that lands goes into `core.hubspot_calls`, and changed fields
   refresh the company and its offices, so "Last talk" and the company are right before the next
   sync. A failure there is logged and never fails the write. (A meeting's notes in our copy
   catch up at the next meetings refresh: the change moves the meeting's modified date.)
6. **The note on a meeting** (`meeting`, T1-9, choice 9): only for a request with a note and a
   `meeting_id`, and only while the switch `meeting_note_on_meeting` is on at the preview (off
   by default; the preview says what it will do). The note's text goes at the end of the
   meeting's `hs_internal_meeting_notes`, after an empty line. What is there is kept byte for
   byte (HubSpot keeps rich text), and no other field of the meeting is ever sent: never
   `hs_meeting_body` or the location, which the client sees. It reads the meeting first: notes
   that already hold the note's text (as plain text, spaces squeezed) are done, and nothing is
   sent, so running it again never adds it twice. A change that timed out is checked the same
   way: there is done; not there is failed, and sending it again is safe (it reads first). A
   switch turned off since the preview: skipped, and nothing is sent. A meeting not in HubSpot:
   failed, and the note on the company still counts. HubSpot doesn't document a note linked to
   a meeting, so the note itself is never linked to one.

Log lines hold ids, step names and states only: never a call's text, a field's value, an email
or a phone number.
"""

import asyncio
import contextlib
import copy
import logging
import re
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from types import MappingProxyType
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.hubspot.client import (
    Filter,
    HubSpot,
    HubSpotError,
    HubSpotNotFound,
    HubSpotObject,
    HubSpotRejected,
    HubSpotWritesOff,
    HubSpotWriteUncertain,
    Link,
    ObjectType,
    PropertyInfo,
)
from core.hubspot.mapping import DEFAULT_TIME_ZONE
from core.hubspot.models import HubSpotCall, HubSpotOwner, HubSpotWrite
from core.hubspot.owners import owner_id_of, shown_name
from core.hubspot.people import OUTCOMES, plain
from core.hubspot.writer import (
    OPEN,
    Claim,
    FieldChange,
    OnWritten,
    StepResult,
    WriteInProgress,
    WriteNotFound,
    WriteOut,
    WritePlan,
    WriteStatus,
    choice_code,
    claim_write,
    error_of,
    failed_step,
    get_write,
    is_activity,
    latest_write,
    note_html,
    refresh_copy,
    save_preview,
    status_of,
    steps_json,
    steps_of,
    take_over_write,
    write_out,
)

log = logging.getLogger(__name__)

Direction = Literal["outbound", "inbound"]
TaskKind = Literal["call", "email", "todo"]
TaskPriority = Literal["low", "medium", "high"]
FieldKind = Literal["choice", "date", "number", "text"]
Pause = Callable[[float], Awaitable[None]]

# HubSpot's six standard call outcomes, by name (people.py has their ids).
OUTCOME_NAMES: tuple[str, ...] = tuple(OUTCOMES.values())
OUTCOME_IDS: Mapping[str, str] = MappingProxyType({name: key for key, name in OUTCOMES.items()})
BODY_MAX_CHARS = 60_000  # HubSpot's limit for a call or note body is 65,536

STALLED_AFTER = timedelta(minutes=5)  # TBC: a "writing" write not kept this long has stopped
# The plan's key for the step that may be on its way to HubSpot: its name from the save right
# before the send until the save of its answer, else None. Every activity row has it from its
# preview on, so a row without it was saved before the writer kept it.
SENDING = "sending"
MEETING = "meeting"  # the step that adds the note to the meeting's internal notes (T1-9)
MEETING_NOTES = "hs_internal_meeting_notes"  # the only field of a meeting ever read or sent
# The plan's key for whether the note also goes on the meeting (the `meeting` step): decided at
# the preview, from the request and the switch (`meeting_note_on_meeting`) then.
ON_MEETING = "on_meeting"
# Between what a meeting's internal notes hold and the note added after them: an empty line
# (how HubSpot shows it is TBC, M2's test on a made-up meeting).
MEETING_BREAK = "<p><br></p>"
# Steps that read HubSpot before they send, so a write taken over just runs them again: a field
# change sent twice can't double anything, and the meeting step adds the note only when the
# meeting doesn't hold it yet.
RUN_AGAIN = frozenset({"fields", MEETING})
LOOKS = 3  # a create that timed out is looked for this many times,
LOOK_GAP_SECONDS = 15.0  # this far apart: about 30 seconds in all, as HubSpot's search lags
SETTLE_SECONDS = 5.0  # the most a cut-off apply waits to settle its write
TASK_DUE_TIME = time(9, 0)  # TBC: a task is due at 9:00 am on its day, Contour's time
CONTOUR_ZONE = ZoneInfo(DEFAULT_TIME_ZONE)
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
KIND_WORDS: Mapping[str, str] = MappingProxyType(
    {"call": "a call", "email": "an email", "todo": "a to-do"}
)

# What a person reads (PLAN-V15 "Words for errors"): the plan, the steps and the errors.
NOT_IN_HUBSPOT_TITLE = "Not in HubSpot"
NOT_IN_HUBSPOT_DETAIL = "This company isn't in HubSpot. It may have been merged or deleted there."
NOT_HUBSPOT_IDS_TITLE = "HubSpot didn't accept the request"
NOT_HUBSPOT_IDS_DETAIL = "The person or the deal isn't one of HubSpot's records."
COMPANY_GONE_DETAIL = "The company is no longer in HubSpot."
NO_FIELD_DETAIL = "HubSpot has no such field."
NOT_A_CHOICE_DETAIL = "Not one of HubSpot's choices for this field."
NOT_A_DATE_DETAIL = "Not a date HubSpot takes. Use a date like 2028-03-31."
NOT_A_NUMBER_DETAIL = "Not a number HubSpot takes."
EMPTY_DETAIL = "An empty value would clear the field, so it isn't sent."
TWICE_DETAIL = "This field is changed twice here. Only the first change is sent."
ALREADY_DETAIL = "HubSpot already has this value."
HELD_DETAIL = (
    "Changed in HubSpot since the preview, so it wasn't written. Check it, then send it again."
)
NOTHING_DETAIL = "Nothing to change in HubSpot."
PATCH_UNSURE_DETAIL = "HubSpot didn't answer, and the change isn't there. Send it again."
LOOKED_UNSURE_DETAIL = "HubSpot may or may not have saved it. Check HubSpot, then tell us."
FOUND_DETAIL = "HubSpot didn't answer in time, but it has it. It was not sent again."
STOPPED_DETAIL = "Contour stopped while sending this. HubSpot may or may not have it."
LANDED_DETAIL = "A person checked: it is in HubSpot."
NOT_LANDED_DETAIL = "A person checked: it isn't in HubSpot. Send it again."
NO_OWNER_DETAIL = "No HubSpot owner is linked to this account, so HubSpot shows it as unassigned."
NOT_A_MEETING_DETAIL = "The meeting isn't one of HubSpot's records."
MEETING_PLAN_DETAIL = (
    "Also adds the note to the end of the meeting's internal notes, and keeps what is there. "
    "HubSpot leaves these notes out of the client's invite."
)
MEETING_DONE_DETAIL = "Added the note to the end of the meeting's internal notes."
MEETING_THERE_DETAIL = (
    "The meeting's internal notes already have this note, so it wasn't added again."
)
MEETING_OFF_DETAIL = (
    "Not added to the meeting: adding notes to meetings was switched off after the preview."
)
MEETING_GONE_DETAIL = (
    "This meeting isn't in HubSpot, so the note wasn't added to it. It may have been deleted there."
)
MEETING_UNREAD_DETAIL = (
    "HubSpot didn't answer. Send it again: the meeting is read first, so the note is never added "
    "twice."
)
MEETING_EMPTY_DETAIL = "The note has no text to add to the meeting."
UNNAMED = "This company"


class CallIn(BaseModel):
    """The call itself."""

    model_config = ConfigDict(frozen=True)

    at: datetime = Field(description="When the call was (HubSpot's hs_timestamp)")
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(max_length=BODY_MAX_CHARS, description="Plain text")
    outcome: str | None = Field(None, description="One of HubSpot's outcome names, or none")
    direction: Direction = "outbound"

    @field_validator("outcome")
    @classmethod
    def _known_outcome(cls, value: str | None) -> str | None:
        if value is not None and value not in OUTCOME_NAMES:
            raise ValueError(f"outcome must be one of: {', '.join(OUTCOME_NAMES)}")
        return value


class TaskIn(BaseModel):
    """A follow-up task."""

    model_config = ConfigDict(frozen=True)

    subject: str = Field(min_length=1, max_length=300)
    body: str = Field("", max_length=BODY_MAX_CHARS, description="Plain text")
    due: date = Field(description="The day it is due (HubSpot's hs_timestamp)")
    kind: TaskKind = "todo"
    priority: TaskPriority = "medium"
    owner_id: str | None = Field(None, description="Who it is for. None: the rep")


class FieldSet(BaseModel):
    """One company field to change. The writer reads the company again first: when HubSpot's
    value is no longer `seen`, the field is not written."""

    model_config = ConfigDict(frozen=True)

    property: str = Field(min_length=1, max_length=200, description="HubSpot's field name")
    label: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1, max_length=2_000, description="Never empty: that clears")
    seen: str | None = Field(None, description="The value the rep saw, or none")


class NoteIn(BaseModel):
    """A note on the company (and the deal, if there is one)."""

    model_config = ConfigDict(frozen=True)

    body: str = Field(min_length=1, max_length=BODY_MAX_CHARS, description="Plain text")


class ActivityRequest(BaseModel):
    """What one project asks to write on one company."""

    model_config = ConfigDict(frozen=True)

    app: str = Field(min_length=1, max_length=64)
    subject: str = Field(min_length=1, max_length=120, description="Like call_note:<id>")
    company_id: str = Field(min_length=1, max_length=64, description="The company in HubSpot")
    contact_id: str | None = None
    deal_id: str | None = None
    owner_id: str | None = Field(None, description="The rep's HubSpot owner id")
    call: CallIn | None = None
    tasks: list[TaskIn] = Field(default_factory=list, max_length=10)
    fields: list[FieldSet] = Field(default_factory=list, max_length=20)
    note: NoteIn | None = None
    meeting_id: str | None = Field(
        None,
        max_length=64,
        description=(
            "The HubSpot meeting the note is about. While the switch is on, the note also goes "
            "at the end of its internal notes. It never links the note to the meeting"
        ),
    )

    @model_validator(mode="after")
    def _something_to_write(self) -> "ActivityRequest":
        if self.call is None and not self.tasks and not self.fields and self.note is None:
            raise ValueError("an activity needs a call, a task, a field or a note")
        return self

    @model_validator(mode="after")
    def _a_meeting_needs_a_note(self) -> "ActivityRequest":
        """Only a note goes on a meeting, so a meeting with no note is the caller's mistake:
        dropping it quietly would hide that nothing reached the meeting."""
        if self.meeting_id is not None and self.note is None:
            raise ValueError("a meeting_id needs a note: only the note is added to a meeting")
        return self


class StepNotUncertain(Exception):
    """`resolve_step` was asked about a step that isn't uncertain: HubSpot answered it clearly,
    or the write has no such step. Only an uncertain step needs a person's word."""

    def __init__(self, step: str) -> None:
        super().__init__(f"{step[:40]} isn't a step HubSpot may or may not have")
        self.step = step


def planned_steps(request: ActivityRequest, *, on_meeting: bool = False) -> list[str]:
    """The steps a request makes, in the order they are written. `on_meeting`: the switch that
    adds the note to the meeting was on at the preview (the plan keeps it as `ON_MEETING`)."""
    names = ["call"] if request.call is not None else []
    names += ["fields"] if request.fields else []
    names += [f"task:{number}" for number in range(1, len(request.tasks) + 1)]
    names += ["note"] if request.note is not None else []
    if on_meeting and request.note is not None and request.meeting_id is not None:
        names.append(MEETING)
    return names


def activity_status(planned: Sequence[str], steps: Mapping[str, StepResult]) -> WriteStatus:
    """A write's status from its steps, as `status_of` says, with two more rules: a planned step
    with no result yet isn't finished, and a write whose every step had nothing to send (or held
    its fields) is done."""
    results = [steps[name] for name in planned if name in steps]
    status = status_of(results)
    missing = len(results) < len(planned)
    if missing and status == "done":
        return "partial"
    if not missing and results and all(step.status == "skipped" for step in results):
        return "done"
    return status


# --- Preview ---------------------------------------------------------------------------------


async def preview_activity(
    session: AsyncSession, hubspot: HubSpot, request: ActivityRequest
) -> WriteOut:
    """What would be written, with HubSpot's value now for each field. Saved as "previewed";
    nothing is written, and it works while writing is off. A subject already done, being
    written, part written or uncertain gets that write back unchanged. Whether the note also
    goes on the meeting is decided here, from the switch now (the plan's `meeting` says so).

    Raises `HubSpotNotFound` (plain words) when the company isn't in HubSpot, `HubSpotRejected`
    for a person, deal or meeting id that isn't HubSpot's, and any other `HubSpotError` from
    reading the company."""
    _check_ids(request)
    existing = await latest_write(session, request.app, request.subject)
    if existing is not None and existing.status not in OPEN:
        return write_out(existing)
    existing_id = existing.id if existing is not None else None
    owners = await _owner_names(
        session, [request.owner_id, *(task.owner_id for task in request.tasks)]
    )
    await session.commit()  # no database connection is held while HubSpot answers

    definitions = (
        {item.name: item for item in await hubspot.properties("companies")}
        if request.fields
        else {}
    )
    asked = ["name", "domain", *(f.property for f in request.fields if f.property in definitions)]
    found = await hubspot.get_object(
        "companies", request.company_id, properties=list(dict.fromkeys(asked))
    )
    if found is None:
        raise HubSpotNotFound(NOT_IN_HUBSPOT_TITLE, NOT_IN_HUBSPOT_DETAIL)

    changes: list[FieldChange] = []
    kinds: dict[str, FieldKind] = {}
    for item in request.fields:
        info = definitions.get(item.property)
        if any(earlier.property == item.property for earlier in changes):
            change = FieldChange(
                property=item.property,
                label=item.label,
                value=item.value.strip(),
                write=False,
                reason=TWICE_DETAIL,
            )
        else:
            change = _field_change(item, info, found)
        changes.append(change)
        if info is not None:
            kinds[item.property] = _kind(info)

    unassigned = request.owner_id is None and (request.call is not None or bool(request.tasks))
    on_meeting = MEETING in planned_steps(
        request, on_meeting=get_settings().meeting_note_on_meeting
    )
    plan = WritePlan(
        kind="activity",
        action="update",
        company_id=found.id,
        company_name=found.text("name") or UNNAMED,
        company_url=found.url,
        domain=found.text("domain"),
        fields=changes,
        note=request.note.body if request.note is not None else None,
        list_name=None,
        list_id=None,
        warnings=[NO_OWNER_DETAIL] if unassigned else [],
        contact_id=request.contact_id,
        deal_id=request.deal_id,
        owner_id=request.owner_id,
        call=_call_words(request.call) if request.call is not None else None,
        tasks=[_task_words(task, owners, request.owner_id) for task in request.tasks],
        meeting_id=request.meeting_id,
        meeting=MEETING_PLAN_DETAIL if on_meeting else None,
    )
    # The request rides along in the plan (WritePlan doesn't read it), so the write sends exactly
    # what was previewed, with each field's kind for comparing values, and whether the note goes
    # on the meeting. Nothing is on its way yet.
    saved = plan.model_dump(mode="json") | {
        "request": request.model_dump(mode="json"),
        "kinds": kinds,
        ON_MEETING: on_meeting,
        SENDING: None,
    }
    row = await save_preview(
        session,
        existing_id,
        app=request.app,
        subject=request.subject,
        plan=saved,
        company_id=found.id,
        url=found.url,
    )
    return write_out(row)


def _check_ids(request: ActivityRequest) -> None:
    """HubSpot's record ids are digits. The client refuses any other id before sending, so a
    request with one is answered in plain words here instead."""
    if not _digits(request.company_id):
        raise HubSpotNotFound(NOT_IN_HUBSPOT_TITLE, NOT_IN_HUBSPOT_DETAIL)
    for other in (request.contact_id, request.deal_id):
        if other is not None and not _digits(other):
            raise HubSpotRejected(NOT_HUBSPOT_IDS_TITLE, NOT_HUBSPOT_IDS_DETAIL)
    if request.meeting_id is not None and not _digits(request.meeting_id):
        raise HubSpotRejected(NOT_HUBSPOT_IDS_TITLE, NOT_A_MEETING_DETAIL)


def _digits(value: str) -> bool:
    text = value.strip()
    return text.isascii() and text.isdigit()


def _field_change(item: FieldSet, info: PropertyInfo | None, found: HubSpotObject) -> FieldChange:
    """What one field change would do, from HubSpot's field definition and its value now."""
    value = item.value.strip()
    seen = (item.seen or "").strip() or None
    if info is None:
        return FieldChange(
            property=item.property,
            label=item.label,
            value=value,
            write=False,
            reason=NO_FIELD_DETAIL,
            seen=seen,
        )
    kind = _kind(info)
    current = found.text(item.property)
    problem: str | None = None
    if kind == "choice":
        code = choice_code(info, value) if value else None
        if code is None:
            problem = NOT_A_CHOICE_DETAIL if value else EMPTY_DETAIL
        else:
            value = code
        if seen is not None:
            seen = choice_code(info, seen) or seen  # what the rep saw, as HubSpot's code
    else:
        problem = _value_problem(kind, value)
    if problem is None and _same(kind, value, current):
        problem = ALREADY_DETAIL
    return FieldChange(
        property=item.property,
        label=item.label,
        value=value,
        current=current,
        write=problem is None,
        reason=problem,
        seen=seen,
        changed_since=not _same(kind, seen, current),
    )


def _kind(info: PropertyInfo) -> FieldKind:
    if info.choices:
        return "choice"
    if info.type == "date":
        return "date"
    if info.type == "number":
        return "number"
    return "text"


def _value_problem(kind: FieldKind, value: str) -> str | None:
    """Why HubSpot can't take this value, checked by code (never guessed), or None."""
    if not value:
        return EMPTY_DETAIL
    if kind == "date" and not (DAY.fullmatch(value) and _day(value) is not None):
        return NOT_A_DATE_DETAIL
    if kind == "number" and _number(value) is None:
        return NOT_A_NUMBER_DETAIL
    return None


def _same(kind: str, first: str | None, second: str | None) -> bool:
    """Whether two of a field's values are the same: as days, numbers or HubSpot's codes. An
    empty value is only the same as another empty one."""
    a, b = (first or "").strip(), (second or "").strip()
    if not a or not b:
        return a == b
    if kind == "date":
        day_a, day_b = _day(a), _day(b)
        if day_a is not None and day_b is not None:
            return day_a == day_b
    elif kind == "number":
        number_a, number_b = _number(a), _number(b)
        if number_a is not None and number_b is not None:
            return number_a == number_b
    return a == b


def _day(text: str) -> date | None:
    """A day from HubSpot's forms: YYYY-MM-DD, an ISO time, or milliseconds (UTC midnight)."""
    value = text.strip()
    try:
        if DAY.fullmatch(value):
            return date.fromisoformat(value)
        if value.isascii() and value.isdigit():
            return datetime.fromtimestamp(int(value) / 1000, tz=UTC).date()
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    return _utc(moment).date()


def _number(text: str) -> Decimal | None:
    value = text.strip()
    if not NUMBER.fullmatch(value):
        return None
    try:
        return Decimal(value)
    except InvalidOperation:  # pragma: no cover - the pattern lets only numbers through
        return None


async def _owner_names(session: AsyncSession, ids: Iterable[str | None]) -> dict[str, str | None]:
    """Owner id -> name, from our copy of HubSpot's owners."""
    wanted = {owner for owner in ids if owner}
    if not wanted:
        return {}
    rows = await session.execute(
        select(HubSpotOwner.owner_id, HubSpotOwner.name).where(HubSpotOwner.owner_id.in_(wanted))
    )
    return {owner_id: name for owner_id, name in rows.all()}


def _utc(moment: datetime) -> datetime:
    """A time in UTC. A time with no zone is taken as UTC."""
    return moment.astimezone(UTC) if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _ms(moment: datetime) -> str:
    """HubSpot's form of a time: milliseconds since 1970, as text. Exact, with no float."""
    return str((_utc(moment) - EPOCH) // timedelta(milliseconds=1))


def _due_at(day: date) -> datetime:
    return datetime.combine(day, TASK_DUE_TIME, tzinfo=CONTOUR_ZONE)


def _day_words(day: date) -> str:
    return f"{WEEKDAYS[day.weekday()]} {day.day} {MONTHS[day.month - 1]} {day.year}"


def _time_words(moment: datetime) -> str:
    """Like "16 Nov 2026, 9:30 am", in Contour's time."""
    local = _utc(moment).astimezone(CONTOUR_ZONE)
    hour = local.hour % 12 or 12
    half = "am" if local.hour < 12 else "pm"
    return f"{local.day} {MONTHS[local.month - 1]} {local.year}, {hour}:{local.minute:02d} {half}"


def _call_words(call: CallIn) -> str:
    """The call in words: its title, outcome and time."""
    parts = [call.title.strip().rstrip(".")]
    if call.direction == "inbound":
        parts.append("They called")
    if call.outcome:
        parts.append(call.outcome)
    parts.append(_time_words(call.at))
    return ". ".join(parts) + "."


def _task_words(task: TaskIn, owners: Mapping[str, str | None], rep: str | None) -> str:
    """A task in words: what, when it is due, and for whom."""
    owner = task.owner_id or rep
    whom = "no one yet (unassigned)"
    if owner is not None:
        whom = shown_name(owner, owners.get(owner))
    return (
        f"{task.subject.strip().rstrip('.')}: {KIND_WORDS[task.kind]}, {task.priority} priority, "
        f"due {_day_words(task.due)}, for {whom}."
    )


# --- Write -----------------------------------------------------------------------------------


@dataclass
class _Run:
    """One write being written (or answered by a person): its request, its plan as saved (a
    held field changes it), each step's result, and the claim that lets it save."""

    write_id: uuid.UUID
    request: ActivityRequest
    plan: dict[str, Any]
    steps: dict[str, StepResult]
    url: str | None
    claim: Claim | None = None
    # The step whose create or change may be on its way to HubSpot. Each save keeps it in the
    # plan (`SENDING`), so a takeover knows it too.
    sending: str | None = None

    @classmethod
    def of(cls, row: HubSpotWrite) -> "_Run":
        plan = copy.deepcopy(row.plan or {})
        return cls(
            write_id=row.id,
            request=ActivityRequest.model_validate(plan.get("request") or {}),
            plan=plan,
            steps={step.step: step for step in steps_of(row)},
            url=row.hubspot_url,
        )

    @property
    def company_id(self) -> str:
        found = self.plan.get("company_id")
        return found if isinstance(found, str) and found else self.request.company_id

    @property
    def planned(self) -> list[str]:
        return planned_steps(self.request, on_meeting=self.plan.get(ON_MEETING) is True)

    def ordered(self) -> list[StepResult]:
        planned = self.planned
        known = [self.steps[name] for name in planned if name in self.steps]
        return known + [step for name, step in self.steps.items() if name not in planned]

    async def prepare(self, session: AsyncSession, *, taken_over: bool) -> None:
        """Before any step: the note's time is fixed, so a note that timed out can be looked for
        by it; and a write taken over marks the create its stopped apply may have sent as
        uncertain (`stopped_step`)."""
        if self.request.note is not None and not self.plan.get("note_at"):
            self.plan["note_at"] = _ms(datetime.now(UTC))
        if taken_over:
            stopped = self.stopped_step()
            if stopped is not None:
                self.steps[stopped] = StepResult(
                    step=stopped, status="uncertain", detail=STOPPED_DETAIL
                )
            log.warning(
                "hubspot_activity_taken_over",
                extra={"write_id": str(self.write_id), "step": stopped},
            )
        await self.save(session)

    def stopped_step(self) -> str | None:
        """A write taken over: the step its stopped apply may have sent, or None. That is the
        create the plan names as on its way (`SENDING`), unless it is done: even one that failed
        before may have landed this time. The fields and the meeting read HubSpot before they
        send, so they are just run again (`RUN_AGAIN`), and None means nothing was on its way.
        A row saved before the plan kept `SENDING`: the first planned step with no result, as
        before."""
        if SENDING not in self.plan:
            return next((name for name in self.planned if name not in self.steps), None)
        name = self.plan[SENDING]
        if not isinstance(name, str) or name in RUN_AGAIN or name not in self.planned:
            return None
        before = self.steps.get(name)
        if before is not None and before.status in ("done", "skipped"):
            return None
        return name

    async def save(self, session: AsyncSession, **final: Any) -> None:
        """Saves the step log, the plan (with the step on its way, if any) and the link, and
        keeps the claim. Raises `WriteInProgress` when another apply took the write over."""
        if self.claim is None:
            raise WriteInProgress(str(self.write_id))
        values = {
            "result": steps_json(self.ordered()),
            "plan": {**self.plan, SENDING: self.sending},
            "hubspot_url": self.url,
            **final,
        }
        await self.claim.save(session, values)

    async def finish(self, session: AsyncSession) -> WriteStatus:
        status = activity_status(self.planned, self.steps)
        await self.save(
            session, status=status, error=error_of(self.ordered()), finished_at=datetime.now(UTC)
        )
        return status


@dataclass(frozen=True)
class _Create:
    """One record to make: what is sent, and how to find it again if HubSpot doesn't answer."""

    kind: ObjectType
    properties: dict[str, str]
    links: list[Link]
    filters: list[Filter]
    done: str


async def apply_activity(
    session: AsyncSession,
    hubspot: HubSpot,
    write_id: uuid.UUID,
    *,
    on_written: OnWritten | None = None,
    pause: Pause = asyncio.sleep,
) -> WriteOut:
    """Writes a previewed activity, step by step (`call`, `fields`, `task:1` ..., `note`,
    `meeting`), each step saved as it lands. A finished write is returned as it is. Raises
    `WriteInProgress` while it is being written (unless that stopped 5 minutes ago: then it is
    taken over), and `HubSpotWritesOff` while writing is off, before anything is claimed.
    `pause` waits between the looks for a create that timed out (tests give one that doesn't
    wait). `on_written` runs when the write is done."""
    row = await get_write(session, write_id)
    if not is_activity(row):  # a Lead Finder write: `writer.apply_write` writes it
        raise WriteNotFound(str(write_id))
    if row.status == "done":
        return write_out(row)
    taken_over = row.status == "writing"
    if taken_over and not _stalled(row):
        raise WriteInProgress(str(write_id))
    if not getattr(hubspot, "writes_allowed", False):
        raise HubSpotWritesOff
    _Run.of(row)  # a plan that can't be read stops here, before anything is claimed
    run = await _claim(session, row, taken_over=taken_over)
    try:
        await run.prepare(session, taken_over=taken_over)
        await _write_steps(session, hubspot, run, pause)
        status = await run.finish(session)
    except (Exception, asyncio.CancelledError):
        await _settle(session, run)
        raise
    out = await _out(session, write_id)
    if on_written is not None and status == "done":
        await on_written(session, out)
    return out


async def resolve_step(
    session: AsyncSession, write_id: uuid.UUID, step: str, landed: bool
) -> WriteOut:
    """A person says whether an uncertain step is in HubSpot. `landed`: it is done. Not landed:
    it failed, so the next apply sends it again. The write's status is worked out again and
    saved. HubSpot is never called.

    Raises `StepNotUncertain` for a step that isn't uncertain, `WriteInProgress` while the write
    is being written (one that stopped 5 minutes ago is taken over first), and `WriteNotFound`."""
    row = await get_write(session, write_id)
    if not is_activity(row):
        raise WriteNotFound(str(write_id))
    taken_over = row.status == "writing"
    if taken_over and not _stalled(row):
        raise WriteInProgress(str(write_id))
    if not taken_over:
        before = next((item for item in steps_of(row) if item.step == step), None)
        if row.status != "uncertain" or before is None or before.status != "uncertain":
            raise StepNotUncertain(step)
    _Run.of(row)
    run = await _claim(session, row, taken_over=taken_over)
    answered = False
    try:
        await run.prepare(session, taken_over=taken_over)
        target = run.steps.get(step)
        if target is not None and target.status == "uncertain":
            run.steps[step] = (
                StepResult(
                    step=step, status="done", detail=LANDED_DETAIL, hubspot_id=target.hubspot_id
                )
                if landed
                else StepResult(step=step, status="failed", detail=NOT_LANDED_DETAIL)
            )
            answered = True
        await run.finish(session)
    except (Exception, asyncio.CancelledError):
        await _settle(session, run)
        raise
    log.info(
        "hubspot_activity_resolved",
        extra={"write_id": str(write_id), "step": step[:40], "landed": landed, "done": answered},
    )
    if not answered:  # a write taken over is settled all the same
        raise StepNotUncertain(step)
    return await _out(session, write_id)


async def owner_of(session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
    """The rep's HubSpot owner id (PLAN-V17 T1-4), or None: sign-in is off (no user), or the
    account has no owner linked. With None, HubSpot shows the call as unassigned."""
    if user_id is None:
        return None
    return await owner_id_of(session, user_id)


def _stalled(row: HubSpotWrite) -> bool:
    """A "writing" write whose claim hasn't been kept for STALLED_AFTER: its apply stopped."""
    kept = row.applied_at or row.created_at
    return kept < datetime.now(UTC) - STALLED_AFTER


async def _claim(session: AsyncSession, row: HubSpotWrite, *, taken_over: bool) -> _Run:
    if taken_over:
        stalled_before = datetime.now(UTC) - STALLED_AFTER
        claimed = await take_over_write(session, row, stalled_before=stalled_before)
    else:
        claimed = await claim_write(session, row)
    run = _Run.of(claimed)
    run.claim = Claim.of(claimed)
    return run


async def _out(session: AsyncSession, write_id: uuid.UUID) -> WriteOut:
    row = await session.get(HubSpotWrite, write_id, populate_existing=True)
    if row is None:  # pragma: no cover - a write is never removed
        raise WriteNotFound(str(write_id))
    return write_out(row)


async def _write_steps(session: AsyncSession, hubspot: HubSpot, run: _Run, pause: Pause) -> None:
    """Each planned step that isn't done, in order. A step's failure never stops the next."""
    for name in run.planned:
        before = run.steps.get(name)
        if before is not None and before.status in ("done", "skipped"):
            continue
        record: HubSpotObject | None = None
        if name == "fields":
            result = await _fields_step(session, hubspot, run)
        elif name == MEETING:
            result = await _meeting_step(session, hubspot, run)
        else:
            result, record = await _create_step(session, hubspot, run, name, before, pause)
        run.steps[name] = result
        run.sending = None
        if name == "call" and record is not None and record.url:
            run.url = record.url  # "Open in HubSpot" opens the call from now on
        await run.save(session)
        log.info(
            "hubspot_activity_step",
            extra={"write_id": str(run.write_id), "step": name, "status": result.status},
        )
        if result.status != "done":
            continue
        if name == "call" and record is not None:
            await _save_call_copy(session, run, record)
        elif name == "fields":
            await refresh_copy(session, hubspot, run.company_id)


async def _create_step(
    session: AsyncSession,
    hubspot: HubSpot,
    run: _Run,
    name: str,
    before: StepResult | None,
    pause: Pause,
) -> tuple[StepResult, HubSpotObject | None]:
    """Makes the call, a task or the note. One that may have landed before is looked for and
    never sent again."""
    create = _create_of(run, name)
    if before is not None and before.status == "uncertain":
        return await _look(session, hubspot, run, name, create, pause)
    run.sending = name
    await run.save(session)  # still this apply's: nothing is sent once another holds the write
    try:
        made = await hubspot.create_object(create.kind, create.properties, links=create.links)
    except HubSpotWriteUncertain:
        return await _look(session, hubspot, run, name, create, pause)
    except HubSpotError as error:
        return failed_step(name, error), None
    except ValueError:  # the client refused a link before sending: an id that isn't HubSpot's
        return StepResult(step=name, status="failed", detail=NOT_HUBSPOT_IDS_DETAIL), None
    return StepResult(step=name, status="done", detail=create.done, hubspot_id=made.id), made


def _create_of(run: _Run, name: str) -> _Create:
    """The record a step makes, as HubSpot's API wants it (PLAN-V17 "HubSpot's API, checked")."""
    request = run.request
    company = run.company_id
    if name == "call" and request.call is not None:
        call = request.call
        at = _ms(call.at)
        properties = {
            "hs_timestamp": at,
            "hs_call_title": call.title,
            "hs_call_direction": call.direction.upper(),
            "hs_call_status": "COMPLETED",
        }
        _put(properties, "hs_call_body", note_html(call.body))
        if call.outcome is not None:
            properties["hs_call_disposition"] = OUTCOME_IDS[call.outcome]
        _put(properties, "hubspot_owner_id", request.owner_id)
        links = _links(request, company, person=True)
        # The title too: with no owner known, the time alone could match another rep's call.
        filters = [*_found_by(at, request.owner_id), Filter("hs_call_title", "EQ", call.title)]
        return _Create("calls", properties, links, filters, "Logged the call.")
    if name.startswith("task:"):
        task = request.tasks[int(name.removeprefix("task:")) - 1]
        owner = task.owner_id or request.owner_id
        at = _ms(_due_at(task.due))
        properties = {
            "hs_timestamp": at,
            "hs_task_subject": task.subject,
            "hs_task_status": "NOT_STARTED",
            "hs_task_priority": task.priority.upper(),
            "hs_task_type": task.kind.upper(),
        }
        _put(properties, "hs_task_body", note_html(task.body))
        _put(properties, "hubspot_owner_id", owner)
        filters = [*_found_by(at, owner), Filter("hs_task_subject", "EQ", task.subject)]
        links = _links(request, company, person=True)
        return _Create("tasks", properties, links, filters, "Added the task.")
    if name == "note" and request.note is not None:
        at = str(run.plan.get("note_at") or _ms(datetime.now(UTC)))
        properties = {"hs_timestamp": at, "hs_note_body": note_html(request.note.body)}
        _put(properties, "hubspot_owner_id", request.owner_id)  # the rep's note (T1-9)
        links = _links(request, company, person=False)
        filters = _found_by(at, request.owner_id)
        return _Create("notes", properties, links, filters, "Added the note.")
    raise ValueError(f"this write has no step {name[:40]!r}")


def _put(properties: dict[str, str], name: str, value: str | None) -> None:
    """Adds a value that isn't empty: an empty text clears a field in HubSpot."""
    if value and value.strip():
        properties[name] = value


def _links(request: ActivityRequest, company: str, *, person: bool) -> list[Link]:
    """The company, the person (a call or a task) and the deal, when there is one."""
    links = [Link("companies", company)]
    if person and request.contact_id:
        links.append(Link("contacts", request.contact_id))
    if request.deal_id:
        links.append(Link("deals", request.deal_id))
    return links


def _found_by(at: str, owner: str | None) -> list[Filter]:
    found = [Filter("hs_timestamp", "EQ", at)]
    if owner:
        found.append(Filter("hubspot_owner_id", "EQ", owner))
    return found


async def _look(
    session: AsyncSession,
    hubspot: HubSpot,
    run: _Run,
    name: str,
    create: _Create,
    pause: Pause,
) -> tuple[StepResult, HubSpotObject | None]:
    """A create that may have landed is looked for, LOOKS times, LOOK_GAP_SECONDS apart, and
    never sent. Exactly one found: done, with its id. None, or more than one: uncertain. A look
    HubSpot doesn't answer (the search or the links) counts as no answer: it looks again."""
    taken = {step.hubspot_id for other, step in run.steps.items() if other != name}
    found: list[HubSpotObject] = []
    for attempt in range(LOOKS):
        if attempt:
            await pause(LOOK_GAP_SECONDS)
            await run.save(session)  # keeps the claim while it waits
        try:
            found = await _ours(hubspot, create, run.company_id, taken)
        except HubSpotError:
            continue  # HubSpot didn't answer this time: look again
        if found:
            break
    if len(found) == 1:
        record = found[0]
        return StepResult(
            step=name, status="done", detail=FOUND_DETAIL, hubspot_id=record.id
        ), record
    detail = LOOKED_UNSURE_DETAIL
    if found:
        detail = f"HubSpot has {len(found)} that match it. Check HubSpot, then tell us."
    return StepResult(step=name, status="uncertain", detail=detail), None


async def _ours(
    hubspot: HubSpot, create: _Create, company_id: str, taken: set[str | None]
) -> list[HubSpotObject]:
    """The records that match what a create sent, aren't another step's, and are linked to this
    write's company: every task due on one day has the same time, so the rep's task for another
    company can match the rest. Raises `HubSpotError` when HubSpot doesn't answer the search or
    the read of the links."""
    page = await hubspot.search_objects(
        create.kind, filters=create.filters, properties=["hs_timestamp"], limit=10
    )
    found = [record for record in page.results if record.id not in taken]
    if not found:
        return []
    links = await hubspot.linked(create.kind, "companies", [record.id for record in found])
    return [
        record
        for record in found
        if any(link.id == company_id for link in links.get(record.id, ()))
    ]


async def _fields_step(session: AsyncSession, hubspot: HubSpot, run: _Run) -> StepResult:
    """The field changes, in one change to the company. Each is checked against HubSpot right
    before: one HubSpot changed since the preview (or the rep saw otherwise) is held."""
    changes = [FieldChange.model_validate(item) for item in run.plan.get("fields") or []]
    wanted = [change for change in changes if change.write and change.value.strip()]
    if not wanted:
        return StepResult(step="fields", status="skipped", detail=NOTHING_DETAIL)
    kinds: Mapping[str, Any] = run.plan.get("kinds") or {}
    try:
        found = await hubspot.get_object(
            "companies", run.company_id, properties=[change.property for change in wanted]
        )
    except HubSpotError as error:
        return failed_step("fields", error)
    if found is None:
        return StepResult(step="fields", status="failed", detail=COMPANY_GONE_DETAIL)

    send: dict[str, str] = {}
    there: list[str] = []
    held: list[FieldChange] = []
    for index, change in enumerate(changes):
        if not (change.write and change.value.strip()):
            continue
        kind = str(kinds.get(change.property, "text"))
        now = found.text(change.property)
        if _same(kind, now, change.value):
            there.append(change.property)  # HubSpot has it already: an earlier try landed
        elif _same(kind, now, change.current) and _same(kind, now, change.seen):
            send[change.property] = change.value
        else:
            held.append(change)
            changes[index] = change.model_copy(
                update={
                    "write": False,
                    "current": now,
                    "changed_since": True,
                    "reason": HELD_DETAIL,
                }
            )
    held_names = [change.property for change in held]
    held_words = _held_words(held)
    if held:
        run.plan["fields"] = [change.model_dump(mode="json") for change in changes]
    if not send:
        if there:
            return StepResult(
                step="fields",
                status="done",
                detail=_join(f"HubSpot already has {_count(len(there))}.", held_words),
                held=held_names,
            )
        return StepResult(
            step="fields", status="skipped", detail=held_words or NOTHING_DETAIL, held=held_names
        )

    run.sending = "fields"
    await run.save(session)  # still this apply's: nothing is sent once another holds the write
    try:
        await hubspot.update_object("companies", run.company_id, send)
    except HubSpotWriteUncertain:
        if not await _patched(hubspot, run.company_id, send, kinds):
            return StepResult(
                step="fields",
                status="failed",
                detail=_join(PATCH_UNSURE_DETAIL, held_words),
                held=held_names,
            )
    except HubSpotError as error:
        failed = failed_step("fields", error)
        return failed.model_copy(
            update={"detail": _join(failed.detail or "", held_words), "held": held_names}
        )
    return StepResult(
        step="fields",
        status="done",
        detail=_join(f"Changed {_count(len(send) + len(there))}.", held_words),
        held=held_names,
    )


async def _patched(
    hubspot: HubSpot, company_id: str, sent: Mapping[str, str], kinds: Mapping[str, Any]
) -> bool:
    """After a change that timed out: whether the company has every value sent."""
    try:
        found = await hubspot.get_object("companies", company_id, properties=list(sent))
    except HubSpotError:
        return False
    if found is None:
        return False
    return all(
        _same(str(kinds.get(name, "text")), found.text(name), value) for name, value in sent.items()
    )


def _count(fields: int) -> str:
    return f"{fields} field" if fields == 1 else f"{fields} fields"


def _held_words(held: Sequence[FieldChange]) -> str:
    if not held:
        return ""
    labels = ", ".join(change.label for change in held)
    return f"Changed in HubSpot since the preview, so not written: {labels}."


def _join(*parts: str) -> str:
    return " ".join(part for part in parts if part)


async def _meeting_step(session: AsyncSession, hubspot: HubSpot, run: _Run) -> StepResult:
    """The note, added to the end of the meeting's internal notes (T1-9). It reads the meeting
    first: notes that already hold the note's text are done, and nothing is sent, so running it
    again never adds it twice. Only `hs_internal_meeting_notes` is read or sent, and what it
    holds is kept byte for byte. A switch turned off since the preview sends nothing."""
    if not get_settings().meeting_note_on_meeting:
        return StepResult(step=MEETING, status="skipped", detail=MEETING_OFF_DETAIL)
    note, meeting_id = run.request.note, (run.request.meeting_id or "").strip()
    added = note_html(note.body) if note is not None else ""
    wanted = _squeezed(added)
    if not wanted or not meeting_id:
        return StepResult(step=MEETING, status="skipped", detail=MEETING_EMPTY_DETAIL)
    try:
        found = await hubspot.get_object("meetings", meeting_id, properties=[MEETING_NOTES])
    except HubSpotError as error:
        return failed_step(MEETING, error)
    except ValueError:  # the client refused an id that isn't HubSpot's, before sending
        return StepResult(step=MEETING, status="failed", detail=NOT_A_MEETING_DETAIL)
    if found is None:
        return StepResult(step=MEETING, status="failed", detail=MEETING_GONE_DETAIL)
    there = found.properties.get(MEETING_NOTES) or ""
    if wanted in _squeezed(there):
        return StepResult(step=MEETING, status="done", detail=MEETING_THERE_DETAIL)

    value = f"{there}{MEETING_BREAK}{added}" if there.strip() else f"{there}{added}"
    run.sending = MEETING
    await run.save(session)  # still this apply's: nothing is sent once another holds the write
    try:
        await hubspot.update_object("meetings", meeting_id, {MEETING_NOTES: value})
    except HubSpotWriteUncertain:
        return await _meeting_checked(hubspot, meeting_id, wanted)
    except HubSpotNotFound:
        return StepResult(step=MEETING, status="failed", detail=MEETING_GONE_DETAIL)
    except HubSpotError as error:
        return failed_step(MEETING, error)
    return StepResult(step=MEETING, status="done", detail=MEETING_DONE_DETAIL)


async def _meeting_checked(hubspot: HubSpot, meeting_id: str, wanted: str) -> StepResult:
    """After a change to the meeting that timed out: it is read again. The note's text there:
    done. Not there: failed, as a change that didn't land changed nothing, and sending it again
    reads the meeting first."""
    try:
        found = await hubspot.get_object("meetings", meeting_id, properties=[MEETING_NOTES])
    except HubSpotError:
        return StepResult(step=MEETING, status="failed", detail=MEETING_UNREAD_DETAIL)
    if found is None:
        return StepResult(step=MEETING, status="failed", detail=MEETING_GONE_DETAIL)
    if wanted in _squeezed(found.properties.get(MEETING_NOTES)):
        return StepResult(step=MEETING, status="done", detail=FOUND_DETAIL)
    return StepResult(step=MEETING, status="failed", detail=PATCH_UNSURE_DETAIL)


def _squeezed(text: str | None) -> str:
    """HTML as plain text, each run of spaces and line breaks made one space, so a note reads the
    same however HubSpot lays out its paragraphs."""
    return " ".join((plain(text) or "").split())


async def _save_call_copy(session: AsyncSession, run: _Run, record: HubSpotObject) -> None:
    """The call goes into our copy at once, so "Last talk" is right before the next sync. A
    failure is logged (its kind only: the text could quote the call) and never fails the write."""
    call = run.request.call
    if call is None:
        return
    owner_id = run.request.owner_id
    try:
        owner: str | None = None
        if owner_id is not None:
            owner = await session.scalar(
                select(HubSpotOwner.name).where(HubSpotOwner.owner_id == owner_id)
            )
        values: dict[str, Any] = {
            "hubspot_id": record.id,
            "hubspot_company_id": run.company_id,
            "hubspot_contact_id": run.request.contact_id,
            "called_at": _utc(call.at),
            "duration_seconds": None,
            "outcome": call.outcome,
            "title": call.title[:300],
            "note": plain(note_html(call.body)),  # as the sync will read it back from HubSpot
            "owner": owner[:120] if owner else None,
            "owner_id": owner_id,
            "hubspot_url": record.url,
            "imported_at": datetime.now(UTC),
        }
        statement = insert(HubSpotCall).values(values)
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[HubSpotCall.hubspot_id],
                set_={name: statement.excluded[name] for name in values if name != "hubspot_id"},
            )
        )
        await session.commit()
    except Exception as error:
        log.warning(
            "hubspot_call_copy_failed",
            extra={"write_id": str(run.write_id), "error": type(error).__name__},
        )
        with contextlib.suppress(Exception):
            await session.rollback()


async def _settle(session: AsyncSession, run: _Run) -> None:
    """An apply stopped part way (a cancel as the backend stops, or an error) settles its write
    at once, while it still holds it: the step on its way may or may not be in HubSpot, so it is
    uncertain, and the write stops being "writing". If even that fails, the write is taken over
    once STALLED_AFTER has passed."""
    if run.sending is not None:
        run.steps[run.sending] = StepResult(
            step=run.sending, status="uncertain", detail=STOPPED_DETAIL
        )
        run.sending = None

    async def settle() -> None:
        with contextlib.suppress(Exception):
            await session.rollback()  # a failed statement leaves the transaction unusable
            await run.finish(session)

    log.warning("hubspot_activity_cut_off", extra={"write_id": str(run.write_id)})
    with contextlib.suppress(Exception, asyncio.CancelledError):
        await asyncio.shield(asyncio.wait_for(settle(), SETTLE_SECONDS))
