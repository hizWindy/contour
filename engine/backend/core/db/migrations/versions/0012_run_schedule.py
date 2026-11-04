"""Runs started by a schedule (PLAN-V6 D2): `core.runs.schedule_id`.

A run that a schedule started carries that schedule's id, so the Runs page can say "Scheduled". A
run a person started has none. Runs that were made before this have none too, which is right: no
schedule started them. If a schedule is ever deleted, its runs stay and lose the mark.

Revision ID: 0012_run_schedule
Revises: 0011_schedules
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_run_schedule"
down_revision: str | Sequence[str] | None = "0011_schedules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column("runs", sa.Column("schedule_id", sa.Uuid(), nullable=True), schema=SCHEMA)
    op.create_foreign_key(
        op.f("fk_runs_schedule_id_schedules"),
        "runs",
        "schedules",
        ["schedule_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_runs_schedule_id_schedules"), "runs", type_="foreignkey", schema=SCHEMA
    )
    op.drop_column("runs", "schedule_id", schema=SCHEMA)
