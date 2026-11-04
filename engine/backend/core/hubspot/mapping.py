"""How a HubSpot record becomes a row of our copy. Pure code: records in, rows out, no database
and no network, so every rule here is tested on its own (tests/core/test_hubspot_mapping.py).

The field map is in fields.yaml. The rows are the same models the export importer makes
(`CompanyRow`, `OfficeRow`, `DealRow`), so matching, the watchlist and look-alikes read API rows
exactly like export rows:
- pick lists are saved as their label ("Computer Software"), like the export, not HubSpot's code;
- the owner is saved as a name, from HubSpot's owners;
- a deal's stage is its label in its own pipeline ("Dissolved"), never guessed from the id;
- the state is VIC, SA, WA ... and the website a plain domain, as the importer cleans them;
- a text longer than its column is cut to fit, so one odd record can't stop a whole sync.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import String

from core.hubspot.client import HubSpotObject, Pipeline, PropertyInfo, primary_company
from core.hubspot.importer import (
    CompanyRow,
    DealRow,
    OfficeRow,
    normalize_domain,
    normalize_state,
)
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.hubspot.profiles import PLACEHOLDER_NAME

FIELDS_FILE = Path(__file__).with_name("fields.yaml")
DEFAULT_TIME_ZONE = "Australia/Melbourne"  # Contour's HubSpot account (read 4 Nov 2026)
FIELD_NAME = re.compile(r"[a-z0-9_]{1,100}")

CompanyColumn = Literal[
    "name",
    "website",
    "domain",
    "phone",
    "street",
    "city",
    "state_raw",
    "postal_code",
    "country",
    "industry",
    "employees",
    "linkedin_staff_au",
    "lifecycle_stage",
    "owner_id",
    "created_in_hubspot",
    "last_contacted",
    "contacts_count",
    "description",
    "linkedin_url",
    "hubspot_updated_at",
]
OfficeColumn = Literal[
    "city",
    "street",
    "level",
    "postal_code",
    "phone",
    "last_moved",
    "lease_expiry",
    "linkedin_staff",
    "office_m2",
    "size_bracket",
    "quality",
    "staff_count_text",
]
DealColumn = Literal[
    "name",
    "stage_id",
    "pipeline_id",
    "amount_aud",
    "close_date",
    "owner_id",
    "created_in_hubspot",
    "last_contacted",
    "next_step",
    "hubspot_updated_at",
]
# Our columns that hold a pick list's label, not HubSpot's stored code.
LABELLED = frozenset({"industry", "lifecycle_stage"})


# --- The field map ---------------------------------------------------------------------------


def _field_names[V: Mapping[Any, str]](value: V) -> V:
    for column, name in value.items():
        if not FIELD_NAME.fullmatch(name):
            raise ValueError(f"{column}: {name!r} is not a HubSpot field name")
    return value


class OfficeMap(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str = Field(min_length=1, max_length=64)
    fields: dict[OfficeColumn, str]

    @field_validator("fields")
    @classmethod
    def _names(cls, value: dict[OfficeColumn, str]) -> dict[OfficeColumn, str]:
        return _field_names(value)


class FieldMap(BaseModel):
    """fields.yaml, checked: every column is one we have, every value a HubSpot field name."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    companies: dict[CompanyColumn, str]
    offices: list[OfficeMap]
    deals: dict[DealColumn, str]

    @field_validator("companies")
    @classmethod
    def _companies(cls, value: dict[CompanyColumn, str]) -> dict[CompanyColumn, str]:
        if "name" not in value:
            raise ValueError("companies needs a field for name")
        return _field_names(value)

    @field_validator("deals")
    @classmethod
    def _deals(cls, value: dict[DealColumn, str]) -> dict[DealColumn, str]:
        for needed in ("name", "stage_id", "pipeline_id"):
            if needed not in value:
                raise ValueError(f"deals needs a field for {needed}")
        return _field_names(value)

    @field_validator("offices")
    @classmethod
    def _labels_differ(cls, value: list[OfficeMap]) -> list[OfficeMap]:
        labels = [office.label for office in value]
        if len(set(labels)) != len(labels):
            raise ValueError("two offices have the same label")
        return value

    def company_properties(self) -> list[str]:
        """Every HubSpot field a company read asks for."""
        names = [*self.companies.values()]
        names += [name for office in self.offices for name in office.fields.values()]
        return list(dict.fromkeys(names))

    def deal_properties(self) -> list[str]:
        return list(dict.fromkeys(self.deals.values()))


@lru_cache
def load_field_map(path: Path = FIELDS_FILE) -> FieldMap:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return FieldMap.model_validate(data)


# --- What the conversion looks things up in --------------------------------------------------


@dataclass(frozen=True)
class Lookups:
    """The names behind HubSpot's ids and codes, read once per sync."""

    owners: Mapping[str, str | None] = field(default_factory=dict)  # owner id -> name
    pipelines: Mapping[str, str] = field(default_factory=dict)  # pipeline id -> label
    stages: Mapping[tuple[str, str], str] = field(
        default_factory=dict
    )  # (pipeline, stage) -> label
    choices: Mapping[str, Mapping[str, str]] = field(default_factory=dict)  # field -> code -> label
    time_zone: str = DEFAULT_TIME_ZONE

    @classmethod
    def build(
        cls,
        *,
        owners: Iterable[tuple[str, str | None]],
        pipelines: Iterable[Pipeline],
        company_fields: Iterable[PropertyInfo],
        time_zone: str | None,
    ) -> "Lookups":
        pipes = list(pipelines)
        return cls(
            owners=dict(owners),
            pipelines={p.id: p.label for p in pipes},
            stages={(p.id, s.id): s.label for p in pipes for s in p.stages},
            choices={
                item.name: {choice.value: choice.label for choice in item.choices}
                for item in company_fields
                if item.choices
            },
            time_zone=time_zone or DEFAULT_TIME_ZONE,
        )

    def stage_label(self, pipeline_id: str | None, stage_id: str | None) -> str | None:
        if not stage_id:
            return None
        if pipeline_id and (pipeline_id, stage_id) in self.stages:
            return self.stages[(pipeline_id, stage_id)]
        # The deal's pipeline is unknown: use the label only if one pipeline has this stage id.
        labels = {label for (_, stage), label in self.stages.items() if stage == stage_id}
        return labels.pop() if len(labels) == 1 else None


@dataclass
class Problems:
    """What didn't convert cleanly, counted, for the sync's warnings. Never a record's values."""

    unknown_owner: int = 0
    unknown_stage: int = 0
    no_company: int = 0
    cut_to_fit: int = 0
    bad_value: int = 0

    def lines(self) -> list[str]:
        words = {
            "unknown_owner": "records have an owner id HubSpot's owner list doesn't have",
            "unknown_stage": "deals have a stage their pipeline doesn't list (saved as no stage)",
            "no_company": "deals have no company, so they were left out",
            "cut_to_fit": "texts were longer than our column and were cut",
            "bad_value": "values couldn't be read (an odd number or date) and were left empty",
        }
        return [f"{count} {words[name]}" for name, count in vars(self).items() if count]


# --- Values ----------------------------------------------------------------------------------


def _limit(model: type[Any], column: str) -> int | None:
    kind = model.__table__.c[column].type
    return kind.length if isinstance(kind, String) else None


class Converter:
    """Turns HubSpot's text values into ours, counting what didn't fit."""

    def __init__(self, lookups: Lookups, problems: Problems) -> None:
        self.lookups = lookups
        self.problems = problems
        try:
            self._zone = ZoneInfo(lookups.time_zone)
        except (ZoneInfoNotFoundError, ValueError):
            self._zone = ZoneInfo(DEFAULT_TIME_ZONE)

    def text(self, value: str | None, model: type[Any], column: str) -> str | None:
        if value is None:
            return None
        text = " ".join(value.split()) if column != "description" else value.strip()
        if not text:
            return None
        limit = _limit(model, column)
        if limit is not None and len(text) > limit:
            self.problems.cut_to_fit += 1
            text = text[:limit].rstrip()
        return text

    def whole(self, value: str | None) -> int | None:
        if value is None or not value.strip():
            return None
        try:
            number = Decimal(value.strip().replace(",", ""))
        except InvalidOperation:
            self.problems.bad_value += 1
            return None
        if not number.is_finite() or number < 0 or number > 2_000_000_000:
            self.problems.bad_value += 1
            return None
        return int(number)

    def decimal(self, value: str | None, places: int, below: int) -> Decimal | None:
        if value is None or not value.strip():
            return None
        try:
            number = Decimal(value.strip().replace(",", "").replace("$", ""))
        except InvalidOperation:
            self.problems.bad_value += 1
            return None
        if not number.is_finite() or abs(number) >= below:
            self.problems.bad_value += 1
            return None
        return number.quantize(Decimal(1).scaleb(-places))

    def moment(self, value: str | None) -> datetime | None:
        """An exact time, in UTC. HubSpot sends ISO text, or milliseconds since 1970."""
        if value is None or not value.strip():
            return None
        text = value.strip()
        try:
            if text.isdigit():
                return datetime.fromtimestamp(int(text) / 1000, tz=UTC)
            found = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except (ValueError, OverflowError, OSError):
            self.problems.bad_value += 1
            return None
        return found.replace(tzinfo=UTC) if found.tzinfo is None else found.astimezone(UTC)

    def day(self, value: str | None) -> date | None:
        """A date. A date field is plain YYYY-MM-DD; a date-and-time field is read as the day it
        was in Contour's own time zone, which is the day HubSpot's screen shows."""
        if value is None or not value.strip():
            return None
        text = value.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            try:
                return date.fromisoformat(text)
            except ValueError:
                self.problems.bad_value += 1
                return None
        moment = self.moment(text)
        return moment.astimezone(self._zone).date() if moment else None

    def label(self, field_name: str, value: str | None) -> str | None:
        """A pick list's label for its stored code. Several codes (a checkbox list) are joined."""
        if value is None or not value.strip():
            return None
        choices = self.lookups.choices.get(field_name, {})
        codes = [code.strip() for code in value.split(";") if code.strip()]
        return ", ".join(choices.get(code, code) for code in codes) or None

    def owner(self, owner_id: str | None) -> str | None:
        if not owner_id:
            return None
        if owner_id not in self.lookups.owners:
            self.problems.unknown_owner += 1
            return None
        return self.lookups.owners[owner_id]


# --- Records to rows -------------------------------------------------------------------------


@dataclass(frozen=True)
class CompanyRows:
    company: CompanyRow
    offices: tuple[OfficeRow, ...]


def company_rows(record: HubSpotObject, fields: FieldMap, convert: Converter) -> CompanyRows:
    props = fields.companies

    def raw(column: CompanyColumn) -> str | None:
        name = props.get(column)
        return record.properties.get(name) if name else None

    def text(column: CompanyColumn) -> str | None:
        return convert.text(raw(column), HubSpotCompany, column)

    def label(column: CompanyColumn) -> str | None:
        name = props.get(column)
        value = convert.label(name, raw(column)) if name else None
        return convert.text(value, HubSpotCompany, column)

    owner_id = convert.text(raw("owner_id"), HubSpotCompany, "owner_id")
    offices = tuple(
        office
        for office_map in fields.offices
        if (office := office_row(record, office_map, convert)) is not None
    )
    website = text("website")
    state_raw = text("state_raw")
    company = CompanyRow(
        hubspot_id=record.id,
        name=text("name") or PLACEHOLDER_NAME,
        website=website,
        domain=convert.text(
            normalize_domain(raw("domain")) or normalize_domain(website), HubSpotCompany, "domain"
        ),
        phone=text("phone"),
        street=text("street"),
        city=text("city"),
        state=normalize_state(state_raw),
        state_raw=state_raw,
        postal_code=text("postal_code"),
        country=text("country"),
        industry=label("industry"),
        employees=convert.whole(raw("employees")),
        linkedin_staff_au=convert.whole(raw("linkedin_staff_au")),
        offices_on_record=", ".join(office.label for office in offices) or None,
        lifecycle_stage=label("lifecycle_stage"),
        owner=convert.text(convert.owner(owner_id), HubSpotCompany, "owner"),
        owner_id=owner_id,
        created_in_hubspot=convert.day(raw("created_in_hubspot")),
        last_contacted=convert.day(raw("last_contacted")),
        contacts_count=convert.whole(raw("contacts_count")),
        description=text("description"),
        linkedin_url=text("linkedin_url"),
        hubspot_url=record.url,
        hubspot_updated_at=convert.moment(raw("hubspot_updated_at")) or record.updated_at,
    )
    return CompanyRows(company, offices)


def office_row(record: HubSpotObject, office: OfficeMap, convert: Converter) -> OfficeRow | None:
    """The office in one city group, or None when every field of the group is empty."""

    def raw(column: OfficeColumn) -> str | None:
        name = office.fields.get(column)
        return record.properties.get(name) if name else None

    def text(column: OfficeColumn) -> str | None:
        return convert.text(raw(column), HubSpotOffice, column)

    row = OfficeRow(
        hubspot_company_id=record.id,
        label=office.label,
        level=text("level"),
        street=text("street"),
        city=text("city"),
        postal_code=text("postal_code"),
        phone=text("phone"),
        last_moved=convert.day(raw("last_moved")),
        lease_expiry=convert.day(raw("lease_expiry")),
        linkedin_staff=convert.whole(raw("linkedin_staff")),
        office_m2=convert.decimal(raw("office_m2"), places=1, below=10**9),
        size_bracket=text("size_bracket"),
        quality=text("quality"),
        staff_count_text=text("staff_count_text"),
    )
    details = row.model_dump(exclude={"hubspot_company_id", "label"})
    return row if any(value is not None for value in details.values()) else None


def deal_row(
    record: HubSpotObject,
    fields: FieldMap,
    convert: Converter,
    *,
    company_id: str | None = None,
) -> DealRow | None:
    """The deal, or None when it has no company (our copy keeps deals under their company).
    `company_id` comes from a separate association read when the record has no links in it."""
    props = fields.deals

    def raw(column: DealColumn) -> str | None:
        name = props.get(column)
        return record.properties.get(name) if name else None

    company = company_id or primary_company(record.associations)
    if company is None:
        convert.problems.no_company += 1
        return None
    pipeline_id = raw("pipeline_id")
    stage_id = raw("stage_id")
    stage = convert.lookups.stage_label(pipeline_id, stage_id)
    if stage_id and stage is None:
        convert.problems.unknown_stage += 1
    owner_id = convert.text(raw("owner_id"), HubSpotDeal, "owner_id")
    return DealRow(
        hubspot_deal_id=record.id,
        hubspot_company_id=company,
        name=convert.text(raw("name"), HubSpotDeal, "name") or PLACEHOLDER_NAME,
        stage=convert.text(stage, HubSpotDeal, "stage"),
        stage_id=convert.text(stage_id, HubSpotDeal, "stage_id"),
        pipeline=convert.text(
            convert.lookups.pipelines.get(pipeline_id or ""), HubSpotDeal, "pipeline"
        ),
        amount_aud=convert.decimal(raw("amount_aud"), places=2, below=10**12),
        close_date=convert.day(raw("close_date")),
        owner=convert.text(convert.owner(owner_id), HubSpotDeal, "owner"),
        owner_id=owner_id,
        created_in_hubspot=convert.day(raw("created_in_hubspot")),
        last_contacted=convert.day(raw("last_contacted")),
        next_step=convert.text(raw("next_step"), HubSpotDeal, "next_step"),
        hubspot_url=record.url,
        hubspot_updated_at=convert.moment(raw("hubspot_updated_at")) or record.updated_at,
    )


def labelled_fields(fields: FieldMap) -> list[str]:
    """The HubSpot company fields whose choices the sync must read, to save labels."""
    return [name for column, name in fields.companies.items() if column in LABELLED]
