"""The money and company limits of one run. Pure asyncio: no database, no Claude.

Every research task holds money while it works (the company cap), and every discovery slice
holds the slice reserve. The run budget makes sure that what has been spent, plus what is held,
plus a new hold stays under the run cap.

The rule that matters: holds alone must never cause a false "cap reached". With a $20 cap and
$2.50 holds, the ninth company can't start while eight are running, but it can start once one
of them ends, because that one will almost always cost less than its hold. So `acquire` waits
while another hold is in flight, and says no only when nothing is in flight and the hold still
does not fit.

The usual order for one company is: take the research gate (a semaphore), then
`start_company`, then take a hold, work, and end the hold with its real cost in a `finally`:

    async with budget.hold(company_cap) as hold:
        if not hold:
            return  # the cap is used up
        ...work...
        hold.actual = cost  # what the work really cost

or, when a context manager does not fit:

    hold = await budget.acquire(company_cap)
    if hold:
        try:
            ...work...
        finally:
            hold.release(cost)

A `Hold` is a token. Ending it twice, or ending one that was never granted, frees nothing, so a
second `release` can never free money that another hold is keeping. Spending is counted when a
hold ends (the real cost goes into `spent`). The overshoot is at most the cost above a hold, so
spent + held stays under cap + overshoot.

`Hold.release` is not async on purpose: it must run in a `finally` while a task is being
cancelled, and it must never wait for anything.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal

log = logging.getLogger(__name__)


class Hold:
    """Money held for one piece of work. Made by `RunBudget.acquire`, never by hand.

    `bool(hold)` is True when the money was granted. A hold that was not granted can still be
    released: it frees nothing. `actual` is what the work really cost: set it as the cost becomes
    known, and `hold()` (the context manager) hands it to `release` when the block ends.
    """

    __slots__ = ("_budget", "_released", "actual", "amount", "granted")

    def __init__(self, budget: "RunBudget", amount: Decimal, granted: bool) -> None:
        self._budget = budget
        self._released = False
        self.amount = amount
        self.granted = granted
        self.actual = Decimal(0)

    def __bool__(self) -> bool:
        return self.granted

    def __repr__(self) -> str:
        state = "released" if self._released else "held" if self.granted else "refused"
        return f"Hold({self.amount}, {state})"

    @property
    def released(self) -> bool:
        return self._released

    def release(self, actual: Decimal | None = None) -> None:
        """End the hold and count what the work really cost (`actual`, else `self.actual`).

        Only the first call does anything. A second call frees nothing and counts nothing. A
        hold that was never granted frees nothing either (there was nothing held), but a cost
        reported on it is money that was really spent, so the first call counts it as spent.
        `actual` may be above the hold: the extra is the overshoot, and it counts as spent.
        """
        cost = self.actual if actual is None else actual
        if cost < 0:
            raise ValueError("actual can't be negative")
        if self._released:
            log.warning("run_budget_hold_released_twice")
            return
        self._released = True
        self.actual = cost
        if self.granted:
            self._budget._end(self, cost)
        elif cost > 0:
            self._budget.add_spend(cost)


class RunBudget:
    def __init__(
        self,
        cap_usd: Decimal,
        max_companies: int,
        spent: Decimal = Decimal(0),
        companies_started: int = 0,
    ) -> None:
        """`spent` starts at the cost already logged for the run (on start and on resume).

        On a resume it also holds the reserve of every company or slice that started and never
        finished, because the log may be missing what they spent. `companies_started` starts at
        the companies already begun, so a resume doesn't start more than `max_companies`.
        """
        if cap_usd < 0 or spent < 0:
            raise ValueError("cap_usd and spent can't be negative")
        if max_companies < 0 or companies_started < 0:
            raise ValueError("max_companies and companies_started can't be negative")
        self.cap_usd = cap_usd
        self.max_companies = max_companies
        self.spent = spent
        self.companies_started = companies_started
        self._reserved = Decimal(0)
        self._in_flight = 0
        self._waiters: list[asyncio.Future[None]] = []

    # --- Money --------------------------------------------------------------------------

    @property
    def reserved(self) -> Decimal:
        """Money held for work that is running now."""
        return self._reserved

    @property
    def in_flight(self) -> int:
        """How many holds are open (granted and not yet released)."""
        return self._in_flight

    @property
    def remaining(self) -> Decimal:
        """What can still be held: the cap, less what is spent and held. Never below zero."""
        return max(Decimal(0), self.cap_usd - self.spent - self._reserved)

    def fits(self, amount: Decimal) -> bool:
        """Would a hold of `amount` fit right now, with everything else as it is?"""
        return self.spent + self._reserved + amount <= self.cap_usd

    async def acquire(self, amount: Decimal) -> Hold:
        """Hold `amount` for a piece of work. The hold is true when it is granted, and a granted
        hold must be released.

        Waits while the hold doesn't fit and some other hold is still open, because that hold
        will shrink when it is released. The hold is false only when nothing is in flight and it
        still doesn't fit (waiting longer can't help). A task cancelled while waiting gets no
        hold at all: the cancel is raised here and nothing is held.
        """
        if amount < 0:
            raise ValueError("amount can't be negative")
        while True:
            if self.fits(amount):
                self._reserved += amount
                self._in_flight += 1
                return Hold(self, amount, granted=True)
            if self._in_flight == 0:
                return Hold(self, amount, granted=False)
            waiter: asyncio.Future[None] = asyncio.get_running_loop().create_future()
            self._waiters.append(waiter)
            try:
                await waiter
            finally:
                if waiter in self._waiters:  # cancelled while waiting
                    self._waiters.remove(waiter)

    @asynccontextmanager
    async def hold(self, amount: Decimal) -> AsyncIterator[Hold]:
        """`acquire`, and the release when the block ends, however it ends (an error or a cancel
        too). The block gets the hold: check it (`if not hold`), and set `hold.actual` to the real
        cost. A task cancelled while it waits for the hold never enters the block."""
        held = await self.acquire(amount)
        try:
            yield held
        finally:
            held.release()

    def _end(self, hold: Hold, actual: Decimal) -> None:
        """Take a granted hold's money back and count what the work cost. Called once by
        `Hold.release`."""
        self._reserved -= hold.amount
        self._in_flight -= 1
        self.spent += actual
        self._wake()

    def add_spend(self, amount: Decimal) -> None:
        """Count money spent outside any hold (for example the cost found again on a resume)."""
        if amount < 0:
            raise ValueError("amount can't be negative")
        self.spent += amount
        self._wake()

    # --- Companies ----------------------------------------------------------------------

    @property
    def companies_left(self) -> int:
        return max(0, self.max_companies - self.companies_started)

    def start_company(self) -> bool:
        """Count one more company as started. False when `max_companies` is reached."""
        if self.companies_started >= self.max_companies:
            return False
        self.companies_started += 1
        return True

    # --- Waking -------------------------------------------------------------------------

    def _wake(self) -> None:
        """Tell every waiting task to look again. Each looks, and takes its hold or waits."""
        waiters, self._waiters = self._waiters, []
        for waiter in waiters:
            if not waiter.done():
                waiter.set_result(None)
