"""PLAN-V26 T4-3 (the three edit screens) and T3-4 (the keep time). Made-up values only."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select, update

from apps.companies.tables import CallNote
from apps.lead_finder.tables import Lead
from core.auth import audit, records
from core.auth.models import AuditEntry, User
from core.data.models import AdminEdit
from core.hubspot.models import HubSpotCompany, HubSpotContact
from core.logs import REDACTED
from core.memory.models import EMBEDDING_DIM, MemoryItem
from core.runs.models import Run
from core.schedules.jobs import JobContext
from core.searches.models import SearchLog
from tests.core.auth_world import World, all_rows, make_account, make_platform_admin, sign_in
from tests.lead_finder.factories import make_lead

pytestmark = pytest.mark.integration

DATA = "/api/v1/data"
NOTES, LEADS, MEMORY = "companies.call_notes", "lead_finder.leads", "core.memory"


@dataclass
class Team:
    world: World
    admin: httpx.AsyncClient
    staff: httpx.AsyncClient
    admin_user: User

    def path(self, table: str, row: object) -> str:
        return f"{DATA}/tables/{table}/rows/{row}"

    async def save(self, *rows: Any) -> None:
        async with self.world.factory() as db:
            db.add_all(rows)
            await db.commit()

    async def edit(self, table: str, row: object, **values: str | None) -> httpx.Response:
        return await self.admin.patch(self.path(table, row), json={"values": values})

    async def undo(self, edit_id: str) -> httpx.Response:
        return await self.admin.post(f"{DATA}/edits/{edit_id}/undo")


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


def company(key: str, name: str) -> HubSpotCompany:
    return HubSpotCompany(hubspot_id=key, name=name, source="api")


def person(key: str, company_key: str, name: str) -> HubSpotContact:
    return HubSpotContact(hubspot_id=key, hubspot_company_id=company_key, name=name)


def note(world: World, **changes: Any) -> CallNote:
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "company_key": "101",
        "company_name": "Northwind",
        "contact_id": "c1",
        "person_name": "Jo Example",
        "text": "They may move next year",
        "source": "typed",
        "called_at": world.clock.now,
        "status": "to_confirm",
        "card": {"call": {"summary": "May move", "outcome": "Connected"}},
    }
    return CallNote(**{**values, **changes})


async def only[T](world: World, model: type[T]) -> T:
    (row,) = await all_rows(world, model)
    found: T = row
    return found


# --- Leads -------------------------------------------------------------------------------


async def test_a_lead_changes_only_its_listed_fields_and_its_card_follows(team: Team) -> None:
    lead = make_lead("Northwind", city="Perth")
    lead_id, key = lead.id, lead.company_key
    await team.save(lead)

    form = (await team.admin.get(team.path(LEADS, lead_id))).json()
    names = [field["key"] for field in form["fields"]]
    assert names == ["company", "city", "website", "result", "note"]
    assert (form["blocked"], form["deletable"]) == (None, False)

    saved = await team.edit(
        LEADS,
        lead_id,
        company="Northwind Group",
        city="Adelaide",
        website="https://www.northwind.com.au/",
        result="watch",
        note="Checked by hand",
    )
    assert saved.status_code == 200, saved.text
    after = await only(team.world, Lead)
    assert (after.company, after.city, after.result) == ("Northwind Group", "Adelaide", "watch")
    assert after.domain == "northwind.com.au"
    assert (after.card["company"], after.card["result"]) == ("Northwind Group", "watch")
    assert after.company_key == key  # the name that was asked for
    edit = await only(team.world, AdminEdit)
    assert (edit.admin_id, edit.action) == (team.admin_user.id, "change")

    undone = await team.undo(saved.json()["edit_id"])
    assert undone.status_code == 200, undone.text
    back = await only(team.world, Lead)
    assert (back.company, back.city, back.result) == ("Northwind", "Perth", "pass")
    assert back.card["company"] == "Northwind"


@pytest.mark.parametrize(
    ("field", "value"),
    [("score", "100"), ("card", "{}"), ("company", ""), ("result", "brilliant")],
)
async def test_a_lead_refuses_any_other_field_or_a_bad_value(
    team: Team, field: str, value: str
) -> None:
    lead = make_lead("Northwind")
    lead_id = lead.id
    await team.save(lead)
    refused = await team.edit(LEADS, lead_id, **{field: value})
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["field"] == f"body.values.{field}"
    assert await all_rows(team.world, AdminEdit) == []


async def test_a_lead_is_never_deleted_here(team: Team) -> None:
    lead = make_lead("Northwind")
    lead_id = lead.id
    await team.save(lead)
    assert (await team.admin.delete(team.path(LEADS, lead_id))).status_code == 409
    assert len(await all_rows(team.world, Lead)) == 1


# --- Calls not yet sent ------------------------------------------------------------------


async def test_a_call_changes_its_person_outcome_and_note(team: Team) -> None:
    call = note(team.world)
    call_id = call.id
    await team.save(company("101", "Northwind"), person("c2", "101", "Sam Example"), call)
    saved = await team.edit(
        NOTES, call_id, person="c2", outcome="No answer", note="Ring 0412 345 678 on Friday"
    )
    assert saved.status_code == 200, saved.text
    after = await only(team.world, CallNote)
    assert (after.contact_id, after.person_name) == ("c2", "Sam Example")
    assert after.card["call"]["outcome"] == "No answer"
    assert "0412" not in after.text  # left out, as saving a note does


async def test_a_new_company_drops_the_old_ones_person_and_field_changes(team: Team) -> None:
    call = note(
        team.world,
        card={"call": {"outcome": "Connected"}, "changes": [], "dropped": [], "unsure": None},
    )
    call_id = call.id
    await team.save(company("101", "Northwind"), company("102", "Sample Logistics"), call)
    saved = await team.edit(NOTES, call_id, company="102")
    assert saved.status_code == 200, saved.text
    after = await only(team.world, CallNote)
    assert (after.company_key, after.company_name) == ("102", "Sample Logistics")
    assert (after.contact_id, after.person_name) == (None, None)
    assert after.card["changes"] == []
    assert after.card["call"]["outcome"] == "Connected"


async def test_someone_elses_person_cant_be_put_on_a_call(team: Team) -> None:
    call = note(team.world)
    call_id = call.id
    await team.save(company("101", "Northwind"), person("c9", "999", "Not Theirs"), call)
    assert (await team.edit(NOTES, call_id, person="c9")).status_code == 422


async def test_a_call_that_needs_a_company_waits_to_be_confirmed_free(team: Team) -> None:
    call = note(
        team.world,
        status="needs_company",
        company_key=None,
        company_name=None,
        company_heard="North Wind",
        contact_id=None,
        person_name=None,
    )
    call_id = call.id
    await team.save(company("101", "Northwind"), call)
    saved = await team.edit(NOTES, call_id, company="101")
    assert saved.status_code == 200, saved.text
    after = await only(team.world, CallNote)
    assert (after.status, after.company_name, after.sorted_by) == (
        "to_confirm",
        "Northwind",
        "person",
    )
    assert await all_rows(team.world, SearchLog) == []  # no Claude

    assert (await team.undo(saved.json()["edit_id"])).status_code == 200
    back = await only(team.world, CallNote)
    assert (back.status, back.company_key) == ("needs_company", None)


@pytest.mark.parametrize("status", ["sorting", "sending", "logged", "partial", "uncertain"])
async def test_a_call_that_is_sending_or_logged_cant_be_edited_or_deleted(
    team: Team, status: str
) -> None:
    call = note(team.world, status=status)
    call_id = call.id
    await team.save(call)
    assert (await team.admin.get(team.path(NOTES, call_id))).json()["blocked"]
    assert (await team.edit(NOTES, call_id, note="Changed")).status_code == 409
    assert (await team.admin.delete(team.path(NOTES, call_id))).status_code == 409
    assert (await only(team.world, CallNote)).text == "They may move next year"


async def test_a_failed_call_that_is_partly_in_hubspot_cant_change(team: Team) -> None:
    call = note(team.world, status="failed", card={"call": {"state": "landed"}})
    call_id = call.id
    await team.save(call)
    assert (await team.edit(NOTES, call_id, note="Changed")).status_code == 409


async def test_a_stuck_call_is_deleted_and_undo_brings_it_back(team: Team) -> None:
    call = note(team.world, status="failed")
    call_id = call.id
    await team.save(call)
    gone = await team.admin.delete(team.path(NOTES, call_id))
    assert gone.status_code == 200, gone.text
    assert await all_rows(team.world, CallNote) == []
    assert (await team.undo(gone.json()["edit_id"])).status_code == 200
    back = await only(team.world, CallNote)
    assert (back.id, back.text, back.status) == (call_id, "They may move next year", "failed")


async def test_a_hidden_detail_is_never_shown_or_saved_as_dots(team: Team) -> None:
    lead = make_lead("Northwind")
    lead.note = "Ring 0412 345 678"
    lead_id = lead.id
    await team.save(lead)
    form = await team.admin.get(team.path(LEADS, lead_id))
    assert "0412" not in form.text
    shown = next(field for field in form.json()["fields"] if field["key"] == "note")
    assert shown["hidden"] is True
    assert (await team.edit(LEADS, lead_id, note=shown["value"] + " today")).status_code == 422
    assert (await only(team.world, Lead)).note == "Ring 0412 345 678"


# --- Memory ------------------------------------------------------------------------------


async def test_a_wrong_memory_note_is_deleted_and_undo_restores_it_whole(team: Team) -> None:
    vector = [0.0] * EMBEDDING_DIM
    vector[3] = 0.25
    item = MemoryItem(
        id=uuid.uuid4(), app="lead_finder", kind="note", content="Wrong", embedding=vector
    )
    item_id = item.id
    await team.save(item)
    form = (await team.admin.get(team.path(MEMORY, item_id))).json()
    assert (form["fields"], form["deletable"]) == ([], True)
    assert (await team.edit(MEMORY, item_id, content="Better")).status_code == 422

    gone = await team.admin.delete(team.path(MEMORY, item_id))
    assert gone.status_code == 200, gone.text
    assert await all_rows(team.world, MemoryItem) == []
    assert (await team.undo(gone.json()["edit_id"])).status_code == 200
    back = await only(team.world, MemoryItem)
    assert back.content == "Wrong"
    assert list(back.embedding) == pytest.approx(vector)


# --- The record --------------------------------------------------------------------------


async def test_the_edits_say_who_what_and_whether_undo_is_left(team: Team) -> None:
    lead = make_lead("Northwind")
    lead_id = lead.id
    await team.save(lead)
    edit_id = (await team.edit(LEADS, lead_id, company="Northwind Group")).json()["edit_id"]
    listed = (await team.admin.get(f"{DATA}/edits", params={"table": LEADS})).json()
    assert listed["total"] == 1
    (row,) = listed["items"]
    assert (row["admin_name"], row["can_undo"]) == ("Al Khair", True)
    assert row["changes"] == [
        {"label": "Company", "before": "Northwind", "after": "Northwind Group"}
    ]
    assert (await team.undo(edit_id)).status_code == 200
    listed = (await team.admin.get(f"{DATA}/edits", params={"table": LEADS})).json()
    assert [item["can_undo"] for item in listed["items"]] == [False, False]
    assert (await team.undo(edit_id)).status_code == 409


async def test_the_edits_show_names_and_words_not_ids(team: Team) -> None:
    call, lead = note(team.world), make_lead("Northwind")
    call_id, lead_id = call.id, lead.id
    await team.save(company("101", "Northwind"), person("c2", "101", "Sam Example"), call, lead)
    assert (await team.edit(NOTES, call_id, person="c2")).status_code == 200
    assert (await team.edit(LEADS, lead_id, result="watch")).status_code == 200
    said = []
    for table in (NOTES, LEADS):
        listed = (await team.admin.get(f"{DATA}/edits", params={"table": table})).json()
        said += listed["items"][0]["changes"]
    assert said == [
        {"label": "Person", "before": "Jo Example", "after": "Sam Example"},
        {"label": "Result", "before": "Pass", "after": "Watch"},
    ]


async def test_a_redacted_key_is_never_saved_over_the_real_text(team: Team) -> None:
    lead = make_lead("Northwind")
    lead_id = lead.id
    await team.save(lead)
    assert (await team.edit(LEADS, lead_id, note=f"the key is {REDACTED}")).status_code == 422


async def test_undo_is_refused_once_someone_changed_the_row(team: Team) -> None:
    lead = make_lead("Northwind")
    lead_id = lead.id
    await team.save(lead)
    first = (await team.edit(LEADS, lead_id, city="Adelaide")).json()["edit_id"]
    assert (await team.edit(LEADS, lead_id, note="Newer work")).status_code == 200
    assert (await team.undo(first)).status_code == 409
    assert (await only(team.world, Lead)).city == "Adelaide"


async def test_edit_screens_are_for_the_platform_admin_and_three_tables_only(team: Team) -> None:
    path = team.path(LEADS, uuid.uuid4())
    for method, url, body in (
        ("GET", path, None),
        ("PATCH", path, {"values": {}}),
        ("DELETE", path, None),
        ("GET", f"{DATA}/edits?table={LEADS}", None),
        ("POST", f"{DATA}/edits/{uuid.uuid4()}/undo", None),
    ):
        refused = await team.staff.request(method, url, json=body)
        assert refused.status_code == 403, f"{method} {url}"
    tables = (await team.admin.get(f"{DATA}/tables")).json()
    assert {row["table"] for row in tables if row["editable"]} == {LEADS, NOTES, MEMORY}
    for table in ("core.users", "core.hubspot_companies", "core.settings"):
        assert (await team.edit(table, "1", name="X")).status_code == 404


# --- T3-4. The keep time, off until Levi's OK --------------------------------------------


async def run_job(team: Team) -> str:
    context = JobContext(team.world.app, uuid.uuid4(), {}, team.world.clock.now)
    return (await records.start(context)).ref


async def old_rows(team: Team) -> None:
    now = team.world.clock.now
    old = now - timedelta(days=91)
    await team.save(
        AuditEntry(event="sign_in_failed", created_at=old),
        AuditEntry(event="sign_out", created_at=now - timedelta(days=89)),
        note(team.world, called_at=old, created_at=old),
        Run(app="lead_finder", mode="company", created_at=old),
    )


async def test_nothing_is_deleted_or_said_before_levis_ok(team: Team) -> None:
    await old_rows(team)
    before = len(await all_rows(team.world, AuditEntry))
    assert await run_job(team) == "sign-in-records:waiting"
    assert len(await all_rows(team.world, AuditEntry)) == before
    assert (await team.admin.get("/api/v1/health")).json()["sign_in_records_days"] is None


async def test_with_the_ok_old_sign_in_rows_go_and_nothing_else(team: Team) -> None:
    team.world.settings(sign_in_records_ok=True)
    await old_rows(team)
    before = len(await all_rows(team.world, AuditEntry))
    assert await run_job(team) == "sign-in-records:1"
    left = await all_rows(team.world, AuditEntry)
    assert len(left) == before - 1
    assert "sign_in_failed" not in [row.event for row in left]
    assert len(await all_rows(team.world, CallNote)) == 1
    assert len(await all_rows(team.world, Run)) == 1


async def test_with_the_ok_the_sign_in_page_is_told_without_a_session(team: Team) -> None:
    team.world.settings(sign_in_records_ok=True)
    async with team.world.browser() as nobody:
        assert (await nobody.get("/api/v1/health")).json()["sign_in_records_days"] == 90


async def test_signing_in_to_an_old_account_never_says_first_sign_in(team: Team) -> None:
    team.world.settings(sign_in_records_ok=True)
    old = team.world.clock.now - timedelta(days=120)
    await make_account(team.world, email="sam@example.test", username="samsample", name="Sam")
    async with team.world.factory() as db:
        await db.execute(update(User).where(User.username == "samsample").values(created_at=old))
        await db.commit()
    async with team.world.browser() as browser:
        answer = await sign_in(browser, login="samsample")
        assert answer.json()["first_sign_in"] is False


async def test_an_old_account_isnt_new_again_once_its_records_are_gone(team: Team) -> None:
    user_id = team.admin_user.id
    async with team.world.factory() as db:
        assert await audit.is_first_sign_in(db, user_id) is True  # one sign-in is in the log
        made = await db.scalar(select(User.created_at).where(User.id == user_id))
        assert made is not None
        since = made + timedelta(days=1)  # the log begins after the account was made
        assert await audit.is_first_sign_in(db, user_id, kept_since=since) is False
