"""PLAN-V28 T1-1 and T1-2: live voice's talks, and each person's switch for it.

- `companies.voice_sessions`: one row for each live voice talk, from V to its end. Counts only:
  who, when, its status and why it ended, the service and model, tokens by kind, seconds of
  listening and talking, tool calls, reconnects and the estimated US$ (an exact decimal, to a
  millionth). No sound, no words and no names (choice 21). The resume handle Google gives is
  kept while the talk may carry on, and the database refuses an ended talk that still has one.
- `core.users.live_voice`: "Live voice (paid by the minute)", false for everyone (choice 16). Only
  the Platform admin turns it on, in Edit person.

The table is new and empty, and the column has a fixed default, so Postgres adds it without
rewriting the users table. Nothing that exists changes. Going down drops both, with what they
held: the month's spending record goes with the table.

Revision ID: 0030_v28_live_voice
Revises: 0029_v26_activity
Create Date: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_v28_live_voice"
down_revision: str | Sequence[str] | None = "0029_v26_activity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"
TABLE = "voice_sessions"
STATUSES = ("ready", "open", "dropped", "ended")
END_REASONS = (
    "stopped",
    "left",
    "dropped",
    "unreachable",
    "time_limit",
    "limit",
    "idle",
    "replaced",
    "expired",
    "refused",
    "restart",
    "error",
)
SERVICES = ("gemini_api", "agent_platform")
TOKENS = (
    "tokens_in_audio",
    "tokens_in_text",
    "tokens_in_other",
    "tokens_out_audio",
    "tokens_out_text",
    "tokens_out_other",
    "tokens_thinking",
    "tokens_tool",
    "tokens_cached",
    "tokens_other",
)
COUNTS = ("listen_seconds", "speak_seconds", "talk_seconds", "tool_calls", "reconnects")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("end_reason", sa.String(16), nullable=True),
        sa.Column("service", sa.String(16), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("resume_handle", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        *(sa.Column(name, sa.BigInteger(), server_default="0", nullable=False) for name in TOKENS),
        *(sa.Column(name, sa.Integer(), server_default="0", nullable=False) for name in COUNTS),
        sa.Column(
            "cost_usd", sa.Numeric(precision=12, scale=6), server_default="0", nullable=False
        ),
        sa.CheckConstraint(_in_list("status", STATUSES), name=op.f("ck_voice_sessions_status")),
        sa.CheckConstraint(
            "end_reason IS NULL OR " + _in_list("end_reason", END_REASONS),
            name=op.f("ck_voice_sessions_end_reason"),
        ),
        sa.CheckConstraint(_in_list("service", SERVICES), name=op.f("ck_voice_sessions_service")),
        sa.CheckConstraint(
            "status <> 'ended' OR resume_handle IS NULL",
            name=op.f("ck_voice_sessions_handle_cleared"),
        ),
        sa.CheckConstraint(
            "(status IN ('ended', 'dropped')) = (ended_at IS NOT NULL)",
            name=op.f("ck_voice_sessions_ended_at"),
        ),
        sa.CheckConstraint(
            "(status IN ('ended', 'dropped')) = (end_reason IS NOT NULL)",
            name=op.f("ck_voice_sessions_ended_why"),
        ),
        sa.CheckConstraint(
            " AND ".join(f"{name} >= 0" for name in (*TOKENS, *COUNTS)) + " AND cost_usd >= 0",
            name=op.f("ck_voice_sessions_counts"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{CORE}.users.id"],
            name=op.f("fk_voice_sessions_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_voice_sessions")),
        schema=COMPANIES,
    )
    # The month's total: every talk started in it.
    op.create_index("ix_voice_sessions_created_at", TABLE, ["created_at"], schema=COMPANIES)
    # A person's talks that haven't ended: a new start ends them.
    op.create_index(
        "ix_voice_sessions_user_live",
        TABLE,
        ["user_id"],
        schema=COMPANIES,
        postgresql_where=sa.text("status <> 'ended'"),
    )
    op.add_column(
        "users",
        sa.Column("live_voice", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=CORE,
    )


def downgrade() -> None:
    op.drop_column("users", "live_voice", schema=CORE)
    op.drop_index("ix_voice_sessions_user_live", table_name=TABLE, schema=COMPANIES)
    op.drop_index("ix_voice_sessions_created_at", table_name=TABLE, schema=COMPANIES)
    op.drop_table(TABLE, schema=COMPANIES)
