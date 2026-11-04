"""The users table (core.users): find a user, make one, change a password.

These add to the caller's transaction. The caller commits.
"""

import uuid
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import clean
from core.auth.models import User


class LoginTaken(ValueError):
    """The email or the username belongs to someone already. `field` says which."""

    def __init__(self, field: str) -> None:
        self.field = field
        super().__init__(f"That {field} is already used by an account.")


async def find_by_login(db: AsyncSession, login: str) -> User | None:
    """The user whose email or username is `login`, in any case. None if there is no one.

    A username can't hold an @ and an email always does, so at most one user can match.
    """
    value = clean.login(login)
    if not value:
        return None
    return await db.scalar(select(User).where(or_(User.email == value, User.username == value)))


async def find_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def create(
    db: AsyncSession,
    *,
    email: str,
    username: str | None,
    name: str,
    password_hash: str,
    role: str = "admin",
    now: datetime,
) -> User:
    """Makes a user. `email` and `username` must already be clean (`core.auth.clean`).

    Raises `LoginTaken` if either is in use. The transaction is rolled back first, because the
    database has refused the row and nothing else in it can be saved.
    """
    user = User(
        email=email,
        username=username,
        name=name,
        role=role,
        password_hash=password_hash,
        password_changed_at=now,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as error:
        await db.rollback()
        diag = getattr(error.orig, "diag", None)
        constraint = str(getattr(diag, "constraint_name", "") or "")
        if "uq_users_" not in constraint:
            raise  # a rule other than "taken": that is a bug, not a name in use
        raise LoginTaken("username" if "username" in constraint else "email") from error
    return user


def set_password(user: User, password_hash: str, now: datetime) -> None:
    """The new hash is the only password. A lock and the count of wrong tries start again."""
    user.password_hash = password_hash
    user.password_changed_at = now
    user.failed_attempts = 0
    user.locked_until = None
