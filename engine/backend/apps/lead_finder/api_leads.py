"""Lead endpoints: the results table, facets, CSV export, the map, one lead, and feedback.

`GET /leads` and `GET /leads/{id}` work now, in a plain form, against the columns of the leads
table. Package B4c replaces them with the full lead store. The rest answer 501 until their
package builds them (see core/api/stubs.py).

`/leads/export`, `/leads/facets` and `/leads/map` are declared BEFORE `/leads/{lead_id}`, or
the id route would swallow them and answer 422.
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import ColumnElement, Date, case, cast, func, select

from apps.lead_finder.rules import Result, load_rules
from apps.lead_finder.sanitize import one_line
from apps.lead_finder.schemas import (
    HubSpotStatus,
    LeadDetail,
    LeadFacets,
    LeadPage,
    LeadPatch,
    LeadRow,
    LeadSort,
    LeadStatus,
    MapOut,
    PreviousLead,
    SimilarOut,
    SortOrder,
)
from apps.lead_finder.tables import Lead
from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import INT32_MAX, OFFSET_MAX, SafeText
from core.api.stubs import stub

router = APIRouter(prefix="/leads", tags=["leads"])

REPEAT = "Repeat the key to match several values"
MELBOURNE = "Australia/Melbourne"
PREVIOUS_LIMIT = 10


LATEST_DESCRIPTION = (
    "One row for each company: its newest research. Left out, it is on, except when `run_id` is "
    "given: then every lead of that run is shown, even when a later run researched the company "
    "again. It is worked out BEFORE the other filters, so `status=rejected` lists the companies "
    "whose newest research is rejected: a company that was researched again after it was "
    "rejected is not in it (use `latest=false` or `run_id` to see the old row). A test-set lead "
    "and a real lead of one company are counted apart, so `include_tests=true` shows both."
)


@dataclass
class LeadFilters:
    """The filters that GET /leads, /leads/facets, /leads/export and /leads/map share.

    Free text is `SafeText` (no NUL character, which the database can't store) and numbers have
    an upper bound the database accepts, so a bad value is a 422 and never a 500.
    """

    result: Annotated[list[Result] | None, Query(description=REPEAT)] = None
    city: Annotated[list[SafeText] | None, Query(description=REPEAT)] = None
    trigger: Annotated[
        list[SafeText] | None,
        Query(description="A trigger id. Matches a lead with any of them. " + REPEAT),
    ] = None
    industry: Annotated[
        list[SafeText] | None, Query(description="The exact industry, as the facets list it")
    ] = None
    industry_group: Annotated[list[SafeText] | None, Query(description=REPEAT)] = None
    min_score: Annotated[int | None, Query(ge=0, le=100)] = None
    office_m2_min: Annotated[int | None, Query(ge=0, le=INT32_MAX)] = None
    office_m2_max: Annotated[int | None, Query(ge=0, le=INT32_MAX)] = None
    hubspot_status: Annotated[list[HubSpotStatus] | None, Query(description=REPEAT)] = None
    status: Annotated[list[LeadStatus] | None, Query(description=REPEAT)] = None
    run_id: Annotated[uuid.UUID | None, Query(description="Only leads from this run")] = None
    created_since: Annotated[
        date | None, Query(description="Researched on or after this date (Melbourne time)")
    ] = None
    created_until: Annotated[
        date | None, Query(description="Researched on or before this date (Melbourne time)")
    ] = None
    trigger_since: Annotated[
        date | None, Query(description="Its trigger happened on or after this date")
    ] = None
    q: Annotated[
        SafeText | None,
        Query(max_length=100, description="Part of the company name. % and _ are plain text."),
    ] = None
    include_tests: Annotated[bool, Query(description="Include leads made by the test set")] = False
    latest: Annotated[bool | None, Query(description=LATEST_DESCRIPTION)] = None


Filters = Annotated[LeadFilters, Depends()]
SortParam = Annotated[LeadSort, Query(description="The column to sort by")]
OrderParam = Annotated[SortOrder, Query()]
LimitParam = Annotated[int, Query(ge=1, le=200)]
OffsetParam = Annotated[int, Query(ge=0, le=OFFSET_MAX)]

RESULT_RANK = case(
    {"pass": 0, "director_review": 1, "watch": 2, "drop": 3}, value=Lead.result, else_=4
)
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


def lead_conditions(filters: LeadFilters) -> list[ColumnElement[bool]]:
    """The WHERE parts for the filters."""
    where: list[ColumnElement[bool]] = []
    if filters.result:
        where.append(Lead.result.in_(filters.result))
    if filters.city:
        where.append(Lead.city.in_(filters.city))
    if filters.trigger:
        where.append(Lead.trigger_ids.overlap(filters.trigger))
    if filters.industry:
        where.append(Lead.industry.in_(filters.industry))
    if filters.industry_group:
        where.append(Lead.industry_group.in_(filters.industry_group))
    if filters.min_score is not None:
        where.append(Lead.score >= filters.min_score)
    if filters.office_m2_min is not None:
        where.append(Lead.office_m2 >= filters.office_m2_min)
    if filters.office_m2_max is not None:
        where.append(Lead.office_m2 <= filters.office_m2_max)
    if filters.hubspot_status:
        where.append(Lead.hubspot_status.in_(filters.hubspot_status))
    if filters.status:
        where.append(Lead.status.in_(filters.status))
    if filters.run_id is not None:
        where.append(Lead.run_id == filters.run_id)
    if filters.created_since is not None:
        where.append(_melbourne_day() >= filters.created_since)
    if filters.created_until is not None:
        where.append(_melbourne_day() <= filters.created_until)
    if filters.trigger_since is not None:
        where.append(Lead.trigger_date >= filters.trigger_since)
    if filters.q:
        where.append(Lead.company.icontains(filters.q, autoescape=True))
    tests = [] if filters.include_tests else [Lead.is_test.is_(False)]
    where += tests
    if newest_only(filters):
        # A test lead and a real lead with one company_key are two companies here, so each keeps
        # its own newest row (and `include_tests=true` doesn't let one hide the other).
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


_ROW_COLUMNS = (
    "id",
    "company",
    "city",
    "suburb",
    "result",
    "score",
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


def lead_row(lead: Lead, trigger_labels: Mapping[str, str]) -> LeadRow:
    """One table row from a lead. `reason` is the first line of why the card says it fits."""
    data: dict[str, Any] = {name: getattr(lead, name) for name in _ROW_COLUMNS}
    data["trigger_ids"] = list(lead.trigger_ids or [])
    data["trigger_label"] = trigger_labels.get(lead.trigger_id) if lead.trigger_id else None
    data["reason"] = one_line(str(lead.card.get("why_it_fits") or ""), 240)
    return LeadRow.model_validate(data)


def trigger_labels() -> dict[str, str]:
    return {trigger.id: trigger.label for trigger in load_rules().criteria.triggers.every}


@router.get(
    "",
    response_model=LeadPage,
    summary="List leads",
    description=(
        "One page of leads, best score first unless `sort` says otherwise. By default each "
        "company shows once (its newest research, `latest`, which is off when `run_id` is "
        "given) and test-set leads are left out. Repeat a filter key to match several values. "
        "`offset` can't pass 1000000, and a number filter can't pass 2147483647."
    ),
)
async def list_leads(
    session: SessionDep,
    filters: Filters,
    sort: SortParam = "score",
    order: OrderParam = "desc",
    limit: LimitParam = 50,
    offset: OffsetParam = 0,
) -> LeadPage:
    where = lead_conditions(filters)
    total = await session.scalar(select(func.count()).select_from(Lead).where(*where))
    column = SORT_COLUMNS[sort]
    direction = column.desc() if order == "desc" else column.asc()
    page = (
        select(Lead)
        .where(*where)
        .order_by(direction.nulls_last(), Lead.id)
        .limit(limit)
        .offset(offset)
    )
    labels = trigger_labels()
    rows = await session.scalars(page)
    return LeadPage(total=total or 0, items=[lead_row(row, labels) for row in rows])


@router.get(
    "/export",
    response_model=None,
    response_class=Response,
    summary="Download the filtered leads as a CSV file",
    description=(
        "Takes the same filters and sort as the list. UTF-8 with a byte order mark, so Excel "
        "reads it. Over 2000 rows it answers 413 `too_many_rows`. A cell that starts with "
        "`=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so a "
        "spreadsheet never runs it as a formula."
    ),
    responses={
        200: {
            "description": "The CSV file",
            "content": {"text/csv": {"schema": {"type": "string"}}},
            "headers": {
                "Content-Disposition": {
                    "description": "attachment; filename=leads-YYYY-MM-DD.csv",
                    "schema": {"type": "string"},
                }
            },
        }
    },
)
@stub
async def export_leads(
    filters: Filters, sort: SortParam = "score", order: OrderParam = "desc"
) -> Response:
    raise NotImplementedError


@router.get(
    "/facets",
    response_model=LeadFacets,
    summary="What the filters offer, with counts",
    description=(
        "Takes the same filters as the list. Each count applies every active filter except "
        "its own, so a filter shows what choosing it would give."
    ),
)
@stub
async def lead_facets(filters: Filters) -> LeadFacets:
    raise NotImplementedError


@router.get(
    "/map",
    response_model=MapOut,
    summary="Pins for the map",
    description=(
        "Up to 2000 leads that match the filters. The places are approximate: the centre of "
        "the suburb (or the city), moved a little so pins don't sit on top of each other."
    ),
)
@stub
async def lead_map(filters: Filters) -> MapOut:
    raise NotImplementedError


@router.get("/{lead_id}", response_model=LeadDetail, summary="One lead card")
async def get_lead(lead_id: uuid.UUID, session: SessionDep) -> LeadDetail:
    lead = await session.get(Lead, lead_id)
    if lead is None:
        raise Problem(404, "Lead not found", "Check the id. GET /lead-finder/leads lists them.")
    older = await session.scalars(
        select(Lead)
        .where(
            Lead.company_key == lead.company_key,
            Lead.id != lead.id,
            Lead.is_test.is_(lead.is_test),
            Lead.created_at < lead.created_at,
        )
        .order_by(Lead.created_at.desc(), Lead.id)
        .limit(PREVIOUS_LIMIT)
    )
    previous = [
        PreviousLead.model_validate(
            {
                "id": row.id,
                "created_at": row.created_at,
                "result": row.result,
                "score": row.score,
                "status": row.status,
            }
        )
        for row in older
    ]
    extras = {
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


@router.patch(
    "/{lead_id}",
    response_model=LeadDetail,
    summary="Change a lead's status, note or feedback",
    description=(
        "A merge patch: a field you leave out stays as it is, and `null` clears it. `status` "
        "is new, watching or rejected, and rejecting needs `reject_reason`. Leaving rejected "
        "clears the reason. Setting the status to `new` removes the lead's outcome from memory; "
        "any other change replaces it. Returns the updated lead, so the Undo button can send "
        "back the exact values it had."
    ),
)
@stub
async def patch_lead(lead_id: uuid.UUID, body: LeadPatch) -> LeadDetail:
    raise NotImplementedError


@router.get(
    "/{lead_id}/similar",
    response_model=SimilarOut,
    summary="Companies that look like this lead",
    description=(
        "Compares this lead's profile with HubSpot companies that have a deal and with other "
        "researched leads. Local only: nothing goes to Claude. Answers 200 with `basis: none` "
        "when the lead has no profile yet, and 404 only for an unknown lead."
    ),
)
@stub
async def similar_leads(lead_id: uuid.UUID) -> SimilarOut:
    raise NotImplementedError
