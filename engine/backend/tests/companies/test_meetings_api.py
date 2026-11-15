"""The Meetings reads (PLAN-V17 T2-11), with made-up meetings in place of core's reads:

- off: every Meetings route answers 409, and the company's record shows no meetings;
- my upcoming meetings, grouped by the Melbourne day; the team's, mine first; the past ones, with
  "notes logged"; a meeting with no company, or a company not in our copy, is left out; a
  cancelled one stays;
- the search: company, title and date words, in any case;
- HubSpot's meetings not read yet: an empty list that says so, and zero counts;
- a rep whose account isn't linked to a HubSpot owner; sign-in off;
- the counts for Home; one meeting with its pre-read; a company's next three and last three.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.meeting_store import NOT_LINKED, MeetingSource
from apps.companies.tables import MeetingForm
from core.api.deps import settings_dependency
from core.auth.models import User
from core.hubspot.meetings import NOT_READ_YET, Meeting, MeetingsStatus
from tests.companies.helpers import API, add, signed_in_as
from tests.companies.test_call_notes_api import a_company, log_call, notes_settings, set_note
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
MEETINGS = f"{API}/meetings"
# START is 9 am on Wednesday 4 Nov 2026 in UTC: 8 pm the same day in Melbourne (UTC+11).
MELBOURNE = timedelta(hours=11)


def melbourne(day: int, hour: int, minute: int = 0, month: int = 11) -> datetime:
    """A Melbourne summer time (UTC+11) in 2026, as UTC."""
    return datetime(2026, month, day, hour, minute, tzinfo=UTC) - MELBOURNE


def meeting(
    meeting_id: str, company_id: str | None, owner_id: str, at: datetime, **more: Any
) -> Meeting:
    title = more.pop("title", f"Meeting {meeting_id}")
    return Meeting(
        id=meeting_id,
        company_id=company_id,
        owner_id=owner_id,
        title=title,
        starts_at=at,
        ends_at=at + timedelta(hours=1),
        **more,
    )


# Mia is HubSpot owner o1, and Sam is o2. 201 is Sample Logistics, 202 Sample Freight.
UPCOMING = [
    meeting("9001", "201", "o1", melbourne(4, 21, 30), title="Fit-out walk-through"),  # today
    meeting("9002", "202", "o2", melbourne(5, 8), title="Lease review"),  # tomorrow
    meeting("9003", "201", "o1", melbourne(6, 10), title="Design brief", where="online"),
    meeting("9004", None, "o1", melbourne(5, 12), title="Team lunch"),  # no company: left out
    meeting("9005", "202", "o1", melbourne(9, 10), title="Site visit"),  # Monday: later
    meeting("9006", "201", "o1", melbourne(5, 15), title="Budget check", outcome="canceled"),
    meeting("9007", "999", "o1", melbourne(5, 16), title="Not in our copy"),  # left out
    meeting("9008", "202", "o1", melbourne(10, 10), title="Floor plan"),  # Tuesday: later
    meeting("9009", "201", "o2", melbourne(11, 9), title="Furniture"),  # Wednesday: later
]
PAST = [
    meeting("8001", "201", "o1", melbourne(2, 10), title="Intro call", outcome="completed"),
    meeting("8002", "202", "o2", melbourne(3, 10), title="Catch-up"),
    meeting("8003", "201", "o1", melbourne(20, 10, month=10), title="First visit"),
    meeting("8004", "201", "o1", melbourne(1, 10, month=9), title="Old visit"),  # 2 months ago
    meeting("8005", "201", "o1", melbourne(1, 10, month=8), title="Older visit"),
]


@dataclass
class FakeMeetings:
    """Core's meeting reads, made up: the meetings above, read from START."""

    state: MeetingsStatus = field(default_factory=lambda: MeetingsStatus(state="ready"))
    owners: dict[str, str] = field(default_factory=lambda: {"mia": "o1", "sam": "o2"})
    windows: list[tuple[str, str | None, int]] = field(default_factory=list)

    def source(self) -> MeetingSource:
        return MeetingSource(
            upcoming=self.upcoming,
            past=self.past,
            for_company=self.for_company,
            get=self.get,
            status=self.status,
            owner_of=self.owner_of,
        )

    async def upcoming(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        self.windows.append(("upcoming", owner_id, days))
        end = START + timedelta(days=days)
        found = [m for m in UPCOMING if START <= m.starts_at < end]
        found = [m for m in found if owner_id is None or m.owner_id == owner_id]
        return sorted(found, key=lambda m: m.starts_at)

    async def past(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        self.windows.append(("past", owner_id, days))
        start = START - timedelta(days=days)
        found = [m for m in PAST if start <= m.starts_at < START]
        found = [m for m in found if owner_id is None or m.owner_id == owner_id]
        return sorted(found, key=lambda m: m.starts_at, reverse=True)

    async def for_company(self, session: AsyncSession, company_id: str) -> list[Meeting]:
        return [m for m in [*UPCOMING, *PAST] if m.company_id == company_id]

    async def get(self, session: AsyncSession, meeting_id: str) -> Meeting | None:
        return next((m for m in [*UPCOMING, *PAST] if m.id == meeting_id), None)

    async def status(self, session: AsyncSession) -> MeetingsStatus:
        return self.state

    async def owner_of(self, session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
        person = await session.get(User, user_id) if user_id is not None else None
        login = person.email.split("@")[0] if person is not None else ""
        return self.owners.get(login)


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: Meetings and call notes on. A test changes them."""
    chosen: dict[str, Any] = {"meeting_forms_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def fake(world: World) -> FakeMeetings:
    made = FakeMeetings()
    world.app.state.meeting_source = made.source()
    return made


def form(meeting_id: str | None, status: str, **more: Any) -> MeetingForm:
    return MeetingForm(
        meeting_id=meeting_id,
        company_key=more.pop("company_key", "201"),
        company_name=more.pop("company_name", "Sample Logistics Pty Ltd"),
        title=more.pop("title", "Fit-out walk-through"),
        starts_at=more.pop("starts_at", melbourne(4, 21, 30)),
        status=status,
        **more,
    )


async def some_forms(world: World) -> None:
    await add(world, form("9001", "draft"), form("9003", "failed"), form("9005", "sent"))


async def page(client: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    response = await client.get(MEETINGS, params=params)
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


# --- Off ------------------------------------------------------------------------------------------


async def test_meetings_answer_409_and_the_record_shows_none_while_off(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    settings.update(meeting_forms_enabled=False)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        answers = [
            await client.get(MEETINGS),
            await client.get(f"{MEETINGS}/summary"),
            await client.get(f"{MEETINGS}/9001"),
        ]
        record = (await client.get(f"{API}/201")).json()
    for response in answers:
        assert (response.status_code, response.json()["code"]) == (409, "meeting_forms_off")
        assert response.json()["detail"] == (
            "Meetings and pre-reads are switched off. An admin can switch them on in Settings."
        )
    assert record["meetings"] == []


# --- The lists ------------------------------------------------------------------------------------


async def test_my_upcoming_meetings_are_grouped_by_the_melbourne_day(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    await some_forms(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        mine = await page(client)
    assert (mine["meetings_state"], mine["sentence"], mine["total"]) == ("ready", None, 5)
    # Grouped by the Melbourne day, whose week ends on Sunday 8 Nov. The cancelled meeting
    # stays. The one with no company, and the one whose company isn't in our copy, don't.
    assert [(item["meeting"]["id"], item["group"]) for item in mine["items"]] == [
        ("9001", "today"),
        ("9006", "tomorrow"),
        ("9003", "this_week"),
        ("9005", "later"),
        ("9008", "later"),
    ]
    first = mine["items"][0]
    assert first["company_name"] == "Sample Logistics Pty Ltd"
    assert first["meeting"]["title"] == "Fit-out walk-through"
    assert first["form"]["status"] == "draft" and first["notes_logged"] is False
    forms = {item["meeting"]["id"]: item["form"] for item in mine["items"]}
    assert (forms["9003"]["status"], forms["9005"]["status"], forms["9006"]) == (
        "failed",
        "sent",
        None,
    )
    assert mine["items"][1]["meeting"]["outcome"] == "canceled"
    assert fake.windows == [("upcoming", "o1", 7)]


async def test_the_teams_meetings_put_mine_first_and_past_ones_say_if_notes_were_logged(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client, source="transcript")
        await set_note(world, note["id"], meeting_id="8001")
        team = await page(client, mine="false")
        past = await page(client, when="past")
        team_past = await page(client, when="past", mine="false")
        second_page = await page(client, mine="false", limit=2, offset=1)
    assert [item["meeting"]["id"] for item in team["items"]] == [
        "9001",
        "9006",
        "9003",
        "9005",
        "9008",
        "9002",  # Sam's, after Mia's own
        "9009",
    ]
    assert [item["group"] for item in team["items"]][-2:] == ["tomorrow", "later"]
    # The last 30 days, newest first. No groups.
    assert [(item["meeting"]["id"], item["group"]) for item in past["items"]] == [
        ("8001", None),
        ("8003", None),
    ]
    assert [item["notes_logged"] for item in past["items"]] == [True, False]
    assert [item["meeting"]["id"] for item in team_past["items"]] == ["8001", "8003", "8002"]
    assert second_page["total"] == 7
    assert [item["meeting"]["id"] for item in second_page["items"]] == ["9006", "9003"]
    assert ("past", None, 30) in fake.windows and ("upcoming", None, 7) in fake.windows


@pytest.mark.parametrize(
    ("q", "found"),
    [
        ("freight", ["9005", "9008", "9002"]),
        ("FREIGHT mon", ["9005"]),
        ("5/11", ["9006", "9002"]),
        ("thu", ["9006", "9002"]),
        ("walk", ["9001"]),
        ("sample log nov", ["9001", "9006", "9003", "9009"]),
        ("logistics 6 november", ["9003"]),
        ("2026-11-10", ["9008"]),
        ("lunch", []),  # the meeting with no company is never found
        ("plumbing", []),
    ],
)
async def test_the_search_finds_meetings_by_company_title_and_date_words(
    world: World, settings: dict[str, Any], fake: FakeMeetings, q: str, found: list[str]
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        result = await page(client, mine="false", q=q)
    assert [item["meeting"]["id"] for item in result["items"]] == found
    assert result["total"] == len(found)


async def test_before_hubspots_meetings_are_read_the_list_says_so(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    fake.state = MeetingsStatus(state="waiting", sentence=NOT_READ_YET)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        waiting = await page(client)
        counts = (await client.get(f"{MEETINGS}/summary")).json()
        record = (await client.get(f"{API}/201")).json()
    assert waiting == {
        "items": [],
        "total": 0,
        "meetings_state": "waiting",
        "sentence": "Meetings from HubSpot aren't read yet.",
    }
    assert counts == {"need_pre_read": 0, "draft_ready": 0}
    assert record["meetings"] == []
    assert fake.windows == []  # nothing was read


async def test_a_rep_not_linked_to_a_hubspot_owner_sees_the_team_and_sign_in_off_sees_all(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    async with signed_in_as(world, "lee", ["companies"]) as client:
        mine = await page(client)
        team = await page(client, mine="false")
        counts = (await client.get(f"{MEETINGS}/summary")).json()
    world.settings(auth_required=False)  # sign-in off, as on the laptop
    settings.update(auth_required=False)
    async with world.browser() as client:
        everyone = await page(client)
    assert (mine["items"], mine["total"], mine["sentence"]) == ([], 0, NOT_LINKED)
    assert team["total"] == 7
    assert counts == {"need_pre_read": 0, "draft_ready": 0}
    assert everyone["total"] == 7 and everyone["sentence"] is None


# --- Counts, one meeting, and a company's record --------------------------------------------------


async def test_the_counts_for_home_are_my_own_upcoming_meetings(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    await some_forms(world)
    await add(world, form("9002", "draft"))  # Sam's
    async with signed_in_as(world, "mia", ["companies"]) as client:
        counts = (await client.get(f"{MEETINGS}/summary")).json()
    # 9003's draft failed and 9008 has none: they need a pre-read. 9001's draft waits. 9005 is
    # sent, and 9006 is cancelled: neither needs one.
    assert counts == {"need_pre_read": 2, "draft_ready": 1}


async def test_one_meeting_comes_with_its_company_and_its_pre_read(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    sources = [
        {"id": "F1", "kind": "hubspot", "label": "HubSpot: company", "url": None, "date": None}
    ]
    await add(
        world,
        form(
            "9001",
            "draft",
            facts=[{"label": "Where", "value": "In person", "source": "HubSpot meeting"}],
            summaries={
                "what_they_do": {"text": "They move freight.", "by": "ai", "sources": sources}
            },
            next_step="Book a site visit",
        ),
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        found = await client.get(f"{MEETINGS}/9001")
        no_company = await client.get(f"{MEETINGS}/9004")
        unknown = await client.get(f"{MEETINGS}/1234")
        not_an_id = await client.get(f"{MEETINGS}/abc")
        no_form = (await client.get(f"{MEETINGS}/9003")).json()
    assert found.status_code == 200, found.text
    body = found.json()
    assert (body["meeting"]["id"], body["company_name"]) == ("9001", "Sample Logistics Pty Ltd")
    pre_read = body["form"]
    assert pre_read["meeting"] == {
        "meeting_id": "9001",
        "company_key": "201",
        "company_name": "Sample Logistics Pty Ltd",
        "title": "Fit-out walk-through",
        "starts_at": "2026-11-04T10:30:00Z",
        "ends_at": None,
        "where": "unknown",
    }
    assert pre_read["status"] == "draft"
    assert pre_read["facts"] == [
        {"label": "Where", "value": "In person", "source": "HubSpot meeting"}
    ]
    assert pre_read["summaries"]["what_they_do"] == {
        "text": "They move freight.",
        "by": "ai",
        "sources": sources,
    }
    assert pre_read["summaries"]["talks_so_far"] == {"text": "", "by": "ai", "sources": []}
    assert (pre_read["next_step"], pre_read["going"], pre_read["sent_to"]) == (
        "Book a site visit",
        None,
        [],
    )
    assert (pre_read["hubspot_copy"], pre_read["sent_by"], pre_read["error"]) == (None, None, None)
    assert Decimal(pre_read["cost_usd"]) == 0
    for missing in (no_company, unknown):
        assert (missing.status_code, missing.json()["code"]) == (404, "meeting_not_found")
    assert not_an_id.status_code == 422
    assert no_form["form"] is None


async def test_a_companys_record_lists_its_next_three_and_last_three_meetings(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    await some_forms(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        logistics = (await client.get(f"{API}/201")).json()["meetings"]
    assert [(item["meeting"]["id"], item["group"]) for item in logistics] == [
        ("9001", "today"),
        ("9006", "tomorrow"),
        ("9003", "this_week"),
        ("8001", None),  # the past ones, newest first, with no group
        ("8003", None),
        ("8004", None),
    ]
    assert logistics[0]["form"]["status"] == "draft"
