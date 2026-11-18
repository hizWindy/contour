"""Today, the Assistant's first page (PLAN-V22 T1-3, choices 6 to 9): my open HubSpot tasks, my
meetings today and tomorrow, my calls to confirm, and my open deals that need a nudge, the most
urgent first. It makes no Claude request, so it is free. The route is in api_assistant.py.

- **Tasks** come from HubSpot (`core/hubspot/tasks.py`: one search, then one read of their links
  to companies). They are read when Today opens and kept for 5 minutes a person (`TaskCopy`, in
  memory, so it starts again when the backend restarts: TBC). Sync (`fresh=true`) reads them
  again, but HubSpot is asked at most once a minute a person, whatever asks. A read gets 10
  seconds (TBC). A Done, a reopen or a new task (T1-4) changes the kept copy at once, and is laid
  over the reads of the next 2 minutes, as HubSpot's search lags behind a change (TBC).
- **No HubSpot link, no tasks** (choice 9): Today says so, and the rest still shows.
- **Meetings** come from our copy of HubSpot (core's meeting reads, as Meetings has them): the
  ones I own or am on, today and tomorrow (Melbourne), not cancelled, with a client company in
  our copy, each with its pre-read; and my own pre-reads for meetings typed in on those days.
- **Calls:** my notes to confirm and those that need a look, as `GET /call-notes/summary` counts.
- **Deals:** my open deals (`stage_kind`) whose close date has passed, or whose company nobody has
  talked to for `today_quiet_days` days (14, TBC with Levi), at most 50 (`store.deals_to_nudge`).
- **Who sees what** (`parts`): tasks and deals, anyone with the Assistant; meetings, the Meetings
  tick while pre-meeting forms are on; calls, the Call logs tick while call notes are on.
- With sign-in off nobody is "me": no tasks, and everyone's meetings and deals (as Home does).
- No database connection is held while HubSpot answers. Log lines hold counts and states only.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta
from typing import Final, Literal

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import note_store, store
from apps.companies.assistant_schemas import (
    DealReason,
    TasksState,
    Today,
    TodayCalls,
    TodayCompany,
    TodayDeal,
    TodayMeeting,
    TodayPart,
    TodayTask,
)
from apps.companies.meeting_store import (
    MeetingSource,
    cancelled,
    client_meetings,
    clock_words,
    company_names,
    forms_of,
    my_owner,
    typed_meetings,
)
from apps.companies.notes import MELBOURNE
from apps.companies.schemas import MeetingFormState
from core.api.access import can_feature
from core.auth import users
from core.auth.sessions import AuthContext
from core.config import Settings
from core.hubspot.client import HubSpotError, HubSpotMissingScope, HubSpotUnavailable
from core.hubspot.connection import hubspot_set_up, open_hubspot
from core.hubspot.meetings import Meeting
from core.hubspot.tasks import OpenTask, TaskRead, open_tasks

log = logging.getLogger(__name__)

KEEP_FOR: Final = timedelta(minutes=5)  # a read is kept this long a person (choice 7, TBC)
READ_EVERY: Final = timedelta(minutes=1)  # HubSpot is asked at most this often a person
CHANGES_HOLD: Final = timedelta(minutes=2)  # a change made here is laid over reads this long
READ_SECONDS: Final = 10.0  # the longest wait for HubSpot's tasks (TBC)
SOON_DAYS: Final = 7  # tasks due in the next 7 days show, folded (choice 6)
DEALS_CAP: Final = 50
MEETING_DAYS_READ: Final = 3  # read ahead, then only today and tomorrow (Melbourne) are kept
BEFORE_CAP: Final = 200  # the most tasks a person's copy remembers as they were before
MONTHS: Final = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# --- The words (PLAN-V22 "Words for when things go wrong") ---------------------------------------

NO_LINK: Final = "Today needs your account linked to HubSpot. Ask {asker} to link it."
NO_ACCOUNT: Final = "Nobody is signed in, so there are no tasks of your own to show."
CANT_READ: Final = "We can't read your HubSpot tasks yet. Your meetings and calls still show."
NOT_CONNECTED: Final = (
    "HubSpot isn't connected yet, so your tasks can't show. Your meetings and calls still show."
)
FROM_EARLIER: Final = (
    "HubSpot didn't answer, so these tasks are from {time}. Try again in a minute."
)
NO_CLIENT: Final = "HubSpot isn't connected"  # a read with no client: it counts as failed
PLATFORM_ADMIN: Final = "the Platform admin"

ReadProblem = Literal["no_access", "failed"]
type TaskReader = Callable[[], Awaitable[TaskRead]]


# --- Each person's tasks, kept for 5 minutes --------------------------------------------------


@dataclass
class _Entry:
    """One person's tasks: the last good read, the last try, how it ended, the changes made here
    (task id -> the task as it is now, or None once done, and when), and each changed task as it
    was before its change (so a reopen keeps its company)."""

    read: TaskRead | None = None
    read_at: datetime | None = None
    tried_at: datetime | None = None
    problem: ReadProblem | None = None
    changes: dict[str, tuple[OpenTask | None, datetime]] = field(default_factory=dict)
    before: dict[str, OpenTask] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(frozen=True)
class KeptTasks:
    """What Today shows of one person's tasks, and from when."""

    state: TasksState
    tasks: tuple[OpenTask, ...] = ()
    more: int = 0
    read_at: datetime | None = None
    from_earlier: bool = False  # the last read failed, so these are from an earlier one


def _with_change(read: TaskRead, task_id: str, task: OpenTask | None) -> TaskRead:
    tasks = [kept for kept in read.tasks if kept.id != task_id]
    if task is not None:
        tasks.append(task)
    tasks.sort(key=lambda kept: kept.due_at, reverse=True)
    return replace(read, tasks=tuple(tasks))


class TaskCopy:
    """Each person's open tasks as last read from HubSpot, by their HubSpot owner id, with the
    changes made here since. It lives on `app.state.today_tasks`; a test puts its own."""

    def __init__(self) -> None:
        self._entries: dict[str, _Entry] = {}

    def _entry(self, owner: str) -> _Entry:
        return self._entries.setdefault(owner, _Entry())

    async def tasks(self, owner: str, *, now: datetime, fresh: bool, read: TaskReader) -> KeptTasks:
        """The person's tasks: kept, or read now when the copy is 5 minutes old (or Sync asks),
        but never twice in a minute. Two asks at once make one read."""
        entry = self._entry(owner)
        async with entry.lock:
            if self._due(entry, now, fresh):
                problem: ReadProblem | None = None
                found: TaskRead | None = None
                try:
                    found = await read()
                except HubSpotMissingScope:
                    problem = "no_access"
                except (HubSpotError, TimeoutError) as error:
                    log.warning("today_tasks_failed", extra={"error": type(error).__name__})
                    problem = "failed"
                except Exception as error:  # a fault here never stops the rest of Today
                    log.warning("today_tasks_fault", extra={"error": type(error).__name__})
                    problem = "failed"
                entry.tried_at, entry.problem = now, problem
                if found is not None:
                    entry.read, entry.read_at = self._laid_over(entry, found, now), now
            return self._shown(entry)

    def change(self, owner: str, task_id: str, task: OpenTask | None, now: datetime) -> None:
        """A change made here (T1-4): `task` as it is now, or None once it is done. The kept copy
        changes at once, and the reads of the next 2 minutes get it too."""
        entry = self._entry(owner)
        known = self.kept(owner, task_id)
        if known is not None:
            entry.before.pop(task_id, None)
            entry.before[task_id] = known
            while len(entry.before) > BEFORE_CAP:  # the oldest go first
                del entry.before[next(iter(entry.before))]
        self._prune(entry, now)
        entry.changes[task_id] = (task, now)
        if entry.read is not None:
            entry.read = _with_change(entry.read, task_id, task)

    def kept(self, owner: str, task_id: str) -> OpenTask | None:
        """A task as the copy has it now, else as a change made here left it, else as it was
        before its last change here (a task ticked done). None when it was never kept."""
        entry = self._entries.get(owner)
        if entry is None:
            return None
        found = entry.read.tasks if entry.read is not None else ()
        kept = next((task for task in found if task.id == task_id), None)
        changed = entry.changes.get(task_id)
        if kept is None and changed is not None:
            kept = changed[0]
        return kept or entry.before.get(task_id)

    @staticmethod
    def _due(entry: _Entry, now: datetime, fresh: bool) -> bool:
        if entry.tried_at is not None and now - entry.tried_at < READ_EVERY:
            return False
        if fresh or entry.read_at is None:
            return True
        return now - entry.read_at >= KEEP_FOR

    @staticmethod
    def _laid_over(entry: _Entry, found: TaskRead, now: datetime) -> TaskRead:
        """A fresh read, with the changes of the last 2 minutes that HubSpot's search may not
        show yet: a task done here is left out, and one added or opened again here is added when
        the read doesn't have it (when it does, HubSpot's own record wins)."""
        TaskCopy._prune(entry, now)
        read_ids = {task.id for task in found.tasks}
        for task_id, (task, _) in entry.changes.items():
            if task is None or task_id not in read_ids:
                found = _with_change(found, task_id, task)
        return found

    @staticmethod
    def _prune(entry: _Entry, now: datetime) -> None:
        """Forgets the changes made here over 2 minutes ago: HubSpot's search shows them now."""
        for task_id, (_, at) in list(entry.changes.items()):
            if now - at >= CHANGES_HOLD:
                del entry.changes[task_id]

    @staticmethod
    def _shown(entry: _Entry) -> KeptTasks:
        if entry.problem == "no_access":
            return KeptTasks(state="no_access")
        if entry.read is None:
            return KeptTasks(state="failed")
        return KeptTasks(
            state="ok",
            tasks=entry.read.tasks,
            more=entry.read.more,
            read_at=entry.read_at,
            from_earlier=entry.problem == "failed",
        )


# --- Today ---------------------------------------------------------------------------------------


def parts_of(auth: AuthContext | None, settings: Settings) -> list[TodayPart]:
    parts: list[TodayPart] = ["tasks"]
    if settings.meeting_forms_enabled and can_feature(auth, "companies.meetings"):
        parts.append("meetings")
    if settings.call_notes_enabled and can_feature(auth, "companies.call_logs"):
        parts.append("calls")
    parts.append("deals")
    return parts


def day_of(moment: datetime) -> date:
    return moment.astimezone(MELBOURNE).date()


def window_end(today: date) -> datetime:
    """Tasks due before this show: the end of the 7th day after today, Melbourne time."""
    return datetime.combine(today + timedelta(days=SOON_DAYS + 1), time(0), tzinfo=MELBOURNE)


def day_words(day: date, today: date) -> str:
    """Like "12 Nov", or "12 Nov 2025" in another year."""
    words = f"{day.day} {MONTHS[day.month - 1]}"
    return words if day.year == today.year else f"{words} {day.year}"


def why_of(deal: store.DealToNudge, today: date, quiet_days: int) -> tuple[str, list[DealReason]]:
    """Why a deal needs a nudge, in words and as reasons."""
    words: list[str] = []
    reasons: list[DealReason] = []
    if deal.close_date is not None and deal.close_date < today:
        words.append(f"Close date passed, {day_words(deal.close_date, today)}")
        reasons.append("close_date_passed")
    if deal.last_contact is None:
        words.append("No contact on record")
        reasons.append("quiet")
    else:
        days = (today - deal.last_contact).days
        if days >= quiet_days:
            words.append(f"No contact for {days} {'day' if days == 1 else 'days'}")
            reasons.append("quiet")
    return ". ".join(words), reasons


def task_out(task: OpenTask, names: dict[str, str], today: date) -> TodayTask:
    due = day_of(task.due_at)
    company = None
    if task.company_id is not None and task.company_id in names:
        company = TodayCompany(key=task.company_id, name=names[task.company_id])
    return TodayTask(
        id=task.id,
        subject=task.subject,
        kind=task.kind,
        priority=task.priority,
        due=due,
        due_at=task.due_at,
        overdue=due < today,
        group="overdue" if due < today else "today" if due == today else "soon",
        company=company,
        hubspot_url=task.url,
    )


def in_order(tasks: Iterable[TodayTask]) -> list[TodayTask]:
    """Overdue first, then today's, then the next 7 days', each soonest due first."""
    rank = {"overdue": 0, "today": 1, "soon": 2}
    return sorted(tasks, key=lambda task: (rank[task.group], task.due_at, task.id))


async def my_tasks(
    app: FastAPI,
    copy: TaskCopy,
    *,
    auth: AuthContext | None,
    me: str | None,
    now: datetime,
    fresh: bool,
) -> KeptTasks:
    """My open tasks, kept or read now. HubSpot isn't connected: off. No link: no_owner."""
    if not hubspot_set_up(app):
        return KeptTasks(state="off")
    if auth is None or me is None:
        return KeptTasks(state="no_owner")
    due_before = window_end(day_of(now))

    async def read() -> TaskRead:
        async with asyncio.timeout(READ_SECONDS), open_hubspot(app) as hubspot:
            if hubspot is None:
                raise HubSpotUnavailable(NO_CLIENT, CANT_READ)
            return await open_tasks(hubspot, me, due_before=due_before)

    kept = await copy.tasks(me, now=now, fresh=fresh, read=read)
    shown = tuple(task for task in kept.tasks if task.due_at < due_before)
    return replace(kept, tasks=shown)


async def my_meetings(
    session: AsyncSession,
    auth: AuthContext | None,
    *,
    me: str | None,
    source: MeetingSource,
    now: datetime,
) -> list[TodayMeeting]:
    """My meetings today and tomorrow (Melbourne), soonest first: from our copy of HubSpot's
    (with a client company, not cancelled), and my own typed-in pre-reads."""
    today = day_of(now)
    days = {today: "today", today + timedelta(days=1): "tomorrow"}
    found: list[tuple[Meeting, str, MeetingFormState | None]] = []
    if (await source.status(session)).state == "ready" and (auth is None or me is not None):
        read = [
            *await source.past(session, owner_id=me, days=1),
            *await source.upcoming(session, owner_id=me, days=MEETING_DAYS_READ),
        ]
        picked = [m for m in read if not cancelled(m) and day_of(m.starts_at) in days]
        linked = await client_meetings(session, picked)
        forms = await forms_of(session, [meeting.id for meeting, _ in linked])
        found += [(meeting, name, forms.get(meeting.id)) for meeting, name in linked]
    for upcoming in (False, True):
        for entry in await typed_meetings(session, auth, upcoming=upcoming, now=now):
            if day_of(entry.meeting.starts_at) in days:
                found.append((entry.meeting, entry.company_name, entry.typed))
    found.sort(key=lambda item: (item[0].starts_at, item[0].id))
    return [
        TodayMeeting(
            id=meeting.id or None,
            title=meeting.title,
            starts_at=meeting.starts_at,
            ends_at=meeting.ends_at,
            day="today" if day_of(meeting.starts_at) == today else "tomorrow",
            company=TodayCompany(key=meeting.company_id or "", name=name),
            form=form,
            hubspot_url=meeting.hubspot_url,
        )
        for meeting, name, form in found
    ]


async def my_deals(
    session: AsyncSession,
    auth: AuthContext | None,
    *,
    me: str | None,
    settings: Settings,
    now: datetime,
) -> tuple[list[TodayDeal], int]:
    """My open deals that need a nudge, and how many more there are. No link: none."""
    if auth is not None and me is None:
        return [], 0
    today = day_of(now)
    quiet_days = settings.today_quiet_days
    rows, total = await store.deals_to_nudge(
        session, me, on=today, quiet_days=quiet_days, limit=DEALS_CAP
    )
    deals: list[TodayDeal] = []
    for row in rows:
        why, reasons = why_of(row, today, quiet_days)
        deals.append(
            TodayDeal(
                id=row.deal_id,
                name=row.name,
                company=TodayCompany(key=row.company_key, name=row.company_name),
                stage=row.stage,
                close_date=row.close_date,
                last_contact=row.last_contact,
                why=why,
                reasons=reasons,
                hubspot_url=row.hubspot_url,
            )
        )
    return deals, max(0, total - len(rows))


async def tasks_sentence(
    session: AsyncSession, kept: KeptTasks, auth: AuthContext | None, now: datetime
) -> str | None:
    """The tasks' plain words when they can't show, or show from an earlier read."""
    if kept.state == "ok":
        if kept.from_earlier and kept.read_at is not None:
            return FROM_EARLIER.format(time=clock_words(kept.read_at, now))
        return None
    if kept.state == "off":
        return NOT_CONNECTED
    if kept.state == "no_owner":
        if auth is None:
            return NO_ACCOUNT
        return NO_LINK.format(asker=await users.platform_admin_name(session) or PLATFORM_ADMIN)
    return CANT_READ


async def build_today(
    session: AsyncSession,
    *,
    app: FastAPI,
    auth: AuthContext | None,
    settings: Settings,
    source: MeetingSource,
    copy: TaskCopy,
    now: datetime,
    fresh: bool,
) -> Today:
    """Today, from our copy and HubSpot's tasks. The database is read first, and its connection
    let go, before HubSpot is asked."""
    parts = parts_of(auth, settings)
    me = await my_owner(session, auth, source)
    meetings = (
        await my_meetings(session, auth, me=me, source=source, now=now)
        if "meetings" in parts
        else []
    )
    calls = TodayCalls(to_confirm=0, needs_look=0)
    if "calls" in parts:
        counted = await note_store.summary(session, auth, now)
        calls = TodayCalls(to_confirm=counted.to_confirm, needs_look=counted.needs_look)
    deals, deals_more = await my_deals(session, auth, me=me, settings=settings, now=now)
    if session.in_transaction():
        await session.rollback()  # it only read: no connection waits on HubSpot
    kept = await my_tasks(app, copy, auth=auth, me=me, now=now, fresh=fresh)
    names = await company_names(session, (task.company_id for task in kept.tasks))
    today = day_of(now)
    tasks = in_order(task_out(task, names, today) for task in kept.tasks)
    sentence = await tasks_sentence(session, kept, auth, now)
    if session.in_transaction():
        await session.rollback()
    log.info(
        "today",
        extra={
            "tasks_state": kept.state,
            "tasks": len(tasks),
            "meetings": len(meetings),
            "deals": len(deals),
        },
    )
    return Today(
        parts=parts,
        tasks=tasks,
        tasks_state=kept.state,
        tasks_sentence=sentence,
        tasks_more=kept.more,
        meetings=meetings,
        calls=calls,
        deals=deals,
        deals_more=deals_more,
        quiet_days=settings.today_quiet_days,
        checked_at=kept.read_at or now,
    )
