"""Loads and checks the Lead Finder's rules files. The backend won't start if one is wrong.

The files live in rules/: criteria.yaml (the company criteria), queries.yaml (the search
templates) and hubspot_map.yaml (which field goes where in HubSpot). Each run will save the
rules version it used, so old results stay explainable after the rules change.
"""

import hashlib
import string
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

RULES_DIR = Path(__file__).resolve().parent / "rules"
RULE_FILES = ("criteria", "queries", "hubspot_map")
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


class Size(Strict):
    staff_min: int = Field(gt=0)
    staff_max: int = Field(gt=0)
    staff_counted_in: Literal["city", "company"]
    office_m2_min: int = Field(gt=0)
    office_m2_max: int = Field(gt=0)
    m2_per_staff: float = Field(gt=0)
    director_band_m2: tuple[int, int]
    linkedin_staff_multiplier: float = Field(gt=0)

    @model_validator(mode="after")
    def check_ranges(self) -> Self:
        if self.staff_min >= self.staff_max:
            raise ValueError("staff_min must be below staff_max")
        if self.office_m2_min >= self.office_m2_max:
            raise ValueError("office_m2_min must be below office_m2_max")
        low, high = self.director_band_m2
        if not 0 < low < high <= self.office_m2_min:
            raise ValueError("director_band_m2 must sit just below office_m2_min")
        return self


class Fitout(Strict):
    rate_per_m2_aud: Decimal = Field(gt=0)


class Industries(Strict):
    director_review: list[str]
    check_office_size: list[str]


class Fit(Strict):
    local_team_runs_project: bool
    healthy: bool


class Item(Strict):
    id: str = Field(pattern=r"^[a-z][a-z_]*$")
    label: str = Field(min_length=1)


class Triggers(Strict):
    window_years: int = Field(gt=0)
    best_window_years: tuple[int, int]
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


class TbcNote(Strict):
    key: str
    note: str


Result = Literal["pass", "director_review", "watch", "drop"]


class Criteria(Strict):
    label: str
    cities: Cities
    size: Size
    fitout: Fitout
    industries: Industries
    fit: Fit
    triggers: Triggers
    boosters: list[Item]
    never_suggest: NeverSuggest
    sources_rank: list[str] = Field(min_length=1)
    results: list[Result]
    tbc: list[TbcNote]

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


# --- All three together -----------------------------------------------------------------


class LeadFinderRules(Strict):
    version: str
    criteria: Criteria
    queries: Queries
    hubspot_map: HubSpotMap

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
