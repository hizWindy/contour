"""The source check. Pure code: no AI and no database, so it's easy to test.

Every fact needs a link to a page the engine actually read. A fact whose link is missing,
unseen or on a blocked site becomes unknown. Each kept link gets a source kind, which feeds
the score.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from apps.lead_finder.fields import CompanyFacts, Fact
from apps.lead_finder.rules import Criteria

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
)
BLOCKED = "blocked"


def host_of(url: str) -> str:
    value = url.strip().lower()
    if "://" not in value:
        value = "https://" + value
    return (urlsplit(value).hostname or "").removeprefix("www.")


def url_key(url: str) -> str:
    """The same page, however it's written: no scheme, no www, no #part, no end slash."""
    parts = urlsplit(url.strip() if "://" in url else "https://" + url.strip())
    path = parts.path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{host_of(url)}{path}{query}"


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


def check_sources(
    facts: CompanyFacts, seen_urls: Iterable[str], criteria: Criteria
) -> CheckedFacts:
    seen = {url_key(url) for url in seen_urls}
    seen_hosts = {key.split("/", 1)[0].split("?", 1)[0] for key in seen}
    website = facts.website.value
    company_domain = host_of(website) if website else None
    dropped: list[str] = []

    def problem(url: str | None) -> str | None:
        if not url:
            return "no source link"
        if source_kind(url, criteria, company_domain) == BLOCKED:
            return f"blocked site ({host_of(url)})"
        if url_key(url) not in seen:
            return f"link not among the pages read ({url})"
        return None

    update: dict[str, Any] = {}
    for name in FACT_FIELDS:
        fact: Fact[Any] = getattr(facts, name)
        if fact.value is None:
            continue
        issue = problem(fact.source_url)
        # The website can stand on its own: we read pages on that site.
        if name == "website" and issue and company_domain in seen_hosts:
            issue = None
        if issue:
            dropped.append(f"{name}: {issue}. Marked unknown.")
            update[name] = fact.model_copy(update={"value": None, "label": None})
            if name == "website":
                company_domain = None

    trigger_ids = {t.id for t in criteria.triggers.every}
    triggers = []
    for trigger in facts.triggers:
        issue = (
            "unknown trigger id" if trigger.id not in trigger_ids else problem(trigger.source_url)
        )
        if issue:
            dropped.append(f"trigger {trigger.id}: {issue}. Removed.")
        else:
            triggers.append(trigger)

    booster_ids = {b.id for b in criteria.boosters}
    boosters = []
    for booster in facts.boosters:
        issue = (
            "unknown booster id" if booster.id not in booster_ids else problem(booster.source_url)
        )
        if issue:
            dropped.append(f"booster {booster.id}: {issue}. Removed.")
        else:
            boosters.append(booster)

    update |= {"triggers": triggers, "boosters": boosters}
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
