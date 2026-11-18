"""The Assistant's command step (PLAN-V22 T1-1): one thing a rep says or types becomes one action,
for the review card to show. It writes nothing to HubSpot, sends nothing and keeps no copy of the
words. The route is in api_assistant.py.

- **One small Claude request** in a fixed form (assistant_form.py), no web tools, on
  `model_notes`, at most `notes_cap_usd`. It follows the AI sort's switch
  (`call_notes_ai_enabled`, choice 17), because it is the same data: what a rep says, with client
  names. Call notes must be on too. Its cost goes to the search log, so the daily limit counts it:
  that row holds the model, the tokens and the cost, never the words.
- **Code, not Claude, finds things** (assistant_find.py) and fills in the card
  (assistant_card.py).
- **Limits:** 2,000 characters a command; 20 commands a minute a person (kept in memory, so they
  start again when the backend restarts, TBC); and 15 seconds for Claude's answer (TBC: M2
  measures it). On an open card, a plain "send it" or "cancel" needs no request.
- **No connection waits on Claude,** and the log gets why a command failed, never its words.
"""

import asyncio
import logging
import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant_card import settle
from apps.companies.assistant_find import Context
from apps.companies.assistant_form import (
    SYSTEM,
    CommandAnswer,
    blank_answer,
    card_shortcut,
    command_prompt,
)
from apps.companies.assistant_schemas import (
    COMMAND_MAX_CHARS,
    AssistantCommand,
    AssistantCommandIn,
)
from apps.companies.facts import scrub
from apps.companies.meeting_store import MeetingSource
from apps.companies.notes import MELBOURNE
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.claude.budget import Budget, BudgetSpent
from core.claude.client import Claude, ClaudeError, get_claude
from core.claude.daily import DailyLimitReached
from core.company_leads import CompanyLeads
from core.config import Settings
from core.searches.service import log_reply

log = logging.getLogger(__name__)

APP = "companies"
STEP = "assistant:command"
PROMPT_VERSION = "assistant-1"
# A short sort into one of a few actions, so the lowest effort: quick and cheap. M2 checks it gets
# at least 18 of 20 right; if not, medium is next (TBC).
EFFORT = "low"
COMMAND_SECONDS: Final = 15.0  # the longest wait for Claude's answer (TBC, M2 measures it)
COMMANDS_PER_MINUTE: Final = 20  # a person (choice 18, TBC)
LIMIT_WINDOW: Final = timedelta(minutes=1)
RETRY_SECONDS: Final = 5  # a 503's Retry-After: the rep may try again at once

# --- The words (PLAN-V15 "Words for errors", PLAN-V22 "Words for when things go wrong") ---------

OFF_TITLE = "The Assistant is off"
NO_ANSWER_TITLE = "The Assistant didn't answer"


def assistant_off(*, notes_on: bool) -> Problem:
    """The AI sort's switch is off, or Claude isn't set up (409 `assistant_off`). The website then
    opens Log call with the words in the note (choice 17)."""
    if notes_on:
        return Problem(
            409,
            OFF_TITLE,
            "The Assistant can't read commands yet. Log the call by hand instead, or ask an "
            "admin to switch it on.",
            code="assistant_off",
        )
    return Problem(
        409,
        OFF_TITLE,
        "Call notes and the Assistant are switched off. An admin can switch them on in Settings.",
        code="assistant_off",
    )


def command_empty() -> Problem:
    return Problem(
        422,
        "Nothing to do",
        "We didn't hear anything. Press V and speak, or type what to do.",
        code="command_empty",
    )


def command_too_long() -> Problem:
    return Problem(
        422,
        "That command is too long",
        f"A command can be up to {COMMAND_MAX_CHARS:,} characters. Shorten it, or log a call "
        "for a longer note.",
        code="command_too_long",
    )


def too_many_commands(wait_seconds: int) -> Problem:
    return Problem(
        429,
        "Too many commands",
        "That's a lot of commands in one minute. Wait a moment, then try again.",
        code="too_many_commands",
        headers={"Retry-After": str(wait_seconds)},
    )


def too_slow() -> Problem:
    return Problem(
        503,
        NO_ANSWER_TITLE,
        "That took too long. Your words are kept. Try again.",
        code="claude_unavailable",
        headers={"Retry-After": str(RETRY_SECONDS)},
    )


def claude_down() -> Problem:
    return Problem(
        503,
        NO_ANSWER_TITLE,
        "The Assistant couldn't read that just now. Your words are kept. Try again.",
        code="claude_unavailable",
        headers={"Retry-After": str(RETRY_SECONDS)},
    )


def daily_limit() -> Problem:
    return Problem(
        503,
        "Today's AI limit is reached",
        "The Assistant can't read commands until tomorrow. Your words are kept: log the call by "
        "hand instead.",
        code="claude_unavailable",
        headers={"Retry-After": str(RETRY_SECONDS)},
    )


# --- At most 20 commands a minute a person -----------------------------------------------------


class CommandLimit:
    """At most `per_minute` commands a person in any minute. Kept in memory: the counts start
    again when the backend restarts (TBC, the S0 log). With sign-in off, everyone is one person."""

    def __init__(self, per_minute: int = COMMANDS_PER_MINUTE) -> None:
        self.per_minute = per_minute
        self._times: dict[str, deque[datetime]] = {}

    def take(self, who: str, now: datetime) -> int | None:
        """Counts one command now. None when it fits, else the whole seconds to wait."""
        start = now - LIMIT_WINDOW
        for person in [key for key, times in self._times.items() if times[-1] <= start]:
            del self._times[person]  # nobody's minute is kept once it is over
        times = self._times.setdefault(who, deque())
        while times and times[0] <= start:
            times.popleft()
        if len(times) >= self.per_minute:
            return max(1, math.ceil((times[0] - start).total_seconds()))
        times.append(now)
        return None


def person_key(auth: AuthContext | None) -> str:
    return str(auth.user.id) if auth is not None else "nobody signed in"


# --- One command ---------------------------------------------------------------------------------

type ClaudeSource = Callable[[], Claude]


@dataclass
class Assistant:
    """What the command step keeps while the backend runs: where Claude comes from, the limit,
    and how long to wait for an answer. It lives on `app.state.assistant`; a test puts its own,
    with a fake Claude."""

    claude: ClaudeSource = get_claude
    limit: CommandLimit = field(default_factory=CommandLimit)
    seconds: float = COMMAND_SECONDS


def is_on(settings: Settings) -> bool:
    """The command step works: call notes are on, the AI sort's switch is on, and Claude is set
    up (the AI sort's own test, `note_store.ai_sorts`)."""
    key = settings.anthropic_api_key
    return (
        settings.call_notes_enabled
        and settings.call_notes_ai_enabled
        and key is not None
        and bool(key.get_secret_value())
    )


def check_on(settings: Settings) -> Settings:
    """The settings, once the command step works (409 `assistant_off` otherwise)."""
    if not is_on(settings):
        raise assistant_off(notes_on=settings.call_notes_enabled)
    return settings


async def read_command(
    session: AsyncSession,
    body: AssistantCommandIn,
    *,
    assistant: Assistant,
    settings: Settings,
    auth: AuthContext | None,
    meetings: MeetingSource,
    leads: list[CompanyLeads],
    now: datetime,
) -> AssistantCommand:
    """One command, read and settled. It writes nothing but its cost to the search log."""
    text = body.text.strip()
    if not text:
        raise command_empty()
    if len(text) > COMMAND_MAX_CHARS:
        raise command_too_long()
    wait = assistant.limit.take(person_key(auth), now)
    if wait is not None:
        raise too_many_commands(wait)
    said = scrub(text)  # no email address or phone number reaches Claude
    today = now.astimezone(MELBOURNE).date()
    answer = card_shortcut(said, body.card)
    if answer is None:
        prompt = command_prompt(said, source=body.source, today=today, card=body.card)
        answer = await ask(session, assistant, prompt, settings)
    context = Context(
        said=said,
        typed=text,
        on_page=body.on_page,
        card=body.card,
        auth=auth,
        settings=settings,
        meetings=meetings,
        leads=leads,
        now=now,
        today=today,
    )
    command = await settle(session, answer, context)
    log.info(
        "assistant_command",
        extra={"source": body.source, "asked": answer.action, "action": command.action},
    )
    return command


async def ask(
    session: AsyncSession, assistant: Assistant, prompt: str, settings: Settings
) -> CommandAnswer:
    """One request, within its cap, the daily limit and the wait. No database connection is held
    while Claude answers. The log gets why it failed, never the words."""
    if session.in_transaction():
        await session.rollback()  # it only read: no connection waits on Claude
    budget = Budget(cap_usd=settings.notes_cap_usd, max_searches=0)
    started = time.monotonic()
    try:
        budget.check()  # this request's cap. The shared client checks the daily limit.
        claude = assistant.claude()
        async with asyncio.timeout(assistant.seconds):
            reply = await claude.ask(
                system=SYSTEM,
                prompt=prompt,
                form=CommandAnswer,
                model=settings.model_notes,
                effort=EFFORT,
                max_continues=0,  # no web tools, so no paused turn to resume
            )
    except TimeoutError:
        log.warning("assistant_command_failed", extra={"why": "timeout"})
        raise too_slow() from None
    except DailyLimitReached:
        log.info("assistant_command_failed", extra={"why": "daily limit"})
        raise daily_limit() from None
    except (BudgetSpent, ClaudeError) as error:  # their words hold nothing from the command
        log.warning("assistant_command_failed", extra={"why": str(error)})
        raise claude_down() from None
    budget.record(reply)
    log_reply(session, reply, app=APP, step=STEP, prompt_version=PROMPT_VERSION)
    await session.commit()
    log.info(
        "assistant_command_read",
        extra={
            "model": reply.model,
            "ms": round((time.monotonic() - started) * 1000),
            "cost_usd": str(reply.cost_usd),
            "fits": reply.parsed is not None,
            "over_cap": budget.spent_usd > budget.cap_usd,
        },
    )
    if reply.parsed is not None:
        return reply.parsed
    if reply.stop_reason == "refusal":  # Claude declined: the card says what it can do
        return blank_answer("unknown")
    raise claude_down()
