"""The call notes routes (PLAN-V17 T2-5, the contract's part 2), under /api/v1/companies.

Behind the Companies tick, like every Companies route. Every route but `GET /call-notes/options`
answers 409 `call_notes_off` while call notes are switched off. A rep reads and changes their own
notes. An Admin reads everyone's (TBC: a team view), but only the person who logged a call
changes, removes or sends it.

The fixed paths (options, summary, preview, confirm) come before `/call-notes/{note_id}`. The
service is note_store.py, the sorter notes.py, and the batch to HubSpot note_batch.py.
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response

from apps.companies import note_store
from apps.companies.deps import LeadsDep
from apps.companies.note_batch import NoteSender
from apps.companies.notes import NoteSorter
from apps.companies.schemas import (
    CallNoteConfirm,
    CallNoteIds,
    CallNoteIn,
    CallNoteOptions,
    CallNoteOut,
    CallNotePage,
    CallNotePatch,
    CallNotePreview,
    CallNoteResolve,
    CallNoteSummary,
    NoteState,
    OutcomeFilter,
)
from core.api.access import SignedInDep
from core.api.deps import SessionDep, SettingsDep
from core.api.models import OFFSET_MAX, SafeText
from core.api.runs import IDEMPOTENCY_PATTERN
from core.api.signin import NowDep
from core.claude.client import get_claude
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.hubspot.client import HubSpotWritesOff
from core.hubspot.connection import open_hubspot

router = APIRouter()
PAGE_SIZE = 50


def note_sorter(request: Request) -> NoteSorter:
    """The app's note sorter, made on first use. A test puts its own in app.state."""
    sorter: NoteSorter | None = getattr(request.app.state, "note_sorter", None)
    if sorter is None:
        sessions = getattr(request.app.state, "session_factory", None) or get_sessionmaker()
        sorter = NoteSorter(sessions=sessions, claude=get_claude)
        request.app.state.note_sorter = sorter
    return sorter


def note_sender(request: Request) -> NoteSender:
    """The app's sender of call notes to HubSpot, made on first use. A test puts its own in
    app.state, with a fake writer."""
    sender: NoteSender | None = getattr(request.app.state, "note_sender", None)
    if sender is None:
        app = request.app
        sessions = getattr(app.state, "session_factory", None) or get_sessionmaker()
        sender = NoteSender(sessions=sessions, hubspot=lambda: open_hubspot(app))
        app.state.note_sender = sender
    return sender


async def notes_on(settings: SettingsDep) -> Settings:
    """The settings in use, once call notes are on (409 `call_notes_off` while they are off)."""
    if not settings.call_notes_enabled:
        raise note_store.call_notes_off()
    return settings


SorterDep = Annotated[NoteSorter, Depends(note_sorter)]
SenderDep = Annotated[NoteSender, Depends(note_sender)]
NotesOnDep = Annotated[Settings, Depends(notes_on)]
NoteId = Annotated[uuid.UUID, Path(description="The note's id")]


@router.get(
    "/call-notes/options",
    response_model=CallNoteOptions,
    summary="What Log call offers",
    description=(
        "Whether call notes are on, whether Claude sorts a note, whether sending to HubSpot is "
        "ready (and what it waits for, in plain words), the call outcomes, the fields a call may "
        "change, when the timer turns Ochre, the longest note, the longest meeting transcript, "
        "and which voice to text tool the mic uses. The browser's own speech service "
        "(`browser_service`) sends the voice to Google or Microsoft, so until the server allows "
        "it (Levi's OK) a saved or server value of it comes as `browser_model`, Whisper in the "
        "browser. It answers while call notes are off too."
    ),
)
async def call_note_options(request: Request, settings: SettingsDep) -> CallNoteOptions:
    return note_store.options(request.app, settings)


@router.get(
    "/call-notes/summary",
    response_model=CallNoteSummary,
    summary="My call note counts",
    description=(
        "For Home and the menu: my notes to confirm (being sorted, or waiting for me), those "
        "that need a look (failed, partly saved, or unsure in HubSpot), and those logged today, "
        "Melbourne time. 409 `call_notes_off`."
    ),
)
async def call_note_summary(
    session: SessionDep, settings: NotesOnDep, auth: SignedInDep, now: NowDep
) -> CallNoteSummary:
    return await note_store.summary(session, auth, now)


@router.post(
    "/call-notes/preview",
    response_model=CallNotePreview,
    summary="Check notes before sending",
    description=(
        "For a list of my notes (waiting to be sent, or the parts not yet sent of a note that "
        "failed or was partly saved): each one with what HubSpot has now for every change, read "
        "through the writer's preview (while HubSpot can't be written, our copy's value), "
        "whether sending is ready, and `totals`: the calls, follow-ups and field changes "
        "sending would add. A change whose value moved since I saw it says so "
        "(`current_changed`). Notes that can't be sent are in `skipped`, with why. Nothing is "
        "written. 409 `call_notes_off`."
    ),
)
async def preview_call_notes(
    body: CallNoteIds,
    request: Request,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sender: SenderDep,
) -> CallNotePreview:
    return await note_store.preview(
        session, body.ids, auth, app=request.app, settings=settings, sender=sender
    )


@router.post(
    "/call-notes/confirm",
    response_model=CallNoteConfirm,
    status_code=202,
    summary="Send notes to HubSpot",
    description=(
        "Sends my notes to HubSpot, one after another, in the background, in the order given, "
        "each as one record (one failure never fails the rest). It answers at once: `sending` "
        "is how many started. While a batch is being sent, a second press starts nothing and "
        "says so (`already_sending`, still 202). A note left out, not mine, not waiting to be "
        "sent, or for a company not in HubSpot yet is in `skipped`, with why. 409 "
        "`hubspot_writes_off` while sending waits for HubSpot write access: nothing is sent. "
        "409 `call_notes_off`."
    ),
)
async def confirm_call_notes(
    body: CallNoteIds,
    request: Request,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sender: SenderDep,
    now: NowDep,
) -> CallNoteConfirm:
    return await note_store.confirm(
        session, body.ids, auth, app=request.app, settings=settings, sender=sender, now=now
    )


@router.get(
    "/call-notes",
    response_model=CallNotePage,
    summary="My call notes",
    description=(
        "A page of notes. `state`: `to_confirm` (being sorted, waiting for me, or being sent), "
        "`logged`, `needs_look` (failed, partly saved, or unsure in HubSpot), or `history` "
        "(every one of my own notes, in any status, for History in Call logs). `mine` is true "
        "by default: `mine=false` shows everyone's notes to an Admin, and anyone else still gets "
        "only their own; History is always my own. Filters, for any state: `q` (each word must "
        "start a word of the company's name, the person's name, the note or the summary), "
        "`outcome` (one of the call outcomes, or `none`), and `since` and `until` (Melbourne "
        "days, both counted). To confirm: the notes the sorter was unsure of first, then the "
        "oldest call first. Otherwise the newest call first. 422 `dates_out_of_order` when "
        "`since` is after `until`. 409 `call_notes_off`."
    ),
)
async def list_call_notes(
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sorter: SorterDep,
    sender: SenderDep,
    now: NowDep,
    state: NoteState | None = None,
    company_key: Annotated[SafeText | None, Query(max_length=64)] = None,
    mine: bool = True,
    q: Annotated[SafeText | None, Query(max_length=200)] = None,
    outcome: OutcomeFilter | None = None,
    since: Annotated[date | None, Query(description="A Melbourne day, counted")] = None,
    until: Annotated[date | None, Query(description="A Melbourne day, counted")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> CallNotePage:
    return await note_store.list_notes(
        session,
        auth,
        state=state,
        company_key=company_key or None,
        mine=mine,
        limit=limit,
        offset=offset,
        sorter=sorter,
        sender=sender,
        now=now,
        filters=note_store.NoteFilters(q=q or None, outcome=outcome, since=since, until=until),
    )


@router.post(
    "/call-notes",
    response_model=CallNoteOut,
    status_code=201,
    summary="Log a call",
    description=(
        "Saves a note after a call. The text may be empty when an outcome is picked (No "
        "answer needs no words). An email address or a phone number in it is saved as "
        "[email left out] or [number left out]. With Claude sorting, a note with words comes "
        "back `sorting` and is sorted in the background; otherwise it is ready to confirm at "
        "once, and the rep adds the outcome and any follow-ups. Send an `Idempotency-Key`: the "
        "same key from the "
        "same person gives back the first note (200), so a double press is one note. 404 "
        "`company_not_found`. 422 `note_too_long`, `note_empty`, `person_not_at_company`, "
        "`prep_not_found` or `called_later`. 409 `call_notes_off`."
    ),
    responses={200: {"model": CallNoteOut, "description": "The note saved first with this key"}},
)
async def save_call_note(
    body: CallNoteIn,
    response: Response,
    session: SessionDep,
    settings: NotesOnDep,
    leads: LeadsDep,
    auth: SignedInDep,
    sorter: SorterDep,
    now: NowDep,
    idempotency_key: Annotated[
        str | None,
        Header(
            min_length=1,
            max_length=64,
            pattern=IDEMPOTENCY_PATTERN,
            description="Any unique text (a UUID is fine). The same key gives back the same note",
        ),
    ] = None,
) -> CallNoteOut:
    note, new = await note_store.save_note(
        session,
        body,
        auth=auth,
        settings=settings,
        leads=leads,
        idempotency_key=idempotency_key,
        now=now,
    )
    if new and note.status == "sorting":
        sorter.start(note.id)
    if not new:
        response.status_code = 200
    return await note_store.one_out(session, note)


@router.get(
    "/call-notes/{note_id}",
    response_model=CallNoteOut,
    summary="One call note",
    description=(
        "Mine, or anyone's for an Admin. A note left `sorting` by a restart goes to the batch "
        "to be sorted by hand. A note left `sending` by a restart takes what its write says, "
        "and what was never sent goes back to me. 404 `note_not_found`. 409 `call_notes_off`."
    ),
)
async def get_call_note(
    note_id: NoteId,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sorter: SorterDep,
    sender: SenderDep,
    now: NowDep,
) -> CallNoteOut:
    return await note_store.get_note(session, note_id, auth, sorter, sender, now)


@router.patch(
    "/call-notes/{note_id}",
    response_model=CallNoteOut,
    summary="Change a call note",
    description=(
        "My edits while the note waits for me, or to the parts not yet in HubSpot of a note "
        "that failed or was partly saved: the summary, the outcome, the person, the changes, "
        "the follow-ups (with `due_words`, the words the day came from), and `left_out`. Only "
        "the parts sent change. Each change is checked as the sorter checks one (a listed "
        "field, an office the company has, a value that can be read), and no follow-up is due "
        "before today. 409 `note_sorting` while it is being sorted, `note_sent` while it is "
        "being sent or once it is logged, `part_sent` for a part already in HubSpot. 422 "
        "`change_not_possible`, "
        "`change_twice`, `task_in_past`, `task_empty`, `owner_not_found` or "
        "`person_not_at_company`. 403 `not_your_note` for an Admin's look at someone else's. "
        "404 `note_not_found`. 409 `call_notes_off`."
    ),
)
async def edit_call_note(
    note_id: NoteId,
    body: CallNotePatch,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    now: NowDep,
) -> CallNoteOut:
    note = await note_store.read_note(session, note_id, auth, change=True)
    await note_store.edit_note(session, note, body, now)
    return await note_store.one_out(session, note)


@router.delete(
    "/call-notes/{note_id}",
    status_code=204,
    summary="Remove a call note",
    description=(
        "Removes my note before it is sent (the toast's Undo), or a note that failed with "
        "nothing in HubSpot. A sort still running stops first. 409 `note_sent` while it is "
        "being sent, or once any part of it is in HubSpot or may be. 403 `not_your_note`, 404 "
        "`note_not_found`, 409 `call_notes_off`."
    ),
)
async def delete_call_note(
    note_id: NoteId,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sorter: SorterDep,
) -> Response:
    note = await note_store.read_note(session, note_id, auth, change=True)
    await note_store.remove_note(session, note, sorter)
    return Response(status_code=204)


@router.post(
    "/call-notes/{note_id}/retry",
    response_model=CallNoteOut,
    status_code=202,
    summary="Send a note again",
    description=(
        "Sends what didn't land, for my note that failed or was partly saved: a field held "
        "because HubSpot's value changed goes with the value now shown. It answers at once with "
        "the note being sent. 409 `note_uncertain` until I say whether HubSpot has an unsure "
        "step, `nothing_to_retry` for a note that didn't fail, `already_sending` while a batch "
        "is being sent, and `hubspot_writes_off` while sending waits for HubSpot write access. "
        "422 `change_off_the_list` for a change that isn't one a call may change. "
        "403 `not_your_note`, 404 `note_not_found`, 409 `call_notes_off`."
    ),
)
async def retry_call_note(
    note_id: NoteId,
    request: Request,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sender: SenderDep,
    now: NowDep,
) -> CallNoteOut:
    note = await note_store.read_note(session, note_id, auth, change=True)
    await note_store.retry(
        session, note, app=request.app, settings=settings, sender=sender, now=now
    )
    return await note_store.one_out(session, note)


@router.post(
    "/call-notes/{note_id}/resolve",
    response_model=CallNoteOut,
    summary="Say whether HubSpot has it",
    description=(
        "For a step HubSpot may or may not have saved (HubSpot didn't answer): `step` as the "
        "note's steps name it, and `landed` true when it is there, false when it isn't, so "
        "sending again adds it. The note's status follows. 409 `nothing_to_resolve` for a note "
        "with nothing unsure, `step_not_unsure` for a step HubSpot answered, and "
        "`hubspot_writes_off` while HubSpot can't be written. 403 `not_your_note`, 404 "
        "`note_not_found`, 409 `call_notes_off`."
    ),
)
async def resolve_call_note(
    request: Request,
    note_id: NoteId,
    body: CallNoteResolve,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sender: SenderDep,
) -> CallNoteOut:
    note = await note_store.read_note(session, note_id, auth, change=True)
    try:
        await note_store.resolve(
            session,
            note,
            body.step,
            body.landed,
            app=request.app,
            settings=settings,
            sender=sender,
        )
    except HubSpotWritesOff as error:
        raise note_store.writes_off(error.detail) from None
    return await note_store.one_out(session, note)
