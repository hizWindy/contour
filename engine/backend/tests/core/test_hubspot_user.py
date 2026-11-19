"""The HubSpot user mark (PLAN-V23 T3-1): where each account's work lands in HubSpot, as `hubspot`:
linked (an owner is set), none ("No HubSpot user", like a designer) or not_set.

- Add person needs one choice: their HubSpot user, or No HubSpot user (422
  `hubspot_choice_missing` for neither; a field error for both, or an owner that isn't active);
- a No HubSpot user person reads `none`, and starts with the Call logs tick only, unless ticks
  are sent; one added with their HubSpot user reads `linked`, set by hand;
- an old account with no link reads `not_set`; linking later gives `linked`; the mark clears the
  link and a link clears the mark; the signed-in answer says the same;
- the owners sync's email match never links an account marked No HubSpot user.

Every person and address here is made up.
"""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.auth import admin
from core.auth.features import default_features
from core.auth.models import AuditEntry, User
from core.hubspot.models import HubSpotOwner
from core.hubspot.owners import Account, hubspot_user, plan_links
from tests.core.auth_world import FAST, GOOD, World, make_platform_admin, me, sign_in
from tests.core.test_hubspot_owners import JO, add_account, link_of, row_for
from tests.core.test_hubspot_sync import contour, sync

Factory = async_sessionmaker[AsyncSession]
PEOPLE = "/api/v1/people"
db = pytest.mark.integration
NOT_ACTIVE = {
    "field": "body.hubspot_owner_id",
    "message": "This isn't an active HubSpot owner. Pick one from the list.",
}


# --- The rules, in pure code (fast) ----------------------------------------------------------


def test_the_link_and_the_mark_read_as_one_word() -> None:
    def user(owner: str | None = None, *, mark: bool = False) -> User:
        return User(
            hubspot_owner_id=owner,
            hubspot_owner_matched_by="person" if owner else None,
            no_hubspot_user=mark,
        )

    assert hubspot_user(user("301")) == "linked"
    assert hubspot_user(user(mark=True)) == "none"
    assert hubspot_user(user()) == "not_set"


def test_the_sync_never_plans_a_link_for_an_account_marked_no_hubspot_user() -> None:
    lee = "lee.sample@contourinteriors.com.au"
    marked = Account(
        id=uuid.uuid4(), email=JO, owner_id=None, matched_by=None, no_hubspot_user=True
    )
    plain = Account(id=uuid.uuid4(), email=lee, owner_id=None, matched_by=None)
    changes = plan_links([marked, plain], {JO: "301", lee: "302"}, active={"301", "302"})
    assert changes == {plain.id: "302"}


# --- Add person -------------------------------------------------------------------------------


async def our_owners(world: World) -> None:
    async with world.factory() as session:
        session.add_all(
            [
                HubSpotOwner(owner_id="301", name="Sam Sample"),
                HubSpotOwner(owner_id="303", name="Old Sample", archived=True),
            ]
        )
        await session.commit()


async def add_person(browser: httpx.AsyncClient, **body: Any) -> httpx.Response:
    values: dict[str, Any] = {
        "name": "Jo Sample",
        "email": "jo.sample@example.test",
        "role": "staff",
    }
    return await browser.post(PEOPLE, json=values | body)


@db
async def test_a_new_person_needs_their_hubspot_user_or_no_hubspot_user(world: World) -> None:
    await our_owners(world)
    await make_platform_admin(world)
    async with world.browser() as boss:
        assert (await sign_in(boss)).status_code == 200
        neither = await add_person(boss)
        both = await add_person(boss, hubspot_owner_id="301", no_hubspot_user=True)
        left = await add_person(boss, hubspot_owner_id="303")  # left HubSpot: archived
        unknown = await add_person(boss, hubspot_owner_id="999")
        listed = (await boss.get(PEOPLE)).json()

    assert (neither.status_code, neither.json()["code"]) == (422, "hubspot_choice_missing")
    assert neither.json()["title"] == "Pick their HubSpot user"
    assert neither.json()["detail"] == (
        "Pick this person's HubSpot user from the list, or pick No HubSpot user."
    )
    assert neither.json()["errors"] == [
        {
            "field": "body.hubspot_owner_id",
            "message": "Pick their HubSpot user, or No HubSpot user.",
        }
    ]
    assert both.status_code == 422
    assert both.json()["errors"] == [
        {
            "field": "body.no_hubspot_user",
            "message": "Pick one: their HubSpot user, or No HubSpot user.",
        }
    ]
    for refused in (left, unknown):
        assert refused.status_code == 422 and refused.json()["errors"] == [NOT_ACTIVE]
    assert [person["email"] for person in listed] == ["al.khair@example.test"]  # nobody added


@db
async def test_no_hubspot_user_reads_none_and_starts_with_call_logs_only(world: World) -> None:
    await our_owners(world)
    await make_platform_admin(world)
    async with world.browser() as boss:
        assert (await sign_in(boss)).status_code == 200
        jo = await add_person(boss, position="Designer", no_hubspot_user=True)
        ana = await add_person(
            boss,
            name="Ana Sample",
            email="ana.sample@example.test",
            no_hubspot_user=True,
            features=["companies.call_logs", "companies.meetings"],  # she writes pre-reads
        )
        sam = await add_person(
            boss, name="Sam Sample", email="sam.sample@example.test", hubspot_owner_id=" 301 "
        )
    assert (jo.status_code, ana.status_code, sam.status_code) == (201, 201, 201)
    added = jo.json()
    assert (added["hubspot"], added["hubspot_owner"]) == ("none", None)
    assert (added["features"], added["apps"]) == (["companies.call_logs"], ["companies"])
    assert ana.json()["features"] == ["companies.call_logs", "companies.meetings"]
    assert sam.json()["hubspot"] == "linked"
    assert sam.json()["hubspot_owner"] == {
        "id": "301",
        "name": "Sam Sample",
        "matched_by": "person",
    }
    assert sam.json()["features"] == default_features("staff")  # the role's ticks, as before

    async with world.browser() as designer:
        login = {"login": "jo.sample@example.test", "password": added["starting_password"]}
        assert (await sign_in(designer, **login)).status_code == 200
        signed = (await me(designer)).json()
    assert signed["user"]["hubspot"] == "none"  # the signed-in answer says the same

    async with world.factory() as session:
        made = list(
            await session.scalars(
                select(AuditEntry.details)
                .where(AuditEntry.event == "account_created")
                .order_by(AuditEntry.id)
            )
        )
    assert [entry.get("hubspot") for entry in made[-3:]] == ["none", "none", "linked"]


# --- The link and the mark, later -----------------------------------------------------------


@db
async def test_an_old_account_reads_not_set_and_the_link_and_the_mark_clear_each_other(
    world: World,
) -> None:
    await our_owners(world)
    await make_platform_admin(world)
    async with world.factory() as session:
        kim = await admin.create_person(
            session,
            email="kim.sample@example.test",
            username="kimsample",
            name="Kim Sample",
            role="staff",
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
    path = f"{PEOPLE}/{kim.id}/hubspot-owner"

    async def row() -> tuple[str | None, str | None, bool]:
        async with world.factory() as session:
            user = await session.get(User, kim.id)
            assert user is not None
            return user.hubspot_owner_id, user.hubspot_owner_matched_by, user.no_hubspot_user

    async with world.browser() as boss:
        assert (await sign_in(boss)).status_code == 200
        before = row_for((await boss.get(PEOPLE)).json(), kim.id)
        linked = (await boss.put(path, json={"owner_id": "301"})).json()
        marked = (await boss.put(path, json={"owner_id": None, "no_hubspot_user": True})).json()
        after_mark = await row()
        relinked = (await boss.put(path, json={"owner_id": "301"})).json()
        after_link = await row()
        both = await boss.put(path, json={"owner_id": "301", "no_hubspot_user": True})
        cleared = (await boss.put(path, json={"owner_id": None})).json()

    assert (before["hubspot"], before["hubspot_owner"]) == ("not_set", None)
    assert (linked["hubspot"], linked["hubspot_owner"]["id"]) == ("linked", "301")
    assert (marked["hubspot"], marked["hubspot_owner"]) == ("none", None)
    assert after_mark == (None, None, True)  # the mark clears the link
    assert relinked["hubspot"] == "linked" and after_link == ("301", "person", False)
    assert both.status_code == 422
    assert both.json()["errors"][0]["field"] == "body.no_hubspot_user"
    assert (cleared["hubspot"], cleared["hubspot_owner"]) == ("not_set", None)
    assert await row() == (None, None, False)


@db
async def test_the_sync_never_links_an_account_marked_no_hubspot_user(
    session_factory: Factory,
) -> None:
    fake = contour()
    fake.add_owner("301", "Jo Sample", email=JO)
    jo = await add_account(session_factory, JO)
    async with session_factory() as session:
        await session.execute(update(User).where(User.id == jo).values(no_hubspot_user=True))
        await session.commit()

    await sync(session_factory, fake)

    assert await link_of(session_factory, jo) == (None, None)
    assert "owner_emails" not in fake.calls  # nobody to match: HubSpot isn't asked
