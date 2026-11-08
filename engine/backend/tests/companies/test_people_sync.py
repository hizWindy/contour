"""People and calls from HubSpot (PLAN-V10 C1), on the fake HubSpot and the test database:

- without the contacts scope the sync goes on, says what it waits for, and the Admin page's
  check and the Companies project's readiness say "waiting";
- with it, contacts and the calls of the last 2 years are copied, with their company, person,
  owner, length, outcome and note, and the Companies panel shows them.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies.app import HUBSPOT_NEEDS
from core.hubspot.check import check_connection
from core.hubspot.client import Owner
from core.hubspot.models import HubSpotCall, HubSpotContact
from core.hubspot.needs import readiness
from core.hubspot.people import WAITING, plain
from tests.companies.helpers import API, signed_in_as
from tests.core.auth_world import World
from tests.core.hubspot_fake import FakeHubSpot
from tests.core.test_hubspot_sync import sync

pytestmark = pytest.mark.integration


def ms(moment: datetime) -> str:
    return str(int(moment.timestamp() * 1000))


def with_people() -> FakeHubSpot:
    fake = FakeHubSpot(page_size=2)
    fake.owners_active = [Owner("11", "Levi Smith", False)]
    fake.add_company("101", name="ABC Logistics", domain="abclogistics.com.au")
    fake.add_contact(
        "201",
        firstname="Jason",
        lastname="Reeds",
        jobtitle="Head of Operations",
        phone="+61 8 9000 1234",
        email="jason@abclogistics.com.au",
        associatedcompanyid="101",
    )
    fake.add_contact("202", firstname="Mia", lastname=None, associatedcompanyid="101")
    now = datetime.now(UTC)
    fake.add_call(
        "301",
        "101",
        "201",
        hs_timestamp=ms(now - timedelta(days=30)),
        hs_call_duration="420000",
        hs_call_disposition="f240bbac-87c9-4f6e-bf70-924b57d47db7",
        hs_call_body="<p>Lease ends next year.</p><p>Call back in <b>March</b>.</p>",
        hubspot_owner_id="11",
    )
    fake.add_call("302", "101", None, hs_timestamp=ms(now - timedelta(days=3 * 365)))
    return fake


async def test_without_the_scope_the_sync_goes_on_and_says_it_waits(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    fake = with_people()  # the fake key starts without the contacts scope
    done = await sync(session_factory, fake)
    assert done.status == "done"
    assert WAITING in done.warnings
    assert (await session.scalars(select(HubSpotContact))).all() == []
    check = await check_connection(fake)
    assert check.state_of("crm.objects.contacts.read") == "no"
    ready = readiness("companies", "Companies", HUBSPOT_NEEDS, check, write_enabled=False)
    assert ready.reading == "waiting"
    assert ready.waiting_for == ["crm.objects.contacts.read"]


async def test_with_the_scope_people_and_two_years_of_calls_are_copied(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    fake = with_people()
    fake.grant_people()
    done = await sync(session_factory, fake)
    assert WAITING not in done.warnings
    contacts = {row.hubspot_id: row for row in (await session.scalars(select(HubSpotContact)))}
    assert set(contacts) == {"201", "202"}
    jason = contacts["201"]
    assert (jason.name, jason.job_title, jason.hubspot_company_id) == (
        "Jason Reeds",
        "Head of Operations",
        "101",
    )
    assert jason.email == "jason@abclogistics.com.au"  # kept for the team, never sent to Claude
    assert contacts["202"].name == "Mia"
    calls = (await session.scalars(select(HubSpotCall))).all()
    assert [call.hubspot_id for call in calls] == ["301"]  # the 3-year-old call is left out
    call = calls[0]
    assert (call.hubspot_company_id, call.hubspot_contact_id) == ("101", "201")
    assert (call.duration_seconds, call.outcome, call.owner) == (420, "Connected", "Levi Smith")
    assert call.note == "Lease ends next year.\nCall back in March."
    # A second sync replaces the copy: a call deleted in HubSpot goes too.
    del fake.call_log["301"]
    await sync(session_factory, fake)
    assert (await session.scalars(select(HubSpotCall))).all() == []


async def test_the_panel_shows_people_once_they_are_copied(
    world: World, session_factory: Any
) -> None:
    fake = with_people()
    fake.grant_people()
    await sync(session_factory, fake)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        detail = (await client.get(f"{API}/101")).json()
    assert detail["people_status"] == "ready"
    assert {person["name"] for person in detail["people"]} == {"Jason Reeds", "Mia"}
    assert detail["calls"][0]["note"].startswith("Lease ends next year.")
    assert detail["last_talk_note"] == "Lease ends next year.\nCall back in March."


def test_a_call_note_loses_its_html() -> None:
    assert plain("<div>Hi&nbsp;there<br>Second line</div>") == "Hi there\nSecond line"
    assert plain("<p></p>") is None
    assert plain(None) is None
