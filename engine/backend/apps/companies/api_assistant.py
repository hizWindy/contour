"""The Assistant's routes (PLAN-V22, the contract's parts 1 and 2), under
/api/v1/companies/assistant.

Behind the Call logs or the Meetings tick. Viewers get no V (choice 18), so the command step
refuses one, though it changes nothing. The services are assistant.py (the command) and today.py
(Today).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from apps.companies import today
from apps.companies.api_meetings import SourceDep
from apps.companies.assistant import Assistant, check_on, read_command
from apps.companies.assistant_schemas import AssistantCommand, AssistantCommandIn, Today
from apps.companies.deps import LeadsDep
from apps.companies.today import TaskCopy
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.signin import NowDep
from core.config import Settings

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


AssistantDep = Annotated[Assistant, Depends(assistant_state)]
AssistantOnDep = Annotated[Settings, Depends(assistant_on)]
TaskCopyDep = Annotated[TaskCopy, Depends(task_copy)]


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
