"""How many Claude requests may run at once, for the whole process.

One `ClaudeGate` is shared by every run, every endpoint and the command line, so the limit holds
across all of them. A request takes a place with `async with gate.acquire():` and gives it back
when the block ends, however it ends.

- The limit can change at any time (`set_limit`). Growing it lets waiting requests in at once.
  Shrinking it never stops a request that is already running: new requests wait until enough
  of the running ones are done.
- Requests are let in in the order they came.
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


class _Places:
    """What the gate keeps for one event loop: the places taken and the line of waiters."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.condition = asyncio.Condition()  # opened by the first request that waits
        self.in_flight = 0
        self.line: deque[object] = deque()  # one ticket for each request still waiting
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

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        """Waits for a place, holds it for the block, and gives it back at the end.

        Cancelling the wait is safe: no place is taken. A place is always given back, also when
        the block is cancelled.
        """
        places = self._places_for_this_loop()
        await self._enter(places)
        try:
            yield
        finally:
            # No await here, so a second cancel can't stop the place from coming back.
            places.in_flight -= 1
            self._wake(places)

    # --- Inside ----------------------------------------------------------------------------

    def _places_for_this_loop(self) -> _Places:
        loop = asyncio.get_running_loop()
        if self._places is None or self._places.loop is not loop:
            # First use, or the loop that made these places is gone. Whatever it held is gone too.
            self._places = _Places(loop)
        return self._places

    async def _enter(self, places: _Places) -> None:
        ticket = object()
        async with places.condition:
            places.line.append(ticket)
            try:
                await places.condition.wait_for(
                    lambda: places.line[0] is ticket and places.in_flight < self._limit
                )
                places.in_flight += 1
            finally:
                # Leave the line when the place is taken, and also when the wait is cancelled.
                # Either way the next in line must look again.
                places.line.remove(ticket)
                places.condition.notify_all()

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


def _checked(limit: int) -> int:
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError(f"The Claude limit must be a whole number of 1 or more, not {limit!r}")
    return limit
