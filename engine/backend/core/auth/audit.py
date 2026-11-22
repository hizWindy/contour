"""The sign-in log (core.audit_log): writing an entry, reading the newest, counting failures.

An entry is added to the caller's transaction and not committed here, so it is saved or lost
together with the thing it records. The one exception is a failed sign-in: the service commits the
failure first, then answers, or a refused request would roll its own record back.

Nothing secret goes in. `details` holds facts (how many sessions ended, which command did it), and
`add_entry` refuses a key that names a secret, so a careless `details={"password": ...}` fails in
the first test that writes it instead of reaching the database.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CursorResult, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import clean
from core.auth.models import AUDIT_EVENTS, AuditEntry, User

# A key with one of these words in it is refused, whatever its value.
SECRET_WORDS = ("password", "passphrase", "token", "secret", "cookie", "hash")
DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def add_entry(
    db: AsyncSession,
    event: str,
    *,
    user_id: uuid.UUID | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    details: dict[str, Any] | None = None,
    at: datetime | None = None,
) -> AuditEntry:
    """Adds one entry to the transaction. `ip` and `user_agent` are cleaned here.

    `at` is the caller's clock (`now`), so the log, the sessions and the limits all measure time
    from the same moment. Without it the database's clock is used.
    """
    if event not in AUDIT_EVENTS:
        raise ValueError(f"{event!r} is not a kind of log entry")
    facts = details or {}
    for key in facts:
        if any(word in key.lower() for word in SECRET_WORDS):
            raise ValueError(f"the log never holds a secret, and {key!r} sounds like one")
    entry = AuditEntry(
        event=event,
        user_id=user_id,
        ip=clean.ip(ip),
        user_agent=clean.user_agent(user_agent),
        details=facts,
    )
    if at is not None:
        entry.created_at = at
    db.add(entry)
    return entry


def made_by(admin: User | None, *, ip: str | None, user_agent: str | None) -> dict[str, Any]:
    """Who made an admin's change, for that entry's `details` (PLAN-V26 choice 10): the admin,
    their address and their device. They aren't in the entry's own `ip` and `user_agent`: those
    two say where the account's own person was. `admin` is None where sign-in is off."""
    return {
        "admin_id": str(admin.id) if admin else None,
        "admin_name": admin.name if admin else None,
        "admin_ip": clean.ip(ip),
        "admin_device": clean.device(user_agent),
    }


async def newest(
    db: AsyncSession, *, limit: int = DEFAULT_LIMIT, offset: int = 0
) -> list[tuple[AuditEntry, User | None]]:
    """The newest entries first, each with its user (None when it has none, or the user is gone)."""
    rows = await db.execute(
        select(AuditEntry, User)
        .outerjoin(User, User.id == AuditEntry.user_id)
        .order_by(AuditEntry.created_at.desc(), AuditEntry.id.desc())
        .limit(max(1, min(limit, MAX_LIMIT)))
        .offset(max(0, offset))
    )
    return [(entry, user) for entry, user in rows]


async def failures_from(db: AsyncSession, ip: str | None, since: datetime) -> list[datetime]:
    """When each failed sign-in from this address happened since `since`, newest first.

    No address (None) counts as one address of its own. The list is as long as the failures, so
    the caller can count them and also find when the oldest one leaves its window.
    """
    where = AuditEntry.ip.is_(None) if ip is None else AuditEntry.ip == ip
    rows = await db.scalars(
        select(AuditEntry.created_at)
        .where(where, AuditEntry.event == "sign_in_failed", AuditEntry.created_at > since)
        .order_by(AuditEntry.created_at.desc())
    )
    return list(rows)


async def delete_before(db: AsyncSession, before: datetime) -> int:
    """Deletes the log's entries from before that time, and nothing else (PLAN-V26 choice 14).
    Returns how many went. The caller commits."""
    gone: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        delete(AuditEntry).where(AuditEntry.created_at < before)
    )
    return int(gone.rowcount or 0)


async def count(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count()).select_from(AuditEntry)) or 0)


async def is_first_sign_in(
    db: AsyncSession, user_id: uuid.UUID, *, kept_since: datetime | None = None
) -> bool:
    """True when the account has signed in once and hasn't changed its own password yet.

    `kept_since` is where the log begins, when old records are deleted (PLAN-V26 choice 14). An
    account older than that is never on its first sign-in: the log can't show the earlier ones.
    """
    if kept_since is not None:
        made = await db.scalar(select(User.created_at).where(User.id == user_id))
        if made is None or made < kept_since:
            return False
    sign_ins = int(
        await db.scalar(
            select(func.count())
            .select_from(AuditEntry)
            .where(AuditEntry.user_id == user_id, AuditEntry.event == "sign_in")
        )
        or 0
    )
    if sign_ins != 1:
        return False
    changed = await db.scalar(
        select(AuditEntry.id)
        .where(
            AuditEntry.user_id == user_id,
            AuditEntry.event == "password_changed",
            AuditEntry.details["by"].astext == "person",
        )
        .limit(1)
    )
    return changed is None
