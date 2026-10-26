"""An index on the search log's creation time.

The Searches page lists the log newest first, and the daily cap adds up the cost of the last
24 hours. Both filter on `created_at`.

Revision ID: 0005_searches_created_at
Revises: 0004_lead_columns
Create Date: 2026-10-26
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005_searches_created_at"
down_revision: str | Sequence[str] | None = "0004_lead_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_searches_created_at", "searches", ["created_at"], schema="core")


def downgrade() -> None:
    op.drop_index("ix_searches_created_at", table_name="searches", schema="core")
