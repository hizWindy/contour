"""Adding a company to HubSpot from the card (PLAN-V23 T1-4, the contract's part 4), through its
routes, with core's real writer and a fake HubSpot:

- a close name in HubSpot shows in `similar`, read into our copy, and the preview writes nothing;
- the same name and city gives 409 (and, for now, the same name in another city too);
- writing off, or a key that can't make companies, gives 409 with the plan's words;
- a repeated key makes one company, and a send that timed out isn't sent again blind;
- the new company is in our copy at once, and each write is a row in the write log;
- 5 new companies a minute a person, then 429;
- no connection waits on HubSpot; a Viewer, someone without the ticks and nobody signed in are
  refused; the name's checks.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.pool import QueuePool

from apps.companies.assistant_add import ADDING_OFF
from core.api.deps import settings_dependency
from core.hubspot.client import HubSpotWriteUncertain
from core.hubspot.matching import forget_loaded_copy
from core.hubspot.models import HubSpotCompany, HubSpotWrite
from tests.companies.helpers import API, add, company
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_today import signed_in
from tests.core.auth_world import World, all_rows
from tests.core.hubspot_fake import FakeHubSpot

pytestmark = pytest.mark.integration
ADD = f"{API}/assistant/companies"
PREVIEW = f"{ADD}/preview"


@pytest.fixture(autouse=True)
def fresh_copy() -> Iterator[None]:
    forget_loaded_copy()
    yield
    forget_loaded_copy()


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """Call notes and HubSpot writing on. A test changes them."""
    chosen: dict[str, Any] = {"meeting_forms_enabled": True, "hubspot_write_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


def a_hubspot() -> FakeHubSpot:
    """HubSpot, with two companies our copy doesn't have yet."""
    fake = FakeHubSpot()
    fake.grant_writes()
    fake.add_company("801", name="Sample Logistics Pty Ltd", city="Perth")
    fake.add_company("802", name="Sample Freight", city="Perth")
    return fake


@pytest.fixture
def hubspot(world: World) -> FakeHubSpot:
    fake = a_hubspot()
    world.app.state.hubspot_provider = lambda: fake
    return fake


async def send(
    client: httpx.AsyncClient, name: str, city: str | None = None, key: str = "card-1"
) -> httpx.Response:
    body: dict[str, Any] = {"name": name, "city": city}
    return await client.post(ADD, json=body, headers={"Idempotency-Key": key})


async def preview(client: httpx.AsyncClient, name: str, city: str | None = None) -> dict[str, Any]:
    response = await client.post(PREVIEW, json={"name": name, "city": city})
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


def made(fake: FakeHubSpot) -> list[dict[str, str | None]]:
    """The companies a test made in HubSpot (not the two it started with)."""
    return [r.properties for i, r in fake.companies.items() if i not in ("801", "802")]


def writes(fake: FakeHubSpot) -> list[str]:
    return [call for call in fake.calls if call.startswith(("create", "update", "add_to"))]


# --- The preview ---------------------------------------------------------------------------------


async def test_a_close_name_in_hubspot_shows_in_similar_and_nothing_is_written(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        found = await preview(client, "  Sample   Logistics ", "Perth")
    assert found["name"] == "Sample Logistics" and found["city"] == "Perth"
    assert found["similar"] == [
        {
            "key": "801",
            "name": "Sample Logistics Pty Ltd",
            "city": "Perth",
            "industry": None,
            "source": "hubspot",
        }
    ]
    assert found["exists"] is None and found["can_write"] is True
    assert found["waiting_for"] is None
    assert found["sentence"] == (
        "HubSpot already has Sample Logistics Pty Ltd. Use it, or add Sample Logistics anyway."
    )
    assert "801" in {row.hubspot_id for row in await all_rows(world, HubSpotCompany)}
    assert writes(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


async def test_the_preview_with_nothing_like_it_and_with_the_same_name(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        new = await preview(client, "Zebra Holdings")
        same = await preview(client, "sample freight", "Perth")
    assert (new["similar"], new["exists"], new["sentence"]) == ([], None, None)
    assert same["exists"]["key"] == "802"
    assert same["sentence"] == (
        "HubSpot already has Sample Freight in Perth, so it isn't added again. Use it from the "
        "list."
    )


# --- The same name --------------------------------------------------------------------------------


async def test_the_same_name_and_city_gives_409(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        same = await send(client, "Sample Freight", "Perth")
        other_city = await send(client, "SAMPLE FREIGHT", "Sydney", key="card-2")
        no_city = await send(client, "Sample Freight", key="card-3")
    for response in (same, other_city, no_city):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "company_exists"
    assert same.json()["detail"] == (
        "HubSpot already has Sample Freight in Perth, so it isn't added again. Use it from the "
        "list."
    )
    assert made(hubspot) == [] and "create_companies" not in hubspot.calls


async def test_the_same_name_in_our_copy_is_refused_before_hubspot_is_asked(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    await add(world, company("803", "Sample Quiet Pty Ltd", city="Hobart"))
    async with signed_in(world, "mia", owner="o1") as (client, _):
        refused = await send(client, "sample  quiet pty ltd")
    assert (refused.status_code, refused.json()["code"]) == (409, "company_exists")
    assert refused.json()["detail"].startswith("HubSpot already has Sample Quiet Pty Ltd in Hobart")
    assert hubspot.calls == []


# --- Writing off ----------------------------------------------------------------------------------


async def test_writing_off_gives_409_with_the_plans_words(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    settings["hubspot_write_enabled"] = False
    async with signed_in(world, "mia", owner="o1") as (client, _):
        found = await preview(client, "Zebra Holdings")
        refused = await send(client, "Zebra Holdings")
    assert (found["can_write"], found["waiting_for"], found["sentence"]) == (
        False,
        ADDING_OFF,
        ADDING_OFF,
    )
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_writing_off")
    assert refused.json()["detail"] == (
        "Adding companies to HubSpot is off for now. Pick a company that's there."
    )
    assert made(hubspot) == [] and await all_rows(world, HubSpotWrite) == []


async def test_a_key_that_can_t_make_companies_is_the_same_as_off(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    hubspot.scopes.discard("crm.objects.companies.write")
    async with signed_in(world, "mia", owner="o1") as (client, _):
        refused = await send(client, "Zebra Holdings")
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_writing_off")
    assert "crm." not in refused.text  # no scope name on screen
    [row] = await all_rows(world, HubSpotWrite)
    assert row.status == "failed"  # the write log keeps what HubSpot said


async def test_no_hubspot_connection_lists_nothing_and_adds_nothing(
    world: World, settings: dict[str, Any]
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        found = await preview(client, "Zebra Holdings")
        refused = await send(client, "Zebra Holdings")
    assert (found["similar"], found["can_write"], found["sentence"]) == ([], False, ADDING_OFF)
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_writing_off")


# --- Adding ---------------------------------------------------------------------------------------


async def test_a_new_company_is_in_hubspot_and_our_copy_at_once_once_for_a_key(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    hubspot.search_lag = 10  # HubSpot's search won't show the new company for a while
    async with signed_in(world, "mia", owner="o1") as (client, _):
        first = await send(client, "Zebra Holdings", "Perth")
        again = await send(client, "Zebra Holdings Again", "Perth")  # the same key
    assert (first.status_code, again.status_code) == (201, 200)
    added = first.json()
    assert again.json() == added
    assert added["company"] == {
        "key": added["company_key"],
        "name": "Zebra Holdings",
        "city": "Perth",
        "industry": None,
        "source": "hubspot",
    }
    assert added["hubspot_url"] and added["company_key"] in added["hubspot_url"]
    assert made(hubspot) == [{"name": "Zebra Holdings", "city": "Perth"}]
    assert hubspot.calls.count("create_companies") == 1
    rows = {row.hubspot_id: row for row in await all_rows(world, HubSpotCompany)}
    assert (rows[added["company_key"]].name, rows[added["company_key"]].city) == (
        "Zebra Holdings",
        "Perth",
    )
    [write] = await all_rows(world, HubSpotWrite)
    assert (write.app, write.status, write.hubspot_company_id) == (
        "companies",
        "done",
        added["company_key"],
    )
    assert write.subject.startswith("assistant_company:") and write.subject.endswith(":card-1")


async def test_each_write_is_a_row_in_the_write_log(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        one = await send(client, "Zebra Holdings", key="card-1")
        two = await send(client, "Yak Logistics", "Darwin", key="card-2")
    assert (one.status_code, two.status_code) == (201, 201)
    rows: list[HubSpotWrite] = await all_rows(world, HubSpotWrite)
    assert sorted(row.hubspot_company_id or "" for row in rows) == sorted(
        [one.json()["company_key"], two.json()["company_key"]]
    )
    assert {row.status for row in rows} == {"done"}
    assert {row.plan["kind"] for row in rows} == {"company"}  # the Lead Finder writer's kind


async def test_a_send_that_timed_out_is_not_sent_again_blind(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    hubspot.fail_after["create_companies"] = [
        HubSpotWriteUncertain("HubSpot didn't answer", "It may have landed.")
    ]
    async with signed_in(world, "mia", owner="o1") as (client, _):
        unsure = await send(client, "Zebra Holdings")
        again = await send(client, "Zebra Holdings")
    assert (unsure.status_code, unsure.json()["code"]) == (502, "company_not_added")
    assert unsure.json()["detail"] == (
        "We can't tell yet if the company was added. Try again: it won't be added twice."
    )
    assert again.status_code == 200, again.text  # found by name: the first try made it
    assert hubspot.calls.count("create_companies") == 1 and len(made(hubspot)) == 1
    assert again.json()["company"]["name"] == "Zebra Holdings"


async def test_five_new_companies_a_minute_then_wait(
    world: World, settings: dict[str, Any], hubspot: FakeHubSpot
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        for n in range(5):
            response = await send(client, f"Zebra Number {n}", key=f"card-{n}")
            assert response.status_code == 201, response.text
        repeat = await send(client, "Zebra Number 0", key="card-0")  # not counted
        refused = await send(client, "Zebra Number 5", key="card-5")
        world.clock.advance(seconds=61)
        later = await send(client, "Zebra Number 5", key="card-5")
    assert repeat.status_code == 200
    assert (refused.status_code, refused.json()["code"]) == (429, "too_many_companies")
    assert refused.json()["detail"] == (
        "That's a lot of companies in one minute. Wait a moment, then try again."
    )
    assert refused.headers["retry-after"] == "60"
    assert later.status_code == 201
    assert len(made(hubspot)) == 6


# --- Who may add, the checks, and no connection waits on HubSpot ----------------------------------


async def test_who_may_add(world: World, settings: dict[str, Any], hubspot: FakeHubSpot) -> None:
    async with signed_in(world, "vic", owner=None, role="viewer") as (viewer, _):
        refused = await send(viewer, "Zebra Holdings")
        looked = await viewer.post(PREVIEW, json={"name": "Zebra Holdings"})
    async with signed_in(world, "cora", owner=None, features=["companies.companies"]) as (
        no_tick,
        _,
    ):
        no_feature = await send(no_tick, "Zebra Holdings")
    async with world.browser() as nobody:
        signed_out = await send(nobody, "Zebra Holdings")
    for response in (refused, looked):
        assert (response.status_code, response.json()["code"]) == (403, "viewer_read_only")
    assert (no_feature.status_code, no_feature.json()["code"]) == (403, "feature_not_allowed")
    assert (signed_out.status_code, signed_out.json()["code"]) == (401, "auth_required")
    assert made(hubspot) == [] and hubspot.calls == []


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"name": "   "}, "company_name_empty"),
        ({"name": "Zebra 0412 345 678"}, "contact_details"),
        ({"name": "Zebra Holdings", "city": "jo@sample.example"}, "contact_details"),
        ({"name": "x" * 121}, None),
        ({"name": "Zebra Holdings", "more": 1}, None),
    ],
)
async def test_the_checks_before_a_company_is_added(
    world: World,
    settings: dict[str, Any],
    hubspot: FakeHubSpot,
    body: dict[str, Any],
    code: str | None,
) -> None:
    async with signed_in(world, "mia", owner="o1") as (client, _):
        response = await client.post(ADD, json=body, headers={"Idempotency-Key": "card-1"})
        missing_key = await client.post(ADD, json={"name": "Zebra Holdings"})
    assert response.status_code == 422, response.text
    if code is not None:
        assert response.json()["code"] == code
    assert missing_key.status_code == 422
    assert made(hubspot) == []


class Watching(FakeHubSpot):
    """A fake HubSpot that notes how many database connections are out at each call."""

    def __init__(self, pool: QueuePool) -> None:
        super().__init__()
        self.pool = pool
        self.out: list[int] = []

    def _call(self, name: str, scope: str | None = None) -> None:
        self.out.append(self.pool.checkedout())
        super()._call(name, scope)


async def test_no_database_connection_waits_on_hubspot(
    world: World, settings: dict[str, Any], engine: AsyncEngine
) -> None:
    pool = engine.sync_engine.pool
    assert isinstance(pool, QueuePool)
    fake = Watching(pool)
    fake.grant_writes()
    fake.add_company("801", name="Sample Logistics Pty Ltd", city="Perth")
    world.app.state.hubspot_provider = lambda: fake
    async with signed_in(world, "mia", owner="o1") as (client, _):
        await preview(client, "Sample Logistics")
        added = await send(client, "Zebra Holdings", "Perth")
    assert added.status_code == 201, added.text
    assert "create_companies" in fake.calls
    assert fake.out and set(fake.out) == {0}  # every HubSpot call: no connection held
