"""The call notes routes (PLAN-V17 T2-5, the contract's part 2), under /api/v1/companies.

Behind the Companies tick, like every Companies route. Every route but `GET /call-notes/options`
answers 409 `call_notes_off` while call notes are switched off. A rep reads and changes their own
notes. An Admin reads everyone's (TBC: a team view), but only the person who logged a call
changes, removes or sends it.

The fixed paths (options, summary, preview, confirm) come before `/call-notes/{note_id}`. The
service is note_store.py, and the sorter notes.py. Sending waits for HubSpot write access: the
batch itself comes in T2-6.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response

from apps.companies import note_store
from apps.companies.deps import LeadsDep
from apps.companies.notes import NoteSorter
from apps.companies.schemas import (
    CallNoteBatch,
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


async def notes_on(settings: SettingsDep) -> Settings:
    """The settings in use, once call notes are on (409 `call_notes_off` while they are off)."""
    if not settings.call_notes_enabled:
        raise note_store.call_notes_off()
    return settings


SorterDep = Annotated[NoteSorter, Depends(note_sorter)]
NotesOnDep = Annotated[Settings, Depends(notes_on)]
NoteId = Annotated[uuid.UUID, Path(description="The note's id")]


@router.get(
    "/call-notes/options",
    response_model=CallNoteOptions,
    summary="What Log call offers",
    description=(
        "Whether call notes are on, whether Claude sorts a note, whether sending to HubSpot is "
        "ready (and what it waits for, in plain words), the call outcomes, the fields a call may "
        "change, when the timer turns Ochre, and the longest note. It answers while call notes "
        "are off too."
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
        "For a list of my notes: each one with what HubSpot has now for every change (until "
        "HubSpot can be written, the value in our copy), and whether sending is ready. A change "
        "whose value moved since I saw it says so (`current_changed`). Notes that can't be sent "
        "are listed in `skipped` with why. Nothing is written. 409 `call_notes_off`."
    ),
)
async def preview_call_notes(
    body: CallNoteIds,
    request: Request,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
) -> CallNotePreview:
    return await note_store.preview(session, body.ids, auth, app=request.app, settings=settings)


@router.post(
    "/call-notes/confirm",
    response_model=CallNoteBatch,
    status_code=202,
    summary="Send notes to HubSpot",
    description=(
        "Sends my notes to HubSpot, one after another, in the background, in the order given. "
        "It answers at once with the notes being sent. A note left out, not mine, or not "
        "waiting to be sent is skipped, with why. 409 `hubspot_writes_off` while sending waits "
        "for HubSpot write access: nothing is sent. 409 `call_notes_off`."
    ),
)
async def confirm_call_notes(
    body: CallNoteIds,
    request: Request,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
) -> CallNoteBatch:
    try:
        return await note_store.confirm(session, body.ids, auth, app=request.app, settings=settings)
    except HubSpotWritesOff as error:
        raise note_store.writes_off(error.detail) from None


@router.get(
    "/call-notes",
    response_model=CallNotePage,
    summary="My call notes",
    description=(
        "A page of notes. `state`: `to_confirm` (being sorted, waiting for me, or being sent), "
        "`logged`, or `needs_look` (failed, partly saved, or unsure in HubSpot). `mine` is true "
        "by default: `mine=false` shows everyone's notes to an Admin, and anyone else still gets "
        "only their own. To confirm: the notes the sorter was unsure of first, then the oldest "
        "call first. Otherwise the newest call first. 409 `call_notes_off`."
    ),
)
async def list_call_notes(
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sorter: SorterDep,
    now: NowDep,
    state: NoteState | None = None,
    company_key: Annotated[SafeText | None, Query(max_length=64)] = None,
    mine: bool = True,
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
        now=now,
    )


@router.post(
    "/call-notes",
    response_model=CallNoteOut,
    status_code=201,
    summary="Log a call",
    description=(
        "Saves a note after a call. An email address or a phone number in it is saved as "
        "[email left out] or [number left out]. With Claude sorting, it comes back `sorting` "
        "and is sorted in the background; otherwise it is ready to confirm at once, and the rep "
        "adds the outcome and any follow-ups. Send an `Idempotency-Key`: the same key from the "
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
        "to be sorted by hand. 404 `note_not_found`. 409 `call_notes_off`."
    ),
)
async def get_call_note(
    note_id: NoteId,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
    sorter: SorterDep,
    now: NowDep,
) -> CallNoteOut:
    return await note_store.get_note(session, note_id, auth, sorter, now)


@router.patch(
    "/call-notes/{note_id}",
    response_model=CallNoteOut,
    summary="Change a call note",
    description=(
        "My edits while the note waits for me: the summary, the outcome, the person, the "
        "changes, the follow-ups, and `left_out`. Only the parts sent change. Each change is "
        "checked as the sorter checks one (a listed field, an office the company has, a value "
        "that can be read), and no follow-up is due before today. 409 `note_sorting` while it is "
        "being sorted, `note_sent` once it has gone to HubSpot. 422 `change_not_possible`, "
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
        "Removes my note before it is sent (the toast's Undo). A sort still running stops "
        "first. 409 `note_sent` once it has gone to HubSpot. 403 `not_your_note`, 404 "
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
        "Sends what didn't land, for my note that failed or was partly saved. 409 "
        "`note_uncertain` until I say whether HubSpot has an unsure step, `nothing_to_retry` "
        "for a note that didn't fail, and `hubspot_writes_off` while sending waits for HubSpot "
        "write access. 403 `not_your_note`, 404 `note_not_found`, 409 `call_notes_off`."
    ),
)
async def retry_call_note(
    note_id: NoteId,
    request: Request,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
) -> CallNoteOut:
    note = await note_store.read_note(session, note_id, auth, change=True)
    try:
        await note_store.retry(session, note, app=request.app, settings=settings)
    except HubSpotWritesOff as error:
        raise note_store.writes_off(error.detail) from None
    return await note_store.one_out(session, note)


@router.post(
    "/call-notes/{note_id}/resolve",
    response_model=CallNoteOut,
    summary="Say whether HubSpot has it",
    description=(
        "For a step HubSpot may or may not have saved (HubSpot didn't answer): `landed` true "
        "when it is there, false when it isn't, so sending again adds it. 409 "
        "`nothing_to_resolve` for a note with nothing unsure, and `hubspot_writes_off` while "
        "HubSpot can't be written. 403 `not_your_note`, 404 `note_not_found`, 409 "
        "`call_notes_off`."
    ),
)
async def resolve_call_note(
    note_id: NoteId,
    body: CallNoteResolve,
    session: SessionDep,
    settings: NotesOnDep,
    auth: SignedInDep,
) -> CallNoteOut:
    note = await note_store.read_note(session, note_id, auth, change=True)
    try:
        await note_store.resolve(session, note, body.step, body.landed)
    except HubSpotWritesOff as error:
        raise note_store.writes_off(error.detail) from None
    return await note_store.one_out(session, note)
