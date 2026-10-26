"""Caps on spending. Code checks them before every Claude request; Claude can't raise them.

A request's cost is known only after it ends, and requests run side by side. So before each
web request the budget holds back a fixed amount of money (`request_reserve_usd`) and some
searches. It refuses a request unless everything spent, everything held and the new hold fit
under the cap. When the reply arrives, the hold is swapped for the real cost.

Two ways to ask for a hold:

- `reserve_request` answers at once: it takes the hold or raises BudgetSpent.
- `acquire_request` (async) waits while other requests are running, because their holds may
  shrink when they end. It raises only when nothing is running and the request still does not
  fit. Use this one when several requests start together.

Example with the default settings: the cap is $2.50, a hold is $0.80, and research starts four
angles at once. Three holds fit ($2.40). With `reserve_request` the fourth angle would be lost
on every company. With `acquire_request` it waits until two of the first three have ended
and cost less than their holds, then it runs.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from core.claude.client import Reply

log = logging.getLogger(__name__)


class BudgetSpent(Exception):
    """The cap is reached. The caller stops cleanly and marks what's left as unknown."""


@dataclass
class Budget:
    """The caps for researching one company.

    `request_reserve_usd` is the money held for each request in progress. Zero (the default)
    holds nothing, so callers that don't pass it behave as before.
    """

    cap_usd: Decimal
    max_searches: int
    request_reserve_usd: Decimal = Decimal(0)
    spent_usd: Decimal = Decimal(0)
    searches: int = 0
    _reserved: int = field(default=0, repr=False)
    _reserved_usd: Decimal = field(default=Decimal(0), repr=False)
    _waiters: list[asyncio.Future[None]] = field(default_factory=list, repr=False, compare=False)

    @property
    def reserved_usd(self) -> Decimal:
        """Money held for requests that are running now."""
        return self._reserved_usd

    @property
    def in_flight(self) -> bool:
        """True while some request holds searches (it has not been recorded or released)."""
        return self._reserved > 0

    def reserve_request(self, wanted_searches: int) -> int:
        """Call before a web request. Returns how many searches it may use (at least 1).

        It also holds `request_reserve_usd`. It raises BudgetSpent unless
        spent + held + this request's hold fits under the cap, or when no search is left.
        Nothing is held when it raises. It has no await, so requests started side by side
        take their holds one after the other.
        """
        refusal = self._refusal()
        if refusal is not None:
            raise BudgetSpent(refusal)
        return self._take(wanted_searches)

    async def acquire_request(self, wanted_searches: int) -> int:
        """Like `reserve_request`, but waits while other requests are running.

        When the hold does not fit yet and another request is in flight, this waits for one
        to be recorded or released and then looks again. It raises BudgetSpent only when the
        cap is already spent, or when nothing is in flight and it still does not fit (waiting
        longer could not help). Nothing is held when it raises or is cancelled.

        Every request that holds searches must end with `record` or `release`, in a `finally`,
        or a waiting request would wait for it forever.
        """
        while True:
            refusal = self._refusal()
            if refusal is None:
                return self._take(wanted_searches)
            if self.spent_usd >= self.cap_usd or not self.in_flight:
                raise BudgetSpent(refusal)
            waiter: asyncio.Future[None] = asyncio.get_running_loop().create_future()
            self._waiters.append(waiter)
            try:
                await waiter
            finally:
                if waiter in self._waiters:  # cancelled while waiting
                    self._waiters.remove(waiter)

    def reserve_searches(self, wanted: int) -> int:
        """The old name for reserve_request."""
        return self.reserve_request(wanted)

    def release(self, reserved: int) -> None:
        """Call when a request failed, so its reserved searches and money go back."""
        self._reserved -= reserved
        self._release_money(reserved)
        self._wake()

    def check(self) -> None:
        """Call before a request with no web search."""
        if self.spent_usd >= self.cap_usd:
            raise BudgetSpent(f"Spent ${self.spent_usd} of the ${self.cap_usd} cap")

    def record(
        self,
        reply: Reply[Any],
        reserved: int = 0,
        on_spend: Callable[[Reply[Any]], None] | None = None,
    ) -> None:
        """Call after a request, with what it reserved (0 if it reserved nothing).

        The hold goes back, the real cost and searches are added, and `on_spend(reply)` runs
        so a run can update its live totals. A failing callback is logged and never loses the
        record: the money is already spent.
        """
        self._reserved -= reserved
        self._release_money(reserved)
        self.spent_usd += reply.cost_usd
        self.searches += reply.usage.web_searches
        self._wake()
        if on_spend is not None:
            try:
                on_spend(reply)
            except Exception:
                log.exception("budget_on_spend_failed")

    def _refusal(self) -> str | None:
        """Why a new request does not fit right now, or None if it does."""
        if self.spent_usd >= self.cap_usd:
            return f"Spent ${self.spent_usd} of the ${self.cap_usd} cap"
        if self.spent_usd + self._reserved_usd + self.request_reserve_usd > self.cap_usd:
            return (
                f"No room under the ${self.cap_usd} cap for another request "
                f"(spent ${self.spent_usd}, ${self._reserved_usd} held for requests in "
                f"progress, ${self.request_reserve_usd} needed for this one)"
            )
        if self.max_searches - self.searches - self._reserved < 1:
            return f"Used all {self.max_searches} searches"
        return None

    def _take(self, wanted_searches: int) -> int:
        left = self.max_searches - self.searches - self._reserved  # at least 1 (see _refusal)
        granted = max(1, min(wanted_searches, left))
        self._reserved += granted
        self._reserved_usd += self.request_reserve_usd
        return granted

    def _wake(self) -> None:
        """Tell every waiting request to look again. Called whenever a hold ends."""
        waiters, self._waiters = self._waiters, []
        for waiter in waiters:
            if not waiter.done():
                waiter.set_result(None)

    def _release_money(self, reserved: int) -> None:
        # Only a request that reserved searches also holds money (see reserve_request).
        if reserved > 0:
            self._reserved_usd = max(Decimal(0), self._reserved_usd - self.request_reserve_usd)
