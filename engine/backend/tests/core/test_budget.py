"""The per-company budget: searches and money held back for requests that are running."""

import asyncio
from decimal import Decimal
from typing import Any

import pytest

from core.claude.budget import Budget, BudgetSpent
from core.claude.client import Reply
from core.claude.pricing import Usage
from core.config import Settings

RESERVE = Decimal("0.80")


def reply(cost: str, searches: int = 1) -> Reply[Any]:
    return Reply(
        "claude-opus-5-5", "end_turn", None, "", (), (), Usage(web_searches=searches), Decimal(cost)
    )


def budget(cap: str, reserve: Decimal = RESERVE, max_searches: int = 50) -> Budget:
    return Budget(Decimal(cap), max_searches, request_reserve_usd=reserve)


async def start_request(b: Budget, results: list[str], cost: str = "0.30", wanted: int = 3) -> None:
    """One request: take the hold, 'run' for a moment, then record the real cost."""
    try:
        granted = b.reserve_request(wanted)
    except BudgetSpent:
        results.append("refused")
        return
    await asyncio.sleep(0)  # the request is in flight
    b.record(reply(cost), reserved=granted)
    results.append("passed")


async def test_a_small_cap_lets_almost_nothing_through() -> None:
    """Cap $0.50, hold $0.80 per request: three side by side can't all go. None or one does."""
    b = budget("0.50")
    results: list[str] = []
    await asyncio.gather(*(start_request(b, results) for _ in range(3)))
    assert results.count("passed") <= 1
    assert results.count("refused") >= 2
    assert b.spent_usd <= b.cap_usd  # the cap was never gone past
    assert b.reserved_usd == 0


async def test_three_requests_fit_a_normal_cap_and_a_fourth_waits_for_one_to_settle() -> None:
    """Cap $2.50, hold $0.80: three fit ($2.40). A fourth is refused until one settles."""
    b = budget("2.50")
    for _ in range(3):
        b.reserve_request(3)
    assert b.reserved_usd == Decimal("2.40")
    with pytest.raises(BudgetSpent, match="No room"):
        b.reserve_request(3)

    # One request ends and cost only $0.05. Spent 0.05 + held 1.60 + new 0.80 = 2.45: fits.
    b.record(reply("0.05"), reserved=3)
    assert b.reserved_usd == Decimal("1.60")
    b.reserve_request(3)


def test_a_request_that_cost_more_than_its_hold_keeps_the_next_one_out() -> None:
    b = budget("2.50")
    for _ in range(3):
        b.reserve_request(3)
    b.record(reply("0.90"), reserved=3)  # spent 0.90 + held 1.60 + 0.80 = 3.30
    with pytest.raises(BudgetSpent):
        b.reserve_request(3)


async def test_parallel_requests_never_go_past_the_cap_plus_what_is_in_flight() -> None:
    b = budget("2.50")
    results: list[str] = []
    await asyncio.gather(*(start_request(b, results, cost="0.70") for _ in range(6)))
    assert results.count("passed") == 3  # the other three were refused while those ran
    assert b.spent_usd == Decimal("2.10")
    assert b.reserved_usd == 0
    # Nothing is in flight now, but 2.10 spent + 0.80 for a new request is over 2.50.
    with pytest.raises(BudgetSpent):
        b.reserve_request(3)


def test_a_failed_request_returns_its_searches_and_its_money() -> None:
    b = budget("2.50", max_searches=5)
    granted = b.reserve_request(3)
    assert (granted, b.reserved_usd) == (3, RESERVE)
    b.release(granted)
    assert b.reserved_usd == 0
    assert b.reserve_request(5) == 5  # all 5 searches are free again


def test_a_refused_request_holds_nothing() -> None:
    b = budget("2.50", max_searches=2)
    assert b.reserve_request(2) == 2
    with pytest.raises(BudgetSpent, match="searches"):
        b.reserve_request(1)  # money would fit, searches do not
    assert b.reserved_usd == RESERVE  # only the first request's hold is there


def test_searches_are_shared_out_while_requests_run() -> None:
    b = budget("10.00", max_searches=5)
    assert b.reserve_request(3) == 3
    assert b.reserve_request(3) == 2  # 2 left while the first request runs
    b.record(reply("0.40", searches=1), reserved=3)
    b.release(2)
    assert b.reserve_request(9) == 4  # the unused searches came back
    assert b.searches == 1


def test_no_hold_keeps_the_old_behaviour() -> None:
    """Without request_reserve_usd, only money already spent counts, as before."""
    b = Budget(Decimal("1.00"), 5)
    assert b.reserve_searches(3) == 3  # the old name still works
    assert b.reserve_searches(3) == 2
    with pytest.raises(BudgetSpent):
        b.reserve_searches(1)
    b.record(reply("0.40"), reserved=3)
    b.release(2)
    assert b.reserved_usd == 0
    assert b.reserve_searches(9) == 4
    b.record(reply("0.70", searches=4), reserved=4)
    with pytest.raises(BudgetSpent):
        b.check()
    with pytest.raises(BudgetSpent):
        b.reserve_request(1)  # spent $1.10 of $1.00


def test_exactly_at_the_cap_is_refused_even_with_no_hold() -> None:
    b = Budget(Decimal("1.00"), 5)
    b.record(reply("1.00", searches=0))
    with pytest.raises(BudgetSpent):
        b.reserve_request(1)


def test_a_call_with_no_web_search_holds_nothing() -> None:
    """record() with reserved=0 (the form-filling call) must not give back a hold."""
    b = budget("2.50")
    granted = b.reserve_request(3)
    b.record(reply("0.04", searches=0))  # another request, no hold of its own
    assert b.reserved_usd == RESERVE  # the first request's hold is still there
    b.record(reply("0.20"), reserved=granted)
    assert b.reserved_usd == 0


def test_the_hold_cannot_go_below_zero() -> None:
    b = budget("2.50")
    b.release(3)  # a bug elsewhere: nothing was held
    assert b.reserved_usd == 0


def test_on_spend_gets_each_reply_after_the_budget_is_updated() -> None:
    b = budget("2.50")
    seen: list[tuple[Decimal, Decimal, int]] = []

    def on_spend(r: Reply[Any]) -> None:
        seen.append((r.cost_usd, b.spent_usd, b.searches))

    granted = b.reserve_request(3)
    b.record(reply("0.25", searches=2), reserved=granted, on_spend=on_spend)
    assert seen == [(Decimal("0.25"), Decimal("0.25"), 2)]


def test_a_failing_on_spend_never_loses_the_record() -> None:
    b = budget("2.50")

    def broken(r: Reply[Any]) -> None:
        raise RuntimeError("counter is broken")

    granted = b.reserve_request(3)
    b.record(reply("0.25", searches=2), reserved=granted, on_spend=broken)
    assert (b.spent_usd, b.searches, b.reserved_usd) == (Decimal("0.25"), 2, Decimal(0))


# --- acquire_request: wait while other requests are running -----------------------------------


def default_settings_budget() -> tuple[Budget, int]:
    """A budget built from the default settings, and the searches one request asks for."""
    fields = Settings.model_fields
    budget = Budget(
        fields["company_cap_usd"].default,
        fields["company_max_searches"].default,
        request_reserve_usd=fields["request_reserve_usd"].default,
    )
    return budget, fields["searches_per_request"].default


async def acquire(b: Budget, wanted: int = 3) -> int:
    """acquire_request, but a test that would wait for ever fails after 2 seconds instead."""
    return await asyncio.wait_for(b.acquire_request(wanted), timeout=2)


async def let_tasks_run() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


async def test_the_default_settings_run_all_four_research_angles() -> None:
    """Cap $2.50, hold $0.80: only three holds fit at once, but the fourth angle must not be
    lost. It waits until two of the first three have ended, then runs."""
    b, wanted = default_settings_budget()
    assert (b.cap_usd, b.request_reserve_usd) == (Decimal("2.50"), RESERVE)
    within_cap: list[bool] = []
    started: list[int] = []

    async def angle(number: int) -> int:
        granted = await acquire(b, wanted)
        started.append(number)
        within_cap.append(b.spent_usd + b.reserved_usd <= b.cap_usd)
        await asyncio.sleep(0.01)  # the request is in flight
        b.record(reply("0.30"), reserved=granted)
        return granted

    granted = await asyncio.gather(*(angle(n) for n in range(4)))
    assert granted == [wanted] * 4  # all four ran, each with its searches
    assert started == [0, 1, 2, 3]  # the fourth went last, after others ended
    assert all(within_cap)  # money spent and held never went over the cap
    assert b.spent_usd == Decimal("1.20")
    assert (b.reserved_usd, b.searches) == (Decimal(0), 4)


def test_reserve_request_still_refuses_the_fourth_angle_at_once() -> None:
    """The answer-now version is unchanged. It is the reason research needs acquire_request."""
    b, wanted = default_settings_budget()
    for _ in range(3):
        b.reserve_request(wanted)
    with pytest.raises(BudgetSpent, match="No room"):
        b.reserve_request(wanted)


async def test_acquire_does_not_wait_when_nothing_is_running_and_it_cannot_fit() -> None:
    b = budget("2.50")
    b.record(reply("2.10", searches=0))  # spent $2.10, nothing in flight
    with pytest.raises(BudgetSpent, match="No room"):
        await acquire(b)
    assert b.reserved_usd == 0


async def test_acquire_does_not_wait_when_the_cap_is_already_spent() -> None:
    """Spent money never comes back, so waiting for other requests could not help."""
    b = budget("2.50")
    b.reserve_request(3)  # a request is in flight
    b.record(reply("2.50", searches=0))
    with pytest.raises(BudgetSpent, match="Spent"):
        await acquire(b)
    assert b.reserved_usd == RESERVE  # the running request keeps its hold


async def test_a_small_cap_refuses_every_request_at_once_without_waiting() -> None:
    """Cap $0.50, hold $0.80: no request can ever fit, and nothing is running, so none waits."""
    b = budget("0.50")
    outcomes = await asyncio.gather(*(acquire(b) for _ in range(3)), return_exceptions=True)
    assert all(isinstance(o, BudgetSpent) for o in outcomes)
    assert b.reserved_usd == 0


async def test_acquire_waits_then_runs_when_a_running_request_cost_less_than_its_hold() -> None:
    b = budget("2.50")
    holds = [b.reserve_request(3) for _ in range(3)]
    waiting = asyncio.create_task(acquire(b))
    await let_tasks_run()
    assert not waiting.done()
    b.record(reply("0.05"), reserved=holds[0])  # spent 0.05 + held 1.60 + 0.80 = 2.45: fits
    assert await waiting == 3
    assert b.reserved_usd == Decimal("2.40")


async def test_acquire_keeps_waiting_while_a_settled_request_still_leaves_no_room() -> None:
    b = budget("2.50")
    holds = [b.reserve_request(3) for _ in range(3)]
    waiting = asyncio.create_task(acquire(b))
    b.record(reply("0.70"), reserved=holds[0])  # 0.70 + 1.60 + 0.80 = 3.10: no room yet
    await let_tasks_run()
    assert not waiting.done()
    b.record(reply("0.20"), reserved=holds[1])  # 0.90 + 0.80 + 0.80 = 2.50: fits exactly
    assert await waiting == 3


async def test_acquire_is_refused_when_the_last_request_ends_and_it_still_does_not_fit() -> None:
    b = budget("2.50")
    holds = [b.reserve_request(3) for _ in range(3)]
    waiting = asyncio.create_task(acquire(b))
    for hold in holds[:2]:
        b.record(reply("0.80"), reserved=hold)
        await let_tasks_run()
        assert not waiting.done()  # one is still running, so it may yet make room
    b.record(reply("0.40"), reserved=holds[2])  # all ended: spent 2.00 + 0.80 is over 2.50
    with pytest.raises(BudgetSpent, match="No room"):
        await waiting
    assert b.reserved_usd == 0


async def test_acquire_waits_for_a_search_and_gets_it_when_a_request_fails() -> None:
    b = budget("10.00", max_searches=3)
    granted = b.reserve_request(3)  # every search is held
    waiting = asyncio.create_task(acquire(b))
    await let_tasks_run()
    assert not waiting.done()
    b.release(granted)  # the request failed, so its searches come back
    assert await waiting == 3
    assert b.reserved_usd == RESERVE


async def test_acquire_gives_up_on_searches_when_nothing_is_running() -> None:
    b = budget("10.00", max_searches=1)
    b.record(reply("0.10", searches=1))  # the one search is used
    with pytest.raises(BudgetSpent, match="searches"):
        await acquire(b)


async def test_parallel_acquires_never_wait_for_ever_and_never_pass_the_cap() -> None:
    """Six requests that each cost $0.70: three run, then the others are refused, not stuck."""
    b = budget("2.50")
    results: list[str] = []

    async def request() -> None:
        try:
            granted = await acquire(b)
        except BudgetSpent:
            results.append("refused")
            return
        await asyncio.sleep(0.01)
        b.record(reply("0.70"), reserved=granted)
        results.append("passed")

    await asyncio.gather(*(request() for _ in range(6)))
    assert sorted(results) == ["passed"] * 3 + ["refused"] * 3
    assert b.spent_usd == Decimal("2.10")
    assert b.reserved_usd == 0


async def test_a_cancelled_waiter_holds_nothing_and_leaves_nothing_behind() -> None:
    b = budget("2.50")
    holds = [b.reserve_request(3) for _ in range(3)]
    waiting = asyncio.create_task(acquire(b))
    await let_tasks_run()
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert b.reserved_usd == Decimal("2.40")  # only the three running requests hold money
    assert b._waiters == []
    b.record(reply("0.05"), reserved=holds[0])  # waking up with nobody waiting is harmless
    assert b.reserve_request(3) == 3


async def test_a_waiter_that_was_woken_and_then_cancelled_holds_nothing() -> None:
    b = budget("2.50")
    holds = [b.reserve_request(3) for _ in range(3)]
    waiting = asyncio.create_task(acquire(b))
    await let_tasks_run()
    b.record(reply("0.05"), reserved=holds[0])  # wakes the waiter, which has not run yet
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert b.reserved_usd == Decimal("1.60")  # the waiter took no hold


# --- A request needs at least one search ---------------------------------------------------------


@pytest.mark.parametrize("wanted", [0, -1, -50])
def test_asking_for_fewer_than_one_search_is_a_bug_not_a_hold(wanted: int) -> None:
    b = budget("2.50")
    for ask in (b.reserve_request, b.reserve_searches):
        with pytest.raises(ValueError, match="at least 1 search"):
            ask(wanted)
    assert (b.reserved_usd, b.in_flight) == (Decimal(0), False)  # nothing was held
    assert b.reserve_request(1) == 1  # the budget still works


@pytest.mark.parametrize("wanted", [0, -1, -50])
async def test_acquire_request_refuses_fewer_than_one_search_too(wanted: int) -> None:
    b = budget("2.50")
    with pytest.raises(ValueError, match="at least 1 search"):
        await acquire(b, wanted)
    assert (b.reserved_usd, b.in_flight, b._waiters) == (Decimal(0), False, [])
    assert await acquire(b, 1) == 1


def test_the_value_error_comes_before_the_cap_check() -> None:
    """Even a budget that is already spent says what is wrong with the call."""
    b = budget("1.00")
    b.record(reply("1.10"))
    with pytest.raises(ValueError, match="at least 1 search"):
        b.reserve_request(0)
    with pytest.raises(BudgetSpent):
        b.reserve_request(1)
