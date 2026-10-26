"""The event bus of the run engine: saves each event of a run, and sends it to everyone watching.

One bus lives in each run manager. It owns three things:

- **Order.** Each run has one `asyncio.Lock` and a counter. `emit` takes the lock, adds 1 to the
  counter (it is read from the database once, the first time the run is used), saves the event
  in a FRESH session and commits, and only then puts the event in every watcher's queue. So an
  event is never sent before it is saved, and two tasks emitting for the same run always get
  different numbers (1, 2, 3 ... with no gap). If saving fails or is cut off by a cancel, the
  counter is forgotten and read from the database again, so it can never repeat a number.
- **Replay.** `subscribe` takes the same lock, reads the saved events after a number and
  registers a queue in one step, so no event is lost or repeated between the replay and the
  live part. The stream skips any live event whose number it has already given.
- **Limits.** A queue holds 1000 events. A watcher whose queue is full is dropped (its stream
  ends after what it already has, and the browser comes back with `Last-Event-ID` and replays).
  One run has at most 10 watchers and the whole bus 50 (Problem 429, code `too_many_watchers`).

A stream ends only when its replay is used up, its queue is empty, the run is not active in this
process AND the run's saved status is final at that moment. A `run_finished` met during the replay
is plain history: a run that was resumed afterwards is active again, and the stream goes on.

`emit_in_transaction` lets a caller change the run's row (its status or totals) in the SAME
transaction as the event, under the same lock. The final status and `run_finished` use it, so a
reader never sees one without the other.
"""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.runs.models import TERMINAL_RUN_STATUSES, Run
from core.runs.models import RunEvent as RunEventRow
from core.runs.schemas import RunEvent, build_event, event_data

log = logging.getLogger(__name__)

MAX_WATCHERS_PER_RUN = 10
MAX_WATCHERS = 50
QUEUE_SIZE = 1000

# Builds the data of an event inside the transaction that saves it. Returns None for "no event".
type EventBuilder = Callable[[AsyncSession], Awaitable[BaseModel | None]]


class _Channel:
    """What the bus keeps for one run."""

    __slots__ = ("lock", "seq", "streams")

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.seq: int | None = None  # the last number given; None: read it from the database
        self.streams: set[RunEventStream] = set()


def _to_event(row: RunEventRow) -> RunEvent:
    # Always UTC, so a replayed event and the live one are the same JSON text.
    return build_event(row.seq, row.type, row.data, row.created_at.astimezone(UTC))


class RunEventStream:
    """One watcher's view of a run: the saved events after a number, then the live ones.

    It is registered when `EventBus.subscribe` returns it, before the first `__anext__`. Call
    `aclose()` when you stop early. That unregisters it, also when it was never read, so a stream
    that was made and dropped can't use up a watcher slot. It also unregisters itself when it ends.
    """

    def __init__(
        self,
        bus: "EventBus",
        channel: _Channel,
        run_id: UUID,
        replay: list[RunEvent],
        after_seq: int,
    ) -> None:
        self._bus = bus
        self._channel = channel
        self._run_id = run_id
        self._replay = replay
        self._next = 0
        self._last = after_seq  # the highest number given so far
        self._queue: asyncio.Queue[RunEvent | None] = asyncio.Queue(maxsize=bus.queue_size)
        self._closed = False
        self._dropped = False  # the queue was full: no more live events come

    @property
    def last_seq(self) -> int:
        """The number of the last event given (the `after_seq` it started from, if none yet)."""
        return self._last

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def dropped(self) -> bool:
        """True when this watcher was dropped for being too slow."""
        return self._dropped

    def __aiter__(self) -> "RunEventStream":
        return self

    async def __anext__(self) -> RunEvent:
        while True:
            if self._closed:
                raise StopAsyncIteration
            if self._next < len(self._replay):
                event = self._replay[self._next]
                self._next += 1
                self._last = max(self._last, event.seq)
                return event
            if self._queue.empty() and (self._dropped or await self._bus.run_is_over(self._run_id)):
                await self.aclose()
                raise StopAsyncIteration
            item = await self._queue.get()
            if item is None:  # a nudge: look again at whether the run is over
                continue
            if item.seq <= self._last:  # already given by the replay
                continue
            self._last = item.seq
            return item

    async def aclose(self) -> None:
        """Stops this watcher and gives its slot back. Safe to call twice, or from `finally`."""
        self._closed = True
        self._bus._unregister(self)
        self._nudge()  # wakes a reader that is waiting for the next event

    # --- Called by the bus --------------------------------------------------------------

    def _offer(self, event: RunEvent) -> None:
        if self._closed or self._dropped:
            return
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            self._dropped = True  # it reconnects with Last-Event-ID and replays what it missed
            self._bus._unregister(self)
            log.warning("run_watcher_dropped", extra={"run_id": str(self._run_id)})

    def _nudge(self) -> None:
        # A full queue means the reader has events to read first, and looks again after them.
        with contextlib.suppress(asyncio.QueueFull):
            self._queue.put_nowait(None)


class EventBus:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        is_active: Callable[[UUID], bool],
        max_per_run: int = MAX_WATCHERS_PER_RUN,
        max_total: int = MAX_WATCHERS,
        queue_size: int = QUEUE_SIZE,
    ) -> None:
        """`is_active(run_id)` says whether a run is going in this process (the manager's)."""
        self.session_factory = session_factory
        self._is_active = is_active
        self.max_per_run = max_per_run
        self.max_total = max_total
        self.queue_size = queue_size
        self._channels: dict[UUID, _Channel] = {}
        self._watchers = 0

    # --- Writing --------------------------------------------------------------------------

    def _channel(self, run_id: UUID) -> _Channel:
        channel = self._channels.get(run_id)
        if channel is None:
            channel = self._channels[run_id] = _Channel()
        return channel

    async def emit(self, run_id: UUID, type: str, data: BaseModel) -> RunEvent:
        """Saves one event and sends it to every watcher. `data` must be the model of `type`.

        Raises ValueError for an unknown type and TypeError for the wrong model, before anything
        is saved.
        """

        async def same(_: AsyncSession) -> BaseModel:
            return data

        event = await self.emit_in_transaction(run_id, type, same)
        assert event is not None
        return event

    async def emit_in_transaction(
        self, run_id: UUID, type: str, build: EventBuilder
    ) -> RunEvent | None:
        """`emit`, where `build(session)` runs first, in the same transaction and under the same
        lock, and gives the data of the event. Use it to change the run's row together with the
        event. `build` returns None to save no event (what it did to the session is committed).

        If `build` raises, nothing is saved.
        """
        channel = self._channel(run_id)
        async with channel.lock:
            try:
                if channel.seq is None:
                    channel.seq = await self._stored_last_seq(run_id)
                async with self.session_factory() as session:
                    data = await build(session)
                    if data is None:
                        await session.commit()
                        return None
                    seq = channel.seq + 1
                    payload = event_data(type, data)
                    event = _stamp(seq, type, payload)
                    session.add(
                        RunEventRow(
                            run_id=run_id,
                            seq=seq,
                            type=type,
                            data=payload,
                            created_at=event.created_at,
                        )
                    )
                    await session.commit()
            except BaseException:
                # Unknown: saved or not (a cancel can land in the middle of the commit). The next
                # emit reads the real last number, so a number is never used twice.
                channel.seq = None
                raise
            channel.seq = seq
            for stream in list(channel.streams):
                stream._offer(event)
            return event

    async def _stored_last_seq(self, run_id: UUID) -> int:
        async with self.session_factory() as session:
            last = await session.scalar(
                select(func.coalesce(func.max(RunEventRow.seq), 0)).where(
                    RunEventRow.run_id == run_id
                )
            )
        return int(last or 0)

    # --- Reading --------------------------------------------------------------------------

    async def last_seq(self, run_id: UUID) -> int:
        """The highest saved number of a run (0 if it has no events)."""
        return await self._stored_last_seq(run_id)

    async def run_state(self, run_id: UUID) -> tuple[str, int] | None:
        """The run's saved status and its last event number, or None for an unknown run."""
        async with self.session_factory() as session:
            status = await session.scalar(select(Run.status).where(Run.id == run_id))
            if status is None:
                return None
            last = await session.scalar(
                select(func.coalesce(func.max(RunEventRow.seq), 0)).where(
                    RunEventRow.run_id == run_id
                )
            )
        return status, int(last or 0)

    async def run_is_over(self, run_id: UUID) -> bool:
        """True when the run is not going in this process and its saved status is final."""
        if self._is_active(run_id):
            return False
        async with self.session_factory() as session:
            status = await session.scalar(select(Run.status).where(Run.id == run_id))
        return status is None or status in TERMINAL_RUN_STATUSES

    # --- Watching -------------------------------------------------------------------------

    def _check_room(self, run_id: UUID) -> None:
        channel = self._channels.get(run_id)
        for_run = len(channel.streams) if channel is not None else 0
        if for_run >= self.max_per_run or self._watchers >= self.max_total:
            raise Problem(
                429,
                "Too many people are watching",
                "Close another window that shows this run, then try again.",
                code="too_many_watchers",
            )

    async def subscribe(self, run_id: UUID, after_seq: int = 0) -> RunEventStream:
        """Registers a watcher. The saved events after `after_seq` come first, then the live ones.

        Raises Problem 404 for an unknown run and 429 (`too_many_watchers`) when it is full.
        """
        async with self.session_factory() as session:
            known = await session.scalar(select(Run.id).where(Run.id == run_id))
        if known is None:
            raise Problem(404, "Run not found", "There is no run with this id.")
        self._check_room(run_id)  # a cheap early no, before the lock
        channel = self._channel(run_id)
        async with channel.lock:  # no event is saved while the tail is read and the queue added
            async with self.session_factory() as session:
                rows = (
                    await session.scalars(
                        select(RunEventRow)
                        .where(RunEventRow.run_id == run_id, RunEventRow.seq > after_seq)
                        .order_by(RunEventRow.seq)
                    )
                ).all()
            replay: list[RunEvent] = []
            for row in rows:
                try:
                    replay.append(_to_event(row))
                except ValidationError:
                    log.warning(
                        "run_event_unreadable", extra={"run_id": str(run_id), "seq": row.seq}
                    )
            # The check and the registration are one step (no await between them).
            self._check_room(run_id)
            stream = RunEventStream(self, channel, run_id, replay, after_seq)
            channel.streams.add(stream)
            self._watchers += 1
        return stream

    def _unregister(self, stream: RunEventStream) -> None:
        channel = stream._channel
        if stream in channel.streams:
            channel.streams.discard(stream)
            self._watchers -= 1

    @property
    def watchers(self) -> int:
        """Every watcher on the bus."""
        return self._watchers

    def watchers_of(self, run_id: UUID) -> int:
        channel = self._channels.get(run_id)
        return len(channel.streams) if channel is not None else 0

    def wake(self, run_id: UUID) -> None:
        """Tells the watchers of a run to look again at whether it is over. Call it after the run
        has left the manager's active list."""
        channel = self._channels.get(run_id)
        if channel is not None:
            for stream in list(channel.streams):
                stream._nudge()

    def close(self) -> None:
        """Ends every stream (the backend is stopping). Browsers reconnect when it is back."""
        for channel in self._channels.values():
            for stream in list(channel.streams):
                stream._closed = True
                self._unregister(stream)
                stream._nudge()


def _stamp(seq: int, type: str, payload: dict[str, Any]) -> RunEvent:
    """The typed event for a saved payload, made now. It is checked through the union, so what
    is saved is always something the log and the stream can read back."""
    return build_event(seq, type, payload, datetime.now(UTC))
