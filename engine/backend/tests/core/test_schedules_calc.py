"""When a schedule runs next (PLAN-V6 D1): the calculation alone, no database and no clock.

Melbourne is UTC+11 from the first Sunday in October (2026-10-04) to the first Sunday in April
(2027-04-04), and UTC+10 the rest of the year. Every UTC moment below is written out by hand from
that, so a test fails if the wall clock drifts by an hour.
"""

import random
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from core.schedules.calc import Cadence, describe, first_run, next_after, slot

MEL = ZoneInfo("Australia/Melbourne")


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


def melbourne(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=MEL)


MONDAY_7AM_FORTNIGHTLY = Cadence(every=2, unit="weeks", weekday=0, at=time(7, 0))
DAILY_6AM = Cadence(every=1, unit="days", at=time(6, 0))


# --- The first time ---------------------------------------------------------------------------


def test_the_first_run_of_a_weekly_schedule_is_the_next_matching_weekday() -> None:
    thursday = melbourne(2026, 11, 5, 10, 0)  # a Thursday
    assert thursday.weekday() == 3
    assert first_run(MONDAY_7AM_FORTNIGHTLY, thursday) == utc(2026, 11, 8, 20, 0)  # Mon 9 Nov 7:00


def test_a_weekly_schedule_that_is_due_today_runs_today_unless_the_time_has_gone() -> None:
    monday = (2026, 11, 9)
    just_before = melbourne(*monday, 6, 59)
    assert first_run(MONDAY_7AM_FORTNIGHTLY, just_before) == utc(2026, 11, 8, 20, 0)
    on_the_dot = melbourne(*monday, 7, 0)
    assert first_run(MONDAY_7AM_FORTNIGHTLY, on_the_dot) == utc(2026, 11, 15, 20, 0)  # next week
    after = melbourne(*monday, 7, 1)
    assert first_run(MONDAY_7AM_FORTNIGHTLY, after) == utc(2026, 11, 15, 20, 0)


def test_the_first_run_of_a_daily_schedule_is_today_or_tomorrow() -> None:
    assert first_run(DAILY_6AM, melbourne(2026, 11, 5, 5, 0)) == utc(2026, 11, 4, 19, 0)
    assert first_run(DAILY_6AM, melbourne(2026, 11, 5, 6, 0)) == utc(2026, 11, 5, 19, 0)
    assert first_run(DAILY_6AM, melbourne(2026, 11, 5, 23, 59)) == utc(2026, 11, 5, 19, 0)


def test_the_day_is_the_day_in_the_zone_not_in_utc() -> None:
    """Half past midnight on Monday in Melbourne is still Sunday in UTC. The schedule goes by the
    zone's day, so it is Monday, and 7:00 am the same morning is next."""
    just_after_midnight = melbourne(2026, 11, 9, 0, 30)  # Monday 12:30 am; Sunday 13:30 UTC
    assert just_after_midnight.astimezone(UTC).weekday() == 6  # Sunday in UTC
    assert first_run(MONDAY_7AM_FORTNIGHTLY, just_after_midnight) == utc(2026, 11, 8, 20, 0)


# --- The next time after one ------------------------------------------------------------------


def test_a_run_on_time_gives_the_time_one_period_later() -> None:
    meant = utc(2026, 11, 8, 20, 0)  # Mon 9 Nov 7:00
    assert next_after(MONDAY_7AM_FORTNIGHTLY, meant, meant) == utc(
        2026, 11, 22, 20, 0
    )  # Mon 23 Nov
    one_second_later = meant + timedelta(seconds=1)
    assert next_after(MONDAY_7AM_FORTNIGHTLY, meant, one_second_later) == utc(2026, 11, 22, 20, 0)


def test_a_late_run_stays_on_its_own_days() -> None:
    meant = utc(2026, 11, 8, 20, 0)  # Mon 9 Nov 7:00
    wednesday = melbourne(2026, 11, 11, 12, 0)
    assert next_after(MONDAY_7AM_FORTNIGHTLY, meant, wednesday) == utc(2026, 11, 22, 20, 0)
    # The Monday after is not one of its days (every 2 weeks): 16 Nov is skipped.
    assert next_after(MONDAY_7AM_FORTNIGHTLY, meant, melbourne(2026, 11, 17, 9, 0)) == utc(
        2026, 11, 22, 20, 0
    )


def test_a_schedule_missed_for_weeks_runs_once_and_skips_the_times_in_between() -> None:
    meant = utc(2026, 11, 8, 20, 0)  # Mon 9 Nov 7:00; then 23 Nov, 7 Dec, 21 Dec...
    back_on = melbourne(2026, 12, 16, 10, 0)  # a Wednesday, 5 weeks later
    assert next_after(MONDAY_7AM_FORTNIGHTLY, meant, back_on) == utc(2026, 12, 20, 20, 0)  # 21 Dec
    # Exactly on a later time: the next one has to be after it, never the same.
    on_the_seventh = melbourne(2026, 12, 7, 7, 0)
    assert next_after(MONDAY_7AM_FORTNIGHTLY, meant, on_the_seventh) == utc(2026, 12, 20, 20, 0)


def test_a_daily_schedule_gives_the_next_day() -> None:
    meant = utc(2026, 11, 8, 19, 0)  # Mon 9 Nov 6:00
    assert next_after(DAILY_6AM, meant, meant) == utc(2026, 11, 9, 19, 0)
    assert next_after(DAILY_6AM, meant, melbourne(2026, 11, 12, 12, 0)) == utc(2026, 11, 12, 19, 0)


def test_every_three_days_counts_in_threes() -> None:
    three = Cadence(every=3, unit="days", at=time(6, 0))
    meant = utc(2026, 11, 8, 19, 0)  # Mon 9 Nov 6:00
    assert next_after(three, meant, meant) == utc(2026, 11, 11, 19, 0)  # Thu 12 Nov
    assert next_after(three, meant, melbourne(2026, 11, 13, 0, 0)) == utc(
        2026, 11, 14, 19, 0
    )  # 15 Nov


# --- Daylight saving --------------------------------------------------------------------------


def test_7am_stays_7am_when_the_clocks_go_forward() -> None:
    weekly = Cadence(every=1, unit="weeks", weekday=0, at=time(7, 0))
    before = slot(melbourne(2026, 9, 28).date(), time(7, 0), MEL)  # Mon 28 Sep, UTC+10
    assert before == utc(2026, 9, 27, 21, 0)
    after = next_after(weekly, before, before)  # Mon 5 Oct, UTC+11
    assert after == utc(2026, 10, 4, 20, 0)
    assert after - before == timedelta(days=6, hours=23)  # an hour short in UTC...
    assert after.astimezone(MEL).time() == time(7, 0)  # ...and still 7:00 on the wall


def test_7am_stays_7am_when_the_clocks_go_back() -> None:
    weekly = Cadence(every=1, unit="weeks", weekday=0, at=time(7, 0))
    before = utc(2027, 3, 28, 20, 0)  # Mon 29 Mar 7:00, UTC+11
    assert before.astimezone(MEL).time() == time(7, 0)
    after = next_after(weekly, before, before)  # Mon 5 Apr, UTC+10
    assert after == utc(2027, 4, 4, 21, 0)
    assert after - before == timedelta(days=7, hours=1)  # an hour long in UTC
    assert after.astimezone(MEL).time() == time(7, 0)


def test_a_time_that_does_not_exist_runs_once_at_the_moment_the_old_clock_gives() -> None:
    """On 4 Oct 2026 the clocks go from 2:00 straight to 3:00, so 2:30 am never happens."""
    nightly = Cadence(every=1, unit="days", at=time(2, 30))
    saturday = melbourne(2026, 10, 3, 12, 0)
    run = first_run(nightly, saturday)
    assert run == utc(2026, 10, 3, 16, 30)
    assert run.astimezone(MEL).strftime("%d %H:%M") == "04 03:30"  # 3:30 am, once
    assert next_after(nightly, run, run) == utc(2026, 10, 4, 15, 30)  # Mon... Sun night: 5 Oct 2:30


def test_a_time_that_happens_twice_runs_once_at_the_first() -> None:
    """On 4 Apr 2027 the clocks go from 3:00 back to 2:00, so 2:30 am happens twice."""
    nightly = Cadence(every=1, unit="days", at=time(2, 30))
    saturday_night = utc(2027, 4, 2, 15, 30)  # Sat 3 Apr 2:30, UTC+11
    sunday = next_after(nightly, saturday_night, saturday_night)
    assert sunday == utc(2027, 4, 3, 15, 30)  # the first 2:30 on Sun 4 Apr (UTC+11)
    monday = next_after(nightly, sunday, sunday)
    assert monday == utc(
        2027, 4, 4, 16, 30
    )  # Mon 5 Apr 2:30, UTC+10: nothing ran at the second 2:30
    assert [d.astimezone(MEL).strftime("%a %H:%M") for d in (sunday, monday)] == [
        "Sun 02:30",
        "Mon 02:30",
    ]


def test_a_zone_without_daylight_saving_never_moves() -> None:
    friday = Cadence(every=1, unit="weeks", weekday=4, at=time(17, 30), zone="Australia/Perth")
    first = first_run(friday, utc(2026, 11, 4, 0, 0))  # a Wednesday
    assert first == utc(2026, 11, 6, 9, 30)  # Perth is UTC+8 all year
    assert next_after(friday, first, first) == utc(2026, 11, 13, 9, 30)


@pytest.mark.parametrize("seed", range(4))
def test_whatever_the_cadence_the_next_time_is_the_first_one_still_to_come(seed: int) -> None:
    """2,000 random cadences and moments across a year of daylight-saving changes."""
    chance = random.Random(seed)
    first = utc(2026, 1, 1)
    for _ in range(500):
        unit = chance.choice(("days", "weeks"))
        every = chance.randint(1, 6)
        cadence = Cadence(
            every=every,
            unit=unit,  # type: ignore[arg-type]
            at=time(chance.choice([0, 1, 2, 3, 6, 7, 12, 23]), chance.choice([0, 30])),
            weekday=chance.randint(0, 6) if unit == "weeks" else None,
        )
        meant = first_run(
            cadence, first + timedelta(days=chance.randint(0, 300), minutes=chance.randint(0, 1439))
        )
        now = meant + timedelta(days=chance.randint(0, 120), seconds=chance.randint(0, 86399))
        found = next_after(cadence, meant, now)

        assert found > now, (cadence, meant, now)
        local = found.astimezone(MEL)
        # It is a whole number of periods after `meant`, counted in days on the wall clock...
        days_apart = (local.date() - meant.astimezone(MEL).date()).days
        assert days_apart % cadence.step == 0 and days_apart >= cadence.step
        # ...at the wall-clock time, except in the hour that doesn't exist...
        if local.time() != cadence.at:
            assert cadence.at.hour == 2 and local.hour == 3  # the spring-forward gap
        # ...and no earlier time was skipped that was still to come.
        earlier = slot(local.date() - timedelta(days=cadence.step), cadence.at, MEL)
        assert days_apart == cadence.step or earlier <= now, (cadence, meant, now)


# --- The rules of a cadence -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kwargs", "words"),
    [
        ({"every": 0, "unit": "days", "at": time(6)}, "1 or more"),
        ({"every": 1, "unit": "months", "at": time(6)}, "unit"),
        ({"every": 1, "unit": "weeks", "at": time(6)}, "needs a weekday"),
        ({"every": 1, "unit": "days", "at": time(6), "weekday": 2}, "needs a weekday"),
        ({"every": 1, "unit": "weeks", "at": time(6), "weekday": 7}, "Sunday"),
        ({"every": 1, "unit": "days", "at": time(6, tzinfo=UTC)}, "no time zone"),
        ({"every": 1, "unit": "days", "at": time(6), "zone": "Nowhere/City"}, "not a time zone"),
        ({"every": 1, "unit": "days", "at": time(6), "zone": "../etc/passwd"}, "not a time zone"),
    ],
)
def test_a_cadence_that_makes_no_sense_is_refused(kwargs: dict[str, object], words: str) -> None:
    with pytest.raises(ValueError, match=words):
        Cadence(**kwargs)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("cadence", "words"),
    [
        (MONDAY_7AM_FORTNIGHTLY, "Every 2 weeks on Monday at 7:00 am"),
        (
            Cadence(every=1, unit="weeks", weekday=4, at=time(17, 30)),
            "Every week on Friday at 5:30 pm",
        ),
        (DAILY_6AM, "Every day at 6:00 am"),
        (Cadence(every=3, unit="days", at=time(12, 0)), "Every 3 days at 12:00 pm"),
        (Cadence(every=1, unit="days", at=time(0, 5)), "Every day at 12:05 am"),
    ],
)
def test_a_cadence_is_said_in_plain_words(cadence: Cadence, words: str) -> None:
    assert describe(cadence) == words
