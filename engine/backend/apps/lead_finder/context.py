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
OnReply = Callable[[Reply[Any]], None]  # called as each Claude reply arrives


@dataclass(frozen=True)
class Signal:
    """What discovery learned about a company: a sign of an office change, and where it is."""

    trigger_id: str
    what_happened: str  # one line, in Claude's words
    url: str  # a page the search tools returned
    date: str | None = None  # when it happened, YYYY-MM-DD or YYYY-MM
    published: str | None = None  # when the page was published


@dataclass(frozen=True)
class StepModels:
    """The model for each kind of step. None means the default Claude model."""

    discover: str | None = None
    search: str | None = None
    extract: str | None = None


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
