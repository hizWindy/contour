"""PLAN-V26 Part 3: who asked is saved, and the Activity routes."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from fastapi import Request

from apps.companies import assistant, notes
from apps.companies.tables import CallNote, MeetingForm, Prep
from core import work
from core.auth.models import User
from core.claude.client import Reply
from core.claude.pricing import Usage
from core.runs.models import Run
from core.searches.models import SearchLog
from core.searches.service import log_reply
from core.work import Work
from tests.core.auth_world import (
    FIREFOX,
    World,
    all_rows,
    make_account,
    make_platform_admin,
    me,
    sign_in,
)

pytestmark = pytest.mark.integration

WHEN = datetime(2026, 11, 4, 1, 0, tzinfo=UTC)  # noon in Melbourne
TABS = ("sign-ins", "devices", "calls", "preps", "sent", "spending")


@dataclass
class Team:
    world: World
    admin: httpx.AsyncClient
    jo: httpx.AsyncClient  # signed in
    admin_user: User
    jo_user: User

    def path(self, tail: str) -> str:
        return f"/api/v1/people/{self.jo_user.id}/{tail}"

    async def tab(self, name: str, offset: int = 0) -> dict[str, Any]:
        answer = await self.admin.get(self.path(f"activity/{name}"), params={"offset": offset})
        assert answer.status_code == 200, answer.text
        body: dict[str, Any] = answer.json()
        return body

    async def save(self, *rows: Any) -> None:
        async with self.world.factory() as db:
            db.add_all(rows)
            await db.commit()


@pytest.fixture
async def team(world: World) -> AsyncIterator[Team]:
    boss = await make_platform_admin(world)
    jo = await make_account(
        world, email="jo@example.test", username="jsample", name="Jo Sample", role="staff"
    )
    async with world.browser() as admin, world.browser(FIREFOX, ip="203.0.113.9") as browser:
        assert (await sign_in(admin)).status_code == 200
        assert (await sign_in(browser, login="jsample")).status_code == 200
        yield Team(world, admin, browser, boss, jo)


def search(user_id: uuid.UUID | None, step: str, cost: str, **more: Any) -> SearchLog:
    values = {"created_at": WHEN, "app": "companies", **more}
    return SearchLog(
        user_id=user_id,
        step=step,
        model="claude-opus-5-5",
        cost_usd=Decimal(cost),
        answer_ok=True,
        **values,
    )


# --- T3-1. Save who asked ----------------------------------------------------------------


async def test_a_request_carries_who_asked(team: Team) -> None:
    seen: list[Work] = []

    async def who(request: Request) -> None:
        seen.append(work.current())

    team.world.app.add_api_route("/api/v1/test-who", who)
    route = team.world.app.router.routes.pop()  # ahead of the website's catch-all, if there is one
    team.world.app.router.routes.insert(0, route)
    assert (await team.jo.get("/api/v1/test-who")).status_code == 200
    assert seen == [Work("people", team.jo_user.id)]


@pytest.mark.parametrize("step", ["prep:script", notes.STEP, assistant.STEP])
async def test_a_prep_a_note_and_the_assistant_save_the_person(team: Team, step: str) -> None:
    reply = cast(
        Reply[Any],
        SimpleNamespace(
            model="claude-opus-5-5",
            queries=(),
            sources=(),
            usage=Usage(),
            cost_usd=Decimal("0.05"),
            stop_reason="end_turn",
            parsed=object(),
            request_id=f"req-{step}",
        ),
    )
    async with team.world.factory() as db:
        with work.doing(Work("people", team.jo_user.id)):
            log_reply(db, reply, app="companies", step=step)
        log_reply(db, reply, app="companies", step=step)  # a scheduled job: nobody
        await db.commit()
    saved = [row.user_id for row in await all_rows(team.world, SearchLog)]
    assert sorted(saved, key=str) == sorted([team.jo_user.id, None], key=str)


# --- T3-2. The Activity routes -----------------------------------------------------------


async def test_calls_preps_and_sent_list_the_persons_own_newest_first(team: Team) -> None:
    mine, other = team.jo_user.id, team.admin_user.id

    def note(user: uuid.UUID, minutes: int, status: str, name: str | None) -> CallNote:
        at = WHEN + timedelta(minutes=minutes)
        return CallNote(
            made_by=user,
            company_key="101" if name else None,
            company_name=name,
            company_heard=None if name else "North Wind",
            person_name="Jo Example",
            text="No answer",
            source="typed",
            called_at=at,
            finished_at=at if status == "logged" else None,
            status=status,
        )

    await team.save(
        note(mine, 1, "to_confirm", "Northwind"),
        note(mine, 2, "logged", "Northwind"),
        note(mine, 3, "needs_company", None),
        note(other, 4, "logged", "Sample Logistics"),
        Prep(made_by=mine, company_key="101", company_name="Northwind", status="ready"),
        Prep(made_by=other, company_key="102", company_name="Sample Logistics", status="ready"),
        MeetingForm(
            sent_by=mine,
            sent_at=WHEN + timedelta(minutes=9),
            company_key="101",
            company_name="Northwind",
            title="First meeting",
            starts_at=WHEN,
            status="sent",
        ),
    )
    calls = await team.tab("calls")
    assert calls["total"] == 3
    assert [(row["what"], row["state"]) for row in calls["items"]] == [
        ("North Wind", "Needs a company"),
        ("Northwind", "In HubSpot"),
        ("Northwind", "To confirm"),
    ]
    preps = await team.tab("preps")
    assert [(row["what"], row["state"]) for row in preps["items"]] == [("Northwind", "Ready")]
    sent = await team.tab("sent")
    assert [row["state"] for row in sent["items"]] == ["Pre-read to the team", "Call to HubSpot"]


async def test_spending_is_by_melbourne_day_and_by_kind(team: Team) -> None:
    mine, run = team.jo_user.id, uuid.uuid4()
    late = datetime(2026, 11, 4, 14, 0, tzinfo=UTC)  # 1 am on the 5th in Melbourne
    await team.save(
        search(mine, "prep:web", "0.10"),
        search(mine, "prep:script", "0.05"),
        search(mine, notes.STEP, "0.02"),
        search(mine, assistant.STEP, "0.01", created_at=late),
        search(mine, "discover", "1.50", app="lead_finder", run_id=run),
        search(team.admin_user.id, "prep:web", "9.00"),
        search(None, "prep:web", "7.00"),  # from before PLAN-V26: nobody's
    )
    spent = await team.tab("spending")
    assert [(r["day"], r["kind"], r["requests"]) for r in spent["items"]] == [
        ("2026-11-05", "The Assistant", 1),
        ("2026-11-04", "Call notes", 1),
        ("2026-11-04", "Preps", 2),
        ("2026-11-04", "Runs", 1),
    ]
    assert Decimal(spent["items"][2]["cost_usd"]) == Decimal("0.15")
    assert (spent["total"], Decimal(spent["total_usd"])) == (4, Decimal("1.68"))


async def test_each_list_is_paged_fifty_at_a_time(team: Team) -> None:
    rows = [
        Prep(
            made_by=team.jo_user.id,
            company_key=str(number),
            company_name=f"Sample {number:02}",
            status="ready",
            created_at=WHEN + timedelta(minutes=number),
        )
        for number in range(53)
    ]
    await team.save(*rows)
    first, second = await team.tab("preps"), await team.tab("preps", 50)
    assert (first["total"], len(first["items"]), len(second["items"])) == (53, 50, 3)
    assert first["items"][0]["what"] == "Sample 52"
    assert [row["what"] for row in second["items"]] == ["Sample 02", "Sample 01", "Sample 00"]


async def test_spending_and_sign_ins_page_fifty_at_a_time(team: Team) -> None:
    for day in range(52):
        await team.save(
            search(team.jo_user.id, "prep:web", "0.01", created_at=WHEN + timedelta(days=day))
        )
    spent = await team.tab("spending")
    assert (spent["total"], len(spent["items"])) == (52, 50)
    assert len((await team.tab("spending", 50))["items"]) == 2

    assert (await team.admin.post(team.path("sign-out"))).status_code == 200
    log = await team.tab("sign-ins")
    assert log["items"][0]["event"] == "sign_out_everywhere"
    assert log["items"][0]["device"] is None  # Jo didn't do it
    assert log["items"][0]["details"]["admin_name"] == "Al Khair"
    assert "account_created" in [row["event"] for row in log["items"]]


async def test_devices_list_each_browser_and_one_can_be_signed_out(team: Team) -> None:
    async with team.world.browser() as second:
        assert (await sign_in(second, login="jsample")).status_code == 200
        devices = await team.tab("devices")
        assert devices["total"] == 2
        firefox = next(d for d in devices["items"] if "Firefox" in d["device"])
        assert firefox["ip"] == "203.0.113.9"
        assert firefox["current"] is False

        out = await team.admin.post(team.path(f"devices/{firefox['id']}/sign-out"))
        assert out.json() == {"sessions_ended": 1}
        assert (await me(team.jo)).status_code == 401
        assert (await me(second)).status_code == 200  # only that browser
        assert (await team.tab("devices"))["total"] == 1

        logged = (await team.tab("sign-ins"))["items"][0]
        assert logged["event"] == "sign_out"
        assert logged["details"]["admin_id"] == str(team.admin_user.id)


async def test_sign_out_everywhere_ends_them_all(team: Team) -> None:
    async with team.world.browser() as second:
        assert (await sign_in(second, login="jsample")).status_code == 200
        out = await team.admin.post(team.path("sign-out"))
        assert out.json() == {"sessions_ended": 2}
        assert (await me(team.jo)).status_code == 401
        assert (await me(second)).status_code == 401
    assert (await me(team.admin)).status_code == 200


async def test_another_persons_browser_is_a_404_here(team: Team) -> None:
    own = await team.admin.get(f"/api/v1/people/{team.admin_user.id}/activity/devices")
    session = own.json()["items"][0]
    assert session["current"] is True
    refused = await team.admin.post(team.path(f"devices/{session['id']}/sign-out"))
    assert refused.status_code == 404
    assert (await me(team.admin)).status_code == 200


async def test_only_the_platform_admin_gets_in(team: Team) -> None:
    for tab in TABS:
        refused = await team.jo.get(team.path(f"activity/{tab}"))
        assert refused.status_code == 403, tab
        assert refused.json()["code"] == "platform_admin_only"
    for tail in ("sign-out", f"devices/{uuid.uuid4()}/sign-out"):
        assert (await team.jo.post(team.path(tail))).status_code == 403


async def test_nobody_is_a_404(team: Team) -> None:
    for tab in TABS:
        answer = await team.admin.get(f"/api/v1/people/{uuid.uuid4()}/activity/{tab}")
        assert answer.status_code == 404, tab


async def test_a_run_row_keeps_who_started_it(team: Team) -> None:
    await team.save(Run(app="lead_finder", mode="company", started_by=team.jo_user.id))
    assert [run.started_by for run in await all_rows(team.world, Run)] == [team.jo_user.id]
