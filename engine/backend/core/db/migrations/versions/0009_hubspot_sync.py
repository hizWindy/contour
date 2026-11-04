"""HubSpot through the API (PLAN-V5 B4 and B5): the sync log, the owners, the write log, and new
columns on our copy of HubSpot.

- `core.hubspot_syncs`: one row per sync. A partial unique index lets only one run at a time.
- `core.hubspot_owners`: owner ids and names (never an email).
- `core.hubspot_writes`: every write a person asked for, from preview to result. A partial unique
  index lets only one write at a time run for the same subject (like one lead).
- Companies and deals: the owner's id and "changed in HubSpot" time. Deals: the stage id, the
  pipeline, and `source` and `imported_at` like companies have (old rows are "export").
- Offices: the office size, size bracket, quality and staff text HubSpot keeps for each office.
- `source` may only be "export" or "api" (old rows are all "export").

Revision ID: 0009_hubspot_sync
Revises: 0008_signalhire_details
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_hubspot_sync"
down_revision: str | Sequence[str] | None = "0008_signalhire_details"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"


def _count(name: str) -> sa.Column[int]:
    return sa.Column(name, sa.Integer(), server_default=sa.text("0"), nullable=False)


def upgrade() -> None:
    # --- New columns on our copy -------------------------------------------------------------
    op.add_column(
        "hubspot_companies", sa.Column("owner_id", sa.String(32), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "hubspot_companies",
        sa.Column("hubspot_updated_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_hubspot_companies_source"),
        "hubspot_companies",
        "source IN ('export', 'api')",
        schema=SCHEMA,
    )

    for column in (
        sa.Column("office_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("size_bracket", sa.String(32), nullable=True),
        sa.Column("quality", sa.String(32), nullable=True),
        sa.Column("staff_count_text", sa.String(64), nullable=True),
    ):
        op.add_column("hubspot_offices", column, schema=SCHEMA)

    for column in (
        sa.Column("stage_id", sa.String(64), nullable=True),
        sa.Column("pipeline", sa.String(120), nullable=True),
        sa.Column("owner_id", sa.String(32), nullable=True),
        sa.Column("hubspot_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(16), server_default="export", nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ):
        op.add_column("hubspot_deals", column, schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_hubspot_deals_source"),
        "hubspot_deals",
        "source IN ('export', 'api')",
        schema=SCHEMA,
    )

    # --- Owners --------------------------------------------------------------------------------
    op.create_table(
        "hubspot_owners",
        sa.Column("owner_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("owner_id", name=op.f("pk_hubspot_owners")),
        schema=SCHEMA,
    )

    # --- The sync log --------------------------------------------------------------------------
    op.create_table(
        "hubspot_syncs",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), server_default="running", nullable=False),
        sa.Column("changed_since", sa.DateTime(timezone=True), nullable=True),
        _count("companies_read"),
        _count("deals_read"),
        _count("owners_read"),
        _count("companies_saved"),
        _count("offices_saved"),
        _count("deals_saved"),
        _count("deals_skipped"),
        _count("companies_removed"),
        _count("deals_removed"),
        _count("profiles_rebuilt"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "warnings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('full', 'changes')", name=op.f("ck_hubspot_syncs_mode")),
        sa.CheckConstraint(
            "trigger IN ('command', 'website', 'startup')", name=op.f("ck_hubspot_syncs_trigger")
        ),
        sa.CheckConstraint(
            "status IN ('running', 'done', 'failed', 'interrupted')",
            name=op.f("ck_hubspot_syncs_status"),
        ),
        sa.CheckConstraint(
            "(status = 'running') = (finished_at IS NULL)",
            name=op.f("ck_hubspot_syncs_finished"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hubspot_syncs")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_hubspot_syncs_started_at",
        "hubspot_syncs",
        [sa.text("started_at DESC")],
        schema=SCHEMA,
    )
    op.create_index(
        "uq_hubspot_syncs_running",
        "hubspot_syncs",
        ["status"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("status = 'running'"),
    )

    # --- The write log -------------------------------------------------------------------------
    op.create_table(
        "hubspot_writes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("app", sa.String(64), nullable=False),
        sa.Column("subject", sa.String(120), nullable=False),
        sa.Column("status", sa.String(16), server_default="previewed", nullable=False),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "result",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("hubspot_company_id", sa.String(32), nullable=True),
        sa.Column("hubspot_url", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('previewed', 'writing', 'done', 'partial', 'failed', 'uncertain')",
            name=op.f("ck_hubspot_writes_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hubspot_writes")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_hubspot_writes_app_subject", "hubspot_writes", ["app", "subject"], schema=SCHEMA
    )
    op.create_index(
        "ix_hubspot_writes_created_at",
        "hubspot_writes",
        [sa.text("created_at DESC")],
        schema=SCHEMA,
    )
    op.create_index(
        "uq_hubspot_writes_writing",
        "hubspot_writes",
        ["app", "subject"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("status = 'writing'"),
    )


def downgrade() -> None:
    op.drop_index("uq_hubspot_writes_writing", table_name="hubspot_writes", schema=SCHEMA)
    op.drop_index("ix_hubspot_writes_created_at", table_name="hubspot_writes", schema=SCHEMA)
    op.drop_index("ix_hubspot_writes_app_subject", table_name="hubspot_writes", schema=SCHEMA)
    op.drop_table("hubspot_writes", schema=SCHEMA)
    op.drop_index("uq_hubspot_syncs_running", table_name="hubspot_syncs", schema=SCHEMA)
    op.drop_index("ix_hubspot_syncs_started_at", table_name="hubspot_syncs", schema=SCHEMA)
    op.drop_table("hubspot_syncs", schema=SCHEMA)
    op.drop_table("hubspot_owners", schema=SCHEMA)

    op.drop_constraint(
        op.f("ck_hubspot_deals_source"), "hubspot_deals", type_="check", schema=SCHEMA
    )
    for name in ("imported_at", "source", "hubspot_updated_at", "owner_id", "pipeline", "stage_id"):
        op.drop_column("hubspot_deals", name, schema=SCHEMA)
    for name in ("staff_count_text", "quality", "size_bracket", "office_m2"):
        op.drop_column("hubspot_offices", name, schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_hubspot_companies_source"), "hubspot_companies", type_="check", schema=SCHEMA
    )
    op.drop_column("hubspot_companies", "hubspot_updated_at", schema=SCHEMA)
    op.drop_column("hubspot_companies", "owner_id", schema=SCHEMA)
