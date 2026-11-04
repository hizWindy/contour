"""The sign-in tables (core.users, core.sessions, core.audit_log): what the database itself refuses.

The code checks these things too. The database checks them again, so a bug or a hand-made row
can't leave a mixed-case email, a raw token or an unknown kind of log entry behind. PLAN-V6 B1.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.auth.models import (
    AUDIT_EVENTS,
    IP_MAX,
    ROLES,
    USER_AGENT_MAX,
    AuditEntry,
    User,
    UserSession,
)

pytestmark = pytest.mark.integration

Factory = async_sessionmaker[AsyncSession]
HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaA"  # the shape only; no real password


def make_user(**changes: Any) -> User:
    values: dict[str, Any] = {"email": "al@example.test", "name": "Al", "password_hash": HASH}
    return User(**{**values, **changes})


def digest(token: str = "one") -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def make_session(user: User, **changes: Any) -> UserSession:
    values: dict[str, Any] = {
        "token_hash": digest(),
        "user_id": user.id,
        "expires_at": datetime.now(UTC) + timedelta(hours=12),
    }
    return UserSession(**{**values, **changes})


async def save(factory: Factory, *rows: Any) -> None:
    async with factory() as db_session:
        db_session.add_all(rows)
        await db_session.commit()


# --- Users ------------------------------------------------------------------------------------


async def test_a_new_user_gets_sensible_defaults(session_factory: Factory) -> None:
    user = make_user()
    await save(session_factory, user)
    async with session_factory() as db_session:
        saved = await db_session.get(User, user.id)
    assert saved is not None
    assert (saved.role, saved.active, saved.failed_attempts) == ("admin", True, 0)
    assert (saved.username, saved.locked_until, saved.last_signed_in_at) == (None, None, None)
    assert saved.created_at is not None
    assert saved.password_changed_at is not None


async def test_an_email_is_unique_and_kept_in_lower_case(session_factory: Factory) -> None:
    await save(session_factory, make_user())
    with pytest.raises(IntegrityError, match="uq_users_email"):
        await save(session_factory, make_user(name="Another"))
    for bad in (
        "Al.Two@example.test",
        " al.two@example.test",
        "al.two@example.test ",
        "no-at-sign",
    ):
        with pytest.raises(IntegrityError, match="ck_users_email"):
            await save(session_factory, make_user(email=bad))
    with pytest.raises(IntegrityError, match="ck_users_email"):
        await save(session_factory, make_user(email="@example.test"))  # nothing before the @


async def test_a_username_is_optional_unique_and_never_an_email(session_factory: Factory) -> None:
    # Two people without one don't compete: nothing equals nothing.
    await save(session_factory, make_user(email="a@example.test"))
    await save(session_factory, make_user(email="b@example.test"))
    await save(session_factory, make_user(email="c@example.test", username="al-khair"))
    with pytest.raises(IntegrityError, match="uq_users_username"):
        await save(session_factory, make_user(email="d@example.test", username="al-khair"))
    for bad in ("Al-khair", "al@khair", "al khair", "ab", "-alkhair", "al/khair", "al-khair\n"):
        with pytest.raises(IntegrityError, match="ck_users_username"):
            await save(
                session_factory, make_user(email=f"{secrets.token_hex(4)}@e.test", username=bad)
            )
    for fine in ("al.khair", "al_khair", "a1b", "x" * 64):
        await save(
            session_factory, make_user(email=f"{secrets.token_hex(4)}@e.test", username=fine)
        )


async def test_the_role_is_one_of_the_three(session_factory: Factory) -> None:
    for number, role in enumerate(ROLES):
        await save(session_factory, make_user(email=f"{number}@example.test", role=role))
    with pytest.raises(IntegrityError, match="ck_users_role"):
        await save(session_factory, make_user(email="owner@example.test", role="owner"))


async def test_the_count_of_failed_tries_cannot_be_negative(session_factory: Factory) -> None:
    with pytest.raises(IntegrityError, match="ck_users_failed_attempts"):
        await save(session_factory, make_user(failed_attempts=-1))


# --- Sessions ---------------------------------------------------------------------------------


async def test_a_session_keeps_only_a_hash_of_the_token(session_factory: Factory) -> None:
    user = make_user()
    await save(session_factory, user)
    raw = secrets.token_urlsafe(32)  # what the cookie holds
    for bad in (raw, digest().upper(), digest()[:-1], "", "g" * 64):
        with pytest.raises(IntegrityError, match="ck_sessions_token_hash"):
            await save(session_factory, make_session(user, token_hash=bad))
    with pytest.raises(DataError):  # one character too many doesn't fit the column at all
        await save(session_factory, make_session(user, token_hash=digest() + "0"))
    await save(session_factory, make_session(user, token_hash=digest(raw)))
    with pytest.raises(IntegrityError, match="uq_sessions_token_hash"):
        await save(session_factory, make_session(user, token_hash=digest(raw)))


async def test_a_new_session_gets_sensible_defaults(session_factory: Factory) -> None:
    user = make_user()
    await save(session_factory, user)
    made = make_session(user)
    await save(session_factory, made)
    async with session_factory() as db_session:
        saved = await db_session.get(UserSession, made.id)
    assert saved is not None
    assert (saved.remember, saved.ended_at, saved.ip, saved.user_agent) == (False, None, None, None)
    assert saved.created_at is not None
    assert saved.last_seen_at is not None


async def test_a_session_needs_a_real_user_and_goes_with_its_user(session_factory: Factory) -> None:
    ghost = make_user(id=uuid.uuid4(), email="ghost@example.test")  # never saved
    with pytest.raises(IntegrityError, match="fk_sessions_user_id_users"):
        await save(session_factory, make_session(ghost))

    user = make_user()
    await save(session_factory, user)
    await save(session_factory, make_session(user, token_hash=digest("a")))
    await save(session_factory, make_session(user, token_hash=digest("b")))
    async with session_factory() as db_session:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()
        left = await db_session.scalars(select(UserSession).where(UserSession.user_id == user.id))
        assert list(left) == []


# --- The log ----------------------------------------------------------------------------------


async def test_the_log_takes_only_the_listed_events(session_factory: Factory) -> None:
    await save(session_factory, *(AuditEntry(event=event) for event in AUDIT_EVENTS))
    with pytest.raises(IntegrityError, match="ck_audit_log_event"):
        await save(session_factory, AuditEntry(event="password_typed"))
    async with session_factory() as db_session:
        rows = list(await db_session.scalars(select(AuditEntry).order_by(AuditEntry.id)))
    assert [row.event for row in rows] == list(AUDIT_EVENTS)
    assert all(row.details == {} and row.created_at is not None for row in rows)
    assert [row.id for row in rows] == sorted({row.id for row in rows})  # numbered in order


async def test_the_log_keeps_its_rows_when_a_user_is_deleted(session_factory: Factory) -> None:
    user = make_user()
    await save(session_factory, user)
    await save(session_factory, AuditEntry(event="sign_in", user_id=user.id, ip="203.0.113.7"))
    async with session_factory() as db_session:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()
        entry = await db_session.scalar(select(AuditEntry))
    assert entry is not None
    assert (entry.user_id, entry.event, entry.ip) == (None, "sign_in", "203.0.113.7")


async def test_an_entry_needs_a_real_user_or_none(session_factory: Factory) -> None:
    await save(
        session_factory, AuditEntry(event="sign_in_failed", user_id=None)
    )  # an unknown login
    with pytest.raises(IntegrityError, match="fk_audit_log_user_id_users"):
        await save(session_factory, AuditEntry(event="sign_in", user_id=uuid.uuid4()))


async def test_the_columns_have_room_for_what_the_code_saves_and_no_more(
    session_factory: Factory,
) -> None:
    """The code cuts the browser's name to 300 characters. An IPv6 address needs 45 at most."""
    longest_ipv6 = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255"
    assert len(longest_ipv6) == IP_MAX
    await save(
        session_factory,
        AuditEntry(event="sign_in", ip=longest_ipv6, user_agent="x" * USER_AGENT_MAX),
    )
    with pytest.raises(DataError):
        await save(
            session_factory, AuditEntry(event="sign_in", user_agent="x" * (USER_AGENT_MAX + 1))
        )
    with pytest.raises(DataError):
        await save(session_factory, AuditEntry(event="sign_in", ip="1" * (IP_MAX + 1)))


# --- Indexes ----------------------------------------------------------------------------------


async def test_the_indexes_the_code_looks_up_are_there(session_factory: Factory) -> None:
    async with session_factory() as db_session:
        rows = await db_session.execute(
            text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'core' "
                "AND tablename IN ('users', 'sessions', 'audit_log')"
            )
        )
        definitions = {name: definition for name, definition in rows}
    assert "UNIQUE" in definitions["uq_users_email"]
    assert "UNIQUE" in definitions["uq_users_username"]
    assert "UNIQUE" in definitions["uq_sessions_token_hash"]  # looked up on every request
    assert definitions["ix_sessions_user_open"].endswith("(user_id) WHERE (ended_at IS NULL)")
    assert definitions["ix_audit_log_created_at"].endswith("(created_at DESC)")
    assert definitions["ix_audit_log_ip_created_at"].endswith("(ip, created_at DESC)")
