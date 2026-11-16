"""PLAN-V18 T1-3: HubSpot teams, the companies' last activity, and an index for History.

- `core.hubspot_owner_teams`: which HubSpot team each owner is in (HubSpot's owners list gives
  each owner's teams: its id, its name, and whether it is the owner's main one). Ids and names
  only, never an email. The sync replaces the whole table each time. An owner id is a soft link,
  like the other owner ids in our copy, not a foreign key.
- `core.hubspot_companies.last_activity`: HubSpot's "Last activity date" (`notes_last_updated`,
  read from HubSpot on 16 Nov 2026), the newest call, email, meeting, note or task on the
  company. Empty until the next sync reads it.
- `companies.call_notes`: an index on who logged a call and when it was, newest first, for the
  History list of Call logs.

The table is new and empty, and the column is new and empty, so nothing that exists changes. The
call notes table holds a few hundred rows at most, so the index is made in one step.

Revision ID: 0024_v18_teams_activity
Revises: 0023_meeting_forms
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_v18_teams_activity"
down_revision: str | Sequence[str] | None = "0023_meeting_forms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"


def upgrade() -> None:
    op.create_table(
        "hubspot_owner_teams",
        sa.Column("owner_id", sa.String(32), nullable=False),
        sa.Column("team_id", sa.String(32), nullable=False),
        sa.Column("team_name", sa.String(200), nullable=True),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("owner_id", "team_id", name=op.f("pk_hubspot_owner_teams")),
        schema=CORE,
    )
    op.create_index("ix_hubspot_owner_teams_team", "hubspot_owner_teams", ["team_id"], schema=CORE)
    op.add_column(
        "hubspot_companies",
        sa.Column("last_activity", sa.DateTime(timezone=True), nullable=True),
        schema=CORE,
    )
    op.create_index(
        "ix_call_notes_made_by_called_at",
        "call_notes",
        ["made_by", sa.text("called_at DESC")],
        schema=COMPANIES,
    )


def downgrade() -> None:
    op.drop_index("ix_call_notes_made_by_called_at", table_name="call_notes", schema=COMPANIES)
    op.drop_column("hubspot_companies", "last_activity", schema=CORE)
    op.drop_index("ix_hubspot_owner_teams_team", table_name="hubspot_owner_teams", schema=CORE)
    op.drop_table("hubspot_owner_teams", schema=CORE)
