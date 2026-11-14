"""How the engine reads the two tools: our copy of Property Daily and Arealytics.

PLAN-V16, the contract part 1. The two names below are fixed (S0), so Track 1 builds the research
against them while Track 2 builds the connectors.

- `lookup_company`: everything both tools know about one company's office. It reads our copy
  first, and asks a tool live only when that tool is on and our last lookup of the company is
  older than `property_lookup_days`. It never raises: a problem is that tool's status, `error`.
- `recent_items`: the new feed items for some cities, from our copy only. Free and fast.
- `source_availability` (added in T2-7, for the run options): each tool, on or off, ready or not,
  and why not in one sentence.

Arealytics is always `off`: it has no connector (its site refused automated access, and Al-khair
dropped it from PLAN-V16 on 15 Nov).

**A live lookup** reads about 3 pages, at the tools' slow pace (4 to 9 seconds apart), so it takes
about half a minute. It counts against the run's `source_pages_per_run`. Over a limit, or while
the tool is paused, it isn't asked: the tool's status is `not_checked` (over a limit) or `error`
(paused, no login, or a page failed), and our copy is still returned. A lookup that failed is not
remembered, so the next one tries again. The database work uses short sessions of its own, so no
connection is held while the browser reads.
"""

import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.browser.reader import DailyLimitReached, RunLimitReached, SourceStopped
from core.browser.worker import BrowserError
from core.config import Settings
from core.hubspot.matching import clean_name
from core.prefs.service import effective_settings
from core.sources import store
from core.sources.meaning import as_feed_item
from core.sources.service import Availability, availability, get_sources
from core.sources.types import CompanyProperty, FeedItem, SourceChecks, SourceId, SourceStatus

log = logging.getLogger(__name__)
EVERY_CITY = "australia"


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
    settings in use (a run passes its own). None reads them from the database. `website` is kept
    for a later match by domain (TBC): the name and the city match today.
    """
    try:
        in_use = settings if settings is not None else await effective_settings(session)
        return await _lookup(session, name, city, in_use, run_id)
    except Exception:
        log.exception("sources_lookup_failed")
        return CompanyProperty(checked=SourceChecks(property_daily="error", arealytics="off"))


async def _lookup(
    session: AsyncSession,
    name: str,
    city: str | None,
    settings: Settings,
    run_id: uuid.UUID | None,
) -> CompanyProperty:
    key = clean_name(name)
    factory = async_sessionmaker(session.bind, expire_on_commit=False)
    async with factory() as own:
        last = await store.last_lookup(own, "property_daily", key)
    status: SourceStatus
    looked_up_at = last.looked_up_at if last else None
    if not settings.property_daily_enabled:
        status = "off"
    elif last is not None and datetime.now(UTC) - last.looked_up_at < timedelta(
        days=settings.property_lookup_days
    ):
        status = "found" if last.status == "found" else "not_found"
    else:
        status = await _live(factory, name, city, key, settings, run_id)
        if status in ("found", "not_found"):
            looked_up_at = datetime.now(UTC)
    async with factory() as own:
        records = await store.records_for(own, key, city)
    if status == "not_found" and records:
        status = "found"  # the feed brought this company's records in
    return CompanyProperty(
        records=records,
        checked=SourceChecks(property_daily=status, arealytics="off"),
        looked_up_at=looked_up_at,
    )


async def _live(
    factory: async_sessionmaker[AsyncSession],
    name: str,
    city: str | None,
    key: str,
    settings: Settings,
    run_id: uuid.UUID | None,
) -> SourceStatus:
    try:
        found = await get_sources().lookup(settings, name, city, run_id=run_id)
    except (DailyLimitReached, RunLimitReached):
        return "not_checked"
    except (SourceStopped, BrowserError):
        return "error"
    status: SourceStatus = "found" if found.found else "not_found"
    async with factory.begin() as own:
        await store.save_records(own, found.records, via="lookup")
        await store.save_lookup(
            own,
            source="property_daily",
            company_key=key,
            company=name,
            city=city,
            status=status,
            records=len(found.records),
            at=datetime.now(UTC),
            run_id=run_id,
        )
    return status


async def recent_items(
    session: AsyncSession, cities: Sequence[str] | None, since: datetime
) -> list[FeedItem]:
    """New feed items since `since` (a time with its zone), for these cities, newest first.

    `cities` None, empty, or holding "Australia" means every city. From our copy only.
    """
    every = not cities or any(city.strip().lower() == EVERY_CITY for city in cities)
    records = await store.recent_records(session, None if every else cities, since)
    today = datetime.now(UTC).date()
    return [as_feed_item(record, today) for record in records]


async def source_availability(
    session: AsyncSession, settings: Settings
) -> dict[SourceId, Availability]:
    """Each tool: switched on, ready to read, and why not (one sentence for the website)."""
    return await availability(session, settings)
