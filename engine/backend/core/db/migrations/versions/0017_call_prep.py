"""PLAN-V15 T3-2: call prep races, and the tone presets.

- `companies.preps` gets a unique index: one prep "searching" for each call (a company and a
  person, or the company's switchboard). A second start for the same call gets the running one,
  so two clicks never pay twice.
- Before the index, every prep left "searching" for over 5 minutes is marked failed, and only the
  newest searching one for each call stays. Otherwise the index could fail on the live database.
  The table is locked against writes for those few statements, so a backend still running during
  the deploy can't add a second one in between.
- `companies.script_prefs`: each person's tone preset (`mine`), and the team's default (`team`,
  one row, with no user). With sign-in off nobody is signed in, so "no user" counts as one person,
  as for the style notes.

Revision ID: 0017_call_prep
Revises: 0015_script_notes (PLAN-V15 M1 changes this to 0016_sync_cancel)
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_call_prep"
down_revision: str | Sequence[str] | None = "0015_script_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"
NO_USER = "'00000000-0000-0000-0000-000000000000'::uuid"
STUCK = "This prep stopped when the server restarted. Press Research again."


def upgrade() -> None:
    op.execute(f"LOCK TABLE {COMPANIES}.preps IN SHARE ROW EXCLUSIVE MODE")
    op.execute(
        sa.text(
            f"""
            UPDATE {COMPANIES}.preps
            SET status = 'failed', error = :stuck, finished_at = now()
            WHERE status = 'searching'
              AND (
                created_at < now() - interval '5 minutes'
                OR id NOT IN (
                  SELECT DISTINCT ON (company_key, coalesce(contact_id, '')) id
                  FROM {COMPANIES}.preps
                  WHERE status = 'searching'
                  ORDER BY company_key, coalesce(contact_id, ''), created_at DESC, id DESC
                )
              )
            """
        ).bindparams(stuck=STUCK)
    )
    op.create_index(
        "ux_preps_searching",
        "preps",
        ["company_key", sa.text("coalesce(contact_id, '')")],
        unique=True,
        schema=COMPANIES,
        postgresql_where=sa.text("status = 'searching'"),
    )
    op.create_table(
        "script_prefs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("tone", sa.String(16), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("scope IN ('mine', 'team')", name=op.f("ck_script_prefs_scope")),
        sa.CheckConstraint(
            "tone IN ('friendly', 'direct', 'consultative', 'formal')",
            name=op.f("ck_script_prefs_tone"),
        ),
        sa.CheckConstraint(
            "scope = 'mine' OR user_id IS NULL", name=op.f("ck_script_prefs_team_has_no_user")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{CORE}.users.id"],
            name=op.f("fk_script_prefs_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_script_prefs")),
        schema=COMPANIES,
    )
    op.create_index(
        "ux_script_prefs_who",
        "script_prefs",
        ["scope", sa.text(f"coalesce(user_id, {NO_USER})")],
        unique=True,
        schema=COMPANIES,
    )


def downgrade() -> None:
    op.drop_index("ux_script_prefs_who", table_name="script_prefs", schema=COMPANIES)
    op.drop_table("script_prefs", schema=COMPANIES)
    op.drop_index("ux_preps_searching", table_name="preps", schema=COMPANIES)
