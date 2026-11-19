"""Sending call notes to HubSpot (PLAN-V17 T2-6): the preview, the batch, a retry, and a person's
answer about an unsure step.

- **One record at a time** (choice 6). Each send of a note is its own write in
  `core.hubspot_writes`, made by core's activity writer (`core/hubspot/activities.py`): a preview
  first, which reads the company now, then the write. Each note keeps its own result, so one
  failure never fails ten.
- **What a note sends:** its call, on the company and the person, and on the company's one open
  deal (choice 5, TBC); its field changes; and its follow-ups. Each part keeps its own state on
  the card (`notes.Sent`), so a later send carries only what hasn't landed, as
  `call_note:<id>:2`.
- **A logged meeting** (T2-15, a transcript) isn't a phone call: its summary and words go as a note
  on the company and its one open deal (the step `note`), with its field changes and follow-ups.
- **A held field** (choice 4, TBC). The writer reads the company again right before writing. A
  field whose value changed since the rep saw it isn't written: it comes back held, with
  HubSpot's value, and waits for the rep, who checks it and sends again.
- **The batch** runs in the background, one note after another, in the order given, one batch at
  a time (the backend runs as one copy). No database connection waits on HubSpot. It stops
  cleanly on shutdown: what was sent stays sent, the note in flight takes what its write says,
  and the rest go back to the rep.
- **The writer is injected** (`ActivityWriter`), so tests use a fake one. HubSpot is read only by
  the writer: the owner and the deal come from our copy.
- **The company's owner is told** (PLAN-V23 T2-2, choice 8): a send that carries a call on a
  company whose owner (in our copy, an owner who hasn't left) isn't the call's owner asks the
  writer for an FYI task: "FYI: Jo Sample logged a call with Sample Logistics Pty Ltd", the call's
  summary, and a link to the company in Contour (its Call history shows the call; Call logs show
  only your own notes). The writer makes it once the call is in HubSpot, due that day, with the
  2 minute reminder. Only the send that carries the call can ask for it, so a later send of what
  didn't land never makes a second one. Off with `notify_owner_calls`, read as the send starts.
- **A call with no owner says who logged it** (PLAN-V23 T3-2, choice 14): someone with no HubSpot
  user (or one not linked yet) logs a call that HubSpot shows with no owner, so its text starts
  "Logged by Jo Sample, Designer, in Contour." ("Logged by Jo Sample in Contour." with no
  position). A logged meeting's note too. A linked account's call has no such line.
"""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies.deals import stage_kind
from apps.companies.facts import day, scrub
from apps.companies.links import company_link
from apps.companies.note_fields import NotOnTheList, hubspot_property
from apps.companies.notes import (
    MELBOURNE,
    STUCK_MINUTES,
    CardCall,
    CardChange,
    CardTask,
    CardWrite,
    NoteCard,
    PartState,
    Sent,
    call_text,
    where_failed,
)
from apps.companies.schemas import CallNoteStep, CallNoteTotals, StepStatus
from apps.companies.tables import CallNote
from core.auth.models import User
from core.config import Settings
from core.hubspot import activities
from core.hubspot.activities import (
    BODY_MAX_CHARS,
    OUTCOME_NAMES,
    ActivityRequest,
    CallIn,
    FieldSet,
    FyiIn,
    NoteIn,
    TaskIn,
)
from core.hubspot.client import HubSpot, HubSpotWritesOff
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOwner, HubSpotWrite
from core.hubspot.writer import WriteOut
from core.prefs.service import effective_settings

log = logging.getLogger(__name__)

APP = "companies"
TITLE_CHARS = 300
START_CHARS = 200  # an FYI task for a call with no summary quotes how its note starts
FINAL: Final = ("done", "partial", "failed", "uncertain")  # a write that has finished
PREVIEWABLE: Final = ("to_confirm", "partial", "failed")  # notes with parts not yet in HubSpot

# What the card and the answers say, in plain words (PLAN-V15 "Words for errors").
LEAD_ONLY = (
    "This company isn't in HubSpot yet. Send it from the Lead Finder first, then send this note "
    "again."
)
NOTHING_LEFT = "Everything in it is in HubSpot already."
OFF_THE_LIST = (
    "A change on this note isn't one a call may change. Remove it, then send the note again."
)
# One batch at a time in this backend, whoever pressed Send, so the words don't say whose it is.
ALREADY_SENDING = "Notes are being sent right now. Try again in a few seconds."
CHECK = "Check HubSpot, then tell us: it's there, or it's not."
STOPPED_MID_SEND = f"Contour stopped while sending this note. {CHECK}"
FAULT = "Something went wrong on our side while sending this note."
SEND_FAULT = f"{FAULT} Try again."
SEND_FAULT_UNSURE = f"{FAULT} {CHECK}"
TRY_AGAIN = "Try again."
NOT_THERE = "You said it isn't in HubSpot."
NO_ANSWER = f"HubSpot didn't answer. {CHECK}"

# --- The writer, injected ---------------------------------------------------------------------

type PreviewFn = Callable[[AsyncSession, HubSpot, ActivityRequest], Awaitable[WriteOut]]
type ApplyFn = Callable[[AsyncSession, HubSpot, uuid.UUID], Awaitable[WriteOut]]
type ResolveFn = Callable[[AsyncSession, uuid.UUID, str, bool], Awaitable[WriteOut]]
type OwnerFn = Callable[[AsyncSession, uuid.UUID | None], Awaitable[str | None]]
type SettingsFn = Callable[[AsyncSession], Awaitable[Settings]]


@dataclass(frozen=True)
class ActivityWriter:
    """Core's activity writer, as the batch uses it. A test gives a fake one."""

    preview: PreviewFn = activities.preview_activity
    apply: ApplyFn = activities.apply_activity
    resolve: ResolveFn = activities.resolve_step
    owner_of: OwnerFn = activities.owner_of


# --- What one send carries ----------------------------------------------------------------------


def parts_of(card: NoteCard) -> list[Sent]:
    return [card.call, *card.changes, *card.tasks]


def unsent(card: NoteCard) -> tuple[bool, list[CardChange], list[CardTask]]:
    """The parts a send carries: all that haven't landed. A held field goes again, with the
    value the rep has now seen on the card."""
    call = card.call.state != "landed"
    changes = [change for change in card.changes if change.state != "landed"]
    tasks = [task for task in card.tasks if task.state != "landed"]
    return call, changes, tasks


def call_title(note: CallNote) -> str:
    return (f"Call with {note.person_name}" if note.person_name else "Call")[:TITLE_CHARS]


def call_body(note: CallNote, card: NoteCard) -> str:
    """The call's text in HubSpot: the summary, a blank line, the note, then anything said that
    didn't change a field ("Not changed in HubSpot: ...")."""
    parts = [card.call.summary.strip(), call_text(note.text, card)]
    return "\n\n".join(part for part in parts if part)[:BODY_MAX_CHARS]


def is_meeting(note: CallNote) -> bool:
    """A logged meeting's note (T2-15): its call part goes to HubSpot as a note, not a call."""
    return note.source == "transcript"


def call_step(meeting: bool) -> str:
    """The step that carries a note's call part: `note` for a logged meeting, else `call`."""
    return "note" if meeting else "call"


def meeting_body(note: CallNote, card: NoteCard) -> str:
    """A logged meeting's note in HubSpot: the day it was, the summary, then the transcript and
    anything said that didn't change a field."""
    held_on = day(note.called_at.astimezone(MELBOURNE).date())
    parts = [f"Meeting notes, {held_on}", card.call.summary.strip(), call_text(note.text, card)]
    return "\n\n".join(part for part in parts if part)[:BODY_MAX_CHARS]


# Room in a HubSpot body for what goes around the rep's words: a meeting's first line, the summary
# (the rep's is at most 600 characters), and a line for each thing said that didn't change a field
# (at most 10). So the words a note may hold always reach HubSpot whole.
BODY_ROOM: Final = 2_000


def longest(setting: int) -> int:
    """The longest a note or a transcript may be, in characters: the setting, but never more than
    fits in one HubSpot body with what goes around it."""
    return min(setting, BODY_MAX_CHARS - BODY_ROOM)


def change_label(change: CardChange) -> str:
    """Like "Melbourne lease end"."""
    return f"{change.office} {change.label.lower()}"


async def one_open_deal(session: AsyncSession, company_id: str) -> str | None:
    """The deal to link the call to: only when the company has exactly one open deal in our copy
    (choice 5, TBC with Levi). Two or more, or none: no deal."""
    rows = await session.execute(
        select(HubSpotDeal.hubspot_deal_id, HubSpotDeal.stage).where(
            HubSpotDeal.hubspot_company_id == company_id
        )
    )
    found = [deal_id for deal_id, stage in rows.all() if stage_kind(stage) == "open"]
    return found[0] if len(found) == 1 else None


def off_the_list(card: NoteCard) -> bool:
    """Whether a change not yet in HubSpot names a field the list doesn't give for its office.
    Core's writer takes any company field, so the list of what a call may change
    (note_fields.yaml, choice 3) is kept here: each field is worked out from the list again
    before it is previewed or sent, and a card that names anything else is not sent at all."""
    for change in card.changes:
        if change.state == "landed":
            continue
        try:
            listed = hubspot_property(change.field, change.office_label)
        except NotOnTheList:
            return True
        if listed != change.property:
            return True
    return False


@dataclass(frozen=True)
class Caller:
    """Who logged a call, from their account: the FYI task for the company's owner names them
    (PLAN-V23 T2-2)."""

    name: str
    position: str | None


def logged_by(caller: Caller) -> str:
    """The first line of a call with no owner (PLAN-V23 choice 14): who logged it."""
    position = " ".join((caller.position or "").split())
    if position:
        return f"Logged by {caller.name}, {position}, in Contour."
    return f"Logged by {caller.name} in Contour."


def signed(body: str, caller: Caller | None, rep: str | None) -> str:
    """A call's or a logged meeting's text, with who logged it first when HubSpot will show it
    with no owner."""
    if rep is not None or caller is None:
        return body
    return f"{logged_by(caller)}\n\n{body}"[:BODY_MAX_CHARS]


async def caller_of(session: AsyncSession, note: CallNote) -> Caller | None:
    """The account that logged the note. None with sign-in off (nobody), or once it is deleted."""
    if note.made_by is None:
        return None
    user = await session.get(User, note.made_by)
    return Caller(name=user.name, position=user.position) if user is not None else None


async def owner_to_tell(session: AsyncSession, company_key: str, rep: str | None) -> str | None:
    """The company's owner, to be told of a call someone else logged (PLAN-V23 choice 8): from
    our copy, and not the call's owner (`rep`). None: the company has no owner, the call is the
    owner's own, or the owner has left HubSpot."""
    owner = await session.scalar(
        select(HubSpotCompany.owner_id).where(HubSpotCompany.hubspot_id == company_key)
    )
    if not owner or owner == rep:
        return None
    left = await session.scalar(select(HubSpotOwner.archived).where(HubSpotOwner.owner_id == owner))
    return None if left else owner


def fyi_subject(caller: Caller, company_name: str) -> str:
    """Like "FYI: Jo Sample logged a call with Sample Logistics Pty Ltd"."""
    return f"FYI: {caller.name} logged a call with {company_name}"[:TITLE_CHARS]


def fyi_body(note: CallNote, card: NoteCard, settings: Settings) -> str:
    """The call's summary (or how its note starts, when it has none), then a link to the company
    in Contour: its Call history shows the call. No email address or phone number."""
    summary = " ".join(scrub(card.call.summary).split())
    if not summary:
        summary = " ".join(scrub(note.text).split())[:START_CHARS].rstrip()
    link = company_link(settings, note.company_key)
    parts = [summary, f"See the call on {note.company_name} in Contour: {link}"]
    return "\n\n".join(part for part in parts if part)[:BODY_MAX_CHARS]


async def fyi_of(
    session: AsyncSession,
    note: CallNote,
    card: NoteCard,
    *,
    caller: Caller | None,
    rep: str | None,
    settings: Settings,
    today: date,
) -> FyiIn | None:
    """The FYI task for the company's owner, for a send that carries a call (PLAN-V23 T2-2), or
    None: the switch is off, nobody is signed in, or there is no one else to tell."""
    if not settings.notify_owner_calls:
        return None
    owner = await owner_to_tell(session, note.company_key, rep) if caller is not None else None
    if caller is None or owner is None:
        return None
    return FyiIn(
        owner_id=owner,
        subject=fyi_subject(caller, note.company_name),
        body=fyi_body(note, card, settings),
        due=today,
    )


@dataclass(frozen=True)
class Planned:
    """One send of one note: the request for the writer, and the parts of the card it carries."""

    request: ActivityRequest
    record: CardWrite


async def plan_send(
    session: AsyncSession,
    note: CallNote,
    card: NoteCard,
    *,
    writer: ActivityWriter,
    settings: Settings,
    today: date,
) -> Planned | str:
    """What the next send of this note carries, or why it can't be sent. `settings`: as the send
    starts; `today`: its day, Melbourne time (an FYI task is due then)."""
    if note.company_key.startswith("lead:"):
        return LEAD_ONLY
    call, changes, tasks = unsent(card)
    if not (call or changes or tasks):
        return NOTHING_LEFT
    if off_the_list(card):
        return OFF_THE_LIST
    number = len(card.writes) + 1
    subject = f"call_note:{note.id}" if number == 1 else f"call_note:{note.id}:{number}"
    outcome = card.call.outcome if card.call.outcome in OUTCOME_NAMES else None
    meeting = is_meeting(note)
    rep = await writer.owner_of(session, note.made_by)
    caller = await caller_of(session, note)
    carries_call = call and not meeting
    fyi = (
        await fyi_of(session, note, card, caller=caller, rep=rep, settings=settings, today=today)
        if carries_call
        else None
    )
    request = ActivityRequest(
        app=APP,
        subject=subject,
        company_id=note.company_key,
        contact_id=note.contact_id,
        deal_id=await one_open_deal(session, note.company_key),
        owner_id=rep,
        call=(
            CallIn(
                at=note.called_at,
                title=call_title(note),
                body=signed(call_body(note, card), caller, rep),
                outcome=outcome,
                direction="outbound",
            )
            if carries_call
            else None
        ),
        note=(
            NoteIn(body=signed(meeting_body(note, card), caller, rep)) if call and meeting else None
        ),
        fields=[
            FieldSet(
                property=change.property,
                label=change_label(change),
                value=change.value,
                seen=change.current,
            )
            for change in changes
        ],
        tasks=[
            TaskIn(
                subject=task.subject,
                due=task.due,
                kind=task.kind,
                priority="medium",
                owner_id=task.owner_id,
            )
            for task in tasks
        ],
        fyi=fyi,
    )
    record = CardWrite(
        id="",
        subject=subject,
        call=call,
        meeting=meeting,
        tasks=[task.id for task in tasks],
        changes=[change.id for change in changes],
    )
    return Planned(request, record)


def mark_sending(note: CallNote, now: datetime) -> None:
    """The note is on its way: what hasn't landed waits to be sent, and its write is the one
    this send makes (none yet). The caller commits."""
    card = NoteCard.model_validate(note.card or {})
    for part in parts_of(card):
        if part.state != "landed":  # its step's name comes from the write that carries it
            part.state, part.step, part.detail = "new", None, None
    card.previewed = None
    note.status = "sending"
    note.write_id = None
    note.confirmed_at = note.confirmed_at or now
    note.card = card.model_dump(mode="json")


# --- Reading what a write says -------------------------------------------------------------------


@dataclass(frozen=True)
class StepSeen:
    status: str  # done, failed, uncertain or skipped
    detail: str | None  # plain words, from the writer


@dataclass(frozen=True)
class FieldSeen:
    write: bool  # False: the writer left it as it is
    current: str | None  # what HubSpot has
    reason: str | None  # why it wasn't written, in plain words


@dataclass(frozen=True)
class Landing:
    """What one write says: each step's result, and each field (by HubSpot's field name). Read
    from the writer's answer, or from the write's saved row."""

    write_id: str
    status: str
    steps: dict[str, StepSeen]
    fields: dict[str, FieldSeen]
    url: str | None
    error: str | None


def landing_of(out: WriteOut) -> Landing:
    return Landing(
        write_id=str(out.id),
        status=str(out.status),
        steps={str(step.step): StepSeen(str(step.status), step.detail) for step in out.steps},
        fields={
            field.property: FieldSeen(field.write, field.current, field.reason)
            for field in out.plan.fields
        },
        url=out.hubspot_url,
        error=out.error,
    )


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def landing_of_row(row: HubSpotWrite) -> Landing:
    """The same, from the row. Read as plain data: the writer's own reader takes only the Lead
    Finder's step names until Track 1's T1-5 widens them."""
    steps = [step for step in (row.result or {}).get("steps", []) if isinstance(step, dict)]
    fields = [field for field in (row.plan or {}).get("fields", []) if isinstance(field, dict)]
    return Landing(
        write_id=str(row.id),
        status=row.status,
        steps={
            str(step.get("step")): StepSeen(str(step.get("status")), _text(step.get("detail")))
            for step in steps
        },
        fields={
            str(field.get("property")): FieldSeen(
                bool(field.get("write", True)),
                _text(field.get("current")),
                _text(field.get("reason")),
            )
            for field in fields
        },
        url=row.hubspot_url,
        error=row.error,
    )


STEP_STATES: Final[dict[str, PartState]] = {
    "done": "landed",
    "failed": "failed",
    "uncertain": "uncertain",
    "skipped": "skipped",
}


def record_of(card: NoteCard, write_id: str) -> CardWrite | None:
    return next((write for write in card.writes if write.id == write_id), None)


def carried(card: NoteCard, record: CardWrite) -> list[tuple[str, Sent]]:
    """The parts one write carried, each with its step's name in that write."""
    found: list[tuple[str, Sent]] = [(call_step(record.meeting), card.call)] if record.call else []
    changes = {change.id: change for change in card.changes}
    found += [
        ("fields", changes[change_id]) for change_id in record.changes if change_id in changes
    ]
    tasks = {task.id: task for task in card.tasks}
    found += [
        (f"task:{number}", tasks[task_id])
        for number, task_id in enumerate(record.tasks, start=1)
        if task_id in tasks
    ]
    return found


def _landed(part: Sent) -> None:
    part.state, part.detail = "landed", None
    if isinstance(part, CardChange):
        part.current, part.current_changed = part.value, False


def _not_written(change: CardChange, field: FieldSeen) -> None:
    """A field the writer left as it is. HubSpot has the value already: it landed. HubSpot's
    value changed since the rep saw it: it is held, shows HubSpot's value, and waits for the rep.
    Anything else didn't land, with the writer's reason."""
    if field.current is not None and field.current == change.value:
        _landed(change)
    elif field.current != change.current:
        change.state, change.detail = "held", None
        change.current, change.current_changed = field.current, True
    else:
        change.state, change.detail = "failed", field.reason


def apply_landing(
    card: NoteCard, landing: Landing, *, unrecorded: PartState = "skipped", why: str | None = None
) -> None:
    """Each part the write carried takes its step's result. A step the write has no result for
    wasn't reached (`skipped`), or, for a write cut off part way, may or may not be in HubSpot
    (`uncertain`, with `why`)."""
    record = record_of(card, landing.write_id)
    if record is None:
        return
    fallback = why or (landing.error if not landing.steps else None)
    for step, part in carried(card, record):
        part.step = step
        field = landing.fields.get(part.property) if isinstance(part, CardChange) else None
        seen = landing.steps.get(step)
        if isinstance(part, CardChange) and field is not None and not field.write:
            _not_written(part, field)
        elif seen is None:
            part.state, part.detail = unrecorded, fallback
        elif seen.status == "done":
            _landed(part)
        else:  # an unsure step says to check HubSpot in our own words
            part.state = STEP_STATES.get(seen.status, "failed")
            part.detail = None if part.state == "uncertain" else seen.detail


def status_of(card: NoteCard) -> str:
    """The note's status from its parts. A part uncertain: uncertain. All landed: logged. Some:
    partial. None: failed."""
    states = [part.state for part in parts_of(card)]
    if "uncertain" in states:
        return "uncertain"
    if all(state == "landed" for state in states):
        return "logged"
    return "partial" if "landed" in states else "failed"


def settle_note(note: CallNote, card: NoteCard, now: datetime, url: str | None = None) -> None:
    """Saves the card, the status that follows from it, and the newest write. Nothing of it sent:
    it goes back to the rep's batch. The caller commits."""
    if all(part.state == "new" for part in parts_of(card)):
        note.status, note.confirmed_at = "to_confirm", None
    else:
        note.status = status_of(card)
    if url and card.call.state == "landed" and not note.hubspot_url:
        note.hubspot_url = url
    note.write_id = uuid.UUID(card.writes[-1].id) if card.writes else None
    note.finished_at = now if note.status == "logged" else None
    note.card = card.model_dump(mode="json")


async def settle_cut_off(
    session: AsyncSession, note: CallNote, now: datetime, *, unsure: str, failed: str | None
) -> None:
    """A note whose send was cut off: by a shutdown, a restart, an error, or writing switched
    off. The write it was on decides. Finished: its parts land as it says. Still writing: a part
    it has no result for may or may not be in HubSpot (`unsure`). Only previewed: it carried
    nothing. A part never sent fails with `failed`, or goes back to the rep when that is None.
    The caller commits."""
    card = NoteCard.model_validate(note.card or {})
    record = record_of(card, str(note.write_id)) if note.write_id is not None else None
    url: str | None = None
    if record is not None:
        row = await session.get(HubSpotWrite, note.write_id)
        if row is not None and row.status in FINAL:
            apply_landing(card, landing_of_row(row))
            url = row.hubspot_url
        elif row is not None and row.status == "writing":
            apply_landing(card, landing_of_row(row), unrecorded="uncertain", why=unsure)
            url = row.hubspot_url
        else:
            card.writes.remove(record)
    if failed is not None:
        for part in parts_of(card):
            if part.state == "new":
                part.state, part.detail = "failed", failed
    settle_note(note, card, now, url)


def totals_of(cards: Iterable[tuple[NoteCard, bool]]) -> CallNoteTotals:
    """What sending these notes adds: each call, meeting note and follow-up not in HubSpot yet,
    and each field change not in HubSpot and not held. Each card comes with whether it is a
    logged meeting's: its notes go as a note, not a call."""
    calls = meeting_notes = tasks = changes = 0
    for card, meeting in cards:
        unsent = card.call.state != "landed"
        if meeting:
            meeting_notes += unsent
        else:
            calls += unsent
        tasks += sum(task.state != "landed" for task in card.tasks)
        changes += sum(change.state not in ("landed", "held") for change in card.changes)
    return CallNoteTotals(calls=calls, meeting_notes=meeting_notes, tasks=tasks, changes=changes)


def unsure_steps(card: NoteCard) -> set[str]:
    """The steps of the newest write that HubSpot may or may not have."""
    record = card.writes[-1] if card.writes else None
    if record is None:
        return set()
    return {name for name, part in carried(card, record) if part.state == "uncertain"}


# --- What the card says about each part ---------------------------------------------------------

STEP_STATUS: Final[dict[PartState, StepStatus]] = {
    "new": "pending",
    "landed": "done",
    "failed": "failed",
    "skipped": "skipped",
    "held": "skipped",
    "uncertain": "uncertain",
}


def _again(detail: str | None) -> str:
    """The writer's words, then "Try again" when they don't say it already."""
    words = (detail or "").strip()
    if not words:
        return TRY_AGAIN
    words = words if words.endswith((".", "!", "?")) else f"{words}."
    return words if "try again" in words.lower() else f"{words} {TRY_AGAIN}"


def _shown(value: str | None) -> str:
    """A field's value as a person reads it: a date in words, like 30 Jun 2027."""
    if value is None or not value.strip():
        return "empty"
    try:
        return day(date.fromisoformat(value))
    except ValueError:
        return value


def _words(part: Sent, what: str, *, landed: str, waiting: str) -> str:
    """What the card says about one part. `what` names it, like "Task 'Send the floor plan'"."""
    match part.state:
        case "new":
            return waiting
        case "landed":
            return landed
        case "uncertain":  # our own sentence when a send was cut off, else HubSpot's silence
            return f"{what}: {part.detail or NO_ANSWER}"
        case "skipped":
            return (
                f"{what} not sent: {_again(part.detail)}"
                if part.detail
                else f"{what} not sent. {TRY_AGAIN}"
            )
        case _:
            return (
                f"{what} not saved: {_again(part.detail)}"
                if part.detail
                else f"{what} not saved. {TRY_AGAIN}"
            )


def _call_words(call: CardCall, *, meeting: bool) -> str:
    if meeting:
        return _words(
            call,
            "Meeting notes",
            landed="Meeting notes added.",
            waiting="Meeting notes waiting to be sent.",
        )
    return _words(call, "Call", landed="Call logged.", waiting="Call waiting to be sent.")


def _change_words(change: CardChange) -> str:
    what = change_label(change)
    what = what[:1].upper() + what[1:]
    if change.state == "held":
        return (
            f"{what} changed in HubSpot since you checked it. It is now "
            f"{_shown(change.current)}. Check it, then send again."
        )
    return _words(
        change,
        what,
        landed=f"{what} set to {_shown(change.value)} in HubSpot.",
        waiting=f"{what} waiting to be sent.",
    )


def _task_words(task: CardTask) -> str:
    return _words(
        task,
        f"Task '{task.subject}'",
        landed=f"Task added: {task.subject}.",
        waiting=f"Task waiting to be sent: {task.subject}.",
    )


def steps_of(card: NoteCard, status: str, *, meeting: bool = False) -> list[CallNoteStep]:
    """Each part's step, as the note shows it once it is on its way: the call (a logged
    meeting's note), the changes, then the follow-ups. Empty before that."""
    if status != "sending" and all(part.state == "new" for part in parts_of(card)):
        return []
    steps = [
        CallNoteStep(
            step=card.call.step or call_step(meeting),
            status=STEP_STATUS[card.call.state],
            words=_call_words(card.call, meeting=meeting),
        )
    ]
    steps += [
        CallNoteStep(
            step=change.step or "fields",
            status=STEP_STATUS[change.state],
            words=_change_words(change),
        )
        for change in card.changes
    ]
    steps += [
        CallNoteStep(
            step=task.step or f"task:{number}",
            status=STEP_STATUS[task.state],
            words=_task_words(task),
        )
        for number, task in enumerate(card.tasks, start=1)
    ]
    return steps


# --- The runner ---------------------------------------------------------------------------------

type HubSpotSource = Callable[[], AbstractAsyncContextManager[HubSpot | None]]
type Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(UTC)


class NoteSender:
    """Sends call notes to HubSpot in the background: one batch at a time in this backend, one
    note after another. It also previews notes, and settles a person's answer about an unsure
    step, with the same writer. A test puts its own in `app.state.note_sender`, with a fake
    writer."""

    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        hubspot: HubSpotSource,
        writer: ActivityWriter | None = None,
        clock: Clock = _utc_now,
        settings: SettingsFn = effective_settings,
    ) -> None:
        self.sessions = sessions
        self.hubspot = hubspot
        self.writer = writer or ActivityWriter()
        self._clock = clock
        self._settings = settings  # read as each send starts (tests give their own)
        self._task: asyncio.Task[None] | None = None
        self._claimed = False
        self._notes: frozenset[uuid.UUID] = frozenset()
        self.batch_id: uuid.UUID | None = None

    def _today(self) -> date:
        return self._clock().astimezone(MELBOURNE).date()

    async def _plan(self, session: AsyncSession, note: CallNote, card: NoteCard) -> Planned | str:
        settings = await self._settings(session)
        return await plan_send(
            session, note, card, writer=self.writer, settings=settings, today=self._today()
        )

    @property
    def busy(self) -> bool:
        """A batch is being sent, or a press has claimed the runner for one."""
        return self._claimed or (self._task is not None and not self._task.done())

    def has(self, note_id: uuid.UUID) -> bool:
        """Whether this backend is sending the note now, or may be about to."""
        return self._claimed or (self.busy and note_id in self._notes)

    def claim(self) -> uuid.UUID | None:
        """Holds the runner for one batch, or None when a batch is being sent already. It has no
        await, so two presses can't both get it."""
        if self.busy:
            return None
        self._claimed = True
        self.batch_id = uuid.uuid4()
        return self.batch_id

    def release(self) -> None:
        """Gives the runner back when nothing was started."""
        self._claimed = False

    def launch(self, note_ids: Sequence[uuid.UUID]) -> None:
        """Sends these notes (already marked `sending`), one after another, in this order."""
        self._notes = frozenset(note_ids)
        self._task = asyncio.create_task(
            self._send_all(list(note_ids)), name=f"call-notes-{self.batch_id}"
        )
        self._claimed = False

    async def wait(self) -> None:
        """Waits for the batch to end (tests, and a clean shutdown)."""
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)

    async def stop(self, *, wait_seconds: float = 10.0) -> None:
        """Stops the batch, for a clean shutdown. What was sent stays sent, the note in flight
        takes what its write says, and the notes not started go back to the rep."""
        task = self._task
        if task is not None and not task.done():
            task.cancel()
            await asyncio.wait([task], timeout=wait_seconds)

    # --- Sending ---

    async def _send_all(self, pending: list[uuid.UUID]) -> None:
        in_flight: uuid.UUID | None = None
        try:
            async with self.hubspot() as hubspot:
                if hubspot is None:
                    raise HubSpotWritesOff()
                while pending:
                    in_flight = pending.pop(0)
                    try:
                        await self._send_one(hubspot, in_flight)
                    except (HubSpotWritesOff, asyncio.CancelledError):
                        raise
                    except Exception as error:  # one note's problem never stops the others
                        log.error(
                            "call_note_send_failed",
                            extra={"note_id": str(in_flight), **where_failed(error)},
                        )
                        await self._cut_off(in_flight, unsure=SEND_FAULT_UNSURE, failed=SEND_FAULT)
                    in_flight = None
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await asyncio.shield(self._stopped(in_flight, pending))
            raise
        except HubSpotWritesOff:
            # Writing was switched off, or the key went, while the batch ran: nothing more goes.
            left = len(pending) + (in_flight is not None)
            log.warning("call_notes_waiting_for_writes", extra={"left": left})
            with contextlib.suppress(Exception):
                await self._stopped(in_flight, pending)
        except Exception as error:
            log.error("call_note_batch_failed", extra=where_failed(error))
            with contextlib.suppress(Exception):
                await self._stopped(in_flight, pending)

    async def _send_one(self, hubspot: HubSpot, note_id: uuid.UUID) -> None:
        """One note: plan it, preview it (HubSpot is read now), write it, and save what landed.
        Each step has its own session, so no connection waits on HubSpot."""
        async with self.sessions() as session:
            note = await session.get(CallNote, note_id, with_for_update=True)
            if note is None or note.status != "sending":
                return
            card = NoteCard.model_validate(note.card or {})
            planned = await self._plan(session, note, card)
            if isinstance(planned, str):  # nothing to send after all: it settles as it is
                settle_note(note, card, self._clock())
            await session.commit()
        if isinstance(planned, str):
            return
        async with self.sessions() as session:
            previewed = await self.writer.preview(session, hubspot, planned.request)
        async with self.sessions() as session:
            note = await session.get(CallNote, note_id, with_for_update=True)
            if note is None:
                return
            card = NoteCard.model_validate(note.card or {})
            card.writes.append(planned.record.model_copy(update={"id": str(previewed.id)}))
            note.write_id = previewed.id
            note.card = card.model_dump(mode="json")
            await session.commit()
        async with self.sessions() as session:
            written = await self.writer.apply(session, hubspot, previewed.id)
        landing = landing_of(written)
        async with self.sessions() as session:
            note = await session.get(CallNote, note_id, with_for_update=True)
            if note is None:
                return
            card = NoteCard.model_validate(note.card or {})
            apply_landing(card, landing)
            settle_note(note, card, self._clock(), landing.url)
            await session.commit()

    async def _stopped(self, in_flight: uuid.UUID | None, pending: Sequence[uuid.UUID]) -> None:
        """The batch stopped: the note in flight takes what its write says, and the notes not
        started go back to the rep."""
        for note_id in [*([in_flight] if in_flight is not None else []), *pending]:
            await self._cut_off(note_id, unsure=STOPPED_MID_SEND, failed=None)

    async def _cut_off(self, note_id: uuid.UUID, *, unsure: str, failed: str | None) -> None:
        async with self.sessions() as session:
            note = await session.get(CallNote, note_id, with_for_update=True)
            if note is not None and note.status == "sending":
                await settle_cut_off(session, note, self._clock(), unsure=unsure, failed=failed)
            await session.commit()

    # --- Previewing ---

    async def preview(self, note_ids: Sequence[uuid.UUID]) -> tuple[bool, set[uuid.UUID]]:
        """Each note's changes with HubSpot's values now, through the writer's preview. Answers
        whether HubSpot could be written, and the notes it couldn't preview (they keep our copy's
        values). One note's problem never stops the others."""
        missed: set[uuid.UUID] = set()
        async with self.hubspot() as hubspot:
            if hubspot is None:
                return False, set(note_ids)
            for position, note_id in enumerate(note_ids):
                try:
                    await self._preview_one(hubspot, note_id)
                except HubSpotWritesOff:
                    return False, missed | set(note_ids[position:])
                except Exception as error:
                    log.warning(
                        "call_note_preview_failed",
                        extra={"note_id": str(note_id), **where_failed(error)},
                    )
                    missed.add(note_id)
        return True, missed

    async def _preview_one(self, hubspot: HubSpot, note_id: uuid.UUID) -> None:
        async with self.sessions() as session:
            note = await session.get(CallNote, note_id)
            if note is None or note.status not in PREVIEWABLE:
                return
            planned = await self._plan(session, note, NoteCard.model_validate(note.card or {}))
            await session.commit()
        if isinstance(planned, str):
            return
        async with self.sessions() as session:
            landing = landing_of(await self.writer.preview(session, hubspot, planned.request))
        async with self.sessions() as session:
            note = await session.get(CallNote, note_id, with_for_update=True)
            if note is None or note.status not in PREVIEWABLE:
                return
            card = NoteCard.model_validate(note.card or {})
            for change in card.changes:
                field = landing.fields.get(change.property)
                if (
                    change.state != "landed"
                    and field is not None
                    and field.current != change.current
                ):
                    change.current, change.current_changed = field.current, True
            card.previewed = landing.write_id
            note.card = card.model_dump(mode="json")
            await session.commit()

    # --- A person's answer about an unsure step ---

    async def resolve(
        self,
        session: AsyncSession,
        note_id: uuid.UUID,
        write_id: uuid.UUID,
        step: str,
        landed: bool,
    ) -> None:
        """The writer settles the step in its write. Then the parts of that step take the
        person's word, and the note's status follows: not there, and a retry sends it again."""
        await session.commit()  # no connection waits on the writer's own work
        settled = await self.writer.resolve(session, write_id, step, landed)
        note = await session.get(CallNote, note_id, with_for_update=True, populate_existing=True)
        if note is None or note.status != "uncertain" or note.write_id != write_id:
            await session.commit()
            return
        card = NoteCard.model_validate(note.card or {})
        record = record_of(card, str(write_id))
        for name, part in carried(card, record) if record is not None else []:
            if name == step and part.state == "uncertain":
                if landed:
                    _landed(part)
                else:
                    part.state, part.detail = "failed", NOT_THERE
        settle_note(note, card, self._clock(), settled.hubspot_url)
        await session.commit()


def sending_stuck(note: CallNote, sender: NoteSender, now: datetime) -> bool:
    """A note left "sending" by a restart: no batch behind it, untouched for STUCK_MINUTES."""
    return (
        note.status == "sending"
        and not sender.has(note.id)
        and note.updated_at < now - timedelta(minutes=STUCK_MINUTES)
    )
