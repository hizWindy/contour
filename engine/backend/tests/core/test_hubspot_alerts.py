"""Alerts in HubSpot (PLAN-V23 Part 2), on the fake HubSpot and the test database:

- T2-1: a reminder on every task the activity writer makes. For someone else: 2 minutes after the
  send. For the rep: 9:00 am on its due day. Never in the past. In milliseconds, as text.

Every company, person and address here is made up.
"""

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.activities import (
    REMINDER_AFTER_SEND,
    NoteIn,
    TaskIn,
    apply_activity,
    preview_activity,
    task_reminders,
)
from tests.core.hubspot_fake import FakeRecord
from tests.core.test_hubspot_activities import (
    MELBOURNE,
    OTHER_REP,
    REP,
    Waits,
    a_request,
    add_owners,
    contour,
    due_ms,
    ms,
    only,
)

db = pytest.mark.integration

THURSDAY = date(2026, 11, 19)
FRIDAY = date(2026, 11, 20)
AFTERNOON = datetime(2026, 11, 19, 15, 0, tzinfo=MELBOURNE)  # Thursday, 3 pm
TWO_MINUTES = timedelta(minutes=2)


def nine(day: date) -> datetime:
    return datetime.combine(day, time(9, 0), tzinfo=MELBOURNE)


def reminders_of(task: FakeRecord) -> str | None:
    return task.properties.get("hs_task_reminders")


# --- T2-1: the rules, in pure code (fast) ----------------------------------------------------


def test_someone_elses_task_reminds_them_2_minutes_after_the_send() -> None:
    assert REMINDER_AFTER_SEND == TWO_MINUTES
    soon = (AFTERNOON + TWO_MINUTES,)
    assert task_reminders(FRIDAY, someone_else=True, sent_at=AFTERNOON) == soon
    # A task due weeks away still alerts them now: it stands in for "you have a task".
    assert task_reminders(date(2026, 12, 18), someone_else=True, sent_at=AFTERNOON) == soon


def test_my_own_task_reminds_me_at_9_on_its_day() -> None:
    assert task_reminders(FRIDAY, someone_else=False, sent_at=AFTERNOON) == (nine(FRIDAY),)
    early = datetime(2026, 11, 19, 7, 30, tzinfo=MELBOURNE)
    assert task_reminders(THURSDAY, someone_else=False, sent_at=early) == (nine(THURSDAY),)


def test_a_reminder_never_falls_in_the_past() -> None:
    # Due today, sent at 3 pm: 9:00 am has passed, so 2 minutes after the send.
    assert task_reminders(THURSDAY, someone_else=False, sent_at=AFTERNOON) == (
        AFTERNOON + TWO_MINUTES,
    )
    # Due on a day gone by (a send that waited): 2 minutes after the send.
    assert task_reminders(date(2026, 11, 2), someone_else=False, sent_at=AFTERNOON) == (
        AFTERNOON + TWO_MINUTES,
    )
    # A minute before 9:00 on the day: never sooner than 2 minutes after the send.
    almost = datetime(2026, 11, 19, 8, 59, tzinfo=MELBOURNE)
    assert task_reminders(THURSDAY, someone_else=False, sent_at=almost) == (almost + TWO_MINUTES,)
    for times in (
        task_reminders(FRIDAY, someone_else=False, sent_at=AFTERNOON),
        task_reminders(FRIDAY, someone_else=True, sent_at=AFTERNOON),
    ):
        assert all(moment.tzinfo is UTC and moment > AFTERNOON for moment in times)


# --- T2-1: what HubSpot gets -------------------------------------------------------------------


@db
async def test_a_calls_follow_ups_each_carry_one_reminder_in_milliseconds(
    session: AsyncSession,
) -> None:
    """Mine is due Friday: 9:00 am Friday. The teammate's: 2 minutes after the send."""
    fake = contour()
    await add_owners(session)
    out = await preview_activity(session, fake, a_request(fields=[]))
    done = await apply_activity(session, fake, out.id, pause=Waits(), clock=lambda: AFTERNOON)

    assert done.status == "done"
    mine, theirs = sorted(fake.tasks.values(), key=lambda record: int(record.id))
    assert mine.properties["hubspot_owner_id"] == REP
    assert reminders_of(mine) == due_ms(FRIDAY) == ms(nine(FRIDAY))
    assert theirs.properties["hubspot_owner_id"] == OTHER_REP
    assert reminders_of(theirs) == ms(AFTERNOON + TWO_MINUTES)
    for task in (mine, theirs):
        text = reminders_of(task) or ""
        assert text.isdigit() and len(text) == 13  # milliseconds since 1970, as text
    assert "hs_task_reminders" not in next(iter(fake.call_log.values())).properties  # a call: none


@db
async def test_a_pre_reads_tasks_alert_each_person_2_minutes_after_the_send(
    session: AsyncSession,
) -> None:
    """The pre-read's shape (meeting_send.py): a note on the company and a task for each person it
    goes to, sent by the rep. The rep's own copy of the task is theirs: 9:00 am on its day."""
    fake = contour()
    request = only(
        note=NoteIn(body="Pre-read for Sample Logistics Pty Ltd"),
        tasks=[
            TaskIn(subject="Pre-read: Walk-through, Fri 20 Nov", due=THURSDAY, owner_id=OTHER_REP),
            TaskIn(subject="Pre-read: Walk-through, Fri 20 Nov", due=FRIDAY, owner_id=REP),
        ],
    )
    out = await preview_activity(session, fake, request)
    sent = datetime(2026, 11, 19, 7, 45, tzinfo=MELBOURNE)
    await apply_activity(session, fake, out.id, pause=Waits(), clock=lambda: sent)

    theirs, mine = sorted(fake.tasks.values(), key=lambda record: int(record.id))
    assert reminders_of(theirs) == ms(sent + TWO_MINUTES)  # not 9:00 am Thursday
    assert reminders_of(mine) == ms(nine(FRIDAY))


@db
async def test_a_task_sent_after_9_on_its_day_reminds_2_minutes_after_the_send(
    session: AsyncSession,
) -> None:
    fake = contour()
    request = only(tasks=[TaskIn(subject="Send the floor plan", due=THURSDAY)])
    out = await preview_activity(session, fake, request)
    await apply_activity(session, fake, out.id, pause=Waits(), clock=lambda: AFTERNOON)

    (task,) = fake.tasks.values()
    assert task.properties["hs_timestamp"] == ms(nine(THURSDAY))  # still due at 9:00 am
    assert reminders_of(task) == ms(AFTERNOON + TWO_MINUTES)  # never in the past
