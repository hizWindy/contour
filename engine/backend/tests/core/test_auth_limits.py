"""The limits on guessing, through the API (PLAN-V6 B4, security rule 2), on the test database.

The rules themselves are in `test_throttle.py`. These tests check what a person (or a guesser) sees:
the waits, the lock, that a try made during a wait does no work and leaves no trace, that a login
with no account is treated the same as one with an account, and the limit on one IP address.
"""

import asyncio
import json
import logging
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select

from core.auth import admin
from core.auth.models import AuditEntry, User
from tests.core.auth_world import (
    API,
    FAST,
    GOOD,
    CountingHasher,
    World,
    all_rows,
    make_account,
    sign_in,
)

pytestmark = pytest.mark.integration

WRONG = "not the password at all"
PLAIN_401 = {
    "type": "about:blank",
    "title": "Sign-in failed",
    "status": 401,
    "detail": "That email or password isn't right.",
    "code": "invalid_credentials",
}


async def wrong(client: httpx.AsyncClient, login: str = "alkhair") -> httpx.Response:
    return await sign_in(client, login=login, password=WRONG)


def retry_of(response: httpx.Response) -> int | None:
    found = response.json().get("retry_after_seconds")
    return None if found is None else int(found)


async def user_row(world: World) -> User:
    (row,) = await all_rows(world, User)
    return row  # type: ignore[no-any-return]


async def log_count(world: World, event: str | None = None) -> int:
    async with world.factory() as db:
        query = select(func.count()).select_from(AuditEntry)
        if event:
            query = query.where(AuditEntry.event == event)
        return int(await db.scalar(query) or 0)


async def lock_the_account(world: World, client: httpx.AsyncClient, login: str = "alkhair") -> None:
    """Ten wrong tries in a row, waiting out each short wait. That leaves the account locked."""
    for number in range(10):
        wait = retry_of(await wrong(client, login))
        if wait and number < 9:
            world.clock.advance(seconds=wait)


def counting(world: World) -> CountingHasher:
    hasher = CountingHasher()
    world.app.state.hasher = hasher
    return hasher


# --- The waits and the lock for one login -----------------------------------------------------


async def test_the_first_two_wrong_tries_cost_nothing_and_the_third_starts_the_waits(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    for _ in range(2):
        slip = await wrong(browser)
        assert slip.status_code == 401
        assert slip.json() == PLAIN_401  # no wait, and nothing more to say
    third = await wrong(browser)
    assert third.status_code == 401
    assert third.json() == {**PLAIN_401, "retry_after_seconds": 2}

    # Even the right password is turned away during the wait, and nothing is checked.
    early = await sign_in(browser)
    assert early.status_code == 429
    assert early.headers["content-type"].startswith("application/problem+json")
    assert early.headers["retry-after"] == "2"
    assert early.json() == {
        "type": "about:blank",
        "title": "Too many tries",
        "status": 429,
        "detail": "Too many tries. Try again in 2 seconds.",
        "code": "too_many_attempts",
        "retry_after_seconds": 2,
    }
    world.clock.advance(seconds=1)
    assert retry_of(await sign_in(browser)) == 1  # what is left of it, rounded up
    world.clock.advance(seconds=1)  # the wait is over
    assert (await sign_in(browser)).status_code == 200


async def test_the_waits_double_to_a_minute_and_the_tenth_wrong_try_locks_for_fifteen_minutes(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    seen = []
    for _ in range(10):
        answer = await wrong(browser)
        assert answer.status_code == 401
        seen.append(retry_of(answer))
        if retry_of(answer):
            world.clock.advance(seconds=retry_of(answer) or 0)  # wait exactly as long as told
    assert seen == [None, None, 2, 4, 8, 16, 32, 60, 60, 900]

    locked = await user_row(world)
    assert locked.failed_attempts == 10
    assert locked.locked_until == world.clock.now  # we waited the 900 seconds too: it just ended
    # Start the lock again to look at it: one more wrong try after it ended locks it again.
    again = await wrong(browser)
    assert retry_of(again) == 900
    locked_at = world.clock.now

    # During the lock nothing is checked, even the right password, and the lock doesn't grow.
    world.clock.advance(minutes=14, seconds=59)
    answer = await sign_in(browser)
    assert (answer.status_code, retry_of(answer)) == (429, 1)
    assert answer.json()["detail"] == "Too many tries. Try again in 1 second."
    assert (await user_row(world)).locked_until == locked_at + timedelta(minutes=15)
    world.clock.advance(seconds=1)  # 15 minutes: over
    assert (await sign_in(browser)).status_code == 200
    ended = await user_row(world)
    assert (ended.failed_attempts, ended.locked_until) == (0, None)  # a right password ends it


async def test_the_lock_message_says_how_long_in_minutes(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await lock_the_account(world, browser)
    blocked = await sign_in(browser)
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Too many tries. Try again in 15 minutes."
    assert blocked.headers["retry-after"] == "900"


async def test_a_wrong_try_after_a_lock_ends_locks_again_and_each_lock_is_logged(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    for _ in range(10):
        answer = await wrong(browser)
        world.clock.advance(seconds=retry_of(answer) or 0)
    again = await wrong(browser)  # the lock just ended; this one is wrong
    assert retry_of(again) == 900
    locks = [e for e in await all_rows(world, AuditEntry) if e.event == "account_locked"]
    assert [e.details for e in locks] == [
        {"tries": 10, "minutes": 15},
        {"tries": 11, "minutes": 15},
    ]


async def test_a_right_password_in_between_starts_the_count_again(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    assert (await wrong(browser)).json() == PLAIN_401
    assert (await wrong(browser)).json() == PLAIN_401
    assert (await sign_in(browser)).status_code == 200  # before any wait
    for _ in range(2):  # two more slips are free again
        assert (await wrong(browser)).json() == PLAIN_401


async def test_a_try_during_a_wait_is_not_checked_not_counted_and_not_logged(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    hasher = counting(world)
    for _ in range(3):
        await wrong(browser)
    assert hasher.work == 3
    before = await user_row(world)
    entries = await log_count(world)
    assert (before.failed_attempts, entries) == (3, 4)  # the account's creation and 3 failures

    for number in range(25):  # during the 2-second wait, right and wrong alike
        answer = await (sign_in(browser) if number % 2 else wrong(browser))
        assert answer.status_code == 429
    assert hasher.work == 3  # no password was hashed or checked
    after = await user_row(world)
    assert (after.failed_attempts, after.locked_until) == (3, before.locked_until)
    assert await log_count(world) == entries  # and the log wasn't filled


async def test_the_limits_are_the_settings(world: World, browser: httpx.AsyncClient) -> None:
    world.settings(login_free_tries=0, login_lock_tries=3, login_lock_minutes=1)
    await make_account(world)
    seen = []
    for _ in range(3):
        answer = await wrong(browser)
        seen.append(retry_of(answer))
        world.clock.advance(seconds=retry_of(answer) or 0)
    assert seen == [2, 4, 60]  # the third try locks, for a minute


async def test_a_new_password_from_the_command_lifts_a_lock(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    await lock_the_account(world, browser)
    assert (await sign_in(browser)).status_code == 429
    async with world.factory() as db:
        saved = await db.get(User, user.id)
        assert saved is not None
        await admin.reset_password(
            db, saved, "river stone lantern copper orchard", now=world.clock.now, hasher=FAST
        )
    assert (
        await sign_in(browser, password="river stone lantern copper orchard")
    ).status_code == 200


async def test_the_failures_and_the_lock_are_in_the_log_without_what_was_typed(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    await lock_the_account(world, browser)
    entries = await all_rows(world, AuditEntry)
    failures = [e for e in entries if e.event == "sign_in_failed"]
    assert len(failures) == 10
    assert all(e.user_id == user.id and e.details == {"reason": "wrong"} for e in failures)
    assert [e.details for e in entries if e.event == "account_locked"] == [
        {"tries": 10, "minutes": 15}
    ]
    assert WRONG not in json.dumps([e.details for e in entries])


# --- A login that matches no account ----------------------------------------------------------


async def run_sequence(
    world: World, client: httpx.AsyncClient, login: str
) -> list[tuple[int, str, int | None, str | None]]:
    """12 wrong tries at one login, each followed by an early one, as a guesser would make them."""
    seen: list[tuple[int, str, int | None, str | None]] = []
    for _ in range(12):
        answer = await wrong(client, login)
        body = answer.json()
        seen.append((answer.status_code, body["code"], retry_of(answer), body["detail"]))
        wait = retry_of(answer)
        if wait:
            early = await wrong(client, login)  # too soon: refused without being checked
            seen.append(
                (early.status_code, early.json()["code"], retry_of(early), early.json()["detail"])
            )
            world.clock.advance(seconds=wait)
    return seen


async def test_a_login_with_no_account_is_slowed_and_locked_exactly_like_a_real_one(
    world: World,
) -> None:
    await make_account(world)
    hasher = counting(world)
    async with world.browser(ip="203.0.113.10") as one, world.browser(ip="203.0.113.11") as two:
        real = await run_sequence(world, one, "alkhair")
        work_for_the_real_one = hasher.work
        unknown = await run_sequence(world, two, "nobody-by-this-name")

    assert real == unknown  # every status, code, wait and sentence is the same
    assert [status for status, *_ in real[:3]] == [401, 401, 401]
    assert (429, "too_many_attempts", 2, "Too many tries. Try again in 2 seconds.") in real
    assert (429, "too_many_attempts", 900, "Too many tries. Try again in 15 minutes.") in real
    # And the work is the same: a real check for the real login, a dummy one for the other.
    assert hasher.checked == work_for_the_real_one
    assert hasher.burned == work_for_the_real_one


async def test_what_was_typed_as_an_unknown_login_is_never_saved(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    typed = "the-password-i-put-in-the-wrong-box"
    await sign_in(browser, login=typed, password=WRONG)
    unknown = world.app.state.unknown_logins
    assert len(unknown) == 1
    assert typed not in "".join(unknown._seen)  # remembered by a hash
    dump = json.dumps(
        [(e.event, e.details, e.ip, e.user_agent) for e in await all_rows(world, AuditEntry)]
    )
    assert typed not in dump


async def test_a_switched_off_account_is_slowed_and_locked_too(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    async with world.factory() as db:
        saved = await db.get(User, user.id)
        assert saved is not None
        saved.active = False
        await db.commit()
    seen = []
    for _ in range(4):
        answer = await sign_in(browser)  # the right password, but the account is off
        seen.append((answer.status_code, retry_of(answer)))
        world.clock.advance(seconds=retry_of(answer) or 0)
    assert seen == [(401, None), (401, None), (401, 2), (401, 4)]


# --- Many tries at once -----------------------------------------------------------------------


async def test_a_burst_of_parallel_tries_cannot_get_past_the_count(world: World) -> None:
    """The account's row is locked while a try is checked, so the tries are checked one after the
    other, and the count moves between them."""
    await make_account(world)
    hasher = counting(world)
    async with world.browser() as client:
        answers = await asyncio.gather(*(wrong(client) for _ in range(24)))
    statuses = sorted(answer.status_code for answer in answers)
    assert statuses == [401] * 3 + [429] * 21  # two free tries, the third starts the wait
    assert hasher.checked == 3
    assert (await user_row(world)).failed_attempts == 3


async def test_a_burst_at_a_login_with_no_account_is_counted_the_same_way(world: World) -> None:
    await make_account(world)
    hasher = counting(world)
    async with world.browser() as client:
        answers = await asyncio.gather(*(wrong(client, "nobody") for _ in range(24)))
    assert sorted(answer.status_code for answer in answers) == [401] * 3 + [429] * 21
    assert hasher.burned == 3


# --- One IP address ---------------------------------------------------------------------------


async def test_an_address_that_keeps_failing_waits_until_its_oldest_failure_leaves(
    world: World,
) -> None:
    world.settings(login_ip_max_failures=5)
    await make_account(world)
    hasher = counting(world)
    async with world.browser(ip="203.0.113.5") as guesser, world.browser(ip="203.0.113.6") as other:
        for number in range(5):  # five logins, so none of them is slowed by its own count
            assert (await wrong(guesser, f"guess-{number}")).status_code == 401
            world.clock.advance(seconds=10)
        world.clock.advance(seconds=-10)  # now: 9:00:40, the fifth failure's time

        # The address is at its limit: even the right password for the real account waits.
        blocked = await sign_in(guesser)
        assert blocked.status_code == 429
        assert blocked.json()["retry_after_seconds"] == 860  # until 9:15:00
        assert blocked.json()["detail"] == "Too many tries. Try again in 15 minutes."
        assert blocked.headers["retry-after"] == "860"
        work, entries = hasher.work, await log_count(world)
        for _ in range(30):
            assert (await wrong(guesser)).status_code == 429
        assert (hasher.work, await log_count(world)) == (work, entries)  # no work, no log rows

        # Another address is not affected.
        assert (await sign_in(other)).status_code == 200

        # When the oldest failure leaves the window, the address may try again.
        world.clock.advance(seconds=860)  # 9:15:00: the failure at 9:00:00 is out
        assert (await sign_in(guesser)).status_code == 200
        # One wrong try fills the window again (4 older ones and this one).
        assert (await wrong(guesser)).status_code == 401
        again = await sign_in(guesser)
        assert (again.status_code, retry_of(again)) == (429, 10)  # until the one at 9:00:10 leaves


async def test_only_wrong_tries_count_against_an_address(
    world: World, browser: httpx.AsyncClient
) -> None:
    world.settings(login_ip_max_failures=5)
    await make_account(world)
    for _ in range(12):  # twelve sign-ins in a row: none is a failure
        assert (await sign_in(browser)).status_code == 200
    assert (await wrong(browser)).status_code == 401  # the first wrong try is free and counted


async def test_the_limit_for_an_address_is_the_setting(world: World) -> None:
    world.settings(login_ip_max_failures=5, login_ip_window_minutes=1)
    await make_account(world)
    async with world.browser(ip="203.0.113.7") as client:
        for number in range(5):
            await wrong(client, f"guess-{number}")
        assert (await sign_in(client)).status_code == 429
        world.clock.advance(minutes=1)  # the window is a minute, so they have all left it
        assert (await sign_in(client)).status_code == 200


# --- What is logged ---------------------------------------------------------------------------


async def test_no_log_line_holds_a_password_or_a_token(
    world: World, browser: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    await make_account(world)
    typed = "a wrong password typed here"
    for _ in range(4):
        await sign_in(browser, password=typed)
    world.clock.advance(seconds=10)
    ok = await sign_in(browser)
    token = ok.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
    await browser.get(f"{API}/me")
    await browser.post(f"{API}/logout")
    await sign_in(browser, login="nobody", password=typed)

    logged = json.dumps(
        [
            {"message": record.getMessage(), **{k: str(v) for k, v in record.__dict__.items()}}
            for record in caplog.records
        ]
    )
    assert len(caplog.records) > 0  # the test saw the app's logging, and found nothing to hide
    for secret in (GOOD, typed, token, "contour_session="):
        assert secret not in logged, secret
