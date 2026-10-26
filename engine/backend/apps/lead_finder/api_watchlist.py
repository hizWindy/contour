"""The watchlist preview: the HubSpot companies a watchlist run would research.

Local data only: it reads the HubSpot copy in the database and the rules. Nothing goes to
Claude, so it needs no approval to use HubSpot names.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from apps.lead_finder.rules import load_rules
from apps.lead_finder.schemas import WatchlistOut
from apps.lead_finder.watchlist import load_watchlist
from core.api.deps import SessionDep

router = APIRouter()


@router.get(
    "/watchlist",
    response_model=WatchlistOut,
    summary="Preview the HubSpot watchlist",
    description=(
        "The HubSpot companies a watchlist run would research, with the counts of how the "
        "rest were left out. Local only: nothing goes to Claude."
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
) -> WatchlistOut:
    return await load_watchlist(
        session,
        load_rules(),
        include_unlikely=include_unlikely,
        include_director=include_director,
        limit=limit,
    )
