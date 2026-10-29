"""How many points the tool could check for a lead.

The score is now the Target Customer Profile's 100 points in six parts, and the tool can't judge
every check for every lead. `score_checked` is the most points it could judge ("48 of 60
checked"). A lead scored under version 1 keeps NULL here, and so does a Drop.

Revision ID: 0006_score_checked
Revises: 0005_searches_created_at
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_score_checked"
down_revision: str | Sequence[str] | None = "0005_searches_created_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "leads", sa.Column("score_checked", sa.Integer(), nullable=True), schema="lead_finder"
    )


def downgrade() -> None:
    op.drop_column("leads", "score_checked", schema="lead_finder")
