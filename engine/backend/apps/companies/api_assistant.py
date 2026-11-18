"""The Assistant's routes (PLAN-V22, the contract's part 1), under /api/v1/companies/assistant.

Behind the Call logs or the Meetings tick. Viewers get no V (choice 18), so the command step
refuses one, though it changes nothing. The service is assistant.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from apps.companies.api_meetings import SourceDep
from apps.companies.assistant import Assistant, check_on, read_command
from apps.companies.assistant_schemas import AssistantCommand, AssistantCommandIn
from apps.companies.deps import LeadsDep
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


AssistantDep = Annotated[Assistant, Depends(assistant_state)]
AssistantOnDep = Annotated[Settings, Depends(assistant_on)]


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
