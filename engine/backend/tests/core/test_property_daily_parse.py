"""Property Daily's pages into records (PLAN-V16 T2-5), on made-up pages like the real ones."""

from datetime import UTC, date, datetime

import pytest

from core.sources.property_daily.parse import (
    city_of,
    parse_daily,
    parse_leases,
    parse_report,
    parse_search,
    read_area,
    read_date,
)
from tests.core.property_daily_pages import DAILY, LEASES, REPORT, SEARCH

READ_AT = datetime(2026, 11, 15, 6, 15, tzinfo=UTC)
PEOPLE = ("jane", "citizen", "john", "smith", "sam agent", "@", "0412", "9123", "9000")


def no_people(texts: list[str]) -> None:
    joined = " ".join(texts).lower()
    for mark in PEOPLE:
        assert mark not in joined, mark


@pytest.mark.parametrize(
    ("text", "expected", "month_end"),
    [
        ("29 February 2028", date(2028, 2, 29), False),
        ("Lease Expiry: March 2008", date(2008, 3, 31), True),
        ("Further details expected March 2027", date(2027, 3, 1), False),
        ("Suite 2000 then 4 July 2029", date(2029, 7, 4), False),
        ("no date here", None, False),
        ("31 February 2028", None, False),
    ],
)
def test_dates(text: str, expected: date | None, month_end: bool) -> None:
    assert read_date(text, month_end=month_end) == expected


def test_areas_and_cities() -> None:
    assert read_area("2,800 - 3,300sqm") == 3300
    assert read_area("Level 5, (3,289sqm),") == 3289
    assert read_area("no size") is None
    assert (city_of("WA", "6000"), city_of("QLD", "4226"), city_of("VIC", "3220")) == (
        "Perth",
        "Gold Coast",
        "Geelong",
    )
    assert city_of(None, None) is None


def test_the_daily_email_gives_each_items_need_lease_and_awarded_fitout() -> None:
    parsed = parse_daily(DAILY, url="u", read_at=READ_AT, published_on=date(2026, 11, 13))
    by_kind = {(item.record.company, item.record.kind): item for item in parsed}
    assert set(by_kind) == {
        ("Sample Logistics Pty Ltd", "requirement"),
        ("Sample Logistics Pty Ltd", "lease"),
        ("Example Engineering", "lease"),
        ("Example Engineering", "fitout"),
    }
    need = by_kind["Sample Logistics Pty Ltd", "requirement"].record
    assert (need.area_m2, need.city, need.published_on) == (1500, "Perth", date(2026, 11, 13))
    assert need.url == "https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=901"
    lease = by_kind["Sample Logistics Pty Ltd", "lease"].record
    assert (lease.floor, lease.building, lease.area_m2) == ("Level 12", "Sample Tower", 1100)
    assert lease.address == "100 Example Street, Perth WA 6000"
    assert (lease.lease_end, lease.city) == (date(2028, 6, 30), "Perth")
    other = by_kind["Example Engineering", "lease"].record
    assert (other.city, other.lease_end, other.area_m2) == ("Melbourne", None, 800)
    assert other.floor == "Part level 3 - Suite 2"
    fitout = by_kind["Example Engineering", "fitout"].record
    assert "Sample Design Studio" in fitout.summary
    assert by_kind["Sample Logistics Pty Ltd", "lease"].ref == "report:901"
    assert len({item.key for item in parsed}) == len(parsed)  # each fact has its own key
    no_people([item.record.model_dump_json() for item in parsed])


def test_reading_the_same_page_twice_gives_the_same_keys() -> None:
    first = parse_daily(DAILY, url="u", read_at=READ_AT, published_on=date(2026, 11, 13))
    later = parse_daily(DAILY, url="u", read_at=datetime.now(UTC), published_on=date(2026, 11, 13))
    assert [item.key for item in first] == [item.key for item in later]


def test_a_report_gives_the_need_the_offices_and_the_website_but_no_people() -> None:
    report = parse_report(
        REPORT, url="https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=901", read_at=READ_AT
    )
    assert report is not None
    assert (report.company, report.city) == ("Sample Logistics Pty Ltd", "Perth")
    assert report.website == "www.samplelogistics.example"
    kinds = [(item.record.kind, item.record.lease_end) for item in report.records]
    assert kinds == [
        ("requirement", None),
        ("lease", date(2028, 6, 30)),
        ("lease", date(2015, 3, 31)),
        ("lease", date(2009, 2, 28)),
    ]
    current = report.records[1].record
    assert (current.city, current.area_m2, current.building) == ("Perth", 1100, "Sample Tower")
    past = report.records[2].record
    assert (past.city, past.address, past.area_m2) == (
        "Perth",
        "8 Old Lane, West Perth WA 6005",
        600,
    )
    assert report.records[3].record.address == "1 First Street, Fremantle WA 6160"
    assert report.records[0].record.area_m2 == 1500
    # "Previous Interior Designer" is a past project: no fitout record now.
    assert all(item.record.kind != "fitout" for item in report.records)
    no_people([item.record.model_dump_json() for item in report.records])


def test_a_page_that_isnt_a_report_gives_nothing() -> None:
    assert (
        parse_report("<html><title>Home</title><body>Hi</body></html>", url="u", read_at=READ_AT)
        is None
    )


def test_search_rows_give_each_report_and_its_market() -> None:
    found = parse_search(SEARCH)
    assert [(row.report_id, row.organisation, row.market) for row in found] == [
        ("901", "Sample Logistics Pty Ltd", "Perth"),
        ("355", "Sample Logistics", "Melbourne"),
    ]
    assert found[1].published_on == date(2019, 10, 19)


def test_lease_rows_give_one_lease_each() -> None:
    parsed = parse_leases(LEASES, read_at=READ_AT)
    rows = [
        (item.record.company, item.record.city, item.record.area_m2, item.record.lease_end)
        for item in parsed
    ]
    assert rows == [
        ("Sample Logistics Pty Ltd", "Perth", 1100, date(2028, 6, 30)),
        ("Example Insurance Group", "Sydney", 2940, date(2028, 8, 7)),
        ("Coast Sample Co", "Gold Coast", 1042, date(2027, 8, 31)),
    ]
    first = parsed[0]
    assert first.ref == "lease:7001"
    assert first.record.url.endswith("/cgi-bin/lease_expiry_news.cgi/report?id=7001")
    assert first.record.floor == "Level 12"
    assert "Sample Property Trust" not in first.record.model_dump_json()  # an owner, not ours
