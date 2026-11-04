"""What an administrator does from the server's command line: make the Admin account, set a new
password, sign everyone out. PLAN-V6 B2.

There is no sign-up page and no password reset by email, on purpose: the only way to make an
account or to change a password is to be on the server. Each function here does one thing, writes
its own entry in the sign-in log in the same transaction, and commits. The command in `core.cli`
asks for the password (twice, never shown) and calls these.
"""

from collections.abc import Callable
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import audit, clean, sessions, users
from core.auth.models import User
from core.auth.passwords import Hasher, check_rules, get_hasher, require_good_password

PASSWORD_ATTEMPTS = 3  # how many times the command asks before it gives up
BY_COMMAND = "command"


def default_name(email: str) -> str:
    """ "al.khair@x.test" becomes "Al Khair": what the top bar shows when no name was given."""
    local = email.split("@", 1)[0]
    words = local.replace(".", " ").replace("_", " ").replace("-", " ").split()
    return " ".join(words).title() or local


async def create_admin(
    db: AsyncSession,
    *,
    email: str,
    username: str | None,
    name: str | None,
    password: str,
    now: datetime,
    hasher: Hasher | None = None,
) -> User:
    """Makes an Admin account. Raises ValueError for a login that isn't allowed, `PasswordRefused`
    for a password that breaks the rules, and `users.LoginTaken` for a login already in use."""
    email = clean.email(email)
    username = clean.username(username)
    require_good_password(password, email=email, username=username)
    password_hash = await (hasher or get_hasher()).ahash(password)
    user = await users.create(
        db,
        email=email,
        username=username,
        name=(name or "").strip()[:120] or default_name(email),
        role="admin",
        password_hash=password_hash,
        now=now,
    )
    audit.add_entry(
        db,
        "account_created",
        user_id=user.id,
        details={"by": BY_COMMAND, "role": user.role},
        at=now,
    )
    await db.commit()
    return user


async def reset_password(
    db: AsyncSession,
    user: User,
    password: str,
    *,
    now: datetime,
    hasher: Hasher | None = None,
) -> int:
    """Gives a user a new password. Every session of that user ends, so whoever had the old
    password (or a stolen cookie) is out. The lock, if there is one, is lifted. Returns how many
    sessions ended. Raises `PasswordRefused` for a password that breaks the rules."""
    require_good_password(password, email=user.email, username=user.username)
    password_hash = await (hasher or get_hasher()).ahash(password)
    users.set_password(user, password_hash, now)
    ended = await sessions.end_for_user(db, user.id, now)
    audit.add_entry(
        db,
        "password_changed",
        user_id=user.id,
        details={"by": BY_COMMAND, "sessions_ended": ended},
        at=now,
    )
    await db.commit()
    return ended


async def sign_out_everyone(db: AsyncSession, *, now: datetime) -> tuple[int, int]:
    """Ends every session of every user. Returns (live sessions ended, people who had some)."""
    ended = await sessions.end_all(db, now)
    for user_id, count in ended.items():
        audit.add_entry(
            db,
            "sign_out_everywhere",
            user_id=user_id,
            details={"by": BY_COMMAND, "sessions_ended": count},
            at=now,
        )
    await db.commit()
    return sum(ended.values()), sum(1 for count in ended.values() if count)


def ask_new_password(
    read_secret: Callable[[str], str],
    complain: Callable[[str], None],
    *,
    email: str | None,
    username: str | None,
    attempts: int = PASSWORD_ATTEMPTS,
) -> str | None:
    """Asks for a new password twice and returns it, or None after `attempts` tries that failed.

    `read_secret` asks without showing what is typed. `complain` shows a problem. The password
    itself is never shown or logged: only the rules' plain-words problems are.
    """
    for _ in range(attempts):
        first = read_secret("New password: ")
        problems = check_rules(first, email=email, username=username)
        if problems:
            for problem in problems:
                complain(f"  - {problem}")
            continue
        if read_secret("New password again: ") != first:
            complain("  - The two passwords are different.")
            continue
        return first
    return None
