"""The CSV export, as pure code: the formula guard, the columns, the byte order mark.

Fast tests: no database. The route and the 413 are in test_leads_api.py.
"""

import csv
import io
from datetime import UTC, date, datetime

import pytest

from apps.lead_finder.lead_store import (
    BOM,
    EXPORT_COLUMNS,
    ExportRow,
    csv_safe,
    export_filename,
    render_csv,
)

HOSTILE = [
    "=1+1",
    "+cmd|' /C calc'!A0",
    "@SUM(1)",
    "\t=1+1",
    "\r=1+1",
    "-2+3",
    '=HYPERLINK("http://evil.example","click")',
]


def make_row(**changes: object) -> ExportRow:
    values: dict[str, object] = {
        "company": "Acme Software",
        "source": "web",
        "result": "pass",
        "stage": "Active prospect",
        "score": 78,
        "score_checked": 77,
        "city": "Melbourne",
        "trigger": "Lease ending",
        "trigger_date": date(2028, 3, 1),
        "industry": "Software",
        "office_m2": 2500,
        "office_m2_estimated": False,
        "hubspot_status": "new",
        "status": "new",
        "source_link": "https://www.afr.com/property/acme",
        "created_at": datetime(2026, 10, 26, 1, 30, tzinfo=UTC),
    }
    values.update(changes)
    return ExportRow(**values)  # type: ignore[arg-type]


def parse(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text, newline="")))


@pytest.mark.parametrize("value", HOSTILE)
def test_a_cell_that_could_be_a_formula_gets_a_leading_apostrophe(value: str) -> None:
    assert csv_safe(value) == "'" + value


@pytest.mark.parametrize("value", ["Acme", "", "A=B", "a-b", "x@y.com", " =1", "'=1", "12"])
def test_other_text_is_left_alone(value: str) -> None:
    assert csv_safe(value) == value


def test_the_file_starts_with_a_byte_order_mark_and_the_columns_of_the_design() -> None:
    data = render_csv([make_row()])
    assert data.startswith(BOM)
    assert data[:3] == b"\xef\xbb\xbf"
    header = data.decode("utf-8-sig").split("\r\n")[0]
    assert header == (
        "company,source,result,stage,score,points_checked,city,trigger,trigger_date,industry,"
        "office_m2,office_m2_estimated,hubspot_status,status,source_link,created_at"
    )
    assert header.split(",") == list(EXPORT_COLUMNS)


def test_an_empty_export_is_just_the_header() -> None:
    assert parse(render_csv([])) == []
    assert render_csv([]).decode("utf-8-sig").count("\r\n") == 1


def test_a_row_is_written_in_plain_forms() -> None:
    [row] = parse(render_csv([make_row()]))
    assert row == {
        "company": "Acme Software",
        "source": "web",
        "result": "pass",
        "stage": "Active prospect",
        "score": "78",
        "points_checked": "77",
        "city": "Melbourne",
        "trigger": "Lease ending",
        "trigger_date": "2028-03-01",
        "industry": "Software",
        "office_m2": "2500",
        "office_m2_estimated": "false",
        "hubspot_status": "new",
        "status": "new",
        "source_link": "https://www.afr.com/property/acme",
        "created_at": "2026-10-26T12:30:00+11:00",  # Melbourne time
    }


def test_a_missing_value_is_an_empty_cell() -> None:
    [row] = parse(
        render_csv(
            [
                make_row(
                    city=None,
                    trigger=None,
                    trigger_date=None,
                    industry=None,
                    office_m2=None,
                    source_link=None,
                    office_m2_estimated=True,
                )
            ]
        )
    )
    assert [row[name] for name in ("city", "trigger", "trigger_date", "industry", "office_m2")] == [
        ""
    ] * 5
    assert row["office_m2_estimated"] == "true"


@pytest.mark.parametrize("value", HOSTILE)
def test_every_text_column_is_guarded(value: str) -> None:
    row = make_row(
        company=value,
        source=value,
        result=value,
        stage=value,
        city=value,
        trigger=value,
        industry=value,
        hubspot_status=value,
        status=value,
        source_link=value,
    )
    [parsed] = parse(render_csv([row]))
    for column in (
        "company",
        "source",
        "result",
        "stage",
        "city",
        "trigger",
        "industry",
        "hubspot_status",
        "status",
        "source_link",
    ):
        assert parsed[column] == "'" + value, column


def test_no_cell_of_a_hostile_file_starts_with_a_formula_character() -> None:
    rows = [make_row(company=value, industry=value) for value in HOSTILE]
    for parsed in parse(render_csv(rows)):
        for column, cell in parsed.items():
            assert not cell.startswith(("=", "+", "-", "@", "\t", "\r")), (column, cell)


def test_commas_quotes_and_line_breaks_stay_inside_their_cell() -> None:
    name = 'Smith, "Jones" & Co\nSecond line'
    [parsed] = parse(render_csv([make_row(company=name)]))
    assert parsed["company"] == name


def test_non_english_names_survive_in_utf8() -> None:
    [parsed] = parse(render_csv([make_row(company="Café Zoë 日本")]))
    assert parsed["company"] == "Café Zoë 日本"


def test_the_filename_has_todays_melbourne_date() -> None:
    # 14:30 UTC on 25 Oct is already 26 Oct in Melbourne (UTC+11 in summer time).
    moment = datetime(2026, 10, 25, 14, 30, tzinfo=UTC)
    assert export_filename(moment) == "leads-2026-10-26.csv"
    assert export_filename(datetime(2026, 7, 1, 13, 59, tzinfo=UTC)) == "leads-2026-07-01.csv"
    assert export_filename(datetime(2026, 7, 1, 14, 1, tzinfo=UTC)) == "leads-2026-07-02.csv"
