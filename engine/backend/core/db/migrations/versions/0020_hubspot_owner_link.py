"""PLAN-V17 T1-4: who each account is in HubSpot.

- `core.users.hubspot_owner_id`: the HubSpot owner a person's calls, tasks and notes are logged
  under. HubSpot's owner id (digits), never the owner's email.
- `core.users.hubspot_owner_matched_by`: how the link was made. `email`: the sync found an active
  owner with the account's email. `person`: an Admin set it by hand, and the sync never changes
  it. Empty when there is no link, and the two columns are empty or filled together.

Both columns are new and empty, so the rows that exist keep their values. The table holds a few
accounts, so the checks are added in one step.

Revision ID: 0020_hubspot_owner_link
Revises: 0019_lead_tier (written after 0017_call_prep; PLAN-V16 reached master first, so at the
    PLAN-V17 merge, 16 Nov, it follows PLAN-V16's newest)
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_hubspot_owner_link"
down_revision: str | Sequence[str] | None = "0019_lead_tier"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"
TABLE = "users"
MATCHED_BY = ("email", "person")


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("hubspot_owner_id", sa.String(32)), schema=SCHEMA)
    op.add_column(TABLE, sa.Column("hubspot_owner_matched_by", sa.String(16)), schema=SCHEMA)
    listed = ", ".join(repr(value) for value in MATCHED_BY)
    op.create_check_constraint(
        op.f("ck_users_hubspot_owner_matched_by"),
        TABLE,
        f"hubspot_owner_matched_by IS NULL OR hubspot_owner_matched_by IN ({listed})",
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_users_hubspot_owner_link"),
        TABLE,
        "(hubspot_owner_id IS NULL) = (hubspot_owner_matched_by IS NULL)",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_hubspot_owner_link"), TABLE, type_="check", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_users_hubspot_owner_matched_by"), TABLE, type_="check", schema=SCHEMA
    )
    op.drop_column(TABLE, "hubspot_owner_matched_by", schema=SCHEMA)
    op.drop_column(TABLE, "hubspot_owner_id", schema=SCHEMA)
