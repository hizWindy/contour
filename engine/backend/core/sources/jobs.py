"""The tools' schedule jobs (PLAN-V16 T2-7). Both are off until a person switches them on.

- `sources.property_daily.feed`: every working day at 6:15 am Melbourne time, it reads the daily
  emails since the last one read (1 page a day) and saves what is new.
- `sources.property_daily.lease_endings`: every Monday at 6:45 am, it reads the leases that end in
  12 to 36 months, for all of Australia (2 pages). It replaced the Arealytics job when Arealytics
  was dropped (15 Nov).

A job starts its work in the background and returns at once. It skips itself, with the reason in
plain words, while Property Daily is switched off, has no login, or is paused, on a weekend (the
feed), or while its last start is still running. Neither costs Claude money.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import time
from decimal import Decimal
from zoneinfo import ZoneInfo

from core.config import Settings
from core.prefs.service import effective_settings
from core.schedules.calc import Cadence
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSkipped,
    JobSpec,
)
from core.sources.service import Sources, availability, get_sources

log = logging.getLogger(__name__)

ZONE = ZoneInfo("Australia/Melbourne")
FEED = "sources.property_daily.feed"
LEASE_ENDINGS = "sources.property_daily.lease_endings"


async def _settings(context: JobContext) -> Settings:
    from core.db.engine import get_sessionmaker

    async with get_sessionmaker()() as session:
        return await effective_settings(session)


async def _ready_or_skip(settings: Settings) -> None:
    from core.db.engine import get_sessionmaker

    async with get_sessionmaker()() as session:
        found = (await availability(session, settings))["property_daily"]
    if not found.ready:
        raise JobSkipped(found.sentence or "Property Daily isn't ready.")


def _start(
    key: str, ref: str, work: Callable[[Sources, Settings], Awaitable[object]]
) -> Callable[[JobContext], Awaitable[JobResult]]:
    async def start(context: JobContext) -> JobResult:
        sources = get_sources()
        running = sources.tasks.get(key)
        if running is not None and not running.done():
            raise JobSkipped("Its last start is still running.")
        if key == FEED and context.now.astimezone(ZONE).weekday() >= 5:
            raise JobSkipped("It's the weekend: Property Daily sends no email today.")
        settings = await _settings(context)
        await _ready_or_skip(settings)

        async def run() -> object:
            try:
                return await work(sources, settings)
            except Exception:
                log.exception("sources_job_failed", extra={"job": key})
                return None

        sources.tasks[key] = asyncio.create_task(run(), name=key)
        return JobResult(ref=f"{ref}:{context.now.astimezone(ZONE).date().isoformat()}")

    return start


def _running(key: str) -> Callable[[JobContext], Awaitable[bool]]:
    async def running(context: JobContext) -> bool:
        task = get_sources().tasks.get(key)
        return task is not None and not task.done()

    return running


async def _free(context: JobContext) -> JobEstimate:
    zero = Decimal(0)
    return JobEstimate(
        valid=True,
        problem=None,
        typical_usd=zero,
        worst_usd=zero,
        cap_usd=zero,
        daily_left_usd=zero,
        basis=(
            "Reading Property Daily is free: Contour pays for it already, and asks Claude nothing."
        ),
    )


async def _feed(sources: Sources, settings: Settings) -> object:
    return await sources.feed(settings)


async def _lease_endings(sources: Sources, settings: Settings) -> object:
    return await sources.lease_endings(settings)


SOURCE_JOBS = (
    JobSpec(
        key=FEED,
        project="core",
        title="Read Property Daily's daily email",
        start=_start(FEED, "pd-feed", _feed),
        running=_running(FEED),
        estimate=_free,
        describe=lambda settings: "Reads the daily emails since the last one read, 1 page a day.",
        default=DefaultSchedule(
            cadence=Cadence(every=1, unit="days", at=time(6, 15)), enabled=False
        ),
    ),
    JobSpec(
        key=LEASE_ENDINGS,
        project="core",
        title="Read Property Daily's leases that end soon",
        start=_start(LEASE_ENDINGS, "pd-leases", _lease_endings),
        running=_running(LEASE_ENDINGS),
        estimate=_free,
        describe=lambda settings: (
            "Reads the leases of 500 m² and up that end in 12 to 36 "
            "months, for all of Australia: 2 pages."
        ),
        default=DefaultSchedule(
            cadence=Cadence(every=1, unit="weeks", weekday=0, at=time(6, 45)), enabled=False
        ),
    ),
)
