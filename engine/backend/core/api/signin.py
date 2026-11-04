"""What a route needs to know about the sign-in: who is signed in, and the answer when no one is.

`MaybeAuthDep` gives the signed-in user, or None when no one is and sign-in isn't required (the
laptop's default, `AUTH_REQUIRED=false`). When it is required and no one is signed in, the request
is answered 401 `auth_required` and the route never runs. `AdminDep` also needs the Admin role.

The guard (`core.api.guard`) has usually checked the cookie already, before any body was read, and
leaves the answer in `request.state.auth`. These dependencies use it when it is there and look the
cookie up themselves when it isn't, so a route is safe even if it is mounted without the guard.
"""

from datetime import datetime
from typing import Annotated

from fastapi import Depends, Request

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.auth import cookies, sessions, words
from core.auth.clock import utcnow
from core.auth.passwords import Hasher, get_hasher
from core.auth.sessions import AuthContext, Gone, Limits
from core.auth.throttle import UnknownLogins
from core.config import Settings, get_settings


def clock_dependency(request: Request) -> datetime:
    """The time now. A test moves it with `app.state.clock = lambda: later`."""
    clock = getattr(request.app.state, "clock", None) or utcnow
    now: datetime = clock()
    return now


def hasher_dependency(request: Request) -> Hasher:
    """The password hasher. A test gives the app a cheap one in `app.state.hasher`."""
    hasher: Hasher | None = getattr(request.app.state, "hasher", None)
    return hasher or get_hasher()


def auth_settings_dependency() -> Settings:
    """The sign-in settings. They are env-only, so this is `get_settings()` as it is."""
    return get_settings()


def unknown_logins_dependency(request: Request) -> UnknownLogins:
    """What the sign-in remembers about logins that match no account. One for the whole app."""
    state = request.app.state
    if getattr(state, "unknown_logins", None) is None:
        state.unknown_logins = UnknownLogins()
    found: UnknownLogins = state.unknown_logins
    return found


NowDep = Annotated[datetime, Depends(clock_dependency)]
UnknownLoginsDep = Annotated[UnknownLogins, Depends(unknown_logins_dependency)]
HasherDep = Annotated[Hasher, Depends(hasher_dependency)]
AuthSettingsDep = Annotated[Settings, Depends(auth_settings_dependency)]


def client_ip(request: Request) -> str | None:
    """The address the request came from, as the server sees it (behind Caddy, as Caddy says)."""
    return request.client.host if request.client else None


def sign_in_needed(gone: Gone | None, settings: Settings) -> Problem:
    """The 401 for a request that needs a session and has none, or a dead one.

    With a dead session (the browser sent a cookie, but it can't be used) the answer says why in
    plain words, and tells the browser to drop the cookie.
    """
    limits = Limits.from_settings(settings)
    detail, reason, headers = words.SIGN_IN_NEEDED, None, None
    if gone is not None:
        headers = {"Set-Cookie": cookies.clear_cookie(secure=settings.session_cookie_secure)}
        if gone.why == "idle":
            detail, reason = words.signed_out_idle(limits.idle), "idle"
        elif gone.why == "expired":
            detail, reason = words.signed_out_expired(gone.lasted or limits.maximum), "expired"
        elif gone.why == "ended":
            detail, reason = words.SIGNED_OUT, "ended"
    return Problem(
        401, "Sign in needed", detail, code="auth_required", headers=headers, reason=reason
    )


async def maybe_auth(
    request: Request, db: SessionDep, settings: AuthSettingsDep, now: NowDep
) -> AuthContext | None:
    known = getattr(request.state, "auth", None)
    if isinstance(known, AuthContext):
        return known
    token = cookies.read_token(request.headers.get("cookie"), secure=settings.session_cookie_secure)
    gone: Gone | None = None
    if token:
        found = await sessions.resolve(db, token, now=now, limits=Limits.from_settings(settings))
        await db.commit()  # keeps "last seen"
        if isinstance(found, AuthContext):
            return found
        gone = found
    if settings.auth_required:
        raise sign_in_needed(gone, settings)
    return None


MaybeAuthDep = Annotated[AuthContext | None, Depends(maybe_auth)]


async def require_admin(auth: MaybeAuthDep) -> AuthContext | None:
    """The signed-in Admin. Sign-in off (no one signed in, none required) lets the request pass,
    as everything else does then. A signed-in user who isn't an Admin gets a 403."""
    if auth is not None and auth.user.role != "admin":
        raise Problem(403, "Admins only", "Only an Admin can do this.", code="admin_only")
    return auth


AdminDep = Annotated[AuthContext | None, Depends(require_admin)]
