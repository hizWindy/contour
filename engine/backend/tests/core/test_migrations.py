"""Every table change has a migration, and each migration works both ways.

Most tests here need the database (`integration`). The ones that move data between versions
build their own scratch database, so the shared test database is never rolled back.

The chain: 0001 core tables, 0002 searches and leads, 0003 runs and settings, 0004 lead
columns (with a backfill from the cards), 0005 an index on the search log's time.
"""

import importlib
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import psycopg
import pytest
from alembic import command
from alembic.script import ScriptDirectory
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.tables import Lead
from core.config import get_settings
from core.prefs.models import Setting
from core.runs.models import Run, RunEvent
from core.searches.models import SearchLog
from tests.conftest import alembic_config, server_conninfo

frozen = importlib.import_module("core.db.migrations.versions.0004_lead_columns")

# --- The frozen copies inside migration 0004 (fast: no database) -----------------------------


@pytest.mark.parametrize(
    ("name", "cleaned"),
    [
        ("ABC Logistics Pty. Ltd.", "abc logistics"),
        ("Acme Software Pty Ltd", "acme software"),
        ("Johnson & Johnson Inc", "johnson and johnson"),
        ("Harbour Partners Limited", "harbour partners"),
        ("Pty Ltd", ""),
    ],
)
def test_the_frozen_cleaner_drops_legal_words(name: str, cleaned: str) -> None:
    assert frozen.clean_name(name) == cleaned


@pytest.mark.parametrize(
    ("place", "city"),
    [
        ("Docklands", "Melbourne"),
        ("Melbourne VIC", "Melbourne"),
        ("Cremorne", "Melbourne"),
        ("St Kilda Road, Melbourne", "Melbourne"),
        ("North Adelaide", "Adelaide"),
        ("West Perth WA", "Perth"),
        ("North Sydney NSW", "Sydney"),
        ("Surry Hills", "Sydney"),
        ("Brisbane QLD", None),
        ("Dockland", None),  # whole words only
        ("", None),
    ],
)
def test_the_frozen_city_rule_maps_places_to_the_metro_city(place: str, city: str | None) -> None:
    assert frozen.city_of(place) == city


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-10-14", date(2026, 10, 14)),
        ("2028-03", date(2028, 3, 1)),
        ("2027", date(2027, 7, 1)),  # a year alone is 1 July
        ("2026-13", None),
        ("soon", None),
        (None, None),
    ],
)
def test_the_frozen_date_reader(text: str | None, expected: date | None) -> None:
    assert frozen.parse_date(text) == expected


@pytest.mark.parametrize(
    ("website", "domain"),
    [
        ("https://www.Acme.com.au/about", "acme.com.au"),
        ("acme.com.au", "acme.com.au"),
        ("www.acme.com.au:8080/x", "acme.com.au"),
        ("http://[broken", None),
        ("", None),
        (None, None),
    ],
)
def test_the_frozen_domain_reader(website: str | None, domain: str | None) -> None:
    assert frozen.normalize_domain(website) == domain


def test_an_odd_card_never_stops_the_backfill() -> None:
    odd_card: Any = {
        "office_m2": 1e12,  # too big for the column
        "office_m2_estimated": "yes",
        "contact_role": 7,
        "facts": {"staff_in_city": {"value": True}, "city": "Melbourne", "industry": None},
        "triggers": [{"trigger": {"id": None}}, "nonsense", {"trigger": {"id": "new_ceo"}}],
    }
    values = frozen.lead_values("Odd Co", None, odd_card)
    assert values["company_key"] == "odd co"
    assert values["city"] is None
    assert values["office_m2"] is None
    assert values["office_m2_estimated"] is False
    assert values["staff_in_city"] is None
    assert values["contact_role"] is None
    assert values["trigger_ids"] == ["new_ceo"]
    assert values["trigger_date"] is None
    assert frozen.lead_values("Odd Co", "Cremorne", "not a card")["city"] == "Melbourne"
    assert frozen.lead_values("Pty Ltd", None, {})["company_key"] == "pty ltd"


# --- The shared test database -----------------------------------------------------------------


@pytest.mark.integration
def test_models_match_the_migrations(database_url: str) -> None:
    command.check(alembic_config(database_url))  # fails if a model change has no migration


@pytest.mark.integration
def test_upgrade_to_head_is_safe_to_repeat(database_url: str) -> None:
    config = alembic_config(database_url)
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    head = ScriptDirectory.from_config(config).get_current_head()
    with psycopg.connect(server_conninfo(get_settings(), get_settings().postgres_db)) as connection:
        row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
    assert row is not None
    assert row[0] == head


def test_the_migrations_form_one_line_up_to_0005() -> None:
    """No branches, and each step follows the one before. Later migrations may follow 0005."""
    script = ScriptDirectory.from_config(alembic_config("postgresql+psycopg://x@127.0.0.1/x"))
    assert len(script.get_heads()) == 1
    oldest_first = [revision.revision for revision in reversed(list(script.walk_revisions()))]
    assert oldest_first[:5] == [
        "0001_core_tables",
        "0002_searches_leads",
        "0003_runs_settings",
        "0004_lead_columns",
        "0005_searches_created_at",
    ]


@pytest.mark.integration
def test_the_langgraph_schema_is_not_drift(database_url: str) -> None:
    """LangGraph keeps its own tables in the `langgraph` schema. alembic check must ignore them."""
    settings = get_settings()
    with psycopg.connect(server_conninfo(settings, settings.postgres_db), autocommit=True) as c:
        c.execute("CREATE SCHEMA IF NOT EXISTS langgraph")
        c.execute("CREATE TABLE IF NOT EXISTS langgraph.drift_probe (id int)")
        try:
            command.check(alembic_config(database_url))
        finally:
            c.execute("DROP TABLE IF EXISTS langgraph.drift_probe")


# --- Rules the new tables and columns enforce -------------------------------------------------


def make_lead(**changes: Any) -> Lead:
    values: dict[str, Any] = {
        "company": "Acme Software",
        "company_key": "acme software",
        "result": "pass",
        "score": 80,
        "hubspot_status": "new",
        "card": {},
        "cost_usd": Decimal("0.5"),
        "web_searches": 3,
        "rules_version": "v1",
        "prompt_version": "research:abc",
    }
    return Lead(**{**values, **changes})


async def save(factory: async_sessionmaker[AsyncSession], *rows: Any) -> None:
    async with factory() as db_session:
        db_session.add_all(rows)
        await db_session.commit()


@pytest.mark.integration
async def test_a_new_run_gets_sensible_defaults(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    run = Run(app="lead_finder", mode="discovery")
    await save(session_factory, run)
    async with session_factory() as db_session:
        saved = await db_session.get(Run, run.id)
    assert saved is not None
    assert saved.status == "queued"
    assert saved.cost_usd == Decimal(0)
    assert (saved.web_searches, saved.claude_requests) == (0, 0)
    assert (saved.params, saved.caps, saved.counts) == ({}, {}, {})
    assert saved.stop_reason is None
    assert saved.idempotency_key is None
    assert saved.created_at is not None
    assert saved.started_at is None


@pytest.mark.integration
async def test_run_rules(session_factory: async_sessionmaker[AsyncSession]) -> None:
    with pytest.raises(IntegrityError, match="ck_runs_status"):
        await save(session_factory, Run(app="a", mode="m", status="paused"))

    await save(session_factory, Run(app="a", mode="m", idempotency_key="key-1"))
    with pytest.raises(IntegrityError, match="uq_runs_idempotency_key"):
        await save(session_factory, Run(app="a", mode="m", idempotency_key="key-1"))
    # Runs without a key never compete with each other.
    await save(session_factory, Run(app="a", mode="m"), Run(app="a", mode="m"))


@pytest.mark.integration
async def test_run_events_are_ordered_unique_and_go_with_their_run(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    run = Run(app="a", mode="m")
    await save(session_factory, run)
    await save(
        session_factory,
        RunEvent(run_id=run.id, seq=1, type="run_started", data={"mode": "m"}),
        RunEvent(run_id=run.id, seq=2, type="progress", data={}),
    )
    with pytest.raises(IntegrityError, match="pk_run_events"):
        await save(session_factory, RunEvent(run_id=run.id, seq=2, type="progress", data={}))
    with pytest.raises(IntegrityError, match="fk_run_events_run_id_runs"):
        await save(session_factory, RunEvent(run_id=uuid.uuid4(), seq=1, type="x", data={}))

    async with session_factory() as db_session:
        await db_session.execute(delete(Run).where(Run.id == run.id))
        await db_session.commit()
        left = await db_session.scalars(select(RunEvent).where(RunEvent.run_id == run.id))
        assert list(left) == []


@pytest.mark.integration
async def test_settings_keep_numbers_text_and_nulls(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await save(
        session_factory,
        Setting(key="company_max_searches", value=8),
        Setting(key="run_cap_usd", value="20.00"),  # money is stored as text
        Setting(key="model_discover", value=None),  # null means "use the main model"
    )
    async with session_factory() as db_session:
        rows = {s.key: s for s in await db_session.scalars(select(Setting))}
    assert rows["company_max_searches"].value == 8
    assert rows["run_cap_usd"].value == "20.00"
    assert rows["model_discover"].value is None
    assert rows["run_cap_usd"].updated_at is not None


@pytest.mark.integration
async def test_updated_at_can_be_read_right_after_an_orm_update(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The PATCH routes return the changed row. Its `updated_at` must be there to read,
    without a new query (a lazy load fails in async code)."""
    lead = make_lead()
    await save(session_factory, lead, Setting(key="run_cap_usd", value="20.00"))
    async with session_factory() as db_session:
        saved_lead = await db_session.get(Lead, lead.id)
        saved_setting = await db_session.get(Setting, "run_cap_usd")
        assert saved_lead is not None
        assert saved_setting is not None
        lead_before, setting_before = saved_lead.updated_at, saved_setting.updated_at

        saved_lead.status = "watching"
        saved_setting.value = "15.00"
        await db_session.commit()  # the session keeps its objects after a commit

        assert saved_lead.updated_at > lead_before
        assert saved_setting.updated_at > setting_before


@pytest.mark.integration
async def test_the_search_log_records_the_run_and_long_prompt_versions(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    run_id = uuid.uuid4()
    version = "research:" + "a" * 55  # 64 characters
    await save(
        session_factory,
        SearchLog(
            app="lead_finder",
            run_id=run_id,
            step="discover",
            model="m",
            prompt_version=version,
            cost_usd=Decimal("0.1"),
            answer_ok=True,
        ),
    )
    async with session_factory() as db_session:
        row = await db_session.scalar(select(SearchLog).where(SearchLog.run_id == run_id))
    assert row is not None
    assert row.prompt_version == version


@pytest.mark.integration
async def test_lead_defaults(session_factory: async_sessionmaker[AsyncSession]) -> None:
    lead = make_lead()
    await save(session_factory, lead)
    async with session_factory() as db_session:
        saved = await db_session.get(Lead, lead.id)
    assert saved is not None
    assert (saved.origin, saved.is_test, saved.status) == ("typed", False, "new")
    assert saved.run_id is None
    assert saved.trigger_ids == []
    assert saved.office_m2_estimated is False
    assert saved.useful is None
    assert saved.updated_at is not None


@pytest.mark.integration
async def test_company_key_falls_back_to_the_cleaned_company_name(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Code that sets no company_key still saves a lead. Research should set it itself."""
    values: dict[str, Any] = {
        "result": "pass",
        "score": 1,
        "hubspot_status": "new",
        "card": {},
        "cost_usd": Decimal("0.1"),
        "web_searches": 0,
        "rules_version": "v1",
        "prompt_version": "p",
    }
    leads = [
        Lead(company="ABC Logistics Pty. Ltd.", **values),
        Lead(company="Pty Ltd", **values),
        Lead(company="Explicit Co", company_key="asked for this", **values),
    ]
    await save(session_factory, *leads)
    assert [lead.company_key for lead in leads] == ["abc logistics", "pty ltd", "asked for this"]


@pytest.mark.integration
async def test_lead_value_rules(session_factory: async_sessionmaker[AsyncSession]) -> None:
    for status in ("new", "watching", "rejected", "sent"):
        await save(session_factory, make_lead(status=status))
    for origin in ("typed", "web", "hubspot"):
        await save(session_factory, make_lead(origin=origin))
    with pytest.raises(IntegrityError, match="ck_leads_status"):
        await save(session_factory, make_lead(status="archived"))
    with pytest.raises(IntegrityError, match="ck_leads_origin"):
        await save(session_factory, make_lead(origin="email"))


@pytest.mark.integration
async def test_one_lead_for_each_company_in_a_run(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    first, second = Run(app="a", mode="m"), Run(app="a", mode="m")
    await save(session_factory, first, second)
    await save(session_factory, make_lead(run_id=first.id))
    with pytest.raises(IntegrityError, match="uq_leads_run_id_company_key"):
        await save(session_factory, make_lead(run_id=first.id, company="Acme Software Pty Ltd"))
    # The same company in another run, or outside any run, is fine.
    await save(session_factory, make_lead(run_id=second.id))
    await save(session_factory, make_lead(), make_lead())
    await save(session_factory, make_lead(run_id=first.id, company_key="other co"))


@pytest.mark.integration
async def test_deleting_a_run_keeps_its_leads(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    run = Run(app="a", mode="m")
    await save(session_factory, run)
    lead = make_lead(run_id=run.id, trigger_ids=["lease_ending", "new_ceo"])
    await save(session_factory, lead)
    async with session_factory() as db_session:
        await db_session.execute(delete(Run).where(Run.id == run.id))
        await db_session.commit()
        kept = await db_session.get(Lead, lead.id)
    assert kept is not None
    assert kept.run_id is None
    assert kept.trigger_ids == ["lease_ending", "new_ceo"]
    async with session_factory() as db_session:
        found = await db_session.scalars(
            select(Lead.id).where(Lead.trigger_ids.contains(["new_ceo"]))
        )
        assert list(found) == [lead.id]


# --- Moving old data through migration 0004 ---------------------------------------------------


@dataclass(frozen=True)
class Scratch:
    url: str  # for Alembic
    conninfo: str  # for psycopg

    def connect(self) -> psycopg.Connection[dict[str, Any]]:
        return psycopg.connect(self.conninfo, autocommit=True, row_factory=dict_row)


@pytest.fixture
def scratch(database_url: str) -> Iterator[Scratch]:
    """A throwaway database that these tests migrate up and down. Dropped afterwards."""
    settings = get_settings()
    name = f"{settings.postgres_db}_mig"
    server = server_conninfo(settings)
    drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
    with psycopg.connect(server, autocommit=True) as connection:
        connection.execute(drop)
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield Scratch(settings.database_url(name), server_conninfo(settings, name))
    finally:
        with psycopg.connect(server, autocommit=True) as connection:
            connection.execute(drop)


def search_log_indexes(scratch: Scratch) -> dict[str, str]:
    """The indexes on core.searches, by name, with their definitions."""
    with scratch.connect() as connection:
        rows = connection.execute(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = 'core' AND tablename = 'searches'"
        ).fetchall()
    return {row["indexname"]: row["indexdef"] for row in rows}


@pytest.mark.integration
def test_0005_adds_and_removes_the_index_on_the_search_log_time(scratch: Scratch) -> None:
    config = alembic_config(scratch.url)
    command.upgrade(config, "0004_lead_columns")
    assert "ix_searches_created_at" not in search_log_indexes(scratch)

    command.upgrade(config, "0005_searches_created_at")
    assert search_log_indexes(scratch)["ix_searches_created_at"].endswith("(created_at)")

    command.downgrade(config, "0004_lead_columns")
    assert "ix_searches_created_at" not in search_log_indexes(scratch)
    command.upgrade(config, "head")
    assert "ix_searches_created_at" in search_log_indexes(scratch)
    command.check(config)  # the models declare the same index, so nothing is missing or extra


def lead_columns(scratch: Scratch) -> dict[str, str]:
    """The columns of lead_finder.leads, by name, with their types."""
    with scratch.connect() as connection:
        rows = connection.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'lead_finder' AND table_name = 'leads'"
        ).fetchall()
    return {row["column_name"]: row["data_type"] for row in rows}


@pytest.mark.integration
def test_0006_adds_and_removes_the_checked_points_of_the_score(scratch: Scratch) -> None:
    config = alembic_config(scratch.url)
    command.upgrade(config, "0005_searches_created_at")
    assert "score_checked" not in lead_columns(scratch)

    command.upgrade(config, "0006_score_checked")
    assert lead_columns(scratch)["score_checked"] == "integer"
    # Alembic's check needs the newest revision. The models declare the same columns as the
    # migrations, so nothing is missing or extra.
    command.upgrade(config, "head")
    command.check(config)

    command.downgrade(config, "0005_searches_created_at")
    assert "score_checked" not in lead_columns(scratch)
    command.upgrade(config, "head")
    assert "score_checked" in lead_columns(scratch)


def auth_tables(scratch: Scratch) -> set[str]:
    """Which of the sign-in tables exist in the core schema."""
    with scratch.connect() as connection:
        rows = connection.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'core' "
            "AND tablename IN ('users', 'sessions', 'audit_log')"
        ).fetchall()
    return {row["tablename"] for row in rows}


@pytest.mark.integration
def test_0010_adds_and_removes_the_sign_in_tables(scratch: Scratch) -> None:
    config = alembic_config(scratch.url)
    command.upgrade(config, "0009_hubspot_sync")
    assert auth_tables(scratch) == set()

    command.upgrade(config, "0010_auth_tables")
    assert auth_tables(scratch) == {"users", "sessions", "audit_log"}
    command.upgrade(config, "head")
    command.check(config)  # the models declare the same tables, keys, checks and indexes

    # Going down removes all three, and a second way up brings them back empty.
    with scratch.connect() as connection:
        connection.execute(
            "INSERT INTO core.users (id, email, name, password_hash) "
            "VALUES (%s, 'al@example.test', 'Al', 'x')",
            (uuid.uuid4(),),
        )
    command.downgrade(config, "0009_hubspot_sync")
    assert auth_tables(scratch) == set()
    command.upgrade(config, "head")
    assert auth_tables(scratch) == {"users", "sessions", "audit_log"}
    with scratch.connect() as connection:
        assert connection.execute("SELECT count(*) AS n FROM core.users").fetchone() == {"n": 0}


def schedule_tables(scratch: Scratch) -> set[str]:
    with scratch.connect() as connection:
        rows = connection.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'core' AND tablename = 'schedules'"
        ).fetchall()
    return {row["tablename"] for row in rows}


def sync_trigger_rule(scratch: Scratch) -> str:
    with scratch.connect() as connection:
        row = connection.execute(
            "SELECT pg_get_constraintdef(oid) AS rule FROM pg_constraint "
            "WHERE conname = 'ck_hubspot_syncs_trigger'"
        ).fetchone()
    assert row is not None
    return str(row["rule"])


@pytest.mark.integration
def test_0011_adds_the_schedules_and_lets_a_schedule_start_a_sync(scratch: Scratch) -> None:
    config = alembic_config(scratch.url)
    command.upgrade(config, "0010_auth_tables")
    assert schedule_tables(scratch) == set()
    assert "schedule" not in sync_trigger_rule(scratch)

    command.upgrade(config, "0011_schedules")
    command.upgrade(config, "head")
    command.check(config)  # the model declares the same table, checks and index
    assert schedule_tables(scratch) == {"schedules"}
    assert "'schedule'" in sync_trigger_rule(scratch)

    # A sync that a schedule started is kept on the way down, as a command, so the old rule holds.
    with scratch.connect() as connection:
        connection.execute(
            "INSERT INTO core.hubspot_syncs (mode, trigger, status, finished_at) "
            "VALUES ('changes', 'schedule', 'done', now())"
        )
    command.downgrade(config, "0010_auth_tables")
    assert schedule_tables(scratch) == set()
    assert "schedule" not in sync_trigger_rule(scratch)
    with scratch.connect() as connection:
        row = connection.execute("SELECT trigger FROM core.hubspot_syncs").fetchone()
    assert row == {"trigger": "command"}

    command.upgrade(config, "head")
    assert schedule_tables(scratch) == {"schedules"}


def fact(value: Any) -> dict[str, Any]:
    found = value is not None
    return {
        "value": value,
        "source_url": "https://example.com/page" if found else None,
        "source_date": None,
        "label": "confirmed" if found else None,
    }


def counted(trigger_id: str, when: str | None) -> dict[str, Any]:
    return {
        "trigger": {
            "id": trigger_id,
            "what_happened": "Something happened.",
            "date": when,
            "source_url": "https://example.com/news",
            "label": "confirmed",
        },
        "group": "main",
        "source_kind": "other_news",
        "points": 60,
    }


def phase_1_card(
    company: str,
    *,
    place: str | None = None,
    website: str | None = None,
    industry: str | None = None,
    group: str | None = None,
    staff: int | None = None,
    m2: int | None = None,
    estimated: bool = False,
    role: str | None = None,
    triggers: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    """A card the way Phase 1 wrote it (a trimmed LeadCard, as JSON)."""
    return {
        "company": company,
        "result": "pass",
        "score": 70,
        "contact_role": role,
        "office_m2": m2,
        "office_m2_estimated": estimated,
        "triggers": list(triggers),
        "facts": {
            "name": company,
            "website": fact(website),
            "city": fact(place),
            "industry": fact(industry),
            "industry_group": group,
            "staff_in_city": fact(staff),
            "office_m2": fact(m2),
        },
    }


@dataclass(frozen=True)
class Legacy:
    """A lead as it sat in the table at migration 0003, and what 0004 must make of it."""

    company: str
    city: str | None  # the `city` column at 0003: the place text as found
    card: dict[str, Any]
    expect: dict[str, Any]
    created_at: datetime


NO_TRIGGER: dict[str, Any] = {
    "trigger_id": None,
    "trigger_ids": [],
    "trigger_date": None,
}
LEGACY = [
    Legacy(
        company="Acme Software Pty Ltd",
        city="Docklands",
        card=phase_1_card(
            "Acme Software Pty Ltd",
            place="Docklands",
            website="https://www.acme.com.au/about",
            industry="Software",
            group="Technology",
            staff=250,
            m2=2500,
            role="Head of Property",
            triggers=(
                counted("lease_ending", "2028-03"),
                counted("fast_growth", None),
                counted("lease_ending", "2027-01"),
            ),
        ),
        expect={
            "company_key": "acme software",
            "domain": "acme.com.au",
            "city": "Melbourne",
            "suburb": "Docklands",
            "industry": "Software",
            "industry_group": "Technology",
            "staff_in_city": 250,
            "office_m2": 2500,
            "office_m2_estimated": False,
            "trigger_id": "lease_ending",
            "trigger_ids": ["lease_ending", "fast_growth"],
            "trigger_date": date(2028, 3, 1),
            "contact_role": "Head of Property",
        },
        created_at=datetime(2026, 10, 20, 9, 30, tzinfo=UTC),
    ),
    Legacy(
        company="ABC Logistics Pty. Ltd.",
        city="Melbourne VIC",
        card=phase_1_card(
            "ABC Logistics Pty. Ltd.",
            place="Melbourne VIC",
            website="abc.com.au",
            industry="Logistics",
            m2=1800,
            estimated=True,
            triggers=(counted("merger_or_takeover", "2026-09-15"),),
        ),
        expect={
            "company_key": "abc logistics",
            "domain": "abc.com.au",
            "city": "Melbourne",
            "suburb": "Melbourne VIC",
            "industry": "Logistics",
            "industry_group": None,
            "staff_in_city": None,
            "office_m2": 1800,
            "office_m2_estimated": True,
            "trigger_id": "merger_or_takeover",
            "trigger_ids": ["merger_or_takeover"],
            "trigger_date": date(2026, 9, 15),
            "contact_role": None,
        },
        created_at=datetime(2026, 10, 21, 9, 30, tzinfo=UTC),
    ),
    Legacy(
        company="Mystery Co",
        city=None,
        card=phase_1_card("Mystery Co"),
        expect={
            "company_key": "mystery co",
            "domain": None,
            "city": None,
            "suburb": None,
            "industry": None,
            "industry_group": None,
            "staff_in_city": None,
            "office_m2": None,
            "office_m2_estimated": False,
            "contact_role": None,
            **NO_TRIGGER,
        },
        created_at=datetime(2026, 10, 22, 9, 30, tzinfo=UTC),
    ),
    Legacy(
        company="Harbour Partners Limited",
        city="North Sydney NSW",
        card=phase_1_card(
            "Harbour Partners Limited",
            place="North Sydney NSW",
            website="https://harbourpartners.com/",
            industry="Finance",
            staff=90,
            triggers=(counted("new_ceo", "2027"),),
        ),
        expect={
            "company_key": "harbour partners",
            "domain": "harbourpartners.com",
            "city": "Sydney",
            "suburb": "North Sydney NSW",
            "industry": "Finance",
            "industry_group": None,
            "staff_in_city": 90,
            "office_m2": None,
            "office_m2_estimated": False,
            "trigger_id": "new_ceo",
            "trigger_ids": ["new_ceo"],
            "trigger_date": date(2027, 7, 1),
            "contact_role": None,
        },
        created_at=datetime(2026, 10, 23, 9, 30, tzinfo=UTC),
    ),
    Legacy(
        company="Brisbane Builders",
        city="Brisbane QLD",
        card=phase_1_card("Brisbane Builders", place="Brisbane QLD", industry="Construction"),
        expect={
            "company_key": "brisbane builders",
            "domain": None,
            "city": None,  # not one of our four cities
            "suburb": "Brisbane QLD",
            "industry": "Construction",
            "industry_group": None,
            "staff_in_city": None,
            "office_m2": None,
            "office_m2_estimated": False,
            "contact_role": None,
            **NO_TRIGGER,
        },
        created_at=datetime(2026, 10, 24, 9, 30, tzinfo=UTC),
    ),
    Legacy(
        company="Gadget & Co",
        city="Cremorne",  # the card has no city, so the column is the only place text
        card=phase_1_card("Gadget & Co"),
        expect={
            "company_key": "gadget and co",
            "domain": None,
            "city": "Melbourne",
            "suburb": "Cremorne",
            "industry": None,
            "industry_group": None,
            "staff_in_city": None,
            "office_m2": None,
            "office_m2_estimated": False,
            "contact_role": None,
            **NO_TRIGGER,
        },
        created_at=datetime(2026, 10, 25, 9, 30, tzinfo=UTC),
    ),
]

NEW_COLUMNS = (
    "company_key",
    "domain",
    "city",
    "suburb",
    "industry",
    "industry_group",
    "staff_in_city",
    "office_m2",
    "office_m2_estimated",
    "trigger_id",
    "trigger_ids",
    "trigger_date",
    "contact_role",
)
PHASE_1_COLUMNS = {
    "id",
    "company",
    "city",
    "result",
    "score",
    "status",
    "hubspot_status",
    "hubspot_id",
    "card",
    "cost_usd",
    "web_searches",
    "rules_version",
    "prompt_version",
    "created_at",
}


@pytest.fixture
def legacy(scratch: Scratch) -> Scratch:
    """The scratch database at migration 0003, holding leads written the Phase 1 way."""
    command.upgrade(alembic_config(scratch.url), "0003_runs_settings")
    with scratch.connect() as connection:
        for item in LEGACY:
            connection.execute(
                "INSERT INTO lead_finder.leads (id, company, city, result, score, status, "
                "hubspot_status, hubspot_id, card, cost_usd, web_searches, rules_version, "
                "prompt_version, created_at) VALUES (%s, %s, %s, 'pass', 70, 'new', 'new', NULL, "
                "%s, 0.5, 3, 'v1', 'research:abc', %s)",
                (uuid.uuid4(), item.company, item.city, Jsonb(item.card), item.created_at),
            )
    return scratch


def leads_by_company(scratch: Scratch) -> dict[str, dict[str, Any]]:
    with scratch.connect() as connection:
        rows = connection.execute("SELECT * FROM lead_finder.leads").fetchall()
    return {row["company"]: row for row in rows}


@pytest.mark.integration
def test_old_leads_are_filled_in_from_their_cards(legacy: Scratch) -> None:
    command.upgrade(alembic_config(legacy.url), "0004_lead_columns")
    saved = leads_by_company(legacy)
    assert set(saved) == {item.company for item in LEGACY}
    for item in LEGACY:
        row = saved[item.company]
        assert {key: row[key] for key in NEW_COLUMNS} == item.expect, item.company
        # What the migration must not touch, and what it starts with.
        assert row["card"] == item.card
        assert row["updated_at"] == item.created_at == row["created_at"]
        assert (row["origin"], row["is_test"], row["run_id"]) == ("typed", False, None)
        assert (row["reject_reason"], row["note"], row["useful"]) == (None, None, None)
        assert row["status"] == "new"


@pytest.mark.integration
def test_downgrade_to_0002_restores_the_card_columns_and_the_way_back_fills_them_again(
    legacy: Scratch,
) -> None:
    """Going down to 0002 puts the Phase 1 leads table back, and going up fills it in again.

    What it loses on the way is on purpose, and this test checks it: downgrading 0004 drops
    run links, test flags and feedback (run_id, origin, is_test, reject_reason, note and
    useful), and downgrading 0003 drops the runs, their events and the settings. Coming back
    up gives those columns their defaults. Everything the cards can rebuild comes back as it
    was.
    """
    config = alembic_config(legacy.url)
    command.upgrade(config, "head")
    before = leads_by_company(legacy)
    long_version = "v" * 64
    run_id = uuid.uuid4()
    with legacy.connect() as connection:
        connection.execute(
            "INSERT INTO core.searches (id, app, run_id, step, model, prompt_version, queries, "
            "sources, web_searches, web_fetches, input_tokens, output_tokens, cache_read_tokens, "
            "cache_write_tokens, cost_usd, answer_ok) VALUES (%s, 'lead_finder', %s, 'discover', "
            "'m', %s, '[]', '[]', 0, 0, 0, 0, 0, 0, 0, true)",
            (uuid.uuid4(), uuid.uuid4(), long_version),
        )
        # One lead with everything the downgrade is going to drop.
        connection.execute(
            "INSERT INTO core.runs (id, app, mode) VALUES (%s, 'lead_finder', 'discovery')",
            (run_id,),
        )
        marked = connection.execute(
            "UPDATE lead_finder.leads SET run_id = %s, origin = 'web', is_test = true, "
            "useful = true, note = 'Called them', reject_reason = 'Too small' "
            "WHERE company = 'Mystery Co' "
            "RETURNING run_id, origin, is_test, useful, note, reject_reason",
            (run_id,),
        ).fetchone()
    assert marked == {
        "run_id": run_id,
        "origin": "web",
        "is_test": True,
        "useful": True,
        "note": "Called them",
        "reject_reason": "Too small",
    }
    assert "ix_searches_created_at" in search_log_indexes(legacy)

    command.downgrade(config, "0002_searches_leads")
    with legacy.connect() as connection:
        columns = connection.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'lead_finder' AND table_name = 'leads'"
        ).fetchall()
        gone = connection.execute(
            "SELECT to_regclass('core.runs') AS runs, to_regclass('core.run_events') AS events, "
            "to_regclass('core.settings') AS settings"
        ).fetchone()
        search_columns = {
            row["column_name"]: row["character_maximum_length"]
            for row in connection.execute(
                "SELECT column_name, character_maximum_length FROM information_schema.columns "
                "WHERE table_schema = 'core' AND table_name = 'searches'"
            )
        }
        kept = connection.execute("SELECT prompt_version FROM core.searches").fetchone()
    assert {row["column_name"] for row in columns} == PHASE_1_COLUMNS
    assert gone == {"runs": None, "events": None, "settings": None}
    assert "run_id" not in search_columns
    assert "ix_searches_created_at" not in search_log_indexes(legacy)
    assert search_columns["prompt_version"] == 32
    assert kept is not None
    assert kept["prompt_version"] == long_version[:32]
    # `city` is the place text as found again, which is what Phase 1 kept there.
    old = leads_by_company(legacy)
    assert {name: row["city"] for name, row in old.items()} == {
        item.company: item.city for item in LEGACY
    }

    command.upgrade(config, "head")
    command.check(config)
    # Every column the cards fill is back as it was, and the dropped ones are at their defaults.
    # So the lead we marked equals its unmarked self from before.
    assert leads_by_company(legacy) == before
    assert "ix_searches_created_at" in search_log_indexes(legacy)
    with legacy.connect() as connection:
        runs = connection.execute("SELECT count(*) AS n FROM core.runs").fetchone()
    assert runs == {"n": 0}  # the run, and so the link to it, is gone for good
