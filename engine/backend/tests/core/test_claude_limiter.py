"""The Claude gate: how many requests run at once, across the whole process."""

import asyncio

import pytest

from core.claude.limiter import ClaudeGate


async def finished(*tasks: "asyncio.Task[None]") -> None:
    """Waits for tasks to end. A gate that lost a wake-up would wait for ever, so this gives up."""
    async with asyncio.timeout(5):
        await asyncio.gather(*tasks)


async def settle() -> None:
    """Lets every task that can run, run, until all of them are waiting for something."""
    for _ in range(10):
        await asyncio.sleep(0)


class Holder:
    """A request that takes a place, says so, and keeps it until it is told to leave."""

    def __init__(self, gate: ClaudeGate, name: str, entered: list[str]) -> None:
        self.name = name
        self.leave = asyncio.Event()
        self.task = asyncio.create_task(self._run(gate, entered))

    async def _run(self, gate: ClaudeGate, entered: list[str]) -> None:
        async with gate.acquire():
            entered.append(self.name)
            await self.leave.wait()


async def test_a_gate_lets_in_no_more_than_its_limit() -> None:
    gate = ClaudeGate(2)
    running = peak = 0

    async def request() -> None:
        nonlocal running, peak
        async with gate.acquire():
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.01)
            running -= 1

    await asyncio.gather(*(request() for _ in range(8)))
    assert peak == 2
    assert (gate.in_flight, gate.waiting) == (0, 0)


async def test_requests_are_let_in_in_the_order_they_came() -> None:
    gate = ClaudeGate(1)
    entered: list[str] = []
    holders = []
    for name in "abcde":
        holders.append(Holder(gate, name, entered))
        await settle()
    assert entered == ["a"]
    assert (gate.in_flight, gate.waiting) == (1, 4)
    for holder in holders:
        holder.leave.set()
        await settle()
    assert entered == list("abcde")
    assert (gate.in_flight, gate.waiting) == (0, 0)


async def test_a_gate_of_three_holds_three_and_the_rest_wait() -> None:
    gate = ClaudeGate(3)
    entered: list[str] = []
    holders = [Holder(gate, str(n), entered) for n in range(5)]
    await settle()
    assert entered == ["0", "1", "2"]
    assert (gate.in_flight, gate.waiting) == (3, 2)
    holders[0].leave.set()
    await settle()
    assert entered == ["0", "1", "2", "3"]
    for holder in holders:
        holder.leave.set()
    await finished(*(holder.task for holder in holders))
    assert gate.in_flight == 0


# --- A limit that changes ------------------------------------------------------------------


async def test_shrinking_the_limit_never_stops_a_request_that_is_running() -> None:
    gate = ClaudeGate(3)
    entered: list[str] = []
    running = [Holder(gate, f"old{n}", entered) for n in range(3)]
    await settle()
    assert gate.in_flight == 3

    gate.set_limit(1)
    newcomers = [Holder(gate, f"new{n}", entered) for n in range(2)]
    await settle()
    assert gate.limit == 1
    assert not any(holder.task.done() for holder in running)  # nobody was cancelled
    assert (gate.in_flight, gate.waiting) == (3, 2)  # the new ones wait

    running[0].leave.set()
    running[1].leave.set()
    await settle()
    assert entered == ["old0", "old1", "old2"]  # one is still running, which fills the limit of 1
    assert gate.in_flight == 1

    running[2].leave.set()
    await settle()
    assert entered[3:] == ["new0"]  # now one new request, and only one
    assert (gate.in_flight, gate.waiting) == (1, 1)
    newcomers[0].leave.set()
    await settle()
    assert entered[4:] == ["new1"]
    newcomers[1].leave.set()
    await finished(*(holder.task for holder in [*running, *newcomers]))
    assert gate.in_flight == 0


async def test_growing_the_limit_lets_waiting_requests_in_at_once() -> None:
    gate = ClaudeGate(1)
    entered: list[str] = []
    holders = [Holder(gate, str(n), entered) for n in range(4)]
    await settle()
    assert (entered, gate.waiting) == (["0"], 3)

    gate.set_limit(3)
    await settle()
    assert entered == ["0", "1", "2"]
    assert (gate.in_flight, gate.waiting) == (3, 1)
    for holder in holders:
        holder.leave.set()
    await finished(*(holder.task for holder in holders))


async def test_a_limit_set_from_a_thread_still_wakes_the_waiting_requests() -> None:
    """The settings can change from code that is not inside the loop."""
    gate = ClaudeGate(1)
    entered: list[str] = []
    holders = [Holder(gate, str(n), entered) for n in range(3)]
    await settle()
    assert entered == ["0"]
    await asyncio.to_thread(gate.set_limit, 3)
    await settle()
    assert entered == ["0", "1", "2"]
    for holder in holders:
        holder.leave.set()
    await finished(*(holder.task for holder in holders))


@pytest.mark.parametrize("bad", [0, -1, 1.5, "2", None, True])
def test_the_limit_is_a_whole_number_of_one_or_more(bad: object) -> None:
    gate = ClaudeGate(2)
    with pytest.raises(ValueError, match="whole number"):
        gate.set_limit(bad)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="whole number"):
        ClaudeGate(bad)  # type: ignore[arg-type]
    assert gate.limit == 2  # a refused change leaves the limit as it was


def test_the_limit_can_change_before_any_event_loop_exists() -> None:
    gate = ClaudeGate()
    assert gate.limit == 2
    gate.set_limit(4)
    assert (gate.limit, gate.in_flight, gate.waiting) == (4, 0, 0)


# --- Cancelling ----------------------------------------------------------------------------


async def test_a_request_cancelled_while_it_waits_takes_no_place() -> None:
    gate = ClaudeGate(1)
    entered: list[str] = []
    first = Holder(gate, "first", entered)
    await settle()
    second = Holder(gate, "second", entered)
    third = Holder(gate, "third", entered)
    await settle()
    assert gate.waiting == 2

    second.task.cancel()
    await settle()
    assert second.task.cancelled()
    assert (gate.in_flight, gate.waiting) == (1, 1)

    first.leave.set()
    await settle()
    assert entered == ["first", "third"]  # the cancelled one left no gap in the line
    third.leave.set()
    await finished(third.task)
    assert (gate.in_flight, gate.waiting) == (0, 0)


async def test_a_request_cancelled_just_after_it_was_called_in_does_not_lose_the_next_turn() -> (
    None
):
    """The place was freed and the first in line was woken, then cancelled before it ran. The
    request behind it must still get the place."""
    gate = ClaudeGate(1)
    entered: list[str] = []
    holder = Holder(gate, "holder", entered)
    await settle()
    head = Holder(gate, "head", entered)
    behind = Holder(gate, "behind", entered)
    await settle()

    # Both happen before the loop runs again: the holder leaves and the head is cancelled, so
    # the head is woken for a place it can no longer take.
    holder.leave.set()
    head.task.cancel()
    await finished(holder.task)
    await settle()
    assert head.task.cancelled()
    assert entered == ["holder", "behind"]
    assert gate.in_flight == 1
    behind.leave.set()
    await finished(behind.task)
    assert gate.in_flight == 0


async def test_a_request_cancelled_while_it_holds_a_place_gives_it_back() -> None:
    gate = ClaudeGate(1)
    entered: list[str] = []
    holder = Holder(gate, "holder", entered)
    waiting = Holder(gate, "waiting", entered)
    await settle()
    assert gate.in_flight == 1

    holder.task.cancel()
    await settle()
    assert holder.task.cancelled()
    assert entered == ["holder", "waiting"]  # the place came back, and the next one took it
    waiting.leave.set()
    await finished(waiting.task)
    assert gate.in_flight == 0


async def test_an_error_inside_the_block_gives_the_place_back() -> None:
    gate = ClaudeGate(1)
    with pytest.raises(RuntimeError, match="boom"):
        async with gate.acquire():
            raise RuntimeError("boom")
    assert gate.in_flight == 0
    async with gate.acquire():  # the place is free again
        assert gate.in_flight == 1


async def test_many_cancels_at_random_moments_never_lose_a_place() -> None:
    """A rough shake: tasks start, wait and are cancelled at different moments. The gate must
    end with nothing held and nobody waiting, and still serve a request."""
    gate = ClaudeGate(2)

    async def request(delay: float) -> None:
        async with gate.acquire():
            await asyncio.sleep(delay)

    tasks = [asyncio.create_task(request(0.001 * (n % 4))) for n in range(60)]
    for n, task in enumerate(tasks):
        await asyncio.sleep(0.0005 * (n % 3))
        if n % 3 == 0:
            task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    assert (gate.in_flight, gate.waiting) == (0, 0)
    async with asyncio.timeout(2), gate.acquire():
        assert gate.in_flight == 1


# --- Event loops ---------------------------------------------------------------------------


def run_in_a_new_loop(gate: ClaudeGate, requests: int) -> int:
    """`requests` requests on a gate of limit 1 in a loop of their own. Returns the peak."""

    async def main() -> int:
        running = peak = 0

        async def request() -> None:
            nonlocal running, peak
            async with gate.acquire():
                running += 1
                peak = max(peak, running)
                await asyncio.sleep(0.005)
                running -= 1

        await asyncio.gather(*(request() for _ in range(requests)))
        return peak

    return asyncio.run(main())


def test_one_gate_works_in_two_event_loops_one_after_the_other() -> None:
    """Tests (and the app, if it is ever restarted in-process) run each in a new loop. A gate that
    kept a Condition from the first loop would raise "bound to a different event loop"."""
    gate = ClaudeGate(1)
    assert run_in_a_new_loop(gate, 3) == 1
    assert run_in_a_new_loop(gate, 3) == 1
    assert run_in_a_new_loop(gate, 3) == 1
    assert gate.in_flight == 0


def test_a_loop_that_ended_with_a_request_still_inside_leaves_the_gate_usable() -> None:
    gate = ClaudeGate(1)
    entered: list[str] = []

    async def abandon() -> None:
        Holder(gate, "left behind", entered)  # takes the only place, and never leaves
        await settle()
        assert gate.in_flight == 1
        # The loop closes with the request still inside (asyncio.run cancels it).

    asyncio.run(abandon())
    assert run_in_a_new_loop(gate, 2) == 1  # the second loop is not stuck behind a dead one
    assert gate.in_flight == 0


def test_a_late_release_from_a_finished_loop_does_not_free_a_place_in_the_next_one() -> None:
    """The place count belongs to the loop that made it, so a late release can't corrupt another."""
    gate = ClaudeGate(1)
    late = gate.acquire()

    async def take_and_forget() -> None:
        await late.__aenter__()  # a place in the first loop, never given back inside it

    asyncio.run(take_and_forget())

    async def second_loop() -> None:
        async with gate.acquire():
            assert gate.in_flight == 1
            await late.__aexit__(None, None, None)  # the first loop's request ends, late
            assert gate.in_flight == 1  # this loop's place is untouched
        assert gate.in_flight == 0

    asyncio.run(second_loop())
