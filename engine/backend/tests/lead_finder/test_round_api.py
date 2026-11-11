"""The city schedules as one control and the round's budget (PLAN-V13 T1-3), on the test database.

- `GET` and `PUT /api/v1/schedules/lead-finder` through the real app (sign-in off unless a test
  says otherwise). The clock is Monday 16 Nov 2026, 10:00 am in Melbourne.
- The budget at a real start: the run manager is real, its work is a stand-in that ends at once,
  so nothing is spent.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, text

from apps.lead_finder.goal import round_window, spent_reason
from apps.lead_finder.jobs import JOBS, ZONE, job_key, start_discovery
from core.prefs.models import Setting
from core.runs.models import Run
from core.schedules import service
from core.schedules.jobs import JobContext, JobSkipped
from core.schedules.models import Schedule
from core.schedules.runner import Scheduler
from tests.core.auth_world import Clock, World, build_world, make_account, sign_in
from tests.core.runs_fakes import wait_until_idle
from tests.lead_finder.conftest import MakeLeadFinderManager, lf_settings
from tests.lead_finder.jobs_world import Factory, Gate, add_past_prices, waiting_kinds
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration

D = Decimal
URL = "/api/v1/schedules/lead-finder"
NOW = datetime(2026, 11, 15, 23, 0, tzinfo=UTC)  # Mon 16 Nov, 10:00 am Melbourne
CITIES = ("Melbourne", "Adelaide", "Perth", "Sydney")


def melbourne(day: date, at: time = time(7, 0)) -> datetime:
    return datetime.combine(day, at, tzinfo=UTC) - timedelta(hours=11)


def plan(**values: Any) -> dict[str, Any]:
    return {
        "enabled": True,
        "cities": list(CITIES),
        "every": 2,
        "unit": "weeks",
        "weekday": 0,
        "at": "07:00",
        "budget_usd": "150.00",
        **values,
    }


async def rows_of(factory: Factory) -> dict[str, Schedule]:
    async with factory() as db:
        rows = await db.scalars(select(Schedule).where(Schedule.job.startswith("lead_finder.")))
        return {row.job: row for row in rows}


@pytest.fixture
def world(session_factory: Factory) -> World:
    return build_world(session_factory)


@pytest.fixture
async def client(world: World) -> AsyncIterator[httpx.AsyncClient]:
    world.settings(auth_required=False)  # sign-in off, as on the laptop
    world.clock.now = NOW
    async with world.browser() as browser:
        yield browser


# --- The control ----------------------------------------------------------------------------------


async def test_picking_two_cities_turns_the_other_two_off(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    saved = await client.put(URL, json=plan(cities=["Sydney", "Perth"], weekday=2))
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (body["enabled"], body["cities"], body["weekday"]) == (True, ["Perth", "Sydney"], 2)
    assert body["when"] == "Every 2 weeks from Wednesday at 7:00 am"
    assert body["summary"] == (
        "Next round: Wed 18 Nov, 7:00 am. Perth Wed, Sydney Thu. Up to US$150."
    )
    by_city = {item["city"]: item for item in body["city_plan"]}
    assert [item["city"] for item in body["city_plan"]] == list(CITIES)
    assert {city: item["enabled"] for city, item in by_city.items()} == {
        "Melbourne": False,
        "Adelaide": False,
        "Perth": True,
        "Sydney": True,
    }
    assert (by_city["Perth"]["day"], by_city["Sydney"]["day"]) == ("Wednesday", "Thursday")

    rows = await rows_of(session_factory)
    perth, sydney = rows[job_key("Perth")], rows[job_key("Sydney")]
    assert (perth.next_run_at, sydney.next_run_at) == (
        melbourne(date(2026, 11, 18)),
        melbourne(date(2026, 11, 19)),
    )
    assert rows[job_key("Melbourne")].next_run_at is None
    assert all(
        row.settings["since_days"] == 14
        for row in rows.values()
        if row.job != "lead_finder.discovery"
    )

    again = await client.get(URL)
    assert again.json() == body  # it reads back the same


async def test_switching_off_keeps_the_cities_for_next_time(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    await client.put(URL, json=plan(cities=["Perth", "Sydney"], weekday=2))
    off = (
        await client.put(URL, json=plan(cities=["Perth", "Sydney"], weekday=2, enabled=False))
    ).json()
    assert (off["enabled"], off["cities"], off["weekday"]) == (False, ["Perth", "Sydney"], 2)
    assert off["summary"].startswith("When it is on, the next round would be: Wed 18 Nov")
    rows = await rows_of(session_factory)
    assert not any(row.enabled for row in rows.values())


async def test_every_n_days_puts_the_cities_one_day_apart(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    saved = await client.put(URL, json=plan(unit="days", every=30, weekday=5))
    assert saved.status_code == 200, saved.text
    assert saved.json()["when"] == "Every 30 days from Saturday at 7:00 am"
    rows = await rows_of(session_factory)
    firsts = [rows[job_key(city)].next_run_at for city in CITIES]
    assert firsts == [melbourne(date(2026, 11, 21 + index)) for index in range(4)]
    assert all(rows[job_key(city)].weekday is None for city in CITIES)
    assert all(rows[job_key(city)].settings["since_days"] == 30 for city in CITIES)


async def test_a_plan_that_cant_be_kept_changes_nothing(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    await client.put(URL, json=plan(cities=["Perth"], weekday=2))
    before = {
        job: (row.enabled, row.next_run_at) for job, row in (await rows_of(session_factory)).items()
    }

    too_often = await client.put(URL, json=plan(unit="days", every=3))
    assert too_often.status_code == 422
    assert too_often.json()["errors"][0]["field"] == "body.every"

    too_dear = await client.put(URL, json=plan(budget_usd="500.00"))
    assert too_dear.status_code == 422
    assert too_dear.json()["errors"][0]["field"] == "body.budget_usd"
    assert "200" in too_dear.json()["errors"][0]["message"]  # the ceiling

    after = {
        job: (row.enabled, row.next_run_at) for job, row in (await rows_of(session_factory)).items()
    }
    assert after == before


async def test_the_budget_is_the_setting(
    client: httpx.AsyncClient, session_factory: Factory
) -> None:
    saved = (await client.put(URL, json=plan(budget_usd="120.50"))).json()
    assert D(saved["budget_usd"]) == D("120.50")
    assert (D(saved["budget_max_usd"]), D(saved["run_cap_usd"])) == (D("200"), D("150"))
    settings = (await client.get("/api/v1/settings")).json()
    field = next(item for item in settings["fields"] if item["key"] == "lead_finder_round_cap_usd")
    assert field["value"] == "120.50"
    async with session_factory() as db:
        record = await db.scalar(select(Setting.value).where(Setting.key == "lead_finder_round"))
    assert record == {"cities": list(CITIES), "weekday": 0}


async def test_only_an_admin_may_save(world: World, session_factory: Factory) -> None:
    world.settings(auth_required=True)
    world.clock.now = NOW
    await make_account(world)
    async with session_factory() as db:
        await db.execute(text("UPDATE core.users SET role = 'staff', apps = '{lead_finder}'"))
        await db.commit()
    async with world.browser() as browser:
        assert (await sign_in(browser)).status_code == 200
        assert (await browser.get(URL)).status_code == 200  # reading needs only the project
        refused = await browser.put(URL, json=plan())
        assert (refused.status_code, refused.json()["code"]) == (403, "admin_only")
    assert not any(row.enabled for row in (await rows_of(session_factory)).values())


# --- The budget at a start ------------------------------------------------------------------------


SMALL = {"triggers": ["lease_ending"], "since_days": 14}


async def city_rows(factory: Factory, now: datetime) -> dict[str, Schedule]:
    """Melbourne and Adelaide on, as a round that began yesterday: Melbourne ran and its next time
    moved 2 weeks on; Adelaide's time is now."""
    async with factory() as db:
        await service.ensure_defaults(db, JOBS, now)
        rows = {row.job: row for row in await db.scalars(select(Schedule))}
        for city, first in (("Melbourne", now + timedelta(days=13)), ("Adelaide", now)):
            row = rows[job_key(city)]
            row.enabled, row.next_run_at = True, first
            row.settings = {"cities": [city], **SMALL}
        await db.commit()
        return rows


async def melbourne_spent(factory: Factory, rows: dict[str, Schedule], dollars: str) -> None:
    async with factory() as db:
        db.add(
            Run(
                app="lead_finder",
                mode="discovery",
                status="done",
                cost_usd=D(dollars),
                schedule_id=rows[job_key("Melbourne")].id,
            )
        )
        await db.commit()


def finished_at_once() -> Gate:
    gate = Gate()
    gate.release.set()
    return gate


async def test_adelaide_gets_what_melbourne_left_of_the_round(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    """Melbourne spent US$40 of US$150, so Adelaide may spend US$110."""
    await add_past_prices(session_factory)
    now = datetime.now(UTC)
    rows = await city_rows(session_factory, now)
    await melbourne_spent(session_factory, rows, "40")
    manager = make_lf_manager(FakeClaude(), kinds=waiting_kinds(finished_at_once()))
    app = FastAPI()
    app.state.run_manager = manager
    adelaide = rows[job_key("Adelaide")]

    started = await start_discovery(JobContext(app, adelaide.id, dict(adelaide.settings), now))
    await wait_until_idle(manager, timeout=30)
    async with session_factory() as db:
        run = await db.get(Run, uuid.UUID(started.ref))
    assert run is not None
    assert D(run.caps["run_cap_usd"]) == D("110.00")
    assert D(run.params["caps"]["run_cap_usd"]) == D("110.00")  # saved with the run


async def test_a_full_budget_leaves_the_run_its_own_cap(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    now = datetime.now(UTC)
    rows = await city_rows(session_factory, now)
    manager = make_lf_manager(FakeClaude(), kinds=waiting_kinds(finished_at_once()))
    app = FastAPI()
    app.state.run_manager = manager
    adelaide = rows[job_key("Adelaide")]
    started = await start_discovery(JobContext(app, adelaide.id, dict(adelaide.settings), now))
    await wait_until_idle(manager, timeout=30)
    async with session_factory() as db:
        run = await db.get(Run, uuid.UUID(started.ref))
    assert run is not None
    assert D(run.caps["run_cap_usd"]) == D("150.00")
    assert (run.params.get("caps") or {}).get("run_cap_usd") is None  # nothing lowered


async def test_a_spent_round_stops_the_next_city_and_its_schedule_says_why(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    now = datetime.now(UTC)
    rows = await city_rows(session_factory, now)
    await melbourne_spent(session_factory, rows, "150")
    manager = make_lf_manager(
        FakeClaude(), settings=lf_settings(), kinds=waiting_kinds(finished_at_once())
    )
    app = FastAPI()
    app.state.run_manager = manager
    clock = Clock()
    clock.now = now
    loop = Scheduler(app=app, sessions=session_factory, jobs=JOBS, clock=clock)

    fired = await loop.run_now(rows[job_key("Adelaide")].id)

    async with session_factory() as db:
        schedules = list(await db.scalars(select(Schedule)))
        adelaide = await db.get(Schedule, rows[job_key("Adelaide")].id, populate_existing=True)
        runs = list(await db.scalars(select(Run)))
    next_round = round_window(schedules, now).next_start
    assert next_round is not None
    reason = spent_reason(D("150"), next_round, ZONE)
    assert reason.startswith("This round's budget (US$150) is spent. Next round: ")
    assert (fired.status, fired.reason) == ("skipped", reason)
    assert adelaide is not None and (adelaide.last_status, adelaide.last_error) == (
        "skipped",
        reason,
    )
    assert len(runs) == 1  # only Melbourne's: Adelaide didn't start


async def test_a_lowered_cap_too_small_for_the_searches_says_so(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    now = datetime.now(UTC)
    rows = await city_rows(session_factory, now)
    await melbourne_spent(session_factory, rows, "149.50")  # US$0.50 left: not one search fits
    manager = make_lf_manager(FakeClaude(), kinds=waiting_kinds(finished_at_once()))
    app = FastAPI()
    app.state.run_manager = manager
    adelaide = rows[job_key("Adelaide")]
    with pytest.raises(JobSkipped) as skipped:
        await start_discovery(JobContext(app, adelaide.id, dict(adelaide.settings), now))
    assert skipped.value.reason.startswith(
        "Only US$0.50 is left of this round's budget (US$150), too little for a run."
    )
