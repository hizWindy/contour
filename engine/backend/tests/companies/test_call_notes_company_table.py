"""A call saved before its company, in the table (PLAN-V24 T3-1, migration 0027):

- migration 0027 lets `company_key` and `company_name` be empty, adds `company_heard` and the
  status `needs_company`, keeps the calls that exist as they were, and the models match it;
- the table's rule: a call has its company, or it needs one and has the name as heard, never
  neither and never both;
- going down is refused while a call still needs a company, and changes nothing; once none does,
  it runs down cleanly and up again.

Made-up data only: Sample Logistics Pty Ltd and North Wind.
"""

import uuid
from typing import Any

import psycopg
import pytest
from alembic import command
from alembic.script import ScriptDirectory

from tests.companies.test_call_notes_table import add_note
from tests.conftest import alembic_config

pytestmark = pytest.mark.integration
NEEDS_COMPANY = "0027_v24_call_needs_company"


def shape(conninfo: str) -> dict[str, Any]:
    """The columns that changed (whether each may be empty), and the table's checks."""
    with psycopg.connect(conninfo, autocommit=True) as connection:
        columns = connection.execute(
            "SELECT column_name, is_nullable FROM information_schema.columns "
            "WHERE table_schema = 'companies' AND table_name = 'call_notes' "
            "AND column_name IN ('company_key', 'company_name', 'company_heard') "
            "ORDER BY column_name"
        ).fetchall()
        checks = connection.execute(
            "SELECT conname FROM pg_constraint WHERE conrelid = 'companies.call_notes'::regclass "
            "AND contype = 'c' ORDER BY conname"
        ).fetchall()
    return {"columns": dict(columns), "checks": [name for (name,) in checks]}


def waiting(connection: psycopg.Connection[Any], **values: object) -> uuid.UUID:
    """A call that needs its company, with the name as heard."""
    row: dict[str, object] = {
        "company_key": None,
        "company_name": None,
        "company_heard": "North Wind",
        "status": "needs_company",
        **values,
    }
    return add_note(connection, **row)


def test_0027_lets_a_call_wait_for_its_company_and_runs_down_once_none_does(
    scratch_url: tuple[str, str],
) -> None:
    url, conninfo = scratch_url
    config = alembic_config(url)
    before = ScriptDirectory.from_config(config).get_revision(NEEDS_COMPANY).down_revision
    assert before == "0026_v23_names_and_hubspot_user"
    command.upgrade(config, before)
    old_checks = ["ck_call_notes_sorted_by", "ck_call_notes_source", "ck_call_notes_status"]
    assert shape(conninfo) == {
        "columns": {"company_key": "NO", "company_name": "NO"},
        "checks": old_checks,
    }
    with psycopg.connect(conninfo, autocommit=True) as connection:
        kept = add_note(connection)  # a call from before, with its company

    command.upgrade(config, NEEDS_COMPANY)
    assert shape(conninfo) == {
        "columns": {"company_heard": "YES", "company_key": "YES", "company_name": "YES"},
        "checks": ["ck_call_notes_company", *old_checks],
    }
    with psycopg.connect(conninfo, autocommit=True) as connection:
        assert connection.execute(
            "SELECT company_key, company_name, company_heard, status "
            "FROM companies.call_notes WHERE id = %s",
            (kept,),
        ).fetchone() == ("101", "Sample Logistics Pty Ltd", None, "to_confirm")
        first = waiting(connection)
        add_note(connection, company_heard="Sample Logistic")  # a picked call keeps its words
        never: list[dict[str, object]] = [
            {"company_key": "101"},  # a company, yet waiting for one
            {"company_name": "Sample Logistics Pty Ltd"},
            {"company_heard": None},  # waiting with no name as heard
            {"status": "to_confirm"},  # no company, yet on its way
        ]
        for values in never:
            with pytest.raises(psycopg.errors.CheckViolation):
                waiting(connection, **values)
        with pytest.raises(psycopg.errors.CheckViolation):
            add_note(connection, status="done")  # still only the listed statuses

    # Alembic's check needs the newest migration. The models declare the same table.
    command.upgrade(config, "head")
    command.check(config)

    # Going down is refused while a call needs its company, and nothing changes.
    with pytest.raises(RuntimeError, match="still need a company"):
        command.downgrade(config, before)
    assert shape(conninfo)["columns"]["company_heard"] == "YES"
    with psycopg.connect(conninfo, autocommit=True) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            NEEDS_COMPANY,
        )
        connection.execute("DELETE FROM companies.call_notes WHERE id = %s", (first,))

    command.downgrade(config, before)
    assert shape(conninfo) == {
        "columns": {"company_key": "NO", "company_name": "NO"},
        "checks": old_checks,
    }
    with psycopg.connect(conninfo, autocommit=True) as connection:
        assert connection.execute("SELECT count(*) FROM companies.call_notes").fetchone() == (2,)
        with pytest.raises(psycopg.errors.CheckViolation):
            add_note(connection, status="needs_company")
    command.upgrade(config, "head")
    assert shape(conninfo)["columns"]["company_heard"] == "YES"
