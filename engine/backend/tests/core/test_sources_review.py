"""Two fixes from the review before PLAN-V16's M1, in Track 2's code: the never-open list reads a
query's names, not a searched company's name, and no email or phone number survives in a record's
summary. Pure code."""

from datetime import UTC, datetime
from urllib.parse import quote

from core.sources.property_daily.pages import property_daily_pages
from core.sources.property_daily.parse import _record


def test_a_company_name_in_a_search_is_not_a_never_open_page() -> None:
    pages = property_daily_pages()
    site = pages.as_site()
    for name in ("Sample Payments Group", "Sample Notes and Registers", "Sample Request Co"):
        assert site.may_open(pages.pages.search.format(name=quote(name))), name
    assert not site.may_open("https://www.spatialgroup.com.au/main/logout")
    assert not site.may_open("https://www.spatialgroup.com.au/cgi-bin/x.cgi?shortlist=1")
    assert not site.may_open("https://example.com/cgi-bin/search.cgi")  # another host


def test_no_email_or_phone_number_survives_in_a_summary() -> None:
    parsed = _record(
        kind="fitout",
        company="Sample Engineering",
        city="Melbourne",
        place=None,
        url="https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=1",
        read_at=datetime(2026, 11, 15, tzinfo=UTC),
        ref="report:1",
        summary=(
            "Sample Engineering's fitout is with Sample Studio, pat@studio.example, 03 9000 0000."
        ),
    )
    assert "@" not in parsed.record.summary
    assert "9000" not in parsed.record.summary
    assert parsed.record.summary.startswith("Sample Engineering's fitout is with Sample Studio")
