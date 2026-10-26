"""The daily limit: how much Claude may cost in any 24 hours, across every run and request.

Before every Claude request, `DailyCap.reserve()` adds up

    what the search log says was spent in the last 24 hours (core.searches.cost_usd)
  + what this process has spent but not logged yet
  + the money held for requests that are running now (`request_reserve_usd` each)
  + the hold for this request

and refuses (`DailyLimitReached`) when the total would pass the cap. The cap is `daily_cap_usd`,
which only .env can change. Every road to Claude goes through the shared client, so runs, the
`/research` endpoint, re-checks and the command line are all covered.

Two details keep the sum honest:
- A request's cost is known only when it ends, and the caller writes it to the search log some
  time later (research logs a company's requests together, at the end). In between, the cost
  sits in a small list in memory (`note_spent`). Each entry leaves the list when its row shows
  up in the log, which is matched by the API's request id, so nothing is counted twice or lost.
- The total from the database is kept for a few seconds, so a burst of requests asks once. The
  holds and the list in memory are exact at every moment: only rows written by another process
  (the command line) can be a few seconds late.
"""

import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.claude.budget import BudgetSpent
from core.claude.client import ClaudeError, ClaudeUnavailable
from core.searches.models import SearchLog

log = logging.getLogger(__name__)

WINDOW = timedelta(hours=24)
CACHE_SECONDS = 3.0  # how long the total from the database is reused
NO_ID_SECONDS = 15 * 60  # an unlogged cost with no request id is kept this long, then dropped
MAX_UNLOGGED = 5000  # the most costs kept in memory while they wait for their log row
CENT = Decimal("0.01")

type SessionOpener = Callable[[], AbstractAsyncContextManager[AsyncSession]]


class DailyLimitReached(BudgetSpent, ClaudeError):
    """The daily limit would be passed, so the request was not sent.

    It is a `BudgetSpent`, like every cap, so code that stops a run cleanly on a cap sees it.
    It is also a `ClaudeError`, so older code that shows a Claude error (the /research
    endpoint, the command line) shows this plain message instead of failing.
    """

    def __init__(self, *, cap: Decimal, spent: Decimal, held: Decimal, needed: Decimal) -> None:
        super().__init__(
            "Claude's daily limit is reached",
            f"US${spent:.2f} was spent in the last 24 hours, and US${held:.2f} is held for "
            f"requests in progress. One more request holds US${needed:.2f}, and the limit is "
            f"US${cap:.2f}. Wait for older spending to leave the 24 hours, or raise "
            "DAILY_CAP_USD in engine/.env and restart.",
        )
        self.cap = cap
        self.spent = spent
        self.held = held


@dataclass
class _Unlogged:
    """The cost of a finished request whose search-log row has not been seen yet."""

    cost: Decimal
    request_id: str | None
    at: float  # the cap's clock when it ended


async def read_spent(
    session: AsyncSession, request_ids: list[str] | None = None
) -> tuple[Decimal, set[str]]:
    """What the search log holds for the last 24 hours, and which of `request_ids` it has.

    One statement, so the total and the matches come from the same moment.
    """
    ids = [item for item in (request_ids or []) if item]
    total = func.coalesce(func.sum(SearchLog.cost_usd), 0)
    window = SearchLog.created_at > func.now() - WINDOW
    if not ids:
        only = (await session.execute(select(total).where(window))).one()
        return Decimal(only[0]), set()
    found = func.array_agg(SearchLog.request_id).filter(SearchLog.request_id.in_(ids))
    both = (await session.execute(select(total, found).where(window))).one()
    return Decimal(both[0]), {item for item in (both[1] or ()) if item}


class DailyCap:
    """The process-wide daily limit. One is shared by every request (see `claude_holder`)."""

    def __init__(
        self,
        session_factory: SessionOpener,
        daily_cap_usd: Decimal,
        request_reserve_usd: Decimal = Decimal("0.80"),
        *,
        cache_seconds: float = CACHE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """`session_factory()` opens a session for one short read. It is called for every refresh,
        and never while a request is waiting for the Claude gate."""
        self._session_factory = session_factory
        self._cap_usd = _positive(daily_cap_usd, "daily_cap_usd")
        self._reserve_usd = _not_negative(request_reserve_usd, "request_reserve_usd")
        self._cache_seconds = cache_seconds
        self._clock = clock
        self._held = Decimal(0)
        self._in_flight = 0
        self._unlogged: list[_Unlogged] = []
        self._total = Decimal(0)  # the log's total at the last refresh
        self._fetched_at: float | None = None
        self._started = 0  # refreshes started, so an older answer never replaces a newer one
        self._applied = 0

    # --- What it is ------------------------------------------------------------------------

    @property
    def cap_usd(self) -> Decimal:
        return self._cap_usd

    @property
    def request_reserve_usd(self) -> Decimal:
        return self._reserve_usd

    @property
    def held_usd(self) -> Decimal:
        """Money held for the requests running now."""
        return self._held

    @property
    def in_flight(self) -> int:
        return self._in_flight

    def configure(
        self,
        *,
        daily_cap_usd: Decimal | None = None,
        request_reserve_usd: Decimal | None = None,
    ) -> None:
        """Changes the cap or the hold. It applies to the next request. Holds already taken
        keep the amount they took."""
        if daily_cap_usd is not None:
            self._cap_usd = _positive(daily_cap_usd, "daily_cap_usd")
        if request_reserve_usd is not None:
            self._reserve_usd = _not_negative(request_reserve_usd, "request_reserve_usd")

    # --- Asking ----------------------------------------------------------------------------

    async def spent_usd(
        self, *, session: AsyncSession | None = None, fresh: bool = False
    ) -> Decimal:
        """Spent in the last 24 hours: the log, plus what this process has not logged yet.

        It does not include the holds. `session` is used for the read when given (otherwise the
        cap opens its own). `fresh` skips the few-seconds cache.
        """
        await self._refresh(session, fresh)
        return self._spent_now()

    async def remaining(
        self, *, session: AsyncSession | None = None, fresh: bool = False
    ) -> Decimal:
        """What is left of the cap: the cap, less what was spent and what is held. Never below 0."""
        await self._refresh(session, fresh)
        return max(Decimal(0), self._cap_usd - self._spent_now() - self._held)

    @asynccontextmanager
    async def reserve(self) -> AsyncIterator[None]:
        """Holds money for one request for the length of the block.

        Raises `DailyLimitReached` when the hold would pass the cap (nothing is held then). Raises
        `ClaudeUnavailable` when the log can't be read: with no way to check, nothing is sent.
        """
        await self._refresh(None, False)
        # No await from here to the hold: two requests can't both take the last room.
        amount = self._reserve_usd
        spent = self._spent_now()
        if spent + self._held + amount > self._cap_usd:
            raise DailyLimitReached(cap=self._cap_usd, spent=spent, held=self._held, needed=amount)
        self._held += amount
        self._in_flight += 1
        try:
            yield
        finally:
            self._held -= amount
            self._in_flight -= 1

    async def has_room(self) -> bool:
        """True when what is spent and held (this request's hold included) is within the cap.

        For a request that is already running and wants to go on (a paused turn): it asks
        whether another round is still allowed. It does not hold anything.
        """
        await self._refresh(None, False)
        return self._spent_now() + self._held <= self._cap_usd

    def note_spent(self, cost: Decimal, request_id: str | None) -> None:
        """Records what a finished request cost, until its row shows up in the search log.

        The shared client calls this when a request ends. Call it before the hold ends, with
        no await between, so the money is never in neither place.
        """
        if cost <= 0:
            return
        self._unlogged.append(_Unlogged(cost, request_id, self._clock()))
        if len(self._unlogged) > MAX_UNLOGGED:
            del self._unlogged[: len(self._unlogged) - MAX_UNLOGGED]

    # --- Inside ----------------------------------------------------------------------------

    def _spent_now(self) -> Decimal:
        return self._total + sum((item.cost for item in self._unlogged), Decimal(0))

    async def _refresh(self, session: AsyncSession | None, fresh: bool) -> None:
        started_at = self._clock()
        if (
            not fresh
            and self._fetched_at is not None
            and started_at - self._fetched_at < self._cache_seconds
        ):
            return
        self._started += 1
        number = self._started
        ids = [item.request_id for item in self._unlogged if item.request_id]
        try:
            if session is not None:
                total, seen = await read_spent(session, ids)
            else:
                async with self._session_factory() as own:
                    total, seen = await read_spent(own, ids)
        except Exception as error:
            # The reason (the driver's text) stays out of the message: it can name the server.
            log.warning("daily_limit_unreadable", extra={"error": type(error).__name__})
            raise ClaudeUnavailable(
                "Can't check the daily limit",
                "The database didn't answer, so the daily Claude limit can't be checked and "
                "nothing was sent. Try again when the database is back.",
            ) from error
        if number < self._applied:
            return  # a refresh that began later has already been applied
        self._applied = number
        self._total = total
        self._fetched_at = started_at
        now = self._clock()
        self._unlogged = [
            item
            for item in self._unlogged
            if not (item.request_id and item.request_id in seen) and not _too_old(item, now)
        ]


def _too_old(item: _Unlogged, now: float) -> bool:
    age = now - item.at
    return age > WINDOW.total_seconds() or (item.request_id is None and age > NO_ID_SECONDS)


def _positive(value: Decimal, name: str) -> Decimal:
    if not value > 0:
        raise ValueError(f"{name} must be more than 0, not {value}")
    return value


def _not_negative(value: Decimal, name: str) -> Decimal:
    if value < 0:
        raise ValueError(f"{name} can't be negative, not {value}")
    return value


def whole_cents(value: Decimal) -> Decimal:
    """Rounded DOWN to the cent, so a "left" figure is never more than what is really left."""
    return value.quantize(CENT, rounding=ROUND_DOWN)
