"""The automatic runs' goal and limits (9 Nov, Al-khair): a run a schedule starts aims for its share
of the round's good leads, has the automatic run's money limit (US$150) and no company limit of its
own; a run a person starts keeps its own limits. The scheduler loop is the real one; Claude is the
saved sample answers, so nothing is spent."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from apps.lead_finder.goal import Round, goal_for_run, good_of, round_so_far, run_goal
from apps.lead_finder.jobs import JOBS, job_key, settings_for, start_discovery
from apps.lead_finder.run_email import round_line
from apps.lead_finder.tables import Lead
from core.runs.manager import RunManager
from core.runs.models import Run, RunEvent
from core.schedules import service
from core.schedules.jobs import JobContext
from core.schedules.models import Schedule
from core.schedules.runner import Scheduler
from tests.core.auth_world import Clock
from tests.core.runs_fakes import wait_until_idle
from tests.lead_finder.conftest import APP, MakeLeadFinderManager, lf_settings
from tests.lead_finder.jobs_world import FIRST_MONDAY, NOW, Factory, add_past_prices, switch_on
from tests.lead_finder.samples import FakeClaude, candidate

D = Decimal

# --- The share of the goal (pure) ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("goal", "found", "runs_left", "on", "share"),
    [
        (100, 0, 4, 4, 25),  # Monday: a quarter of 100
        (100, 18, 3, 4, 28),  # Melbourne found 18: the other 3 share 82, rounded up
        (100, 70, 1, 4, 30),  # Thursday makes up what is left
        (100, 120, 1, 4, 25),  # met already: a city still aims for its plain share
        (100, 99, 1, 4, 1),
        (90, 0, 4, 4, 23),  # 90 / 4, rounded up
        (100, 0, 2, 2, 50),  # only 2 cities on
    ],
)
def test_each_run_aims_for_its_share_of_what_is_still_needed(
    goal: int, found: int, runs_left: int, on: int, share: int
) -> None:
    assert run_goal(goal, found, runs_left, on) == share


def test_good_leads_are_a_pass_or_a_director_review() -> None:
    assert good_of({"by_result": {"pass": 2, "director_review": 3, "watch": 7, "drop": 1}}) == 5
    assert good_of(None) == 0


def test_the_email_line_says_how_far_the_round_is() -> None:
    state = Round(goal=100, found=62, spent_usd=D("80.4"), runs=3, schedules_on=4, runs_left=1)
    assert (
        round_line(state)
        == "This round so far: 62 of 100 good leads, US$80.40 spent (3 city runs)."
    )
    met = Round(goal=100, found=104, spent_usd=D("120"), runs=4, schedules_on=4, runs_left=1)
    assert round_line(met).endswith("The goal is reached.")


# --- Runs on the test database -------------------------------------------------------------------

FIVE = {
    ("lease_ending", "Melbourne"): [
        candidate(f"Sample Company {letter}", website=f"sample{letter.lower()}.com.au")
        for letter in "ABCDE"
    ]
}
CHOICES = {"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30}


async def schedule_of(factory: Factory, city: str, *, on: bool = False) -> Schedule:
    async with factory() as db:
        await service.ensure_defaults(db, JOBS, NOW)
        row = await db.scalar(select(Schedule).where(Schedule.job == job_key(city)))
        assert row is not None
        row.settings = {**settings_for(city), "triggers": ["lease_ending"], "since_days": 30}
        await db.commit()
    if on:
        await switch_on(factory, row)
    return row


def context(manager: RunManager, schedule: Schedule) -> JobContext:
    app = FastAPI()
    app.state.run_manager = manager
    return JobContext(app, schedule.id, dict(schedule.settings), NOW)


async def finished_run(manager: RunManager, factory: Factory, run_id: uuid.UUID) -> Run:
    await wait_until_idle(manager, timeout=60)
    async with factory() as db:
        row = await db.get(Run, run_id)
        assert row is not None
        return row


async def skips_of(factory: Factory, run_id: uuid.UUID) -> list[str]:
    async with factory() as db:
        rows = await db.scalars(
            select(RunEvent).where(RunEvent.run_id == run_id, RunEvent.type == "company_skipped")
        )
        return [str(row.data.get("reason")) for row in rows]


def one_at_a_time(**values: Any) -> Any:
    return lf_settings(run_company_concurrency=1, **values)


@pytest.mark.integration
async def test_an_automatic_run_stops_at_its_goal(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    schedule = await schedule_of(session_factory, "Melbourne")
    manager = make_lf_manager(
        FakeClaude(scenario=FIVE), settings=one_at_a_time(lead_finder_goal_good_leads=2)
    )

    started = await start_discovery(context(manager, schedule))
    run = await finished_run(manager, session_factory, uuid.UUID(started.ref or ""))

    assert run.status == "done" and run.stop_reason is None  # reaching the goal is not a stop
    assert good_of(run.counts) == 2
    assert run.counts["researched"] == 2  # 5 found, 2 were enough
    assert (await skips_of(session_factory, run.id)).count(
        "the run reached its goal of 2 good leads"
    ) == 3
    assert (D(run.caps["run_cap_usd"]), run.caps["max_companies"]) == (D("150.00"), 100)


@pytest.mark.integration
async def test_an_automatic_run_stops_when_no_company_is_left(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    schedule = await schedule_of(session_factory, "Melbourne")
    manager = make_lf_manager(FakeClaude(scenario=FIVE), settings=one_at_a_time())  # goal 100

    started = await start_discovery(context(manager, schedule))
    run = await finished_run(manager, session_factory, uuid.UUID(started.ref or ""))

    assert run.status == "done" and run.stop_reason is None
    assert run.counts["researched"] == 5  # every company it found, far under 100
    assert not any("goal" in reason for reason in await skips_of(session_factory, run.id))


@pytest.mark.integration
async def test_a_run_a_person_starts_keeps_its_own_limits(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    manager = make_lf_manager(
        FakeClaude(scenario=FIVE),
        settings=one_at_a_time(run_max_companies=3, lead_finder_goal_good_leads=1),
    )

    made = await manager.start(APP, "discovery", CHOICES)
    run = await finished_run(manager, session_factory, made.id)

    assert run.schedule_id is None
    assert (D(run.caps["run_cap_usd"]), run.caps["max_companies"]) == (D("20.00"), 3)
    assert run.counts["researched"] == 3  # its company limit, and no goal (it would be 1)
    assert not any("goal" in reason for reason in await skips_of(session_factory, run.id))


@pytest.mark.integration
async def test_a_city_that_falls_short_leaves_more_for_the_next(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    await add_past_prices(session_factory)
    melbourne = await schedule_of(session_factory, "Melbourne", on=True)
    adelaide = await schedule_of(session_factory, "Adelaide", on=True)
    one = {("lease_ending", "Melbourne"): [candidate("Sample Only", website="sampleonly.com.au")]}
    manager = make_lf_manager(
        FakeClaude(scenario=one), settings=one_at_a_time(lead_finder_goal_good_leads=10)
    )

    # Before anything: 2 cities on, so each aims for 5.
    async with session_factory() as db:
        first_goal = await goal_for_run(db, 10, datetime.now(UTC), uuid.uuid4(), melbourne.id)
    assert first_goal == 5

    started = await start_discovery(context(manager, melbourne))
    run = await finished_run(manager, session_factory, uuid.UUID(started.ref or ""))
    assert good_of(run.counts) == 1  # Melbourne found only 1

    async with session_factory() as db:
        state = await round_so_far(db, 10, datetime.now(UTC), schedule_id=adelaide.id)
        next_goal = await goal_for_run(db, 10, datetime.now(UTC), uuid.uuid4(), adelaide.id)
    assert (state.found, state.runs, state.runs_left) == (1, 1, 1)
    assert next_goal == 9  # Adelaide makes up the 9 still needed


@pytest.mark.integration
async def test_the_scheduler_loop_starts_an_automatic_run_with_the_automatic_limits(
    make_lf_manager: MakeLeadFinderManager, session_factory: Factory
) -> None:
    """The real loop: a city schedule that is on and due starts a run, with US$150, up to 100
    companies and its share of the goal; the loop then waits for the next time, 2 weeks on."""
    await add_past_prices(session_factory)
    schedule = await schedule_of(session_factory, "Melbourne", on=True)
    manager = make_lf_manager(
        FakeClaude(scenario=FIVE), settings=one_at_a_time(lead_finder_goal_good_leads=3)
    )
    app = FastAPI()
    app.state.run_manager = manager
    clock = Clock()
    clock.now = FIRST_MONDAY
    loop = Scheduler(app=app, sessions=session_factory, jobs=JOBS, clock=clock)

    (fired,) = await loop.tick()

    assert fired.status == "started", fired.reason
    run = await finished_run(manager, session_factory, uuid.UUID(fired.ref or ""))
    assert run.schedule_id == schedule.id
    assert (D(run.caps["run_cap_usd"]), run.caps["max_companies"]) == (D("150.00"), 100)
    assert good_of(run.counts) == 3  # one city on: its share is the whole goal of 3
    async with session_factory() as db:
        row = await db.get(Schedule, schedule.id, populate_existing=True)
        assert row is not None
        assert row.last_status == "started"
        assert row.next_run_at is not None and (row.next_run_at - FIRST_MONDAY).days == 14
    assert await loop.tick() == []  # nothing is due again until then
    async with session_factory() as db:
        leads = list(await db.scalars(select(Lead).where(Lead.run_id == run.id)))
    assert len(leads) == 3
