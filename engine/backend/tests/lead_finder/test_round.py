"""The city schedules as one control, and the round's budget (PLAN-V13 T1-3). Fast: pure parts only.

The clock is Monday 16 Nov 2026, 10:00 am in Melbourne (UTC+11), unless a test says otherwise.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from itertools import pairwise
from typing import Any

import pytest

from apps.lead_finder.goal import (
    ROUND_DAYS,
    round_window,
    run_cap_in_round,
    spent_reason,
    too_little_reason,
)
from apps.lead_finder.jobs import CITY_DAYS, JOBS, job_key, settings_for
from apps.lead_finder.round import (
    CITIES,
    Plan,
    RoundIn,
    apply_plan,
    check_plan,
    look_back,
    plan_of,
    round_times,
    summary_words,
    when_words,
)
from core.api.errors import Problem
from core.schedules.calc import Cadence, next_after
from core.schedules.models import Schedule

D = Decimal
NOW = datetime(2026, 11, 15, 23, 0, tzinfo=UTC)  # Mon 16 Nov, 10:00 am Melbourne
SEVEN = time(7, 0)


def melbourne(day: date, at: time = SEVEN) -> datetime:
    """A wall-clock time in Melbourne (UTC+11 in November) as a moment."""
    return datetime.combine(day, at, tzinfo=UTC) - timedelta(hours=11)


def plan(cities: tuple[str, ...] = CITIES, **values: Any) -> Plan:
    chosen: dict[str, Any] = {
        "enabled": True,
        "every": 2,
        "unit": "weeks",
        "weekday": 0,
        "at": SEVEN,
        **values,
    }
    return Plan(cities=cities, **chosen)


def default_rows() -> dict[str, Schedule]:
    """The four default schedules, off, as the scheduler makes them."""
    rows = {}
    for city, day in CITY_DAYS:
        rows[job_key(city)] = Schedule(
            id=uuid.uuid4(),
            project="lead_finder",
            job=job_key(city),
            name=f"Find new leads: {city}",
            settings=settings_for(city),
            every=2,
            unit="weeks",
            weekday=day,
            at_time=SEVEN,
            timezone="Australia/Melbourne",
            enabled=False,
            next_run_at=None,
        )
    return rows


# --- The times ------------------------------------------------------------------------------------


def test_two_cities_in_weeks_are_one_day_apart_from_the_first_day() -> None:
    """The plan's own example: Perth and Sydney, every 2 weeks from Wednesday at 7:00 am."""
    times = round_times(plan(("Sydney", "Perth"), weekday=2), NOW)
    assert list(times) == ["Perth", "Sydney"]  # the fixed order, whatever order they came in
    assert (times["Perth"].weekday, times["Sydney"].weekday) == (2, 3)
    assert times["Perth"].first == melbourne(date(2026, 11, 18))  # Wednesday
    assert times["Sydney"].first == melbourne(date(2026, 11, 19))  # Thursday


def test_the_days_wrap_past_sunday() -> None:
    times = round_times(plan(weekday=5), NOW)  # from Saturday
    assert [times[city].weekday for city in CITIES] == [5, 6, 0, 1]
    assert times["Sydney"].first - times["Melbourne"].first == timedelta(days=3)


def test_a_first_day_that_is_today_but_past_its_time_starts_next_week() -> None:
    times = round_times(plan(weekday=0), NOW)  # Monday 10 am: 7 am has gone
    assert times["Melbourne"].first == melbourne(date(2026, 11, 23))
    earlier = round_times(plan(weekday=0, at=time(11, 0)), NOW)  # 11 am is still to come
    assert earlier["Melbourne"].first == melbourne(date(2026, 11, 16), time(11, 0))


def test_cities_in_days_are_one_day_apart_and_stay_so() -> None:
    every_30 = plan(unit="days", every=30, weekday=5)
    times = round_times(every_30, NOW)
    assert all(item.weekday is None for item in times.values())  # a schedule in days has none
    firsts = [times[city].first for city in CITIES]
    assert firsts[0] == melbourne(date(2026, 11, 21))  # the next Saturday
    assert [later - earlier for earlier, later in pairwise(firsts)] == [timedelta(days=1)] * 3
    # What the scheduler does after each run keeps them one day apart, 30 days on.
    cadence = Cadence(every=30, unit="days", at=SEVEN)
    nexts = [next_after(cadence, first, first + timedelta(minutes=1)) for first in firsts]
    assert [nxt - first for first, nxt in zip(firsts, nexts, strict=True)] == [
        timedelta(days=30)
    ] * 4
    assert nexts[3] - nexts[0] == timedelta(days=3)


@pytest.mark.parametrize(
    ("step", "days"), [(1, 7), (7, 7), (8, 14), (14, 14), (21, 30), (30, 30), (60, 30)]
)
def test_the_look_back_covers_the_time_between_rounds(step: int, days: int) -> None:
    assert look_back(step) == days


# --- Saving a plan --------------------------------------------------------------------------------


def body(**values: Any) -> RoundIn:
    chosen = {
        "enabled": True,
        "cities": list(CITIES),
        "every": 2,
        "unit": "weeks",
        "weekday": 0,
        "at": "07:00",
        "budget_usd": "150",
        **values,
    }
    return RoundIn.model_validate(chosen)


def test_a_round_must_end_before_the_next_starts() -> None:
    with pytest.raises(Problem) as refused:
        check_plan(body(every=3, unit="days"))
    errors = refused.value.extra["errors"]
    assert errors[0]["field"] == "body.every"
    assert errors[0]["message"] == (
        "4 cities run on 4 days in a row, so a round can repeat every 4 days at most often."
    )
    check_plan(body(every=4, unit="days"))  # 4 days is fine
    check_plan(body(every=2, unit="days", cities=["Perth", "Sydney"]))
    with pytest.raises(Problem):
        check_plan(body(every=53, unit="weeks"))


def test_each_city_at_most_once_and_a_known_city() -> None:
    with pytest.raises(ValueError, match="Pick each city once"):
        body(cities=["Perth", "Perth"])
    with pytest.raises(ValueError):
        body(cities=["Brisbane"])
    with pytest.raises(ValueError):
        body(cities=[])
    with pytest.raises(ValueError, match="24-hour"):
        body(at="7am")


def test_picking_two_cities_turns_the_other_two_off() -> None:
    rows = default_rows()
    old = plan_of(rows, {})
    new = plan(("Perth", "Sydney"), weekday=2)
    apply_plan(rows, old, new, NOW)
    by_city = {city: rows[job_key(city)] for city in CITIES}
    assert {city: row.enabled for city, row in by_city.items()} == {
        "Melbourne": False,
        "Adelaide": False,
        "Perth": True,
        "Sydney": True,
    }
    assert by_city["Melbourne"].next_run_at is None and by_city["Adelaide"].next_run_at is None
    assert (by_city["Perth"].weekday, by_city["Sydney"].weekday) == (2, 3)
    assert by_city["Perth"].next_run_at == melbourne(date(2026, 11, 18))
    assert by_city["Sydney"].next_run_at == melbourne(date(2026, 11, 19))
    assert all(row.settings["since_days"] == 14 for row in by_city.values())
    assert by_city["Perth"].settings["cities"] == ["Perth"]  # its other choices stay


def test_saving_the_same_times_again_keeps_each_next_run() -> None:
    rows = default_rows()
    first = plan(("Melbourne", "Adelaide"))
    apply_plan(rows, plan_of(rows, {}), first, NOW)
    planned = rows[job_key("Adelaide")].next_run_at
    later = NOW + timedelta(days=3)
    apply_plan(rows, plan_of(rows, {}), first, later)  # only the budget changed
    assert rows[job_key("Adelaide")].next_run_at == planned
    moved = plan(("Melbourne", "Adelaide"), at=time(8, 0))
    apply_plan(rows, plan_of(rows, {}), moved, later)  # a new time plans the round again
    assert rows[job_key("Adelaide")].next_run_at == melbourne(date(2026, 11, 24), time(8, 0))


def test_switching_off_leaves_every_city_off_and_the_record_brings_them_back() -> None:
    rows = default_rows()
    apply_plan(rows, plan_of(rows, {}), plan(("Perth", "Sydney"), weekday=2), NOW)
    off = plan(("Perth", "Sydney"), weekday=2, enabled=False)
    apply_plan(rows, plan_of(rows, {}), off, NOW)
    assert not any(row.enabled or row.next_run_at for row in rows.values())
    read = plan_of(rows, {"cities": ["Perth", "Sydney"], "weekday": 2})
    assert (read.enabled, read.cities, read.weekday) == (False, ("Perth", "Sydney"), 2)
    assert plan_of(default_rows(), {}).cities == CITIES  # nothing saved yet: all four


def test_the_plan_read_while_on_comes_from_the_schedules() -> None:
    rows = default_rows()
    apply_plan(rows, plan_of(rows, {}), plan(("Adelaide", "Perth"), weekday=3), NOW)
    read = plan_of(rows, {"cities": ["Melbourne"], "weekday": 0})  # an old record is ignored
    assert (read.enabled, read.cities, read.weekday, read.every, read.unit) == (
        True,
        ("Adelaide", "Perth"),
        3,
        2,
        "weeks",
    )


def test_the_plan_in_words() -> None:
    assert when_words(plan()) == "Every 2 weeks from Monday at 7:00 am"
    assert when_words(plan(every=1)) == "Every week from Monday at 7:00 am"
    assert when_words(plan(unit="days", every=30, weekday=5)) == (
        "Every 30 days from Saturday at 7:00 am"
    )
    times = round_times(plan(), NOW)
    starts = {city: item.first for city, item in times.items()}
    assert summary_words(plan(), starts, D("150")) == (
        "Next round: Mon 23 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. "
        "Up to US$150."
    )


# --- The round's window ---------------------------------------------------------------------------


def planned_rows(cities: tuple[str, ...], **values: Any) -> dict[str, Schedule]:
    rows = default_rows()
    apply_plan(rows, plan_of(rows, {}), plan(cities, **values), NOW)
    return rows


def claim(rows: dict[str, Schedule], city: str) -> None:
    """What the scheduler does when a city's time comes: its next time moves one period on."""
    row = rows[job_key(city)]
    assert row.next_run_at is not None
    cadence = Cadence(every=row.every, unit=row.unit, at=row.at_time, weekday=row.weekday)  # type: ignore[arg-type]
    row.next_run_at = next_after(cadence, row.next_run_at, row.next_run_at + timedelta(minutes=1))


def test_the_round_begins_at_the_first_picked_citys_time() -> None:
    rows = planned_rows(CITIES)  # Melbourne Mon 23 Nov ... Sydney Thu 26 Nov
    monday = melbourne(date(2026, 11, 23))
    claim(rows, "Melbourne")
    claim(rows, "Adelaide")
    wednesday = melbourne(date(2026, 11, 25), time(8, 0))
    window = round_window(list(rows.values()), wednesday)
    assert window.start == monday  # Adelaide's and Melbourne's runs count
    assert window.next_start == melbourne(date(2026, 12, 7))  # 2 weeks later


def test_before_the_first_city_runs_it_is_still_the_round_before() -> None:
    rows = planned_rows(CITIES)
    window = round_window(list(rows.values()), NOW)  # Mon 16 Nov: the first round is on the 23rd
    assert window.start == melbourne(date(2026, 11, 9))
    assert window.next_start == melbourne(date(2026, 11, 23))


def test_a_weekly_round_never_counts_last_weeks_cities() -> None:
    """7 days back would count last week's Adelaide, Perth and Sydney: the round doesn't."""
    rows = planned_rows(CITIES, every=1)
    claim(rows, "Melbourne")
    for city in ("Adelaide", "Perth", "Sydney"):
        claim(rows, city)
    claim(rows, "Melbourne")  # the next Monday's run has been claimed
    next_monday = melbourne(date(2026, 11, 30), time(7, 1))
    window = round_window(list(rows.values()), next_monday)
    assert window.start == melbourne(date(2026, 11, 30))


def test_the_leader_is_the_first_city_that_is_on() -> None:
    rows = planned_rows(("Perth", "Sydney"), weekday=2)
    window = round_window(list(rows.values()), melbourne(date(2026, 11, 19), time(8, 0)))
    assert window.start == melbourne(
        date(2026, 11, 4)
    )  # Perth hasn't been claimed: the round before
    claim(rows, "Perth")
    window = round_window(list(rows.values()), melbourne(date(2026, 11, 19), time(8, 0)))
    assert window.start == melbourne(date(2026, 11, 18))  # Perth's Wednesday


def test_with_no_city_on_the_round_is_the_last_seven_days() -> None:
    window = round_window(list(default_rows().values()), NOW)
    assert (window.start, window.next_start) == (NOW - timedelta(days=ROUND_DAYS), None)


# --- The budget -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("own", "budget", "spent", "cap"),
    [
        ("150", "150", "40", "110"),  # the plan's example: Adelaide gets US$110
        ("150", "150", "0", "150"),
        ("100", "150", "40", "100"),  # the run's own cap is smaller: it stays
        ("150", "150", "149.995", "0.00"),  # less than a cent left is nothing
        ("150", "150", "150", "0"),
        ("150", "150", "180", "0"),  # spent more than the budget: never below 0
    ],
)
def test_a_run_gets_the_smaller_of_its_cap_and_what_is_left(
    own: str, budget: str, spent: str, cap: str
) -> None:
    assert run_cap_in_round(D(own), D(budget), D(spent)) == D(cap)


def test_the_reasons_say_the_budget_and_the_next_round() -> None:
    from zoneinfo import ZoneInfo

    zone = ZoneInfo("Australia/Melbourne")
    nxt = melbourne(date(2026, 11, 30))
    assert spent_reason(D("150"), nxt, zone) == (
        "This round's budget (US$150) is spent. Next round: 30 Nov."
    )
    assert spent_reason(D("150.50"), None, zone) == "This round's budget (US$150.50) is spent."
    assert too_little_reason(D("1.2"), D("150"), nxt, zone) == (
        "Only US$1.20 is left of this round's budget (US$150), too little for a run. "
        "Next round: 30 Nov."
    )


def test_the_four_defaults_are_the_round_order() -> None:
    assert tuple(city for city, _ in CITY_DAYS) == CITIES
    assert {job.key for job in JOBS} >= {job_key(city) for city in CITIES}
