"""The rules and the score. Pure code: no AI and no database inside.

The same facts always get the same result, so every rule is easy to test. The rules come
from Criteria_v2.md (a draft until Levi confirms it), through rules/criteria.yaml.

The score is the Target Customer Profile's 100 points in six parts. Each part is a few checks.
A check earns points, or it is "not known yet" when the tool can't judge it for this lead. The
score is the points earned. "Checked" is the most the tool could judge, like "48 of 60 checked".
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from apps.lead_finder.fields import CompanyFacts, TriggerFound
from apps.lead_finder.rules import LeadFinderRules, Result
from apps.lead_finder.sources import host_of, source_kind
from core.hubspot.matching import CandidateReason, HubSpotMatch

Outcome = Literal["ok", "fail", "director", "unknown", "flag"]
Group = Literal["main", "other", "weak"]
Band = Literal["research_first", "investigate", "nurture"]
# "small": worked out from staff between staff_floor and staff_hint_min. The lead is a Watch at
# best, with a "check office size" flag (PLAN-V9 B1).
SizeBasis = Literal["confirmed", "estimated", "growing", "director", "small", "below", "none"]
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


@dataclass(frozen=True)
class SizeJudgement:
    """The size rule's check, the office size it used, and what that size rests on."""

    check: RuleCheck
    m2: int | None
    estimated: bool
    basis: SizeBasis


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
    sized = _size(facts, rules, today)
    checks.append(sized.check)
    checks.append(_office(facts, rules))
    checks += _local_and_healthy(facts)
    triggers = _triggers(facts, rules, today)
    checks.append(
        RuleCheck(rule="Trigger", outcome="ok", detail=triggers[0].trigger.what_happened)
        if triggers
        else RuleCheck(rule="Trigger", outcome="unknown", detail="No sign of an office change yet")
    )
    history = office_history(facts, rules, today)
    history_check = _history_check(history, rules)
    if history_check is not None:  # left out when nothing is known, so a card isn't all "unknown"
        checks.append(history_check)

    outcomes = {check.outcome for check in checks}
    unknown_core = any(c.outcome == "unknown" and c.rule in ("City", "Size") for c in checks)
    result: Result
    if "fail" in outcomes:
        result = "drop"
    elif not triggers:
        result = "watch"
    elif sized.basis == "small":
        result = "watch"  # 50 to 74 staff, not growing: a person checks the office size first
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
        signs = {trigger.id for trigger in facts.triggers} & set(cities.no_city_director_signs)
        if signs:  # an overseas company new to Australia that names no city yet (PLAN-V9 B3)
            detail = "New to Australia, but no Australian city is named yet: a Director decides"
            return RuleCheck(rule="City", outcome="director", detail=detail)
        return RuleCheck(rule="City", outcome="unknown", detail="City not known")
    city = city_of(place, rules)
    if city in cities.pass_:
        return RuleCheck(rule="City", outcome="ok", detail=city)
    if city in cities.director_review:
        return RuleCheck(rule="City", outcome="director", detail=f"{city}: a Director decides")
    if cities.other_cities == "drop":
        return RuleCheck(rule="City", outcome="fail", detail=f"{place} is outside our cities")
    return RuleCheck(rule="City", outcome="director", detail=f"{place}: a Director decides")


def _size(facts: CompanyFacts, rules: LeadFinderRules, today: date) -> SizeJudgement:
    """The size rule. A known office size is judged against the range. A size worked out from
    staff follows the staff numbers (PLAN-V9 B1, Levi 5 Nov): `staff_hint_min` (75) or more is
    fine; from `staff_floor` (50) up to it is a Watch with a "check office size" flag; under the
    floor is a Drop, "too small". A small company that will soon need an office in range still
    fits (`_growing`), whatever its staff today."""
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
        unknown = RuleCheck(
            rule="Size", outcome="unknown", detail="Office size and staff not known"
        )
        return SizeJudgement(unknown, None, False, "none")

    text = f"{m2:,} m²{basis}"
    low, _ = size.director_band_m2
    got: SizeBasis = "estimated" if estimated else "confirmed"
    if m2 > size.office_m2_max or (staff is not None and staff > size.staff_max):
        check = RuleCheck(rule="Size", outcome="director", detail=f"{text}: over the top limit")
        return SizeJudgement(check, m2, estimated, "director")  # no reason to look at growth
    if m2 >= size.office_m2_min:
        return SizeJudgement(RuleCheck(rule="Size", outcome="ok", detail=text), m2, estimated, got)
    why: SizeBasis = "below"
    if from_staff and staff is not None:
        hint, floor = size.staff_hint_min, size.staff_floor
        if staff >= hint:
            detail = f"{text}: at the staff hint ({hint}+)"
            return SizeJudgement(RuleCheck(rule="Size", outcome="ok", detail=detail), m2, True, got)
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
    return grown if grown is not None else SizeJudgement(check, m2, estimated, why)


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


@dataclass(frozen=True)
class History:
    """How long the company has been at its address, and whether it moved or fitted out lately."""

    since: date | None
    fitout: date | None
    years_at: float | None  # None when the move-in is not known
    due: bool | None  # more than `office_age.due_years` at this address
    recent: bool | None  # a move or fitout lately. None when neither date is known


def office_history(facts: CompanyFacts, rules: LeadFinderRules, today: date) -> History:
    age = rules.criteria.office_age
    since = parse_date(facts.office_since.value)
    fitout = parse_date(facts.last_fitout.value)
    known = [day for day in (since, fitout) if day is not None]
    years_at = (today - since).days / DAYS_PER_YEAR if since else None
    return History(
        since=since,
        fitout=fitout,
        years_at=years_at,
        due=None if years_at is None else years_at > age.due_years,
        recent=(
            (today - max(known)).days < age.recent_move_years * DAYS_PER_YEAR if known else None
        ),
    )


def _history_check(history: History, rules: LeadFinderRules) -> RuleCheck | None:
    """A note for the card, not a rule: a recent move or fitout makes a new project less likely.
    None when neither date is known."""
    if history.recent is None:
        return None
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
