"""Reads a HubSpot export file (.xlsx). No database here, so it's easy to test.

- Reads the Companies, Office Locations and Deals sheets, by column name.
- Never reads a Contacts sheet (personal data). It's listed as skipped.
- Cleans values into HubSpot's own formats: state as VIC, SA, WA, and so on; website as a
  plain domain.
- Counts deals from the Deals sheet, because the export's "# Deals" column is a formula.
"""

import zipfile
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from openpyxl import load_workbook
from openpyxl.cell.cell import Cell, MergedCell
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import BaseModel

COMPANY_SHEET = "Companies"
OFFICE_SHEET = "Office Locations"
DEAL_SHEET = "Deals"


class ExportError(ValueError):
    """The file isn't a HubSpot export we can read."""


class CompanyRow(BaseModel):
    hubspot_id: str
    name: str
    website: str | None = None
    domain: str | None = None
    phone: str | None = None
    street: str | None = None
    city: str | None = None
    state: str | None = None
    state_raw: str | None = None
    postal_code: str | None = None
    country: str | None = None
    industry: str | None = None
    employees: int | None = None
    linkedin_staff_au: int | None = None
    offices_on_record: str | None = None
    lifecycle_stage: str | None = None
    owner: str | None = None
    created_in_hubspot: date | None = None
    last_contacted: date | None = None
    contacts_count: int | None = None
    description: str | None = None
    linkedin_url: str | None = None
    hubspot_url: str | None = None


class OfficeRow(BaseModel):
    hubspot_company_id: str
    label: str
    level: str | None = None
    street: str | None = None
    city: str | None = None
    postal_code: str | None = None
    phone: str | None = None
    last_moved: date | None = None
    lease_expiry: date | None = None
    linkedin_staff: int | None = None


class DealRow(BaseModel):
    hubspot_deal_id: str
    hubspot_company_id: str
    name: str
    stage: str | None = None
    amount_aud: Decimal | None = None
    close_date: date | None = None
    owner: str | None = None
    created_in_hubspot: date | None = None
    last_contacted: date | None = None
    next_step: str | None = None
    hubspot_url: str | None = None


class HubSpotExport(BaseModel):
    companies: list[CompanyRow]
    offices: list[OfficeRow]
    deals: list[DealRow]
    skipped_sheets: list[str]
    skipped_rows: int


# --- Cleaning values ------------------------------------------------------------------


def _whole(value: Any) -> Any:
    """Excel stores 3000 as 3000.0. Turn whole floats back into ints."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(_whole(value)).strip()
    return text or None


def clean_int(value: Any) -> int | None:
    text = clean_text(value)
    if text is None:
        return None
    try:
        return int(float(text.replace(",", "")))
    except ValueError:
        return None


def clean_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = clean_text(value)
    if text is None:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def clean_decimal(value: Any) -> Decimal | None:
    text = clean_text(value)
    if text is None:
        return None
    try:
        return Decimal(text.replace(",", "").replace("$", ""))
    except InvalidOperation:
        return None


STATE_NAMES = {
    "new south wales": "NSW",
    "victoria": "VIC",
    "queensland": "QLD",
    "south australia": "SA",
    "western australia": "WA",
    "tasmania": "TAS",
    "northern territory": "NT",
    "australian capital territory": "ACT",
}
STATE_CODES = set(STATE_NAMES.values())

# Australian postcode ranges, for when a postcode was typed into the State field.
POSTCODE_RANGES = [
    (200, 299, "ACT"),
    (800, 999, "NT"),
    (1000, 2599, "NSW"),
    (2600, 2618, "ACT"),
    (2619, 2899, "NSW"),
    (2900, 2920, "ACT"),
    (2921, 2999, "NSW"),
    (3000, 3999, "VIC"),
    (4000, 4999, "QLD"),
    (5000, 5999, "SA"),
    (6000, 6999, "WA"),
    (7000, 7999, "TAS"),
    (8000, 8999, "VIC"),
    (9000, 9999, "QLD"),
]


def state_from_postcode(postcode: int) -> str | None:
    for low, high, state in POSTCODE_RANGES:
        if low <= postcode <= high:
            return state
    return None


def normalize_state(raw: str | None) -> str | None:
    """'South Australia' and '5000' both become 'SA'. Unknown values become None."""
    if raw is None:
        return None
    value = raw.strip()
    if value.upper() in STATE_CODES:
        return value.upper()
    named = STATE_NAMES.get(value.lower())
    if named:
        return named
    if value.isdigit() and len(value) == 4:
        return state_from_postcode(int(value))
    return None


def normalize_domain(website: str | None) -> str | None:
    """'https://www.abc.com.au/about' becomes 'abc.com.au'."""
    if not website:
        return None
    value = website.strip().lower()
    if "://" not in value:
        value = "http://" + value
    host = urlsplit(value).hostname
    if not host:
        return None
    return host.removeprefix("www.")


# --- Reading sheets -------------------------------------------------------------------

Cleaner = Callable[[Any], Any]


def _link(cell: Cell | MergedCell) -> str | None:
    """Columns like "LinkedIn" show the word "Open" and keep the address in a hyperlink."""
    hyperlink = getattr(cell, "hyperlink", None)  # merged cells have no hyperlink
    if hyperlink is not None and hyperlink.target:
        return str(hyperlink.target)
    return clean_text(cell.value)


COMPANY_COLUMNS: dict[str, tuple[str, Cleaner | None]] = {
    "Company ID": ("hubspot_id", clean_text),
    "Company Name": ("name", clean_text),
    "Website": ("website", clean_text),
    "Phone": ("phone", clean_text),
    "Street Address": ("street", clean_text),
    "City": ("city", clean_text),
    "State": ("state_raw", clean_text),
    "Postal Code": ("postal_code", clean_text),
    "Country": ("country", clean_text),
    "Industry": ("industry", clean_text),
    "Employees": ("employees", clean_int),
    "Total Staff on LinkedIn (AU)": ("linkedin_staff_au", clean_int),
    "Offices on Record": ("offices_on_record", clean_text),
    "Lifecycle Stage": ("lifecycle_stage", clean_text),
    "Owner": ("owner", clean_text),
    "Created Date": ("created_in_hubspot", clean_date),
    "Last Contacted": ("last_contacted", clean_date),
    "# Contacts": ("contacts_count", clean_int),
    "Description": ("description", clean_text),
    "LinkedIn": ("linkedin_url", None),  # None means: read the hyperlink
    "HubSpot Record": ("hubspot_url", None),
}

OFFICE_COLUMNS: dict[str, tuple[str, Cleaner | None]] = {
    "Company ID": ("hubspot_company_id", clean_text),
    "Office": ("label", clean_text),
    "Level": ("level", clean_text),
    "Street Address": ("street", clean_text),
    "City": ("city", clean_text),
    "Post Code": ("postal_code", clean_text),
    "Phone Number": ("phone", clean_text),
    "Last Moved": ("last_moved", clean_date),
    "Lease Expiry": ("lease_expiry", clean_date),
    "Staff on LinkedIn": ("linkedin_staff", clean_int),
}

DEAL_COLUMNS: dict[str, tuple[str, Cleaner | None]] = {
    "Company ID": ("hubspot_company_id", clean_text),
    "Deal ID": ("hubspot_deal_id", clean_text),
    "Deal Name": ("name", clean_text),
    "Deal Stage": ("stage", clean_text),
    "Amount (AUD)": ("amount_aud", clean_decimal),
    "Close Date": ("close_date", clean_date),
    "Deal Owner": ("owner", clean_text),
    "Created Date": ("created_in_hubspot", clean_date),
    "Last Contacted": ("last_contacted", clean_date),
    "Next Step": ("next_step", clean_text),
    "HubSpot Record": ("hubspot_url", None),
}


def _read_sheet(
    sheet: Worksheet,
    columns: dict[str, tuple[str, Cleaner | None]],
    required: set[str],
) -> list[dict[str, Any]]:
    rows = sheet.iter_rows()
    try:
        header = [clean_text(cell.value) for cell in next(rows)]
    except StopIteration:
        return []
    missing = required - set(filter(None, header))
    if missing:
        raise ExportError(f"Sheet '{sheet.title}' is missing columns: {', '.join(sorted(missing))}")
    positions = {name: i for i, name in enumerate(header) if name in columns}
    records = []
    for cells in rows:
        record: dict[str, Any] = {}
        for name, i in positions.items():
            field, cleaner = columns[name]
            if i >= len(cells):
                continue
            cell = cells[i]
            record[field] = _link(cell) if cleaner is None else cleaner(cell.value)
        if any(value is not None for value in record.values()):
            records.append(record)
    return records


def read_export(source: Path | bytes) -> HubSpotExport:
    """Reads the export. Raises ExportError if the file isn't one we can read."""
    try:
        workbook = load_workbook(
            filename=BytesIO(source) if isinstance(source, bytes) else source, data_only=True
        )
    except (zipfile.BadZipFile, InvalidFileException, KeyError, OSError) as error:
        raise ExportError("This isn't an .xlsx file we can read.") from error

    if COMPANY_SHEET not in workbook.sheetnames:
        raise ExportError(f"There's no '{COMPANY_SHEET}' sheet in this file.")
    skipped_sheets = [
        name
        for name in workbook.sheetnames
        if name not in {COMPANY_SHEET, OFFICE_SHEET, DEAL_SHEET}
    ]
    skipped_rows = 0

    companies: dict[str, CompanyRow] = {}
    for record in _read_sheet(
        workbook[COMPANY_SHEET], COMPANY_COLUMNS, {"Company ID", "Company Name"}
    ):
        if not record.get("hubspot_id") or not record.get("name"):
            skipped_rows += 1
            continue
        record["state"] = normalize_state(record.get("state_raw"))
        record["domain"] = normalize_domain(record.get("website"))
        companies[record["hubspot_id"]] = CompanyRow(**record)

    offices: list[OfficeRow] = []
    if OFFICE_SHEET in workbook.sheetnames:
        for record in _read_sheet(workbook[OFFICE_SHEET], OFFICE_COLUMNS, {"Company ID", "Office"}):
            if record.get("hubspot_company_id") not in companies or not record.get("label"):
                skipped_rows += 1
                continue
            offices.append(OfficeRow(**record))

    deals: dict[str, DealRow] = {}
    if DEAL_SHEET in workbook.sheetnames:
        for record in _read_sheet(
            workbook[DEAL_SHEET], DEAL_COLUMNS, {"Company ID", "Deal ID", "Deal Name"}
        ):
            # Skips the export's "Total" row, and deals for companies not in the file.
            if (
                not record.get("hubspot_deal_id")
                or not record.get("name")
                or record.get("hubspot_company_id") not in companies
            ):
                skipped_rows += 1
                continue
            deals[record["hubspot_deal_id"]] = DealRow(**record)

    return HubSpotExport(
        companies=list(companies.values()),
        offices=offices,
        deals=list(deals.values()),
        skipped_sheets=skipped_sheets,
        skipped_rows=skipped_rows,
    )
