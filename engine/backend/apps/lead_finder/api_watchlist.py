"""The watchlist preview: the HubSpot companies a watchlist run would research.

Local data only: it reads the HubSpot copy in the database and the rules. Nothing goes to
Claude, so it needs no approval to use HubSpot names. The Start page's lease and tenure run
(PLAN-V11 C2) asks it for one city and some industries, so that count is free too.
"""

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import ValidationError

from apps.lead_finder.params import WatchlistOptions
from apps.lead_finder.rules import load_rules
from apps.lead_finder.schemas import WatchlistOut
from apps.lead_finder.watchlist import load_watchlist
from core.api.deps import SessionDep
from core.api.errors import Problem

router = APIRouter()


@router.get(
    "/watchlist",
    response_model=WatchlistOut,
    summary="Preview the HubSpot watchlist",
    description=(
        "The HubSpot companies a watchlist run would research, with the counts of how the "
        "rest were left out. Local only: nothing goes to Claude. `city` and `industry` narrow the "
        "lists like a lease and tenure run's choices do; `counts` stays the whole copy."
    ),
)
async def get_watchlist(
    session: SessionDep,
    include_unlikely: Annotated[
        bool, Query(description="Include industries that rarely work in an office")
    ] = True,
    include_director: Annotated[
        bool, Query(description="Include the Director review list in `items`")
    ] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
    city: Annotated[
        str | None,
        Query(max_length=60, description="Only companies whose biggest office is in this city"),
    ] = None,
    industry: Annotated[
        list[str] | None,
        Query(description="Only companies in these HubSpot industries. Repeat it for more."),
    ] = None,
) -> WatchlistOut:
    try:
        # The same checks as a run's choices, so the preview and the run agree.
        chosen = WatchlistOptions(city=city, industries=industry or [])
    except ValidationError as error:
        detail = str(error.errors()[0]["msg"])
        raise Problem(422, "That choice can't be used", detail, code="bad_choice") from None
    return await load_watchlist(
        session,
        load_rules(),
        include_unlikely=include_unlikely,
        include_director=include_director,
        limit=limit,
        city=chosen.city,
        industries=chosen.industries,
    )
