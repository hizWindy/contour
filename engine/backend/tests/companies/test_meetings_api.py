"""The Meetings reads (PLAN-V17 T2-11), with made-up meetings in place of core's reads:

- off: every Meetings route answers 409, and the company's record shows no meetings;
- All (the default), My meetings and My team (PLAN-V18 T1-4), always in time order, each item
  saying whether it is mine; my upcoming meetings, grouped by the Melbourne day; the past ones,
  with "notes logged"; a meeting with no company, or a company not in our copy, is left out; a
  cancelled one stays;
- My team: one team, two teams, no team, HubSpot with no teams, and our copy's own teams;
- the search: company, title and date words, in any case;
- HubSpot's meetings not read yet: an empty list that says so, and zero counts;
- a rep whose account isn't linked to a HubSpot owner; sign-in off;
- the counts for Home; one meeting with its pre-read; a company's next three and last three;
- Sync (PLAN-V18 T1-5): started, running and fresh, no HubSpot, and what the list says about the
  last read: when it was, whether one runs, and a failed or waiting one in plain words.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import asyncio
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.meeting_store import (
    NO_ACCOUNT,
    NO_TEAM,
    NO_TEAMS_IN_HUBSPOT,
    NOT_LINKED,
    NOT_LINKED_TEAM,
    SYNC_FAILED_FIRST,
    SYNC_WAITING,
    MeetingSource,
    clock_words,
)
from apps.companies.tables import MeetingForm
from core.api.deps import settings_dependency
from core.auth.models import User
from core.hubspot import meetings as core_meetings
from core.hubspot.meetings import NOT_READ_YET, Meeting, MeetingsRefresher, MeetingsStatus
from core.hubspot.models import HubSpotOwnerTeam
from core.hubspot.owners import TeamsOf
from tests.companies.helpers import API, add, signed_in_as
from tests.companies.test_call_notes_api import a_company, log_call, notes_settings, set_note
from tests.core.auth_world import START, World
from tests.core.test_hubspot_meetings_sync import Held

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


def sample_teams() -> dict[str, set[str]]:
    """HubSpot's teams, made up: Mia (o1) and Sam (o2) are in Sample Sales, o4 and o5 in Sample
    BD. Kim (o6) is linked, and in no team. Lee isn't linked to an owner."""
    return {"Sample Sales": {"o1", "o2"}, "Sample BD": {"o4", "o5"}}


@dataclass
class FakeMeetings:
    """Core's meeting reads, made up: the meetings above, read from START."""

    state: MeetingsStatus = field(default_factory=lambda: MeetingsStatus(state="ready"))
    owners: dict[str, str] = field(default_factory=lambda: {"mia": "o1", "sam": "o2", "kim": "o6"})
    windows: list[tuple[str, str | None, int]] = field(default_factory=list)
    coming: list[Meeting] = field(default_factory=lambda: list(UPCOMING))
    teams: dict[str, set[str]] = field(default_factory=sample_teams)
    real_teams: bool = False  # True: our copy's own teams (core.hubspot_owner_teams)

    def source(self) -> MeetingSource:
        made = MeetingSource(
            upcoming=self.upcoming,
            past=self.past,
            for_company=self.for_company,
            get=self.get,
            status=self.status,
            owner_of=self.owner_of,
            teams_of=self.teams_of,
        )
        if self.real_teams:
            made = MeetingSource(**{**vars(made), "teams_of": MeetingSource().teams_of})
        return made

    async def upcoming(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        self.windows.append(("upcoming", owner_id, days))
        end = START + timedelta(days=days)
        found = [m for m in self.coming if START <= m.starts_at < end]
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
        return [m for m in [*self.coming, *PAST] if m.company_id == company_id]

    async def get(self, session: AsyncSession, meeting_id: str) -> Meeting | None:
        return next((m for m in [*self.coming, *PAST] if m.id == meeting_id), None)

    async def status(self, session: AsyncSession) -> MeetingsStatus:
        return self.state

    async def owner_of(self, session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
        person = await session.get(User, user_id) if user_id is not None else None
        login = person.email.split("@")[0] if person is not None else ""
        return self.owners.get(login)

    async def teams_of(self, session: AsyncSession, owner_id: str | None) -> TeamsOf:
        if not self.teams:
            return TeamsOf(any_team=False)
        names = sorted(name for name, people in self.teams.items() if owner_id in people)
        members = frozenset(person for name in names for person in self.teams[name])
        return TeamsOf(True, tuple(names), members)


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
        mine = await page(client, who="mine")
    assert (mine["meetings_state"], mine["sentence"], mine["total"]) == ("ready", None, 5)
    assert (mine["who"], mine["linked"], mine["team_state"], mine["team_names"]) == (
        "mine",
        True,
        "ready",
        ["Sample Sales"],
    )
    assert all(item["mine"] for item in mine["items"])
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
    assert fake.windows == [("upcoming", None, 7)]  # the window is read, then mine picked out


async def test_all_is_the_default_in_time_order_and_past_ones_say_if_notes_were_logged(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client, source="transcript")
        await set_note(world, note["id"], meeting_id="8001")
        everyone = await page(client)
        past = await page(client, when="past", who="mine")
        everyone_past = await page(client, when="past", who="all")
        second_page = await page(client, limit=2, offset=1)
        old_link = await page(client, mine="false")  # the old switch is gone: All
    # Everyone's, soonest first: no "mine first". Mia's own say so.
    assert [(item["meeting"]["id"], item["mine"]) for item in everyone["items"]] == [
        ("9001", True),
        ("9002", False),  # Sam's
        ("9006", True),
        ("9003", True),
        ("9005", True),
        ("9008", True),
        ("9009", False),  # Sam's
    ]
    assert (everyone["who"], everyone["sentence"], everyone["total"]) == ("all", None, 7)
    assert [item["group"] for item in everyone["items"]][:3] == ["today", "tomorrow", "tomorrow"]
    # Whose each one is, as our copy of HubSpot's owners names them: o1 is Lee Sample there,
    # and o2 isn't in it.
    owners = {item["meeting"]["id"]: item["owner_name"] for item in everyone["items"]}
    assert (owners["9001"], owners["9002"]) == ("Lee Sample", None)
    # The last 30 days, newest first. No groups.
    assert [(item["meeting"]["id"], item["group"]) for item in past["items"]] == [
        ("8001", None),
        ("8003", None),
    ]
    assert [item["notes_logged"] for item in past["items"]] == [True, False]
    assert [item["meeting"]["id"] for item in everyone_past["items"]] == ["8002", "8001", "8003"]
    assert second_page["total"] == 7
    assert [item["meeting"]["id"] for item in second_page["items"]] == ["9002", "9006"]
    assert old_link["who"] == "all" and old_link["total"] == 7
    assert ("past", None, 30) in fake.windows and ("upcoming", None, 7) in fake.windows


@pytest.mark.parametrize(
    ("q", "found"),
    [
        ("freight", ["9002", "9005", "9008"]),
        ("FREIGHT mon", ["9005"]),
        ("5/11", ["9002", "9006"]),
        ("thu", ["9002", "9006"]),
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
        result = await page(client, q=q)
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
        "sentence": "Meetings can't be read from HubSpot yet. You can still start a new pre-read.",
        "who": "all",
        "linked": True,
        "team_state": "ready",
        "team_names": ["Sample Sales"],
        "checked_at": None,
        "syncing": False,
        "sync_problem": None,
    }
    assert counts == {"need_pre_read": 0, "draft_ready": 0}
    assert record["meetings"] == []
    assert fake.windows == []  # nothing was read


async def test_a_rep_not_linked_to_a_hubspot_owner_sees_all_and_hears_why_the_rest_are_empty(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    async with signed_in_as(world, "lee", ["companies"]) as client:
        everyone = await page(client)
        mine = await page(client, who="mine")
        team = await page(client, who="team")
        counts = (await client.get(f"{MEETINGS}/summary")).json()
    # The "not linked" sentence shows on My meetings and My team only, never on All.
    assert (everyone["total"], everyone["sentence"], everyone["linked"]) == (7, None, False)
    assert not any(item["mine"] for item in everyone["items"])
    assert (mine["items"], mine["total"], mine["sentence"]) == ([], 0, NOT_LINKED)
    assert (team["items"], team["total"], team["sentence"]) == ([], 0, NOT_LINKED_TEAM)
    assert (team["team_state"], team["team_names"]) == ("not_linked", [])
    assert counts == {"need_pre_read": 0, "draft_ready": 0}


async def test_with_sign_in_off_all_works_and_nobody_is_linked(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    world.settings(auth_required=False)  # sign-in off, as on the laptop
    settings.update(auth_required=False)
    async with world.browser() as client:
        everyone = await page(client)
        mine = await page(client, who="mine")
        team = await page(client, who="team")
    assert (everyone["total"], everyone["sentence"]) == (7, None)
    assert (everyone["linked"], everyone["team_state"], everyone["team_names"]) == (
        False,
        "not_linked",
        [],
    )
    assert not any(item["mine"] for item in everyone["items"])
    for empty in (mine, team):
        assert (empty["items"], empty["total"], empty["sentence"]) == ([], 0, NO_ACCOUNT)


# --- My team (PLAN-V18 T1-4) ----------------------------------------------------------------------

# Three more upcoming meetings: one owned in Sample BD with Sam on it, one owned in Sample BD
# only, and one owned by someone in no team with Mia on it.
MORE = [
    meeting(
        "9010", "202", "o4", melbourne(6, 14), title="Lease options", attendee_owner_ids=["o2"]
    ),
    meeting("9011", "201", "o5", melbourne(7, 11), title="Office tour"),
    meeting("9012", "202", "o7", melbourne(8, 9), title="Kick-off", attendee_owner_ids=["o1"]),
]


def ids(found: dict[str, Any]) -> list[str]:
    return [item["meeting"]["id"] for item in found["items"]]


async def test_my_team_is_the_meetings_my_teams_people_own_or_are_on(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    fake.coming += MORE
    async with signed_in_as(world, "mia", ["companies"]) as client:
        everyone = await page(client)
        mine = await page(client, who="mine")
        team = await page(client, who="team")
    assert ids(everyone) == [
        "9001",
        "9002",
        "9006",
        "9003",
        "9010",
        "9011",
        "9012",
        "9005",
        "9008",
        "9009",
    ]
    # Mine: the ones Mia owns, and the one she is on (9012).
    assert ids(mine) == ["9001", "9006", "9003", "9012", "9005", "9008"]
    # Sample Sales is Mia and Sam: theirs, the one Sam is on (9010) and the one Mia is on (9012).
    # Not 9011: nobody of Sample Sales owns it or is on it.
    assert ids(team) == ["9001", "9002", "9006", "9003", "9010", "9012", "9005", "9008", "9009"]
    assert (team["who"], team["sentence"], team["team_state"], team["team_names"]) == (
        "team",
        None,
        "ready",
        ["Sample Sales"],
    )
    by_id = {item["meeting"]["id"]: item["mine"] for item in team["items"]}
    assert (by_id["9010"], by_id["9012"]) == (False, True)


async def test_in_two_teams_my_team_joins_both(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    fake.coming += MORE
    fake.teams["Sample BD"].add("o2")  # Sam is in both
    async with signed_in_as(world, "sam", ["companies"]) as client:
        team = await page(client, who="team")
    assert team["team_names"] == ["Sample BD", "Sample Sales"]
    assert "9011" in ids(team) and team["total"] == 10


async def test_in_no_team_or_with_no_teams_in_hubspot_my_team_says_why_it_is_empty(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    async with signed_in_as(world, "kim", ["companies"]) as client:
        no_team = await page(client, who="team")
        everyone = await page(client)
        fake.teams = {}  # HubSpot has no teams at all
        none_at_all = await page(client, who="team")
        all_again = await page(client)
    assert (no_team["items"], no_team["sentence"], no_team["team_state"]) == (
        [],
        NO_TEAM,
        "no_team",
    )
    assert (no_team["linked"], no_team["team_names"]) == (True, [])
    assert (everyone["total"], everyone["sentence"], everyone["team_state"]) == (7, None, "no_team")
    assert (none_at_all["items"], none_at_all["sentence"]) == ([], NO_TEAMS_IN_HUBSPOT)
    assert all_again["team_state"] == "none_in_hubspot"  # the website hides My team
    assert all_again["total"] == 7


async def test_my_team_reads_our_copys_teams(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    """The real `teams_of` behind the page: the teams the sync saved."""
    await a_company(world)
    fake.coming += MORE
    fake.real_teams = True
    world.app.state.meeting_source = fake.source()
    await add(
        world,
        HubSpotOwnerTeam(owner_id="o1", team_id="7001", team_name="Sample Sales", is_primary=True),
        HubSpotOwnerTeam(owner_id="o4", team_id="7001", team_name="Sample Sales"),
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        team = await page(client, who="team")
    assert team["team_names"] == ["Sample Sales"]
    # Mia's own, and 9010 and 9011's owners: o4 is in Mia's team now, o5 isn't.
    assert ids(team) == ["9001", "9006", "9003", "9010", "9012", "9005", "9008"]


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


# --- The joins at the PLAN-V17 merge (M5) ---------------------------------------------------------


@dataclass
class Refresher:
    """Core's meetings refresher, made up: it counts the asks."""

    asked: int = 0

    def soon(self) -> bool:
        self.asked += 1
        return True


async def test_meetings_and_home_ask_hubspot_for_changed_meetings(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    """Opening Meetings or Home starts a refresh in the background (core keeps it to one read
    every 15 minutes) and answers at once."""
    refresher = Refresher()
    world.app.state.hubspot_provider = object  # HubSpot is set up
    world.app.state.meetings_refresher = refresher
    async with signed_in_as(world, "mia", ["companies"]) as client:
        assert (await client.get(MEETINGS)).status_code == 200
        assert (await client.get(f"{MEETINGS}/summary")).status_code == 200
    assert refresher.asked == 2


# --- Sync (PLAN-V18 T1-5) -------------------------------------------------------------------------

SYNC = f"{MEETINGS}/sync"


@pytest.fixture
def no_read_left_over() -> Iterator[None]:
    """A test that fails half way never leaves a read "running" for the next one."""
    yield
    core_meetings._running.clear()


class SyncClock:
    """The refresher's clock, which a test moves by hand."""

    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


async def test_sync_answers_at_once_started_running_then_fresh(
    world: World, settings: dict[str, Any], fake: FakeMeetings, no_read_left_over: None
) -> None:
    hubspot = Held()
    clock = SyncClock()
    refresher = MeetingsRefresher(sessions=world.factory, hubspot=lambda: hubspot, clock=clock)
    world.app.state.hubspot_provider = lambda: hubspot
    world.app.state.meetings_refresher = refresher
    async with signed_in_as(world, "mia", ["companies"]) as client:
        started = await client.post(SYNC)
        await asyncio.wait_for(hubspot.searching.wait(), timeout=10)
        again = await client.post(SYNC)
        hubspot.go.set()
        await refresher.wait()
        clock.now = START + timedelta(seconds=30)
        fresh = await client.post(SYNC)
    assert (started.status_code, started.json()) == (202, {"state": "started", "checked_at": None})
    assert (again.status_code, again.json()["state"]) == (202, "running")
    assert (fresh.status_code, fresh.json()) == (
        202,
        {"state": "fresh", "checked_at": "2026-11-04T09:00:00Z"},
    )
    assert hubspot.calls.count("search_meetings") == 1  # fresh asked HubSpot nothing


async def test_sync_without_hubspot_is_a_plain_503_and_off_is_a_409(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    async with signed_in_as(world, "mia", ["companies"]) as client:
        no_hubspot = await client.post(SYNC)
        settings.update(meeting_forms_enabled=False)
        off = await client.post(SYNC)
    assert (no_hubspot.status_code, no_hubspot.json()["code"]) == (503, "hubspot_not_connected")
    assert no_hubspot.headers["retry-after"]
    assert no_hubspot.json()["title"] == "HubSpot isn't connected"
    assert no_hubspot.json()["detail"] == (
        "HubSpot isn't connected, so meetings can't be read from it. An admin can connect it on "
        "the HubSpot page in Admin."
    )
    assert (off.status_code, off.json()["code"]) == (409, "meeting_forms_off")


async def test_the_list_says_when_hubspot_was_last_read_and_what_went_wrong(
    world: World, settings: dict[str, Any], fake: FakeMeetings
) -> None:
    await a_company(world)
    checked = START - timedelta(hours=2)  # 6 pm in Melbourne, the same day
    async with signed_in_as(world, "mia", ["companies"]) as client:
        fake.state = MeetingsStatus(state="ready", checked_at=checked, syncing=True)
        running = await page(client)
        fake.state = MeetingsStatus(state="ready", checked_at=checked, last_read="failed")
        failed = await page(client)
        fake.state = MeetingsStatus(state="waiting", sentence=NOT_READ_YET, last_read="failed")
        failed_first = await page(client)
        fake.state = MeetingsStatus(state="ready", checked_at=checked, last_read="waiting")
        waiting = await page(client)
    assert (running["checked_at"], running["syncing"], running["sync_problem"]) == (
        "2026-11-04T07:00:00Z",
        True,
        None,
    )
    assert running["total"] == 7  # the list as the last good read left it
    assert failed["sync_problem"] == (
        "HubSpot didn't answer, so this list is from 6:00 pm. Try Sync again in a minute."
    )
    assert failed["total"] == 7 and failed["sentence"] is None
    assert failed_first["sync_problem"] == SYNC_FAILED_FIRST
    assert waiting["sync_problem"] == SYNC_WAITING


def test_the_time_of_the_last_read_is_said_the_way_a_person_says_it() -> None:
    now = datetime(2026, 11, 16, 3, 0, tzinfo=UTC)  # 2 pm on Monday 16 Nov in Melbourne
    assert clock_words(datetime(2026, 11, 15, 22, 2, tzinfo=UTC), now) == "9:02 am"
    assert clock_words(datetime(2026, 11, 16, 1, 0, tzinfo=UTC), now) == "12:00 pm"
    assert clock_words(datetime(2026, 11, 15, 13, 5, tzinfo=UTC), now) == "12:05 am"
    assert clock_words(datetime(2026, 11, 15, 2, 14, tzinfo=UTC), now) == "1:14 pm yesterday"
    assert clock_words(datetime(2026, 11, 13, 22, 0, tzinfo=UTC), now) == "9:00 am on 14 Nov"
