"""An in-memory `RunContext` for tests of run handlers and graph steps. No database, no Claude.

    harness = make_run_context(DiscoveryParams(), claude=FakeClaude())
    outcome = await run_handler(harness.ctx)
    harness.events.assert_order("run_started", "plan_ready", "run_finished")

What it builds, so a handler is tested the way the manager would run it:
- `emit` is a fake that checks every event through the typed event union (`build_event`) and
  through a JSON round trip, then keeps it. An event with the wrong data model, an unknown type
  or data that is not JSON fails the test at the call, not later.
- `budget` is a real `RunBudget` made from the caps (`make_caps`, as the manager does).
- `research_gate` and `discover_gate` are real semaphores sized from the settings.
- `cancelled` is a real event. `harness.cancel()` sets it.
- `session_factory`, `claude`, `embedder` and `checkpointer` can be passed in. Left out, the first
  three are stand-ins that FAIL THE TEST when used (a handler that touches the database or calls
  Claude must be given one on purpose). The checkpointer is a real in-memory LangGraph saver.

The manager's own work (rows, locks, subscribers) is not here: this is for what a handler does.
"""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, NoReturn, cast

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.claude.client import Claude, Reply, WebTools
from core.config import Settings
from core.memory.embedder import Embedder
from core.runs.budget import RunBudget
from core.runs.schemas import RunEvent, build_event, dump_event
from core.runs.types import (
    CapsOverride,
    RunContext,
    RunOutcome,
    RunTotals,
    make_caps,
)

# --- Stand-ins that fail the test when they are used -----------------------------------------


def _unused(what: str) -> NoReturn:
    raise AssertionError(
        f"This test used {what}, but the run harness has none. "
        f"Pass your own to make_run_context(...)."
    )


class UnusedSessionFactory:
    """Calling it (as `ctx.session()` does) fails the test: there is no database here."""

    def __call__(self, *args: Any, **kwargs: Any) -> NoReturn:
        _unused("the database (ctx.session())")


class UnusedClaude:
    """Asking it fails the test: there is no Claude here."""

    async def ask[T: BaseModel](
        self,
        *,
        system: str,
        prompt: str,
        form: type[T],
        web: WebTools | None = None,
        model: str | None = None,
        effort: str | None = None,
        max_continues: int | None = None,
    ) -> Reply[T]:
        _unused("Claude (ctx.claude.ask)")


class UnusedEmbedder(Embedder):
    """Embedding with it fails the test. It never loads the real model."""

    def __init__(self) -> None:
        super().__init__("unused", Path("unused"))

    def _load(self) -> NoReturn:
        _unused("the embedder (ctx.embedder)")


# --- The events a run emitted ----------------------------------------------------------------


class Recorder:
    """The fake `emit`. Keeps every event, typed, in the order they were emitted.

    An event is checked on the way in: its data model must match its type (`build_event`), and
    it must survive `dump_event` as plain JSON, the same JSON the stream and the log send.
    """

    def __init__(self) -> None:
        self.events: list[RunEvent] = []

    async def emit(self, type: str, data: BaseModel) -> None:
        # No await between the count and the append: two tasks never get the same seq.
        seq = len(self.events) + 1
        event = build_event(seq, type, data, datetime.now(UTC))
        json.dumps(dump_event(event))  # fails here if the data can't be written as JSON
        self.events.append(event)

    def __len__(self) -> int:
        return len(self.events)

    @property
    def types(self) -> list[str]:
        """The event types in order, like ["run_started", "plan_ready", ...]."""
        return [event.type for event in self.events]

    def of_type(self, type: str) -> list[RunEvent]:
        return [event for event in self.events if event.type == type]

    def data_of(self, type: str) -> list[BaseModel]:
        """The data models of every event of a type, in order."""
        return [event.data for event in self.of_type(type)]

    def count(self, type: str) -> int:
        return len(self.of_type(type))

    def assert_seqs_are_in_order(self) -> None:
        """The events are numbered 1, 2, 3 ... with no gap and no repeat."""
        seqs = [event.seq for event in self.events]
        assert seqs == list(range(1, len(seqs) + 1)), f"seq is not 1..N: {seqs}"

    def assert_exactly(self, *types: str) -> None:
        """The run emitted exactly these types, in this order, and nothing else."""
        assert self.types == list(types), f"events were {self.types}, expected {list(types)}"

    def assert_order(self, *types: str) -> None:
        """These types appear in this order. Other events may sit between them.

        Each one is looked for after the one before it, so ["run_started", "run_finished"] fails
        when the run finished first.
        """
        position = 0
        found = self.types
        for wanted in types:
            try:
                position = found.index(wanted, position) + 1
            except ValueError:
                raise AssertionError(
                    f"expected {wanted!r} after position {position} in {found}"
                ) from None

    def assert_before(self, first: str, second: str) -> None:
        """Every event of type `first` comes before every event of type `second`.

        Both types must be there at least once, so a typo can't make this pass.
        """
        found = self.types
        assert first in found, f"no {first!r} event in {found}"
        assert second in found, f"no {second!r} event in {found}"
        last_first = max(i for i, name in enumerate(found) if name == first)
        first_second = min(i for i, name in enumerate(found) if name == second)
        assert last_first < first_second, f"{first!r} is not always before {second!r}: {found}"

    def assert_last(self, type: str) -> None:
        """The last event is this type (for example `run_finished`: nothing comes after it)."""
        assert self.events, "no events were emitted"
        assert self.types[-1] == type, f"the last event is {self.types[-1]!r}, not {type!r}"

    def assert_never(self, type: str) -> None:
        assert type not in self.types, f"a {type!r} event was emitted: {self.types}"


# --- The harness -----------------------------------------------------------------------------


@dataclass
class RunHarness[P: BaseModel]:
    ctx: RunContext[P]
    events: Recorder
    settings: Settings = field(repr=False)

    def cancel(self) -> None:
        """What `RunManager.cancel` does to the context: a person asked to stop."""
        self.ctx.cancelled.set()

    async def run(self, handler: Callable[[RunContext[P]], Awaitable[RunOutcome]]) -> RunOutcome:
        """Runs a handler with this context and returns what it returns."""
        return await handler(self.ctx)


def make_run_context[P: BaseModel](
    params: P,
    *,
    app: str = "lead_finder",
    mode: str = "discovery",
    settings: Settings | None = None,
    settings_overrides: dict[str, Any] | None = None,
    caps_override: CapsOverride | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    claude: Claude | None = None,
    embedder: Embedder | None = None,
    checkpointer: Any | None = None,
    run_id: uuid.UUID | None = None,
    resume: bool = False,
    spent: Decimal = Decimal(0),
    companies_started: int = 0,
    rules_version: str = "rules-test",
    prompt_versions: str = "prompts-test",
) -> RunHarness[P]:
    """A `RunContext` for `params`, and the recorder of its events.

    `settings` are the effective settings (default: the defaults, never the developer's own
    .env file), and `settings_overrides` change some of them (like `run_cap_usd=Decimal("5")`
    or `run_company_concurrency=1`). `caps_override` plays the person's own limits, as the
    kind's `caps_override` hook gives them. `spent` and `companies_started` start the budget
    where a resume would. `checkpointer` can be any saver; the default is LangGraph's in-memory
    one, made fresh for each context.
    """
    if settings is None:
        settings = Settings(_env_file=None, **(settings_overrides or {}))
    elif settings_overrides:
        settings = settings.model_copy(update=settings_overrides)
    caps = make_caps(settings, caps_override)

    if checkpointer is None:
        from core.runtime import disable_tracing

        disable_tracing()  # before LangGraph is imported, as everywhere else
        from langgraph.checkpoint.memory import InMemorySaver

        checkpointer = InMemorySaver()

    recorder = Recorder()
    ctx = RunContext(
        run_id=run_id or uuid.uuid4(),
        app=app,
        mode=mode,
        params=params,
        settings=settings,
        caps=caps,
        rules_version=rules_version,
        prompt_versions=prompt_versions,
        resume=resume,
        session_factory=session_factory or cast(Any, UnusedSessionFactory()),
        claude=claude or UnusedClaude(),
        embedder=embedder or UnusedEmbedder(),
        checkpointer=checkpointer,
        emit=recorder.emit,
        cancelled=asyncio.Event(),
        totals=RunTotals(),
        budget=RunBudget(
            caps.run_cap_usd, caps.max_companies, spent=spent, companies_started=companies_started
        ),
        research_gate=asyncio.Semaphore(settings.run_company_concurrency),
        discover_gate=asyncio.Semaphore(settings.run_discover_concurrency),
    )
    return RunHarness(ctx=ctx, events=recorder, settings=settings)
