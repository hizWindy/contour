"""How the engine reads the two tools: our copy of Property Daily and Arealytics.

PLAN-V16, the contract part 1. The two names below are fixed (S0), so Track 1 builds the research
against them while Track 2 builds the connectors.

- `lookup_company`: everything both tools know about one company's office. It reads our copy
  first, and asks a tool live only when that tool is on and our last lookup of the company is
  older than `property_lookup_days`. It never raises: a problem is that tool's status, `error`.
- `recent_items`: the new feed items for some cities, from our copy only. Free and fast.

S0: both are stubs that read nothing. A tool is `off` while its switch is off, and `not_checked`
while it is on. T2-7 gives them their real code.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from core.prefs.service import effective_settings
from core.sources.types import CompanyProperty, FeedItem, SourceChecks, SourceStatus


def _untouched(on: bool) -> SourceStatus:
    return "not_checked" if on else "off"


async def lookup_company(
    session: AsyncSession,
    name: str,
    city: str | None,
    website: str | None,
    *,
    run_id: uuid.UUID | None = None,
    settings: Settings | None = None,
) -> CompanyProperty:
    """What both tools know about one company's office, newest record first. Never raises.

    `run_id`: the live pages count against that run's `source_pages_per_run`. `settings`: the
    settings in use (a run passes its own). None reads them from the database.
    """
    in_use = settings if settings is not None else await effective_settings(session)
    return CompanyProperty(
        checked=SourceChecks(
            property_daily=_untouched(in_use.property_daily_enabled),
            arealytics=_untouched(in_use.arealytics_enabled),
        )
    )


async def recent_items(
    session: AsyncSession, cities: Sequence[str] | None, since: datetime
) -> list[FeedItem]:
    """New feed items since `since` (a time with its zone), for these cities, newest first.

    `cities` None, empty, or holding "Australia" means every city. From our copy only.
    """
    return []
