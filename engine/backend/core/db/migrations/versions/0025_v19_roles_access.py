"""Roles, feature ticks, and optional position on `core.users` (PLAN-V19 T1-3, T1-4, T1-5):

- `platform_admin` joins `ck_users_role`, with a partial unique index so at most one exists.
- The oldest active admin becomes the Platform admin (unless one already exists).
- `users.features` holds the eight ticks (`lead_finder.*` and `companies.*`), backfilled from `apps`
  for staff/viewer and all eight for admin/platform_admin, keeping `apps` in sync.
- `users.position` adds optional job title text up to 80 characters.

Revision ID: 0025_v19_roles_access
Revises: 0024_v18_teams_activity
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025_v19_roles_access"
down_revision: str | Sequence[str] | None = "0024_v18_teams_activity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"
TABLE = "users"

OLD_ROLES = ("admin", "staff", "viewer")
NEW_ROLES = ("platform_admin", "admin", "staff", "viewer")

LEAD_FINDER_FEATURES = (
    "lead_finder.start_run",
    "lead_finder.results",
    "lead_finder.rules",
    "lead_finder.send_to_hubspot",
)
COMPANIES_FEATURES = (
    "companies.companies",
    "companies.call_logs",
    "companies.meetings",
    "companies.call_prep",
)
ALL_FEATURES = (*LEAD_FINDER_FEATURES, *COMPANIES_FEATURES)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _array_literal(values: tuple[str, ...]) -> str:
    items = ", ".join(repr(value) for value in values)
    return f"ARRAY[{items}]::varchar[]"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_users_role"), TABLE, type_="check", schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_users_role"), TABLE, _in_list("role", NEW_ROLES), schema=SCHEMA
    )
    op.create_index(
        "ix_users_one_platform_admin",
        TABLE,
        ["role"],
        unique=True,
        postgresql_where=sa.text("role = 'platform_admin'"),
        schema=SCHEMA,
    )
    op.add_column(TABLE, sa.Column("position", sa.String(80), nullable=True), schema=SCHEMA)
    op.add_column(
        TABLE,
        sa.Column(
            "features",
            postgresql.ARRAY(sa.String(64)),
            nullable=False,
            server_default=sa.text("'{}'::varchar[]"),
        ),
        schema=SCHEMA,
    )

    op.execute(
        f"""
        UPDATE {SCHEMA}.{TABLE}
        SET role = 'platform_admin'
        WHERE id = (
            SELECT id FROM {SCHEMA}.{TABLE}
            WHERE role = 'admin' AND active IS TRUE
            ORDER BY created_at ASC, id ASC
            LIMIT 1
        )
        AND NOT EXISTS (
            SELECT 1 FROM {SCHEMA}.{TABLE} WHERE role = 'platform_admin'
        )
        """
    )

    all_features_sql = _array_literal(ALL_FEATURES)
    all_apps_sql = _array_literal(("lead_finder", "companies"))
    lf_features_sql = _array_literal(LEAD_FINDER_FEATURES)
    co_features_sql = _array_literal(COMPANIES_FEATURES)

    op.execute(
        f"""
        UPDATE {SCHEMA}.{TABLE}
        SET features = {all_features_sql},
            apps = {all_apps_sql}
        WHERE role IN ('platform_admin', 'admin')
        """
    )
    op.execute(
        f"""
        UPDATE {SCHEMA}.{TABLE}
        SET features = (
            CASE WHEN 'lead_finder' = ANY(apps) THEN {lf_features_sql} ELSE ARRAY[]::varchar[] END
            ||
            CASE WHEN 'companies' = ANY(apps) THEN {co_features_sql} ELSE ARRAY[]::varchar[] END
        )
        WHERE role IN ('staff', 'viewer')
        """
    )


def downgrade() -> None:
    op.execute(f"UPDATE {SCHEMA}.{TABLE} SET role = 'admin' WHERE role = 'platform_admin'")
    op.drop_index("ix_users_one_platform_admin", table_name=TABLE, schema=SCHEMA)
    op.drop_constraint(op.f("ck_users_role"), TABLE, type_="check", schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_users_role"), TABLE, _in_list("role", OLD_ROLES), schema=SCHEMA
    )
    op.drop_column(TABLE, "features", schema=SCHEMA)
    op.drop_column(TABLE, "position", schema=SCHEMA)
