"""The rules and the score. Pure code: no AI and no database inside.

The same facts always get the same result, so every rule is easy to test. The rules come
from Criteria_v2.md (a draft until Levi confirms it), through rules/criteria.yaml.
"""

import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from apps.lead_finder.fields import CompanyFacts, TriggerFound
from apps.lead_finder.rules import LeadFinderRules, Result
from apps.lead_finder.sources import host_of, source_kind
from core.hubspot.matching import CandidateReason, HubSpotMatch

Outcome = Literal["ok", "fail", "director", "unknown", "flag"]
Group = Literal["main", "other", "weak"]
DAYS_PER_YEAR = 365.25
REASON_WORDS: dict[CandidateReason, str] = {
    "close_name": "close name",
    "name_in_deal": "name in a deal",
    "similar_profile": "similar profile",
}


class RuleCheck(BaseModel):
    rule: str
    outcome: Outcome
    detail: str


class TriggerScore(BaseModel):
    trigger: TriggerFound
    group: Group
    source_kind: str
    points: int


class Verdict(BaseModel):
    result: Result
    score: int
    checks: list[RuleCheck]
    office_m2: int | None
    office_m2_estimated: bool
    fitout_aud: Decimal | None
    triggers: list[TriggerScore]  # the triggers that count, best first


def parse_date(text: str | None) -> date | None:
    """'2026-10-14', '2026-10' or '2026'. A year alone is read as 1 July."""
    if not text:
        return None
    match = re.match(r"^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?", text.strip())
    if not match:
        return None
    year, month, day = match.groups()
    try:
        if month is None:
            return date(int(year), 7, 1)
        return date(int(year), int(month), int(day or 1))
    except ValueError:
        return None


def judge(
    facts: CompanyFacts, hubspot: HubSpotMatch, rules: LeadFinderRules, today: date
) -> Verdict:
    criteria = rules.criteria
    checks: list[RuleCheck] = []
    checks += _never_suggest(facts, hubspot, rules, today)
    checks.append(_city(facts, rules))
    size_check, office_m2, estimated = _size(facts, rules, today)
    checks.append(size_check)
    checks.append(_office(facts, rules))
    checks += _local_and_healthy(facts)
    triggers = _triggers(facts, rules, today)
    checks.append(
        RuleCheck(rule="Trigger", outcome="ok", detail=triggers[0].trigger.what_happened)
        if triggers
        else RuleCheck(rule="Trigger", outcome="unknown", detail="No sign of an office change yet")
    )

    outcomes = {check.outcome for check in checks}
    unknown_core = any(c.outcome == "unknown" and c.rule in ("City", "Size") for c in checks)
    result: Result
    if "fail" in outcomes:
        result = "drop"
    elif not triggers:
        result = "watch"
    elif "director" in outcomes:
        result = "director_review"
    elif unknown_core:
        result = "watch"  # it may fit, but a person needs to check the city or size
    else:
        result = "pass"

    fitout = office_m2 * criteria.fitout.rate_per_m2_aud if office_m2 is not None else None
    return Verdict(
        result=result,
        score=_score(result, triggers, facts, rules),
        checks=checks,
        office_m2=office_m2,
        office_m2_estimated=estimated,
        fitout_aud=fitout,
        triggers=triggers,
    )


# --- Each rule ---------------------------------------------------------------------------


def _never_suggest(
    facts: CompanyFacts, hubspot: HubSpotMatch, rules: LeadFinderRules, today: date
) -> list[RuleCheck]:
    never = rules.criteria.never_suggest
    if hubspot.status == "possible_match":
        return [_possible_match(hubspot)]
    if hubspot.status == "open_deal" and never.open_deal:
        names = ", ".join(hubspot.open_deals)
        return [RuleCheck(rule="HubSpot", outcome="fail", detail=f"Open deal in HubSpot: {names}")]
    if hubspot.status == "dissolved_deal":
        ended = hubspot.last_dissolved
        if ended is None:
            return [
                RuleCheck(
                    rule="HubSpot", outcome="fail", detail="Dissolved deal, date not recorded"
                )
            ]
        wait_until = ended + timedelta(days=round(never.dissolved_deal_wait_months * 30.44))
        if today < wait_until:
            newer = [t for t in facts.triggers if (d := parse_date(t.date)) and d > ended]
            if newer:
                detail = f"Deal dissolved {ended}, but a new trigger appeared since"
                return [RuleCheck(rule="HubSpot", outcome="ok", detail=detail)]
            detail = f"Deal dissolved {ended}. Wait until {wait_until}, unless a new trigger"
            return [RuleCheck(rule="HubSpot", outcome="fail", detail=detail)]
    if hubspot.status == "new":
        return [RuleCheck(rule="HubSpot", outcome="ok", detail="Not in HubSpot yet")]
    owner = f", owner {hubspot.owner}" if hubspot.owner else ""
    return [RuleCheck(rule="HubSpot", outcome="ok", detail=f"In HubSpot{owner}, no open deal")]


def _possible_match(hubspot: HubSpotMatch) -> RuleCheck:
    """A flag, never a fail: the company might be one in HubSpot, and a person confirms. It
    doesn't change the result or the score by itself, so a wrong guess costs nothing."""
    if not hubspot.candidates:
        return RuleCheck(
            rule="HubSpot", outcome="flag", detail="Possible match in HubSpot. A person confirms."
        )
    best = hubspot.candidates[0]
    detail = f"Possible match with {best.name} ({REASON_WORDS[best.reason]}). A person confirms."
    if best.open_deals:
        detail += " It has an open deal."
    for other in hubspot.candidates[1:]:
        if other.open_deals:
            detail += f" {other.name} has an open deal."
    return RuleCheck(rule="HubSpot", outcome="flag", detail=detail)


def city_of(place: str, rules: LeadFinderRules) -> str | None:
    """'Cremorne' or 'Melbourne VIC' becomes 'Melbourne'. None if it's not a known city."""
    text = place.lower()
    for city, areas in rules.queries.areas.items():
        names = [city, *areas.get("cbd", []), *areas.get("inner", [])]
        if any(re.search(rf"\b{re.escape(name.lower())}\b", text) for name in names):
            return city
    return None


def _city(facts: CompanyFacts, rules: LeadFinderRules) -> RuleCheck:
    cities = rules.criteria.cities
    place = facts.city.value
    if place is None:
        return RuleCheck(rule="City", outcome="unknown", detail="City not known")
    city = city_of(place, rules)
    if city in cities.pass_:
        return RuleCheck(rule="City", outcome="ok", detail=city)
    if city in cities.director_review:
        return RuleCheck(rule="City", outcome="director", detail=f"{city}: a Director decides")
    if cities.other_cities == "drop":
        return RuleCheck(rule="City", outcome="fail", detail=f"{place} is outside our cities")
    return RuleCheck(rule="City", outcome="director", detail=f"{place}: a Director decides")


def _size(
    facts: CompanyFacts, rules: LeadFinderRules, today: date
) -> tuple[RuleCheck, int | None, bool]:
    """The size rule. A known office size is judged against the range. A size worked out from
    staff is only a hint (Criteria_v2): it can raise a flag, never a Drop. A small company that
    will soon need an office in range still fits (`_growing`)."""
    size = rules.criteria.size
    staff = facts.staff_in_city.value
    if staff is not None and facts.staff_from_linkedin:
        staff = round(staff * size.linkedin_staff_multiplier)
    from_staff = False
    if facts.office_m2.value is not None:
        m2, estimated, basis = facts.office_m2.value, facts.office_m2.label != "confirmed", ""
    elif staff is not None:
        m2, estimated, from_staff = round(staff * size.m2_per_staff), True, True
        basis = f" (estimated: {staff} staff x {size.m2_per_staff:g} m²)"
    else:
        grown = _growing(facts, rules, today)
        if grown is not None:
            return grown
        return (
            RuleCheck(rule="Size", outcome="unknown", detail="Office size and staff not known"),
            None,
            False,
        )

    text = f"{m2:,} m²{basis}"
    low, _ = size.director_band_m2
    if m2 > size.office_m2_max or (staff is not None and staff > size.staff_max):
        check = RuleCheck(rule="Size", outcome="director", detail=f"{text}: over the top limit")
        return check, m2, estimated  # a plan to grow even bigger is no reason to look again
    if m2 >= size.office_m2_min:
        return RuleCheck(rule="Size", outcome="ok", detail=text), m2, estimated
    if from_staff and staff is not None:
        hint = size.staff_hint_min
        if staff >= hint:
            check = RuleCheck(
                rule="Size", outcome="ok", detail=f"{text}: at the staff hint ({hint}+)"
            )
            return check, m2, estimated
        detail = f"{text}: below the staff hint ({hint}+). Check the office size"
        check = RuleCheck(rule="Size", outcome="flag", detail=detail)
    elif m2 >= low:
        check = RuleCheck(rule="Size", outcome="director", detail=f"{text}: just under the minimum")
    else:
        check = RuleCheck(rule="Size", outcome="fail", detail=f"{text}: too small")
    grown = _growing(facts, rules, today)
    return grown if grown is not None else (check, m2, estimated)


def _growing(
    facts: CompanyFacts, rules: LeadFinderRules, today: date
) -> tuple[RuleCheck, int, bool] | None:
    """A company below the range that will soon need an office in it still fits (Levi, 29 Oct):
    big funding or a big announcement, plus a plan to hire. The office it will need is what
    counts. None when there is no such plan, or it is further away than `grow_into_range_months`."""
    size = rules.criteria.size
    needed = facts.size_needed_m2.value
    if facts.growth_plan.value is not True or needed is None or needed < size.office_m2_min:
        return None
    when = parse_date(facts.growth_by.value)
    if when is not None and when > today + timedelta(
        days=round(size.grow_into_range_months * 30.44)
    ):
        return None
    text = f"{needed:,} m²"
    if needed > size.office_m2_max:
        detail = f"Growing: will need about {text}, over the top limit"
        return RuleCheck(rule="Size", outcome="director", detail=detail), needed, True
    if when is None:
        detail = f"Growing into the range: will need about {text}. When is not known, so check"
        return RuleCheck(rule="Size", outcome="flag", detail=detail), needed, True
    detail = f"Growing into the range: will need about {text} by {facts.growth_by.value}"
    return RuleCheck(rule="Size", outcome="ok", detail=detail), needed, True


def _office(facts: CompanyFacts, rules: LeadFinderRules) -> RuleCheck:
    """Judge the office, not the industry (Criteria_v2): a miner's head office counts. The AI's
    "the office doesn't matter" is a judgement, so it is a flag to check, never a Drop."""
    industries = rules.criteria.industries
    name = facts.industry.value or "Industry not known"
    group = facts.industry_group
    if group in industries.director_review:
        return RuleCheck(rule="Office", outcome="director", detail=f"{name}: {group}")
    matters = facts.office_matters.value
    if matters is False:
        detail = f"{name}: the office may not matter to how they work. Check the office size"
        return RuleCheck(rule="Office", outcome="flag", detail=detail)
    if matters is None and group in industries.check_office_size:
        return RuleCheck(rule="Office", outcome="flag", detail=f"{name}: check the office size")
    if matters:
        detail = f"{name}: the office matters to how they work"
        return RuleCheck(rule="Office", outcome="ok", detail=detail)
    outcome: Outcome = "ok" if facts.industry.value else "unknown"
    return RuleCheck(rule="Office", outcome=outcome, detail=name)


def _local_and_healthy(facts: CompanyFacts) -> list[RuleCheck]:
    checks = []
    for rule, fact, fail_text in (
        ("Local team", facts.local_team_runs_project, "The local team can't run the project"),
        ("Healthy", facts.healthy, "In administration or cutting staff fast"),
    ):
        if fact.value is None:
            checks.append(RuleCheck(rule=rule, outcome="unknown", detail="Not checked"))
        elif fact.value:
            checks.append(RuleCheck(rule=rule, outcome="ok", detail="Yes"))
        else:
            checks.append(RuleCheck(rule=rule, outcome="fail", detail=fail_text))
    return checks


def _triggers(facts: CompanyFacts, rules: LeadFinderRules, today: date) -> list[TriggerScore]:
    """The triggers that count, best first."""
    criteria = rules.criteria
    groups: dict[str, Group] = {}
    for group_name, items in (
        ("main", criteria.triggers.main),
        ("other", criteria.triggers.other),
        ("weak", criteria.triggers.weak),
    ):
        for item in items:
            groups[item.id] = group_name  # type: ignore[assignment]
    website = facts.website.value
    company_domain = host_of(website) if website else None
    score = criteria.score
    window = criteria.triggers.window_years * DAYS_PER_YEAR
    low, high = criteria.triggers.best_window_years
    recent = timedelta(days=round(criteria.triggers.recent_months * 30.44))

    counted: list[TriggerScore] = []
    for trigger in facts.triggers:
        group = groups.get(trigger.id)
        if group is None:
            continue
        when = parse_date(trigger.date)
        if when is None:
            recency = score.undated
        elif trigger.id == "lease_ending":
            days_out = (when - today).days
            if not 0 <= days_out <= window:
                continue  # already ended, or too far away
            in_best = low * DAYS_PER_YEAR <= days_out <= high * DAYS_PER_YEAR
            recency = score.lease_in_best_window if in_best else score.recency[-1].points
        elif when > today:
            if (when - today).days > window:
                continue
            recency = score.recency[0].points  # announced and still to come
        else:
            if today - when > recent:
                continue  # too old to count
            age = (today - when).days
            recency = next((s.points for s in score.recency if age <= s.within_days), 0)
        kind = source_kind(trigger.source_url, criteria, company_domain)
        points = score.trigger[group] + recency + score.source.get(kind, 0)
        counted.append(TriggerScore(trigger=trigger, group=group, source_kind=kind, points=points))
    return sorted(counted, key=lambda t: t.points, reverse=True)


def _score(
    result: Result, triggers: list[TriggerScore], facts: CompanyFacts, rules: LeadFinderRules
) -> int:
    if result == "drop":
        return 0
    score = rules.criteria.score
    total = triggers[0].points if triggers else 0
    if result in ("pass", "director_review"):
        total += score.fit[result]
    booster_ids = {booster.id for booster in facts.boosters}
    total += min(len(booster_ids) * score.booster_each, score.boosters_max)
    return max(0, min(100, total))
