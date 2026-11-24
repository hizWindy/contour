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

from dataclasses import replace
from datetime import UTC, datetime
from decimal import ROUND_DOWN, ROUND_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder import prompts
from apps.lead_finder.context import Focus
from apps.lead_finder.params import (
    CompanyParams,
    DiscoveryParams,
    TestsetParams,
    WatchlistOptions,
    WatchlistParams,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.run_email import run_finished
from apps.lead_finder.run_sources import (
    SOURCE_WORDS,
    check_sources,
    feed_candidates,
    picked_tools,
    web_only,
)
from apps.lead_finder.schemas import WatchItem
from apps.lead_finder.steps.discover import MAX_CANDIDATES
from apps.lead_finder.steps.plan import (
    check_discovery_size,
    make_slices,
    sweeps_for,
    web_picked,
)
from apps.lead_finder.steps.state import CompanyTask
from apps.lead_finder.testing import load_testset
from apps.lead_finder.watchlist import load_watchlist, most_staff_first
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
    "Once he agrees, an admin switches it on."
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


# The Run tab is for new leads only (PLAN-V27 choices 1 and 2). The HubSpot watchlist run, and Old
# offices (a watchlist run with the office questions first), are switched off, not deleted: set
# this to True to bring them back. Typed companies (`company`) stay for the lead card's Re-check.
WATCHLIST_RUNS_ON = False
# The run types the Start page offers (`modes` in the run options).
START_MODES = ("discovery",)
SWITCHED_OFF_CODE = "run_type_off"
SWITCHED_OFF_TITLE = "This run type is switched off"
SWITCHED_OFF_DETAIL = (
    "The Lead Finder finds new leads only, so this run type is switched off. Use Find new leads, "
    "or ask the Assistant to research one company."
)


def switched_off() -> Problem:
    return Problem(409, SWITCHED_OFF_TITLE, SWITCHED_OFF_DETAIL, code=SWITCHED_OFF_CODE)


# --- Checks ----------------------------------------------------------------------------------


def check_discovery(params: DiscoveryParams, settings: Settings, caps: RunCaps) -> None:
    check_sources(params, settings)  # a tool it names must be ready (PLAN-V16 T1-8)
    check_target(params, caps)
    check_discovery_size(params, settings, caps)


def check_target(params: DiscoveryParams, caps: RunCaps) -> None:
    """The target a person picked can't be above the run's company limit (PLAN-V21 T1-4): the
    limit is the ceiling. Left out, the target is the default, pulled down to the limit."""
    asked = params.target_companies
    if asked is None or asked <= caps.max_companies:
        return
    message = (
        f"Pick at most {caps.max_companies}: the run's company limit. Raise the limit first to "
        "research more."
    )
    raise Problem(
        422,
        "The target is above the company limit",
        message,
        code="target_above_limit",
        errors=[{"field": "body.params.target_companies", "message": message}],
    )


def check_watchlist(params: WatchlistParams, settings: Settings, caps: RunCaps) -> None:
    if not WATCHLIST_RUNS_ON:
        raise switched_off()
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
    focus: Focus = "growth",
) -> CompanyTask:
    task = CompanyTask(
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
    if focus != "growth":
        task["focus"] = focus
    return task


async def chosen_watchlist(session: AsyncSession, options: WatchlistOptions) -> list[WatchItem]:
    """The companies a watchlist run researches, in order: the watch list, most likely first,
    then the Director list when asked, in the chosen city and industries (PLAN-V11 C2). A lease
    and tenure run takes the most staff first. At most `limit`. Local only: no Claude."""
    found = await load_watchlist(
        session,
        load_rules(),
        include_unlikely=options.include_unlikely,
        include_director=options.include_director,
        city=options.city,
        industries=options.industries,
    )
    items = [*found.items, *found.director]
    if options.focus == "tenure":
        items = most_staff_first(items)
    return items if options.limit is None else items[: options.limit]


async def watchlist_tasks(ctx: RunContext[WatchlistParams], today: str) -> list[CompanyTask]:
    """The chosen watchlist companies (`chosen_watchlist`). Only the name, the city and the domain
    go to Claude."""
    options = ctx.params.watchlist
    async with ctx.session() as session:
        items = await chosen_watchlist(session, options)
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
            focus=options.focus,
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

    ctx.params = web_only(ctx.params, ctx.settings)  # PLAN-V27 choice 8, also on a resume
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


CENT = Decimal("0.01")


def _usd(amount: Decimal) -> str:
    return f"US${amount.quantize(CENT, ROUND_UP):,.2f}"


def target_cost(
    ctx: EstimateContext[DiscoveryParams], target: int, slices: int, sweeps: int
) -> tuple[Decimal, Decimal, str | None]:
    """What a run that reaches its target costs (PLAN-V21 T1-4): low, one sweep and the target's
    companies at what past companies cost; high, every sweep. And one sentence when that doesn't
    fit the run's limit or what is left of today's limit."""
    costs = ctx.unit_costs
    research = target * costs.company_usd
    low = slices * costs.slice_usd + research
    high = slices * sweeps * costs.slice_usd + research
    limit = min(ctx.caps.run_cap_usd, ctx.daily_left_usd)
    if low <= limit:
        return low, high, None
    room = limit - slices * costs.slice_usd
    fit = int((room / costs.company_usd).to_integral_value(ROUND_DOWN)) if room > 0 else 0
    which = (
        f"this run's limit of {_usd(ctx.caps.run_cap_usd)}"
        if ctx.caps.run_cap_usd <= ctx.daily_left_usd
        else f"what is left of today's limit ({_usd(ctx.daily_left_usd)})"
    )
    note = (
        f"{target} companies cost about {_usd(low)}, more than {which}, so the run stops at the "
        f"limit after about {fit}."
    )
    return low, high, note


async def estimate_discovery(ctx: EstimateContext[DiscoveryParams]) -> RunEstimate:
    ctx = replace(ctx, params=web_only(ctx.params, ctx.settings))  # PLAN-V27 choice 8
    rules = load_rules()
    slices = len(make_slices(ctx.params, rules))
    # The property tools' new items are in our copy, so they are counted now, free (PLAN-V16
    # T1-8). A slice keeps at most 10 companies; how many it finds isn't known before the run.
    tools = picked_tools(ctx.params, ctx.settings)
    feed = 0
    if tools:
        async with ctx.session() as session:
            found = await feed_candidates(session, ctx.params, rules, tools, datetime.now(UTC))
        feed = len(found)
    # No goal stops a run (PLAN-V20): it researches every company it chooses, up to its limits.
    companies = min(ctx.caps.max_companies, slices * MAX_CANDIDATES + feed)
    if slices and not ctx.scheduled:  # it has a target, and may sweep (PLAN-V21 T1-4)
        return _estimate_target(ctx, slices, feed, tools)
    names = " and ".join(SOURCE_WORDS[tool] for tool in tools)
    items = f"{feed} new item" if feed == 1 else f"{feed} new items"
    if not slices:
        text = (
            f"Discovery makes no web search. It reads {items} from {names}, and "
            f"researches up to {companies} of them."
        )
    elif tools:
        text = (
            f"Discovery searches {slices} city and trigger pairs and reads {items} from "
            f"{names}, then researches up to {companies} of the companies it finds. How many the "
            "searches find isn't known in advance."
        )
    else:
        text = (
            f"Discovery searches {slices} city and trigger pairs, then researches up to "
            f"{companies} of the companies it finds. How many it finds isn't known in advance."
        )
    return _estimate(ctx, companies, slices, warnings=[text])


def _estimate_target(
    ctx: EstimateContext[DiscoveryParams], slices: int, feed: int, tools: list[Any]
) -> RunEstimate:
    """A discovery run a person starts: it tries to research its target, and searches again in a
    new way while it is short (PLAN-V21 T1-4). The typical cost is one sweep and the target's
    companies; the worst case is every sweep at its full hold and the company limit at its cap."""
    params, settings, caps = ctx.params, ctx.settings, ctx.caps
    asked = params.target_companies
    target = min(
        asked if asked is not None else settings.target_companies_default, caps.max_companies
    )
    sweeps = sweeps_for(settings.discovery_max_sweeps) if web_picked(params) else 1
    low, high, note = target_cost(ctx, target, slices, sweeps)
    worst = slices * sweeps * settings.slice_reserve_usd + caps.max_companies * caps.company_cap_usd
    names = " and ".join(SOURCE_WORDS[tool] for tool in tools)
    items = f"{feed} new item" if feed == 1 else f"{feed} new items"
    reads = f" and reads {items} from {names}" if tools else ""
    if sweeps > 1:
        text = (
            f"Discovery searches {slices} city and sign pairs{reads}. While it has fewer than "
            f"{target} companies, it searches them again in a new way, up to {sweeps} times in "
            f"all, then researches what it found, up to {caps.max_companies}."
        )
    else:
        text = (
            f"Discovery searches {slices} city and sign pairs{reads}, then researches up to "
            f"{caps.max_companies} of the companies it finds. How many it finds isn't known in "
            "advance."
        )
    estimate = RunEstimate(
        valid=True,
        warnings=[text],
        slices=slices,
        companies_expected=target,
        cost_usd_low=low,
        cost_usd_high=max(low, worst),
        target_companies=target,
        target_cost_usd_low=low,
        target_cost_usd_high=high,
        target_note=note,
    )
    return estimate


async def estimate_watchlist(ctx: EstimateContext[WatchlistParams]) -> RunEstimate:
    options = ctx.params.watchlist
    async with ctx.session() as session:
        companies = len(await chosen_watchlist(session, options))
    blocked = (
        Blocked(code=SWITCHED_OFF_CODE, message=SWITCHED_OFF_DETAIL)
        if not WATCHLIST_RUNS_ON  # PLAN-V27 choice 2
        else None
        if ctx.settings.hubspot_names_to_claude_ok
        else Blocked(code=NOT_APPROVED_CODE, message=NOT_APPROVED_DETAIL)
    )
    narrowed = options.city is not None or bool(options.industries)
    empty = (
        "No watchlist company fits these choices."
        if narrowed
        else "The watchlist is empty. Upload a HubSpot export first."
    )
    return _estimate(ctx, companies, blocked=blocked, warnings=[] if companies else [empty])


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
        # Research again on a lead card: one company, searched again. Someone waits for it, so it
        # asks Claude in the People lane (PLAN-V26 choice 1).
        person_waits=lambda params: params.recheck and len(params.companies) == 1,
        # A research the Assistant started: nobody sits and waits, so it asks Claude behind
        # people's own requests, with at most 2 places (PLAN-V27 choice 20).
        in_background=lambda params: params.from_assistant,
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
