"""Companies endpoints, under /api/v1/companies (PLAN-V10).

Everyone with the Companies tick sees the HubSpot copy. A person who also has the Lead Finder tick
sees its good leads that aren't in HubSpot yet, and its column and panel section. The server leaves
those out for anyone else: hiding them in the browser would not be enough (PLAN-V10 B2).

This file has the reads. The call prep routes are in api_preps.py, and the script edits and style
notes (PLAN-V14) in api_script.py.
"""

from typing import Annotated

from fastapi import APIRouter, Path, Query

from apps.companies import api_preps, api_script, store
from apps.companies.deals import DealState
from apps.companies.deps import LeadsDep
from apps.companies.schemas import (
    CompanyDetail,
    CompanyFacets,
    CompanyPage,
    CompanySearch,
    SortKey,
    SortOrder,
    Source,
)
from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX, SafeText

router = APIRouter()


Key = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        description="A HubSpot company id, or lead:<id> for a lead not in HubSpot yet",
    ),
]


def not_found() -> Problem:
    return Problem(
        404,
        "Company not found",
        "There is no such company, or it isn't open to your account.",
        code="company_not_found",
    )


@router.get(
    "",
    response_model=CompanyPage,
    summary="List companies",
    description=(
        "One page of companies from the HubSpot copy, by name unless `sort` says otherwise. "
        "With the Lead Finder tick, its good leads that aren't in HubSpot yet are added "
        "(`source` lead), and each row has the Lead Finder's newest result. `q` looks in the "
        "name, website and industry. `city` matches the company's city or any of its offices."
    ),
)
async def list_companies(
    session: SessionDep,
    leads: LeadsDep,
    q: Annotated[SafeText | None, Query(max_length=200)] = None,
    city: Annotated[SafeText | None, Query(max_length=120)] = None,
    owner: Annotated[SafeText | None, Query(max_length=120)] = None,
    deal: DealState | None = None,
    source: Source | None = None,
    sort: SortKey = "name",
    order: SortOrder | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = store.PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> CompanyPage:
    query = store.ListQuery(
        q=q or None,
        city=city or None,
        owner=owner or None,
        deal=deal,
        source=source,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    return await store.list_companies(session, query, leads)


@router.get(
    "/facets",
    response_model=CompanyFacets,
    summary="What the filters offer",
    description="The cities, with how many companies have an office there, and the owners.",
)
async def company_facets(session: SessionDep, leads: LeadsDep) -> CompanyFacets:
    return await store.facets(session, leads)


@router.get(
    "/search",
    response_model=CompanySearch,
    summary="Matches for the prep box",
    description=(
        "Up to 4 people (once HubSpot's contacts are copied) and up to 4 companies whose name "
        "matches `q`, best first. Fewer than 2 letters give nothing."
    ),
)
async def search_companies(
    session: SessionDep,
    leads: LeadsDep,
    q: Annotated[SafeText, Query(max_length=120)],
) -> CompanySearch:
    return await store.search(session, q, leads)


# The prep and script routes have fixed paths (/preps/..., /script-edits, /script-style/...), so
# they go before /{key}.
router.include_router(api_preps.router)
router.include_router(api_script.router)


@router.get(
    "/{key}",
    response_model=CompanyDetail,
    summary="One company",
    description=(
        "What it does, its offices, deals and owner, the last talk, saved notes under 30 days "
        "old from any project, and (with HubSpot's contacts and calls) its people and calls. "
        "The Lead Finder section comes only with the Lead Finder tick. 404 `company_not_found` "
        "when there is no such company, or it isn't open to this account."
    ),
)
async def get_company(session: SessionDep, leads: LeadsDep, key: Key) -> CompanyDetail:
    if not store.valid_key(key):
        raise not_found()
    detail = await store.company_detail(session, key, leads)
    if detail is None:
        raise not_found()
    return detail
