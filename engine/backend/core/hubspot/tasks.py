"""HubSpot tasks for the Assistant (PLAN-V22): a rep's open tasks for Today (T1-3).

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
meeting's title is. Its body is never read. Log lines hold counts only, never a subject.
"""

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Final

from core.hubspot.activities import TaskKind, TaskPriority
from core.hubspot.client import (
    BATCH_SIZE,
    Association,
    Filter,
    HubSpot,
    HubSpotObject,
    primary_company,
)
from core.hubspot.meetings import without_contact_details

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
