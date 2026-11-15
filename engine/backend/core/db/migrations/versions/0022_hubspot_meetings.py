"""PLAN-V17 T1-8: our copy of HubSpot's meetings.

- `core.hubspot_meetings`: the meetings from 90 days back to 60 days ahead (TBC), as the
  `Meeting` model in `core/hubspot/meetings.py` has them. The people on a meeting are ids only:
  HubSpot's contacts (`contact_ids`) and Contour's owners (`owner_id`, `attendee_owner_ids`),
  never an address. `hubspot_company_id` is the first company linked, and `more_companies` says
  there were others.
- `core.hubspot_meeting_reads`: one row for each read of them (the daily sync's, or a refresh),
  so the 15-minute rule and the meetings' status work from the database.

Both tables are new and empty, so nothing that exists changes.

Revision ID: 0022_hubspot_meetings
Revises: 0021_call_notes (Track 1 wrote it after 0020; at the PLAN-V17 merge, 16 Nov, it
    follows Track 2's 0021, and Track 2's 0023 follows this one)
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_hubspot_meetings"
down_revision: str | Sequence[str] | None = "0021_call_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
WHERE = ("online", "in_person", "unknown")
KINDS = ("full", "changes")
STATES = ("done", "waiting", "failed")


def _listed(values: tuple[str, ...]) -> str:
    return ", ".join(repr(value) for value in values)


def _ids(name: str) -> sa.Column[object]:
    return sa.Column(
        name,
        postgresql.ARRAY(sa.String(32)),
        server_default=sa.text("'{}'::varchar[]"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "hubspot_meetings",
        sa.Column("hubspot_id", sa.String(32), nullable=False),
        sa.Column("hubspot_company_id", sa.String(32), nullable=True),
        sa.Column("more_companies", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _ids("contact_ids"),
        sa.Column("owner_id", sa.String(32), nullable=True),
        _ids("attendee_owner_ids"),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("where", sa.String(16), server_default="unknown", nullable=False),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("outcome", sa.String(32), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("hubspot_url", sa.Text(), nullable=True),
        sa.Column("hubspot_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # "where" is a word SQL keeps for itself, so the check quotes it.
        sa.CheckConstraint(
            f'"where" IN ({_listed(WHERE)})', name=op.f("ck_hubspot_meetings_where")
        ),
        sa.PrimaryKeyConstraint("hubspot_id", name=op.f("pk_hubspot_meetings")),
        schema=CORE,
    )
    op.create_index("ix_hubspot_meetings_starts_at", "hubspot_meetings", ["starts_at"], schema=CORE)
    op.create_index(
        "ix_hubspot_meetings_company_starts_at",
        "hubspot_meetings",
        ["hubspot_company_id", "starts_at"],
        schema=CORE,
    )

    op.create_table(
        "hubspot_meeting_reads",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("sentence", sa.Text(), nullable=True),
        sa.Column("changed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"kind IN ({_listed(KINDS)})", name=op.f("ck_hubspot_meeting_reads_kind")
        ),
        sa.CheckConstraint(
            f"state IN ({_listed(STATES)})", name=op.f("ck_hubspot_meeting_reads_state")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hubspot_meeting_reads")),
        schema=CORE,
    )
    op.create_index(
        "ix_hubspot_meeting_reads_started_at",
        "hubspot_meeting_reads",
        [sa.text("started_at DESC")],
        schema=CORE,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_hubspot_meeting_reads_started_at", table_name="hubspot_meeting_reads", schema=CORE
    )
    op.drop_table("hubspot_meeting_reads", schema=CORE)
    op.drop_index(
        "ix_hubspot_meetings_company_starts_at", table_name="hubspot_meetings", schema=CORE
    )
    op.drop_index("ix_hubspot_meetings_starts_at", table_name="hubspot_meetings", schema=CORE)
    op.drop_table("hubspot_meetings", schema=CORE)
