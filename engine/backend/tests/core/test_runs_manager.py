"""The run manager: starting, finishing, failing and stopping runs, on the real test database.

The handlers are the tiny fakes of `tests/core/runs_fakes.py`. Claude is never called.
"""

import asyncio
import logging
import random
import uuid
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.config import get_settings
from core.runs.manager import (
    PROMPT_VERSIONS_MAX,
    RULES_VERSION_MAX,
    STOPPED_BY_PERSON,
    UNEXPECTED_ERROR,
    RunManager,
)
from core.runs.schemas import RunCaps
from tests.core.conftest import MakeManager
from tests.core.runs_fakes import (
    APP,
    FakeState,
    assert_totals_match_log,
    event_types,
    run_row,
    stored_events,
    stored_json,
    wait_for_status,
    wait_until,
    wait_until_idle,
)

pytestmark = pytest.mark.integration
D = Decimal
API_KEY = "sk-ant-api03-AbCdEf_0123456789-xyz"  # the shape of a real key; the log hides it


async def problem_of(call: Any) -> Problem:
    with pytest.raises(Problem) as caught:
        await call
    return caught.value


# --- A run from start to end -----------------------------------------------------------------


async def test_a_run_starts_does_its_work_and_ends_done(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "work", {"units": 3})

    assert run.status == "queued"
    assert run.params["units"] == 3
    row = await wait_for_status(session_factory, run.id, "done")
    await wait_until_idle(run_manager)

    types = await event_types(session_factory, run.id)
    assert types[0] == "run_started"
    assert types[-1] == "run_finished"
    assert types.count("company_started") == types.count("company_done") == 3
    row = await assert_totals_match_log(session_factory, run.id)
    assert (row.cost_usd, row.web_searches, row.claude_requests) == (D("0.30"), 3, 3)
    assert row.counts["researched"] == 3
    assert row.counts["by_result"] == {"pass": 3}
    assert (row.rules_version, row.prompt_versions) == ("rules-fake", "prompts-fake")
    assert row.started_at is not None and row.finished_at is not None
    assert row.stop_reason is None and row.error is None
    assert RunCaps.model_validate(row.caps).run_cap_usd == D("5")
    finished = (await stored_json(session_factory, run.id))[-1]["data"]
    assert finished == {
        "status": "done",
        "stop_reason": None,
        "cost_usd": "0.300000",
        "counts": row.counts,
    }
    assert not run_manager.is_active(run.id)


async def test_the_run_started_event_carries_the_mode_caps_and_rules_version(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "work", {"units": 0, "run_cap_usd": "2.5"})
    await wait_for_status(session_factory, run.id, "done")
    started = (await stored_json(session_factory, run.id))[0]
    assert started["type"] == "run_started"
    assert started["data"]["mode"] == "work"
    assert started["data"]["rules_version"] == "rules-fake"
    assert started["data"]["caps"]["run_cap_usd"] == "2.5"  # a run can only lower its cap


async def test_a_caps_override_can_lower_but_never_raise_the_settings(
    run_manager: RunManager,
) -> None:
    lower = await run_manager.start(APP, "work", {"units": 0, "max_companies": 2})
    await wait_until_idle(run_manager)
    higher = await run_manager.start(APP, "work", {"units": 0, "run_cap_usd": "500"})
    await wait_until_idle(run_manager)
    assert lower.caps.max_companies == 2
    assert higher.caps.run_cap_usd == D("5")  # the settings' cap (small_settings)


async def test_a_stop_reason_and_a_cap_reached_event_end_the_run_cleanly(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "capped", {})
    row = await wait_for_status(session_factory, run.id, "done")
    assert row.stop_reason == "The run cap was reached"
    events = await stored_json(session_factory, run.id)
    (cap,) = [event for event in events if event["type"] == "cap_reached"]
    assert cap["data"] == {"kind": "run_cost", "detail": "The run reached its limit of US$5.00"}
    assert events[-1]["data"]["stop_reason"] == "The run cap was reached"


async def test_texts_longer_than_their_columns_are_cut(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "long", {"units": 0, "stop_reason": "x" * 500})
    row = await wait_for_status(session_factory, run.id, "done")
    assert len(row.rules_version) == RULES_VERSION_MAX
    assert len(row.prompt_versions) == PROMPT_VERSIONS_MAX
    assert row.rules_version.endswith("…")
    assert row.stop_reason is not None and len(row.stop_reason) <= 120


# --- Refusals at start ------------------------------------------------------------------------


async def test_an_unknown_app_or_mode_is_a_404(run_manager: RunManager) -> None:
    for app, mode in (("nobody", "work"), (APP, "nothing")):
        problem = await problem_of(run_manager.start(app, mode, {}))
        assert (problem.status, problem.code) == (404, "unknown_run_kind")
    assert run_manager.active_run_ids == []


async def test_bad_params_are_a_422_that_names_each_field(run_manager: RunManager) -> None:
    problem = await problem_of(
        run_manager.start(APP, "work", {"units": -1, "pause": "slow", "surprise": 1})
    )
    assert problem.status == 422
    fields = {error["field"]: error["message"] for error in problem.extra["errors"]}
    assert set(fields) == {"body.params.units", "body.params.pause", "body.params.surprise"}
    assert not any("Value error" in message for message in fields.values())
    assert "slow" not in str(problem.extra)  # the value that was refused is not repeated
    assert run_manager.active_run_ids == []


async def test_the_kind_check_refuses_a_run_that_is_too_big(run_manager: RunManager) -> None:
    problem = await problem_of(run_manager.start(APP, "work", {"too_big": True}))
    assert (problem.status, problem.code) == (422, "discovery_too_large")
    assert problem.extra["errors"] == [{"field": "body.params.units", "message": "too many"}]
    assert run_manager.active_run_ids == []


async def test_a_second_run_while_one_is_going_is_a_409_with_the_run_id(
    run_manager: RunManager, fakes: FakeState
) -> None:
    first = await run_manager.start(APP, "block", {})
    await fakes.entered.wait()

    problem = await problem_of(run_manager.start(APP, "work", {}))

    assert (problem.status, problem.code) == (409, "run_already_active")
    assert problem.extra["run_id"] == str(first.id)
    fakes.gate.set()
    await wait_until_idle(run_manager)
    second = await run_manager.start(APP, "work", {"units": 0})  # the slot is free again
    assert second.id != first.id


async def test_twenty_starts_at_once_give_exactly_one_run(
    run_manager: RunManager, fakes: FakeState
) -> None:
    results = await asyncio.gather(
        *(run_manager.start(APP, "block", {}) for _ in range(20)), return_exceptions=True
    )

    runs = [result for result in results if not isinstance(result, BaseException)]
    refused = [result for result in results if isinstance(result, Problem)]
    assert len(runs) == 1
    assert len(refused) == 19
    assert {(p.status, p.code, p.extra["run_id"]) for p in refused} == {
        (409, "run_already_active", str(runs[0].id))
    }
    fakes.gate.set()
    await wait_until_idle(run_manager)


async def test_a_checkpoint_store_that_is_down_is_a_503_and_takes_no_slot(
    make_manager: MakeManager,
) -> None:
    class Down:
        async def get(self) -> Any:
            raise OSError("connection to 127.0.0.1 refused, password=secret")

        async def close(self, seconds: float = 5) -> None: ...

    manager = make_manager(checkpointer_source=Down())
    problem = await problem_of(manager.start(APP, "work", {}))
    assert (problem.status, problem.code) == (503, "checkpoints_unavailable")
    assert "secret" not in f"{problem.title} {problem.detail}"
    assert manager.active_run_ids == []


async def test_a_stopping_backend_refuses_new_runs(run_manager: RunManager) -> None:
    await run_manager.shutdown()
    problem = await problem_of(run_manager.start(APP, "work", {}))
    assert (problem.status, problem.code) == (503, "backend_stopping")


# --- The Idempotency-Key ------------------------------------------------------------------------


async def test_the_same_key_and_body_give_the_same_run(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    first = await run_manager.start(APP, "work", {"units": 1}, idempotency_key="click-1")
    again = await run_manager.start(APP, "work", {"units": 1}, idempotency_key="click-1")
    assert again.id == first.id
    await wait_until_idle(run_manager)
    # Once the run is over the key still finds it (from the database).
    later = await run_manager.start(APP, "work", {"units": 1}, idempotency_key="click-1")
    assert later.id == first.id
    assert (await run_row(session_factory, first.id)).idempotency_key == "click-1"


async def test_twenty_requests_with_one_key_at_once_make_one_run(
    run_manager: RunManager, fakes: FakeState
) -> None:
    results = await asyncio.gather(
        *(run_manager.start(APP, "block", {}, idempotency_key="double") for _ in range(20))
    )
    assert len({run.id for run in results}) == 1
    fakes.gate.set()
    await wait_until_idle(run_manager)


async def test_the_same_key_with_another_body_is_a_409(run_manager: RunManager) -> None:
    await run_manager.start(APP, "work", {"units": 1}, idempotency_key="key-a")
    for app, mode, params in ((APP, "work", {"units": 2}), (APP, "capped", {"units": 1})):
        problem = await problem_of(run_manager.start(app, mode, params, idempotency_key="key-a"))
        assert (problem.status, problem.code) == (409, "idempotency_key_reused")
    await wait_until_idle(run_manager)


async def test_a_key_is_remembered_after_a_restart(
    make_manager: MakeManager,
) -> None:
    first = make_manager()
    run = await first.start(APP, "work", {"units": 0}, idempotency_key="before-restart")
    await wait_until_idle(first)
    await first.shutdown()

    second = make_manager()
    assert (await second.start(APP, "work", {"units": 0}, idempotency_key="before-restart")).id == (
        run.id
    )
    reused = await problem_of(
        second.start(APP, "work", {"units": 9}, idempotency_key="before-restart")
    )
    assert reused.code == "idempotency_key_reused"


@pytest.mark.parametrize("key", ["", "k" * 65])
async def test_a_key_of_the_wrong_length_is_a_422(run_manager: RunManager, key: str) -> None:
    problem = await problem_of(run_manager.start(APP, "work", {}, idempotency_key=key))
    assert problem.status == 422
    assert problem.extra["errors"][0]["field"] == "header.idempotency-key"


# --- Failures -------------------------------------------------------------------------------


async def test_claude_unavailable_fails_the_run_with_its_plain_words(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "down", {})
    row = await wait_for_status(session_factory, run.id, "failed")
    assert row.stop_reason == "No Claude API key"
    assert row.error == "No Claude API key. Add ANTHROPIC_API_KEY to engine/.env."
    assert row.error_id is None
    events = await stored_json(session_factory, run.id)
    assert [event["type"] for event in events[-2:]] == ["problem", "run_finished"]
    assert events[-2]["data"]["message"] == row.error


async def test_a_claude_provider_that_fails_fails_the_run_the_same_way(
    make_manager: MakeManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    from core.claude.client import ClaudeUnavailable

    def no_key() -> Any:
        raise ClaudeUnavailable("No Claude API key", "Add ANTHROPIC_API_KEY to engine/.env.")

    manager = make_manager(claude_provider=no_key)
    run = await manager.start(APP, "work", {})
    row = await wait_for_status(session_factory, run.id, "failed")
    assert row.stop_reason == "No Claude API key"


async def test_an_unexpected_error_leaves_no_secret_anywhere(
    run_manager: RunManager,
    session_factory: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
) -> None:
    password = get_settings().postgres_password.get_secret_value()
    assert len(password) >= 4  # the test database has a real password
    text = f"could not connect: password={password} key={API_KEY}"
    with caplog.at_level(logging.DEBUG):
        run = await run_manager.start(APP, "boom", {"raise_text": text})
        row = await wait_for_status(session_factory, run.id, "failed")
        await wait_until_idle(run_manager)

    assert row.error == UNEXPECTED_ERROR
    assert row.error_id is not None and len(row.error_id) == 12
    assert row.stop_reason == "Stopped by an error"
    saved = dict((await run_row(session_factory, run.id)).__dict__)
    del saved["params"]  # the request as it was sent (the test put the secrets there itself)
    written = " ".join(
        [
            repr(saved),
            repr(await stored_json(session_factory, run.id)),
            caplog.text,
            *(repr(record.__dict__) for record in caplog.records),
        ]
    )
    # Booleans, so a failure can't print the secret it found.
    leaked = {"password": password in written, "key": API_KEY in written, "text": text in written}
    assert leaked == {"password": False, "key": False, "text": False}
    # The error id finds the trace (with the secrets removed) in the log.
    (failed,) = [r for r in caplog.records if getattr(r, "error_id", None) == row.error_id]
    assert "RuntimeError" in failed.trace  # type: ignore[attr-defined]
    assert "[redacted]" in failed.trace  # type: ignore[attr-defined]


async def test_a_dead_process_writes_nothing_more(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "work", {"units": 4, "crash_after": 2})
    await wait_until_idle(run_manager)
    row = await run_row(session_factory, run.id)
    assert row.status == "running"  # recover() fixes it at the next start
    assert row.finished_at is None
    assert "run_finished" not in await event_types(session_factory, run.id)


# --- Cancel -----------------------------------------------------------------------------------


async def test_cancel_mid_run_keeps_what_finished_and_marks_it_cancelled(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "work", {"units": 5, "pause": 0.3})

    async def two_done() -> bool:
        return (await event_types(session_factory, run.id)).count("company_done") >= 2

    await wait_until(two_done)
    out = await run_manager.cancel(run.id)

    assert out.status == "cancelled"
    assert out.stop_reason == STOPPED_BY_PERSON
    assert out.cancel_requested_at is not None
    assert fakes.cancelled_seen == 1
    row = await assert_totals_match_log(session_factory, run.id)
    assert row.claude_requests in (2, 3)  # what finished before the stop stays
    assert row.counts["researched"] == row.claude_requests
    events = await stored_json(session_factory, run.id)
    assert events[-1]["type"] == "run_finished"
    assert events[-1]["data"]["status"] == "cancelled"
    assert not run_manager.is_active(run.id)


async def test_cancel_before_the_first_step_still_finishes_the_run(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "block", {})
    out = await run_manager.cancel(run.id)  # no wait: the task may not have begun
    assert out.status == "cancelled"
    assert (await event_types(session_factory, run.id))[-1] == "run_finished"


async def test_a_second_cancel_and_a_cancel_of_a_finished_run_return_the_run(
    run_manager: RunManager, fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "block", {})
    await fakes.entered.wait()
    first, second = await asyncio.gather(run_manager.cancel(run.id), run_manager.cancel(run.id))
    assert first.status == second.status == "cancelled"
    assert fakes.cancelled_seen == 1  # the task was cancelled once
    assert (await run_manager.cancel(run.id)).status == "cancelled"

    done = await run_manager.start(APP, "work", {"units": 0})
    await wait_until_idle(run_manager)
    assert (await run_manager.cancel(done.id)).status == "done"


async def test_cancel_of_an_unknown_run_is_a_404(run_manager: RunManager) -> None:
    problem = await problem_of(run_manager.cancel(uuid.uuid4()))
    assert problem.status == 404


async def test_a_storm_of_cancels_at_random_moments_leaves_every_run_whole(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    rng = random.Random(7)
    ids = []
    for _ in range(100):
        run = await run_manager.start(APP, "work", {"units": 3, "pause": 0.005})
        ids.append(run.id)
        await asyncio.sleep(rng.random() * 0.03)
        out = await run_manager.cancel(run.id)
        assert out.status in ("cancelled", "done")
    assert run_manager.active_run_ids == []
    for run_id in ids:
        row = await assert_totals_match_log(session_factory, run_id)
        assert row.status in ("cancelled", "done")
        assert (await event_types(session_factory, run_id))[-1] == "run_finished"
        seqs = [event.seq for event in await stored_events(session_factory, run_id)]
        assert seqs == list(range(1, len(seqs) + 1))
    after = await run_manager.start(APP, "work", {"units": 2})
    assert (await wait_for_status(session_factory, after.id, "done")).claude_requests == 2


async def test_the_handler_is_told_to_stop_through_the_context(
    run_manager: RunManager, fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "block", {})
    await fakes.entered.wait()
    ctx = fakes.contexts[-1]
    assert not ctx.cancelled.is_set()
    await run_manager.cancel(run.id)
    assert ctx.cancelled.is_set()


# --- What the context gives a handler ---------------------------------------------------------


async def test_the_context_has_the_settings_caps_gates_and_a_budget(
    run_manager: RunManager, fakes: FakeState
) -> None:
    await run_manager.start(APP, "block", {"max_companies": 3})
    await fakes.entered.wait()
    ctx = fakes.contexts[-1]
    assert ctx.app == APP and ctx.mode == "block" and ctx.resume is False
    assert ctx.caps.max_companies == 3
    assert ctx.budget.cap_usd == D("5")
    assert ctx.settings.run_company_concurrency == 2
    assert ctx.research_gate._value == 2
    assert ctx.discover_gate._value == 3
    async with ctx.session() as one, ctx.session() as two:
        assert one is not two  # a fresh session for each use
    fakes.gate.set()
    await wait_until_idle(run_manager)


async def test_progress_is_saved_while_the_run_goes(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "work", {"units": 3, "pause": 0.15})
    await wait_for_status(session_factory, run.id, "done")
    events = await stored_json(session_factory, run.id)
    progress = [event["data"] for event in events if event["type"] == "progress"]
    assert progress, "a progress event every tick while the totals change"
    costs = [D(item["cost_usd"]) for item in progress]
    assert costs == sorted(costs)  # never backwards
