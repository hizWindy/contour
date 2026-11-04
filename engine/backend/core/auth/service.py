"""Signing in and out. PLAN-V6 B3.

`login` checks the password and starts a session. It answers the same way, and takes as long,
whether the login is unknown, the account is switched off or the password is wrong, so nobody can
learn which accounts exist from the words or from the clock. A failure is written in the sign-in
log and committed before the refusal, because the refusal rolls the request back.

These functions commit. They are called with a database session of their own (one request).
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import audit, sessions, users
from core.auth.models import User, UserSession
from core.auth.passwords import Hasher, get_hasher
from core.auth.sessions import AuthContext, Limits


class InvalidLogin(Exception):
    """The login or the password is wrong. It never says which."""


@dataclass(frozen=True)
class LoginResult:
    user: User
    session: UserSession
    token: str  # the raw token, for the cookie only


async def login(
    db: AsyncSession,
    *,
    identifier: str,
    password: str,
    remember: bool,
    ip: str | None,
    user_agent: str | None,
    now: datetime,
    limits: Limits,
    hasher: Hasher | None = None,
) -> LoginResult:
    """Signs a person in. Raises `InvalidLogin` for a wrong login or password."""
    hasher = hasher or get_hasher()
    user = await users.find_by_login(db, identifier)
    if user is None or not user.active:
        await hasher.aburn(password)  # as much work as a real check
        right, rehash = False, False
    else:
        right, rehash = await hasher.averify(user.password_hash, password)
    if user is None or not right:
        reason = "unknown_login" if user is None else "inactive" if not user.active else "wrong"
        audit.add_entry(
            db,
            "sign_in_failed",
            user_id=user.id if user else None,
            ip=ip,
            user_agent=user_agent,
            details={"reason": reason},
            at=now,
        )
        await db.commit()
        raise InvalidLogin

    if rehash:  # saved with older settings: the right password is in hand, so save it again
        user.password_hash = await hasher.ahash(password)
    user.last_signed_in_at = now
    session, token = await sessions.start(
        db, user, remember=remember, ip=ip, user_agent=user_agent, now=now, limits=limits
    )
    audit.add_entry(
        db,
        "sign_in",
        user_id=user.id,
        ip=ip,
        user_agent=user_agent,
        details={"keep_signed_in": remember},
        at=now,
    )
    await sessions.clean_up(db, now)
    await db.commit()
    return LoginResult(user, session, token)


async def logout(
    db: AsyncSession, auth: AuthContext, *, ip: str | None, user_agent: str | None, now: datetime
) -> None:
    """Signs the browser out. The session ends for good."""
    await sessions.end(db, auth.session, now)
    audit.add_entry(db, "sign_out", user_id=auth.user.id, ip=ip, user_agent=user_agent, at=now)
    await db.commit()


async def logout_everywhere(
    db: AsyncSession, auth: AuthContext, *, ip: str | None, user_agent: str | None, now: datetime
) -> int:
    """Ends every session of this user, this browser's too. Returns how many were still live."""
    ended = await sessions.end_for_user(db, auth.user.id, now)
    audit.add_entry(
        db,
        "sign_out_everywhere",
        user_id=auth.user.id,
        ip=ip,
        user_agent=user_agent,
        details={"by": "person", "sessions_ended": ended},
        at=now,
    )
    await db.commit()
    return ended
