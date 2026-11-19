"""PLAN-V23 T1-2: the names the team taught the mic, and the "No HubSpot user" mark.

- `companies.learned_names`: words the speech service heard, like "North Wind", and the company
  a rep picked for them, like Northwind, kept for the whole team (choice 3). `heard_key` is the
  words in lower case with their spaces tidied: one pair for each words and company. Who taught
  it is a link to the account that goes empty when the account is deleted.
- `core.users.no_hubspot_user`: the mark for an account with no HubSpot login (decision 4),
  false for everyone. Part 3 (T3-1) reads it with the HubSpot link as linked, none or not set.

The table is new and empty, and the column has a fixed default, so Postgres adds it without
rewriting the users table. Nothing that exists changes.

Revision ID: 0026_v23_names_and_hubspot_user
Revises: 0025_v19_roles_access
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_v23_names_and_hubspot_user"
down_revision: str | Sequence[str] | None = "0025_v19_roles_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CORE = "core"
COMPANIES = "companies"
TABLE = "learned_names"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("heard", sa.String(80), nullable=False),
        sa.Column("heard_key", sa.String(80), nullable=False),
        sa.Column("company_key", sa.String(64), nullable=False),
        sa.Column("company_name", sa.String(300), nullable=False),
        sa.Column("made_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("btrim(heard) <> ''", name=op.f("ck_learned_names_heard")),
        sa.CheckConstraint(
            "heard_key = lower(heard_key) AND btrim(heard_key) <> ''",
            name=op.f("ck_learned_names_heard_key"),
        ),
        sa.ForeignKeyConstraint(
            ["made_by"],
            [f"{CORE}.users.id"],
            name=op.f("fk_learned_names_made_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_learned_names")),
        schema=COMPANIES,
    )
    op.create_index(
        "ux_learned_names_heard_company",
        TABLE,
        ["heard_key", "company_key"],
        unique=True,
        schema=COMPANIES,
    )
    op.create_index(
        "ix_learned_names_created_at",
        TABLE,
        [sa.literal_column("created_at DESC")],
        schema=COMPANIES,
    )
    op.add_column(
        "users",
        sa.Column("no_hubspot_user", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=CORE,
    )


def downgrade() -> None:
    op.drop_column("users", "no_hubspot_user", schema=CORE)
    op.drop_index("ix_learned_names_created_at", table_name=TABLE, schema=COMPANIES)
    op.drop_index("ux_learned_names_heard_company", table_name=TABLE, schema=COMPANIES)
    op.drop_table(TABLE, schema=COMPANIES)
