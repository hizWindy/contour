"""The rules and the score. Pure code: no AI and no database inside.

The same facts always get the same result, so every rule is easy to test. The rules come
from Criteria_v2.md (a draft until Levi confirms it), through rules/criteria.yaml.

The score is the Target Customer Profile's 100 points in six parts. Each part is a few checks.
A check earns points, or it is "not known yet" when the tool can't judge it for this lead. The
score is the points earned. "Checked" is the most the tool could judge, like "48 of 60 checked".
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal, NamedTuple

from pydantic import BaseModel, Field

from apps.lead_finder.fields import CompanyFacts, DampenerFinding, TriggerFound
from apps.lead_finder.rules import (
    DampenerId,
    DampenerRule,
    DampenerStrength,
    ExclusionRule,
    LeadFinderRules,
    Result,
    Strength,
)
from apps.lead_finder.sources import host_of, source_kind
from core.hubspot.matching import CandidateReason, HubSpotMatch

Outcome = Literal["ok", "fail", "director", "unknown", "flag"]
Group = Literal["main", "other", "weak"]
Band = Literal["research_first", "investigate", "nurture"]
# "small": worked out from staff between staff_floor and staff_hint_min. The lead is a Watch at
# best, with a "check office size" flag (PLAN-V9 B1). Since 9 Nov both are 50, so no lead is
# "small" until the rules open that band again (PLAN-V11 B2).
SizeBasis = Literal["confirmed", "estimated", "growing", "director", "small", "below", "none"]
DAYS_PER_YEAR = 365.25
DAYS_PER_MONTH = 30.44
# The rule check of a company that moved or fitted out lately: it makes the lead a Watch (B3)
JUST_MOVED = "Just moved"
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
    strength: Strength | None = Field(
        default=None,
        description="very_high, high, medium or low (Levi's section 4). Empty for a card made "
        "before PLAN-V16.",
    )
    source_kind: str
    points: int = Field(description="Group, source and timing together. It ranks the triggers.")
    group_points: int = Field(default=0, description="The trigger part of the score")
    source_points: int = Field(default=0, description="The trigger part of the score")
    timing_points: int = Field(default=0, description="How recent, or how near the lease end")


class ScoreCheck(BaseModel):
    id: str
    label: str
    earned: int
    max: int
    known: bool = Field(description="false means 'not known yet': it adds nothing to 'checked'")
    detail: str = ""


class ScorePart(BaseModel):
    id: str
    label: str
    max: int = Field(description="The part's points in the Profile's 100")
    earned: int
    checked: int = Field(description="The points of the checks the tool could judge")
    checks: list[ScoreCheck]


FilterId = Literal["location", "office_size", "headcount", "office_relevance", "sector"]
FilterState = Literal["pass", "fail", "estimated"]
FILTER_LABELS: dict[FilterId, str] = {
    "location": "Location",
    "office_size": "Office size",
    "headcount": "Headcount",
    "office_relevance": "Office relevance",
    "sector": "Sector",
}


class FilterResult(BaseModel):
    """One of Levi's five filters (his section 2, PLAN-V16 T1-3). A fact nobody found is
    "estimated" and labelled, never a fail (choice 3): a lead fails a filter only when a fact we
    know says so."""

    id: FilterId
    label: str
    state: FilterState = Field(
        description="pass: the facts meet it. estimated: not known, or only estimated, so a "
        "person may check. fail: a known fact says no."
    )
    basis: str = Field(
        description="One plain sentence on what it rests on, like 'about 1,200 m², estimated "
        "from staff'"
    )


class Override(BaseModel):
    """A person's decision to judge a lead again without its exclusion."""

    by: str = Field(description="Who did it: the name or email of the account")
    at: datetime


class Excluded(BaseModel):
    """Why a lead is left out and not scored (Levi's section 3). An excluded lead is a Drop. A
    person with the Lead Finder tick can override it: `overridden_by` and `overridden_at` then say
    who did it, and the lead is judged without the exclusion."""

    reason_id: str = Field(examples=["law_firm"])
    label: str = Field(examples=["Law firm"])
    evidence: str = Field(description="What says so, in one plain sentence")
    url: str | None = Field(default=None, description="The page that says it, when there is one")
    overridden_by: str | None = None
    overridden_at: datetime | None = None


DampenerStatus = Literal["found", "not_found", "not_checked"]


class Dampener(BaseModel):
    """One dampener on a lead (Levi's section 5, PLAN-V16 T1-5): a fact that lowers its score and
    never removes the lead. Every dampener is listed, so a card says what was checked.

    `state` is `found`, `not_found` (the check ran and showed nothing: never written as "none") or
    `not_checked` (nobody could check, so it says nothing either way). A found dampener has its
    strength, its evidence, its date and link when there are some, and what could reverse it.
    `waived` is a sentence when it is found but takes nothing off, with the reason."""

    id: DampenerId
    label: str
    state: DampenerStatus
    strength: DampenerStrength | None = Field(
        default=None, description="strong takes off 20 points and moderate 10. Empty unless found."
    )
    evidence: str | None = Field(default=None, description="What shows it, in one plain sentence")
    date: str | None = Field(default=None, description="When it happened: YYYY-MM-DD or YYYY-MM")
    url: str | None = Field(default=None, description="The page that says it")
    can_reverse: str | None = Field(
        default=None, description="What could reverse it, like a contract's renewal date"
    )
    waived: str | None = Field(
        default=None, description="Why a found dampener takes nothing off. Empty when it does."
    )


class Verdict(BaseModel):
    result: Result
    stage: str  # the Profile's stage for the result: Active prospect, Target account...
    score: int
    checks: list[RuleCheck]
    office_m2: int | None
    office_m2_estimated: bool
    fitout_aud: Decimal | None
    triggers: list[TriggerScore]  # the triggers that count, best first
    parts: list[ScorePart] = Field(default_factory=list)  # empty for a Drop
    score_checked: int = 0
    band: Band | None = None
    filters: list[FilterResult] = Field(default_factory=list)  # Levi's five (PLAN-V16 T1-3)
    excluded: Excluded | None = None  # the exclusion that applies, or that a person overrode
    dampeners: list[Dampener] = Field(default_factory=list)  # every one, as the rules list them


@dataclass(frozen=True)
class SizeJudgement:
    """The size rule's check, the office size it used, and what that size rests on."""

    check: RuleCheck
    m2: int | None
    estimated: bool
    basis: SizeBasis
    # The staff number the size rested on, after a LinkedIn count is doubled, and whether the size
    # was worked out from it. The headcount filter reads them (PLAN-V16 T1-3).
    staff: int | None = None
    from_staff: bool = False


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


def month_year(text: str | None) -> str:
    """'2026-03' or '2026-03-14' as 'March 2026', and '2026' as '2026'. As given if unreadable."""
    when = parse_date(text)
    if when is None or text is None:
        return text or ""
    return f"{when:%B %Y}" if re.match(r"^\s*\d{4}-\d", text) else str(when.year)


def judge(
    facts: CompanyFacts,
    hubspot: HubSpotMatch,
    rules: LeadFinderRules,
    today: date,
    *,
    overrides: Mapping[str, Override] | None = None,
) -> Verdict:
    """The result, the score and the reasons for one company, from its facts.

    `overrides` are the exclusions a person overrode, by exclusion id (PLAN-V16 T1-3): the lead is
    judged as if they didn't apply, and the verdict's `excluded` says who overrode.
    """
    criteria = rules.criteria
    checks: list[RuleCheck] = []
    checks += _never_suggest(facts, hubspot, rules, today)
    excluded, exclusion_checks = _exclusion(facts, rules, overrides or {})
    checks += exclusion_checks
    city_check = _city(facts, rules)
    checks.append(city_check)
    sized = _size(facts, rules, today)
    checks.append(sized.check)
    checks.append(_office(facts, rules))
    checks += _local_and_healthy(facts)
    history = office_history(facts, rules, today)
    # The old office's sign comes from the office dates, not from Claude (PLAN-V11 C1)
    triggers = _triggers(with_tenure_sign(facts, history, rules), rules, today)
    checks.append(
        RuleCheck(rule="Trigger", outcome="ok", detail=triggers[0].trigger.what_happened)
        if triggers
        else RuleCheck(rule="Trigger", outcome="unknown", detail="No sign of an office change yet")
    )
    history_check = _history_check(facts, history, rules)
    if history_check is not None:  # left out when nothing is known, so a card isn't all "unknown"
        checks.append(history_check)

    outcomes = {check.outcome for check in checks}
    unknown_core = any(c.outcome == "unknown" and c.rule in ("City", "Size") for c in checks)
    result: Result
    if "fail" in outcomes:
        result = "drop"
    elif not triggers:
        result = "watch"
    elif history.just_moved:
        result = "watch"  # it has probably just set up its office (PLAN-V11 B3), sign or not
    elif sized.basis == "small":
        result = "watch"  # between the floor and the hint, not growing: check the office size
    elif "director" in outcomes:
        result = "director_review"
    elif unknown_core:
        result = "watch"  # it may fit, but a person needs to check the city or size
    else:
        result = "pass"

    fitout = sized.m2 * criteria.fitout.rate_per_m2_aud if sized.m2 is not None else None
    parts: list[ScorePart] = []
    score = checked = 0
    band: Band | None = None
    if result != "drop":  # a Drop scores 0: the score never overrides a Drop
        parts = _score_parts(triggers, facts, sized, history, rules)
        score = max(0, min(100, sum(part.earned for part in parts)))
        checked = sum(part.checked for part in parts)
        band = band_of(score, checked, rules)
    return Verdict(
        result=result,
        stage=criteria.stages[result],
        score=score,
        checks=checks,
        office_m2=sized.m2,
        office_m2_estimated=sized.estimated,
        fitout_aud=fitout,
        triggers=triggers,
        parts=parts,
        score_checked=checked,
        band=band,
        filters=_filters(facts, rules, city_check, sized, excluded),
        excluded=excluded,
        dampeners=_dampeners(facts, rules, today, sized, triggers),
    )


# --- Each rule ---------------------------------------------------------------------------


def _excluded_by(
    rule: ExclusionRule, facts: CompanyFacts, rules: LeadFinderRules
) -> tuple[str, str | None] | None:
    """What says this company is one the rule leaves out: (the evidence, its link), or None."""
    industry = facts.industry.value or facts.industry_group or "its industry"
    if rule.kind == "industry":
        if facts.industry_group not in rule.industry_groups:
            return None
        return f"Its industry is {industry} ({facts.industry_group}).", facts.industry.source_url
    if rule.kind == "office_incidental":
        site_heavy = facts.industry_group in rules.criteria.industries.check_office_size
        if facts.office_matters.value is not False or not site_heavy:
            return None
        text = f"{industry}: the local staff are mostly not office staff."
        return text, facts.office_matters.source_url
    if facts.tender_only.value is not True:
        return None
    text = "A note says it buys its office fitouts only through formal public tender portals."
    return text, facts.tender_only.source_url


def _exclusion(
    facts: CompanyFacts, rules: LeadFinderRules, overrides: Mapping[str, Override]
) -> tuple[Excluded | None, list[RuleCheck]]:
    """The first exclusion that applies (Levi's section 3, PLAN-V16 T1-3), and its rule check.

    An active exclusion is a failed check, so the lead is a Drop. A person's override turns it
    into a flag: the lead is judged as if it didn't apply, and the card says who overrode. A
    company the rule's `unless` words describe (a government-owned corporation, an industry super
    fund) is not left out: it gets the rule's flag.
    """
    text = f"{facts.industry.value or ''} {facts.owner.value or ''}".casefold()
    for rule in rules.criteria.exclusions:
        found = _excluded_by(rule, facts, rules)
        if found is None:
            continue
        if rule.unless and any(word.casefold() in text for word in rule.unless):
            return None, [
                RuleCheck(rule="Excluded", outcome="flag", detail=rule.flag or rule.label)
            ]
        evidence, url = found
        override = overrides.get(rule.id)
        excluded = Excluded(
            reason_id=rule.id,
            label=rule.label,
            evidence=evidence,
            url=url,
            overridden_by=override.by if override else None,
            overridden_at=override.at if override else None,
        )
        if override is not None:
            detail = f"{rule.label}. {override.by} overrode this exclusion"
            return excluded, [RuleCheck(rule="Excluded", outcome="flag", detail=detail)]
        return excluded, [
            RuleCheck(rule="Excluded", outcome="fail", detail=f"{rule.label}. {evidence}")
        ]
    return None, []


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
        signs = {trigger.id for trigger in facts.triggers} & set(cities.no_city_director_signs)
        if signs:  # an overseas company new to Australia that names no city yet (PLAN-V9 B3)
            detail = "New to Australia, but no Australian city is named yet: a Director decides"
            return RuleCheck(rule="City", outcome="director", detail=detail)
        return RuleCheck(rule="City", outcome="unknown", detail="City not known")
    # All of Australia (PLAN-V16 T1-2): any place on our list passes, whatever its group. A place
    # that isn't on the list passes too, with a flag, so a person checks the city.
    city = city_of(place, rules)
    if city is not None and cities.group_of(city) is not None:
        return RuleCheck(rule="City", outcome="ok", detail=city)
    return RuleCheck(
        rule="City",
        outcome="flag",
        detail=f"{place} isn't one of the places we list. Check the city",
    )


def _size(facts: CompanyFacts, rules: LeadFinderRules, today: date) -> SizeJudgement:
    """The size rule. A known office size is judged against the range. A size worked out from
    staff follows the staff numbers (PLAN-V9 B1): `staff_hint_min` or more is fine; from
    `staff_floor` up to it is a Watch with a "check office size" flag; under the floor is a Drop,
    "too small". Since Levi's 9 Nov meeting both are 50, so 50+ staff fits and the Watch band is
    empty (PLAN-V11 B2). A small company that will soon need an office in range still fits
    (`_growing`), whatever its staff today."""
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
            return replace(grown, staff=staff)
        unknown = RuleCheck(
            rule="Size", outcome="unknown", detail="Office size and staff not known"
        )
        return SizeJudgement(unknown, None, False, "none")

    text = f"{m2:,} m²{basis}"
    low, _ = size.director_band_m2
    got: SizeBasis = "estimated" if estimated else "confirmed"

    def judged(check: RuleCheck, size_basis: SizeBasis, is_estimated: bool) -> SizeJudgement:
        return SizeJudgement(check, m2, is_estimated, size_basis, staff, from_staff)

    if m2 > size.office_m2_max or (staff is not None and staff > size.staff_max):
        check = RuleCheck(rule="Size", outcome="director", detail=f"{text}: over the top limit")
        return judged(check, "director", estimated)  # no reason to look at growth
    if m2 >= size.office_m2_min:
        return judged(RuleCheck(rule="Size", outcome="ok", detail=text), got, estimated)
    why: SizeBasis = "below"
    if from_staff and staff is not None:
        hint, floor = size.staff_hint_min, size.staff_floor
        if staff >= hint:
            detail = f"{text}: at the staff hint ({hint}+)"
            return judged(RuleCheck(rule="Size", outcome="ok", detail=detail), got, True)
        if staff >= floor:
            why = "small"
            detail = f"{text}: under {hint} staff, so a Watch. Check the office size"
            check = RuleCheck(rule="Size", outcome="flag", detail=detail)
        else:
            detail = f"{text}: under {floor} staff, too small"
            check = RuleCheck(rule="Size", outcome="fail", detail=detail)
    elif m2 >= low:
        why = "director"
        check = RuleCheck(rule="Size", outcome="director", detail=f"{text}: just under the minimum")
    else:
        check = RuleCheck(rule="Size", outcome="fail", detail=f"{text}: too small")
    grown = _growing(facts, rules, today)
    return replace(grown, staff=staff) if grown is not None else judged(check, why, estimated)


def _growing(facts: CompanyFacts, rules: LeadFinderRules, today: date) -> SizeJudgement | None:
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
        return SizeJudgement(
            RuleCheck(rule="Size", outcome="director", detail=detail), needed, True, "director"
        )
    if when is None:
        detail = f"Growing into the range: will need about {text}. When is not known, so check"
        return SizeJudgement(
            RuleCheck(rule="Size", outcome="flag", detail=detail), needed, True, "below"
        )
    detail = f"Growing into the range: will need about {text} by {facts.growth_by.value}"
    return SizeJudgement(
        RuleCheck(rule="Size", outcome="ok", detail=detail), needed, True, "growing"
    )


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


GROUP_WORDS = {
    "priority": "priority city",
    "secondary": "secondary city",
    "capital": "capital city",
    "regional": "regional centre",
}


def _filters(
    facts: CompanyFacts,
    rules: LeadFinderRules,
    city_check: RuleCheck,
    sized: SizeJudgement,
    excluded: Excluded | None,
) -> list[FilterResult]:
    """Levi's five filters, each pass, fail or estimated (his section 2, PLAN-V16 T1-3).

    They say the same thing as the rule checks, in his words. A fact nobody found is "estimated"
    and labelled (choice 3), never a fail. A filter fails only when a fact we know says no: a size
    or a staff count under the floor, or an office that doesn't matter in a site-heavy industry.
    """
    criteria = rules.criteria
    size = criteria.size
    results: list[FilterResult] = []

    def add(id: FilterId, state: FilterState, basis: str) -> None:
        results.append(FilterResult(id=id, label=FILTER_LABELS[id], state=state, basis=basis))

    # 1. Location: any place on our list passes, and so does a place that isn't (with its flag)
    if city_check.outcome == "ok":
        group = criteria.cities.group_of(city_check.detail)
        words = f", a {GROUP_WORDS[group]}" if group else ""
        add("location", "pass", f"{city_check.detail}{words}")
    elif city_check.outcome == "flag":
        add("location", "pass", city_check.detail)
    else:
        add("location", "estimated", city_check.detail)

    # 2. Office size: 1,000 m² or more now, or within 24 months
    outcome = sized.check.outcome
    if outcome == "fail":
        state: FilterState = "fail"
    elif outcome == "ok":
        state = "pass" if sized.basis == "confirmed" else "estimated"
    elif outcome == "director":  # over the top limit still meets it; just under the minimum doesn't
        over = (sized.m2 or 0) > size.office_m2_max or (sized.staff or 0) > size.staff_max
        state = "pass" if over else "estimated"
    else:  # flag or unknown
        state = "estimated"
    add("office_size", state, sized.check.detail)

    # 3. Headcount: staff in that city, not the company's. 50+ qualifies (Levi, 9 Nov)
    staff = sized.staff
    if sized.from_staff and sized.check.outcome == "fail" and staff is not None:
        add("headcount", "fail", f"{staff:,} staff in the city, under {size.staff_floor}")
    elif staff is None:
        grows = sized.basis == "growing"
        add(
            "headcount",
            "estimated",
            "No staff count, but it plans to grow into the office it will need"
            if grows
            else "Staff in the city not known",
        )
    elif staff >= size.staff_min:
        confirmed = facts.staff_in_city.label == "confirmed" and not facts.staff_from_linkedin
        counted = f"{staff:,} staff in the city"
        add(
            "headcount",
            "pass" if confirmed else "estimated",
            counted if confirmed else f"{counted}, estimated",
        )
    else:
        under = f"{staff:,} staff in the city, under {size.staff_min}"
        add("headcount", "estimated", f"{under}. Its office or its plan to grow carries it")

    # 4. Office relevance: the office matters to how they work (an office-based business)
    industry = facts.industry.value or "Industry not known"
    incidental = (
        excluded is not None
        and excluded.overridden_by is None
        and any(
            rule.id == excluded.reason_id and rule.kind == "office_incidental"
            for rule in criteria.exclusions
        )
    )
    if incidental:
        add("office_relevance", "fail", f"{industry}: most of the local staff are not office staff")
    elif facts.office_matters.value is True:
        add("office_relevance", "pass", f"{industry}: the office matters to how they work")
    elif facts.office_matters.value is False:
        text = f"{industry}: the office may not matter to how they work. Check the office size"
        add("office_relevance", "estimated", text)
    elif facts.industry_group in criteria.industries.check_office_size:
        add("office_relevance", "estimated", f"{industry}: a site-heavy industry. Check the office")
    elif facts.industry.value is not None:
        add("office_relevance", "estimated", f"Not stated. Assumed from its industry ({industry})")
    else:
        add("office_relevance", "estimated", "Not known: no industry and no note about the office")

    # 5. Sector: a priority sector earns the sector points. Any other sector passes too, so the
    # score and the tier decide (Levi: other sectors "can qualify on strong signals")
    priority = [*criteria.industries.tier_1, *criteria.industries.tier_2]
    if facts.tier_group in priority:
        add("sector", "pass", f"Priority sector: {facts.tier_group}")
    elif facts.industry.value is not None:
        add("sector", "pass", f"{facts.industry.value}: not a priority sector, so no sector points")
    else:
        add("sector", "estimated", "Industry not known")
    return results


@dataclass(frozen=True)
class History:
    """How long the company has been at its address, and whether it moved or fitted out lately."""

    since: date | None
    fitout: date | None
    years_at: float | None  # None when the move-in is not known
    due: bool | None  # more than `office_age.due_years` at this address
    recent: bool | None  # a move or fitout lately. None when neither date is known
    # A move or fitout in the last `office_age.just_moved_months` (PLAN-V11 B3). A date still to
    # come doesn't count. None when neither date is known.
    just_moved: bool | None = None
    # How many years ago the last fitout was, when one is known (Levi's long tenure rule asks for
    # none in the last 5 years)
    fitout_years_ago: float | None = None


def office_history(facts: CompanyFacts, rules: LeadFinderRules, today: date) -> History:
    age = rules.criteria.office_age
    since = parse_date(facts.office_since.value)
    fitout = parse_date(facts.last_fitout.value)
    known = [day for day in (since, fitout) if day is not None]
    years_at = (today - since).days / DAYS_PER_YEAR if since else None
    days_ago = (today - max(known)).days if known else None
    return History(
        since=since,
        fitout=fitout,
        years_at=years_at,
        due=None if years_at is None else years_at > age.due_years,
        recent=(None if days_ago is None else days_ago < age.recent_move_years * DAYS_PER_YEAR),
        just_moved=(
            None
            if days_ago is None
            else 0 <= days_ago < round(age.just_moved_months * DAYS_PER_MONTH)
        ),
        fitout_years_ago=(today - fitout).days / DAYS_PER_YEAR if fitout else None,
    )


def _just_moved_words(facts: CompanyFacts, history: History) -> str:
    """Like "Moved in March 2026, so probably not in the market yet" (PLAN-V11 B3)."""
    moved = history.since is not None and (
        history.fitout is None or history.since >= history.fitout
    )
    what, text = (
        ("Moved", facts.office_since.value) if moved else ("Fitted out", facts.last_fitout.value)
    )
    return f"{what} in {month_year(text)}, so probably not in the market yet"


def _history_check(
    facts: CompanyFacts, history: History, rules: LeadFinderRules
) -> RuleCheck | None:
    """A note for the card: a recent move or fitout makes a new project less likely. A very recent
    one is a rule (PLAN-V11 B3): the lead is a Watch, and the check says why. None when neither
    date is known."""
    if history.recent is None:
        return None
    if history.just_moved:
        return RuleCheck(rule=JUST_MOVED, outcome="flag", detail=_just_moved_words(facts, history))
    sentences = []
    if history.since is not None and history.years_at is not None:
        since = f"At this address since {history.since.year} ({history.years_at:.1f} years)"
        sentences.append(since)
    if history.fitout is not None:
        sentences.append(f"Last fitout {history.fitout.year}")
    if history.recent:
        years = rules.criteria.office_age.recent_move_years
        sentences.append(
            f"A move or fitout in the last {years} years, so a new project is less likely"
        )
    elif history.due:
        sentences.append("Due for a new fitout")
    outcome: Outcome = "flag" if history.recent else "ok"
    return RuleCheck(rule="Office history", outcome=outcome, detail=". ".join(sentences))


def has_long_tenure(history: History, rules: LeadFinderRules, healthy: bool | None = None) -> bool:
    """An old office (Levi's section 4, PLAN-V16 T1-4, from PLAN-V11 C1): at the same address for
    `office_age.tenure_years` or more, stable or growing, with no known fitout there in the last
    `office_age.tenure_fitout_years`. An exact move-in date isn't needed: a year is enough ("at
    this address since at least 2017"). A fitout before the move-in was part of the move, and a
    fitout longer ago than the limit doesn't stop it. A company that is cutting staff fast or in
    administration (`healthy` is false) isn't stable, so it has no tenure sign."""
    age = rules.criteria.office_age
    if healthy is False:
        return False
    if history.since is None or history.years_at is None or history.years_at < age.tenure_years:
        return False
    if history.fitout is None or history.fitout <= history.since:
        return True
    return (history.fitout_years_ago or 0) >= age.tenure_fitout_years


def with_tenure_sign(facts: CompanyFacts, history: History, rules: LeadFinderRules) -> CompanyFacts:
    """The facts with the old office's sign added when the dates show one (PLAN-V11 C1). The code
    adds it, never Claude, so a sign with that id from Claude is left out. The sign has no date:
    the years at the address earn their own Timing points. Its link is the move-in's source."""
    sign_id = rules.criteria.office_age.tenure_sign
    others = [trigger for trigger in facts.triggers if trigger.id != sign_id]
    if not has_long_tenure(history, rules, facts.healthy.value):
        if len(others) == len(facts.triggers):
            return facts
        return facts.model_copy(update={"triggers": others})
    since = facts.office_since
    years = int(history.years_at or 0)
    sign = TriggerFound(
        id=sign_id,
        what_happened=(
            f"At this address since at least {month_year(since.value)} ({years} years), "
            "with no known fitout there in the last "
            f"{rules.criteria.office_age.tenure_fitout_years} years."
        ),
        date=None,
        source_url=since.source_url or "",
        label=since.label or "confirmed",
    )
    return facts.model_copy(update={"triggers": [*others, sign]})


# --- Dampeners (Levi's section 5, PLAN-V16 T1-5) -------------------------------------------------


class _Event(NamedTuple):
    """A fitout or a move that has happened, from the facts the form already holds or from
    Claude's dampener answer."""

    when: date
    when_text: str | None
    evidence: str
    url: str | None
    can_reverse: str | None


def _dampeners(
    facts: CompanyFacts,
    rules: LeadFinderRules,
    today: date,
    sized: SizeJudgement,
    triggers: list[TriggerScore],
) -> list[Dampener]:
    """Every dampener the rules list: found, not found, or not checked, in the rules' order.

    The four Levi has searched for come from Claude's answer (`facts.dampeners`). A fitout or a
    move, and a buyer that uses tender portals only, also show in facts the form holds already, so
    they count too, and a card never says "not found" beside a fitout it shows elsewhere. Financial
    stress reads `healthy`. "Not checked" is a check nobody ran, like a card made before this rule
    or a search the run skipped: it says nothing either way. Points come off in the score (T1-6).
    """
    answers: dict[str, DampenerFinding] = {finding.id: finding for finding in facts.dampeners}
    signs = {score.trigger.id for score in triggers}
    results: list[Dampener] = []
    for rule in rules.criteria.dampeners:
        answer = answers.get(rule.id)
        if rule.id == "recent_fitout":
            results.append(_recent_fitout(rule, facts, rules, today, sized, answer))
        elif rule.id == "procurement":
            results.append(_procurement(rule, facts, answer))
        elif rule.id == "financial_stress":
            results.append(_financial_stress(rule, facts, rules, signs))
        else:
            results.append(_searched(rule, answer))
    return results


def _found(
    rule: DampenerRule, answer: DampenerFinding, strength: DampenerStrength | None
) -> Dampener:
    return Dampener(
        id=rule.id,
        label=rule.label,
        state="found",
        strength=strength,
        evidence=answer.evidence or rule.label,
        date=answer.date,
        url=answer.source_url,
        can_reverse=answer.can_reverse,
    )


def _searched(rule: DampenerRule, answer: DampenerFinding | None) -> Dampener:
    """An outsourcing deal or a tie to a competitor: only Claude's answer says."""
    if answer is None:
        return Dampener(id=rule.id, label=rule.label, state="not_checked")
    if answer.state == "not_found":
        return Dampener(id=rule.id, label=rule.label, state="not_found")
    return _found(rule, answer, rule.strength)


def _procurement(
    rule: DampenerRule, facts: CompanyFacts, answer: DampenerFinding | None
) -> Dampener:
    """A red flag in Claude's answer, and a company that buys fitouts only through tender portals
    (the fact the exclusion reads). When a person overrides that exclusion the lead is judged
    without it, and this is what still counts against it. The stronger flag wins."""
    flags: list[Dampener] = []
    if answer is not None and answer.state == "found":
        flags.append(_found(rule, answer, rule.kinds.get(answer.kind or "", rule.strength)))
    if facts.tender_only.value is True:
        flags.append(
            Dampener(
                id=rule.id,
                label=rule.label,
                state="found",
                strength=rule.kinds.get("tender_portal", rule.strength),
                evidence="A note says it buys its office fitouts only through formal public "
                "tender portals.",
                date=facts.tender_only.source_date,
                url=facts.tender_only.source_url,
            )
        )
    if flags:
        return max(flags, key=lambda flag: flag.strength == "strong")  # the answer wins a tie
    state: DampenerStatus = "not_found" if answer is not None else "not_checked"
    return Dampener(id=rule.id, label=rule.label, state=state)


def _financial_stress(
    rule: DampenerRule, facts: CompanyFacts, rules: LeadFinderRules, signs: set[str]
) -> Dampener:
    """From the `healthy` fact: false when a note says it is in administration or cutting staff
    fast. Levi: unless it is part of a consolidation that creates a move, so then it takes
    nothing off."""
    healthy = facts.healthy
    if healthy.value is None:
        return Dampener(id=rule.id, label=rule.label, state="not_checked")
    if healthy.value:
        return Dampener(id=rule.id, label=rule.label, state="not_found")
    labels = {sign.id: sign.label for sign in rules.criteria.triggers.every}
    reasons = [labels.get(sign, sign) for sign in rule.waived_by if sign in signs]
    return Dampener(
        id=rule.id,
        label=rule.label,
        state="found",
        strength=rule.strength,
        evidence="A note says it is in administration, or cutting staff fast.",
        date=healthy.source_date,
        url=healthy.source_url,
        waived=(
            f"Takes nothing off: it is part of a consolidation that creates a move ({reasons[0]})."
            if reasons
            else None
        ),
    )


def _recent_fitout(
    rule: DampenerRule,
    facts: CompanyFacts,
    rules: LeadFinderRules,
    today: date,
    sized: SizeJudgement,
    answer: DampenerFinding | None,
) -> Dampener:
    """A fitout or move in that city: strong in the last `strong_years`, moderate up to
    `moderate_years`, and nothing after that. The move-in, the last fitout and Claude's answer all
    count, and the newest one decides (the answer wins a tie). An answer with no date counts as
    moderate. A date to come isn't a fitout yet. It takes nothing off when hiring would outgrow
    the space within `outgrow_months` (Levi: still list the lead). PLAN-V11's rule that a move in
    the last 12 months is a Watch stays in `judge`: it is this dampener's strongest case."""
    assert rule.strong_years is not None and rule.moderate_years is not None
    assert rule.outgrow_months is not None
    undated: DampenerFinding | None = None
    events: list[_Event] = []
    if answer is not None and answer.state == "found":
        when = parse_date(answer.date)
        if when is None:
            undated = answer
        elif when <= today:
            events.append(
                _Event(
                    when,
                    answer.date,
                    answer.evidence or rule.label,
                    answer.source_url,
                    answer.can_reverse,
                )
            )
    for fact, words in (
        (facts.office_since, "Moved into its current office in"),
        (facts.last_fitout, "Last fitout in"),
    ):
        when = parse_date(fact.value)
        if when is not None and when <= today:
            text = f"{words} {month_year(fact.value)}."
            events.append(_Event(when, fact.value, text, fact.source_url, None))

    newest = max(events, key=lambda event: event.when, default=None)
    strength: DampenerStrength | None = None
    if newest is not None:
        years_ago = (today - newest.when).days / DAYS_PER_YEAR
        if years_ago <= rule.moderate_years:
            strength = "strong" if years_ago <= rule.strong_years else "moderate"
    outgrows = _outgrows(facts, rules, today, sized, rule.outgrow_months)
    waived = f"Takes nothing off: {outgrows}." if outgrows else None
    if newest is not None and strength is not None:
        return Dampener(
            id=rule.id,
            label=rule.label,
            state="found",
            strength=strength,
            evidence=newest.evidence,
            date=newest.when_text,
            url=newest.url,
            can_reverse=newest.can_reverse,
            waived=waived,
        )
    if undated is not None:  # found, but we can't say how long ago
        return Dampener(
            id=rule.id,
            label=rule.label,
            state="found",
            strength="moderate",
            evidence=f"{undated.evidence or rule.label} (date not known)",
            url=undated.source_url,
            can_reverse=undated.can_reverse,
            waived=waived,
        )
    # Nothing in the last `moderate_years`. It was checked if Claude answered, or a date is known
    looked = answer is not None or newest is not None
    return Dampener(id=rule.id, label=rule.label, state="not_found" if looked else "not_checked")


def _outgrows(
    facts: CompanyFacts,
    rules: LeadFinderRules,
    today: date,
    sized: SizeJudgement,
    months: int,
) -> str | None:
    """When the company's hiring would outgrow its office within `months` (Levi's section 5): it
    plans to hire a lot, says it will need more space than it has now, and by a date inside the
    window. A sentence that says so, or None. The office now is its known floor area, or about 10
    m² a person (as the size rule works it out)."""
    needed = facts.size_needed_m2.value
    when = parse_date(facts.growth_by.value)
    if facts.growth_plan.value is not True or needed is None or when is None:
        return None
    now = facts.office_m2.value
    if now is None and sized.staff is not None:
        now = round(sized.staff * rules.criteria.size.m2_per_staff)
    if now is None or needed <= now:
        return None
    if when > today + timedelta(days=round(months * DAYS_PER_MONTH)):
        return None
    return (
        f"it says it will need about {needed:,} m² by {facts.growth_by.value}, "
        f"more than the {now:,} m² it has now"
    )


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
            timing = score.undated
        elif trigger.id == "lease_ending":
            days_out = (when - today).days
            if not 0 <= days_out <= window:
                continue  # already ended, or too far away
            in_best = low * DAYS_PER_YEAR <= days_out <= high * DAYS_PER_YEAR
            timing = score.lease_in_best_window if in_best else score.recency[-1].points
        elif when > today:
            if (when - today).days > window:
                continue
            timing = score.recency[0].points  # announced and still to come
        else:
            if today - when > recent:
                continue  # too old to count
            age = (today - when).days
            timing = next((s.points for s in score.recency if age <= s.within_days), 0)
        kind = source_kind(trigger.source_url, criteria, company_domain)
        group_points = score.trigger_group[group]
        source_points = score.source.get(kind, 0)
        counted.append(
            TriggerScore(
                trigger=trigger,
                group=group,
                strength=criteria.triggers.strength_of(trigger.id),
                source_kind=kind,
                points=group_points + timing + source_points,
                group_points=group_points,
                source_points=source_points,
                timing_points=timing,
            )
        )
    return sorted(counted, key=lambda t: t.points, reverse=True)


# --- The score ---------------------------------------------------------------------------


def _score_parts(
    triggers: list[TriggerScore],
    facts: CompanyFacts,
    sized: SizeJudgement,
    history: History,
    rules: LeadFinderRules,
) -> list[ScorePart]:
    """The six parts of the score, each with its checks. A check is "not known yet" when the tool
    can't judge it for this lead, and then it adds nothing to `checked`."""
    criteria = rules.criteria
    score = criteria.score
    best = triggers[0] if triggers else None
    evidence = {booster.id: booster.evidence for booster in facts.boosters}

    def check(
        id: str, earned: int, most: int, *, known: bool = True, detail: str = ""
    ) -> ScoreCheck:
        known = known and id not in score.unseen
        return ScoreCheck(
            id=id,
            label=score.check_labels[id],
            earned=earned if known else 0,
            max=most,
            known=known,
            detail=detail if known else "",
        )

    size_points = {
        "confirmed": score.size.confirmed_in_range,
        "estimated": score.size.estimated_in_range,
        "growing": score.size.growing_into_range,
        "director": score.size.director,
        "small": 0,
        "below": 0,
        "none": 0,
    }
    tier = facts.tier_group
    tier_points = (
        score.fit.tier_1
        if tier in criteria.industries.tier_1
        else score.fit.tier_2
        if tier in criteria.industries.tier_2
        else 0
    )
    years = f"{history.years_at:.1f} years at this address" if history.years_at is not None else ""
    last = max((d for d in (history.since, history.fitout) if d is not None), default=None)
    by_part: dict[str, list[ScoreCheck]] = {
        "trigger": [
            check(
                "trigger_group",
                best.group_points if best else 0,
                max(score.trigger_group.values()),
                detail=best.trigger.what_happened if best else "No sign of an office change yet",
            ),
            check(
                "source",
                best.source_points if best else 0,
                max(score.source.values()),
                detail=best.source_kind.replace("_", " ") if best else "",
            ),
        ],
        "size": [
            check(
                "size",
                size_points[sized.basis],
                criteria.score.parts["size"].points,
                known=sized.basis != "none",
                detail=sized.check.detail,
            )
        ],
        "timing": [
            check(
                "recency",
                best.timing_points if best else 0,
                score.recency_max,
                detail=f"Dated {best.trigger.date}" if best and best.trigger.date else "",
            ),
            check(
                "years_at_address",
                score.years_at_address if history.due else 0,
                score.years_at_address,
                known=history.years_at is not None,
                detail=years,
            ),
            check(
                "no_recent_move",
                score.no_recent_move if history.recent is False else 0,
                score.no_recent_move,
                known=history.recent is not None,
                detail=f"Last move or fitout {last.year}" if last else "",
            ),
        ],
        "access": [
            check(
                "contact_role",
                score.access.contact_role if facts.contact_role else 0,
                score.access.contact_role,
                detail=facts.contact_role or "No contact role found",
            ),
            check("hubspot_contact", 0, score.access.hubspot_contact, known=False),
            check("customer_link", 0, score.access.customer_link, known=False),
        ],
        "fit": [
            check(
                "buys_strategy",
                score.fit.buys_strategy if "buys_strategy" in evidence else 0,
                score.fit.buys_strategy,
                detail=evidence.get("buys_strategy", "No sign found"),
            ),
            check(
                "industry_tier",
                tier_points,
                max(score.fit.tier_1, score.fit.tier_2),
                known=facts.industry.value is not None,
                detail=tier or "Not in a tier",
            ),
        ],
        "competition": [
            check(
                "no_rival_in_place",
                score.competition.no_rival_in_place if "no_rival_in_place" in evidence else 0,
                score.competition.no_rival_in_place,
                detail=evidence.get("no_rival_in_place", "No sign found"),
            ),
            check(
                "no_contractor_relationship",
                0,
                score.competition.no_contractor_relationship,
                known=False,
            ),
        ],
    }
    return [
        ScorePart(
            id=part_id,
            label=rule.label,
            max=rule.points,
            earned=sum(c.earned for c in by_part[part_id]),
            checked=sum(c.max for c in by_part[part_id] if c.known),
            checks=by_part[part_id],
        )
        for part_id, rule in score.parts.items()
    ]


def band_of(score: int, checked: int, rules: LeadFinderRules) -> Band:
    """The Profile's bands: 75 to 100 research first, 50 to 74 investigate, under 50 nurture. With
    `band_basis: scaled` the points earned are scaled to the points checked first, so
    48 of 60 counts as 80."""
    rule = rules.criteria.score
    value = score
    if rule.band_basis == "scaled":
        value = round(score * 100 / checked) if checked else 0
    if value >= rule.bands.research_first:
        return "research_first"
    if value >= rule.bands.investigate:
        return "investigate"
    return "nurture"
