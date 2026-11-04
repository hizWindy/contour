"""Signing in and out. PLAN-V6 B3 and B4.

`login` checks the password and starts a session. It answers the same way, and takes as long,
whether the login is unknown, the account is switched off or the password is wrong, so nobody can
learn which accounts exist from the words or from the clock. The limits on guessing are in
`core.auth.throttle`: this function applies them, in this order, before any password is hashed:

1. **The IP address.** Too many wrong tries from this address lately: it waits.
2. **The login.** The account's row is locked (so tries at one account are checked one after the
   other), then its wait or lock is looked at. A login that matches no account goes through the
   same steps with what the sign-in remembers about it (`UnknownLogins`).
3. **The password.** Checked, or the same amount of work done for nothing.

A wrong try is written in the sign-in log and committed before the refusal, because the refusal
rolls the request back. A try that is refused for waiting isn't checked, doesn't count and isn't
logged (it would only fill the log).

These functions commit. They are called with a database session of their own (one request).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import audit, sessions, throttle, users
from core.auth.models import User, UserSession
from core.auth.passwords import Hasher, get_hasher
from core.auth.sessions import AuthContext, Limits
from core.auth.throttle import Rules, Standing, UnknownLogins


class InvalidLogin(Exception):
    """The login or the password is wrong. It never says which. If this wrong try makes the next
    ones wait, `retry_after` says how long."""

    def __init__(self, retry_after: timedelta | None = None) -> None:
        self.retry_after = retry_after
        super().__init__("invalid login")


class TooManyTries(Exception):
    """Too many wrong tries: from this address, or at this login. Nothing was checked."""

    def __init__(self, retry_after: timedelta) -> None:
        self.retry_after = retry_after
        super().__init__("too many tries")


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
    rules: Rules,
    unknown: UnknownLogins,
    hasher: Hasher | None = None,
) -> LoginResult:
    """Signs a person in. Raises `InvalidLogin` for a wrong login or password and `TooManyTries`
    when the limits say to wait."""
    hasher = hasher or get_hasher()

    wait = await throttle.ip_wait(db, ip, rules, now)  # a read: nothing is locked yet
    if wait is not None:
        raise TooManyTries(wait)

    user = await users.find_by_login(db, identifier, lock=True)
    if user is None:
        standing = unknown.standing(identifier)
    else:
        standing = Standing(user.failed_attempts, user.locked_until)
    wait = throttle.wait_for(standing, now)
    if wait is not None:
        await db.rollback()  # let the account's row go
        raise TooManyTries(wait)

    after, locked = standing, False  # where the login stands after this try, if it is wrong
    if user is None:
        # Nothing to guess here, but it is counted the way a real account is, and counted before
        # the slow part, so parallel tries at one made-up login can't all pass the count.
        after, locked = throttle.after_failure(standing, rules, now)
        unknown.record(identifier, after)
        await hasher.aburn(password)  # as much work as a real check
        right, rehash = False, False
    elif not user.active:
        await hasher.aburn(password)
        right, rehash = False, False
    else:
        right, rehash = await hasher.averify(user.password_hash, password)

    if user is None or not right:
        if user is not None:
            after, locked = throttle.after_failure(standing, rules, now)
            user.failed_attempts, user.locked_until = after.failed, after.blocked_until
        _write_failure(db, user, locked, after, ip=ip, user_agent=user_agent, now=now, rules=rules)
        await db.commit()
        raise InvalidLogin(throttle.wait_for(after, now))

    if rehash:  # saved with older settings: the right password is in hand, so save it again
        user.password_hash = await hasher.ahash(password)
    user.failed_attempts, user.locked_until = 0, None  # a right password ends the count
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


def _write_failure(
    db: AsyncSession,
    user: User | None,
    locked: bool,
    after: Standing,
    *,
    ip: str | None,
    user_agent: str | None,
    now: datetime,
    rules: Rules,
) -> None:
    """Adds a wrong try to the log: the try itself, and the lock if this try made one. The reason
    is for the Admin reading the log. It is never given to the person who tried."""
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
    if user is not None and locked:
        minutes = int(rules.lock_for.total_seconds() // 60)
        audit.add_entry(
            db,
            "account_locked",
            user_id=user.id,
            ip=ip,
            user_agent=user_agent,
            details={"tries": after.failed, "minutes": minutes},
            at=now,
        )


async def logout(
    db: AsyncSession, auth: AuthContext, *, ip: str | None, user_agent: str | None, now: datetime
) -> None:
    """Signs the browser out. The session ends for good."""
    await sessions.end(db, auth.session.id, now)
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
