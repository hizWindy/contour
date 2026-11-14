"""PLAN-V16 T2-4: the tables for Property Daily and Arealytics, in the `core` schema.

- `core.property_records`: our copy of what a tool told us about a company's office. A fact is
  saved once (`source` and `record_key` are unique).
- `core.property_lookups`: when each tool was last asked about each company (the 30-day memory).
- `core.source_reads`: one row for every page a tool served us. Never the page's content.
- `core.source_state`: one row for each tool: a 24-hour pause after a block, and the last problem.

All four start empty. Nothing else changes.

Revision ID: 0018_property_sources
Revises: 0017_call_prep
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_property_sources"
down_revision: str | Sequence[str] | None = "0017_call_prep"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
# The ways a page can go (core.sources.models.OUTCOMES, frozen here as they were on 15 Nov).
OUTCOMES = (
    "ok",
    "not_found",
    "signin_page",
    "signin_failed",
    "signin_twice",
    "captcha",
    "lockout",
    "forbidden",
    "rate_limited",
    "timeout",
    "error",
)


def _in_list(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    op.create_table(
        "property_lookups",
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("company_key", sa.Text(), nullable=False),
        sa.Column("company", sa.Text(), nullable=False),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("records", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("looked_up_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "source IN ('property_daily', 'arealytics')", name=op.f("ck_property_lookups_source")
        ),
        sa.CheckConstraint(
            "status IN ('found', 'not_found', 'error')", name=op.f("ck_property_lookups_status")
        ),
        sa.CheckConstraint("records >= 0", name=op.f("ck_property_lookups_records")),
        sa.PrimaryKeyConstraint("source", "company_key", name=op.f("pk_property_lookups")),
        schema="core",
    )
    op.create_table(
        "property_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("via", sa.String(length=16), nullable=False),
        sa.Column("company", sa.Text(), nullable=False),
        sa.Column("company_key", sa.Text(), nullable=False),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("building", sa.Text(), nullable=True),
        sa.Column("floor", sa.Text(), nullable=True),
        sa.Column("area_m2", sa.Integer(), nullable=True),
        sa.Column("lease_start", sa.Date(), nullable=True),
        sa.Column("lease_end", sa.Date(), nullable=True),
        sa.Column("happened_on", sa.Date(), nullable=True),
        sa.Column("published_on", sa.Date(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("ref", sa.String(length=64), nullable=True),
        sa.Column("record_key", sa.String(length=64), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('lease', 'move', 'requirement', 'fitout', 'building', 'occupier', 'news')",
            name=op.f("ck_property_records_kind"),
        ),
        sa.CheckConstraint(
            "source IN ('property_daily', 'arealytics')", name=op.f("ck_property_records_source")
        ),
        sa.CheckConstraint(
            "via IN ('feed', 'lease_endings', 'lookup')", name=op.f("ck_property_records_via")
        ),
        sa.CheckConstraint(
            "area_m2 IS NULL OR area_m2 >= 0", name=op.f("ck_property_records_area_m2")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_property_records")),
        sa.UniqueConstraint("source", "record_key", name="uq_property_records_record"),
        schema="core",
    )
    op.create_index(
        "ix_property_records_company_key",
        "property_records",
        ["company_key"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_property_records_via_read_at",
        "property_records",
        ["via", "read_at"],
        unique=False,
        schema="core",
    )
    op.create_table(
        "source_reads",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("ms", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            _in_list("outcome", OUTCOMES),
            name=op.f("ck_source_reads_outcome"),
        ),
        sa.CheckConstraint(
            "source IN ('property_daily', 'arealytics')", name=op.f("ck_source_reads_source")
        ),
        sa.CheckConstraint("ms >= 0", name=op.f("ck_source_reads_ms")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_reads")),
        schema="core",
    )
    op.create_index(
        "ix_source_reads_run_id",
        "source_reads",
        ["run_id"],
        unique=False,
        schema="core",
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )
    op.create_index(
        "ix_source_reads_source_at", "source_reads", ["source", "at"], unique=False, schema="core"
    )
    op.create_table(
        "source_state",
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("paused_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pause_reason", sa.String(length=16), nullable=True),
        sa.Column("last_problem", sa.String(length=16), nullable=True),
        sa.Column("last_problem_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signed_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"last_problem IS NULL OR {_in_list('last_problem', OUTCOMES)}",
            name=op.f("ck_source_state_last_problem"),
        ),
        sa.CheckConstraint(
            f"pause_reason IS NULL OR {_in_list('pause_reason', OUTCOMES)}",
            name=op.f("ck_source_state_pause_reason"),
        ),
        sa.CheckConstraint(
            "source IN ('property_daily', 'arealytics')", name=op.f("ck_source_state_source")
        ),
        sa.PrimaryKeyConstraint("source", name=op.f("pk_source_state")),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("source_state", schema="core")
    op.drop_index("ix_source_reads_source_at", table_name="source_reads", schema="core")
    op.drop_index(
        "ix_source_reads_run_id",
        table_name="source_reads",
        schema="core",
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )
    op.drop_table("source_reads", schema="core")
    op.drop_index("ix_property_records_via_read_at", table_name="property_records", schema="core")
    op.drop_index("ix_property_records_company_key", table_name="property_records", schema="core")
    op.drop_table("property_records", schema="core")
    op.drop_table("property_lookups", schema="core")
