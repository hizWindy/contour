"""Sign-in (PLAN-V6 B1): the users, their sessions and the sign-in log.

- `core.users`: one row for each person who may sign in. The email (and the username) is saved in
  lower case and is unique. Only the password's argon2id hash is kept.
- `core.sessions`: one row for each signed-in browser. Only a hash of the cookie's token is kept
  (a check refuses anything that isn't a SHA-256 in hex). It goes with its user.
- `core.audit_log`: every sign-in, failure, lock, sign-out and password change. It keeps its rows
  when a user is deleted.

Revision ID: 0010_auth_tables
Revises: 0009_hubspot_sync
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_auth_tables"
down_revision: str | Sequence[str] | None = "0009_hubspot_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"

# Frozen copies of the rules, so this migration never changes when the models do.
ROLES = ("admin", "staff", "viewer")
AUDIT_EVENTS = (
    "sign_in",
    "sign_in_failed",
    "account_locked",
    "sign_out",
    "sign_out_everywhere",
    "password_changed",
    "account_created",
)
USERNAME_PATTERN = "^[a-z0-9][a-z0-9._-]{2,63}$"
TOKEN_HASH_PATTERN = "^[0-9a-f]{64}$"


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _now(name: str, *, nullable: bool = False) -> sa.Column[object]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=nullable
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("username", sa.String(64), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(16), server_default="admin", nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        _now("password_changed_at"),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        _now("created_at"),
        sa.Column("last_signed_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(_in_list("role", ROLES), name=op.f("ck_users_role")),
        sa.CheckConstraint(
            "email = lower(btrim(email)) AND position('@' IN email) > 1",
            name=op.f("ck_users_email"),
        ),
        sa.CheckConstraint(
            f"username IS NULL OR username ~ '{USERNAME_PATTERN}'",
            name=op.f("ck_users_username"),
        ),
        sa.CheckConstraint("failed_attempts >= 0", name=op.f("ck_users_failed_attempts")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
        sa.UniqueConstraint("username", name=op.f("uq_users_username")),
        schema=SCHEMA,
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        _now("created_at"),
        _now("last_seen_at"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("remember", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            f"token_hash ~ '{TOKEN_HASH_PATTERN}'", name=op.f("ck_sessions_token_hash")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_sessions_token_hash")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_sessions_user_open",
        "sessions",
        ["user_id"],
        schema=SCHEMA,
        postgresql_where=sa.text("ended_at IS NULL"),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        _now("created_at"),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.String(32), nullable=False),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint(_in_list("event", AUDIT_EVENTS), name=op.f("ck_audit_log_event")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_audit_log_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_audit_log_created_at", "audit_log", [sa.text("created_at DESC")], schema=SCHEMA
    )
    op.create_index(
        "ix_audit_log_ip_created_at",
        "audit_log",
        ["ip", sa.text("created_at DESC")],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_audit_log_ip_created_at", table_name="audit_log", schema=SCHEMA)
    op.drop_index("ix_audit_log_created_at", table_name="audit_log", schema=SCHEMA)
    op.drop_table("audit_log", schema=SCHEMA)
    op.drop_index("ix_sessions_user_open", table_name="sessions", schema=SCHEMA)
    op.drop_table("sessions", schema=SCHEMA)
    op.drop_table("users", schema=SCHEMA)
