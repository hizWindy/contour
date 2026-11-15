"""PLAN-V16 T1-6: a lead's tier and its confidence are columns.

- `tier`: A, B, C or discard (Levi's section 6). The list sorts and filters by it.
- `confidence`: high, medium or low. How well the headcount, the signs and the dampener checks are
  sourced.

Both can be empty, and both are indexed. Leads that exist keep them empty: `uv run lead-finder
rejudge --save` judges them again with the current rules and fills them in. Nothing here changes a
lead's result or score.

Revision ID: 0019_lead_tier
Revises: 0018_property_sources (Track 2's tables; joined at M1, when this line and the
down_revision changed from 0017_call_prep)
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_lead_tier"
down_revision: str | Sequence[str] | None = "0018_property_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "lead_finder"
TABLE = "leads"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("tier", sa.String(8), nullable=True), schema=SCHEMA)
    op.add_column(TABLE, sa.Column("confidence", sa.String(8), nullable=True), schema=SCHEMA)
    op.create_index(op.f("ix_leads_tier"), TABLE, ["tier"], unique=False, schema=SCHEMA)
    op.create_index(op.f("ix_leads_confidence"), TABLE, ["confidence"], unique=False, schema=SCHEMA)


def downgrade() -> None:
    op.drop_index(op.f("ix_leads_confidence"), table_name=TABLE, schema=SCHEMA)
    op.drop_index(op.f("ix_leads_tier"), table_name=TABLE, schema=SCHEMA)
    op.drop_column(TABLE, "confidence", schema=SCHEMA)
    op.drop_column(TABLE, "tier", schema=SCHEMA)
