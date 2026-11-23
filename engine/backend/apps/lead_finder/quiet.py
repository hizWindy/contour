"""New leads only (PLAN-V27 Part 1): when a company already in HubSpot still counts as new.

A Find new leads run leaves out a company already in HubSpot (choice 3), unless it is quiet:
nobody has worked it for `hubspot_quiet_months`. "Worked" is HubSpot's "Last activity date" in our
copy (`HubSpotCompany.last_activity`: the newest call, email, meeting, note or task).

- A company with no activity date at all has never been worked, so it is quiet. On 24 Nov 2026 the
  laptop's copy had a date for 145 of its 13,921 companies (TBC: the live copy's count, S2).
- 0 months: no company is ever quiet, so every HubSpot company is left out (A2).
- An open deal is never quiet: the deal rule leaves it out first. A dissolved deal or a plain
  "in HubSpot" company can be.

A quiet company is researched, and its lead's HubSpot status is `quiet`, so its card says "In
HubSpot, quiet since March 2025" and Results shows it with the new leads. Free: our copy only.
"""

from collections.abc import Collection
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.matching import HubSpotMatch, Status
from core.hubspot.models import HubSpotCompany

QUIET: Status = "quiet"
# The statuses that can be quiet. An open deal can't; new and a maybe aren't in HubSpot for sure.
CAN_BE_QUIET: frozenset[str] = frozenset({"in_hubspot", "dissolved_deal"})
# A match that names one HubSpot company for sure (PLAN-V27 choice 26). A maybe never does.
SURE_MATCH: frozenset[str] = frozenset({"hubspot_id", "domain", "name"})


def months_before(today: date, months: int) -> date:
    """The same day `months` months earlier, or the month's last day when it is shorter."""
    total = today.year * 12 + today.month - 1 - months
    year, month = divmod(total, 12)
    month += 1
    for day in (today.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    return date(year, month, 28)


def is_quiet(last_activity: date | None, months: int, today: date) -> bool:
    """Nobody has worked it for `months` months (module text). 0 months: never quiet."""
    if months <= 0:
        return False
    if last_activity is None:
        return True
    return last_activity < months_before(today, months)


async def last_activity_of(session: AsyncSession, ids: Collection[str]) -> dict[str, date | None]:
    """The last activity day of each HubSpot company, by id. A company not in our copy is left
    out of the answer."""
    wanted = sorted({hubspot_id for hubspot_id in ids if hubspot_id})
    if not wanted:
        return {}
    rows = await session.execute(
        select(HubSpotCompany.hubspot_id, HubSpotCompany.last_activity).where(
            HubSpotCompany.hubspot_id.in_(wanted)
        )
    )
    return {hubspot_id: moment.date() if moment else None for hubspot_id, moment in rows}


@dataclass(frozen=True)
class QuietCheck:
    """A lead's HubSpot status after the quiet rule, and the day it was last worked."""

    status: Status
    last_activity: date | None


def quiet_check(
    match: HubSpotMatch, last_activity: date | None, months: int, today: date
) -> QuietCheck:
    """`quiet` for a HubSpot company nobody has worked for `months`; otherwise the match's own
    status. The day is kept either way, for the card."""
    if (
        match.status in CAN_BE_QUIET
        and match.hubspot_id is not None
        and is_quiet(last_activity, months, today)
    ):
        return QuietCheck(QUIET, last_activity)
    return QuietCheck(match.status, last_activity)


async def quiet_status(
    session: AsyncSession, match: HubSpotMatch, months: int, today: date
) -> QuietCheck:
    """`quiet_check` with the day read from our copy."""
    if match.hubspot_id is None or match.status not in CAN_BE_QUIET:
        return QuietCheck(match.status, None)
    days = await last_activity_of(session, [match.hubspot_id])
    return quiet_check(match, days.get(match.hubspot_id), months, today)
