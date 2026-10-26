"""The in-memory run harness: a real budget and gates, a fake emit that checks every event, and
stand-ins that fail the test when a handler uses the database, Claude or the embedder."""

import asyncio
import uuid
from decimal import Decimal
from typing import Any, cast

import pytest
from pydantic import BaseModel, ValidationError

from apps.lead_finder.params import CompanyParams, DiscoveryParams
from core.claude.client import WebTools
from core.config import Settings
from core.runs.budget import RunBudget
from core.runs.schemas import (
    CapReachedData,
    CompanyDoneData,
    CompanyStartedData,
    MergedData,
    PlanReadyData,
    RunFinishedData,
    RunStartedData,
)
from core.runs.schemas import RunCaps as Caps
from core.runs.types import CapsOverride, RunContext, RunOutcome, make_caps
from tests.core.runs_harness import (
    Recorder,
    UnusedClaude,
    UnusedEmbedder,
    UnusedSessionFactory,
    make_run_context,
)

D = Decimal


class NotAnEvent(BaseModel):
    pass


def caps() -> Caps:
    return Caps(
        run_cap_usd=D("20"), max_companies=20, company_cap_usd=D("2.50"), discovery_cap_usd=D("8")
    )


def started() -> RunStartedData:
    return RunStartedData(mode="discovery", caps=caps(), rules_version="r1")


def plan(slices: int = 3) -> PlanReadyData:
    return PlanReadyData(slices=slices, companies=0, labels=[f"slice {n}" for n in range(slices)])


def finished() -> RunFinishedData:
    from core.runs.schemas import RunCounts

    return RunFinishedData(status="done", stop_reason=None, cost_usd=D("1.5"), counts=RunCounts())


# --- What the harness builds ------------------------------------------------------------------


def test_the_context_has_the_pieces_a_handler_needs_with_the_default_settings() -> None:
    params = DiscoveryParams()
    harness = make_run_context(params)
    ctx = harness.ctx
    assert isinstance(ctx, RunContext)
    assert ctx.params is params
    assert (ctx.app, ctx.mode, ctx.resume) == ("lead_finder", "discovery", False)
    assert ctx.caps == make_caps(Settings(_env_file=None))
    assert isinstance(ctx.budget, RunBudget)
    assert (ctx.budget.cap_usd, ctx.budget.max_companies) == (ctx.caps.run_cap_usd, 20)
    assert ctx.budget.spent == D(0)
    assert ctx.totals.cost_usd == D(0)
    assert ctx.cancelled.is_set() is False
    assert isinstance(ctx.run_id, uuid.UUID)
    assert (ctx.rules_version, ctx.prompt_versions) == ("rules-test", "prompts-test")
    assert harness.events.events == []


def test_each_context_has_its_own_run_id_budget_and_events() -> None:
    first = make_run_context(DiscoveryParams())
    second = make_run_context(DiscoveryParams())
    assert first.ctx.run_id != second.ctx.run_id
    assert first.ctx.budget is not second.ctx.budget
    assert first.events is not second.events
    fixed = uuid.uuid4()
    assert make_run_context(DiscoveryParams(), run_id=fixed).ctx.run_id == fixed


async def test_the_gates_are_real_semaphores_sized_from_the_settings() -> None:
    harness = make_run_context(
        DiscoveryParams(),
        settings_overrides={"run_company_concurrency": 1, "run_discover_concurrency": 3},
    )
    research, discover = harness.ctx.research_gate, harness.ctx.discover_gate
    assert isinstance(research, asyncio.Semaphore)
    await research.acquire()
    assert research.locked()  # a size of one: the second task would wait
    for _ in range(3):
        await discover.acquire()
    assert discover.locked()
    assert harness.ctx.research_gate is research  # made once for the run


def test_settings_and_the_persons_own_limits_decide_the_caps() -> None:
    harness = make_run_context(
        DiscoveryParams(),
        settings_overrides={"run_cap_usd": D("10"), "run_max_companies": 8},
        caps_override=CapsOverride(run_cap_usd=D("4"), max_companies=3),
    )
    assert harness.ctx.caps.run_cap_usd == D("4")
    assert harness.ctx.caps.max_companies == 3
    assert harness.ctx.budget.cap_usd == D("4")
    assert harness.ctx.budget.max_companies == 3
    # A person can only lower a limit.
    raised = make_run_context(
        DiscoveryParams(),
        settings_overrides={"run_cap_usd": D("10")},
        caps_override=CapsOverride(run_cap_usd=D("30")),
    )
    assert raised.ctx.caps.run_cap_usd == D("10")


def test_given_settings_are_used_as_they_are_and_can_be_changed_a_little() -> None:
    mine = Settings(_env_file=None, run_cap_usd=D("12"))
    assert make_run_context(DiscoveryParams(), settings=mine).ctx.settings is mine
    changed = make_run_context(
        DiscoveryParams(), settings=mine, settings_overrides={"run_max_companies": 4}
    )
    assert changed.ctx.settings.run_cap_usd == D("12")
    assert changed.ctx.caps.max_companies == 4
    assert mine.run_max_companies == 20  # the settings passed in are not changed


def test_a_resume_can_start_the_budget_where_the_last_run_stopped() -> None:
    harness = make_run_context(
        DiscoveryParams(), resume=True, spent=D("3.20"), companies_started=19
    )
    assert harness.ctx.resume is True
    assert harness.ctx.budget.spent == D("3.20")
    assert harness.ctx.budget.start_company() is True  # the 20th
    assert harness.ctx.budget.start_company() is False


async def test_the_budget_is_the_real_one() -> None:
    harness = make_run_context(DiscoveryParams(), caps_override=CapsOverride(run_cap_usd=D("5")))
    budget = harness.ctx.budget
    async with budget.hold(D("2.50")) as first, budget.hold(D("2.50")) as second:
        assert first
        assert second
        third = asyncio.create_task(budget.acquire(D("2.50")))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not third.done()  # it waits: the cap is full of holds
        first.actual = D("1")
        second.actual = D("1")
    async with asyncio.timeout(2):
        hold = await third  # both ended, 2.00 is spent, and 2.50 more fits
    assert hold
    hold.release(D("0.50"))
    assert budget.spent == D("2.50")
    assert budget.reserved == D(0)


# --- The stand-ins fail the test when used ----------------------------------------------------


async def test_using_the_database_fails_the_test_unless_one_is_given() -> None:
    harness = make_run_context(DiscoveryParams())
    assert isinstance(harness.ctx.session_factory, UnusedSessionFactory)
    with pytest.raises(AssertionError, match="the database"):
        async with harness.ctx.session():
            pass  # pragma: no cover


async def test_asking_claude_fails_the_test_unless_one_is_given() -> None:
    harness = make_run_context(DiscoveryParams())
    assert isinstance(harness.ctx.claude, UnusedClaude)
    with pytest.raises(AssertionError, match="Claude"):
        await harness.ctx.claude.ask(
            system="s", prompt="p", form=PlanReadyData, web=WebTools(1, 1), model="m"
        )


async def test_embedding_fails_the_test_unless_an_embedder_is_given() -> None:
    harness = make_run_context(DiscoveryParams())
    assert isinstance(harness.ctx.embedder, UnusedEmbedder)
    with pytest.raises(AssertionError, match="the embedder"):
        await harness.ctx.embedder.embed_query("an office move")
    with pytest.raises(AssertionError, match="the embedder"):
        harness.ctx.embedder.passages(["a"])


async def test_what_is_passed_in_is_what_the_context_holds() -> None:
    class Factory:
        def __call__(self) -> "Session":
            return Session()

    class Session:
        async def __aenter__(self) -> "Session":
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

    factory, claude, embedder, saver = Factory(), UnusedClaude(), UnusedEmbedder(), object()
    harness = make_run_context(
        DiscoveryParams(),
        session_factory=factory,  # type: ignore[arg-type]
        claude=claude,
        embedder=embedder,
        checkpointer=saver,
    )
    ctx = harness.ctx
    assert cast(Any, ctx.session_factory) is factory
    assert ctx.claude is claude
    assert ctx.embedder is embedder
    assert ctx.checkpointer is saver
    async with ctx.session() as session:  # the given factory is used, so nothing fails
        assert isinstance(session, Session)


def test_the_default_checkpointer_is_a_fresh_in_memory_saver() -> None:
    from langgraph.checkpoint.memory import InMemorySaver

    first = make_run_context(DiscoveryParams()).ctx.checkpointer
    second = make_run_context(DiscoveryParams()).ctx.checkpointer
    assert isinstance(first, InMemorySaver)
    assert first is not second


# --- The fake emit ----------------------------------------------------------------------------


async def test_emit_keeps_typed_events_numbered_from_one() -> None:
    harness = make_run_context(DiscoveryParams())
    await harness.ctx.emit("run_started", started())
    await harness.ctx.emit("plan_ready", plan())
    await harness.ctx.emit_event(MergedData(candidates=9, unique=7))
    events = harness.events.events
    assert [(e.seq, e.type) for e in events] == [
        (1, "run_started"),
        (2, "plan_ready"),
        (3, "merged"),
    ]
    assert isinstance(events[1].data, PlanReadyData)
    assert events[1].data.labels == ["slice 0", "slice 1", "slice 2"]
    assert events[0].created_at.tzinfo is not None
    harness.events.assert_seqs_are_in_order()
    assert len(harness.events) == 3


async def test_emit_event_finds_the_type_from_the_data_model() -> None:
    harness = make_run_context(DiscoveryParams())
    await harness.ctx.emit_event(CompanyStartedData(name="Acme"))
    await harness.ctx.emit_event(
        CompanyDoneData(
            name="Acme",
            lead_id=uuid.uuid4(),
            result="pass",
            score=82,
            cost_usd=D("0.9"),
            hubspot_status="in_hubspot",
        )
    )
    await harness.ctx.emit_event(CapReachedData(kind="run_cost", detail="US$20.00 used"))
    harness.events.assert_exactly("company_started", "company_done", "cap_reached")
    with pytest.raises(TypeError, match="not the data of any run event"):
        await harness.ctx.emit_event(NotAnEvent())


async def test_emit_refuses_a_type_and_data_that_do_not_belong_together() -> None:
    harness = make_run_context(DiscoveryParams())
    with pytest.raises(TypeError, match="plan_ready needs a PlanReadyData"):
        await harness.ctx.emit("plan_ready", MergedData(candidates=1, unique=1))
    with pytest.raises(ValueError, match="Unknown event type"):
        await harness.ctx.emit("planned", plan())
    assert harness.events.events == []  # a refused event is not kept


async def test_an_event_goes_through_the_typed_union_so_bad_values_fail_at_the_call() -> None:
    harness = make_run_context(DiscoveryParams())
    bad = CompanyDoneData.model_construct(
        name="Acme",
        lead_id=uuid.uuid4(),
        result="pass",
        score=82,
        cost_usd=D("0.9"),
        hubspot_status=cast(Any, "maybe"),  # not a HubSpot status
    )
    with pytest.raises(ValidationError):
        await harness.ctx.emit("company_done", bad)
    assert harness.events.events == []


async def test_many_tasks_emitting_at_once_get_every_number_once() -> None:
    harness = make_run_context(DiscoveryParams())

    async def worker(n: int) -> None:
        for _ in range(20):
            await asyncio.sleep(0)
            await harness.ctx.emit_event(CompanyStartedData(name=f"Company {n}"))

    await asyncio.gather(*(worker(n) for n in range(10)))
    assert harness.events.count("company_started") == 200
    harness.events.assert_seqs_are_in_order()


# --- The order helpers ------------------------------------------------------------------------


async def recorded(*datas: BaseModel) -> Recorder:
    harness = make_run_context(DiscoveryParams())
    for data in datas:
        await harness.ctx.emit_event(data)
    return harness.events


async def test_assert_order_allows_other_events_between_but_not_a_wrong_order() -> None:
    events = await recorded(
        started(),
        plan(),
        CompanyStartedData(name="A"),
        MergedData(candidates=1, unique=1),
        finished(),
    )
    events.assert_order("run_started", "company_started", "run_finished")
    events.assert_order()  # nothing to check
    with pytest.raises(AssertionError, match="expected 'run_started'"):
        events.assert_order("run_finished", "run_started")
    with pytest.raises(AssertionError, match="expected 'cap_reached'"):
        events.assert_order("run_started", "cap_reached")


async def test_assert_order_needs_each_type_after_the_one_before() -> None:
    events = await recorded(plan(), plan(), finished())
    events.assert_order("plan_ready", "plan_ready", "run_finished")
    with pytest.raises(AssertionError):
        events.assert_order("plan_ready", "plan_ready", "plan_ready")  # only two of them


async def test_assert_exactly_and_the_other_checks() -> None:
    events = await recorded(started(), CompanyStartedData(name="A"), finished())
    events.assert_exactly("run_started", "company_started", "run_finished")
    with pytest.raises(AssertionError, match="events were"):
        events.assert_exactly("run_started", "run_finished")
    assert events.types == ["run_started", "company_started", "run_finished"]
    assert [e.seq for e in events.of_type("company_started")] == [2]
    assert [d.name for d in events.data_of("company_started")] == ["A"]  # type: ignore[attr-defined]
    events.assert_last("run_finished")
    with pytest.raises(AssertionError, match="the last event is 'run_finished'"):
        events.assert_last("company_started")
    events.assert_never("cap_reached")
    with pytest.raises(AssertionError, match="a 'merged' event"):
        (await recorded(MergedData(candidates=1, unique=1))).assert_never("merged")


async def test_assert_before_compares_every_event_of_the_two_types() -> None:
    events = await recorded(
        CompanyStartedData(name="A"), CompanyStartedData(name="B"), finished(), plan()
    )
    events.assert_before("company_started", "run_finished")
    with pytest.raises(AssertionError, match="not always before"):
        events.assert_before("run_finished", "company_started")
    with pytest.raises(AssertionError, match="not always before"):
        events.assert_before("plan_ready", "run_finished")
    with pytest.raises(AssertionError, match="no 'cap_reached' event"):
        events.assert_before("cap_reached", "run_finished")  # a typo can't pass
    with pytest.raises(AssertionError, match="no 'merged' event"):
        events.assert_before("run_finished", "merged")


def test_the_checks_on_an_empty_run() -> None:
    harness = make_run_context(DiscoveryParams())
    with pytest.raises(AssertionError, match="no events"):
        harness.events.assert_last("run_finished")
    harness.events.assert_exactly()
    harness.events.assert_seqs_are_in_order()
    assert harness.events.count("run_started") == 0


# --- Running a handler ------------------------------------------------------------------------


async def test_run_gives_the_handler_the_context_and_returns_its_outcome() -> None:
    harness = make_run_context(CompanyParams.model_validate({"companies": [{"name": "Acme"}]}))

    async def handler(ctx: RunContext[CompanyParams]) -> RunOutcome:
        await ctx.emit_event(started())
        assert ctx.params.companies[0].name == "Acme"
        async with ctx.budget.hold(ctx.caps.company_cap_usd) as hold:
            assert hold
            hold.actual = D("0.75")
        ctx.totals.cost_usd = ctx.budget.spent
        await ctx.emit_event(finished())
        return RunOutcome(stop_reason="the list is done")

    outcome = await harness.run(handler)
    assert outcome == RunOutcome(stop_reason="the list is done")
    harness.events.assert_exactly("run_started", "run_finished")
    assert harness.ctx.budget.spent == D("0.75")
    assert harness.ctx.totals.cost_usd == D("0.75")


async def test_cancel_sets_the_event_a_handler_watches() -> None:
    harness = make_run_context(DiscoveryParams())
    seen: list[bool] = []

    async def handler(ctx: RunContext[DiscoveryParams]) -> RunOutcome:
        await ctx.cancelled.wait()
        seen.append(ctx.cancelled.is_set())
        return RunOutcome(stop_reason="Stopped by a person")

    task = asyncio.create_task(harness.run(handler))
    await asyncio.sleep(0)
    assert not task.done()
    harness.cancel()
    async with asyncio.timeout(2):
        outcome = await task
    assert seen == [True]
    assert outcome.stop_reason == "Stopped by a person"
