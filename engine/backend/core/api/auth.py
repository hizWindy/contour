"""The sign-in endpoints: sign in, sign out, who am I, my sessions and the sign-in log. PLAN-V6 B3.

The cookie holds a random token. Only its hash is saved. A session ends after 2 hours idle, after
12 hours at most, or after 14 days with "Keep me signed in" (which has no idle limit). The numbers
are settings (`session_idle_minutes`, `session_max_hours`, `session_remember_days`).

Every route here needs a session except `POST /auth/login`. Where sign-in is off
(`AUTH_REQUIRED=false`, the laptop's default), nothing needs one: `GET /auth/me` then says so, and
the routes that act on "my session" have nothing to do.
"""

import math
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field, StringConstraints

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX, OutModel, SafeText
from core.api.signin import (
    AdminDep,
    AuthSettingsDep,
    HasherDep,
    MaybeAuthDep,
    NowDep,
    UnknownLoginsDep,
    client_ip,
)
from core.auth import audit, clean, cookies, service, sessions, words
from core.auth.models import AuditEntry, User, UserSession
from core.auth.sessions import Limits
from core.auth.throttle import Rules
from core.config import Settings

router = APIRouter(prefix="/auth", tags=["auth"])

# The same lists as the tables' checks. A test keeps them equal.
Role = Literal["admin", "staff", "viewer"]
Event = Literal[
    "sign_in",
    "sign_in_failed",
    "account_locked",
    "sign_out",
    "sign_out_everywhere",
    "password_changed",
    "account_created",
    "account_changed",
]


class LoginRequest(BaseModel):
    login: Annotated[SafeText, StringConstraints(min_length=1, max_length=254)] = Field(
        description="The email or the username, in any case",
        examples=["name@company.com.au"],
    )
    password: Annotated[SafeText, StringConstraints(min_length=1, max_length=1024)] = Field(
        description="The password as typed. It is never saved or logged.",
        examples=["a few words in a row"],
    )
    keep_signed_in: bool = Field(
        False,
        description=(
            "Keep me signed in: the session has no idle limit and lasts up to 14 days "
            "(`session_remember_days`), and the cookie outlives the browser."
        ),
    )


class UserOut(OutModel):
    id: uuid.UUID
    email: str
    username: str | None = Field(description="The second way to sign in, if the account has one")
    name: str = Field(description="What the top bar shows")
    role: Role = Field(description="admin, staff or viewer")
    apps: list[str] = Field(
        default_factory=list,
        description="The projects this person may use, like lead_finder. An Admin may use all.",
    )


class SessionOut(OutModel):
    """One signed-in browser."""

    id: uuid.UUID
    current: bool = Field(description="This is the session that asked")
    device: str = Field(description='A short name for the browser, like "Chrome on Windows"')
    user_agent: str | None = Field(description="The browser's full name as it sent it, cut to 300")
    ip: str | None
    created_at: datetime
    last_seen_at: datetime = Field(description="Updated at most once a minute")
    expires_at: datetime = Field(description="The latest this session can last until")
    keep_signed_in: bool
    idle_timeout_seconds: int | None = Field(
        description="Signed out after this long without a request. Null: no idle limit"
    )


class LoginOut(OutModel):
    user: UserOut
    session: SessionOut


class MeOut(OutModel):
    """Who is signed in. `user` is null only where sign-in is off (`auth_required` false)."""

    auth_required: bool = Field(
        description="False: sign-in is off on this backend and nothing needs a session"
    )
    user: UserOut | None
    session: SessionOut | None


class SessionPage(OutModel):
    total: int
    items: list[SessionOut]


class SignedOut(OutModel):
    sessions_ended: int = Field(description="How many of your sessions were still live")


class LogEntryOut(OutModel):
    id: int
    created_at: datetime
    event: Event
    user: UserOut | None = Field(description="Null for a login that matched no account")
    ip: str | None
    device: str
    details: dict[str, Any] = Field(description="Facts only. Never a password or a token")


class LogPage(OutModel):
    total: int
    items: list[LogEntryOut]


# --- Shapes ---------------------------------------------------------------------------------


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        username=user.username,
        name=user.name,
        role=cast(Role, user.role),  # the table's check keeps it one of the three
        apps=list(user.apps or []),
    )


def session_out(session: UserSession, *, current: bool, limits: Limits) -> SessionOut:
    idle = None if session.remember else int(limits.idle.total_seconds())
    return SessionOut(
        id=session.id,
        current=current,
        device=clean.device(session.user_agent),
        user_agent=session.user_agent,
        ip=session.ip,
        created_at=session.created_at,
        last_seen_at=session.last_seen_at,
        expires_at=session.expires_at,
        keep_signed_in=session.remember,
        idle_timeout_seconds=idle,
    )


def _seconds(wait: timedelta) -> int:
    """A wait in whole seconds, rounded up: never tell someone to try again too early."""
    return max(1, math.ceil(wait.total_seconds()))


def _agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _cookie_life(session: UserSession, now: datetime) -> int | None:
    """A "Keep me signed in" cookie lives as long as its session. Any other goes with the
    browser."""
    if not session.remember:
        return None
    return max(0, int((session.expires_at - now).total_seconds()))


def _drop_cookie(response: Response, settings: Settings) -> None:
    response.headers.append(
        "set-cookie", cookies.clear_cookie(secure=settings.session_cookie_secure)
    )


# --- Routes ---------------------------------------------------------------------------------


@router.post(
    "/login",
    response_model=LoginOut,
    summary="Sign in",
    responses={
        200: {
            "description": "Signed in. The session cookie is set.",
            "headers": {
                "Set-Cookie": {
                    "description": (
                        "The session cookie: `contour_session` over http, or "
                        "`__Host-contour_session` over HTTPS. HttpOnly, SameSite=Strict, and "
                        "Secure over HTTPS. It lives until the browser closes, or for the "
                        "length of the session with `keep_signed_in`."
                    ),
                    "schema": {"type": "string"},
                }
            },
        },
        401: {
            "description": (
                "The login or the password isn't right (code `invalid_credentials`). When this "
                "wrong try makes the next ones wait, `retry_after_seconds` says how long."
            )
        },
        429: {
            "description": (
                "Too many wrong tries, from this address or at this login (code "
                "`too_many_attempts`). Nothing was checked. `retry_after_seconds` and the "
                "`Retry-After` header say how long to wait."
            )
        },
    },
)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: SessionDep,
    settings: AuthSettingsDep,
    hasher: HasherDep,
    unknown: UnknownLoginsDep,
    now: NowDep,
) -> LoginOut:
    """Signs in with an email or a username and a password, and sets the session cookie.

    The answer is the same, and takes as long, whether the login is unknown, the account is
    switched off or the password is wrong, so nobody can learn which accounts exist. A new token
    is made at every sign-in. This is the one route that needs no session.

    **Guessing is limited.** The first 2 wrong tries in a row cost nothing. Each one after that
    makes the next wait longer (2 seconds, doubling, up to a minute), and the 10th locks the login
    for 15 minutes. A login that matches no account is slowed and locked the same way, so the lock
    never says which accounts exist. One IP address may make 20 wrong tries in 15 minutes. A try
    made during a wait is answered 429 and isn't checked. A right password ends the count.
    """
    limits = Limits.from_settings(settings)
    try:
        result = await service.login(
            db,
            identifier=body.login,
            password=body.password,
            remember=body.keep_signed_in,
            ip=client_ip(request),
            user_agent=_agent(request),
            now=now,
            limits=limits,
            rules=Rules.from_settings(settings),
            unknown=unknown,
            hasher=hasher,
        )
    except service.TooManyTries as tries:
        seconds = _seconds(tries.retry_after)
        raise Problem(
            429,
            "Too many tries",
            words.too_many_tries(seconds),
            code="too_many_attempts",
            headers={"Retry-After": str(seconds)},
            retry_after_seconds=seconds,
        ) from None
    except service.InvalidLogin as wrong:
        wait = None if wrong.retry_after is None else _seconds(wrong.retry_after)
        raise Problem(
            401,
            "Sign-in failed",
            words.INVALID_LOGIN,
            code="invalid_credentials",
            retry_after_seconds=wait,
        ) from None
    response.headers.append(
        "set-cookie",
        cookies.set_cookie(
            result.token,
            secure=settings.session_cookie_secure,
            max_age=_cookie_life(result.session, now),
        ),
    )
    return LoginOut(
        user=user_out(result.user),
        session=session_out(result.session, current=True, limits=limits),
    )


@router.post("/logout", status_code=204, summary="Sign out of this browser")
async def logout(
    request: Request,
    response: Response,
    db: SessionDep,
    auth: MaybeAuthDep,
    settings: AuthSettingsDep,
    now: NowDep,
) -> None:
    """Ends this browser's session and drops its cookie. Where sign-in is off and no one is signed
    in there is nothing to end, and the answer is the same."""
    if auth is not None:
        await service.logout(db, auth, ip=client_ip(request), user_agent=_agent(request), now=now)
    _drop_cookie(response, settings)


@router.post("/logout-everywhere", response_model=SignedOut, summary="Sign out of every browser")
async def logout_everywhere(
    request: Request,
    response: Response,
    db: SessionDep,
    auth: MaybeAuthDep,
    settings: AuthSettingsDep,
    now: NowDep,
) -> SignedOut:
    """Ends every session of the signed-in user, this one too, and drops this browser's cookie."""
    ended = 0
    if auth is not None:
        ended = await service.logout_everywhere(
            db, auth, ip=client_ip(request), user_agent=_agent(request), now=now
        )
    _drop_cookie(response, settings)
    return SignedOut(sessions_ended=ended)


@router.get("/me", response_model=MeOut, summary="Who is signed in")
async def me(auth: MaybeAuthDep, settings: AuthSettingsDep) -> MeOut:
    """The signed-in user and this session. The website asks first, to know whether to show the
    sign-in page. With sign-in off on this backend, `auth_required` is false and `user` is null."""
    if auth is None:
        return MeOut(auth_required=settings.auth_required, user=None, session=None)
    return MeOut(
        auth_required=settings.auth_required,
        user=user_out(auth.user),
        session=session_out(auth.session, current=True, limits=Limits.from_settings(settings)),
    )


@router.get("/sessions", response_model=SessionPage, summary="Your signed-in browsers")
async def my_sessions(
    db: SessionDep,
    auth: MaybeAuthDep,
    settings: AuthSettingsDep,
    now: NowDep,
) -> SessionPage:
    """Every session of the signed-in user that can still be used, the most recently used first."""
    if auth is None:
        return SessionPage(total=0, items=[])
    limits = Limits.from_settings(settings)
    live = await sessions.open_for_user(db, auth.user.id, now=now, limits=limits)
    items = [
        session_out(session, current=session.id == auth.session.id, limits=limits)
        for session in live
    ]
    return SessionPage(total=len(items), items=items)


@router.get("/log", response_model=LogPage, summary="The sign-in log, newest first")
async def sign_in_log(
    db: SessionDep,
    admin: AdminDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> LogPage:
    """Every sign-in, failure, lock, sign-out and password change, with the time and the IP
    address. Never a password or a token. Admin only."""
    rows = await audit.newest(db, limit=limit, offset=offset)
    total = await audit.count(db)
    return LogPage(total=total, items=[_log_out(entry, user) for entry, user in rows])


def _log_out(entry: AuditEntry, user: User | None) -> LogEntryOut:
    return LogEntryOut(
        id=entry.id,
        created_at=entry.created_at,
        event=cast(Event, entry.event),  # the table's check keeps it on the list
        user=user_out(user) if user else None,
        ip=entry.ip,
        device=clean.device(entry.user_agent),
        details=entry.details,
    )
