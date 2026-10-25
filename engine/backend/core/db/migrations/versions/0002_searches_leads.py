"""The search log (core.searches) and the Lead Finder's lead cards (lead_finder.leads).

Revision ID: 0002_searches_leads
Revises: 0001_core_tables
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_searches_leads"
down_revision: str | Sequence[str] | None = "0001_core_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "searches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("app", sa.String(length=64), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("subject", sa.String(length=300), nullable=True),
        sa.Column("step", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=True),
        sa.Column("queries", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sources", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("web_searches", sa.Integer(), nullable=False),
        sa.Column("web_fetches", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("stop_reason", sa.String(length=32), nullable=True),
        sa.Column("answer_ok", sa.Boolean(), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_searches")),
        schema="core",
    )
    op.create_index(op.f("ix_searches_job_id"), "searches", ["job_id"], unique=False, schema="core")
    op.create_index(
        op.f("ix_searches_subject"), "searches", ["subject"], unique=False, schema="core"
    )
    op.create_table(
        "leads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company", sa.String(length=300), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("result", sa.String(length=32), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="new", nullable=False),
        sa.Column("hubspot_status", sa.String(length=32), nullable=False),
        sa.Column("hubspot_id", sa.String(length=32), nullable=True),
        sa.Column("card", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("web_searches", sa.Integer(), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("prompt_version", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_leads")),
        schema="lead_finder",
    )
    op.create_index(
        op.f("ix_leads_company"), "leads", ["company"], unique=False, schema="lead_finder"
    )
    op.create_index(
        op.f("ix_leads_result"), "leads", ["result"], unique=False, schema="lead_finder"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_leads_result"), table_name="leads", schema="lead_finder")
    op.drop_index(op.f("ix_leads_company"), table_name="leads", schema="lead_finder")
    op.drop_table("leads", schema="lead_finder")
    op.drop_index(op.f("ix_searches_subject"), table_name="searches", schema="core")
    op.drop_index(op.f("ix_searches_job_id"), table_name="searches", schema="core")
    op.drop_table("searches", schema="core")
