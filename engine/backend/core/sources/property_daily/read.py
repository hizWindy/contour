"""Reading Property Daily: sign-in, the daily feed, one company's lookup, and the leases that end
soon (PLAN-V16 T2-5). Each step reads pages through a `SiteReader` (one page at a time, at a slow
pace, with the stop rules) and gives back parsed records. Saving them is the store's job.

- **Sign-in** fills the site's own sign-in form with the login from the settings. The values go
  straight into the browser: never into a log, an error or a record.
- **The feed** reads each working day's email since the last one read: 1 page a day.
- **A lookup** is the search and the lease search for the company's name, then its newest report
  in its city: about 3 pages. A name that doesn't match closely is left out (a weak match is not a
  fact).
- **Lease endings** are the lease database's two "ending soon" views (all of Australia, 1 page
  each), kept to leases of 500 m² and up that end in 12 to 36 months.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Protocol
from urllib.parse import quote_plus

from core.browser.reader import SiteReader, SourceStopped
from core.browser.stops import Seen
from core.config import Settings
from core.hubspot.matching import clean_name, core_tokens
from core.sources.meaning import months_until
from core.sources.property_daily.pages import Pages
from core.sources.property_daily.parse import (
    Parsed,
    market_city,
    parse_daily,
    parse_leases,
    parse_report,
    parse_search,
)


class NoLogin(SourceStopped):
    """Property Daily is on, but no username or password is set."""


class Reads(Protocol):
    """What these steps need from a reader: one page at a time. `SiteReader` is one."""

    async def page(self, url: str, *, kind: str, run_id: uuid.UUID | None = None) -> Seen: ...


def signer(settings: Settings, pages: Pages) -> Callable[[SiteReader], Awaitable[None]]:
    """The sign-in step a `SiteReader` calls when it meets the sign-in page."""

    async def sign_in(reader: SiteReader) -> None:
        login, password = settings.property_daily_username, settings.property_daily_password
        if login is None or password is None:
            raise NoLogin("no login is set")
        form = pages.signin_form
        await reader.submit(
            pages.pages.signin,
            {form.login: login.get_secret_value(), form.password: password.get_secret_value()},
            form.submit,
        )

    return sign_in


# --- The feed --------------------------------------------------------------------------------


def working_days(after: date | None, today: date, pages: Pages) -> list[date]:
    """The working days whose email is still to read: after `after` up to today, oldest first."""
    first = (
        after + timedelta(days=1) if after else today - timedelta(days=pages.feed.first_read_days)
    )
    first = max(first, today - timedelta(days=pages.feed.most_days))
    days: list[date] = []
    day = first
    while day <= today:
        if day.weekday() < 5:
            days.append(day)
        day += timedelta(days=1)
    return days


@dataclass
class FeedRead:
    records: list[Parsed] = field(default_factory=list)
    last_day: date | None = None  # the newest day read


async def read_feed(
    reader: Reads, pages: Pages, *, after: date | None, today: date, read_at: datetime
) -> FeedRead:
    out = FeedRead()
    for day in working_days(after, today, pages):
        url = pages.pages.daily.format(day=day.isoformat())
        seen = await reader.page(url, kind="feed")
        out.records += parse_daily(seen.html, url=url, read_at=read_at, published_on=day)
        out.last_day = day
    return out


# --- A lookup --------------------------------------------------------------------------------


@dataclass
class Lookup:
    records: list[Parsed] = field(default_factory=list)
    website: str | None = None
    pages: int = 0

    @property
    def found(self) -> bool:
        return bool(self.records)


def same_company(asked: str, found: str) -> bool:
    """The same company by name: equal once cleaned, or the same core words."""
    if clean_name(asked) == clean_name(found):
        return True
    asked_core, found_core = core_tokens(asked), core_tokens(found)
    return bool(asked_core) and asked_core == found_core


async def lookup(
    reader: Reads,
    pages: Pages,
    name: str,
    city: str | None,
    *,
    read_at: datetime,
    run_id: uuid.UUID | None = None,
) -> Lookup:
    out = Lookup()
    wanted = quote_plus(name.strip())
    seen = await reader.page(pages.pages.search.format(name=wanted), kind="search", run_id=run_id)
    out.pages += 1
    rows = [row for row in parse_search(seen.html) if same_company(name, row.organisation)]
    in_city = [row for row in rows if city is None or market_city(row.market) == city]
    seen = await reader.page(
        pages.pages.lease_search.format(name=wanted), kind="lease_search", run_id=run_id
    )
    out.pages += 1
    out.records += [
        lease
        for lease in parse_leases(seen.html, read_at=read_at)
        if same_company(name, lease.record.company)
        and (city is None or lease.record.city in (None, city))
    ]
    best = max(in_city or rows, key=lambda row: row.published_on or date.min, default=None)
    if best is not None:
        url = pages.pages.report.format(id=best.report_id)
        seen = await reader.page(url, kind="report", run_id=run_id)
        out.pages += 1
        report = parse_report(seen.html, url=url, read_at=read_at)
        if report is not None:
            out.records += report.records
            out.website = report.website
    return out


# --- Lease endings ---------------------------------------------------------------------------


async def read_lease_endings(
    reader: Reads, pages: Pages, *, today: date, read_at: datetime
) -> list[Parsed]:
    window = pages.lease_endings
    out: list[Parsed] = []
    for url in pages.pages.lease_views:
        seen = await reader.page(url, kind="lease_view")
        for lease in parse_leases(seen.html, read_at=read_at):
            ends, area = lease.record.lease_end, lease.record.area_m2
            if ends is None or area is None or area < window.smallest_m2:
                continue
            if window.from_months <= months_until(ends, today) <= window.to_months:
                out.append(lease)
    return out


__all__ = [
    "FeedRead",
    "Lookup",
    "NoLogin",
    "lookup",
    "read_feed",
    "read_lease_endings",
    "same_company",
    "signer",
    "working_days",
]
