"""The dates in a call note, worked out by code (PLAN-V17 T2-4). Pure code: no database, no AI.

Claude writes the rep's words for a date in one simple form, like "next tuesday", "in 2 weeks"
or "march 2028" (the list is `DATE_FORMS`), and `read_when` turns it into a day. "Today" is
Melbourne's date, given by the caller, so tests can fix it.

- `this <weekday>` is the next one after today (1 to 7 days on). `next <weekday>` is that day in
  next week, which starts on Monday. `next week` is next week's Monday, `next month` the 1st of
  next month, `end of month` this month's last day.
- `in N months` is the same day N months on, or the month's last day when it is shorter.
- A date with no year is the next one on or after today. For a move (`back`), the latest one on
  or before today, since a move is in the past.
- `<Month> <YYYY>` and `<Month>` are the 1st of the month (TBC with Levi: the card shows the rep's
  words beside the date). `<YYYY>` alone is only a year.
- A task (`task_day`) never falls on a weekend or in the past. When code had to choose its day,
  it says why, so the card can say so.

Anything else is `Unreadable`, and never guessed.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final, Literal

DATE_FORMS = (
    "today, tomorrow, in N days, in N weeks, in N months, in N years, this <weekday>, next "
    "<weekday>, next week, next month, end of month, <D> <Month>, <D> <Month> <YYYY>, "
    "<Month> <YYYY>, <Month>, <YYYY>, unknown"
)
_WEEKDAY_WORDS = (
    ("monday", "mon"),
    ("tuesday", "tue", "tues"),
    ("wednesday", "wed", "weds"),
    ("thursday", "thu", "thur", "thurs"),
    ("friday", "fri"),
    ("saturday", "sat"),
    ("sunday", "sun"),
)
_MONTH_WORDS = (
    ("january", "jan"),
    ("february", "feb"),
    ("march", "mar"),
    ("april", "apr"),
    ("may",),
    ("june", "jun"),
    ("july", "jul"),
    ("august", "aug"),
    ("september", "sep", "sept"),
    ("october", "oct"),
    ("november", "nov"),
    ("december", "dec"),
)
WEEKDAYS: Final = {word: day for day, words in enumerate(_WEEKDAY_WORDS) for word in words}
MONTHS: Final = {word: month for month, words in enumerate(_MONTH_WORDS, 1) for word in words}
FIRST_YEAR, LAST_YEAR = 1950, 2100
NO_DATE: Final = frozenset({"", "unknown", "none", "not said"})

Precision = Literal["day", "month", "year"]


@dataclass(frozen=True)
class When:
    """A day, and how precise the rep's words were: "march 2028" is the 1st, to the month."""

    on: date
    precision: Precision


class Unreadable(ValueError):
    """Words that aren't one of the simple date forms."""


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _add_months(day: date, months: int) -> date:
    """The same day `months` on, or the month's last day when it is shorter (31 Jan, 28 Feb)."""
    year, index = divmod(day.year * 12 + day.month - 1 + months, 12)
    return date(year, index + 1, min(day.day, _month_end(year, index + 1).day))


def _year(text: str) -> int:
    year = int(text)
    if not FIRST_YEAR <= year <= LAST_YEAR:
        raise Unreadable(text)
    return year


def _day_in(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _nearest(month: int, day: int, today: date, *, back: bool) -> date:
    """The next one on or after today, or with `back` the latest one on or before it. 29 Feb
    waits for a leap year."""
    step = -1 if back else 1
    for years in range(9):
        found = _day_in(today.year + step * years, month, day)
        if found is not None and (found <= today if back else found >= today):
            return found
    raise Unreadable(f"{day} {month}")


def _tidy(words: str) -> str:
    text = words.casefold().replace(",", " ").replace(".", " ")
    text = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", r"\1", text)
    return " ".join(token for token in text.split() if token not in ("the", "of"))


def read_when(words: str, today: date, *, back: bool = False) -> When | None:
    """One simple date form as a day. None for "unknown": nothing was said.

    `today` is Melbourne's date. A date with no year is the next one on or after today, or with
    `back` (a move) the latest one on or before it. Case, spaces, "the", "of" and "3rd" are
    forgiven, and "Tue" reads as "Tuesday". A date as YYYY-MM-DD (what the website sends for a
    date the rep picked) reads as that day. Anything else raises Unreadable: it is never guessed.
    """
    text = _tidy(words)
    if text in NO_DATE:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        exact = _day_in(_year(text[:4]), int(text[5:7]), int(text[8:10]))
        if exact is None:
            raise Unreadable(words)
        return When(exact, "day")
    if text == "today":
        return When(today, "day")
    if text == "tomorrow":
        return When(today + timedelta(days=1), "day")
    if text == "next week":  # next week's Monday
        return When(today + timedelta(days=7 - today.weekday()), "day")
    if text == "next month":
        return When(_add_months(today.replace(day=1), 1), "day")
    if text in ("end month", "end this month"):
        return When(_month_end(today.year, today.month), "day")
    if found := re.fullmatch(r"in (\d{1,3}|a|an|one) (days?|weeks?|months?|years?)", text):
        count = 1 if found[1] in ("a", "an", "one") else int(found[1])
        unit = found[2].rstrip("s")
        if unit in ("day", "week"):
            return When(today + timedelta(days=count * (7 if unit == "week" else 1)), "day")
        return When(_add_months(today, count * (12 if unit == "year" else 1)), "day")
    parts = text.split()
    said_weekday = parts[-1] in WEEKDAYS and (
        len(parts) == 1 or (len(parts) == 2 and parts[0] in ("this", "next"))
    )
    if said_weekday:
        weekday = WEEKDAYS[parts[-1]]
        if parts[0] == "next":  # that weekday in next week, which starts on Monday
            monday = today + timedelta(days=7 - today.weekday())
            return When(monday + timedelta(days=weekday), "day")
        return When(today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1), "day")
    if re.fullmatch(r"\d{4}", text):
        return When(date(_year(text), 1, 1), "year")
    if (found := re.fullmatch(r"([a-z]+)(?: (\d{4}))?", text)) and found[1] in MONTHS:
        month = MONTHS[found[1]]
        if found[2]:
            return When(date(_year(found[2]), month, 1), "month")
        if back:
            year = today.year if month <= today.month else today.year - 1
        else:
            year = today.year if month >= today.month else today.year + 1
        return When(date(year, month, 1), "month")
    found = re.fullmatch(r"(\d{1,2}) ([a-z]+)(?: (\d{4}))?", text) or re.fullmatch(
        r"([a-z]+) (\d{1,2})(?: (\d{4}))?", text
    )
    if found is None:
        raise Unreadable(words)
    day_text, month_text = (found[1], found[2]) if found[1].isdigit() else (found[2], found[1])
    if month_text not in MONTHS:
        raise Unreadable(words)
    month, day = MONTHS[month_text], int(day_text)
    if not found[3]:
        return When(_nearest(month, day, today, back=back), "day")
    exact = _day_in(_year(found[3]), month, day)
    if exact is None:
        raise Unreadable(words)
    return When(exact, "day")


def working_day(day: date) -> date:
    """The day itself, or the Monday after a Saturday or a Sunday (TBC: public holidays)."""
    return day + timedelta(days=7 - day.weekday()) if day.weekday() >= 5 else day


def next_working_day(today: date) -> date:
    return working_day(today + timedelta(days=1))


def task_day(when: When | None, today: date) -> tuple[date, str | None]:
    """The day a task is due, and why code chose it when the rep's words couldn't be used.

    A weekend moves to the Monday. A date that has passed, only a year, or no date at all gives
    the next working day, with the reason, so the card says so. A month that has begun ("this
    November") is due today."""
    if when is None:
        return next_working_day(today), "no date was said"
    if when.precision == "year":
        return next_working_day(today), "only a year was said"
    due = when.on
    if when.precision == "month" and (due.year, due.month) == (today.year, today.month):
        due = today
    if due < today:
        return next_working_day(today), "that date has passed"
    return working_day(due), None
