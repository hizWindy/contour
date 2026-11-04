"""The sessions table (core.sessions): who is signed in. PLAN-V6 B3.

**The token.** A sign-in makes a new random token (32 bytes, 256 bits), which goes to the browser in
a cookie. Only its SHA-256 is saved, so a copy of the database can't be used to sign in. A fast hash
is right here: the token is random, so there is nothing to guess and nothing to slow down.

**The limits,** checked on every request by `resolve`:
- the longest a session can last (`expires_at`): 12 hours, or 14 days with "Keep me signed in";
- idle time: signed out after 2 hours without a request. A "Keep me signed in" session has no idle
  limit (without that it would end at the first lunch break, and the box would mean nothing).
A session that ends in any other way (`ended_at`) is gone for good.

**Last seen** is written at most once a minute, so a busy page doesn't write on every request. The
idle limit is therefore measured to the minute.

Every time here comes from the one clock the caller passes in (`now`), never from the database, so
a test can move time and the app and the database can't disagree by a second. These functions add
to the caller's transaction. The caller commits.
"""

import hashlib
import secrets
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import clean
from core.auth.models import User, UserSession
from core.config import Settings

TOKEN_BYTES = 32
MAX_TOKEN_CHARS = 128  # a token is 43 characters; anything much longer isn't one, and isn't hashed
TOUCH_EVERY = timedelta(seconds=60)
KEEP_ENDED_FOR = timedelta(days=7)  # a finished session's row stays this long, then it is deleted

Why = Literal["unknown", "idle", "expired", "ended"]


@dataclass(frozen=True)
class Limits:
    """How long a session lasts. Made from the settings, so a test can use its own."""

    idle: timedelta
    maximum: timedelta
    remember: timedelta
    touch_every: timedelta = TOUCH_EVERY

    @classmethod
    def from_settings(cls, settings: Settings) -> "Limits":
        return cls(
            idle=timedelta(minutes=settings.session_idle_minutes),
            maximum=timedelta(hours=settings.session_max_hours),
            remember=timedelta(days=settings.session_remember_days),
        )


@dataclass(frozen=True)
class AuthContext:
    """A signed-in request: who, and by which session."""

    user: User
    session: UserSession


@dataclass(frozen=True)
class Gone:
    """A session that can't be used, and why. "unknown": no such token (or no token)."""

    why: Why
    lasted: timedelta | None = None  # how long the session was meant to last, for the message


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_live(session: UserSession, now: datetime, limits: Limits) -> bool:
    """Can this session still be used? Not ended, not past its time, and (unless it is a "Keep me
    signed in" one) not idle for too long."""
    if session.ended_at is not None or now >= session.expires_at:
        return False
    return session.remember or now - session.last_seen_at < limits.idle


async def start(
    db: AsyncSession,
    user: User,
    *,
    remember: bool,
    ip: str | None,
    user_agent: str | None,
    now: datetime,
    limits: Limits,
) -> tuple[UserSession, str]:
    """Signs a user in: a new session and its new token (a sign-in never reuses a token, so one
    that was planted in the browser before it is of no use). Returns the row and the raw token,
    which only the cookie gets."""
    token = new_token()
    session = UserSession(
        id=uuid.uuid4(),
        token_hash=hash_token(token),
        user_id=user.id,
        created_at=now,
        last_seen_at=now,
        expires_at=now + (limits.remember if remember else limits.maximum),
        remember=remember,
        ip=clean.ip(ip),
        user_agent=clean.user_agent(user_agent),
    )
    db.add(session)
    await db.flush()
    return session, token


async def resolve(
    db: AsyncSession, token: str | None, *, now: datetime, limits: Limits
) -> AuthContext | Gone:
    """Who is behind this cookie, or why no one. Records "last seen" (at most once a minute)."""
    if not token or len(token) > MAX_TOKEN_CHARS:
        return Gone("unknown")
    row = (
        await db.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(UserSession.token_hash == hash_token(token))
        )
    ).first()
    if row is None:
        return Gone("unknown")
    session, user = row
    lasted = session.expires_at - session.created_at
    if session.ended_at is not None or not user.active:
        return Gone("ended", lasted)
    if now >= session.expires_at:
        return Gone("expired", lasted)
    if not session.remember and now - session.last_seen_at >= limits.idle:
        return Gone("idle", lasted)
    if now - session.last_seen_at >= limits.touch_every:
        session.last_seen_at = now
        await db.flush()
    return AuthContext(user, session)


async def end(db: AsyncSession, session_id: uuid.UUID, now: datetime) -> None:
    """Signs one session out. It is an UPDATE by id, because the session object the route holds
    was loaded by the guard's own database session: changing that object would save nothing."""
    await db.execute(
        update(UserSession)
        .where(UserSession.id == session_id, UserSession.ended_at.is_(None))
        .values(ended_at=now)
    )


async def end_for_user(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Ends every session of one user. Returns how many were still live (not past their time)."""
    rows = await db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.ended_at.is_(None))
        .values(ended_at=now)
        .returning(UserSession.expires_at)
    )
    return sum(1 for (expires_at,) in rows if expires_at > now)


async def end_all(db: AsyncSession, now: datetime) -> Counter[uuid.UUID]:
    """Ends every session of every user. Returns, for each user, how many were still live."""
    rows = await db.execute(
        update(UserSession)
        .where(UserSession.ended_at.is_(None))
        .values(ended_at=now)
        .returning(UserSession.user_id, UserSession.expires_at)
    )
    live: Counter[uuid.UUID] = Counter()
    for user_id, expires_at in rows:
        live[user_id] += 1 if expires_at > now else 0
        live.setdefault(user_id, 0)
    return live


async def open_for_user(
    db: AsyncSession, user_id: uuid.UUID, *, now: datetime, limits: Limits
) -> list[UserSession]:
    """The sessions of one user that can still be used, the most recently used first."""
    rows = await db.scalars(
        select(UserSession)
        .where(UserSession.user_id == user_id, UserSession.ended_at.is_(None))
        .order_by(UserSession.last_seen_at.desc())
    )
    return [session for session in rows if is_live(session, now, limits)]


async def clean_up(db: AsyncSession, now: datetime) -> int:
    """Deletes the sessions that ended or ran out more than a week ago. Returns how many."""
    before = now - KEEP_ENDED_FOR
    result = await db.execute(
        delete(UserSession).where(
            or_(UserSession.ended_at < before, UserSession.expires_at < before)
        )
    )
    return int(getattr(result, "rowcount", 0) or 0)
