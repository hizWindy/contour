"""The afternoon reminder about calls not sent yet (PLAN-V23 T2-3, choice 10): one email to each
person with calls waiting, like "7 calls aren't in HubSpot yet.", with a link to Call logs.

- **When:** every day at 4:30 pm Melbourne time (the plan's `calls_nudge_at`: the schedule's own
  time, changed on Admin, Schedules), off until a person switches it on there, like the morning
  jobs. On a Saturday or a Sunday it skips itself, and while call notes are off.
- **Who:** each person with calls waiting in To confirm (being sorted, or waiting for them to
  confirm), as Today counts them, whose account can sign in and may open Call logs, at their own
  address when it is a Contour one (`internal_email_domains`): the email names no client, but an
  account's address can be anyone's.
- **Once a day a person:** who was told is kept in memory by Melbourne day, and each email's key
  (`calls-nudge:<person>:<day>`) stops a repeat at the email service after a restart (Resend keeps
  a key for 24 hours).
- **Email off** (no email service set up, or the log sender, which sends nothing): nothing is sent,
  the log says why (`calls_nudge_not_sent`), and the schedule says so in plain words.
- Free: no Claude, no HubSpot. Log lines hold counts and reasons only, never an address.
"""

import asyncio
import html
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any, Final
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies.links import call_logs_link
from apps.companies.meeting_job import email_sender
from apps.companies.tables import CallNote
from core.auth.features import effective_features, is_admin
from core.auth.models import User
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.email.internal import only_internal
from core.email.sender import EmailError, EmailNotSetUp, EmailSender, send
from core.prefs.service import effective_settings
from core.schedules.calc import Cadence
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSettingsError,
    JobSkipped,
    JobSpec,
)

log = logging.getLogger(__name__)

CALLS_NUDGE: Final = "companies.calls_nudge"
MELBOURNE: Final = ZoneInfo("Australia/Melbourne")
NUDGE_AT: Final = time(16, 30)  # the plan's calls_nudge_at (TBC): the schedule's starting time
WAITING: Final = ("sorting", "to_confirm")  # To confirm, as Today counts it
CALL_LOGS: Final = "companies.call_logs"

# What the Schedules page says (plain words, PLAN-V15 "Words for errors").
WEEKEND: Final = "It's the weekend. The reminder goes on weekdays."
NOTES_OFF: Final = "Call notes are switched off in Admin, Settings."
STILL_SENDING: Final = "Today's reminder is still being sent."
EMAIL_OFF: Final = "Email isn't switched on yet, so the reminder can't go. An admin can set it up."
# Why nothing was sent, for the log line only.
NO_SERVICE: Final = "no email service is set up"
LOG_ONLY: Final = "email goes to the log only"


# --- The app's parts ---------------------------------------------------------------------------


def _state(app: FastAPI) -> dict[str, Any]:
    """The task now sending, and who was told on which Melbourne day."""
    state: dict[str, Any] | None = getattr(app.state, "calls_nudge", None)
    if state is None:
        state = {"task": None, "day": None, "told": set()}
        app.state.calls_nudge = state
    return state


def _sessions(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    found: async_sessionmaker[AsyncSession] | None = getattr(app.state, "session_factory", None)
    return found or get_sessionmaker()


async def _settings(app: FastAPI) -> Settings:
    async with _sessions(app)() as session:
        return await effective_settings(session)


def sender_or_why(app: FastAPI, settings: Settings) -> EmailSender | str:
    """The email sender, or why email is off: no service set up, or the log sender (it writes the
    email to the log and sends nothing, so a reminder would reach nobody)."""
    try:
        sender = email_sender(app, settings)
    except EmailNotSetUp:
        return NO_SERVICE
    return LOG_ONLY if sender.provider == "log" else sender


# --- Who has calls waiting ------------------------------------------------------------------------


@dataclass(frozen=True)
class Waiting:
    """One person with calls waiting: their account, first name, address and how many."""

    user_id: uuid.UUID
    name: str
    address: str
    calls: int


def may_open_call_logs(user: User) -> bool:
    return is_admin(user.role) or CALL_LOGS in effective_features(user.role, user.features)


async def people_waiting(session: AsyncSession, settings: Settings) -> list[Waiting]:
    """Each person with calls waiting in To confirm, by name: only accounts that can sign in, may
    open Call logs, and have a Contour address."""
    rows = await session.execute(
        select(CallNote.made_by, func.count())
        .where(CallNote.made_by.is_not(None), CallNote.status.in_(WAITING))
        .group_by(CallNote.made_by)
    )
    counts: dict[uuid.UUID, int] = {made_by: count for made_by, count in rows.all() if made_by}
    if not counts:
        return []
    users = await session.scalars(
        select(User).where(User.id.in_(list(counts)), User.active.is_(True))
    )
    found = [
        Waiting(user_id=user.id, name=user.name, address=user.email, calls=counts[user.id])
        for user in users
        if may_open_call_logs(user)
        and only_internal([user.email], settings.internal_email_domains).allowed
    ]
    return sorted(found, key=lambda person: (person.name.casefold(), str(person.user_id)))


# --- The email ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class NudgeEmail:
    subject: str
    text: str
    html: str


def calls_line(calls: int) -> str:
    """Like "7 calls aren't in HubSpot yet."."""
    return "1 call isn't in HubSpot yet." if calls == 1 else f"{calls} calls aren't in HubSpot yet."


def nudge_email(name: str, calls: int, link: str) -> NudgeEmail:
    """The reminder: how many calls wait, and a link to Call logs. No client is named."""
    first = name.split()[0] if name.strip() else ""
    hello = f"Hi {first}," if first else "Hi,"
    line = calls_line(calls)
    text = f"{hello}\n\n{line} Check them and send them from Call logs:\n{link}\n"
    page = html.escape(link, quote=True)
    body = (
        f"<p>{html.escape(hello)}</p>"
        f"<p>{html.escape(line)} Check them and send them from Call logs: "
        f'<a href="{page}">open Call logs</a>.</p>'
    )
    return NudgeEmail(subject=line.rstrip("."), text=text, html=body)


# --- One afternoon --------------------------------------------------------------------------------


@dataclass
class Nudged:
    emailed: int = 0
    skipped: int = 0  # told already today
    failed: int = 0


def _told_today(app: FastAPI, day: date) -> set[uuid.UUID]:
    state = _state(app)
    if state["day"] != day:  # a new day: yesterday's list goes
        state["day"], state["told"] = day, set()
    told: set[uuid.UUID] = state["told"]
    return told


async def nudge(
    app: FastAPI, settings: Settings, sender: EmailSender, now: datetime | None = None
) -> Nudged:
    """One afternoon's reminders, to the end: one email a person with calls waiting, once a day."""
    now = now or datetime.now(UTC)
    day = now.astimezone(MELBOURNE).date()
    async with _sessions(app)() as session:
        waiting = await people_waiting(session, settings)
    told = _told_today(app, day)
    link = call_logs_link(settings)
    done = Nudged()
    for person in waiting:
        if person.user_id in told:
            done.skipped += 1
            continue
        email = nudge_email(person.name, person.calls, link)
        try:
            await send(
                [person.address],
                email.subject,
                email.text,
                email.html,
                sender=sender,
                key=f"calls-nudge:{person.user_id}:{day.isoformat()}",
            )
        except EmailError as error:  # its title is plain words, and holds no address
            log.warning("calls_nudge_not_sent", extra={"why": error.title})
            done.failed += 1
            continue
        told.add(person.user_id)
        done.emailed += 1
    log.info(
        "calls_nudge_done",
        extra={
            "people": len(waiting),
            "emailed": done.emailed,
            "skipped": done.skipped,
            "failed": done.failed,
        },
    )
    return done


# --- The schedule ---------------------------------------------------------------------------------


async def start_calls_nudge(context: JobContext) -> JobResult:
    local = context.now.astimezone(MELBOURNE)
    if local.weekday() >= 5:
        raise JobSkipped(WEEKEND)
    settings = await _settings(context.app)
    if not settings.call_notes_enabled:
        raise JobSkipped(NOTES_OFF)
    sender = sender_or_why(context.app, settings)
    if isinstance(sender, str):
        log.info("calls_nudge_not_sent", extra={"why": sender})
        raise JobSkipped(EMAIL_OFF)
    state = _state(context.app)
    task: asyncio.Task[Nudged] | None = state["task"]
    if task is not None and not task.done():
        raise JobSkipped(STILL_SENDING)
    state["task"] = asyncio.create_task(nudge(context.app, settings, sender, context.now))
    return JobResult(ref=f"calls-nudge:{local.date().isoformat()}")


async def calls_nudge_running(context: JobContext) -> bool:
    task: asyncio.Task[Nudged] | None = _state(context.app)["task"]
    return task is not None and not task.done()


async def estimate_calls_nudge(context: JobContext) -> JobEstimate:
    """Free: an email a person, no Claude and no HubSpot."""
    settings = await _settings(context.app)
    problem = None
    if not settings.call_notes_enabled:
        problem = NOTES_OFF
    elif isinstance(sender_or_why(context.app, settings), str):
        problem = EMAIL_OFF
    zero = Decimal(0)
    return JobEstimate(
        valid=True,
        problem=problem,
        typical_usd=zero,
        worst_usd=zero,
        cap_usd=zero,
        daily_left_usd=zero,
        basis="The reminder is free: one email a person, with no Claude and no HubSpot.",
    )


def describe_calls_nudge(settings: dict[str, Any]) -> str:
    return (
        "Emails each person whose calls aren't in HubSpot yet, on weekdays, with a link to Call "
        "logs. Once a day a person."
    )


def check_calls_nudge_settings(settings: dict[str, Any]) -> dict[str, Any]:
    if settings:
        raise JobSettingsError("The reminder has no choices here. Its time is set above.")
    return {}


JOB = JobSpec(
    key=CALLS_NUDGE,
    project="companies",
    title="Call logs: calls not sent yet",
    start=start_calls_nudge,
    running=calls_nudge_running,
    default=DefaultSchedule(cadence=Cadence(every=1, unit="days", at=NUDGE_AT), enabled=False),
    estimate=estimate_calls_nudge,
    describe=describe_calls_nudge,
    check_settings=check_calls_nudge_settings,
)
