"""The source check. Pure code: no AI and no database, so it's easy to test.

Every fact needs a link to a page the engine actually read. A fact whose link is missing,
not a plain web address, unseen or on a blocked site becomes unknown, and its link is removed
too. Each kept link gets a source kind, which feeds the score. The website is kept as a bare
domain, and only if a page on that site was read. Otherwise it becomes unknown. A decision maker
(a leader's name and job title) needs a read page too, and never one behind a login.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import SplitResult, urlsplit

from apps.lead_finder.fields import CompanyFacts, Fact
from apps.lead_finder.rules import Criteria
from apps.lead_finder.sanitize import clean_domain, one_line, safe_http_url

FACT_FIELDS = (
    "website",
    "city",
    "industry",
    "owner",
    "staff_in_city",
    "office_m2",
    "local_team_runs_project",
    "healthy",
    "expected_move",
    "growth_plan",
    "size_needed_m2",
    "growth_by",
    "office_matters",
    "office_since",
    "last_fitout",
)
BLOCKED = "blocked"
ID_MAX_CHARS = 40  # a trigger or booster id, when it is echoed in a message
# People's pages on these sites need a login, so they are never a decision maker's source.
LOGIN_SITES = ("linkedin.com",)


def _split(url: str) -> SplitResult | None:
    """`urlsplit`, but None instead of an error for text that can't be read as a web address.

    Claude writes some of these links, and a web page can make it write a broken one, like
    'http://[x'. That must never stop a research that has already been paid for. A broken link
    is dropped later, by `safe_http_url`, as not a plain web link.
    """
    text = url.strip()
    try:
        return urlsplit(text if "://" in text else "https://" + text)
    except ValueError:
        return None


def _clean_host(hostname: str | None) -> str:
    """Lowercase host (urlsplit lowers it) with no closing dot and no `www.`.

    A closing dot names the same site ('propertydaily.com.au.' is 'propertydaily.com.au'), so
    it must not be a way round the blocked list.
    """
    return (hostname or "").rstrip(".").removeprefix("www.")


def host_of(url: str) -> str:
    """The host of a web address, lowercase, with no `www.` and no closing dot.

    Never raises: text that isn't a readable web address has no host, so it gives ''.
    """
    parts = _split(url.lower())
    return _clean_host(parts.hostname if parts else None)


def url_key(url: str) -> str:
    """The same page, however it's written: no scheme, no www, no #part, no end slash.

    Never raises. Text that isn't a readable web address (like 'http://[x') gets the key '/'
    plus its own lowercase text, so it matches only an identical string. The key starts with
    '/' because a real key starts with a host: `check_sources` reads the part before the first
    '/' as a host, and a bare '[x.acme.com.au' would pass there as a page on acme.com.au.
    """
    parts = _split(url)
    if parts is None:
        return "/" + url.strip().lower()
    path = parts.path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{_clean_host(parts.hostname)}{path}{query}"


def on_site(host: str, domains: Iterable[str]) -> bool:
    """True if the host is one of the domains, or a subdomain of one."""
    return any(host == d or host.endswith("." + d) for d in domains)


def source_kind(url: str, criteria: Criteria, company_domain: str | None = None) -> str:
    """property_daily, asx_or_official_news, other_news, job_ads, or blocked."""
    host = host_of(url)
    domains = criteria.source_domains
    if on_site(host, domains.blocked):
        return BLOCKED
    if company_domain and on_site(host, [company_domain]):
        return "asx_or_official_news"  # the company's own website or announcements
    for kind in ("property_daily", "asx_or_official_news", "job_ads"):
        if on_site(host, getattr(domains, kind)):
            return kind
    return "other_news"


@dataclass(frozen=True)
class CheckedFacts:
    facts: CompanyFacts
    dropped: list[str]  # what was removed, and why, in plain words


def _unknown(fact: Fact[Any]) -> Fact[Any]:
    """A fact that is dropped: no value, no label and no link, so nothing odd is stored."""
    return fact.model_copy(
        update={"value": None, "label": None, "source_url": None, "source_date": None}
    )


def check_sources(
    facts: CompanyFacts, seen_urls: Iterable[str], criteria: Criteria
) -> CheckedFacts:
    seen = {url_key(url) for url in seen_urls}
    seen_hosts = {key.split("/", 1)[0].split("?", 1)[0] for key in seen}
    dropped: list[str] = []

    # The website is stored as a bare domain, like acme.com.au. It stands only if we read a
    # page on that site (or on a subdomain of it, like careers.acme.com.au). Otherwise a made-up
    # or planted domain could steer the HubSpot match and make links count as the company's own.
    website_fact = facts.website
    if website_fact.value is not None:
        domain = clean_domain(website_fact.value)
        if domain is None:
            dropped.append("website: not a valid domain name. Marked unknown.")
            website_fact = _unknown(website_fact)
        elif not any(on_site(host, [domain]) for host in seen_hosts):
            dropped.append("website: no page on this site was read. Marked unknown.")
            website_fact = _unknown(website_fact)
        elif domain != website_fact.value:
            website_fact = website_fact.model_copy(update={"value": domain})
        facts = facts.model_copy(update={"website": website_fact})
    company_domain = website_fact.value

    def problem(url: str | None) -> str | None:
        if not url:
            return "no source link"
        if not safe_http_url(url):
            return "not a plain web link (http or https only)"
        if source_kind(url, criteria, company_domain) == BLOCKED:
            return f"blocked site ({host_of(url)})"
        if url_key(url) not in seen:
            return f"link not among the pages read ({url})"
        return None

    update: dict[str, Any] = {}
    for name in FACT_FIELDS:
        fact: Fact[Any] = getattr(facts, name)
        if fact.value is None:
            # Nothing is claimed, so no link is kept either (it could be any text at all).
            if fact.source_url is not None or fact.source_date is not None:
                update[name] = fact.model_copy(update={"source_url": None, "source_date": None})
            continue
        issue = problem(fact.source_url)
        if issue and name == "website":
            # The site was read (checked above), so the domain stands. Its own link failed the
            # check, so that link is not kept as a source.
            update[name] = fact.model_copy(update={"source_url": None, "source_date": None})
        elif issue:
            dropped.append(f"{name}: {issue}. Marked unknown.")
            update[name] = _unknown(fact)

    trigger_ids = {t.id for t in criteria.triggers.every}
    triggers = []
    for trigger in facts.triggers:
        issue = (
            "unknown trigger id" if trigger.id not in trigger_ids else problem(trigger.source_url)
        )
        if issue:
            dropped.append(f"trigger {one_line(trigger.id, ID_MAX_CHARS)}: {issue}. Removed.")
        else:
            triggers.append(trigger)

    booster_ids = {b.id for b in criteria.boosters}
    boosters = []
    for booster in facts.boosters:
        issue = (
            "unknown booster id" if booster.id not in booster_ids else problem(booster.source_url)
        )
        if issue:
            dropped.append(f"booster {one_line(booster.id, ID_MAX_CHARS)}: {issue}. Removed.")
        else:
            boosters.append(booster)

    # A decision maker needs a page we read, like any fact. Never a LinkedIn page: profiles sit
    # behind a login, so a name "from LinkedIn" was not read there. The message names no one.
    people = []
    for person in facts.decision_makers:
        issue = problem(person.source_url)
        if issue is None and on_site(host_of(person.source_url), LOGIN_SITES):
            issue = f"a page behind a login ({host_of(person.source_url)})"
        if issue:
            dropped.append(f"a decision maker: {issue}. Removed.")
        else:
            people.append(person)

    update |= {"triggers": triggers, "boosters": boosters, "decision_makers": people}
    return CheckedFacts(facts=facts.model_copy(update=update), dropped=dropped)


def missing_facts(facts: CompanyFacts) -> list[str]:
    """What the gap check looks for: city, office size (or staff) and a trigger."""
    missing = []
    if facts.city.value is None:
        missing.append("city")
    if facts.office_m2.value is None and facts.staff_in_city.value is None:
        missing.append("office size or staff in the city")
    if not facts.triggers:
        missing.append("a sign of an office change")
    return missing
