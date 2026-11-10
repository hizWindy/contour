"""What a research of one company is told about the run it belongs to.

`research_company` takes one of these. It carries the facts that are not part of the public
`ResearchRequest` (where the company came from, which HubSpot company it is, whether it is a
test), and the hooks of the run (the models to use, the sites never to read, what to do when
a reply arrives). A plain research from the API or the command line uses the defaults.

None of it comes from a web request: internal values such as `origin` and `hubspot_id` must
never be accepted from a caller.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from core.claude.client import Reply

Origin = Literal["typed", "web", "hubspot"]  # where the company name came from
# What the research looks for first. growth: signs of growth and change (property, people and
# money). tenure: the office questions first, for the lease and tenure run (PLAN-V11 C2).
Focus = Literal["growth", "tenure"]
OnReply = Callable[[Reply[Any]], None]  # called as each Claude reply arrives


@dataclass(frozen=True)
class Signal:
    """What discovery learned about a company: a sign of an office change, and where it is."""

    trigger_id: str
    what_happened: str  # one line, in Claude's words
    url: str  # a page the search tools returned
    date: str | None = None  # when it happened, YYYY-MM-DD or YYYY-MM
    published: str | None = None  # when the page was published


class CreditMeter:
    """The Signal Hire company credits a run may still spend (PLAN-V4 C1). A credit is taken before
    the paid call, and every company of a run shares one meter, so the run can't spend more than
    `signalhire_max_credits_per_run`. One event loop runs a run, so nothing needs a lock here."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    def take(self, credits: int = 1) -> bool:
        """Takes `credits` if that many are left. If not, takes nothing and says so."""
        if self.used + credits > self.limit:
            return False
        self.used += credits
        return True

    def give_back(self, credits: int = 1) -> None:
        self.used = max(0, self.used - credits)


@dataclass(frozen=True)
class StepModels:
    """The model for each kind of step. None means the default Claude model."""

    discover: str | None = None
    search: str | None = None
    extract: str | None = None
    why: str | None = None  # the Why now on the lead card (PLAN-V12 C2)


@dataclass(frozen=True)
class ResearchContext:
    run_id: uuid.UUID | None = None  # None when no run asked (the research endpoint, the CLI)
    origin: Origin = "typed"
    hubspot_id: str | None = None  # set by the watchlist: the company is already known
    is_test: bool = False  # a company from the test set
    signals: tuple[Signal, ...] = ()  # found by discovery. Saved to memory before research.
    on_reply: OnReply | None = None  # the run's live totals, updated as each reply arrives
    models: StepModels = StepModels()
    blocked_domains: tuple[str, ...] = ()  # sites the web tools never read. Empty: the rules' list
    company_cap_usd: Decimal | None = None  # the run's company cap. None: the settings' cap
    # The run's Signal Hire credits, shared by its companies. None: a research on its own gets
    # a meter of its own, set by the settings.
    signalhire_credits: CreditMeter | None = None
    focus: Focus = "growth"  # tenure: the lease and tenure run asks the office questions first
