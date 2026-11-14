"""The call notes table (PLAN-V17 T2-2).

- migration 0021 adds `companies.call_notes` and runs down, and the models match it;
- a double press is one note: one idempotency key for each person, and "no user" with sign-in off
  counts as one person;
- only the listed sources, statuses and sorters are saved, and a note keeps its defaults;
- a note outlives the account that made it;
- through the models, a saved note reads its defaults at once, and `updated_at` moves on a change.

Made-up data only: Sample Logistics Pty Ltd and Jo Sample.
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

from apps.companies.tables import CallNote
from tests.conftest import alembic_config

pytestmark = pytest.mark.integration
NOTES = "0021_call_notes"
NOTE_TEXT = "Spoke to Jo Sample. The Perth lease ends in March 2028."


def add_note(connection: psycopg.Connection[Any], **values: object) -> uuid.UUID:
    """Saves one note with made-up words. `values` add columns or replace these."""
    note_id = uuid.uuid4()
    row: dict[str, object] = {
        "id": note_id,
        "company_key": "101",
        "company_name": "Sample Logistics Pty Ltd",
        "text": NOTE_TEXT,
        "source": "typed",
        "called_at": datetime.now(UTC),
        "status": "to_confirm",
        **values,
    }
    connection.execute(
        sql.SQL("INSERT INTO companies.call_notes ({}) VALUES ({})").format(
            sql.SQL(", ").join(map(sql.Identifier, row)),
            sql.SQL(", ").join(sql.Placeholder() * len(row)),
        ),
        list(row.values()),
    )
    return note_id


def add_person(connection: psycopg.Connection[Any], login: str) -> uuid.UUID:
    person_id = uuid.uuid4()
    connection.execute(
        "INSERT INTO core.users (id, email, name, password_hash) VALUES (%s, %s, %s, 'x')",
        (person_id, f"{login}@example.test", login.title()),
    )
    return person_id


def table_and_indexes(conninfo: str) -> tuple[object, list[str]]:
    with psycopg.connect(conninfo, autocommit=True) as connection:
        table = connection.execute("SELECT to_regclass('companies.call_notes')").fetchone()
        indexes = connection.execute(
            "SELECT indexname FROM pg_indexes "
            "WHERE schemaname = 'companies' AND tablename = 'call_notes' ORDER BY indexname"
        ).fetchall()
    return (table[0] if table else None), [name for (name,) in indexes]


def test_0021_adds_the_call_notes_table_and_runs_down(scratch_url: tuple[str, str]) -> None:
    url, conninfo = scratch_url
    config = alembic_config(url)
    # The migration before it: 0017 in Track 2's branch, Track 1's 0020 after the merge.
    before = ScriptDirectory.from_config(config).get_revision(NOTES).down_revision
    assert isinstance(before, str)
    command.upgrade(config, before)
    assert table_and_indexes(conninfo) == (None, [])

    command.upgrade(config, NOTES)
    assert table_and_indexes(conninfo) == (
        "companies.call_notes",
        [
            "ix_call_notes_company",
            "ix_call_notes_made_by_status",
            "pk_call_notes",
            "ux_call_notes_idempotency",
        ],
    )
    with psycopg.connect(conninfo, autocommit=True) as connection:
        rep, other_rep = add_person(connection, "jo"), add_person(connection, "sam")
        first = add_note(connection, made_by=rep, idempotency_key="press-1")
        defaults = connection.execute(
            "SELECT sorted_by, card, left_out, cost_usd, sorted, write_id, "
            "created_at IS NOT NULL, updated_at IS NOT NULL "
            "FROM companies.call_notes WHERE id = %s",
            (first,),
        ).fetchone()
        assert defaults == ("person", {}, False, Decimal("0"), None, None, True, True)

        # A double press is one note.
        with pytest.raises(psycopg.errors.UniqueViolation):
            add_note(connection, made_by=rep, idempotency_key="press-1")
        add_note(connection, made_by=other_rep, idempotency_key="press-1")  # another person's
        add_note(connection, made_by=rep, idempotency_key="press-2")
        add_note(connection, made_by=rep)  # no key: every note is its own
        add_note(connection, made_by=rep)
        # With sign-in off there is no user, and "no user" counts as one person.
        add_note(connection, idempotency_key="press-1")
        with pytest.raises(psycopg.errors.UniqueViolation):
            add_note(connection, idempotency_key="press-1")

        for column, value in (("source", "voicemail"), ("status", "done"), ("sorted_by", "bot")):
            with pytest.raises(psycopg.errors.CheckViolation):
                add_note(connection, **{column: value})
        for source in ("mic", "typed", "transcript"):
            add_note(connection, source=source, status="sorting", sorted_by="ai")

        # An account that goes keeps its logged calls: the note stays, with no user.
        leaver = add_person(connection, "lee")
        kept = add_note(connection, made_by=leaver, status="logged")
        connection.execute("DELETE FROM core.users WHERE id = %s", (leaver,))
        assert connection.execute(
            "SELECT made_by FROM companies.call_notes WHERE id = %s", (kept,)
        ).fetchone() == (None,)

    # Alembic's check needs the newest migration. The models declare the same table.
    command.upgrade(config, "head")
    command.check(config)

    command.downgrade(config, before)
    assert table_and_indexes(conninfo) == (None, [])
    command.upgrade(config, "head")
    assert table_and_indexes(conninfo)[0] == "companies.call_notes"


async def test_a_saved_note_reads_its_defaults_and_updated_at_moves(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The routes return the saved or changed note at once, without a new query (a lazy load
    fails in async code)."""
    async with session_factory() as db:
        note = CallNote(
            company_key="101",
            company_name="Sample Logistics Pty Ltd",
            person_name="Jo Sample",
            text=NOTE_TEXT,
            source="mic",
            called_at=datetime.now(UTC),
            status="sorting",
        )
        db.add(note)
        await db.commit()
        assert (note.sorted_by, note.card, note.left_out, note.cost_usd) == (
            "person",
            {},
            False,
            Decimal("0"),
        )
        assert note.created_at.tzinfo is not None
        saved_at = note.updated_at

        note.status = "to_confirm"
        note.card = {"call": {"summary": "Jo Sample confirmed the March 2028 lease end."}}
        await db.commit()  # the session keeps its objects after a commit
        assert note.updated_at > saved_at
