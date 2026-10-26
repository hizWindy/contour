"""The types a project uses to plug a kind of run into the engine.

A project lists its run kinds in `AppSpec.run_kinds`. Each `RunKind` names a mode (like
`discovery`), the model its `params` are checked against, the handler that does the work, and
the function that estimates the cost. The run manager (`core.runs.manager`) calls them.

A handler gets a `RunContext`: everything one run needs, and nothing global. The manager never
reaches for the database engine, the Claude client or the embedder by itself, and neither
should a handler: it uses `ctx.session()`, `ctx.claude` and `ctx.embedder`. That keeps a run
testable with fakes.

Three small hooks on `RunKind` let the manager fill what only the project knows, without
guessing at the params model: `check` (values that depend on settings), `caps_override` (limits a
person chose for this run) and `versions` (the rules and prompt versions the run uses).
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from decimal import ROUND_DOWN, Decimal
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.claude.client import Claude, Reply
from core.config import Settings
from core.memory.embedder import Embedder
from core.runs.budget import RunBudget
from core.runs.schemas import (
    ProgressData,
    RunCaps,
    RunCounts,
    RunEstimate,
    RunEvent,
    event_type_of,
)

if TYPE_CHECKING:
    # Only for the type. Importing LangGraph here would load it before tracing is switched off.
    from langgraph.checkpoint.base import BaseCheckpointSaver

DEFAULT_COMPANY_USD = Decimal("1.00")  # TBC: until there are 5 finished companies to average
DEFAULT_SLICE_USD = Decimal("0.40")  # TBC: until there are 5 finished slices to average
CENT = Decimal("0.01")

type KindKey = tuple[str, str]  # (app name, mode)


@dataclass
class RunTotals:
    """Live counters for one run. They start at zero, or at the logged totals on a resume.

    `add_reply` is the `on_spend` hook for the per-company budget: it runs as each Claude reply
    arrives. When the run ends, and when it resumes, the totals are rebuilt from the database
    (`core.searches` and the leads of the run), so a cancel or a crash can't lose or double
    count cost.
    """

    cost_usd: Decimal = Decimal(0)
    web_searches: int = 0
    claude_requests: int = 0
    counts: RunCounts = field(default_factory=RunCounts)

    def add_reply(self, reply: Reply[Any]) -> None:
        self.cost_usd += reply.cost_usd
        self.web_searches += reply.usage.web_searches
        self.claude_requests += 1

    def progress(self) -> ProgressData:
        """A copy of the totals as the `progress` event."""
        return ProgressData(
            cost_usd=self.cost_usd,
            web_searches=self.web_searches,
            claude_requests=self.claude_requests,
            counts=self.counts.model_copy(deep=True),
        )


@dataclass(frozen=True)
class RunOutcome:
    """What a handler returns when it finishes normally. The run ends `done`."""

    stop_reason: str | None = None  # plain words, when the run stopped early (a cap, say)


class EmitFn(Protocol):
    """Saves an event and sends it to everyone watching. `data` must be the model for `type`."""

    async def __call__(self, type: str, data: BaseModel) -> None: ...


async def emit_event(emit: EmitFn, data: BaseModel) -> None:
    """Emit `data` as the event of its own model, so the type can't be mistyped or mismatched.

    `await emit_event(ctx.emit, PlanReadyData(...))` is `emit("plan_ready", PlanReadyData(...))`.
    Raises TypeError when `data` is not one of the event data models. The string form,
    `emit(type, data)`, stays for tests and for a caller that has the type as text.
    """
    await emit(event_type_of(data), data)


@dataclass(frozen=True)
class RunVersions:
    """The versions a run was made with, saved in the run row and shown on the run.

    `rules` is the fingerprint of the project's rules files (at most 32 characters). `prompts`
    lists the prompt versions the run's steps use (at most 128 characters), like
    "research 1a2b3c, extract 4d5e6f".
    """

    rules: str = ""
    prompts: str = ""


@dataclass(frozen=True)
class CapsOverride:
    """Limits a person chose for one run. None means "use the settings' limit".

    An override can only LOWER a limit. `make_caps` ignores a value above the settings.
    """

    run_cap_usd: Decimal | None = None
    max_companies: int | None = None


def make_caps(settings: Settings, override: CapsOverride | None = None) -> RunCaps:
    """The caps a run starts with, from the effective settings and what the person chose.

    Both `POST /runs` and `POST /runs/estimate` use this, so the estimate shows the cap the run
    would really get. The discovery cap is the discovery share of the (lowered) run cap, in whole
    cents rounded down. One company can never cost more than the whole run.
    """
    run_cap = settings.run_cap_usd
    max_companies = settings.run_max_companies
    if override is not None:
        if override.run_cap_usd is not None:
            run_cap = min(run_cap, override.run_cap_usd)
        if override.max_companies is not None:
            max_companies = min(max_companies, override.max_companies)
    discovery = (run_cap * Decimal(str(settings.discovery_share))).quantize(
        CENT, rounding=ROUND_DOWN
    )
    return RunCaps(
        run_cap_usd=run_cap,
        max_companies=max_companies,
        company_cap_usd=min(settings.company_cap_usd, run_cap),
        discovery_cap_usd=discovery,
    )


@dataclass
class RunContext[P: BaseModel]:
    """Everything a handler needs for one run."""

    run_id: uuid.UUID
    app: str
    mode: str
    params: P  # already checked against the kind's params_model
    settings: Settings  # the effective settings when the run started
    caps: RunCaps
    rules_version: str  # from the kind's `versions` (empty if it has none)
    prompt_versions: str  # the same
    resume: bool  # True when this is a resume: continue from the checkpoint
    session_factory: async_sessionmaker[AsyncSession]
    claude: Claude
    embedder: Embedder
    checkpointer: "BaseCheckpointSaver[Any]"
    emit: EmitFn
    cancelled: asyncio.Event  # set when a person asks to stop
    totals: RunTotals
    budget: RunBudget
    research_gate: asyncio.Semaphore  # size run_company_concurrency, made once for the run
    discover_gate: asyncio.Semaphore  # size run_discover_concurrency, made once for the run

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """A NEW session on every use. One session is never shared by two tasks.

        Never hold one while waiting for the Claude gate or a semaphore.
        """
        async with self.session_factory() as session:
            yield session

    async def emit_event(self, data: BaseModel) -> None:
        """`emit` for the model's own event type: `await ctx.emit_event(MergedData(...))`."""
        await emit_event(self.emit, data)


@dataclass(frozen=True)
class UnitCosts:
    """What one company and one slice usually cost, for estimates."""

    company_usd: Decimal = DEFAULT_COMPANY_USD
    slice_usd: Decimal = DEFAULT_SLICE_USD
    company_samples: int = 0  # how many finished companies the average has. 0: the default.
    slice_samples: int = 0

    @property
    def from_history(self) -> bool:
        return self.company_samples > 0 or self.slice_samples > 0


@dataclass(frozen=True)
class EstimateContext[P: BaseModel]:
    """What an estimate function gets. It never starts a run and never calls Claude."""

    app: str
    mode: str
    params: P  # already checked against the kind's params_model
    settings: Settings  # the effective settings now
    caps: RunCaps  # the caps this run would get
    daily_left_usd: Decimal
    unit_costs: UnitCosts
    session_factory: async_sessionmaker[AsyncSession]

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.session_factory() as session:
            yield session


type RunHandler[P: BaseModel] = Callable[[RunContext[P]], Awaitable[RunOutcome]]
type EstimateFn[P: BaseModel] = Callable[[EstimateContext[P]], Awaitable[RunEstimate]]
# Checks values that depend on settings (like discovery_too_large). Raises Problem(422, ...).
# Pure: no await and no database. The manager calls it at start, the estimate route after it.
type CheckFn[P: BaseModel] = Callable[[P, Settings, RunCaps], None]
# The limits the person chose in the params (like `params.caps`). Pure: no await, no database.
type CapsOverrideFn[P: BaseModel] = Callable[[P], CapsOverride]
# The versions this kind of run uses right now. Pure and quick: it only reads loaded files.
type VersionsFn = Callable[[], RunVersions]


@dataclass(frozen=True)
class RunKind[P: BaseModel]:
    """One kind of run a project offers.

    The three optional hooks have a fixed meaning, so the manager never reaches into `params`:
    - `check(params, settings, caps)` raises a 422 `Problem` for a value that is fine by itself
      but too big for the settings. The manager calls it at start, and the estimate calls it too.
    - `caps_override(params)` gives the person's own limits. The manager and the estimate pass
      the result to `make_caps`. Without it the run gets the settings' limits.
    - `versions()` gives the rules and prompt versions. The manager saves them in the run row
      (`rules_version`, `prompt_versions`), puts them in `run_started` and in the `RunContext`.
      Without it they are empty text.
    """

    mode: str  # like "discovery"
    title: str  # shown to people, like "Find new leads"
    params_model: type[P]
    handler: RunHandler[P]
    estimate: EstimateFn[P]
    check: CheckFn[P] | None = None
    caps_override: CapsOverrideFn[P] | None = None
    versions: VersionsFn | None = None


# --- What the manager is built from -------------------------------------------------------

type ClaudeProvider = Callable[[], Claude]  # raises ClaudeUnavailable (no key, bad key)
type SettingsProvider = Callable[[], Awaitable[Settings]]  # the effective settings, right now


class CheckpointerSource(Protocol):
    """Gives the LangGraph saver, and closes its connection pool at shutdown.

    The pool is made lazily inside the running event loop, so a database that is down at
    start-up is not fatal. `get` raises when it can't be made, and the API answers 503.
    """

    async def get(self) -> "BaseCheckpointSaver[Any]": ...

    async def close(self, seconds: float = 5) -> None: ...


class EventStream(AsyncIterator[RunEvent], Protocol):
    """A live view of one run's events, already registered when `subscribe` returns it.

    It is registered before the first `__anext__`, so an event that happens while the response is
    still being built is not lost. A caller that stops early (the browser left) must call
    `aclose()`, which unregisters it. That also holds when it never read an event, so a stream
    that was made and dropped can't use up a watcher slot.
    """

    async def aclose(self) -> None: ...
