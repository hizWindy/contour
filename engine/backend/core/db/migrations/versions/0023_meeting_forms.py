"""PLAN-V17 T2-10: pre-meeting forms.

- `companies.meeting_forms`: one pre-read for each client meeting. The meeting it is for (HubSpot's
  `meeting_id`, or none for one typed in), kept as it was: the company, the title, the times and
  where. The facts (no AI), the three summaries (each by the AI or a person, with its sources), the
  rep's two blanks (`next_step`, `going`), who it went to and when, a `version` for the email's
  key, its copy in HubSpot (`hubspot_copy`, its sentence and its write), what it cost, and who
  started it (a person, or the morning job).
- A unique index on `meeting_id` where it is set, so a meeting never gets two forms.
- `companies.call_notes.meeting_id`: the HubSpot meeting a transcript came from (Log meeting,
  T2-15), with an index. Existing notes have none.

It follows 0021 in Track 2's branch. At the PLAN-V17 M5 merge, `down_revision` becomes
"0022_hubspot_meetings" (Track 1's migration): that one line changes.

Revision ID: 0023_meeting_forms
Revises: 0021_call_notes
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_meeting_forms"
down_revision: str | Sequence[str] | None = "0021_call_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"


def _now(name: str) -> sa.Column[object]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def _later(name: str) -> sa.Column[object]:
    """A time set when it happens, like when the form was sent."""
    return sa.Column(name, sa.DateTime(timezone=True), nullable=True)


def _json(name: str, empty: str) -> sa.Column[object]:
    return sa.Column(
        name,
        postgresql.JSONB(astext_type=sa.Text()),
        server_default=sa.text(f"'{empty}'::jsonb"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "meeting_forms",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("meeting_id", sa.String(32), nullable=True),
        sa.Column("company_key", sa.String(64), nullable=False),
        sa.Column("company_name", sa.String(300), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("where", sa.String(16), server_default="unknown", nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        _json("facts", "[]"),
        _json("summaries", "{}"),
        sa.Column("next_step", sa.Text(), nullable=True),
        sa.Column("going", sa.Text(), nullable=True),
        _json("sent_to", "[]"),
        _later("sent_at"),
        sa.Column("sent_by", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("hubspot_copy", sa.String(16), nullable=True),
        sa.Column("hubspot_copy_sentence", sa.Text(), nullable=True),
        sa.Column("hubspot_write_id", sa.Uuid(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(10, 6), server_default=sa.text("0"), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("made_by", sa.Uuid(), nullable=True),
        sa.Column("trigger", sa.String(8), server_default="person", nullable=False),
        _now("created_at"),
        _now("updated_at"),
        _later("drafted_at"),
        sa.CheckConstraint(
            "\"where\" IN ('online', 'in_person', 'unknown')", name=op.f("ck_meeting_forms_where")
        ),
        sa.CheckConstraint(
            "status IN ('drafting', 'draft', 'sent', 'failed')",
            name=op.f("ck_meeting_forms_status"),
        ),
        sa.CheckConstraint(
            "hubspot_copy IN ('saved', 'waiting', 'off', 'failed')",
            name=op.f("ck_meeting_forms_hubspot_copy"),
        ),
        sa.CheckConstraint("trigger IN ('person', 'job')", name=op.f("ck_meeting_forms_trigger")),
        sa.CheckConstraint("version >= 1", name=op.f("ck_meeting_forms_version")),
        sa.ForeignKeyConstraint(
            ["sent_by"],
            [f"{CORE}.users.id"],
            name=op.f("fk_meeting_forms_sent_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["hubspot_write_id"],
            [f"{CORE}.hubspot_writes.id"],
            name=op.f("fk_meeting_forms_hubspot_write_id_hubspot_writes"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["made_by"],
            [f"{CORE}.users.id"],
            name=op.f("fk_meeting_forms_made_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_meeting_forms")),
        schema=COMPANIES,
    )
    op.create_index(
        "ux_meeting_forms_meeting",
        "meeting_forms",
        ["meeting_id"],
        unique=True,
        schema=COMPANIES,
        postgresql_where=sa.text("meeting_id IS NOT NULL"),
    )
    op.create_index(
        "ix_meeting_forms_company",
        "meeting_forms",
        ["company_key", sa.text("starts_at DESC")],
        schema=COMPANIES,
    )
    op.create_index(
        "ix_meeting_forms_made_by",
        "meeting_forms",
        ["made_by", sa.text("created_at DESC")],
        schema=COMPANIES,
    )
    op.add_column(
        "call_notes", sa.Column("meeting_id", sa.String(32), nullable=True), schema=COMPANIES
    )
    op.create_index("ix_call_notes_meeting", "call_notes", ["meeting_id"], schema=COMPANIES)


def downgrade() -> None:
    op.drop_index("ix_call_notes_meeting", table_name="call_notes", schema=COMPANIES)
    op.drop_column("call_notes", "meeting_id", schema=COMPANIES)
    op.drop_index("ix_meeting_forms_made_by", table_name="meeting_forms", schema=COMPANIES)
    op.drop_index("ix_meeting_forms_company", table_name="meeting_forms", schema=COMPANIES)
    op.drop_index("ux_meeting_forms_meeting", table_name="meeting_forms", schema=COMPANIES)
    op.drop_table("meeting_forms", schema=COMPANIES)
