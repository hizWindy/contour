"""PLAN-V10: the Companies page and call prep.

- `core.hubspot_contacts` and `core.hubspot_calls` (C1): people and logged calls, copied from
  HubSpot once its key can read them (TBC: the admin adds the scopes).
- The `companies` schema and `companies.preps` (D3): each call script, with what it rested on,
  what it cost and who asked.

Nothing that exists changes.

Revision ID: 0014_companies
Revises: 0013_plan_v9
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_companies"
down_revision: str | Sequence[str] | None = "0013_plan_v9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"


def _now(name: str, *, nullable: bool = False) -> sa.Column[object]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=nullable
    )


def upgrade() -> None:
    op.create_table(
        "hubspot_contacts",
        sa.Column("hubspot_id", sa.String(32), nullable=False),
        sa.Column("hubspot_company_id", sa.String(32), nullable=True),
        sa.Column("first_name", sa.String(120), nullable=True),
        sa.Column("last_name", sa.String(120), nullable=True),
        sa.Column("name", sa.String(240), nullable=False),
        sa.Column("job_title", sa.String(200), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("mobile", sa.String(64), nullable=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("last_activity", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hubspot_url", sa.Text(), nullable=True),
        sa.Column("hubspot_updated_at", sa.DateTime(timezone=True), nullable=True),
        _now("imported_at"),
        sa.PrimaryKeyConstraint("hubspot_id", name=op.f("pk_hubspot_contacts")),
        schema=CORE,
    )
    op.create_index(
        "ix_hubspot_contacts_company", "hubspot_contacts", ["hubspot_company_id"], schema=CORE
    )
    op.create_index(
        "ix_hubspot_contacts_name", "hubspot_contacts", [sa.text("lower(name)")], schema=CORE
    )

    op.create_table(
        "hubspot_calls",
        sa.Column("hubspot_id", sa.String(32), nullable=False),
        sa.Column("hubspot_company_id", sa.String(32), nullable=True),
        sa.Column("hubspot_contact_id", sa.String(32), nullable=True),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(64), nullable=True),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("owner", sa.String(120), nullable=True),
        sa.Column("owner_id", sa.String(32), nullable=True),
        sa.Column("hubspot_url", sa.Text(), nullable=True),
        _now("imported_at"),
        sa.PrimaryKeyConstraint("hubspot_id", name=op.f("pk_hubspot_calls")),
        schema=CORE,
    )
    op.create_index(
        "ix_hubspot_calls_company_called_at",
        "hubspot_calls",
        ["hubspot_company_id", sa.text("called_at DESC")],
        schema=CORE,
    )
    op.create_index(
        "ix_hubspot_calls_contact", "hubspot_calls", ["hubspot_contact_id"], schema=CORE
    )

    op.execute(f"CREATE SCHEMA IF NOT EXISTS {COMPANIES}")
    op.create_table(
        "preps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_key", sa.String(64), nullable=False),
        sa.Column("company_name", sa.String(300), nullable=False),
        sa.Column("contact_id", sa.String(32), nullable=True),
        sa.Column("person_name", sa.String(240), nullable=True),
        sa.Column("person_title", sa.String(200), nullable=True),
        sa.Column("kind", sa.String(16), server_default="person", nullable=False),
        sa.Column("trigger", sa.String(16), server_default="person", nullable=False),
        sa.Column("status", sa.String(16), server_default="searching", nullable=False),
        sa.Column("stage", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "facts",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("script", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "sources",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("cost_usd", sa.Numeric(12, 6), server_default=sa.text("0"), nullable=False),
        sa.Column("web_searches", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("made_by", sa.Uuid(), nullable=True),
        _now("created_at"),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('searching', 'ready', 'failed')", name=op.f("ck_preps_status")
        ),
        sa.CheckConstraint("kind IN ('person', 'cold')", name=op.f("ck_preps_kind")),
        sa.CheckConstraint("trigger IN ('person', 'search_ahead')", name=op.f("ck_preps_trigger")),
        sa.ForeignKeyConstraint(
            ["made_by"],
            [f"{CORE}.users.id"],
            name=op.f("fk_preps_made_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_preps")),
        schema=COMPANIES,
    )
    op.create_index(
        "ix_preps_company_contact",
        "preps",
        ["company_key", "contact_id", sa.text("created_at DESC")],
        schema=COMPANIES,
    )
    op.create_index(
        "ix_preps_made_by_created_at",
        "preps",
        ["made_by", sa.text("created_at DESC")],
        schema=COMPANIES,
    )


def downgrade() -> None:
    op.drop_index("ix_preps_made_by_created_at", table_name="preps", schema=COMPANIES)
    op.drop_index("ix_preps_company_contact", table_name="preps", schema=COMPANIES)
    op.drop_table("preps", schema=COMPANIES)
    op.execute(f"DROP SCHEMA IF EXISTS {COMPANIES}")
    op.drop_index("ix_hubspot_calls_contact", table_name="hubspot_calls", schema=CORE)
    op.drop_index("ix_hubspot_calls_company_called_at", table_name="hubspot_calls", schema=CORE)
    op.drop_table("hubspot_calls", schema=CORE)
    op.drop_index("ix_hubspot_contacts_name", table_name="hubspot_contacts", schema=CORE)
    op.drop_index("ix_hubspot_contacts_company", table_name="hubspot_contacts", schema=CORE)
    op.drop_table("hubspot_contacts", schema=CORE)
