"""The Lead Finder's scheduled run on the test database (PLAN-V6 D2): a run that starts, the limits
that stop one, the saved choices, and the loop that calls it.

The run's own work is a stand-in that waits at a gate, so a test sees a run that is going and one
that has finished, with no Claude and no memory model. The estimate, the limits, the slot and the
start are the real ones.

Past prices: a new database has none, and the estimate then uses its placeholders (US$1.00 a
company and US$0.40 a slice), which put the default run at US$24.80, above the US$20 run limit. So
most tests first add 6 finished companies at US$0.30 and 6 slices at US$0.15, which make the
default run US$7.80 (12 searches and 20 companies): the plan's "about US$8".
"""

import asyncio
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import delete

from apps.lead_finder.jobs import (
    APP,
    DEFAULT_SETTINGS,
    DISCOVERY,
    JOBS,
    MODE,
    SLOT_TAKEN,
    discovery_running,
    start_discovery,
)
from apps.lead_finder.params import DiscoveryParams, default_triggers
from core.runs.manager import RunManager
from core.schedules import runner
from core.schedules.jobs import JobContext, JobSkipped
from core.schedules.models import Schedule
from core.schedules.runner import Scheduler
from core.searches.models import SearchLog
from tests.core.auth_world import Clock
from tests.core.runs_fakes import wait_until_idle
from tests.lead_finder.conftest import MakeLeadFinderManager
from tests.lead_finder.jobs_world import (
    FIRST_MONDAY,
    NOW,
    SMALL,
    Factory,
    Gate,
    add_past_prices,
    all_runs,
    get_schedule,
    spend_today,
    switch_on,
    the_schedule,
    waiting_kinds,
)
from tests.lead_finder.samples import FakeClaude

pytestmark = pytest.mark.integration

D = Decimal


@pytest.fixture
def gate() -> Gate:
    return Gate()


@pytest.fixture
def manager(make_lf_manager: MakeLeadFinderManager, gate: Gate) -> RunManager:
    return make_lf_manager(FakeClaude(), kinds=waiting_kinds(gate))


def context_for(manager: RunManager, schedule: Schedule) -> JobContext:
    app = FastAPI()
    app.state.run_manager = manager
    return JobContext(app, schedule.id, dict(schedule.settings), NOW)


async def refused(context: JobContext) -> str:
    with pytest.raises(JobSkipped) as skipped:
        await start_discovery(context)
    return skipped.value.reason


# --- A run that starts ----------------------------------------------------------------------------


async def test_the_default_choices_start_a_run_that_says_a_schedule_started_it(
    session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    await add_past_prices(session_factory)
    schedule = await the_schedule(session_factory)
    context = context_for(manager, schedule)
    assert await discovery_running(context) is False

    result = await start_discovery(context)

    run_id = uuid.UUID(result.ref)
    run = await manager.get_run(run_id)
    assert run.schedule_id == schedule.id
    assert (run.app, run.mode) == ("lead_finder", "discovery")
    assert run.params["cities"] == ["Melbourne", "Adelaide", "Perth"]
    assert run.params["since_days"] == 14
    assert run.params["triggers"] == default_triggers()
    assert run.params["area"] == {}
    await asyncio.wait_for(gate.entered.wait(), 10)
    assert (await manager.get_run(run_id)).status == "running"
    assert await discovery_running(context) is True  # this schedule's run is still going

    gate.release.set()
    await wait_until_idle(manager)
    assert (await manager.get_run(run_id)).status == "done"
    assert await discovery_running(context) is False


async def test_a_run_a_person_starts_has_no_schedule_and_the_list_tells_them_apart(
    session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    await add_past_prices(session_factory)
    schedule = await the_schedule(session_factory, SMALL)
    by_person = await manager.start(APP, MODE, {"cities": ["Perth"], "triggers": ["fast_growth"]})
    assert by_person.schedule_id is None
    gate.release.set()
    await wait_until_idle(manager)

    by_schedule = await start_discovery(context_for(manager, schedule))
    await wait_until_idle(manager)

    page = await manager.list_runs(app=APP)
    marks = {str(item.id): item.schedule_id for item in page.items}
    assert marks == {str(by_person.id): None, by_schedule.ref: schedule.id}


# --- The limits ----------------------------------------------------------------------------------


async def test_a_typical_run_above_the_run_limit_does_not_start(
    session_factory: Factory, manager: RunManager
) -> None:
    schedule = await the_schedule(session_factory)  # no past prices: the placeholders are used

    reason = await refused(context_for(manager, schedule))

    assert (
        "A typical run costs about US$24.80, which is more than the run limit of US$20.00."
        in reason
    )
    assert "US$1.00 a company, a default" in reason  # where the number came from
    assert await all_runs(session_factory) == []
    assert manager.active_run_ids == []


async def test_a_run_the_daily_limit_cannot_cover_does_not_start_until_there_is_room(
    session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    schedule = await the_schedule(session_factory, SMALL)
    context = context_for(manager, schedule)
    await spend_today(session_factory, "48")  # the daily limit is US$50: US$2.00 is left

    reason = await refused(context)

    assert reason == "A typical run costs about US$3.40, but only US$2.00 is left of today's limit."
    assert await all_runs(session_factory) == []

    # Once the day's spending is gone, the same choices start.
    async with session_factory() as db:
        await db.execute(delete(SearchLog))
        await db.commit()
    result = await start_discovery(context)
    assert (await manager.get_run(uuid.UUID(result.ref))).schedule_id == schedule.id


async def test_the_run_still_has_its_own_limits_while_it_works(
    session_factory: Factory, manager: RunManager
) -> None:
    schedule = await the_schedule(session_factory, SMALL)
    result = await start_discovery(context_for(manager, schedule))
    run = await manager.get_run(uuid.UUID(result.ref))
    # The saved cap lowers the run's company limit, and the run limit comes from Settings.
    assert run.caps.max_companies == 3
    assert run.caps.run_cap_usd == D("20.00")


# --- The saved choices ----------------------------------------------------------------------------


async def test_the_saved_choices_are_what_the_run_gets(
    session_factory: Factory, manager: RunManager
) -> None:
    choices = {
        "cities": ["Perth", "Adelaide"],
        "triggers": ["fast_growth"],
        "since_days": 7,
        "area": {"Perth": "cbd"},
        "caps": {"max_companies": 4},
    }
    schedule = await the_schedule(session_factory, choices)

    result = await start_discovery(context_for(manager, schedule))

    run = await manager.get_run(uuid.UUID(result.ref))
    assert run.params == DiscoveryParams.model_validate(choices).model_dump(mode="json")
    assert run.params["cities"] == ["Perth", "Adelaide"] and run.params["area"] == {"Perth": "cbd"}


async def test_the_default_schedule_saves_the_cities_the_signs_and_the_look_back(
    session_factory: Factory,
) -> None:
    schedule = await the_schedule(session_factory)
    assert schedule.settings == DEFAULT_SETTINGS
    assert (schedule.enabled, schedule.next_run_at) == (False, None)


@pytest.mark.parametrize(
    ("choices", "said"),
    [
        ({"cities": ["Atlantis"]}, "cities: Unknown city Atlantis."),
        ({"cities": ["Perth"], "cites": ["Perth"]}, "cites: Extra inputs are not permitted"),
        ({"cities": ["Perth"], "since_days": 10}, "since_days: Input should be 7, 14 or 30"),
        (
            {"cities": ["Perth"], "triggers": ["moon_landing"]},
            "triggers: Unknown trigger moon_landing.",
        ),
    ],
)
async def test_choices_that_cant_be_used_are_refused_in_plain_words_and_start_nothing(
    session_factory: Factory, manager: RunManager, choices: dict[str, Any], said: str
) -> None:
    schedule = await the_schedule(session_factory, choices)

    reason = await refused(context_for(manager, schedule))

    assert reason.startswith("The saved choices can't be used. ")
    assert said in reason
    assert await all_runs(session_factory) == []


# --- One run at a time ----------------------------------------------------------------------------


async def test_a_run_a_person_started_holds_the_slot(
    session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    await add_past_prices(session_factory)
    by_person = await manager.start(APP, MODE, {"cities": ["Perth"], "triggers": ["fast_growth"]})
    await asyncio.wait_for(gate.entered.wait(), 10)
    schedule = await the_schedule(session_factory)
    context = context_for(manager, schedule)

    assert await discovery_running(context) is False  # that run isn't this schedule's
    assert await refused(context) == SLOT_TAKEN
    assert [run.id for run in await all_runs(session_factory)] == [by_person.id]


async def test_a_run_another_schedule_started_is_not_this_schedules_run(
    session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    ours = await the_schedule(session_factory)
    async with session_factory() as db:
        other = Schedule(
            project="test", job="test.other", name="Another", every=1, unit="days", at_time=time(6)
        )
        db.add(other)
        await db.commit()
    await manager.start(APP, MODE, SMALL, schedule_id=other.id)
    await asyncio.wait_for(gate.entered.wait(), 10)

    assert await discovery_running(context_for(manager, other)) is True
    assert await discovery_running(context_for(manager, ours)) is False


# --- Called by the loop --------------------------------------------------------------------------


def make_loop(manager: RunManager, factory: Factory, clock: Clock) -> Scheduler:
    app = FastAPI()
    app.state.run_manager = manager
    return Scheduler(app=app, sessions=factory, jobs=JOBS, clock=clock)


def clock_at(moment: datetime) -> Clock:
    clock = Clock()
    clock.now = moment
    return clock


async def test_the_loop_starts_it_when_due_skips_it_while_it_goes_and_starts_it_again(
    session_factory: Factory, manager: RunManager, gate: Gate
) -> None:
    await add_past_prices(session_factory)
    schedule = await the_schedule(session_factory)
    await switch_on(session_factory, schedule)
    clock = clock_at(FIRST_MONDAY)
    loop = make_loop(manager, session_factory, clock)

    (first,) = await loop.tick()

    assert (first.job, first.status) == (DISCOVERY, "started")
    row = await get_schedule(session_factory, schedule.id)
    assert (row.last_status, row.last_ref, row.last_error) == ("started", first.ref, None)
    assert row.next_run_at == FIRST_MONDAY + timedelta(days=14)
    assert (await manager.get_run(uuid.UUID(str(first.ref)))).schedule_id == schedule.id

    # Two weeks later the first run is still going: this time is skipped, with the note.
    clock.now = FIRST_MONDAY + timedelta(days=14)
    (second,) = await loop.tick()
    assert (second.status, second.reason) == ("skipped", runner.STILL_RUNNING)
    assert len(await all_runs(session_factory)) == 1

    # It finishes. A fortnight after that, a second run starts.
    gate.release.set()
    await wait_until_idle(manager)
    clock.now = FIRST_MONDAY + timedelta(days=28)
    (third,) = await loop.tick()
    assert third.status == "started" and third.ref != first.ref
    assert len(await all_runs(session_factory)) == 2


async def test_the_reason_it_didnt_start_is_kept_on_the_schedule(
    session_factory: Factory, manager: RunManager
) -> None:
    schedule = await the_schedule(session_factory, SMALL)
    await switch_on(session_factory, schedule)
    await spend_today(session_factory, "48")
    loop = make_loop(manager, session_factory, clock_at(FIRST_MONDAY))

    (fired,) = await loop.tick()

    assert fired.status == "skipped"
    row = await get_schedule(session_factory, schedule.id)
    assert row.last_status == "skipped"
    assert (
        row.last_error
        == "A typical run costs about US$3.40, but only US$2.00 is left of today's limit."
    )
    assert row.last_ref is None
    assert row.next_run_at == FIRST_MONDAY + timedelta(days=14)  # it waits for its next time
    assert await all_runs(session_factory) == []
