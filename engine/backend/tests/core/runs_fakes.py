"""Fakes and helpers for testing the run engine against the real database.

`FakeState` and `fake_kinds` make a registry of tiny run kinds (the "handlers are tiny fakes" of
the design). All of them take the same `FakeParams`, and each mode does one thing:

- `work`: `units` units of work. A unit emits `company_started`, waits `pause` seconds, logs one
  search row that costs `cost` (and counts it in `ctx.totals`), then emits `company_done`. A unit
  that has a `company_done` event already is skipped, so a resume doesn't repeat finished work.
  `crash_after=N` raises `SimulatedCrash` once N units are done (the next unit has started: a dead
  process). `fail_after=N` raises a `RuntimeError` there. Both happen on the first go only, not on
  a resume (the params are saved with the run, and the resume must be able to finish).
  `stop_reason` is returned as the outcome.
- `block`: waits for `state.gate`. `state.entered` is set when it begins.
- `down`: raises `ClaudeUnavailable`.
- `boom`: raises `RuntimeError(params.raise_text)`.
- `many`: two tasks that each emit `units` `problem` events at once (for the numbering tests).
- `capped`: emits `cap_reached` and returns a stop reason.
- `checkpointed`: saves a LangGraph state under the run id with the context's saver, then ends
  the way `params.ending` says (`done`, `fail` or `wait`).

Everything a handler does is written to `state` (calls, contexts), so a test can check it.
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal, TypedDict, cast

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.claude.client import ClaudeUnavailable, Reply
from core.claude.pricing import Usage
from core.config import Settings
from core.runs.models import Run
from core.runs.models import RunEvent as RunEventRow
from core.runs.schemas import (
    CapReachedData,
    CompanyDoneData,
    CompanyStartedData,
    RunCaps,
    RunEstimate,
    RunEvent,
    RunProblemData,
    build_event,
    dump_event,
)
from core.runs.types import (
    CapsOverride,
    EstimateContext,
    KindKey,
    RunContext,
    RunKind,
    RunOutcome,
    RunVersions,
)
from core.searches.models import SearchLog
from core.searches.service import log_reply

APP = "fake"
D = Decimal


class SimulatedCrash(BaseException):
    """Escapes `except Exception` like a dead process. The manager writes nothing more."""


class FakeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    units: int = Field(3, ge=0, le=5000)
    pause: float = Field(0, ge=0, le=60)
    cost: Decimal = Field(D("0.10"), ge=0)
    crash_after: int | None = None
    fail_after: int | None = None
    stop_reason: str | None = None
    raise_text: str = "something broke"
    ending: Literal["done", "fail", "wait"] = "done"
    too_big: bool = False
    run_cap_usd: Decimal | None = Field(None, gt=0)
    max_companies: int | None = Field(None, gt=0)
    rules_version: str = "rules-fake"
    prompt_versions: str = "prompts-fake"


class CounterState(TypedDict):
    n: int


@dataclass
class FakeState:
    """What the fake handlers saw. One per test."""

    settings: Settings
    calls: list[tuple[str, bool]] = field(default_factory=list)  # (unit name, resume)
    contexts: list[RunContext[Any]] = field(default_factory=list)
    gate: asyncio.Event = field(default_factory=asyncio.Event)
    entered: asyncio.Event = field(default_factory=asyncio.Event)
    cancelled_seen: int = 0
    handler_runs: int = 0

    def units_called(self) -> list[str]:
        return [name for name, _ in self.calls]


def small_settings(**overrides: Any) -> Settings:
    """Settings with small caps, and no .env file (so the developer's own values never leak in)."""
    values: dict[str, Any] = {
        "run_cap_usd": D("5"),
        "run_max_companies": 5,
        "company_cap_usd": D("1"),
        "request_reserve_usd": D("0.5"),
        "slice_reserve_usd": D("0.5"),
        "max_concurrent_runs": 1,
        "run_company_concurrency": 2,
        "run_discover_concurrency": 3,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


async def spend(ctx: RunContext[Any], cost: Decimal, subject: str = "unit") -> None:
    """What a real research step does: log one Claude request for the run, and count it live."""
    reply: Reply[BaseModel] = Reply(
        model="claude-opus-5-5",
        stop_reason="end_turn",
        parsed=None,
        text="",
        sources=(),
        queries=(),
        usage=Usage(web_searches=1),
        cost_usd=cost,
    )
    async with ctx.session() as session:
        log_reply(session, reply, app=ctx.app, step="work", run_id=ctx.run_id, subject=subject)
        await session.commit()
    ctx.totals.add_reply(reply)


async def finished_units(ctx: RunContext[Any]) -> set[str]:
    """The units that already have a `company_done` event (what a real resume reads)."""
    async with ctx.session() as session:
        rows = await session.scalars(
            select(RunEventRow.data["name"].astext).where(
                RunEventRow.run_id == ctx.run_id, RunEventRow.type == "company_done"
            )
        )
        return set(rows)


def fake_kinds(state: FakeState) -> dict[KindKey, RunKind[Any]]:
    """The registry the run manager tests use: one kind for each mode in the module text."""

    async def work(ctx: RunContext[FakeParams]) -> RunOutcome:
        params = ctx.params
        state.contexts.append(ctx)
        state.handler_runs += 1
        already = await finished_units(ctx) if ctx.resume else set()
        done = len(already)
        for number in range(params.units):
            name = f"unit-{number}"
            if name in already:
                continue
            await ctx.emit_event(CompanyStartedData(name=name))
            state.calls.append((name, ctx.resume))
            first_go = not ctx.resume
            if first_go and params.crash_after is not None and done >= params.crash_after:
                raise SimulatedCrash(name)
            if first_go and params.fail_after is not None and done >= params.fail_after:
                raise RuntimeError(f"failed at {name}")
            try:
                await asyncio.sleep(params.pause)
            except asyncio.CancelledError:
                state.cancelled_seen += 1
                raise
            await spend(ctx, params.cost, name)
            await ctx.emit_event(
                CompanyDoneData(
                    name=name,
                    lead_id=uuid.uuid4(),
                    result="pass",
                    score=1,
                    cost_usd=params.cost,
                    hubspot_status="new",
                )
            )
            done += 1
            ctx.totals.counts.researched = done
            ctx.totals.counts.by_result = {"pass": done}
        return RunOutcome(stop_reason=params.stop_reason)

    async def block(ctx: RunContext[FakeParams]) -> RunOutcome:
        state.contexts.append(ctx)
        state.handler_runs += 1
        state.entered.set()
        try:
            await state.gate.wait()
        except asyncio.CancelledError:
            state.cancelled_seen += 1
            raise
        return RunOutcome()

    async def down(ctx: RunContext[FakeParams]) -> RunOutcome:
        state.contexts.append(ctx)
        raise ClaudeUnavailable("No Claude API key", "Add ANTHROPIC_API_KEY to engine/.env.")

    async def boom(ctx: RunContext[FakeParams]) -> RunOutcome:
        state.contexts.append(ctx)
        raise RuntimeError(ctx.params.raise_text)

    async def many(ctx: RunContext[FakeParams]) -> RunOutcome:
        state.contexts.append(ctx)

        async def burst(label: str) -> None:
            for number in range(ctx.params.units):
                await ctx.emit_event(RunProblemData(message=f"{label} {number}"))

        await asyncio.gather(burst("a"), burst("b"))
        return RunOutcome()

    async def capped(ctx: RunContext[FakeParams]) -> RunOutcome:
        state.contexts.append(ctx)
        await ctx.emit_event(
            CapReachedData(kind="run_cost", detail="The run reached its limit of US$5.00")
        )
        return RunOutcome(stop_reason="The run cap was reached")

    async def checkpointed(ctx: RunContext[FakeParams]) -> RunOutcome:
        from langgraph.graph import END, START, StateGraph

        state.contexts.append(ctx)

        def add_one(counter: CounterState) -> CounterState:
            return {"n": counter["n"] + 1}

        builder = StateGraph(CounterState)
        # mypy does not see a TypedDict's key attributes, so it can't match any overload.
        builder.add_node("add_one", cast(Any, add_one))
        builder.add_edge(START, "add_one")
        builder.add_edge("add_one", END)
        graph = builder.compile(checkpointer=ctx.checkpointer)
        await graph.ainvoke({"n": 1}, {"configurable": {"thread_id": str(ctx.run_id)}})
        state.entered.set()
        if ctx.params.ending == "fail":
            raise RuntimeError("after the checkpoint")
        if ctx.params.ending == "wait":
            await state.gate.wait()
        return RunOutcome()

    async def estimate(ctx: EstimateContext[FakeParams]) -> RunEstimate:
        return RunEstimate(valid=True)

    def caps_override(params: FakeParams) -> CapsOverride:
        return CapsOverride(run_cap_usd=params.run_cap_usd, max_companies=params.max_companies)

    def versions_of(rules: str, prompts: str) -> Callable[[], RunVersions]:
        return lambda: RunVersions(rules=rules, prompts=prompts)

    def check(params: FakeParams, settings: Any, caps: RunCaps) -> None:
        if params.too_big:
            raise Problem(
                422,
                "Some fields need a fix",
                "Too big for the settings.",
                code="discovery_too_large",
                errors=[{"field": "body.params.units", "message": "too many"}],
            )

    handlers: dict[str, Callable[[RunContext[Any]], Awaitable[RunOutcome]]] = {
        "work": work,
        "block": block,
        "down": down,
        "boom": boom,
        "many": many,
        "capped": capped,
        "checkpointed": checkpointed,
    }
    kinds: dict[KindKey, RunKind[Any]] = {}
    for mode, handler in handlers.items():
        kinds[(APP, mode)] = RunKind(
            mode=mode,
            title=f"Fake {mode}",
            params_model=FakeParams,
            handler=handler,
            estimate=estimate,
            check=check,
            caps_override=caps_override,
            versions=lambda: RunVersions(rules="rules-fake", prompts="prompts-fake"),
        )
    # A kind whose versions come from its params would need the params; the long-text test
    # uses this one instead, with fixed long texts.
    kinds[(APP, "long")] = RunKind(
        mode="long",
        title="Fake long versions",
        params_model=FakeParams,
        handler=work,
        estimate=estimate,
        versions=versions_of("r" * 100, "p" * 300),
    )
    return kinds


# --- Helpers that read the database ----------------------------------------------------------


async def wait_until(
    check: Callable[[], Awaitable[bool]],
    timeout: float = 10.0,  # noqa: ASYNC109  (a polling helper: it does the waiting itself)
    interval: float = 0.02,
) -> None:
    """Polls `check` until it is true. Fails the test (with a plain message) on a timeout."""
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        if await check():
            return
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError(f"not true after {timeout} seconds: {check}")
        await asyncio.sleep(interval)


async def run_row(factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID) -> Run:
    async with factory() as session:
        row = await session.get(Run, run_id, populate_existing=True)
    assert row is not None, f"no run {run_id}"
    return row


async def wait_for_status(
    factory: async_sessionmaker[AsyncSession],
    run_id: uuid.UUID,
    *statuses: str,
    timeout: float = 10.0,  # noqa: ASYNC109  (a polling helper: it does the waiting itself)
) -> Run:
    """Waits until the run's saved status is one of `statuses`, and returns the row."""

    async def reached() -> bool:
        return (await run_row(factory, run_id)).status in statuses

    await wait_until(reached, timeout)
    return await run_row(factory, run_id)


async def wait_until_idle(
    manager: Any,
    timeout: float = 10.0,  # noqa: ASYNC109  (a polling helper: it does the waiting itself)
) -> None:
    """Waits until the manager has no run going (every slot is free)."""

    async def idle() -> bool:
        return not manager.active_run_ids

    await wait_until(idle, timeout)


async def stored_events(
    factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> list[RunEvent]:
    """The saved events of a run, as typed events, the way the log and the replay build them."""
    from datetime import UTC

    async with factory() as session:
        rows = (
            await session.scalars(
                select(RunEventRow).where(RunEventRow.run_id == run_id).order_by(RunEventRow.seq)
            )
        ).all()
    return [build_event(r.seq, r.type, r.data, r.created_at.astimezone(UTC)) for r in rows]


async def stored_json(
    factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> list[dict[str, Any]]:
    return [dump_event(event) for event in await stored_events(factory, run_id)]


async def event_types(factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID) -> list[str]:
    return [event.type for event in await stored_events(factory, run_id)]


async def searches_total(
    factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> tuple[Decimal, int, int]:
    """(SUM cost, SUM web searches, COUNT) of the search log rows of a run."""
    async with factory() as session:
        row = (
            await session.execute(
                select(
                    func.coalesce(func.sum(SearchLog.cost_usd), 0),
                    func.coalesce(func.sum(SearchLog.web_searches), 0),
                    func.count(),
                ).where(SearchLog.run_id == run_id)
            )
        ).one()
    return Decimal(row[0]), int(row[1]), int(row[2])


async def assert_totals_match_log(
    factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID
) -> Run:
    """The run's saved totals equal what the search log says (the invariant of the design)."""
    row = await run_row(factory, run_id)
    cost, searches, requests = await searches_total(factory, run_id)
    assert (row.cost_usd, row.web_searches, row.claude_requests) == (cost, searches, requests)
    return row
