"""PLAN-V17 T2-2: call notes.

- `companies.call_notes`: one row for each call a rep logs. Who made it, the company and the
  person, the prep it came from (or none), the note as typed or said, its source, when the call
  was, the status, what the sorter made (`sorted`, kept as it came), the note as it will be sent
  with the rep's edits (`card`), what it cost, and the write it became (`core.hubspot_writes`).
- A unique index on the person and the `Idempotency-Key`, so a double press is one note. With
  sign-in off nobody is signed in, so "no user" counts as one person, as in 0015 and 0017.

Nothing that exists changes.

It followed 0017 in Track 2's branch. At the PLAN-V17 merge (16 Nov) it follows
"0020_hubspot_owner_link" (Track 1's migration).

Revision ID: 0021_call_notes
Revises: 0020_hubspot_owner_link
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021_call_notes"
down_revision: str | Sequence[str] | None = "0020_hubspot_owner_link"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"
NO_USER = "'00000000-0000-0000-0000-000000000000'::uuid"


def _now(name: str) -> sa.Column[object]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def _later(name: str) -> sa.Column[object]:
    """A time set when it happens, like when the note was sorted."""
    return sa.Column(name, sa.DateTime(timezone=True), nullable=True)


def upgrade() -> None:
    op.create_table(
        "call_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("made_by", sa.Uuid(), nullable=True),
        sa.Column("idempotency_key", sa.String(64), nullable=True),
        sa.Column("company_key", sa.String(64), nullable=False),
        sa.Column("company_name", sa.String(300), nullable=False),
        sa.Column("contact_id", sa.String(32), nullable=True),
        sa.Column("person_name", sa.String(240), nullable=True),
        sa.Column("person_title", sa.String(200), nullable=True),
        sa.Column("prep_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sorted_by", sa.String(8), server_default="person", nullable=False),
        sa.Column("sorted", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "card",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("left_out", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("cost_usd", sa.Numeric(10, 6), server_default=sa.text("0"), nullable=False),
        sa.Column("write_id", sa.Uuid(), nullable=True),
        sa.Column("hubspot_url", sa.String(500), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        _now("created_at"),
        _now("updated_at"),
        _later("sorted_at"),
        _later("confirmed_at"),
        _later("finished_at"),
        sa.CheckConstraint(
            "source IN ('mic', 'typed', 'transcript')", name=op.f("ck_call_notes_source")
        ),
        sa.CheckConstraint(
            "status IN ('sorting', 'to_confirm', 'sending', 'logged', 'partial', 'failed', "
            "'uncertain')",
            name=op.f("ck_call_notes_status"),
        ),
        sa.CheckConstraint("sorted_by IN ('ai', 'person')", name=op.f("ck_call_notes_sorted_by")),
        sa.ForeignKeyConstraint(
            ["made_by"],
            [f"{CORE}.users.id"],
            name=op.f("fk_call_notes_made_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["prep_id"],
            [f"{COMPANIES}.preps.id"],
            name=op.f("fk_call_notes_prep_id_preps"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["write_id"],
            [f"{CORE}.hubspot_writes.id"],
            name=op.f("fk_call_notes_write_id_hubspot_writes"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_call_notes")),
        schema=COMPANIES,
    )
    op.create_index(
        "ux_call_notes_idempotency",
        "call_notes",
        [sa.text(f"coalesce(made_by, {NO_USER})"), "idempotency_key"],
        unique=True,
        schema=COMPANIES,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.create_index(
        "ix_call_notes_made_by_status",
        "call_notes",
        ["made_by", "status", sa.text("created_at DESC")],
        schema=COMPANIES,
    )
    op.create_index(
        "ix_call_notes_company",
        "call_notes",
        ["company_key", sa.text("created_at DESC")],
        schema=COMPANIES,
    )


def downgrade() -> None:
    op.drop_index("ix_call_notes_company", table_name="call_notes", schema=COMPANIES)
    op.drop_index("ix_call_notes_made_by_status", table_name="call_notes", schema=COMPANIES)
    op.drop_index("ux_call_notes_idempotency", table_name="call_notes", schema=COMPANIES)
    op.drop_table("call_notes", schema=COMPANIES)
