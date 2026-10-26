"""Discovery of one slice: one Claude request with web tools, then checks on the answer.

A slice is one trigger in one city (`steps/plan.py`). The request holds only what the rules and
the run's own params say: the trigger's search templates, the city, the trigger, the places to
focus on and how recent the news must be. It holds nothing from HubSpot and nothing from memory,
so no company name from either can reach Claude through discovery, and a page can't steer one
slice with what another slice learned.

Claude's answer is never trusted as it is. After parsing, in this order: the list is cut to 10
companies, then each company is checked. A company that fails a check is dropped with a short
reason (a person sees it in the run feed). The checks are pure code (`check_candidates`):

- the name passes `clean_company_name` (rejected, never repaired);
- the trigger is one the rules know;
- the sentence of what happened is cut to one line of at most 240 characters;
- the link is a plain web address, is not on a blocked site, and is one of the pages the web
  tools returned;
- the date (or the page's date when there is none) is not older than `since_days`. A company with
  no date at all is kept, and one summary line says so;
- the city is one of the run's cities, else it is left empty;
- the website is a bare domain that was among the pages read, else it is left empty.

Discovery has no side effect on the database. The caller logs `DiscoverResult.reply` in the
search log, and keeps the signals in the run state.
"""

import logging
import re
from calendar import monthrange
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

from pydantic import BaseModel, ConfigDict

from apps.lead_finder.context import OnReply, Signal
from apps.lead_finder.fields import Candidate, Candidates
from apps.lead_finder.prompts import discover_prompt
from apps.lead_finder.rules import Criteria, LeadFinderRules
from apps.lead_finder.sanitize import (
    clean_city,
    clean_company_name,
    clean_domain,
    json_text,
    one_line,
    safe_http_url,
)
from apps.lead_finder.sources import BLOCKED, host_of, on_site, source_kind, url_key
from apps.lead_finder.steps.plan import Slice, area_text, focus_places
from core.claude.budget import Budget, BudgetSpent
from core.claude.client import Claude, ClaudeError, ClaudeUnavailable, Reply, WebTools
from core.config import Settings

log = logging.getLogger(__name__)

MAX_CANDIDATES = 10  # companies kept from one slice's answer
WHAT_HAPPENED_MAX = 240  # characters in the sentence of what happened
DISCOVER_MAX_CONTINUES = 1  # a paused web turn is resumed at most once (research uses 3)
NAME_DISPLAY_MAX = 60  # characters of a dropped name shown in the run feed
# A website on one of these kinds of site is never a company's own website.
NOT_A_COMPANY_SITE = frozenset({BLOCKED, "job_ads", "asx_or_official_news"})
_DATE = re.compile(r"(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?![\d-])")

# The reasons a company is dropped. Short, plain, and the same every time.
NAME_NOT_USABLE = "name not usable"
UNKNOWN_TRIGGER = "unknown trigger"
NOTHING_HAPPENED = "no description of what happened"
LINK_NOT_PLAIN = "link is not a plain web address"
LINK_BLOCKED = "link is on a blocked site"
LINK_NOT_READ = "link is not among the pages read"


class Found(BaseModel):
    """A company discovery found, after the checks. Every value is clean. JSON-simple, so it
    can sit in the graph state (`found.model_dump()` and `Found.model_validate(d)`)."""

    model_config = ConfigDict(frozen=True)

    name: str  # passed `clean_company_name`
    website: str | None  # a bare domain, and a page on it was read
    city: str | None  # one of the run's cities
    trigger_id: str  # a trigger the rules know
    what_happened: str  # one line, at most 240 characters
    date: str | None  # YYYY-MM-DD, YYYY-MM or YYYY
    url: str  # a plain web link among the pages read, never on a blocked site
    published: str | None  # YYYY-MM-DD, YYYY-MM or YYYY
    slice_id: str  # the slice that found it

    @property
    def dated(self) -> bool:
        """False when neither the event nor the page has a date: a person should check it."""
        return self.date is not None or self.published is not None

    @property
    def signal(self) -> Signal:
        """The part that travels with the company into research and memory."""
        return Signal(
            trigger_id=self.trigger_id,
            what_happened=self.what_happened,
            url=self.url,
            date=self.date,
            published=self.published,
        )


@dataclass(frozen=True)
class Checked:
    """The result of `check_candidates`."""

    candidates: list[Found]
    skipped: list[tuple[str, str]]  # (name as shown, reason) for each dropped company
    problems: list[str]  # plain words about the slice as a whole


@dataclass(frozen=True)
class DiscoverResult:
    """What `discover_slice` gives back. It never raises for a bad answer.

    - `candidates`: the companies that passed every check, in Claude's order.
    - `reply`: the Claude reply, for the search log. None when no request was made or it failed.
    - `skipped`: (name, reason) for each dropped company. The name is one short clean line. The
      run can show each as `company_skipped`.
    - `problems`: plain words about the slice, each starting with the slice label. For the feed.
    - `failure`: set when no list of companies could be used (a refused request, an answer that
      didn't fit the form, a spent budget). It is the reason for `slice_failed`, and it is
      repeated in `problems`.
    """

    candidates: list[Found]
    reply: Reply[Candidates] | None
    problems: list[str] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    failure: str | None = None


# --- The request ----------------------------------------------------------------------------


def discover_request(rules: LeadFinderRules, slice_: Slice, since_days: int, today: date) -> str:
    """The text sent with the discovery instructions. Only these parts, and nothing else:

    - the city and the trigger (as JSON text, with the trigger's label from the rules);
    - the places to focus on (from queries.yaml);
    - how recent the news must be, and today's date;
    - the trigger's search templates, filled in. A template that asks for `{company}` gets an
      empty text: discovery doesn't know a company yet.
    """
    label = next(
        item.label for item in rules.criteria.triggers.every if item.id == slice_.trigger_id
    )
    values = {
        "city": slice_.city,
        "area": area_text(rules, slice_.city, slice_.area),
        "year": today.year,
        "month_year": today.strftime("%B %Y"),
        "company": "",
    }
    searches = "\n".join(
        f"- {' '.join(template.format(**values).split())}"
        for template in rules.queries.discovery[slice_.trigger_id]
    )
    focus = ", ".join(focus_places(rules, slice_.city, slice_.area))
    return (
        f"City: {json_text(slice_.city, 60)}\n"
        f"Trigger: {json_text(slice_.trigger_id, 60)} ({label})\n"
        f"Focus on: {focus}\n"
        f"Only events from the last {since_days} days (today is {today.isoformat()}).\n\n"
        f"Searches you could start with:\n{searches}"
    )


def slice_budget(settings: Settings) -> Budget:
    """The budget of one slice: the slice reserve is its cap, and it has the slice's searches."""
    return Budget(
        cap_usd=settings.slice_reserve_usd,
        max_searches=settings.slice_max_searches,
        request_reserve_usd=settings.slice_reserve_usd,
    )


# --- The checks (pure) ----------------------------------------------------------------------


def _clean_date(text: str | None) -> str | None:
    """'2026-10-14', '2026-10' or '2026' as a canonical text, or None if it isn't a real date.

    A time after the date ('2026-10-14T09:00') is ignored. Other text (like 'last week') is None.
    """
    if not text:
        return None
    match = _DATE.match(text.strip())
    if match is None:
        return None
    year = int(match.group(1))
    month = int(match.group(2)) if match.group(2) else None
    day = int(match.group(3)) if match.group(3) else None
    try:
        if month is None:
            date(year, 1, 1)
            return f"{year:04d}"
        if day is None:
            date(year, month, 1)
            return f"{year:04d}-{month:02d}"
        date(year, month, day)
    except ValueError:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _latest_day(clean: str) -> date:
    """The last day a clean date could mean: a month is its last day, a year is 31 December.
    So a company is never dropped for a date that is only imprecise."""
    parts = [int(part) for part in clean.split("-")]
    if len(parts) == 1:
        return date(parts[0], 12, 31)
    if len(parts) == 2:
        return date(parts[0], parts[1], monthrange(parts[0], parts[1])[1])
    return date(parts[0], parts[1], parts[2])


def _site(value: str | None, seen_hosts: Iterable[str], criteria: Criteria) -> str | None:
    """The company's own website as a bare domain, or None.

    It stands only if a page on that site (or a subdomain of it) was read, so a made-up or
    planted domain can't steer the HubSpot match. A news, job or official site, or a blocked
    one, is never a company's own website.
    """
    domain = clean_domain(value)
    if domain is None:
        return None
    if not any(on_site(host, [domain]) for host in seen_hosts):
        return None
    if source_kind(f"https://{domain}", criteria) in NOT_A_COMPANY_SITE:
        return None
    return domain


def _no_date_note(count: int) -> str:
    if count == 1:
        return "1 company has no date, so it was kept. Check its date."
    return f"{count} companies have no date, so they were kept. Check their dates."


def check_candidates(
    companies: Sequence[Candidate],
    source_urls: Iterable[str],
    rules: LeadFinderRules,
    slice_: Slice,
    since_days: int,
    today: date,
    cities: Sequence[str],
) -> Checked:
    """Cut the list to 10, then check each company. Pure code: it never raises for odd text.

    `source_urls` are the pages the web tools returned (`reply.sources`). `cities` are the run's
    cities: a company's city outside them becomes None.
    """
    criteria = rules.criteria
    problems: list[str] = []
    skipped: list[tuple[str, str]] = []
    kept: list[Found] = []
    if len(companies) > MAX_CANDIDATES:
        problems.append(
            f"Claude listed {len(companies)} companies. Only the first {MAX_CANDIDATES} were used."
        )
        companies = companies[:MAX_CANDIDATES]

    urls = list(source_urls)
    seen_keys = {url_key(url) for url in urls}
    seen_hosts = {host for host in (host_of(url) for url in urls) if host}
    triggers = {item.id for item in criteria.triggers.every}
    cutoff = today - timedelta(days=since_days)

    for company in companies:
        shown = one_line(company.name, NAME_DISPLAY_MAX) or "(no name)"
        name = clean_company_name(company.name)
        if name is None:
            skipped.append((shown, NAME_NOT_USABLE))
            continue
        what_happened = one_line(company.what_happened, WHAT_HAPPENED_MAX)
        when = _clean_date(company.date)
        published = _clean_date(company.published)
        # The event's own date counts first. The page's date counts only when there is none.
        known = when or published
        reason: str | None = None
        if company.trigger_id not in triggers:
            reason = UNKNOWN_TRIGGER
        elif not what_happened:
            reason = NOTHING_HAPPENED
        elif not safe_http_url(company.url):
            reason = LINK_NOT_PLAIN
        elif source_kind(company.url, criteria) == BLOCKED:
            reason = LINK_BLOCKED
        elif url_key(company.url) not in seen_keys:
            reason = LINK_NOT_READ
        elif known is not None and _latest_day(known) < cutoff:
            reason = f"older than {since_days} days"
        if reason is not None:
            skipped.append((shown, reason))
            continue
        kept.append(
            Found(
                name=name,
                website=_site(company.website, seen_hosts, criteria),
                city=clean_city(company.city, cities),
                trigger_id=company.trigger_id,
                what_happened=what_happened,
                date=when,
                url=company.url,
                published=published,
                slice_id=slice_.id,
            )
        )

    undated = sum(1 for found in kept if not found.dated)
    if undated:
        problems.append(_no_date_note(undated))
    return Checked(candidates=kept, skipped=skipped, problems=problems)


# --- The step -------------------------------------------------------------------------------


async def discover_slice(
    claude: Claude,
    rules: LeadFinderRules,
    settings: Settings,
    slice_: Slice,
    since_days: int,
    today: date,
    budget: Budget | None = None,
    blocked_domains: Sequence[str] | None = None,
    on_reply: OnReply | None = None,
    *,
    cities: Sequence[str] | None = None,
) -> DiscoverResult:
    """Discover the companies of one slice with ONE Claude request.

    - `budget`: the slice's own `Budget` (`slice_budget(settings)` when left out). The request
      holds searches and money from it, and the real cost is recorded on it.
    - `blocked_domains`: sites the web tools never read. Left out, the rules' blocked list.
    - `on_reply(reply)`: called as soon as the reply arrives, for the run's live totals
      (`RunTotals.add_reply`). It is the only hook. The caller logs `result.reply`.
    - `cities`: the run's cities, for the city check. Left out, every city the rules know.

    A reply that doesn't fit the form, a Claude error that is not `ClaudeUnavailable`, and a spent
    budget give a result with `failure` set, not an exception. `ClaudeUnavailable` (no key, no
    connection) and a cancel propagate, after the budget hold is released.
    """
    criteria = rules.criteria
    budget = budget if budget is not None else slice_budget(settings)
    blocked = (
        tuple(blocked_domains)
        if blocked_domains is not None
        else tuple(criteria.source_domains.blocked)
    )
    run_cities = (
        list(cities)
        if cities is not None
        else [
            *criteria.cities.pass_,
            *criteria.cities.director_review,
        ]
    )
    prefix = f"{slice_.label}: "

    def failed(text: str, reply: Reply[Candidates] | None = None) -> DiscoverResult:
        return DiscoverResult(
            candidates=[], reply=reply, problems=[prefix + text], skipped=[], failure=text
        )

    try:
        reserved = budget.reserve_request(settings.slice_max_searches)
    except BudgetSpent as stop:
        return failed(f"skipped. {stop}.")
    try:
        reply = await claude.ask(
            system=discover_prompt().text,
            prompt=discover_request(rules, slice_, since_days, today),
            form=Candidates,
            web=WebTools(
                max_searches=reserved,
                max_fetches=settings.fetches_per_request,
                blocked_domains=blocked,
            ),
            model=settings.model_for("discover"),
            max_continues=DISCOVER_MAX_CONTINUES,
        )
    except BaseException as error:  # the hold goes back whatever happens, even a cancel
        budget.release(reserved)
        if isinstance(error, ClaudeError) and not isinstance(error, ClaudeUnavailable):
            return failed(f"{error.title}. {error.detail}")
        raise
    budget.record(reply, reserved=reserved, on_spend=on_reply)

    if reply.parsed is None:
        stop_reason = reply.stop_reason or "unknown"
        return failed(f"the answer didn't fit the form (stopped: {stop_reason}).", reply)
    try:
        checked = check_candidates(
            reply.parsed.companies,
            [source.url for source in reply.sources],
            rules,
            slice_,
            since_days,
            today,
            run_cities,
        )
    except Exception:  # the request is paid for: keep its reply for the log, whatever happens
        log.exception("discover_check_failed")
        return failed("the answer could not be read.", reply)
    return DiscoverResult(
        candidates=checked.candidates,
        reply=reply,
        problems=[prefix + problem for problem in checked.problems],
        skipped=checked.skipped,
    )
