"""PLAN-V24 T3-1: a call is saved before its company is found.

- `companies.call_notes.company_key` and `company_name` may be empty: only while the call needs
  its company.
- `company_heard` keeps the company's name as heard or typed, like "North Wind" (1 to 120
  characters).
- The status list gains `needs_company`: such a call is never sorted or sent until the rep picks
  its company.
- `ck_call_notes_company`: a call has its company, or it needs one and has the name as heard.
  Never neither.

Rows that exist keep their values: each has its company, so it meets the new rule. The columns
only stop being required, and the new one starts empty, so Postgres rewrites nothing. The old code
still runs with it (it always saves a company).

Going down is refused while any call still needs a company (TBC): the old table has nowhere to
keep it. Pick a company for each in Call logs, or remove it, first.

Revision ID: 0027_v24_call_needs_company
Revises: 0026_v23_names_and_hubspot_user
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_v24_call_needs_company"
down_revision: str | Sequence[str] | None = "0026_v23_names_and_hubspot_user"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "companies"
TABLE = "call_notes"
OLD_STATUSES = ("sorting", "to_confirm", "sending", "logged", "partial", "failed", "uncertain")
NEW_STATUSES = ("needs_company", *OLD_STATUSES)
HEARD_CHARS = 120
COMPANY_RULE = (
    "(status = 'needs_company' AND company_key IS NULL AND company_name IS NULL "
    "AND company_heard IS NOT NULL) OR (status <> 'needs_company' AND company_key IS NOT NULL "
    "AND company_name IS NOT NULL)"
)


def _in_list(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _status_rule(values: Sequence[str]) -> None:
    op.drop_constraint(op.f("ck_call_notes_status"), TABLE, type_="check", schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_call_notes_status"), TABLE, _in_list("status", values), schema=SCHEMA
    )


def upgrade() -> None:
    op.alter_column(TABLE, "company_key", existing_type=sa.String(64), nullable=True, schema=SCHEMA)
    op.alter_column(
        TABLE, "company_name", existing_type=sa.String(300), nullable=True, schema=SCHEMA
    )
    op.add_column(
        TABLE, sa.Column("company_heard", sa.String(HEARD_CHARS), nullable=True), schema=SCHEMA
    )
    _status_rule(NEW_STATUSES)
    op.create_check_constraint(op.f("ck_call_notes_company"), TABLE, COMPANY_RULE, schema=SCHEMA)


def downgrade() -> None:
    waiting = (
        op.get_bind()
        .execute(
            sa.text(
                f"SELECT count(*) FROM {SCHEMA}.{TABLE} "
                "WHERE status = 'needs_company' OR company_key IS NULL OR company_name IS NULL"
            )
        )
        .scalar()
    )
    if waiting:
        raise RuntimeError(
            f"{waiting} call(s) still need a company, and the old table can't keep them. Pick a "
            "company for each in Call logs, or remove them, then go down again."
        )
    op.drop_constraint(op.f("ck_call_notes_company"), TABLE, type_="check", schema=SCHEMA)
    _status_rule(OLD_STATUSES)
    op.drop_column(TABLE, "company_heard", schema=SCHEMA)
    op.alter_column(
        TABLE, "company_name", existing_type=sa.String(300), nullable=False, schema=SCHEMA
    )
    op.alter_column(
        TABLE, "company_key", existing_type=sa.String(64), nullable=False, schema=SCHEMA
    )
