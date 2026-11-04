"""The small parts of the sign-in that need no database: the sentences, the cookie text, the
limits, the token and the browser names (PLAN-V6 B3)."""

import re
from datetime import UTC, datetime, timedelta
from typing import Any, get_args

import pytest

from core.api.auth import Event, Role
from core.auth import clean, cookies, words
from core.auth.models import AUDIT_EVENTS, ROLES, UserSession
from core.auth.sessions import (
    TOUCH_EVERY,
    Limits,
    hash_token,
    is_live,
    new_token,
)
from core.config import Settings

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


# --- The sentences ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("span", "text"),
    [
        (timedelta(hours=2), "2 hours"),
        (timedelta(hours=1), "1 hour"),
        (timedelta(minutes=90), "90 minutes"),
        (timedelta(minutes=1), "1 minute"),
        (timedelta(hours=12), "12 hours"),
        (timedelta(days=14), "14 days"),
        (timedelta(days=1), "1 day"),
        (timedelta(hours=36), "36 hours"),
        (timedelta(seconds=10), "1 minute"),  # never "0 minutes"
    ],
)
def test_a_length_of_time_is_said_in_the_whole_unit_it_fits(span: timedelta, text: str) -> None:
    assert words.duration(span) == text


@pytest.mark.parametrize(
    ("seconds", "text"),
    [
        (0.2, "1 second"),
        (1, "1 second"),
        (30, "30 seconds"),
        (59.1, "1 minute"),  # rounds up to 60 seconds, which reads better as a minute
        (60, "1 minute"),
        (61, "2 minutes"),  # rounded up: never tell someone to try again too early
        (720, "12 minutes"),
        (721, "13 minutes"),
        (900, "15 minutes"),
    ],
)
def test_a_wait_is_rounded_up(seconds: float, text: str) -> None:
    assert words.wait(seconds) == text


def test_the_sentences_are_the_ones_the_login_page_shows() -> None:
    assert words.INVALID_LOGIN == "That email or password isn't right."
    assert words.too_many_tries(720) == "Too many tries. Try again in 12 minutes."
    assert words.signed_out_idle(timedelta(hours=2)) == "You were signed out after 2 hours idle."
    assert words.signed_out_expired(timedelta(hours=12)) == (
        "Your session ended after 12 hours. Sign in again."
    )
    assert words.SIGN_IN_NEEDED == "Sign in to use Contour HQ."


# --- The cookie -------------------------------------------------------------------------------


def test_the_cookie_over_http_is_plain_and_http_only() -> None:
    text = cookies.set_cookie("abc", secure=False, max_age=None)
    assert text == "contour_session=abc; Path=/; HttpOnly; SameSite=Strict"
    assert "Secure" not in text
    assert "Max-Age" not in text  # a session cookie: it goes when the browser closes


def test_the_cookie_over_https_is_host_prefixed_and_secure() -> None:
    text = cookies.set_cookie("abc", secure=True, max_age=None)
    assert text == "__Host-contour_session=abc; Path=/; HttpOnly; SameSite=Strict; Secure"
    assert "Domain" not in text  # a __Host- cookie must have no Domain, Path=/ and Secure


def test_keep_me_signed_in_gives_the_cookie_a_life() -> None:
    assert cookies.set_cookie("abc", secure=True, max_age=1_209_600).endswith("; Max-Age=1209600")


def test_the_clearing_cookie_matches_the_one_it_clears() -> None:
    """A browser only removes a cookie that has the same name, path and (for __Host-) Secure."""
    for secure in (False, True):
        gone = cookies.clear_cookie(secure=secure)
        made = cookies.set_cookie("abc", secure=secure, max_age=None)
        assert gone.split(";")[0] == f"{cookies.cookie_name(secure)}="
        for attribute in ("Path=/", "HttpOnly", "SameSite=Strict") + (
            ("Secure",) if secure else ()
        ):
            assert attribute in gone
            assert attribute in made
        assert "Max-Age=0" in gone
        assert "1970" in gone


def test_the_token_is_found_in_a_cookie_header_by_the_exact_name() -> None:
    assert cookies.read_token("contour_session=abc", secure=False) == "abc"
    assert cookies.read_token("a=1; contour_session=abc; b=2", secure=False) == "abc"
    assert cookies.read_token("__Host-contour_session=xyz", secure=True) == "xyz"
    # Not the other kind of cookie, and not a cookie that only ends with the name.
    assert cookies.read_token("__Host-contour_session=xyz", secure=False) is None
    assert cookies.read_token("contour_session=abc", secure=True) is None
    assert cookies.read_token("evil_contour_session=abc", secure=False) is None
    assert cookies.read_token("contour_session=", secure=False) is None
    assert cookies.read_token("", secure=False) is None
    assert cookies.read_token(None, secure=False) is None


# --- Tokens -----------------------------------------------------------------------------------


def test_a_token_is_256_bits_of_randomness_and_its_hash_is_sha256_hex() -> None:
    first, second = new_token(), new_token()
    assert first != second
    assert len(first) == 43  # 32 bytes in url-safe base64, without padding
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", first)
    digest = hash_token(first)
    assert re.fullmatch(r"[0-9a-f]{64}", digest)  # what the table's check wants
    assert digest != first
    assert hash_token(first) == digest  # the same token always finds its row
    assert hash_token(second) != digest


# --- Limits -----------------------------------------------------------------------------------


def test_the_limits_come_from_the_settings_and_default_to_the_plan() -> None:
    limits = Limits.from_settings(Settings(_env_file=None))
    assert limits.idle == timedelta(hours=2)
    assert limits.maximum == timedelta(hours=12)
    assert limits.remember == timedelta(days=14)
    assert limits.touch_every == TOUCH_EVERY == timedelta(seconds=60)
    changed = Limits.from_settings(
        Settings(
            _env_file=None, session_idle_minutes=30, session_max_hours=8, session_remember_days=7
        )
    )
    assert (changed.idle, changed.maximum, changed.remember) == (
        timedelta(minutes=30),
        timedelta(hours=8),
        timedelta(days=7),
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"session_idle_minutes": 4},
        {"session_idle_minutes": 1441},
        {"session_max_hours": 0},
        {"session_max_hours": 169},
        {"session_remember_days": 0},
        {"session_remember_days": 91},
    ],
)
def test_a_session_time_outside_its_bounds_is_refused(changes: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="session_"):
        Settings(_env_file=None, **changes)


def make_session(**changes: Any) -> UserSession:
    values: dict[str, Any] = {
        "created_at": NOW,
        "last_seen_at": NOW,
        "expires_at": NOW + timedelta(hours=12),
        "remember": False,
        "ended_at": None,
    }
    return UserSession(**{**values, **changes})


LIMITS = Limits(idle=timedelta(hours=2), maximum=timedelta(hours=12), remember=timedelta(days=14))


def test_a_session_is_live_until_it_ends_runs_out_or_sits_idle() -> None:
    session = make_session()
    assert is_live(session, NOW, LIMITS)
    assert is_live(session, NOW + timedelta(hours=1, minutes=59), LIMITS)
    assert not is_live(session, NOW + timedelta(hours=2), LIMITS)  # idle: exactly at the limit
    assert not is_live(make_session(ended_at=NOW), NOW, LIMITS)
    session = make_session(last_seen_at=NOW + timedelta(hours=11))
    assert is_live(session, NOW + timedelta(hours=11, minutes=59), LIMITS)
    assert not is_live(session, NOW + timedelta(hours=12), LIMITS)  # the longest: exactly there


def test_a_keep_me_signed_in_session_has_no_idle_limit() -> None:
    session = make_session(remember=True, expires_at=NOW + timedelta(days=14))
    assert is_live(session, NOW + timedelta(days=13), LIMITS)  # idle for 13 days
    assert not is_live(session, NOW + timedelta(days=14), LIMITS)  # but not for ever


# --- The API's lists agree with the tables ---------------------------------------------------


def test_the_roles_and_events_the_api_names_are_the_ones_the_tables_allow() -> None:
    assert get_args(Role) == tuple(ROLES)
    assert get_args(Event) == tuple(AUDIT_EVENTS)


# --- Browser names ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("agent", "name"),
    [
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Safari/537.36",
            "Chrome on Windows",
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
            "Edge on Windows",
        ),
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
            "Safari on iOS",
        ),
        (
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Mobile Safari/537.36",
            "Chrome on Android",
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
            "Firefox on Linux",
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.5 Safari/605.1.15",
            "Safari on macOS",
        ),
        ("curl/8.5.0", "curl"),
        ("python-httpx/0.28", "Unknown device"),
        ("", "Unknown device"),
        (None, "Unknown device"),
    ],
)
def test_a_browser_gets_a_short_name(agent: str | None, name: str) -> None:
    assert clean.device(agent) == name
