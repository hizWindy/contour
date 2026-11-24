"""The Lead Finder run as a LangGraph graph, so a run saves its progress after every step and a
resume continues where it stopped instead of paying twice.

    plan -> (discover, one per slice | merge | choose) -> merge -> choose
    choose -> next_sweep -> (discover, one per slice) -> merge -> choose ...   (PLAN-V21 T1-4)
    choose -> settle -> (research, one per company | finish) -> finish

- `plan`: an automatic discovery run (one a schedule started) works out its share of the round's
  goal in good leads first (`goal.py`), to report against. A run a person started has no goal
  (PLAN-V20). Discovery makes its slices (cities x triggers), and
  adds up to `rivals.per_run` pending rivals of booming companies in its cities, with the weak
  sign `rival_growth`, and the
  new items of each property tool it picked, each with its sign (PLAN-V16 T1-8,
  `run_sources.py`). A discovery run that leaves out the web has no slices, and goes straight to
  `merge`. The other modes already know their companies (`State.known`): the watchlist, the
  typed list, the test set.
- `discover`: one Claude request per slice, side by side (the run's discover gate). It holds the
  slice reserve in the run budget. Only the search log is written; what it finds travels in the
  state.
- `merge`: the same company found twice becomes one (pure). A discovery run merges after every
  sweep, so "companies after merging" grows as the searches go.
- `choose`: the rules that skip a company (HubSpot deals, fresh or decided leads), then the best
  first, up to the run's company limit. A discovery run also leaves out every company HubSpot
  surely has, unless nobody has worked it for `hubspot_quiet_months` (PLAN-V27 choice 3), so the
  places those used go to new companies and a run searches on until it has its target of them.
  The watchlist keeps its own order. Typed companies and
  the test set are researched as asked, up to the limit. It only decides: `settle` says who was
  left out, once.
- `next_sweep` (PLAN-V21 T1-4): a discovery run a person started that has fewer companies than its
  target searches its signs again in a new way (`plan.sweep_searches`), up to
  `discovery_max_sweeps`, while discovery's share of the money lasts. The target never ends a run
  early: a run that meets it in sweep 1 researches everything it chose, up to its limit.
- `settle`: says who was left out and why (the companies already in HubSpot in one line, PLAN-V27
  choice 7), and marks the rivals. A short discovery run says so; it is no longer topped up from
  the HubSpot watchlist (PLAN-V27 choice 5).
- `research`: one company (steps/company.py), side by side (the run's research gate). Every
  company the run chose is researched, up to its limits: a goal never stops a run.
- `finish`: nothing. The run's outcome is worked out after the graph, from the database: its
  good leads, and where they came from.

Every router returns its `Send`s or a plain node name, so a fan-out with nothing in it never ends
the graph early. There is no `max_concurrency` and no retry policy: the run's own gates set the
pace, and a Claude request is never repeated by the graph (a repeat is billed).

The thread id is the run id. On a resume with a checkpoint the graph continues (`ainvoke(None)`);
without one (the run stopped before the first step was saved) it starts again from the beginning,
and the research step finds any lead that was already saved.
"""

from core.runtime import disable_tracing

disable_tracing()  # before LangGraph is imported (importing it could read the tracing switches)

import logging  # noqa: E402
from datetime import UTC, date, datetime  # noqa: E402
from typing import Any, cast  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from langchain_core.runnables import RunnableConfig  # noqa: E402
from langgraph.graph import END, START, StateGraph  # noqa: E402
from langgraph.runtime import Runtime  # noqa: E402
from langgraph.types import Send  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from apps.lead_finder.context import CreditMeter  # noqa: E402
from apps.lead_finder.goal import goal_for_run, good_of  # noqa: E402
from apps.lead_finder.params import DiscoveryParams  # noqa: E402
from apps.lead_finder.prompts import discover_prompt  # noqa: E402
from apps.lead_finder.quiet import CAN_BE_QUIET, last_activity_of  # noqa: E402
from apps.lead_finder.rivals import (  # noqa: E402
    mark_rivals,
    pending_for_run,
    rival_found,
)
from apps.lead_finder.rules import LeadFinderRules, load_rules  # noqa: E402
from apps.lead_finder.run_sources import (  # noqa: E402
    feed_candidates,
    picked_tools,
    read_new_emails,
)
from apps.lead_finder.sources import tool_of  # noqa: E402
from apps.lead_finder.steps.choose import (  # noqa: E402
    IN_HUBSPOT_REASON,
    OVER_LIMIT_REASON,
    ExistingLead,
    decide,
)
from apps.lead_finder.steps.company import research_one  # noqa: E402
from apps.lead_finder.steps.discover import Found, discover_slice  # noqa: E402
from apps.lead_finder.steps.merge import Merged, merge  # noqa: E402
from apps.lead_finder.steps.plan import (  # noqa: E402
    Slice,
    make_slices,
    run_cities,
    slice_job_id,
    sweep_label,
    sweeps_for,
    web_picked,
)
from apps.lead_finder.steps.state import (  # noqa: E402
    CompanyTask,
    RunCtx,
    SliceTask,
    State,
    day_of,
)
from apps.lead_finder.tables import Lead, company_key  # noqa: E402
from core.claude.budget import BudgetSpent  # noqa: E402
from core.hubspot.matching import HubSpotMatch, match_company  # noqa: E402
from core.runs.schemas import (  # noqa: E402
    LEAD_SOURCES,
    CompanySkippedData,
    MergedData,
    PlanReadyData,
    RunCounts,
    RunProblemData,
    SliceDoneData,
    SliceFailedData,
    SliceStartedData,
    SweepDoneData,
    SweepStartedData,
)
from core.runs.types import RunContext, RunOutcome  # noqa: E402
from core.searches.service import log_reply  # noqa: E402

log = logging.getLogger(__name__)

APP = "lead_finder"
MELBOURNE = ZoneInfo("Australia/Melbourne")
SLICE_CAP_REACHED = "the run's money for discovery is used up"


def run_day() -> str:
    """Today in Melbourne, YYYY-MM-DD. A run keeps the day it started with."""
    return datetime.now(UTC).astimezone(MELBOURNE).date().isoformat()


def _ctx(runtime: Runtime[RunCtx]) -> RunCtx:
    return runtime.context


def person_discovery(ctx: RunContext[Any]) -> bool:
    """A discovery run a person started. Only these get a target, the sweeps and the top up: an
    automatic run keeps one search for each sign, until Al-khair says otherwise after M2."""
    return ctx.mode == "discovery" and ctx.schedule_id is None


def target_of(ctx: RunContext[Any]) -> int | None:
    """How many companies the run tries to research (PLAN-V21 T1-4): what the person picked, else
    `target_companies_default`, never above the company limit. None for every other run."""
    if not person_discovery(ctx) or not isinstance(ctx.params, DiscoveryParams):
        return None
    asked = ctx.params.target_companies
    wanted = asked if asked is not None else ctx.settings.target_companies_default
    return max(1, min(wanted, ctx.caps.max_companies))


def sweeps_of(ctx: RunContext[Any]) -> int:
    """The most sweeps the run may make: the setting for a discovery run a person started that
    searches the web, else 1."""
    if not person_discovery(ctx) or not web_picked(ctx.params):
        return 1
    return sweeps_for(ctx.settings.discovery_max_sweeps)


# --- plan ------------------------------------------------------------------------------------


async def plan(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    run = _ctx(runtime)
    ctx = run.run
    if state["mode"] != "discovery":
        await ctx.emit_event(PlanReadyData(slices=0, companies=len(state["known"]), labels=[]))
        return {}
    slices = make_slices(ctx.params, run.rules)
    counts = ctx.totals.counts
    counts.slices = len(slices)
    counts.target = target_of(ctx)
    counts.sweeps = sweeps_of(ctx) if slices else 0
    setup = run.rules.criteria.rivals
    rivals = []
    if setup.enabled and setup.per_run > 0:
        async with ctx.session() as session:
            pending = await pending_for_run(
                session, run_cities(ctx.params, run.rules), setup.per_run
            )
        rivals = [rival_found(item, setup.sign) for item in pending]
    # The new items of the property tools the run picked (PLAN-V16 T1-8): free, from our copy
    tools = picked_tools(ctx.params, ctx.settings)
    feed: list[Found] = []
    if "property_daily" in tools:  # its new emails first, so the run needn't wait for the job
        problem = await read_new_emails(ctx.session_factory, ctx.settings, datetime.now(UTC))
        if problem is not None:
            await ctx.emit_event(RunProblemData(message=problem))
    if tools:
        async with ctx.session() as session:
            feed = await feed_candidates(session, ctx.params, run.rules, tools, datetime.now(UTC))
    extra = [*rivals, *feed]
    await ctx.emit_event(
        PlanReadyData(slices=len(slices), companies=len(extra), labels=[s.label for s in slices])
    )
    if counts.sweeps > 1:
        await ctx.emit_event(
            SweepStartedData(sweep=1, of=counts.sweeps, label=sweep_label(run.rules, 1))
        )
    found: dict[str, Any] = {"slices": [s.model_dump(mode="json") for s in slices], "sweep": 1}
    if extra:
        found["candidates"] = [company.model_dump(mode="json") for company in extra]
    if ctx.schedule_id is not None:  # an automatic run reports against its round's share
        async with ctx.session() as session:
            found["goal"] = await goal_for_run(
                session,
                ctx.settings.lead_finder_goal_good_leads,
                datetime.now(UTC),
                ctx.run_id,
                ctx.schedule_id,
            )
        ctx.totals.counts.goal = found["goal"]
    return found


def after_plan(state: State) -> list[Send] | str:
    slices = state.get("slices") or []
    sends = [Send("discover", SliceTask(slice=slice_, today=state["today"])) for slice_ in slices]
    if sends:
        return sends
    # A discovery run with no slices (it left out the web, PLAN-V16 T1-8) still merges what the
    # tools and the rivals found
    return "merge" if state["mode"] == "discovery" else "choose"


# --- discover --------------------------------------------------------------------------------


async def discover(task: SliceTask, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    run = _ctx(runtime)
    ctx = run.run
    slice_ = Slice.model_validate(task["slice"])
    counts = ctx.totals.counts
    nothing: dict[str, Any] = {"candidates": []}
    async with ctx.discover_gate:
        if run.stop_reason is not None:
            counts.slices_failed += 1
            await ctx.emit_event(
                SliceFailedData(slice_id=slice_.id, label=slice_.label, reason=run.stop_reason)
            )
            return nothing
        # Discovery's share first (PLAN-V21 T1-4): a later sweep stops at it and leaves the rest
        # of the run's money for the research. The size check at the start makes sweep 1 fit.
        share = await (await run.discovery_budget()).acquire(ctx.settings.slice_reserve_usd)
        if not share:
            counts.slices_failed += 1
            await ctx.emit_event(
                SliceFailedData(slice_id=slice_.id, label=slice_.label, reason=SLICE_CAP_REACHED)
            )
            return nothing
        hold = await ctx.budget.acquire(ctx.settings.slice_reserve_usd)
        if not hold:
            share.release()
            await run.stop(
                "run_cost", f"The run reached its limit of US${ctx.caps.run_cap_usd:.2f}"
            )
            counts.slices_failed += 1
            await ctx.emit_event(
                SliceFailedData(slice_id=slice_.id, label=slice_.label, reason=SLICE_CAP_REACHED)
            )
            return nothing
        try:
            await ctx.emit_event(SliceStartedData(slice_id=slice_.id, label=slice_.label))
            params = ctx.params
            try:
                result = await discover_slice(
                    ctx.claude,
                    run.rules,
                    ctx.settings,
                    slice_,
                    params.since_days,
                    day_of(task["today"]),
                    blocked_domains=run.rules.criteria.source_domains.blocked,
                    on_reply=ctx.totals.add_reply,
                    cities=run_cities(params, run.rules),
                )
            except BudgetSpent as stop:  # the daily limit
                await run.stop("daily", str(stop) or "Claude's daily limit is reached")
                counts.slices_failed += 1
                await ctx.emit_event(
                    SliceFailedData(
                        slice_id=slice_.id, label=slice_.label, reason="the daily limit is reached"
                    )
                )
                return nothing
            if result.reply is not None:
                hold.actual = result.reply.cost_usd
                async with ctx.session() as session:
                    log_reply(
                        session,
                        result.reply,
                        app=APP,
                        step="discover",
                        job_id=slice_job_id(ctx.run_id, slice_),
                        run_id=ctx.run_id,
                        subject=slice_.label,
                        prompt_version=discover_prompt().version,
                    )
                    await session.commit()
            for name, reason in result.skipped:
                counts.skipped += 1
                await ctx.emit_event(CompanySkippedData(name=name, reason=reason))
            for problem in result.problems:
                if result.failure is None or not problem.endswith(result.failure):
                    await ctx.emit_event(RunProblemData(message=problem))
            if result.failure is not None:
                counts.slices_failed += 1
                await ctx.emit_event(
                    SliceFailedData(slice_id=slice_.id, label=slice_.label, reason=result.failure)
                )
                return nothing
            counts.slices_done += 1
            counts.candidates += len(result.candidates)
            reply = result.reply
            await ctx.emit_event(
                SliceDoneData(
                    slice_id=slice_.id,
                    label=slice_.label,
                    found=len(result.candidates),
                    cost_usd=reply.cost_usd if reply else 0,
                    searches=reply.usage.web_searches if reply else 0,
                )
            )
            return {"candidates": [found.model_dump(mode="json") for found in result.candidates]}
        finally:
            hold.release()
            share.release(hold.actual)


# --- merge -----------------------------------------------------------------------------------


async def merge_step(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    ctx = _ctx(runtime).run
    found = [Found.model_validate(item) for item in state.get("candidates") or []]
    merged = merge(found, ctx.settings.match_fuzzy_min)
    ctx.totals.counts.unique = len(merged)
    await ctx.emit_event(MergedData(candidates=len(found), unique=len(merged)))
    return {"merged": [company.model_dump(mode="json") for company in merged]}


# --- choose ----------------------------------------------------------------------------------


def _task_of_merged(company: Merged, today: str, recheck: bool) -> CompanyTask:
    return CompanyTask(
        name=company.name,
        city=company.city,
        website=company.website,
        origin="web",
        hubspot_id=None,
        is_test=False,
        recheck=recheck,
        signals=[
            {
                "trigger_id": s.trigger_id,
                "what_happened": s.what_happened,
                "url": s.url,
                "date": s.date,
                "published": s.published,
            }
            for s in company.signals
        ],
        today=today,
    )


def _merged_of_task(task: CompanyTask) -> Merged:
    return Merged(
        name=task["name"],
        key=company_key(task["name"]),
        website=task["website"],
        city=task["city"],
        names=[task["name"]],
        signals=[],
    )


async def _matches_and_leads(
    ctx: RunContext[Any], companies: list[Merged], tasks: dict[str, CompanyTask]
) -> tuple[dict[str, HubSpotMatch], list[ExistingLead], dict[str, date | None]]:
    """What `decide` needs from the database: each company's HubSpot match (names and websites
    only, no Claude), the leads already saved under any of their names, and the last activity day
    of each HubSpot company matched (PLAN-V27). The same name counts only in the same city
    (choice 26), so a different company with the same name is a maybe, never left out."""
    matches: dict[str, HubSpotMatch] = {}
    keys = sorted({key for company in companies for key in company.keys})
    async with ctx.session() as session:
        for company in companies:
            task = tasks.get(company.key)
            matches[company.key] = await match_company(
                session,
                company.name,
                website=company.website,
                city=company.city,
                hubspot_id=task["hubspot_id"] if task else None,
                found_name=company.names[1] if len(company.names) > 1 else None,
                fuzzy_min=ctx.settings.match_fuzzy_min,
                name_needs_city=True,
            )
        activity = await last_activity_of(
            session,
            [
                match.hubspot_id
                for match in matches.values()
                if match.hubspot_id and match.status in CAN_BE_QUIET
            ],
        )
        rows = (
            await session.execute(
                select(
                    Lead.company_key,
                    Lead.status,
                    Lead.created_at,
                    Lead.updated_at,
                    Lead.is_test,
                    Lead.trigger_ids,
                ).where(Lead.company_key.in_(keys), Lead.run_id.is_distinct_from(ctx.run_id))
            )
        ).all()
    leads = [
        ExistingLead(
            company_key=row.company_key,
            status=row.status,
            created_at=row.created_at,
            updated_at=row.updated_at if row.updated_at != row.created_at else None,
            is_test=row.is_test,
            trigger_ids=tuple(row.trigger_ids or ()),
        )
        for row in rows
    ]
    return matches, leads, activity


async def choose(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    """Decides who is researched. A discovery run then says how its sweep went, and whether it
    searches again (`more`). Who was left out is said once, in `settle`."""
    run = _ctx(runtime)
    ctx = run.run
    mode = state["mode"]
    today = state["today"]
    limit = ctx.caps.max_companies
    recheck = bool(getattr(ctx.params, "recheck", False))
    skipped: list[tuple[str, str]] = []
    in_hubspot: list[str] = []
    chosen_keys: list[str] = []
    if mode in ("company", "testset"):  # researched as asked, up to the limit
        chosen = list(state["known"][:limit])
        over = max(0, len(state["known"]) - limit)
    else:
        if mode == "discovery":
            merged = [Merged.model_validate(item) for item in state.get("merged") or []]
            tasks: dict[str, CompanyTask] = {}
        else:  # the watchlist: HubSpot companies, already in their own order
            tasks = {_merged_of_task(task).key: task for task in state["known"]}
            merged = [_merged_of_task(task) for task in state["known"]]
        matches, leads, activity = await _matches_and_leads(ctx, merged, tasks)
        decision = decide(
            merged,
            matches,
            leads,
            run.rules,
            ctx.params,
            day_of(today),
            limit,
            ctx.settings,
            ranked=mode == "discovery",
            new_only=mode == "discovery",
            activity=activity,
        )
        skipped = decision.skipped
        in_hubspot = decision.left_out_hubspot
        over = decision.over_limit_count
        chosen_keys = [company.key for company in decision.chosen]
        chosen = [
            tasks[company.key] if company.key in tasks else _task_of_merged(company, today, recheck)
            for company in decision.chosen
        ]
    # `counts.chosen` is set once, in `settle`, after any top up: the run page reads a count
    # above 0 as "researching", so a sweep shows its own progress until then
    found: dict[str, Any] = {
        "chosen": chosen,
        "decision": {
            "skipped": [[name, reason] for name, reason in skipped],
            "in_hubspot": in_hubspot,
            "over": over,
            "chosen_keys": chosen_keys,
        },
        "more": False,
    }
    if mode == "discovery":
        found["more"] = await _end_of_sweep(run, state, len(chosen))
    return found


async def _end_of_sweep(run: RunCtx, state: State, companies: int) -> bool:
    """Says how the sweep went (`sweep_done`), and whether the run searches again: it has fewer
    companies than its target, a sweep is left, nothing stopped it, and discovery's share of the
    money still holds one more search. Out of money, it says so in the feed (PLAN-V21 T1-4)."""
    ctx = run.run
    counts = ctx.totals.counts
    if counts.sweeps <= 1 or not state.get("slices"):
        return False
    sweep = state.get("sweep", 1)
    ids = {Slice.model_validate(item).id for item in state.get("slices") or []}
    found = sum(1 for item in state.get("candidates") or [] if item.get("slice_id") in ids)
    counts.sweeps_done = max(counts.sweeps_done, sweep)
    target = counts.target
    await ctx.emit_event(
        SweepDoneData(sweep=sweep, found=found, companies=companies, target=target)
    )
    if target is None or companies >= target or sweep >= counts.sweeps:
        return False
    if run.stop_reason is not None or ctx.cancelled.is_set():
        return False
    share = await run.discovery_budget()
    if not share.fits(ctx.settings.slice_reserve_usd):
        await ctx.emit_event(
            RunProblemData(
                message=(
                    f"Discovery's share of the money (US${ctx.caps.discovery_cap_usd:.2f}) is "
                    f"used up, so the run stops searching after sweep {sweep}, with {companies} "
                    f"of its {target} companies."
                )
            )
        )
        return False
    return True


def after_choose(state: State) -> str:
    return "next_sweep" if state.get("more") else "settle"


async def next_sweep(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    """The next sweep's slices: the same cities and signs, searched in a new way (T1-3)."""
    run = _ctx(runtime)
    ctx = run.run
    sweep = state.get("sweep", 1) + 1
    slices = make_slices(ctx.params, run.rules, sweep)
    counts = ctx.totals.counts
    counts.slices += len(slices)
    await ctx.emit_event(
        SweepStartedData(sweep=sweep, of=counts.sweeps, label=sweep_label(run.rules, sweep))
    )
    return {"sweep": sweep, "slices": [s.model_dump(mode="json") for s in slices], "more": False}


def after_next_sweep(state: State) -> list[Send] | str:
    sends = [
        Send("discover", SliceTask(slice=slice_, today=state["today"]))
        for slice_ in state.get("slices") or []
    ]
    return sends or "settle"


async def settle(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    """Says once who was left out and why, and marks the rivals. A short discovery run says it came
    up short (PLAN-V27 choice 5). Then the research starts."""
    run = _ctx(runtime)
    ctx = run.run
    counts = ctx.totals.counts
    chosen = list(state.get("chosen") or [])
    decision = state.get("decision") or {}
    for name, reason in decision.get("skipped") or []:
        counts.skipped += 1
        await ctx.emit_event(CompanySkippedData(name=name, reason=reason))
    in_hubspot = [str(name) for name in decision.get("in_hubspot") or []]
    if in_hubspot:  # one line for all of them (PLAN-V27 choice 7)
        counts.skipped += len(in_hubspot)
        word = "company" if len(in_hubspot) == 1 else "companies"
        await ctx.emit_event(
            CompanySkippedData(
                name=f"{len(in_hubspot)} {word}",
                reason=IN_HUBSPOT_REASON,
                count=len(in_hubspot),
            )
        )
    over = int(decision.get("over") or 0)
    if over:
        counts.skipped += over
        await ctx.emit_event(
            CompanySkippedData(name=f"{over} more", reason=OVER_LIMIT_REASON, count=over)
        )
    if state["mode"] == "discovery":
        merged = [Merged.model_validate(item) for item in state.get("merged") or []]
        await _mark_rivals(
            ctx,
            run.rules.criteria.rivals.sign,
            merged,
            list(decision.get("chosen_keys") or []),
            [*(str(pair[0]) for pair in decision.get("skipped") or []), *in_hubspot],
            run_cities(ctx.params, run.rules),
        )
        await _say_if_short(run, len(chosen))
    counts.chosen = len(chosen)
    return {"chosen": chosen}


async def _say_if_short(run: RunCtx, chosen: int) -> None:
    """A run a person started that found fewer new companies than its target says so, with what to
    try (PLAN-V27 choice 5): "Found 31 of 50. Try a longer look-back or more places." It is no
    longer topped up from the HubSpot watchlist."""
    ctx = run.run
    target = ctx.totals.counts.target
    if target is None or not person_discovery(ctx) or ctx.cancelled.is_set():
        return
    wanted = min(target, ctx.caps.max_companies)
    if chosen >= wanted:
        return
    await ctx.emit_event(
        RunProblemData(
            message=f"Found {chosen} of {wanted}. Try a longer look-back or more places."
        )
    )


async def _mark_rivals(
    ctx: RunContext[Any],
    sign: str,
    merged: list[Merged],
    chosen_keys: list[str],
    skipped_names: list[str],
    cities: list[str],
) -> None:
    """The rivals this run chose are used; the ones a rule skipped are skipped. The ones the company
    limit left out stay pending for the next run (PLAN-V9 B5). `cities` are the run's places."""
    rivals = {
        company.key for company in merged if any(s.trigger_id == sign for s in company.signals)
    }
    if not rivals:
        return
    used = [key for key in chosen_keys if key in rivals]
    skipped = [key for name in skipped_names if (key := company_key(name)) in rivals]
    async with ctx.session() as session:
        await mark_rivals(
            session,
            ctx.run_id,
            used_keys=used,
            skipped_keys=skipped,
            cities=cities,
        )
        await session.commit()


def after_settle(state: State) -> list[Send] | str:
    sends = [Send("research", task) for task in state.get("chosen") or []]
    return sends or "finish"


# --- research and finish --------------------------------------------------------------------


async def research(task: CompanyTask, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    return {"outcomes": [await research_one(_ctx(runtime), task)]}


async def finish(state: State) -> dict[str, Any]:
    return {}


def build_graph() -> Any:
    """The graph, not yet compiled. (Typed as Any: LangGraph's overloads don't fit a node that
    takes a TypedDict payload under mypy.)"""
    builder: Any = StateGraph(State, context_schema=RunCtx)
    builder.add_node("plan", plan)
    builder.add_node("discover", discover, input_schema=SliceTask)
    builder.add_node("merge", merge_step)
    builder.add_node("choose", choose)
    builder.add_node("next_sweep", next_sweep)
    builder.add_node("settle", settle)
    builder.add_node("research", research, input_schema=CompanyTask)
    builder.add_node("finish", finish)
    builder.add_edge(START, "plan")
    builder.add_conditional_edges("plan", after_plan, ["discover", "merge", "choose"])
    builder.add_edge("discover", "merge")
    builder.add_edge("merge", "choose")
    builder.add_conditional_edges("choose", after_choose, ["next_sweep", "settle"])
    builder.add_conditional_edges("next_sweep", after_next_sweep, ["discover", "settle"])
    builder.add_conditional_edges("settle", after_settle, ["research", "finish"])
    builder.add_edge("research", "finish")
    builder.add_edge("finish", END)
    return builder


# --- Running it -------------------------------------------------------------------------------


async def _counts_from_leads(ctx: RunContext[Any]) -> None:
    """Researched and by_result from the run's own leads: the truth after a crash or a resume."""
    async with ctx.session() as session:
        rows = (
            await session.execute(
                select(Lead.result, func.count())
                .where(Lead.run_id == ctx.run_id)
                .group_by(Lead.result)
            )
        ).all()
    by_result = {str(result): int(count) for result, count in rows}
    counts: RunCounts = ctx.totals.counts
    counts.by_result = by_result
    counts.researched = sum(by_result.values())
    counts.good = good_of({"by_result": by_result})


async def _leads_by_source(
    ctx: RunContext[Any], chosen: list[CompanyTask], rules: LeadFinderRules
) -> dict[str, int]:
    """How many of the run's leads each source found (PLAN-V16 T1-8): a company discovery found
    through a property tool's feed counts for that tool, and one it found on the web for the web.
    A company two sources found counts for each."""
    async with ctx.session() as session:
        saved = set(
            (await session.scalars(select(Lead.company_key).where(Lead.run_id == ctx.run_id))).all()
        )
    found = dict.fromkeys(LEAD_SOURCES, 0)
    for task in chosen:
        if company_key(task["name"]) not in saved:
            continue
        sources = {tool_of(signal["url"], rules.criteria) or "web" for signal in task["signals"]}
        for source in sources:
            found[source] = found.get(source, 0) + 1
    return found


async def run_graph(
    ctx: RunContext[Any],
    known: list[CompanyTask],
    rules: LeadFinderRules | None = None,
) -> RunOutcome:
    """Runs (or resumes) the graph for one run. `known` is the companies of a watchlist, company
    or testset run (empty for discovery). On a resume the saved state wins over `known`."""
    run = RunCtx(
        run=ctx,
        rules=rules or load_rules(),
        signalhire_credits=CreditMeter(ctx.settings.signalhire_max_credits_per_run),
    )
    graph = build_graph().compile(checkpointer=ctx.checkpointer)
    config = cast(RunnableConfig, {"configurable": {"thread_id": str(ctx.run_id)}})
    started = False
    if ctx.resume:
        await _counts_from_leads(ctx)
        snapshot = await graph.aget_state(config)
        if snapshot.values:
            await graph.ainvoke(None, config, context=run)
            started = True
    if not started:
        today = known[0]["today"] if known else run_day()
        initial: State = {"mode": ctx.mode, "today": today, "known": known}
        await graph.ainvoke(initial, config, context=run)
    await _counts_from_leads(ctx)
    values = (await graph.aget_state(config)).values or {}
    counts = ctx.totals.counts
    if ctx.mode == "discovery":
        counts.goal = values.get("goal")  # only an automatic run has one
        counts.by_source = await _leads_by_source(ctx, values.get("chosen") or [], run.rules)
    return RunOutcome(stop_reason=run.stop_reason)
