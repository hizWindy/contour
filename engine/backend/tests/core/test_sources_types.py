"""The property record shapes and the reader's names (PLAN-V16, the contract part 1).

S0 fixes the names, so Track 1 can build against them. T2-7 gives the reader its real code and
its own tests; these keep what must stay true from the start.
"""

import inspect
from datetime import UTC, date, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from core.config import Settings
from core.sources import reader
from core.sources.types import (
    SOURCE_IDS,
    SOURCE_NAMES,
    CompanyProperty,
    FeedItem,
    PropertyRecord,
)


def record(**values: Any) -> dict[str, Any]:
    return {
        "source": "arealytics",
        "kind": "lease",
        "company": "Sample Logistics Pty Ltd",
        "summary": "Leased 1,400 m² on level 12, ending in June 2028.",
        "url": "https://example.com/tenant/1",
        "read_at": datetime(2026, 11, 15, 9, tzinfo=UTC),
        **values,
    }


def test_a_record_holds_the_office_facts_and_a_feed_item_adds_its_meaning() -> None:
    lease = PropertyRecord(**record(area_m2=1400, lease_end=date(2028, 6, 30), floor="Level 12"))
    assert (lease.area_m2, lease.lease_end, lease.city) == (1400, date(2028, 6, 30), None)
    item = FeedItem(**record(kind="requirement"), sign_id="tenant_advisor")
    assert (item.sign_id, item.dampener_id, item.company) == (
        "tenant_advisor",
        None,
        "Sample Logistics Pty Ltd",
    )


@pytest.mark.parametrize("link", ["javascript:alert(1)", "ftp://example.com/x", "example.com"])
def test_a_record_link_is_a_web_address(link: str) -> None:
    with pytest.raises(ValidationError, match="url must be a web address"):
        PropertyRecord(**record(url=link))


@pytest.mark.parametrize(
    "values",
    [{"source": "linkedin"}, {"kind": "rumour"}, {"summary": ""}, {"area_m2": -1}],
)
def test_a_record_outside_the_contract_is_refused(values: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        PropertyRecord(**record(**values))


def test_an_empty_answer_names_both_tools_as_not_checked() -> None:
    empty = CompanyProperty()
    assert (empty.records, empty.looked_up_at) == ([], None)
    assert empty.checked.model_dump() == dict.fromkeys(SOURCE_IDS, "not_checked")
    assert set(SOURCE_NAMES) == set(SOURCE_IDS)


def test_the_reader_names_are_the_ones_in_the_contract() -> None:
    lookup = inspect.signature(reader.lookup_company)
    assert list(lookup.parameters)[:4] == ["session", "name", "city", "website"]
    assert list(inspect.signature(reader.recent_items).parameters) == [
        "session",
        "cities",
        "since",
    ]


async def test_the_stub_lookup_says_off_or_not_checked_from_the_switches() -> None:
    off = await reader.lookup_company(
        None,  # type: ignore[arg-type]  # with settings given, the stub reads no database
        "Sample Logistics Pty Ltd",
        "Perth",
        None,
        settings=Settings(_env_file=None),
    )
    assert off.checked.model_dump() == {"property_daily": "off", "arealytics": "off"}
    on = await reader.lookup_company(
        None,  # type: ignore[arg-type]
        "Sample Logistics Pty Ltd",
        "Perth",
        None,
        settings=Settings(_env_file=None, property_daily_enabled=True),
    )
    assert on.checked.model_dump() == {"property_daily": "not_checked", "arealytics": "off"}
    assert await reader.recent_items(None, ["Perth"], datetime.now(UTC)) == []  # type: ignore[arg-type]
