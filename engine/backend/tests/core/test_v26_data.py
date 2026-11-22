"""PLAN-V26 Part 4: the Data tab's routes, the change record and Undo. Made-up values only."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from apps.companies.tables import CallNote
from core.auth.models import User
from core.data import edits
from core.data.edits import Editable, EditRefused
from core.data.models import AdminEdit
from core.hubspot.models import HubSpotContact
from tests.core.auth_world import World, all_rows, make_account, make_platform_admin, sign_in

pytestmark = pytest.mark.integration

TABLES = "/api/v1/data/tables"
NOW = datetime(2026, 11, 4, 1, 0, tzinfo=UTC)
NOTES = Editable(
    "companies.call_notes",
    ("company_name", "person_name", "text"),
    deletable=True,
    blocked=lambda row: "It's in HubSpot already." if row["status"] == "logged" else None,
)


@dataclass
class Team:
    world: World
    admin: httpx.AsyncClient
    staff: httpx.AsyncClient
    admin_user: User


@pytest.fixture
async def team(world: World) -> AsyncIterator[Team]:
    boss = await make_platform_admin(world)
    await make_account(
        world, email="jo@example.test", username="jsample", name="Jo Sample", role="admin"
    )
    async with world.browser() as admin, world.browser() as staff:
        assert (await sign_in(admin)).status_code == 200
        assert (await sign_in(staff, login="jsample")).status_code == 200
        yield Team(world, admin, staff, boss)


async def a_note(world: World, **changes: Any) -> CallNote:
    values: dict[str, Any] = {
        "company_key": "101",
        "company_name": "Northwind",
        "person_name": "Jo Sample",
        "text": "Ring 0412 345 678 or jo@northwind.com.au",
        "source": "typed",
        "called_at": NOW,
        "status": "to_confirm",
    }
    note = CallNote(**{**values, **changes})
    async with world.factory() as db:
        db.add(note)
        await db.commit()
    return note


# --- T4-1. The view ----------------------------------------------------------------------


async def test_every_listed_table_shows(team: Team) -> None:
    tables = (await team.admin.get(TABLES)).json()
    assert len(tables) > 30
    for table in tables:
        answer = await team.admin.get(f"{TABLES}/{table['table']}")
        assert answer.status_code == 200, f"{table['table']}: {answer.text}"
        for column in table["columns"]:
            if column["sortable"]:
                params = {"sort": column["key"], "order": "asc"}
                again = await team.admin.get(f"{TABLES}/{table['table']}", params=params)
                assert again.status_code == 200, f"{table['table']}.{column['key']}: {again.text}"


async def test_no_hash_leaves_the_server(team: Team) -> None:
    people = await team.admin.get(f"{TABLES}/core.users")
    browsers = await team.admin.get(f"{TABLES}/core.sessions")
    secrets = [user.password_hash for user in await all_rows(team.world, User)]
    assert "argon2" not in people.text
    for secret in secrets:
        assert secret not in people.text
    assert "token" not in browsers.text
    assert "a•••@example.test" in people.text  # and the email is hidden


async def test_contact_details_are_hidden_in_columns_and_in_notes(team: Team) -> None:
    await a_note(team.world)
    async with team.world.factory() as db:
        db.add(
            HubSpotContact(
                hubspot_id="9001",
                name="Jo Sample",
                email="jo@northwind.com.au",
                phone="0412 345 678",
            )
        )
        await db.commit()
    for table in ("companies.call_notes", "core.hubspot_contacts"):
        answer = await team.admin.get(f"{TABLES}/{table}")
        assert answer.json()["total"] == 1
        assert "0412" not in answer.text
        assert "jo@northwind" not in answer.text
        assert "j•••@northwind.com.au" in answer.text


async def test_search_looks_in_names_and_never_in_a_contact_detail(team: Team) -> None:
    await a_note(team.world)
    await a_note(team.world, company_name="Sample Logistics", company_key="102")
    path = f"{TABLES}/companies.call_notes"
    found = (await team.admin.get(path, params={"q": "logist"})).json()
    assert [row["values"]["company_name"] for row in found["items"]] == ["Sample Logistics"]
    assert (await team.admin.get(path, params={"q": "0412"})).json()["total"] == 0
    assert (await team.admin.get(path, params={"q": "%"})).json()["total"] == 0  # not a wildcard


async def test_fifty_to_a_page_and_sorted(team: Team) -> None:
    for number in range(52):
        await a_note(team.world, company_name=f"Sample {number:02}", company_key=str(number))
    path = f"{TABLES}/companies.call_notes"
    params: dict[str, Any] = {"sort": "company_name", "order": "asc"}
    first = (await team.admin.get(path, params=params)).json()
    second = (await team.admin.get(path, params={**params, "offset": 50})).json()
    assert (first["total"], len(first["items"]), len(second["items"])) == (52, 50, 2)
    assert first["items"][0]["values"]["company_name"] == "Sample 00"
    assert second["items"][-1]["values"]["company_name"] == "Sample 51"


async def test_only_a_listed_table_and_a_sortable_column(team: Team) -> None:
    assert (await team.admin.get(f"{TABLES}/pg_catalog.pg_authid")).status_code == 404
    assert (await team.admin.get(f"{TABLES}/core.nothing")).status_code == 404
    for table, sort in (
        ("core.users", "password_hash"),
        ("core.users", "email"),
        ("core.users", "name; drop table core.users"),
    ):
        refused = await team.admin.get(f"{TABLES}/{table}", params={"sort": sort})
        assert refused.status_code == 422, sort


async def test_the_data_tab_is_for_the_platform_admin_only(team: Team) -> None:
    for path in (TABLES, f"{TABLES}/core.users"):
        refused = await team.staff.get(path)  # an Admin, not the Platform admin
        assert refused.status_code == 403
        assert refused.json()["code"] == "platform_admin_only"


# --- T4-2. The change record and Undo ----------------------------------------------------


async def change(team: Team, note: CallNote, **values: Any) -> AdminEdit | None:
    async with team.world.factory() as db:
        edit = await edits.change(
            db, NOTES, str(note.id), values, admin_id=team.admin_user.id, now=NOW
        )
        await db.commit()
        return edit


async def undo(team: Team, edit: AdminEdit) -> AdminEdit:
    async with team.world.factory() as db:
        undone = await edits.undo(db, edit.id, admin_id=team.admin_user.id, now=NOW)
        await db.commit()
        return undone


async def test_an_edit_saves_the_old_and_new_value_who_and_when(team: Team) -> None:
    note = await a_note(team.world)
    edit = await change(team, note, company_name="Sample Logistics", person_name="Jo Sample")
    assert edit is not None
    assert (edit.table_name, edit.row_id) == ("companies.call_notes", str(note.id))
    assert (edit.admin_id, edit.created_at) == (team.admin_user.id, NOW)
    assert edit.before == {"company_name": "Northwind"}  # only what changed
    assert edit.after == {"company_name": "Sample Logistics"}
    (saved,) = await all_rows(team.world, CallNote)
    assert saved.company_name == "Sample Logistics"


async def test_nothing_different_records_nothing(team: Team) -> None:
    note = await a_note(team.world)
    assert await change(team, note, company_name="Northwind") is None
    assert await all_rows(team.world, AdminEdit) == []


async def test_undo_puts_the_old_value_back_and_is_recorded(team: Team) -> None:
    note = await a_note(team.world)
    edit = await change(team, note, company_name="Sample Logistics")
    assert edit is not None
    undone = await undo(team, edit)
    assert (undone.action, undone.undoes) == ("undo", edit.id)
    (saved,) = await all_rows(team.world, CallNote)
    assert saved.company_name == "Northwind"
    assert len(await all_rows(team.world, AdminEdit)) == 2
    with pytest.raises(EditRefused):  # once only
        await undo(team, edit)


async def test_undo_is_refused_once_the_row_changed(team: Team) -> None:
    note = await a_note(team.world)
    edit = await change(team, note, company_name="Sample Logistics")
    assert edit is not None
    async with team.world.factory() as db:
        row = await db.get(CallNote, note.id)
        assert row is not None
        row.text = "The rep rewrote it"  # another field, by someone else
        await db.commit()
    with pytest.raises(EditRefused):
        await undo(team, edit)
    (saved,) = await all_rows(team.world, CallNote)
    assert (saved.company_name, saved.text) == ("Sample Logistics", "The rep rewrote it")


async def test_a_delete_keeps_the_row_and_undo_brings_it_back_as_it_was(team: Team) -> None:
    note = await a_note(team.world)
    (before,) = await all_rows(team.world, CallNote)
    async with team.world.factory() as db:
        edit = await edits.delete(db, NOTES, str(note.id), admin_id=team.admin_user.id, now=NOW)
        await db.commit()
    assert await all_rows(team.world, CallNote) == []
    await undo(team, edit)
    (back,) = await all_rows(team.world, CallNote)
    for column in CallNote.__table__.columns:
        assert getattr(back, column.key) == getattr(before, column.key), column.key


async def test_only_listed_fields_and_only_rows_that_may_change(team: Team) -> None:
    note = await a_note(team.world)
    logged = await a_note(team.world, status="logged")
    with pytest.raises(EditRefused):
        await change(team, note, status="logged")
    with pytest.raises(EditRefused):
        await change(team, logged, company_name="Sample Logistics")
    async with team.world.factory() as db:
        with pytest.raises(EditRefused):
            await edits.change(db, NOTES, str(uuid.uuid4()), {}, admin_id=None, now=NOW)
    assert await all_rows(team.world, AdminEdit) == []
