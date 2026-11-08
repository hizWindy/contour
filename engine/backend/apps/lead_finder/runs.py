"""The Lead Finder's kinds of run: discovery, watchlist, company and testset.

Each kind names its params model (apps/lead_finder/params.py), its handler, its cost estimate and
three hooks the run manager calls:
- `check`: refuses a run before it starts. Discovery checks its size (422 `discovery_too_large`).
  The watchlist checks Levi's OK to send HubSpot names to Claude (409
  `hubspot_names_not_approved`); the estimate shows that one as `blocked`, not as an error.
- `caps_override`: the limits a person chose (`params.caps`).
- `versions`: the rules version and the prompt versions.

Every handler runs the same graph (steps/graph.py). Discovery finds its companies on the web; the
other modes hand the graph the companies they already know. Nothing here calls Claude or reads
anything outside the run context, so a run is testable with a fake Claude.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder import prompts
from apps.lead_finder.params import (
    CompanyParams,
    DiscoveryParams,
    TestsetParams,
    WatchlistParams,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.run_email import run_finished
from apps.lead_finder.steps.discover import MAX_CANDIDATES
from apps.lead_finder.steps.plan import check_discovery_size, make_slices
from apps.lead_finder.steps.state import CompanyTask
from apps.lead_finder.testing import load_testset
from apps.lead_finder.watchlist import load_watchlist
from core.api.errors import Problem
from core.config import Settings
from core.hubspot.models import HubSpotCompany
from core.runs.schemas import Blocked, RunCaps, RunEstimate, RunOut
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
NOT_APPROVED_CODE = "hubspot_names_not_approved"
NOT_APPROVED_TITLE = "HubSpot names aren't approved yet"
NOT_APPROVED_DETAIL = (
    "This run sends the names of HubSpot companies to Claude, which waits for Levi's OK. "
    "Once he agrees, set HUBSPOT_NAMES_TO_CLAUDE_OK=true in engine/.env and restart."
)

type AnyParams = DiscoveryParams | WatchlistParams | CompanyParams | TestsetParams


def caps_override(params: AnyParams) -> CapsOverride:
    """The limits the person chose for this run. Every mode has `params.caps`."""
    return CapsOverride(
        run_cap_usd=params.caps.run_cap_usd, max_companies=params.caps.max_companies
    )


def run_versions() -> RunVersions:
    """The rules version and the prompt versions a run uses (research, extract, discover)."""
    rules = load_rules()
    return RunVersions(rules=rules.version, prompts=prompts.run_versions(rules))


def not_approved() -> Problem:
    return Problem(409, NOT_APPROVED_TITLE, NOT_APPROVED_DETAIL, code=NOT_APPROVED_CODE)


# --- Checks ----------------------------------------------------------------------------------


def check_discovery(params: DiscoveryParams, settings: Settings, caps: RunCaps) -> None:
    check_discovery_size(params, settings, caps)


def check_watchlist(params: WatchlistParams, settings: Settings, caps: RunCaps) -> None:
    if not settings.hubspot_names_to_claude_ok:
        raise not_approved()


# --- The companies a run already knows --------------------------------------------------------


def _task(
    name: str,
    city: str | None,
    website: str | None,
    today: str,
    *,
    origin: Any = "typed",
    hubspot_id: str | None = None,
    is_test: bool = False,
    recheck: bool = False,
) -> CompanyTask:
    return CompanyTask(
        name=name,
        city=city,
        website=website,
        origin=origin,
        hubspot_id=hubspot_id,
        is_test=is_test,
        recheck=recheck,
        signals=[],
        today=today,
    )


async def watchlist_tasks(ctx: RunContext[WatchlistParams], today: str) -> list[CompanyTask]:
    """The watchlist, most likely first (then the Director list when asked), up to `limit`.
    Only the name, the city and the domain go to Claude."""
    options = ctx.params.watchlist
    async with ctx.session() as session:
        found = await load_watchlist(
            session,
            load_rules(),
            include_unlikely=options.include_unlikely,
            include_director=options.include_director,
        )
        items = [*found.items, *found.director]
        if options.limit is not None:
            items = items[: options.limit]
        ids = [item.hubspot_id for item in items]
        domains = dict(
            (
                await session.execute(
                    select(HubSpotCompany.hubspot_id, HubSpotCompany.domain).where(
                        HubSpotCompany.hubspot_id.in_(ids)
                    )
                )
            ).all()
        )
    return [
        _task(
            item.name,
            item.city,
            domains.get(item.hubspot_id),
            today,
            origin="hubspot",
            hubspot_id=item.hubspot_id,
        )
        for item in items
    ]


def company_tasks(params: CompanyParams, today: str) -> list[CompanyTask]:
    return [
        _task(company.name, company.city, company.website, today, recheck=params.recheck)
        for company in params.companies
    ]


def testset_tasks(today: str) -> list[CompanyTask]:
    return [
        _task(company.name, company.city, company.website, today, is_test=True)
        for company in load_testset().companies
    ]


# --- Handlers ----------------------------------------------------------------------------------
# The graph module imports LangGraph, so it is imported when a run starts, not at start-up.


async def run_discovery(ctx: RunContext[DiscoveryParams]) -> RunOutcome:
    from apps.lead_finder.steps.graph import run_graph

    return await run_graph(ctx, [])


async def run_watchlist(ctx: RunContext[WatchlistParams]) -> RunOutcome:
    from apps.lead_finder.steps.graph import run_day, run_graph

    return await run_graph(ctx, await watchlist_tasks(ctx, run_day()))


async def run_company(ctx: RunContext[CompanyParams]) -> RunOutcome:
    from apps.lead_finder.steps.graph import run_day, run_graph

    return await run_graph(ctx, company_tasks(ctx.params, run_day()))


async def run_testset(ctx: RunContext[TestsetParams]) -> RunOutcome:
    from apps.lead_finder.steps.graph import run_day, run_graph

    return await run_graph(ctx, testset_tasks(run_day()))


# --- Estimates -----------------------------------------------------------------------------------
# `cost_usd_low` is a typical run (what past companies and slices cost on average); `cost_usd_high`
# the worst case (every request at its full hold). The engine adds the cap, today's limit and the
# warnings (core.runs.estimate.add_limits).


def _estimate(
    ctx: EstimateContext[Any],
    companies: int,
    slices: int = 0,
    blocked: Blocked | None = None,
    warnings: list[str] | None = None,
) -> RunEstimate:
    costs = ctx.unit_costs
    settings = ctx.settings
    researched = min(companies, ctx.caps.max_companies)
    low = slices * costs.slice_usd + researched * costs.company_usd
    high = slices * settings.slice_reserve_usd + researched * ctx.caps.company_cap_usd
    return RunEstimate(
        valid=True,
        blocked=blocked,
        warnings=warnings or [],
        slices=slices,
        companies_expected=companies,
        cost_usd_low=low,
        cost_usd_high=max(low, high),
    )


async def estimate_discovery(ctx: EstimateContext[DiscoveryParams]) -> RunEstimate:
    slices = len(make_slices(ctx.params, load_rules()))
    # A slice keeps at most 10 companies; how many it finds isn't known before the run.
    companies = min(ctx.caps.max_companies, slices * MAX_CANDIDATES)
    warnings = [
        f"Discovery searches {slices} city and trigger pairs, then researches up to "
        f"{companies} of the companies it finds. How many it finds isn't known in advance."
    ]
    return _estimate(ctx, companies, slices, warnings=warnings)


async def estimate_watchlist(ctx: EstimateContext[WatchlistParams]) -> RunEstimate:
    options = ctx.params.watchlist
    async with ctx.session() as session:
        found = await load_watchlist(
            session,
            load_rules(),
            include_unlikely=options.include_unlikely,
            include_director=options.include_director,
        )
    companies = len(found.items) + len(found.director)
    if options.limit is not None:
        companies = min(companies, options.limit)
    blocked = (
        None
        if ctx.settings.hubspot_names_to_claude_ok
        else Blocked(code=NOT_APPROVED_CODE, message=NOT_APPROVED_DETAIL)
    )
    warnings = [] if companies else ["The watchlist is empty. Upload a HubSpot export first."]
    return _estimate(ctx, companies, blocked=blocked, warnings=warnings)


async def estimate_company(ctx: EstimateContext[CompanyParams]) -> RunEstimate:
    return _estimate(ctx, len(ctx.params.companies))


async def estimate_testset(ctx: EstimateContext[TestsetParams]) -> RunEstimate:
    return _estimate(ctx, len(load_testset().companies))


async def email_when_finished(run: RunOut, session: AsyncSession, settings: Settings) -> None:
    """A scheduled discovery run emails its result when it ends (PLAN-V9 C2, `run_email.py`)."""
    await run_finished(run, session, settings)


RUN_KINDS: tuple[RunKind[Any], ...] = (
    RunKind(
        mode="discovery",
        title="Find new leads",
        params_model=DiscoveryParams,
        handler=run_discovery,
        estimate=estimate_discovery,
        check=check_discovery,
        caps_override=caps_override,
        versions=run_versions,
        finished=email_when_finished,  # PLAN-V9 C2: a scheduled run emails its result
    ),
    RunKind(
        mode="watchlist",
        title="Research the HubSpot watchlist",
        params_model=WatchlistParams,
        handler=run_watchlist,
        estimate=estimate_watchlist,
        check=check_watchlist,
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
