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
from typing import Any, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

RULES_DIR = Path(__file__).resolve().parent / "rules"
RULE_FILES = ("criteria", "queries", "hubspot_map", "watchlist")
PLACEHOLDERS = {"city", "area", "company", "year", "month_year"}
ANGLES = {"property", "people", "money"}


class Strict(BaseModel):
    """Unknown keys are an error, so a typo in a rules file stops the backend from starting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


# --- criteria.yaml ----------------------------------------------------------------------


class Cities(Strict):
    pass_: list[str] = Field(alias="pass", min_length=1)
    director_review: list[str]
    other_cities: Literal["director_review", "drop"]


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


class DataSources(Strict):
    """Which source is main for which data (PLAN-V4 C2). In each list the first source with a value
    is the one the rules use, and the ones after it are the backup. Staff numbers have their own
    list, `size.staff_sources`."""

    company_details: list[DataSource] = Field(min_length=1)
    office_cities: list[DataSource] = Field(min_length=1)
    decision_makers: list[DataSource] = Field(min_length=1)

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


class Fitout(Strict):
    rate_per_m2_aud: Decimal = Field(gt=0)


class Industries(Strict):
    director_review: list[str]
    check_office_size: list[str]
    tier_1: list[str]
    tier_2: list[str]

    @model_validator(mode="after")
    def check_tiers(self) -> Self:
        tiers = [*self.tier_1, *self.tier_2]
        repeated = sorted({group for group in tiers if tiers.count(group) > 1})
        if repeated:
            raise ValueError(f"A tier group is listed twice: {', '.join(repeated)}")
        return self


class OfficeAge(Strict):
    due_years: int = Field(gt=0)
    recent_move_years: int = Field(gt=0)


class Fit(Strict):
    local_team_runs_project: bool
    healthy: bool


class Item(Strict):
    id: str = Field(pattern=r"^[a-z][a-z_]*$")
    label: str = Field(min_length=1)


class Triggers(Strict):
    window_years: int = Field(gt=0)
    best_window_years: tuple[int, int]
    recent_months: int = Field(gt=0)
    consultant_window_months: int = Field(gt=0)
    main: list[Item] = Field(min_length=1)
    other: list[Item]
    weak: list[Item]

    @property
    def every(self) -> list[Item]:
        return [*self.main, *self.other, *self.weak]

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


class NeverSuggest(Strict):
    already_sent: bool
    open_deal: bool
    dissolved_deal_wait_months: int = Field(ge=0)
    do_not_contact: bool


class SourceDomains(Strict):
    property_daily: list[str]
    asx_or_official_news: list[str]
    job_ads: list[str]
    blocked: list[str]


class Recency(Strict):
    within_days: int = Field(gt=0)
    points: int = Field(ge=0)


PartId = Literal["trigger", "size", "timing", "access", "fit", "competition"]
PART_IDS: tuple[PartId, ...] = ("trigger", "size", "timing", "access", "fit", "competition")
# The checks inside the parts. Each earns points, or is "not known yet" for a lead.
CHECK_IDS: tuple[str, ...] = (
    "trigger_group",
    "source",
    "size",
    "recency",
    "years_at_address",
    "no_recent_move",
    "contact_role",
    "hubspot_contact",
    "customer_link",
    "buys_strategy",
    "industry_tier",
    "no_rival_in_place",
    "no_contractor_relationship",
)


class PartRule(Strict):
    label: str = Field(min_length=1)
    points: int = Field(gt=0)


class SizePoints(Strict):
    confirmed_in_range: int = Field(ge=0)
    estimated_in_range: int = Field(ge=0)
    growing_into_range: int = Field(ge=0)
    director: int = Field(ge=0)


class AccessPoints(Strict):
    contact_role: int = Field(ge=0)
    hubspot_contact: int = Field(ge=0)
    customer_link: int = Field(ge=0)


class FitPoints(Strict):
    buys_strategy: int = Field(ge=0)
    tier_1: int = Field(ge=0)
    tier_2: int = Field(ge=0)


class CompetitionPoints(Strict):
    no_rival_in_place: int = Field(ge=0)
    no_contractor_relationship: int = Field(ge=0)


class Bands(Strict):
    research_first: int = Field(gt=0, le=100)
    investigate: int = Field(gt=0, le=100)


class Score(Strict):
    """The Target Customer Profile's 100 points in six parts (Criteria_v2.md section 6)."""

    parts: dict[PartId, PartRule]
    check_labels: dict[str, str]
    trigger_group: dict[Literal["main", "other", "weak"], int]
    source: dict[str, int]
    size: SizePoints
    recency: list[Recency] = Field(min_length=1)
    undated: int = Field(ge=0)
    lease_in_best_window: int = Field(ge=0)
    years_at_address: int = Field(ge=0)
    no_recent_move: int = Field(ge=0)
    access: AccessPoints
    fit: FitPoints
    competition: CompetitionPoints
    unseen: list[str]
    bands: Bands
    band_basis: Literal["scaled", "raw"]

    @property
    def recency_max(self) -> int:
        """The most the timing part's first check can earn."""
        return max(self.undated, self.lease_in_best_window, *(step.points for step in self.recency))

    @model_validator(mode="after")
    def check_score(self) -> Self:
        if set(self.parts) != set(PART_IDS):
            raise ValueError("score.parts needs trigger, size, timing, access, fit and competition")
        if set(self.trigger_group) != {"main", "other", "weak"}:
            raise ValueError("score.trigger_group needs main, other and weak")
        total = sum(part.points for part in self.parts.values())
        if total != 100:
            raise ValueError(f"The six parts add up to {total}. They must add up to 100.")
        if set(self.check_labels) != set(CHECK_IDS):
            raise ValueError("score.check_labels needs a label for every check, and no others")
        unknown = sorted(set(self.unseen) - set(CHECK_IDS))
        if unknown:
            raise ValueError(f"score.unseen has checks that don't exist: {', '.join(unknown)}")
        days = [step.within_days for step in self.recency]
        if days != sorted(set(days)):
            raise ValueError("score.recency must go from the shortest time to the longest")
        if self.bands.investigate >= self.bands.research_first:
            raise ValueError("bands.investigate must be below bands.research_first")
        best = {
            "trigger": max(self.trigger_group.values()) + max(self.source.values()),
            "size": max(self.size.model_dump().values()),
            "timing": self.recency_max + self.years_at_address + self.no_recent_move,
            "access": sum(self.access.model_dump().values()),
            "fit": self.fit.buys_strategy + max(self.fit.tier_1, self.fit.tier_2),
            "competition": sum(self.competition.model_dump().values()),
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
    fit: Fit
    office_age: OfficeAge
    triggers: Triggers
    boosters: list[Item]
    never_suggest: NeverSuggest
    sources_rank: list[str] = Field(min_length=1)
    source_domains: SourceDomains
    score: Score
    results: list[Result]
    stages: dict[Result, str]
    tbc: list[TbcNote]

    @model_validator(mode="after")
    def check_sources(self) -> Self:
        if set(self.score.source) != set(self.sources_rank):
            raise ValueError("score.source needs one entry for each kind in sources_rank")
        return self

    @model_validator(mode="after")
    def check_growth_signs(self) -> Self:
        known = {trigger.id for trigger in self.triggers.every}
        unknown = sorted(set(self.size.growth_signs) - known)
        if unknown:
            raise ValueError(
                f"size.growth_signs has signs that aren't triggers: {', '.join(unknown)}"
            )
        return self

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


class Queries(Strict):
    areas: dict[str, dict[Literal["cbd", "inner"], list[str]]]
    discovery: dict[str, list[str]]
    company: dict[Literal["property", "people", "money"], list[str]]

    @model_validator(mode="after")
    def check_templates(self) -> Self:
        if set(self.company) != ANGLES:
            raise ValueError("company templates need the property, people and money angles")
        templates = [t for group in self.discovery.values() for t in group]
        templates += [t for group in self.company.values() for t in group]
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
        every_city = [*criteria.cities.pass_, *criteria.cities.director_review]
        outside = [c for c in watchlist.count_cities if c not in every_city]
        if outside:
            raise ValueError(
                f"watchlist.count_cities has cities that criteria.cities doesn't: "
                f"{', '.join(outside)}"
            )
        unknown = [
            g for g in watchlist.director_industries if g not in criteria.industries.director_review
        ]
        if unknown:
            raise ValueError(
                "watchlist.director_industries has groups that criteria.industries."
                f"director_review doesn't: {', '.join(unknown)}"
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
        trigger_ids = {trigger.id for trigger in self.criteria.triggers.every}
        missing = sorted(i for i in trigger_ids if not self.queries.discovery.get(i))
        if missing:
            raise ValueError(f"No discovery templates for triggers: {', '.join(missing)}")
        unknown = sorted(set(self.queries.discovery) - trigger_ids)
        if unknown:
            raise ValueError(f"Discovery templates for unknown triggers: {', '.join(unknown)}")
        cities = [*self.criteria.cities.pass_, *self.criteria.cities.director_review]
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
