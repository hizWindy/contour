"""Lead columns the website filters and sorts by, and the link from a lead to its run.

The lead card JSON stays the full record. The new columns copy what the card says, so the
results page can filter, sort and group without opening every card. Old leads (written by
Phase 1) are filled in from their card JSON, in Python, inside this migration.

This file must not import app code. The cleaner, the city rule and the date reader below are
FROZEN copies of how Phase 1 behaved:
- clean_name: core/hubspot/matching.py
- city_of: apps/lead_finder/scoring.py, with the cities from rules/queries.yaml
- parse_date: apps/lead_finder/scoring.py
- normalize_domain: core/hubspot/importer.py
If one of those changes later, this migration keeps its old behaviour on purpose.

Revision ID: 0004_lead_columns
Revises: 0003_runs_settings
Create Date: 2026-10-26
"""

import re
from collections.abc import Sequence
from datetime import date
from typing import Any
from urllib.parse import urlsplit

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0004_lead_columns"
down_revision: str | Sequence[str] | None = "0003_runs_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "lead_finder"
BATCH_SIZE = 500
INT_MAX = 2**31 - 1

STATUSES = ("new", "watching", "rejected", "sent")
ORIGINS = ("typed", "web", "hubspot")


# --- Frozen copies of the Phase 1 behaviour --------------------------------------------------

LEGAL_WORDS = frozenset(
    {"pty", "ltd", "limited", "inc", "incorporated", "llc", "plc", "corp", "corporation"}
)

# From rules/queries.yaml `areas`: the city name, then its CBD and inner places, in that order.
CITY_PLACES: dict[str, list[str]] = {
    "Melbourne": [
        "Melbourne",
        "Melbourne CBD",
        "Docklands",
        "Southbank",
        "St Kilda Road",
        "Richmond",
        "Cremorne",
        "Collingwood",
        "South Melbourne",
    ],
    "Adelaide": [
        "Adelaide",
        "Adelaide CBD",
        "North Adelaide",
        "Kent Town",
        "Keswick",
        "Mile End",
    ],
    "Perth": [
        "Perth",
        "Perth CBD",
        "West Perth",
        "East Perth",
        "Subiaco",
        "Northbridge",
    ],
    "Sydney": [
        "Sydney",
        "Sydney CBD",
        "North Sydney",
        "Barangaroo",
        "Pyrmont",
        "Surry Hills",
    ],
}


def clean_name(name: str) -> str:
    """'ABC Logistics Pty. Ltd.' becomes 'abc logistics'."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("&", " and ")).split()
    return " ".join(word for word in words if word not in LEGAL_WORDS)


def city_of(place: str) -> str | None:
    """'Cremorne' or 'Melbourne VIC' becomes 'Melbourne'. None if it's not a known city."""
    text = place.lower()
    for city, names in CITY_PLACES.items():
        if any(re.search(rf"\b{re.escape(name.lower())}\b", text) for name in names):
            return city
    return None


def parse_date(text: str | None) -> date | None:
    """'2026-10-14', '2026-10' or '2026'. A year alone is read as 1 July."""
    if not text:
        return None
    match = re.match(r"^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?", text.strip())
    if not match:
        return None
    year, month, day = match.groups()
    try:
        if month is None:
            return date(int(year), 7, 1)
        return date(int(year), int(month), int(day or 1))
    except ValueError:
        return None


def normalize_domain(website: str | None) -> str | None:
    """'https://www.abc.com.au/about' becomes 'abc.com.au'."""
    if not website:
        return None
    value = website.strip().lower()
    if "://" not in value:
        value = "http://" + value
    try:
        host = urlsplit(value).hostname
    except ValueError:
        return None
    if not host:
        return None
    return host.removeprefix("www.")


# --- Reading an old lead card ----------------------------------------------------------------


def _dig(data: Any, *path: str) -> Any:
    """card["facts"]["city"]["value"], or None if any step is missing."""
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip()[:limit] or None


def _whole_number(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = round(value)
    return number if 0 <= number <= INT_MAX else None


def lead_values(company: str, old_city: str | None, card: Any) -> dict[str, Any]:
    """What the new columns hold for one old lead."""
    raw_place = _dig(card, "facts", "city", "value")
    place = raw_place.strip() if isinstance(raw_place, str) and raw_place.strip() else old_city
    place = place.strip() if place else None

    key = clean_name(company)[:300] or company.strip().lower()[:300]

    trigger_ids: list[str] = []
    trigger_date: date | None = None
    triggers = _dig(card, "triggers")
    for item in triggers if isinstance(triggers, list) else []:
        trigger_id = _text(_dig(item, "trigger", "id"), 64)
        if trigger_id is None:
            continue
        if not trigger_ids:  # the card lists the best trigger first
            raw_date = _dig(item, "trigger", "date")
            trigger_date = parse_date(raw_date if isinstance(raw_date, str) else None)
        if trigger_id not in trigger_ids:
            trigger_ids.append(trigger_id)

    return {
        "company_key": key,
        "domain": _text(normalize_domain(_text(_dig(card, "facts", "website", "value"), 300)), 255),
        "city": city_of(place) if place else None,
        "suburb": _text(place, 120),
        "industry": _text(_dig(card, "facts", "industry", "value"), 120),
        "industry_group": _text(_dig(card, "facts", "industry_group"), 120),
        "staff_in_city": _whole_number(_dig(card, "facts", "staff_in_city", "value")),
        "office_m2": _whole_number(_dig(card, "office_m2")),
        "office_m2_estimated": _dig(card, "office_m2_estimated") is True,
        "trigger_id": trigger_ids[0] if trigger_ids else None,
        "trigger_ids": trigger_ids,
        "trigger_date": trigger_date,
        "contact_role": _text(_dig(card, "contact_role"), 200),
    }


def backfill_leads(bind: sa.Connection) -> None:
    """Fills the new columns of every existing lead from its card."""
    leads = sa.table(
        "leads",
        sa.column("id", sa.Uuid()),
        sa.column("company", sa.String()),
        sa.column("city", sa.String()),
        sa.column("card", postgresql.JSONB()),
        sa.column("company_key", sa.String()),
        sa.column("domain", sa.String()),
        sa.column("suburb", sa.String()),
        sa.column("industry", sa.String()),
        sa.column("industry_group", sa.String()),
        sa.column("staff_in_city", sa.Integer()),
        sa.column("office_m2", sa.Integer()),
        sa.column("office_m2_estimated", sa.Boolean()),
        sa.column("trigger_id", sa.String()),
        sa.column("trigger_ids", postgresql.ARRAY(sa.Text())),
        sa.column("trigger_date", sa.Date()),
        sa.column("contact_role", sa.String()),
        schema=SCHEMA,
    )
    rows = bind.execute(sa.select(leads.c.id, leads.c.company, leads.c.city, leads.c.card)).all()
    changes = [{"b_id": row.id, **lead_values(row.company, row.city, row.card)} for row in rows]
    statement = (
        sa.update(leads)
        .where(leads.c.id == sa.bindparam("b_id"))
        .values(
            company_key=sa.bindparam("company_key"),
            domain=sa.bindparam("domain"),
            city=sa.bindparam("city"),
            suburb=sa.bindparam("suburb"),
            industry=sa.bindparam("industry"),
            industry_group=sa.bindparam("industry_group"),
            staff_in_city=sa.bindparam("staff_in_city"),
            office_m2=sa.bindparam("office_m2"),
            office_m2_estimated=sa.bindparam("office_m2_estimated"),
            trigger_id=sa.bindparam("trigger_id"),
            trigger_ids=sa.bindparam("trigger_ids"),
            trigger_date=sa.bindparam("trigger_date"),
            contact_role=sa.bindparam("contact_role"),
        )
    )
    for start in range(0, len(changes), BATCH_SIZE):
        bind.execute(statement, changes[start : start + BATCH_SIZE])


# --- The migration ---------------------------------------------------------------------------


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    add = op.add_column
    add("leads", sa.Column("run_id", sa.Uuid(), nullable=True), schema=SCHEMA)
    add(
        "leads",
        sa.Column("origin", sa.String(length=16), server_default="typed", nullable=False),
        schema=SCHEMA,
    )
    add(
        "leads",
        sa.Column("is_test", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=SCHEMA,
    )
    add("leads", sa.Column("company_key", sa.String(length=300), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("domain", sa.String(length=255), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("suburb", sa.String(length=120), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("industry", sa.String(length=120), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("industry_group", sa.String(length=120), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("staff_in_city", sa.Integer(), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("office_m2", sa.Integer(), nullable=True), schema=SCHEMA)
    add(
        "leads",
        sa.Column(
            "office_m2_estimated", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        schema=SCHEMA,
    )
    add("leads", sa.Column("trigger_id", sa.String(length=64), nullable=True), schema=SCHEMA)
    add(
        "leads",
        sa.Column(
            "trigger_ids",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        schema=SCHEMA,
    )
    add("leads", sa.Column("trigger_date", sa.Date(), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("contact_role", sa.String(length=200), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("reject_reason", sa.Text(), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("note", sa.Text(), nullable=True), schema=SCHEMA)
    add("leads", sa.Column("useful", sa.Boolean(), nullable=True), schema=SCHEMA)
    add(
        "leads",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema=SCHEMA,
    )

    # Old leads: read each card, fill the columns. A lead was last changed when it was made.
    # This needs a live database. A SQL-only run (`alembic upgrade --sql`) can't do it.
    if not context.is_offline_mode():
        backfill_leads(op.get_bind())
    op.execute(f"UPDATE {SCHEMA}.leads SET updated_at = created_at")
    op.alter_column(
        "leads", "company_key", existing_type=sa.String(300), nullable=False, schema=SCHEMA
    )

    op.create_foreign_key(
        op.f("fk_leads_run_id_runs"),
        "leads",
        "runs",
        ["run_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema="core",
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        op.f("ck_leads_status"), "leads", _in_list("status", STATUSES), schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_leads_origin"), "leads", _in_list("origin", ORIGINS), schema=SCHEMA
    )
    op.create_index("ix_leads_run_id", "leads", ["run_id"], schema=SCHEMA)
    op.create_index("ix_leads_company_key", "leads", ["company_key"], schema=SCHEMA)
    op.create_index("ix_leads_domain", "leads", ["domain"], schema=SCHEMA)
    op.create_index("ix_leads_city", "leads", ["city"], schema=SCHEMA)
    op.create_index("ix_leads_hubspot_status", "leads", ["hubspot_status"], schema=SCHEMA)
    op.create_index(
        "ix_leads_trigger_ids", "leads", ["trigger_ids"], schema=SCHEMA, postgresql_using="gin"
    )
    op.create_index("ix_leads_created_at", "leads", [sa.text("created_at DESC")], schema=SCHEMA)
    op.create_index(
        "uq_leads_run_id_company_key",
        "leads",
        ["run_id", "company_key"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )


def downgrade() -> None:
    # `city` goes back to the place text as found, which is what Phase 1 kept in it.
    op.execute(f"UPDATE {SCHEMA}.leads SET city = COALESCE(suburb, city)")

    op.drop_index("uq_leads_run_id_company_key", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_created_at", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_trigger_ids", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_hubspot_status", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_city", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_domain", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_company_key", table_name="leads", schema=SCHEMA)
    op.drop_index("ix_leads_run_id", table_name="leads", schema=SCHEMA)
    op.drop_constraint(op.f("ck_leads_origin"), "leads", type_="check", schema=SCHEMA)
    op.drop_constraint(op.f("ck_leads_status"), "leads", type_="check", schema=SCHEMA)
    op.drop_constraint(op.f("fk_leads_run_id_runs"), "leads", type_="foreignkey", schema=SCHEMA)

    for column in (
        "updated_at",
        "useful",
        "note",
        "reject_reason",
        "contact_role",
        "trigger_date",
        "trigger_ids",
        "trigger_id",
        "office_m2_estimated",
        "office_m2",
        "staff_in_city",
        "industry_group",
        "industry",
        "suburb",
        "domain",
        "company_key",
        "is_test",
        "origin",
        "run_id",
    ):
        op.drop_column("leads", column, schema=SCHEMA)
