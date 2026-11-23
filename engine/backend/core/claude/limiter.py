"""How many Claude requests may run at once, for the whole process.

There are three lanes (PLAN-V26 T1-1): People, Runs and Jobs, each with a `ClaudeGate` of its own,
so a request in one lane never waits for another lane. `ClaudeLanes` picks the lane from who
started the work (`core.work`). One set of lanes is shared by every run, every endpoint and the
command line. A request takes a place with `async with lanes.acquire():` and gives it back when
the block ends, however it ends.

- The limit can change at any time (`set_limit`). Growing it lets waiting requests in at once.
  Shrinking it never stops a request that is already running: new requests wait until enough
  of the running ones are done.
- Requests are let in in the order they came, except that a request whose work is `behind`
  (PLAN-V27 choice 20) lets every other request in its line go first, and a work with `most`
  never holds more places than that: its next request waits without holding up the line.
- A request that is cancelled while it waits takes no place, and does not stop the ones behind it.
- The gate keeps nothing that belongs to one event loop until a request asks for a place, and it
  starts again from nothing when the next request comes from another loop. So one gate can serve
  the app, and also several tests that each run in their own loop. It is for one running loop at
  a time, not for several threads.
"""

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Final

from core import work
from core.work import LANES, Lane

# A wait is shown once it is longer than this (PLAN-V26 choice 4, TBC).
WAIT_SHOWN_AFTER_SECONDS: Final = 1.0


@dataclass(frozen=True, slots=True, eq=False)
class _Ticket:
    key: str | None  # the work that asks (`core.work.Work.key`)
    since: float  # the loop's clock when it joined the line
    behind: bool = False  # lets the others go first (`core.work.Work.behind`)
    most: int | None = None  # the most places this work holds at once


class _Places:
    """What the gate keeps for one event loop: the places taken and the line of waiters."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.condition = asyncio.Condition()  # opened by the first request that waits
        self.in_flight = 0
        self.line: deque[_Ticket] = deque()  # one ticket for each request still waiting
        self.holding: list[str | None] = []  # the key of each request that holds a place
        self.wakers: set[asyncio.Task[None]] = set()  # keeps the wake-up tasks alive


class ClaudeGate:
    def __init__(self, limit: int = 2) -> None:
        self._limit = _checked(limit)
        self._places: _Places | None = None

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def in_flight(self) -> int:
        """Requests holding a place now."""
        return self._places.in_flight if self._places is not None else 0

    @property
    def waiting(self) -> int:
        """Requests waiting for a place now."""
        return len(self._places.line) if self._places is not None else 0

    def set_limit(self, limit: int) -> None:
        """Changes how many requests may run at once (1 or more). It never raises or waits.

        It applies to the next request. Requests that already hold a place keep it.
        """
        self._limit = _checked(limit)
        if self._places is not None:
            self._wake(self._places)  # a bigger limit may let waiting requests in

    def ahead(self, key: str, *, waited: float = WAIT_SHOWN_AFTER_SECONDS) -> int | None:
        """How many requests must end before this work's next one starts.

        None when the work isn't waiting: it holds a place, it isn't in the line, or it has
        waited less than `waited` seconds.
        """
        places = self._places
        if places is None or places.loop.is_closed() or key in places.holding:
            return None
        for index, ticket in enumerate(places.line):
            if ticket.key == key:
                if places.loop.time() - ticket.since < waited:
                    return None
                return max(1, places.in_flight + index + 1 - self._limit)
        return None

    @asynccontextmanager
    async def acquire(
        self, key: str | None = None, *, behind: bool = False, most: int | None = None
    ) -> AsyncIterator[None]:
        """Waits for a place, holds it for the block, and gives it back at the end. `key` names
        the work, for `ahead`. `behind` and `most`: see the module text.

        Cancelling the wait is safe: no place is taken. A place is always given back, also when
        the block is cancelled.
        """
        places = self._places_for_this_loop()
        await self._enter(places, _Ticket(key, places.loop.time(), behind, most))
        try:
            yield
        finally:
            # No await here, so a second cancel can't stop the place from coming back.
            places.in_flight -= 1
            places.holding.remove(key)
            self._wake(places)

    # --- Inside ----------------------------------------------------------------------------

    def _places_for_this_loop(self) -> _Places:
        loop = asyncio.get_running_loop()
        if self._places is None or self._places.loop is not loop:
            # First use, or the loop that made these places is gone. Whatever it held is gone too.
            self._places = _Places(loop)
        return self._places

    async def _enter(self, places: _Places, ticket: _Ticket) -> None:
        async with places.condition:
            if ticket.behind:
                places.line.append(ticket)
            else:  # before the first ticket that lets others go first
                at = next((i for i, t in enumerate(places.line) if t.behind), len(places.line))
                places.line.insert(at, ticket)
            try:
                await places.condition.wait_for(lambda: self._next(places) is ticket)
                places.in_flight += 1
                places.holding.append(ticket.key)
            finally:
                # Leave the line when the place is taken, and also when the wait is cancelled.
                # Either way the next in line must look again.
                places.line.remove(ticket)
                places.condition.notify_all()

    def _next(self, places: _Places) -> _Ticket | None:
        """The ticket that takes the next free place: the first in line whose work holds fewer
        places than its `most`. None when no place is free."""
        if places.in_flight >= self._limit:
            return None
        for ticket in places.line:
            if ticket.most is None or places.holding.count(ticket.key) < ticket.most:
                return ticket
        return None

    def _wake(self, places: _Places) -> None:
        """Tells the waiting requests to look again. Called when a place frees or the limit grows.

        It can't wait for the condition's lock (it runs where a cancel may land), so it starts a
        small task that does. With nobody waiting there is nothing to do.
        """
        if not places.line or places.loop.is_closed():
            return
        try:
            here: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            here = None
        if here is places.loop:
            self._start_waker(places)
        else:
            places.loop.call_soon_threadsafe(self._start_waker, places)

    @staticmethod
    def _start_waker(places: _Places) -> None:
        async def notify() -> None:
            async with places.condition:
                places.condition.notify_all()

        task = places.loop.create_task(notify())
        places.wakers.add(task)
        task.add_done_callback(places.wakers.discard)


class ClaudeLanes:
    """The three lanes, each with its own places and its own line."""

    def __init__(self, *, people: int = 4, runs: int = 2, jobs: int = 1) -> None:
        sizes: dict[Lane, int] = {"people": people, "runs": runs, "jobs": jobs}
        self._gates = {lane: ClaudeGate(sizes[lane]) for lane in LANES}

    def __getitem__(self, lane: Lane) -> ClaudeGate:
        return self._gates[lane]

    def set_limits(self, *, people: int, runs: int, jobs: int) -> None:
        self._gates["people"].set_limit(people)
        self._gates["runs"].set_limit(runs)
        self._gates["jobs"].set_limit(jobs)

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        """A place in the lane of the work that asks."""
        now = work.current()
        async with self._gates[now.lane].acquire(now.key, behind=now.behind, most=now.most):
            yield

    def ahead(self, key: str) -> int | None:
        """`ClaudeGate.ahead`, in whichever lane this work waits."""
        waits = (gate.ahead(key) for gate in self._gates.values())
        return next((ahead for ahead in waits if ahead is not None), None)


def _checked(limit: int) -> int:
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError(f"The Claude limit must be a whole number of 1 or more, not {limit!r}")
    return limit
