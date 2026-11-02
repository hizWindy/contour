"""Mark the lead cards whose answer form failed, so the website can show it (PLAN-V4 B4).

From 30 Oct to 2 Nov 2026 Claude refused every answer form (it was too complex), and those cards
say so only in their problems list. This sets `form_failed: true` in them. Data only: no table
changes, and new cards set the flag themselves.

Revision ID: 0007_form_failed
Revises: 0006_score_checked
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_form_failed"
down_revision: str | Sequence[str] | None = "0006_score_checked"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FAILED = "The form couldn't be filled. Every fact is unknown."


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE lead_finder.leads SET card = jsonb_set(card, '{form_failed}', 'true'::jsonb) "
            "WHERE card -> 'problems' @> jsonb_build_array(CAST(:failed AS text))"
        ).bindparams(failed=FAILED)
    )


def downgrade() -> None:
    op.execute(
        "UPDATE lead_finder.leads SET card = card - 'form_failed' "
        "WHERE card -> 'form_failed' IS NOT NULL"
    )
