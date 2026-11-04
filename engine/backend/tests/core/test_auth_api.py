"""Signing in and out through the API (PLAN-V6 B3), on the test database.

The app is the real one, with a clock the test can move, a cheap password hasher and a fresh
database session for every request (see `auth_world.py`). The browser is an httpx client: it keeps
cookies the way a browser does, so a test signs in once and its next requests carry the cookie.

Every password here is made up.
"""

import hashlib
import re
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from core.api.app import create_app
from core.auth import admin
from core.auth.models import AuditEntry, User, UserSession
from core.auth.passwords import Hasher
from tests.core.auth_world import (
    API,
    CHROME,
    FAST,
    FIREFOX,
    GOOD,
    START,
    World,
    all_rows,
    make_account,
    me,
    moment,
    sign_in,
    token_in,
)

pytestmark = pytest.mark.integration


# --- Signing in -------------------------------------------------------------------------------


async def test_signing_in_sets_the_cookie_and_answers_with_the_user_and_the_session(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    response = await sign_in(browser)
    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {
        "id": str(user.id),
        "email": "al.khair@example.test",
        "username": "alkhair",
        "name": "Al Khair",
        "role": "admin",
    }
    session = body["session"]
    assert (session["current"], session["keep_signed_in"]) == (True, False)
    assert session["idle_timeout_seconds"] == 7200
    assert (session["device"], session["ip"]) == ("Chrome on Windows", "127.0.0.1")
    assert moment(session["expires_at"]) == START + timedelta(hours=12)

    # The cookie: plain over http, HttpOnly, SameSite=Strict, and it goes when the browser closes.
    cookie = response.headers["set-cookie"]
    assert re.fullmatch(
        r"contour_session=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Strict", cookie
    )
    token = token_in(response)

    # The database holds only the token's hash, and the sign-in is in the log.
    (row,) = await all_rows(world, UserSession)
    assert row.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert row.token_hash != token
    assert (row.created_at, row.last_seen_at, row.remember) == (START, START, False)
    assert (row.ip, row.user_agent, row.ended_at) == ("127.0.0.1", CHROME, None)
    (saved,) = await all_rows(world, User)
    assert saved.last_signed_in_at == START
    entries = [e for e in await all_rows(world, AuditEntry) if e.event == "sign_in"]
    assert [(e.user_id, e.ip, e.user_agent, e.details) for e in entries] == [
        (user.id, "127.0.0.1", CHROME, {"keep_signed_in": False})
    ]


async def test_the_login_works_with_the_email_or_the_username_in_any_case(world: World) -> None:
    await make_account(world)
    for typed in ("al.khair@example.test", "AL.KHAIR@Example.TEST", "alkhair", " AlKhair "):
        async with world.browser() as client:
            response = await sign_in(client, login=typed)
            assert response.status_code == 200, typed
            assert (await me(client)).json()["user"]["email"] == "al.khair@example.test"


async def test_a_wrong_password_an_unknown_login_and_a_switched_off_account_get_one_answer(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    other = await make_account(world, email="off@example.test", username="offline")
    async with world.factory() as db:
        switched_off = await db.get(User, other.id)
        assert switched_off is not None
        switched_off.active = False
        await db.commit()

    attempts = [
        {"login": "alkhair", "password": "not the password at all"},
        {"login": "nobody@example.test", "password": GOOD},
        {"login": "offline", "password": GOOD},  # the right password, but the account is off
        {"login": "offline", "password": "wrong as well"},
    ]
    answers = [await browser.post(f"{API}/login", json=body) for body in attempts]
    for answer in answers:
        assert answer.status_code == 401
        assert "set-cookie" not in answer.headers
        assert answer.headers["content-type"].startswith("application/problem+json")
        assert answer.json() == {
            "type": "about:blank",
            "title": "Sign-in failed",
            "status": 401,
            "detail": "That email or password isn't right.",
            "code": "invalid_credentials",
        }
        assert answer.text == answers[0].text  # not a word differs
    assert await all_rows(world, UserSession) == []

    # The log says which it was, for the Admin: that is not for the person who tried.
    failures = [e for e in await all_rows(world, AuditEntry) if e.event == "sign_in_failed"]
    assert [e.details["reason"] for e in failures] == [
        "wrong",
        "unknown_login",
        "inactive",
        "inactive",
    ]
    assert [e.user_id is None for e in failures] == [False, True, False, False]
    assert all(e.ip == "127.0.0.1" for e in failures)
    for entry in failures:
        assert "login" not in entry.details  # what was typed is never saved: it may be a password
        for value in entry.details.values():
            assert GOOD not in str(value)


async def test_every_sign_in_gets_a_new_token_even_with_an_old_cookie_in_the_browser(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    first = token_in(await sign_in(browser))
    second = token_in(await sign_in(browser))  # the first cookie is still in the browser's jar
    planted = token_in(await sign_in(browser, login="al.khair@example.test"))
    assert len({first, second, planted}) == 3
    assert len(await all_rows(world, UserSession)) == 3


async def test_keep_me_signed_in_gives_a_cookie_that_outlives_the_browser(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    response = await sign_in(browser, keep_signed_in=True)
    assert response.headers["set-cookie"].endswith("; Max-Age=1209600")  # 14 days
    session = response.json()["session"]
    assert (session["keep_signed_in"], session["idle_timeout_seconds"]) == (True, None)
    assert moment(session["expires_at"]) == START + timedelta(days=14)
    (row,) = await all_rows(world, UserSession)
    assert row.remember is True


async def test_an_old_hash_is_saved_again_with_todays_settings_at_the_next_sign_in(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    today = Hasher(time_cost=2, memory_cost=16, parallelism=1)
    world.app.state.hasher = today
    async with world.factory() as db:
        first = await db.get(User, user.id)
        assert first is not None
        before = first.password_hash
    assert today.needs_rehash(before)  # made with the cheaper settings
    assert (await sign_in(browser)).status_code == 200
    async with world.factory() as db:
        saved = await db.get(User, user.id)
        assert saved is not None
        assert saved.password_hash != before
        assert not today.needs_rehash(saved.password_hash)
        assert today.verify(saved.password_hash, GOOD) == (True, False)  # the same password
        assert saved.password_changed_at == START  # the person didn't change it


async def test_a_bad_request_is_a_422_that_never_repeats_the_password(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    secret = "hunter2 hunter2 hunter2"
    bad = [
        {"login": "", "password": secret},
        {"login": "alkhair", "password": ""},
        {"login": "alkhair"},
        {"login": "x" * 255, "password": secret},
        {"login": "alkhair", "password": secret * 100},  # 2,300 characters
        {"login": "al\x00khair", "password": secret},
        {"login": "alkhair", "password": "a\x00b"},
        {"login": ["alkhair"], "password": secret},
    ]
    for body in bad:
        response = await browser.post(f"{API}/login", json=body)
        assert response.status_code == 422, body
        assert response.headers["content-type"].startswith("application/problem+json")
        assert secret not in response.text
    assert (await browser.post(f"{API}/login")).status_code == 422  # no body at all
    assert (await browser.post(f"{API}/login", content=b"not json")).status_code == 422
    assert await all_rows(world, UserSession) == []


async def test_a_secure_cookie_is_host_prefixed_and_only_travels_over_https(world: World) -> None:
    world.settings(session_cookie_secure=True)
    await make_account(world)
    async with world.browser(base_url="https://localhost") as client:
        response = await sign_in(client)
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert re.fullmatch(
            r"__Host-contour_session=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Strict; Secure",
            cookie,
        )
        assert "Domain" not in cookie
        assert (await me(client)).status_code == 200  # the jar sends it back over https
        # The same cookie sent by hand under the plain name isn't a session.
        token = token_in(response)
    async with world.browser(base_url="https://localhost") as other:
        found = await other.get(f"{API}/me", headers={"Cookie": f"contour_session={token}"})
        assert found.status_code == 401
        assert "reason" not in found.json()


# --- Who am I ---------------------------------------------------------------------------------


async def test_me_says_who_is_signed_in(world: World, browser: httpx.AsyncClient) -> None:
    await make_account(world)
    await sign_in(browser)
    body = (await me(browser)).json()
    assert body["auth_required"] is True
    assert body["user"]["email"] == "al.khair@example.test"
    assert (body["session"]["current"], body["session"]["device"]) == (True, "Chrome on Windows")


async def test_without_a_session_me_is_a_401_that_names_its_code(
    world: World, browser: httpx.AsyncClient
) -> None:
    response = await me(browser)
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json() == {
        "type": "about:blank",
        "title": "Sign in needed",
        "status": 401,
        "detail": "Sign in to use Contour HQ.",
        "code": "auth_required",
    }
    assert "set-cookie" not in response.headers  # there was no cookie to drop


async def test_where_sign_in_is_off_me_says_so_and_nothing_needs_a_session(
    world: World, browser: httpx.AsyncClient
) -> None:
    world.settings(auth_required=False)
    assert (await me(browser)).json() == {"auth_required": False, "user": None, "session": None}
    # A person can still sign in there (to try it), and then me knows them.
    await make_account(world)
    assert (await sign_in(browser)).status_code == 200
    body = (await me(browser)).json()
    assert (body["auth_required"], body["user"]["name"]) == (False, "Al Khair")


# --- The two time limits ----------------------------------------------------------------------


async def test_two_hours_idle_signs_a_person_out_but_activity_keeps_them_in(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await sign_in(browser)
    world.clock.advance(minutes=119)
    assert (await me(browser)).status_code == 200
    world.clock.advance(minutes=119)  # 238 minutes after signing in, but never 2 hours idle
    assert (await me(browser)).status_code == 200
    world.clock.advance(hours=2)
    late = await me(browser)
    assert late.status_code == 401
    assert late.json()["code"] == "auth_required"
    assert late.json()["reason"] == "idle"
    assert late.json()["detail"] == "You were signed out after 2 hours idle."
    # The browser is told to drop the dead cookie.
    assert late.headers["set-cookie"].startswith("contour_session=;")
    assert "Max-Age=0" in late.headers["set-cookie"]
    assert "contour_session" not in browser.cookies  # so the next request carries none
    assert (await me(browser)).json().get("reason") is None


async def test_twelve_hours_is_the_longest_even_with_constant_activity(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await sign_in(browser)
    for _ in range(11):  # a request every hour, up to 11 hours
        world.clock.advance(hours=1)
        assert (await me(browser)).status_code == 200
    world.clock.advance(minutes=59)
    assert (await me(browser)).status_code == 200  # 11 hours 59 minutes
    world.clock.advance(minutes=1)
    late = await me(browser)
    assert late.status_code == 401
    assert late.json()["reason"] == "expired"
    assert late.json()["detail"] == "Your session ended after 12 hours. Sign in again."


async def test_keep_me_signed_in_has_no_idle_limit_and_ends_after_14_days(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await sign_in(browser, keep_signed_in=True)
    world.clock.advance(days=3)  # idle for 3 days: a normal session would be long gone
    still = await me(browser)
    assert still.status_code == 200
    assert still.json()["session"]["keep_signed_in"] is True
    world.clock.advance(
        days=10, hours=23, minutes=59
    )  # 13 days 23 hours 59 minutes since signing in
    assert (await me(browser)).status_code == 200
    world.clock.advance(minutes=1)  # 14 days since signing in
    late = await me(browser)
    assert (late.status_code, late.json()["reason"]) == (401, "expired")
    assert late.json()["detail"] == "Your session ended after 14 days. Sign in again."


async def test_the_session_times_are_the_settings(world: World) -> None:
    world.settings(session_idle_minutes=30, session_max_hours=2)
    await make_account(world)
    async with world.browser() as client:
        await sign_in(client)
        world.clock.advance(minutes=29)
        assert (await me(client)).status_code == 200
        world.clock.advance(minutes=30)
        late = await me(client)
        assert (late.json()["reason"], late.json()["detail"]) == (
            "idle",
            "You were signed out after 30 minutes idle.",
        )
    async with world.browser() as client:
        await sign_in(client)
        for _ in range(3):
            world.clock.advance(minutes=29)
            assert (await me(client)).status_code == 200
        world.clock.advance(minutes=33)  # 2 hours since signing in (3 x 29 + 33 = 120)
        late = await me(client)
        assert late.json()["detail"] == "Your session ended after 2 hours. Sign in again."


async def test_last_seen_is_written_at_most_once_a_minute(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await sign_in(browser)

    async def last_seen() -> datetime:
        (row,) = await all_rows(world, UserSession)
        seen: datetime = row.last_seen_at
        return seen

    world.clock.advance(seconds=30)
    await me(browser)
    assert await last_seen() == START  # less than a minute: not written
    world.clock.advance(seconds=31)
    await me(browser)
    assert await last_seen() == START + timedelta(seconds=61)
    world.clock.advance(seconds=29)
    await me(browser)
    assert await last_seen() == START + timedelta(seconds=61)  # not again so soon
    world.clock.advance(seconds=31)
    await me(browser)
    assert await last_seen() == START + timedelta(seconds=121)


async def test_a_dead_cookie_is_refused_whatever_it_looks_like(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    token = token_in(await sign_in(browser))
    other = world.browser()
    async with other:
        for cookie in (
            "contour_session=not-a-real-token",
            f"contour_session={token[:-1]}{'A' if token[-1] != 'A' else 'B'}",  # one character off
            "contour_session=" + "a" * 5000,  # far too long to be a token
            f"evil_contour_session={token}",  # another cookie's name
        ):
            answer = await other.get(f"{API}/me", headers={"Cookie": cookie})
            assert answer.status_code == 401, cookie
            assert answer.json()["code"] == "auth_required"
            assert "reason" not in answer.json()  # nothing is said about a token that isn't one
        # The token is only read from the cookie, never from anywhere else.
        elsewhere: list[dict[str, Any]] = [
            {"headers": {"Authorization": f"Bearer {token}"}},
            {"headers": {"X-Session": token}},
            {"params": {"contour_session": token}},
            {"params": {"token": token}},
        ]
        for how in elsewhere:
            assert (await other.get(f"{API}/me", **how)).status_code == 401, how


async def test_a_switched_off_account_is_signed_out_at_its_next_request(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    await sign_in(browser)
    async with world.factory() as db:
        saved = await db.get(User, user.id)
        assert saved is not None
        saved.active = False
        await db.commit()
    late = await me(browser)
    assert (late.status_code, late.json()["reason"]) == (401, "ended")


async def test_a_new_password_from_the_command_signs_every_browser_out(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    await sign_in(browser)
    async with world.factory() as db:
        saved = await db.get(User, user.id)
        assert saved is not None
        await admin.reset_password(
            db, saved, "river stone lantern copper orchard", now=world.clock.now, hasher=FAST
        )
    late = await me(browser)
    assert (late.status_code, late.json()["reason"]) == (401, "ended")
    assert (await sign_in(browser)).status_code == 401  # the old password is gone
    assert (
        await sign_in(browser, password="river stone lantern copper orchard")
    ).status_code == 200


# --- Signing out ------------------------------------------------------------------------------


async def test_signing_out_ends_the_session_for_good_and_drops_the_cookie(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    token = token_in(await sign_in(browser))
    world.clock.advance(minutes=5)
    response = await browser.post(f"{API}/logout")
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["set-cookie"].startswith("contour_session=;")
    assert "Max-Age=0" in response.headers["set-cookie"]
    (row,) = await all_rows(world, UserSession)
    assert row.ended_at == world.clock.now
    out = [e for e in await all_rows(world, AuditEntry) if e.event == "sign_out"]
    assert [(e.user_id, e.ip) for e in out] == [(user.id, "127.0.0.1")]

    # Taking the old cookie back (a stolen copy, or a back button) gets nothing.
    async with world.browser() as thief:
        answer = await thief.get(f"{API}/me", headers={"Cookie": f"contour_session={token}"})
        assert answer.status_code == 401
        assert answer.json()["reason"] == "ended"
        assert answer.json()["detail"] == "You were signed out. Sign in again."


async def test_signing_out_where_sign_in_is_off_has_nothing_to_end(
    world: World, browser: httpx.AsyncClient
) -> None:
    world.settings(auth_required=False)
    response = await browser.post(f"{API}/logout")
    assert response.status_code == 204
    assert (await browser.post(f"{API}/logout-everywhere")).json() == {"sessions_ended": 0}


async def test_signing_out_everywhere_ends_every_browser(world: World) -> None:
    user = await make_account(world)
    async with (
        world.browser(CHROME) as laptop,
        world.browser(FIREFOX) as desk,
        world.browser("curl/8.5.0") as phone,
    ):
        for client in (laptop, desk, phone):
            assert (await sign_in(client)).status_code == 200
            world.clock.advance(minutes=1)
        listed = (await laptop.get(f"{API}/sessions")).json()
        assert listed["total"] == 3
        assert [(i["device"], i["current"]) for i in listed["items"]] == [
            ("Chrome on Windows", True),  # it just asked, so it was seen last
            ("curl", False),
            ("Firefox on Linux", False),
        ]

        answer = await desk.post(f"{API}/logout-everywhere")
        assert answer.status_code == 200
        assert answer.json() == {"sessions_ended": 3}
        assert answer.headers["set-cookie"].startswith("contour_session=;")

        # The other two still hold a cookie, which is now dead. The one that asked dropped its own.
        for client in (laptop, phone):
            late = await me(client)
            assert (late.status_code, late.json()["reason"]) == (401, "ended")
        assert "reason" not in (await me(desk)).json()
    rows = await all_rows(world, UserSession)
    assert len(rows) == 3
    assert all(row.ended_at == world.clock.now for row in rows)
    entries = [e for e in await all_rows(world, AuditEntry) if e.event == "sign_out_everywhere"]
    assert [(e.user_id, e.details) for e in entries] == [
        (user.id, {"by": "person", "sessions_ended": 3})
    ]


# --- The list of sessions ---------------------------------------------------------------------


async def test_the_list_shows_this_persons_live_sessions_and_marks_the_asking_one(
    world: World,
) -> None:
    await make_account(world)
    await make_account(world, email="bo@example.test", username="bo-b")
    async with (
        world.browser(CHROME) as laptop,
        world.browser(FIREFOX) as desk,
        world.browser("curl/8.5.0") as signed_out,
        world.browser() as someone_else,
    ):
        await sign_in(laptop)  # at 9:00
        world.clock.advance(minutes=10)
        await sign_in(desk)  # at 9:10
        await sign_in(signed_out)
        await signed_out.post(f"{API}/logout")  # ended, so it isn't listed
        await sign_in(someone_else, login="bo-b")  # another person's, so it isn't listed
        world.clock.advance(minutes=5)
        page = (await desk.get(f"{API}/sessions")).json()

    assert page["total"] == len(page["items"]) == 2
    first, second = page["items"]  # the most recently used first: the desk, which just asked
    assert (first["device"], first["current"]) == ("Firefox on Linux", True)
    assert (second["device"], second["current"]) == ("Chrome on Windows", False)
    assert (second["ip"], second["user_agent"]) == ("127.0.0.1", CHROME)
    assert moment(first["last_seen_at"]) == START + timedelta(minutes=15)
    assert moment(second["last_seen_at"]) == START  # the laptop has been quiet since 9:00
    for item in page["items"]:
        assert set(item) == {
            "id",
            "current",
            "device",
            "user_agent",
            "ip",
            "created_at",
            "last_seen_at",
            "expires_at",
            "keep_signed_in",
            "idle_timeout_seconds",
        }


async def test_the_list_leaves_out_a_session_that_ran_out_or_sat_idle(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    async with world.browser(FIREFOX) as idle:
        await sign_in(idle)
        world.clock.advance(hours=3)  # idle for 3 hours: dead, though never signed out
        await sign_in(browser)
        page = (await browser.get(f"{API}/sessions")).json()
    assert page["total"] == 1
    assert page["items"][0]["current"] is True


async def test_where_sign_in_is_off_the_list_is_empty(
    world: World, browser: httpx.AsyncClient
) -> None:
    world.settings(auth_required=False)
    assert (await browser.get(f"{API}/sessions")).json() == {"total": 0, "items": []}


# --- The sign-in log --------------------------------------------------------------------------


async def test_the_log_lists_what_happened_newest_first_with_who_and_from_where(
    world: World, browser: httpx.AsyncClient
) -> None:
    user = await make_account(world)
    world.clock.advance(minutes=1)
    await browser.post(f"{API}/login", json={"login": "nobody@example.test", "password": "x" * 15})
    world.clock.advance(minutes=1)
    await sign_in(browser)
    world.clock.advance(minutes=1)
    page = (await browser.get(f"{API}/log")).json()
    assert page["total"] == 3
    newest, middle, oldest = page["items"]
    assert [i["event"] for i in page["items"]] == ["sign_in", "sign_in_failed", "account_created"]
    assert newest["user"]["id"] == str(user.id)
    assert (newest["ip"], newest["device"]) == ("127.0.0.1", "Chrome on Windows")
    assert newest["details"] == {"keep_signed_in": False}
    assert middle["user"] is None  # a login that matched no account
    assert middle["details"] == {"reason": "unknown_login"}
    assert (oldest["user"]["email"], oldest["ip"], oldest["device"]) == (
        "al.khair@example.test",
        None,
        "Unknown device",
    )
    assert moment(newest["created_at"]) > moment(middle["created_at"])
    assert set(newest) == {"id", "created_at", "event", "user", "ip", "device", "details"}
    text_of_all = str(page)
    assert GOOD not in text_of_all
    assert "x" * 15 not in text_of_all


async def test_the_log_is_paged(world: World, browser: httpx.AsyncClient) -> None:
    await make_account(world)
    for _ in range(4):
        world.clock.advance(minutes=1)
        await sign_in(browser)
    everything = (await browser.get(f"{API}/log", params={"limit": 200})).json()
    assert everything["total"] == 5 == len(everything["items"])
    second = (await browser.get(f"{API}/log", params={"limit": 2, "offset": 1})).json()
    assert second["total"] == 5
    assert [i["id"] for i in second["items"]] == [i["id"] for i in everything["items"][1:3]]
    assert (await browser.get(f"{API}/log", params={"limit": 201})).status_code == 422
    assert (await browser.get(f"{API}/log", params={"limit": 0})).status_code == 422
    assert (await browser.get(f"{API}/log", params={"offset": -1})).status_code == 422
    assert len((await browser.get(f"{API}/log")).json()["items"]) == 5  # the default is 100


async def test_only_an_admin_may_read_the_log(world: World) -> None:
    await make_account(world, email="boss@example.test", username="boss")
    async with world.factory() as db:  # a staff member, made by hand (only Admins exist today)
        db.add(
            User(
                email="staff@example.test",
                username="staffer",
                name="Staff",
                role="staff",
                password_hash=FAST.hash(GOOD),
            )
        )
        await db.commit()
    async with world.browser() as staff, world.browser() as boss, world.browser() as nobody:
        assert (await sign_in(staff, login="staffer")).status_code == 200
        assert (await sign_in(boss, login="boss")).status_code == 200
        refused = await staff.get(f"{API}/log")
        assert refused.status_code == 403
        assert refused.json()["code"] == "admin_only"
        assert (await me(staff)).status_code == 200  # a staff member can still use the rest
        assert (await boss.get(f"{API}/log")).status_code == 200
        assert (await nobody.get(f"{API}/log")).status_code == 401


async def test_where_sign_in_is_off_the_log_is_open_like_everything_else(
    world: World, browser: httpx.AsyncClient
) -> None:
    world.settings(auth_required=False)
    assert (await browser.get(f"{API}/log")).status_code == 200


# --- Nothing secret is kept -------------------------------------------------------------------


async def test_the_raw_token_and_the_password_are_never_saved_or_logged(
    world: World, browser: httpx.AsyncClient
) -> None:
    await make_account(world)
    await browser.post(f"{API}/login", json={"login": "alkhair", "password": "a wrong try here"})
    token = token_in(await sign_in(browser))
    await browser.post(f"{API}/logout")
    async with world.factory() as db:
        dump = ""
        for table in ("core.users", "core.sessions", "core.audit_log"):
            rows = await db.execute(text(f"SELECT row_to_json(t)::text FROM {table} t"))
            dump += " ".join(row[0] for row in rows)
    for secret in (token, GOOD, "a wrong try here"):
        assert secret not in dump
    assert hashlib.sha256(token.encode()).hexdigest() in dump  # only the hash is there


# --- What the API file says -------------------------------------------------------------------


def test_the_routes_are_documented_with_their_answers() -> None:
    schema = create_app().openapi()
    paths = schema["paths"]
    login = paths[f"{API}/login"]["post"]
    assert login["summary"] == "Sign in"
    assert login["tags"] == ["auth"]
    assert "invalid_credentials" in login["responses"]["401"]["description"]
    body = schema["components"]["schemas"]["LoginRequest"]
    assert set(body["properties"]) == {"login", "password", "keep_signed_in"}
    assert body["required"] == ["login", "password"]
    assert paths[f"{API}/logout"]["post"]["responses"]["204"]
    assert paths[f"{API}/logout-everywhere"]["post"]["summary"] == "Sign out of every browser"
    assert set(schema["components"]["schemas"]["MeOut"]["properties"]) == {
        "auth_required",
        "user",
        "session",
    }
    problem = schema["components"]["schemas"]["ProblemDetails"]["properties"]
    assert {"reason", "retry_after_seconds"} <= set(problem)
