"""The pre-meeting forms table (PLAN-V17 T2-10).

- migration 0023 adds `companies.meeting_forms` and `call_notes.meeting_id`, runs down, and the
  models match it;
- a HubSpot meeting gets one form; typed ones ("New pre-read") have no meeting and any number;
- only the listed places, statuses, HubSpot copy states and triggers are saved, and a form keeps
  its defaults;
- a form outlives the account that made or sent it;
- through the models, a saved form reads its defaults at once, and `updated_at` moves on a change.

Made-up data only: Sample Logistics Pty Ltd.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import psycopg
import pytest
from alembic import command
from alembic.script import ScriptDirectory
from psycopg import sql
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies.tables import MeetingForm
from tests.conftest import alembic_config

pytestmark = pytest.mark.integration
FORMS = "0023_meeting_forms"
FORM_INDEXES = [
    "ix_meeting_forms_company",
    "ix_meeting_forms_made_by",
    "pk_meeting_forms",
    "ux_meeting_forms_meeting",
]


def add_form(connection: psycopg.Connection[Any], **values: object) -> uuid.UUID:
    """Saves one form for a made-up meeting. `values` add columns or replace these."""
    form_id = uuid.uuid4()
    row: dict[str, object] = {
        "id": form_id,
        "company_key": "101",
        "company_name": "Sample Logistics Pty Ltd",
        "title": "Fit-out walk-through",
        "starts_at": datetime.now(UTC),
        "status": "drafting",
        **values,
    }
    connection.execute(
        sql.SQL("INSERT INTO companies.meeting_forms ({}) VALUES ({})").format(
            sql.SQL(", ").join(map(sql.Identifier, row)),
            sql.SQL(", ").join(sql.Placeholder() * len(row)),
        ),
        list(row.values()),
    )
    return form_id


def add_person(connection: psycopg.Connection[Any], login: str) -> uuid.UUID:
    person_id = uuid.uuid4()
    connection.execute(
        "INSERT INTO core.users (id, email, name, password_hash) VALUES (%s, %s, %s, 'x')",
        (person_id, f"{login}@example.test", login.title()),
    )
    return person_id


def what_is_there(conninfo: str) -> tuple[object, list[str], list[str]]:
    """The forms table, its indexes, and the call notes' meeting column and index."""
    with psycopg.connect(conninfo, autocommit=True) as connection:
        table = connection.execute("SELECT to_regclass('companies.meeting_forms')").fetchone()
        indexes = connection.execute(
            "SELECT indexname FROM pg_indexes "
            "WHERE schemaname = 'companies' AND tablename = 'meeting_forms' ORDER BY indexname"
        ).fetchall()
        on_notes = connection.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'companies' AND table_name = 'call_notes' "
            "AND column_name = 'meeting_id' "
            "UNION ALL SELECT indexname FROM pg_indexes "
            "WHERE schemaname = 'companies' AND indexname = 'ix_call_notes_meeting'"
        ).fetchall()
    return (table[0] if table else None), [name for (name,) in indexes], [n for (n,) in on_notes]


def test_0023_adds_the_meeting_forms_table_and_runs_down(scratch_url: tuple[str, str]) -> None:
    url, conninfo = scratch_url
    config = alembic_config(url)
    # The migration before it: 0021 in Track 2's branch, Track 1's 0022 after the merge.
    before = ScriptDirectory.from_config(config).get_revision(FORMS).down_revision
    assert isinstance(before, str)
    command.upgrade(config, before)
    assert what_is_there(conninfo) == (None, [], [])

    command.upgrade(config, FORMS)
    assert what_is_there(conninfo) == (
        "companies.meeting_forms",
        FORM_INDEXES,
        ["meeting_id", "ix_call_notes_meeting"],
    )
    with psycopg.connect(conninfo, autocommit=True) as connection:
        rep = add_person(connection, "jo")
        first = add_form(connection, meeting_id="9001", made_by=rep)
        defaults = connection.execute(
            'SELECT "where", facts, summaries, sent_to, version, cost_usd, hubspot_copy, '
            "trigger, created_at IS NOT NULL, updated_at IS NOT NULL "
            "FROM companies.meeting_forms WHERE id = %s",
            (first,),
        ).fetchone()
        assert defaults == ("unknown", [], {}, [], 1, Decimal("0"), None, "person", True, True)

        # One form for each HubSpot meeting. Typed meetings have none, so any number.
        with pytest.raises(psycopg.errors.UniqueViolation):
            add_form(connection, meeting_id="9001")
        add_form(connection, meeting_id="9002")
        add_form(connection)
        add_form(connection)

        for column, value in (
            ("where", "phone"),
            ("status", "done"),
            ("hubspot_copy", "maybe"),
            ("trigger", "claude"),
            ("version", 0),
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                add_form(connection, **{column: value})
        for where in ("online", "in_person", "unknown"):
            add_form(connection, where=where)
        for status in ("drafting", "draft", "sent", "failed"):
            add_form(connection, status=status)
        for copy in ("saved", "waiting", "off", "failed"):
            add_form(connection, hubspot_copy=copy, hubspot_copy_sentence="Plain words.")
        add_form(connection, trigger="job")

        # An account that goes keeps its pre-reads: the form stays, with no maker or sender.
        leaver = add_person(connection, "lee")
        kept = add_form(connection, made_by=leaver, sent_by=leaver, status="sent")
        connection.execute("DELETE FROM core.users WHERE id = %s", (leaver,))
        assert connection.execute(
            "SELECT made_by, sent_by FROM companies.meeting_forms WHERE id = %s", (kept,)
        ).fetchone() == (None, None)

        # A call note may name the meeting its transcript came from.
        connection.execute(
            "INSERT INTO companies.call_notes "
            "(id, company_key, company_name, text, source, called_at, status, meeting_id) "
            "VALUES (%s, '101', 'Sample Logistics Pty Ltd', 'Met Jo Sample.', 'transcript', "
            "now(), 'to_confirm', '9001')",
            (uuid.uuid4(),),
        )

    # Alembic's check needs the newest migration. The models declare the same tables.
    command.upgrade(config, "head")
    command.check(config)

    command.downgrade(config, before)
    assert what_is_there(conninfo) == (None, [], [])
    command.upgrade(config, "head")
    assert what_is_there(conninfo)[0] == "companies.meeting_forms"


async def test_a_saved_form_reads_its_defaults_and_updated_at_moves(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The routes return the saved or changed form at once, without a new query (a lazy load
    fails in async code)."""
    async with session_factory() as db:
        form = MeetingForm(
            meeting_id="9001",
            company_key="101",
            company_name="Sample Logistics Pty Ltd",
            title="Fit-out walk-through",
            starts_at=datetime.now(UTC),
            status="drafting",
        )
        db.add(form)
        await db.commit()
        assert (form.where, form.facts, form.summaries, form.sent_to, form.version) == (
            "unknown",
            [],
            {},
            [],
            1,
        )
        assert (form.cost_usd, form.trigger, form.hubspot_copy) == (Decimal("0"), "person", None)
        assert form.created_at.tzinfo is not None
        saved_at = form.updated_at

        form.status = "draft"
        form.version += 1
        await db.commit()  # the session keeps its objects after a commit
        assert form.updated_at > saved_at
