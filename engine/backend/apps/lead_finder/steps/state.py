"""What a Lead Finder run carries from step to step.

`State` is the graph's state. It is saved in a checkpoint after each step, so it holds only JSON
values: dumps of `Slice`, `Found` and `Merged`, and `CompanyTask` dicts. `RunCtx` is what every
step gets alongside (LangGraph's run context): the engine's `RunContext` and the rules. It is
never saved; a resume makes a new one.
"""

import asyncio
import logging
import operator
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, NotRequired, TypedDict

from sqlalchemy import func, select

from apps.lead_finder.context import CreditMeter, Focus, Origin, Signal
from apps.lead_finder.rules import LeadFinderRules
from core.runs.budget import RunBudget
from core.runs.schemas import CapKind, CapReachedData
from core.runs.types import RunContext
from core.searches.models import SearchLog

DISCOVER_STEP = "discover"  # the step every discovery request is logged under

log = logging.getLogger(__name__)


class CompanyTask(TypedDict):
    """One company to research. JSON only, so it can sit in a checkpoint."""

    name: str  # the name to research (and the lead's company_key)
    city: str | None
    website: str | None
    origin: Origin
    hubspot_id: str | None  # set by the watchlist: the company is already known
    is_test: bool
    recheck: bool  # search again even when memory is fresh
    signals: list[dict[str, Any]]  # `Signal` fields, from discovery
    today: str  # the run's day, YYYY-MM-DD
    # What the research asks first (PLAN-V11 C2). Missing: growth, today's research.
    focus: NotRequired[Focus]


class SliceTask(TypedDict):
    """One discovery search: a `Slice` dump and the run's day."""

    slice: dict[str, Any]
    today: str


class State(TypedDict):
    mode: str
    today: str  # fixed for the whole run, so a resume judges dates the same way
    known: list[CompanyTask]  # the companies of a watchlist, company or testset run
    slices: NotRequired[list[dict[str, Any]]]  # the slices of the sweep running now
    candidates: NotRequired[Annotated[list[dict[str, Any]], operator.add]]  # from every slice
    merged: NotRequired[list[dict[str, Any]]]
    chosen: NotRequired[list[CompanyTask]]
    goal: NotRequired[int | None]  # an automatic run's share of the round's goal, from `plan`
    outcomes: NotRequired[Annotated[list[dict[str, Any]], operator.add]]  # one per company
    # PLAN-V21 T1-4: the sweep running now (1 to 4), whether `choose` found the run short of its
    # target with a sweep and money left, and what `choose` left out, for `settle` to say once:
    # {"skipped": [[name, reason], ...], "over": count, "chosen_keys": [key, ...]}
    sweep: NotRequired[int]
    more: NotRequired[bool]
    decision: NotRequired[dict[str, Any]]


def signals_of(task: CompanyTask) -> tuple[Signal, ...]:
    return tuple(Signal(**signal) for signal in task["signals"])


def day_of(text: str) -> date:
    return date.fromisoformat(text)


@dataclass
class RunCtx:
    """Everything a step needs that is not saved in the state."""

    run: RunContext[Any]
    rules: LeadFinderRules
    # The Signal Hire company credits the run may spend, shared by its companies (PLAN-V4 C1)
    signalhire_credits: CreditMeter = field(default_factory=lambda: CreditMeter(0))
    stop_reason: str | None = None  # set when a cap stops the run; later work is skipped
    _caps_reported: set[str] = field(default_factory=set)
    # Discovery's share of the run's money (PLAN-V21 T1-4): a budget of its own, so a later sweep
    # stops at the share and never takes the research's money. Built on first use from what the
    # run's discovery requests already cost (the search log), so a resume starts from the truth.
    _discovery: RunBudget | None = None
    _discovery_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def discovery_budget(self) -> RunBudget:
        async with self._discovery_lock:
            if self._discovery is None:
                ctx = self.run
                async with ctx.session() as session:
                    spent = await session.scalar(
                        select(func.coalesce(func.sum(SearchLog.cost_usd), 0)).where(
                            SearchLog.run_id == ctx.run_id,
                            SearchLog.step.startswith(DISCOVER_STEP, autoescape=True),
                        )
                    )
                self._discovery = RunBudget(
                    ctx.caps.discovery_cap_usd, 0, spent=Decimal(spent or 0)
                )
            return self._discovery

    async def stop(self, kind: CapKind, detail: str) -> None:
        """A cap is reached: say so once (`cap_reached`), and skip the work that is left."""
        if self.stop_reason is None:
            self.stop_reason = detail
        if kind not in self._caps_reported:
            self._caps_reported.add(kind)
            await self.run.emit_event(CapReachedData(kind=kind, detail=detail))
