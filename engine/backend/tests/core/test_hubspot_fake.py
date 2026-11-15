"""The fake HubSpot (hubspot_fake.py) keeps the client's rules for links and write scopes
(PLAN-V17 T1-3), so a test on the fake fails where the real HubSpot would refuse."""

import pytest

from core.hubspot.check import ACTIVITY_WRITE_SCOPE
from core.hubspot.client import (
    Association,
    HubSpotMissingScope,
    HubSpotRejected,
    HubSpotWritesOff,
    Link,
    ObjectType,
)
from tests.core.hubspot_fake import FakeHubSpot

AT = {"hs_timestamp": "1763251200000"}


def writing() -> FakeHubSpot:
    fake = FakeHubSpot()
    fake.grant_writes()
    return fake


async def test_a_call_keeps_its_links_and_linked_finds_them_both_ways() -> None:
    fake = writing()
    made = await fake.create_object(
        "calls",
        AT,
        links=[
            Link("companies", "101"),
            Link("contacts", "201"),
            Link("deals", "501"),
            Link("contacts", "202"),
            Link("contacts", " 201 "),  # the same person again
        ],
    )
    record = fake.call_log[made.id]
    assert (record.companies, record.contacts, record.deals) == (("101",), ("201", "202"), ("501",))
    assert await fake.linked("calls", "contacts", [made.id, "999"]) == {
        made.id: (Association("201", primary=True), Association("202", primary=False))
    }
    assert await fake.linked("companies", "calls", ["101"]) == {
        "101": (Association(made.id, primary=True),)
    }
    assert "linked_calls_contacts" in fake.calls


async def test_the_fake_refuses_a_link_the_client_has_no_number_for() -> None:
    fake = writing()
    with pytest.raises(HubSpotRejected):
        await fake.create_object("calls", AT, links=[Link("calls", "301")])  # type: ignore[arg-type]
    with pytest.raises(HubSpotRejected):
        await fake.create_object("companies", {"name": "x"}, links=[Link("contacts", "201")])
    with pytest.raises(ValueError, match="record id"):  # as the client: digits only
        await fake.create_object("tasks", AT, links=[Link("companies", "hs-101")])
    assert fake.call_log == {} and fake.companies == {} and fake.tasks == {}


async def test_activities_need_the_activity_scope_and_a_note_the_companies_one() -> None:
    fake = FakeHubSpot()
    with pytest.raises(HubSpotWritesOff):
        await fake.create_object("tasks", AT, links=[Link("companies", "101")])
    fake.writes_allowed = True
    fake.scopes.add("crm.objects.companies.write")  # what the Lead Finder needs, no more
    note = await fake.create_object("notes", AT, links=[Link("companies", "101")])
    assert fake.notes[note.id].companies == ("101",)
    kinds: tuple[ObjectType, ...] = ("calls", "tasks", "meetings")
    for kind in kinds:
        with pytest.raises(HubSpotMissingScope) as caught:
            await fake.create_object(kind, AT, links=[Link("companies", "101")])
        assert caught.value.scopes == (ACTIVITY_WRITE_SCOPE,)
    fake.scopes.add(ACTIVITY_WRITE_SCOPE)
    task = await fake.create_object("tasks", AT, links=[Link("deals", "501")])
    meeting = await fake.create_object("meetings", AT, links=[Link("contacts", "201")])
    assert (fake.tasks[task.id].deals, fake.meetings[meeting.id].contacts) == (("501",), ("201",))
    await fake.update_object("meetings", meeting.id, {"hs_internal_meeting_notes": "Pre-read"})
    assert fake.meetings[meeting.id].properties["hs_internal_meeting_notes"] == "Pre-read"


async def test_links_are_read_with_the_first_kinds_scope_and_primary_companies_hold() -> None:
    fake = FakeHubSpot(scopes=set())
    fake.add_deal("501", "101")
    with pytest.raises(HubSpotMissingScope):
        await fake.linked("deals", "companies", ["501"])
    fake.scopes.add("crm.objects.deals.read")
    fake.add_deal("502", None)
    assert await fake.primary_companies(["501", "502", "503"]) == {"501": "101"}
    assert await fake.linked("deals", "companies", ["501", "502"]) == {
        "501": (Association("101", primary=True),)
    }
