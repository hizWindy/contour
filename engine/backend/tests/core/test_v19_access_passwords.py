"""PLAN-V19 Part 1 tests (T1-3 to T1-6): role ladder, eight feature ticks, starting
passphrases, and self-service password change."""

import logging
import re
import uuid
from typing import Any

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select, text

from core import cli
from core.api.app import create_app
from core.api.deps import settings_dependency
from core.auth import admin, passphrase
from core.auth.features import APPS_ORDER, FEATURES, ROLE_DEFAULT_FEATURES
from core.auth.models import AuditEntry, User, UserSession
from core.auth.passwords import check_rules
from core.config import Settings
from core.db.engine import get_engine
from core.hubspot.models import HubSpotMeeting
from tests.companies.helpers import API as COMPANIES_API
from tests.companies.helpers import a_small_copy, add, soon
from tests.companies.helpers import person as company_person
from tests.core.auth_world import (
    API as AUTH_API,
)
from tests.core.auth_world import (
    CHROME,
    FAST,
    FIREFOX,
    GOOD,
    START,
    World,
    all_rows,
    make_account,
    make_platform_admin,
    me,
    sign_in,
)

# Routes that explicitly do NOT carry a tick/role guard beyond session sign-in / public status:
PUBLIC_ROUTES = {("GET", "/api/v1/health"), ("POST", "/api/v1/auth/login")}
SELF_AUTH_ROUTES = {
    ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/auth/logout-everywhere"),
    ("POST", "/api/v1/auth/password"),
    ("GET", "/api/v1/auth/me"),
    ("GET", "/api/v1/auth/sessions"),
}
SHARED_SIGNED_IN_READS = {("GET", "/api/v1/schedules")}

ALL_EIGHT = set(FEATURES)


def _route_guards(route: APIRoute) -> list[tuple[Any, ...]]:
    found: list[tuple[Any, ...]] = []

    def walk(dep: Any) -> None:
        mark = getattr(dep.call, "_contour_guard", None)
        if mark is not None:
            found.append(mark)
        for sub in dep.dependencies:
            walk(sub)

    walk(route.dependant)
    return found


def test_every_api_route_has_an_explicit_access_guard() -> None:
    """Every route on create_app() must declare its tick/role/app guard or be an explicit
    public, self-auth, or shared-read route (PLAN-V19 T1-4)."""
    app = create_app()
    unguarded: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        guards = _route_guards(route)
        for method in sorted(route.methods or ()):
            key = (method, route.path)
            if key in PUBLIC_ROUTES or key in SELF_AUTH_ROUTES or key in SHARED_SIGNED_IN_READS:
                continue
            if not guards:
                unguarded.append(key)
                continue
            has_write_guard = any(
                g[0] in {"role", "app_access"} or (g[0] == "feature" and g[2] is True)
                for g in guards
            )
            if method in {"POST", "PUT", "PATCH", "DELETE"} and not has_write_guard:
                unguarded.append((method, f"{route.path} (missing write guard: {guards})"))
    assert unguarded == []


def test_generated_starting_passphrases_follow_shape_and_pass_password_rules() -> None:
    """1,000 generated passphrases match word-word-word-NN and satisfy check_rules (T1-5)."""
    words = passphrase.word_list()
    assert len(words) >= 2000
    assert all(word.isascii() and word.isalpha() and len(word) >= 4 for word in words)
    samples = [
        passphrase.generate_password(email="alex.sample@example.test", username="alexsample")
        for _ in range(1000)
    ]
    assert len(set(samples)) > 990
    for item in samples:
        assert re.fullmatch(r"[a-z]{4,}-[a-z]{4,}-[a-z]{4,}-\d{2}", item), item
        assert check_rules(item, email="alex.sample@example.test", username="alexsample") == []


@pytest.mark.integration
async def test_role_ladder_platform_admin_vs_admin_for_admin_settings_and_team_tools(
    world: World,
) -> None:
    """T1-3: Platform admin opens every Admin setting; plain Admin gets 403 `platform_admin_only`
    on Admin settings while still opening team style notes & team call notes."""
    boss = await make_platform_admin(world, email="boss@example.test", username="boss", name="Boss")
    mid = await make_account(world, email="mid@example.test", username="mid", name="Mid Admin")
    staff = await company_person(world, "sam", apps=["companies", "lead_finder"], role="staff")

    admin_settings_requests: list[tuple[str, str, Any]] = [
        ("GET", "/api/v1/people", None),
        ("POST", "/api/v1/people", {"name": "New", "email": "new@example.test"}),
        ("PATCH", f"/api/v1/people/{staff.id}", {"position": "Associate"}),
        ("POST", f"/api/v1/people/{staff.id}/password", None),
        ("PUT", f"/api/v1/people/{staff.id}/hubspot-owner", {"owner_id": None}),
        ("GET", "/api/v1/auth/log", None),
        ("GET", "/api/v1/health/details", None),
        ("GET", "/api/v1/settings", None),
        ("PATCH", "/api/v1/settings", {"values": {}}),
        ("DELETE", "/api/v1/settings/run_max_companies", None),
        ("PUT", "/api/v1/schedules/lead-finder", {"cities": ["Melbourne"]}),
        ("GET", "/api/v1/sources", None),
        ("POST", "/api/v1/sources/property_daily/check", None),
        ("POST", "/api/v1/sources/property_daily/resume", None),
        ("GET", "/api/v1/hubspot/summary", None),
        ("GET", "/api/v1/hubspot/status", None),
        ("POST", "/api/v1/hubspot/sync", None),
        ("GET", "/api/v1/hubspot/syncs", None),
        ("POST", "/api/v1/hubspot/syncs/1/cancel", None),
        ("GET", "/api/v1/hubspot/writes", None),
        ("GET", "/api/v1/hubspot/owners", None),
        ("POST", "/api/v1/lead-finder/tests/run", None),
        ("GET", "/api/v1/lead-finder/tests", None),
        ("GET", f"/api/v1/lead-finder/tests/{uuid.uuid4()}", None),
        (
            "POST",
            "/api/v1/memory",
            {"app": "lead_finder", "kind": "note", "content": "Note text"},
        ),
        ("GET", "/api/v1/memory/search?q=note", None),
    ]

    async with world.browser() as admin_browser, world.browser() as boss_browser:
        world.app.dependency_overrides[settings_dependency] = lambda: Settings(
            _env_file=None,
            auth_required=True,
            call_notes_enabled=True,
        )
        assert (await sign_in(admin_browser, login="mid")).status_code == 200
        assert (await sign_in(boss_browser, login="boss")).status_code == 200

        for method, path, body in admin_settings_requests:
            denied = await admin_browser.request(method, path, json=body)
            assert denied.status_code == 403, (method, path, denied.status_code, denied.text)
            assert denied.json()["code"] == "platform_admin_only", (method, path)
            assert "Platform admin" in denied.json()["detail"]

        # Platform admin opens Admin settings (non-403).
        for method, path, body in (
            ("GET", "/api/v1/people", None),
            ("GET", "/api/v1/auth/log", None),
            ("GET", "/api/v1/settings", None),
            ("GET", "/api/v1/sources", None),
            ("GET", "/api/v1/hubspot/owners", None),
            ("GET", "/api/v1/lead-finder/tests", None),
        ):
            ok = await boss_browser.request(method, path, json=body)
            assert ok.status_code != 403, (method, path, ok.status_code, ok.text)

        # Plain Admin still sets team tone and manages team style notes & sees team call notes.
        tone_ok = await admin_browser.put(
            f"{COMPANIES_API}/script-style/team-tone", json={"tone": "direct"}
        )
        assert tone_ok.status_code == 200
        notes_ok = await admin_browser.get(f"{COMPANIES_API}/call-notes", params={"mine": "false"})
        assert notes_ok.status_code == 200

        for _target_id in (boss.id,):
            demote = await boss_browser.patch(
                f"/api/v1/people/{_target_id}", json={"role": "admin"}
            )
            assert demote.status_code == 422
            assert demote.json()["errors"][0]["field"] == "body.role"

    assert boss.id != mid.id


@pytest.mark.integration
def test_cli_set_platform_admin_swaps_role_atomically(
    world: World, capsys: pytest.CaptureFixture[str]
) -> None:
    """`engine set-platform-admin <email>` hands Platform admin cleanly to another Admin."""
    import asyncio

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from core.runtime import loop_factory

    del world  # World fixture truncates core.users cleanly before CLI runs.

    def seed() -> tuple[uuid.UUID, uuid.UUID]:
        async def _run() -> tuple[uuid.UUID, uuid.UUID]:
            engine = get_engine()
            factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with factory() as db:
                first = await admin.create_admin(
                    db,
                    email="first@example.test",
                    username="first",
                    name="First Boss",
                    password=GOOD,
                    now=START,
                    hasher=FAST,
                    role="platform_admin",
                )
                second = await admin.create_admin(
                    db,
                    email="second@example.test",
                    username="second",
                    name="Second Admin",
                    password=GOOD,
                    now=START,
                    hasher=FAST,
                    role="admin",
                )
                return first.id, second.id

        return asyncio.run(_run(), loop_factory=loop_factory())

    first_id, second_id = seed()
    asyncio.run(get_engine().dispose(), loop_factory=loop_factory())

    code = cli.main(["set-platform-admin", "second@example.test"])
    out = capsys.readouterr()
    assert code == 0, out.err
    assert "second@example.test" in out.out

    async def read_roles() -> dict[uuid.UUID, str]:
        engine = get_engine()
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as db:
            rows = list(await db.scalars(select(User)))
            return {row.id: row.role for row in rows}

    roles = asyncio.run(read_roles(), loop_factory=loop_factory())
    asyncio.run(get_engine().dispose(), loop_factory=loop_factory())
    assert roles == {first_id: "admin", second_id: "platform_admin"}


@pytest.mark.integration
async def test_staff_with_only_call_logs_and_viewer_read_only_enforcement(world: World) -> None:
    """T1-4: Staff with only Call logs opens call-notes + company picker, gets 403 on Meetings
    naming the Platform admin; Viewer gets 403 `viewer_read_only` on changes but keeps `/auth/*`."""
    await make_platform_admin(world, name="Al-khair Pama")
    await a_small_copy(world)
    await add(
        world,
        HubSpotMeeting(
            hubspot_id="9001",
            hubspot_company_id="101",
            title="Intro call",
            starts_at=soon(2),
            ends_at=soon(2),
        ),
    )
    async with world.factory() as db:
        await admin.create_person(
            db,
            email="caller@example.test",
            username="caller",
            name="Caller Only",
            role="staff",
            features=["companies.call_logs"],
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
        await admin.create_person(
            db,
            email="viewer@example.test",
            username="looker",
            name="Read Only",
            role="viewer",
            features=ROLE_DEFAULT_FEATURES["viewer"],
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )

    world.app.dependency_overrides[settings_dependency] = lambda: Settings(
        _env_file=None,
        auth_required=True,
        call_notes_enabled=True,
        meeting_forms_enabled=True,
    )
    async with world.browser() as staff_browser, world.browser() as viewer_browser:
        assert (await sign_in(staff_browser, login="caller")).status_code == 200
        assert (await sign_in(viewer_browser, login="looker")).status_code == 200

        # Staff with only Call logs: Call logs + company picker open (200), Meetings refused (403).
        assert (await staff_browser.get(f"{COMPANIES_API}/call-notes")).status_code == 200
        assert (await staff_browser.get(COMPANIES_API)).status_code == 200
        assert (
            await staff_browser.get(f"{COMPANIES_API}/search", params={"q": "abc"})
        ).status_code == 200
        denied_meeting = await staff_browser.get(f"{COMPANIES_API}/meetings")
        assert denied_meeting.status_code == 403
        assert denied_meeting.json()["code"] == "feature_not_allowed"
        assert denied_meeting.json()["detail"] == (
            "You don't have access to Meetings. Ask Al-khair Pama to turn it on."
        )
        denied_company_card = await staff_browser.get(f"{COMPANIES_API}/101")
        assert denied_company_card.status_code == 403
        assert denied_company_card.json()["code"] == "feature_not_allowed"

        # Viewer: reads open, every change gives 403 `viewer_read_only`.
        assert (await viewer_browser.get(f"{COMPANIES_API}")).status_code == 200
        assert (await viewer_browser.get(f"{COMPANIES_API}/call-notes")).status_code == 200
        assert (await viewer_browser.get(f"{COMPANIES_API}/meetings")).status_code == 200
        for method, path, body in (
            ("POST", f"{COMPANIES_API}/call-notes", {"company_key": "101", "text": "Hi"}),
            ("POST", f"{COMPANIES_API}/preps", {"company_key": "101", "cold": True}),
            ("POST", f"{COMPANIES_API}/meetings/sync", None),
            ("POST", "/api/v1/runs", {"app": "lead_finder", "mode": "discovery"}),
            ("PATCH", f"/api/v1/lead-finder/leads/{uuid.uuid4()}", {"status": "watch"}),
            (
                "POST",
                "/api/v1/lead-finder/review/status",
                {"lead_ids": [str(uuid.uuid4())], "status": "watch"},
            ),
        ):
            blocked = await viewer_browser.request(method, path, json=body)
            assert blocked.status_code == 403, (method, path, blocked.status_code, blocked.text)
            assert blocked.json()["code"] == "viewer_read_only", (method, path)
            assert "Al-khair Pama" in blocked.json()["detail"]

        # Viewer still uses self-auth endpoints.
        assert (await me(viewer_browser)).status_code == 200
        assert (await viewer_browser.get(f"{AUTH_API}/sessions")).status_code == 200


@pytest.mark.integration
async def test_admin_creates_and_resets_passphrases_without_logging_secrets(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    """T1-5: Starting password generated on create & reset, never stored or logged."""
    caplog.set_level(logging.DEBUG)
    await make_platform_admin(world)
    async with (
        world.browser() as boss,
        world.browser(CHROME) as rep_a,
        world.browser(FIREFOX) as rep_b,
    ):
        assert (await sign_in(boss)).status_code == 200
        created = await boss.post(
            "/api/v1/people",
            json={
                "name": "Jo Sample",
                "email": "jo.sample@example.test",
                "position": "Sales Rep",
                "role": "staff",
                "features": ["companies.call_logs"],
            },
        )
        assert created.status_code == 201, created.text
        assert created.headers.get("cache-control") == "no-store"
        person = created.json()
        start_pw = person["starting_password"]
        assert re.fullmatch(r"[a-z]{4,}-[a-z]{4,}-[a-z]{4,}-\d{2}", start_pw)
        assert person["position"] == "Sales Rep"

        assert (
            await sign_in(rep_a, login="jo.sample@example.test", password=start_pw)
        ).status_code == 200
        assert (await me(rep_a)).json()["first_sign_in"] is True
        assert (
            await sign_in(rep_b, login="jo.sample@example.test", password=start_pw)
        ).status_code == 200

        reset = await boss.post(f"/api/v1/people/{person['id']}/password")
        assert reset.status_code == 200, reset.text
        assert reset.headers.get("cache-control") == "no-store"
        new_start_pw = reset.json()["starting_password"]
        assert new_start_pw != start_pw
        assert re.fullmatch(r"[a-z]{4,}-[a-z]{4,}-[a-z]{4,}-\d{2}", new_start_pw)

        # Reset signs out every session for that person.
        for browser in (rep_a, rep_b):
            gone = await me(browser)
            assert gone.status_code == 401 and gone.json()["reason"] == "ended"

        # New starting password works.
        assert (
            await sign_in(rep_a, login="jo.sample@example.test", password=new_start_pw)
        ).status_code == 200

    # No starting password ever hit logs or core.users/core.audit_log.
    for secret in (start_pw, new_start_pw):
        assert secret not in caplog.text
    async with world.factory() as db:
        for table in ("core.users", "core.audit_log"):
            rows = await db.execute(text(f"SELECT row_to_json(t)::text FROM {table} t"))
            dump = " ".join(r[0] for r in rows)
            assert start_pw not in dump and new_start_pw not in dump


@pytest.mark.integration
async def test_self_service_password_change_ends_other_sessions_and_throttles_wrong_tries(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    """T1-6: POST /auth/password checks current password, applies rules & throttle, updates
    password, keeps current browser signed in, ends other sessions, clears first_sign_in."""
    caplog.set_level(logging.DEBUG)
    await make_platform_admin(world)
    async with world.browser() as boss:
        await sign_in(boss)
        created = (
            await boss.post(
                "/api/v1/people",
                json={"name": "Jo", "email": "jo@example.test", "role": "staff"},
            )
        ).json()
        start_pw = created["starting_password"]

    chosen_pw = "cobalt-meadow-timber-88-fresh"
    async with world.browser(CHROME) as phone, world.browser(FIREFOX) as laptop:
        assert (await sign_in(phone, login="jo@example.test", password=start_pw)).status_code == 200
        assert (await me(phone)).json()["first_sign_in"] is True
        assert (
            await sign_in(laptop, login="jo@example.test", password=start_pw)
        ).status_code == 200

        # Weak new password -> 422 before changing.
        weak = await laptop.post(
            f"{AUTH_API}/password", json={"current": start_pw, "new": "too-short"}
        )
        assert weak.status_code == 422
        assert weak.json()["errors"][0]["field"] == "body.new"

        # Wrong current -> 422 `wrong_password`, keeping session alive.
        wrong = await laptop.post(
            f"{AUTH_API}/password", json={"current": "not-the-right-passphrase", "new": chosen_pw}
        )
        assert wrong.status_code == 422
        assert wrong.json()["code"] == "wrong_password"
        assert wrong.json()["detail"] == "That isn't your current password."
        assert (await me(laptop)).status_code == 200

        # Valid change -> 204 no-store, phone signed out, laptop keeps valid session.
        changed = await laptop.post(
            f"{AUTH_API}/password", json={"current": start_pw, "new": chosen_pw}
        )
        assert changed.status_code == 204, changed.text
        assert changed.headers.get("cache-control") == "no-store"

        phone_me = await me(phone)
        assert phone_me.status_code == 401 and phone_me.json()["reason"] == "ended"
        laptop_me = await me(laptop)
        assert laptop_me.status_code == 200 and laptop_me.json()["first_sign_in"] is False

        # Old password fails, new password works, and 10th wrong current try locks (429).
        async with world.browser() as check_login:
            assert (
                await check_login.post(
                    f"{AUTH_API}/login", json={"login": "jo@example.test", "password": start_pw}
                )
            ).status_code == 401
            assert (
                await check_login.post(
                    f"{AUTH_API}/login", json={"login": "jo@example.test", "password": chosen_pw}
                )
            ).status_code == 200
        for attempt in range(9):
            resp = await laptop.post(
                f"{AUTH_API}/password",
                json={"current": f"wrong-attempt-{attempt}", "new": "another-good-phrase-99"},
            )
            assert resp.status_code in (422, 429)
            if resp.status_code == 429:
                assert resp.json()["code"] == "too_many_attempts"
                break
        else:
            final_lock = await laptop.post(
                f"{AUTH_API}/password",
                json={"current": "final-wrong-attempt", "new": "another-good-phrase-99"},
            )
            assert final_lock.status_code == 429
            assert final_lock.json()["code"] == "too_many_attempts"

    assert chosen_pw not in caplog.text
    entries = [e for e in await all_rows(world, AuditEntry) if e.event == "password_changed"]
    assert entries and all(chosen_pw not in str(e.details) for e in entries)
    sessions = [
        s for s in await all_rows(world, UserSession) if s.user_id == uuid.UUID(created["id"])
    ]
    assert len(sessions) >= 3
    assert sum(1 for s in sessions if s.ended_at is None) == 2  # laptop + check_login
    assert sum(1 for s in sessions if s.ended_at is not None) >= 1  # phone was ended
    assert set(APPS_ORDER) == {"lead_finder", "companies"} and ALL_EIGHT
