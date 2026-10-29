"""Choose: which merged companies to research, and why the others are skipped. Pure code.

`decide` takes plain data. The caller reads the database first (the HubSpot match of each company
and the leads that already exist) and passes the rows in, so every rule here is quick to test and
the same input always gives the same answer.

The rules, in this order, for each company (the first that applies skips it):

1. HubSpot says it has an open deal.
2. HubSpot says a deal was dissolved less than `never_suggest.dissolved_deal_wait_months` ago,
   unless a signal is newer than the day it was dissolved. This is the rule of the lead card,
   asked of `scoring.judge`, so the card and the choice can't disagree.
3. A lead for it was made less than `memory_fresh_days` ago (unless the run is a re-check).
   Test leads (`is_test`) are ignored.
4. A lead for it was sent or rejected, unless a signal is newer than that decision.

Then the rest are ranked (`rank_candidate`) and the top `max_companies` are kept. The others are
counted in `over_limit_count`, and the caller says so in one summary line.

A "signal is newer" means the news date: the date of the event, or the page's date when there is
none. For a lease ending the event date is in the future by nature, so only the page's date counts.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from apps.lead_finder.context import Signal
from apps.lead_finder.fields import CompanyFacts, Fact, TriggerFound
from apps.lead_finder.rules import Item, LeadFinderRules
from apps.lead_finder.scoring import DAYS_PER_YEAR, Group, judge, parse_date
from apps.lead_finder.sources import source_kind
from apps.lead_finder.steps.merge import Merged
from core.config import Settings
from core.hubspot.matching import HubSpotMatch

OVER_LIMIT_REASON = "over the run's company limit"
LEASE_ENDING = "lease_ending"  # the trigger whose date is when the lease ends


@dataclass(frozen=True)
class ExistingLead:
    """What `decide` needs to know about a lead that is already saved. Plain data."""

    company_key: str  # the cleaned name that was asked for
    status: str  # new, watching, rejected or sent
    created_at: datetime
    updated_at: datetime | None = None  # when a person last changed it (the decision date)
    is_test: bool = False  # a lead of the test set: never counts


@dataclass(frozen=True)
class Decision:
    """Who is researched and who is not.

    - `chosen`: the companies to research, best first (at most `max_companies`).
    - `skipped`: (name, reason) for each company left out by a rule. Plain words.
    - `over_limit_count`: how many more were left out because of the company limit. They are
      counted, not listed: say it once with `OVER_LIMIT_REASON`.
    """

    chosen: list[Merged]
    skipped: list[tuple[str, str]] = field(default_factory=list)
    over_limit_count: int = 0


# --- Ranking --------------------------------------------------------------------------------


def _group_of(rules: LeadFinderRules, trigger_id: str) -> Group | None:
    triggers = rules.criteria.triggers
    groups: tuple[tuple[Group, list[Item]], ...] = (
        ("main", triggers.main),
        ("other", triggers.other),
        ("weak", triggers.weak),
    )
    for group, items in groups:
        if any(item.id == trigger_id for item in items):
            return group
    return None


def signal_day(signal: Signal) -> date | None:
    """When a signal is news (see the module text). None when no date can be read."""
    published = parse_date(signal.published)
    if signal.trigger_id == LEASE_ENDING:
        return published
    return parse_date(signal.date) or published


def signal_points(
    signal: Signal, rules: LeadFinderRules, today: date, company_domain: str | None = None
) -> int:
    """Points for one signal: its trigger group, how recent it is, and what kind of page says it.

    The same weights and the same recency steps as the lead card's score (`scoring._triggers`).
    The difference: the card leaves out a trigger that is too old, or a lease already ended or too
    far away; here it just gets no recency points, because ranking is only about the order.
    """
    criteria = rules.criteria
    group = _group_of(rules, signal.trigger_id)
    if group is None:
        return 0
    score = criteria.score
    window_days = criteria.triggers.window_years * DAYS_PER_YEAR
    low, high = criteria.triggers.best_window_years
    recent = timedelta(days=round(criteria.triggers.recent_months * 30.44))
    lease = signal.trigger_id == LEASE_ENDING
    when = parse_date(signal.date) or (None if lease else parse_date(signal.published))
    recency = 0
    if when is None:
        recency = score.undated
    elif lease:
        days_out = (when - today).days
        if 0 <= days_out <= window_days:
            in_best = low * DAYS_PER_YEAR <= days_out <= high * DAYS_PER_YEAR
            recency = score.lease_in_best_window if in_best else score.recency[-1].points
    elif when > today:
        if (when - today).days <= window_days:
            recency = score.recency[0].points  # announced and still to come
    elif today - when <= recent:
        age = (today - when).days
        recency = next((step.points for step in score.recency if age <= step.within_days), 0)
    kind = source_kind(signal.url, criteria, company_domain)
    return score.trigger[group] + recency + score.source.get(kind, 0)


def rank_candidate(company: Merged, rules: LeadFinderRules, today: date) -> int:
    """The points of the company's best signal. A higher number is researched first. Ties are
    settled by name (see `rank`)."""
    return max(
        (signal_points(signal, rules, today, company.website) for signal in company.signals),
        default=0,
    )


def rank(companies: Sequence[Merged], rules: LeadFinderRules, today: date) -> list[Merged]:
    """Best first. Equal points: by name, A to Z, so the order never changes between runs."""
    points = {id(company): rank_candidate(company, rules, today) for company in companies}
    return sorted(companies, key=lambda c: (-points[id(c)], c.name.casefold(), c.name))


# --- The rules ------------------------------------------------------------------------------


def _unknown() -> Fact[Any]:
    return Fact(value=None, source_url=None, source_date=None, label=None)


def _facts_of(company: Merged) -> CompanyFacts:
    """A card with nothing known except the signals, so `scoring.judge` can be asked about
    HubSpot. Only its HubSpot check is read."""
    return CompanyFacts(
        name=company.name,
        website=_unknown(),
        city=_unknown(),
        industry=_unknown(),
        industry_group=None,
        owner=_unknown(),
        staff_in_city=_unknown(),
        staff_from_linkedin=False,
        office_m2=_unknown(),
        local_team_runs_project=_unknown(),
        healthy=_unknown(),
        triggers=[
            TriggerFound(
                id=signal.trigger_id,
                what_happened=signal.what_happened,
                date=day.isoformat() if (day := signal_day(signal)) else None,
                source_url=signal.url,
                label="estimated",
            )
            for signal in company.signals
        ],
        boosters=[],
        expected_move=_unknown(),
        growth_plan=_unknown(),
        size_needed_m2=_unknown(),
        growth_by=_unknown(),
        office_matters=_unknown(),
        tier_group=None,
        office_since=_unknown(),
        last_fitout=_unknown(),
        fitout_contractors=[],
        talking_points=[],
        contact_role=None,
        summary="",
        opening_line=None,
    )


def _hubspot_reason(
    company: Merged, match: HubSpotMatch | None, rules: LeadFinderRules, today: date
) -> str | None:
    """Why HubSpot says skip: an open deal, or a deal dissolved too recently. None if it doesn't."""
    if match is None or match.status not in ("open_deal", "dissolved_deal"):
        return None
    for check in judge(_facts_of(company), match, rules, today).checks:
        if check.rule == "HubSpot" and check.outcome == "fail":
            return check.detail
    return None


def _day(moment: datetime) -> date:
    return moment.date()


def _newer_signal(company: Merged, than: date) -> bool:
    return any((day := signal_day(signal)) is not None and day > than for signal in company.signals)


def _lead_reason(
    company: Merged,
    leads: Sequence[ExistingLead],
    today: date,
    fresh_days: int,
    recheck: bool,
) -> str | None:
    """Why an existing lead says skip: a fresh one, or one a person sent or rejected."""
    real = [lead for lead in leads if not lead.is_test]
    if not recheck:
        fresh = [lead for lead in real if (today - _day(lead.created_at)).days < fresh_days]
        if fresh:
            newest = max(fresh, key=lambda lead: lead.created_at)
            age = max(0, (today - _day(newest.created_at)).days)
            unit = "day" if age == 1 else "days"
            return f"researched {age} {unit} ago (memory is fresh for {fresh_days} days)"
    decided = [lead for lead in real if lead.status in ("sent", "rejected")]
    if decided:
        last = max(decided, key=lambda lead: lead.updated_at or lead.created_at)
        when = _day(last.updated_at or last.created_at)
        if not _newer_signal(company, when):
            return f"already {last.status} on {when.isoformat()}, and nothing newer was found"
    return None


def decide(
    merged: Sequence[Merged],
    hubspot_matches: Mapping[str, HubSpotMatch],
    existing_leads: Sequence[ExistingLead],
    rules: LeadFinderRules,
    params: object,
    today: date,
    max_companies: int,
    settings: Settings,
    *,
    ranked: bool = True,
) -> Decision:
    """Apply the rules (module text), rank the rest and keep the top `max_companies`.

    - `ranked`: False keeps the order the companies came in instead of ranking them (the
      watchlist is already in its own order, most likely first, and has no signals to rank by).

    - `hubspot_matches`: the HubSpot match of each company, by `Merged.key`. A company with no
      entry counts as not in HubSpot.
    - `existing_leads`: leads already saved. Found by `company_key`, for every name of a company.
    - `params`: only `params.recheck` is read (False when the params have none, as discovery's).
    - `settings`: only `settings.memory_fresh_days` is read.
    """
    recheck = bool(getattr(params, "recheck", False))
    by_key: dict[str, list[ExistingLead]] = {}
    for lead in existing_leads:
        by_key.setdefault(lead.company_key, []).append(lead)

    kept: list[Merged] = []
    skipped: list[tuple[str, str]] = []
    order = merged if not ranked else sorted(merged, key=lambda c: (c.name.casefold(), c.name))
    for company in order:
        reason = _hubspot_reason(company, hubspot_matches.get(company.key), rules, today)
        if reason is None:
            leads = [lead for key in company.keys for lead in by_key.get(key, [])]
            reason = _lead_reason(company, leads, today, settings.memory_fresh_days, recheck)
        if reason is None:
            kept.append(company)
        else:
            skipped.append((company.name, reason))

    best_first = rank(kept, rules, today) if ranked else kept
    limit = max(0, max_companies)
    return Decision(
        chosen=best_first[:limit],
        skipped=skipped,
        over_limit_count=max(0, len(best_first) - limit),
    )
