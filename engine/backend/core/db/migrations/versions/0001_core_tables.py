"""Core tables: memory (pgvector) and the copy of HubSpot data.

Also turns on pgvector and makes the `core` and `lead_finder` schemas.

Revision ID: 0001_core_tables
Revises:
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "0001_core_tables"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMBEDDING_DIM = 384


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE SCHEMA IF NOT EXISTS core")
    op.execute("CREATE SCHEMA IF NOT EXISTS lead_finder")

    op.create_table(
        "memory",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("app", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("subject", sa.String(300), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("source_date", sa.Date(), nullable=True),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("embedding", Vector(EMBEDDING_DIM), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('source_note', 'company_profile', 'lead_outcome', 'note')",
            name=op.f("ck_memory_kind"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_memory")),
        schema="core",
    )
    op.create_index("ix_memory_app_kind", "memory", ["app", "kind"], schema="core")
    op.create_index(
        "ix_memory_embedding",
        "memory",
        ["embedding"],
        schema="core",
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    op.create_table(
        "hubspot_companies",
        sa.Column("hubspot_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("website", sa.String(300), nullable=True),
        sa.Column("domain", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("street", sa.String(300), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("state", sa.String(3), nullable=True),
        sa.Column("state_raw", sa.String(64), nullable=True),
        sa.Column("postal_code", sa.String(16), nullable=True),
        sa.Column("country", sa.String(80), nullable=True),
        sa.Column("industry", sa.String(120), nullable=True),
        sa.Column("employees", sa.Integer(), nullable=True),
        sa.Column("linkedin_staff_au", sa.Integer(), nullable=True),
        sa.Column("offices_on_record", sa.Text(), nullable=True),
        sa.Column("lifecycle_stage", sa.String(64), nullable=True),
        sa.Column("owner", sa.String(120), nullable=True),
        sa.Column("created_in_hubspot", sa.Date(), nullable=True),
        sa.Column("last_contacted", sa.Date(), nullable=True),
        sa.Column("contacts_count", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("linkedin_url", sa.Text(), nullable=True),
        sa.Column("hubspot_url", sa.Text(), nullable=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("hubspot_id", name=op.f("pk_hubspot_companies")),
        schema="core",
    )
    op.create_index("ix_hubspot_companies_domain", "hubspot_companies", ["domain"], schema="core")

    op.create_table(
        "hubspot_offices",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("hubspot_company_id", sa.String(32), nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("level", sa.String(64), nullable=True),
        sa.Column("street", sa.String(300), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("postal_code", sa.String(16), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("last_moved", sa.Date(), nullable=True),
        sa.Column("lease_expiry", sa.Date(), nullable=True),
        sa.Column("linkedin_staff", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["hubspot_company_id"],
            ["core.hubspot_companies.hubspot_id"],
            name=op.f("fk_hubspot_offices_hubspot_company_id_hubspot_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hubspot_offices")),
        schema="core",
    )
    op.create_index(
        "ix_hubspot_offices_hubspot_company_id",
        "hubspot_offices",
        ["hubspot_company_id"],
        schema="core",
    )

    op.create_table(
        "hubspot_deals",
        sa.Column("hubspot_deal_id", sa.String(32), nullable=False),
        sa.Column("hubspot_company_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("stage", sa.String(64), nullable=True),
        sa.Column("amount_aud", sa.Numeric(14, 2), nullable=True),
        sa.Column("close_date", sa.Date(), nullable=True),
        sa.Column("owner", sa.String(120), nullable=True),
        sa.Column("created_in_hubspot", sa.Date(), nullable=True),
        sa.Column("last_contacted", sa.Date(), nullable=True),
        sa.Column("next_step", sa.Text(), nullable=True),
        sa.Column("hubspot_url", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["hubspot_company_id"],
            ["core.hubspot_companies.hubspot_id"],
            name=op.f("fk_hubspot_deals_hubspot_company_id_hubspot_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("hubspot_deal_id", name=op.f("pk_hubspot_deals")),
        schema="core",
    )
    op.create_index(
        "ix_hubspot_deals_hubspot_company_id",
        "hubspot_deals",
        ["hubspot_company_id"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("hubspot_deals", schema="core")
    op.drop_table("hubspot_offices", schema="core")
    op.drop_table("hubspot_companies", schema="core")
    op.drop_table("memory", schema="core")
    op.execute("DROP SCHEMA IF EXISTS lead_finder")
    op.execute("DROP SCHEMA IF EXISTS core")
