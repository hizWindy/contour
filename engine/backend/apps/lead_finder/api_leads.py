"""Lead endpoints: the results table, facets, CSV export, the map, one lead, and feedback.

Each route checks its request and calls `lead_store` (the leads table) or `similar`
(look-alikes). The filters are explained once, in `LeadFilters` below.

`/leads/export`, `/leads/facets` and `/leads/map` are declared BEFORE `/leads/{lead_id}`, or
the id route would swallow them and answer 422.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from apps.lead_finder import lead_store
from apps.lead_finder.lead_store import SORT_COLUMNS, lead_conditions, newest_only
from apps.lead_finder.rules import Result
from apps.lead_finder.schemas import (
    HubSpotStatus,
    LeadDetail,
    LeadFacets,
    LeadPage,
    LeadPatch,
    LeadSort,
    LeadStatus,
    MapOut,
    SimilarOut,
    SortOrder,
)
from apps.lead_finder.similar import similar_for
from core.api.deps import EmbedderDep, SessionDep
from core.api.errors import Problem
from core.api.models import INT32_MAX, OFFSET_MAX, SafeText

__all__ = ["SORT_COLUMNS", "LeadFilters", "lead_conditions", "newest_only", "router"]

router = APIRouter(prefix="/leads", tags=["leads"])

REPEAT = "Repeat the key to match several values"


LATEST_DESCRIPTION = (
    "One row for each company: its newest research. Left out, it is on, except when `run_id` is "
    "given: then every lead of that run is shown, even when a later run researched the company "
    "again. It is worked out BEFORE the other filters, so `status=rejected` lists the companies "
    "whose newest research is rejected: a company that was researched again after it was "
    "rejected is not in it (use `latest=false` or `run_id` to see the old row). A test-set lead "
    "and a real lead of one company are counted apart, so `include_tests=true` shows both."
)


@dataclass
class LeadFilters(lead_store.LeadFilters):
    """The filters that GET /leads, /leads/facets, /leads/export and /leads/map share.

    The store's class of the same name holds the values. This one adds what the query string
    needs: a description for Swagger, and the limits. Free text is `SafeText` (no NUL character,
    which the database can't store) and numbers have an upper bound the database accepts, so a
    bad value is a 422 and never a 500.
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
    return await lead_store.list_leads(session, filters, sort, order, limit, offset)


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
async def export_leads(
    session: SessionDep,
    filters: Filters,
    sort: SortParam = "score",
    order: OrderParam = "desc",
) -> Response:
    rows = await lead_store.export_rows(session, filters, sort, order)
    return Response(
        content=lead_store.render_csv(rows),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={lead_store.export_filename()}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/facets",
    response_model=LeadFacets,
    summary="What the filters offer, with counts",
    description=(
        "Takes the same filters as the list. Each count applies every active filter except "
        "its own, so a filter shows what choosing it would give."
    ),
)
async def lead_facets(session: SessionDep, filters: Filters) -> LeadFacets:
    return await lead_store.lead_facets(session, filters)


@router.get(
    "/map",
    response_model=MapOut,
    summary="Pins for the map",
    description=(
        "Up to 2000 leads that match the filters. The places are approximate: the centre of "
        "the suburb (or the city), moved a little so pins don't sit on top of each other."
    ),
)
async def lead_map(session: SessionDep, filters: Filters) -> MapOut:
    return await lead_store.map_points(session, filters)


@router.get("/{lead_id}", response_model=LeadDetail, summary="One lead card")
async def get_lead(lead_id: uuid.UUID, session: SessionDep) -> LeadDetail:
    detail = await lead_store.get_detail(session, lead_id)
    if detail is None:
        raise Problem(404, *lead_store.NOT_FOUND)
    return detail


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
async def patch_lead(
    lead_id: uuid.UUID, body: LeadPatch, session: SessionDep, embedder: EmbedderDep
) -> LeadDetail:
    return await lead_store.patch_lead(session, embedder, lead_id, body)


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
async def similar_leads(lead_id: uuid.UUID, session: SessionDep) -> SimilarOut:
    return await similar_for(session, lead_id)
