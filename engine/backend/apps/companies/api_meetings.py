"""The Meetings routes (PLAN-V17 T2-11 and T2-12, the contract's part 3), under /api/v1/companies.

Behind the Companies tick, like every Companies route. Each answers 409 `meeting_forms_off` while
meetings and pre-reads are switched off. A rep sees everyone's meetings, their own, or their
HubSpot team's (PLAN-V18 T1-4). The fixed
paths come before `/meetings/{meeting_id}`, and the whole router before `/{key}`. The services
are meeting_store.py (the reads), meeting_form.py (the pre-read's draft), meeting_send.py
(sending it, T2-14) and meeting_log.py (a past meeting's transcript, T2-15).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response

from apps.companies import meeting_form, meeting_log, meeting_send, meeting_store, note_store
from apps.companies.api_notes import SorterDep
from apps.companies.deps import LeadsDep
from apps.companies.meeting_form import MeetingFormRunner
from apps.companies.meeting_store import MeetingSource
from apps.companies.note_batch import ActivityWriter
from apps.companies.schemas import (
    CallNoteOut,
    FormEmailPreview,
    FormPreviewIn,
    FormSendIn,
    MeetingDetail,
    MeetingFormOut,
    MeetingFormPatch,
    MeetingFormStart,
    MeetingPage,
    MeetingsSyncOut,
    MeetingSummary,
    MeetingTranscriptIn,
    MeetingWhen,
    MeetingWho,
    TeamMember,
)
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.models import OFFSET_MAX, SafeText
from core.api.runs import IDEMPOTENCY_PATTERN
from core.api.signin import NowDep
from core.claude.client import get_claude
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.hubspot.connection import refresh_meetings_soon

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
    "/team",
    response_model=list[TeamMember],
    dependencies=[Depends(need("companies.meetings"))],
    summary="Contour team owners for pre-read sending",
    description=(
        "Active HubSpot owners ordered by name, with whether each has an active Contour account "
        "and whether they are the signed-in user. Never exposes email addresses. 503 "
        "`team_unavailable` if loading fails."
    ),
)
async def list_team(session: SessionDep, auth: SignedInDep) -> list[TeamMember]:
    return await meeting_store.list_team(session, auth)


@router.get(
    "/meetings",
    response_model=MeetingPage,
    dependencies=[Depends(need("companies.meetings"))],
    summary="Client meetings",
    description=(
        "A page of client meetings from HubSpot (one with no company is left out; a cancelled "
        "one stays, with its outcome), always in time order. `when`: `upcoming` (the next 7 "
        "days, soonest first, each with its `group` by the Melbourne date: today, tomorrow, "
        "this_week or later) or `past` (the last 30 days, newest first). `who`: `all` (the "
        "default: everyone's), `mine` (the ones I own or am on, as my HubSpot owner) or `team` "
        "(the ones whose owner, or a Contour person on them, is in one of my HubSpot teams, mine "
        "included). Each meeting says whether it is `mine`. `linked`, `team_state` and "
        "`team_names` say what My meetings and My team can pick out, and `sentence` says why "
        "one of them is empty (never for All). My own pre-reads for meetings typed in (New "
        "pre-read) join the list in the same window, marked `typed`, even while HubSpot's "
        "meetings aren't read. `q`: each word must start a word of the company's name, the "
        "title or the date in words, like 'sample 26 nov', 'thu' or '26/11'. Each meeting comes "
        "with its pre-read's state (`form`) and, once past, whether notes were logged. While "
        "HubSpot's meetings aren't read, `meetings_state` and `sentence` say why. Opening it "
        "asks HubSpot for changed meetings in the background (at most every 15 minutes). 409 "
        "`meeting_forms_off`. `owner` narrows the list to the meetings one HubSpot owner owns or "
        "is on (an id from `owners`), on top of `who`, and it works with sign-in off too. "
        "`owners` names the people who own a meeting in the window, for an Owner filter."
    ),
)
async def list_meetings(
    request: Request,
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    source: SourceDep,
    now: NowDep,
    when: MeetingWhen = "upcoming",
    who: MeetingWho = "all",
    q: Annotated[SafeText | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
    owner: Annotated[
        str | None,
        Query(
            max_length=32,
            pattern=r"^[A-Za-z0-9_-]+$",
            description="A HubSpot owner id, from `owners`: only the meetings they own or are on",
        ),
    ] = None,
) -> MeetingPage:
    refresh_meetings_soon(request.app)  # in the background, at most every 15 minutes
    return await meeting_store.list_meetings(
        session,
        auth,
        source=source,
        when=when,
        who=who,
        q=q,
        limit=limit,
        offset=offset,
        now=now,
        owner=owner,
    )


@router.get(
    "/meetings/summary",
    response_model=MeetingSummary,
    dependencies=[Depends(need("companies.meetings"))],
    summary="My meeting counts",
    description=(
        "For Home: my upcoming client meetings (the next 7 days, my typed ones too) that need "
        "a pre-read (none yet, or one that failed; a cancelled meeting needs none), and those "
        "whose draft waits for me. Opening it asks HubSpot for changed meetings in the "
        "background (at most every 15 minutes). 409 `meeting_forms_off`."
    ),
)
async def meeting_summary(
    request: Request,
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    source: SourceDep,
    now: NowDep,
) -> MeetingSummary:
    refresh_meetings_soon(request.app)  # in the background, at most every 15 minutes
    return await meeting_store.summary(session, auth, source=source, now=now)


@router.post(
    "/meetings/sync",
    response_model=MeetingsSyncOut,
    status_code=202,
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="Read HubSpot's meetings now",
    description=(
        "Sync on Meetings: a full read of HubSpot's meetings in our window (90 days back to 60 "
        "days ahead, TBC), so it also finds meetings that moved or were deleted. It answers at "
        "once: `started` (the read runs in the background, and the list's `syncing` is true "
        "until it ends), `running` (a read was going already: nothing new starts) or `fresh` "
        "(a good read finished under a minute ago: HubSpot isn't asked). One read at a time "
        "for the whole site. It only reads HubSpot, and costs nothing. A HubSpot failure "
        "doesn't fail this request: the list's `sync_problem` says it, and the list stays as "
        "it was. 503 `hubspot_not_connected` when HubSpot isn't connected. 409 "
        "`meeting_forms_off`."
    ),
)
async def sync_meetings(request: Request, settings: MeetingsOnDep) -> MeetingsSyncOut:
    return await meeting_store.sync_now(request.app)


@router.post(
    "/meetings/forms",
    response_model=MeetingFormOut,
    status_code=201,
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="Start a pre-read",
    description=(
        "For a HubSpot meeting (`meeting_id`), or for one typed in (`company_key`, `title`, "
        "`starts_at`, and `ends_at` and `where` when known). It answers at once with the form "
        "`drafting`: the facts come first, with no AI, then the three summaries from one Claude "
        "request (this costs money: about US$0.03, at most the pre-read cap). A HubSpot meeting "
        "has one pre-read: a second start gives back the first (200). So does a typed meeting I "
        "start again with the same company, title and start, so a retry makes no second one. "
        "404 `meeting_not_found` or `company_not_found`. 422 for a body that is neither kind, "
        "and `meeting_time_missing` for a typed meeting with no start. 409 `meeting_forms_off`."
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
    dependencies=[Depends(need("companies.meetings"))],
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
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="Change a pre-read",
    description=(
        "The rep's edits: a summary's new text (`summaries`), the ideal next step "
        "(`next_step`) and who is going (`going`). Only the parts sent change. A summary "
        "changed here is the rep's own from then on (`by: person`): a redraft leaves it, and "
        "it keeps its sources. A sent pre-read that changes is a draft again, so sending it "
        "again emails the new words. A failed draft becomes a draft once all three summaries "
        "have text (the rep wrote them), so it can be sent; with one or two written it stays "
        "failed, with its `error`. 404 `form_not_found`. 409 `meeting_forms_off`."
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
    dependencies=[Depends(need("companies.meetings", write=True))],
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
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="See the pre-read's HubSpot tasks and email",
    description=(
        "What Send will do: the HubSpot task subject and working-day due date, email preview, "
        "and each person with whether they get a task and/or email (and if they already got it). "
        "Nothing is sent. 404 `form_not_found`. 409 `meeting_forms_off`."
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
        session,
        form,
        source=source,
        settings=settings,
        owner_ids=body.owner_ids,
        emails=body.emails,
        email_them=body.email_them,
        now=now,
    )


@router.post(
    "/meetings/forms/{form_id}/send",
    response_model=MeetingFormOut,
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="Send the pre-read",
    description=(
        "Creates HubSpot follow-up tasks for picked team members and optionally emails them (and "
        "any added Contour addresses), once per new recipient unless the pre-read text changed. "
        "Saves the company/meeting copy in HubSpot. 422 `blanks_empty`, `outside_address`, "
        "`no_one`. 409 `hubspot_writes_off`, `form_not_ready`, `form_sending`, `email_not_set_up`. "
        "502 `email_failed`. 404 `form_not_found`. 409 `meeting_forms_off`."
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
        session,
        form,
        owner_ids=body.owner_ids,
        emails=body.emails,
        email_them=body.email_them,
        auth=auth,
        app=request.app,
        settings=settings,
        writer=writer,
        now=now,
    )
    return await meeting_store.form_out(session, sent)


@router.post(
    "/meetings/forms/{form_id}/tasks/retry",
    response_model=MeetingFormOut,
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="Retry failed HubSpot tasks for a sent pre-read",
    description=(
        "Retries HubSpot task creation only for people whose task previously failed, without "
        "sending any email. Partial successes are saved. Raises 502 `task_failed` if any "
        "task still fails. 409 `hubspot_writes_off`, `form_not_ready`. 404 `form_not_found`."
    ),
)
async def retry_form_tasks(
    form_id: FormId,
    request: Request,
    session: SessionDep,
    settings: MeetingsOnDep,
    leads: LeadsDep,
    runner: RunnerDep,
    writer: WriterDep,
    now: NowDep,
) -> MeetingFormOut:
    form = await meeting_form.read_form(session, form_id, leads=leads, runner=runner, now=now)
    updated = await meeting_send.retry_tasks(
        session, form, app=request.app, settings=settings, writer=writer, now=now
    )
    return await meeting_store.form_out(session, updated)


@router.get(
    "/meetings/{meeting_id}",
    response_model=MeetingDetail,
    dependencies=[Depends(need("companies.meetings"))],
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


@router.post(
    "/meetings/{meeting_id}/transcript",
    response_model=CallNoteOut,
    status_code=201,
    dependencies=[Depends(need("companies.meetings", write=True))],
    summary="Log a meeting",
    description=(
        "A past client meeting's transcript, pasted or read from a .txt or .vtt file "
        "(`file_name`): a .vtt file is cleaned of its header, cue numbers, times and tags, and "
        "keeps who said what. It becomes a call note like any other, linked to the meeting, "
        "with the source `transcript`: sorted the same way, in the same batch, and nothing goes "
        "to HubSpot until I confirm it. The transcript is data, never instructions. Send an "
        "`Idempotency-Key`: the same key from the same person gives back the first note (200). "
        "404 `meeting_not_found`, `company_not_found`. 409 `meeting_not_past` for a meeting "
        "still to come, `call_notes_off`, `meeting_forms_off`. 422 `transcript_file` (not a "
        ".txt or .vtt file), `transcript_empty`, `transcript_too_long`."
    ),
    responses={200: {"model": CallNoteOut, "description": "The note saved first with this key"}},
)
async def log_meeting(
    meeting_id: MeetingId,
    body: MeetingTranscriptIn,
    response: Response,
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    leads: LeadsDep,
    source: SourceDep,
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
    note, new = await meeting_log.log_transcript(
        session,
        meeting_id,
        body,
        auth,
        source=source,
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
