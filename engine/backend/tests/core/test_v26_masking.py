"""PLAN-V26 choice 17: the Data tab hides contact details and keys, and lists no secret column.

Every name, address and number here is made up.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from core.api.app import create_app
from core.data import service
from core.data.masking import CELL_MAX, cell, hide_contacts
from core.db.base import Base

NEVER = ("password_hash", "token_hash", "idempotency_key", "request_id", "embedding", "record_key")


@pytest.mark.parametrize(
    ("value", "shown"),
    [
        ("jo@northwind.com.au", "j•••@northwind.com.au"),
        ("Write to jo.sample@northwind.com.au.", "Write to j•••@northwind.com.au."),
        ("Ring 0412 345 678 today", "Ring ••• 678 today"),
        ("Ring 0412345678", "Ring ••• 678"),
        ("+61 412 345 678", "••• 678"),
        ("+61 (0)3 9000 1234", "••• 234"),
        ("(03) 9000-1234", "••• 234"),
        ("1300 555 019", "••• 019"),
        ("their line is 9000 1234", "their line is ••• 234"),
        ("+44 20 7946 0958", "••• 958"),
    ],
)
def test_emails_and_phone_numbers_are_hidden(value: str, shown: str) -> None:
    assert hide_contacts(value) == shown


@pytest.mark.parametrize(
    "value",
    [
        "A lease to 31/03/2028",
        "Signed 2026-11-04 at noon",
        "About 12,500,000 a year and 850 sqm",
        "https://app.hubspot.com/contacts/1234/company/28123456789",
        "lead:0a41f2c4-1c22-4e0a-9b1b-123456789012",
        "04123456-1234-4123-8123-123456789012",
        "Suite 4, 120 Collins Street, 2026 to 2027",
    ],
)
def test_dates_ids_money_and_addresses_stay(value: str) -> None:
    assert hide_contacts(value) == value


def test_a_marked_column_is_hidden_whatever_it_holds() -> None:
    assert cell("555 0199", "phone") == "••• 199"
    assert cell("12", "phone") == "•••"
    assert cell("not an address", "email") == "•••"
    assert cell("jo@northwind.com.au", "email") == "j•••@northwind.com.au"


def test_json_is_hidden_at_every_depth() -> None:
    shown = cell(
        {
            "to": [{"name": "Jo Sample", "email": "jo@northwind.com.au"}],
            "person": {"mobile": "555 0199", "note": "or 0412 345 678"},
            "phone": 5550199,
        }
    )
    assert shown is not None
    assert "Jo Sample" in shown
    for secret in ("jo@", "555 0199", "0412", "5550199"):
        assert secret not in shown


def test_a_key_is_never_shown() -> None:
    key = "sk-ant-" + "api03-" + "a" * 60  # made up
    assert key not in (cell(f"the key is {key}") or "")


def test_an_address_at_the_cut_is_hidden_before_it_is_cut() -> None:
    shown = cell("x" * (CELL_MAX - 5) + " jo@northwind.com.au")
    assert shown is not None
    assert len(shown) == CELL_MAX + 1
    assert "jo@" not in shown


def test_plain_values_read_as_text() -> None:
    at = datetime(2026, 11, 4, 1, 0, tzinfo=UTC)
    uid = uuid.UUID(int=7)
    assert cell(None) is None
    assert (cell(True), cell(False)) == ("Yes", "No")
    assert cell(at) == "2026-11-04T01:00:00+00:00"
    assert cell(date(2028, 3, 31)) == "2028-03-31"
    assert (cell(Decimal("1.50")), cell(uid)) == ("1.50", str(uid))


def test_every_table_is_listed_once_with_real_columns_and_a_plain_name() -> None:
    tables = service.listed(create_app().state.apps)
    names = [table.table for table in tables]
    assert len(names) == len(set(names))
    assert len({(table.group, table.label) for table in tables}) == len(tables)
    ours = {name for name in Base.metadata.tables if name.split(".")[0] != "langgraph"}
    assert set(names) == {name for name in ours if not name.startswith("test")}
    for table in tables:
        real = {column.name for column in service.db_table(table).columns}
        wanted = {column.key for column in table.columns} | set(table.search) | {table.newest}
        assert wanted <= real, table.table
        assert table.search, table.table


def test_no_hash_key_or_contact_detail_is_listed_unhidden() -> None:
    for table in service.listed(create_app().state.apps):
        for column in table.columns:
            assert column.key not in NEVER, f"{table.table}.{column.key}"
            assert "hash" not in column.key and "secret" not in column.key
            if column.key in ("email", "phone", "mobile"):
                assert column.mask is not None, f"{table.table}.{column.key}"
                assert not service.sortable(table, column)
                assert column.key not in table.search


def test_every_hubspot_table_says_to_change_it_in_hubspot() -> None:
    for table in service.listed(create_app().state.apps):
        if table.table.startswith("core.hubspot_"):
            assert table.note == "Change it in HubSpot, then press Sync.", table.table
