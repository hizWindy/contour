"""Today, the Assistant's first page (PLAN-V22 T1-3), through its route, with a fake HubSpot for
the tasks and made-up meetings in place of core's reads:

- my open tasks, overdue first, then today's, then the next 7 days'; another rep's task, a done
  one and one after the window never show; two HubSpot requests a read;
- my meetings today and tomorrow, each with its pre-read, my calls to confirm, and my open deals
  that need a nudge (close date passed, or no contact for `today_quiet_days`);
- the 5-minute copy: a repeat inside 5 minutes asks HubSpot nothing, and Sync at most once a
  minute;
- no HubSpot link gives `no_owner`, a refused read `no_access`, no HubSpot `off`, and a failed
  read keeps the last good one; the rest still shows each time;
- the parts follow the ticks and the switches; sign-in, a tick, and a Viewer may read;
- the pre-reads sent to me (PLAN-V23 T2-3): by my HubSpot user or my address, from today on;
- no HubSpot user (PLAN-V23 T3-3): `tasks_state` none, no HubSpot request, and only my calls and
  the pre-reads sent to me.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import uuid
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.meeting_store import MeetingSource
from core.api.deps import settings_dependency
from core.auth.features import Feature
from core.auth.models import User
from core.hubspot.client import HubSpotUnavailable
from core.hubspot.meetings import Meeting, MeetingsStatus
from tests.companies.helpers import API, add, company, deal
from tests.companies.test_assistant_api import COMPANIES, account
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_call_notes_history import a_note
from tests.companies.test_meetings_api import form, meeting, melbourne
from tests.core.auth_world import START, World, make_platform_admin, sign_in
from tests.core.hubspot_fake import SCOPE_FOR, FakeHubSpot

pytestmark = pytest.mark.integration
TODAY = f"{API}/assistant/today"
# START is 8 pm on Wednesday 4 Nov 2026 in Melbourne. Mia Sample is HubSpot owner o1.
MEETINGS = [
    meeting("9201", "201", "o1", melbourne(4, 14), title="Walk-through"),  # earlier today
    meeting("9202", "202", "o1", melbourne(5, 10), title="Lease review"),  # tomorrow
    meeting("9203", "201", "o1", melbourne(5, 15), title="Budget", outcome="canceled"),
    meeting("9204", "201", "o2", melbourne(5, 11), title="Lee's own"),  # another rep's
    meeting("9205", "201", "o1", melbourne(6, 9), title="Friday"),  # after tomorrow
    meeting("9206", "999", "o1", melbourne(5, 12), title="No client"),  # not in our copy
]


def ms(moment: datetime) -> str:
    return str(int(moment.timestamp() * 1000))


@dataclass
class DayMeetings:
    """Core's meeting reads, made up: the meetings above, read from START."""

    meetings: list[Meeting] = field(default_factory=lambda: list(MEETINGS))

    def source(self) -> MeetingSource:
        return MeetingSource(upcoming=self.upcoming, past=self.past, status=self.status)

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

    async def status(self, session: AsyncSession) -> MeetingsStatus:
        return MeetingsStatus(state="ready")


def a_task(fake: FakeHubSpot, task_id: str, due: datetime, **more: Any) -> None:
    companies = more.pop("companies", ("201",))
    values: dict[str, str | None] = {
        "hs_task_subject": f"Task {task_id}",
        "hs_task_status": "NOT_STARTED",
        "hs_task_type": "TODO",
        "hs_timestamp": ms(due),
        "hubspot_owner_id": "o1",
        **more,
    }
    fake.add_task(task_id, companies=companies, **values)


def some_tasks() -> FakeHubSpot:
    fake = FakeHubSpot()
    a_task(fake, "501", melbourne(2, 9), hs_task_subject="Send Sample Logistics the quote")
    a_task(fake, "502", melbourne(4, 9), hs_task_subject="Call Jo Sample back", hs_task_type="CALL")
    a_task(fake, "503", melbourne(8, 9), hs_task_subject="Book the site visit", companies=("202",))
    a_task(fake, "504", melbourne(4, 10), hubspot_owner_id="o2")  # Lee's
    a_task(fake, "505", melbourne(4, 11), hs_task_status="COMPLETED")  # done
    a_task(fake, "506", melbourne(20, 9))  # after the next 7 days
    a_task(fake, "507", melbourne(5, 9), companies=("888",))  # its company isn't in our copy
    return fake


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """Call notes and Meetings on. A test changes them with `settings.update(...)`."""
    chosen: dict[str, Any] = {"meeting_forms_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def hubspot(world: World) -> FakeHubSpot:
    fake = some_tasks()
    world.app.state.hubspot_provider = lambda: fake
    return fake


@pytest.fixture
def meetings(world: World) -> DayMeetings:
    made = DayMeetings()
    world.app.state.meeting_source = made.source()
    return made


async def a_day(world: World, mia: User) -> None:
    """Our copy: four companies, my deals and others', a pre-read, and call notes."""
    await add(
        world,
        company("201", "Sample Logistics Pty Ltd", last_contacted=date(2026, 11, 3)),
        company("202", "Sample Freight Pty Ltd", last_contacted=date(2026, 10, 1)),
        company("203", "Sample Fresh Pty Ltd", last_contacted=date(2026, 11, 1)),
        company("204", "Sample Quiet Pty Ltd"),
    )
    await add(
        world,
        deal("701", "201", "Qualified Deal", owner_id="o1", close_date=date(2026, 11, 2)),
        deal("702", "202", "Qualified Deal", owner_id="o1", close_date=date(2026, 12, 20)),
        deal("703", "203", "Qualified Deal", owner_id="o1", close_date=date(2027, 1, 31)),
        deal("704", "201", "Closed lost", owner_id="o1", close_date=date(2026, 10, 2)),
        deal("705", "202", "Qualified Deal", owner_id="o2", close_date=date(2026, 10, 2)),
        deal("706", "204", "Lead", owner_id="o1"),
        form(
            "9202",
            "draft",
            company_key="202",
            company_name="Sample Freight Pty Ltd",
            title="Lease review",
            starts_at=melbourne(5, 10),
        ),
        form(
            None,
            "draft",
            made_by=mia.id,
            company_key="202",
            company_name="Sample Freight Pty Ltd",
            title="Typed visit",
            starts_at=melbourne(5, 16),
        ),
        a_note(mia.id, START - timedelta(hours=1), "Rang them", status="to_confirm"),
        a_note(mia.id, START - timedelta(hours=2), "Left a message", status="to_confirm"),
        a_note(mia.id, START - timedelta(hours=3), "It failed", status="failed"),
        a_note(None, START - timedelta(hours=1), "Someone else's", status="to_confirm"),
    )


@asynccontextmanager
async def signed_in(
    world: World,
    login: str,
    *,
    owner: str | None,
    role: str = "staff",
    features: Sequence[Feature] = COMPANIES,
) -> AsyncIterator[tuple[httpx.AsyncClient, User]]:
    user = await account(world, login, role=role, features=features, owner=owner)
    async with world.browser() as client:
        assert (await sign_in(client, login=login)).status_code == 200
        yield client, user


async def today(client: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    response = await client.get(TODAY, params=params)
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


# --- The day -------------------------------------------------------------------------------------


async def test_today_shows_my_tasks_overdue_first_then_meetings_calls_and_deals(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, mia):
        await a_day(world, mia)
        found = await today(client)
    assert found["parts"] == ["tasks", "meetings", "pre_reads", "calls", "deals"]
    assert (found["tasks_state"], found["tasks_sentence"], found["tasks_more"]) == ("ok", None, 0)
    tasks = found["tasks"]
    assert [(task["id"], task["group"], task["overdue"]) for task in tasks] == [
        ("501", "overdue", True),
        ("502", "today", False),
        ("507", "soon", False),
        ("503", "soon", False),
    ]  # Lee's task, the done one and the one after the next 7 days never show
    assert tasks[1] == {
        "id": "502",
        "subject": "Call Jo Sample back",
        "kind": "call",
        "priority": None,
        "due": "2026-11-04",
        "due_at": "2026-11-03T22:00:00Z",
        "overdue": False,
        "group": "today",
        "company": {"key": "201", "name": "Sample Logistics Pty Ltd"},
        "hubspot_url": "https://app.hubspot.com/contacts/1234567/record/0-2/502",
    }
    assert tasks[2]["company"] is None  # its company isn't in our copy
    assert hubspot.calls == ["search_tasks", "linked_tasks_companies"]  # two requests

    assert [(m["id"], m["title"], m["day"]) for m in found["meetings"]] == [
        ("9201", "Walk-through", "today"),
        ("9202", "Lease review", "tomorrow"),
        (None, "Typed visit", "tomorrow"),
    ]  # the cancelled one, Lee's, Friday's and the one with no client company never show
    walk, lease, typed = found["meetings"]
    assert walk["form"] is None and walk["company"] == {
        "key": "201",
        "name": "Sample Logistics Pty Ltd",
    }
    assert lease["form"]["status"] == typed["form"]["status"] == "draft"

    assert found["calls"] == {"to_confirm": 2, "needs_look": 1}  # my own notes only
    assert [(d["id"], d["why"], d["reasons"]) for d in found["deals"]] == [
        ("701", "Close date passed, 2 Nov", ["close_date_passed"]),
        ("706", "No contact on record", ["quiet"]),
        ("702", "No contact for 34 days", ["quiet"]),
    ]  # 703 was talked to 3 days ago; 704 is lost; 705 is Lee's
    first = found["deals"][0]
    assert first["company"] == {"key": "201", "name": "Sample Logistics Pty Ltd"}
    assert (first["stage"], first["close_date"], first["last_contact"]) == (
        "Qualified Deal",
        "2026-11-02",
        "2026-11-03",
    )
    assert (found["deals_more"], found["quiet_days"]) == (0, 14)
    assert found["checked_at"] == "2026-11-04T09:00:00Z"


async def test_the_quiet_days_setting_moves_the_cut(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    settings["today_quiet_days"] = 40
    async with signed_in(world, "mia", owner="o1") as (client, mia):
        await a_day(world, mia)
        found = await today(client)
    assert [deal["id"] for deal in found["deals"]] == ["701", "706"]  # 34 days is no longer quiet
    assert found["quiet_days"] == 40


# --- The 5-minute copy -------------------------------------------------------------------------


async def test_a_repeat_inside_5_minutes_asks_hubspot_nothing_and_sync_once_a_minute(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    read = ["search_tasks", "linked_tasks_companies"]
    async with signed_in(world, "mia", owner="o1") as (client, _):
        await today(client)
        assert hubspot.calls == read
        world.clock.advance(minutes=4, seconds=59)
        a_task(hubspot, "508", melbourne(4, 12))  # new in HubSpot: the copy doesn't know yet
        assert "508" not in [task["id"] for task in (await today(client))["tasks"]]
        assert hubspot.calls == read  # no HubSpot request inside 5 minutes

        world.clock.advance(seconds=1)  # 5 minutes: read again
        assert "508" in [task["id"] for task in (await today(client))["tasks"]]
        assert hubspot.calls == read * 2

        world.clock.advance(seconds=59)  # Sync inside a minute of the last read: the copy
        synced = await today(client, fresh="true")
        assert hubspot.calls == read * 2
        assert synced["checked_at"] == "2026-11-04T09:05:00Z"

        world.clock.advance(seconds=1)  # Sync a minute after it: read again
        synced = await today(client, fresh="true")
        assert hubspot.calls == read * 3
        assert synced["checked_at"] == "2026-11-04T09:06:00Z"


# --- When the tasks can't show, the rest still does ----------------------------------------


async def test_no_hubspot_link_gives_no_owner_and_the_rest_still_shows(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    await make_platform_admin(world)
    async with signed_in(world, "kim", owner=None) as (client, kim):
        await a_day(world, kim)
        found = await today(client)
    assert found["tasks_state"] == "no_owner"
    assert found["tasks_sentence"] == (
        "Today needs your account linked to HubSpot. Ask Al Khair to link it."
    )
    assert found["tasks"] == [] and hubspot.calls == []  # HubSpot isn't asked
    assert found["calls"] == {"to_confirm": 2, "needs_look": 1}  # still shows
    assert [m["title"] for m in found["meetings"]] == ["Typed visit"]  # only my own typed one
    assert found["deals"] == []  # whose deals are mine can't be told without the link


async def test_a_refused_read_gives_no_access_and_the_rest_still_shows(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    hubspot.scopes.discard(SCOPE_FOR["tasks"])
    async with signed_in(world, "mia", owner="o1") as (client, mia):
        await a_day(world, mia)
        found = await today(client)
    assert (found["tasks_state"], found["tasks"]) == ("no_access", [])
    assert found["tasks_sentence"] == (
        "We can't read your HubSpot tasks yet. Your meetings and calls still show."
    )
    assert len(found["meetings"]) == 3 and len(found["deals"]) == 3
    assert found["calls"] == {"to_confirm": 2, "needs_look": 1}


async def test_no_hubspot_gives_off(
    world: World, settings: dict[str, Any], meetings: DayMeetings
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, mia):
        await a_day(world, mia)
        found = await today(client)
    assert (found["tasks_state"], found["tasks"]) == ("off", [])
    assert found["tasks_sentence"] == (
        "HubSpot isn't connected yet, so your tasks can't show. Your meetings and calls still show."
    )
    assert len(found["deals"]) == 3


async def test_a_failed_read_keeps_the_last_good_one_and_says_from_when(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    down = HubSpotUnavailable("HubSpot didn't answer", "It timed out. Try again.")
    async with signed_in(world, "mia", owner="o1") as (client, _):
        assert len((await today(client))["tasks"]) == 4
        world.clock.advance(minutes=6)
        hubspot.fail["search_tasks"] = [down]
        found = await today(client)
    assert (found["tasks_state"], len(found["tasks"])) == ("ok", 4)
    assert found["tasks_sentence"] == (
        "HubSpot didn't answer, so these tasks are from 8:00 pm. Try again in a minute."
    )
    assert found["checked_at"] == "2026-11-04T09:00:00Z"


async def test_a_failed_first_read_gives_failed(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    hubspot.fail["search_tasks"] = [HubSpotUnavailable("HubSpot didn't answer", "Try again.")]
    async with signed_in(world, "mia", owner="o1") as (client, _):
        found = await today(client)
        assert (found["tasks_state"], found["tasks"]) == ("failed", [])
        assert found["tasks_sentence"] == (
            "We can't read your HubSpot tasks yet. Your meetings and calls still show."
        )
        world.clock.advance(seconds=30)  # Try again inside a minute: HubSpot isn't asked
        assert (await today(client, fresh="true"))["tasks_state"] == "failed"
        assert hubspot.calls == ["search_tasks"]
        world.clock.advance(seconds=30)
        assert (await today(client, fresh="true"))["tasks_state"] == "ok"


# --- Who sees what -------------------------------------------------------------------------------


async def test_the_parts_follow_the_ticks_and_the_switches(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    async with signed_in(world, "mia", owner="o1", features=["companies.call_logs"]) as (
        client,
        mia,
    ):
        await a_day(world, mia)
        calls_only = await today(client)
    assert calls_only["parts"] == ["tasks", "calls", "deals"]
    assert calls_only["meetings"] == [] and calls_only["calls"]["to_confirm"] == 2
    assert calls_only["pre_reads"] == []  # a pre-read opens only with the Meetings tick

    async with signed_in(world, "lee", owner="o2", features=["companies.meetings"]) as (client, _):
        meetings_only = await today(client)
        settings["meeting_forms_enabled"] = False
        forms_off = await today(client)
    assert meetings_only["parts"] == ["tasks", "meetings", "pre_reads", "deals"]
    assert meetings_only["calls"] == {"to_confirm": 0, "needs_look": 0}
    assert [m["id"] for m in meetings_only["meetings"]] == ["9204"]  # Lee's own
    assert [task["id"] for task in meetings_only["tasks"]] == ["504"]
    assert forms_off["parts"] == ["tasks", "deals"] and forms_off["meetings"] == []
    assert forms_off["pre_reads"] == []


async def test_today_needs_sign_in_and_a_tick_and_a_viewer_may_read(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    async with world.browser() as nobody:
        refused = await nobody.get(TODAY)
    assert (refused.status_code, refused.json()["code"]) == (401, "auth_required")

    async with signed_in(world, "sam", owner="o3", features=["companies.companies"]) as (
        client,
        _,
    ):
        no_tick = await client.get(TODAY)
    assert (no_tick.status_code, no_tick.json()["code"]) == (403, "feature_not_allowed")

    async with signed_in(world, "vic", owner="o1", role="viewer") as (client, _):
        assert (await today(client))["tasks_state"] == "ok"


# --- Pre-reads sent to me (PLAN-V23 T2-3) --------------------------------------------------------


def sent_to(**person: Any) -> dict[str, Any]:
    """One person a pre-read went to, as `sent_to` keeps them."""
    return {
        "owner_id": None,
        "name": None,
        "address": None,
        "task": "none",
        "email": False,
    } | person


async def test_pre_reads_sent_to_me_by_hubspot_user_or_my_address_show_from_today_on(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    lee = await account(world, "lee", owner="o2")
    lease_review = uuid.uuid4()
    async with signed_in(world, "mia", owner="o1") as (client, _):
        await add(
            world,
            form(
                "9301",
                "sent",
                id=lease_review,
                title="Lease review",
                company_key="202",
                company_name="Sample Freight Pty Ltd",
                starts_at=melbourne(5, 10),
                sent_by=lee.id,
                sent_to=[sent_to(owner_id="o1", name="Mia Sample", task="sent")],
            ),
            form(  # earlier today, to my address only
                "9302",
                "sent",
                title="Walk-through",
                starts_at=melbourne(4, 14),
                sent_by=lee.id,
                sent_to=[sent_to(address="mia@example.test", email=True)],
            ),
            form(  # a meeting gone by
                "9303",
                "sent",
                title="Last week's",
                starts_at=melbourne(2, 10),
                sent_by=lee.id,
                sent_to=[sent_to(owner_id="o1")],
            ),
            form(  # Lee's own
                "9304",
                "sent",
                title="Lee's own",
                starts_at=melbourne(6, 9),
                sent_by=lee.id,
                sent_to=[sent_to(owner_id="o2", address="lee@example.test", email=True)],
            ),
            form("9305", "draft", title="Not sent yet", starts_at=melbourne(6, 9)),
            form(  # an older row keeps the address under "email"; nobody signed in sent it
                None,
                "sent",
                title="Typed visit",
                starts_at=melbourne(9, 9),
                sent_to=[{"email": "mia@example.test"}],
            ),
        )
        found = await today(client)
    assert found["parts"] == ["tasks", "meetings", "pre_reads", "calls", "deals"]
    assert [(item["title"], item["sent_by"]) for item in found["pre_reads"]] == [
        ("Walk-through", "Lee Sample"),
        ("Lease review", "Lee Sample"),
        ("Typed visit", None),
    ]  # soonest first; the one gone by, Lee's own and the draft never show
    assert found["pre_reads"][1] == {
        "form_id": str(lease_review),
        "title": "Lease review",
        "starts_at": "2026-11-04T23:00:00Z",
        "company": {"key": "202", "name": "Sample Freight Pty Ltd"},
        "sent_by": "Lee Sample",
    }


# --- No HubSpot user (PLAN-V23 T3-3) -----------------------------------------------------------


async def test_today_with_no_hubspot_user_asks_hubspot_nothing_and_shows_calls_and_pre_reads(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot, meetings: DayMeetings
) -> None:
    async with signed_in(world, "josie", owner=None) as (client, jo):
        async with world.factory() as db:
            await db.execute(update(User).where(User.id == jo.id).values(no_hubspot_user=True))
            await db.commit()
        await a_day(world, jo)
        await add(
            world,
            form(  # sent to Josie's own address: no HubSpot user to find it by
                "9401",
                "sent",
                title="Site visit",
                starts_at=melbourne(5, 9),
                sent_to=[sent_to(address="josie@example.test", email=True)],
            ),
        )
        found = await today(client)
    assert found["parts"] == ["pre_reads", "calls"]
    assert (found["tasks_state"], found["tasks_sentence"], found["tasks"]) == ("none", None, [])
    assert hubspot.calls == []  # HubSpot isn't asked at all
    assert (found["meetings"], found["deals"]) == ([], [])  # those go by HubSpot user
    assert found["calls"] == {"to_confirm": 2, "needs_look": 1}
    assert [item["title"] for item in found["pre_reads"]] == ["Site visit"]
