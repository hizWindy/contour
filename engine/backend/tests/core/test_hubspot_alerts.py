"""Alerts in HubSpot (PLAN-V23 Part 2), on the fake HubSpot and the test database:

- T2-1: a reminder on every task the activity writer makes. For someone else: 2 minutes after the
  send. For the rep: 9:00 am on its due day. Never in the past. In milliseconds, as text.
- T2-2: the FYI task for the company's owner: the write's last step, made once the call is in
  HubSpot, linked to the company only, with the 2 minute reminder, never twice, and never a
  reason for the rep's call to read as not sent.

Every company, person and address here is made up.
"""

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.activities import (
    FOUND_DETAIL,
    REMINDER_AFTER_SEND,
    CallIn,
    FyiIn,
    NoteIn,
    TaskIn,
    activity_status,
    apply_activity,
    planned_steps,
    preview_activity,
    task_reminders,
)
from core.hubspot.writer import StepResult
from tests.core.hubspot_fake import FakeRecord
from tests.core.test_hubspot_activities import (
    AT,
    COMPANY,
    MELBOURNE,
    OTHER_REP,
    REFUSED,
    REP,
    TIMED_OUT,
    Waits,
    a_request,
    add_owners,
    contour,
    due_ms,
    ms,
    only,
    writes_of,
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


# --- T2-2: the FYI task for the company's owner ------------------------------------------------

OWNER = "303"  # the company's owner: neither the rep nor the teammate
SITE = "https://hq.contour.example"
FYI_SUBJECT = "FYI: Jo Sample logged a call with Sample Logistics Pty Ltd"


def an_fyi(**changes: object) -> FyiIn:
    values: dict[str, object] = {
        "owner_id": OWNER,
        "subject": FYI_SUBJECT,
        "body": f"Wants a floor plan.\n\nSee the call on Sample Logistics Pty Ltd in Contour: "
        f"{SITE}/companies/{COMPANY}",
        "due": THURSDAY,
    }
    return FyiIn.model_validate(values | changes)


def a_call() -> CallIn:
    return CallIn(
        at=AT, title="Call with Jo Sample", body="Wants a floor plan.", outcome="Connected"
    )


def test_the_fyi_task_is_the_last_step_and_goes_only_with_a_call() -> None:
    assert planned_steps(a_request(fyi=an_fyi())) == [
        "call",
        "fields",
        "task:1",
        "task:2",
        "note",
        "fyi",
    ]
    assert planned_steps(a_request()) == ["call", "fields", "task:1", "task:2", "note"]
    with pytest.raises(ValueError, match="an fyi needs a call"):
        only(note=NoteIn(body="A pre-read"), fyi=an_fyi())
    assert StepResult(step="fyi", status="done").step == "fyi"


def test_the_fyi_task_never_changes_the_writes_status() -> None:
    def steps(**states: str) -> dict[str, StepResult]:
        return {name: StepResult(step=name, status=state) for name, state in states.items()}

    planned = ["call", "fyi"]
    assert activity_status(planned, steps(call="done")) == "done"  # the FYI not tried yet
    assert activity_status(planned, steps(call="done", fyi="failed")) == "done"
    assert activity_status(planned, steps(call="done", fyi="uncertain")) == "done"
    assert activity_status(planned, steps(call="failed")) == "failed"


@db
async def test_the_owner_gets_one_fyi_task_once_the_call_lands_linked_to_the_company_only(
    session: AsyncSession,
) -> None:
    fake = contour()
    out = await preview_activity(session, fake, only(call=a_call(), fyi=an_fyi()))
    done = await apply_activity(session, fake, out.id, pause=Waits(), clock=lambda: AFTERNOON)

    assert done.status == "done" and done.error is None
    assert [(step.step, step.status, step.detail) for step in done.steps] == [
        ("call", "done", "Logged the call."),
        ("fyi", "done", "Told the company's owner, with an FYI task."),
    ]
    assert writes_of(fake) == ["create_calls", "create_tasks"]  # the call first
    (task,) = fake.tasks.values()
    body = task.properties.pop("hs_task_body") or ""
    assert task.properties == {
        "hs_timestamp": ms(nine(THURSDAY)),  # due today
        "hs_task_subject": FYI_SUBJECT,
        "hs_task_status": "NOT_STARTED",
        "hs_task_priority": "LOW",
        "hs_task_type": "TODO",
        "hubspot_owner_id": OWNER,
        "hs_task_reminders": ms(AFTERNOON + TWO_MINUTES),
    }
    assert body.startswith("<p>Wants a floor plan.</p><p>See the call on Sample Logistics")
    assert f'<a href="{SITE}/companies/{COMPANY}">' in body
    # On the company only: not on the person or the deal the call is on.
    assert (task.companies, task.contacts, task.deals) == ((COMPANY,), (), ())
    (call,) = fake.call_log.values()
    assert (call.contacts, call.deals) != ((), ())

    # Once only: applying the write again, or previewing it again, sends nothing.
    again = await apply_activity(session, fake, out.id, pause=Waits())
    assert again.status == "done" and len(fake.tasks) == 1
    assert (await preview_activity(session, fake, only(call=a_call(), fyi=an_fyi()))).id == out.id
    assert writes_of(fake) == ["create_calls", "create_tasks"]


@db
async def test_no_fyi_task_until_the_call_is_in_hubspot_then_one(session: AsyncSession) -> None:
    fake = contour()
    fake.fail["create_calls"] = [REFUSED]
    out = await preview_activity(session, fake, only(call=a_call(), fyi=an_fyi()))

    first = await apply_activity(session, fake, out.id, pause=Waits())
    assert first.status == "failed"
    assert [step.step for step in first.steps] == ["call"]  # the FYI waits, with no result
    assert fake.tasks == {}

    again = await apply_activity(session, fake, out.id, pause=Waits())
    assert again.status == "done"
    assert [(step.step, step.status) for step in again.steps] == [("call", "done"), ("fyi", "done")]
    assert len(fake.tasks) == 1 and writes_of(fake).count("create_tasks") == 1


@db
async def test_an_fyi_task_hubspot_refused_leaves_the_call_sent(session: AsyncSession) -> None:
    fake = contour()
    fake.fail["create_tasks"] = [REFUSED]
    out = await preview_activity(session, fake, only(call=a_call(), fyi=an_fyi()))
    done = await apply_activity(session, fake, out.id, pause=Waits())

    assert {step.step: step.status for step in done.steps} == {"call": "done", "fyi": "failed"}
    assert done.status == "done" and done.error is None  # the rep's call reads as sent
    assert fake.tasks == {}


@db
async def test_an_fyi_task_that_timed_out_and_landed_is_found_not_sent_again(
    session: AsyncSession,
) -> None:
    fake = contour()
    fake.fail_after["create_tasks"] = [TIMED_OUT]  # it lands, then the answer is lost
    out = await preview_activity(session, fake, only(call=a_call(), fyi=an_fyi()))
    done = await apply_activity(session, fake, out.id, pause=Waits())

    fyi = next(step for step in done.steps if step.step == "fyi")
    assert (fyi.status, fyi.detail) == ("done", FOUND_DETAIL)
    assert len(fake.tasks) == 1 and writes_of(fake).count("create_tasks") == 1
