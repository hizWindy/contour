"""Who may use which project (PLAN-V9 E1): the Lead Finder tick, walked over every Lead Finder
route, the core routes that hold Lead Finder data, and the People tab."""

import re
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from core.api.routes import api_routes
from core.auth import admin
from core.auth.models import AuditEntry, User
from tests.core.auth_world import FAST, GOOD, World, build_world, make_account, me, sign_in

pytestmark = pytest.mark.integration
LF = "/api/v1/lead-finder"
PEOPLE = "/api/v1/people"


@pytest.fixture
def world(session_factory: Any) -> World:
    return build_world(session_factory)


async def person(world: World, login: str, *, role: str = "staff", apps: list[str]) -> User:
    async with world.factory() as db:
        return await admin.create_person(
            db,
            email=f"{login}@example.test",
            username=login,
            name=login.title(),
            role=role,
            apps=apps,
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )


def lead_finder_routes(app: FastAPI) -> list[tuple[str, str]]:
    found = [
        (method, route.path)
        for route in api_routes(app)
        if route.path.startswith(LF)
        for method in sorted(route.methods)
    ]
    assert len(found) > 20  # every Lead Finder route, so a new one is walked too
    return found


def filled(path: str) -> str:
    return re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)


CORE_LEAD_FINDER_DATA = [
    ("GET", "/api/v1/runs", None),
    ("GET", "/api/v1/runs?app=lead_finder", None),
    ("GET", "/api/v1/runs/summary", None),
    ("POST", "/api/v1/runs", {"app": "lead_finder", "mode": "discovery", "params": {}}),
    ("POST", "/api/v1/runs/estimate", {"app": "lead_finder", "mode": "discovery", "params": {}}),
    ("GET", "/api/v1/searches", None),
    ("GET", "/api/v1/searches?app=lead_finder", None),
    ("GET", "/api/v1/memory/search?q=dairy%20company", None),
    ("POST", "/api/v1/memory", {"app": "lead_finder", "kind": "note", "content": "A note."}),
]


async def test_every_lead_finder_route_refuses_a_person_without_the_tick(world: World) -> None:
    await person(world, "sam", apps=[])
    # A stand-in run engine: the check comes before the engine is ever asked for anything.
    world.app.state.run_manager = object()
    async with world.browser() as client:
        assert (await sign_in(client, login="sam")).status_code == 200
        for method, path in lead_finder_routes(world.app):
            answer = await client.request(method, filled(path), json={})
            assert answer.status_code == 403, (method, path, answer.status_code, answer.text)
            assert answer.json()["code"] == "app_not_allowed"
        for method, path, body in CORE_LEAD_FINDER_DATA:
            answer = await client.request(method, path, json=body)
            assert answer.status_code == 403, (method, path, answer.status_code, answer.text)
        assert (await me(client)).json()["user"]["apps"] == []


async def test_with_the_tick_every_lead_finder_route_is_open(world: World) -> None:
    await person(world, "marcus", apps=["lead_finder"])
    async with world.browser() as client:
        assert (await sign_in(client, login="marcus")).status_code == 200
        for method, path in lead_finder_routes(world.app):
            answer = await client.request(method, filled(path), json={})
            assert answer.status_code != 403, (method, path, answer.text)
        for path in ("rules", "leads", "leads/facets", "leads/reject-reasons"):
            assert (await client.get(f"{LF}/{path}")).status_code == 200, path
        assert (await client.get("/api/v1/runs?app=lead_finder")).status_code != 403
        assert (await me(client)).json()["user"]["apps"] == ["lead_finder"]


async def test_an_admin_needs_no_tick(world: World) -> None:
    await make_account(world)  # an Admin with no projects listed
    async with world.browser() as client:
        assert (await sign_in(client)).status_code == 200
        assert (await client.get(f"{LF}/rules")).status_code == 200
        assert (await client.get("/api/v1/runs")).status_code != 403


# --- The People tab ------------------------------------------------------------------------------


async def test_an_admin_adds_a_person_with_the_tick_and_they_can_sign_in(world: World) -> None:
    await make_account(world)
    async with world.browser() as admin_browser:
        await sign_in(admin_browser)
        added = await admin_browser.post(
            PEOPLE,
            json={
                "name": "Marcus Lee",
                "email": "Marcus@Example.test",
                "role": "staff",
                "apps": ["lead_finder"],
                "password": GOOD,
            },
        )
        assert added.status_code == 201, added.text
        body = added.json()
        assert (body["email"], body["role"], body["apps"]) == (
            "marcus@example.test",
            "staff",
            ["lead_finder"],
        )
        assert "password" not in body
        listed = (await admin_browser.get(PEOPLE)).json()
        assert [p["email"] for p in listed] == ["al.khair@example.test", "marcus@example.test"]

        weak = await admin_browser.post(
            PEOPLE,
            json={"name": "Weak", "email": "weak@example.test", "password": "password1"},
        )
        assert weak.status_code == 422
        assert weak.json()["errors"][0]["field"] == "body.password"
        again = await admin_browser.post(
            PEOPLE,
            json={"name": "Again", "email": "marcus@example.test", "password": GOOD},
        )
        assert again.status_code == 422 and again.json()["errors"][0]["field"] == "body.email"
        unknown = await admin_browser.post(
            PEOPLE,
            json={"name": "X", "email": "x@example.test", "apps": ["nothing"], "password": GOOD},
        )
        assert unknown.status_code == 422 and unknown.json()["errors"][0]["field"] == "body.apps"

    async with world.browser() as marcus:
        assert (await sign_in(marcus, login="marcus@example.test")).status_code == 200
        assert (await marcus.get(f"{LF}/rules")).status_code == 200
        assert (await marcus.get(PEOPLE)).status_code == 403  # Admins only


async def test_taking_the_tick_away_closes_the_lead_finder(world: World) -> None:
    await make_account(world)
    marcus = await person(world, "marcus", apps=["lead_finder"])
    async with world.browser() as admin_browser, world.browser() as marcus_browser:
        await sign_in(admin_browser)
        await sign_in(marcus_browser, login="marcus")
        assert (await marcus_browser.get(f"{LF}/rules")).status_code == 200

        changed = await admin_browser.patch(f"{PEOPLE}/{marcus.id}", json={"apps": []})
        assert changed.status_code == 200 and changed.json()["apps"] == []
        assert (await marcus_browser.get(f"{LF}/rules")).status_code == 403

    async with world.factory() as db:
        entries = list(
            await db.scalars(select(AuditEntry).where(AuditEntry.event == "account_changed"))
        )
    assert len(entries) == 1 and entries[0].details["apps"] == []


async def test_an_admin_cant_lock_themselves_out(world: World) -> None:
    me_admin = await make_account(world)
    async with world.browser() as client:
        await sign_in(client)
        demote = await client.patch(f"{PEOPLE}/{me_admin.id}", json={"role": "staff"})
        assert demote.status_code == 422
        off = await client.patch(f"{PEOPLE}/{me_admin.id}", json={"active": False})
        assert off.status_code == 422
        missing = await client.patch(f"{PEOPLE}/{uuid.uuid4()}", json={"apps": []})
        assert missing.status_code == 404
