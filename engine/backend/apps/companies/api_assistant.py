"""The Assistant's routes (PLAN-V22, the contract's parts 1 to 4), under
/api/v1/companies/assistant.

Behind the Call logs or the Meetings tick. Viewers get no V (choice 18), so the command step
refuses one, though it changes nothing; every route that changes something refuses one too. The
services are assistant.py (the command), today.py (Today), assistant_tasks.py (a task on its
own, Done and reopen) and team_email.py (the team email).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response

from apps.companies import assistant_tasks, team_email, today
from apps.companies.api_meetings import SourceDep, WriterDep
from apps.companies.assistant import Assistant, check_on, read_command
from apps.companies.assistant_schemas import (
    AssistantCommand,
    AssistantCommandIn,
    AssistantEmailIn,
    AssistantTaskIn,
    TeamEmail,
    Today,
)
from apps.companies.deps import LeadsDep
from apps.companies.team_email import TeamEmailBook
from apps.companies.today import TaskCopy
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.runs import IDEMPOTENCY_PATTERN
from core.api.signin import NowDep
from core.config import Settings
from core.hubspot.writer import WriteOut

router = APIRouter(prefix="/assistant")


def assistant_state(request: Request) -> Assistant:
    """The app's command step, made on first use. A test puts its own in app.state."""
    found: Assistant | None = getattr(request.app.state, "assistant", None)
    if found is None:
        found = Assistant()
        request.app.state.assistant = found
    return found


async def assistant_on(settings: SettingsDep) -> Settings:
    """The settings in use, once the command step works (409 `assistant_off` otherwise)."""
    return check_on(settings)


def task_copy(request: Request) -> TaskCopy:
    """Each person's HubSpot tasks, kept for 5 minutes, made on first use. A test puts its own in
    app.state."""
    found: TaskCopy | None = getattr(request.app.state, "today_tasks", None)
    if found is None:
        found = TaskCopy()
        request.app.state.today_tasks = found
    return found


def team_email_book(request: Request) -> TeamEmailBook:
    """Each person's team emails today and the keys already sent, made on first use. A test
    puts its own in app.state."""
    found: TeamEmailBook | None = getattr(request.app.state, "team_email", None)
    if found is None:
        found = TeamEmailBook()
        request.app.state.team_email = found
    return found


AssistantDep = Annotated[Assistant, Depends(assistant_state)]
AssistantOnDep = Annotated[Settings, Depends(assistant_on)]
TaskCopyDep = Annotated[TaskCopy, Depends(task_copy)]
EmailBookDep = Annotated[TeamEmailBook, Depends(team_email_book)]
TaskId = Annotated[
    str, Path(min_length=1, max_length=32, pattern=r"^[0-9]+$", description="HubSpot's task id")
]
CardKey = Annotated[
    str,
    Header(
        min_length=1,
        max_length=64,
        pattern=IDEMPOTENCY_PATTERN,
        description="Any unique text (a UUID is fine), made when the review card opens. A "
        "repeated key from the same person gives back the first answer, and sends nothing again",
    ),
]
CHANGES = need("companies.call_logs", "companies.meetings", write=True)


@router.post(
    "/command",
    response_model=AssistantCommand,
    dependencies=[Depends(need("companies.call_logs", "companies.meetings", write=True))],
    summary="Read a command",
    description=(
        "Turns one thing a rep said or typed into one action for the review card: `pre_read`, "
        "`log_call`, `task`, `email` or `open`, or on an open card (`card`) `change`, `send` or "
        "`cancel`. Anything else is `unknown`, and `read_back` lists what the Assistant can do. "
        "One small Claude request, on the call notes' model and within their cap for one note; "
        "a card's plain 'send it' or 'cancel' needs none. Claude gets only the words (emails and "
        "phone numbers blanked), today's date and an open card's box names. Code finds the "
        "company, the person, the meeting and the teammates in our HubSpot copy: each comes "
        "back as `heard`, then `found` (one match) or `choices` (two or more, best first). With "
        "no company named, the one on screen (`on_page`). It writes nothing, sends nothing and "
        "keeps no copy of the words; its cost goes to the search log. Behind the Call logs or "
        "the Meetings tick; a Viewer gets 403 `viewer_read_only`. 409 `assistant_off` while "
        "call notes or their AI sort are off, or Claude isn't set up. 422 `command_empty`, or "
        "`command_too_long` over 2,000 characters. 429 `too_many_commands` over 20 in a minute "
        "for one person, with `Retry-After`. 503 `claude_unavailable` when Claude takes over 15 "
        "seconds, is down, or today's limit is reached, with `Retry-After`."
    ),
)
async def read_assistant_command(
    body: AssistantCommandIn,
    session: SessionDep,
    settings: AssistantOnDep,
    auth: SignedInDep,
    leads: LeadsDep,
    source: SourceDep,
    assistant: AssistantDep,
    now: NowDep,
) -> AssistantCommand:
    return await read_command(
        session,
        body,
        assistant=assistant,
        settings=settings,
        auth=auth,
        meetings=source,
        leads=leads,
        now=now,
    )


@router.get(
    "/today",
    response_model=Today,
    dependencies=[Depends(need("companies.call_logs", "companies.meetings"))],
    summary="Today",
    description=(
        "The Assistant's first page, the most urgent first (`parts` says which this person "
        "sees). `tasks`: my open HubSpot tasks, overdue first, then today's, then the next 7 "
        "days' (Melbourne days), at most 100, latest due kept (`tasks_more` counts older overdue "
        "ones). They are read from HubSpot (two free requests: the tasks, then their companies) "
        "and kept for 5 minutes a person; `fresh=true` (Sync) reads them again, but HubSpot is "
        "asked at most once a minute a person. `tasks_state`: `ok`, `no_owner` (no HubSpot link: "
        "the rest still shows), `no_access` (HubSpot won't let the key read tasks), `off` "
        "(HubSpot isn't connected) or `failed` (HubSpot didn't answer and no earlier read is "
        "kept), with `tasks_sentence` in plain words; a read that fails after a good one keeps "
        "the good one, and the sentence says from when. `meetings`: mine today and tomorrow, not "
        "cancelled, each with its pre-read (`form`), and my typed-in pre-reads. `calls`: my "
        "notes to confirm and those that need a look. `deals`: my open deals whose close date "
        "has passed or whose company nobody has talked to for `quiet_days` days, at most 50 "
        "(`deals_more`). `checked_at`: when the tasks were read. No Claude request: it is free. "
        "Behind the Call logs or the Meetings tick (403 `feature_not_allowed`); a Viewer may "
        "read it."
    ),
)
async def read_today(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    source: SourceDep,
    copy: TaskCopyDep,
    now: NowDep,
    fresh: Annotated[
        bool,
        Query(description="Sync: read the tasks from HubSpot again (at most once a minute)"),
    ] = False,
) -> Today:
    return await today.build_today(
        session,
        app=request.app,
        auth=auth,
        settings=settings,
        source=source,
        copy=copy,
        now=now,
        fresh=fresh,
    )


# --- A task on its own, Done and reopen (T1-4) ---------------------------------------------------


@router.post(
    "/tasks/preview",
    response_model=WriteOut,
    dependencies=[Depends(CHANGES)],
    summary="Check a task before adding it",
    description=(
        "What adding this task would do: the company as HubSpot has it now (one free read), "
        "the task in words (`plan.tasks`: what, its kind, when it is due and for whom), any "
        "warning (like no HubSpot owner linked to my account, so HubSpot shows it unassigned), "
        "and whether HubSpot can be written now (`can_write`, `waiting_for`). Nothing is sent; "
        "it works while writing is off. `owner_id`: me by default, or a teammate from GET "
        "/team. The task is due at 9:00 am on its day, Melbourne time. Send the card's "
        "`Idempotency-Key`: the send with the same key adds this task once. 404 "
        "`company_not_found`. 422 `not_in_hubspot` (a Lead Finder company), `task_empty`, "
        "`task_in_past`, `day_out_of_range`, `owner_not_found`. 503 `hubspot_not_connected` or "
        "`hubspot_unavailable` (HubSpot didn't answer). A Viewer gets 403 `viewer_read_only`."
    ),
)
async def preview_assistant_task(
    body: AssistantTaskIn,
    request: Request,
    session: SessionDep,
    auth: SignedInDep,
    writer: WriterDep,
    now: NowDep,
    idempotency_key: CardKey,
) -> WriteOut:
    return await assistant_tasks.preview_task(
        session, body, app=request.app, auth=auth, writer=writer, key=idempotency_key, now=now
    )


@router.post(
    "/tasks",
    response_model=WriteOut,
    status_code=201,
    dependencies=[Depends(CHANGES)],
    summary="Add a task",
    description=(
        "Adds one HubSpot task on the company, for me or a teammate, through the same writer "
        "as a call note's follow-ups, and answers with the write: `status` (`done` when it is "
        "in HubSpot, `failed` or `uncertain` otherwise) and its step `task:1` in words, with "
        "HubSpot's id once made. HubSpot's search may take a few seconds to show it; Today "
        "shows it at once. Send an `Idempotency-Key`: the same key from the same person gives "
        "back the first write (200), so HubSpot gets one task, even for a double press. A send "
        "that timed out is never sent again blind: HubSpot is searched for it first. 409 "
        "`hubspot_writing_off` while HubSpot can't be written (nothing is sent), `task_sending` "
        "while the same task is being sent. 404 `company_not_found`. 422 `not_in_hubspot`, "
        "`task_empty`, `task_in_past`, `day_out_of_range`, `owner_not_found`. 503 "
        "`hubspot_unavailable`. A Viewer gets 403 `viewer_read_only`."
    ),
    responses={200: {"model": WriteOut, "description": "The first task added with this key"}},
)
async def add_assistant_task(
    body: AssistantTaskIn,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    writer: WriterDep,
    copy: TaskCopyDep,
    now: NowDep,
    idempotency_key: CardKey,
) -> WriteOut:
    written, new = await assistant_tasks.add_task(
        session,
        body,
        app=request.app,
        auth=auth,
        settings=settings,
        writer=writer,
        copy=copy,
        key=idempotency_key,
        now=now,
    )
    if not new:
        response.status_code = 200
    return written


@router.post(
    "/tasks/{task_id}/done",
    status_code=204,
    dependencies=[Depends(CHANGES)],
    summary="Tick a task done",
    description=(
        "Ticks my HubSpot task done at once (choice 7: Undo is reopen). HubSpot is read first: "
        "a task that isn't mine is never changed (403 `not_your_task`). A task done already "
        "sends nothing. Each change is a row in HubSpot's write log. Today shows it at once. 404 "
        "`task_not_found`. 409 `hubspot_writing_off` while HubSpot can't be written, "
        "`no_hubspot_link` when my account has no HubSpot owner linked. 502 `task_not_changed` "
        "when HubSpot didn't take it "
        "(trying again is safe). 503 `hubspot_unavailable`. A Viewer gets 403 "
        "`viewer_read_only`."
    ),
)
async def tick_assistant_task_done(
    task_id: TaskId,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    source: SourceDep,
    copy: TaskCopyDep,
    now: NowDep,
) -> Response:
    await assistant_tasks.change_status(
        session,
        task_id,
        done=True,
        app=request.app,
        auth=auth,
        settings=settings,
        source=source,
        copy=copy,
        now=now,
    )
    return Response(status_code=204)


@router.post(
    "/tasks/{task_id}/reopen",
    status_code=204,
    dependencies=[Depends(CHANGES)],
    summary="Open a task again",
    description=(
        "Opens my HubSpot task again (the Undo of Done): it gets back the status it had before "
        "its last Done here, like In progress, else Not started. HubSpot is read first: a task "
        "that isn't mine is never changed (403 `not_your_task`). A task open already sends "
        "nothing. Each change is a row in HubSpot's write log. 404 `task_not_found`. 409 "
        "`hubspot_writing_off`, `no_hubspot_link`. 502 `task_not_changed`. 503 "
        "`hubspot_unavailable`. A Viewer gets 403 `viewer_read_only`."
    ),
)
async def reopen_assistant_task(
    task_id: TaskId,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    source: SourceDep,
    copy: TaskCopyDep,
    now: NowDep,
) -> Response:
    await assistant_tasks.change_status(
        session,
        task_id,
        done=False,
        app=request.app,
        auth=auth,
        settings=settings,
        source=source,
        copy=copy,
        now=now,
    )
    return Response(status_code=204)


# --- The team email (T1-5) -----------------------------------------------------------------------


@router.post(
    "/email/preview",
    response_model=TeamEmail,
    dependencies=[Depends(CHANGES)],
    summary="Check a team email before sending it",
    description=(
        "The email as it would go: the subject, the plain text and the HTML (every value "
        "escaped, ending 'Sent by {name} from Contour HQ', with a link to the company when "
        "`company_key` is given), who it goes to (1 to 20 people, each once), whether a reply "
        "goes to my own Contour address (`reply_to_me`), whether it can be sent now "
        "(`can_send`, `waiting_for`), and my sends left today (30 a day, TBC). Nothing is sent. "
        "Teammates come from GET /team, each with a Contour account; Contour addresses can be "
        "typed in full. 422 `outside_address` (one outside address refuses the whole email, "
        "and is named), `no_account` (a teammate who can't get it, with why), "
        "`owner_not_found`, `no_one`, `too_many_recipients`, `subject_empty`, `body_empty`, "
        "`not_in_hubspot` (a Lead Finder company). 404 `company_not_found`. A Viewer gets 403 "
        "`viewer_read_only`."
    ),
)
async def preview_team_email(
    body: AssistantEmailIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    source: SourceDep,
    book: EmailBookDep,
    now: NowDep,
) -> TeamEmail:
    return await team_email.preview_email(
        session,
        body,
        app=request.app,
        auth=auth,
        settings=settings,
        source=source,
        book=book,
        now=now,
    )


@router.post(
    "/email",
    response_model=TeamEmail,
    status_code=201,
    dependencies=[Depends(CHANGES)],
    summary="Send a team email",
    description=(
        "Sends the email to Contour people only, through the same sender as a pre-read, and "
        "answers with it as it went (`sent_at`). It isn't copied to HubSpot, and nothing is "
        "saved. Send an `Idempotency-Key`: the same key from the same person gives back the "
        "first send (200) and sends nothing again; the email service gets the same key too. At "
        "most 30 sends a day a person, by the Melbourne day (TBC): 429 `too_many_emails`, with "
        "`Retry-After`. 409 `email_not_set_up` while email isn't set up (nothing is sent), "
        "`email_sending` while the same email is on its way. 502 `email_failed` when the email "
        "service didn't take it (trying again is safe). The same 422 and 404 as the preview. A "
        "Viewer gets 403 `viewer_read_only`."
    ),
    responses={200: {"model": TeamEmail, "description": "The first send with this key"}},
)
async def send_team_email(
    body: AssistantEmailIn,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    source: SourceDep,
    book: EmailBookDep,
    now: NowDep,
    idempotency_key: CardKey,
) -> TeamEmail:
    sent, new = await team_email.send_email(
        session,
        body,
        app=request.app,
        auth=auth,
        settings=settings,
        source=source,
        book=book,
        key=idempotency_key,
        now=now,
    )
    if not new:
        response.status_code = 200
    return sent
