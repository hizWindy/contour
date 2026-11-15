"""The call notes service (PLAN-V17 T2-5): saving, reading, editing and removing a rep's call
notes, the counts for Home, and what sending waits for. The routes are in api_notes.py, and the
sorter in notes.py.

- **Whose note.** A rep reads and changes their own notes. An Admin reads everyone's (a team view
  is TBC), but only the person who logged a call changes, removes or sends it. With sign-in off
  nobody is signed in, and every note is open, as everything else is then.
- **No contact details are stored.** The note's text, a summary and a follow-up's subject are
  saved through `scrub`, so a phone number or an email shows as [number left out] or
  [email left out].
- **A double press is one note.** The same person and `Idempotency-Key` give back the first note,
  and its sort runs once.
- **The AI.** Off: the note goes straight to the rep's batch (`to_confirm`), sorted by hand, free.
  On: it is `sorting`, and the sorter works in the background.
- **Sending** (preview, confirm, retry, resolve) goes through the batch (note_batch.py, T2-6). While
  HubSpot can't be written, preview shows each note with our copy's values, and the rest say what
  sending waits for.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final, get_args
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.facts import scrub
from apps.companies.note_batch import (
    ALREADY_SENDING,
    LEAD_ONLY,
    STOPPED_MID_SEND,
    NoteSender,
    mark_sending,
    sending_stuck,
    settle_cut_off,
    steps_of,
    totals_of,
    unsure_steps,
)
from apps.companies.note_fields import note_fields
from apps.companies.notes import (
    CardChange,
    CardTask,
    Dropped,
    NoteCard,
    NoteSorter,
    OfficeChoice,
    check_change,
    field_value,
    is_stuck,
    match_person,
    office_choices,
    settle_by_hand,
    settle_stuck,
)
from apps.companies.schemas import (
    NOTE_VALUE_MAX_CHARS,
    CallNoteCall,
    CallNoteChange,
    CallNoteChangeIn,
    CallNoteConfirm,
    CallNoteIn,
    CallNoteOptions,
    CallNoteOut,
    CallNotePage,
    CallNotePatch,
    CallNotePreview,
    CallNoteSkipped,
    CallNoteSummary,
    CallNoteTask,
    CallNoteTaskIn,
    NoteFieldOption,
    NoteState,
    OutcomeName,
    PrepPerson,
)
from apps.companies.store import people_of, valid_key
from apps.companies.tables import CallNote, Prep
from core.api.errors import Problem
from core.auth.models import User
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads
from core.config import Settings
from core.hubspot.activities import OUTCOME_NAMES
from core.hubspot.connection import hubspot_set_up, project_readiness
from core.hubspot.models import HubSpotCompany, HubSpotContact, HubSpotOffice, HubSpotOwner

APP = "companies"
MELBOURNE = ZoneInfo("Australia/Melbourne")
FUTURE_GRACE = timedelta(minutes=5)  # a call "now" from a laptop whose clock runs a little fast
STATES: Final[dict[NoteState, tuple[str, ...]]] = {
    "to_confirm": ("sorting", "to_confirm", "sending"),
    "logged": ("logged",),
    "needs_look": ("partial", "failed", "uncertain"),
}
CHANGEABLE: Final = ("to_confirm", "partial", "failed")  # the parts not in HubSpot yet
REMOVABLE: Final = ("sorting", "to_confirm")
CARD_PARTS: Final = frozenset({"summary", "outcome", "changes", "tasks"})
SENT_FIELDS: Final[set[str]] = {"state", "step", "detail"}  # where a part is with HubSpot
WAITING_FOR_HUBSPOT = "Waiting for HubSpot to be connected."
WAITING_FOR_WRITES = "Waiting for HubSpot write access."

# --- The words (PLAN-V15 "Words for errors"): what happened, then one thing to do ---------------


def company_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that company",
        "It may have been removed, or it isn't open to your account.",
        code="company_not_found",
    )


def note_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that note",
        "It may have been removed, or it isn't open to your account.",
        code="note_not_found",
    )


def call_notes_off() -> Problem:
    return Problem(
        409,
        "Call notes are off",
        "Call notes are switched off. An admin can switch them on in Settings.",
        code="call_notes_off",
    )


def not_your_note() -> Problem:
    return Problem(
        403,
        "Not your note",
        "Only the person who logged this call can change it, remove it or send it.",
        code="not_your_note",
    )


def still_sorting() -> Problem:
    return Problem(
        409,
        "Still sorting",
        "This note is still being sorted. Try again in a moment.",
        code="note_sorting",
    )


SENT_WORDS: Final = {
    "sending": "This note is being sent to HubSpot. Wait for it to finish.",
    "uncertain": "Check HubSpot first, then tell us whether it's there.",
    "partial": "Part of this note is in HubSpot already, so it can't be removed here.",
    "failed": "This note was sent to HubSpot once, so it can't be removed here. Send it again.",
}


def already_sent(status: str | None = None) -> Problem:
    return Problem(
        409,
        "Already sent",
        SENT_WORDS.get(
            status or "", "This note has gone to HubSpot, so it can't be changed or removed here."
        ),
        code="note_sent",
    )


def writes_off(waiting_for: str) -> Problem:
    return Problem(409, "Waiting for write access", waiting_for, code="hubspot_writes_off")


def refused(title: str, detail: str, code: str) -> Problem:
    return Problem(422, title, detail, code=code)


# --- Whose note -----------------------------------------------------------------------------------


def maker_of(auth: AuthContext | None) -> uuid.UUID | None:
    return auth.user.id if auth is not None else None


def may_read(note: CallNote, auth: AuthContext | None) -> bool:
    return auth is None or note.made_by == auth.user.id or auth.user.role == "admin"


def may_change(note: CallNote, auth: AuthContext | None) -> bool:
    return auth is None or note.made_by == auth.user.id


async def read_note(
    session: AsyncSession, note_id: uuid.UUID, auth: AuthContext | None, *, change: bool = False
) -> CallNote:
    """A note this person may read (404 otherwise), and with `change` one they may also change:
    an Admin reading someone else's gets a 403."""
    note = await session.get(CallNote, note_id)
    if note is None or not may_read(note, auth):
        raise note_not_found()
    if change and not may_change(note, auth):
        raise not_your_note()
    return note


# --- What the routes send back --------------------------------------------------------------------


def note_out(
    note: CallNote, card: NoteCard, *, made_by: str | None, owners: dict[str, str]
) -> CallNoteOut:
    """One note as the contract has it. `owners` gives the names of the HubSpot owners its
    follow-ups are for."""
    person = (
        PrepPerson(id=note.contact_id or "", name=note.person_name, title=note.person_title)
        if note.person_name
        else None
    )
    outcome = card.call.outcome
    return CallNoteOut(
        id=note.id,
        company_key=note.company_key,
        company_name=note.company_name,
        person=person,
        text=note.text,
        source=note.source,  # the table's checks keep these three to their lists
        called_at=note.called_at,
        status=note.status,
        sorted_by=note.sorted_by,
        unsure=card.unsure,
        call=CallNoteCall(
            summary=card.call.summary,
            outcome=outcome if outcome in OUTCOME_NAMES else None,
            in_hubspot=card.call.state == "landed",
        ),
        changes=[
            CallNoteChange(
                id=change.id,
                field=change.field,
                label=change.label,
                office=change.office,
                current=change.current,
                value=change.value,
                current_changed=change.current_changed,
                in_hubspot=change.state == "landed",
            )
            for change in card.changes
        ],
        tasks=[
            CallNoteTask(
                id=task.id,
                subject=task.subject,
                due=task.due,
                due_words=task.due_words,
                kind=task.kind,
                owner=owners.get(task.owner_id) if task.owner_id else None,
                in_hubspot=task.state == "landed",
            )
            for task in card.tasks
        ],
        left_out=note.left_out,
        steps=steps_of(card, note.status),
        hubspot_url=note.hubspot_url,
        made_by=made_by,
        created_at=note.created_at,
        confirmed_at=note.confirmed_at,
    )


async def notes_out(session: AsyncSession, notes: Sequence[CallNote]) -> list[CallNoteOut]:
    """The notes, with who logged each and who each follow-up is for, in two reads."""
    cards = {note.id: NoteCard.model_validate(note.card or {}) for note in notes}
    makers = {note.made_by for note in notes if note.made_by is not None}
    names: dict[uuid.UUID, str] = {}
    if makers:
        rows = await session.execute(select(User.id, User.name).where(User.id.in_(makers)))
        names = {user_id: name for user_id, name in rows.all()}
    wanted = {task.owner_id for card in cards.values() for task in card.tasks if task.owner_id}
    owners: dict[str, str] = {}
    if wanted:
        rows_owners = await session.execute(
            select(HubSpotOwner.owner_id, HubSpotOwner.name).where(
                HubSpotOwner.owner_id.in_(wanted)
            )
        )
        owners = {owner_id: name for owner_id, name in rows_owners.all() if name}
    return [
        note_out(
            note,
            cards[note.id],
            made_by=names.get(note.made_by) if note.made_by is not None else None,
            owners=owners,
        )
        for note in notes
    ]


async def one_out(session: AsyncSession, note: CallNote) -> CallNoteOut:
    [out] = await notes_out(session, [note])
    return out


# --- Options and what sending waits for -----------------------------------------------------------


def ai_sorts(settings: Settings) -> bool:
    """Claude sorts a note: its switch is on and Claude is set up."""
    key = settings.anthropic_api_key
    return settings.call_notes_ai_enabled and key is not None and bool(key.get_secret_value())


@dataclass(frozen=True)
class Sending:
    ready: bool
    waiting_for: str | None  # in plain words, when it isn't ready


def sending_state(app: FastAPI, settings: Settings) -> Sending:
    """Whether a confirmed note can go to HubSpot now, and what it waits for. It never calls
    HubSpot: it reads the key, the write switch, and a connection check already made."""
    if not hubspot_set_up(app):
        return Sending(ready=False, waiting_for=WAITING_FOR_HUBSPOT)
    if not settings.hubspot_write_enabled:
        return Sending(ready=False, waiting_for=WAITING_FOR_WRITES)
    checked = getattr(app.state, "hubspot_check", None)  # (check, when): the Admin page's cache
    if checked is not None:
        specs = [spec for spec in getattr(app.state, "apps", []) if spec.name == APP]
        for state in project_readiness(specs, checked[0], settings):
            if state.sending in ("waiting", "off"):
                return Sending(ready=False, waiting_for=WAITING_FOR_WRITES)
    return Sending(ready=True, waiting_for=None)


def options(app: FastAPI, settings: Settings) -> CallNoteOptions:
    sending = sending_state(app, settings)
    return CallNoteOptions(
        enabled=settings.call_notes_enabled,
        ai_enabled=ai_sorts(settings),
        sending_ready=sending.ready,
        waiting_for=sending.waiting_for,
        outcomes=list(get_args(OutcomeName)),
        fields=[
            NoteFieldOption(id=field.id, label=field.label, kind=field.kind)
            for field in note_fields()
        ],
        soft_seconds=settings.notes_soft_seconds,
        max_chars=settings.notes_max_chars,
    )


# --- Saving a note ------------------------------------------------------------------------------


async def company_named(
    session: AsyncSession, key: str, leads: Sequence[CompanyLeads]
) -> str | None:
    """The company's name, when it is open to this person: in our HubSpot copy, or a lead of a
    project whose tick they have. None otherwise."""
    if not valid_key(key):
        return None
    if not key.startswith("lead:"):
        company = await session.get(HubSpotCompany, key)
        return company.name if company is not None else None
    try:
        lead_id = uuid.UUID(key.removeprefix("lead:"))
    except ValueError:
        return None
    for hook in leads:
        info = await hook.detail(session, None, lead_id)
        if info is not None:
            return info.name or "Unnamed company"
    return None


async def person_at(session: AsyncSession, key: str, contact_id: str) -> HubSpotContact:
    """One of the company's people in our copy (a 422 in plain words otherwise)."""
    contact = await session.get(HubSpotContact, contact_id)
    if contact is None or key.startswith("lead:") or contact.hubspot_company_id != key:
        raise refused(
            "That person isn't at this company",
            "Pick someone from this company's people, or leave the person out.",
            code="person_not_at_company",
        )
    return contact


async def _by_key(session: AsyncSession, maker: uuid.UUID | None, key: str) -> CallNote | None:
    who = CallNote.made_by == maker if maker is not None else CallNote.made_by.is_(None)
    found: CallNote | None = await session.scalar(
        select(CallNote).where(who, CallNote.idempotency_key == key)
    )
    return found


async def save_note(
    session: AsyncSession,
    body: CallNoteIn,
    *,
    auth: AuthContext | None,
    settings: Settings,
    leads: Sequence[CompanyLeads],
    idempotency_key: str | None,
    now: datetime,
) -> tuple[CallNote, bool]:
    """Saves a note, and says whether it is new. The same person and key give back the first
    note. With the AI on it is saved `sorting` (the caller starts the sorter); with it off, or
    with no words to sort (just an outcome), it goes to the rep's batch at once, sorted by hand."""
    maker = maker_of(auth)
    if idempotency_key is not None:
        first = await _by_key(session, maker, idempotency_key)
        if first is not None:
            return first, False
    name = await company_named(session, body.company_key, leads)
    if name is None:
        raise company_not_found()
    text = body.text.strip()
    if not text and body.outcome is None:  # "No answer" needs no words, but something must be said
        raise refused(
            "Nothing to save",
            "Write or say something, or pick how the call went.",
            code="note_empty",
        )
    if len(text) > settings.notes_max_chars:
        raise refused(
            "This note is too long",
            f"This note is longer than {settings.notes_max_chars:,} characters. Shorten it, or "
            "split it into two notes.",
            code="note_too_long",
        )
    if body.called_at > now + FUTURE_GRACE:
        raise refused(
            "That call is in the future", "Check the call's date and time.", code="called_later"
        )
    contact = (
        await person_at(session, body.company_key, body.contact_id) if body.contact_id else None
    )
    if body.prep_id is not None:
        prep = await session.get(Prep, body.prep_id)
        if prep is None or prep.company_key != body.company_key:
            raise refused(
                "We can't find that call prep",
                "It may have been removed. Save the note without it.",
                code="prep_not_found",
            )
    sorts = ai_sorts(settings) and bool(text)  # no words: nothing for Claude to sort
    note = CallNote(
        made_by=maker,
        idempotency_key=idempotency_key,
        company_key=body.company_key,
        company_name=name,
        contact_id=contact.hubspot_id if contact is not None else None,
        person_name=contact.name if contact is not None else None,
        person_title=contact.job_title if contact is not None else None,
        prep_id=body.prep_id,
        text=scrub(text),
        source=body.source,
        called_at=body.called_at.astimezone(UTC),
        status="sorting" if sorts else "to_confirm",
        # The rep's own pick, kept on the card: it wins over the sorter's.
        card={"call": {"summary": "", "outcome": body.outcome}},
    )
    if not sorts:  # free: code finds the person the note names, and the rep sorts it by hand
        if contact is None and not body.company_key.startswith("lead:"):
            match_person(note, await people_of(session, body.company_key))
        settle_by_hand(note, now)
    session.add(note)
    try:
        await session.commit()
    except IntegrityError:
        # A second press with the same key won the race: the unique index allows one note.
        await session.rollback()
        first = await _by_key(session, maker, idempotency_key) if idempotency_key else None
        if first is None:
            raise
        return first, False
    return note, True


# --- Reading notes -----------------------------------------------------------------------------


async def _settle_stuck(
    session: AsyncSession,
    notes: Sequence[CallNote],
    sorter: NoteSorter,
    sender: NoteSender,
    now: datetime,
) -> None:
    """Notes a restart left "sorting" go to the rep's batch, to be sorted by hand. Notes it left
    "sending" take what their write says, and what was never sent goes back to the rep."""
    stuck = [note for note in notes if is_stuck(note, sorter, now)]
    for note in stuck:
        settle_stuck(note, now)
    cut = [note for note in notes if sending_stuck(note, sender, now)]
    for note in cut:
        locked = await session.get(CallNote, note.id, with_for_update=True, populate_existing=True)
        if locked is not None and sending_stuck(locked, sender, now):
            await settle_cut_off(session, locked, now, unsure=STOPPED_MID_SEND, failed=None)
    if stuck or cut:
        await session.commit()


async def get_note(
    session: AsyncSession,
    note_id: uuid.UUID,
    auth: AuthContext | None,
    sorter: NoteSorter,
    sender: NoteSender,
    now: datetime,
) -> CallNoteOut:
    note = await read_note(session, note_id, auth)
    await _settle_stuck(session, [note], sorter, sender, now)
    return await one_out(session, note)


async def list_notes(
    session: AsyncSession,
    auth: AuthContext | None,
    *,
    state: NoteState | None,
    company_key: str | None,
    mine: bool,
    limit: int,
    offset: int,
    sorter: NoteSorter,
    sender: NoteSender,
    now: datetime,
) -> CallNotePage:
    """A page of notes. Only an Admin sees other people's (`mine` false). To confirm: the unsure
    ones first, then the oldest call first. Logged and needs a look: the newest call first."""
    statement = select(CallNote)
    if auth is not None and (mine or auth.user.role != "admin"):
        statement = statement.where(CallNote.made_by == auth.user.id)
    if state is not None:
        statement = statement.where(CallNote.status.in_(STATES[state]))
    if company_key is not None:
        statement = statement.where(CallNote.company_key == company_key)
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    if state == "to_confirm":
        unsure_last = CallNote.card["unsure"].astext.is_(None)
        statement = statement.order_by(unsure_last, CallNote.called_at, CallNote.id)
    else:
        statement = statement.order_by(CallNote.called_at.desc(), CallNote.id)
    notes = list(await session.scalars(statement.offset(offset).limit(limit)))
    await _settle_stuck(session, notes, sorter, sender, now)
    return CallNotePage(total=total or 0, items=await notes_out(session, notes))


def melbourne_day_start(now: datetime) -> datetime:
    """The start of today in Melbourne, in UTC."""
    local = now.astimezone(MELBOURNE)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


async def summary(
    session: AsyncSession, auth: AuthContext | None, now: datetime
) -> CallNoteSummary:
    """The counts for Home and the menu, for this person's own notes."""
    mine = [CallNote.made_by == auth.user.id] if auth is not None else []
    rows = await session.execute(
        select(CallNote.status, func.count()).where(*mine).group_by(CallNote.status)
    )
    counts: dict[str, int] = {status: count for status, count in rows.all()}
    logged_today = await session.scalar(
        select(func.count())
        .select_from(CallNote)
        .where(
            *mine,
            CallNote.status == "logged",
            CallNote.finished_at >= melbourne_day_start(now),
        )
    )
    return CallNoteSummary(
        to_confirm=counts.get("sorting", 0) + counts.get("to_confirm", 0),
        needs_look=sum(counts.get(status, 0) for status in STATES["needs_look"]),
        logged_today=logged_today or 0,
    )


# --- The rep's edits ----------------------------------------------------------------------------


def _card_text(text: str, *, lines: bool = False) -> str:
    """Text the rep wrote on the card: spaces tidied, no contact details."""
    if lines:
        kept = [" ".join(line.split()) for line in scrub(text).strip().splitlines()]
        return "\n".join(line for line in kept if line)
    return " ".join(scrub(text).split())


def _next_id(prefix: str, used: set[str]) -> str:
    number = 1
    while f"{prefix}{number}" in used:
        number += 1
    used.add(f"{prefix}{number}")
    return f"{prefix}{number}"


async def _offices(session: AsyncSession, key: str) -> list[OfficeChoice]:
    if key.startswith("lead:"):
        return []
    rows = await session.scalars(
        select(HubSpotOffice).where(HubSpotOffice.hubspot_company_id == key)
    )
    return office_choices(list(rows))


def part_sent(what: str) -> Problem:
    return Problem(
        409,
        "Already in HubSpot",
        f"{what} is in HubSpot already, so it can't change here.",
        code="part_sent",
    )


def _same_value(old: CardChange, item: CallNoteChangeIn, today: date) -> bool:
    office = (item.office or "").strip().casefold()
    value, _ = field_value(old.field, item.value, today)
    return (
        item.field == old.field
        and office in (old.office.casefold(), old.office_label.casefold())
        and value == old.value
    )


def _edited_changes(
    sent: Sequence[CallNoteChangeIn],
    before: Sequence[CardChange],
    *,
    today: date,
    offices: Sequence[OfficeChoice],
    in_hubspot: bool,
) -> list[CardChange]:
    """The card's new list of changes, each checked as the sorter checks one. One already in
    HubSpot stays as it is. One the rep kept as it was keeps its state and the words said."""
    earlier = {change.id: change for change in before}
    landed = [change for change in before if change.state == "landed"]
    used = {change.id for change in landed} | {item.id for item in sent if item.id in earlier}
    seen = {(change.field, change.office_label.casefold()) for change in landed}
    out: list[CardChange] = list(landed)  # what is in HubSpot stays
    for item in sent:
        old = earlier.get(item.id) if item.id else None
        if old is not None and old.state == "landed":
            if not _same_value(old, item, today):
                raise part_sent(f"{old.office} {old.label.lower()}")
            continue
        if old is not None and _same_value(old, item, today):
            checked = old  # as it was: it keeps its state
        else:
            found = check_change(
                item.field,
                item.office or "",
                item.value,
                old.said if old is not None else "",
                today=today,
                offices=offices,
                in_hubspot=in_hubspot,
            )
            if isinstance(found, Dropped):
                what = found.what[:1].upper() + found.what[1:]
                raise refused(
                    "This change can't be made", f"{what}: {found.why}.", code="change_not_possible"
                )
            same = old is not None and old.value == found.value
            fresher = (
                old is not None
                and old.current_changed
                and (old.field, old.office_label) == (found.field, found.office_label)
            )
            checked = found.model_copy(
                update={
                    "id": old.id if old is not None else _next_id("c", used),
                    "said": found.said if same else "",
                    **(
                        {"current": old.current, "current_changed": True}
                        if fresher and old is not None
                        else {}
                    ),
                }
            )
        key = (checked.field, checked.office_label.casefold())
        if key in seen:
            raise refused(
                "One field, two changes",
                f"{checked.office} {checked.label.lower()} is changed twice. Keep one.",
                code="change_twice",
            )
        seen.add(key)
        out.append(checked)
    return out


async def _edited_tasks(
    session: AsyncSession, sent: Sequence[CallNoteTaskIn], before: Sequence[CardTask], today: date
) -> list[CardTask]:
    """The card's new list of follow-ups. None is due before today (Melbourne). One already in
    HubSpot stays as it is. One the rep kept as it was keeps its state. `due_words` are the rep's
    words for the day; left out, they stay while the day is the same."""
    owners = {item.owner_id for item in sent if item.owner_id}
    if owners:
        known = set(
            await session.scalars(
                select(HubSpotOwner.owner_id).where(HubSpotOwner.owner_id.in_(owners))
            )
        )
        if owners - known:
            raise refused(
                "We can't find that person in HubSpot",
                "Pick who the follow-up is for from the list, or leave it with you.",
                code="owner_not_found",
            )
    earlier = {task.id: task for task in before}
    landed = [task for task in before if task.state == "landed"]
    used = {task.id for task in landed} | {item.id for item in sent if item.id in earlier}
    out: list[CardTask] = list(landed)  # what is in HubSpot stays
    for item in sent:
        subject = _card_text(item.subject)
        old = earlier.get(item.id) if item.id else None
        if old is not None and old.state == "landed":
            if (subject, item.due, item.kind) != (old.subject, old.due, old.kind):
                raise part_sent(f"The task '{old.subject}'")
            continue
        if not subject:
            raise refused(
                "A follow-up needs words", "Say what the follow-up is.", code="task_empty"
            )
        if item.due < today:
            raise refused(
                "That day has passed",
                "A follow-up can't be due before today. Pick today or a later day.",
                code="task_in_past",
            )
        if item.due_words is not None:
            words = _card_text(item.due_words)[:NOTE_VALUE_MAX_CHARS]
        else:
            words = old.due_words if old is not None and old.due == item.due else ""
        task = CardTask(
            id=old.id if old is not None else _next_id("t", used),
            subject=subject,
            due=item.due,
            due_words=words,
            kind=item.kind,
            owner_id=item.owner_id,
        )
        kept = old is not None and task.model_dump(exclude=SENT_FIELDS) == old.model_dump(
            exclude=SENT_FIELDS
        )
        out.append(old if kept and old is not None else task)
    return out


async def edit_note(
    session: AsyncSession, note: CallNote, patch: CallNotePatch, now: datetime
) -> None:
    """The rep's edits to a note waiting for them, or to the parts not yet in HubSpot of a note
    that failed or was partly saved. Each change and follow-up is checked as the sorter checks
    them. The card is marked edited; `sorted` keeps what the sorter made."""
    if note.status == "sorting":
        raise still_sorting()
    if note.status not in CHANGEABLE:
        raise already_sent(note.status)
    given = patch.model_fields_set
    card = NoteCard.model_validate(note.card or {})
    today = now.astimezone(MELBOURNE).date()
    in_hubspot = not note.company_key.startswith("lead:")
    summary = _card_text(patch.summary or "", lines=True) if "summary" in given else None
    if card.call.state == "landed" and (
        (summary is not None and summary != card.call.summary)
        or ("outcome" in given and patch.outcome != card.call.outcome)
        or ("contact_id" in given and (patch.contact_id or None) != note.contact_id)
    ):
        raise part_sent("The call")
    if summary is not None:
        card.call.summary = summary
    if "outcome" in given:
        card.call.outcome = patch.outcome
    if "changes" in given:
        offices = await _offices(session, note.company_key)
        card.changes = _edited_changes(
            patch.changes or [], card.changes, today=today, offices=offices, in_hubspot=in_hubspot
        )
    if "tasks" in given:
        card.tasks = await _edited_tasks(session, patch.tasks or [], card.tasks, today)
    if "contact_id" in given and (patch.contact_id or None) != note.contact_id:
        contact = (
            await person_at(session, note.company_key, patch.contact_id)
            if patch.contact_id
            else None
        )
        note.contact_id = contact.hubspot_id if contact is not None else None
        note.person_name = contact.name if contact is not None else None
        note.person_title = contact.job_title if contact is not None else None
    if "left_out" in given and patch.left_out is not None:
        note.left_out = patch.left_out
    if given & CARD_PARTS:  # what the rep changed of what the sorter made (T2-8 compares them)
        card.edited = True
        note.card = card.model_dump(mode="json")
    await session.commit()


async def remove_note(session: AsyncSession, note: CallNote, sorter: NoteSorter) -> None:
    """Removes a note not yet sent (the toast's Undo). A sort still running is stopped first;
    what it spent stays in the search log."""
    if note.status not in REMOVABLE:
        raise already_sent(note.status)
    note_id, sorting = note.id, note.status == "sorting"
    await session.commit()  # no connection waits while the sort stops
    if sorting:
        await sorter.cancel(note_id)
    # Only while it is still unsent: the database decides, not the copy read before the wait.
    gone: CursorResult[Any] = await session.execute(  # type: ignore[assignment]
        delete(CallNote)
        .where(CallNote.id == note_id, CallNote.status.in_(REMOVABLE))
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    if not gone.rowcount:
        left = await session.get(CallNote, note_id, populate_existing=True)
        raise already_sent(left.status) if left is not None else note_not_found()


# --- Sending (the batch is note_batch.py) ---------------------------------------------------------

NOT_SENDABLE: Final = {
    "sorting": "It is still being sorted.",
    "sending": "It is being sent now.",
    "logged": "It is in HubSpot already.",
    "uncertain": "Check HubSpot first, then tell us whether it's there.",
}


async def batch_notes(
    session: AsyncSession,
    ids: Sequence[uuid.UUID],
    auth: AuthContext | None,
    *,
    allowed: tuple[str, ...],
    skip_left_out: bool,
) -> tuple[list[CallNote], list[CallNoteSkipped]]:
    """The notes to preview or send, in the order given, and the rest with why. A company that
    isn't in HubSpot yet is the rest too."""
    notes: list[CallNote] = []
    skipped: list[CallNoteSkipped] = []
    for note_id in dict.fromkeys(ids):
        note = await session.get(CallNote, note_id)
        why: str | None = None
        if note is None or not may_read(note, auth):
            why = "We can't find this note."
        elif not may_change(note, auth):
            why = "Only the person who logged this call can send it."
        elif note.status not in allowed:
            why = NOT_SENDABLE.get(note.status, "It can't be sent now.")
        elif skip_left_out and note.left_out:
            why = "You left it out of this send."
        elif note.company_key.startswith("lead:"):
            why = LEAD_ONLY
        if why is None and note is not None:
            notes.append(note)
        else:
            skipped.append(CallNoteSkipped(id=note_id, why=why or "It can't be sent now."))
    return notes, skipped


async def refresh_current(session: AsyncSession, note: CallNote) -> None:
    """Each change's `current` from our copy now, when HubSpot can't be asked. One that moved
    since the rep saw it says so."""
    card = NoteCard.model_validate(note.card or {})
    if not card.changes or note.company_key.startswith("lead:"):
        return
    offices = {
        office.label.casefold(): office for office in await _offices(session, note.company_key)
    }
    moved = False
    for change in card.changes:
        if change.state == "landed":
            continue
        office = offices.get(change.office_label.casefold())
        now_value = office.current.get(change.field) if office is not None else None
        if now_value != change.current:
            change.current = now_value
            change.current_changed = True
            moved = True
    if moved:
        note.card = card.model_dump(mode="json")


async def preview(
    session: AsyncSession,
    ids: Sequence[uuid.UUID],
    auth: AuthContext | None,
    *,
    app: FastAPI,
    settings: Settings,
    sender: NoteSender,
) -> CallNotePreview:
    """Each note with what HubSpot has now, read through the writer's preview; what sending
    them would add; and what sending waits for. While HubSpot can't be written, "now" is our
    copy's value. Nothing is written to HubSpot."""
    items, skipped = await batch_notes(
        session, ids, auth, allowed=("to_confirm", "partial", "failed"), skip_left_out=False
    )
    sending = sending_state(app, settings)
    missed = {note.id for note in items}
    if sending.ready and items:
        await session.commit()  # no connection waits on HubSpot
        ready, missed = await sender.preview([note.id for note in items])
        if not ready:
            sending = Sending(ready=False, waiting_for=WAITING_FOR_WRITES)
        fresh = [await session.get(CallNote, note.id, populate_existing=True) for note in items]
        items = [note for note in fresh if note is not None]
    for note in items:
        if note.id in missed:
            await refresh_current(session, note)
    await session.commit()
    return CallNotePreview(
        items=await notes_out(session, items),
        sending_ready=sending.ready,
        waiting_for=sending.waiting_for,
        totals=totals_of(
            NoteCard.model_validate(note.card or {}) for note in items if not note.left_out
        ),
        skipped=skipped,
    )


def already_sending() -> Problem:
    return Problem(409, "Already sending", ALREADY_SENDING, code="already_sending")


async def confirm(
    session: AsyncSession,
    ids: Sequence[uuid.UUID],
    auth: AuthContext | None,
    *,
    app: FastAPI,
    settings: Settings,
    sender: NoteSender,
    now: datetime,
) -> CallNoteConfirm:
    """Marks the notes `sending` and starts the batch: one note after another, in the order
    given, in the background. While a batch runs, a second press starts nothing and says so.
    Nothing is sent while sending waits for HubSpot (409)."""
    sending = sending_state(app, settings)
    if not sending.ready:
        raise writes_off(sending.waiting_for or WAITING_FOR_WRITES)
    batch_id = sender.claim()
    if batch_id is None:
        return CallNoteConfirm(
            sending=0, already_sending=True, batch_id=sender.batch_id, notes=[], skipped=[]
        )
    try:
        notes, skipped = await batch_notes(
            session, ids, auth, allowed=("to_confirm",), skip_left_out=True
        )
        claimed: list[CallNote] = []
        for note in notes:
            # Under a lock, so a second tab's press can't send the same note twice.
            locked = await session.get(
                CallNote, note.id, with_for_update=True, populate_existing=True
            )
            if locked is None or locked.status != "to_confirm" or locked.left_out:
                skipped.append(CallNoteSkipped(id=note.id, why=NOT_SENDABLE["sending"]))
                continue
            mark_sending(locked, now)
            claimed.append(locked)
        await session.commit()
    except BaseException:
        sender.release()
        raise
    if not claimed:
        sender.release()
        return CallNoteConfirm(
            sending=0, already_sending=False, batch_id=None, notes=[], skipped=skipped
        )
    sender.launch([note.id for note in claimed])
    return CallNoteConfirm(
        sending=len(claimed),
        already_sending=False,
        batch_id=batch_id,
        notes=await notes_out(session, claimed),
        skipped=skipped,
    )


async def retry(
    session: AsyncSession,
    note: CallNote,
    *,
    app: FastAPI,
    settings: Settings,
    sender: NoteSender,
    now: datetime,
) -> None:
    """Sends again what didn't land, for a note that failed or was partly saved: a held field
    goes with the value the rep has now seen."""
    if note.status == "uncertain":
        raise Problem(
            409,
            "Check HubSpot first",
            "Tell us whether HubSpot has it. Then you can send it again.",
            code="note_uncertain",
        )
    if note.status not in ("failed", "partial"):
        raise nothing_to_retry()
    sending = sending_state(app, settings)
    if not sending.ready:
        raise writes_off(sending.waiting_for or WAITING_FOR_WRITES)
    if sender.claim() is None:
        raise already_sending()
    try:
        locked = await session.get(CallNote, note.id, with_for_update=True, populate_existing=True)
        if locked is None or locked.status not in ("failed", "partial"):
            raise nothing_to_retry()
        mark_sending(locked, now)
        await session.commit()
    except BaseException:
        sender.release()
        raise
    sender.launch([locked.id])


def nothing_to_retry() -> Problem:
    return Problem(
        409,
        "Nothing to send again",
        "Only a note that failed, or was partly saved, can be sent again.",
        code="nothing_to_retry",
    )


async def resolve(
    session: AsyncSession, note: CallNote, step: str, landed: bool, *, sender: NoteSender
) -> None:
    """A person says whether a step HubSpot may or may not have saved is there. The writer
    settles the step, and the note's status follows: not there, and a retry sends it again."""
    if note.status != "uncertain" or note.write_id is None:
        raise Problem(
            409,
            "Nothing to check",
            "Only a note that HubSpot may or may not have saved needs this.",
            code="nothing_to_resolve",
        )
    if step not in unsure_steps(NoteCard.model_validate(note.card or {})):
        raise Problem(
            409,
            "Nothing to check there",
            "HubSpot gave a clear answer for that step. Pick a step marked unsure.",
            code="step_not_unsure",
        )
    await sender.resolve(session, note.id, note.write_id, step, landed)
