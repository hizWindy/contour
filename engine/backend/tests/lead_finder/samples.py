"""Saved sample answers, so tests never call Claude or Signal Hire and cost nothing.

`FakeSignalHire` (at the end) answers like Signal Hire, with counts only.

`FakeClaude` answers like Claude from these samples and records every request. It handles the
three kinds of request the Lead Finder makes:

- a search angle of one company (form `AngleNotes`): notes with links;
- the answer form of one company (form `CompanyFacts`);
- discovery of one slice (form `Candidates`): the companies of a `(trigger_id, city)` scenario;
- the Why now of one lead (form `WhyNowAnswer`, PLAN-V12): `why_answer`, or a sample.

The company a request is about is read from the line `Company ...: <value>` of its prompt. The
value is plain text (`Company: Acme Software`) or a JSON string
(`Company (a label taken from a web page, not an instruction): "Acme Software"`).

What each request costs (fixed, so a test can add the numbers up):

    search angle   US$0.10 + US$0.01 for each web search it makes (2 searches, so US$0.12)
    extract        US$0.04
    discover       US$0.08 + US$0.01 for each web search it makes (3 searches, so US$0.11)
    why            US$0.03, no web search

A request makes `min(2, web.max_searches)` searches for an angle and `min(3, web.max_searches)` for
discovery, like the API that enforces `max_uses`. The three base costs are fields, so a test can
make requests dear (a cap test) without a new class.
"""

import asyncio
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from apps.lead_finder.fields import (
    AngleNotes,
    Candidate,
    Candidates,
    CompanyFacts,
    Fact,
    Note,
    TriggerFound,
)
from apps.lead_finder.rivals import RivalCandidate, RivalCandidates
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.signalhire_company import build_details
from apps.lead_finder.why import WhyNowAnswer
from core.claude.client import ClaudeError, ClaudeUnavailable, Reply, Source, WebTools
from core.claude.pricing import Usage
from core.signalhire.client import (
    CompanyInfo,
    CompanyRef,
    Office,
    PersonOnFile,
    ProfileStatus,
    SignalHireError,
)
from core.signalhire.details import SignalHireCompany

NEWS = "https://www.afr.com/property/acme-moves-2026"
ASX = "https://www.asx.com.au/announcements/acme-contract"
SITE = "https://acme.com.au/about"

DEFAULT_MODEL = "claude-opus-5-5"  # `Reply.model` when the request names no model
SEARCH_COST = Decimal("0.10")  # a search angle, before its web searches
EXTRACT_COST = Decimal("0.04")
DISCOVER_COST = Decimal("0.08")  # a discovery request, before its web searches
WEB_SEARCH_COST = Decimal("0.01")  # each web search
WHY_COST = Decimal("0.03")  # a Why now (PLAN-V12): no web search


def sample_why(company: str | None) -> WhyNowAnswer:
    """A Why now as Claude would write it for the Acme sample, under the company's own name."""
    name = company or "The company"
    return WhyNowAnswer(
        reason=f"{name}'s lease ends in March 2028, so it may be looking for a new office now.",
        likely_next="It may ask fitout firms for ideas before it signs a new lease.",
        ask=["Who is leading the search for the next office?"],
        links=[NEWS],
    )


def fact(value: Any, url: str | None = NEWS, label: str = "confirmed") -> Fact[Any]:
    if value is None:
        return Fact(value=None, source_url=None, source_date=None, label=None)
    return Fact(value=value, source_url=url, source_date="2026-10-01", label=label)


def make_facts(**changes: Any) -> CompanyFacts:
    """A company that passes every rule: Melbourne, 2,500 m², a fresh lease trigger."""
    base = CompanyFacts(
        name="Acme Software",
        website=fact("acme.com.au", SITE),
        city=fact("Melbourne"),
        industry=fact("Software"),
        industry_group=None,
        owner=fact("ASX-listed, Australian", ASX),
        staff_in_city=fact(250),
        staff_from_linkedin=False,
        office_m2=fact(2500),
        local_team_runs_project=fact(True, SITE),
        healthy=fact(True, ASX),
        triggers=[
            TriggerFound(
                id="lease_ending",
                what_happened="Acme's Collins Street lease ends in March 2028.",
                date="2028-03",
                source_url=NEWS,
                label="confirmed",
            )
        ],
        boosters=[],
        expected_move=fact("2027", NEWS, "estimated"),
        growth_plan=fact(None),
        size_needed_m2=fact(None),
        growth_by=fact(None),
        office_matters=fact(None),
        tier_group=None,
        office_since=fact(None),
        last_fitout=fact(None),
        fitout_contractors=[],
        talking_points=[],
        contact_role="Head of Property",
        decision_makers=[],
        summary="Acme's Melbourne lease ends in 2028 and it is looking for a bigger office.",
        opening_line="Congratulations on the growth. Is a new office on the cards?",
    )
    return base.model_copy(update=changes)


ANGLE_NOTES = {
    "property": [
        Note(
            claim="Acme's Collins Street lease ends in March 2028.",
            url=NEWS,
            published="2026-10-01",
        )
    ],
    "people": [
        Note(claim="Acme has about 250 staff in Melbourne.", url=NEWS, published="2026-10-01"),
        Note(claim="Acme is run from its Melbourne head office.", url=SITE, published=None),
    ],
    "money": [Note(claim="Acme won a $50M contract.", url=ASX, published="2026-09-20")],
    # PLAN-V11 C2: the lease and tenure run's office questions
    "tenure": [
        Note(
            claim="Acme has been at 101 Collins Street since 2016, with no refit since.",
            url=NEWS,
            published="2026-10-01",
        )
    ],
    "gaps": [Note(claim="Acme's office is 2,500 m².", url=NEWS, published="2026-10-01")],
}


# --- Discovery samples ---------------------------------------------------------------------


def candidate(
    name: str,
    trigger_id: str = "lease_ending",
    *,
    website: str | None = None,
    city: str | None = "Melbourne",
    what_happened: str | None = None,
    date: str | None = "2026-10-20",
    url: str | None = None,
    published: str | None = "2026-10-21",
) -> Candidate:
    """One company a discovery request found. The link is a news page named after the company, so
    two companies never share a source unless a test says so (`url=`)."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return Candidate(
        name=name,
        website=website,
        city=city,
        trigger_id=trigger_id,
        what_happened=what_happened
        or f"{name} was in the news for {trigger_id.replace('_', ' ')}.",
        date=date,
        url=url if url is not None else f"https://www.smh.com.au/business/{slug}-{trigger_id}",
        published=published,
    )


def sample_scenario() -> dict[tuple[str, str], list[Candidate]]:
    """A small discovery world. `Unyte` is found twice under two names (one domain, two triggers
    in one city), and `Harbour Foods` twice under one cleaned name in two cities' slices. Every
    other company is found once."""
    return {
        ("lease_ending", "Melbourne"): [
            candidate("Unyte", website="unyte.com"),
            candidate("Boxhill Software", website="boxhillsoftware.com.au"),
        ],
        ("merger_or_takeover", "Melbourne"): [
            candidate("Unyte Health", "merger_or_takeover", website="unyte.com"),
        ],
        ("lease_ending", "Adelaide"): [
            candidate("Harbour Foods Pty Ltd", city="Adelaide"),
        ],
        ("fast_growth", "Adelaide"): [
            candidate("Harbour Foods", "fast_growth", city="Adelaide"),
            candidate("Kent Town Legal", "fast_growth", city="Adelaide"),
        ],
        ("lease_ending", "Perth"): [
            candidate("West Perth Mining Services", city="Perth", date="2027-06"),
        ],
    }


# --- Reading the prompts -------------------------------------------------------------------

_COMPANY_LINE = re.compile(r"^Company\b[^:\n]*:[ \t]*(.+?)[ \t]*$", re.MULTILINE)
_CITY_LINE = re.compile(r'^City: (".*")[ \t]*$', re.MULTILINE)
_TRIGGER_LINE = re.compile(r'^Trigger: ("(?:[^"\\]|\\.)*")', re.MULTILINE)


def company_of(prompt: str) -> str | None:
    """The company a research prompt is about, from its `Company ...: <value>` line."""
    match = _COMPANY_LINE.search(prompt)
    if match is None:
        return None
    value = match.group(1)
    if value.startswith('"'):
        try:
            decoded = json.loads(value)
        except ValueError:
            return value
        if isinstance(decoded, str):
            return decoded
    return value


def _json_value(pattern: re.Pattern[str], prompt: str) -> str | None:
    match = pattern.search(prompt)
    if match is None:
        return None
    try:
        decoded = json.loads(match.group(1))
    except ValueError:
        return None
    return decoded if isinstance(decoded, str) else None


def _for_company(model: BaseModel, company: str) -> Any:
    """The Acme sample with the company's name and its own website in place of Acme's."""
    domain = (re.sub(r"[^a-z0-9]+", "", company.casefold())[:30] or "company") + ".com.au"
    escaped = json.dumps(company, ensure_ascii=False)[1:-1]
    text = model.model_dump_json().replace("acme.com.au", domain).replace("Acme", escaped)
    return type(model).model_validate_json(text)


class SimulatedCrash(BaseException):
    """The process died. It is not an `Exception`, so `except Exception` does not catch it, the
    way nothing catches a killed process. A test that raises it must expect it."""


@dataclass(frozen=True)
class Call:
    """One request FakeClaude got."""

    company: str | None  # None for discovery (it is about a slice, not a company)
    step: str  # "discover", "search:<angle>" or "extract"
    model: str | None  # what the caller passed (None: the default)
    effort: str | None
    max_continues: int | None
    web: WebTools | None
    prompt: str
    system: str = ""

    @property
    def key(self) -> tuple[str | None, str, str | None, str | None, int | None]:
        """(company, step, model, effort, max_continues)"""
        return (self.company, self.step, self.model, self.effort, self.max_continues)


@dataclass
class FakeClaude:
    """Answers like Claude, from the samples above. Records every request.

    What it answers:

    - `facts`: when given, the form of EVERY company (the old behaviour of the Acme tests).
      When left out, each company gets the Acme sample under its own name and website, built
      from the `Company` line of the prompt. A name with "acme" in it keeps the Acme sample.
    - `company_facts`: facts for named companies (key: the name in any case). Wins over `facts`.
    - `scenario`: the companies discovery finds, by `(trigger_id, city)`. A slice with no entry
      finds none. See `sample_scenario()`.
    - `Reply.model` is the model the caller passed (`DEFAULT_MODEL` when none). `Reply.sources`
      holds the links of the notes (or companies) it returns, and a page on each company's
      website; `invented_url` and `unread_websites` leave them out, as a page never read.

    What a test can switch on:

    - `invented_url`: notes (and discovered companies) cite pages the search never returned;
    - `unread_websites`: discovered companies' websites were never read;
    - `off_form`: the answer doesn't fit the form (`parsed` is None);
    - `unavailable`: every request raises `ClaudeUnavailable` (no key);
    - `error`: every request raises this `ClaudeError`;
    - `extract_error`: only the answer form raises this `ClaudeError` (the searches work);
    - `delay_seconds`: each request waits this long first (for cancel tests);
    - `hold(company)` / `hold_nth(n)`: a company's requests wait until the returned event is
      set. `reached(company)` is set when a request of that company arrives, so a test waits for
      it instead of sleeping;
    - `crash_on`: names whose requests raise `SimulatedCrash`;
    - `crash_after_extracts`: once this many answer forms have been returned, every later
      request raises `SimulatedCrash`;
    - Why now (PLAN-V12): `why_answer` is the answer (else `sample_why`), `why_off_form` makes
      that many Why now answers miss the form first, and `why_error` makes the Why now raise.

    The record: `calls` (`"search:property"`, `"extract"`, `"discover"`, `"why"`, the old list of
    text) and `requests` (a `Call` for each request, with the company, model, effort and prompt).
    """

    facts: CompanyFacts | None = None
    company_facts: dict[str, CompanyFacts] = field(default_factory=dict)
    scenario: dict[tuple[str, str], list[Candidate]] = field(default_factory=dict)
    # PLAN-V9 B5: the rivals the rivals search names for a company, by its name
    rivals: dict[str, list[RivalCandidate]] = field(default_factory=dict)
    invented_url: bool = False  # the notes cite a page the search never returned
    unread_websites: bool = False
    off_form: bool = False
    unavailable: bool = False
    error: ClaudeError | None = None
    extract_error: ClaudeError | None = None  # only the answer form fails (PLAN-V4 B4)
    delay_seconds: float = 0
    crash_on: set[str] = field(default_factory=set)
    crash_after_extracts: int | None = None
    search_cost: Decimal = SEARCH_COST
    extract_cost: Decimal = EXTRACT_COST
    discover_cost: Decimal = DISCOVER_COST
    why_answer: WhyNowAnswer | None = None  # PLAN-V12: else `sample_why` for the company
    why_off_form: int = 0  # this many Why now answers miss the form before one fits
    why_error: ClaudeError | None = None  # only the Why now raises this
    why_cost: Decimal = WHY_COST
    calls: list[str] = field(default_factory=list)
    requests: list[Call] = field(default_factory=list)
    _holds: dict[str, asyncio.Event] = field(default_factory=dict, init=False, repr=False)
    _holds_nth: dict[int, asyncio.Event] = field(default_factory=dict, init=False, repr=False)
    _reached: dict[str, asyncio.Event] = field(default_factory=dict, init=False, repr=False)
    _order: dict[str, int] = field(default_factory=dict, init=False, repr=False)
    _extracts: int = field(default=0, init=False, repr=False)
    _whys: int = field(default=0, init=False, repr=False)

    # --- For tests ---

    def hold(self, company: str) -> asyncio.Event:
        """Hold every request about `company` until the returned event is set."""
        return self._holds.setdefault(company.casefold(), asyncio.Event())

    def hold_nth(self, n: int) -> asyncio.Event:
        """Hold the company whose first request came n-th (0 is the first), until the event is
        set."""
        return self._holds_nth.setdefault(n, asyncio.Event())

    def reached(self, company: str) -> asyncio.Event:
        """Set when a request about `company` has arrived (held or not)."""
        return self._reached.setdefault(company.casefold(), asyncio.Event())

    def requests_for(self, company: str) -> list[Call]:
        return [
            call for call in self.requests if (call.company or "").casefold() == company.casefold()
        ]

    # --- The answer ---

    async def ask[T: BaseModel](
        self,
        *,
        system: str,
        prompt: str,
        form: type[T],
        web: WebTools | None = None,
        model: str | None = None,
        effort: str | None = None,
        max_continues: int | None = None,
    ) -> Reply[T]:
        company = company_of(prompt)
        step = self._step(form, prompt)
        self.calls.append(step)
        self.requests.append(Call(company, step, model, effort, max_continues, web, prompt, system))
        key = (company or "").casefold()
        if company is not None:
            index = self._order.setdefault(key, len(self._order))
            self.reached(company).set()
        else:
            index = -1
        if key in {name.casefold() for name in self.crash_on} or (
            self.crash_after_extracts is not None and self._extracts >= self.crash_after_extracts
        ):
            raise SimulatedCrash(f"The process died at {step} for {company}")
        if self.unavailable:
            raise ClaudeUnavailable("No Claude API key", "Add ANTHROPIC_API_KEY to engine/.env.")
        if self.error is not None:
            raise self.error
        if self.extract_error is not None and step == "extract":
            raise self.extract_error
        if self.why_error is not None and step == "why":
            raise self.why_error
        gate = self._holds.get(key) or self._holds_nth.get(index)
        if gate is not None:
            await gate.wait()
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)

        parsed: Any
        missed = False
        if form is Candidates:
            parsed, sources, queries, usage, cost = self._discover(prompt, web)
        elif form is RivalCandidates:
            parsed, sources, queries, usage, cost = self._rivals(company)
        elif form is AngleNotes:
            parsed, sources, queries, usage, cost = self._angle(prompt, company, web)
        elif form is WhyNowAnswer:
            parsed = self.why_answer or sample_why(company)
            sources, queries = (), ()
            usage, cost = Usage(input_tokens=3_000, output_tokens=400), self.why_cost
            self._whys += 1
            missed = self._whys <= self.why_off_form
        else:
            parsed, sources, queries, usage, cost = self._extract(company)
            self._extracts += 1
        if self.off_form or missed:
            parsed, text = None, "this is not the form"
        else:
            text = parsed.model_dump_json()
        return Reply(
            model=model or DEFAULT_MODEL,
            stop_reason="end_turn",
            parsed=parsed,
            text=text,
            sources=sources,
            queries=queries,
            usage=usage,
            cost_usd=cost,
        )

    @staticmethod
    def _step(form: type[BaseModel], prompt: str) -> str:
        if form is Candidates:
            return "discover"
        if form is RivalCandidates:
            return "rivals"
        if form is AngleNotes:
            return f"search:{FakeClaude._angle_name(prompt)}"
        if form is WhyNowAnswer:
            return "why"
        return "extract"

    @staticmethod
    def _angle_name(prompt: str) -> str:
        if "didn't find these facts" in prompt:
            return "gaps"
        return prompt.split("Angle: ")[1].split(".")[0]

    def _angle(
        self, prompt: str, company: str | None, web: WebTools | None
    ) -> tuple[Any, tuple[Source, ...], tuple[str, ...], Usage, Decimal]:
        angle = self._angle_name(prompt)
        notes = ANGLE_NOTES[angle]
        if company is not None and "acme" not in company.casefold():
            notes = [_for_company(note, company) for note in notes]
        sources = tuple(Source(n.url, "A page") for n in notes)
        if self.invented_url:
            notes = [n.model_copy(update={"url": "https://made-up.example/page"}) for n in notes]
        searches = min(2, web.max_searches) if web else 0  # the API enforces max_uses
        usage = Usage(
            input_tokens=20_000, output_tokens=1_000, web_searches=searches, web_fetches=1
        )
        cost = self.search_cost + searches * WEB_SEARCH_COST  # 20k x $4/M + 1k x $20/M
        return AngleNotes(notes=notes), sources, (f"acme {angle}",), usage, cost

    def _extract(
        self, company: str | None
    ) -> tuple[Any, tuple[Source, ...], tuple[str, ...], Usage, Decimal]:
        named = {name.casefold(): facts for name, facts in self.company_facts.items()}
        facts = named.get((company or "").casefold(), self.facts)
        if facts is None:
            facts = make_facts()
            if company is not None and "acme" not in company.casefold():
                facts = _for_company(facts, company).model_copy(update={"name": company})
        return facts, (), (), Usage(input_tokens=5_000, output_tokens=1_000), self.extract_cost

    def _rivals(
        self, company: str | None
    ) -> tuple[Any, tuple[Source, ...], tuple[str, ...], Usage, Decimal]:
        named = {name.casefold(): found for name, found in self.rivals.items()}
        found = named.get((company or "").casefold(), [])
        sources = tuple(Source(item.url, "A page") for item in found)
        usage = Usage(input_tokens=3_000, output_tokens=400, web_searches=2)
        return (
            RivalCandidates(rivals=list(found)),
            sources,
            (f"rivals of {company}",),
            usage,
            Decimal("0.07"),
        )

    def _discover(
        self, prompt: str, web: WebTools | None
    ) -> tuple[Any, tuple[Source, ...], tuple[str, ...], Usage, Decimal]:
        city = _json_value(_CITY_LINE, prompt) or ""
        trigger = _json_value(_TRIGGER_LINE, prompt) or ""
        found = self.scenario.get((trigger, city), [])
        sources: list[Source] = []
        if not self.invented_url:
            for item in found:
                sources.append(Source(item.url, "A news page"))
                if item.website and not self.unread_websites:
                    sources.append(Source(f"https://{item.website}/", "The company's site"))
        searches = min(3, web.max_searches) if web else 0
        usage = Usage(
            input_tokens=15_000, output_tokens=1_500, web_searches=searches, web_fetches=2
        )
        cost = self.discover_cost + searches * WEB_SEARCH_COST
        return (
            Candidates(companies=list(found)),
            tuple(sources),
            (f"{trigger} {city}",),
            usage,
            cost,
        )


# --- Signal Hire ---------------------------------------------------------------------------

CULTURE_AMP = CompanyRef(id=5, slug="culture-amp", name="Culture Amp")
CULTURE_AMP_INFO = CompanyInfo(
    name="Culture Amp",
    website="cultureamp.com",
    industry="Software",
    staff_count=700,
    staffing_company=False,
    linkedin_id="98765",
    offices=(
        Office("Melbourne", "Victoria", "Australia", True),
        Office("Sydney", None, None, False),
    ),
)
ACME_SOFTWARE = CompanyRef(id=7, slug="acme-software", name="Acme Software")
# What Signal Hire says about Acme Software, in the same words as `make_facts` where they agree.
ACME_INFO = CompanyInfo(
    name="Acme Software",
    website="https://www.acme.com.au/",
    industry="Software Development",
    staff_count=420,
    staffing_company=False,
    linkedin_id="55555",
    offices=(
        Office("Melbourne", "Victoria", "Australia", True),
        Office("Sydney", "New South Wales", "Australia", False),
    ),
)
DETAILS_DAY = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # when the sample details were read


def make_details(**changes: Any) -> SignalHireCompany:
    """Signal Hire's details for Acme Software, as the lookup keeps them."""
    return build_details(ACME_SOFTWARE, ACME_INFO, DETAILS_DAY).model_copy(update=changes)


# Made-up people for the fake Signal Hire: never real names.
SAMPLE_LEADERS = (
    PersonOnFile("sh-1", "Pat Example", "Chief Financial Officer"),
    PersonOnFile("sh-2", "Sam Sample", "Head of Workplace"),
)


def rules_with_signalhire(rules: LeadFinderRules, **size_changes: Any) -> LeadFinderRules:
    """The rules with `headcount_tool` listed in `size.staff_sources`, the name check `required`
    (so a test doesn't depend on what criteria.yaml uses today), and any other change to `size`."""
    sources = ["hubspot", "headcount_tool", "linkedin", "web_research"]
    changes: dict[str, Any] = {
        "staff_sources": sources,
        "headcount_tool_name_check": "required",
        **size_changes,
    }
    size = rules.criteria.size.model_copy(update=changes)
    return rules.model_copy(update={"criteria": rules.criteria.model_copy(update={"size": size})})


def rules_without_signalhire(rules: LeadFinderRules) -> LeadFinderRules:
    """The rules with `headcount_tool` left out of `size.staff_sources`: Signal Hire is off."""
    sources = [source for source in rules.criteria.size.staff_sources if source != "headcount_tool"]
    size = rules.criteria.size.model_copy(update={"staff_sources": sources})
    return rules.model_copy(update={"criteria": rules.criteria.model_copy(update={"size": size})})


class FakeSignalHire:
    """Answers like Signal Hire, with counts only. Records every call in `calls`.

    - `known`: the companies `find_company` knows, by slug. Culture Amp by default.
    - `people` and `senior`: what `count_people` answers (all people, and the senior ones).
    - `leaders`: what `senior_people` answers (made-up names and job titles).
    - `failures`: a step to raise an error at: `"find"`, `"info"`, `"people"`, `"senior"` or
      `"leaders"`.
    Nothing here costs a credit or reaches the network.
    """

    def __init__(
        self,
        known: Sequence[CompanyRef] = (CULTURE_AMP,),
        *,
        info: CompanyInfo | None = CULTURE_AMP_INFO,
        failures: dict[str, SignalHireError] | None = None,
        people: int = 210,
        senior: int = 14,
        leaders: Sequence[PersonOnFile] = SAMPLE_LEADERS,
    ) -> None:
        self.known = {ref.slug: ref for ref in known}
        self.info = info
        self.failures = failures or {}
        self.people = people
        self.senior = senior
        self.leaders = list(leaders)
        self.calls: list[str] = []

    def _fail(self, step: str) -> None:
        if step in self.failures:
            raise self.failures[step]

    async def find_company(self, id_or_slug: str) -> CompanyRef | None:
        self.calls.append(f"find:{id_or_slug}")
        self._fail("find")
        return self.known.get(id_or_slug)

    async def company_info(self, company_id: int) -> CompanyInfo | None:
        self.calls.append(f"info:{company_id}")
        self._fail("info")
        return self.info

    async def profile_count(self, company_id: int, status: ProfileStatus = "current") -> int:
        self.calls.append(f"profiles:{status}")
        return {"current": 650, "past": 900, "both": 1550}[status]

    async def count_people(
        self, *, company: str, location: str | None = None, titles: str | None = None
    ) -> int:
        self.calls.append(f"people:{company}|{location}|{titles or ''}")
        self._fail("senior" if titles else "people")
        return self.senior if titles else self.people

    async def senior_people(
        self, *, company: str, location: str, titles: str, size: int
    ) -> list[PersonOnFile]:
        self.calls.append(f"leaders:{company}|{location}|{size}")
        self._fail("leaders")
        return list(self.leaders[:size])
