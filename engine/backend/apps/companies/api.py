"""Companies endpoints, under /api/v1/companies (PLAN-V10).

Everyone with the Companies tick sees the HubSpot copy. A person who also has the Lead Finder tick
sees its good leads that aren't in HubSpot yet, and its column and panel section. The server leaves
those out for anyone else: hiding them in the browser would not be enough (PLAN-V10 B2).

This file has the reads. The call prep routes are in api_preps.py, the script edits and style
notes (PLAN-V14) in api_script.py, the call notes (PLAN-V17) in api_notes.py, Meetings
(PLAN-V17) in api_meetings.py, and the Assistant (PLAN-V22) in api_assistant.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from apps.companies import (
    api_assistant,
    api_meetings,
    api_notes,
    api_preps,
    api_script,
    meeting_store,
    store,
)
from apps.companies.deals import DealState
from apps.companies.deps import LeadsDep
from apps.companies.live_voice import api as live_voice_api
from apps.companies.schemas import (
    CompanyDetail,
    CompanyFacets,
    CompanyPage,
    CompanySearch,
    SortKey,
    SortOrder,
    Source,
)
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX, SafeText
from core.api.signin import NowDep

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
        "We can't find that company",
        "It may have been removed, or it isn't open to your account. Go back to the list "
        "and pick it again.",
        code="company_not_found",
    )


@router.get(
    "",
    response_model=CompanyPage,
    dependencies=[Depends(need("companies.companies", "companies.call_logs"))],
    summary="List companies",
    description=(
        "One page of companies from the HubSpot copy. `sort`: `last_activity` (the default: "
        "the newest of HubSpot's Last activity date and Last contacted, newest first), `name`, "
        "`staff`, `lease` or `last_talk`; `order` turns it round. An empty value goes last, "
        "then ties go A to Z. With the Lead Finder tick, its good leads that aren't in HubSpot "
        "yet are added (`source` lead, with no last activity, so they come last), and each row "
        "has the Lead Finder's newest result. `q` looks in the name, website and industry. "
        "`city` matches the company's city or any of its offices."
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
    sort: SortKey = "last_activity",
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
    dependencies=[Depends(need("companies.companies"))],
    summary="What the filters offer",
    description="The cities, with how many companies have an office there, and the owners.",
)
async def company_facets(session: SessionDep, leads: LeadsDep) -> CompanyFacets:
    return await store.facets(session, leads)


@router.get(
    "/search",
    response_model=CompanySearch,
    dependencies=[
        Depends(
            need(
                "companies.call_prep",
                "companies.companies",
                "companies.call_logs",
                "companies.meetings",
            )
        )
    ],
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


# The prep, script, call note, meeting and Assistant routes have fixed paths (/preps/...,
# /script-edits, /script-style/..., /call-notes/..., /meetings/..., /assistant/...), so they go
# before /{key}.
router.include_router(api_preps.router)
router.include_router(api_script.router)
router.include_router(api_notes.router)
router.include_router(api_meetings.router)
router.include_router(api_assistant.router)
router.include_router(live_voice_api.router)  # PLAN-V28: live voice


@router.get(
    "/{key}",
    response_model=CompanyDetail,
    dependencies=[Depends(need("companies.companies"))],
    summary="One company",
    description=(
        "What it does, its offices, deals and owner, the last talk, saved notes under 30 days "
        "old from any project, and (with HubSpot's contacts and calls) its people and calls. "
        "The Lead Finder section comes only with the Lead Finder tick. `meetings`: its next "
        "three client meetings and its last three, while Meetings are on and HubSpot's "
        "meetings are read. 404 `company_not_found` when there is no such company, or it isn't "
        "open to this account."
    ),
)
async def get_company(
    session: SessionDep,
    settings: SettingsDep,
    leads: LeadsDep,
    auth: SignedInDep,
    source: api_meetings.SourceDep,
    now: NowDep,
    key: Key,
) -> CompanyDetail:
    if not store.valid_key(key):
        raise not_found()
    detail = await store.company_detail(session, key, leads)
    if detail is None:
        raise not_found()
    detail.meetings = await meeting_store.company_meetings(
        session,
        key,
        source=source,
        settings=settings,
        now=now,
        me=await meeting_store.my_owner(session, auth, source),
    )
    return detail
