"""Loads and checks the Lead Finder's rules files. The backend won't start if one is wrong.

The files live in rules/: criteria.yaml (the company criteria), queries.yaml (the search
templates), hubspot_map.yaml (which field goes where in HubSpot) and watchlist.yaml (which
HubSpot companies are worth watching). Each run will save the rules version it used, so old
results stay explainable after the rules change.
"""

import hashlib
import re
import string
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

RULES_DIR = Path(__file__).resolve().parent / "rules"
RULE_FILES = ("criteria", "queries", "hubspot_map", "watchlist")
PLACEHOLDERS = {"city", "area", "company", "year", "month_year"}
# The search angles for one company. tenure is the lease and tenure run's office questions (C2).
# dampeners looks for the facts that make an office project less likely (PLAN-V16 T1-5).
ANGLES = {"property", "people", "money", "tenure", "dampeners"}
# Levi's dampener search is "up to 3 web searches a company" (the plan, T1-5). The research gives it
# this many on top of `company_max_searches`, so the old angles and the gap check keep their own.
MAX_DAMPENER_SEARCHES = 3


class Strict(BaseModel):
    """Unknown keys are an error, so a typo in a rules file stops the backend from starting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


# A whole number of years from 1 to 15, for the lease guess (a 5.5 or a "5" is an error)
GuessYears = Annotated[StrictInt, Field(ge=1, le=15)]


# --- criteria.yaml ----------------------------------------------------------------------


CityGroup = Literal["priority", "secondary", "capital", "regional"]
CITY_GROUPS: tuple[CityGroup, ...] = ("priority", "secondary", "capital", "regional")


class Cities(Strict):
    """Where a lead's office may be, for all of Australia (PLAN-V16 T1-2, Al-khair 15 Nov).

    Every place in a group passes the location filter. The groups only change the city points of
    the score. A place that isn't listed passes too, with the flag "check the city"
    (`scoring._city`). `national` is not a place: it is the name of the run choice that searches
    all of Australia at once, one search for each sign instead of one for each city.
    """

    groups: dict[CityGroup, list[str]]
    national: str = Field(min_length=1, max_length=40)
    # A lead with one of these signs and no known city goes to a Director, not to Watch (PLAN-V9 B3)
    no_city_director_signs: list[str] = Field(default_factory=list)

    @property
    def every(self) -> list[str]:
        """Every place, the priority group first."""
        return [city for group in CITY_GROUPS for city in self.groups[group]]

    def group_of(self, city: str) -> CityGroup | None:
        """The group a place is in, or None when it isn't listed."""
        for group in CITY_GROUPS:
            if city in self.groups[group]:
                return group
        return None

    @model_validator(mode="after")
    def check_groups(self) -> Self:
        if set(self.groups) != set(CITY_GROUPS):
            raise ValueError("cities.groups needs priority, secondary, capital and regional")
        empty = [group for group in CITY_GROUPS if not self.groups[group]]
        if empty:
            raise ValueError(f"cities.groups has no place in: {', '.join(empty)}")
        every = self.every
        repeated = sorted({city for city in every if every.count(city) > 1})
        if repeated:
            raise ValueError(f"A place is listed twice in cities.groups: {', '.join(repeated)}")
        if self.national in every:
            raise ValueError("cities.national is a run choice. It can't also be a place")
        return self


StaffSource = Literal["hubspot", "headcount_tool", "linkedin", "web_research"]


class Size(Strict):
    staff_min: int = Field(gt=0)
    staff_hint_min: int = Field(gt=0)
    # Under this, a size worked out from staff is a Drop unless the company is growing (PLAN-V9 B1)
    staff_floor: int = Field(gt=0)
    # Discovery signs that mean the company is growing: never stopped early for its size (B2)
    growth_signs: list[str] = Field(default_factory=list)
    staff_max: int = Field(gt=0)
    staff_counted_in: Literal["city", "company"]
    office_m2_min: int = Field(gt=0)
    office_m2_max: int = Field(gt=0)
    m2_per_staff: float = Field(gt=0)
    director_band_m2: tuple[int, int]
    linkedin_staff_multiplier: float = Field(gt=0)
    grow_into_range_months: int = Field(gt=0)
    staff_sources: list[StaffSource] = Field(min_length=1)
    # Signal Hire's count of the people on file in the city, times this, is the staff estimate. The
    # upper bound only stops a typo (200 for 2) from making every company look big.
    headcount_tool_multiplier: float = Field(gt=0, le=20)
    # required: a count needs the Company API to match the name. optional: the name as typed
    # is used when it can't be matched. auto: required while the Company API answers, and the
    # name as typed while it is switched off (a 403), so it turns strict by itself (PLAN-V4 C3).
    headcount_tool_name_check: Literal["required", "optional", "auto"]

    @model_validator(mode="after")
    def check_ranges(self) -> Self:
        if self.staff_min >= self.staff_max:
            raise ValueError("staff_min must be below staff_max")
        if self.staff_hint_min > self.staff_min:
            raise ValueError("staff_hint_min must not be above staff_min")
        if self.staff_floor > self.staff_hint_min:
            raise ValueError("staff_floor must not be above staff_hint_min")
        if len(set(self.growth_signs)) != len(self.growth_signs):
            raise ValueError("growth_signs lists a sign twice")
        if len(set(self.staff_sources)) != len(self.staff_sources):
            raise ValueError("staff_sources lists a source twice")
        if self.office_m2_min >= self.office_m2_max:
            raise ValueError("office_m2_min must be below office_m2_max")
        low, high = self.director_band_m2
        if not 0 < low < high <= self.office_m2_min:
            raise ValueError("director_band_m2 must sit just below office_m2_min")
        return self


DataSource = Literal["headcount_tool", "web_research"]
# The sources of the office's size, its lease end and its move-in date (PLAN-V16 T1-8): the two
# property tools, HubSpot and the web research.
OfficeSource = Literal["property_daily", "arealytics", "hubspot", "web_research"]


class DataSources(Strict):
    """Which source is main for which data (PLAN-V4 C2). In each list the first source with a value
    is the one the rules use, and the ones after it are the backup. Staff numbers have their own
    list, `size.staff_sources`. The office's size, lease end and move-in date have theirs since
    PLAN-V16 T1-8."""

    company_details: list[DataSource] = Field(min_length=1)
    office_cities: list[DataSource] = Field(min_length=1)
    decision_makers: list[DataSource] = Field(min_length=1)
    office_m2: list[OfficeSource] = Field(min_length=1)
    lease_end: list[OfficeSource] = Field(min_length=1)
    office_since: list[OfficeSource] = Field(min_length=1)

    @model_validator(mode="after")
    def check_lists(self) -> Self:
        for name, sources in self.model_dump().items():
            if len(set(sources)) != len(sources):
                raise ValueError(f"data_sources.{name} lists a source twice")
        return self


class Conflicts(Strict):
    # Staff numbers from two sources more than this many times apart raise a flag. The lower bound
    # keeps a typo (0.5, or 1) from flagging every lead.
    staff_gap_ratio: float = Field(gt=1, le=20)
    # PLAN-V16 T1-8: two office sizes more than this many times apart, or two lease ends or move-in
    # dates more than this many months apart, raise a flag
    office_m2_gap_ratio: float = Field(gt=1, le=20)
    date_gap_months: int = Field(ge=1, le=120)


class Fitout(Strict):
    rate_per_m2_aud: Decimal = Field(gt=0)


class Industries(Strict):
    director_review: list[str]
    check_office_size: list[str]
    # Levi's priority sectors (his section 2, PLAN-V16 T1-6). They replace version 2's tier 1 and
    # tier 2 industries. Claude files a company in one of them (the fact `tier_group`, which keeps
    # its old name so saved cards still load), and the company earns the sector points.
    priority_sectors: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def check_priority_sectors(self) -> Self:
        repeated = sorted(
            {group for group in self.priority_sectors if self.priority_sectors.count(group) > 1}
        )
        if repeated:
            raise ValueError(f"A priority sector is listed twice: {', '.join(repeated)}")
        return self


ExclusionKind = Literal["industry", "office_incidental", "tender_only"]


class ExclusionRule(Strict):
    """A kind of company that is left out and not scored (Levi's section 3, PLAN-V16 T1-3).

    The code is `scoring._exclusion`. An excluded lead is a Drop that shows its reason and its
    evidence, and a person with the Lead Finder tick can override it: the lead is then judged
    again without the exclusion.

    - `industry`: the company's `industry_group` (the answer form) is one of `industry_groups`.
    - `office_incidental`: the office doesn't matter to how the company works, in an industry of
      `industries.check_office_size` (logistics, manufacturing, retail, hospitality...).
    - `tender_only`: a note says it buys its fitouts only through formal public tender portals.
    """

    id: str = Field(pattern=r"^[a-z][a-z_]*$")
    label: str = Field(min_length=1)
    kind: ExclusionKind
    industry_groups: list[str] = Field(default_factory=list)
    # What the extract prompt tells Claude a group means, so it files a company in the right group
    meaning: str | None = None
    # Words in the company's industry or owner that mean it is NOT one: a government-owned
    # corporation, an industry super fund. It is not left out, and its card shows `flag` instead.
    unless: list[str] = Field(default_factory=list)
    flag: str | None = None

    @model_validator(mode="after")
    def check_rule(self) -> Self:
        if self.kind == "industry" and not self.industry_groups:
            raise ValueError(f"exclusion {self.id}: an industry exclusion needs industry_groups")
        if self.kind != "industry" and (self.industry_groups or self.unless or self.flag):
            raise ValueError(f"exclusion {self.id}: only an industry exclusion has groups or words")
        if bool(self.unless) != bool(self.flag):
            raise ValueError(f"exclusion {self.id}: `unless` and `flag` go together")
        return self


DampenerId = Literal[
    "recent_fitout", "outsourcing", "competitor_tie", "procurement", "financial_stress"
]
DAMPENER_IDS: tuple[DampenerId, ...] = (
    "recent_fitout",
    "outsourcing",
    "competitor_tie",
    "procurement",
    "financial_stress",
)
# The four Levi has searched for on purpose. Financial stress comes from the `healthy` fact.
SEARCHED_DAMPENER_IDS: tuple[DampenerId, ...] = DAMPENER_IDS[:4]
DampenerStrength = Literal["strong", "moderate"]


class DampenerRule(Strict):
    """A fact that lowers a lead's score, never removes it (Levi's section 5, PLAN-V16 T1-5).

    The first four are searched for on purpose; financial stress comes from the `healthy` fact.
    The code is `scoring._dampeners`. How much each takes off is `score.dampeners` (T1-6).

    - `recent_fitout`: a fitout or move in that city is strong within `strong_years` and moderate
      from there to `moderate_years`. A fitout longer ago than that doesn't count. It takes
      nothing off when the company's hiring would outgrow the space within `outgrow_months`
      (his "still list the lead"). A date that isn't known counts as moderate.
    - `procurement`: `kinds` says which red flag is strong and which is moderate. A flag with no
      kind gets `strength`.
    - `financial_stress`: `waived_by` are the signs that make it part of a consolidation that
      creates a move, when it takes nothing off (his "unless").
    """

    id: DampenerId
    label: str = Field(min_length=1)
    # What Claude is asked to look for, in plain words. The four searched checks need it.
    meaning: str = ""
    strength: DampenerStrength | None = None
    strong_years: int | None = Field(default=None, gt=0)
    moderate_years: int | None = Field(default=None, gt=0)
    outgrow_months: int | None = Field(default=None, gt=0)
    kinds: dict[str, DampenerStrength] = Field(default_factory=dict)
    waived_by: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_rule(self) -> Self:
        if self.kinds and self.id != "procurement":
            raise ValueError(f"{self.id} has no kinds: only procurement does")
        if self.waived_by and self.id != "financial_stress":
            raise ValueError(f"{self.id} can't be waived: only financial_stress can")
        if self.id in SEARCHED_DAMPENER_IDS and not self.meaning:
            raise ValueError(f"{self.id} needs a meaning: it is what Claude is asked to look for")
        missing = [kind for kind in self.kinds if kind not in self.meaning]
        if missing:
            raise ValueError(f"procurement's meaning must name each kind: {', '.join(missing)}")
        timing = (self.strong_years, self.moderate_years, self.outgrow_months)
        if self.id == "recent_fitout":
            if self.strength is not None or None in timing:
                raise ValueError(
                    "recent_fitout needs strong_years, moderate_years and outgrow_months, "
                    "and no strength"
                )
            assert self.strong_years is not None and self.moderate_years is not None
            if self.strong_years >= self.moderate_years:
                raise ValueError("recent_fitout: strong_years must be below moderate_years")
        elif self.strength is None or any(value is not None for value in timing):
            raise ValueError(f"{self.id} needs a strength and no years or months")
        return self


class OfficeAge(Strict):
    due_years: int = Field(gt=0)
    recent_move_years: int = Field(gt=0)
    # A move or fitout this recent makes a lead a Watch, even with a sign (PLAN-V11 B3)
    just_moved_months: int = Field(gt=0)
    # This many years at the same address with no move or fitout since is a sign of its own, the
    # tenure sign: the code adds it from the office dates, never Claude (PLAN-V11 C1)
    tenure_years: int = Field(gt=0)
    tenure_sign: str = Field(pattern=r"^[a-z][a-z_]*$")
    # Levi's section 4 (PLAN-V16 T1-4): "no known fitout at that address in the last 5 years". A
    # fitout longer ago than this doesn't stop the tenure sign, and the move-in's own doesn't count.
    tenure_fitout_years: int = Field(gt=0)
    # The lead card's Why now guesses a lease end as the move-in year plus this many years, from
    # the first to the second (PLAN-V12 B1). It never changes a result or a score.
    lease_guess_years: tuple[GuessYears, GuessYears]

    @model_validator(mode="after")
    def check_months(self) -> Self:
        if self.just_moved_months > self.recent_move_years * 12:
            raise ValueError("office_age.just_moved_months must fit inside recent_move_years")
        if self.tenure_years < self.due_years:
            raise ValueError("office_age.tenure_years must not be below due_years")
        low, high = self.lease_guess_years
        if low > high:
            raise ValueError("office_age.lease_guess_years: the first must not be above the second")
        return self


class Fit(Strict):
    local_team_runs_project: bool
    healthy: bool


class Item(Strict):
    id: str = Field(pattern=r"^[a-z][a-z_]*$")
    label: str = Field(min_length=1)


Strength = Literal["very_high", "high", "medium", "low"]
STRENGTHS: tuple[Strength, ...] = ("very_high", "high", "medium", "low")
STRENGTH_WORDS: dict[Strength, str] = {
    "very_high": "very high",
    "high": "high",
    "medium": "medium",
    "low": "low",
}


class Sign(Item):
    """A sign of an office change, and how strong it is (Levi's section 4, PLAN-V16 T1-4). The
    group it sits in (main, other, weak) says whether a run searches for it by default. The
    strength says how much it counts in the score."""

    strength: Strength


class Triggers(Strict):
    window_years: int = Field(gt=0)
    best_window_years: tuple[int, int]
    # A sign older than this is ignored, unless it is a lease or tenure date (Levi: 18 months)
    recent_months: int = Field(gt=0)
    consultant_window_months: int = Field(gt=0)
    main: list[Sign] = Field(min_length=1)
    other: list[Sign]
    weak: list[Sign]

    @property
    def every(self) -> list[Sign]:
        return [*self.main, *self.other, *self.weak]

    def strength_of(self, sign_id: str) -> Strength | None:
        """How strong a sign is, or None for an id the rules don't know."""
        return next((sign.strength for sign in self.every if sign.id == sign_id), None)

    @model_validator(mode="after")
    def check_triggers(self) -> Self:
        ids = [trigger.id for trigger in self.every]
        repeated = sorted({i for i in ids if ids.count(i) > 1})
        if repeated:
            raise ValueError(f"Trigger ids appear twice: {', '.join(repeated)}")
        low, high = self.best_window_years
        if not 0 <= low < high <= self.window_years:
            raise ValueError("best_window_years must sit inside window_years")
        return self


class Rivals(Strict):
    """Rivals of a booming company (PLAN-V9 B5). The code is apps/lead_finder/rivals.py."""

    enabled: bool
    per_lead: int = Field(ge=1, le=10)
    per_run: int = Field(ge=0, le=20)
    max_searches: int = Field(ge=1, le=5)
    sign: str = Field(pattern=r"^[a-z][a-z_]*$")
    # Levi's competitor sweep (section 4, PLAN-V16 T1-4): it also runs for a good lead with one of
    # these signs, whatever its sector: a sector tailwind lifts the companies around it
    also_after: list[str] = Field(default_factory=list)


class NeverSuggest(Strict):
    already_sent: bool
    open_deal: bool
    dissolved_deal_wait_months: int = Field(ge=0)
    do_not_contact: bool


class SourceDomains(Strict):
    property_daily: list[str]
    arealytics: list[str]
    asx_or_official_news: list[str]
    job_ads: list[str]
    blocked: list[str]


class Recency(Strict):
    within_days: int = Field(gt=0)
    points: int = Field(ge=0)


PartId = Literal["fit", "change", "access"]
PART_IDS: tuple[PartId, ...] = ("fit", "change", "access")
# The checks inside the parts (Levi's section 6, PLAN-V16 T1-6). Each earns points, or is "not
# known yet" for a lead.
CHECK_IDS: tuple[str, ...] = (
    "local_staff",
    "priority_sector",
    "city",
    "office_relevance",
    "strongest_sign",
    "other_signs",
    "office_constrained",
    "no_lock_in",
    "procurement",
    "warm_path",
)


class PartRule(Strict):
    label: str = Field(min_length=1)
    points: int = Field(gt=0)


class StaffStep(Strict):
    """Local staff of at least `from_staff` earn `points`. The highest step that fits counts."""

    from_staff: int = Field(gt=0)
    points: int = Field(ge=0)


class CityPoints(Strict):
    priority: int = Field(ge=0)
    secondary: int = Field(ge=0)
    other: int = Field(ge=0)  # a capital, a regional centre, or a place that isn't listed


class OtherSigns(Strict):
    """Levi: "other independent signs within 12 months: 8 each, at most 2". The strongest sign is
    counted apart, and so is the same sign twice. A sign with a date counts while it is
    `within_months` old (or still to come, like a lease end). A sign with no date counts too: an
    unknown date doesn't fail a lead (a long tenure has none by design)."""

    points_each: int = Field(ge=0)
    at_most: int = Field(gt=0)
    within_months: int = Field(gt=0)


class DampenerPoints(Strict):
    strong: int = Field(ge=0)
    moderate: int = Field(ge=0)


class Tiers(Strict):
    """The lowest score of each tier. Under `c` is Discard."""

    a: int = Field(gt=0, le=100)
    b: int = Field(gt=0, le=100)
    c: int = Field(gt=0, le=100)


class Score(Strict):
    """Levi's 100 points in three parts (his section 6, PLAN-V16 T1-6, Criteria_v3.md): Fit 30,
    Change and timing 50, Access 20. The dampeners then take points off, and the score sets the
    tier."""

    parts: dict[PartId, PartRule]
    check_labels: dict[str, str]
    # How signs, and companies found by discovery, are ranked against each other. These are not
    # points of a lead's score: the strength of its strongest sign is (`strongest_sign`).
    trigger_group: dict[Literal["main", "other", "weak"], int]
    source: dict[str, int]
    recency: list[Recency] = Field(min_length=1)
    undated: int = Field(ge=0)
    lease_in_best_window: int = Field(ge=0)
    # Fit (30)
    local_staff: list[StaffStep] = Field(min_length=1)
    priority_sector: int = Field(ge=0)
    city: CityPoints
    office_relevance: int = Field(ge=0)
    # Change and timing (50)
    strongest_sign: dict[Strength, int]
    other_signs: OtherSigns
    office_constrained: int = Field(ge=0)
    # Access (20)
    no_lock_in: int = Field(ge=0)
    procurement: int = Field(ge=0)
    warm_path: int = Field(ge=0)
    unseen: list[str]  # checks the tool can't judge yet
    dampeners: DampenerPoints
    tiers: Tiers

    @property
    def recency_max(self) -> int:
        """The most a sign's recency can earn when signs are ranked."""
        return max(self.undated, self.lease_in_best_window, *(step.points for step in self.recency))

    def staff_points(self, staff: int) -> int:
        """The points local staff earn: the highest step that `staff` reaches, else 0."""
        steps = sorted(self.local_staff, key=lambda step: step.from_staff, reverse=True)
        return next((step.points for step in steps if staff >= step.from_staff), 0)

    @model_validator(mode="after")
    def check_score(self) -> Self:
        if set(self.parts) != set(PART_IDS):
            raise ValueError("score.parts needs fit, change and access")
        if set(self.trigger_group) != {"main", "other", "weak"}:
            raise ValueError("score.trigger_group needs main, other and weak")
        total = sum(part.points for part in self.parts.values())
        if total != 100:
            raise ValueError(f"The three parts add up to {total}. They must add up to 100.")
        if set(self.check_labels) != set(CHECK_IDS):
            raise ValueError("score.check_labels needs a label for every check, and no others")
        unknown = sorted(set(self.unseen) - set(CHECK_IDS))
        if unknown:
            raise ValueError(f"score.unseen has checks that don't exist: {', '.join(unknown)}")
        days = [step.within_days for step in self.recency]
        if days != sorted(set(days)):
            raise ValueError("score.recency must go from the shortest time to the longest")
        if set(self.strongest_sign) != set(STRENGTHS):
            raise ValueError("score.strongest_sign needs very_high, high, medium and low")
        order = [self.strongest_sign[strength] for strength in STRENGTHS]
        if order != sorted(order, reverse=True):
            raise ValueError("score.strongest_sign must not give a weaker sign more points")
        starts = [step.from_staff for step in self.local_staff]
        if len(set(starts)) != len(starts):
            raise ValueError("score.local_staff has two steps for the same staff number")
        if not self.tiers.a > self.tiers.b > self.tiers.c:
            raise ValueError("score.tiers must go down from a to b to c")
        best = {
            "fit": max(step.points for step in self.local_staff)
            + self.priority_sector
            + max(self.city.model_dump().values())
            + self.office_relevance,
            "change": max(self.strongest_sign.values())
            + self.other_signs.points_each * self.other_signs.at_most
            + self.office_constrained,
            "access": self.no_lock_in + self.procurement + self.warm_path,
        }
        for part_id, most in best.items():
            points = self.parts[part_id].points  # type: ignore[index]
            if most != points:
                raise ValueError(
                    f"The checks in part {part_id} add up to {most}, but the part is {points} "
                    "points. Make them match."
                )
        return self


class TbcNote(Strict):
    key: str
    note: str


Result = Literal["pass", "director_review", "watch", "drop"]


class Criteria(Strict):
    label: str
    cities: Cities
    size: Size
    data_sources: DataSources
    conflicts: Conflicts
    fitout: Fitout
    industries: Industries
    exclusions: list[ExclusionRule] = Field(min_length=1)
    dampeners: list[DampenerRule]
    fit: Fit
    office_age: OfficeAge
    triggers: Triggers
    rivals: Rivals
    boosters: list[Item]
    never_suggest: NeverSuggest
    sources_rank: list[str] = Field(min_length=1)
    source_domains: SourceDomains
    score: Score
    results: list[Result]
    stages: dict[Result, str]
    tbc: list[TbcNote]

    @property
    def exclusion_groups(self) -> list[str]:
        """The industry groups that mean an exclusion, in order: Claude may name them."""
        return [group for rule in self.exclusions for group in rule.industry_groups]

    @model_validator(mode="after")
    def check_exclusions(self) -> Self:
        ids = [rule.id for rule in self.exclusions]
        repeated = sorted({i for i in ids if ids.count(i) > 1})
        if repeated:
            raise ValueError(f"Exclusion ids appear twice: {', '.join(repeated)}")
        for kind in ("office_incidental", "tender_only"):
            if sum(1 for rule in self.exclusions if rule.kind == kind) > 1:
                raise ValueError(f"At most one exclusion has the kind {kind}")
        groups = self.exclusion_groups
        taken = {*self.industries.director_review, *self.industries.check_office_size}
        clashing = sorted({g for g in groups if groups.count(g) > 1 or g in taken})
        if clashing:
            raise ValueError(
                "An exclusion's industry group is also a Director review or a site-heavy group, "
                f"or is in two exclusions: {', '.join(clashing)}"
            )
        return self

    @model_validator(mode="after")
    def check_dampeners(self) -> Self:
        if [rule.id for rule in self.dampeners] != list(DAMPENER_IDS):
            raise ValueError(f"dampeners needs these, in this order: {', '.join(DAMPENER_IDS)}")
        signs = {sign.id for sign in self.triggers.every}
        unknown = sorted({sign for rule in self.dampeners for sign in rule.waived_by} - signs)
        if unknown:
            raise ValueError(
                f"dampeners waived_by has signs that aren't triggers: {', '.join(unknown)}"
            )
        return self

    def dampener(self, dampener_id: str) -> DampenerRule:
        """The rule of one dampener. Start-up checked that every id exists."""
        return next(rule for rule in self.dampeners if rule.id == dampener_id)

    @model_validator(mode="after")
    def check_sources(self) -> Self:
        if set(self.score.source) != set(self.sources_rank):
            raise ValueError("score.source needs one entry for each kind in sources_rank")
        return self

    @model_validator(mode="after")
    def check_growth_signs(self) -> Self:
        known = {trigger.id for trigger in self.triggers.every}
        unknown = sorted(
            (set(self.size.growth_signs) | set(self.cities.no_city_director_signs)) - known
        )
        if unknown:
            raise ValueError(
                f"size.growth_signs or cities.no_city_director_signs has signs that aren't "
                f"triggers: {', '.join(unknown)}"
            )
        return self

    @model_validator(mode="after")
    def check_rival_sign(self) -> Self:
        if self.rivals.sign not in {trigger.id for trigger in self.triggers.weak}:
            raise ValueError(f"rivals.sign {self.rivals.sign!r} must be a weak trigger")
        unknown = sorted(set(self.rivals.also_after) - {t.id for t in self.triggers.every})
        if unknown:
            raise ValueError(
                f"rivals.also_after has signs that aren't triggers: {', '.join(unknown)}"
            )
        if self.rivals.sign in self.rivals.also_after:
            raise ValueError("rivals.also_after can't hold the rivals' own sign")
        return self

    @model_validator(mode="after")
    def check_tenure_sign(self) -> Self:
        if self.office_age.tenure_sign not in {trigger.id for trigger in self.triggers.main}:
            raise ValueError(
                f"office_age.tenure_sign {self.office_age.tenure_sign!r} must be a main trigger"
            )
        return self

    @property
    def searchable_triggers(self) -> list[Item]:
        """The signs a discovery search can look for: every sign but the rivals' own (it comes
        from the rivals table) and the old office's (the code adds it from the office dates)."""
        made_elsewhere = {self.rivals.sign, self.office_age.tenure_sign}
        return [trigger for trigger in self.triggers.every if trigger.id not in made_elsewhere]

    @property
    def claude_triggers(self) -> list[Item]:
        """The signs Claude may report: every sign but the old office's, which the code adds from
        the office dates (PLAN-V11 C1)."""
        return [t for t in self.triggers.every if t.id != self.office_age.tenure_sign]

    @model_validator(mode="after")
    def check_stages(self) -> Self:
        if set(self.stages) != set(self.results) or not all(self.stages.values()):
            raise ValueError("stages needs a name for each of the results, and no others")
        return self

    @model_validator(mode="after")
    def check_tbc_keys(self) -> Self:
        data = self.model_dump(by_alias=True)
        for note in self.tbc:
            node: Any = data
            for part in note.key.split("."):
                if not isinstance(node, dict) or part not in node:
                    raise ValueError(f"tbc key {note.key!r} doesn't match a rule")
                node = node[part]
        return self


# --- queries.yaml -----------------------------------------------------------------------


SOURCE_GROUP_IDS: tuple[str, ...] = (
    "mergers",
    "funding",
    "hiring",
    "leases_and_tenure",
    "recent_fitouts",
    "outsourcing",
    "leadership",
    "sector_growth",
    "procurement",
    "company_facts",
)
Angle = Literal["property", "people", "money", "tenure", "dampeners"]


class SourceGroup(Strict):
    """One of the source groups Levi names (his section 7, PLAN-V16 T1-7), and the searches that
    reach it. On every run the research looks in each group.

    - `company`: searches for one company. They are added to the research angles in `angles`
      ("Searches you could start with"), and need `{company}`.
    - `discovery`: searches for a slice of the discovery run. They are added to the signs in
      `signs`, and can't name a company. A group no sign uses (a dampener's source) has none.
    """

    label: str = Field(min_length=1)
    angles: list[Angle] = Field(min_length=1)
    signs: list[str] = Field(default_factory=list)
    company: list[str] = Field(min_length=1)
    discovery: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_group(self) -> Self:
        if bool(self.signs) != bool(self.discovery):
            raise ValueError("a group with signs needs discovery searches, and the other way round")
        if any("{company}" not in template for template in self.company):
            raise ValueError("a group's company searches must name the {company}")
        if any("{company}" in template for template in self.discovery):
            raise ValueError("a group's discovery searches can't name a {company}")
        return self


class Queries(Strict):
    areas: dict[str, dict[Literal["cbd", "inner"], list[str]]]
    discovery: dict[str, list[str]]
    company: dict[Literal["property", "people", "money", "tenure", "dampeners"], list[str]]
    source_groups: dict[str, SourceGroup]

    def groups_for_angle(self, angle: str) -> list[SourceGroup]:
        """The source groups a company's research asks in this angle."""
        return [group for group in self.source_groups.values() if angle in group.angles]

    def groups_for_sign(self, sign_id: str) -> list[SourceGroup]:
        """The source groups discovery asks for this sign."""
        return [group for group in self.source_groups.values() if sign_id in group.signs]

    @model_validator(mode="after")
    def check_templates(self) -> Self:
        if set(self.company) != ANGLES:
            raise ValueError(
                "company templates need the property, people, money, tenure and dampeners angles"
            )
        if not 1 <= len(self.company["dampeners"]) <= MAX_DAMPENER_SEARCHES:
            raise ValueError(
                f"The dampeners angle needs 1 to {MAX_DAMPENER_SEARCHES} search templates: it is "
                "limited to that many searches a company"
            )
        if tuple(self.source_groups) != SOURCE_GROUP_IDS:
            raise ValueError(
                "source_groups needs Levi's ten groups, in this order: "
                + ", ".join(SOURCE_GROUP_IDS)
            )
        templates = [t for group in self.discovery.values() for t in group]
        templates += [t for group in self.company.values() for t in group]
        for group in self.source_groups.values():
            templates += [*group.company, *group.discovery]
        for template in templates:
            names = {field for _, field, _, _ in string.Formatter().parse(template) if field}
            unknown = names - PLACEHOLDERS
            if unknown:
                raise ValueError(f"Unknown placeholder {sorted(unknown)} in {template!r}")
        return self


# --- hubspot_map.yaml -------------------------------------------------------------------


class HubSpotField(Strict):
    property: str = Field(min_length=1)
    standard: bool


class HubSpotMap(Strict):
    company: dict[str, HubSpotField]
    list_name: str = Field(min_length=1)


# --- watchlist.yaml ---------------------------------------------------------------------


_NOT_A_LETTER = re.compile(r"[^0-9a-z]+")


def industry_name_key(name: str) -> str:
    """How industry names are compared: ignoring case, punctuation, "&" and the word "and".

    HubSpot's own labels ("Hospital & Health Care", "Electrical/Electronic Manufacturing") and
    the 25 Oct export's form of them ("Hospital Health Care", "Electrical Electronic
    Manufacturing") then give the same key, so the rules match either (PLAN-V5 D1).
    """
    words = _NOT_A_LETTER.sub(" ", name.casefold()).split()
    return " ".join(word for word in words if word != "and")


class WatchStaff(Strict):
    missing: Literal["unknown"]
    staff_max_applies_to_director: bool


class WatchlistRules(Strict):
    """Which HubSpot companies are worth watching. The code is apps/lead_finder/watchlist.py."""

    count_cities: list[str] = Field(min_length=1)
    staff: WatchStaff
    director_industries: dict[str, list[str]]  # criteria group -> HubSpot industry names
    not_office_based: dict[str, list[str]]  # criteria group (or "none") -> industry names
    tbc: list[TbcNote]

    @model_validator(mode="after")
    def check_names(self) -> Self:
        repeated_cities = sorted({c for c in self.count_cities if self.count_cities.count(c) > 1})
        if repeated_cities:
            raise ValueError(f"count_cities lists a city twice: {', '.join(repeated_cities)}")
        seen: dict[str, str] = {}
        for section, groups in (
            ("director_industries", self.director_industries),
            ("not_office_based", self.not_office_based),
        ):
            for group, names in groups.items():
                for name in names:
                    key = industry_name_key(name)
                    if not key:
                        raise ValueError(f"{section}.{group} has an empty industry name")
                    if key in seen:
                        raise ValueError(
                            f"The industry {name!r} is listed twice: in {seen[key]} "
                            f"and in {section}.{group}"
                        )
                    seen[key] = f"{section}.{group}"
        return self

    @model_validator(mode="after")
    def check_tbc_keys(self) -> Self:
        data = self.model_dump()
        for note in self.tbc:
            node: Any = data
            for part in note.key.split("."):
                if not isinstance(node, dict) or part not in node:
                    raise ValueError(f"tbc key {note.key!r} doesn't match a watchlist rule")
                node = node[part]
        return self


# --- All files together -----------------------------------------------------------------

NO_GROUP = "none"  # in watchlist.yaml not_office_based: industries with no criteria group


class LeadFinderRules(Strict):
    version: str
    criteria: Criteria
    queries: Queries
    hubspot_map: HubSpotMap
    watchlist: WatchlistRules

    @model_validator(mode="after")
    def check_watchlist(self) -> Self:
        criteria, watchlist = self.criteria, self.watchlist
        every_city = criteria.cities.every
        outside = [c for c in watchlist.count_cities if c not in every_city]
        if outside:
            raise ValueError(
                f"watchlist.count_cities has cities that criteria.cities doesn't: "
                f"{', '.join(outside)}"
            )
        # The Director list holds the Director review groups and, since PLAN-V16 T1-3, the groups
        # that are left out: a person decides whether such a company is researched at all.
        director_groups = {*criteria.industries.director_review, *criteria.exclusion_groups}
        unknown = [g for g in watchlist.director_industries if g not in director_groups]
        if unknown:
            raise ValueError(
                "watchlist.director_industries has groups that criteria.industries."
                f"director_review and criteria.exclusions don't: {', '.join(unknown)}"
            )
        unknown = [
            g
            for g in watchlist.not_office_based
            if g != NO_GROUP and g not in criteria.industries.check_office_size
        ]
        if unknown:
            raise ValueError(
                "watchlist.not_office_based has groups that criteria.industries."
                f"check_office_size doesn't: {', '.join(unknown)}"
            )
        return self

    @model_validator(mode="after")
    def check_together(self) -> Self:
        # The rivals' sign (PLAN-V9 B5) and the old office's (PLAN-V11 C1) have no search.
        trigger_ids = {trigger.id for trigger in self.criteria.searchable_triggers}
        missing = sorted(i for i in trigger_ids if not self.queries.discovery.get(i))
        if missing:
            raise ValueError(f"No discovery templates for triggers: {', '.join(missing)}")
        unknown = sorted(set(self.queries.discovery) - trigger_ids)
        if unknown:
            raise ValueError(f"Discovery templates for unknown triggers: {', '.join(unknown)}")
        for group_id, group in self.queries.source_groups.items():
            missing_signs = sorted(set(group.signs) - trigger_ids)
            if missing_signs:
                raise ValueError(
                    f"source_groups.{group_id} has signs that aren't searchable: "
                    f"{', '.join(missing_signs)}"
                )
        cities = self.criteria.cities.every
        no_areas = [city for city in cities if city not in self.queries.areas]
        if no_areas:
            raise ValueError(f"No areas in queries.yaml for: {', '.join(no_areas)}")
        return self


def rules_version(raw_files: dict[str, bytes]) -> str:
    """A short fingerprint of the rules files. Line endings don't change it."""
    digest = hashlib.sha256()
    for name in sorted(raw_files):
        digest.update(name.encode())
        digest.update(raw_files[name].replace(b"\r\n", b"\n"))
    return digest.hexdigest()[:12]


def read_rules(rules_dir: Path) -> LeadFinderRules:
    raw = {name: (rules_dir / f"{name}.yaml").read_bytes() for name in RULE_FILES}
    data = {name: yaml.safe_load(content) for name, content in raw.items()}
    return LeadFinderRules.model_validate({"version": rules_version(raw), **data})


@lru_cache
def load_rules() -> LeadFinderRules:
    """The rules in use. They're read once, so restart the backend after editing a file."""
    return read_rules(RULES_DIR)
