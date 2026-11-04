"""What a person can ask a Lead Finder run to do (the `params` of `POST /runs`).

One model for each mode, built from shared parts, and `LeadFinderRunParams` which holds every
part with its default (the Start page shows these defaults). All of them refuse unknown keys,
so a typo is a 422 instead of being ignored.

The checks here need only the rules files, never the settings or the database:
- cities and triggers must exist in the rules, once each;
- `area` keys must be cities of the run (spelled like the rules, the same as `cities`). The check
  is a validator on `area` itself, so the 422 names `body.params.area`;
- `companies` belongs to the `company` mode only, 1 to 25 names, each name passing the
  sanitiser (a bad name is a 422 that names the field, never a crash);
- caps are above zero. They can only LOWER the settings. `runs.caps_override` hands them to
  `make_caps` (core/runs/types.py), which ignores a value above the settings' limit. The
  estimate shows the cap that really applies.
"""

import re
from decimal import Decimal
from typing import Literal
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from apps.lead_finder.rules import load_rules
from apps.lead_finder.sanitize import clean_city, clean_company_name, clean_domain, normalize
from core.api.models import OutModel
from core.hubspot.matching import clean_name

AreaId = Literal["cbd", "inner", "all"]  # the part of a city to look in; "all" is the whole city
# How far back a discovery run looks. The Start page offers 7 and 30 (`options.py`). 14 is for a
# schedule that runs every 2 weeks: its look-back matches the time between runs (PLAN-V6 D2).
SinceDays = Literal[7, 14, 30]
COMPANIES_MIN = 1
COMPANIES_MAX = 25
WATCHLIST_LIMIT_MAX = 200
PLACE_MAX_CHARS = 60
NAME_MESSAGE = (
    "Use 2 to 80 characters and at most 8 words: letters, digits, spaces and & ' . , - ( ) /"
)
_PLACE_CHARS = re.compile(r"[^\W\d_](?:[^\W\d_]|[ '\u2019.,-])*")


def known_cities() -> list[str]:
    """Every city the rules know: the pass cities, then the Director review ones."""
    cities = load_rules().criteria.cities
    return [*cities.pass_, *cities.director_review]


def known_trigger_ids() -> list[str]:
    return [trigger.id for trigger in load_rules().criteria.triggers.every]


def default_cities() -> list[str]:
    """The pass cities. Sydney is allowed, but it is a person's choice."""
    return list(load_rules().criteria.cities.pass_)


def default_triggers() -> list[str]:
    """The main triggers."""
    return [trigger.id for trigger in load_rules().criteria.triggers.main]


# --- Typed values: a person typed them, so a bad one is an error and never repaired --------


def clean_typed_city(value: str | None) -> str | None:
    """A place name a person typed: the rules' spelling of a known city, else plain place text.

    Only letters, spaces and ' . , - are allowed, at most 60 characters. Anything else is an
    error: the text goes into prompts and onto pages.
    """
    if value is None:
        return None
    text = normalize(value)
    if not text:
        return None
    known = clean_city(text, known_cities())
    if known is not None:
        return known
    if len(text) > PLACE_MAX_CHARS or not _PLACE_CHARS.fullmatch(text):
        raise PydanticCustomError(
            "city",
            "Use a city name: letters, spaces and ' . , - only, at most 60 characters",
        )
    return text


def clean_typed_domain(value: str | None) -> str | None:
    """A website a person typed, as a bare domain like acme.com.au. A full address is cut to
    its host. Anything that is not a plain domain is an error."""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if re.match(r"https?://", text, re.IGNORECASE):
        try:
            text = urlsplit(text).hostname or ""
        except ValueError:
            text = ""
    domain = clean_domain(text)
    if domain is None:
        raise PydanticCustomError(
            "website", "Use the company's domain, like acme.com.au (no path, no spaces)"
        )
    return domain


# --- Parts ---------------------------------------------------------------------------------


class Strict(OutModel):
    model_config = ConfigDict(extra="forbid")


class RunCapsIn(Strict):
    """Lower limits for one run. Missing means the settings' limits."""

    run_cap_usd: Decimal | None = Field(
        None,
        gt=0,
        le=1000,
        max_digits=7,
        decimal_places=2,
        description="The most this run may spend, in US dollars. It can only lower the setting.",
    )
    max_companies: int | None = Field(
        None,
        gt=0,
        le=100,
        description="The most companies to research. It can only lower the setting.",
    )


class CompanyIn(Strict):
    """A company a person names."""

    name: str = Field(max_length=300, examples=["Culture Amp"])
    city: str | None = Field(None, max_length=120, examples=["Melbourne"])
    website: str | None = Field(None, max_length=300, examples=["cultureamp.com"])

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = clean_company_name(value)
        if cleaned is None:
            raise PydanticCustomError("company_name", NAME_MESSAGE)
        return cleaned

    @field_validator("city")
    @classmethod
    def _city(cls, value: str | None) -> str | None:
        return clean_typed_city(value)

    @field_validator("website")
    @classmethod
    def _website(cls, value: str | None) -> str | None:
        return clean_typed_domain(value)


class WatchlistOptions(Strict):
    """Which HubSpot companies the watchlist run researches."""

    include_unlikely: bool = Field(
        True, description="Include companies in industries that rarely work in an office"
    )
    include_director: bool = Field(
        False, description="Also research the Director review list (hospitals, law firms...)"
    )
    limit: int | None = Field(
        None,
        ge=1,
        le=WATCHLIST_LIMIT_MAX,
        description="Research only the first N. Missing: as many as the run limits allow.",
    )


class _Caps(Strict):
    caps: RunCapsIn = Field(
        default_factory=RunCapsIn,
        description="Used by every mode (discovery, watchlist, company, testset). Lower limits.",
    )


class _Discovery(Strict):
    cities: list[str] = Field(
        default_factory=default_cities,
        min_length=1,
        max_length=8,
        description=(
            "Used by mode discovery only. Cities to search, each once. "
            "The default is the three pass cities."
        ),
        examples=[["Melbourne", "Adelaide"]],
    )
    area: dict[str, AreaId] = Field(
        default_factory=dict,
        max_length=8,
        description=(
            "Used by mode discovery only. Narrow a city to its CBD or inner suburbs. "
            "A city not listed uses all. Each key must be one of `cities`."
        ),
        examples=[{"Melbourne": "cbd"}],
    )
    triggers: list[str] = Field(
        default_factory=default_triggers,
        min_length=1,
        max_length=16,
        description=(
            "Used by mode discovery only. Trigger ids to look for, each once. "
            "The default is the main triggers."
        ),
    )
    since_days: SinceDays = Field(
        30,
        description=(
            "Used by mode discovery only. Only events from the last 7, 14 or 30 days. "
            "The Start page offers 7 and 30; 14 is for a schedule that runs every 2 weeks."
        ),
    )

    @field_validator("cities")
    @classmethod
    def _cities(cls, value: list[str]) -> list[str]:
        known = known_cities()
        cleaned: list[str] = []
        for city in value:
            match = clean_city(city, known)
            if match is None:
                raise PydanticCustomError(
                    "city",
                    "Unknown city {city}. Choose from: {known}",
                    {"city": city[:60], "known": ", ".join(known)},
                )
            if match in cleaned:
                raise PydanticCustomError(
                    "city", "List each city once ({city} is there twice)", {"city": match}
                )
            cleaned.append(match)
        return cleaned

    @field_validator("triggers")
    @classmethod
    def _triggers(cls, value: list[str]) -> list[str]:
        known = known_trigger_ids()
        for trigger in value:
            if trigger not in known:
                raise PydanticCustomError(
                    "trigger",
                    "Unknown trigger {trigger}. Choose from: {known}",
                    {"trigger": trigger[:60], "known": ", ".join(known)},
                )
        if len(set(value)) != len(value):
            raise PydanticCustomError("trigger", "List each trigger once")
        return value

    @field_validator("area")
    @classmethod
    def _area(cls, value: dict[str, AreaId], info: ValidationInfo) -> dict[str, AreaId]:
        """Each key is a city of the run, spelled like the rules (the same as `cities`).

        `cities` is checked first (it comes first in the model). When it failed there is no
        list to compare with, so only the spelling is checked and that error is not repeated.
        """
        chosen: list[str] | None = info.data.get("cities")
        known = known_cities()
        cleaned: dict[str, AreaId] = {}
        outside: list[str] = []
        for key, area in value.items():
            city = clean_city(key, known)
            if city is None or (chosen is not None and city not in chosen):
                outside.append(key)
            elif city in cleaned:
                raise PydanticCustomError(
                    "area", "List each city once in area ({city} is there twice)", {"city": city}
                )
            else:
                cleaned[city] = area
        if outside:
            raise PydanticCustomError(
                "area",
                "area names a city that isn't in cities: {cities}",
                {"cities": ", ".join(sorted(key[:60] for key in outside))},
            )
        return cleaned


def _unique_companies(companies: list[CompanyIn]) -> list[CompanyIn]:
    """Each company once. Two names that clean to the same text are the same company."""
    seen: set[str] = set()
    for company in companies:
        key = clean_name(company.name) or company.name.casefold()
        if key in seen:
            raise PydanticCustomError(
                "companies",
                "List each company once ({name} is there twice)",
                {"name": company.name},
            )
        seen.add(key)
    return companies


# --- One model for each mode ----------------------------------------------------------------


class DiscoveryParams(_Discovery, _Caps):
    """Mode `discovery`: search the web for companies with a sign of an office change."""


class WatchlistParams(_Caps):
    """Mode `watchlist`: research the companies on the HubSpot watchlist."""

    watchlist: WatchlistOptions = Field(default_factory=WatchlistOptions)


class CompanyParams(_Caps):
    """Mode `company`: research the companies a person names. Also used by a re-check."""

    companies: list[CompanyIn] = Field(
        min_length=COMPANIES_MIN,
        max_length=COMPANIES_MAX,
        description="1 to 25 companies, each once",
    )
    recheck: bool = Field(
        False, description="Search again even when memory is fresh. Used by Re-check."
    )

    @field_validator("companies")
    @classmethod
    def _companies(cls, value: list[CompanyIn]) -> list[CompanyIn]:
        return _unique_companies(value)


class TestsetParams(_Caps):
    """Mode `testset`: the test set's public companies. Nothing to choose except the caps."""

    __test__ = False  # not a pytest class


class LeadFinderRunParams(_Discovery, _Caps):
    """Every part with its default. The Start page shows these as the starting values.

    A real run uses the model of its mode (above), which refuses the parts it doesn't use. So
    send only the parts of your mode: `cities`, `area`, `triggers` and `since_days` for
    discovery, `watchlist` for watchlist, `companies` and `recheck` for company, and `caps` for
    every mode (testset has nothing else).
    """

    watchlist: WatchlistOptions = Field(
        default_factory=WatchlistOptions,
        description="Used by mode watchlist only. Which HubSpot companies to research.",
    )
    companies: list[CompanyIn] = Field(
        default_factory=list,
        max_length=COMPANIES_MAX,
        description="Used by mode company only: 1 to 25 companies",
    )
    recheck: bool = Field(
        False,
        description=(
            "Used by mode company only. Search again even when memory is fresh. Re-check sets it."
        ),
    )

    @field_validator("companies")
    @classmethod
    def _companies(cls, value: list[CompanyIn]) -> list[CompanyIn]:
        return _unique_companies(value)
