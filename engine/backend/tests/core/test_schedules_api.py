"""The Schedules endpoints (PLAN-V6 D3), on the test database and the real app.

The job here is a fake that records its calls and answers what the test tells it to; its default
schedule is every 2 weeks on Monday at 7:00 am, off. The clock is the test's own: Wednesday 4 Nov
2026, 8:00 pm in Melbourne (UTC+11), so the next Monday 7:00 am is 2026-11-08 20:00 UTC.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.schedules import runner, service
from core.schedules.calc import Cadence
from core.schedules.core_jobs import HUBSPOT_SYNC
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSettingsError,
    JobSkipped,
    JobSpec,
)
from core.schedules.models import Schedule
from core.schedules.runner import Scheduler
from core.schedules.runtime import all_jobs
from tests.core.auth_world import World, make_account, sign_in

pytestmark = pytest.mark.integration

D = Decimal
Factory = async_sessionmaker[AsyncSession]
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
FIRST_MONDAY = datetime(2026, 11, 8, 20, 0, tzinfo=UTC)
FORTNIGHTLY = Cadence(every=2, unit="weeks", weekday=0, at=time(7, 0))
URL = "/api/v1/schedules"


@dataclass
class Job:
    """A job that records its calls and does what the test tells it to."""

    key: str = "test.job"
    calls: list[JobContext] = field(default_factory=list)
    is_running: bool = False
    skip: str | None = None
    crash: bool = False
    typical: Decimal = field(default_factory=lambda: D("8.00"))

    async def start(self, context: JobContext) -> JobResult:
        self.calls.append(context)
        if self.crash:
            raise RuntimeError("secret detail that must not reach the table")
        if self.skip is not None:
            raise JobSkipped(self.skip)
        return JobResult(ref=f"run-{len(self.calls)}")

    async def running(self, context: JobContext) -> bool:
        return self.is_running

    async def estimate(self, context: JobContext) -> JobEstimate:
        return JobEstimate(
            valid=True,
            problem=None,
            typical_usd=self.typical,
            worst_usd=D("20.00"),
            cap_usd=D("20.00"),
            daily_left_usd=D("50.00"),
            basis="a test basis",
        )

    @staticmethod
    def describe(settings: dict[str, Any]) -> str:
        return f"Looks at {settings.get('what', 'nothing')}."

    @staticmethod
    def check(settings: dict[str, Any]) -> dict[str, Any]:
        if "bad" in settings:
            raise JobSettingsError("bad isn't a choice here.")
        return {key: value for key, value in settings.items() if value is not None}

    def spec(self) -> JobSpec:
        return JobSpec(
            key=self.key,
            project="test",
            title="A test job",
            start=self.start,
            running=self.running,
            estimate=self.estimate,
            describe=self.describe,
            check_settings=self.check,
            default=DefaultSchedule(FORTNIGHTLY, enabled=False, settings={"what": "everything"}),
        )


@dataclass
class Setup:
    client: httpx.AsyncClient
    world: World
    job: Job
    factory: Factory


@pytest.fixture
async def setup(world: World, session_factory: Factory) -> AsyncIterator[Setup]:
    world.settings(auth_required=False)  # sign-in off, as on the laptop
    world.clock.now = NOW
    job = Job()
    world.app.state.apps = [SimpleNamespace(jobs=(job.spec(),))]
    jobs = all_jobs(world.app)  # the HubSpot sync and the fake
    async with session_factory() as db:
        await service.ensure_defaults(db, jobs, NOW)
    world.app.state.scheduler = Scheduler(
        app=world.app, sessions=session_factory, jobs=jobs, clock=world.clock
    )
    async with world.browser() as client:
        yield Setup(client, world, job, session_factory)


async def schedule_of(setup: Setup, key: str = "test.job") -> Schedule:
    async with setup.factory() as db:
        row = await db.scalar(select(Schedule).where(Schedule.job == key))
        assert row is not None
        return row


async def listed(setup: Setup) -> dict[str, dict[str, Any]]:
    answer = await setup.client.get(URL)
    assert answer.status_code == 200, answer.text
    return {item["job"]: item for item in answer.json()["items"]}


async def patch(setup: Setup, body: dict[str, Any], key: str = "test.job") -> httpx.Response:
    row = await schedule_of(setup, key)
    return await setup.client.patch(f"{URL}/{row.id}", json=body)


# --- Reading ------------------------------------------------------------------------------------


async def test_each_schedule_comes_with_its_words_its_choices_and_its_estimate(
    setup: Setup,
) -> None:
    items = await listed(setup)
    item = items["test.job"]
    assert item["name"] == "A test job" and item["project"] == "test"
    assert (item["every"], item["unit"], item["weekday"], item["at"]) == (2, "weeks", 0, "07:00")
    assert item["when"] == "Every 2 weeks on Monday at 7:00 am"
    assert item["timezone"] == "Australia/Melbourne"
    assert item["summary"] == "Looks at everything."
    assert (item["enabled"], item["next_run_at"]) == (False, None)
    assert (item["last_status"], item["last_kind"], item["last_id"]) == (None, None, None)
    assert (item["running"], item["installed"]) == (False, True)
    assert item["estimate"] == {
        "valid": True,
        "problem": None,
        "typical_usd": "8.00",
        "worst_usd": "20.00",
        "per_month_usd": "17.40",  # 8.00 x 30.4375 / 14 days, rounded up
        "cap_usd": "20.00",
        "daily_left_usd": "50.00",
        "basis": "a test basis",
    }


async def test_the_hubspot_sync_is_listed_on_and_free(setup: Setup) -> None:
    item = (await listed(setup))[HUBSPOT_SYNC]
    assert item["when"] == "Every day at 6:00 am"
    assert item["enabled"] is True and item["next_run_at"] is not None
    assert item["estimate"]["typical_usd"] == "0.00" and item["estimate"]["per_month_usd"] == "0.00"
    assert item["summary"].startswith("Copies everything when the last full copy is old")


async def test_a_running_job_says_so(setup: Setup) -> None:
    setup.job.is_running = True
    assert (await listed(setup))["test.job"]["running"] is True


async def test_a_schedule_whose_job_is_gone_is_listed_without_an_estimate(setup: Setup) -> None:
    async with setup.factory() as db:
        db.add(
            Schedule(
                project="old",
                job="old.job",
                name="An old job",
                every=1,
                unit="days",
                at_time=time(6, 0),
            )
        )
        await db.commit()
    item = (await listed(setup))["old.job"]
    assert (item["installed"], item["estimate"], item["summary"], item["running"]) == (
        False,
        None,
        "",
        False,
    )


@pytest.mark.parametrize(
    ("ref", "kind", "found"),
    [
        ("sync:7", "sync", "7"),
        ("2f6f4a4e-5d4e-4c1c-9d0e-2a4d3f6c1b11", "run", "2f6f4a4e-5d4e-4c1c-9d0e-2a4d3f6c1b11"),
        (None, None, None),
    ],
)
async def test_the_last_start_is_a_kind_and_an_id(
    setup: Setup, ref: str | None, kind: str | None, found: str | None
) -> None:
    async with setup.factory() as db:
        await db.execute(
            update(Schedule)
            .where(Schedule.job == "test.job")
            .values(last_ref=ref, last_status="started" if ref else None)
        )
        await db.commit()
    item = (await listed(setup))["test.job"]
    assert (item["last_kind"], item["last_id"]) == (kind, found)


async def test_a_job_whose_estimate_breaks_does_not_break_the_list(setup: Setup) -> None:
    async def broken(context: JobContext) -> JobEstimate:
        raise RuntimeError("a detail for the log only")

    spec = setup.job.spec()
    setup.world.app.state.apps = [
        SimpleNamespace(jobs=(JobSpec(**{**vars(spec), "estimate": broken}),))
    ]
    items = await listed(setup)
    assert items["test.job"]["estimate"]["valid"] is False
    assert "a detail for the log" not in items["test.job"]["estimate"]["problem"]
    assert items[HUBSPOT_SYNC]["estimate"]["valid"] is True


async def test_a_job_that_cannot_estimate_yet_says_why(setup: Setup) -> None:
    async def not_ready(context: JobContext) -> JobEstimate:
        raise JobSkipped("The run engine isn't ready, so this time was skipped.")

    spec = setup.job.spec()
    setup.world.app.state.apps = [
        SimpleNamespace(jobs=(JobSpec(**{**vars(spec), "estimate": not_ready}),))
    ]
    estimate = (await listed(setup))["test.job"]["estimate"]
    assert estimate["valid"] is False
    assert estimate["problem"] == "The run engine isn't ready, so this time was skipped."


# --- Changing a schedule -------------------------------------------------------------------------


async def test_switching_on_sets_the_next_run_to_the_first_monday_at_7(setup: Setup) -> None:
    answer = await patch(setup, {"enabled": True})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["enabled"] is True
    assert datetime.fromisoformat(body["next_run_at"]) == FIRST_MONDAY
    row = await schedule_of(setup)
    assert (row.enabled, row.next_run_at) == (True, FIRST_MONDAY)


async def test_switching_off_clears_the_next_run(setup: Setup) -> None:
    await patch(setup, {"enabled": True})
    answer = await patch(setup, {"enabled": False})
    assert answer.json()["enabled"] is False and answer.json()["next_run_at"] is None
    row = await schedule_of(setup)
    assert (row.enabled, row.next_run_at) == (False, None)


async def test_saying_on_again_keeps_the_next_run_where_it_is(setup: Setup) -> None:
    await patch(setup, {"enabled": True})
    later = FIRST_MONDAY + timedelta(days=14)
    async with setup.factory() as db:
        await db.execute(
            update(Schedule).where(Schedule.job == "test.job").values(next_run_at=later)
        )
        await db.commit()
    answer = await patch(setup, {"enabled": True, "settings": {"what": "Perth"}})
    assert datetime.fromisoformat(answer.json()["next_run_at"]) == later  # not moved


async def test_changing_when_it_runs_moves_the_next_run_if_it_is_on(setup: Setup) -> None:
    await patch(setup, {"enabled": True})
    answer = await patch(setup, {"unit": "weeks", "weekday": 2, "at": "09:30", "every": 3})
    body = answer.json()
    assert (body["every"], body["weekday"], body["at"]) == (3, 2, "09:30")
    assert body["when"] == "Every 3 weeks on Wednesday at 9:30 am"
    # It is Wednesday 8:00 pm in Melbourne, so today's 9:30 am has passed: the next one is
    # Wednesday 11 Nov at 9:30 am, which is 22:30 UTC on the 10th.
    assert datetime.fromisoformat(body["next_run_at"]) == datetime(2026, 11, 10, 22, 30, tzinfo=UTC)


async def test_changing_when_it_runs_while_it_is_off_stays_off(setup: Setup) -> None:
    answer = await patch(setup, {"every": 1, "at": "08:15"})
    body = answer.json()
    assert (body["enabled"], body["next_run_at"], body["when"]) == (
        False,
        None,
        "Every week on Monday at 8:15 am",
    )


async def test_a_schedule_can_change_from_weeks_to_days_and_back(setup: Setup) -> None:
    await patch(setup, {"enabled": True})
    in_days = (await patch(setup, {"unit": "days", "every": 1, "at": "06:00"})).json()
    assert (in_days["unit"], in_days["weekday"], in_days["when"]) == (
        "days",
        None,
        "Every day at 6:00 am",
    )
    assert datetime.fromisoformat(in_days["next_run_at"]) == datetime(
        2026, 11, 4, 19, 0, tzinfo=UTC
    )
    back = (await patch(setup, {"unit": "weeks", "weekday": 4})).json()
    assert (back["unit"], back["weekday"]) == ("weeks", 4)


async def test_the_choices_are_checked_by_the_job_and_saved_cleaned(setup: Setup) -> None:
    answer = await patch(setup, {"settings": {"what": "Perth", "extra": None}})
    assert answer.status_code == 200, answer.text
    assert answer.json()["settings"] == {"what": "Perth"}
    assert answer.json()["summary"] == "Looks at Perth."
    assert (await schedule_of(setup)).settings == {"what": "Perth"}


@pytest.mark.parametrize(
    ("body", "field", "message"),
    [
        ({"unit": "days", "weekday": 2}, "body.weekday", "A schedule in days has no day"),
        ({"every": 53}, "body.every", "Use 52 weeks or fewer."),
        ({"unit": "days", "every": 366}, "body.every", "Less than or equal to 365"),
        ({"every": 0}, "body.every", "Greater than or equal to 1"),
        ({"at": "7:00"}, "body.at", "Use a 24-hour time like 07:00"),
        ({"at": "24:00"}, "body.at", "Use a 24-hour time like 07:00"),
        ({"weekday": 7}, "body.weekday", "Less than or equal to 6"),
        ({"settings": {"bad": 1}}, "body.settings", "bad isn't a choice here."),
    ],
)
async def test_a_change_that_cannot_be_made_is_a_422_that_names_the_field(
    setup: Setup, body: dict[str, Any], field: str, message: str
) -> None:
    answer = await patch(setup, body)
    assert answer.status_code == 422, answer.text
    errors = {error["field"]: error["message"] for error in answer.json()["errors"]}
    assert field in errors and message.lower() in errors[field].lower()
    row = await schedule_of(setup)
    assert (row.every, row.unit, row.weekday, row.at_time) == (2, "weeks", 0, time(7, 0))


async def test_a_schedule_in_days_needs_a_day_to_become_weeks(setup: Setup) -> None:
    await patch(setup, {"unit": "days"})
    answer = await patch(setup, {"unit": "weeks"})
    assert answer.status_code == 422
    assert answer.json()["errors"][0]["field"] == "body.weekday"


async def test_an_unknown_part_is_refused_not_ignored(setup: Setup) -> None:
    answer = await patch(setup, {"enabeld": True})
    assert answer.status_code == 422


async def test_a_job_without_choices_takes_none(setup: Setup) -> None:
    async with setup.factory() as db:
        db.add(
            Schedule(
                project="old", job="old.job", name="Old", every=1, unit="days", at_time=time(6)
            )
        )
        await db.commit()
    answer = await patch(setup, {"settings": {"a": 1}}, key="old.job")
    assert answer.status_code == 422
    assert answer.json()["errors"][0]["message"] == "This job takes no choices."


async def test_the_hubspot_sync_takes_a_mode_and_nothing_else(setup: Setup) -> None:
    good = await patch(setup, {"settings": {"mode": "full"}}, key=HUBSPOT_SYNC)
    assert good.status_code == 200 and good.json()["settings"] == {"mode": "full"}
    assert good.json()["summary"].startswith("Copies everything, and finds")
    for bad in ({"mode": "weekly"}, {"mode": "full", "speed": 3}):
        refused = await patch(setup, {"settings": bad}, key=HUBSPOT_SYNC)
        assert refused.status_code == 422


async def test_an_unknown_schedule_is_a_404(setup: Setup) -> None:
    missing = uuid.uuid4()
    assert (await setup.client.patch(f"{URL}/{missing}", json={"enabled": True})).status_code == 404
    assert (await setup.client.post(f"{URL}/{missing}/run")).status_code == 404


# --- Run now -------------------------------------------------------------------------------------


async def test_run_now_starts_the_job_with_the_saved_choices_and_leaves_the_next_run_alone(
    setup: Setup,
) -> None:
    await patch(setup, {"enabled": True})
    row = await schedule_of(setup)
    answer = await setup.client.post(f"{URL}/{row.id}/run")
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"status": "started", "ref": "run-1", "reason": None}
    assert [call.settings for call in setup.job.calls] == [{"what": "everything"}]
    assert setup.job.calls[0].schedule_id == row.id
    after = await schedule_of(setup)
    assert (after.last_status, after.last_ref, after.last_error) == ("started", "run-1", None)
    assert after.last_run_at == NOW
    assert after.next_run_at == FIRST_MONDAY  # "Run now" never moves the cadence


async def test_run_now_works_for_a_schedule_that_is_off(setup: Setup) -> None:
    row = await schedule_of(setup)
    answer = await setup.client.post(f"{URL}/{row.id}/run")
    assert answer.json()["status"] == "started"
    after = await schedule_of(setup)
    assert (after.enabled, after.next_run_at) == (False, None)


async def test_run_now_says_why_when_the_job_does_not_start(setup: Setup) -> None:
    setup.job.skip = "A typical run costs about US$24.80, which is more than the run limit."
    row = await schedule_of(setup)
    answer = await setup.client.post(f"{URL}/{row.id}/run")
    assert answer.status_code == 200
    assert answer.json() == {"status": "skipped", "ref": None, "reason": setup.job.skip}
    after = await schedule_of(setup)
    assert (after.last_status, after.last_error) == ("skipped", setup.job.skip)


async def test_run_now_is_skipped_while_the_last_run_is_still_going(setup: Setup) -> None:
    setup.job.is_running = True
    row = await schedule_of(setup)
    answer = await setup.client.post(f"{URL}/{row.id}/run")
    assert answer.json() == {"status": "skipped", "ref": None, "reason": runner.STILL_RUNNING}
    assert setup.job.calls == []


async def test_run_now_that_fails_gives_a_fixed_sentence_and_no_detail(setup: Setup) -> None:
    setup.job.crash = True
    row = await schedule_of(setup)
    answer = await setup.client.post(f"{URL}/{row.id}/run")
    assert answer.json() == {"status": "failed", "ref": None, "reason": runner.COULD_NOT_START}
    assert "secret detail" not in answer.text
    assert "secret detail" not in str((await schedule_of(setup)).last_error)


async def test_run_now_without_a_scheduler_is_a_503(setup: Setup) -> None:
    del setup.world.app.state.scheduler
    row = await schedule_of(setup)
    answer = await setup.client.post(f"{URL}/{row.id}/run")
    assert answer.status_code == 503 and answer.json()["code"] == "schedules_not_ready"


# --- Who may -------------------------------------------------------------------------------------


async def test_only_a_signed_in_person_may_read_and_only_an_admin_may_change(
    setup: Setup,
) -> None:
    world = setup.world
    world.settings(auth_required=True)
    row = await schedule_of(setup)
    anonymous = await setup.client.get(URL)
    assert anonymous.status_code == 401 and anonymous.json()["code"] == "auth_required"
    assert (await setup.client.patch(f"{URL}/{row.id}", json={"enabled": True})).status_code == 401
    assert (await setup.client.post(f"{URL}/{row.id}/run")).status_code == 401

    await make_account(world)
    async with setup.factory() as db:
        await db.execute(text("UPDATE core.users SET role = 'viewer'"))
        await db.commit()
    assert (await sign_in(setup.client)).status_code == 200
    assert (await setup.client.get(URL)).status_code == 200  # reading needs only a session
    refused = await setup.client.patch(f"{URL}/{row.id}", json={"enabled": True})
    assert (refused.status_code, refused.json()["code"]) == (403, "admin_only")
    refused = await setup.client.post(f"{URL}/{row.id}/run")
    assert (refused.status_code, refused.json()["code"]) == (403, "admin_only")
    assert setup.job.calls == []
    assert (await schedule_of(setup)).enabled is False

    async with setup.factory() as db:
        await db.execute(text("UPDATE core.users SET role = 'admin'"))
        await db.commit()
    changed = await setup.client.patch(f"{URL}/{row.id}", json={"enabled": True})
    assert changed.status_code == 200
    assert (await setup.client.post(f"{URL}/{row.id}/run")).json()["status"] == "started"
