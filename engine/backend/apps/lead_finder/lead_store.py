"""The lead store: everything that reads or changes the leads table for the website.

Reading: the filtered, sorted, paged list; the facets (what each filter offers, with counts);
the map pins; the CSV export; and one lead with its older researches.
Changing: what a person does to a lead (`patch_lead`): status, note, thumbs up or down. A change
to the outcome is also saved to memory as ONE `lead_outcome` item per lead, so later research can
learn from it.

The filters are shared by the list, the facets, the export and the map. `lead_conditions` turns
them into SQL. Facets call it once for each filter with that filter left out ("skip"), so a count
shows what choosing a value WOULD give.

Pure helpers (no database): `csv_safe`, `render_csv`, `result_rank`, `reason_of`, `apply_patch`,
`outcome_of`, `export_filename`. The functions that take a session are the only ones that touch
the database.
"""

import csv
import io
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Final
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Date, case, cast, delete, distinct, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.geo import CITY_CENTRES, approximate_point
from apps.lead_finder.research import APP
from apps.lead_finder.rules import Result, load_rules
from apps.lead_finder.sanitize import one_line, safe_http_url
from apps.lead_finder.schemas import (
    DateRange,
    FacetValue,
    HubSpotStatus,
    IntRange,
    LeadDetail,
    LeadFacets,
    LeadPage,
    LeadPatch,
    LeadRow,
    LeadSort,
    LeadStatus,
    MapOut,
    MapPoint,
    PreviousLead,
    RunFacet,
    SortOrder,
    TriggerFacet,
)
from apps.lead_finder.scoring import band_of
from apps.lead_finder.tables import Lead
from core.api.errors import Problem
from core.memory.embedder import Embedder
from core.memory.models import MemoryItem
from core.memory.service import Note, remember_many
from core.runs.models import Run

MELBOURNE: Final = "Australia/Melbourne"
EXPORT_MAX_ROWS: Final = 2000
MAP_MAX_POINTS: Final = 2000
INDUSTRY_FACET_MAX: Final = 50
RUN_FACET_MAX: Final = 50
PREVIOUS_LIMIT: Final = 10
REASON_MAX_CHARS: Final = 240
OUTCOME_KIND: Final = "lead_outcome"

# The order a person reads these in. A value that isn't listed goes last.
RESULT_ORDER: Final = ("pass", "director_review", "watch", "drop")
HUBSPOT_ORDER: Final = ("new", "in_hubspot", "open_deal", "dissolved_deal", "possible_match")
STATUS_ORDER: Final = ("new", "watching", "rejected", "sent")

NOT_FOUND: Final = ("Lead not found", "Check the id. GET /lead-finder/leads lists them.")


# --- Filters ----------------------------------------------------------------------------------


@dataclass
class LeadFilters:
    """The filters that the list, the facets, the export and the map share.

    The API's own class (`api_leads.LeadFilters`) adds the query-string descriptions. This one
    is plain data, so the store never imports from the API.
    """

    result: list[Result] | None = None
    city: list[str] | None = None
    trigger: list[str] | None = None
    industry: list[str] | None = None
    industry_group: list[str] | None = None
    min_score: int | None = None
    office_m2_min: int | None = None
    office_m2_max: int | None = None
    hubspot_status: list[HubSpotStatus] | None = None
    status: list[LeadStatus] | None = None
    run_id: uuid.UUID | None = None
    created_since: date | None = None
    created_until: date | None = None
    trigger_since: date | None = None
    q: str | None = None
    include_tests: bool = False
    latest: bool | None = None
    facts_missing: bool = False  # only leads whose answer form failed


# The names a facet leaves out of its own count.
SKIP_RESULT: Final = "result"
SKIP_CITY: Final = "city"
SKIP_TRIGGER: Final = "trigger"
SKIP_INDUSTRY: Final = "industry"
SKIP_GROUP: Final = "industry_group"
SKIP_HUBSPOT: Final = "hubspot_status"
SKIP_STATUS: Final = "status"
SKIP_SCORE: Final = "score"
SKIP_M2: Final = "office_m2"
SKIP_CREATED: Final = "created"
SKIP_RUN: Final = "run"


def result_rank(result: str) -> int:
    """Where a result sorts: pass first, then director review, watch and drop. Unknown last."""
    return RESULT_ORDER.index(result) if result in RESULT_ORDER else len(RESULT_ORDER)


RESULT_RANK = case(
    {name: rank for rank, name in enumerate(RESULT_ORDER)},
    value=Lead.result,
    else_=len(RESULT_ORDER),
)
# A dict, so `sort` can only name a column listed here. Never build SQL from the text.
SORT_COLUMNS: dict[str, Any] = {
    "score": Lead.score,
    "created_at": Lead.created_at,
    "updated_at": Lead.updated_at,
    "company": func.lower(Lead.company),
    "city": Lead.city,
    "result": RESULT_RANK,
    "status": Lead.status,
    "hubspot_status": Lead.hubspot_status,
    "trigger_date": Lead.trigger_date,
    "office_m2": Lead.office_m2,
    "cost_usd": Lead.cost_usd,
}


def newest_only(filters: LeadFilters) -> bool:
    """Whether to show one row for each company. `latest` when it is given. Otherwise yes,
    unless a run is asked for: the leads of a run are all shown."""
    if filters.latest is not None:
        return filters.latest
    return filters.run_id is None


def _melbourne_day() -> ColumnElement[date]:
    """The day a lead was researched, read in Australia/Melbourne."""
    return cast(func.timezone(MELBOURNE, Lead.created_at), Date)


def lead_conditions(
    filters: LeadFilters, *, skip: Collection[str] = ()
) -> list[ColumnElement[bool]]:
    """The WHERE parts for the filters.

    `skip` names filters to leave out (the SKIP_* names above). A facet skips its own, so its
    counts show what choosing a value would give. Tests are left out unless `include_tests`, and
    "one row per company" always applies: whether it does is decided by the filters as they
    were sent, even when `run_id` itself is skipped.
    """
    skipped = set(skip)
    where: list[ColumnElement[bool]] = []
    if filters.result and SKIP_RESULT not in skipped:
        where.append(Lead.result.in_(filters.result))
    if filters.city and SKIP_CITY not in skipped:
        where.append(Lead.city.in_(filters.city))
    if filters.trigger and SKIP_TRIGGER not in skipped:
        where.append(Lead.trigger_ids.overlap(filters.trigger))
    if filters.industry and SKIP_INDUSTRY not in skipped:
        where.append(Lead.industry.in_(filters.industry))
    if filters.industry_group and SKIP_GROUP not in skipped:
        where.append(Lead.industry_group.in_(filters.industry_group))
    if filters.min_score is not None and SKIP_SCORE not in skipped:
        where.append(Lead.score >= filters.min_score)
    if SKIP_M2 not in skipped:
        if filters.office_m2_min is not None:
            where.append(Lead.office_m2 >= filters.office_m2_min)
        if filters.office_m2_max is not None:
            where.append(Lead.office_m2 <= filters.office_m2_max)
    if filters.hubspot_status and SKIP_HUBSPOT not in skipped:
        where.append(Lead.hubspot_status.in_(filters.hubspot_status))
    if filters.status and SKIP_STATUS not in skipped:
        where.append(Lead.status.in_(filters.status))
    if filters.run_id is not None and SKIP_RUN not in skipped:
        where.append(Lead.run_id == filters.run_id)
    if SKIP_CREATED not in skipped:
        if filters.created_since is not None:
            where.append(_melbourne_day() >= filters.created_since)
        if filters.created_until is not None:
            where.append(_melbourne_day() <= filters.created_until)
    if filters.trigger_since is not None:
        where.append(Lead.trigger_date >= filters.trigger_since)
    if filters.q:
        where.append(Lead.company.icontains(filters.q, autoescape=True))
    if filters.facts_missing:
        where.append(_CARD["form_failed"].as_boolean().is_(True))
    tests = [] if filters.include_tests else [Lead.is_test.is_(False)]
    where += tests
    if newest_only(filters):
        # A test lead and a real lead with one company_key are two companies here, so each keeps
        # its own newest row (and `include_tests=true` doesn't let one hide the other). The
        # ranking comes BEFORE the other filters: "newest" means newest of the company.
        ranked = (
            select(
                Lead.id.label("id"),
                func.row_number()
                .over(
                    partition_by=(Lead.company_key, Lead.is_test),
                    order_by=(Lead.created_at.desc(), Lead.id.desc()),
                )
                .label("rank"),
            )
            .where(*tests)
            .subquery()
        )
        where.append(Lead.id.in_(select(ranked.c.id).where(ranked.c.rank == 1)))
    return where


def lead_order(sort: LeadSort, order: SortOrder) -> list[Any]:
    """ORDER BY <column> <direction> NULLS LAST, id. The id makes pages stable when values tie."""
    column = SORT_COLUMNS[sort]
    direction = column.desc() if order == "desc" else column.asc()
    return [direction.nulls_last(), Lead.id]


# --- The list ---------------------------------------------------------------------------------

_ROW_COLUMNS: Final = (
    "id",
    "company",
    "city",
    "suburb",
    "result",
    "score",
    "score_checked",
    "status",
    "hubspot_status",
    "trigger_id",
    "trigger_date",
    "office_m2",
    "office_m2_estimated",
    "staff_in_city",
    "industry",
    "industry_group",
    "contact_role",
    "run_id",
    "origin",
    "is_test",
    "useful",
    "note",
    "cost_usd",
    "web_searches",
    "created_at",
    "updated_at",
)
_CARD: Any = Lead.card  # `Mapped[dict]`, but here it is indexed like JSON


def trigger_labels() -> dict[str, str]:
    return {trigger.id: trigger.label for trigger in load_rules().criteria.triggers.every}


def _check_details(checks: object, *, outcome: str, rule: str | None = None) -> list[str]:
    """The `detail` of each stored rule check with this outcome (and rule, if given)."""
    found: list[str] = []
    if not isinstance(checks, list):
        return found
    for check in checks:
        if not isinstance(check, dict) or check.get("outcome") != outcome:
            continue
        if rule is not None and check.get("rule") != rule:
            continue
        detail = check.get("detail")
        if isinstance(detail, str) and detail.strip():
            found.append(detail)
    return found


def _short(text: str, max_chars: int) -> str:
    """One line of at most `max_chars` characters, cut with an ellipsis. Unlike `one_line` it
    leaves the characters alone (a check says `2,500 m²`, and NFKC would turn that into m2)."""
    line = " ".join(text.split())
    return line if len(line) <= max_chars else line[: max_chars - 1].rstrip() + "…"


def reason_of(result: str, checks: object, why_it_fits: str | None = None) -> str:
    """One line: why this result. Taken from the stored rule checks.

    drop: what failed. director_review: what needs a Director. watch: no trigger yet, or the
    city or size isn't known. pass: the trigger that counted. Without a matching check (an old
    card) it is the first part of `why_it_fits`.
    """
    parts: list[str] = []
    if result == "drop":
        parts = _check_details(checks, outcome="fail")
    elif result == "director_review":
        parts = _check_details(checks, outcome="director")
    elif result == "watch":
        parts = _check_details(checks, outcome="unknown", rule="Trigger")
        if not parts:
            parts = [
                *_check_details(checks, outcome="unknown", rule="City"),
                *_check_details(checks, outcome="unknown", rule="Size"),
            ]
    elif result == "pass":
        parts = _check_details(checks, outcome="ok", rule="Trigger")
    return _short("; ".join(parts) or why_it_fits or "", REASON_MAX_CHARS)


def _row(data: Mapping[Any, Any], labels: Mapping[str, str]) -> LeadRow:
    values: dict[str, Any] = {name: data[name] for name in _ROW_COLUMNS}
    trigger_id = data["trigger_id"]
    values["trigger_ids"] = list(data["trigger_ids"] or [])
    values["trigger_label"] = labels.get(trigger_id, trigger_id) if trigger_id else None
    values["reason"] = reason_of(data["result"], data["checks"], data["why_it_fits"])
    values["form_failed"] = bool(data["form_failed"])
    rules = load_rules()
    values["stage"] = rules.criteria.stages[data["result"]]
    checked = data["score_checked"]
    values["band"] = band_of(data["score"], checked, rules) if checked else None
    return LeadRow.model_validate(values)


def _row_query() -> Any:
    return select(
        *(getattr(Lead, name) for name in _ROW_COLUMNS),
        Lead.trigger_ids,
        _CARD["checks"].label("checks"),
        _CARD["why_it_fits"].as_string().label("why_it_fits"),
        func.coalesce(_CARD["form_failed"].as_boolean(), False).label("form_failed"),
    )


async def list_leads(
    session: AsyncSession,
    filters: LeadFilters,
    sort: LeadSort = "score",
    order: SortOrder = "desc",
    limit: int = 50,
    offset: int = 0,
) -> LeadPage:
    """One page of rows, and how many leads match in all."""
    where = lead_conditions(filters)
    total = await session.scalar(select(func.count()).select_from(Lead).where(*where))
    page = _row_query().where(*where).order_by(*lead_order(sort, order)).limit(limit).offset(offset)
    rows = (await session.execute(page)).mappings().all()
    labels = trigger_labels()
    return LeadPage(total=total or 0, items=[_row(row, labels) for row in rows])


# --- Facets -----------------------------------------------------------------------------------


def facet_values(
    counts: Mapping[str, int],
    *,
    order: Sequence[str] = (),
    selected: Sequence[str] | None = None,
    top: int | None = None,
) -> list[FacetValue]:
    """Counts as a list. Values in `order` come first in that order, then the rest by count
    (largest first, then by name). `top` keeps only the first few. A value that is selected but
    has no count right now is still listed, with 0, so the page can show and clear it."""
    listed = [value for value in order if value in counts]
    listed += sorted((v for v in counts if v not in order), key=lambda v: (-counts[v], v))
    if top is not None:
        listed = listed[:top]
    for value in selected or ():
        if value not in listed:
            listed.append(value)
    return [FacetValue(value=value, count=counts.get(value, 0)) for value in listed]


async def lead_facets(session: AsyncSession, filters: LeadFilters) -> LeadFacets:
    """What each filter offers. A count applies every active filter except its own."""
    labels = trigger_labels()

    def without(skip: str) -> list[ColumnElement[bool]]:
        return lead_conditions(filters, skip=(skip,))

    async def grouped(column: Any, skip: str) -> dict[str, int]:
        statement = (
            select(column, func.count())
            .select_from(Lead)
            .where(column.is_not(None), *without(skip))
            .group_by(column)
        )
        return {str(value): int(count) for value, count in (await session.execute(statement)).all()}

    async def spread(column: Any, skip: str) -> tuple[Any, Any]:
        statement = select(func.min(column), func.max(column)).where(*without(skip))
        low, high = (await session.execute(statement)).one()
        return low, high

    # Trigger ids are a list in each lead, so they are unpacked first: one count per lead.
    unpacked = (
        select(Lead.id.label("lead_id"), func.unnest(Lead.trigger_ids).label("trigger_id"))
        .where(*without(SKIP_TRIGGER))
        .subquery()
    )
    trigger_rows = (
        await session.execute(
            select(unpacked.c.trigger_id, func.count(distinct(unpacked.c.lead_id))).group_by(
                unpacked.c.trigger_id
            )
        )
    ).all()
    trigger_counts = {str(trigger_id): int(count) for trigger_id, count in trigger_rows}
    picked_triggers = filters.trigger or []
    trigger_ids = sorted(trigger_counts, key=lambda t: (-trigger_counts[t], t))
    trigger_ids += [t for t in picked_triggers if t not in trigger_counts]
    triggers = [
        TriggerFacet(id=t, label=labels.get(t, t), count=trigger_counts.get(t, 0))
        for t in trigger_ids
    ]

    low_score, high_score = await spread(Lead.score, SKIP_SCORE)
    low_m2, high_m2 = await spread(Lead.office_m2, SKIP_M2)
    first_day, last_day = await spread(_melbourne_day(), SKIP_CREATED)

    return LeadFacets(
        result=facet_values(
            await grouped(Lead.result, SKIP_RESULT), order=RESULT_ORDER, selected=filters.result
        ),
        city=facet_values(await grouped(Lead.city, SKIP_CITY), selected=filters.city),
        trigger=triggers,
        industry=facet_values(
            await grouped(Lead.industry, SKIP_INDUSTRY),
            selected=filters.industry,
            top=INDUSTRY_FACET_MAX,
        ),
        industry_group=facet_values(
            await grouped(Lead.industry_group, SKIP_GROUP), selected=filters.industry_group
        ),
        hubspot_status=facet_values(
            await grouped(Lead.hubspot_status, SKIP_HUBSPOT),
            order=HUBSPOT_ORDER,
            selected=filters.hubspot_status,
        ),
        status=facet_values(
            await grouped(Lead.status, SKIP_STATUS), order=STATUS_ORDER, selected=filters.status
        ),
        score=IntRange(min=low_score, max=high_score),
        office_m2=IntRange(min=low_m2, max=high_m2),
        created=DateRange(min=first_day, max=last_day),
        runs=await _run_facets(session, filters),
    )


async def _run_facets(session: AsyncSession, filters: LeadFilters) -> list[RunFacet]:
    """The most recent runs that have leads under the other filters, with how many each has."""
    where = lead_conditions(filters, skip=(SKIP_RUN,))
    rows = (
        await session.execute(
            select(Lead.run_id, Run.created_at, Run.mode, func.count())
            .select_from(Lead)
            .join(Run, Run.id == Lead.run_id)
            .where(*where)
            .group_by(Lead.run_id, Run.created_at, Run.mode)
            .order_by(Run.created_at.desc(), Lead.run_id)
        )
    ).all()
    runs = [
        RunFacet(id=run_id, created_at=created_at, mode=mode, count=int(count))
        for run_id, created_at, mode, count in rows
    ]
    kept = runs[:RUN_FACET_MAX]
    # The run the page asked for stays in the list, even when it is not one of the newest.
    kept += [run for run in runs[RUN_FACET_MAX:] if run.id == filters.run_id]
    return kept


# --- The map ----------------------------------------------------------------------------------


async def map_points(session: AsyncSession, filters: LeadFilters) -> MapOut:
    """Up to 2000 pins, best score first. `total` counts every lead that matches, including
    leads whose city is unknown (they have no pin)."""
    where = lead_conditions(filters)
    total = await session.scalar(select(func.count()).select_from(Lead).where(*where))
    rows = (
        await session.execute(
            select(Lead.id, Lead.company, Lead.result, Lead.score, Lead.city, Lead.suburb)
            .where(*where, Lead.city.in_(list(CITY_CENTRES)))
            .order_by(Lead.score.desc(), Lead.id)
            .limit(MAP_MAX_POINTS)
        )
    ).all()
    points: list[MapPoint] = []
    for lead_id, company, result, score, city, suburb in rows:
        place = approximate_point(city, suburb, lead_id)
        if place is None:
            continue
        points.append(
            MapPoint(
                id=lead_id,
                name=company,
                result=result,
                score=score,
                city=city,
                suburb=suburb,
                lat=place[0],
                lng=place[1],
            )
        )
    return MapOut(total=total or 0, items=points)


# --- The CSV export ---------------------------------------------------------------------------

EXPORT_COLUMNS: Final = (
    "company",
    "result",
    "stage",
    "score",
    "points_checked",
    "city",
    "trigger",
    "trigger_date",
    "industry",
    "office_m2",
    "office_m2_estimated",
    "hubspot_status",
    "status",
    "source_link",
    "created_at",
)
BOM: Final = b"\xef\xbb\xbf"  # so Excel reads the file as UTF-8
# A spreadsheet runs a cell that starts with one of these as a formula.
FORMULA_STARTS: Final = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: str) -> str:
    """The text with a leading apostrophe if a spreadsheet would run it as a formula."""
    return f"'{value}" if value.startswith(FORMULA_STARTS) else value


@dataclass(frozen=True)
class ExportRow:
    company: str
    result: str
    stage: str
    score: int
    score_checked: int | None
    city: str | None
    trigger: str | None
    trigger_date: date | None
    industry: str | None
    office_m2: int | None
    office_m2_estimated: bool
    hubspot_status: str
    status: str
    source_link: str | None
    created_at: datetime


def _cell(value: str | int | bool | date | datetime | None) -> str:
    """One CSV cell. EVERY text cell goes through `csv_safe`, whatever it holds."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return csv_safe(value.astimezone(ZoneInfo(MELBOURNE)).isoformat(timespec="seconds"))
    if isinstance(value, date):
        return csv_safe(value.isoformat())
    if isinstance(value, int):
        return str(value)
    return csv_safe(value)


def render_csv(rows: Sequence[ExportRow]) -> bytes:
    """The file: a byte order mark, the header, then one line for each lead. Times are
    Australia/Melbourne, like the date filters."""
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(EXPORT_COLUMNS)
    for row in rows:
        writer.writerow(
            _cell(value)
            for value in (
                row.company,
                row.result,
                row.stage,
                row.score,
                row.score_checked,
                row.city,
                row.trigger,
                row.trigger_date,
                row.industry,
                row.office_m2,
                row.office_m2_estimated,
                row.hubspot_status,
                row.status,
                row.source_link,
                row.created_at,
            )
        )
    return BOM + out.getvalue().encode("utf-8")


def export_filename(now: datetime | None = None) -> str:
    """`leads-YYYY-MM-DD.csv`, with today's date in Australia/Melbourne."""
    moment = now or datetime.now(ZoneInfo(MELBOURNE))
    return f"leads-{moment.astimezone(ZoneInfo(MELBOURNE)):%Y-%m-%d}.csv"


async def export_rows(
    session: AsyncSession, filters: LeadFilters, sort: LeadSort, order: SortOrder
) -> list[ExportRow]:
    """The rows for the CSV, in the list's order. Raises Problem 413 `too_many_rows` when more
    than 2000 leads match."""
    where = lead_conditions(filters)
    total = await session.scalar(select(func.count()).select_from(Lead).where(*where)) or 0
    if total > EXPORT_MAX_ROWS:
        raise Problem(
            413,
            "Too many rows to export",
            f"{total} leads match. Narrow the filters to {EXPORT_MAX_ROWS} or fewer.",
            code="too_many_rows",
        )
    labels = trigger_labels()
    stages = {str(name): stage for name, stage in load_rules().criteria.stages.items()}
    source_link = _CARD["triggers"][0]["trigger"]["source_url"].as_string()
    rows = await session.execute(
        select(
            Lead.company,
            Lead.result,
            Lead.score,
            Lead.score_checked,
            Lead.city,
            Lead.trigger_id,
            Lead.trigger_date,
            Lead.industry,
            Lead.office_m2,
            Lead.office_m2_estimated,
            Lead.hubspot_status,
            Lead.status,
            source_link.label("source_link"),
            Lead.created_at,
        )
        .where(*where)
        .order_by(*lead_order(sort, order))
        .limit(EXPORT_MAX_ROWS)
    )
    return [
        ExportRow(
            company=company,
            result=result,
            stage=stages[result],
            score=score,
            score_checked=checked,
            city=city,
            trigger=labels.get(trigger_id, trigger_id) if trigger_id else None,
            trigger_date=trigger_date,
            industry=industry,
            office_m2=office_m2,
            office_m2_estimated=bool(estimated),
            hubspot_status=hubspot_status,
            status=status,
            source_link=link if safe_http_url(link) else None,
            created_at=created_at,
        )
        for (
            company,
            result,
            score,
            checked,
            city,
            trigger_id,
            trigger_date,
            industry,
            office_m2,
            estimated,
            hubspot_status,
            status,
            link,
            created_at,
        ) in rows.all()
    ]


# --- One lead ---------------------------------------------------------------------------------


async def get_detail(session: AsyncSession, lead_id: uuid.UUID) -> LeadDetail | None:
    """The lead card and what a person did with it, or None for an unknown id. `previous` lists
    the older researches of the same company, newest first."""
    lead = await session.scalar(
        select(Lead).where(Lead.id == lead_id).execution_options(populate_existing=True)
    )
    if lead is None:
        return None
    older = await session.execute(
        select(Lead.id, Lead.created_at, Lead.result, Lead.score, Lead.status)
        .where(
            Lead.company_key == lead.company_key,
            Lead.is_test.is_(lead.is_test),
            # The same order as "newest": by time, then by id.
            tuple_(Lead.created_at, Lead.id) < tuple_(lead.created_at, lead.id),
        )
        .order_by(Lead.created_at.desc(), Lead.id.desc())
        .limit(PREVIOUS_LIMIT)
    )
    previous = [
        PreviousLead(
            id=row.id,
            created_at=row.created_at,
            result=row.result,
            score=row.score,
            status=row.status,
        )
        for row in older
    ]
    extras: dict[str, Any] = {
        "status": lead.status,
        "reject_reason": lead.reject_reason,
        "note": lead.note,
        "useful": lead.useful,
        "run_id": lead.run_id,
        "origin": lead.origin,
        "is_test": lead.is_test,
        "updated_at": lead.updated_at,
        "previous": previous,
    }
    return LeadDetail.model_validate({**lead.card, **extras})


# --- What a person does to a lead -------------------------------------------------------------


@dataclass(frozen=True)
class LeadState:
    """The parts of a lead that a person can change."""

    status: str
    reject_reason: str | None
    note: str | None
    useful: bool | None


def _text_or_none(value: str | None) -> str | None:
    """The text without spaces at either end. Blank text is nothing."""
    return (value or "").strip() or None


def _invalid(field: str, message: str) -> Problem:
    return Problem(
        422,
        "The request isn't valid",
        "Check the fields listed in errors.",
        errors=[{"field": f"body.{field}", "message": message}],
    )


def apply_patch(current: LeadState, patch: LeadPatch) -> LeadState:
    """The lead as it will be after the patch. A merge patch: a field that was not sent stays,
    `null` clears. Raises Problem 422 when the result isn't allowed:

    - rejecting needs a reason (`body.reject_reason`);
    - a reason belongs to a rejected lead only, so leaving `rejected` clears it, and sending a
      reason with another status is refused.
    A lead that was already sent to HubSpot keeps its status (409).
    """
    sent = set(patch.model_fields_set)
    status = patch.status if "status" in sent and patch.status is not None else current.status
    if status != current.status and current.status == "sent":
        raise Problem(
            409,
            "This lead was already sent",
            "It is in HubSpot, so its status can't be changed here.",
            code="lead_sent",
        )
    if "reject_reason" in sent:
        reason = _text_or_none(patch.reject_reason)
    else:  # kept only while the lead stays rejected
        reason = current.reject_reason if current.status == status == "rejected" else None
    if status == "rejected" and reason is None:
        raise _invalid("reject_reason", "Say why you are rejecting this lead.")
    if status != "rejected" and reason is not None:
        raise _invalid(
            "reject_reason", "A reason belongs to a rejected lead. Send status rejected with it."
        )
    return LeadState(
        status=status,
        reject_reason=reason,
        note=_text_or_none(patch.note) if "note" in sent else current.note,
        useful=patch.useful if "useful" in sent else current.useful,
    )


def outcome_of(state: LeadState) -> str | None:
    """The one word memory keeps about a lead: rejected, useful, not_useful or watching. None
    when a person has said nothing about it."""
    if state.status == "rejected":
        return "rejected"
    if state.useful is not None:
        return "useful" if state.useful else "not_useful"
    return "watching" if state.status == "watching" else None


def outcome_text(lead: Lead, state: LeadState, outcome: str) -> str:
    """What memory stores for an outcome: one plain line. No contacts, no notes."""
    head = {
        "rejected": "Rejected lead",
        "useful": "Useful lead",
        "not_useful": "Not useful lead",
        "watching": "Watching lead",
    }[outcome]
    place = ", ".join(part for part in (lead.city, lead.industry) if part)
    text = f"{head}: {lead.company}" + (f" ({place})" if place else "") + "."
    if state.status == "rejected" and state.reject_reason:
        text += f" Reason: {state.reject_reason.rstrip('.!? ')}."
    if outcome == "rejected" and state.useful is not None:
        text += " The research was rated " + ("useful." if state.useful else "not useful.")
    return one_line(text, 600)


async def _replace_outcome(
    session: AsyncSession, embedder: Embedder, lead: Lead, state: LeadState, *, forget: bool
) -> None:
    """Deletes the lead's outcome item, then saves the new one (unless it is to be forgotten).
    The caller holds the lead row locked and commits, so there is never more than one item."""
    meta: Any = MemoryItem.meta
    await session.execute(
        delete(MemoryItem)
        .where(
            MemoryItem.app == APP,
            MemoryItem.kind == OUTCOME_KIND,
            meta.contains({"lead_id": str(lead.id)}),
        )
        .execution_options(synchronize_session=False)
    )
    outcome = None if forget else outcome_of(state)
    if outcome is None:
        return
    note = Note(
        content=outcome_text(lead, state, outcome),
        subject=lead.company,
        meta={"lead_id": str(lead.id), "outcome": outcome},
    )
    await remember_many(session, embedder, [note], app=APP, kind=OUTCOME_KIND)


async def patch_lead(
    session: AsyncSession, embedder: Embedder, lead_id: uuid.UUID, patch: LeadPatch
) -> LeadDetail:
    """Applies a merge patch and returns the updated lead.

    The lead row is locked first, so two patches of one lead run one after the other. When the
    status or the thumb changes, the lead's `lead_outcome` memory item is replaced (embedded on
    this computer): saved when there is an outcome, deleted when there is none or when the patch
    sends status `new` (an Undo). A patch that changes nothing writes nothing.
    """
    lead = await session.scalar(
        select(Lead)
        .where(Lead.id == lead_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if lead is None:
        raise Problem(404, *NOT_FOUND)
    current = LeadState(lead.status, lead.reject_reason, lead.note, lead.useful)
    try:
        new = apply_patch(current, patch)
    except Problem:
        await session.commit()  # nothing was changed. This lets go of the row lock.
        raise
    if new != current:
        lead.status = new.status
        lead.reject_reason = new.reject_reason
        lead.note = new.note
        lead.useful = new.useful
        outcome_moved = (new.status, new.reject_reason, new.useful) != (
            current.status,
            current.reject_reason,
            current.useful,
        )
        if outcome_moved:
            undo = "status" in patch.model_fields_set and patch.status == "new"
            await _replace_outcome(session, embedder, lead, new, forget=undo)
    await session.commit()
    detail = await get_detail(session, lead_id)
    assert detail is not None  # the row was locked a moment ago
    return detail
