"""The daily limit: how much Claude may cost in any 24 hours, across the whole process.

Fast tests replace the read of the search log with a fake total. The integration tests sum real
`core.searches` rows. Nothing calls Claude.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx2
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.claude import daily as daily_module
from core.claude.budget import BudgetSpent
from core.claude.client import AnthropicClaude, ClaudeError, ClaudeUnavailable, Reply
from core.claude.daily import (
    NO_ID_SECONDS,
    DailyCap,
    DailyLimitReached,
    read_spent,
    whole_cents,
)
from core.claude.pricing import Usage
from core.config import get_settings
from core.searches.models import SearchLog
from core.searches.service import log_reply
from tests.core.test_claude import FINAL, Answer, claude_that_answers

D = Decimal


class Log:
    """A fake search log: its 24-hour total and the request ids it holds."""

    def __init__(self, total: str = "0") -> None:
        self.total = D(total)
        self.ids: set[str] = set()
        self.reads = 0
        self.down = False

    async def read(
        self, session: Any, request_ids: list[str] | None = None
    ) -> tuple[Decimal, set[str]]:
        self.reads += 1
        if self.down:
            raise OSError("connection refused for user leadfinder")
        return self.total, {item for item in (request_ids or []) if item in self.ids}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@asynccontextmanager
async def no_session() -> AsyncIterator[Any]:
    yield object()


@pytest.fixture
def log(monkeypatch: pytest.MonkeyPatch) -> Log:
    fake = Log()
    monkeypatch.setattr(daily_module, "read_spent", fake.read)
    return fake


@pytest.fixture
def clock() -> Clock:
    return Clock()


def cap(clock: Clock, limit: str = "10", reserve: str = "1", **more: Any) -> DailyCap:
    return DailyCap(no_session, D(limit), D(reserve), clock=clock, **more)


# --- Holding money for a request (fast) -------------------------------------------------------


async def test_each_request_holds_its_reserve_until_it_ends(log: Log, clock: Clock) -> None:
    limit = cap(clock)
    async with limit.reserve():
        assert (limit.held_usd, limit.in_flight) == (D("1"), 1)
        async with limit.reserve():
            assert (limit.held_usd, limit.in_flight) == (D("2"), 2)
        assert limit.held_usd == D("1")
    assert (limit.held_usd, limit.in_flight) == (D("0"), 0)


async def test_a_request_that_would_pass_the_cap_is_refused_before_it_holds_anything(
    log: Log, clock: Clock
) -> None:
    log.total = D("8.50")
    limit = cap(clock)
    async with limit.reserve():  # 8.50 + 1 = 9.50: fits
        with pytest.raises(DailyLimitReached) as refused:
            async with limit.reserve():  # 8.50 + 1 held + 1 = 10.50: does not
                pytest.fail("it was let in")
        assert limit.held_usd == D("1")  # the refused one held nothing
    error = refused.value
    assert (error.cap, error.spent, error.held) == (D("10"), D("8.50"), D("1"))
    assert error.title == "Claude's daily limit is reached"
    assert "US$8.50 was spent in the last 24 hours" in error.detail
    assert "DAILY_CAP_USD" in error.detail


async def test_the_exact_cap_is_allowed(log: Log, clock: Clock) -> None:
    log.total = D("9")
    async with cap(clock).reserve():  # 9 + 1 = 10, not more than 10
        pass


async def test_a_hold_is_given_back_when_the_request_fails_or_is_cancelled(
    log: Log, clock: Clock
) -> None:
    limit = cap(clock)
    with pytest.raises(RuntimeError):
        async with limit.reserve():
            raise RuntimeError("the request broke")
    assert limit.held_usd == 0

    started = asyncio.Event()

    async def hold_for_ever() -> None:
        async with limit.reserve():
            started.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(hold_for_ever())
    await started.wait()
    task.cancel()
    await asyncio.wait({task})
    assert (limit.held_usd, limit.in_flight) == (D("0"), 0)


async def test_many_requests_at_once_never_hold_more_than_the_cap(log: Log, clock: Clock) -> None:
    limit = cap(clock, limit="5", reserve="1")
    inside = 0
    most = 0
    refused = 0
    gate = asyncio.Event()

    async def request() -> None:
        nonlocal inside, most, refused
        try:
            async with limit.reserve():
                inside += 1
                most = max(most, inside)
                await gate.wait()
                inside -= 1
        except DailyLimitReached:
            refused += 1

    tasks = [asyncio.create_task(request()) for _ in range(12)]
    await asyncio.sleep(0.05)
    gate.set()
    await asyncio.gather(*tasks)
    assert (most, refused) == (5, 7)


def test_the_daily_limit_is_a_cap_and_a_claude_error() -> None:
    error = DailyLimitReached(cap=D("50"), spent=D("49"), held=D("0.8"), needed=D("0.8"))
    assert isinstance(error, BudgetSpent)  # a run stops cleanly on it, like any cap
    assert isinstance(error, ClaudeError)  # /research and the command line show it plainly
    assert not isinstance(error, ClaudeUnavailable)  # it doesn't fail a run as "Claude is down"


# --- What was spent but not logged yet (fast) --------------------------------------------------


async def test_a_cost_counts_until_its_row_reaches_the_log_and_never_twice(
    log: Log, clock: Clock
) -> None:
    limit = cap(clock, cache_seconds=0)
    limit.note_spent(D("2"), "req_1")
    assert await limit.spent_usd() == D("2")  # not in the log yet: counted from memory

    log.total = D("2")
    log.ids.add("req_1")  # the caller wrote its row
    assert await limit.spent_usd() == D("2")  # now from the log only, not 4

    log.total = D("0")  # the row left the 24 hours
    assert await limit.spent_usd() == D("0")


async def test_a_cost_with_no_request_id_is_kept_for_a_while_then_dropped(
    log: Log, clock: Clock
) -> None:
    limit = cap(clock, cache_seconds=0)
    limit.note_spent(D("3"), None)
    assert await limit.spent_usd() == D("3")
    clock.now += NO_ID_SECONDS + 1
    assert await limit.spent_usd() == D("0")


async def test_nothing_is_kept_for_a_free_request(log: Log, clock: Clock) -> None:
    limit = cap(clock, cache_seconds=0)
    limit.note_spent(D("0"), "req_free")
    assert await limit.spent_usd() == D("0")


# --- Reading the log (fast) ---------------------------------------------------------------------


async def test_the_total_is_read_again_only_after_a_few_seconds(log: Log, clock: Clock) -> None:
    limit = cap(clock, cache_seconds=3)
    async with limit.reserve():
        pass
    async with limit.reserve():
        pass
    assert log.reads == 1
    await limit.remaining(fresh=True)  # the Settings page asks for a fresh number
    assert log.reads == 2
    clock.now += 3.1
    async with limit.reserve():
        pass
    assert log.reads == 3


async def test_a_log_that_cant_be_read_sends_nothing(log: Log, clock: Clock) -> None:
    log.down = True
    limit = cap(clock)
    with pytest.raises(ClaudeUnavailable) as caught:
        async with limit.reserve():
            pytest.fail("it was let in")
    assert caught.value.title == "Can't check the daily limit"
    assert "leadfinder" not in caught.value.detail  # the driver's text stays out
    assert limit.held_usd == 0


async def test_remaining_is_the_cap_less_spent_and_held_and_never_negative(
    log: Log, clock: Clock
) -> None:
    log.total = D("4.255")
    limit = cap(clock)
    async with limit.reserve():
        assert await limit.remaining() == D("4.745")
    log.total = D("12")
    assert await limit.remaining(fresh=True) == D("0")
    assert whole_cents(D("4.749")) == D("4.74")  # rounded down: never more than is left


async def test_has_room_counts_the_holds_already_taken(log: Log, clock: Clock) -> None:
    log.total = D("8")
    limit = cap(clock)
    async with limit.reserve():  # 8 spent + 1 held
        assert await limit.has_room()
        log.total = D("9.5")
        assert await limit.remaining(fresh=True) == D("0")  # the log moved on
        assert not await limit.has_room()  # 9.5 spent + 1 held is over 10


async def test_configure_changes_the_cap_and_the_hold_for_the_next_request(
    log: Log, clock: Clock
) -> None:
    limit = cap(clock, limit="10", reserve="1")
    async with limit.reserve():
        limit.configure(daily_cap_usd=D("1.5"), request_reserve_usd=D("0.5"))
        assert limit.held_usd == D("1")  # a hold already taken keeps its amount
        async with limit.reserve():  # 1 held + 0.5 = 1.5: just fits
            with pytest.raises(DailyLimitReached):
                async with limit.reserve():  # 2.0: over
                    pass
    assert (limit.cap_usd, limit.request_reserve_usd) == (D("1.5"), D("0.5"))
    with pytest.raises(ValueError):
        limit.configure(daily_cap_usd=D("0"))
    with pytest.raises(ValueError):
        limit.configure(request_reserve_usd=D("-1"))


# --- The client and the limit together (fast) ---------------------------------------------------


async def test_the_client_checks_the_limit_before_it_sends(log: Log, clock: Clock) -> None:
    log.total = D("49.50")
    sent: list[httpx2.Request] = []
    shared = cap(clock, limit="50", reserve="0.80")
    claude = claude_that_answers(sent, FINAL, daily=shared)

    with pytest.raises(DailyLimitReached):
        await claude.ask(system="s", prompt="p", form=Answer)
    assert sent == []  # refused before anything was sent (or billed)
    assert shared.held_usd == 0


async def test_the_client_notes_what_a_request_cost_until_it_is_logged(
    log: Log, clock: Clock
) -> None:
    sent: list[httpx2.Request] = []
    shared = cap(clock, limit="50", reserve="0.80", cache_seconds=0)
    claude = claude_that_answers(sent, FINAL, daily=shared)

    reply = await claude.ask(system="s", prompt="p", form=Answer)

    assert len(sent) == 1
    assert reply.cost_usd > 0
    assert await shared.spent_usd() == reply.cost_usd
    assert shared.held_usd == 0


async def test_the_sdk_never_retries_a_request(log: Log, clock: Clock) -> None:
    calls: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(request)
        return httpx2.Response(
            529, json={"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}
        )

    import anthropic

    sdk = anthropic.AsyncAnthropic(
        api_key="test-key",
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
        max_retries=5,  # whatever it is given, the engine turns retries off
    )
    claude = AnthropicClaude(client=sdk, daily=cap(clock, limit="50", reserve="0.80"))
    with pytest.raises(ClaudeError) as caught:
        await claude.ask(system="s", prompt="p", form=Answer)
    assert len(calls) == 1  # a retry would be billed again
    assert "529" in caught.value.title
    assert json.loads(calls[0].content)["model"] == get_settings().claude_model


# --- The real log (integration) -----------------------------------------------------------------


def reply(cost: str, request_id: str) -> Reply[Any]:
    return Reply(
        model="claude-opus-5-5",
        stop_reason="end_turn",
        parsed=None,
        text="",
        sources=(),
        queries=(),
        usage=Usage(web_searches=1),
        cost_usd=D(cost),
        request_id=request_id,
    )


async def add_row(
    factory: async_sessionmaker[AsyncSession], cost: str, request_id: str, hours_ago: float
) -> None:
    async with factory() as session:
        row = log_reply(session, reply(cost, request_id), app="lead_finder", step="search")
        await session.flush()
        await session.execute(
            update(SearchLog)
            .where(SearchLog.id == row.id)
            .values(created_at=datetime.now(UTC) - timedelta(hours=hours_ago))
        )
        await session.commit()


@pytest.mark.integration
async def test_the_log_total_covers_the_last_24_hours_only(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await add_row(session_factory, "1.25", "req_a", hours_ago=1)
    await add_row(session_factory, "2.50", "req_b", hours_ago=23.5)
    await add_row(session_factory, "40.00", "req_old", hours_ago=24.5)
    async with session_factory() as session:
        total, seen = await read_spent(session, ["req_a", "req_old", "req_missing", ""])
        empty_total, nothing = await read_spent(session)
    assert total == empty_total == D("3.75")
    assert seen == {"req_a"}  # the old row is outside the 24 hours
    assert nothing == set()


@pytest.mark.integration
async def test_the_cap_reads_the_real_log_and_matches_a_noted_cost_by_its_request_id(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    limit = DailyCap(session_factory, D("10"), D("1"), cache_seconds=0)
    limit.note_spent(D("2"), f"req_{uuid.uuid4().hex}")
    noted = limit._unlogged[0].request_id
    assert noted is not None
    assert await limit.spent_usd() == D("2")
    await add_row(session_factory, "2", noted, hours_ago=0.01)  # the caller logs it
    assert await limit.spent_usd() == D("2")  # once, from the log
    assert limit._unlogged == []
    assert await limit.remaining() == D("8")
