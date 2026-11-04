"""When a schedule runs next. Pure: no database and no clock of its own. PLAN-V6 D1.

A schedule says "every N days or weeks, on a weekday, at a time of day, in a time zone", like
"every 2 weeks, on Monday, at 7:00 am, Australia/Melbourne". Plain cron can't say "every 2 weeks".

**The time is the wall clock in the zone.** 7:00 am Melbourne stays 7:00 am all year, though it is
8:00 pm the day before in UTC for half the year (UTC+11) and 9:00 pm for the other half (UTC+10).
So a date and a time are worked out in the zone, and only then turned into a moment (UTC). Adding
7 x 24 hours to a moment would drift an hour at each change.

**Daylight saving.** A wall-clock time that doesn't exist (2:30 am on the day the clocks go from
2:00 to 3:00) runs at the same moment the old offset gives, which is 3:30 am. One that happens twice
(2:30 am on the day they go back) runs at the first of them, so it runs once.

**Missed times.** The next time is counted from the time the schedule was meant to run, not from
when it did, so a Monday schedule that ran late on Wednesday stays on its Mondays. If it was missed
for weeks, the times in between are skipped: it runs once and waits for the first one still to come.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

Unit = Literal["days", "weeks"]
UNITS: tuple[Unit, ...] = ("days", "weeks")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
DEFAULT_ZONE = "Australia/Melbourne"


@dataclass(frozen=True)
class Cadence:
    """How often, and when in the day. `weekday` is 0 for Monday to 6 for Sunday, and it is needed
    for a schedule in weeks and left out for one in days."""

    every: int
    unit: Unit
    at: time
    weekday: int | None = None
    zone: str = DEFAULT_ZONE

    def __post_init__(self) -> None:
        if self.every < 1:
            raise ValueError("every must be 1 or more")
        if self.unit not in UNITS:
            raise ValueError(f"unit must be one of {UNITS}")
        if self.at.tzinfo is not None:
            raise ValueError("the time of day is the wall clock in the zone: give no time zone")
        if (self.unit == "weeks") != (self.weekday is not None):
            raise ValueError("a schedule in weeks needs a weekday, and one in days has none")
        if self.weekday is not None and not 0 <= self.weekday <= 6:
            raise ValueError("weekday is 0 (Monday) to 6 (Sunday)")
        try:
            ZoneInfo(self.zone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"{self.zone!r} is not a time zone") from error

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.zone)

    @property
    def step(self) -> int:
        """The days between two times."""
        return self.every * 7 if self.unit == "weeks" else self.every


def slot(day: date, at: time, tz: ZoneInfo) -> datetime:
    """The moment (UTC) of this wall-clock time on this date in this zone."""
    return datetime.combine(day, at, tzinfo=tz).astimezone(
        UTC
    )  # fold=0: a repeated time is the first


def first_run(cadence: Cadence, now: datetime) -> datetime:
    """The first time after `now`: the next matching weekday at the time (in weeks), or the next
    time of day (in days). Used when a schedule is made or switched on, and when it is edited."""
    tz = cadence.tz
    day = now.astimezone(tz).date()
    if cadence.weekday is not None:
        day += timedelta(days=(cadence.weekday - day.weekday()) % 7)
    if slot(day, cadence.at, tz) <= now:
        day += timedelta(days=7 if cadence.unit == "weeks" else 1)
    return slot(day, cadence.at, tz)


def next_after(cadence: Cadence, scheduled: datetime, now: datetime) -> datetime:
    """The first time after `now` that is a whole number of periods after `scheduled`.

    `scheduled` is the time the schedule was meant to run. A run that happens on time gives the
    time one period later. A late run (the backend was off) gives the first time still to come that
    keeps the same days, so each missed time is left out and none is run twice.
    """
    tz = cadence.tz
    first_day = scheduled.astimezone(tz).date()
    step = cadence.step
    gone = (now.astimezone(tz).date() - first_day).days
    periods = max(1, gone // step)
    while slot(first_day + timedelta(days=periods * step), cadence.at, tz) <= now:
        periods += 1
    while (
        periods > 1 and slot(first_day + timedelta(days=(periods - 1) * step), cadence.at, tz) > now
    ):
        periods -= 1
    return slot(first_day + timedelta(days=periods * step), cadence.at, tz)


def describe(cadence: Cadence) -> str:
    """The schedule in plain words, like "Every 2 weeks on Monday at 7:00 am"."""
    clock = cadence.at.strftime("%I:%M %p").lstrip("0").replace("AM", "am").replace("PM", "pm")
    if cadence.unit == "weeks" and cadence.weekday is not None:
        day = WEEKDAYS[cadence.weekday]
        every = "Every week" if cadence.every == 1 else f"Every {cadence.every} weeks"
        return f"{every} on {day} at {clock}"
    return (
        f"Every day at {clock}" if cadence.every == 1 else f"Every {cadence.every} days at {clock}"
    )
