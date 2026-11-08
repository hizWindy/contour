"""PLAN-V9: rivals, reject reasons, each person's projects, and the four city schedules.

- `lead_finder.rivals` (B5): competitors of a good lead in a booming industry, to research in a
  later run.
- `lead_finder.leads.reject_note` and a fixed list for `reject_reason` (D1). A reason saved before
  this was free text: it moves to the note, and the reason becomes `other`.
- `core.users.apps` (E1): the projects a person may use, like {lead_finder}. An Admin may use them
  all. Accounts made before this get an empty list, which changes nothing for an Admin. The
  sign-in log gains `account_changed`, for an Admin changing a person on the People tab.
- The schedule `lead_finder.discovery` (C4): it becomes four, one for each city, made by the
  backend at its next start. The old one is removed only if it is off and has never run; one that
  someone switched on, or that has run, stays as it is.

Revision ID: 0013_plan_v9
Revises: 0012_run_schedule
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_plan_v9"
down_revision: str | Sequence[str] | None = "0012_run_schedule"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LF = "lead_finder"
CORE = "core"
REASONS = (
    "too_small",
    "wrong_industry",
    "already_talking",
    "bad_timing",
    "not_a_real_sign",
    "other",
)
REASON_LIST = ", ".join(f"'{reason}'" for reason in REASONS)
AUDIT_BEFORE = (
    "sign_in",
    "sign_in_failed",
    "account_locked",
    "sign_out",
    "sign_out_everywhere",
    "password_changed",
    "account_created",
)
AUDIT_AFTER = (*AUDIT_BEFORE, "account_changed")


def _events(values: tuple[str, ...]) -> str:
    return f"event IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    op.create_table(
        "rivals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lead_id", sa.Uuid(), nullable=False),
        sa.Column("lead_company", sa.String(300), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("company_key", sa.String(300), nullable=False),
        sa.Column("website", sa.String(255), nullable=True),
        sa.Column("city", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("why", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), server_default="pending", nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("found_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'used', 'skipped')", name=op.f("ck_rivals_status")
        ),
        sa.ForeignKeyConstraint(
            ["lead_id"],
            [f"{LF}.leads.id"],
            name=op.f("fk_rivals_lead_id_leads"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            [f"{CORE}.runs.id"],
            name=op.f("fk_rivals_run_id_runs"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rivals")),
        schema=LF,
    )
    op.create_index(
        "uq_rivals_lead_id_company_key",
        "rivals",
        ["lead_id", "company_key"],
        unique=True,
        schema=LF,
    )
    op.create_index(
        "ix_rivals_pending",
        "rivals",
        ["city", "found_at"],
        schema=LF,
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.add_column("leads", sa.Column("reject_note", sa.Text(), nullable=True), schema=LF)
    op.execute(
        f"UPDATE {LF}.leads SET reject_note = reject_reason, reject_reason = 'other' "
        f"WHERE reject_reason IS NOT NULL AND reject_reason NOT IN ({REASON_LIST})"
    )
    op.create_check_constraint(
        op.f("ck_leads_reject_reason"),
        "leads",
        f"reject_reason IS NULL OR reject_reason IN ({REASON_LIST})",
        schema=LF,
    )

    op.add_column(
        "users",
        sa.Column(
            "apps",
            postgresql.ARRAY(sa.String(64)),
            server_default=sa.text("'{}'::varchar[]"),
            nullable=False,
        ),
        schema=CORE,
    )

    op.drop_constraint(op.f("ck_audit_log_event"), "audit_log", type_="check", schema=CORE)
    op.create_check_constraint(
        op.f("ck_audit_log_event"), "audit_log", _events(AUDIT_AFTER), schema=CORE
    )

    op.execute(
        f"DELETE FROM {CORE}.schedules WHERE job = 'lead_finder.discovery' "
        "AND enabled = false AND last_run_at IS NULL"
    )


def downgrade() -> None:
    # The four city schedules stay: a backend on the older code ignores them, and remakes its one.
    op.execute(f"DELETE FROM {CORE}.audit_log WHERE event = 'account_changed'")
    op.drop_constraint(op.f("ck_audit_log_event"), "audit_log", type_="check", schema=CORE)
    op.create_check_constraint(
        op.f("ck_audit_log_event"), "audit_log", _events(AUDIT_BEFORE), schema=CORE
    )
    op.drop_column("users", "apps", schema=CORE)
    op.drop_constraint(op.f("ck_leads_reject_reason"), "leads", type_="check", schema=LF)
    op.execute(
        f"UPDATE {LF}.leads SET reject_reason = coalesce(reject_note, reject_reason) "
        "WHERE reject_reason IS NOT NULL"
    )
    op.drop_column("leads", "reject_note", schema=LF)
    op.drop_index("ix_rivals_pending", table_name="rivals", schema=LF)
    op.drop_index("uq_rivals_lead_id_company_key", table_name="rivals", schema=LF)
    op.drop_table("rivals", schema=LF)
