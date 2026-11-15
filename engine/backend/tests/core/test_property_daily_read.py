"""Property Daily's steps (PLAN-V16 T2-5) on made-up pages, through a fake reader: no browser."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.browser.stops import Seen
from core.config import Settings
from core.sources.meaning import as_feed_item, meaning
from core.sources.property_daily.pages import PAGES_FILE, property_daily_pages, read_pages
from core.sources.property_daily.read import (
    NoLogin,
    lookup,
    read_feed,
    read_lease_endings,
    same_company,
    signer,
    working_days,
)
from core.sources.types import PropertyRecord, RecordKind
from tests.core.property_daily_pages import DAILY, LEASES, REPORT, SEARCH

PAGES = property_daily_pages()
READ_AT = datetime(2026, 11, 15, 6, 15, tzinfo=UTC)
TODAY = date(2026, 11, 16)  # a Monday
SEARCH_URL = "https://www.spatialgroup.com.au/cgi-bin/search.cgi"
LEASES_URL = "https://www.spatialgroup.com.au/cgi-bin/lease_expiry_news.cgi/marketview"


@dataclass
class FakeReader:
    """Serves made-up pages by the start of their address, and notes each page asked for."""

    pages: dict[str, str]
    asked: list[tuple[str, str, uuid.UUID | None]] = field(default_factory=list)

    async def page(self, url: str, *, kind: str, run_id: uuid.UUID | None = None) -> Seen:
        self.asked.append((url, kind, run_id))
        html = next((html for start, html in self.pages.items() if url.startswith(start)), "")
        return Seen(status=200, url=url, title="", text="", html=html)


def test_the_pages_file_is_valid_and_keeps_the_never_open_pages_closed() -> None:
    site = PAGES.as_site()
    assert site.hosts == {"www.spatialgroup.com.au", "www.propertydaily.com.au"}
    assert site.may_open("https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=1")
    for never in ("/cgi-bin/logout.cgi", "/main/pd/shortlist/add?ids=1", "/main/password"):
        assert not site.may_open(f"https://www.spatialgroup.com.au{never}")
    assert not site.may_open("https://accounts.google.com/")


def test_a_wrong_pages_file_is_refused(tmp_path: Path) -> None:
    text = PAGES_FILE.read_text(encoding="utf-8")
    bad = tmp_path / "pages.yaml"
    home = "https://www.spatialgroup.com.au/cgi-bin/main.cgi"
    bad.write_text(text.replace(home, "https://other.example/x"), encoding="utf-8")
    with pytest.raises(ValidationError, match="site's hosts"):
        read_pages(bad)


def test_the_working_days_to_read() -> None:
    assert working_days(date(2026, 11, 13), TODAY, PAGES) == [TODAY]  # read Friday, now Monday
    first = working_days(None, TODAY, PAGES)
    assert (first[0], first[-1], len(first)) == (date(2026, 11, 9), TODAY, 6)
    assert len(working_days(date(2026, 1, 1), TODAY, PAGES)) <= PAGES.feed.most_days


async def test_the_feed_reads_one_page_a_working_day() -> None:
    reader = FakeReader({"https://www.spatialgroup.com.au/main/mailview/pd/": DAILY})
    read = await read_feed(reader, PAGES, after=date(2026, 11, 12), today=TODAY, read_at=READ_AT)
    assert [url[-10:] for url, _, _ in reader.asked] == ["2026-11-13", "2026-11-16"]
    assert {kind for _, kind, _ in reader.asked} == {"feed"}
    assert read.last_day == TODAY
    assert len(read.records) == 8  # 4 records a day


async def test_a_lookup_reads_the_search_the_leases_and_the_best_report_in_the_city() -> None:
    reader = FakeReader(
        {
            SEARCH_URL: SEARCH,
            LEASES_URL: LEASES,
            "https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=901": REPORT,
        }
    )
    run = uuid.uuid4()
    found = await lookup(reader, PAGES, "Sample Logistics", "Perth", read_at=READ_AT, run_id=run)
    assert [kind for _, kind, _ in reader.asked] == ["search", "lease_search", "report"]
    assert all(asked_run == run for _, _, asked_run in reader.asked)
    assert "search=Sample+Logistics" in reader.asked[0][0]
    assert reader.asked[2][0].endswith("report.cgi?id=901")  # Perth, not the Melbourne report
    assert found.found and found.pages == 3
    assert found.website == "www.samplelogistics.example"
    assert {item.record.company for item in found.records} == {"Sample Logistics Pty Ltd"}


async def test_a_lookup_with_no_close_name_reads_no_report() -> None:
    reader = FakeReader({SEARCH_URL: SEARCH, LEASES_URL: LEASES})
    found = await lookup(reader, PAGES, "Sample Freight Services", "Perth", read_at=READ_AT)
    assert not found.found and found.pages == 2


def test_names_match_only_when_close() -> None:
    assert same_company("Sample Logistics", "Sample Logistics Pty Ltd")
    assert not same_company("Sample", "Sample Logistics Pty Ltd")
    assert not same_company("Apex Group", "Apex Plumbing")


async def test_lease_endings_keep_500_m2_and_up_ending_in_12_to_36_months() -> None:
    reader = FakeReader({LEASES_URL: LEASES})
    kept = await read_lease_endings(reader, PAGES, today=TODAY, read_at=READ_AT)
    assert len(reader.asked) == len(PAGES.pages.lease_views)
    assert {item.record.company for item in kept} == {
        "Sample Logistics Pty Ltd",
        "Example Insurance Group",
    }  # Coast Sample Co's lease ends in 9 months


async def test_sign_in_needs_a_login() -> None:
    sign_in = signer(Settings(_env_file=None), PAGES)
    with pytest.raises(NoLogin):
        await sign_in(None)  # type: ignore[arg-type]  # it stops before using the reader


@pytest.mark.parametrize(
    ("kind", "lease_end", "want"),
    [
        ("lease", date(2028, 6, 30), ("lease_ending", None)),
        ("lease", date(2027, 1, 31), (None, None)),
        ("move", None, ("lease_ending", None)),
        ("requirement", None, ("tenant_advisor", None)),
        ("fitout", None, (None, "recent_fitout")),
        ("news", None, (None, None)),
    ],
)
def test_what_each_record_means(
    kind: RecordKind, lease_end: date | None, want: tuple[str | None, str | None]
) -> None:
    record = PropertyRecord(
        source="property_daily",
        kind=kind,
        company="Sample Logistics Pty Ltd",
        lease_end=lease_end,
        summary="A fact.",
        url="https://example.com/1",
        read_at=READ_AT,
    )
    assert meaning(record, TODAY) == want
    item = as_feed_item(record, TODAY)
    assert (item.sign_id, item.dampener_id) == want
