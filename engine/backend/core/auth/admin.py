"""What an administrator does from the server's command line: make the Admin account, set a new
password, change a name (PLAN-V13 T1-4), sign everyone out. PLAN-V6 B2.

There is no sign-up page and no password reset by email, on purpose: the only way to make an
account or to change a password is to be on the server. Each function here does one thing, writes
its own entry in the sign-in log in the same transaction, and commits. The command in `core.cli`
asks for the password (twice, never shown) and calls these.
"""

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import audit, clean, sessions, users
from core.auth.features import (
    APPS_ORDER,
    FEATURES,
    apps_from_features,
    default_features,
    features_from_apps,
    is_admin,
    normalize_features,
)
from core.auth.models import User
from core.auth.passwords import Hasher, check_rules, get_hasher, require_good_password

PASSWORD_ATTEMPTS = 3  # how many times the command asks before it gives up
BY_COMMAND = "command"
BY_SETTINGS = "settings"  # the first Admin, made by `engine migrate` from FIRST_ADMIN_*


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
    by: str = BY_COMMAND,
    role: str = "admin",
) -> User:
    """Makes an Admin account (or Platform admin when specified). Raises ValueError for a login
    that isn't allowed, `PasswordRefused` for a password that breaks the rules, and
    `users.LoginTaken` for a login already in use. `by` is what the sign-in log says made it."""
    return await create_person(
        db,
        email=email,
        username=username,
        name=name,
        role=role,
        apps=list(APPS_ORDER),
        features=list(FEATURES),
        password=password,
        now=now,
        hasher=hasher,
        by=by,
    )


async def create_person(
    db: AsyncSession,
    *,
    email: str,
    username: str | None,
    name: str | None,
    role: str,
    password: str,
    now: datetime,
    position: str | None = None,
    apps: Sequence[str] | None = None,
    features: Sequence[str] | None = None,
    hasher: Hasher | None = None,
    by: str = BY_COMMAND,
    hubspot_owner_id: str | None = None,
    no_hubspot_user: bool = False,
    made_by: Mapping[str, Any] | None = None,
) -> User:
    """Makes an account with a role, optional position, and ticks (`PLAN-V19 T1-4, T1-5`). It may
    start linked to a HubSpot owner the caller has checked (set by hand), or marked "No HubSpot
    user" (PLAN-V23 T3-1), in the same transaction. `made_by` is the admin who did it, for the
    log (`audit.made_by`)."""
    email = clean.email(email)
    username = clean.username(username)
    cleaned_position = clean.position(position)
    resolved_features: list[str]
    if is_admin(role):
        resolved_features = list(FEATURES)
    elif features is not None:
        resolved_features = normalize_features(features)
    elif apps is not None:
        resolved_features = features_from_apps(apps)
    else:
        resolved_features = default_features(role)
    resolved_apps = apps_from_features(resolved_features)
    require_good_password(password, email=email, username=username)
    password_hash = await (hasher or get_hasher()).ahash(password)
    user = await users.create(
        db,
        email=email,
        username=username,
        name=(name or "").strip()[:120] or default_name(email),
        position=cleaned_position,
        role=role,
        apps=resolved_apps,
        features=resolved_features,
        password_hash=password_hash,
        now=now,
    )
    if hubspot_owner_id is not None:
        user.hubspot_owner_id = hubspot_owner_id
        user.hubspot_owner_matched_by = "person"  # an Admin picked it: the sync never changes it
    else:
        user.no_hubspot_user = no_hubspot_user
    details: dict[str, object] = {"by": by, "role": user.role, **(made_by or {})}
    if hubspot_owner_id is not None or no_hubspot_user:
        details["hubspot"] = "linked" if hubspot_owner_id is not None else "none"
    audit.add_entry(db, "account_created", user_id=user.id, details=details, at=now)
    await db.commit()
    return user


async def create_first_admin(
    db: AsyncSession,
    *,
    email: str,
    username: str | None,
    name: str | None,
    password: str,
    now: datetime,
    hasher: Hasher | None = None,
) -> User | None:
    """Makes the first Platform admin account, unless an Admin/Platform admin exists already."""
    if await users.admin_exists(db):
        return None
    try:
        return await create_admin(
            db,
            email=email,
            username=username,
            name=name,
            password=password,
            now=now,
            hasher=hasher,
            by=BY_SETTINGS,
            role="platform_admin",
        )
    except users.LoginTaken:
        return None


async def reset_password(
    db: AsyncSession,
    user: User,
    password: str,
    *,
    now: datetime,
    hasher: Hasher | None = None,
    by: str = BY_COMMAND,
    sign_out: bool = True,
    made_by: Mapping[str, Any] | None = None,
) -> int:
    """Gives a user a new password. With `sign_out` (the default) every session of that user
    ends, so whoever had the old password (or a stolen cookie) is out. Without it their open
    browsers stay signed in (PLAN-V26 choice 6). The lock, if there is one, is lifted. Returns
    how many sessions ended. Raises `PasswordRefused` for a password that breaks the rules."""
    require_good_password(password, email=user.email, username=user.username)
    password_hash = await (hasher or get_hasher()).ahash(password)
    users.set_password(user, password_hash, now)
    ended = await sessions.end_for_user(db, user.id, now) if sign_out else 0
    audit.add_entry(
        db,
        "password_changed",
        user_id=user.id,
        details={"by": by, "signed_out": sign_out, "sessions_ended": ended, **(made_by or {})},
        at=now,
    )
    await db.commit()
    return ended


async def set_platform_admin(
    db: AsyncSession, user: User, *, now: datetime, by: str = BY_COMMAND
) -> bool:
    """Makes `user` the single Platform admin, demoting any previous Platform admin to Admin."""
    if not user.active:
        raise ValueError("Switch the account on before making it the Platform admin.")
    if user.role == "platform_admin":
        user.features = list(FEATURES)
        user.apps = list(APPS_ORDER)
        await db.commit()
        return False
    previous = await db.scalars(
        select(User).where(User.role == "platform_admin", User.id != user.id).with_for_update()
    )
    for old in previous:
        old.role = "admin"
        old.features = list(FEATURES)
        old.apps = list(APPS_ORDER)
    await db.flush()
    user.role = "platform_admin"
    user.features = list(FEATURES)
    user.apps = list(APPS_ORDER)
    audit.add_entry(
        db,
        "account_changed",
        user_id=user.id,
        details={"by": by, "fields": ["role"], "role": "platform_admin"},
        at=now,
    )
    await db.commit()
    return True


NAME_MAX = 120  # the users.name column


def clean_name(text: str) -> str:
    """A person's name as the top bar and the People tab show it: spaces trimmed and joined.
    Raises ValueError for an empty name or one too long."""
    name = " ".join(text.split())
    if not name:
        raise ValueError("Give a name, like Al-khair M. Pama.")
    if len(name) > NAME_MAX:
        raise ValueError(f"Use {NAME_MAX} characters or fewer.")
    return name


async def rename(db: AsyncSession, user: User, name: str, *, now: datetime) -> str:
    """Changes the name an account shows (PLAN-V13 T1-4). The People tab can't change a name, so
    this is the way. Logged as `account_changed`. Returns the name as saved."""
    user.name = clean_name(name)
    audit.add_entry(
        db,
        "account_changed",
        user_id=user.id,
        details={"by": BY_COMMAND, "fields": ["name"]},
        at=now,
    )
    await db.commit()
    return user.name


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
