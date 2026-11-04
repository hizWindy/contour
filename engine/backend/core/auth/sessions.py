"""The sessions table (core.sessions): who is signed in.

A session is one row. Its token is 32 random bytes in the cookie, and only the token's SHA-256 is
saved, so the database alone can't be used to sign in. These functions add to the caller's
transaction. The caller commits.
"""

import uuid
from collections import Counter
from datetime import datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth.models import UserSession


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
