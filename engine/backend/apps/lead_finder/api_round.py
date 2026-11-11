"""The city schedules as one control: `GET` and `PUT /api/v1/schedules/lead-finder` (PLAN-V13 T1-3).

The core mounts this router under `/schedules` plus the project's prefix
(`AppSpec.schedule_router`), next to the core's own Schedules endpoints, with the Lead Finder's
access check. Reading needs a
session; saving needs the Admin role, because switching the round on spends money. See `round.py`
for what a save does.
"""

from fastapi import APIRouter, Request

from apps.lead_finder.round import RoundIn, RoundOut, read_round, save_round
from core.api.deps import SessionDep
from core.api.signin import AdminDep, NowDep
from core.prefs.service import effective_settings

router = APIRouter()


@router.get(
    "",
    response_model=RoundOut,
    summary="The city schedules as one plan, the round so far and its budget",
)
async def get_lead_finder_round(session: SessionDep, now: NowDep) -> RoundOut:
    settings = await effective_settings(session)
    found = await read_round(session, settings, now)
    await session.rollback()  # reads only: ends the transaction
    return found


@router.put(
    "",
    response_model=RoundOut,
    summary="Save the city schedules as one plan, and the round's budget",
    description=(
        "Changes the four city schedules in one transaction. Picked cities are on, one day apart "
        "in the order Melbourne, Adelaide, Perth, Sydney, from the first day (`weekday`, 0 Monday "
        "to 6 Sunday) at `at` (24-hour, Melbourne time). The others are off. A round must end "
        "before the next starts, so `every` in days is at least the number of cities. "
        "`budget_usd` is the most a whole round may spend (the setting "
        "`lead_finder_round_cap_usd`). Saving the same times again keeps each schedule's next "
        "run. Switching it on spends money, so it needs the Admin role."
    ),
)
async def put_lead_finder_round(
    body: RoundIn, request: Request, session: SessionDep, now: NowDep, admin: AdminDep
) -> RoundOut:
    await save_round(session, body, now)
    settings = await effective_settings(session)
    found = await read_round(session, settings, now)
    await session.rollback()
    return found
