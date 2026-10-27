"""The Lead Finder run as a LangGraph graph, so a run saves its progress after every step and a
resume continues where it stopped instead of paying twice.

    plan -> (discover, one per slice | choose) -> merge -> choose -> (research, one per company
    | finish) -> finish

- `plan`: discovery makes its slices (cities x triggers). The other modes already know their
  companies (`State.known`): the watchlist, the typed list, the test set.
- `discover`: one Claude request per slice, side by side (the run's discover gate). It holds the
  slice reserve in the run budget. Only the search log is written; what it finds travels in the
  state.
- `merge`: the same company found twice becomes one (pure).
- `choose`: the rules that skip a company (HubSpot deals, fresh or decided leads), then the best
  first, up to the run's company limit. The watchlist keeps its own order. Typed companies and
  the test set are researched as asked, up to the limit.
- `research`: one company (steps/company.py), side by side (the run's research gate).
- `finish`: nothing. The run's outcome is worked out after the graph, from the database.

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
from datetime import UTC, datetime  # noqa: E402
from typing import Any, cast  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from langchain_core.runnables import RunnableConfig  # noqa: E402
from langgraph.graph import END, START, StateGraph  # noqa: E402
from langgraph.runtime import Runtime  # noqa: E402
from langgraph.types import Send  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from apps.lead_finder.prompts import discover_prompt  # noqa: E402
from apps.lead_finder.rules import LeadFinderRules, load_rules  # noqa: E402
from apps.lead_finder.steps.choose import (  # noqa: E402
    OVER_LIMIT_REASON,
    ExistingLead,
    decide,
)
from apps.lead_finder.steps.company import research_one  # noqa: E402
from apps.lead_finder.steps.discover import Found, discover_slice  # noqa: E402
from apps.lead_finder.steps.merge import Merged, merge  # noqa: E402
from apps.lead_finder.steps.plan import Slice, make_slices, slice_job_id  # noqa: E402
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
    CompanySkippedData,
    MergedData,
    PlanReadyData,
    RunCounts,
    RunProblemData,
    SliceDoneData,
    SliceFailedData,
    SliceStartedData,
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


# --- plan ------------------------------------------------------------------------------------


async def plan(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    run = _ctx(runtime)
    ctx = run.run
    if state["mode"] != "discovery":
        await ctx.emit_event(PlanReadyData(slices=0, companies=len(state["known"]), labels=[]))
        return {}
    slices = make_slices(ctx.params, run.rules)
    ctx.totals.counts.slices = len(slices)
    await ctx.emit_event(
        PlanReadyData(slices=len(slices), companies=0, labels=[s.label for s in slices])
    )
    return {"slices": [s.model_dump(mode="json") for s in slices]}


def after_plan(state: State) -> list[Send] | str:
    slices = state.get("slices") or []
    sends = [Send("discover", SliceTask(slice=slice_, today=state["today"])) for slice_ in slices]
    return sends or "choose"


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
        hold = await ctx.budget.acquire(ctx.settings.slice_reserve_usd)
        if not hold:
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
                    cities=params.cities,
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
) -> tuple[dict[str, HubSpotMatch], list[ExistingLead]]:
    """What `decide` needs from the database: each company's HubSpot match (names and websites
    only, no Claude) and the leads already saved under any of their names."""
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
            )
        rows = (
            await session.execute(
                select(
                    Lead.company_key, Lead.status, Lead.created_at, Lead.updated_at, Lead.is_test
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
        )
        for row in rows
    ]
    return matches, leads


async def choose(state: State, runtime: Runtime[RunCtx]) -> dict[str, Any]:
    run = _ctx(runtime)
    ctx = run.run
    mode = state["mode"]
    today = state["today"]
    limit = ctx.caps.max_companies
    recheck = bool(getattr(ctx.params, "recheck", False))
    skipped: list[tuple[str, str]] = []
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
        matches, leads = await _matches_and_leads(ctx, merged, tasks)
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
        )
        skipped = decision.skipped
        over = decision.over_limit_count
        chosen = [
            tasks[company.key] if company.key in tasks else _task_of_merged(company, today, recheck)
            for company in decision.chosen
        ]
    counts = ctx.totals.counts
    counts.chosen = len(chosen)
    for name, reason in skipped:
        counts.skipped += 1
        await ctx.emit_event(CompanySkippedData(name=name, reason=reason))
    if over:
        counts.skipped += over
        await ctx.emit_event(
            CompanySkippedData(name=f"{over} more", reason=OVER_LIMIT_REASON, count=over)
        )
    return {"chosen": chosen}


def after_choose(state: State) -> list[Send] | str:
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
    builder.add_node("research", research, input_schema=CompanyTask)
    builder.add_node("finish", finish)
    builder.add_edge(START, "plan")
    builder.add_conditional_edges("plan", after_plan, ["discover", "choose"])
    builder.add_edge("discover", "merge")
    builder.add_edge("merge", "choose")
    builder.add_conditional_edges("choose", after_choose, ["research", "finish"])
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


async def run_graph(
    ctx: RunContext[Any],
    known: list[CompanyTask],
    rules: LeadFinderRules | None = None,
) -> RunOutcome:
    """Runs (or resumes) the graph for one run. `known` is the companies of a watchlist, company
    or testset run (empty for discovery). On a resume the saved state wins over `known`."""
    run = RunCtx(run=ctx, rules=rules or load_rules())
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
    return RunOutcome(stop_reason=run.stop_reason)
