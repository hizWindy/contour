"""A saved copy of Signal Hire's company details (PLAN-V4 C1).

Reading a company's details costs 1 company credit. This table keeps each answer, so the same
company is paid for once a month and not once for each run.

Revision ID: 0008_signalhire_details
Revises: 0007_form_failed
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_signalhire_details"
down_revision: str | Sequence[str] | None = "0007_form_failed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "signalhire_details",
        sa.Column("signalhire_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("signalhire_id", name=op.f("pk_signalhire_details")),
        schema="lead_finder",
    )
    op.create_index(
        "ix_signalhire_details_slug", "signalhire_details", ["slug"], schema="lead_finder"
    )


def downgrade() -> None:
    op.drop_index(
        "ix_signalhire_details_slug", table_name="signalhire_details", schema="lead_finder"
    )
    op.drop_table("signalhire_details", schema="lead_finder")
