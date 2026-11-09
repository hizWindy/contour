"""Research one company inside a run: the work of the graph's `research` step.

In order, for each company:
1. Wait for a place (the run's research gate, `run_company_concurrency` at once).
2. Already researched in this run? (a resume, or the same name twice) Then nothing more: no event,
   no cost. The lead id is fixed by the run and the company, so this is a plain lookup.
3. A HubSpot name (the watchlist) waits for Levi's OK: `company_skipped` if it is off. An
   automatic run that already has its goal of good leads skips the rest (`goal.py`).
4. Count the company against `max_companies`, and hold the company cap in the run budget. When
   the run's money is used up, the run stops cleanly (`cap_reached`) and the rest is skipped.
5. Save discovery's signals to memory under the name being researched (research then reads them).
6. `company_started`, research, `company_done`. One company failing never stops the others:
   `company_failed` with a plain reason (the details go to the log). Claude being down
   (`ClaudeUnavailable`) and a cancel stop the whole run.
7. A good lead in a tier 1 or tier 2 industry: one cheap Claude web search names up to 5 rivals in
   its city, saved for a later run (PLAN-V9 B5). It is paid from the same company hold, and a
   problem with it never changes the lead.
The hold ends in a `finally` with what the company really cost.
"""

import logging
import uuid
from decimal import Decimal
from typing import Any

from apps.lead_finder.context import ResearchContext, StepModels
from apps.lead_finder.goal import good_of
from apps.lead_finder.research import (
    APP,
    LeadCard,
    ResearchRequest,
    known_note_urls,
    lead_of_run,
    research_company,
)
from apps.lead_finder.rivals import RIVALS_PROMPT_VERSION, find_rivals, save_rivals, wants_rivals
from apps.lead_finder.sanitize import one_line, safe_http_url
from apps.lead_finder.scoring import city_of, parse_date
from apps.lead_finder.steps.choose import OVER_LIMIT_REASON
from apps.lead_finder.steps.state import CompanyTask, RunCtx, day_of, signals_of
from apps.lead_finder.tables import company_key
from core.claude.budget import Budget, BudgetSpent
from core.claude.client import ClaudeUnavailable, Reply
from core.logs import scrub
from core.memory.service import Note, remember_many
from core.runs.schemas import (
    CompanyDoneData,
    CompanyFailedData,
    CompanySkippedData,
    CompanyStartedData,
)
from core.searches.service import log_reply

log = logging.getLogger(__name__)

NOT_APPROVED = "HubSpot names are not approved"


def goal_reached(goal: int) -> str:
    """Why an automatic run skips the companies left once it has its goal."""
    return f"the run reached its goal of {goal} good leads"


CAP_REACHED = "the run's cost limit is reached"
RESEARCH_FAILED = "Research failed because of an unexpected error. The details are in the log."
SIGNAL_MAX_CHARS = 400


def outcome(task: CompanyTask, status: str, **more: Any) -> dict[str, Any]:
    """What the step adds to the state for one company. JSON only."""
    return {"name": task["name"], "key": company_key(task["name"]), "status": status, **more}


async def _skip(run: RunCtx, task: CompanyTask, reason: str) -> dict[str, Any]:
    run.run.totals.counts.skipped += 1
    await run.run.emit_event(CompanySkippedData(name=task["name"], reason=reason))
    return outcome(task, "skipped", reason=reason)


def _hubspot_names_approved(run: RunCtx) -> bool:
    """Levi's OK to send HubSpot names to Claude. It lives only in engine/.env and changes only
    with a restart, so the settings the run started with are the settings now (a resume after a
    restart reads them again)."""
    return run.run.settings.hubspot_names_to_claude_ok


async def save_signals(run: RunCtx, task: CompanyTask) -> int:
    """Discovery's signals become memory notes about the company, under the name being
    researched, so research reads them first. A link already noted is not saved again."""
    signals = signals_of(task)
    if not signals:
        return 0
    async with run.run.session() as session:
        known = await known_note_urls(session, task["name"])
        notes = []
        for signal in signals:
            if signal.url in known or not safe_http_url(signal.url):
                continue
            known.add(signal.url)
            notes.append(
                Note(
                    content=one_line(signal.what_happened, SIGNAL_MAX_CHARS),
                    subject=task["name"],
                    url=signal.url,
                    source_date=parse_date(signal.published or signal.date),
                    meta={
                        "origin": "discovery",
                        "angle": "discovery",
                        "trigger_id": signal.trigger_id,
                        "run_id": str(run.run.run_id),
                    },
                )
            )
        await remember_many(session, run.run.embedder, notes, app=APP, kind="source_note")
        await session.commit()
    return len(notes)


async def _rivals(
    run: RunCtx, card: LeadCard, task: CompanyTask, spent: Decimal, on_reply: Any
) -> int:
    """Finds and saves the rivals of a good lead in a booming industry (PLAN-V9 B5). Returns how
    many were saved. Paid from what is left of the company's hold; a problem is logged, never
    raised, except Claude being down or the daily limit (the run stops for those anyway)."""
    ctx = run.run
    rules = run.rules
    place = card.facts.city.value if isinstance(card.facts.city.value, str) else task["city"]
    city = city_of(place, rules) if place else None
    if not wants_rivals(rules, card.result, card.facts.tier_group, city):
        return 0
    assert city is not None  # wants_rivals says no without a city
    left = ctx.caps.company_cap_usd - spent
    budget = Budget(
        max(left, Decimal(0)),
        rules.criteria.rivals.max_searches,
        request_reserve_usd=min(ctx.settings.request_reserve_usd, max(left, Decimal(0))),
    )
    industry = card.facts.industry.value if isinstance(card.facts.industry.value, str) else None
    try:
        found = await find_rivals(
            ctx.claude,
            rules,
            ctx.settings,
            company=card.company,
            industry=industry,
            city=city,
            budget=budget,
            on_reply=on_reply,
        )
    except (ClaudeUnavailable, BudgetSpent):
        raise
    except Exception as error:
        log.warning(
            "rivals_failed", extra={"run_id": str(ctx.run_id), "kind": type(error).__name__}
        )
        return 0
    async with ctx.session() as session:
        if found.reply is not None:
            log_reply(
                session,
                found.reply,
                app=APP,
                step="rivals",
                job_id=card.id,
                run_id=ctx.run_id,
                subject=card.company,
                prompt_version=RIVALS_PROMPT_VERSION,
            )
        saved = await save_rivals(session, card.id, card.company, city, found.rivals)
        await session.commit()
    for problem in found.problems:
        log.info("rivals_problem", extra={"run_id": str(ctx.run_id), "problem": problem})
    return saved


async def research_one(run: RunCtx, task: CompanyTask) -> dict[str, Any]:
    """Research one company of the run (the module text has the steps)."""
    ctx = run.run
    name = task["name"]
    key = company_key(name)
    async with ctx.research_gate:
        async with ctx.session() as session:
            existing = await lead_of_run(session, ctx.run_id, key)
        if existing is not None:
            return outcome(task, "done", lead_id=str(existing.id), result=existing.result)
        if run.stop_reason is not None:
            return await _skip(run, task, run.stop_reason)
        goal = task.get("goal")
        if goal is not None and good_of({"by_result": ctx.totals.counts.by_result}) >= goal:
            return await _skip(run, task, goal_reached(goal))
        if task["origin"] == "hubspot" and not _hubspot_names_approved(run):
            return await _skip(run, task, NOT_APPROVED)
        if not ctx.budget.start_company():
            return await _skip(run, task, OVER_LIMIT_REASON)
        hold = await ctx.budget.acquire(ctx.caps.company_cap_usd)
        if not hold:
            await run.stop(
                "run_cost", f"The run reached its limit of US${ctx.caps.run_cap_usd:.2f}"
            )
            return await _skip(run, task, CAP_REACHED)

        spent = Decimal(0)

        def on_reply(reply: Reply[Any]) -> None:
            nonlocal spent
            spent += reply.cost_usd
            ctx.totals.add_reply(reply)

        try:
            await save_signals(run, task)
            await ctx.emit_event(CompanyStartedData(name=name))
            settings = ctx.settings
            context = ResearchContext(
                run_id=ctx.run_id,
                origin=task["origin"],
                hubspot_id=task["hubspot_id"],
                is_test=task["is_test"],
                signals=signals_of(task),
                on_reply=on_reply,
                models=StepModels(
                    discover=settings.model_for("discover"),
                    search=settings.model_for("search"),
                    extract=settings.model_for("extract"),
                ),
                blocked_domains=tuple(run.rules.criteria.source_domains.blocked),
                company_cap_usd=ctx.caps.company_cap_usd,
                signalhire_credits=run.signalhire_credits,
                focus=task.get("focus", "growth"),  # tenure: the lease and tenure run (C2)
            )
            request = ResearchRequest(
                company=name,
                city=task["city"],
                website=task["website"],
                use_memory=not task["recheck"],
            )
            async with ctx.session() as session:
                card = await research_company(
                    session,
                    ctx.embedder,
                    ctx.claude,
                    run.rules,
                    settings,
                    request,
                    day_of(task["today"]),
                    context,
                )
            if not task["is_test"]:
                await _rivals(run, card, task, spent, on_reply)
        except ClaudeUnavailable:
            raise  # Claude is down: the whole run stops (failed), and can be resumed
        except BudgetSpent as stop:  # the daily limit: nothing more can be sent today
            await run.stop("daily", str(stop) or "Claude's daily limit is reached")
            return await _skip(run, task, "Claude's daily limit is reached")
        except Exception as error:
            error_id = uuid.uuid4().hex[:12]
            log.error(
                "company_research_failed",
                extra={
                    "run_id": str(ctx.run_id),
                    "error_id": error_id,
                    "kind": type(error).__name__,
                    "detail": scrub(str(error))[:500],
                },
            )
            ctx.totals.counts.failed += 1
            await ctx.emit_event(
                CompanyFailedData(name=name, reason=f"{RESEARCH_FAILED} ({error_id})")
            )
            return outcome(task, "failed", error_id=error_id)
        finally:
            hold.release(spent)

        counts = ctx.totals.counts
        counts.researched += 1
        counts.by_result[card.result] = counts.by_result.get(card.result, 0) + 1
        await ctx.emit_event(
            CompanyDoneData(
                name=name,
                lead_id=card.id,
                result=card.result,
                score=card.score,
                cost_usd=card.research.cost_usd,
                hubspot_status=card.hubspot.status,
            )
        )
        return outcome(task, "done", lead_id=str(card.id), result=card.result)
