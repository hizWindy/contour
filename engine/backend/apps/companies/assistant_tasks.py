"""A task on its own, and Done and reopen (PLAN-V22 T1-4, the contract's parts 2 and 3). The
routes are in api_assistant.py.

- **Adding a task** goes through core's activity writer (`ActivityRequest` with one `TaskIn`), as
  a call note's follow-ups do: the preview reads the company in HubSpot and saves the write as
  previewed (it works while writing is off); the send previews again with the card's words as
  sent, then writes. The write's subject is the person and their Idempotency-Key
  (`assistant_task:<person>:<key>`), so a repeated key gives back the first write, and HubSpot
  gets one task. A create that timed out is looked for, never sent again blind (the writer's rule).
- **For whom:** me by default (my HubSpot owner), or a teammate on the team list (an active
  HubSpot owner). The task is due at 9:00 am on its day, Melbourne time, as a follow-up is. Its
  words are sent with email addresses and phone numbers blanked, as a call note is saved.
- **Done and reopen** (core's `tasks.set_status`): the task is read again and must be mine (403
  `not_your_task` otherwise, and nothing is written; 409 `no_hubspot_link` when my account has no
  HubSpot owner linked). Each is a row in `core.hubspot_writes`.
  Reopen gives back the status the task had before its last Done here, else Not started.
- **Writing** is behind `hubspot_write_enabled` and the key's write access (409
  `hubspot_writing_off`, in the task's own words: the call notes' code says calls wait).
- **At most 20 tasks added a minute a person** (T1-6, TBC, as for commands: 429
  `too_many_tasks`). A repeated key gives back its first task, so it isn't counted. Kept in
  memory, so the count starts again when the backend restarts.
- **Today's copy** changes at once (`TaskCopy.change`), so Today shows the change before HubSpot's
  search does.
- No database connection is held while HubSpot answers. Log lines hold ids and states only.
"""

import logging
from dataclasses import replace
from datetime import date, datetime
from typing import Final

from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant import CommandLimit, person_key
from apps.companies.assistant_schemas import AssistantTaskIn
from apps.companies.facts import scrub
from apps.companies.meeting_store import MeetingSource, company_names, my_owner
from apps.companies.note_batch import ActivityWriter
from apps.companies.note_store import DAY_RANGE_DETAIL, LAST_DAY, sending_state
from apps.companies.notes import MELBOURNE
from apps.companies.today import TaskCopy
from core.api.errors import Problem
from core.auth import users
from core.auth.sessions import AuthContext
from core.config import Settings
from core.hubspot import tasks as core_tasks
from core.hubspot.activities import CONTOUR_ZONE, TASK_DUE_TIME, ActivityRequest, TaskIn
from core.hubspot.client import HubSpotError, HubSpotNotFound, HubSpotWritesOff
from core.hubspot.connection import open_hubspot
from core.hubspot.models import HubSpotCompany, HubSpotOwner
from core.hubspot.tasks import OPEN, OpenTask, subject_of
from core.hubspot.writer import OPEN as REPLANNED
from core.hubspot.writer import WriteInProgress, WriteOut, latest_write

log = logging.getLogger(__name__)

APP: Final = "companies"
TASK_SUBJECT: Final = "assistant_task"  # the write's subject: assistant_task:<person>:<key>
ANYONE: Final = "anyone"  # the person, while sign-in is off
PRIORITY: Final = "medium"
RETRY_SECONDS: Final = 30
PLATFORM_ADMIN: Final = "the Platform admin"
TASKS_PER_MINUTE: Final = 20  # added by one person (T1-6, TBC, as for commands)

# --- The words (PLAN-V15 "Words for errors", PLAN-V22 "Words for when things go wrong") ---------


def not_in_hubspot() -> Problem:
    return Problem(
        422,
        "This company isn't in HubSpot yet",
        "A task needs a company in HubSpot. Send it from the Lead Finder first, then add the task.",
        code="not_in_hubspot",
    )


def company_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that company",
        "It may have been merged or deleted in HubSpot. Pick the company again.",
        code="company_not_found",
    )


def task_empty() -> Problem:
    return Problem(422, "A task needs words", "Say or type what the task is.", code="task_empty")


def task_in_past() -> Problem:
    return Problem(
        422,
        "That day has passed",
        "A task can't be due before today. Pick today or a later day.",
        code="task_in_past",
    )


def day_out_of_range() -> Problem:
    return Problem(422, "That day is out of range", DAY_RANGE_DETAIL, code="day_out_of_range")


def owner_not_found() -> Problem:
    return Problem(
        422,
        "We can't find that person in HubSpot",
        "Pick who the task is for from the team list, or leave it with you.",
        code="owner_not_found",
    )


def writing_off(what: str) -> Problem:
    """HubSpot can't be written now (409 `hubspot_writing_off`). `what`: what didn't happen."""
    return Problem(
        409,
        "Sending to HubSpot is off",
        f"Sending to HubSpot is off for now, so {what}. An admin can switch it on.",
        code="hubspot_writing_off",
    )


def hubspot_unavailable(what: str) -> Problem:
    """HubSpot didn't answer before anything was sent (503). `what`: what didn't happen."""
    return Problem(
        503,
        "HubSpot didn't answer",
        f"HubSpot didn't answer, so {what}. Try again in a minute.",
        code="hubspot_unavailable",
        headers={"Retry-After": str(RETRY_SECONDS)},
    )


def hubspot_not_connected() -> Problem:
    return Problem(
        503,
        "HubSpot isn't connected",
        "HubSpot isn't connected yet, so nothing was checked. An admin can connect it on the "
        "HubSpot page in Admin.",
        code="hubspot_not_connected",
    )


def too_many_tasks(wait_seconds: int) -> Problem:
    return Problem(
        429,
        "Too many tasks",
        "That's a lot of tasks in one minute. Wait a moment, then try again.",
        code="too_many_tasks",
        headers={"Retry-After": str(wait_seconds)},
    )


def task_limit() -> CommandLimit:
    """The tasks a person may add in a minute (T1-6, TBC)."""
    return CommandLimit(per_minute=TASKS_PER_MINUTE)


def task_sending() -> Problem:
    return Problem(
        409,
        "This task is being added",
        "It is being sent to HubSpot right now. Wait a moment, then check Today.",
        code="task_sending",
    )


def task_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that task",
        "It may have been deleted in HubSpot. Press Sync to see your tasks again.",
        code="task_not_found",
    )


def no_hubspot_link(asker: str) -> Problem:
    """My account has no HubSpot owner linked, so no task can be told to be mine (409)."""
    return Problem(
        409,
        "Your account isn't linked to HubSpot",
        f"Your account isn't linked to HubSpot, so your tasks can't be told apart. Ask {asker} "
        "to link it.",
        code="no_hubspot_link",
    )


def not_your_task() -> Problem:
    """The task isn't mine (403)."""
    return Problem(
        403,
        "Not your task",
        "Only the person the task is for can tick it done or open it again. Ask them, or "
        "change it in HubSpot.",
        code="not_your_task",
    )


def task_not_changed(said: str | None) -> Problem:
    """HubSpot didn't take a Done or a reopen (502). `said`: the step's own words."""
    return Problem(
        502,
        "HubSpot didn't take the change",
        f"{said or 'HubSpot refused it.'} You can check the task in HubSpot, then try again.",
        code="task_not_changed",
    )


# --- Adding a task -------------------------------------------------------------------------------


def write_subject(auth: AuthContext | None, key: str) -> str:
    """The write's subject: one per person and key, so a repeated key is the same write."""
    who = auth.user.id.hex if auth is not None else ANYONE
    return f"{TASK_SUBJECT}:{who}:{key}"


def due_at(day: date) -> datetime:
    """When HubSpot has the task due: 9:00 am on its day, Contour's time (as the writer sends)."""
    return datetime.combine(day, TASK_DUE_TIME, tzinfo=CONTOUR_ZONE)


async def task_request(
    session: AsyncSession,
    body: AssistantTaskIn,
    *,
    auth: AuthContext | None,
    writer: ActivityWriter,
    key: str,
    now: datetime,
) -> tuple[ActivityRequest, str]:
    """The write for one task, checked: the company in our HubSpot copy, words, a day from today,
    and a teammate on the team list. Also the company's name."""
    company_key = body.company_key.strip()
    if company_key.startswith("lead:"):
        raise not_in_hubspot()
    name = (
        await session.scalar(
            select(HubSpotCompany.name).where(HubSpotCompany.hubspot_id == company_key)
        )
        if company_key.isascii() and company_key.isdigit()
        else None
    )
    if name is None:
        raise company_not_found()
    subject = " ".join(scrub(body.subject).split())
    if not subject:
        raise task_empty()
    today = now.astimezone(MELBOURNE).date()
    if body.due < today:
        raise task_in_past()
    if body.due > LAST_DAY:
        raise day_out_of_range()
    teammate = (body.owner_id or "").strip() or None
    if teammate is not None:
        active = await session.scalar(
            select(HubSpotOwner.owner_id).where(
                HubSpotOwner.owner_id == teammate, HubSpotOwner.archived.is_(False)
            )
        )
        if active is None:
            raise owner_not_found()
    rep = await writer.owner_of(session, auth.user.id if auth is not None else None)
    request = ActivityRequest(
        app=APP,
        subject=write_subject(auth, key),
        company_id=company_key,
        owner_id=rep,
        tasks=[
            TaskIn(
                subject=subject,
                body=scrub(body.body).strip(),
                due=body.due,
                kind=body.kind,
                priority=PRIORITY,
                owner_id=teammate if teammate != rep else None,
            )
        ],
    )
    return request, name


async def preview_task(
    session: AsyncSession,
    body: AssistantTaskIn,
    *,
    app: FastAPI,
    auth: AuthContext | None,
    writer: ActivityWriter,
    key: str,
    now: datetime,
) -> WriteOut:
    """What adding this task would do: the company as HubSpot has it now, the task in words, and
    whether HubSpot can be written. Saved as a preview under the key; nothing is sent."""
    request, _ = await task_request(session, body, auth=auth, writer=writer, key=key, now=now)
    await session.commit()  # no connection waits on HubSpot
    try:
        async with open_hubspot(app) as hubspot:
            if hubspot is None:
                raise hubspot_not_connected()
            return await writer.preview(session, hubspot, request)
    except HubSpotNotFound:
        raise company_not_found() from None
    except HubSpotError as error:
        log.warning("assistant_task_preview_failed", extra={"error": type(error).__name__})
        raise hubspot_unavailable("nothing was checked or sent") from None


async def add_task(
    session: AsyncSession,
    body: AssistantTaskIn,
    *,
    app: FastAPI,
    auth: AuthContext | None,
    settings: Settings,
    writer: ActivityWriter,
    copy: TaskCopy,
    limit: CommandLimit,
    key: str,
    now: datetime,
) -> tuple[WriteOut, bool]:
    """Adds the task to HubSpot, once for this key: the write, and whether this call made it (a
    repeated key gives back the first write, and sends nothing). Writing off: 409, nothing sent.
    Over 20 new tasks in a minute: 429, before HubSpot is asked."""
    request, _ = await task_request(session, body, auth=auth, writer=writer, key=key, now=now)
    if not sending_state(app, settings).ready:
        raise writing_off("the task wasn't added")
    known = await latest_write(session, APP, request.subject)
    if known is None or known.status in REPLANNED:  # a repeated key isn't a new task
        wait = limit.take(person_key(auth), now)
        if wait is not None:
            raise too_many_tasks(wait)
    await session.commit()  # no connection waits on HubSpot
    try:
        async with open_hubspot(app) as hubspot:
            if hubspot is None:
                raise HubSpotWritesOff
            previewed = await writer.preview(session, hubspot, request)
            new = previewed.status == "previewed"
            written = await writer.apply(session, hubspot, previewed.id)
    except HubSpotWritesOff:
        raise writing_off("the task wasn't added") from None
    except WriteInProgress:
        raise task_sending() from None
    except HubSpotNotFound:
        raise company_not_found() from None
    except HubSpotError as error:
        log.warning("assistant_task_add_failed", extra={"error": type(error).__name__})
        raise hubspot_unavailable("the task wasn't added") from None
    log.info(
        "assistant_task_added",
        extra={"write_id": str(written.id), "status": written.status, "new": new},
    )
    if written.status == "done":
        _show_new_task(copy, request, written, now)
    return written, new


def _show_new_task(
    copy: TaskCopy, request: ActivityRequest, written: WriteOut, now: datetime
) -> None:
    """Today shows the new task at once, for whoever it is for (an unassigned one: no one)."""
    [task] = request.tasks
    owner = task.owner_id or request.owner_id
    made = next((step.hubspot_id for step in written.steps if step.step == "task:1"), None)
    if owner is None or made is None:
        return
    copy.change(
        owner,
        made,
        OpenTask(
            id=made,
            subject=subject_of(task.subject),
            kind=task.kind,
            status=OPEN,
            priority=task.priority,
            due_at=due_at(task.due),
            owner_id=owner,
            company_id=request.company_id,
        ),
        now,
    )


# --- Done and reopen -----------------------------------------------------------------------------


async def change_status(
    session: AsyncSession,
    task_id: str,
    *,
    done: bool,
    app: FastAPI,
    auth: AuthContext | None,
    settings: Settings,
    source: MeetingSource,
    copy: TaskCopy,
    now: datetime,
) -> None:
    """Ticks my task done (`done`), or opens it again, once HubSpot says it is mine."""
    what = "the task wasn't changed"
    if not sending_state(app, settings).ready:
        raise writing_off(what)
    me = await my_owner(session, auth, source)
    if me is None:
        raise no_hubspot_link(await users.platform_admin_name(session) or PLATFORM_ADMIN)
    reopen_to = OPEN
    if not done:
        reopen_to = await core_tasks.status_before_done(session, APP, task_id) or OPEN
    kept = copy.kept(me, task_id)
    company: tuple[str, str] | None = None
    if kept is not None and kept.company_id is not None:
        names = await company_names(session, [kept.company_id])
        if kept.company_id in names:
            company = (kept.company_id, names[kept.company_id])
    await session.commit()  # no connection waits on HubSpot
    try:
        async with open_hubspot(app) as hubspot:
            if hubspot is None:
                raise HubSpotWritesOff
            change = await core_tasks.set_status(
                session,
                hubspot,
                app=APP,
                task_id=task_id,
                owner_id=me,
                done=done,
                reopen_to=reopen_to,
                company=company,
            )
    except HubSpotWritesOff:
        raise writing_off(what) from None
    except core_tasks.TaskNotFound:
        raise task_not_found() from None
    except core_tasks.NotYourTask:
        raise not_your_task() from None
    except HubSpotError as error:
        log.warning("assistant_task_status_failed", extra={"error": type(error).__name__})
        raise hubspot_unavailable("the task wasn't changed") from None
    step = change.write.steps[0] if change.write.steps else None
    if change.write.status != "done":
        if step is not None and step.detail == core_tasks.GONE_DETAIL:
            raise task_not_found()
        raise task_not_changed(step.detail if step is not None else None)
    if done:
        copy.change(me, task_id, None, now)
    elif change.task is not None:
        company_id = kept.company_id if kept is not None else None
        copy.change(me, task_id, replace(change.task, company_id=company_id), now)
