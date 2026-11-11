"""PLAN-V14 T1-3: script edits and style notes.

- `companies.script_edits`: one person's own wording for one line of one call. Private.
- `companies.script_styles`: style notes, each person's own (`mine`) and the team's (`team`, which
  an Admin approves). They go to Claude as style, never as facts.

With sign-in off nobody is signed in, so the unique indexes count "no user" as one person.
Nothing that exists changes.

Revision ID: 0015_script_notes
Revises: 0014_companies
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_script_notes"
down_revision: str | Sequence[str] | None = "0014_companies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"
NO_USER = "'00000000-0000-0000-0000-000000000000'::uuid"


def _now(name: str) -> sa.Column[object]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "script_edits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("company_key", sa.String(64), nullable=False),
        sa.Column("contact_id", sa.String(32), server_default="", nullable=False),
        sa.Column("slot", sa.String(32), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        _now("created_at"),
        _now("updated_at"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{CORE}.users.id"],
            name=op.f("fk_script_edits_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_script_edits")),
        schema=COMPANIES,
    )
    op.create_index(
        "ux_script_edits_slot",
        "script_edits",
        [sa.text(f"coalesce(user_id, {NO_USER})"), "company_key", "contact_id", "slot"],
        unique=True,
        schema=COMPANIES,
    )
    op.create_table(
        "script_styles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), server_default="active", nullable=False),
        sa.Column("decided_by", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint("scope IN ('mine', 'team')", name=op.f("ck_script_styles_scope")),
        sa.CheckConstraint(
            "status IN ('active', 'suggested', 'rejected', 'retired')",
            name=op.f("ck_script_styles_status"),
        ),
        sa.CheckConstraint(
            "scope = 'team' OR status = 'active'", name=op.f("ck_script_styles_mine_is_active")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{CORE}.users.id"],
            name=op.f("fk_script_styles_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by"],
            [f"{CORE}.users.id"],
            name=op.f("fk_script_styles_decided_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_script_styles")),
        schema=COMPANIES,
    )
    op.create_index(
        "ux_script_styles_mine",
        "script_styles",
        [sa.text(f"coalesce(user_id, {NO_USER})")],
        unique=True,
        schema=COMPANIES,
        postgresql_where=sa.text("scope = 'mine'"),
    )
    op.create_index("ix_script_styles_team", "script_styles", ["scope", "status"], schema=COMPANIES)


def downgrade() -> None:
    op.drop_index("ix_script_styles_team", table_name="script_styles", schema=COMPANIES)
    op.drop_index("ux_script_styles_mine", table_name="script_styles", schema=COMPANIES)
    op.drop_table("script_styles", schema=COMPANIES)
    op.drop_index("ux_script_edits_slot", table_name="script_edits", schema=COMPANIES)
    op.drop_table("script_edits", schema=COMPANIES)
