"""HubSpot tasks for the Assistant (PLAN-V22): a rep's open tasks for Today (T1-3), and a task
ticked done or opened again (T1-4). A new task is an activity (`activities.py`).

**The read** (`open_tasks`) is two requests, the way the meetings read is (`meetings.py`):
1. One search: the owner's tasks that aren't completed and are due before a time (overdue ones
   included), latest due first. HubSpot's search answer holds no links to other records (our
   search sends none, as for meetings), so
2. one batch read of the tasks' links to companies (`linked`, 100 tasks a request).

At most `TASKS_CAP` (100) tasks, so the links take one request. Latest due first means a rep with
many old overdue tasks still sees today's and the week's: only the oldest overdue ones are left
out, and `TaskRead.more` counts them. Each task is checked again in code: one owned by someone
else, completed, or with no due time is never kept.

A task's subject is kept as one line with its email addresses and phone numbers blanked, as a
meeting's title is. Its body is never read. Log lines hold ids, counts and states only, never a
subject.

**Done and reopen** (`set_status`) change one field, the task's status, through the writer's
parts (`writer.py`), so each is a row in `core.hubspot_writes` (its plan's kind is `task`, its one
step `status`):
1. The task is read again first. One HubSpot doesn't have is `TaskNotFound`; one that isn't the
   asking rep's (their HubSpot owner id) is `NotYourTask`, and nothing is written or saved.
2. The row is saved with the plan (the status now and the one to send), then claimed.
3. A task that has that status already is done, and nothing is sent. Otherwise the status is
   sent. A change that timed out is checked by reading the task again: there, done; not there,
   failed. A status sent twice can't double anything, so trying again is safe.
Reopen sets the status the task had before its last Done here (`status_before_done`), else Not
started.
"""

import logging
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.activities import (
    CONTOUR_ZONE,
    FOUND_DETAIL,
    MONTHS,
    WEEKDAYS,
    TaskKind,
    TaskPriority,
)
from core.hubspot.client import (
    BATCH_SIZE,
    Association,
    Filter,
    HubSpot,
    HubSpotError,
    HubSpotNotFound,
    HubSpotObject,
    HubSpotWritesOff,
    HubSpotWriteUncertain,
    primary_company,
)
from core.hubspot.meetings import without_contact_details
from core.hubspot.models import HubSpotWrite
from core.hubspot.writer import (
    Claim,
    FieldChange,
    StepResult,
    WriteOut,
    WritePlan,
    claim_write,
    error_of,
    failed_step,
    save_preview,
    status_of,
    steps_json,
    write_out,
)

log = logging.getLogger(__name__)

DUE: Final = "hs_timestamp"  # a task's due time (HubSpot's own field for it)
OWNER: Final = "hubspot_owner_id"
STATUS: Final = "hs_task_status"
SUBJECT: Final = "hs_task_subject"
DONE: Final = "COMPLETED"  # HubSpot's status for a task that is done
OPEN: Final = "NOT_STARTED"  # HubSpot's status for a new task, and for one opened again
FIELDS: Final = (SUBJECT, STATUS, "hs_task_type", "hs_task_priority", DUE, OWNER)
TASKS_CAP: Final = BATCH_SIZE  # the most tasks one read keeps: one search, one links request
SUBJECT_CHARS: Final = 300
UNTITLED: Final = "Untitled task"
KINDS: Final[Mapping[str, TaskKind]] = {"CALL": "call", "EMAIL": "email"}  # anything else: todo
PRIORITIES: Final[Mapping[str, TaskPriority]] = {"LOW": "low", "MEDIUM": "medium", "HIGH": "high"}


@dataclass(frozen=True)
class OpenTask:
    """One of a rep's open tasks, as Today shows it."""

    id: str
    subject: str
    kind: TaskKind
    status: str  # HubSpot's, like NOT_STARTED or IN_PROGRESS: never COMPLETED here
    priority: TaskPriority | None
    due_at: datetime  # in UTC
    owner_id: str
    company_id: str | None = None  # its primary company, else the first one it is linked to
    url: str | None = None  # the task in HubSpot


@dataclass(frozen=True)
class TaskRead:
    """One read: the tasks kept, latest due first, and how many more HubSpot has."""

    tasks: tuple[OpenTask, ...]
    more: int = 0


def _ms(moment: datetime) -> str:
    return str(int(moment.astimezone(UTC).timestamp() * 1000))


def moment_of(value: str | None) -> datetime | None:
    """A HubSpot time: milliseconds since 1970, or ISO text. None when it can't be read."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        if text.isascii() and text.isdigit():
            return datetime.fromtimestamp(int(text) / 1000, tz=UTC)
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    return moment.astimezone(UTC) if moment.tzinfo else moment.replace(tzinfo=UTC)


def subject_of(value: str | None) -> str:
    """The subject as one line, email addresses and phone numbers blanked."""
    cleaned = " ".join(without_contact_details(value or "").split())
    return cleaned[:SUBJECT_CHARS].rstrip() or UNTITLED


def task_of(record: HubSpotObject, owner_id: str) -> OpenTask | None:
    """A searched task as Today keeps it, or None: owned by someone else, completed, or with no
    due time (it can't be placed)."""
    owner = (record.text(OWNER) or "").strip()
    status = (record.text(STATUS) or "").strip().upper()
    due_at = moment_of(record.text(DUE))
    if owner != owner_id or status == DONE or due_at is None:
        return None
    return OpenTask(
        id=record.id,
        subject=subject_of(record.text(SUBJECT)),
        kind=KINDS.get((record.text("hs_task_type") or "").strip().upper(), "todo"),
        status=status or OPEN,
        priority=PRIORITIES.get((record.text("hs_task_priority") or "").strip().upper()),
        due_at=due_at,
        owner_id=owner,
        url=record.url,
    )


def company_of(links: Sequence[Association]) -> str | None:
    """A task's company: the primary one, else the only one, else the first HubSpot lists."""
    return primary_company({"companies": links}) or (links[0].id if links else None)


async def open_tasks(
    hubspot: HubSpot, owner_id: str, *, due_before: datetime, limit: int = TASKS_CAP
) -> TaskRead:
    """The owner's open tasks due before `due_before` (overdue included), latest due first, each
    with its company. Two requests: the search, then the links (none when nothing is found).
    Raises `HubSpotMissingScope` when the key can't read tasks, and any other `HubSpotError`
    when HubSpot doesn't answer."""
    wanted = max(1, min(limit, TASKS_CAP))
    page = await hubspot.search_objects(
        "tasks",
        filters=[
            Filter(OWNER, "EQ", owner_id),
            Filter(STATUS, "NEQ", DONE),
            Filter(DUE, "LT", _ms(due_before)),
        ],
        properties=FIELDS,
        sort_by=DUE,
        descending=True,
        limit=wanted,
    )
    found = [task for record in page.results if (task := task_of(record, owner_id)) is not None]
    found = [task for task in found if task.due_at < due_before][:wanted]
    links = await hubspot.linked("tasks", "companies", [task.id for task in found]) if found else {}
    tasks = tuple(replace(task, company_id=company_of(links.get(task.id, ()))) for task in found)
    more = max(0, (page.total or 0) - len(page.results))
    log.info("hubspot_tasks_read", extra={"tasks": len(tasks), "more": more})
    return TaskRead(tasks=tasks, more=more)


# --- Done and reopen (T1-4) ----------------------------------------------------------------------

STATUS_STEP: Final = "status"
STATUS_SUBJECT: Final = "task_status"  # the write's subject: task_status:<task id>:<a fresh key>
OPEN_STATUSES: Final = frozenset({"NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"})
NO_COMPANY: Final = "Company not known"
STATUS_LABEL: Final = "Status"
DONE_DETAIL: Final = "Ticked the task done."
REOPENED_DETAIL: Final = "Opened the task again."
ALREADY_DONE_DETAIL: Final = "HubSpot has this task done already, so nothing was sent."
ALREADY_OPEN_DETAIL: Final = "HubSpot has this task open already, so nothing was sent."
# A step's words say what happened. The route that shows one adds the next step.
NOT_THERE_DETAIL: Final = "HubSpot didn't answer, and the change isn't there."
UNREAD_DETAIL: Final = (
    "HubSpot didn't answer, so the change may or may not be there. Sending it again is safe: a "
    "status sent twice changes nothing."
)
GONE_DETAIL: Final = "This task isn't in HubSpot any more. It may have been deleted there."


class TaskNotFound(Exception):
    """HubSpot has no task with this id (or it was deleted)."""


class NotYourTask(Exception):
    """The task isn't the asking rep's: its HubSpot owner is someone else, or no one."""


@dataclass(frozen=True)
class StatusChange:
    """A Done or a reopen: the write, as the log has it, and the task as it is now (None once it
    is done)."""

    write: WriteOut
    task: OpenTask | None


def _digits(task_id: str) -> str:
    text = task_id.strip()
    if not (text.isascii() and text.isdigit()):
        raise TaskNotFound(task_id[:40])  # HubSpot's ids are digits: no such task
    return text


def _status_plan(
    found: HubSpotObject,
    *,
    current: str,
    target: str,
    owner_id: str,
    company: tuple[str, str] | None,
) -> dict[str, Any]:
    """What the log keeps: the task in words, and its status now and the one to send."""
    same = current == target
    already = ALREADY_DONE_DETAIL if target == DONE else ALREADY_OPEN_DETAIL
    due = moment_of(found.text(DUE))
    when = ""
    if due is not None:  # its day in Contour's time, as the activity writer words a task's
        day = due.astimezone(CONTOUR_ZONE).date()
        when = f", due {WEEKDAYS[day.weekday()]} {day.day} {MONTHS[day.month - 1]} {day.year}"
    plan = WritePlan(
        kind="task",
        action="update",
        company_id=company[0] if company is not None else None,
        company_name=company[1] if company is not None else NO_COMPANY,
        company_url=None,
        domain=None,
        fields=[
            FieldChange(
                property=STATUS,
                label=STATUS_LABEL,
                value=target,
                current=current,
                write=not same,
                reason=already if same else None,
            )
        ],
        list_name=None,
        list_id=None,
        owner_id=owner_id,
        tasks=[f"{subject_of(found.text(SUBJECT))}{when}."],
    )
    return plan.model_dump(mode="json") | {"task_id": found.id}


LOOK_BACK: Final = 20  # the newest status writes of one task read to find its last real change


async def status_before_done(session: AsyncSession, app: str, task_id: str) -> str | None:
    """The status a task had before its newest status change here that sent something, when that
    change was a Done and the status before it an open one (like In progress). Else None. A
    change that sent nothing (HubSpot had that status already) is passed over."""
    plans = await session.scalars(
        select(HubSpotWrite.plan)
        .where(
            HubSpotWrite.app == app,
            HubSpotWrite.subject.like(f"{STATUS_SUBJECT}:{_digits(task_id)}:%"),
            HubSpotWrite.status == "done",
        )
        .order_by(HubSpotWrite.created_at.desc())
        .limit(LOOK_BACK)
    )
    for plan in plans:
        fields = (plan or {}).get("fields") or []
        field = fields[0] if fields and isinstance(fields[0], dict) else {}
        if field.get("write") is not True:
            continue
        if field.get("value") != DONE:
            return None  # its last real change opened it again
        before = str(field.get("current") or "").strip().upper()
        return before if before in OPEN_STATUSES else None
    return None


async def set_status(
    session: AsyncSession,
    hubspot: HubSpot,
    *,
    app: str,
    task_id: str,
    owner_id: str,
    done: bool,
    reopen_to: str = OPEN,
    company: tuple[str, str] | None = None,
) -> StatusChange:
    """Ticks the rep's task done (`done`), or opens it again with `reopen_to`, once it is read
    again and is theirs. `company` (its id and name), when known, goes in the log. The caller
    holds no database connection: this commits as it goes.

    Raises `HubSpotWritesOff` while writing is off (before anything is read), `TaskNotFound`,
    `NotYourTask`, and any `HubSpotError` from reading the task. A send HubSpot refuses or doesn't
    answer is the write's failed step, never raised."""
    task_id = _digits(task_id)
    if not getattr(hubspot, "writes_allowed", False):
        raise HubSpotWritesOff
    found = await hubspot.get_object("tasks", task_id, properties=FIELDS)
    if found is None:
        raise TaskNotFound(task_id)
    if (found.text(OWNER) or "").strip() != owner_id:
        raise NotYourTask(task_id)
    current = (found.text(STATUS) or OPEN).strip().upper()
    target = DONE if done else (reopen_to if reopen_to in OPEN_STATUSES else OPEN)
    plan = _status_plan(found, current=current, target=target, owner_id=owner_id, company=company)
    row = await save_preview(
        session,
        None,
        app=app,
        subject=f"{STATUS_SUBJECT}:{task_id}:{uuid.uuid4().hex[:12]}",
        plan=plan,
        company_id=company[0] if company is not None else None,
        url=found.url,
    )
    claimed = await claim_write(session, row)
    claim = Claim.of(claimed)
    step = await _status_step(hubspot, task_id, current=current, target=target)
    await claim.save(
        session,
        {
            "result": steps_json([step]),
            "status": status_of([step]),
            "error": error_of([step]),
            "finished_at": datetime.now(UTC),
        },
    )
    saved = await session.get(HubSpotWrite, claimed.id, populate_existing=True)
    if saved is None:  # pragma: no cover - a write is never removed
        raise TaskNotFound(task_id)
    log.info(
        "hubspot_task_status",
        extra={"write_id": str(saved.id), "task_id": task_id, "status": step.status},
    )
    now = HubSpotObject(id=found.id, properties={**found.properties, STATUS: target}, url=found.url)
    return StatusChange(write=write_out(saved), task=task_of(now, owner_id))


async def _status_step(hubspot: HubSpot, task_id: str, *, current: str, target: str) -> StepResult:
    """Sends the status, unless the task has it already. A send that timed out is checked by
    reading the task again."""
    if current == target:
        already = ALREADY_DONE_DETAIL if target == DONE else ALREADY_OPEN_DETAIL
        return StepResult(step=STATUS_STEP, status="done", detail=already, hubspot_id=task_id)
    try:
        await hubspot.update_object("tasks", task_id, {STATUS: target})
    except HubSpotWriteUncertain:
        return await _checked(hubspot, task_id, target)
    except HubSpotNotFound:
        return StepResult(step=STATUS_STEP, status="failed", detail=GONE_DETAIL)
    except HubSpotError as error:
        return failed_step(STATUS_STEP, error)
    landed = DONE_DETAIL if target == DONE else REOPENED_DETAIL
    return StepResult(step=STATUS_STEP, status="done", detail=landed, hubspot_id=task_id)


async def _checked(hubspot: HubSpot, task_id: str, target: str) -> StepResult:
    """After a change that timed out: the task is read again. The status there: done. Not there:
    failed, and sending it again is safe."""
    try:
        found = await hubspot.get_object("tasks", task_id, properties=[STATUS])
    except HubSpotError:
        return StepResult(step=STATUS_STEP, status="failed", detail=UNREAD_DETAIL)
    if found is None:
        return StepResult(step=STATUS_STEP, status="failed", detail=GONE_DETAIL)
    if (found.text(STATUS) or "").strip().upper() == target:
        return StepResult(step=STATUS_STEP, status="done", detail=FOUND_DETAIL, hubspot_id=task_id)
    return StepResult(step=STATUS_STEP, status="failed", detail=NOT_THERE_DETAIL)
