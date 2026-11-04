"""The sign-in tables: who may sign in (core.users), who is signed in (core.sessions) and the log
of every sign-in (core.audit_log). PLAN-V6 B1.

- **Users.** One Admin for now. The email (and the username, if there is one) is saved in lower
  case, so "compared in lower case" is a plain unique key. A username can't hold an `@`, so a
  sign-in name never means two people. Only the password's argon2id hash is kept.
- **Sessions.** One row for each signed-in browser. Only a hash of the cookie's random token is
  kept (the database refuses anything that isn't a SHA-256 hex text), so a copy of the database
  can't be used to sign in. A session ends when `ended_at` is set, when `expires_at` has passed, or
  (unless "keep me signed in") after the idle time: that rule is in `core.auth.sessions`.
- **The log.** Every sign-in, failure, lock, sign-out and password change, with the time and the IP
  address. Never a password, a token or a login name that was typed (`details` is for facts like
  how many sessions ended). It keeps its rows when a user is deleted (the user becomes empty).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base

# admin is the only one used today. staff and viewer are allowed so the table needs no change later.
ROLES = ("admin", "staff", "viewer")

# The kinds of entry in the log. A fixed list, so the Account tab can switch on each one.
AUDIT_EVENTS = (
    "sign_in",  # a successful sign-in
    "sign_in_failed",  # a wrong login or password (or an account that is switched off)
    "account_locked",  # too many wrong tries in a row: the account is locked for a while
    "sign_out",  # a person signed out
    "sign_out_everywhere",  # every session of a user ended (by the person, or by a command)
    "password_changed",  # a new password was set (a reset by command, or a change)
    "account_created",  # the `create-admin` command made an account
)

USER_AGENT_MAX = 300  # the browser's name is cut to this many characters before it is saved
IP_MAX = 45  # the longest text an IPv6 address can have

# A username starts with a letter or digit, then letters, digits, dots, dashes and underscores.
# No `@` and no capitals, so it never equals an email, and never differs only by case.
USERNAME_PATTERN = "^[a-z0-9][a-z0-9._-]{2,63}$"
TOKEN_HASH_PATTERN = "^[0-9a-f]{64}$"  # a SHA-256 in hex: nothing else is a hash of a token


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in_list("role", ROLES), name="role"),
        CheckConstraint("email = lower(btrim(email)) AND position('@' IN email) > 1", name="email"),
        CheckConstraint(f"username IS NULL OR username ~ '{USERNAME_PATTERN}'", name="username"),
        CheckConstraint("failed_attempts >= 0", name="failed_attempts"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # lower case
    username: Mapped[str | None] = mapped_column(String(64), unique=True)  # lower case, or none
    name: Mapped[str] = mapped_column(String(120))  # what the top bar shows
    role: Mapped[str] = mapped_column(String(16), server_default="admin")
    password_hash: Mapped[str] = mapped_column(Text)  # argon2id, with its settings in the text
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    last_signed_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint(f"token_hash ~ '{TOKEN_HASH_PATTERN}'", name="token_hash"),
        # A user's open sessions: the Account tab, "sign out everywhere" and the daily clean-up.
        Index("ix_sessions_user_open", "user_id", postgresql_where=text("ended_at IS NULL")),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # the lookup on every request
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # the longest it can last
    remember: Mapped[bool] = mapped_column(  # "Keep me signed in"
        Boolean, default=False, server_default=text("false")
    )
    ip: Mapped[str | None] = mapped_column(String(IP_MAX))
    user_agent: Mapped[str | None] = mapped_column(String(USER_AGENT_MAX))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEntry(Base):
    """One thing that happened: a sign-in, a failure, a lock, a sign-out or a password change."""

    __tablename__ = "audit_log"
    __table_args__ = (
        CheckConstraint(_in_list("event", AUDIT_EVENTS), name="event"),
        Index("ix_audit_log_created_at", text("created_at DESC")),  # the newest 100 entries
        # How many failures came from one address lately (the limit on tries from one IP).
        Index("ix_audit_log_ip_created_at", "ip", text("created_at DESC")),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    event: Mapped[str] = mapped_column(String(32))
    ip: Mapped[str | None] = mapped_column(String(IP_MAX))
    user_agent: Mapped[str | None] = mapped_column(String(USER_AGENT_MAX))
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
