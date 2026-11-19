"""The learned names table and the "No HubSpot user" mark (PLAN-V23 T1-2, migration 0026).

- migration 0026 adds `companies.learned_names` and `core.users.no_hubspot_user`, runs down, and
  the models match it;
- an account made before it gets the mark as false;
- one pair for each words and company, and the same words may name two companies;
- the words can't be empty, and their key is lower case;
- a pair outlives the account that taught it.

Made-up data only: "North Wind" taught as Northwind.
"""

import uuid
from typing import Any

import psycopg
import pytest
from alembic import command
from alembic.script import ScriptDirectory
from psycopg import sql

from tests.conftest import alembic_config

pytestmark = pytest.mark.integration
NAMES = "0026_v23_names_and_hubspot_user"
INDEXES = ["ix_learned_names_created_at", "pk_learned_names", "ux_learned_names_heard_company"]


def add_person(connection: psycopg.Connection[Any], login: str) -> uuid.UUID:
    person_id = uuid.uuid4()
    connection.execute(
        "INSERT INTO core.users (id, email, name, password_hash) VALUES (%s, %s, %s, 'x')",
        (person_id, f"{login}@example.test", login.title()),
    )
    return person_id


def add_pair(connection: psycopg.Connection[Any], **values: object) -> uuid.UUID:
    pair_id = uuid.uuid4()
    row: dict[str, object] = {
        "id": pair_id,
        "heard": "North Wind",
        "heard_key": "north wind",
        "company_key": "301",
        "company_name": "Northwind Pty Ltd",
        **values,
    }
    connection.execute(
        sql.SQL("INSERT INTO companies.learned_names ({}) VALUES ({})").format(
            sql.SQL(", ").join(map(sql.Identifier, row)),
            sql.SQL(", ").join(sql.Placeholder() * len(row)),
        ),
        list(row.values()),
    )
    return pair_id


def what_is_there(conninfo: str) -> tuple[object, list[str], list[str]]:
    """The table, its indexes, and the users' mark column."""
    with psycopg.connect(conninfo, autocommit=True) as connection:
        table = connection.execute("SELECT to_regclass('companies.learned_names')").fetchone()
        indexes = connection.execute(
            "SELECT indexname FROM pg_indexes "
            "WHERE schemaname = 'companies' AND tablename = 'learned_names' ORDER BY indexname"
        ).fetchall()
        mark = connection.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'core' AND table_name = 'users' "
            "AND column_name = 'no_hubspot_user'"
        ).fetchall()
    return (table[0] if table else None), [name for (name,) in indexes], [n for (n,) in mark]


def test_0026_adds_the_learned_names_and_the_mark_and_runs_down(
    scratch_url: tuple[str, str],
) -> None:
    url, conninfo = scratch_url
    config = alembic_config(url)
    before = ScriptDirectory.from_config(config).get_revision(NAMES).down_revision
    assert before == "0025_v19_roles_access"
    command.upgrade(config, before)
    assert what_is_there(conninfo) == (None, [], [])
    with psycopg.connect(conninfo, autocommit=True) as connection:
        older = add_person(connection, "jo")  # an account made before the mark

    command.upgrade(config, NAMES)
    assert what_is_there(conninfo) == ("companies.learned_names", INDEXES, ["no_hubspot_user"])
    with psycopg.connect(conninfo, autocommit=True) as connection:
        marks = connection.execute("SELECT no_hubspot_user FROM core.users").fetchall()
        assert marks == [(False,)]  # nobody is marked until someone picks it
        newer = add_person(connection, "sam")
        assert connection.execute(
            "SELECT no_hubspot_user FROM core.users WHERE id = %s", (newer,)
        ).fetchone() == (False,)

        first = add_pair(connection, made_by=older)
        made = connection.execute(
            "SELECT created_at IS NOT NULL FROM companies.learned_names WHERE id = %s", (first,)
        ).fetchone()
        assert made == (True,)
        with pytest.raises(psycopg.errors.UniqueViolation):
            add_pair(connection)  # the same words for the same company: one pair
        add_pair(connection, company_key="302", company_name="Northwind Freight")  # two companies
        for bad in ({"heard": "  "}, {"heard_key": "North Wind"}, {"heard_key": " "}):
            with pytest.raises(psycopg.errors.CheckViolation):
                add_pair(connection, company_key="303", **bad)

        # The pair stays when the account that taught it goes.
        connection.execute("DELETE FROM core.users WHERE id = %s", (older,))
        kept = connection.execute(
            "SELECT made_by FROM companies.learned_names WHERE id = %s", (first,)
        ).fetchone()
        assert kept == (None,)

    command.upgrade(config, "head")
    command.check(config)  # the models declare the same table, checks and indexes

    command.downgrade(config, before)
    assert what_is_there(conninfo) == (None, [], [])
    command.upgrade(config, "head")
    assert what_is_there(conninfo)[0] == "companies.learned_names"
