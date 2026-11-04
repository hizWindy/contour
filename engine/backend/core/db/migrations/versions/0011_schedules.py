"""Schedules (PLAN-V6 D1): `core.schedules`, and a new way to start a HubSpot sync.

- `core.schedules`: one row for each job that starts on its own (see core/schedules/models.py).
  A schedule that is on has a next time, and one that is off has none (a check keeps them
  together). A partial index serves the loop that looks for what is due every minute.
- `core.hubspot_syncs.trigger` may now also be `schedule`, for a sync a schedule started.
  Going down turns those into `command` first, so the old rule holds.

Revision ID: 0011_schedules
Revises: 0010_auth_tables
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_schedules"
down_revision: str | Sequence[str] | None = "0010_auth_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"
# Frozen copies of the rules, so this migration never changes when the models do.
UNITS = ("days", "weeks")
LAST_STATUSES = ("starting", "started", "skipped", "failed")
OLD_TRIGGERS = ("command", "website", "startup")
NEW_TRIGGERS = (*OLD_TRIGGERS, "schedule")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    op.create_table(
        "schedules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project", sa.String(64), nullable=False),
        sa.Column("job", sa.String(64), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("every", sa.Integer(), nullable=False),
        sa.Column("unit", sa.String(8), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=True),
        sa.Column("at_time", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(64), server_default="Australia/Melbourne", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(16), nullable=True),
        sa.Column("last_ref", sa.String(64), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("every >= 1", name=op.f("ck_schedules_every")),
        sa.CheckConstraint(_in_list("unit", UNITS), name=op.f("ck_schedules_unit")),
        sa.CheckConstraint(
            "weekday IS NULL OR weekday BETWEEN 0 AND 6", name=op.f("ck_schedules_weekday_range")
        ),
        sa.CheckConstraint(
            "(unit = 'weeks') = (weekday IS NOT NULL)", name=op.f("ck_schedules_weekday")
        ),
        sa.CheckConstraint(
            "enabled = (next_run_at IS NOT NULL)", name=op.f("ck_schedules_next_run")
        ),
        sa.CheckConstraint(
            f"last_status IS NULL OR {_in_list('last_status', LAST_STATUSES)}",
            name=op.f("ck_schedules_last_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_schedules")),
        sa.UniqueConstraint("job", name=op.f("uq_schedules_job")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_schedules_due",
        "schedules",
        ["next_run_at"],
        schema=SCHEMA,
        postgresql_where=sa.text("enabled"),
    )

    op.drop_constraint(
        op.f("ck_hubspot_syncs_trigger"), "hubspot_syncs", type_="check", schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_hubspot_syncs_trigger"),
        "hubspot_syncs",
        _in_list("trigger", NEW_TRIGGERS),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("UPDATE core.hubspot_syncs SET trigger = 'command' WHERE trigger = 'schedule'")
    op.drop_constraint(
        op.f("ck_hubspot_syncs_trigger"), "hubspot_syncs", type_="check", schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_hubspot_syncs_trigger"),
        "hubspot_syncs",
        _in_list("trigger", OLD_TRIGGERS),
        schema=SCHEMA,
    )
    op.drop_index("ix_schedules_due", table_name="schedules", schema=SCHEMA)
    op.drop_table("schedules", schema=SCHEMA)
