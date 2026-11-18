"""The morning pre-reads (PLAN-V17 T2-13): a pre-read drafted before anyone asks, for each client
meeting coming up soon.

- **When:** every day at 6:40 am Melbourne time, after the 6:00 HubSpot sync and search ahead at
  6:30. On a Saturday or a Sunday it skips itself. It is off until a person switches it on
  (Admin, Schedules), and it runs only while Meetings are on.
- **Which meetings:** client meetings (linked to a company in our copy) that start from now to the
  end of the day `meeting_form_days_ahead` working days ahead (2, TBC: on a Friday, Monday and
  Tuesday), not cancelled, and with no pre-read yet. One form for each meeting (the table's unique
  index), so a meeting is never drafted twice.
- **Cost:** each draft keeps to its own cap (`meeting_form_cap_usd`), and the morning stops at
  the daily limit for all Claude spending. One morning costs about US$0.03 a meeting (TBC).
- **Telling the rep:** when a draft is ready, the meeting's owner gets one email, "Your pre-read
  for Sample Logistics is ready", with a link to `/assistant/meetings/<form id>` on the website
  (PLAN-V22 T1-6: the Assistant's Meetings; the old address still sends you on).
  The owner's name and address come through the `rep_of_owner` seam: the account linked to that
  HubSpot owner (Track 1's link). No rep, or no email set up: no email, and the pre-read still
  shows on the website.

Its drafts are made without the Lead Finder's facts, so everyone with the Companies tick may read
them, and with no person behind them (`trigger` job).
"""

import asyncio
import html
import logging
import math
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies.facts import scrub
from apps.companies.meeting_form import MeetingFormRunner, when_words
from apps.companies.meeting_store import MeetingSource, cancelled, client_meetings, forms_of
from apps.companies.tables import MeetingForm
from core.claude.client import get_claude
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.email.internal import only_internal
from core.email.sender import EmailError, EmailSender, get_sender, send
from core.hubspot.meetings import Meeting
from core.prefs.service import effective_settings
from core.runs.estimate import spent_last_24h
from core.schedules.calc import Cadence
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSettingsError,
    JobSkipped,
)

log = logging.getLogger(__name__)

MEETING_FORMS = "companies.meeting_forms"
MELBOURNE = ZoneInfo("Australia/Melbourne")
MAX_MEETINGS = 40  # the most one morning drafts
TYPICAL_FORM_USD = Decimal("0.03")  # TBC: T2-16 measures real drafts
TITLE_CHARS = 300
FORMS_OFF = "Meetings and pre-reads are switched off in Admin, Settings."
NOT_READ = "Meetings from HubSpot aren't read yet."
DAILY_LIMIT = "The daily limit for all Claude spending is used up."


# --- The app's parts ---------------------------------------------------------------------------


def _state(app: FastAPI) -> dict[str, Any]:
    state: dict[str, Any] | None = getattr(app.state, "meeting_forms_job", None)
    if state is None:
        state = {"task": None}
        app.state.meeting_forms_job = state
    return state


def _sessions(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    found: async_sessionmaker[AsyncSession] | None = getattr(app.state, "session_factory", None)
    return found or get_sessionmaker()


def _source(app: FastAPI) -> MeetingSource:
    source: MeetingSource | None = getattr(app.state, "meeting_source", None)
    if source is None:
        source = MeetingSource()
        app.state.meeting_source = source
    return source


def _runner(app: FastAPI) -> MeetingFormRunner:
    runner: MeetingFormRunner | None = getattr(app.state, "meeting_form_runner", None)
    if runner is None:
        runner = MeetingFormRunner(
            sessions=_sessions(app), claude=get_claude, meetings=_source(app)
        )
        app.state.meeting_form_runner = runner
    return runner


def email_sender(app: FastAPI, settings: Settings) -> EmailSender:
    """The sender the settings ask for. A test puts its own in `app.state.email_sender`. Raises
    `EmailNotSetUp` (an `EmailError`) while email isn't set up."""
    own: EmailSender | None = getattr(app.state, "email_sender", None)
    return own or get_sender(settings)


def app_url(settings: Settings) -> str:
    """The website's address for links: APP_URL, else the public origin, else the laptop's (as
    the Lead Finder's run email does)."""
    for url in (settings.app_url, settings.public_origin, *settings.cors_origins):
        if url:
            return url.rstrip("/")
    return "http://localhost:5173"


def form_link(settings: Settings, form_id: uuid.UUID) -> str:
    """The pre-read's page on the website: the Assistant's Meetings (PLAN-V22 T1-6)."""
    return f"{app_url(settings)}/assistant/meetings/{quote(str(form_id))}"


# --- Which meetings -------------------------------------------------------------------------------


def window_end(now: datetime, working_days: int) -> datetime:
    """The end of the day `working_days` working days after today, in Melbourne: from a Friday
    with 2, the end of Tuesday."""
    day = now.astimezone(MELBOURNE).date()
    left = working_days
    while left > 0:
        day += timedelta(days=1)
        if day.weekday() < 5:
            left -= 1
    return datetime.combine(day + timedelta(days=1), time(0), tzinfo=MELBOURNE).astimezone(UTC)


async def pick_meetings(
    session: AsyncSession, source: MeetingSource, settings: Settings, now: datetime
) -> list[tuple[Meeting, str]]:
    """The client meetings to draft, soonest first: from now to the end of the window, not
    cancelled, and with no pre-read yet. None while HubSpot's meetings aren't read."""
    if (await source.status(session)).state != "ready":
        return []
    end = window_end(now, settings.meeting_form_days_ahead)
    days = max(1, math.ceil((end - now).total_seconds() / 86_400))
    found = await client_meetings(session, await source.upcoming(session, owner_id=None, days=days))
    soon = [
        (meeting, name)
        for meeting, name in found
        if now <= meeting.starts_at < end and not cancelled(meeting)
    ]
    forms = await forms_of(session, [meeting.id for meeting, _ in soon])
    picked = [(meeting, name) for meeting, name in soon if meeting.id not in forms]
    picked.sort(key=lambda pair: pair[0].starts_at)
    return picked[:MAX_MEETINGS]


def job_form(meeting: Meeting, company_name: str) -> MeetingForm:
    """A pre-read the morning job starts: the meeting as it is now, and no person behind it."""
    title = " ".join(scrub(meeting.title).split())[:TITLE_CHARS] or "Meeting"
    return MeetingForm(
        meeting_id=meeting.id,
        company_key=meeting.company_id,
        company_name=company_name,
        title=title,
        starts_at=meeting.starts_at,
        ends_at=meeting.ends_at,
        where=meeting.where,
        status="drafting",
        made_by=None,
        trigger="job",
    )


# --- Telling the rep ------------------------------------------------------------------------------


@dataclass(frozen=True)
class ReadyEmail:
    subject: str
    text: str
    html: str


def ready_email(rep_name: str, company_name: str, meeting: Meeting, link: str) -> ReadyEmail:
    """ "Your pre-read for Sample Logistics is ready", with the meeting and a link. Company names,
    a title and a time: no contact details."""
    first = rep_name.split()[0] if rep_name.strip() else ""
    hello = f"Hi {first}," if first else "Hi,"
    title = " ".join(scrub(meeting.title).split())
    when = when_words(meeting.starts_at, meeting.ends_at)
    subject = f"Your pre-read for {company_name} is ready"
    text = (
        f"{hello}\n\n"
        f"Your pre-read for the meeting with {company_name} ({title}, {when}) is ready.\n"
        "Check it, fill in the ideal next step and who is going, then send it to the team:\n"
        f"{link}\n"
    )
    page = html.escape(link, quote=True)
    body = (
        f"<p>{html.escape(hello)}</p>"
        f"<p>Your pre-read for the meeting with {html.escape(company_name)} "
        f"({html.escape(title)}, {html.escape(when)}) is ready.</p>"
        "<p>Check it, fill in the ideal next step and who is going, then send it to the team: "
        f'<a href="{page}">open the pre-read</a>.</p>'
    )
    return ReadyEmail(subject=subject, text=text, html=body)


async def tell_rep(
    app: FastAPI,
    settings: Settings,
    meeting: Meeting,
    company_name: str,
    form_id: uuid.UUID,
) -> bool:
    """One email to the meeting's owner. False when there is nobody to tell, or email can't go:
    the pre-read still shows. Its key is the form's, so it is never sent twice. Like a pre-read,
    it goes to a Contour address only: it names the client and the meeting."""
    if not meeting.owner_id:
        return False
    async with _sessions(app)() as session:
        rep = await _source(app).rep_of_owner(session, meeting.owner_id)
    if rep is None:
        return False
    name, address = rep
    if not only_internal([address], settings.internal_email_domains)[0]:
        log.warning(
            "meeting_form_email_not_sent",
            extra={"form_id": str(form_id), "why": "Not a Contour address"},
        )
        return False
    email = ready_email(name, company_name, meeting, form_link(settings, form_id))
    try:
        await send(
            [address],
            email.subject,
            email.text,
            email.html,
            sender=email_sender(app, settings),
            key=f"meeting-form-ready:{form_id}",
        )
    except EmailError as error:  # its title is plain words, and holds no address
        log.warning(
            "meeting_form_email_not_sent", extra={"form_id": str(form_id), "why": error.title}
        )
        return False
    return True


# --- One morning ----------------------------------------------------------------------------------


@dataclass
class Morning:
    drafted: int = 0
    failed: int = 0
    skipped: int = 0
    emailed: int = 0
    spent_usd: Decimal = Decimal(0)
    stopped: str | None = None


async def draft_morning(app: FastAPI, settings: Settings, now: datetime | None = None) -> Morning:
    """One morning's pre-reads, to the end. The drafts run one after the other."""
    now = now or datetime.now(UTC)
    sessions = _sessions(app)
    runner = _runner(app)
    morning = Morning()
    async with sessions() as session:
        picked = await pick_meetings(session, _source(app), settings, now)
    for meeting, company_name in picked:
        async with sessions() as session:
            form = job_form(meeting, company_name)
            session.add(form)
            try:
                await session.commit()
            except IntegrityError:  # someone started this meeting's pre-read a moment ago
                await session.rollback()
                morning.skipped += 1
                continue
            form_id = form.id
        failed = await runner.run(form_id, [])  # no Lead Finder facts: everyone may read it
        async with sessions() as session:
            done = await session.get(MeetingForm, form_id)
            morning.spent_usd += done.cost_usd if done is not None else Decimal(0)
        if failed == "daily_limit":
            morning.stopped = "It stopped at the daily limit for all Claude spending."
            break
        if failed is not None:
            morning.failed += 1
            continue
        morning.drafted += 1
        if await tell_rep(app, settings, meeting, company_name, form_id):
            morning.emailed += 1
    log.info(
        "meeting_forms_done",
        extra={
            "drafted": morning.drafted,
            "failed": morning.failed,
            "skipped": morning.skipped,
            "emailed": morning.emailed,
            "spent_usd": str(morning.spent_usd),
        },
    )
    return morning


# --- The schedule ---------------------------------------------------------------------------------


async def _settings(app: FastAPI) -> Settings:
    async with _sessions(app)() as session:
        return await effective_settings(session)


async def start_meeting_forms(context: JobContext) -> JobResult:
    local = context.now.astimezone(MELBOURNE)
    if local.weekday() >= 5:
        raise JobSkipped("It's the weekend. Pre-reads are drafted on weekdays.")
    settings = await _settings(context.app)
    if not settings.meeting_forms_enabled:
        raise JobSkipped(FORMS_OFF)
    state = _state(context.app)
    task: asyncio.Task[Morning] | None = state["task"]
    if task is not None and not task.done():
        raise JobSkipped("This morning's pre-reads are still being drafted.")
    async with _sessions(context.app)() as session:
        status = await _source(context.app).status(session)
    if status.state != "ready":
        raise JobSkipped(status.sentence or NOT_READ)
    state["task"] = asyncio.create_task(draft_morning(context.app, settings, context.now))
    return JobResult(ref=f"meeting-forms:{local.date().isoformat()}")


async def meeting_forms_running(context: JobContext) -> bool:
    task: asyncio.Task[Morning] | None = _state(context.app)["task"]
    return task is not None and not task.done()


async def estimate_meeting_forms(context: JobContext) -> JobEstimate:
    settings = await _settings(context.app)
    async with _sessions(context.app)() as session:
        left = max(Decimal(0), settings.daily_cap_usd - await spent_last_24h(session))
        status = await _source(context.app).status(session)
        meetings = len(await pick_meetings(session, _source(context.app), settings, context.now))
    problem = None
    if not settings.meeting_forms_enabled:
        problem = FORMS_OFF
    elif status.state != "ready":
        problem = status.sentence or NOT_READ
    elif left <= 0:
        problem = DAILY_LIMIT
    cap = settings.meeting_form_cap_usd
    worst = cap * meetings
    days = settings.meeting_form_days_ahead
    return JobEstimate(
        valid=True,
        problem=problem,
        typical_usd=TYPICAL_FORM_USD * meetings,
        worst_usd=worst,
        cap_usd=worst,
        daily_left_usd=left,
        basis=(
            f"About US${TYPICAL_FORM_USD:.2f} a pre-read (TBC), for {meetings} client "
            f"meetings in the next {days} working days that have none. Each pre-read stops at "
            f"US${cap:.2f}."
        ),
    )


def describe_meeting_forms(settings: dict[str, Any]) -> str:
    return (
        "Drafts a pre-read for each client meeting coming up in the next working days that has "
        "none, on weekdays, and emails the rep a link to check and send it."
    )


def check_meeting_forms_settings(settings: dict[str, Any]) -> dict[str, Any]:
    if settings:
        raise JobSettingsError(
            "Pre-reads have no choices here. How far ahead they look is on Admin, Settings."
        )
    return {}


DEFAULT = DefaultSchedule(cadence=Cadence(every=1, unit="days", at=time(6, 40)), enabled=False)
