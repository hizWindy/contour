"""Done and reopen in core (PLAN-V22 T1-4, `core/hubspot/tasks.py` `set_status`): the task is read
again and must be the rep's, each change is a row in `core.hubspot_writes` (its own kind,
`task`), a status HubSpot has already is never sent, a change that timed out is checked by reading
the task again, and the other writers refuse these rows. The fake HubSpot only, made-up tasks."""

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.activities import FOUND_DETAIL, apply_activity
from core.hubspot.client import HubSpotWritesOff, HubSpotWriteUncertain
from core.hubspot.models import HubSpotWrite
from core.hubspot.tasks import (
    ALREADY_DONE_DETAIL,
    DONE_DETAIL,
    NOT_THERE_DETAIL,
    REOPENED_DETAIL,
    NotYourTask,
    TaskNotFound,
    set_status,
    status_before_done,
)
from core.hubspot.writer import WriteNotFound, apply_write
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration
APP = "companies"
DUE = datetime(2026, 11, 5, 22, 0, tzinfo=UTC)  # 9 am Friday 6 Nov in Melbourne


def a_fake(status: str = "IN_PROGRESS", owner: str = "11") -> FakeHubSpot:
    fake = FakeHubSpot()
    fake.grant_writes()
    fake.add_task(
        "601",
        companies=("201",),
        hs_task_subject="Send the quote to jo.sample@sample.example",
        hs_task_status=status,
        hs_task_type="TODO",
        hs_timestamp=str(int(DUE.timestamp() * 1000)),
        hubspot_owner_id=owner,
    )
    return fake


async def rows(session: AsyncSession) -> list[HubSpotWrite]:
    return list(await session.scalars(select(HubSpotWrite).order_by(HubSpotWrite.created_at)))


async def done(session: AsyncSession, fake: FakeHubSpot, **more: Any) -> Any:
    return await set_status(session, fake, app=APP, task_id="601", owner_id="11", done=True, **more)


async def test_done_reads_the_task_first_and_logs_one_write(session: AsyncSession) -> None:
    fake = a_fake()
    change = await done(session, fake, company=("201", "Sample Logistics Pty Ltd"))
    assert fake.tasks["601"].properties["hs_task_status"] == "COMPLETED"
    assert fake.calls == ["get_tasks", "update_tasks"]
    assert change.task is None  # done: Today leaves it out
    write = change.write
    assert (write.status, write.app) == ("done", APP)
    assert write.subject.startswith("task_status:601:")
    [step] = write.steps
    assert (step.step, step.status, step.detail, step.hubspot_id) == (
        "status",
        "done",
        DONE_DETAIL,
        "601",
    )
    plan = write.plan
    assert (plan.kind, plan.company_id, plan.company_name, plan.owner_id) == (
        "task",
        "201",
        "Sample Logistics Pty Ltd",
        "11",
    )
    [field] = plan.fields
    assert (field.property, field.current, field.value, field.write) == (
        "hs_task_status",
        "IN_PROGRESS",
        "COMPLETED",
        True,
    )
    assert plan.tasks == ["Send the quote to [email left out], due Fri 6 Nov 2026."]  # no address
    [row] = await rows(session)
    assert (row.status, row.plan["task_id"]) == ("done", "601")


async def test_reopen_gives_back_the_status_before_the_last_done(session: AsyncSession) -> None:
    fake = a_fake()
    assert await status_before_done(session, APP, "601") is None  # never ticked here
    await done(session, fake)
    await done(session, fake)  # a second press sends nothing, and hides nothing
    before = await status_before_done(session, APP, "601")
    assert before == "IN_PROGRESS"
    change = await set_status(
        session, fake, app=APP, task_id="601", owner_id="11", done=False, reopen_to=before
    )
    assert fake.tasks["601"].properties["hs_task_status"] == "IN_PROGRESS"
    assert change.write.steps[0].detail == REOPENED_DETAIL
    assert change.task is not None and (change.task.id, change.task.status) == (
        "601",
        "IN_PROGRESS",
    )
    assert await status_before_done(session, APP, "601") is None  # the newest change: a reopen
    assert len(await rows(session)) == 3  # one row for each press


async def test_another_reps_task_is_never_changed_or_logged(session: AsyncSession) -> None:
    fake = a_fake(owner="12")
    with pytest.raises(NotYourTask):
        await done(session, fake)
    with pytest.raises(TaskNotFound):
        await set_status(session, fake, app=APP, task_id="999", owner_id="11", done=True)
    with pytest.raises(TaskNotFound):  # not an id HubSpot could have
        await set_status(session, fake, app=APP, task_id="60a", owner_id="11", done=True)
    assert fake.tasks["601"].properties["hs_task_status"] == "IN_PROGRESS"
    assert "update_tasks" not in fake.calls
    assert await rows(session) == []


async def test_writing_off_reads_and_sends_nothing(session: AsyncSession) -> None:
    fake = a_fake()
    fake.writes_allowed = False
    with pytest.raises(HubSpotWritesOff):
        await done(session, fake)
    assert fake.calls == [] and await rows(session) == []


async def test_a_task_done_already_sends_nothing(session: AsyncSession) -> None:
    fake = a_fake(status="COMPLETED")
    change = await done(session, fake)
    assert fake.calls == ["get_tasks"]
    assert (change.write.status, change.write.steps[0].detail) == ("done", ALREADY_DONE_DETAIL)
    assert change.write.plan.fields[0].write is False


async def test_a_change_that_timed_out_is_checked_by_reading_the_task_again(
    session: AsyncSession,
) -> None:
    timed_out = HubSpotWriteUncertain("HubSpot didn't answer", "It may or may not be saved.")
    landed = a_fake()
    landed.fail_after["update_tasks"] = [timed_out]  # it landed, then the answer was lost
    change = await done(session, landed)
    assert (change.write.status, change.write.steps[0].detail) == ("done", FOUND_DETAIL)
    assert landed.calls == ["get_tasks", "update_tasks", "get_tasks"]  # never sent twice

    lost = a_fake()
    lost.fail["update_tasks"] = [timed_out]  # it never reached HubSpot
    change = await done(session, lost)
    assert (change.write.status, change.write.steps[0].detail) == ("failed", NOT_THERE_DETAIL)
    assert lost.tasks["601"].properties["hs_task_status"] == "IN_PROGRESS"


async def test_the_other_writers_refuse_a_task_status_row(session: AsyncSession) -> None:
    fake = a_fake()
    change = await done(session, fake)
    with pytest.raises(WriteNotFound):
        await apply_write(session, fake, change.write.id)
    with pytest.raises(WriteNotFound):
        await apply_activity(session, fake, change.write.id)
