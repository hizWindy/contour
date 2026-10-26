"""RunBudget: holds that wait instead of failing, and a cap that is never passed by much."""

import asyncio
import random
from decimal import Decimal

import pytest

from core.runs.budget import Hold, RunBudget

D = Decimal
HOLD = D("2.50")  # a company's cap, as in the default settings


async def settle() -> None:
    """Lets every other task run until it waits again."""
    for _ in range(5):
        await asyncio.sleep(0)


def test_it_starts_from_the_logged_spend() -> None:
    budget = RunBudget(D("20"), 5, spent=D("3.25"), companies_started=2)
    assert budget.spent == D("3.25")
    assert budget.reserved == D(0)
    assert budget.remaining == D("16.75")
    assert budget.companies_started == 2
    assert budget.companies_left == 3


def test_it_refuses_negative_numbers() -> None:
    with pytest.raises(ValueError):
        RunBudget(D("-1"), 5)
    with pytest.raises(ValueError):
        RunBudget(D("1"), -5)
    with pytest.raises(ValueError):
        RunBudget(D("1"), 5, spent=D("-1"))


def test_what_remains_is_never_below_zero() -> None:
    """A run that spent more than its cap has nothing left. It is zero, not a negative number."""
    over = RunBudget(D("5"), 5, spent=D("6.25"))
    assert over.remaining == D(0)
    exact = RunBudget(D("5"), 5, spent=D("5"))
    assert exact.remaining == D(0)
    just_under = RunBudget(D("5"), 5, spent=D("4.99"))
    assert just_under.remaining == D("0.01")


async def test_what_remains_counts_holds_and_is_zero_when_they_pass_the_cap() -> None:
    budget = RunBudget(D("5"), 20)
    first = await budget.acquire(HOLD)
    second = await budget.acquire(HOLD)
    assert budget.remaining == D(0)  # the two holds fill the cap exactly
    first.release(D("4.00"))  # it cost more than its hold: 4.00 spent + 2.50 held is 6.50
    assert budget.spent + budget.reserved == D("6.50")
    assert budget.remaining == D(0)  # not -1.50
    second.release(D("0"))
    assert budget.remaining == D("1.00")


async def test_a_hold_that_fits_is_taken_at_once() -> None:
    budget = RunBudget(D("20"), 5)
    hold = await budget.acquire(HOLD)
    assert hold.granted is True
    assert bool(hold) is True
    assert hold.amount == HOLD
    assert budget.reserved == HOLD
    assert budget.in_flight == 1
    assert budget.remaining == D("17.50")


async def test_release_swaps_the_hold_for_the_real_cost() -> None:
    budget = RunBudget(D("20"), 5)
    hold = await budget.acquire(HOLD)
    hold.release(D("0.90"))
    assert hold.released is True
    assert budget.reserved == D(0)
    assert budget.in_flight == 0
    assert budget.spent == D("0.90")


async def test_a_hold_waits_while_another_is_in_flight_and_is_not_a_false_cap_reached() -> None:
    """Eight holds fill a 20 dollar cap. The ninth waits for two to end, and then runs."""
    budget = RunBudget(D("20"), 20)
    holds = [await budget.acquire(HOLD) for _ in range(8)]
    assert all(holds)
    assert budget.reserved == D("20.00")

    ninth = asyncio.create_task(budget.acquire(HOLD))
    await settle()
    assert not ninth.done()  # it waits. It does not say "cap reached".

    holds[0].release(D("1.00"))  # 1.00 spent + 17.50 held + 2.50 is 21.00: still no room
    await settle()
    assert not ninth.done()

    holds[1].release(D("1.00"))  # 2.00 spent + 15.00 held + 2.50 is 19.50: it fits
    async with asyncio.timeout(2):
        assert await ninth
    assert budget.in_flight == 7
    assert budget.spent == D("2.00")
    assert budget.reserved == D("17.50")


async def test_it_says_no_only_when_nothing_is_in_flight() -> None:
    budget = RunBudget(D("5"), 20, spent=D("4.00"))
    refused = await budget.acquire(HOLD)  # nothing in flight, and 1.00 is left
    assert refused.granted is False
    assert not refused
    assert budget.reserved == D(0)
    assert budget.in_flight == 0


async def test_a_waiting_hold_gets_no_when_the_holds_ahead_of_it_end_with_no_room_freed() -> None:
    budget = RunBudget(D("5"), 20)
    first = await budget.acquire(HOLD)
    second = await budget.acquire(HOLD)  # the cap is full of holds
    assert first
    assert second
    third = asyncio.create_task(budget.acquire(HOLD))
    await settle()
    assert not third.done()

    first.release(D("2.50"))  # it cost its whole hold: no room is freed
    await settle()
    assert not third.done()  # one hold is still in flight, so it still waits
    second.release(D("2.50"))  # now nothing is in flight, and 5.00 is spent
    async with asyncio.timeout(2):
        assert not await third


async def test_releasing_in_a_finally_frees_the_hold_when_the_work_fails() -> None:
    budget = RunBudget(D("5"), 20)

    async def work() -> None:
        hold = await budget.acquire(HOLD)
        assert hold
        try:
            raise RuntimeError("the research failed")
        finally:
            hold.release(D("0.40"))

    with pytest.raises(RuntimeError):
        await work()
    assert budget.reserved == D(0)
    assert budget.in_flight == 0
    assert budget.spent == D("0.40")
    assert await budget.acquire(HOLD)


async def test_a_cancelled_task_in_a_finally_still_frees_its_hold_and_wakes_waiters() -> None:
    budget = RunBudget(D("5"), 20)
    started = asyncio.Event()

    async def work() -> None:
        hold = await budget.acquire(D("5"))
        assert hold
        try:
            started.set()
            await asyncio.sleep(60)
        finally:
            hold.release(D("1.00"))  # a plain call: it needs no await

    task = asyncio.create_task(work())
    await started.wait()
    waiter = asyncio.create_task(budget.acquire(HOLD))
    await settle()
    assert not waiter.done()

    task.cancel()
    await asyncio.wait({task}, timeout=2)
    assert task.cancelled()
    async with asyncio.timeout(2):
        assert await waiter
    assert budget.spent == D("1.00")
    assert budget.reserved == HOLD


async def test_a_task_cancelled_while_waiting_holds_nothing() -> None:
    budget = RunBudget(D("5"), 20)
    big = await budget.acquire(D("5"))
    waiter = asyncio.create_task(budget.acquire(HOLD))
    await settle()
    waiter.cancel()
    await asyncio.wait({waiter}, timeout=2)
    assert waiter.cancelled()
    assert budget.reserved == D("5")
    assert budget.in_flight == 1
    assert budget._waiters == []  # nothing is left waiting for a wake-up

    big.release(D("0.10"))
    assert await budget.acquire(HOLD)


# --- A hold is a token: ending it twice, or ending one that was never granted, frees nothing ---


async def test_a_second_release_does_not_free_money_held_for_others() -> None:
    """The bug this guards: two holds of the same size are open, one is released twice, and the
    second release freed the other task's money."""
    budget = RunBudget(D("20"), 20)
    mine = await budget.acquire(HOLD)
    theirs = await budget.acquire(HOLD)
    mine.release(D("1"))
    assert budget.reserved == HOLD
    assert budget.in_flight == 1
    assert budget.spent == D("1")

    mine.release(D("1"))  # a second release of the same hold
    mine.release(D("5"))  # and a third, with another number
    assert budget.reserved == HOLD  # still held for `theirs`
    assert budget.in_flight == 1
    assert budget.spent == D("1")  # the cost is counted once
    assert theirs.released is False

    theirs.release(D("0.50"))
    assert budget.reserved == D(0)
    assert budget.in_flight == 0
    assert budget.spent == D("1.50")


async def test_a_second_release_on_an_empty_budget_changes_nothing() -> None:
    budget = RunBudget(D("20"), 20)
    hold = await budget.acquire(HOLD)
    hold.release(D("1"))
    hold.release(D("0"))  # nothing is held: ignored, and it can't go below zero
    assert budget.reserved == D(0)
    assert budget.in_flight == 0
    assert budget.spent == D("1")


async def test_a_hold_that_was_refused_frees_nothing_while_other_holds_are_open() -> None:
    budget = RunBudget(D("5"), 20, spent=D("4.00"))
    refused = await budget.acquire(HOLD)  # nothing in flight, and only 1.00 is left
    assert not refused
    small = await budget.acquire(D("1.00"))  # a hold that does fit, and stays open
    assert small

    refused.release(D("0"))
    refused.release(D("0"))
    assert refused.released is True
    assert budget.in_flight == 1
    assert budget.reserved == D("1.00")  # `small` is still held
    assert budget.spent == D("4.00")
    small.release(D("0.20"))
    assert budget.reserved == D(0)
    assert budget.spent == D("4.20")


async def test_releasing_a_refused_hold_never_frees_another_holds_money() -> None:
    budget = RunBudget(D("5"), 20)
    keep = await budget.acquire(D("5"))
    refused = Hold(budget, D("5"), granted=False)  # as if acquire had said no
    refused.release(D("0"))
    refused.release(D("0"))
    assert budget.reserved == D("5")
    assert budget.in_flight == 1
    assert budget.spent == D(0)
    keep.release(D("1"))
    assert budget.reserved == D(0)


async def test_money_reported_on_a_refused_hold_counts_once_as_spent() -> None:
    """If work ran anyway and cost money, the money is gone. It counts, but only once."""
    budget = RunBudget(D("5"), 20)
    refused = Hold(budget, D("1"), granted=False)
    refused.release(D("0.30"))
    refused.release(D("0.30"))
    assert budget.spent == D("0.30")
    assert budget.reserved == D(0)
    assert budget.in_flight == 0


async def test_a_release_with_a_negative_cost_is_refused_and_the_hold_stays_open() -> None:
    budget = RunBudget(D("20"), 20)
    hold = await budget.acquire(HOLD)
    with pytest.raises(ValueError):
        hold.release(D("-1"))
    assert hold.released is False
    assert budget.reserved == HOLD
    hold.release(D("1"))
    assert budget.reserved == D(0)


async def test_a_cancelled_acquire_leaves_nothing_to_release() -> None:
    """A task cancelled while it waits for a hold gets no hold, and the budget is as it was."""
    budget = RunBudget(D("5"), 20)
    big = await budget.acquire(D("5"))
    seen: list[Hold] = []

    async def worker() -> None:
        async with budget.hold(HOLD) as hold:  # waits here, so the block never runs
            seen.append(hold)

    task = asyncio.create_task(worker())
    await settle()
    task.cancel()
    await asyncio.wait({task}, timeout=2)
    assert task.cancelled()
    assert seen == []
    assert budget.reserved == D("5")
    assert budget.in_flight == 1
    assert budget.spent == D(0)
    big.release(D("0"))
    assert budget.reserved == D(0)


async def test_the_hold_block_releases_with_the_actual_cost_when_it_ends() -> None:
    budget = RunBudget(D("20"), 20)
    async with budget.hold(HOLD) as hold:
        assert hold
        assert budget.reserved == HOLD
        assert hold.actual == D(0)
        hold.actual = D("1.75")
    assert hold.released is True
    assert budget.reserved == D(0)
    assert budget.spent == D("1.75")


async def test_the_hold_block_releases_when_the_work_fails_or_is_cancelled() -> None:
    budget = RunBudget(D("20"), 20)
    with pytest.raises(RuntimeError):
        async with budget.hold(HOLD) as hold:
            hold.actual = D("0.40")
            raise RuntimeError("the research failed")
    assert budget.reserved == D(0)
    assert budget.spent == D("0.40")

    started = asyncio.Event()

    async def work() -> None:
        async with budget.hold(HOLD) as inner:
            inner.actual = D("0.60")
            started.set()
            await asyncio.sleep(60)

    task = asyncio.create_task(work())
    await started.wait()
    task.cancel()
    await asyncio.wait({task}, timeout=2)
    assert task.cancelled()
    assert budget.reserved == D(0)
    assert budget.in_flight == 0
    assert budget.spent == D("1.00")


async def test_an_early_release_inside_the_block_is_not_repeated_when_the_block_ends() -> None:
    budget = RunBudget(D("20"), 20)
    other = await budget.acquire(HOLD)
    async with budget.hold(HOLD) as hold:
        hold.release(D("0.50"))  # the work ended early
        assert budget.reserved == HOLD  # only `other` is held now
    assert budget.reserved == HOLD  # the block's own release did nothing
    assert budget.in_flight == 1
    assert budget.spent == D("0.50")
    other.release(D("0"))


async def test_the_hold_block_says_no_the_same_way_when_nothing_fits() -> None:
    budget = RunBudget(D("5"), 20, spent=D("4.00"))
    async with budget.hold(HOLD) as hold:
        assert not hold
        assert budget.in_flight == 0
    assert budget.reserved == D(0)
    assert budget.spent == D("4.00")


async def test_a_hold_shows_its_state() -> None:
    budget = RunBudget(D("5"), 20)
    hold = await budget.acquire(HOLD)
    assert repr(hold) == "Hold(2.50, held)"
    hold.release(D("0"))
    assert repr(hold) == "Hold(2.50, released)"
    refused = Hold(budget, HOLD, granted=False)
    assert repr(refused) == "Hold(2.50, refused)"


async def test_money_spent_outside_a_hold_counts() -> None:
    budget = RunBudget(D("5"), 20)
    budget.add_spend(D("4.00"))
    assert budget.spent == D("4.00")
    assert not await budget.acquire(HOLD)
    with pytest.raises(ValueError):
        budget.add_spend(D("-1"))


async def test_a_hold_is_never_for_a_negative_amount() -> None:
    with pytest.raises(ValueError):
        await RunBudget(D("5"), 20).acquire(D("-1"))


def test_companies_stop_at_the_limit() -> None:
    budget = RunBudget(D("20"), 2)
    assert budget.start_company() is True
    assert budget.start_company() is True
    assert budget.start_company() is False
    assert budget.companies_started == 2
    assert budget.companies_left == 0


def test_a_resume_keeps_counting_from_the_companies_already_started() -> None:
    budget = RunBudget(D("20"), 3, companies_started=2)
    assert budget.start_company() is True
    assert budget.start_company() is False


async def test_many_tasks_never_pass_the_cap_by_more_than_the_overshoot() -> None:
    """60 tasks, a 20 dollar cap, holds of 2.50, and costs that sometimes pass the hold."""
    rng = random.Random(7)
    budget = RunBudget(D("20"), 1000)
    overshoot = D(0)  # the money spent above holds so far
    worst = D(0)  # the biggest (spent + held) minus the cap that was ever seen
    outcomes: list[bool] = []

    async def company(index: int) -> None:
        nonlocal overshoot, worst
        hold = await budget.acquire(HOLD)
        outcomes.append(hold.granted)
        if not hold:
            return
        worst = max(worst, budget.spent + budget.reserved - budget.cap_usd)
        await asyncio.sleep(rng.random() / 200)
        actual = D(str(round(rng.uniform(0.2, 3.2), 2)))
        overshoot += max(D(0), actual - HOLD)
        hold.release(actual)
        hold.release(actual)  # a careless second release must not matter

    async with asyncio.timeout(20):
        await asyncio.gather(*(company(i) for i in range(60)))

    assert budget.reserved == D(0)
    assert budget.in_flight == 0
    assert budget._waiters == []
    assert any(outcomes)  # some ran
    assert worst <= overshoot  # held plus spent never passed the cap by more than the overshoot
    assert budget.spent <= budget.cap_usd + overshoot
    # A "no" is only given when the cap is really used up.
    if not all(outcomes):
        assert budget.spent + HOLD > budget.cap_usd


async def test_all_tasks_run_when_the_cap_is_big_enough() -> None:
    budget = RunBudget(D("100"), 1000)
    results: list[bool] = []

    async def company() -> None:
        async with budget.hold(HOLD) as hold:
            results.append(hold.granted)
            await asyncio.sleep(0.001)
            hold.actual = D("1.00")

    async with asyncio.timeout(10):
        await asyncio.gather(*(company() for _ in range(40)))
    assert results == [True] * 40
    assert budget.spent == D("40.00")
