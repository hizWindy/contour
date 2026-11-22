"""PLAN-V26: who asked Claude, who started a run, and what an admin edited.

- `core.searches.user_id`: the person whose work asked Claude. None for work nobody started, like
  a scheduled job, and for every request from before this migration ("Not recorded before this
  update" on the Activity page).
- `core.runs.started_by`: the person who started the run. None for a schedule's run and older runs.
- `core.admin_edits`: each edit in Admin's Data tab, with the old and the new value, who and
  when. An undo is a row too, and points at the edit it undid.
- The saved `claude_concurrency` goes: the three lanes took its place (PLAN-V26 choice 5), and
  they start at their defaults.

The columns are nullable with no default, so Postgres rewrites nothing, and the old code still
runs with them. Going down drops all three, with what they held. It can't bring the removed
setting back: the old code then uses its default of 2.

**At `merge v26`:** this follows 0027 because `plan-v26` began before PLAN-V25 was merged, on
Al-khair's word (22 Nov). PLAN-V25's `0028_v25_call_type` comes first: point `down_revision` at
it then, and check that `alembic heads` shows one head.

Revision ID: 0029_v26_activity
Revises: 0027_v24_call_needs_company
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0029_v26_activity"
down_revision: str | Sequence[str] | None = "0027_v24_call_needs_company"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "core"
ACTIONS = ("change", "delete", "undo")


def upgrade() -> None:
    op.add_column("searches", sa.Column("user_id", sa.Uuid(), nullable=True), schema=SCHEMA)
    op.create_foreign_key(
        op.f("fk_searches_user_id_users"),
        "searches",
        "users",
        ["user_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    # A person's spending, the newest first. Only the rows that have a person.
    op.create_index(
        "ix_searches_user_id_created_at",
        "searches",
        ["user_id", sa.text("created_at DESC")],
        schema=SCHEMA,
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )

    op.add_column("runs", sa.Column("started_by", sa.Uuid(), nullable=True), schema=SCHEMA)
    op.create_foreign_key(
        op.f("fk_runs_started_by_users"),
        "runs",
        "users",
        ["started_by"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )

    op.create_table(
        "admin_edits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("admin_id", sa.Uuid(), nullable=True),
        sa.Column("table_name", sa.String(length=64), nullable=False),
        sa.Column("row_id", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=8), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("row_after", sa.String(length=64), nullable=True),
        sa.Column("undoes", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            f"action IN ({', '.join(repr(action) for action in ACTIONS)})",
            name=op.f("ck_admin_edits_action"),
        ),
        sa.CheckConstraint(
            "(action = 'undo') = (undoes IS NOT NULL)", name=op.f("ck_admin_edits_undoes")
        ),
        sa.ForeignKeyConstraint(
            ["admin_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_admin_edits_admin_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["undoes"],
            [f"{SCHEMA}.admin_edits.id"],
            name=op.f("fk_admin_edits_undoes_admin_edits"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_admin_edits")),
        sa.UniqueConstraint("undoes", name=op.f("uq_admin_edits_undoes")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_admin_edits_created_at", "admin_edits", [sa.text("created_at DESC")], schema=SCHEMA
    )

    op.execute(f"DELETE FROM {SCHEMA}.settings WHERE key = 'claude_concurrency'")


def downgrade() -> None:
    op.drop_index("ix_admin_edits_created_at", table_name="admin_edits", schema=SCHEMA)
    op.drop_table("admin_edits", schema=SCHEMA)
    op.drop_constraint(op.f("fk_runs_started_by_users"), "runs", schema=SCHEMA, type_="foreignkey")
    op.drop_column("runs", "started_by", schema=SCHEMA)
    op.drop_index("ix_searches_user_id_created_at", table_name="searches", schema=SCHEMA)
    op.drop_constraint(
        op.f("fk_searches_user_id_users"), "searches", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("searches", "user_id", schema=SCHEMA)
