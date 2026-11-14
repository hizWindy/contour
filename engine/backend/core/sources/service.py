"""The tools as the backend uses them (PLAN-V16 T2-7, T2-8).

One `Sources` for the process: one browser worker, and one `SiteReader` for Property Daily (so its
lock and its pace hold across every caller). Every step that reads a page goes through it: the
lookups in the research, the two jobs, the Admin's "Check now" and the commands.

`availability` says, for each tool, whether it is switched on and ready to read, and if not, why,
in one fixed sentence for the website. Arealytics is never ready: it has no connector (its site
refused automated access, and Al-khair dropped it from PLAN-V16 on 15 Nov).
"""

import asyncio
import contextlib
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.browser.reader import Limits, SiteReader, start_of_day
from core.browser.stops import Seen
from core.browser.worker import BrowserWorker
from core.config import Settings
from core.sources import store
from core.sources.property_daily.pages import property_daily_pages
from core.sources.property_daily.read import (
    Lookup,
    lookup,
    read_feed,
    read_lease_endings,
    signer,
)
from core.sources.types import SourceId

log = logging.getLogger(__name__)
ZONE = ZoneInfo("Australia/Melbourne")

AREALYTICS_SENTENCE = "Arealytics isn't connected: it refused automated access."
OFF_SENTENCE = "Property Daily is switched off. An Admin can switch it on."
NO_LOGIN_SENTENCE = "Property Daily has no login yet. An Admin needs to add one."


@dataclass(frozen=True)
class Availability:
    on: bool
    ready: bool
    sentence: str | None  # why it isn't ready, for a person. None when ready


def when_words(moment: datetime) -> str:
    local = moment.astimezone(ZONE)
    clock = local.strftime("%I:%M %p").lstrip("0").replace("AM", "am").replace("PM", "pm")
    return f"{clock}, {local.day} {local:%b}"


async def availability(session: AsyncSession, settings: Settings) -> dict[SourceId, Availability]:
    """Each tool: on, ready, and why not. Free: it reads the settings and one row."""
    found: dict[SourceId, Availability] = {
        "arealytics": Availability(on=False, ready=False, sentence=AREALYTICS_SENTENCE)
    }
    if not settings.property_daily_enabled:
        found["property_daily"] = Availability(False, False, OFF_SENTENCE)
    elif settings.property_daily_username is None or settings.property_daily_password is None:
        found["property_daily"] = Availability(True, False, NO_LOGIN_SENTENCE)
    else:
        state = await store.get_state(session, "property_daily")
        until = state.paused_until if state else None
        if until is not None and until > datetime.now(UTC):
            sentence = (
                f"Property Daily is paused until {when_words(until)}, after the site showed a "
                "block. An Admin can resume it."
            )
            found["property_daily"] = Availability(True, False, sentence)
        else:
            found["property_daily"] = Availability(True, True, None)
    return found


@dataclass(frozen=True)
class FeedDone:
    new_records: int
    last_day: date | None


class Sources:
    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self.factory = factory
        self.worker: BrowserWorker | None = None
        self._reader: SiteReader | None = None
        self.tasks: dict[str, asyncio.Task[object]] = {}

    def property_daily(self, settings: Settings) -> SiteReader:
        """The one reader for Property Daily, with today's limits and login."""
        pages = property_daily_pages()
        if self.worker is None:
            self.worker = BrowserWorker(channel=settings.browser_channel)
        if self._reader is None:
            self._reader = SiteReader(
                pages.as_site(),
                self.worker,
                store.DbLedger(self.factory),
                Limits.from_settings(settings),
                sign_in=signer(settings, pages),
            )
        else:
            self._reader.limits = Limits.from_settings(settings)
            self._reader.sign_in = signer(settings, pages)
        return self._reader

    @property
    def signed_in(self) -> bool | None:
        return self._reader.signed_in if self._reader is not None else None

    async def check(self, settings: Settings) -> Seen:
        """Opens the home page, signing in if it asks: a free check that the login works."""
        return await self.property_daily(settings).page(
            property_daily_pages().pages.home, kind="check"
        )

    async def lookup(
        self, settings: Settings, name: str, city: str | None, *, run_id: uuid.UUID | None = None
    ) -> Lookup:
        return await lookup(
            self.property_daily(settings),
            property_daily_pages(),
            name,
            city,
            read_at=datetime.now(UTC),
            run_id=run_id,
        )

    async def feed(self, settings: Settings) -> FeedDone:
        """Reads the daily emails since the last one read, and saves what is new."""
        async with self.factory() as session:
            after = await store.last_feed_day(session, "property_daily")
        today = datetime.now(ZONE).date()
        read = await read_feed(
            self.property_daily(settings),
            property_daily_pages(),
            after=after,
            today=today,
            read_at=datetime.now(UTC),
        )
        async with self.factory.begin() as session:
            new = await store.save_records(session, read.records, via="feed")
        log.info("sources_feed_read", extra={"new_records": new, "last_day": str(read.last_day)})
        return FeedDone(new_records=new, last_day=read.last_day)

    async def lease_endings(self, settings: Settings) -> int:
        """Reads the leases that end in 12 to 36 months, and saves what is new."""
        kept = await read_lease_endings(
            self.property_daily(settings),
            property_daily_pages(),
            today=datetime.now(ZONE).date(),
            read_at=datetime.now(UTC),
        )
        async with self.factory.begin() as session:
            new = await store.save_records(session, kept, via="lease_endings")
        log.info("sources_lease_endings_read", extra={"new_records": new})
        return new

    async def pages_today(self, session: AsyncSession, source: SourceId) -> int:
        return await store.pages_since(session, source, start_of_day(datetime.now(UTC)))

    async def close(self) -> None:
        for task in self.tasks.values():
            task.cancel()
        for task in self.tasks.values():
            with contextlib.suppress(BaseException):
                await task
        if self.worker is not None:
            await self.worker.close()


_SOURCES: Sources | None = None


def get_sources() -> Sources:
    """The process's one `Sources`, on the app's database."""
    global _SOURCES
    if _SOURCES is None:
        from core.db.engine import get_sessionmaker

        _SOURCES = Sources(get_sessionmaker())
    return _SOURCES


def set_sources(sources: Sources | None) -> None:
    """For tests: put a `Sources` in place (or take it away)."""
    global _SOURCES
    _SOURCES = sources


async def close_sources() -> None:
    """At the backend's shutdown: stops the jobs and closes the browser."""
    global _SOURCES
    if _SOURCES is not None:
        await _SOURCES.close()
        _SOURCES = None
