"""The event bus: numbering, saving, replay plus live, limits, and when a stream ends.

Integration: every event is saved in the test database before it is sent.
"""

import asyncio
import uuid
from typing import Any

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.runs.events import EventBus
from core.runs.manager import RunManager
from core.runs.models import Run
from core.runs.models import RunEvent as RunEventRow
from core.runs.schemas import (
    CompanyStartedData,
    RunCounts,
    RunEvent,
    RunProblemData,
    dump_event,
)
from core.runs.types import EventStream, make_caps
from tests.core.runs_fakes import (
    APP,
    FakeState,
    small_settings,
    stored_events,
    stored_json,
    wait_for_status,
    wait_until_idle,
)

pytestmark = pytest.mark.integration


async def new_run(factory: async_sessionmaker[AsyncSession], status: str = "running") -> uuid.UUID:
    run_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            Run(
                id=run_id,
                app=APP,
                mode="work",
                status=status,
                params={},
                caps=make_caps(small_settings()).model_dump(mode="json"),
                rules_version="",
                prompt_versions="",
                counts=RunCounts().model_dump(mode="json"),
            )
        )
        await session.commit()
    return run_id


async def set_status(
    factory: async_sessionmaker[AsyncSession], run_id: uuid.UUID, status: str
) -> None:
    async with factory() as session:
        await session.execute(update(Run).where(Run.id == run_id).values(status=status))
        await session.commit()


def problem(text: str) -> RunProblemData:
    return RunProblemData(message=text)


async def take(stream: EventStream, count: int) -> list[RunEvent]:
    found: list[RunEvent] = []
    async with asyncio.timeout(10):
        while len(found) < count:
            found.append(await anext(stream))
    return found


async def read_all(stream: EventStream) -> list[RunEvent]:
    async with asyncio.timeout(10):
        return [event async for event in stream]


class Active:
    """What the manager tells the bus: which runs are going in this process."""

    def __init__(self) -> None:
        self.ids: set[uuid.UUID] = set()

    def __call__(self, run_id: uuid.UUID) -> bool:
        return run_id in self.ids


@pytest.fixture
def active() -> Active:
    return Active()


@pytest.fixture
def bus(session_factory: async_sessionmaker[AsyncSession], active: Active) -> EventBus:
    return EventBus(session_factory, is_active=active)


# --- Numbering and saving ---------------------------------------------------------------------


async def test_events_are_numbered_from_one_and_saved_before_they_are_sent(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run_id = await new_run(session_factory)
    first = await bus.emit(run_id, "problem", problem("one"))
    second = await bus.emit(run_id, "company_started", CompanyStartedData(name="Acme"))
    assert (first.seq, second.seq) == (1, 2)
    saved = await stored_json(session_factory, run_id)
    assert saved == [dump_event(first), dump_event(second)]


async def test_two_tasks_emitting_at_once_get_every_number_once(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run_id = await new_run(session_factory)

    async def burst(label: str) -> None:
        for number in range(200):
            await bus.emit(run_id, "problem", problem(f"{label} {number}"))

    await asyncio.gather(burst("a"), burst("b"))
    seqs = [event.seq for event in await stored_events(session_factory, run_id)]
    assert seqs == list(range(1, 401))


async def test_a_new_bus_carries_on_from_the_saved_numbers(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    run_id = await new_run(session_factory)
    for text in ("a", "b", "c"):
        await bus.emit(run_id, "problem", problem(text))
    after_restart = EventBus(session_factory, is_active=active)
    assert (await after_restart.emit(run_id, "problem", problem("d"))).seq == 4


async def test_a_wrong_type_or_model_saves_nothing(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run_id = await new_run(session_factory)
    with pytest.raises(ValueError, match="Unknown event type"):
        await bus.emit(run_id, "gossip", problem("x"))
    with pytest.raises(TypeError, match="needs a"):
        await bus.emit(run_id, "company_started", problem("x"))
    assert await stored_events(session_factory, run_id) == []
    assert (await bus.emit(run_id, "problem", problem("ok"))).seq == 1  # no number was used up


async def test_a_build_that_fails_saves_nothing_and_uses_no_number(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run_id = await new_run(session_factory)
    await bus.emit(run_id, "problem", problem("one"))

    async def broken(session: AsyncSession) -> Any:
        await session.execute(update(Run).where(Run.id == run_id).values(status="done"))
        raise RuntimeError("half way")

    with pytest.raises(RuntimeError):
        await bus.emit_in_transaction(run_id, "problem", broken)
    async with session_factory() as session:
        assert await session.scalar(select(Run.status).where(Run.id == run_id)) == "running"
    assert (await bus.emit(run_id, "problem", problem("two"))).seq == 2


async def test_a_build_that_returns_none_commits_its_change_but_saves_no_event(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run_id = await new_run(session_factory)

    async def change_only(session: AsyncSession) -> None:
        await session.execute(update(Run).where(Run.id == run_id).values(status="done"))

    assert await bus.emit_in_transaction(run_id, "run_finished", change_only) is None
    async with session_factory() as session:
        assert await session.scalar(select(Run.status).where(Run.id == run_id)) == "done"
    assert await stored_events(session_factory, run_id) == []


# --- Replay and live ----------------------------------------------------------------------------


async def test_a_watcher_gets_the_saved_events_then_the_live_ones_with_no_gap(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    run_id = await new_run(session_factory)
    active.ids.add(run_id)
    for number in range(3):
        await bus.emit(run_id, "problem", problem(f"saved {number}"))

    stream = await bus.subscribe(run_id, after_seq=1)
    replayed = await take(stream, 2)
    await bus.emit(run_id, "problem", problem("live"))
    (live,) = await take(stream, 1)

    assert [event.seq for event in [*replayed, live]] == [2, 3, 4]
    await stream.aclose()


async def test_replay_equals_live(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    run_id = await new_run(session_factory)
    active.ids.add(run_id)
    stream = await bus.subscribe(run_id)
    for number in range(5):
        await bus.emit(run_id, "problem", problem(str(number)))
    live = await take(stream, 5)
    await stream.aclose()
    active.ids.discard(run_id)
    await set_status(session_factory, run_id, "done")
    replay = await read_all(await bus.subscribe(run_id))
    assert [dump_event(e) for e in replay] == [dump_event(e) for e in live]


async def test_a_watcher_that_reconnects_mid_burst_misses_and_repeats_nothing(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    run_id = await new_run(session_factory)
    active.ids.add(run_id)

    async def burst(label: str) -> None:
        for number in range(200):
            await bus.emit(run_id, "problem", problem(f"{label} {number}"))

    writers = asyncio.gather(burst("a"), burst("b"))
    first = await bus.subscribe(run_id)
    seen = await take(first, 50)
    await first.aclose()
    second = await bus.subscribe(run_id, after_seq=seen[-1].seq)
    await writers
    active.ids.discard(run_id)
    await set_status(session_factory, run_id, "done")
    bus.wake(run_id)
    seen += await read_all(second)
    assert [event.seq for event in seen] == list(range(1, 401))


async def test_a_run_finished_in_the_replay_does_not_end_a_run_that_is_going_again(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    from core.runs.schemas import RunFinishedData

    run_id = await new_run(session_factory)
    finished = RunFinishedData(
        status="interrupted", stop_reason="stopped", cost_usd=0, counts=RunCounts()
    )
    await bus.emit(run_id, "run_finished", finished)  # history: it was interrupted once
    active.ids.add(run_id)  # and now it is resumed
    stream = await bus.subscribe(run_id)
    assert [event.type for event in await take(stream, 1)] == ["run_finished"]
    await bus.emit(run_id, "problem", problem("after the resume"))
    (live,) = await take(stream, 1)
    assert live.seq == 2
    await stream.aclose()


async def test_a_stream_ends_only_when_the_run_is_not_going_and_its_status_is_final(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    run_id = await new_run(session_factory)
    await bus.emit(run_id, "problem", problem("one"))
    active.ids.add(run_id)
    stream = await bus.subscribe(run_id)
    await take(stream, 1)
    waiting = asyncio.ensure_future(anext(stream))
    await asyncio.sleep(0.1)
    assert not waiting.done()  # going: it waits for more

    active.ids.discard(run_id)
    bus.wake(run_id)
    await asyncio.sleep(0.1)
    assert not waiting.done()  # not going here, but the saved status is still `running`

    await set_status(session_factory, run_id, "done")
    bus.wake(run_id)
    with pytest.raises(StopAsyncIteration):
        async with asyncio.timeout(5):
            await waiting
    assert stream.closed
    assert bus.watchers_of(run_id) == 0


async def test_an_unknown_run_is_a_404(bus: EventBus) -> None:
    with pytest.raises(Problem) as caught:
        await bus.subscribe(uuid.uuid4())
    assert caught.value.status == 404


# --- Limits ---------------------------------------------------------------------------------------


async def test_ten_watchers_per_run_and_fifty_in_all(
    session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    bus = EventBus(session_factory, is_active=active, max_per_run=2, max_total=3)
    one, two = await new_run(session_factory), await new_run(session_factory)
    streams = [await bus.subscribe(one), await bus.subscribe(one)]
    with pytest.raises(Problem) as per_run:
        await bus.subscribe(one)
    assert (per_run.value.status, per_run.value.code) == (429, "too_many_watchers")
    streams.append(await bus.subscribe(two))
    with pytest.raises(Problem) as in_all:
        await bus.subscribe(two)
    assert in_all.value.status == 429
    assert bus.watchers == 3

    await streams[0].aclose()  # never read: closing still gives the slot back
    await streams[0].aclose()  # twice is fine
    assert bus.watchers == 2
    streams.append(await bus.subscribe(one))
    assert EventBus(session_factory, is_active=active).max_per_run == 10
    assert EventBus(session_factory, is_active=active).max_total == 50


async def test_a_watcher_too_slow_to_keep_up_is_dropped_and_replays_later(
    session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    bus = EventBus(session_factory, is_active=active, queue_size=3)
    run_id = await new_run(session_factory)
    active.ids.add(run_id)
    slow = await bus.subscribe(run_id)
    for number in range(6):  # the emitter never waits for the watcher
        await bus.emit(run_id, "problem", problem(str(number)))

    assert slow.dropped
    assert bus.watchers_of(run_id) == 0
    got = await read_all(slow)  # what it had, then the end
    assert [event.seq for event in got] == [1, 2, 3]
    again = await bus.subscribe(run_id, after_seq=got[-1].seq)  # the browser comes back
    assert [event.seq for event in await take(again, 3)] == [4, 5, 6]
    await again.aclose()


async def test_closing_the_bus_ends_every_stream(
    bus: EventBus, session_factory: async_sessionmaker[AsyncSession], active: Active
) -> None:
    run_id = await new_run(session_factory)
    active.ids.add(run_id)
    stream = await bus.subscribe(run_id)
    bus.close()
    assert await read_all(stream) == []
    assert bus.watchers == 0


# --- Through the manager ------------------------------------------------------------------------


async def test_a_watcher_of_a_whole_run_sees_what_was_saved(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "block", {})
    await fakes.entered.wait()
    stream = await run_manager.subscribe(run.id)
    fakes.gate.set()
    seen = await read_all(stream)  # it ends by itself after run_finished
    assert [dump_event(e) for e in seen] == await stored_json(session_factory, run.id)
    assert seen[-1].type == "run_finished"
    assert run_manager.events.watchers == 0


async def test_many_events_from_two_tasks_are_numbered_without_a_gap(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    run = await run_manager.start(APP, "many", {"units": 200})
    await wait_for_status(session_factory, run.id, "done")
    await wait_until_idle(run_manager)
    events = await stored_events(session_factory, run.id)
    assert [event.seq for event in events] == list(range(1, len(events) + 1))
    problems = [event for event in events if event.type == "problem"]
    assert len(problems) == 400


async def test_stream_is_over_only_for_a_finished_run_with_nothing_left(
    run_manager: RunManager, session_factory: async_sessionmaker[AsyncSession], fakes: FakeState
) -> None:
    run = await run_manager.start(APP, "block", {})
    await fakes.entered.wait()
    assert not await run_manager.stream_is_over(run.id, 10_000)  # going
    fakes.gate.set()
    await wait_until_idle(run_manager)
    async with session_factory() as session:
        last = await session.scalar(
            select(RunEventRow.seq)
            .where(RunEventRow.run_id == run.id)
            .order_by(RunEventRow.seq.desc())
        )
    assert last is not None
    assert not await run_manager.stream_is_over(run.id, last - 1)
    assert await run_manager.stream_is_over(run.id, last)
    with pytest.raises(Problem) as unknown:
        await run_manager.stream_is_over(uuid.uuid4(), 0)
    assert unknown.value.status == 404
