"""Runs (core.runs, core.run_events), settings (core.settings) and the search log's run link.

Revision ID: 0003_runs_settings
Revises: 0002_searches_leads
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_runs_settings"
down_revision: str | Sequence[str] | None = "0002_searches_leads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("app", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="queued", nullable=False),
        sa.Column(
            "params",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "caps",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("rules_version", sa.String(length=32), server_default="", nullable=False),
        sa.Column("prompt_versions", sa.String(length=128), server_default="", nullable=False),
        sa.Column(
            "cost_usd",
            sa.Numeric(precision=12, scale=6),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("web_searches", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("claude_requests", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "counts",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("stop_reason", sa.String(length=120), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_id", sa.String(length=16), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'interrupted')",
            name=op.f("ck_runs_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_runs")),
        schema="core",
    )
    op.create_index(
        "ix_runs_app_created_at", "runs", ["app", sa.text("created_at DESC")], schema="core"
    )
    op.create_index("ix_runs_status", "runs", ["status"], schema="core")
    op.create_index(
        "uq_runs_idempotency_key",
        "runs",
        ["idempotency_key"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    op.create_table(
        "run_events",
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["core.runs.id"],
            name=op.f("fk_run_events_run_id_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("run_id", "seq", name=op.f("pk_run_events")),
        schema="core",
    )

    op.create_table(
        "settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_settings")),
        schema="core",
    )

    # The search log learns which run asked, and has room for longer prompt versions.
    op.add_column("searches", sa.Column("run_id", sa.Uuid(), nullable=True), schema="core")
    op.create_index(op.f("ix_searches_run_id"), "searches", ["run_id"], schema="core")
    op.alter_column(
        "searches",
        "prompt_version",
        existing_type=sa.String(length=32),
        type_=sa.String(length=64),
        existing_nullable=True,
        schema="core",
    )


def downgrade() -> None:
    # Longer prompt versions are cut to fit the old column, which loses a few characters.
    op.alter_column(
        "searches",
        "prompt_version",
        existing_type=sa.String(length=64),
        type_=sa.String(length=32),
        existing_nullable=True,
        schema="core",
        postgresql_using="left(prompt_version, 32)",
    )
    op.drop_index(op.f("ix_searches_run_id"), table_name="searches", schema="core")
    op.drop_column("searches", "run_id", schema="core")
    op.drop_table("settings", schema="core")
    op.drop_table("run_events", schema="core")
    op.drop_index("uq_runs_idempotency_key", table_name="runs", schema="core")
    op.drop_index("ix_runs_status", table_name="runs", schema="core")
    op.drop_index("ix_runs_app_created_at", table_name="runs", schema="core")
    op.drop_table("runs", schema="core")
