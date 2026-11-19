"""The Assistant's routes (PLAN-V22, the contract's parts 1 to 4), under
/api/v1/companies/assistant.

Behind the Call logs or the Meetings tick. Viewers get no V (choice 18), so the command step
refuses one, though it changes nothing; every route that changes something refuses one too. The
services are assistant.py (the command), today.py (Today), assistant_tasks.py (a task on its
own, Done and reopen) and team_email.py (the team email).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response

from apps.companies import (
    assistant_add,
    assistant_learned,
    assistant_names,
    assistant_tasks,
    team_email,
    today,
)
from apps.companies.api_meetings import SourceDep, WriterDep
from apps.companies.assistant import Assistant, CommandLimit, check_on, read_command
from apps.companies.assistant_add import CompanyAdds
from apps.companies.assistant_names import HintCache
from apps.companies.assistant_schemas import (
    AssistantCommand,
    AssistantCommandIn,
    AssistantCompanyAdded,
    AssistantCompanyIn,
    AssistantCompanyPreview,
    AssistantEmailIn,
    AssistantNames,
    AssistantTaskIn,
    LearnedNameIn,
    LearnedNamePage,
    TeamEmail,
    Today,
)
from apps.companies.deps import LeadsDep
from apps.companies.team_email import TeamEmailBook
from apps.companies.today import TaskCopy
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.models import OFFSET_MAX, SafeText
from core.api.runs import IDEMPOTENCY_PATTERN
from core.api.signin import AdminDep, NowDep
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


def task_limit(request: Request) -> CommandLimit:
    """The tasks each person may add in a minute (20, TBC), made on first use. A test puts its
    own in app.state."""
    found: CommandLimit | None = getattr(request.app.state, "task_limit", None)
    if found is None:
        found = assistant_tasks.task_limit()
        request.app.state.task_limit = found
    return found


def team_email_book(request: Request) -> TeamEmailBook:
    """Each person's team emails today and the keys already sent, made on first use. A test
    puts its own in app.state."""
    found: TeamEmailBook | None = getattr(request.app.state, "team_email", None)
    if found is None:
        found = TeamEmailBook()
        request.app.state.team_email = found
    return found


def name_hints(request: Request) -> HintCache:
    """Each person's hint list, kept for 5 minutes, made on first use. A test puts its own in
    app.state."""
    found: HintCache | None = getattr(request.app.state, "name_hints", None)
    if found is None:
        found = HintCache()
        request.app.state.name_hints = found
    return found


def company_adds(request: Request) -> CompanyAdds:
    """The companies each person may add in a minute (5, TBC), and one add at a time, made on
    first use. A test puts its own in app.state."""
    found: CompanyAdds | None = getattr(request.app.state, "company_adds", None)
    if found is None:
        found = CompanyAdds()
        request.app.state.company_adds = found
    return found


AssistantDep = Annotated[Assistant, Depends(assistant_state)]
CompanyAddsDep = Annotated[CompanyAdds, Depends(company_adds)]
HintsDep = Annotated[HintCache, Depends(name_hints)]
AssistantOnDep = Annotated[Settings, Depends(assistant_on)]
TaskCopyDep = Annotated[TaskCopy, Depends(task_copy)]
EmailBookDep = Annotated[TeamEmailBook, Depends(team_email_book)]
TaskLimitDep = Annotated[CommandLimit, Depends(task_limit)]
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
        "Words too unclear to make a command are `unclear` (PLAN-V23): `read_back` holds the "
        "words as heard and `unsure` the stop line; words too short to be a command (like 'um') "
        "are `unclear` with no Claude request. "
        "One small Claude request, on the call notes' model and within their cap for one note; "
        "a card's plain 'send it' or 'cancel' needs none. Claude gets only the words (emails and "
        "phone numbers blanked), today's date and an open card's box names. Code finds the "
        "company, the person, the meeting and the teammates in our HubSpot copy: each comes "
        "back as `heard`, then `found` (one match) or `choices` (two or more, best first). With "
        "no company named, the one on screen (`on_page`). A company is found in this order: the "
        "one on screen when the words are close to it, the team's learned names, our copy, "
        "then HubSpot's own search (one free request), which reads what it finds into our copy "
        "(`from_hubspot`). Found nowhere after HubSpot was searched: `can_add`, so the card may "
        "offer to add it. With no HubSpot connection it isn't searched, and `can_add` is false. "
        "It writes nothing to HubSpot, sends nothing and keeps no copy of the words; its cost "
        "goes to the search log. Behind the Call logs or "
        "the Meetings tick; a Viewer gets 403 `viewer_read_only`. 409 `assistant_off` while "
        "call notes or their AI sort are off, or Claude isn't set up. 422 `command_empty`, or "
        "`command_too_long` over 2,000 characters. 429 `too_many_commands` over 20 in a minute "
        "for one person, with `Retry-After`. 503 `claude_unavailable` when Claude takes over 15 "
        "seconds, is down, or today's limit is reached, with `Retry-After`."
    ),
)
async def read_assistant_command(
    body: AssistantCommandIn,
    request: Request,
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
        app=request.app,
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
        "(HubSpot isn't connected), `failed` (HubSpot didn't answer and no earlier read is "
        "kept) or `none` (PLAN-V23 T3-3: my account has no HubSpot user, so HubSpot isn't asked "
        "and `parts` is only `pre_reads` and `calls`), with `tasks_sentence` in plain words (none "
        "for `none`); a read that fails after a good one keeps "
        "the good one, and the sentence says from when. `meetings`: mine today and tomorrow, not "
        "cancelled, each with its pre-read (`form`), and my typed-in pre-reads. `pre_reads` "
        "(PLAN-V23 T2-3): the pre-reads sent to me, by my HubSpot user or my own address, for "
        "meetings from today on, soonest first, at most 20, each with the meeting's title and "
        "time, its company, who sent it and `form_id`. `calls`: my "
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


# --- The mic's hint list (PLAN-V23 T1-1) ---------------------------------------------------------


@router.get(
    "/names",
    response_model=AssistantNames,
    dependencies=[Depends(CHANGES)],
    summary="The names the mic listens for",
    description=(
        "The names this person is most likely to say, most likely first, each once, at most the "
        "Settings page's number (50 to start): the company on screen (`company_key`), its "
        "people, its open deals' client names and its next meeting's people; my meetings today "
        "and tomorrow and my tasks due (as Today last read them); the companies I called in the "
        "last 30 days, then those I own; my teammates; the companies the mic gets wrong (they "
        "have learned names); then the words fitout, test fit, pre-read and follow up. A "
        "company is said without Pty Ltd and the like. The voice bar loads it when the page is "
        "idle or on the first V: the speech service's hints, and the list a misheard name is "
        "fixed against on every page. It reads our copy only, never HubSpot, so it is free, and "
        "each list is kept for 5 minutes for each person and company on screen. Another rep's "
        "companies stay out unless I called them. Behind the Call logs or the Meetings tick; a "
        "Viewer gets 403 `viewer_read_only` (no V)."
    ),
)
async def read_assistant_names(
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    leads: LeadsDep,
    source: SourceDep,
    copy: TaskCopyDep,
    hints: HintsDep,
    now: NowDep,
    company_key: Annotated[
        SafeText | None,
        Query(max_length=64, description="The company on screen: a HubSpot id, or lead:<id>"),
    ] = None,
) -> AssistantNames:
    return await assistant_names.hint_list(
        session,
        auth=auth,
        settings=settings,
        company_key=company_key,
        leads=leads,
        source=source,
        copy=copy,
        hints=hints,
        now=now,
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
        "while the same task is being sent. 429 `too_many_tasks` over 20 new tasks in a "
        "minute for one person (TBC), with `Retry-After`; a repeated key isn't counted. 404 "
        "`company_not_found`. 422 `not_in_hubspot`, `task_empty`, `task_in_past`, "
        "`day_out_of_range`, `owner_not_found`. 503 `hubspot_unavailable`. A Viewer gets 403 "
        "`viewer_read_only`."
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
    limit: TaskLimitDep,
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
        limit=limit,
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


# --- Adding a company (PLAN-V23 T1-4) -----------------------------------------------------------


@router.post(
    "/companies/preview",
    response_model=AssistantCompanyPreview,
    dependencies=[Depends(CHANGES)],
    summary="Check a company before adding it",
    description=(
        "What adding this company to HubSpot would do, for the card's 'Add to HubSpot': "
        "`similar`, HubSpot's companies with a close name (its own search, one free request), "
        "best first, at most 5, each read into our copy so the card can use it; `exists`, a "
        "company with this name already (adding it again is refused); whether it can be added "
        "now (`can_write`, `waiting_for`); and the card's line (`sentence`). Nothing is written "
        "to HubSpot. With no HubSpot connection, none are listed and it can't be added. 422 "
        "`company_name_empty`, `contact_details`. 503 `hubspot_unavailable` when HubSpot didn't "
        "answer. A Viewer gets 403 `viewer_read_only`."
    ),
)
async def preview_assistant_company(
    body: AssistantCompanyIn, request: Request, session: SessionDep, settings: SettingsDep
) -> AssistantCompanyPreview:
    return await assistant_add.preview_company(session, body, app=request.app, settings=settings)


@router.post(
    "/companies",
    response_model=AssistantCompanyAdded,
    status_code=201,
    dependencies=[Depends(CHANGES)],
    summary="Add a company to HubSpot",
    description=(
        "Makes the company in HubSpot, with its name and city only, through core's writer: its "
        "duplicate check looks for the name in HubSpot first, the write is a row in HubSpot's "
        "write log, and the company is in our copy at once. Answers its `company_key`. Send the "
        "card's `Idempotency-Key`: the same key from the same person gives back the first "
        "company (200), so HubSpot gets one, even for a double press. A send that timed out is "
        "never sent again blind: HubSpot is searched by name first. 409 `company_exists` when "
        "HubSpot or our copy has a company with this name (case and spaces aside, in any city: "
        "TBC), `hubspot_writing_off` while companies can't be added (nothing is sent), "
        "`company_adding` while the same add is on its way. 429 `too_many_companies` over 5 new "
        "companies in a minute for one person (TBC), with `Retry-After`; a repeated key isn't "
        "counted. 422 `company_name_empty`, `contact_details`. 502 `company_not_added` when "
        "HubSpot refused it or didn't say whether it was made (trying again is safe). 503 "
        "`hubspot_unavailable`. A Viewer gets 403 `viewer_read_only`."
    ),
    responses={
        200: {"model": AssistantCompanyAdded, "description": "The first company with this key"}
    },
)
async def add_assistant_company(
    body: AssistantCompanyIn,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    adds: CompanyAddsDep,
    now: NowDep,
    idempotency_key: CardKey,
) -> AssistantCompanyAdded:
    added, new = await assistant_add.add_company(
        session,
        body,
        app=request.app,
        auth=auth,
        settings=settings,
        adds=adds,
        key=idempotency_key,
        now=now,
    )
    if not new:
        response.status_code = 200
    return added


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


# --- Learned names (PLAN-V23 T1-2, the contract's part 2) ---------------------------------------


@router.post(
    "/learned",
    status_code=204,
    dependencies=[Depends(CHANGES)],
    summary="Teach the mic a name",
    description=(
        "Keeps a name the rep fixed on the card, for the whole team: the words as heard (1 to 80 "
        "characters, like North Wind) and the company they picked (like Northwind). The card "
        "sends it after the send, when the rep picked the company by hand. The command step "
        "then tries it before the close-name match. Words only, never audio. It is saved only "
        "when the words differ from the company's name, case and spaces aside, and only once; "
        "the same words taught for two companies give both as choices (at most 5). Either way "
        "it answers 204. 404 `company_not_found` when the company isn't open to this person. "
        "422 `contact_details` for an email address or a phone number in the words. A Viewer "
        "gets 403 `viewer_read_only`."
    ),
)
async def teach_assistant_name(
    body: LearnedNameIn, session: SessionDep, auth: SignedInDep, leads: LeadsDep
) -> Response:
    await assistant_learned.learn(session, body, auth=auth, leads=leads)
    return Response(status_code=204)


@router.get(
    "/learned",
    response_model=LearnedNamePage,
    summary="List the learned names",
    description=(
        "Every name the team taught the mic, the newest first, a page at a time: the words as "
        "heard, the company (its name in our copy now), who taught it and when. For the "
        "Settings page, where an Admin removes one. Admins only (403 `admin_only`)."
    ),
)
async def list_learned_names(
    session: SessionDep,
    auth: AdminDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> LearnedNamePage:
    return await assistant_learned.list_pairs(session, limit=limit, offset=offset)


@router.delete(
    "/learned/{pair_id}",
    status_code=204,
    summary="Remove a learned name",
    description=(
        "Removes one learned name, so the command step no longer tries it. Admins only (403 "
        "`admin_only`). 404 `learned_not_found` when it was removed already."
    ),
)
async def remove_learned_name(
    pair_id: Annotated[uuid.UUID, Path(description="The learned name's id")],
    session: SessionDep,
    auth: AdminDep,
) -> Response:
    await assistant_learned.remove_pair(session, pair_id)
    return Response(status_code=204)
