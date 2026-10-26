"""Bringing runs back: a dead process, `recover()`, and `resume()`.

The crash recipe of the design: let some units finish, kill the "process" in the next one (a
`SimulatedCrash` escapes `except Exception`), abandon that manager, start a second one on the same
database, `recover()`, `resume()`, and check from the calls that finished units were not done again.
Integration: the runs live in the test database.
"""

import asyncio
import uuid
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.runs.manager import BACKEND_STOPPED, MAX_RESUMES, RunManager
from core.runs.models import Run
from core.runs.schemas import RunCounts
from core.runs.types import make_caps
from tests.core.conftest import MakeManager, MemorySource
from tests.core.runs_fakes import (
    APP,
    FakeState,
    assert_totals_match_log,
    event_types,
    run_row,
    small_settings,
    stored_json,
    wait_for_status,
    wait_until_idle,
)

pytestmark = pytest.mark.integration
D = Decimal


async def problem_of(call: Any) -> Problem:
    with pytest.raises(Problem) as caught:
        await call
    return caught.value


async def crashed_run(manager: RunManager, **params: Any) -> uuid.UUID:
    """A `work` run whose process dies after `crash_after` units."""
    run = await manager.start(APP, "work", {"units": 5, "crash_after": 2, **params})
    await wait_until_idle(manager)
    return run.id


async def insert_run(
    factory: async_sessionmaker[AsyncSession], status: str, **values: Any
) -> uuid.UUID:
    run_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            Run(
                id=run_id,
                app=APP,
                mode="work",
                status=status,
                params={"units": 1},
                caps=make_caps(small_settings()).model_dump(mode="json"),
                rules_version="rules-fake",
                prompt_versions="prompts-fake",
                counts=RunCounts().model_dump(mode="json"),
                **values,
            )
        )
        await session.commit()
    return run_id


# --- The crash recipe -------------------------------------------------------------------------


async def test_after_a_crash_recover_and_resume_finish_without_repeating_work(
    make_manager: MakeManager,
    session_factory: async_sessionmaker[AsyncSession],
    fakes: FakeState,
) -> None:
    first = make_manager()
    run_id = await crashed_run(first)
    assert (await run_row(session_factory, run_id)).status == "running"
    assert fakes.units_called() == ["unit-0", "unit-1", "unit-2"]  # unit-2 died half way

    second = make_manager()  # the backend starts again on the same database
    assert await second.recover() == 1
    row = await run_row(session_factory, run_id)
    assert (row.status, row.stop_reason) == ("interrupted", BACKEND_STOPPED)
    assert (await event_types(session_factory, run_id))[-1] == "run_finished"

    resumed = await second.resume(run_id)
    assert resumed.status == "queued"
    row = await wait_for_status(session_factory, run_id, "done")
    await wait_until_idle(second)

    after_crash = [name for name, resume in fakes.calls if resume]
    assert after_crash == ["unit-2", "unit-3", "unit-4"]  # 0 and 1 were not done again
    assert fakes.contexts[-1].resume is True
    row = await assert_totals_match_log(session_factory, run_id)
    assert (row.claude_requests, row.cost_usd) == (5, D("0.50"))  # each unit paid once
    assert row.counts["resumes"] == 1
    assert row.stop_reason is None and row.error is None and row.finished_at is not None
    types = await event_types(session_factory, run_id)
    assert types.count("run_resumed") == 1
    resumed_event = next(
        e for e in await stored_json(session_factory, run_id) if e["type"] == "run_resumed"
    )
    assert resumed_event["data"] == {"from_status": "interrupted"}


async def test_a_resume_budget_counts_the_spend_logged_and_the_work_left_open(
    make_manager: MakeManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    first = make_manager()
    run_id = await crashed_run(first)
    second = make_manager()
    await second.recover()

    await second.resume(run_id)
    await wait_for_status(session_factory, run_id, "done")

    ctx = fakes.contexts[-1]
    # Logged: 2 units at 0.10. Open: unit-2 started and never finished, so its company cap
    # (1.00 in the small settings) is held back too.
    assert ctx.budget.cap_usd == D("5")
    assert ctx.budget.spent == D("0.20") + D("1")  # the fake handler never moves the budget
    assert ctx.budget.companies_started == 2  # the units that finished


async def test_recover_marks_queued_and_running_runs_and_leaves_the_rest(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    queued = await insert_run(session_factory, "queued")
    running = await insert_run(session_factory, "running")
    done = await insert_run(session_factory, "done")
    failed = await insert_run(session_factory, "failed")

    assert await run_manager.recover() == 2
    assert await run_manager.recover() == 0  # nothing left to do the second time

    for run_id in (queued, running):
        row = await run_row(session_factory, run_id)
        assert (row.status, row.stop_reason) == ("interrupted", BACKEND_STOPPED)
        assert row.finished_at is not None
        assert await event_types(session_factory, run_id) == ["run_finished"]
    assert (await run_row(session_factory, done)).status == "done"
    assert (await run_row(session_factory, failed)).status == "failed"


async def test_a_run_left_queued_with_no_checkpoint_can_be_resumed_after_recover(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run_id = await insert_run(session_factory, "queued")
    refused = await problem_of(run_manager.resume(run_id))  # still queued: not resumable yet
    assert (refused.status, refused.code) == (409, "run_not_resumable")

    await run_manager.recover()
    await run_manager.resume(run_id)
    row = await wait_for_status(session_factory, run_id, "done")
    assert row.claude_requests == 1
    assert fakes.calls == [("unit-0", True)]


# --- What resume refuses ------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["done", "cancelled", "running", "queued"])
async def test_only_an_interrupted_or_failed_run_can_be_resumed(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], status: str
) -> None:
    run_id = await insert_run(session_factory, status)
    problem = await problem_of(run_manager.resume(run_id))
    assert (problem.status, problem.code) == (409, "run_not_resumable")
    assert run_manager.active_run_ids == []


async def test_resume_of_an_unknown_run_is_a_404(run_manager: RunManager) -> None:
    assert (await problem_of(run_manager.resume(uuid.uuid4()))).status == 404


async def test_a_run_resumed_three_times_is_not_resumed_again(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    counts = RunCounts(resumes=MAX_RESUMES).model_dump(mode="json")
    run_id = await insert_run(session_factory, "interrupted")
    async with session_factory() as session:
        row = await session.get(Run, run_id)
        assert row is not None
        row.counts = counts
        await session.commit()
    problem = await problem_of(run_manager.resume(run_id))
    assert problem.code == "run_not_resumable"
    assert "3 times" in (problem.detail or "")


async def test_a_run_that_spent_its_cap_is_not_resumed(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run_id = await insert_run(session_factory, "failed", cost_usd=D("5"))  # the cap is 5
    problem = await problem_of(run_manager.resume(run_id))
    assert problem.code == "run_not_resumable"
    assert "limit" in (problem.detail or "")


async def test_two_resumes_at_once_run_it_once(
    make_manager: MakeManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run_id = await crashed_run(make_manager())
    second = make_manager()
    await second.recover()
    runs_before = fakes.handler_runs

    results = await asyncio.gather(
        second.resume(run_id), second.resume(run_id), return_exceptions=True
    )

    ok = [result for result in results if not isinstance(result, BaseException)]
    refused = [result for result in results if isinstance(result, Problem)]
    assert len(ok) + len(refused) == 2 and ok
    assert all(problem.code == "run_not_resumable" for problem in refused)
    await wait_for_status(session_factory, run_id, "done")
    await wait_until_idle(second)
    assert fakes.handler_runs == runs_before + 1
    assert (await run_row(session_factory, run_id)).counts["resumes"] == 1


async def test_a_run_that_is_going_is_returned_as_it_is(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "block", {})
    await fakes.entered.wait()
    again = await run_manager.resume(run.id)
    assert (again.id, again.status) == (run.id, "running")
    fakes.gate.set()
    await wait_until_idle(run_manager)


# --- Failed and interrupted runs come back --------------------------------------------------------


async def test_a_failed_run_is_resumed_and_its_error_is_cleared(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "work", {"units": 3, "fail_after": 1})
    failed = await wait_for_status(session_factory, run.id, "failed")
    assert failed.error_id is not None
    await wait_until_idle(run_manager)

    await run_manager.resume(run.id)
    row = await wait_for_status(session_factory, run.id, "done")
    assert (row.error, row.error_id, row.stop_reason) == (None, None, None)
    assert row.counts["researched"] == 3
    await assert_totals_match_log(session_factory, run.id)
    resumed = [e for e in await stored_json(session_factory, run.id) if e["type"] == "run_resumed"]
    assert resumed[0]["data"] == {"from_status": "failed"}


async def test_a_run_stopped_by_a_shutdown_is_interrupted_and_can_be_resumed(
    make_manager: MakeManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    first = make_manager()
    run = await first.start(APP, "work", {"units": 4, "pause": 0.3})
    await asyncio.sleep(0.4)
    await first.shutdown()
    row = await run_row(session_factory, run.id)
    assert (row.status, row.stop_reason) == ("interrupted", BACKEND_STOPPED)
    await assert_totals_match_log(session_factory, run.id)

    second = make_manager()
    await second.resume(run.id)
    row = await wait_for_status(session_factory, run.id, "done")
    assert row.claude_requests == 4  # every unit paid exactly once
    await assert_totals_match_log(session_factory, run.id)


async def test_a_resume_uses_the_lower_of_the_saved_caps_and_the_settings_now(
    make_manager: MakeManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run_id = await crashed_run(make_manager())
    second = make_manager(settings=small_settings(run_cap_usd=D("3"), run_max_companies=50))
    await second.recover()
    await second.resume(run_id)
    await wait_for_status(session_factory, run_id, "done")
    caps = fakes.contexts[-1].caps
    assert caps.run_cap_usd == D("3")  # lowered since the start: the lower one
    assert caps.max_companies == 5  # raised since the start: the saved one


# --- Checkpoints ----------------------------------------------------------------------------------


async def has_checkpoint(source: MemorySource, run_id: uuid.UUID) -> bool:
    found = await source.saver.aget_tuple({"configurable": {"thread_id": str(run_id)}})
    return found is not None


@pytest.mark.parametrize(
    ("ending", "status", "kept"), [("done", "done", False), ("fail", "failed", True)]
)
async def test_checkpoints_are_kept_only_for_runs_that_can_be_resumed(
    make_manager: MakeManager,
    session_factory: async_sessionmaker[AsyncSession],
    ending: str,
    status: str,
    kept: bool,
) -> None:
    source = MemorySource()
    manager = make_manager(checkpointer_source=source)
    run = await manager.start(APP, "checkpointed", {"ending": ending})
    await wait_for_status(session_factory, run.id, status)
    await wait_until_idle(manager)
    assert await has_checkpoint(source, run.id) is kept


async def test_a_cancelled_run_loses_its_checkpoint_and_an_interrupted_one_keeps_it(
    make_manager: MakeManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    source = MemorySource()
    manager = make_manager(checkpointer_source=source)
    cancelled = await manager.start(APP, "checkpointed", {"ending": "wait"})
    await fakes.entered.wait()
    await manager.cancel(cancelled.id)
    assert not await has_checkpoint(source, cancelled.id)

    fakes.entered.clear()
    interrupted = await manager.start(APP, "checkpointed", {"ending": "wait"})
    await fakes.entered.wait()
    await manager.shutdown()
    assert (await run_row(session_factory, interrupted.id)).status == "interrupted"
    assert await has_checkpoint(source, interrupted.id)
    assert source.closed
