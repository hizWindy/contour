"""The HubSpot writer (PLAN-V5 B5) on the fake HubSpot and the test database."""

import asyncio
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.client import HubSpotWritesOff, HubSpotWriteUncertain, PropertyInfo
from core.hubspot.models import HubSpotCompany, HubSpotWrite
from core.hubspot.writer import (
    CompanyTarget,
    WriteInProgress,
    WriteOut,
    WriteRequest,
    apply_write,
    note_html,
    preview_write,
    recent_writes,
)
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration


def fake_with_fields() -> FakeHubSpot:
    """Contour's HubSpot as it is now: no contour_ai_* fields yet (they come in F1)."""
    from tests.core.hubspot_fake import INDUSTRY, _plain

    fake = FakeHubSpot()
    fake.company_fields = [
        _plain("name"),
        _plain("domain"),
        _plain("city"),
        _plain("state"),
        INDUSTRY,
        PropertyInfo("numberofemployees", "Employees", "number", "number", None, True),
    ]
    return fake


def request(**changes: object) -> WriteRequest:
    base: dict[str, object] = {
        "app": "lead_finder",
        "subject": "lead:1",
        "company": CompanyTarget(name="Acme Logistics", domain="acme.com.au"),
        "fields": {
            "name": "Acme Logistics",
            "domain": "acme.com.au",
            "city": "Perth",
            "state": "WA",
            "industry": "Logistics and Supply Chain",  # the label: the core finds the code
            "numberofemployees": "320",
            "contour_ai_trigger": "Lease expiry",
        },
        "labels": {"contour_ai_trigger": "AI trigger", "city": "City"},
        "note": "Trigger: lease ends June 2027. Source: https://example.com/news?a=1&b=2",
        "list_name": "AI suggested",
    }
    return WriteRequest.model_validate(base | changes)


async def test_a_preview_of_a_new_company_writes_nothing_and_says_what_would_happen(
    session: AsyncSession,
) -> None:
    fake = fake_with_fields()
    out = await preview_write(session, fake, request())

    assert out.status == "previewed" and out.plan.action == "create"
    by_name = {change.property: change for change in out.plan.fields}
    assert by_name["industry"].value == "LOGISTICS_AND_SUPPLY_CHAIN" and by_name["industry"].write
    trigger = by_name["contour_ai_trigger"]
    assert not trigger.write and "note" in (trigger.reason or "")
    assert out.plan.note and "AI trigger: Lease expiry" in out.plan.note  # until F1 makes the field
    assert out.plan.list_id == "9"
    assert (out.can_write, out.waiting_for) == (False, "Waiting for write access")
    assert not [call for call in fake.calls if call.startswith(("create", "update", "add_to"))]


async def test_writing_off_refuses_and_writes_nothing(session: AsyncSession) -> None:
    fake = fake_with_fields()
    out = await preview_write(session, fake, request())
    with pytest.raises(HubSpotWritesOff):
        await apply_write(session, fake, out.id)
    assert fake.companies == {}
    row = await session.get(HubSpotWrite, out.id)
    assert row is not None and row.status == "previewed"


async def test_a_confirmed_write_makes_the_company_adds_the_note_and_the_list_once(
    session: AsyncSession,
) -> None:
    fake = fake_with_fields()
    fake.grant_writes()
    told: list[WriteOut] = []

    async def hook(_: AsyncSession, written: WriteOut) -> None:
        told.append(written)

    out = await preview_write(session, fake, request())
    done = await apply_write(session, fake, out.id, on_written=hook)

    assert done.status == "done" and [s.status for s in done.steps] == ["done", "done", "done"]
    (company,) = fake.companies.values()
    assert company.properties["industry"] == "LOGISTICS_AND_SUPPLY_CHAIN"
    assert "contour_ai_trigger" not in company.properties  # no such field yet: it went in the note
    (note,) = fake.notes.values()
    assert note.companies == (company.id,)
    assert "AI trigger: Lease expiry" in (note.properties["hs_note_body"] or "")
    assert fake.list_members["9"] == [company.id]
    assert done.hubspot_company_id == company.id and done.hubspot_url
    assert [w.id for w in told] == [done.id]
    # Our copy has it at once, so pages show it before the next sync.
    saved = await session.get(HubSpotCompany, company.id)
    assert saved is not None and saved.source == "api"

    # A second click returns the first result, never a second company.
    again = await apply_write(session, fake, out.id, on_written=hook)
    assert again.status == "done" and len(fake.companies) == 1 and len(fake.notes) == 1
    assert len(told) == 1
    # A second preview of the same lead returns the write that was sent.
    assert (await preview_write(session, fake, request())).id == out.id
    assert [w.id for w in await recent_writes(session)] == [out.id]


async def test_what_a_person_typed_stays_even_if_typed_after_the_preview(
    session: AsyncSession,
) -> None:
    fake = fake_with_fields()
    fake.grant_writes()
    fake.add_company("777", name="Acme Logistics", domain="acme.com.au", city="Fremantle")
    out = await preview_write(session, fake, request())
    by_name = {change.property: change for change in out.plan.fields}
    assert out.plan.action == "update" and out.plan.company_id == "777"
    assert not by_name["city"].write and by_name["city"].current == "Fremantle"

    fake.companies["777"].properties["industry"] = "LAW_PRACTICE"  # typed after the preview
    done = await apply_write(session, fake, out.id)

    assert done.status == "done"
    record = fake.companies["777"].properties
    assert record["city"] == "Fremantle" and record["industry"] == "LAW_PRACTICE"
    assert record["numberofemployees"] == "320"  # empty, so filled
    assert "industry" in (done.steps[0].detail or "")  # named as kept


async def test_a_missing_write_scope_fails_the_step_and_says_which(session: AsyncSession) -> None:
    fake = fake_with_fields()
    fake.writes_allowed = True
    fake.scopes.add("crm.objects.companies.write")  # but not crm.lists.write
    out = await preview_write(session, fake, request())
    done = await apply_write(session, fake, out.id)

    assert done.status == "partial"
    steps = {step.step: step for step in done.steps}
    assert steps["company"].status == "done" and steps["list"].status == "failed"
    assert "crm.lists.write" in (steps["list"].detail or "")

    fake.scopes.add("crm.lists.write")  # the admin adds it; applying again finishes the rest
    finished = await apply_write(session, fake, out.id)
    assert finished.status == "done" and len(fake.companies) == 1 and len(fake.notes) == 1


async def test_a_timed_out_create_is_never_sent_blind(session: AsyncSession) -> None:
    fake = fake_with_fields()
    fake.grant_writes()
    fake.fail["create_companies"] = [HubSpotWriteUncertain("HubSpot didn't answer", "timed out")]
    out = await preview_write(session, fake, request())

    first = await apply_write(session, fake, out.id)
    assert first.status == "uncertain" and fake.companies == {}

    second = await apply_write(session, fake, out.id)  # not found by domain: still not sent
    assert second.status == "uncertain"
    assert fake.calls.count("create_companies") == 1

    fake.add_company("888", name="Acme Logistics", domain="acme.com.au")  # it had landed
    third = await apply_write(session, fake, out.id)
    assert third.status == "done" and third.hubspot_company_id == "888"
    assert fake.calls.count("create_companies") == 1


async def test_a_timed_out_note_is_not_sent_again(session: AsyncSession) -> None:
    fake = fake_with_fields()
    fake.grant_writes()
    fake.fail["create_notes"] = [HubSpotWriteUncertain("HubSpot didn't answer", "timed out")]
    out = await preview_write(session, fake, request())
    first = await apply_write(session, fake, out.id)
    assert first.status == "uncertain"
    await apply_write(session, fake, out.id)
    assert fake.calls.count("create_notes") == 1


async def test_two_clicks_at_once_write_once(session: AsyncSession, session_factory) -> None:  # type: ignore[no-untyped-def]
    fake = fake_with_fields()
    fake.grant_writes()
    out = await preview_write(session, fake, request())
    results: list[object] = []

    async def click() -> None:
        async with session_factory() as own:
            try:
                results.append((await apply_write(own, fake, out.id)).status)
            except WriteInProgress:
                results.append("in progress")

    await asyncio.gather(click(), click())
    assert sorted(map(str, results)) in (["done", "in progress"], ["done", "done"])
    assert len(fake.companies) == 1


async def test_the_database_lets_one_write_run_per_subject(session: AsyncSession) -> None:
    session.add_all(
        [
            HubSpotWrite(
                id=uuid.uuid4(), app="lead_finder", subject="lead:1", plan={}, status="writing"
            ),
            HubSpotWrite(
                id=uuid.uuid4(), app="lead_finder", subject="lead:1", plan={}, status="writing"
            ),
        ]
    )
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()
    assert await session.scalar(select(func.count()).select_from(HubSpotWrite)) == 0


def test_a_note_is_escaped_and_links_are_links() -> None:
    body = note_html('Score 82 <b>bold</b>\n\nSee https://example.com/a?x=1&y="2"')
    assert body.startswith("<p>Score 82 &lt;b&gt;bold&lt;/b&gt;</p>")
    assert '<a href="https://example.com/a?x=1&amp;y=">' in body
    assert "<b>" not in body
