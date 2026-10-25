"""Research one company: one company in, one lead card out.

The steps, in order:
1. Memory first: reuse fresh notes about this company, so we don't pay to find them again.
2. Search: one Claude request per angle (property, people, money) that memory didn't cover.
3. Fill the answer form from the notes, then check every fact's source.
4. Gap check: if the city, size or a trigger is missing, one more targeted search. Then stop.
5. Match HubSpot, apply the rules and the score, and save the card, the log and the memory.

The steps are plain async functions. Phase 2 runs them for many companies at once.
"""

import asyncio
import logging
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.fields import AngleNotes, CompanyFacts, Fact
from apps.lead_finder.prompts import Prompt, extract_prompt, research_prompt, versions
from apps.lead_finder.rules import LeadFinderRules, Result
from apps.lead_finder.scoring import RuleCheck, TriggerScore, judge, parse_date
from apps.lead_finder.sources import check_sources, missing_facts, url_key
from apps.lead_finder.tables import Lead
from core.claude.budget import Budget, BudgetSpent
from core.claude.client import Claude, ClaudeError, ClaudeUnavailable, Reply, WebTools
from core.config import Settings
from core.hubspot.matching import HubSpotMatch, match_company
from core.memory.embedder import Embedder
from core.memory.service import Note as MemoryNote
from core.memory.service import recent, remember_many
from core.searches.service import log_reply

APP = "lead_finder"
SearchAngle = Literal["property", "people", "money"]
ANGLES: tuple[SearchAngle, ...] = ("property", "people", "money")
ANGLE_FOCUS = {
    "property": "its offices: where they are, how big (m² or floors), who owns the building, "
    "the lease and when it ends, and any move, new office, refit or merging of offices",
    "people": "its staff: how many work in each Australian city, hiring, growth, return to "
    "office, restructures, staff cuts, and a new CEO",
    "money": "its business: big new contracts, takeovers and mergers, fast growth, money "
    "raised, profit, and any administration",
}
log = logging.getLogger(__name__)


class ResearchRequest(BaseModel):
    company: str = Field(min_length=2, max_length=300, examples=["Culture Amp"])
    city: str | None = Field(default=None, max_length=120, examples=["Melbourne"])
    website: str | None = Field(default=None, max_length=300, examples=["cultureamp.com"])
    use_memory: bool = Field(
        default=True, description="false searches the web again, even with fresh notes"
    )


class HubSpotOut(BaseModel):
    status: str
    hubspot_id: str | None
    name: str | None
    owner: str | None
    matched_by: str | None
    open_deals: list[str]
    last_dissolved: date | None


class ResearchCost(BaseModel):
    cost_usd: Decimal
    cap_usd: Decimal
    web_searches: int
    claude_requests: int
    angles_from_memory: list[str]


class LeadCard(BaseModel):
    id: uuid.UUID
    company: str
    result: Result
    score: int = Field(description="0 to 100. Stronger and newer signs rank higher.")
    summary: str
    why_it_fits: str
    contact_role: str | None
    opening_line: str | None
    checks: list[RuleCheck] = Field(description="Each rule, and how this company did")
    triggers: list[TriggerScore]
    office_m2: int | None
    office_m2_estimated: bool
    fitout_aud: Decimal | None
    facts: CompanyFacts
    hubspot: HubSpotOut
    dropped: list[str] = Field(description="Facts the source check removed, and why")
    problems: list[str] = Field(description="Searches that failed, or caps that were reached")
    research: ResearchCost
    rules_version: str
    prompt_version: str
    created_at: datetime


@dataclass(frozen=True)
class FoundNote:
    claim: str
    url: str
    published: str | None
    angle: str
    from_memory: bool


@dataclass
class Job:
    """Everything one research request collects along the way."""

    id: uuid.UUID
    request: ResearchRequest
    rules: LeadFinderRules
    budget: Budget
    today: date
    notes: list[FoundNote]
    replies: list[tuple[str, Reply[Any]]]
    problems: list[str]


async def research_company(
    session: AsyncSession,
    embedder: Embedder,
    claude: Claude,
    rules: LeadFinderRules,
    settings: Settings,
    request: ResearchRequest,
    today: date | None = None,
) -> LeadCard:
    now = datetime.now(UTC)
    job = Job(
        id=uuid.uuid4(),
        request=request,
        rules=rules,
        budget=Budget(settings.company_cap_usd, settings.company_max_searches),
        today=today or now.date(),
        notes=[],
        replies=[],
        problems=[],
    )
    company = request.company.strip()

    # 1. Memory first
    covered: set[str] = set()
    if request.use_memory:
        since = now - timedelta(days=settings.memory_fresh_days)
        for item in await recent(
            session, app=APP, kind="source_note", subject=company, since=since
        ):
            angle = str(item.meta.get("angle", ""))
            if item.url:
                published = item.source_date.isoformat() if item.source_date else None
                job.notes.append(FoundNote(item.content, item.url, published, angle, True))
                covered.add(angle)

    # 2. Search the angles memory didn't cover
    try:
        todo = [angle for angle in ANGLES if angle not in covered]
        await _search(job, claude, settings, [(a, _angle_prompt(a, job)) for a in todo])

        # 3. Fill the form, and check the sources
        prompt = extract_prompt(rules)
        facts, dropped = await _fill_form(job, claude, prompt)

        # 4. Gap check: one more targeted search, then stop
        missing = missing_facts(facts)
        if missing and job.notes:
            before = len(job.notes)
            await _search(job, claude, settings, [("gaps", _gap_prompt(missing, job))])
            if len(job.notes) > before:
                facts, dropped = await _fill_form(job, claude, prompt)
    finally:
        _log_replies(session, job)
        await session.commit()  # the money is spent, so the log is saved even after an error

    # 5. HubSpot, rules, score, save
    hubspot = await match_company(session, facts.name or company, facts.website.value)
    verdict = judge(facts, hubspot, rules, job.today)
    card = LeadCard(
        id=job.id,
        company=facts.name or company,
        result=verdict.result,
        score=verdict.score,
        summary=facts.summary,
        why_it_fits=_why(verdict.checks, verdict.result),
        contact_role=facts.contact_role,
        opening_line=facts.opening_line,
        checks=verdict.checks,
        triggers=verdict.triggers,
        office_m2=verdict.office_m2,
        office_m2_estimated=verdict.office_m2_estimated,
        fitout_aud=verdict.fitout_aud,
        facts=facts,
        hubspot=HubSpotOut(**asdict(hubspot)),
        dropped=dropped,
        problems=job.problems,
        research=ResearchCost(
            cost_usd=job.budget.spent_usd,
            cap_usd=job.budget.cap_usd,
            web_searches=job.budget.searches,
            claude_requests=len(job.replies),
            angles_from_memory=sorted(covered),
        ),
        rules_version=rules.version,
        prompt_version=versions(rules),
        created_at=now,
    )
    await _save(session, embedder, job, card, hubspot, company)
    return card


# --- Steps ---------------------------------------------------------------------------------


async def _search(
    job: Job, claude: Claude, settings: Settings, prompts: list[tuple[str, str]]
) -> None:
    """One Claude request per angle, side by side. Notes with unseen links are dropped."""

    async def one(angle: str, prompt: str) -> tuple[str, Reply[AngleNotes] | None]:
        try:
            granted = job.budget.reserve_searches(settings.searches_per_request)
        except BudgetSpent as stop:
            job.problems.append(f"{angle}: skipped. {stop}.")
            return angle, None
        try:
            reply = await claude.ask(
                system=research_prompt().text,
                prompt=prompt,
                form=AngleNotes,
                web=WebTools(max_searches=granted, max_fetches=settings.fetches_per_request),
            )
        except ClaudeUnavailable:
            job.budget.release(granted)
            raise
        except ClaudeError as error:
            job.budget.release(granted)
            job.problems.append(f"{angle}: {error.title}. {error.detail}")
            return angle, None
        job.budget.record(reply, reserved=granted)
        return angle, reply

    results = await asyncio.gather(*(one(a, p) for a, p in prompts), return_exceptions=True)
    unavailable: BaseException | None = None
    for result in results:
        if isinstance(result, BaseException):
            unavailable = unavailable or result
            continue
        angle, reply = result
        if reply is None:
            continue
        job.replies.append((f"search:{angle}", reply))
        if reply.parsed is None:
            job.problems.append(f"{angle}: the answer didn't fit the form ({reply.stop_reason}).")
            continue
        seen = {url_key(source.url) for source in reply.sources}
        for note in reply.parsed.notes:
            if url_key(note.url) in seen:
                job.notes.append(FoundNote(note.claim, note.url, note.published, angle, False))
    if unavailable is not None:
        raise unavailable


async def _fill_form(job: Job, claude: Claude, prompt: Prompt) -> tuple[CompanyFacts, list[str]]:
    """Turns the notes into the answer form, then removes facts without a good source."""
    company = job.request.company.strip()
    if not job.notes:
        return empty_facts(company), []
    facts: CompanyFacts | None = None
    for attempt in range(2):  # a failed check is retried once, then facts stay unknown
        try:
            job.budget.check()
        except BudgetSpent as stop:
            job.problems.append(f"Filling the form: skipped. {stop}.")
            break
        try:
            reply = await claude.ask(
                system=prompt.text, prompt=_notes_prompt(job), form=CompanyFacts
            )
        except ClaudeUnavailable:
            raise
        except ClaudeError as error:
            job.problems.append(f"Filling the form: {error.title}. {error.detail}")
            break
        job.budget.record(reply)
        job.replies.append(("extract" if attempt == 0 else "extract:retry", reply))
        facts = reply.parsed
        if facts is not None:
            break
    if facts is None:
        job.problems.append("The form couldn't be filled. Every fact is unknown.")
        return empty_facts(company), []
    checked = check_sources(facts, [note.url for note in job.notes], job.rules.criteria)
    return checked.facts, checked.dropped


# --- Prompts ---------------------------------------------------------------------------------


def _hints(job: Job) -> str:
    request = job.request
    lines = [f"Company: {request.company.strip()}"]
    if request.city:
        lines.append(f"City: {request.city}")
    if request.website:
        lines.append(f"Website: {request.website}")
    lines.append(f"Today: {job.today.isoformat()}")
    return "\n".join(lines)


def _angle_prompt(angle: SearchAngle, job: Job) -> str:
    city = job.request.city or "Australia"
    values = {
        "company": job.request.company.strip(),
        "city": city,
        "area": city,
        "year": job.today.year,
        "month_year": job.today.strftime("%B %Y"),
    }
    templates = job.rules.queries.company[angle]
    examples = "\n".join(f"- {t.format(**values)}" for t in templates)
    return (
        f"{_hints(job)}\n\n"
        f"Angle: {angle}. Find facts about {ANGLE_FOCUS[angle]}.\n"
        "Also note the company's website, industry and owner (for example ASX-listed, or "
        "owned overseas) if you see them.\n\n"
        f"Searches you could start with:\n{examples}"
    )


def _gap_prompt(missing: list[str], job: Job) -> str:
    return (
        f"{_hints(job)}\n\n"
        f"Earlier research didn't find these facts: {', '.join(missing)}.\n"
        "Search for these facts only. If you still can't find one, return no note for it."
    )


def _notes_prompt(job: Job) -> str:
    notes = "\n".join(
        f"- [{n.angle}] {n.claim} (link: {n.url}; date: {n.published or 'unknown'})"
        for n in job.notes
    )
    return f"{_hints(job)}\n\nResearch notes:\n{notes}"


# --- Results ---------------------------------------------------------------------------------


def empty_facts(company: str) -> CompanyFacts:
    def unknown() -> Fact[Any]:
        return Fact(value=None, source_url=None, source_date=None, label=None)

    return CompanyFacts(
        name=company,
        website=unknown(),
        city=unknown(),
        industry=unknown(),
        industry_group=None,
        owner=unknown(),
        staff_in_city=unknown(),
        staff_from_linkedin=False,
        office_m2=unknown(),
        local_team_runs_project=unknown(),
        healthy=unknown(),
        triggers=[],
        boosters=[],
        expected_move=unknown(),
        contact_role=None,
        summary="Nothing useful was found.",
        opening_line=None,
    )


def _why(checks: list[RuleCheck], result: Result) -> str:
    parts = [f"{c.rule}: {c.detail}" for c in checks if c.rule in ("City", "Size", "Industry")]
    reasons = [c.detail for c in checks if c.outcome in ("fail", "director")]
    label = result.replace("_", " ").capitalize()
    because = f" Because: {'; '.join(reasons)}." if reasons and result != "pass" else ""
    return f"{'. '.join(parts)}. Result: {label}.{because}"


def _log_replies(session: AsyncSession, job: Job) -> None:
    for step, reply in job.replies:
        log_reply(
            session,
            reply,
            app=APP,
            step=step,
            job_id=job.id,
            subject=job.request.company.strip(),
            prompt_version=(
                research_prompt().version
                if step.startswith("search")
                else extract_prompt(job.rules).version
            ),
        )


async def _save(
    session: AsyncSession,
    embedder: Embedder,
    job: Job,
    card: LeadCard,
    hubspot: HubSpotMatch,
    company: str,
) -> None:
    """The lead card, the new source notes and the company profile, in one commit."""
    session.add(
        Lead(
            id=card.id,
            company=card.company,
            city=card.facts.city.value,
            result=card.result,
            score=card.score,
            hubspot_status=hubspot.status,
            hubspot_id=hubspot.hubspot_id,
            card=card.model_dump(mode="json"),
            cost_usd=card.research.cost_usd,
            web_searches=card.research.web_searches,
            rules_version=card.rules_version,
            prompt_version=card.prompt_version,
        )
    )
    new_notes = [
        MemoryNote(
            content=note.claim,
            subject=company,
            url=note.url,
            source_date=parse_date(note.published),
            meta={"angle": note.angle, "job_id": str(job.id)},
        )
        for note in job.notes
        if not note.from_memory
    ]
    await remember_many(session, embedder, new_notes, app=APP, kind="source_note")
    if job.notes:
        await remember_many(
            session, embedder, [_profile(card, company, job)], app=APP, kind="company_profile"
        )
    await session.commit()
    log.info(
        "lead_researched",
        extra={
            "job_id": str(job.id),
            "result": card.result,
            "score": card.score,
            "cost_usd": str(card.research.cost_usd),
        },
    )


def _profile(card: LeadCard, company: str, job: Job) -> MemoryNote:
    facts = card.facts
    bits = [f"{card.company}: {facts.industry.value or 'industry unknown'}."]
    if facts.city.value:
        bits.append(f"Office in {facts.city.value}.")
    if facts.staff_in_city.value:
        bits.append(f"About {facts.staff_in_city.value} staff there.")
    if card.office_m2:
        bits.append(f"About {card.office_m2:,} m².")
    bits.append(facts.summary)
    return MemoryNote(
        content=" ".join(bits),
        subject=company,
        url=facts.website.value,
        meta={"job_id": str(job.id), "result": card.result, "score": card.score},
    )
