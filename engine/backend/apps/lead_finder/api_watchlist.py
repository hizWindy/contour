"""The watchlist preview: the HubSpot companies a watchlist run would research.

Answers 501 until its package builds it (see core/api/stubs.py).
"""

from typing import Annotated

from fastapi import APIRouter, Query

from apps.lead_finder.schemas import WatchlistOut
from core.api.stubs import stub

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
@stub
async def get_watchlist(
    include_unlikely: Annotated[
        bool, Query(description="Include industries that rarely work in an office")
    ] = True,
    include_director: Annotated[
        bool, Query(description="Include the Director review list in `items`")
    ] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
) -> WatchlistOut:
    raise NotImplementedError
