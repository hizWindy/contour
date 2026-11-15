"""Our copy of HubSpot's meetings (PLAN-V17 T1-8): the daily read, a refresh and its 15-minute
rule, the waiting state, the reads, and that no address or phone number is kept or logged.

Every company, person, address and number here is made up.
"""

import asyncio
import logging
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.hubspot import connection, meetings
from core.hubspot.client import (
    PAGE_SIZE,
    Association,
    Filter,
    HubSpotMissingScope,
    HubSpotObject,
    HubSpotUnavailable,
    ObjectType,
    Page,
)
from core.hubspot.meetings import Meeting, MeetingsRefresher, MeetingWhere
from core.hubspot.models import HubSpotMeeting, HubSpotMeetingRead
from core.hubspot.people import WAITING as PEOPLE_WAITING
from tests.core.hubspot_fake import SCOPE_FOR, FakeHubSpot
from tests.core.test_hubspot_sync import contour, sync

Factory = async_sessionmaker[AsyncSession]

NOW = datetime(2026, 11, 16, 0, 0, tzinfo=UTC)
JO_EMAIL = "jo.sample@samplelogistics.com.au"
JO_PHONE = "0412 345 678"


def ms(moment: datetime) -> str:
    return str(int(moment.timestamp() * 1000))


def iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


class Clock:
    """A clock a test moves by hand."""

    def __init__(self, now: datetime = NOW) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def a_meeting(
    fake: FakeHubSpot,
    meeting_id: str,
    starts_at: datetime,
    *,
    companies: Sequence[str] = ("101",),
    contacts: Sequence[str] = (),
    updated_at: datetime = NOW - timedelta(days=1),
    **properties: str | None,
) -> None:
    fields: dict[str, str | None] = {
        "hs_meeting_title": f"Meeting {meeting_id}",
        "hs_meeting_start_time": iso(starts_at),
        "hs_meeting_end_time": iso(starts_at + timedelta(hours=1)),
        "hubspot_owner_id": "301",
        "hs_meeting_outcome": "SCHEDULED",
    }
    fake.add_meeting(
        meeting_id,
        companies=companies,
        contacts=contacts,
        updated_at=updated_at,
        **(fields | properties),
    )


async def copied(factory: Factory) -> dict[str, HubSpotMeeting]:
    async with factory() as session:
        rows = await session.scalars(select(HubSpotMeeting))
        return {row.hubspot_id: row for row in rows}


async def reads(factory: Factory) -> list[HubSpotMeetingRead]:
    async with factory() as session:
        rows = await session.scalars(select(HubSpotMeetingRead).order_by(HubSpotMeetingRead.id))
        return list(rows)


# --- Pure code (fast) ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("location_type", "location", "link", "where"),
    [
        ("VCE", None, None, "online"),
        (None, "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc", None, "online"),
        ("CUSTOM", "Microsoft Teams Meeting", None, "online"),
        ("CUSTOM", "https://us02web.zoom.us/j/91234567890?pwd=abc", None, "online"),
        ("CUSTOM", "Zoom", None, "online"),
        (None, "Google Meet", None, "online"),
        (None, None, "https://meet.google.com/abc-defg-hij", "online"),
        ("ADDRESS", "Level 5, 1 Sample St, Melbourne VIC 3000", None, "in_person"),
        (None, "Level 5, 1 Sample St, Melbourne VIC 3000", None, "in_person"),
        ("CUSTOM", "Contour's boardroom", None, "in_person"),
        (None, "Meet at reception", None, "in_person"),  # "meet" alone isn't Google Meet
        ("PHONE", "Level 5, 1 Sample St", None, "unknown"),
        ("PHONE", "+61 3 9000 0000", None, "unknown"),
        (None, f"Call {JO_PHONE}", None, "unknown"),
        ("CUSTOM", f"Call Jo on {JO_PHONE}", None, "unknown"),
        (None, "https://webex.com/meet/jo.sample", None, "unknown"),
        (None, "TBC", None, "unknown"),
        (None, "Online", None, "unknown"),
        (None, None, None, "unknown"),
    ],
)
def test_where_is_a_video_call_an_address_or_neither(
    location_type: str | None, location: str | None, link: str | None, where: MeetingWhere
) -> None:
    assert meetings.where_of(location_type, location, link) == where


@pytest.mark.parametrize(
    ("text", "kept"),
    [
        (
            f"Call Jo on {JO_PHONE} or {JO_EMAIL}",
            "Call Jo on [number left out] or [email left out]",
        ),
        ("Switchboard +61 3 9000 0000.", "Switchboard [number left out]."),
        ("(03) 9000-0000", "[number left out]"),
        # Digits in twos are still a number (the Stage B security check): only times keep them.
        ("Mobile 04 12 34 56 78", "Mobile [number left out]"),
        ("Paris +33 6 12 34 56 78", "Paris [number left out]"),
        ("04.12.34.56.78", "[number left out]"),
        # A video call's own link keeps its meeting number. Any other link is read as text.
        ("https://us02web.zoom.us/j/91234567890?pwd=abc", None),
        ("https://teams.microsoft.com/meet/41234567890?p=abc", None),
        ("www.zoom.us/j/91234567890", None),
        ("Text Jo https://wa.me/61400000000", "Text Jo https://wa.me/[number left out]"),
        (
            "https://zoom.us.sample.example/61400000000",
            "https://zoom.us.sample.example/[number left out]",
        ),
        ("Moved to 2026-11-20 10:30", None),
        ("20.11.2026 in the boardroom", None),
        ("10.30 - 11.30 in the boardroom", None),
        ("9.00 - 10.00 then 11.00 to 12.00", None),
        ("Level 12, 123 Sample St, Melbourne VIC 3000", None),
    ],
)
def test_emails_and_phone_numbers_are_blanked_but_links_dates_and_times_stay(
    text: str, kept: str | None
) -> None:
    assert meetings.without_contact_details(text) == (kept if kept is not None else text)


def test_the_contour_people_are_split_in_order_once_without_the_owner() -> None:
    assert meetings.attendees("302;301; 303;302;not-an-id", "301") == ["302", "303"]
    assert meetings.attendees(None, None) == []
    assert meetings.attendees("301", "301") == []


def test_a_hubspot_meeting_as_we_keep_it() -> None:
    start = datetime(2026, 11, 20, 3, 0, tzinfo=UTC)
    record = HubSpotObject(
        id="401",
        properties={
            "hs_meeting_title": "Fitout chat with Sample Logistics",
            "hs_meeting_start_time": "2026-11-20T03:00:00.000Z",
            "hs_meeting_end_time": ms(start + timedelta(hours=1)),  # HubSpot may send either
            "hs_meeting_location": "Level 5, 1 Sample St, Melbourne",
            "hs_meeting_location_type": "ADDRESS",
            "hs_meeting_outcome": "SCHEDULED",
            "hs_internal_meeting_notes": (
                f"<p>Lease ends <b>March</b>.</p><p>Jo: {JO_PHONE}, {JO_EMAIL}</p>"
            ),
            "hubspot_owner_id": "301",
            "hs_attendee_owner_ids": "302;301;303",
        },
        url="https://app.hubspot.com/contacts/1234567/record/0-47/401",
    )
    found = meetings.meeting_of(
        record,
        companies=(Association("101", False), Association("102", False)),
        contacts=(Association("201", False), Association("202", False)),
    )
    assert found == Meeting(
        id="401",
        company_id="101",  # the first, as HubSpot lists them
        more_companies=True,
        contact_ids=["201", "202"],
        owner_id="301",
        attendee_owner_ids=["302", "303"],
        title="Fitout chat with Sample Logistics",
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        where="in_person",
        location="Level 5, 1 Sample St, Melbourne",
        outcome="SCHEDULED",
        notes="Lease ends March.\nJo: [number left out], [email left out]",
        hubspot_url="https://app.hubspot.com/contacts/1234567/record/0-47/401",
    )


def test_a_meeting_with_no_title_no_start_or_an_end_before_its_start() -> None:
    start = datetime(2026, 11, 20, 3, 0, tzinfo=UTC)
    no_title = meetings.meeting_of(
        HubSpotObject(
            id="402",
            properties={"hs_meeting_start_time": iso(start), "hs_meeting_end_time": ms(start)},
        )
    )
    assert no_title is not None
    assert (no_title.title, no_title.company_id, no_title.more_companies) == (
        "Untitled meeting",
        None,
        False,
    )
    backwards = meetings.meeting_of(
        HubSpotObject(
            id="403",
            properties={
                "hs_meeting_start_time": iso(start),
                "hs_meeting_end_time": iso(start - timedelta(hours=1)),
            },
        )
    )
    assert backwards is not None and backwards.ends_at is None
    assert (
        meetings.meeting_of(HubSpotObject(id="404", properties={"hs_meeting_title": "x"})) is None
    )


def test_the_fields_read_never_include_addresses_or_the_clients_text() -> None:
    assert "hs_all_attendee_emails" not in meetings.FIELDS
    assert "hs_meeting_body" not in meetings.FIELDS


def test_with_no_hubspot_key_a_page_starts_nothing() -> None:
    app = FastAPI()
    assert connection.refresh_meetings_soon(app) is False
    assert getattr(app.state, "meetings_refresher", None) is None


# --- The daily read --------------------------------------------------------------------------


class Recording(FakeHubSpot):
    """Remembers the fields each search asked for."""

    def __init__(self) -> None:
        super().__init__()
        self.asked: list[tuple[str, ...]] = []

    async def search_objects(
        self,
        object_type: ObjectType,
        *,
        filters: Sequence[Filter],
        properties: Sequence[str],
        sort_by: str | None = None,
        after: str | None = None,
        limit: int = PAGE_SIZE,
    ) -> Page:
        self.asked.append(tuple(properties))
        return await super().search_objects(
            object_type,
            filters=filters,
            properties=properties,
            sort_by=sort_by,
            after=after,
            limit=limit,
        )


@pytest.mark.integration
async def test_the_daily_read_copies_the_window_with_people_as_ids(
    session_factory: Factory,
) -> None:
    fake = Recording()
    a_meeting(
        fake,
        "401",
        NOW + timedelta(days=2),
        contacts=("201", "202"),
        hs_meeting_location="https://teams.microsoft.com/l/meetup-join/abc",
        hs_meeting_location_type="VCE",
        hs_attendee_owner_ids="302;303",
        hs_internal_meeting_notes="<p>Bring the <b>floor plan</b>.</p>",
    )
    a_meeting(fake, "402", NOW - timedelta(days=89), hs_meeting_outcome="COMPLETED")
    a_meeting(fake, "403", NOW - timedelta(days=91))  # before the window
    a_meeting(fake, "404", NOW + timedelta(days=61))  # after it
    a_meeting(fake, "405", NOW + timedelta(days=3), hs_meeting_start_time=None)  # can't be placed

    warnings = await meetings.copy_meetings(session_factory, fake, clock=Clock())

    assert warnings == []
    rows = await copied(session_factory)
    assert set(rows) == {"401", "402"}
    async with session_factory() as session:
        first = await meetings.get(session, "401")
    assert first is not None
    assert (first.company_id, first.contact_ids, first.owner_id) == ("101", ["201", "202"], "301")
    assert (first.attendee_owner_ids, first.where, first.outcome) == (
        ["302", "303"],
        "online",
        "SCHEDULED",
    )
    assert first.notes == "Bring the floor plan."
    assert first.hubspot_url and first.hubspot_url.endswith("/401")
    assert rows["402"].outcome == "COMPLETED"
    assert all(set(fields) == set(meetings.FIELDS) for fields in fake.asked)
    (read,) = await reads(session_factory)
    assert (read.kind, read.state, read.changed, read.started_at) == ("full", "done", 2, NOW)


@pytest.mark.integration
async def test_a_meeting_with_two_companies_goes_to_the_first_with_a_flag(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1), companies=("102", "101"))
    a_meeting(fake, "402", NOW + timedelta(days=1), companies=("101",))
    await meetings.copy_meetings(session_factory, fake, clock=Clock())
    rows = await copied(session_factory)
    assert (rows["401"].hubspot_company_id, rows["401"].more_companies) == ("102", True)
    assert (rows["402"].hubspot_company_id, rows["402"].more_companies) == ("101", False)
    async with session_factory() as session:
        assert [m.id for m in await meetings.for_company(session, "102")] == ["401"]
        assert [m.id for m in await meetings.for_company(session, "101")] == ["402"]


@pytest.mark.integration
async def test_a_cancelled_meeting_is_kept_with_hubspots_outcome(session_factory: Factory) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1), hs_meeting_outcome="CANCELED")
    await meetings.copy_meetings(session_factory, fake, clock=Clock())
    async with session_factory() as session:
        found = await meetings.upcoming(session, owner_id=None, days=7, now=NOW)
    assert [(m.id, m.outcome) for m in found] == [("401", "CANCELED")]


@pytest.mark.integration
async def test_a_meeting_deleted_in_hubspot_leaves_our_copy_on_the_daily_read(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    a_meeting(fake, "402", NOW + timedelta(days=2))
    clock = Clock()
    await meetings.copy_meetings(session_factory, fake, clock=clock)
    del fake.meetings["402"]

    clock.now = NOW + timedelta(minutes=20)
    assert await meetings.refresh(session_factory, fake, clock=clock) == 0
    assert set(await copied(session_factory)) == {"401", "402"}  # a search can't see it's gone

    clock.now = NOW + timedelta(days=1)
    await meetings.copy_meetings(session_factory, fake, clock=clock)
    assert set(await copied(session_factory)) == {"401"}
    assert (await reads(session_factory))[-1].changed == 1


@pytest.mark.integration
async def test_without_the_meetings_scope_the_sync_goes_on_and_says_what_it_waits_for(
    session_factory: Factory,
) -> None:
    fake = contour()
    fake.scopes.discard(SCOPE_FOR["meetings"])
    a_meeting(fake, "401", datetime.now(UTC) + timedelta(days=1))

    done = await sync(session_factory, fake)

    assert done.status == "done" and done.companies_saved == 3
    assert meetings.WAITING in done.warnings
    assert "crm.objects.meetings.read" in meetings.WAITING
    assert await copied(session_factory) == {}
    async with session_factory() as session:
        status = await meetings.status(session)
    assert (status.state, status.sentence) == ("waiting", meetings.WAITING)


@pytest.mark.integration
async def test_people_waiting_for_their_scope_dont_stop_meetings(
    session_factory: Factory,
) -> None:
    fake = contour()  # the fake key starts without the contacts scope
    a_meeting(fake, "401", datetime.now(UTC) + timedelta(days=1), contacts=("201",))

    done = await sync(session_factory, fake)

    assert done.status == "done"
    assert PEOPLE_WAITING in done.warnings
    assert meetings.WAITING not in done.warnings
    assert (await copied(session_factory))["401"].contact_ids == ["201"]
    async with session_factory() as session:
        assert (await meetings.status(session)).state == "ready"


@pytest.mark.integration
async def test_without_access_to_contacts_meetings_are_kept_without_their_people(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1), contacts=("201",))
    fake.fail["linked_meetings_contacts"] = [HubSpotMissingScope(["crm.objects.contacts.read"])]
    warnings = await meetings.copy_meetings(session_factory, fake, clock=Clock())
    assert warnings == [meetings.NO_PEOPLE_LINKS]
    row = (await copied(session_factory))["401"]
    assert (row.hubspot_company_id, row.contact_ids) == ("101", [])


@pytest.mark.integration
async def test_a_failed_read_keeps_the_copy_from_before(session_factory: Factory) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    clock = Clock()
    await meetings.copy_meetings(session_factory, fake, clock=clock)
    del fake.meetings["401"]
    fake.fail["search_meetings"] = [HubSpotUnavailable("HubSpot is busy", "Try again soon.")]

    clock.now = NOW + timedelta(days=1)
    warnings = await meetings.copy_meetings(session_factory, fake, clock=clock)

    assert warnings == ["Meetings weren't copied: HubSpot is busy."]
    assert set(await copied(session_factory)) == {"401"}
    assert [read.state for read in await reads(session_factory)] == ["done", "failed"]
    async with session_factory() as session:
        assert (await meetings.status(session)).state == "ready"  # the copy is still there


@pytest.mark.integration
async def test_more_meetings_than_one_search_can_list_are_all_read(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(meetings, "SEARCH_RESULTS_CAP", 4)
    fake = FakeHubSpot(page_size=2)
    for day in range(1, 7):
        a_meeting(fake, str(400 + day), NOW + timedelta(days=day))
    a_meeting(fake, "410", NOW + timedelta(days=4))  # starts with 404: read twice, kept once
    await meetings.copy_meetings(session_factory, fake, clock=Clock())
    assert len(await copied(session_factory)) == 7
    assert fake.calls.count("search_meetings") > 2  # it searched on from the last start


# --- A refresh -------------------------------------------------------------------------------


@pytest.mark.integration
async def test_a_refresh_reads_what_changed_and_removes_one_moved_out_of_the_window(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    a_meeting(fake, "402", NOW + timedelta(days=2))
    a_meeting(fake, "403", NOW + timedelta(days=3), updated_at=NOW - timedelta(minutes=5))
    clock = Clock()
    await meetings.copy_meetings(session_factory, fake, clock=clock)

    later = NOW + timedelta(minutes=20)
    a_meeting(
        fake,
        "401",
        NOW + timedelta(days=1),
        hs_meeting_title="Moved to the boardroom",
        updated_at=later - timedelta(minutes=1),
    )
    a_meeting(fake, "402", NOW + timedelta(days=70), updated_at=later - timedelta(minutes=1))
    a_meeting(fake, "404", NOW + timedelta(days=4), updated_at=later - timedelta(minutes=1))
    fake.calls.clear()
    clock.now = later

    # 401 changed, 402 moved out, 404 is new. 403 is read again (it changed within the overlap)
    # but isn't counted: nothing in it changed.
    assert await meetings.refresh(session_factory, fake, clock=clock) == 3

    rows = await copied(session_factory)
    assert set(rows) == {"401", "403", "404"}
    assert rows["401"].title == "Moved to the boardroom"
    assert fake.calls.count("search_meetings") == 1
    last = (await reads(session_factory))[-1]
    assert (last.kind, last.state, last.changed) == ("changes", "done", 3)


@pytest.mark.integration
async def test_a_refresh_asks_hubspot_at_most_once_every_15_minutes(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    clock = Clock()
    await meetings.copy_meetings(session_factory, fake, clock=clock)  # the daily read, at NOW
    a_meeting(fake, "401", NOW + timedelta(days=1), updated_at=NOW + timedelta(minutes=1))
    fake.calls.clear()

    clock.now = NOW + timedelta(minutes=14, seconds=59)
    assert await meetings.refresh(session_factory, fake, clock=clock) == 0
    assert fake.calls == []  # HubSpot wasn't asked

    clock.now = NOW + timedelta(minutes=15)
    assert await meetings.refresh(session_factory, fake, clock=clock) == 1
    fake.calls.clear()
    clock.now = NOW + timedelta(minutes=29)
    assert await meetings.refresh(session_factory, fake, clock=clock) == 0
    assert fake.calls == []  # 14 minutes after the refresh


@pytest.mark.integration
async def test_a_read_that_waited_for_access_counts_for_the_15_minutes_too(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    fake.scopes.discard(SCOPE_FOR["meetings"])
    clock = Clock()
    assert await meetings.refresh(session_factory, fake, clock=clock) == 0
    assert fake.calls.count("search_meetings") == 1
    clock.now = NOW + timedelta(minutes=10)
    assert await meetings.refresh(session_factory, fake, clock=clock) == 0
    assert fake.calls.count("search_meetings") == 1


@pytest.mark.integration
async def test_two_refreshes_at_once_read_once(session_factory: Factory) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    clock = Clock()
    results = await asyncio.gather(
        meetings.refresh(session_factory, fake, clock=clock),
        meetings.refresh(session_factory, fake, clock=clock),
    )
    assert sorted(results) == [0, 1]
    assert fake.calls.count("search_meetings") == 1


@pytest.mark.integration
async def test_a_refresh_before_any_good_read_reads_the_whole_window(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW - timedelta(days=30), updated_at=NOW - timedelta(days=60))
    assert await meetings.refresh(session_factory, fake, clock=Clock()) == 1
    (read,) = await reads(session_factory)
    assert (read.kind, read.state) == ("full", "done")


# --- The reads -------------------------------------------------------------------------------


@pytest.mark.integration
async def test_upcoming_and_past_keep_to_their_windows_and_the_owner(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW)  # now counts as upcoming
    a_meeting(
        fake,
        "402",
        NOW + timedelta(days=6, hours=23),
        hubspot_owner_id="302",
        hs_attendee_owner_ids="301",
    )
    a_meeting(fake, "403", NOW + timedelta(days=7))  # 7 days on: not in the next 7
    a_meeting(fake, "404", NOW - timedelta(hours=1), hubspot_owner_id="303")
    a_meeting(fake, "405", NOW - timedelta(days=30))
    a_meeting(fake, "406", NOW - timedelta(days=30, seconds=1))
    await meetings.copy_meetings(session_factory, fake, clock=Clock())

    async with session_factory() as session:

        async def ids(read: str, owner_id: str | None, days: int) -> list[str]:
            found = await getattr(meetings, read)(session, owner_id=owner_id, days=days, now=NOW)
            return [meeting.id for meeting in found]

        assert await ids("upcoming", None, 7) == ["401", "402"]  # soonest first
        assert await ids("upcoming", "301", 7) == ["401", "402"]  # owner, then attendee
        assert await ids("upcoming", "302", 7) == ["402"]
        assert await ids("upcoming", "999", 7) == []
        assert await ids("past", None, 30) == ["404", "405"]  # newest first
        assert await ids("past", "301", 30) == ["405"]
        assert await ids("past", "303", 30) == ["404"]
        assert await meetings.get(session, "406") is not None  # in our copy, outside the 30
        assert await meetings.get(session, "999") is None


@pytest.mark.integration
async def test_the_status_says_ready_waiting_or_off(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with session_factory() as session:
        no_key = await meetings.status(session)
        monkeypatch.setattr(meetings, "_key_set", lambda: True)
        not_yet = await meetings.status(session)
    assert (no_key.state, no_key.sentence) == ("off", meetings.NO_HUBSPOT)
    assert (not_yet.state, not_yet.sentence) == ("waiting", meetings.NOT_READ_YET)

    fake = FakeHubSpot()
    fake.fail["search_meetings"] = [HubSpotUnavailable("HubSpot is busy", "Try again soon.")]
    clock = Clock()
    await meetings.copy_meetings(session_factory, fake, clock=clock)
    async with session_factory() as session:
        failed = await meetings.status(session)
    assert (failed.state, failed.sentence) == ("waiting", meetings.NOT_READ_YET)

    clock.now = NOW + timedelta(hours=1)
    await meetings.copy_meetings(session_factory, fake, clock=clock)
    async with session_factory() as session:
        assert (await meetings.status(session)).state == "ready"


# --- Privacy ---------------------------------------------------------------------------------


@pytest.mark.integration
async def test_no_email_or_phone_number_is_saved_or_logged(
    session_factory: Factory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)  # every logger, the database's own included
    fake = FakeHubSpot()
    a_meeting(
        fake,
        "401",
        NOW + timedelta(days=1),
        contacts=("201",),
        hs_meeting_title=f"Fitout chat ({JO_EMAIL})",
        hs_meeting_location=f"Call Jo on {JO_PHONE}",
        hs_internal_meeting_notes=f"<p>Jo's mobile: {JO_PHONE}</p><p>{JO_EMAIL}</p>",
        hs_all_attendee_emails=f"{JO_EMAIL};pat.sample@contourinteriors.com.au",
        hs_meeting_body=f"Dial in: {JO_PHONE}",
    )
    await meetings.copy_meetings(session_factory, fake, clock=Clock())

    row = (await copied(session_factory))["401"]
    saved = " ".join(str(value) for value in (row.title, row.location, row.notes, row.contact_ids))
    assert "@" not in saved and "345" not in saved
    assert row.title == "Fitout chat ([email left out])"
    assert row.location == "Call Jo on [number left out]"
    logged = "\n".join(
        [record.getMessage() for record in caplog.records]
        + [repr(record.__dict__) for record in caplog.records]
    )
    assert "jo.sample@" not in logged and "pat.sample@" not in logged
    assert JO_PHONE not in logged
    assert any(record.getMessage() == "hubspot_meetings_read" for record in caplog.records)


# --- In the background, for the website ----------------------------------------------------------


class NeverAnswers(FakeHubSpot):
    """A HubSpot whose meetings search never answers, to catch a refresh while it runs."""

    def __init__(self) -> None:
        super().__init__()
        self.searching = asyncio.Event()

    async def search_objects(
        self,
        object_type: ObjectType,
        *,
        filters: Sequence[Filter],
        properties: Sequence[str],
        sort_by: str | None = None,
        after: str | None = None,
        limit: int = PAGE_SIZE,
    ) -> Page:
        self.searching.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


@pytest.mark.integration
async def test_a_page_starts_one_refresh_at_a_time_and_the_backend_stops_it(
    session_factory: Factory,
) -> None:
    fake = NeverAnswers()
    tick = [1_000.0]
    refresher = MeetingsRefresher(
        sessions=session_factory, hubspot=lambda: fake, clock=Clock(), monotonic=lambda: tick[0]
    )
    app = FastAPI()
    app.state.hubspot_provider = lambda: fake
    app.state.meetings_refresher = refresher

    assert connection.refresh_meetings_soon(app) is True
    await asyncio.wait_for(fake.searching.wait(), timeout=10)
    assert connection.refresh_meetings_soon(app) is False  # one is running
    assert refresher.running

    await connection.shut_down(app)
    assert not refresher.running and fake.closed
    assert connection.refresh_meetings_soon(app) is False  # within a minute of the last
    tick[0] += meetings.ASK_EVERY
    fake.searching.clear()
    assert connection.refresh_meetings_soon(app) is True
    await asyncio.wait_for(fake.searching.wait(), timeout=10)
    await refresher.stop()
    assert await reads(session_factory) == []  # a stopped read saves nothing
