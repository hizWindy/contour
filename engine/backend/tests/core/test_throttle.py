"""The limits on guessing (PLAN-V6 B4): the rules as plain functions, no database and no clock of
their own. The same limits through the API are in `test_auth_limits.py`."""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from core.auth import throttle
from core.auth.throttle import Rules, Standing, UnknownLogins
from core.config import Settings

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
RULES = Rules(
    free_tries=2,
    lock_tries=10,
    lock_for=timedelta(minutes=15),
    ip_max=20,
    ip_window=timedelta(minutes=15),
)


def wrong_tries(rules: Rules, count: int) -> list[tuple[Standing, bool]]:
    """What each of `count` wrong tries in a row leaves, one after another."""
    steps: list[tuple[Standing, bool]] = []
    standing = Standing()
    for _ in range(count):
        standing, locked = throttle.after_failure(standing, rules, NOW)
        steps.append((standing, locked))
    return steps


def test_the_rules_default_to_the_plan() -> None:
    rules = Rules.from_settings(Settings(_env_file=None))
    assert rules == RULES


def test_the_rules_come_from_the_settings() -> None:
    rules = Rules.from_settings(
        Settings(
            _env_file=None,
            login_free_tries=0,
            login_lock_tries=5,
            login_lock_minutes=30,
            login_ip_max_failures=50,
            login_ip_window_minutes=60,
        )
    )
    assert rules == Rules(0, 5, timedelta(minutes=30), 50, timedelta(minutes=60))


def test_the_first_two_wrong_tries_cost_nothing_then_each_wait_doubles_to_a_minute() -> None:
    waits = [
        None if step.blocked_until is None else (step.blocked_until - NOW).total_seconds()
        for step, _ in wrong_tries(RULES, 9)
    ]
    assert waits == [None, None, 2, 4, 8, 16, 32, 60, 60]


def test_the_tenth_wrong_try_in_a_row_locks_for_fifteen_minutes() -> None:
    steps = wrong_tries(RULES, 10)
    assert [locked for _, locked in steps] == [False] * 9 + [True]
    last, _ = steps[-1]
    assert last == Standing(10, NOW + timedelta(minutes=15))


def test_every_wrong_try_after_a_lock_ends_locks_again() -> None:
    standing = Standing(10, NOW - timedelta(seconds=1))  # the lock has just ended
    assert throttle.wait_for(standing, NOW) is None  # so it is checked again
    again, locked = throttle.after_failure(standing, RULES, NOW)
    assert locked is True
    assert again == Standing(11, NOW + timedelta(minutes=15))  # one try every 15 minutes


def test_with_no_free_tries_the_first_wrong_try_already_waits() -> None:
    rules = Rules(0, 4, timedelta(minutes=15), 20, timedelta(minutes=15))
    waits = [
        None if s.blocked_until is None else (s.blocked_until - NOW).total_seconds()
        for s, _ in wrong_tries(rules, 4)
    ]
    assert waits == [2, 4, 8, 900]


def test_a_right_password_starts_the_count_again() -> None:
    assert throttle.after_success() == Standing(0, None)
    # and the count restarts from the free tries
    after_slip = throttle.after_failure(throttle.after_success(), RULES, NOW)[0]
    assert after_slip == Standing(1, None)


@pytest.mark.parametrize(
    ("blocked_until", "left"),
    [
        (None, None),
        (NOW - timedelta(seconds=1), None),  # over
        (NOW, None),  # exactly now: over
        (NOW + timedelta(seconds=1), timedelta(seconds=1)),
        (NOW + timedelta(minutes=12), timedelta(minutes=12)),
    ],
)
def test_the_wait_left_is_what_remains_until_the_block_ends(
    blocked_until: datetime | None, left: timedelta | None
) -> None:
    assert throttle.wait_for(Standing(5, blocked_until), NOW) == left


# --- Logins that match no account -------------------------------------------------------------


def test_an_unknown_login_is_remembered_by_a_hash_never_by_the_text_typed() -> None:
    seen = UnknownLogins()
    typed = "my own password typed in the wrong box"
    seen.record(typed, Standing(3, NOW))
    assert seen.standing(typed) == Standing(3, NOW)
    keys = list(seen._seen)
    assert keys == [hashlib.sha256(typed.encode()).hexdigest()[:32]]
    assert typed not in "".join(keys)
    assert seen.standing("someone else") == Standing()  # a login nothing was recorded for


def test_the_registry_keeps_only_the_most_recently_used_logins() -> None:
    seen = UnknownLogins(capacity=3)
    for name in ("a", "b", "c"):
        seen.record(name, Standing(1, None))
    seen.record("a", Standing(2, None))  # a is used again: it is now the newest
    seen.record("d", Standing(1, None))  # over the limit: the oldest (b) goes
    assert len(seen) == 3
    assert seen.standing("b") == Standing()
    assert seen.standing("a") == Standing(2, None)
    assert {seen.standing(n).failed for n in ("a", "c", "d")} == {2, 1}


def test_a_flood_of_made_up_logins_cannot_grow_the_registry_past_its_limit() -> None:
    seen = UnknownLogins(capacity=100)
    for number in range(10_000):
        seen.record(f"made-up-{number}", Standing(1, None))
    assert len(seen) == 100


# --- The IP address ---------------------------------------------------------------------------


class FakeLog:
    """`audit.failures_from` with a fixed list, newest first."""

    def __init__(self, stamps: list[datetime]) -> None:
        self.stamps = stamps
        self.asked: list[tuple[Any, datetime]] = []

    async def __call__(self, db: Any, ip: str | None, since: datetime) -> list[datetime]:
        self.asked.append((ip, since))
        return [stamp for stamp in self.stamps if stamp > since]


async def test_an_address_under_its_limit_may_try(monkeypatch: pytest.MonkeyPatch) -> None:
    rules = Rules(2, 10, timedelta(minutes=15), 3, timedelta(minutes=15))
    log = FakeLog([NOW - timedelta(minutes=1), NOW - timedelta(minutes=5)])
    monkeypatch.setattr("core.auth.audit.failures_from", log)
    assert await throttle.ip_wait(object(), "203.0.113.7", rules, NOW) is None  # type: ignore[arg-type]
    assert log.asked == [("203.0.113.7", NOW - timedelta(minutes=15))]  # only the window is read


async def test_an_address_at_its_limit_waits_until_the_failure_that_fills_it_leaves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rules = Rules(2, 10, timedelta(minutes=15), 3, timedelta(minutes=15))
    # Newest first: 1, 5 and 9 minutes ago. The third (9 minutes ago) leaves the window in 6.
    stamps = [NOW - timedelta(minutes=m) for m in (1, 5, 9)]
    monkeypatch.setattr("core.auth.audit.failures_from", FakeLog(stamps))
    wait = await throttle.ip_wait(object(), "203.0.113.7", rules, NOW)  # type: ignore[arg-type]
    assert wait == timedelta(minutes=6)
    # With a fourth, older failure the count is over the limit: the same wait, not a longer one.
    older = [*stamps, NOW - timedelta(minutes=14)]
    monkeypatch.setattr("core.auth.audit.failures_from", FakeLog(older))
    assert await throttle.ip_wait(object(), "203.0.113.7", rules, NOW) == timedelta(minutes=6)  # type: ignore[arg-type]


async def test_an_address_that_has_no_name_is_counted_as_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log = FakeLog([])
    monkeypatch.setattr("core.auth.audit.failures_from", log)
    await throttle.ip_wait(object(), None, RULES, NOW)  # type: ignore[arg-type]
    assert log.asked[0][0] is None
