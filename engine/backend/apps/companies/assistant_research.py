"""Research in the Assistant (PLAN-V27 Part 4, choices 17 to 20): "Research Northwind".

**What we know, at once and free** (choice 17, `research_command` and `known_research`): no Claude
request. The company is found as other commands find it (assistant_find.py). Then, from our
copies only:

- HubSpot's view: new, in HubSpot, an open deal, a dissolved deal, quiet (nobody has worked it for
  `hubspot_quiet_months`, `core/hubspot/quiet.py`) or a maybe, with the day it was last worked;
- for people with a Lead Finder tick, through the project's hook (`CompanyLeads.research`): its
  lead card from the last 30 days, and Property Daily's (or Arealytics') lease end and size from
  our copy (`core/sources/store.records_for`), each with its day and source.

**What happens next** (choice 18): a lead card from the last 30 days opens (`open_lead`, no cost);
a HubSpot company that isn't quiet opens its call prep (`open_prep`); a new or quiet one asks first
(`ask`: "Research Northwind? About US$0.40."); more than one company that may be meant asks which
(`choose`, best guess first); no name asks for one (`needs_name`).

**Starting it** (choices 19 and 20, `start_research`): a run of one company through the run
manager, so the company cap, the run cap, the run limit and the daily limit apply as to any run.
The run is marked `from_assistant`, so it asks Claude in the People lane behind people's own
requests, with at most 2 places. Only with the Lead Finder's Start a run tick, never a Viewer.

The Companies project never imports the Lead Finder: the hook gives the run's mode and params, and
the lead card. A name the rep asks to research is treated like a name typed on the Lead Finder's
Start page.
"""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import ROUND_UP, Decimal
from typing import Any, Final, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant_find import (
    SAME_COMPANY,
    Context,
    EstimateFn,
    OnScreen,
    company_hit,
    find_company,
    heard,
    means_same,
    on_screen,
)
from apps.companies.assistant_form import CommandAnswer
from apps.companies.assistant_rank import ON_SCREEN
from apps.companies.assistant_schemas import (
    AssistantAction,
    AssistantCommand,
    AssistantCompany,
    AssistantResearch,
    AssistantResearchIn,
    AssistantResearchStarted,
    ResearchCard,
    ResearchFact,
    ResearchHubSpot,
    ResearchNext,
)
from apps.companies.notes import MELBOURNE
from apps.companies.schemas import CompanyHit
from apps.companies.store import valid_key
from core.api.access import can_feature
from core.api.errors import Problem
from core.auth.features import is_viewer
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads, CompanyResearch, RecentCard
from core.config import Settings
from core.hubspot.matching import clean_name, match_company
from core.hubspot.quiet import quiet_status
from core.runs.schemas import RunCreate, RunOut
from core.sources.store import records_for
from core.sources.types import SOURCE_NAMES, PropertyRecord

log = logging.getLogger(__name__)

RECENT_DAYS: Final = 30  # a lead card this new opens instead of a new research (choice 18)
COST_USD: Final = Decimal("0.40")  # the plan's figure, when past research gives none (TBC)
ESTIMATE_SECONDS: Final = 1.0  # the most the cost may add to the answer (choice 17: under 1 s)
CENT: Final = Decimal("0.01")
START_FEATURE: Final = "lead_finder.start_run"
# Words that mean the company on screen, once tidied and lower case: "research it".
THIS_ONE: Final = frozenset({"it", "this", "this one", "this company", "that one"})
TIER_WORDS: Final = {"A": "an A lead", "B": "a B lead", "C": "a C lead", "discard": "discarded"}
RESULT_WORDS: Final = {
    "pass": "Pass",
    "director_review": "Director review",
    "watch": "Watch",
    "drop": "Drop",
}

# --- The words (PLAN-V27 "Words on screen") ------------------------------------------------------

NEEDS_LEAD_FINDER = "Researching a new company needs the Lead Finder. Ask your Platform admin."
SAY_THE_NAME = "Say the company's name to research it."  # HubSpot names stay out of Claude
NO_NAME = "Research which company? Say or type its name."


def needs_lead_finder() -> Problem:
    return Problem(403, "Not open to you", NEEDS_LEAD_FINDER, code="feature_not_allowed")


def bad_name() -> Problem:
    return Problem(
        422,
        "That name can't be researched",
        "Use the company's name: 2 to 80 characters and at most 8 words, with a city that is a "
        "place name.",
        code="research_name",
    )


def say_the_name() -> Problem:
    """A HubSpot company with no words of the rep's while HubSpot names may not go to Claude."""
    return Problem(422, "Say the company's name", SAY_THE_NAME, code="research_name")


def day_words(day: date, today: date) -> str:
    """'3 Oct', or '3 Oct 2025' in another year. Words, so a date never looks like a number."""
    return f"{day.day} {day:%b}" if day.year == today.year else f"{day.day} {day:%b %Y}"


def month_words(day: date) -> str:
    """'March 2028'."""
    return f"{day:%B %Y}"


def dollars(amount: Decimal) -> str:
    """'US$0.40': up to the cent, never less than it costs."""
    return f"US${amount.quantize(CENT, ROUND_UP):,.2f}"


# --- Who may start one -------------------------------------------------------------------------


def research_hook(leads: Sequence[CompanyLeads]) -> tuple[str, CompanyResearch] | None:
    """The project that researches companies (the Lead Finder), when this person may see it."""
    for project in leads:
        if project.research is not None:
            return project.app, project.research
    return None


def may_start(auth: AuthContext | None, leads: Sequence[CompanyLeads]) -> bool:
    """The Lead Finder's Start a run tick (an Admin has every tick), and not a Viewer. With
    sign-in off, anyone may."""
    if research_hook(leads) is None:
        return False
    if auth is None:
        return True
    return not is_viewer(auth.user.role) and can_feature(auth, START_FEATURE)


# --- What we know --------------------------------------------------------------------------------


async def hubspot_view(
    session: AsyncSession, hit: CompanyHit | None, settings: Settings, today: date
) -> tuple[ResearchHubSpot, date | None]:
    """HubSpot's view of the company, with the quiet rule, and the day it was last worked."""
    if hit is None or hit.source != "hubspot":
        return "new", None
    match = await match_company(session, hit.name, hubspot_id=hit.key)
    if match.hubspot_id is None:  # gone from our copy since it was found
        return "new", None
    checked = await quiet_status(session, match, settings.hubspot_quiet_months, today)
    status = checked.status
    if status == "possible_match":  # a match by id never is one
        return "new", None
    return status, checked.last_activity


def hubspot_line(name: str, status: ResearchHubSpot, last: date | None, today: date) -> str:
    """The card's HubSpot line, like 'Northwind: not in HubSpot.'"""
    if status == "new":
        return f"{name}: not in HubSpot."
    if status == "possible_match":
        return f"{name} may be in HubSpot."
    if status == "open_deal":
        return f"{name} is in HubSpot, with an open deal."
    if status == "quiet":
        since = f"quiet since {month_words(last)}" if last is not None else "never worked"
        return f"{name} is in HubSpot, {since}."
    worked = f" Last activity {day_words(last, today)}." if last is not None else ""
    return f"{name} is in HubSpot.{worked}"


def card_line(card: RecentCard, today: date) -> str:
    """'Lead Finder, 20 Nov: a B lead.'"""
    when = day_words(card.found_at.astimezone(MELBOURNE).date(), today)
    what = TIER_WORDS.get(card.tier or "") or RESULT_WORDS.get(card.result, card.result)
    return f"Lead Finder, {when}: {what}."


def record_day(record: PropertyRecord) -> date:
    return record.happened_on or record.published_on or record.read_at.date()


async def property_facts(
    session: AsyncSession, names: Sequence[str], city: str | None, today: date
) -> tuple[date | None, int | None, list[ResearchFact]]:
    """The newest lease end and size our copy of Property Daily and Arealytics has, each with its
    day and source. Free: no page is read."""
    records: list[PropertyRecord] = []
    for key in dict.fromkeys(clean_name(name) for name in names if clean_name(name)):
        records += await records_for(session, key, city)
    lease = next((record for record in records if record.lease_end is not None), None)
    size = next((record for record in records if record.area_m2), None)
    facts: list[ResearchFact] = []
    if lease is not None and lease.lease_end is not None:
        day = record_day(lease)
        source = SOURCE_NAMES[lease.source]
        ends = month_words(lease.lease_end)
        facts.append(
            ResearchFact(
                kind="lease_end",
                text=f"{source}, {day_words(day, today)}: lease ends {ends}.",
                day=day,
                source=source,
                url=lease.url,
            )
        )
    if size is not None and size.area_m2:
        day = record_day(size)
        source = SOURCE_NAMES[size.source]
        facts.append(
            ResearchFact(
                kind="size",
                text=f"{source}, {day_words(day, today)}: an office of {size.area_m2:,} m².",
                day=day,
                source=source,
                url=size.url,
            )
        )
    return (
        lease.lease_end if lease is not None else None,
        size.area_m2 if size is not None else None,
        facts,
    )


async def cost_of_one(
    estimate_run: EstimateFn | None, project: str, hook: CompanyResearch, name: str
) -> Decimal:
    """About what one company's research costs: the run estimate's typical cost (past research,
    else the settings), within a second, else the plan's US$0.40."""
    if estimate_run is None:
        return COST_USD
    body = RunCreate(app=project, mode=hook.mode, params=hook.params(name, None))
    try:
        async with asyncio.timeout(ESTIMATE_SECONDS):
            estimate = await estimate_run(body)
    except Exception as error:  # the cost is a hint: the answer never waits on it or fails
        log.info("research_cost_unknown", extra={"kind": type(error).__name__})
        return COST_USD
    if not estimate.valid or estimate.cost_usd_low <= 0:
        return COST_USD
    return estimate.cost_usd_low.quantize(CENT, ROUND_UP)


def next_step(status: ResearchHubSpot, card: RecentCard | None) -> ResearchNext:
    """A lead card from the last 30 days first, then call prep for a HubSpot company that isn't
    quiet, else ask (choice 18)."""
    if card is not None:
        return "open_lead"
    if status in ("in_hubspot", "open_deal", "dissolved_deal"):
        return "open_prep"
    return "ask"


async def settled(
    session: AsyncSession,
    *,
    name: str,
    hit: CompanyHit | None,
    ctx: Context,
    words: str | None = None,
) -> AssistantResearch:
    """What we know of one company, and what happens next. Free: our copies only, and the run
    estimate's cost (two small reads) when the card will ask."""
    hook = research_hook(ctx.leads)
    can = may_start(ctx.auth, ctx.leads)
    status, last = await hubspot_view(session, hit, ctx.settings, ctx.today)
    shown = hit.name if hit is not None else name
    known = [
        ResearchFact(
            kind="hubspot",
            text=hubspot_line(shown, status, last, ctx.today),
            day=last,
            source="HubSpot",
            url=None,
        )
    ]
    card: RecentCard | None = None
    lease_end: date | None = None
    area: int | None = None
    if hook is not None:  # the Lead Finder's own facts: only for people with one of its ticks
        hubspot_id = hit.key if hit is not None and hit.source == "hubspot" else None
        lead_id = lead_of(hit)
        since = ctx.now - timedelta(days=RECENT_DAYS)
        card = await hook[1].recent(session, hubspot_id, name, lead_id, since)
        if card is not None:
            known.append(
                ResearchFact(
                    kind="lead",
                    text=card_line(card, ctx.today),
                    day=card.found_at.astimezone(MELBOURNE).date(),
                    source="Lead Finder",
                    url=None,
                )
            )
        names = [name] + ([hit.name] if hit is not None else [])
        lease_end, area, facts = await property_facts(
            session, names, hit.city if hit is not None else None, ctx.today
        )
        known += facts
    step = next_step(status, card)
    sent = run_name(hit, name if words is None else words, ctx.settings)
    blocked: str | None = None if can else NEEDS_LEAD_FINDER
    if not sent:  # "research" on a HubSpot company's page: its name can't go to Claude
        can, blocked = False, SAY_THE_NAME
    cost: Decimal | None = None
    question: str | None = None
    if step == "ask" and can and hook is not None:
        if session.in_transaction():
            await session.rollback()  # it only read: no connection waits on the estimate
        cost = await cost_of_one(ctx.estimate, hook[0], hook[1], name)
        question = f"Research {shown}? About {dollars(cost)}."
    return AssistantResearch(
        company=sent,
        company_key=hit.key if hit is not None else None,
        city=hit.city if hit is not None else None,
        hubspot=status,
        last_activity=last,
        lead=as_card(card),
        lease_end=lease_end,
        area_m2=area,
        known=known,
        next=step,
        question=question,
        cost_usd=cost,
        can_start=can,
        blocked=blocked,
    )


def run_name(hit: CompanyHit | None, words: str, settings: Settings) -> str:
    """The name the research run sends to Claude. A name from our HubSpot copy goes to Claude
    only with `hubspot_names_to_claude_ok`, as in a run; with it off, the run gets the words as
    said (the rep's own), so HubSpot's spelling never leaves (rule-change: "HubSpot names reach
    Claude only when HUBSPOT_NAMES_TO_CLAUDE_OK is on")."""
    if hit is None:
        return words
    if hit.source == "hubspot" and not settings.hubspot_names_to_claude_ok:
        return words
    return hit.name


def lead_of(hit: CompanyHit | None) -> uuid.UUID | None:
    if hit is None or not hit.key.startswith("lead:"):
        return None
    try:
        return uuid.UUID(hit.key.removeprefix("lead:"))
    except ValueError:
        return None


def as_card(card: RecentCard | None) -> ResearchCard | None:
    if card is None:
        return None
    return ResearchCard(
        lead_id=card.lead_id,
        found_on=card.found_at.astimezone(MELBOURNE).date(),
        result=card.result,
        tier=card.tier,
        link=card.link,
    )


def research_card(
    read_back: str,
    research: AssistantResearch,
    *,
    company: AssistantCompany | None = None,
    unsure: str | None = None,
) -> AssistantCommand:
    """The command for a research: what we know is in `research`, the company in `company`."""
    action: AssistantAction = "research"
    return AssistantCommand(
        action=action,
        read_back=read_back,
        company=company,
        person=None,
        meeting=None,
        note_text=None,
        task=None,
        email=None,
        open=None,
        change=None,
        unsure=unsure,
        research=research,
    )


def read_back(research: AssistantResearch, name: str, ctx: Context) -> tuple[str, str | None]:
    """The card's first line, and its unsure line."""
    if research.next == "open_lead" and research.lead is not None:
        when = day_words(research.lead.found_on, ctx.today)
        return f"{name} has a lead card from {when}. Opening it.", None
    if research.next == "open_prep":
        return f"{name} is in HubSpot. Opening its call prep.", None
    if research.question is not None:
        return research.question, None
    return research.known[0].text, research.blocked


def nothing_named(ctx: Context) -> AssistantResearch:
    return AssistantResearch(
        company="",
        company_key=None,
        city=None,
        hubspot=None,
        last_activity=None,
        lead=None,
        lease_end=None,
        area_m2=None,
        known=[],
        next="needs_name",
        question=None,
        cost_usd=None,
        can_start=may_start(ctx.auth, ctx.leads),
        blocked=None,
    )


def several(words: str, ctx: Context, line: str | None) -> AssistantResearch:
    """More than one company may be meant: the card shows the choices, best guess first (in the
    command's `company`), and 'It's new' when none is right."""
    can = may_start(ctx.auth, ctx.leads)
    return AssistantResearch(
        company="",
        company_key=None,
        city=None,
        hubspot="possible_match",
        last_activity=None,
        lead=None,
        lease_end=None,
        area_m2=None,
        known=[
            ResearchFact(
                kind="hubspot",
                text=line or f"{words} may be in HubSpot.",
                day=None,
                source="HubSpot",
                url=None,
            )
        ],
        next="choose",
        question=None,
        cost_usd=None,
        can_start=can,
        blocked=None if can else NEEDS_LEAD_FINDER,
    )


async def research_command(
    session: AsyncSession, answer: CommandAnswer, ctx: Context
) -> AssistantCommand:
    """'Research Northwind', settled from what we know. 'Research' alone uses the company on
    screen, else asks for a name."""
    words = heard(answer.company)
    last_named = ctx.last is not None and bool(ctx.last.company_key)
    if words.casefold() in THIS_ONE or (means_same(words, SAME_COMPANY) and not last_named):
        words = ""  # the company on screen; "them" with no last turn means it too
    screen: OnScreen = await on_screen(session, ctx)
    if not words and screen.company is None:
        return research_card(NO_NAME, nothing_named(ctx))
    if not words:
        company = AssistantCompany(
            heard="",
            from_page=True,
            found=screen.company,
            choices=[],
            level="sure",
            reason=ON_SCREEN,
        )
    else:
        company, line = await find_company(session, words, screen.company, ctx)
        if company.found is None and company.choices:
            research = several(words, ctx, line)
            return research_card(research.known[0].text, research, company=company)
    hit = company.found
    name = hit.name if hit is not None else words
    research = await settled(session, name=name, hit=hit, ctx=ctx, words=words)
    first, unsure = read_back(research, hit.name if hit is not None else words, ctx)
    return research_card(first, research, company=company, unsure=unsure)


async def known_research(
    session: AsyncSession, name: str, company_key: str | None, ctx: Context
) -> AssistantResearch:
    """What we know of one company the card has settled: the choice picked (`company_key`), or a
    new company by its name. Free."""
    hit: CompanyHit | None = None
    if company_key:
        hit = await company_hit(session, company_key, ctx.leads)
        if hit is None:
            raise Problem(
                404,
                "Company not found",
                "That company isn't in our HubSpot copy any more. Say or type its name again.",
                code="company_not_found",
            )
    words = heard(name)
    if hit is None and not words:
        return nothing_named(ctx)
    return await settled(
        session, name=hit.name if hit is not None else words, hit=hit, ctx=ctx, words=words
    )


# --- Starting it ---------------------------------------------------------------------------------


class RunStarter(Protocol):
    """What starts a run: the run manager (a test passes a fake)."""

    async def start(
        self,
        app: str,
        mode: str,
        params: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> RunOut: ...


async def start_research(
    session: AsyncSession,
    body: AssistantResearchIn,
    *,
    runs: RunStarter,
    auth: AuthContext | None,
    leads: Sequence[CompanyLeads],
    key: str | None,
    settings: Settings,
) -> AssistantResearchStarted:
    """A run of one company, in the background (choices 19 and 20). The run manager checks its
    params and limits as for any run: 409 `run_already_active` while the run limit is full, and
    the caps and the daily limit stop it as they stop a run."""
    hook = research_hook(leads)
    if hook is None or not may_start(auth, leads):
        raise needs_lead_finder()
    if body.company_key and not valid_key(body.company_key):
        raise bad_name()
    project, research = hook
    name = " ".join(body.company.split())
    if body.company_key:  # the server, not the card, says which name goes to Claude
        hit = await company_hit(session, body.company_key, leads)
        if hit is not None and hit.source == "hubspot":
            name = " ".join(run_name(hit, heard(body.said or ""), settings).split())
            if not name:
                raise say_the_name()
    city = " ".join(body.city.split()) if body.city else None
    if session.in_transaction():
        await session.rollback()  # no connection waits on the run's start
    try:
        run = await runs.start(project, research.mode, research.params(name, city), key)
    except Problem as problem:
        if problem.status == 422 and "errors" in problem.extra:  # the run's own field check
            raise bad_name() from None
        raise
    log.info("assistant_research_started", extra={"run_id": str(run.id)})
    return AssistantResearchStarted(run_id=run.id, company=name, status=run.status)
