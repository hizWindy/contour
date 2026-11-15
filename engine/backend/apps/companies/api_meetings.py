"""The Meetings routes (PLAN-V17 T2-11 and T2-12, the contract's part 3), under /api/v1/companies.

Behind the Companies tick, like every Companies route. Each answers 409 `meeting_forms_off` while
meetings and pre-reads are switched off. A rep sees their own meetings, or the team's. The fixed
paths come before `/meetings/{meeting_id}`, and the whole router before `/{key}`. The services
are meeting_store.py (the reads), meeting_form.py (the pre-read's draft) and meeting_send.py
(sending it, T2-14).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response

from apps.companies import meeting_form, meeting_send, meeting_store
from apps.companies.deps import LeadsDep
from apps.companies.meeting_form import MeetingFormRunner
from apps.companies.meeting_store import MeetingSource
from apps.companies.note_batch import ActivityWriter
from apps.companies.schemas import (
    FormEmailPreview,
    FormPreviewIn,
    FormSendIn,
    MeetingDetail,
    MeetingFormOut,
    MeetingFormPatch,
    MeetingFormStart,
    MeetingPage,
    MeetingSummary,
    MeetingWhen,
)
from core.api.access import SignedInDep
from core.api.deps import SessionDep, SettingsDep
from core.api.models import OFFSET_MAX, SafeText
from core.api.signin import NowDep
from core.claude.client import get_claude
from core.config import Settings
from core.db.engine import get_sessionmaker

router = APIRouter()
PAGE_SIZE = 50


def meeting_source(request: Request) -> MeetingSource:
    """The app's meeting reads, made on first use. A test puts its own in app.state."""
    source: MeetingSource | None = getattr(request.app.state, "meeting_source", None)
    if source is None:
        source = MeetingSource()
        request.app.state.meeting_source = source
    return source


SourceDep = Annotated[MeetingSource, Depends(meeting_source)]


def meeting_form_runner(request: Request, source: SourceDep) -> MeetingFormRunner:
    """The app's pre-read runner, made on first use. A test puts its own in app.state."""
    runner: MeetingFormRunner | None = getattr(request.app.state, "meeting_form_runner", None)
    if runner is None:
        sessions = getattr(request.app.state, "session_factory", None) or get_sessionmaker()
        runner = MeetingFormRunner(sessions=sessions, claude=get_claude, meetings=source)
        request.app.state.meeting_form_runner = runner
    return runner


async def meetings_on(settings: SettingsDep) -> Settings:
    """The settings in use, once meetings are on (409 `meeting_forms_off` while they are off)."""
    if not settings.meeting_forms_enabled:
        raise meeting_store.meeting_forms_off()
    return settings


def activity_writer(request: Request) -> ActivityWriter:
    """Core's activity writer, for the pre-read's copy in HubSpot. A test puts its own in
    app.state."""
    writer: ActivityWriter | None = getattr(request.app.state, "activity_writer", None)
    return writer or ActivityWriter()


RunnerDep = Annotated[MeetingFormRunner, Depends(meeting_form_runner)]
WriterDep = Annotated[ActivityWriter, Depends(activity_writer)]
MeetingsOnDep = Annotated[Settings, Depends(meetings_on)]
MeetingId = Annotated[
    str,
    Path(min_length=1, max_length=32, pattern=r"^[0-9]+$", description="HubSpot's meeting id"),
]
FormId = Annotated[uuid.UUID, Path(description="The pre-read's id")]


@router.get(
    "/meetings",
    response_model=MeetingPage,
    summary="My meetings",
    description=(
        "A page of client meetings from HubSpot (one with no company is left out; a cancelled "
        "one stays, with its outcome). `when`: `upcoming` (the next 7 days, soonest first, each "
        "with its `group` by the Melbourne date: today, tomorrow, this_week or later) or `past` "
        "(the last 30 days, newest first). `mine` (true by default): my own, as my HubSpot "
        "owner; false: the team's, mine first. My own pre-reads for meetings typed in (New "
        "pre-read) join the list in the same window, marked `typed`, even while HubSpot's "
        "meetings aren't read. `q`: each word must start a word of the company's name, the "
        "title or the date in words, like 'sample 26 nov', 'thu' or '26/11'. Each meeting comes "
        "with its pre-read's state (`form`) and, once past, whether notes were logged. While "
        "HubSpot's meetings aren't read, `meetings_state` and `sentence` say why. 409 "
        "`meeting_forms_off`."
    ),
)
async def list_meetings(
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    source: SourceDep,
    now: NowDep,
    when: MeetingWhen = "upcoming",
    mine: bool = True,
    q: Annotated[SafeText | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> MeetingPage:
    return await meeting_store.list_meetings(
        session,
        auth,
        source=source,
        when=when,
        mine=mine,
        q=q,
        limit=limit,
        offset=offset,
        now=now,
    )


@router.get(
    "/meetings/summary",
    response_model=MeetingSummary,
    summary="My meeting counts",
    description=(
        "For Home: my upcoming client meetings (the next 7 days, my typed ones too) that need "
        "a pre-read (none yet, or one that failed; a cancelled meeting needs none), and those "
        "whose draft waits for me. 409 `meeting_forms_off`."
    ),
)
async def meeting_summary(
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    source: SourceDep,
    now: NowDep,
) -> MeetingSummary:
    return await meeting_store.summary(session, auth, source=source, now=now)


@router.post(
    "/meetings/forms",
    response_model=MeetingFormOut,
    status_code=201,
    summary="Start a pre-read",
    description=(
        "For a HubSpot meeting (`meeting_id`), or for one typed in (`company_key`, `title`, "
        "`starts_at`, and `ends_at` and `where` when known). It answers at once with the form "
        "`drafting`: the facts come first, with no AI, then the three summaries from one Claude "
        "request (this costs money: about US$0.03, at most the pre-read cap). A HubSpot meeting "
        "has one pre-read: a second start gives back the first (200). 404 `meeting_not_found` "
        "or `company_not_found`. 422 for a body that is neither kind. 409 `meeting_forms_off`."
    ),
    responses={200: {"model": MeetingFormOut, "description": "This meeting's pre-read, as it is"}},
)
async def start_form(
    body: MeetingFormStart,
    response: Response,
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    leads: LeadsDep,
    source: SourceDep,
    runner: RunnerDep,
) -> MeetingFormOut:
    form, new = await meeting_form.start_form(
        session, body, auth, source=source, runner=runner, leads=leads
    )
    if not new:
        response.status_code = 200
    return await meeting_store.form_out(session, form)


@router.get(
    "/meetings/forms/{form_id}",
    response_model=MeetingFormOut,
    summary="One pre-read",
    description=(
        "The pre-read: the meeting, the facts, the three summaries, the rep's two blanks, and "
        "who it went to. One a restart left drafting comes back failed, so it can be drafted "
        "again. 404 `form_not_found`. 409 `meeting_forms_off`."
    ),
)
async def get_form(
    form_id: FormId,
    session: SessionDep,
    settings: MeetingsOnDep,
    leads: LeadsDep,
    runner: RunnerDep,
    now: NowDep,
) -> MeetingFormOut:
    form = await meeting_form.read_form(session, form_id, leads=leads, runner=runner, now=now)
    return await meeting_store.form_out(session, form)


@router.patch(
    "/meetings/forms/{form_id}",
    response_model=MeetingFormOut,
    summary="Change a pre-read",
    description=(
        "The rep's edits: a summary's new text (`summaries`), the ideal next step "
        "(`next_step`) and who is going (`going`). Only the parts sent change. A summary "
        "changed here is the rep's own from then on (`by: person`): a redraft leaves it, and "
        "it keeps its sources. A sent pre-read that changes is a draft again, so sending it "
        "again emails the new words. 404 `form_not_found`. 409 `meeting_forms_off`."
    ),
)
async def edit_form(
    form_id: FormId,
    body: MeetingFormPatch,
    session: SessionDep,
    settings: MeetingsOnDep,
    leads: LeadsDep,
    runner: RunnerDep,
    now: NowDep,
) -> MeetingFormOut:
    form = await meeting_form.read_form(session, form_id, leads=leads, runner=runner, now=now)
    await meeting_form.edit_form(session, form, body)
    return await meeting_store.form_out(session, form)


@router.post(
    "/meetings/forms/{form_id}/redraft",
    response_model=MeetingFormOut,
    status_code=202,
    summary="Write the summaries again",
    description=(
        "Writes the three summaries again with one more Claude request. This costs money: "
        "about US$0.03, at most the pre-read cap. The facts are read again. A summary the rep "
        "changed, the ideal next step and who is going stay as they are. It answers at once "
        "with the form `drafting`. 409 `form_drafting` while it is being written. 404 "
        "`form_not_found`. 409 `meeting_forms_off`."
    ),
)
async def redraft_form(
    form_id: FormId,
    session: SessionDep,
    settings: MeetingsOnDep,
    leads: LeadsDep,
    runner: RunnerDep,
    now: NowDep,
) -> MeetingFormOut:
    form = await meeting_form.read_form(session, form_id, leads=leads, runner=runner, now=now)
    await meeting_form.redraft_form(session, form, runner=runner, leads=leads)
    return await meeting_store.form_out(session, form)


@router.post(
    "/meetings/forms/{form_id}/preview",
    response_model=FormEmailPreview,
    summary="See the pre-read's email",
    description=(
        "The email as it would arrive (a subject, plain text, and HTML with every value "
        "escaped), and the people it would go to, each with why: the Contour people on the "
        "meeting who have an account here, ticked, then the addresses I add (`to`). Each says "
        "whether it may get it: only Contour addresses can. Nothing is sent. 404 "
        "`form_not_found`. 409 `meeting_forms_off`."
    ),
)
async def preview_form(
    form_id: FormId,
    body: FormPreviewIn,
    session: SessionDep,
    settings: MeetingsOnDep,
    leads: LeadsDep,
    runner: RunnerDep,
    source: SourceDep,
    now: NowDep,
) -> FormEmailPreview:
    form = await meeting_form.read_form(session, form_id, leads=leads, runner=runner, now=now)
    return await meeting_send.preview(
        session, form, source=source, settings=settings, added=body.to
    )


@router.post(
    "/meetings/forms/{form_id}/send",
    response_model=MeetingFormOut,
    summary="Send the pre-read",
    description=(
        "Emails the pre-read to these addresses (in the body, never an attachment), then saves "
        "its copy in HubSpot: a note on the company, and on its deal when it has exactly one "
        "open deal. Every address must be Contour's: one that isn't refuses the whole send (422 "
        "`outside_address`, naming it). The ideal next step and who is going must be filled in "
        "(422 `blanks_empty`). Sent already: nobody is emailed again, and a copy that is "
        "waiting or failed is tried again. `hubspot_copy` says how the copy went: saved, "
        "waiting (writing to HubSpot isn't on: the email still went), off (the company isn't in "
        "HubSpot), or failed. 409 `form_not_ready` while it is drafting or failed, "
        "`email_not_set_up`. 502 `email_failed`: nothing was sent. 404 `form_not_found`. 409 "
        "`meeting_forms_off`."
    ),
)
async def send_form(
    form_id: FormId,
    body: FormSendIn,
    request: Request,
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    leads: LeadsDep,
    runner: RunnerDep,
    writer: WriterDep,
    now: NowDep,
) -> MeetingFormOut:
    form = await meeting_form.read_form(session, form_id, leads=leads, runner=runner, now=now)
    sent = await meeting_send.send_form(
        session, form, body.to, auth, app=request.app, settings=settings, writer=writer, now=now
    )
    return await meeting_store.form_out(session, sent)


@router.get(
    "/meetings/{meeting_id}",
    response_model=MeetingDetail,
    summary="One meeting",
    description=(
        "A client meeting from HubSpot, its company's name, and its pre-read if it has one. "
        "404 `meeting_not_found` when it isn't in our copy or has no company. 409 "
        "`meeting_forms_off`."
    ),
)
async def get_meeting(
    meeting_id: MeetingId, session: SessionDep, settings: MeetingsOnDep, source: SourceDep
) -> MeetingDetail:
    return await meeting_store.meeting_detail(session, meeting_id, source=source)
