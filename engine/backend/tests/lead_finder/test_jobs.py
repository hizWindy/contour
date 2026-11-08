"""The Lead Finder's scheduled run (PLAN-V6 D2): the default schedule and the check against the
limits. These need no database; `test_jobs_runs.py` starts real runs on the test database."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI

from apps.lead_finder.app import APP
from apps.lead_finder.jobs import (
    CITY_DAYS,
    DEFAULT_CADENCE,
    DEFAULT_SETTINGS,
    DISCOVERY,
    JOBS,
    LEGACY_DISCOVERY,
    LOOK_BACK_DAYS,
    NOT_READY,
    SCHEDULED_CITIES,
    SCHEDULED_COMPANIES,
    SCHEDULED_SIGNS,
    discovery_running,
    doesnt_fit,
    settings_for,
    start_discovery,
    usd,
)
from apps.lead_finder.params import (
    DiscoveryParams,
    default_cities,
    default_triggers,
    known_cities,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.steps.plan import check_discovery_size, make_slices
from core.api.errors import FieldError, Problem
from core.config import Settings
from core.runs.schemas import Blocked, RunEstimate
from core.runs.types import make_caps
from core.schedules.calc import first_run
from core.schedules.jobs import JobContext, JobSkipped

D = Decimal
BASIS = (
    "US$0.30 a company, the average of 30 past companies; "
    "US$0.15 a slice, the average of 40 past slices"
)


def estimate(**changes: Any) -> RunEstimate:
    """A run at past prices: about US$8 a typical run (the plan's number), US$40 worst."""
    values: dict[str, Any] = {
        "valid": True,
        "cost_usd_low": D("8.40"),
        "cost_usd_high": D("40.00"),
        "cap_usd": D("20.00"),
        "daily_left_usd": D("50.00"),
        "basis": BASIS,
    }
    return RunEstimate(**{**values, **changes})


# --- The default schedule ----------------------------------------------------------------------


def test_there_is_one_schedule_for_each_city_on_its_own_day_and_all_are_off() -> None:
    """PLAN-V9 C4: Melbourne Monday, Adelaide Tuesday, Perth Wednesday, Sydney Thursday."""
    made = [job for job in JOBS if job.default is not None]
    assert [job.key for job in made] == [
        "lead_finder.discovery.melbourne",
        "lead_finder.discovery.adelaide",
        "lead_finder.discovery.perth",
        "lead_finder.discovery.sydney",
    ]
    assert [job.title for job in made] == [
        "Find new leads: Melbourne",
        "Find new leads: Adelaide",
        "Find new leads: Perth",
        "Find new leads: Sydney",
    ]
    for job, (city, weekday) in zip(made, CITY_DAYS, strict=True):
        assert job.project == "lead_finder"
        assert job.default is not None
        cadence = job.default.cadence
        assert (cadence.every, cadence.unit, cadence.weekday) == (2, "weeks", weekday)
        assert (cadence.at.hour, cadence.at.minute) == (7, 0)
        assert cadence.zone == "Australia/Melbourne"
        assert job.default.enabled is False  # each run costs money, so Al-khair switches it on
        assert job.default.settings == settings_for(city)
    assert [weekday for _, weekday in CITY_DAYS] == [0, 1, 2, 3]
    assert DISCOVERY == "lead_finder.discovery.melbourne"
    assert made[0].default is not None and made[0].default.cadence == DEFAULT_CADENCE


def test_the_old_job_stays_known_with_no_default() -> None:
    old = next(job for job in JOBS if job.key == LEGACY_DISCOVERY)
    assert old.default is None  # an old row someone switched on still runs; no new one is made


def test_the_default_schedule_first_runs_on_a_monday_at_7_am_melbourne_time() -> None:
    first = first_run(DEFAULT_CADENCE, datetime(2026, 11, 4, 9, 0, tzinfo=UTC))
    local = first.astimezone(ZoneInfo("Australia/Melbourne"))
    assert (local.weekday(), local.hour, local.minute) == (0, 7, 0)


def test_the_lead_finder_offers_this_job_to_the_scheduler() -> None:
    assert APP.jobs == JOBS


def test_the_signs_are_the_main_signs_and_the_cities_every_city() -> None:
    # If the rules change the main signs, this fails: whether the schedules follow is a decision
    # (a new sign changes what a run costs).
    assert list(SCHEDULED_SIGNS) == default_triggers()
    assert list(SCHEDULED_CITIES) == known_cities()
    assert default_cities() == ["Melbourne"]  # the Start page also starts with one city


@pytest.mark.parametrize("city", ["Melbourne", "Adelaide", "Perth", "Sydney"])
def test_each_citys_choices_make_a_valid_run_inside_the_default_limits(city: str) -> None:
    settings = Settings(_env_file=None)
    params = DiscoveryParams.model_validate(settings_for(city))
    assert params.cities == [city]
    assert params.area == {}  # the whole city
    assert params.caps.run_cap_usd is None  # the run limit in Settings applies
    assert params.caps.max_companies == SCHEDULED_COMPANIES
    assert len(make_slices(params, load_rules())) == 6
    check_discovery_size(params, settings, make_caps(settings))  # raises when too large


def test_all_4_cities_in_one_run_are_too_large_for_the_default_limits() -> None:
    # Why there is one schedule for each city: 24 searches, and at most 13 fit.
    settings = Settings(_env_file=None)
    params = DiscoveryParams(cities=known_cities(), triggers=list(SCHEDULED_SIGNS), since_days=14)
    assert len(known_cities()) == 4
    with pytest.raises(Problem) as refused:
        check_discovery_size(params, settings, make_caps(settings))
    assert refused.value.code == "discovery_too_large"
    assert "24 searches is too many (the most that fit is 13)" in str(refused.value.extra)


def test_the_look_back_is_the_time_between_two_runs() -> None:
    assert DEFAULT_CADENCE.step == LOOK_BACK_DAYS == 14
    assert DEFAULT_SETTINGS["since_days"] == LOOK_BACK_DAYS
    assert DiscoveryParams.model_validate(DEFAULT_SETTINGS).since_days == 14


def test_the_default_choices_are_the_schedules_own_copy_of_the_settings() -> None:
    job = next(job for job in JOBS if job.key == DISCOVERY)
    assert job.default is not None
    assert job.default.settings == DEFAULT_SETTINGS
    assert job.default.settings is not settings_for("Melbourne")  # each call makes a new one


# --- Does it fit? ---------------------------------------------------------------------------------


def test_a_typical_run_inside_both_limits_fits() -> None:
    assert doesnt_fit(estimate()) is None


def test_a_run_at_exactly_the_limits_fits() -> None:
    assert doesnt_fit(estimate(cost_usd_low=D("20.00"), daily_left_usd=D("20.00"))) is None


def test_the_worst_case_does_not_decide() -> None:
    # Every discovery run's worst case is above the run limit (the Start page says so). The limits
    # stop the run while it works, so the check looks at what a typical run costs.
    assert doesnt_fit(estimate(cost_usd_high=D("59.60"), over_cap=True)) is None


def test_a_typical_run_above_the_run_limit_says_so_with_the_prices() -> None:
    reason = doesnt_fit(estimate(cost_usd_low=D("26.40"), basis="US$1.00 a company, a default"))
    assert reason == (
        "A typical run costs about US$26.40, which is more than the run limit of US$20.00. "
        "Prices used: US$1.00 a company, a default. Pick fewer cities or signs, or raise the "
        "run limit in Settings."
    )


def test_a_run_limit_message_without_a_basis_has_no_empty_prices_part() -> None:
    reason = doesnt_fit(estimate(cost_usd_low=D("26.40"), basis=""))
    assert reason is not None
    assert "Prices used" not in reason
    assert "  " not in reason


def test_a_typical_run_above_what_is_left_today_says_so() -> None:
    reason = doesnt_fit(estimate(daily_left_usd=D("3.20")))
    assert reason == (
        "A typical run costs about US$8.40, but only US$3.20 is left of today's limit."
    )


def test_nothing_left_today_says_so() -> None:
    reason = doesnt_fit(estimate(daily_left_usd=D("0")))
    assert reason is not None and "only US$0.00 is left of today's limit" in reason


def test_the_run_limit_is_checked_before_the_daily_amount() -> None:
    reason = doesnt_fit(estimate(cost_usd_low=D("26.40"), daily_left_usd=D("3.20")))
    assert reason is not None and "run limit of US$20.00" in reason


def test_money_is_rounded_up_so_it_never_shows_less_than_it_is() -> None:
    assert usd(D("20.001")) == "US$20.01"
    assert usd(D("20.00")) == "US$20.00"
    reason = doesnt_fit(estimate(cost_usd_low=D("20.001"), basis=""))
    assert reason is not None and "about US$20.01" in reason and "limit of US$20.00" in reason


def test_choices_that_cant_be_read_say_where_and_why() -> None:
    errors = [
        FieldError(field="body.params.cities", message="Unknown city Atlantis."),
        FieldError(field="body.params.since_days", message="Input should be 7, 14 or 30"),
    ]
    reason = doesnt_fit(RunEstimate(valid=False, errors=errors))
    assert reason == (
        "The saved choices can't be used. cities: Unknown city Atlantis.; "
        "since_days: Input should be 7, 14 or 30"
    )


def test_fields_with_the_same_words_are_said_once() -> None:
    words = "16 searches is too many (the most that fit is 13). Choose fewer."
    errors = [
        FieldError(field="body.params.cities", message=words),
        FieldError(field="body.params.triggers", message=words),
    ]
    reason = doesnt_fit(RunEstimate(valid=False, errors=errors))
    assert reason == f"The saved choices can't be used. cities, triggers: {words}"


def test_only_the_first_3_problems_are_listed() -> None:
    errors = [FieldError(field=f"body.params.f{n}", message=f"bad {n}") for n in range(6)]
    reason = doesnt_fit(RunEstimate(valid=False, errors=errors))
    assert reason is not None
    assert reason.count("bad") == 3


def test_a_run_that_is_blocked_gives_the_blocks_own_words() -> None:
    blocked = Blocked(code="some_block", message="Something has to be approved first.")
    assert doesnt_fit(estimate(blocked=blocked)) == "Something has to be approved first."


# --- Without a run engine ------------------------------------------------------------


async def test_without_a_run_engine_the_job_is_skipped_not_failed() -> None:
    context = JobContext(FastAPI(), uuid.uuid4(), dict(DEFAULT_SETTINGS), datetime.now(UTC))
    with pytest.raises(JobSkipped) as skipped:
        await start_discovery(context)
    assert skipped.value.reason == NOT_READY
    with pytest.raises(JobSkipped):
        await discovery_running(context)
