"""Schedules (PLAN-V6 D1), on the test database: the table's rules, the default schedules, and the
loop that starts what is due.

Melbourne is UTC+11 from 4 Oct 2026, so Monday 9 Nov 2026 at 7:00 am there is 2026-11-08 20:00 UTC.
The jobs here are fakes that record how they were called, and the clock is the test's own.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.hubspot.models import HubSpotSync
from core.hubspot.sync import SyncAlreadyRunning
from core.schedules import calc, runner, service
from core.schedules import runtime as schedules_runtime
from core.schedules.calc import Cadence
from core.schedules.core_jobs import (
    CORE_JOBS,
    HUBSPOT_SYNC,
    hubspot_sync_running,
    start_hubspot_sync,
)
from core.schedules.jobs import DefaultSchedule, JobContext, JobResult, JobSkipped, JobSpec
from core.schedules.models import Schedule
from core.schedules.runner import Scheduler
from tests.core.auth_world import Clock

pytestmark = pytest.mark.integration

Factory = async_sessionmaker[AsyncSession]
MEL = ZoneInfo("Australia/Melbourne")
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)  # Wednesday 4 Nov, 8:00 pm in Melbourne
FORTNIGHTLY = Cadence(every=2, unit="weeks", weekday=0, at=time(7, 0))  # every 2 weeks, Monday 7:00
DAILY = Cadence(every=1, unit="days", at=time(6, 0))
FIRST_MONDAY = datetime(2026, 11, 8, 20, 0, tzinfo=UTC)  # Mon 9 Nov 7:00 am Melbourne


@dataclass
class Fake:
    """A job that records its calls, and does what the test tells it to."""

    key: str = "test.job"
    calls: list[JobContext] = field(default_factory=list)
    is_running: bool = False
    raises: Exception | None = None

    async def start(self, context: JobContext) -> JobResult:
        self.calls.append(context)
        if self.raises is not None:
            raise self.raises
        return JobResult(ref=f"run:{len(self.calls)}")

    async def running(self, context: JobContext) -> bool:
        return self.is_running

    def spec(self, default: DefaultSchedule | None = None) -> JobSpec:
        return JobSpec(
            key=self.key,
            project="test",
            title="A test job",
            start=self.start,
            running=self.running,
            default=default,
        )


def scheduler(factory: Factory, clock: Clock, *fakes: Fake, **extra: Any) -> Scheduler:
    return Scheduler(
        app=FastAPI(),
        sessions=factory,
        jobs=[fake.spec() for fake in fakes],
        clock=clock,
        **extra,
    )


def make_clock(at: datetime = NOW) -> Clock:
    clock = Clock()
    clock.now = at
    return clock


async def add_schedule(
    factory: Factory,
    cadence: Cadence = FORTNIGHTLY,
    *,
    job: str = "test.job",
    enabled: bool = True,
    next_run_at: datetime | None = None,
    **changes: Any,
) -> uuid.UUID:
    values: dict[str, Any] = {
        "project": "test",
        "job": job,
        "name": "A test job",
        "every": cadence.every,
        "unit": cadence.unit,
        "weekday": cadence.weekday,
        "at_time": cadence.at,
        "timezone": cadence.zone,
        "enabled": enabled,
        "next_run_at": (next_run_at or calc.first_run(cadence, NOW)) if enabled else None,
        **changes,
    }
    row = Schedule(**values)
    async with factory() as db:
        db.add(row)
        await db.commit()
    return row.id


async def get(factory: Factory, schedule_id: uuid.UUID) -> Schedule:
    async with factory() as db:
        row = await db.get(Schedule, schedule_id)
        assert row is not None
        return row


# --- The table's rules ------------------------------------------------------------------------


async def test_a_new_schedule_is_off_with_the_melbourne_zone(session_factory: Factory) -> None:
    schedule_id = await add_schedule(session_factory, enabled=False)
    row = await get(session_factory, schedule_id)
    assert (row.enabled, row.next_run_at, row.timezone) == (False, None, "Australia/Melbourne")
    assert (row.settings, row.last_status, row.last_ref, row.last_error) == ({}, None, None, None)
    assert row.created_at is not None and row.updated_at is not None


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"every": 0}, "ck_schedules_every"),
        ({"unit": "months", "weekday": None}, "ck_schedules_unit"),
        ({"weekday": None}, "ck_schedules_weekday"),  # in weeks, so it needs a weekday
        ({"unit": "days", "weekday": 2}, "ck_schedules_weekday"),  # in days, so it has none
        ({"weekday": 7}, "ck_schedules_weekday_range"),
        ({"weekday": -1}, "ck_schedules_weekday_range"),
        ({"enabled": True, "next_run_at": None}, "ck_schedules_next_run"),  # on, but no next time
        ({"enabled": False, "next_run_at": FIRST_MONDAY}, "ck_schedules_next_run"),  # off, with one
        ({"last_status": "lost"}, "ck_schedules_last_status"),
    ],
)
async def test_the_table_refuses_a_schedule_that_makes_no_sense(
    session_factory: Factory, changes: dict[str, Any], constraint: str
) -> None:
    values: dict[str, Any] = {
        "project": "test",
        "job": "test.job",
        "name": "x",
        "every": 2,
        "unit": "weeks",
        "weekday": 0,
        "at_time": time(7, 0),
        **changes,
    }
    values.setdefault("enabled", False)
    with pytest.raises(IntegrityError, match=constraint):
        async with session_factory() as db:
            db.add(Schedule(**values))
            await db.commit()


async def test_one_schedule_for_each_job(session_factory: Factory) -> None:
    await add_schedule(session_factory, enabled=False)
    with pytest.raises(IntegrityError, match="uq_schedules_job"):
        await add_schedule(session_factory, enabled=False)


async def test_a_hubspot_sync_may_be_started_by_a_schedule(session_factory: Factory) -> None:
    async with session_factory() as db:
        db.add(HubSpotSync(mode="changes", trigger="schedule", status="running"))
        await db.commit()
    with pytest.raises(IntegrityError, match="ck_hubspot_syncs_trigger"):
        async with session_factory() as db:
            db.add(HubSpotSync(mode="changes", trigger="robot", status="done", finished_at=NOW))
            await db.commit()


# --- The default schedules --------------------------------------------------------------------


def lead_finder_like() -> Fake:
    return Fake(key="lead_finder.discovery")


def defaults() -> list[JobSpec]:
    fortnightly_off = DefaultSchedule(cadence=FORTNIGHTLY, enabled=False, settings={"cities": 4})
    return [*CORE_JOBS, lead_finder_like().spec(default=fortnightly_off), Fake("x.none").spec()]


async def test_the_two_defaults_are_made_once(session_factory: Factory) -> None:
    async with session_factory() as db:
        made = await service.ensure_defaults(db, defaults(), NOW)
    assert sorted(made) == ["core.hubspot_sync", "lead_finder.discovery"]  # x.none has no default

    sync = (await _by_job(session_factory))[HUBSPOT_SYNC]
    assert (sync.enabled, sync.every, sync.unit, sync.weekday) == (True, 1, "days", None)
    assert (sync.at_time, sync.timezone, sync.settings) == (
        time(6, 0),
        "Australia/Melbourne",
        {"mode": "auto"},
    )
    assert sync.next_run_at == datetime(2026, 11, 4, 19, 0, tzinfo=UTC)  # Thu 5 Nov 6:00 Melbourne
    finder = (await _by_job(session_factory))["lead_finder.discovery"]
    # The Lead Finder's schedule starts OFF: each run costs money.
    assert (finder.enabled, finder.next_run_at) == (False, None)
    assert (finder.every, finder.unit, finder.weekday, finder.at_time) == (
        2,
        "weeks",
        0,
        time(7, 0),
    )
    assert finder.settings == {"cities": 4}


async def _by_job(factory: Factory) -> dict[str, Schedule]:
    async with factory() as db:
        return {row.job: row for row in await service.all_schedules(db)}


async def test_the_defaults_are_never_made_again_and_never_undo_a_persons_change(
    session_factory: Factory,
) -> None:
    async with session_factory() as db:
        await service.ensure_defaults(db, defaults(), NOW)
    async with session_factory() as db:
        sync = (await service.all_schedules(db))[0]
        assert sync.job == HUBSPOT_SYNC
        sync.enabled, sync.next_run_at = False, None  # a person switched it off
        sync.every = 3
        await db.commit()
    async with session_factory() as db:
        assert await service.ensure_defaults(db, defaults(), NOW + timedelta(days=30)) == []
    after = (await _by_job(session_factory))[HUBSPOT_SYNC]
    assert (after.enabled, after.next_run_at, after.every) == (False, None, 3)


# --- Starting what is due ---------------------------------------------------------------------


async def test_a_due_schedule_starts_once_and_moves_to_its_next_time(
    session_factory: Factory,
) -> None:
    fake = Fake()
    schedule_id = await add_schedule(session_factory, settings={"cities": ["Perth"]})
    clock = make_clock()
    loop = scheduler(session_factory, clock, fake)

    assert await loop.tick() == []  # Wednesday: not due until Monday
    clock.now = FIRST_MONDAY - timedelta(seconds=1)
    assert await loop.tick() == []
    clock.now = FIRST_MONDAY
    (fired,) = await loop.tick()
    assert (fired.job, fired.status, fired.ref) == ("test.job", "started", "run:1")

    (context,) = fake.calls
    assert context.schedule_id == schedule_id
    assert context.settings == {"cities": ["Perth"]}  # the schedule's own choices reach the job
    assert context.now == FIRST_MONDAY
    row = await get(session_factory, schedule_id)
    assert (row.last_status, row.last_ref, row.last_error) == ("started", "run:1", None)
    assert row.last_run_at == FIRST_MONDAY
    assert row.next_run_at == datetime(2026, 11, 22, 20, 0, tzinfo=UTC)  # Mon 23 Nov, 2 weeks on

    # Never twice: the same minute, a minute later, and a day later start nothing.
    for later in (timedelta(0), timedelta(minutes=1), timedelta(days=1), timedelta(days=13)):
        clock.now = FIRST_MONDAY + later
        assert await loop.tick() == []
    assert len(fake.calls) == 1


async def test_a_schedule_missed_while_the_backend_was_off_runs_once_when_it_is_back(
    session_factory: Factory,
) -> None:
    fake = Fake()
    schedule_id = await add_schedule(session_factory)  # due Mon 9 Nov; then 23 Nov, 7 Dec, 21 Dec
    clock = make_clock(datetime(2026, 12, 16, 0, 0, tzinfo=UTC))  # five weeks later
    loop = scheduler(session_factory, clock, fake)
    (fired,) = await loop.tick()
    assert fired.status == "started"
    assert len(fake.calls) == 1  # not once for each time it missed
    row = await get(session_factory, schedule_id)
    assert row.next_run_at == datetime(2026, 12, 20, 20, 0, tzinfo=UTC)  # Mon 21 Dec, its own day
    assert await loop.tick() == []


async def test_a_job_still_running_is_skipped_with_a_note_and_waits_for_its_next_time(
    session_factory: Factory,
) -> None:
    fake = Fake(is_running=True)
    schedule_id = await add_schedule(session_factory, next_run_at=NOW)
    loop = scheduler(session_factory, make_clock(), fake)
    (fired,) = await loop.tick()
    assert (fired.status, fired.reason) == ("skipped", runner.STILL_RUNNING)
    assert fake.calls == []  # it was not started on top of itself
    row = await get(session_factory, schedule_id)
    assert (row.last_status, row.last_error) == ("skipped", runner.STILL_RUNNING)
    assert row.next_run_at is not None and row.next_run_at > NOW  # not tried again every minute
    assert await loop.tick() == []


async def test_a_job_can_say_why_it_did_not_start(session_factory: Factory) -> None:
    fake = Fake(raises=JobSkipped("The run would cost more than today's cap allows."))
    schedule_id = await add_schedule(session_factory, next_run_at=NOW)
    (fired,) = await scheduler(session_factory, make_clock(), fake).tick()
    assert fired.status == "skipped"
    row = await get(session_factory, schedule_id)
    assert row.last_status == "skipped"
    assert row.last_error == "The run would cost more than today's cap allows."
    assert row.last_ref is None


async def test_a_job_that_fails_never_stops_the_loop_and_its_error_stays_in_the_log(
    session_factory: Factory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    broken = Fake(key="broken.job", raises=RuntimeError("the key is sk-secret-123"))
    fine = Fake(key="fine.job")
    await add_schedule(session_factory, job="broken.job", next_run_at=NOW)
    fine_id = await add_schedule(
        session_factory, job="fine.job", next_run_at=NOW + timedelta(seconds=1)
    )
    clock = make_clock(NOW + timedelta(minutes=1))
    fired = await scheduler(session_factory, clock, broken, fine).tick()
    assert [(f.job, f.status) for f in fired] == [("broken.job", "failed"), ("fine.job", "started")]
    rows = await _by_job(session_factory)
    assert rows["broken.job"].last_error == runner.COULD_NOT_START
    assert "secret" not in repr([row.last_error for row in rows.values()])  # a fixed sentence only
    assert (await get(session_factory, fine_id)).last_status == "started"
    assert "scheduled_job_failed" in caplog.text  # the details are in the log


async def test_a_schedule_that_is_off_never_starts(session_factory: Factory) -> None:
    fake = Fake()
    await add_schedule(session_factory, enabled=False)
    clock = make_clock(NOW + timedelta(days=400))
    assert await scheduler(session_factory, clock, fake).tick() == []
    assert fake.calls == []


async def test_switching_a_schedule_on_and_off_is_what_makes_it_due(
    session_factory: Factory,
) -> None:
    fake = Fake()
    schedule_id = await add_schedule(session_factory, enabled=False)
    clock = make_clock(FIRST_MONDAY + timedelta(hours=2))
    loop = scheduler(session_factory, clock, fake)
    assert await loop.tick() == []
    async with session_factory() as db:  # switched on: it gets its next time
        row = await db.get(Schedule, schedule_id)
        assert row is not None
        row.enabled = True
        row.next_run_at = calc.first_run(service.cadence_of(row), clock.now)
        await db.commit()
    assert await loop.tick() == []  # that is the Monday in two weeks' time: Monday 16 Nov
    clock.now = datetime(2026, 11, 15, 20, 0, tzinfo=UTC)
    assert [f.status for f in await loop.tick()] == ["started"]


async def test_a_schedule_whose_job_is_gone_fails_with_a_plain_sentence(
    session_factory: Factory,
) -> None:
    schedule_id = await add_schedule(session_factory, job="gone.job", next_run_at=NOW)
    (fired,) = await scheduler(session_factory, make_clock()).tick()
    assert (fired.status, fired.reason) == ("failed", runner.NOT_INSTALLED)
    assert (await get(session_factory, schedule_id)).next_run_at > NOW  # type: ignore[operator]


async def test_everything_due_starts_in_the_order_it_was_due(session_factory: Factory) -> None:
    first, second = Fake(key="a.job"), Fake(key="b.job")
    await add_schedule(session_factory, job="b.job", next_run_at=NOW - timedelta(hours=1))
    await add_schedule(session_factory, job="a.job", next_run_at=NOW - timedelta(hours=2))
    fired = await scheduler(session_factory, make_clock(), first, second).tick()
    assert [f.job for f in fired] == ["a.job", "b.job"]


async def test_two_loops_at_once_cannot_start_the_same_schedule_twice(
    session_factory: Factory,
) -> None:
    fake = Fake()
    await add_schedule(session_factory, next_run_at=NOW)
    clock = make_clock()
    one, two = scheduler(session_factory, clock, fake), scheduler(session_factory, clock, fake)
    fired = await asyncio.gather(*(loop.tick() for loop in (one, two, one, two)))
    assert sum(len(batch) for batch in fired) == 1
    assert len(fake.calls) == 1


async def test_a_backend_that_stopped_half_way_does_not_start_it_again(
    session_factory: Factory,
) -> None:
    fake = Fake()
    schedule_id = await add_schedule(
        session_factory, next_run_at=FIRST_MONDAY + timedelta(days=14), last_status="starting"
    )
    clock = make_clock(FIRST_MONDAY)
    loop = scheduler(session_factory, clock, fake, tick_seconds=0.01)
    await loop.start()  # the start of the next backend
    await loop.stop()
    row = await get(session_factory, schedule_id)
    assert (row.last_status, row.last_error) == ("failed", service.NOT_FINISHED)
    assert fake.calls == []


# --- The loop ---------------------------------------------------------------------------------


async def test_the_loop_starts_what_is_due_and_survives_a_bad_pass(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = Fake()
    await add_schedule(session_factory, next_run_at=NOW)
    loop = scheduler(session_factory, make_clock(), fake, tick_seconds=0.01)
    real = service.claim_due
    broken = {"once": True}

    async def sometimes_broken(db: AsyncSession, now: datetime) -> Any:
        if broken.pop("once", False):
            raise RuntimeError("the database blinked")
        return await real(db, now)

    monkeypatch.setattr(service, "claim_due", sometimes_broken)
    await loop.start()
    try:
        assert loop.running
        for _ in range(300):
            if fake.calls:
                break
            await asyncio.sleep(0.01)
    finally:
        await loop.stop()
    assert len(fake.calls) == 1  # the first pass failed, the second one worked
    assert not loop.running


async def test_the_loop_makes_the_default_schedules_when_it_starts(
    session_factory: Factory,
) -> None:
    loop = Scheduler(
        app=FastAPI(), sessions=session_factory, jobs=CORE_JOBS, clock=make_clock(), tick_seconds=5
    )
    await loop.start()
    await loop.stop()
    assert set(await _by_job(session_factory)) == {HUBSPOT_SYNC}


# --- Daylight saving, through the loop --------------------------------------------------------


async def test_7am_stays_7am_through_the_loop_when_the_clocks_change(
    session_factory: Factory,
) -> None:
    """Weekly on Monday at 7:00 am, from before to after 4 Oct 2026 (UTC+10 becomes UTC+11) and
    from before to after 4 Apr 2027 (back again)."""
    weekly = Cadence(every=1, unit="weeks", weekday=0, at=time(7, 0))
    fake = Fake()
    start = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    schedule_id = await add_schedule(
        session_factory, weekly, next_run_at=calc.first_run(weekly, start)
    )
    clock = make_clock(start)
    loop = scheduler(session_factory, clock, fake)

    seen: list[tuple[str, int]] = []
    for _ in range(30):  # 30 weeks: from September to the end of March... and one more
        row = await get(session_factory, schedule_id)
        assert row.next_run_at is not None
        clock.now = row.next_run_at
        assert [f.status for f in await loop.tick()] == ["started"]
        local = clock.now.astimezone(MEL)
        seen.append((local.strftime("%a %d %b %H:%M"), clock.now.hour))
    assert all(label.startswith("Mon") and label.endswith("07:00") for label, _ in seen)
    hours = {label[:10]: hour for label, hour in seen}
    assert hours["Mon 28 Sep"] == 21  # before the change: UTC+10, so 9 pm the day before in UTC
    assert hours["Mon 05 Oct"] == 20  # after it: UTC+11
    assert hours["Mon 29 Mar"] == 20
    assert hours["Mon 05 Apr"] == 21  # after the clocks went back
    assert len(fake.calls) == 30


# --- The jobs the core offers, and the hooks --------------------------------------------------


class FakeSyncs:
    def __init__(self, *, busy: bool = False, raises: Exception | None = None) -> None:
        self.busy = busy
        self.raises = raises
        self.started: list[dict[str, Any]] = []

    async def start(self, *, trigger: str, mode: str) -> Any:
        if self.raises is not None:
            raise self.raises
        self.started.append({"trigger": trigger, "mode": mode})
        return SimpleNamespace(id=42)


def hubspot_context(syncs: FakeSyncs, **settings: Any) -> JobContext:
    app = FastAPI()
    app.state.hubspot_syncs = syncs
    return JobContext(app, uuid.uuid4(), settings, NOW)


async def test_the_hubspot_job_starts_a_sync_of_the_chosen_kind_and_says_which() -> None:
    syncs = FakeSyncs()
    result = await start_hubspot_sync(hubspot_context(syncs, mode="changes"))
    assert result == JobResult(ref="sync:42")
    assert syncs.started == [{"trigger": "schedule", "mode": "changes"}]
    await start_hubspot_sync(hubspot_context(syncs))  # no choice: auto
    assert syncs.started[-1]["mode"] == "auto"


@pytest.mark.parametrize(
    ("raises", "words"),
    [
        (LookupError("HUBSPOT_SERVICE_KEY is not set"), "isn't connected"),
        (SyncAlreadyRunning(7), "already running"),
    ],
)
async def test_the_hubspot_job_is_skipped_with_a_reason_when_it_cannot_start(
    raises: Exception, words: str
) -> None:
    with pytest.raises(JobSkipped, match=words):
        await start_hubspot_sync(hubspot_context(FakeSyncs(raises=raises)))


async def test_the_hubspot_job_refuses_a_kind_of_sync_that_does_not_exist() -> None:
    with pytest.raises(JobSkipped, match="auto, full or changes"):
        await start_hubspot_sync(hubspot_context(FakeSyncs(), mode="everything"))


async def test_the_hubspot_job_is_running_while_a_sync_is() -> None:
    assert await hubspot_sync_running(hubspot_context(FakeSyncs(busy=True))) is True
    assert await hubspot_sync_running(hubspot_context(FakeSyncs(busy=False))) is False


def test_the_core_offers_the_hubspot_sync_on_by_default_every_day_at_6am() -> None:
    (job,) = CORE_JOBS
    assert (job.key, job.project) == (HUBSPOT_SYNC, "core")
    assert job.default is not None
    assert job.default.enabled is True
    assert job.default.cadence == Cadence(every=1, unit="days", at=time(6, 0))
    assert job.running is not None


async def test_the_scheduler_starts_with_the_run_engine_and_stops_with_it(
    session_factory: Factory,
) -> None:
    app = FastAPI()
    app.state.apps = []
    app.state.session_factory = session_factory
    await schedules_runtime.start_up(app)
    assert not hasattr(app.state, "scheduler")  # no run engine: another backend holds the lock

    app.state.run_manager = object()
    await schedules_runtime.start_up(app)
    scheduler_made: Scheduler = app.state.scheduler
    assert scheduler_made.running
    assert HUBSPOT_SYNC in await _by_job(session_factory)  # its default was made
    await schedules_runtime.shut_down(app)
    assert not scheduler_made.running
    await schedules_runtime.shut_down(FastAPI())  # nothing to stop: nothing happens


async def test_a_project_adds_its_jobs_through_its_app_spec() -> None:
    app = FastAPI()
    fake = Fake(key="lead_finder.discovery")
    app.state.apps = [SimpleNamespace(jobs=(fake.spec(),)), SimpleNamespace(jobs=())]
    assert [job.key for job in schedules_runtime.all_jobs(app)] == [HUBSPOT_SYNC, fake.key]
