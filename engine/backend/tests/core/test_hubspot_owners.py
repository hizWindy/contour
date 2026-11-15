"""Who each account is in HubSpot (PLAN-V17 T1-4): the sync's match by email, an Admin's link by
hand, the owners' pick list, and `owner_of`. The owners' emails stay in memory: none is saved,
logged or sent by a route.

Every person and address here is made up.
"""

import logging
import uuid

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.auth import admin
from core.auth.models import AuditEntry, User
from core.hubspot import activities
from core.hubspot.client import HubSpotUnavailable, email_key, owner_email_index
from core.hubspot.models import HubSpotOwner
from core.hubspot.owners import OWNER_MATCH_FAILED, Account, plan_links
from tests.core.auth_world import FAST, GOOD, World, make_account, sign_in
from tests.core.test_hubspot_sync import contour, sync

Factory = async_sessionmaker[AsyncSession]
PEOPLE = "/api/v1/people"
OWNERS = "/api/v1/hubspot/owners"

JO = "jo.sample@contourinteriors.com.au"  # the account's email, as we keep it
JO_IN_HUBSPOT = "  Jo.Sample@ContourInteriors.com.au "  # the same person, as HubSpot has it
SAM = "sam.example@contourinteriors.com.au"  # an owner no account has
HASH = "$argon2id$not-a-real-hash"


def logged(caplog: pytest.LogCaptureFixture, prefix: str = "", *, lower: bool = True) -> str:
    """Every captured log line (of the loggers named `prefix...`), with its extra fields and any
    error text. In lower case unless `lower` is False."""
    parts: list[str] = []
    for record in caplog.records:
        if not record.name.startswith(prefix):
            continue
        parts += [record.getMessage(), repr(record.__dict__)]
        if record.exc_info:
            parts.append(logging.Formatter().formatException(record.exc_info))
    found = "\n".join(parts)
    return found.lower() if lower else found


# --- The rules, in pure code (fast) ----------------------------------------------------------


def test_an_email_is_compared_without_its_case_or_the_spaces_around_it() -> None:
    assert email_key(JO_IN_HUBSPOT) == JO
    for nothing in (None, "", "   ", "no-at-sign", "@contourinteriors.com.au"):
        assert email_key(nothing) is None, nothing


def test_two_owners_with_one_email_the_lowest_id_wins_whatever_the_order() -> None:
    pairs = [("1000", JO), ("999", JO_IN_HUBSPOT), ("5", None), ("6", ""), ("hs-1", JO)]
    assert owner_email_index(pairs) == {JO: "999"}  # 999 is lower than 1000 as a number
    assert owner_email_index(list(reversed(pairs))) == {JO: "999"}


def account(email: str, owner_id: str | None = None, matched_by: str | None = None) -> Account:
    return Account(id=uuid.uuid4(), email=email, owner_id=owner_id, matched_by=matched_by)


def test_the_plan_links_clears_and_never_touches_a_link_set_by_hand() -> None:
    new = account(JO)
    left = account("left@contourinteriors.com.au", "302", "email")  # the owner has gone
    by_hand = account("pat.sample@contourinteriors.com.au", "303", "person")
    same = account("lee.sample@contourinteriors.com.au", "304", "email")
    nobody = account("nobody@contourinteriors.com.au")
    archived = account("old.sample@contourinteriors.com.au")
    owners_by_email = {
        JO: "301",
        "pat.sample@contourinteriors.com.au": "301",  # an email match, but the link is by hand
        "lee.sample@contourinteriors.com.au": "304",
        "old.sample@contourinteriors.com.au": "305",  # not an active owner in our copy
    }
    accounts = [new, left, by_hand, same, nobody, archived]
    changes = plan_links(accounts, owners_by_email, active={"301", "302", "303", "304"})
    assert changes == {new.id: "301", left.id: None}


async def test_with_sign_in_off_there_is_no_owner_and_the_database_is_not_read() -> None:
    session: object = object()  # any use of it would fail
    assert await activities.owner_of(session, None) is None  # type: ignore[arg-type]


# --- The sync -------------------------------------------------------------------------------


async def add_account(
    factory: Factory, email: str, owner_id: str | None = None, matched_by: str | None = None
) -> uuid.UUID:
    async with factory() as session:
        user = User(
            email=email,
            name="Jo Sample",
            role="staff",
            password_hash=HASH,
            hubspot_owner_id=owner_id,
            hubspot_owner_matched_by=matched_by,
        )
        session.add(user)
        await session.commit()
        return user.id


async def link_of(factory: Factory, user_id: uuid.UUID) -> tuple[str | None, str | None]:
    async with factory() as session:
        user = await session.get(User, user_id)
        assert user is not None
        return user.hubspot_owner_id, user.hubspot_owner_matched_by


@pytest.mark.integration
async def test_the_sync_links_an_account_by_its_email(session_factory: Factory) -> None:
    fake = contour()
    fake.add_owner("301", "Jo Sample", email=JO_IN_HUBSPOT)  # other case, spaces around it
    fake.add_owner("302", "Sam Example", email=SAM)
    jo = await add_account(session_factory, JO)
    out = await sync(session_factory, fake)
    assert out.status == "done" and OWNER_MATCH_FAILED not in out.warnings
    assert await link_of(session_factory, jo) == ("301", "email")
    assert "owner_emails" in fake.calls


@pytest.mark.integration
async def test_no_match_leaves_the_account_without_a_link(session_factory: Factory) -> None:
    fake = contour()
    fake.add_owner("302", "Sam Example", email=SAM)
    await sync(session_factory, fake)
    assert "owner_emails" not in fake.calls  # no account yet: HubSpot isn't asked

    nobody = await add_account(session_factory, "nobody@contourinteriors.com.au")
    await sync(session_factory, fake)
    assert await link_of(session_factory, nobody) == (None, None)
    assert "owner_emails" in fake.calls


@pytest.mark.integration
async def test_an_email_link_is_cleared_when_the_owner_leaves_or_the_email_changes(
    session_factory: Factory,
) -> None:
    fake = contour()
    owner = fake.add_owner("301", "Jo Sample", email=JO)
    jo = await add_account(session_factory, JO)
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == ("301", "email")

    fake.owner_email["301"] = "jo.new@contourinteriors.com.au"  # the email changed in HubSpot
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == (None, None)

    fake.owner_email["301"] = JO
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == ("301", "email")

    fake.owners_active.remove(owner)  # the owner left: HubSpot archives them
    fake.add_owner("301", "Jo Sample", email=JO, archived=True)
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == (None, None)


@pytest.mark.integration
async def test_a_link_set_by_hand_survives_a_sync(session_factory: Factory) -> None:
    fake = contour()
    fake.add_owner("301", "Jo Sample", email=JO)
    fake.add_owner("302", "Jo's team account")
    jo = await add_account(session_factory, JO, "302", "person")
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == ("302", "person")
    assert "owner_emails" not in fake.calls  # every link is by hand: nothing to match

    other = await add_account(session_factory, "nobody@contourinteriors.com.au")
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == ("302", "person")
    assert await link_of(session_factory, other) == (None, None)


@pytest.mark.integration
async def test_two_owners_with_one_email_the_lowest_id_wins(session_factory: Factory) -> None:
    fake = contour()
    fake.add_owner("1000", "Jo Sample", email=JO)
    fake.add_owner("999", "Jo Sample (old login)", email=JO_IN_HUBSPOT)
    jo = await add_account(session_factory, JO)
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == ("999", "email")


@pytest.mark.integration
async def test_an_archived_owner_is_never_matched(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = contour()
    fake.add_owner("401", "Jo Sample", email=JO, archived=True)
    jo = await add_account(session_factory, JO)
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == (None, None)

    # Even if HubSpot's list named one, an owner our copy holds as archived never matches.
    async def names_an_archived_owner() -> dict[str, str]:
        return {JO: "12"}  # contour()'s "Sam Old", archived

    monkeypatch.setattr(fake, "owner_emails", names_an_archived_owner)
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == (None, None)


async def rows_holding(session: AsyncSession, needle: str, *, any_case: bool) -> dict[str, int]:
    """In each of our tables, how many rows hold `needle` anywhere in their text."""
    tables = await session.execute(
        text(
            "SELECT table_schema, table_name FROM information_schema.tables "
            "WHERE table_schema IN ('core', 'companies', 'lead_finder') "
            "AND table_type = 'BASE TABLE'"
        )
    )
    row_text = "lower(t::text)" if any_case else "t::text"
    found: dict[str, int] = {}
    for schema, table in tables:
        count = await session.scalar(
            text(
                f'SELECT count(*) FROM "{schema}"."{table}" t WHERE strpos({row_text}, :needle) > 0'
            ).bindparams(needle=needle.lower() if any_case else needle)
        )
        if count:
            found[f"{schema}.{table}"] = count
    return found


@pytest.mark.integration
async def test_no_owner_email_is_saved_or_logged(
    session_factory: Factory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)  # every logger, the database's own included
    fake = contour()
    fake.add_owner("301", "Jo Sample", email=JO_IN_HUBSPOT)
    fake.add_owner("302", "Sam Example", email=SAM)
    jo = await add_account(session_factory, JO)
    await sync(session_factory, fake)
    assert await link_of(session_factory, jo) == ("301", "email")

    assert "sam.example@" not in logged(caplog)  # not even as a value sent to the database
    assert "Jo.Sample@ContourInteriors" not in logged(caplog, lower=False)  # HubSpot's way
    assert "jo.sample@" not in logged(caplog, "core.")  # our own lines: no email at all
    assert any(record.getMessage() == "hubspot_owner_links" for record in caplog.records)

    async with session_factory() as session:
        assert await rows_holding(session, SAM, any_case=True) == {}
        assert await rows_holding(session, "Jo.Sample@ContourInteriors", any_case=False) == {}
        # Only the account's own email, which was there before the sync.
        assert await rows_holding(session, JO, any_case=True) == {"core.users": 1}


@pytest.mark.integration
async def test_a_failed_match_never_fails_the_sync_and_logs_no_email(
    session_factory: Factory, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    caplog.set_level(logging.INFO, logger="core")
    fake = contour()
    fake.add_owner("301", "Jo Sample", email=JO)
    jo = await add_account(session_factory, JO, "301", "email")
    fake.fail["owner_emails"] = [HubSpotUnavailable("HubSpot is busy", "Try again soon.")]
    out = await sync(session_factory, fake)
    assert out.status == "done" and OWNER_MATCH_FAILED in out.warnings
    assert await link_of(session_factory, jo) == ("301", "email")  # the link made before stays

    async def breaks() -> dict[str, str]:
        raise RuntimeError(f"an answer that quotes {JO_IN_HUBSPOT}")

    monkeypatch.setattr(fake, "owner_emails", breaks)
    out = await sync(session_factory, fake)
    assert out.status == "done" and OWNER_MATCH_FAILED in out.warnings
    assert await link_of(session_factory, jo) == ("301", "email")
    failures = [r for r in caplog.records if r.getMessage() == "hubspot_owner_match_failed"]
    assert [getattr(r, "reason", None) for r in failures] == ["HubSpot is busy", None]
    assert getattr(failures[1], "error", None) == "RuntimeError"
    assert "jo.sample@" not in logged(caplog)


# --- owner_of ---------------------------------------------------------------------------------


@pytest.mark.integration
async def test_owner_of_gives_the_accounts_owner_or_none(session_factory: Factory) -> None:
    linked = await add_account(session_factory, JO, "301", "email")
    alone = await add_account(session_factory, "nobody@contourinteriors.com.au")
    async with session_factory() as session:
        assert await activities.owner_of(session, linked) == "301"
        assert await activities.owner_of(session, alone) is None
        assert await activities.owner_of(session, uuid.uuid4()) is None  # no such account
        assert await activities.owner_of(session, None) is None  # sign-in off: unassigned


# --- The routes -------------------------------------------------------------------------------


async def our_copy(factory: Factory) -> None:
    """Owners as the sync saves them: names only, one archived, one with no name."""
    async with factory() as session:
        session.add_all(
            [
                HubSpotOwner(owner_id="301", name="Jo Sample", archived=False),
                HubSpotOwner(owner_id="302", name="alex Example", archived=False),
                HubSpotOwner(owner_id="303", name="Old Owner", archived=True),
                HubSpotOwner(owner_id="304", name=None, archived=False),
            ]
        )
        await session.commit()


async def staff(world: World, email: str = JO) -> User:
    async with world.factory() as session:
        return await admin.create_person(
            session,
            email=email,
            username="josample",
            name="Jo Sample",
            role="staff",
            apps=["companies"],
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )


def row_for(people: list[dict[str, object]], person_id: uuid.UUID) -> dict[str, object]:
    return next(row for row in people if row["id"] == str(person_id))


@pytest.mark.integration
async def test_an_admin_sees_sets_and_clears_who_a_person_is_in_hubspot(
    world: World, browser: httpx.AsyncClient
) -> None:
    await our_copy(world.factory)
    await make_account(world)
    jo = await staff(world)
    matched = await add_account(world.factory, "lee.sample@contourinteriors.com.au", "305", "email")
    assert (await sign_in(browser)).status_code == 200

    owners = await browser.get(OWNERS)
    assert owners.status_code == 200, owners.text
    assert owners.json() == [
        {"id": "302", "name": "alex Example"},  # by name, in any case
        {"id": "301", "name": "Jo Sample"},
        {"id": "304", "name": None},  # an owner with no name comes last; archived ones never
    ]
    assert "@" not in owners.text
    assert len((await browser.get(OWNERS, params={"limit": 1})).json()) == 1
    assert (await browser.get(OWNERS, params={"limit": 501})).status_code == 422

    people = (await browser.get(PEOPLE)).json()
    assert row_for(people, jo.id)["hubspot_owner"] is None
    # A sync's match shows too, with no name when the owner isn't in our copy.
    assert row_for(people, matched)["hubspot_owner"] == {
        "id": "305",
        "name": None,
        "matched_by": "email",
    }

    path = f"{PEOPLE}/{jo.id}/hubspot-owner"
    chosen = await browser.put(path, json={"owner_id": " 301 "})
    assert chosen.status_code == 200, chosen.text
    by_hand = {"id": "301", "name": "Jo Sample", "matched_by": "person"}
    assert chosen.json()["hubspot_owner"] == by_hand
    assert row_for((await browser.get(PEOPLE)).json(), jo.id)["hubspot_owner"] == by_hand

    for refused in ("303", "999", ""):  # archived, unknown, empty
        answer = await browser.put(path, json={"owner_id": refused})
        assert answer.status_code == 422, refused
        error = answer.json()["errors"][0]
        assert error == {
            "field": "body.owner_id",
            "message": "This isn't an active HubSpot owner. Pick one from the list.",
        }
    assert (await browser.put(path, json={})).status_code == 422  # say it, even to clear it
    assert row_for((await browser.get(PEOPLE)).json(), jo.id)["hubspot_owner"] == by_hand

    cleared = await browser.put(path, json={"owner_id": None})
    assert cleared.status_code == 200 and cleared.json()["hubspot_owner"] is None
    async with world.factory() as session:
        user = await session.get(User, jo.id)
        assert user is not None
        assert (user.hubspot_owner_id, user.hubspot_owner_matched_by) == (None, None)

    missing = await browser.put(f"{PEOPLE}/{uuid.uuid4()}/hubspot-owner", json={"owner_id": "301"})
    assert missing.status_code == 404 and missing.json()["title"] == "No such person"

    async with world.factory() as session:
        entries = list(
            await session.scalars(
                select(AuditEntry)
                .where(AuditEntry.event == "account_changed", AuditEntry.user_id == jo.id)
                .order_by(AuditEntry.id)
            )
        )
    assert [entry.details for entry in entries] == [
        {"fields": ["hubspot_owner"], "hubspot_owner_id": "301"},
        {"fields": ["hubspot_owner"], "hubspot_owner_id": None},
    ]


@pytest.mark.integration
async def test_only_an_admin_may_see_or_change_who_a_person_is_in_hubspot(
    world: World, browser: httpx.AsyncClient
) -> None:
    await our_copy(world.factory)
    jo = await staff(world)
    path = f"{PEOPLE}/{jo.id}/hubspot-owner"
    async with world.browser() as stranger:  # no session: the guard answers
        assert (await stranger.get(OWNERS)).status_code == 401
        assert (await stranger.put(path, json={"owner_id": "301"})).status_code == 401

    assert (await sign_in(browser, login="josample")).status_code == 200
    for answer in (
        await browser.get(OWNERS),
        await browser.put(path, json={"owner_id": "301"}),
        await browser.get(PEOPLE),
    ):
        assert answer.status_code == 403 and answer.json()["code"] == "admin_only"
    async with world.factory() as session:
        user = await session.get(User, jo.id)
        assert user is not None and user.hubspot_owner_id is None


@pytest.mark.integration
async def test_with_sign_in_off_the_owner_routes_need_no_account(
    world: World, browser: httpx.AsyncClient
) -> None:
    world.settings(auth_required=False)
    await our_copy(world.factory)
    jo = await add_account(world.factory, JO)
    assert [owner["id"] for owner in (await browser.get(OWNERS)).json()] == ["302", "301", "304"]
    chosen = await browser.put(f"{PEOPLE}/{jo}/hubspot-owner", json={"owner_id": "302"})
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["hubspot_owner"]["matched_by"] == "person"
