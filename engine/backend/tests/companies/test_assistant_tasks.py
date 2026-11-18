"""A task on its own, and Done and reopen (PLAN-V22 T1-4), through their routes, with core's real
writers and a fake HubSpot:

- a task for me and one for a teammate, each one HubSpot task linked to the company, and Today
  shows it at once;
- a repeated Idempotency-Key adds one task; the preview sends nothing and works while writing is
  off; writing off gives 409 with its words, and nothing is sent;
- Done, then reopen (the status before Done comes back), each a row in the write log, and Today
  follows at once;
- another person's task gives 403 and changes nothing; so does an account with no HubSpot link;
- the checks before a task (a Lead Finder company, words, the day, the teammate), a Viewer and
  nobody signed in.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

from collections.abc import Iterator
from datetime import datetime
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from apps.companies.assistant import CommandLimit
from core.api.deps import settings_dependency
from core.hubspot.models import HubSpotOwner, HubSpotWrite
from tests.companies.helpers import API, add, company
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_meetings_api import melbourne
from tests.companies.test_today import DayMeetings, signed_in
from tests.core.auth_world import World, all_rows, make_platform_admin
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration
TASKS = f"{API}/assistant/tasks"
TODAY = f"{API}/assistant/today"
# START is 8 pm on Wednesday 4 Nov 2026 in Melbourne. Mia Sample is HubSpot owner o1.
FRIDAY = "2026-11-06"


def ms(moment: datetime) -> str:
    return str(int(moment.timestamp() * 1000))


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """Call notes, Meetings and HubSpot writing on. A test changes them."""
    chosen: dict[str, Any] = {"meeting_forms_enabled": True, "hubspot_write_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def hubspot(world: World) -> FakeHubSpot:
    fake = FakeHubSpot()
    fake.grant_writes()
    fake.add_company("201", name="Sample Logistics Pty Ltd", domain="samplelogistics.example")
    fake.add_task(
        "601",
        companies=("201",),
        hs_task_subject="Send Sample Logistics the quote",
        hs_task_status="IN_PROGRESS",
        hs_task_type="TODO",
        hs_timestamp=ms(melbourne(5, 9)),
        hubspot_owner_id="o1",
    )
    fake.add_task(
        "602",
        companies=("201",),
        hs_task_subject="Lee's own task",
        hs_task_status="NOT_STARTED",
        hs_timestamp=ms(melbourne(5, 9)),
        hubspot_owner_id="o2",
    )
    world.app.state.hubspot_provider = lambda: fake
    world.app.state.meeting_source = DayMeetings(meetings=[]).source()
    return fake


async def a_copy(world: World) -> None:
    await add(
        world,
        company("201", "Sample Logistics Pty Ltd"),
        HubSpotOwner(owner_id="o1", name="Mia Sample"),
        HubSpotOwner(owner_id="o2", name="Lee Sample"),
        HubSpotOwner(owner_id="o9", name="Old Sample", archived=True),
    )


def a_task(**more: Any) -> dict[str, Any]:
    return {"company_key": "201", "subject": "Send the floor plan", "due": FRIDAY, **more}


async def post(
    client: httpx.AsyncClient, path: str, body: dict[str, Any], key: str = "card-1"
) -> httpx.Response:
    return await client.post(path, json=body, headers={"Idempotency-Key": key})


async def today_ids(client: httpx.AsyncClient) -> list[str]:
    response = await client.get(TODAY)
    assert response.status_code == 200, response.text
    return [task["id"] for task in response.json()["tasks"]]


def made(fake: FakeHubSpot) -> list[dict[str, str | None]]:
    """The tasks HubSpot has that a test made (not the two it started with)."""
    return [r.properties for i, r in fake.tasks.items() if i not in ("601", "602")]


# --- Adding a task --------------------------------------------------------------------------------


async def test_a_task_for_me_and_one_for_a_teammate_and_today_shows_them_at_once(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    hubspot.search_lag = 10  # HubSpot's search won't show a new task for a while
    async with signed_in(world, "mia", owner="o1") as (client, _):
        mine = await post(client, TASKS, a_task(kind="call", body="Ring jo@sample.example"))
        theirs = await post(client, TASKS, a_task(owner_id="o2"), key="card-2")
        assert (mine.status_code, theirs.status_code) == (201, 201)
        assert mine.json()["status"] == theirs.json()["status"] == "done"
        [step] = mine.json()["steps"]
        assert (step["step"], step["status"], step["detail"]) == (
            "task:1",
            "done",
            "Added the task.",
        )
        assert mine.json()["plan"]["tasks"] == [
            "Send the floor plan: a call, medium priority, due Fri 6 Nov 2026, for Mia Sample."
        ]
        assert theirs.json()["plan"]["tasks"] == [
            "Send the floor plan: a to-do, medium priority, due Fri 6 Nov 2026, for Lee Sample."
        ]
        assert step["hubspot_id"] in await today_ids(client)  # shown at once, search or not
    first, second = made(hubspot)
    assert (first["hubspot_owner_id"], second["hubspot_owner_id"]) == ("o1", "o2")
    assert first["hs_task_type"] == "CALL" and first["hs_task_status"] == "NOT_STARTED"
    assert first["hs_task_body"] == "<p>Ring [email left out]</p>"  # no address goes out
    assert first["hs_timestamp"] == ms(melbourne(6, 9))  # 9 am on its day, Melbourne time
    assert all(r.companies == ("201",) for i, r in hubspot.tasks.items() if i not in ("601", "602"))
    assert len(await all_rows(world, HubSpotWrite)) == 2  # one write each, in the log


async def test_a_repeated_key_adds_one_task(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        first = await post(client, TASKS, a_task())
        again = await post(client, TASKS, a_task(subject="Send the floor plan again"))
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]  # the first write, as it was
    assert len(made(hubspot)) == 1 and hubspot.calls.count("create_tasks") == 1


async def test_the_preview_sends_nothing_and_writing_off_gives_409_with_its_words(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    settings["hubspot_write_enabled"] = False
    async with signed_in(world, "mia", owner="o1") as (client, _):
        preview = await post(client, f"{TASKS}/preview", a_task(owner_id="o2"))
        refused = await post(client, TASKS, a_task())
        done = await client.post(f"{TASKS}/601/done")
    assert preview.status_code == 200, preview.text
    assert preview.json()["status"] == "previewed"
    assert preview.json()["plan"]["company_name"] == "Sample Logistics Pty Ltd"
    assert preview.json()["plan"]["tasks"] == [
        "Send the floor plan: a to-do, medium priority, due Fri 6 Nov 2026, for Lee Sample."
    ]
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_writing_off")
    assert refused.json()["detail"] == (
        "Sending to HubSpot is off for now, so the task wasn't added. An admin can switch it on."
    )
    assert (done.status_code, done.json()["code"]) == (409, "hubspot_writing_off")
    assert done.json()["detail"] == (
        "Sending to HubSpot is off for now, so the task wasn't changed. An admin can switch it on."
    )
    assert made(hubspot) == [] and "update_tasks" not in hubspot.calls
    assert hubspot.tasks["601"].properties["hs_task_status"] == "IN_PROGRESS"


# --- Done and reopen -----------------------------------------------------------------------------


async def test_done_then_reopen_and_today_follows(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        assert await today_ids(client) == ["601"]  # Lee's 602 isn't mine
        done = await client.post(f"{TASKS}/601/done")
        assert done.status_code == 204, done.text
        assert hubspot.tasks["601"].properties["hs_task_status"] == "COMPLETED"
        assert await today_ids(client) == []  # gone from Today at once
        again = await client.post(f"{TASKS}/601/done")  # a second press sends nothing
        assert again.status_code == 204
        assert hubspot.calls.count("update_tasks") == 1

        reopened = await client.post(f"{TASKS}/601/reopen")
        assert reopened.status_code == 204, reopened.text
        assert hubspot.tasks["601"].properties["hs_task_status"] == "IN_PROGRESS"  # as before
        response = await client.get(TODAY)
    [task] = response.json()["tasks"]
    assert (task["id"], task["company"]) == (
        "601",
        {"key": "201", "name": "Sample Logistics Pty Ltd"},
    )
    async with world.factory() as db:
        logged = list(await db.scalars(select(HubSpotWrite).order_by(HubSpotWrite.created_at)))
    assert [(row.plan["kind"], row.status, row.plan["fields"][0]["value"]) for row in logged] == [
        ("task", "done", "COMPLETED"),
        ("task", "done", "COMPLETED"),  # the second press: nothing sent, still logged
        ("task", "done", "IN_PROGRESS"),
    ]


async def test_another_persons_task_gives_403_and_changes_nothing(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    await make_platform_admin(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        lees = await client.post(f"{TASKS}/602/done")
        missing = await client.post(f"{TASKS}/999/reopen")
    assert (lees.status_code, lees.json()["code"]) == (403, "not_your_task")
    assert lees.json()["detail"] == (
        "Only the person the task is for can tick it done or open it again. Ask them, or change "
        "it in HubSpot."
    )
    assert (missing.status_code, missing.json()["code"]) == (404, "task_not_found")
    async with signed_in(world, "kim", owner=None) as (client, _):
        unlinked = await client.post(f"{TASKS}/601/done")
    assert (unlinked.status_code, unlinked.json()["code"]) == (409, "no_hubspot_link")
    assert unlinked.json()["detail"] == (
        "Your account isn't linked to HubSpot, so your tasks can't be told apart. Ask Al Khair "
        "to link it."
    )
    assert hubspot.tasks["602"].properties["hs_task_status"] == "NOT_STARTED"
    assert "update_tasks" not in hubspot.calls
    assert await all_rows(world, HubSpotWrite) == []


# --- The checks, and who may ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "status", "code"),
    [
        ({"company_key": "lead:5b0f7e9e-1111-2222-3333-444455556666"}, 422, "not_in_hubspot"),
        ({"company_key": "999"}, 404, "company_not_found"),
        ({"subject": "   "}, 422, "task_empty"),
        ({"due": "2026-11-03"}, 422, "task_in_past"),
        ({"due": "2101-01-01"}, 422, "day_out_of_range"),
        ({"owner_id": "o7"}, 422, "owner_not_found"),  # not on the team list
        ({"owner_id": "o9"}, 422, "owner_not_found"),  # no longer active
    ],
)
async def test_the_checks_before_a_task(
    world: World,
    settings: dict[str, Any],
    hubspot: FakeHubSpot,
    change: dict[str, Any],
    status: int,
    code: str,
) -> None:
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        for path in (f"{TASKS}/preview", TASKS):
            refused = await post(client, path, a_task(**change))
            assert (refused.status_code, refused.json()["code"]) == (status, code), path
        no_key = await client.post(TASKS, json=a_task())
    assert no_key.status_code == 422  # a send needs its Idempotency-Key
    assert made(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


async def test_a_viewer_and_nobody_signed_in_are_refused(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await a_copy(world)
    calls = [
        (f"{TASKS}/preview", a_task()),
        (TASKS, a_task()),
        (f"{TASKS}/601/done", None),
        (f"{TASKS}/601/reopen", None),
    ]
    async with signed_in(world, "vic", owner="o1", role="viewer") as (client, _):
        for path, body in calls:
            refused = await client.post(path, json=body, headers={"Idempotency-Key": "card-1"})
            assert (refused.status_code, refused.json()["code"]) == (403, "viewer_read_only")
    async with world.browser() as nobody:
        for path, body in calls:
            refused = await nobody.post(path, json=body, headers={"Idempotency-Key": "card-1"})
            assert (refused.status_code, refused.json()["code"]) == (401, "auth_required")
    assert hubspot.calls == []


async def test_at_most_20_tasks_a_minute_and_a_repeated_key_isnt_counted(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    """T1-6 (TBC): 2 a minute here, to keep the test short."""
    await a_copy(world)
    world.app.state.task_limit = CommandLimit(per_minute=2)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        assert (await post(client, TASKS, a_task(), key="k1")).status_code == 201
        assert (await post(client, TASKS, a_task(), key="k2")).status_code == 201
        assert (await post(client, TASKS, a_task(), key="k1")).status_code == 200  # not counted
        over = await post(client, TASKS, a_task(), key="k3")
        assert (over.status_code, over.json()["code"]) == (429, "too_many_tasks")
        assert over.headers["Retry-After"] == "60"
        assert over.json()["detail"] == (
            "That's a lot of tasks in one minute. Wait a moment, then try again."
        )
        world.clock.advance(minutes=1)
        assert (await post(client, TASKS, a_task(), key="k3")).status_code == 201
    assert len(made(hubspot)) == 3
