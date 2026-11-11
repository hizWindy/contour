"""PLAN-V15 T1-3: a HubSpot sync shows it is alive, can be stopped, and says its phase.

- `heartbeat_at`: a running sync writes it every few seconds. A running row whose heartbeat is
  old (or missing) is left over from a stopped backend, and is marked interrupted.
- `cancel_requested_at`: when someone pressed Stop. The sync sees it within seconds, even when it
  runs on the other backend during a deploy.
- `phase`: reading, saving, people or profiles while it runs.
- `people_saved`, `profiles_done`, `profiles_total`: progress for the last two phases.
- `profiles_skipped`: the sync saved companies but didn't rebuild their profiles (stopped, or the
  rebuild failed). The next sync then rebuilds them all.
- The status `cancelled`: a person stopped it.

Rows that exist keep their values. The new columns start empty (or 0, or false).

Revision ID: 0016_sync_cancel
Revises: 0015_script_notes
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_sync_cancel"
down_revision: str | Sequence[str] | None = "0015_script_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"
TABLE = "hubspot_syncs"
OLD_STATUSES = ("running", "done", "failed", "interrupted")
NEW_STATUSES = (*OLD_STATUSES, "cancelled")
PHASES = ("reading", "saving", "people", "profiles")


def _in_list(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _status_rule(values: Sequence[str]) -> None:
    op.drop_constraint(op.f("ck_hubspot_syncs_status"), TABLE, type_="check", schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_hubspot_syncs_status"), TABLE, _in_list("status", values), schema=SCHEMA
    )


def _zero(name: str) -> sa.Column[int]:
    return sa.Column(name, sa.Integer(), server_default=sa.text("0"), nullable=False)


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("heartbeat_at", sa.DateTime(timezone=True)), schema=SCHEMA)
    op.add_column(
        TABLE, sa.Column("cancel_requested_at", sa.DateTime(timezone=True)), schema=SCHEMA
    )
    op.add_column(TABLE, sa.Column("phase", sa.String(16)), schema=SCHEMA)
    op.add_column(TABLE, _zero("people_saved"), schema=SCHEMA)
    op.add_column(TABLE, _zero("profiles_done"), schema=SCHEMA)
    op.add_column(TABLE, _zero("profiles_total"), schema=SCHEMA)
    op.add_column(
        TABLE,
        sa.Column(
            "profiles_skipped", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_hubspot_syncs_phase"),
        TABLE,
        f"phase IS NULL OR {_in_list('phase', PHASES)}",
        schema=SCHEMA,
    )
    _status_rule(NEW_STATUSES)


def downgrade() -> None:
    # A cancelled sync reads as interrupted in the old shape: both ended before they finished.
    op.execute(
        sa.text(f"UPDATE {SCHEMA}.{TABLE} SET status = 'interrupted' WHERE status = 'cancelled'")
    )
    _status_rule(OLD_STATUSES)
    op.drop_constraint(op.f("ck_hubspot_syncs_phase"), TABLE, type_="check", schema=SCHEMA)
    for column in (
        "profiles_skipped",
        "profiles_total",
        "profiles_done",
        "people_saved",
        "phase",
        "cancel_requested_at",
        "heartbeat_at",
    ):
        op.drop_column(TABLE, column, schema=SCHEMA)
