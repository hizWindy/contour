"""The mic's hint list (PLAN-V23 T1-1, choice 1), through its route, with made-up meetings and a
fake HubSpot for Today's tasks:

- the company on screen, its people, its open deal's client and its next meeting's people come
  first;
- then my meetings today and tomorrow and my tasks due, as Today last read them, with no HubSpot
  request;
- then the companies I called in the last 30 days and those I own; another rep's companies stay
  out unless I called them;
- then my teammates (not me), the companies with learned names, and the fixed words;
- the list stops at the Settings page's number, each name once, a company said without Pty Ltd;
- a second ask inside 5 minutes reads nothing new;
- a Viewer, someone without the ticks, and nobody signed in are refused.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample, Northwind).
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant_names import FIXED_WORDS, HintCache, spoken
from apps.companies.meeting_store import MeetingSource
from apps.companies.tables import LearnedName
from core.api.deps import settings_dependency
from core.hubspot.meetings import Meeting, MeetingsStatus
from core.hubspot.models import HubSpotCall, HubSpotContact, HubSpotDeal, HubSpotOwner
from tests.companies.helpers import API, add, company
from tests.companies.test_assistant_api import account
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_call_notes_history import a_note
from tests.companies.test_meetings_api import meeting, melbourne
from tests.companies.test_today import TODAY, signed_in, some_tasks
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
NAMES = f"{API}/assistant/names"
# START is 8 pm on Wednesday 4 Nov 2026 in Melbourne. Mia Sample is HubSpot owner o1, Lee o2.
MEETINGS = [
    meeting("9301", "205", "o1", melbourne(4, 21), contact_ids=["c5"]),  # tonight
    meeting("9302", "206", "o1", melbourne(5, 10)),  # tomorrow
    meeting("9303", "207", "o1", melbourne(6, 10)),  # Friday: not today or tomorrow
    meeting("9304", "208", "o1", melbourne(5, 11), outcome="canceled"),
    meeting("9305", "201", "o1", melbourne(9, 10), contact_ids=["c9"]),  # 201's next one
]


@dataclass
class Meetings:
    """Core's meeting reads, made up: the meetings above, read from START."""

    meetings: list[Meeting] = field(default_factory=lambda: list(MEETINGS))

    def source(self) -> MeetingSource:
        return MeetingSource(
            upcoming=self.upcoming,
            past=self.past,
            status=self.status,
            for_company=self.for_company,
        )

    async def upcoming(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        end = START + timedelta(days=days)
        found = [m for m in self.meetings if START <= m.starts_at < end]
        return [m for m in found if owner_id is None or m.owner_id == owner_id]

    async def past(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        start = START - timedelta(days=days)
        found = [m for m in self.meetings if start <= m.starts_at < START]
        return [m for m in found if owner_id is None or m.owner_id == owner_id]

    async def for_company(self, session: AsyncSession, company_id: str) -> list[Meeting]:
        return [m for m in self.meetings if m.company_id == company_id]

    async def status(self, session: AsyncSession) -> MeetingsStatus:
        return MeetingsStatus(state="ready")


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """Call notes and Meetings on. A test changes them with `settings.update(...)`."""
    chosen: dict[str, Any] = {"meeting_forms_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def meetings(world: World) -> Meetings:
    made = Meetings()
    world.app.state.meeting_source = made.source()
    return made


async def a_copy(world: World) -> None:
    """Mine (o1): 201 Sample Logistics (on screen, an open deal, two people) and 204 Sample
    Quiet. Lee's (o2): 202, 203 (I called it), 209 (I called it in HubSpot), 210 (I called it
    40 days ago) and 211 (nobody called it). 205 and 206 have my meetings; 212 has a learned name.
    The team: Mia (me), Lee (an account) and Jo Teammate."""
    await add(
        world,
        company("201", "Sample Logistics Pty Ltd", owner_id="o1", last_activity=START),
        company("202", "Sample Freight Pty Ltd", owner_id="o2"),
        company("203", "Sample Fresh Pty. Ltd.", owner_id="o2"),
        company("204", "Sample Quiet Limited", owner_id="o1"),
        company("205", "Sample Tonight Pty Ltd", owner_id="o2"),
        company("206", "Sample Tomorrow Pty Ltd", owner_id="o2"),
        company("207", "Sample Friday Pty Ltd", owner_id="o2"),
        company("208", "Sample Cancelled Pty Ltd", owner_id="o2"),
        company("209", "Sample Rang Pty Ltd", owner_id="o2"),
        company("210", "Sample Long Ago Pty Ltd", owner_id="o2"),
        company("211", "Sample Faraway Pty Ltd", owner_id="o2"),
        company("212", "Northwind Pty Ltd", owner_id="o2"),
    )
    await add(
        world,
        HubSpotDeal(
            hubspot_deal_id="d1",
            hubspot_company_id="201",
            name="SLX Group - Perth - New Office",
            stage="Qualified Deal",
        ),
        HubSpotDeal(
            hubspot_deal_id="d2",
            hubspot_company_id="201",
            name="Old Name - Perth",
            stage="Closed lost",
        ),
        HubSpotContact(hubspot_id="c1", hubspot_company_id="201", name="Jo Sample"),
        HubSpotContact(
            hubspot_id="c2",
            hubspot_company_id="201",
            name="James Sample",
            last_activity=START - timedelta(days=1),
        ),
        HubSpotContact(hubspot_id="c5", hubspot_company_id="205", name="Tess Tonight"),
        HubSpotContact(hubspot_id="c9", hubspot_company_id=None, name="Ned Next"),
        HubSpotContact(hubspot_id="c8", hubspot_company_id="201", name="Jo  Sample"),
        HubSpotOwner(owner_id="o1", name="Mia Sample"),
        HubSpotOwner(owner_id="o2", name="Lee Sample"),
        HubSpotOwner(owner_id="o3", name="Jo Teammate"),
        HubSpotCall(
            hubspot_id="k1",
            hubspot_company_id="209",
            owner_id="o1",
            called_at=START - timedelta(days=5),
        ),
        HubSpotCall(  # Lee's own call: it doesn't make 211 mine
            hubspot_id="k2",
            hubspot_company_id="211",
            owner_id="o2",
            called_at=START - timedelta(days=1),
        ),
        LearnedName(
            heard="North Wind", heard_key="north wind", company_key="212", company_name="Northwind"
        ),
    )
    await account(world, "lee", owner="o2")


async def names(client: httpx.AsyncClient, **params: Any) -> list[dict[str, Any]]:
    response = await client.get(NAMES, params=params)
    assert response.status_code == 200, response.text
    found: list[dict[str, Any]] = response.json()["names"]
    return found


def texts(found: list[dict[str, Any]]) -> list[str]:
    return [name["text"] for name in found]


async def my_calls(world: World, mia_id: Any) -> None:
    await add(
        world,
        a_note(mia_id, START - timedelta(days=3), "Spoke to Fresh.", company=("203", "Fresh")),
        a_note(mia_id, START - timedelta(days=40), "Old.", company=("210", "Long Ago")),
    )


def test_a_company_is_said_without_pty_ltd() -> None:
    assert spoken("Sample Logistics Pty Ltd") == "Sample Logistics"
    assert spoken("Sample Fresh Pty. Ltd.") == "Sample Fresh"
    assert spoken("Sample Quiet Limited") == "Sample Quiet"
    assert spoken("Sample (Australia) Pty Ltd") == "Sample (Australia)"
    assert spoken("Pty Ltd") == "Pty Ltd"  # nothing else: kept as it is
    assert spoken("Smith & Co") == "Smith & Co"


async def test_the_whole_list_in_its_order(
    world: World, settings: dict[str, Any], meetings: Meetings
) -> None:
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, mia):
        await my_calls(world, mia.id)
        found = await names(client, company_key="201")
    assert found[:5] == [
        {"text": "Sample Logistics", "kind": "company", "company_key": "201"},
        {"text": "James Sample", "kind": "person", "company_key": "201"},  # the latest first
        {"text": "Jo Sample", "kind": "person", "company_key": "201"},  # each name once
        {"text": "SLX Group", "kind": "company", "company_key": "201"},  # the open deal only
        {"text": "Ned Next", "kind": "person", "company_key": "201"},  # on its next meeting
    ]
    assert texts(found)[5:] == [
        "Sample Tonight",  # my meeting tonight, and the person on it
        "Tess Tonight",
        "Sample Tomorrow",  # tomorrow's
        "Sample Fresh",  # I called it 3 days ago (a call note)
        "Sample Rang",  # I called it 5 days ago (in HubSpot)
        "Sample Quiet",  # mine: 201 is mine too, but it is already listed
        "Lee Sample",  # teammates, an account first, never me
        "Jo Teammate",
        "Northwind",  # it has a learned name
        *FIXED_WORDS,
    ]
    kinds = {name["text"]: name["kind"] for name in found}
    assert kinds["Lee Sample"] == kinds["Jo Teammate"] == "teammate"
    assert {kinds[word] for word in FIXED_WORDS} == {"word"}
    left_out = {"Sample Freight", "Sample Friday", "Sample Cancelled", "Sample Long Ago"}
    assert left_out.isdisjoint(texts(found)) and "Sample Faraway" not in texts(found)
    assert "Mia Sample" not in texts(found) and "Old Name" not in texts(found)


async def test_another_rep_s_companies_stay_out_unless_i_called_them(
    world: World, settings: dict[str, Any], meetings: Meetings
) -> None:
    await a_copy(world)
    meetings.meetings = []
    async with signed_in(world, "mia", owner="o1") as (client, mia):
        await my_calls(world, mia.id)
        mine = texts(await names(client))
    async with signed_in(world, "sam", owner=None) as (other, _):
        no_link = texts(await names(other))
    assert mine[:4] == ["Sample Fresh", "Sample Rang", "Sample Logistics", "Sample Quiet"]
    for lees in ("Sample Freight", "Sample Faraway", "Sample Long Ago"):
        assert lees not in mine
    # Someone with no HubSpot link has no companies of their own: the team and the words only.
    assert no_link == ["Lee Sample", "Mia Sample", "Jo Teammate", "Northwind", *FIXED_WORDS]


async def test_the_list_stops_at_the_settings_number(
    world: World, settings: dict[str, Any], meetings: Meetings
) -> None:
    await a_copy(world)
    settings["name_hints_max"] = 5
    async with signed_in(world, "mia", owner="o1") as (client, _):
        found = texts(await names(client, company_key="201"))
    assert found == ["Sample Logistics", "James Sample", "Jo Sample", "SLX Group", "Ned Next"]


async def test_a_second_ask_inside_5_minutes_reads_nothing_new(
    world: World, settings: dict[str, Any], meetings: Meetings
) -> None:
    await a_copy(world)
    hints = HintCache()
    world.app.state.name_hints = hints
    async with signed_in(world, "mia", owner="o1") as (client, _):
        first = await names(client)
        await add(world, company("213", "Sample Brand New Pty Ltd", owner_id="o1"))
        world.clock.advance(minutes=4, seconds=59)
        again = await names(client)
        on_screen = await names(client, company_key="213")  # another page: its own list
        world.clock.advance(seconds=1)
        later = await names(client)
    assert again == first and "Sample Brand New" not in texts(first)
    assert texts(on_screen)[0] == "Sample Brand New"
    assert "Sample Brand New" in texts(later)
    assert len(hints) == 2  # the first list was made again, not kept twice


async def test_today_s_tasks_come_from_today_s_read_with_no_hubspot_request(
    world: World, settings: dict[str, Any], meetings: Meetings
) -> None:
    await a_copy(world)
    meetings.meetings = []
    fake = some_tasks()  # my tasks on 201 and 202 (and one on a company not in our copy)
    world.app.state.hubspot_provider = lambda: fake
    async with signed_in(world, "mia", owner="o1") as (client, _):
        before = texts(await names(client))
        world.clock.advance(minutes=6)
        read = await client.get(TODAY)
        assert read.status_code == 200, read.text
        asked = list(fake.calls)
        after = texts(await names(client))
    assert "Sample Freight" not in before  # Lee's, and Today hasn't read my tasks yet
    assert after[:2] == ["Sample Logistics", "Sample Freight"]  # my tasks' companies, by due
    assert fake.calls == asked  # the hint list asked HubSpot nothing


async def test_a_lead_finder_company_on_screen_needs_its_tick(
    world: World, settings: dict[str, Any], meetings: Meetings
) -> None:
    await a_copy(world)
    meetings.meetings = []
    async with signed_in(world, "mia", owner="o1") as (client, _):
        lead = texts(await names(client, company_key="lead:00000000-0000-0000-0000-000000000000"))
        none = texts(await names(client))
        odd = await client.get(NAMES, params={"company_key": "x" * 65})
    assert lead == none  # Mia has no Lead Finder tick: no company on screen
    assert odd.status_code == 422


async def test_who_may_ask(world: World, settings: dict[str, Any], meetings: Meetings) -> None:
    async with signed_in(world, "vic", owner=None, role="viewer") as (viewer, _):
        refused = await viewer.get(NAMES)
    async with signed_in(world, "cora", owner=None, features=["companies.companies"]) as (
        no_tick,
        _,
    ):
        no_feature = await no_tick.get(NAMES)
    async with signed_in(world, "cal", owner=None, features=["companies.call_logs"]) as (
        call_logs,
        _,
    ):
        allowed = await call_logs.get(NAMES)
    async with world.browser() as nobody:
        signed_out = await nobody.get(NAMES)
    assert (refused.status_code, refused.json()["code"]) == (403, "viewer_read_only")
    assert (no_feature.status_code, no_feature.json()["code"]) == (403, "feature_not_allowed")
    assert allowed.status_code == 200 and texts(allowed.json()["names"]) == list(FIXED_WORDS)
    assert (signed_out.status_code, signed_out.json()["code"]) == (401, "auth_required")
