"""The Lead Finder's kinds of run: discovery, watchlist, company and testset.

Each kind names its params model (apps/lead_finder/params.py), its handler and its cost
estimate. The handlers and estimates are stubs: package B3b writes the handlers (the graph and
the research step), and the estimates come with the run options. Until then they raise
NotImplementedError, and no run manager exists to call them.

Two hooks are filled in for every kind, because only this project knows the answer:
- `caps_override` reads the limits a person chose (`params.caps`);
- `versions` gives the rules version and the prompt versions.
`check` is empty. Package B3a adds the discovery size check here (422 `discovery_too_large`).
"""

from typing import Any

from apps.lead_finder import prompts
from apps.lead_finder.params import (
    CompanyParams,
    DiscoveryParams,
    TestsetParams,
    WatchlistParams,
)
from apps.lead_finder.rules import load_rules
from core.runs.schemas import RunEstimate
from core.runs.types import (
    CapsOverride,
    EstimateContext,
    RunContext,
    RunKind,
    RunOutcome,
    RunVersions,
)

# Watchlist runs send HubSpot company names to Claude, so they wait for Levi's OK
# (the `hubspot_names_to_claude_ok` switch in engine/.env). TBC.
MODES_NEEDING_APPROVAL = frozenset({"watchlist"})


type AnyParams = DiscoveryParams | WatchlistParams | CompanyParams | TestsetParams


def caps_override(params: AnyParams) -> CapsOverride:
    """The limits the person chose for this run. Every mode has `params.caps`."""
    return CapsOverride(
        run_cap_usd=params.caps.run_cap_usd, max_companies=params.caps.max_companies
    )


def run_versions() -> RunVersions:
    """The rules version and the prompt versions a run uses. The discover prompt (package B3a)
    joins the prompt versions when it exists."""
    rules = load_rules()
    return RunVersions(rules=rules.version, prompts=prompts.versions(rules))


async def run_discovery(ctx: RunContext[DiscoveryParams]) -> RunOutcome:
    raise NotImplementedError


async def run_watchlist(ctx: RunContext[WatchlistParams]) -> RunOutcome:
    raise NotImplementedError


async def run_company(ctx: RunContext[CompanyParams]) -> RunOutcome:
    raise NotImplementedError


async def run_testset(ctx: RunContext[TestsetParams]) -> RunOutcome:
    raise NotImplementedError


async def estimate_discovery(ctx: EstimateContext[DiscoveryParams]) -> RunEstimate:
    raise NotImplementedError


async def estimate_watchlist(ctx: EstimateContext[WatchlistParams]) -> RunEstimate:
    raise NotImplementedError


async def estimate_company(ctx: EstimateContext[CompanyParams]) -> RunEstimate:
    raise NotImplementedError


async def estimate_testset(ctx: EstimateContext[TestsetParams]) -> RunEstimate:
    raise NotImplementedError


RUN_KINDS: tuple[RunKind[Any], ...] = (
    RunKind(
        mode="discovery",
        title="Find new leads",
        params_model=DiscoveryParams,
        handler=run_discovery,
        estimate=estimate_discovery,
        caps_override=caps_override,
        versions=run_versions,
    ),
    RunKind(
        mode="watchlist",
        title="Research the HubSpot watchlist",
        params_model=WatchlistParams,
        handler=run_watchlist,
        estimate=estimate_watchlist,
        caps_override=caps_override,
        versions=run_versions,
    ),
    RunKind(
        mode="company",
        title="Research companies by name",
        params_model=CompanyParams,
        handler=run_company,
        estimate=estimate_company,
        caps_override=caps_override,
        versions=run_versions,
    ),
    RunKind(
        mode="testset",
        title="Run the test set",
        params_model=TestsetParams,
        handler=run_testset,
        estimate=estimate_testset,
        caps_override=caps_override,
        versions=run_versions,
    ),
)
