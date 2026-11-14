"""Reads one site's pages slowly, within its limits, and stops at the first block (PLAN-V16 T2-3).

For every page, in this order:
1. **One page at a time** for the site (a lock).
2. **Paused?** A site paused by a stop rule raises `SourcePaused` until its time is up or an Admin
   resumes it. Nothing is opened.
3. **Limits.** At most `per_day` pages a day (a Melbourne day) for the site, and `per_run` live
   pages for one run. Over a limit raises `DailyLimitReached` or `RunLimitReached`, before
   anything is opened.
4. **The pace.** A random pause of `wait_seconds` (like 4 to 9 seconds) since the last page.
5. **The page,** through the browser worker. Then the stop rules (`stops.classify`) say what it was.
6. **One row in the ledger** (`core.source_reads`): the kind of page, how it went, how long it
   took, the run. Never the page itself.
7. **What happens next.** A good page is returned. The sign-in page leads to one sign-in and one
   more try; the sign-in page again is a stop. A stop pauses the site for 24 hours and raises
   `SourcePaused`. A page that timed out or failed raises `PageProblem`.

The ledger is a protocol: `core.sources.store.DbLedger` keeps it in the database, and
`MemoryLedger` in memory (tests and fakes).
"""

import asyncio
import random
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from core.browser.sites import Site
from core.browser.stops import GOOD, STOPS, Outcome, Seen, classify, is_signin_page
from core.browser.worker import BrowserError, BrowserWorker, NotAllowed, PageTimeout
from core.config import Settings
from core.sources.types import SourceId

PAUSE = timedelta(hours=24)
DAY_ZONE = ZoneInfo("Australia/Melbourne")


@dataclass(frozen=True)
class Limits:
    wait_seconds: tuple[float, float]
    per_day: int
    per_run: int

    @classmethod
    def from_settings(cls, settings: Settings) -> "Limits":
        return cls(
            wait_seconds=settings.source_page_wait_seconds,
            per_day=settings.source_pages_per_day,
            per_run=settings.source_pages_per_run,
        )


@dataclass(frozen=True)
class Read:
    """One page a site served us: what kind, how it went, how long it took. Never its content."""

    source: SourceId
    kind: str
    outcome: Outcome
    ms: int
    at: datetime
    run_id: uuid.UUID | None = None

    @property
    def ok(self) -> bool:
        return self.outcome in GOOD


@dataclass(frozen=True)
class Pause:
    until: datetime
    reason: Outcome


class Ledger(Protocol):
    async def pause_state(self, source: SourceId) -> Pause | None: ...
    async def pages_since(self, source: SourceId, since: datetime) -> int: ...
    async def pages_in_run(self, source: SourceId, run_id: uuid.UUID) -> int: ...
    async def record(self, read: Read) -> None: ...
    async def pause(self, source: SourceId, reason: Outcome, until: datetime) -> None: ...
    async def problem(self, source: SourceId, outcome: Outcome, at: datetime) -> None: ...
    async def signed_in(self, source: SourceId, at: datetime) -> None: ...


class SourceStopped(Exception):
    """A page wasn't read. The reason is for the log and a fixed sentence, never raw text."""


class SourcePaused(SourceStopped):
    def __init__(self, reason: Outcome, until: datetime) -> None:
        self.reason = reason
        self.until = until
        super().__init__(f"paused until {until.isoformat()} ({reason})")


class DailyLimitReached(SourceStopped):
    pass


class RunLimitReached(SourceStopped):
    pass


class PageProblem(SourceStopped):
    def __init__(self, outcome: Outcome) -> None:
        self.outcome = outcome
        super().__init__(outcome)


SignIn = Callable[["SiteReader"], Awaitable[None]]


def start_of_day(moment: datetime) -> datetime:
    """Midnight in Melbourne, as a moment."""
    local = moment.astimezone(DAY_ZONE)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


class SiteReader:
    """Reads one site. Share one per site in a process, so the lock and the pace hold."""

    def __init__(
        self,
        site: Site,
        worker: BrowserWorker,
        ledger: Ledger,
        limits: Limits,
        *,
        sign_in: SignIn | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        rng: random.Random | None = None,
    ) -> None:
        self.site = site
        self.worker = worker
        self.ledger = ledger
        self.limits = limits
        self.sign_in = sign_in
        self.clock = clock
        self.rng = rng or random.Random()
        self.signed_in: bool | None = None  # None: not checked since this process started
        self._lock = asyncio.Lock()
        self._last_page: float | None = None

    async def page(self, url: str, *, kind: str, run_id: uuid.UUID | None = None) -> Seen:
        """One page of the site, signed in. Raises `SourceStopped` when it can't be read, and
        `NotAllowed` (before anything happens) for an address the site may not open."""
        if not self.site.may_open(url):
            raise NotAllowed(f"{self.site.id} may not open this address")
        async with self._lock:
            seen, outcome = await self._visit(
                lambda: self.worker.open(self.site, url), kind=kind, run_id=run_id
            )
            if outcome != "signin_page":
                return seen
            if self.sign_in is None:
                return await self._stop("signin_page")
            self.signed_in = False
            await self.sign_in(self)
            seen, outcome = await self._visit(
                lambda: self.worker.open(self.site, url), kind=kind, run_id=run_id
            )
            if outcome == "signin_page":
                return await self._stop("signin_twice")
            return seen

    async def submit(
        self, url: str, fields: Mapping[str, str], submit: str, *, kind: str = "signin"
    ) -> Seen:
        """Fills a form and sends it, for a connector's sign-in. Only from inside `sign_in`, which
        runs while `page` holds the lock. A sign-in that lands on the sign-in page again failed:
        a stop, so a wrong password is never tried over and over."""
        seen, outcome = await self._visit(
            lambda: self.worker.fill_and_submit(self.site, url, fields, submit), kind=kind
        )
        if outcome == "signin_page" or is_signin_page(seen, self.site):
            return await self._stop("signin_failed")
        now = self.clock()
        self.signed_in = True
        await self.ledger.signed_in(self.site.id, now)
        await self.worker.save_signed_in(self.site)
        return seen

    async def _visit(
        self,
        open_page: Callable[[], Awaitable[Seen]],
        *,
        kind: str,
        run_id: uuid.UUID | None = None,
    ) -> tuple[Seen, Outcome]:
        await self._may_read(run_id)
        await self._wait_for_the_pace()
        started = time.monotonic()
        try:
            seen = await open_page()
        except PageTimeout:
            await self._log(kind, "timeout", started, run_id)
            await self.ledger.problem(self.site.id, "timeout", self.clock())
            raise PageProblem("timeout") from None
        except BrowserError:
            await self._log(kind, "error", started, run_id)
            await self.ledger.problem(self.site.id, "error", self.clock())
            raise PageProblem("error") from None
        finally:
            self._last_page = time.monotonic()
        outcome = classify(seen, self.site)
        await self._log(kind, outcome, started, run_id)
        if outcome in STOPS:
            await self._stop(outcome)
        if outcome in ("timeout", "error"):
            await self.ledger.problem(self.site.id, outcome, self.clock())
            raise PageProblem(outcome)
        return seen, outcome

    async def _may_read(self, run_id: uuid.UUID | None) -> None:
        now = self.clock()
        paused = await self.ledger.pause_state(self.site.id)
        if paused is not None and paused.until > now:
            raise SourcePaused(paused.reason, paused.until)
        if await self.ledger.pages_since(self.site.id, start_of_day(now)) >= self.limits.per_day:
            raise DailyLimitReached(f"{self.limits.per_day} pages today")
        if run_id is not None:
            used = await self.ledger.pages_in_run(self.site.id, run_id)
            if used >= self.limits.per_run:
                raise RunLimitReached(f"{self.limits.per_run} pages in this run")

    async def _wait_for_the_pace(self) -> None:
        if self._last_page is None:
            return
        shortest, longest = self.limits.wait_seconds
        wanted = self.rng.uniform(shortest, longest)
        left = wanted - (time.monotonic() - self._last_page)
        if left > 0:
            await asyncio.sleep(left)

    async def _log(
        self, kind: str, outcome: Outcome, started: float, run_id: uuid.UUID | None
    ) -> None:
        ms = max(0, round((time.monotonic() - started) * 1000))
        await self.ledger.record(Read(self.site.id, kind, outcome, ms, self.clock(), run_id=run_id))

    async def _stop(self, reason: Outcome) -> Seen:
        """Pauses the site for 24 hours and raises. Typed to return, so callers can `return` it."""
        now = self.clock()
        until = now + PAUSE
        if reason in ("signin_page", "signin_failed", "signin_twice"):
            self.signed_in = False
        await self.ledger.pause(self.site.id, reason, until)
        await self.ledger.problem(self.site.id, reason, now)
        raise SourcePaused(reason, until)


@dataclass
class MemoryLedger:
    """The ledger in memory: for tests, the fake backend and a dry run."""

    reads: list[Read] = field(default_factory=list)
    pauses: dict[str, Pause] = field(default_factory=dict)
    problems: dict[str, tuple[Outcome, datetime]] = field(default_factory=dict)
    sign_ins: dict[str, datetime] = field(default_factory=dict)

    async def pause_state(self, source: SourceId) -> Pause | None:
        return self.pauses.get(source)

    async def pages_since(self, source: SourceId, since: datetime) -> int:
        return sum(1 for read in self.reads if read.source == source and read.at >= since)

    async def pages_in_run(self, source: SourceId, run_id: uuid.UUID) -> int:
        return sum(1 for read in self.reads if read.source == source and read.run_id == run_id)

    async def record(self, read: Read) -> None:
        self.reads.append(read)

    async def pause(self, source: SourceId, reason: Outcome, until: datetime) -> None:
        self.pauses[source] = Pause(until, reason)

    async def problem(self, source: SourceId, outcome: Outcome, at: datetime) -> None:
        self.problems[source] = (outcome, at)

    async def signed_in(self, source: SourceId, at: datetime) -> None:
        self.sign_ins[source] = at

    def resume(self, source: SourceId) -> None:
        self.pauses.pop(source, None)
