"""Search ahead (PLAN-V10 D5): call scripts made each weekday morning, before anyone asks, for the
companies most likely to be called.

- **When:** every day at 6:30 am Melbourne time, after the 6:00 HubSpot sync. On a Saturday or a
  Sunday it skips itself. It is off until Al-khair switches it on (Admin, Schedules).
- **Which companies:** those with an open deal, then the Lead Finder's good leads. Each prep is
  for the person on the last logged call, or a cold call when nobody is named.
- **Skips** a company with a prep, or saved news, under 7 days old (`prep_reuse_days`).
- **Stops** at its own daily cap (`search_ahead_cap_usd`, US$5 TBC), and at the daily limit for
  all Claude spending. Each prep also keeps to its own cap.

Its preps show "Ready. Searched ahead at 6:30." They are made without the Lead Finder's facts
for HubSpot companies, so everyone with the Companies tick may reuse them.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies.deals import CLOSED_STAGES
from apps.companies.prep import APP, PrepContext, PrepRunner
from apps.companies.tables import Prep
from core.claude.client import get_claude
from core.company_leads import CompanyLeads
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.hubspot.models import HubSpotCall, HubSpotCompany, HubSpotContact, HubSpotDeal
from core.memory.embedder import get_embedder
from core.memory.models import MemoryItem
from core.prefs.service import effective_settings
from core.runs.estimate import spent_last_24h
from core.schedules.calc import Cadence
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSettingsError,
    JobSkipped,
    JobSpec,
)
from core.searches.models import SearchLog

log = logging.getLogger(__name__)

SEARCH_AHEAD = "companies.search_ahead"
MELBOURNE = ZoneInfo("Australia/Melbourne")
MAX_COMPANIES = 60  # the most one morning looks at; the cap usually stops it first
TYPICAL_PREP_USD = Decimal("0.10")  # TBC: E3 measures real preps
NOTE = "search ahead"


@dataclass(frozen=True)
class Target:
    company_key: str
    company_name: str
    contact_id: str | None
    lead_only: bool


def _state(app: FastAPI) -> dict[str, Any]:
    state: dict[str, Any] | None = getattr(app.state, "search_ahead", None)
    if state is None:
        state = {"task": None}
        app.state.search_ahead = state
    return state


def _sessions(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    found: async_sessionmaker[AsyncSession] | None = getattr(app.state, "session_factory", None)
    return found or get_sessionmaker()


def _runner(app: FastAPI) -> PrepRunner:
    runner: PrepRunner | None = getattr(app.state, "prep_runner", None)
    if runner is None:
        runner = PrepRunner(sessions=_sessions(app), claude=get_claude, embedder=get_embedder)
        app.state.prep_runner = runner
    return runner


def _lead_hooks(app: FastAPI) -> list[CompanyLeads]:
    return [spec.company_leads for spec in getattr(app.state, "apps", []) if spec.company_leads]


def melbourne_midnight(now: datetime) -> datetime:
    local = now.astimezone(MELBOURNE)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


async def spent_today(session: AsyncSession, now: datetime) -> Decimal:
    """What search ahead has spent since midnight in Melbourne."""
    total = await session.scalar(
        select(func.coalesce(func.sum(SearchLog.cost_usd), 0)).where(
            SearchLog.app == APP,
            SearchLog.note == NOTE,
            SearchLog.created_at >= melbourne_midnight(now),
        )
    )
    return Decimal(total or 0)


async def fresh(session: AsyncSession, target: Target, *, days: int, now: datetime) -> bool:
    """A prep or saved news under `days` old: nothing new to find yet."""
    since = now - timedelta(days=days)
    prep = await session.scalar(
        select(Prep.id)
        .where(
            Prep.company_key == target.company_key,
            Prep.status.in_(("ready", "searching")),
            Prep.created_at >= since,
        )
        .limit(1)
    )
    if prep is not None:
        return True
    news = await session.scalar(
        select(MemoryItem.id)
        .where(
            MemoryItem.kind == "source_note",
            func.lower(MemoryItem.subject) == target.company_name.lower(),
            MemoryItem.created_at >= since,
        )
        .limit(1)
    )
    return news is not None


async def pick_targets(
    session: AsyncSession, hooks: list[CompanyLeads], limit: int = MAX_COMPANIES
) -> list[Target]:
    """Companies with an open deal (the soonest close date first), then good leads not in
    HubSpot (the newest first). Each with the person on its last logged call, if any."""
    deal = HubSpotDeal
    open_deal = func.lower(func.coalesce(deal.stage, "")).not_in(sorted(CLOSED_STAGES))
    rows = await session.execute(
        select(HubSpotCompany.hubspot_id, HubSpotCompany.name, func.min(deal.close_date))
        .join(deal, deal.hubspot_company_id == HubSpotCompany.hubspot_id)
        .where(open_deal)
        .group_by(HubSpotCompany.hubspot_id, HubSpotCompany.name)
        .order_by(func.min(deal.close_date).asc().nulls_last(), HubSpotCompany.name)
        .limit(limit)
    )
    targets: list[Target] = []
    for key, name, _ in rows:
        contact = await session.scalar(
            select(HubSpotCall.hubspot_contact_id)
            .where(
                HubSpotCall.hubspot_company_id == key,
                HubSpotCall.hubspot_contact_id.is_not(None),
                exists().where(HubSpotContact.hubspot_id == HubSpotCall.hubspot_contact_id),
            )
            .order_by(HubSpotCall.called_at.desc().nulls_last())
            .limit(1)
        )
        targets.append(Target(key, name, contact, lead_only=False))
    for hook in hooks:
        leads = hook.lead_only().subquery("lead_only")
        found = await session.execute(
            select(leads.c.key, leads.c.name)
            .order_by(leads.c.found_at.desc())
            .limit(max(0, limit - len(targets)))
        )
        targets += [Target(key, name, None, lead_only=True) for key, name in found]
    return targets[:limit]


@dataclass
class Morning:
    prepped: int = 0
    skipped: int = 0
    spent_usd: Decimal = Decimal(0)
    stopped: str | None = None


async def search_ahead(app: FastAPI, settings: Settings, now: datetime | None = None) -> Morning:
    """One morning's search ahead, to the end. The preps run one after the other."""
    now = now or datetime.now(UTC)
    sessions = _sessions(app)
    runner = _runner(app)
    hooks = _lead_hooks(app)
    morning = Morning()
    async with sessions() as session:
        targets = await pick_targets(session, hooks)
    for target in targets:
        async with sessions() as session:
            spent = await spent_today(session, now)
            left = settings.search_ahead_cap_usd - spent
            if left <= 0:
                morning.stopped = f"It stopped at its US${settings.search_ahead_cap_usd:.2f} cap."
                break
            if await fresh(session, target, days=settings.prep_reuse_days, now=now):
                morning.skipped += 1
                continue
            prep = Prep(
                company_key=target.company_key,
                company_name=target.company_name,
                contact_id=target.contact_id,
                kind="person" if target.contact_id else "cold",
                trigger="search_ahead",
                status="searching",
                stage=0,
                facts={"leads_used": target.lead_only},
            )
            if target.contact_id:
                contact = await session.get(HubSpotContact, target.contact_id)
                prep.person_name = contact.name if contact else None
                prep.person_title = contact.job_title if contact else None
            session.add(prep)
            await session.commit()
            prep_id = prep.id
        context = PrepContext(
            # A HubSpot company's prep leaves the Lead Finder out, so everyone may reuse it.
            hooks=hooks if target.lead_only else [],
            names_ok=settings.hubspot_names_to_claude_ok,
            cap_usd=min(settings.prep_cap_usd, left),
            max_searches=settings.prep_max_searches,
            reuse_days=settings.prep_reuse_days,
            model=settings.model_prep or settings.claude_model,
            trigger="search_ahead",
        )
        await runner.run(prep_id, context)
        async with sessions() as session:
            done = await session.get(Prep, prep_id)
            if done is not None:
                morning.spent_usd += done.cost_usd
                if done.status == "ready":
                    morning.prepped += 1
                elif done.error and "daily limit" in done.error:
                    morning.stopped = "It stopped at the daily limit for all Claude spending."
                    break
    log.info(
        "search_ahead_done",
        extra={
            "prepped": morning.prepped,
            "skipped": morning.skipped,
            "spent_usd": str(morning.spent_usd),
        },
    )
    return morning


async def _settings(app: FastAPI) -> Settings:
    async with _sessions(app)() as session:
        return await effective_settings(session)


async def start_search_ahead(context: JobContext) -> JobResult:
    local = context.now.astimezone(MELBOURNE)
    if local.weekday() >= 5:
        raise JobSkipped("It's the weekend. Search ahead runs on weekdays.")
    settings = await _settings(context.app)
    if not settings.prep_enabled:
        raise JobSkipped("Call prep is switched off in Admin, Settings.")
    state = _state(context.app)
    task: asyncio.Task[Morning] | None = state["task"]
    if task is not None and not task.done():
        raise JobSkipped("This morning's search ahead is still running.")
    async with _sessions(context.app)() as session:
        if await spent_today(session, context.now) >= settings.search_ahead_cap_usd:
            raise JobSkipped("Today's search ahead has already spent its cap.")
    state["task"] = asyncio.create_task(search_ahead(context.app, settings, context.now))
    return JobResult(ref=f"search-ahead:{local.date().isoformat()}")


async def search_ahead_running(context: JobContext) -> bool:
    task: asyncio.Task[Morning] | None = _state(context.app)["task"]
    return task is not None and not task.done()


async def estimate_search_ahead(context: JobContext) -> JobEstimate:
    settings = await _settings(context.app)
    async with _sessions(context.app)() as session:
        left = max(Decimal(0), settings.daily_cap_usd - await spent_last_24h(session))
        spent = await spent_today(session, context.now)
        candidates = len(await pick_targets(session, _lead_hooks(context.app)))
    cap = settings.search_ahead_cap_usd
    problem = None
    if not settings.prep_enabled:
        problem = "Call prep is switched off in Admin, Settings."
    elif spent >= cap:
        problem = "Today's search ahead has already spent its cap."
    elif left <= 0:
        problem = "The daily limit for all Claude spending is used up."
    typical = min(cap, TYPICAL_PREP_USD * candidates)
    return JobEstimate(
        valid=True,
        problem=problem,
        typical_usd=typical,
        worst_usd=cap,
        cap_usd=cap,
        daily_left_usd=left,
        basis=(
            f"About US${TYPICAL_PREP_USD:.2f} a prep (TBC), for up to {candidates} companies. "
            "Companies prepped in the last week are skipped."
        ),
    )


def describe_search_ahead(settings: dict[str, Any]) -> str:
    return (
        "Preps calls for companies with an open deal and the Lead Finder's good leads, on "
        "weekdays, within its own daily cap."
    )


def check_search_ahead_settings(settings: dict[str, Any]) -> dict[str, Any]:
    if settings:
        raise JobSettingsError("Search ahead has no choices here. Its cap is on Admin, Settings.")
    return {}


JOBS = (
    JobSpec(
        key=SEARCH_AHEAD,
        project="companies",
        title="Call prep: search ahead",
        start=start_search_ahead,
        running=search_ahead_running,
        default=DefaultSchedule(
            cadence=Cadence(every=1, unit="days", at=time(6, 30)), enabled=False
        ),
        estimate=estimate_search_ahead,
        describe=describe_search_ahead,
        check_settings=check_search_ahead_settings,
    ),
)
