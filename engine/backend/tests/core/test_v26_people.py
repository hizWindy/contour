"""PLAN-V26 Part 2: the reset's switch, the username, Unlock, and who changed what."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from core.auth.models import AuditEntry, User
from tests.core.auth_world import (
    CHROME,
    FIREFOX,
    GOOD,
    World,
    all_rows,
    make_account,
    make_platform_admin,
    me,
    sign_in,
)

pytestmark = pytest.mark.integration

PEOPLE = "/api/v1/people"
ADMIN_IP, JO_IP = "203.0.113.7", "203.0.113.9"
WRONG = "not the right words at all"


@dataclass
class Team:
    world: World
    admin: httpx.AsyncClient  # the Platform admin, signed in on Chrome
    jo: httpx.AsyncClient  # Jo's browser, not signed in yet
    admin_user: User
    jo_user: User

    @property
    def path(self) -> str:
        return f"{PEOPLE}/{self.jo_user.id}"

    async def jo_signs_in(self, login: str = "jsample", password: str = GOOD) -> httpx.Response:
        return await sign_in(self.jo, login=login, password=password)

    async def changes(self, event: str = "account_changed") -> list[AuditEntry]:
        rows: list[AuditEntry] = await all_rows(self.world, AuditEntry)
        mine = [row for row in rows if row.event == event and row.user_id == self.jo_user.id]
        return sorted(mine, key=lambda row: row.id)


@pytest.fixture
async def team(world: World) -> AsyncIterator[Team]:
    boss = await make_platform_admin(world)
    jo = await make_account(
        world, email="jo@example.test", username="jsample", name="Jo Sample", role="staff"
    )
    async with world.browser(ip=ADMIN_IP) as admin, world.browser(FIREFOX, ip=JO_IP) as browser:
        assert (await sign_in(admin)).status_code == 200
        yield Team(world, admin, browser, boss, jo)


def assert_made_by(entry: AuditEntry, team: Team) -> None:
    assert entry.details["admin_id"] == str(team.admin_user.id)
    assert entry.details["admin_name"] == "Al Khair"
    assert entry.details["admin_ip"] == ADMIN_IP
    assert "Chrome" in entry.details["admin_device"]


# --- T2-1. Reset with a switch -----------------------------------------------------------


@pytest.mark.parametrize("body", [None, {}, {"sign_out": True}])
async def test_a_reset_signs_out_every_browser_by_default(
    team: Team, body: dict[str, Any] | None
) -> None:
    assert (await team.jo_signs_in()).status_code == 200
    async with team.world.browser(CHROME, ip=JO_IP) as second:
        assert (await sign_in(second, login="jsample")).status_code == 200
        assert (await team.admin.post(f"{team.path}/password", json=body)).status_code == 200
        assert (await me(team.jo)).status_code == 401
        assert (await me(second)).status_code == 401

    logged = (await team.changes("password_changed"))[-1]
    assert (logged.details["signed_out"], logged.details["sessions_ended"]) == (True, 2)
    assert_made_by(logged, team)


async def test_with_the_switch_off_open_browsers_stay_and_the_new_password_works(
    team: Team,
) -> None:
    assert (await team.jo_signs_in()).status_code == 200
    answer = await team.admin.post(f"{team.path}/password", json={"sign_out": False})
    assert answer.status_code == 200
    assert answer.headers["cache-control"] == "no-store"
    assert (await me(team.jo)).status_code == 200  # still signed in

    new = answer.json()["starting_password"]
    async with team.world.browser(CHROME, ip=JO_IP) as fresh:
        assert (await sign_in(fresh, login="jsample", password=GOOD)).status_code == 401
        team.world.clock.advance(minutes=2)  # past the short wait after a wrong try
        assert (await sign_in(fresh, login="jsample", password=new)).status_code == 200

    logged = (await team.changes("password_changed"))[-1]
    assert (logged.details["signed_out"], logged.details["sessions_ended"]) == (False, 0)
    assert new not in str(logged.details)


# --- T2-3. Change the username -----------------------------------------------------------


async def test_a_new_username_works_and_the_old_one_stops(team: Team) -> None:
    changed = await team.admin.patch(team.path, json={"username": " Jo.Sample "})
    assert changed.status_code == 200, changed.text
    assert changed.json()["username"] == "jo.sample"  # trimmed, lower case

    assert (await team.jo_signs_in("jsample")).status_code == 401
    assert (await team.jo_signs_in("jo.sample")).status_code == 200

    logged = (await team.changes())[-1]
    assert logged.details["fields"] == ["username"]
    assert (logged.details["username_from"], logged.details["username_to"]) == (
        "jsample",
        "jo.sample",
    )
    assert_made_by(logged, team)


async def test_a_taken_username_is_a_409_and_changes_nothing(team: Team) -> None:
    refused = await team.admin.patch(
        team.path, json={"username": "alkhair", "position": "Not saved"}
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "username_taken"
    assert refused.json()["errors"][0]["field"] == "body.username"
    jo = next(row for row in await all_rows(team.world, User) if row.id == team.jo_user.id)
    assert (jo.username, jo.position) == ("jsample", None)
    assert await team.changes() == []


@pytest.mark.parametrize("name", ["jo@example.test", "jo sample", "jo"])
async def test_a_username_follows_add_persons_rules(team: Team, name: str) -> None:
    refused = await team.admin.patch(team.path, json={"username": name})
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["field"] == "body.username"


@pytest.mark.parametrize("empty", [None, "", "  "])
async def test_a_cleared_username_leaves_the_email_to_sign_in_with(
    team: Team, empty: str | None
) -> None:
    cleared = await team.admin.patch(team.path, json={"username": empty})
    assert cleared.status_code == 200
    assert cleared.json()["username"] is None
    assert (await team.jo_signs_in("jsample")).status_code == 401
    assert (await team.jo_signs_in("jo@example.test")).status_code == 200


async def test_a_patch_without_a_username_leaves_it_alone(team: Team) -> None:
    changed = await team.admin.patch(team.path, json={"position": "Designer"})
    assert changed.json()["username"] == "jsample"
    assert "username_to" not in (await team.changes())[-1].details


# --- T2-4. Unlock ------------------------------------------------------------------------


async def wrong_tries(team: Team, count: int) -> None:
    for _ in range(count):
        assert (await team.jo_signs_in(password=WRONG)).status_code in (401, 429)
        team.world.clock.advance(seconds=61)  # past the short waits


async def lock_of(team: Team) -> dict[str, Any] | None:
    people = (await team.admin.get(PEOPLE)).json()
    lock: dict[str, Any] | None = next(p for p in people if p["id"] == str(team.jo_user.id))["lock"]
    return lock


async def test_short_waits_are_not_a_lock(team: Team) -> None:
    await wrong_tries(team, 8)
    assert (await team.jo_signs_in(password=WRONG)).status_code == 401  # the 9th, with a wait
    assert await lock_of(team) is None


async def test_unlock_shows_clears_and_lets_the_right_password_in_at_once(team: Team) -> None:
    await wrong_tries(team, 10)
    lock = await lock_of(team)
    assert lock is not None
    assert lock["wrong_tries"] == 10
    assert lock["until"]
    assert (await team.jo_signs_in()).status_code == 429  # locked, with the right password too

    unlocked = await team.admin.post(f"{team.path}/unlock")
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["lock"] is None
    assert (await team.jo_signs_in()).status_code == 200  # at once: the clock didn't move

    logged = (await team.changes())[-1]
    assert logged.details["unlocked"] is True
    assert logged.details["wrong_tries"] == 10
    assert_made_by(logged, team)


async def test_a_lock_that_ran_out_is_not_shown(team: Team) -> None:
    await wrong_tries(team, 10)
    team.world.clock.advance(minutes=16)
    assert await lock_of(team) is None


async def test_unlocking_someone_who_is_not_locked_changes_nothing(team: Team) -> None:
    assert (await team.admin.post(f"{team.path}/unlock")).status_code == 200
    assert await team.changes() == []


async def test_unlock_is_for_the_platform_admin_only(team: Team) -> None:
    assert (await team.jo_signs_in()).status_code == 200
    refused = await team.jo.post(f"{team.path}/unlock")
    assert refused.status_code == 403
    assert refused.json()["code"] == "platform_admin_only"


async def test_unlocking_nobody_is_a_404(team: Team) -> None:
    assert (await team.admin.post(f"{PEOPLE}/{uuid.uuid4()}/unlock")).status_code == 404


# --- T2-5. Who changed it ----------------------------------------------------------------


async def test_every_admin_route_records_the_admin_the_address_and_the_device(team: Team) -> None:
    added = await team.admin.post(
        PEOPLE, json={"name": "Sam Sample", "email": "sam@example.test", "no_hubspot_user": True}
    )
    assert added.status_code == 201, added.text
    assert (await team.admin.patch(team.path, json={"position": "Designer"})).status_code == 200
    linked = await team.admin.put(
        f"{team.path}/hubspot-owner", json={"owner_id": None, "no_hubspot_user": True}
    )
    assert linked.status_code == 200, linked.text
    assert (await team.admin.post(f"{team.path}/password")).status_code == 200
    await wrong_tries(team, 10)
    assert (await team.admin.post(f"{team.path}/unlock")).status_code == 200

    rows: list[AuditEntry] = await all_rows(team.world, AuditEntry)
    made = [row for row in rows if "admin_id" in row.details]
    assert sorted(row.event for row in made) == [
        "account_changed",  # the position
        "account_changed",  # the HubSpot user
        "account_changed",  # the unlock
        "account_created",
        "password_changed",
    ]
    for row in made:
        assert_made_by(row, team)
        assert row.ip is None  # the entry's own address is the person's, and they weren't there
