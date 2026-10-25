"""Reading a HubSpot export, and saving it safely. Uses made-up companies only."""

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.importer import ExportError, normalize_domain, normalize_state, read_export
from core.hubspot.service import save_export, summary

COMPANY_HEADER = [
    "Company ID", "Company Name", "Website", "Phone", "Street Address", "City", "State",
    "Postal Code", "Country", "Industry", "Employees", "Total Staff on LinkedIn (AU)",
    "Offices on Record", "Lifecycle Stage", "Owner", "Created Date", "Last Contacted",
    "# Contacts", "# Deals", "Total Deal Value (AUD)", "LinkedIn", "Description", "HubSpot Record",
]  # fmt: skip
OFFICE_HEADER = [
    "Company ID", "Company Name", "Office", "Level", "Street Address", "City", "Post Code",
    "Phone Number", "Last Moved", "Lease Expiry", "Staff on LinkedIn",
]  # fmt: skip
DEAL_HEADER = [
    "Company ID", "Company Name", "Deal ID", "Deal Name", "Deal Stage", "Amount (AUD)",
    "Close Date", "Deal Owner", "Created Date", "Last Contacted", "Next Step", "HubSpot Record",
]  # fmt: skip
LINKEDIN = "https://www.linkedin.com/company/abc-logistics/"


def make_export(path: Path) -> Path:
    workbook = Workbook()
    companies = workbook.active
    assert companies is not None
    companies.title = "Companies"
    companies.append(COMPANY_HEADER)
    companies.append([
        101, "ABC Logistics", "https://www.abclogistics.com.au/about", "+61 8 6000 0000",
        "1 Example Street", "Perth", "Western Australia", 6000, "Australia", "Logistics",
        300, 150, "Perth", "Lead", "Test Owner", datetime(2026, 10, 1), None, 2,
        "=COUNTIF(Deals!A:A,A2)", None, "Open", "A made-up company", "Open",
    ])  # fmt: skip
    companies.cell(row=2, column=COMPANY_HEADER.index("LinkedIn") + 1).hyperlink = LINKEDIN
    companies.append([
        "102", "XYZ Engineering", "xyz.com.au", None, None, "Adelaide", "5000", None, None,
        "Civil Engineering", "120", None, "Adelaide", "Lead", "Test Owner", None, None, 0,
        None, None, None, None, None,
    ])  # fmt: skip
    companies.append([None] * len(COMPANY_HEADER))  # a blank row

    offices = workbook.create_sheet("Office Locations")
    offices.append(OFFICE_HEADER)
    offices.append([
        "101", "ABC Logistics", "Perth", "Level 5", "1 Example Street", "Perth", 6000,
        "+61 8 6000 0000", None, datetime(2028, 6, 30), 150,
    ])  # fmt: skip
    offices.append(
        ["999", "Not In This File", "Perth", None, None, None, None, None, None, None, 9]
    )

    deals = workbook.create_sheet("Deals")
    deals.append(DEAL_HEADER)
    deals.append([
        "101", "ABC Logistics", "D-1", "ABC Logistics PERTH 3,000m2 Office PD Relocation",
        "Verified Information Deal", 4500000, datetime(2027, 5, 1), "Test Owner",
        datetime(2026, 9, 1), None, "Find Decision Maker", "Open",
    ])  # fmt: skip
    deals.append(
        [None, None, None, None, "Total", "=SUM(F2:F2)", None, None, None, None, None, None]
    )

    contacts = workbook.create_sheet("Contacts")
    contacts.append(["Contact ID", "First Name", "Email"])
    contacts.append(["1", "Test", "test.person@example.com"])

    workbook.save(path)
    return path


def test_reads_companies_offices_and_deals(tmp_path: Path) -> None:
    export = read_export(make_export(tmp_path / "export.xlsx"))

    assert [company.name for company in export.companies] == ["ABC Logistics", "XYZ Engineering"]
    abc = export.companies[0]
    assert abc.hubspot_id == "101"
    assert (abc.state, abc.state_raw) == ("WA", "Western Australia")
    assert abc.domain == "abclogistics.com.au"
    assert abc.postal_code == "6000"
    assert abc.employees == 300
    assert abc.linkedin_url == LINKEDIN
    assert abc.created_in_hubspot == date(2026, 10, 1)
    assert export.companies[1].state == "SA"  # "5000" was typed in the State field

    assert len(export.offices) == 1
    assert export.offices[0].lease_expiry == date(2028, 6, 30)
    assert len(export.deals) == 1
    assert export.deals[0].amount_aud == Decimal("4500000")

    assert export.skipped_rows == 2  # the office for a company not in the file, and "Total"
    assert export.skipped_sheets == ["Contacts"]


def test_contacts_are_never_read(tmp_path: Path) -> None:
    export = read_export(make_export(tmp_path / "export.xlsx"))
    assert "test.person@example.com" not in export.model_dump_json()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("VIC", "VIC"),
        ("victoria", "VIC"),
        ("South Australia", "SA"),
        ("5000", "SA"),
        ("2600", "ACT"),
        ("0870", "NT"),
        ("Ontario", None),
        (None, None),
    ],
)
def test_states_are_cleaned(raw: str | None, expected: str | None) -> None:
    assert normalize_state(raw) == expected


@pytest.mark.parametrize(
    ("website", "expected"),
    [
        ("https://www.abc.com.au/about", "abc.com.au"),
        ("ABC.com.au", "abc.com.au"),
        ("http://sub.abc.com.au", "sub.abc.com.au"),
        ("", None),
        (None, None),
    ],
)
def test_domains_are_cleaned(website: str | None, expected: str | None) -> None:
    assert normalize_domain(website) == expected


def test_rejects_a_file_that_is_not_xlsx() -> None:
    with pytest.raises(ExportError, match=r"isn't an \.xlsx file"):
        read_export(b"this is not a spreadsheet")


def test_rejects_a_workbook_without_companies(tmp_path: Path) -> None:
    path = tmp_path / "other.xlsx"
    Workbook().save(path)
    with pytest.raises(ExportError, match="no 'Companies' sheet"):
        read_export(path)


@pytest.mark.integration
async def test_import_is_safe_to_run_twice(session: AsyncSession, tmp_path: Path) -> None:
    export = read_export(make_export(tmp_path / "export.xlsx"))
    await save_export(session, export)
    second = await save_export(session, export)

    assert (second.companies, second.offices, second.deals) == (2, 1, 1)
    loaded = await summary(session)
    assert (loaded.companies, loaded.offices, loaded.deals) == (2, 1, 1)
    assert loaded.last_imported_at is not None
