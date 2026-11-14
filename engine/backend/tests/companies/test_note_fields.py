"""What a call may change (PLAN-V17 T2-3): each office's lease end, last move and staff count.

The list names our office columns, and HubSpot's field for each office group comes from the field
map, so Perth is HubSpot's "other office 1" group. A field off the list is refused, and a list that
names a field the map doesn't have stops the backend from starting. No database, no network.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest

from apps.companies import app as companies_app
from apps.companies import note_fields
from apps.companies.note_fields import (
    NOTE_FIELDS_FILE,
    NotOnTheList,
    hubspot_property,
    office_labels,
    read_note_fields,
)
from core.api.app import create_app
from core.hubspot.mapping import FieldMap, load_field_map

THREE = ("lease_end", "last_move", "staff")


@pytest.fixture
def fresh_list() -> Iterator[None]:
    """The list is read once and kept. These tests read it again, and leave none of theirs."""
    note_fields._note_fields.cache_clear()
    yield
    note_fields._note_fields.cache_clear()


def a_copy_with(tmp_path: Path, line: str, instead: str) -> Path:
    """The real list, with one line changed."""
    text = NOTE_FIELDS_FILE.read_text(encoding="utf-8")
    assert line in text
    copy = tmp_path / "note_fields.yaml"
    copy.write_text(text.replace(line, instead, 1), encoding="utf-8")
    return copy


def test_a_call_may_change_each_offices_lease_end_last_move_and_staff() -> None:
    assert [(field.id, field.label, field.kind) for field in note_fields.note_fields()] == [
        ("lease_end", "Lease end", "date"),
        ("last_move", "Last move", "date"),
        ("staff", "Staff", "number"),
    ]
    assert office_labels() == [
        "Melbourne",
        "Adelaide",
        "Brisbane",
        "Sydney",
        "Perth",
        "Other Office 2",
    ]


@pytest.mark.parametrize(
    ("field_id", "hubspot_field"),
    [
        ("lease_end", "lease_expiry_other_office_1_"),
        ("last_move", "last_moved_other_office_1_"),
        ("staff", "number_of_staff_other_office_1_"),
    ],
)
def test_perth_is_hubspots_other_office_1_group(field_id: str, hubspot_field: str) -> None:
    assert hubspot_property(field_id, "Perth") == hubspot_field


@pytest.mark.parametrize(
    ("field_id", "hubspot_field"),
    [
        ("lease_end", "lease_expiry_melbourne_"),
        ("last_move", "last_moved_melbourne_"),
        ("staff", "number_of_staff_melbourne_office_"),
    ],
)
def test_melbourne_maps_to_the_melbourne_fields(field_id: str, hubspot_field: str) -> None:
    assert hubspot_property(field_id, "Melbourne") == hubspot_field


def test_an_office_group_may_differ_in_case_or_spaces() -> None:
    assert hubspot_property("lease_end", "  perth ") == "lease_expiry_other_office_1_"


def test_every_hubspot_field_comes_from_the_field_map_and_is_typed_once() -> None:
    field_map = load_field_map()
    for office in field_map.offices:
        for field in note_fields.note_fields():
            assert hubspot_property(field.id, office.label) == office.fields[field.office_field]
    listed = NOTE_FIELDS_FILE.read_text(encoding="utf-8")
    typed_here = [
        name for office in field_map.offices for name in office.fields.values() if name in listed
    ]
    assert typed_here == []


@pytest.mark.parametrize("field_id", ["description", "name", "phone", "lease_expiry", ""])
def test_a_field_off_the_list_is_refused(field_id: str) -> None:
    with pytest.raises(NotOnTheList, match="only these office fields: lease end, last move, staff"):
        hubspot_property(field_id, "Perth")
    with pytest.raises(NotOnTheList):
        note_fields.note_field(field_id)


def test_an_office_group_the_map_doesnt_have_is_refused() -> None:
    with pytest.raises(NotOnTheList, match="no office group called Hobart"):
        hubspot_property("lease_end", "Hobart")


@pytest.mark.usefixtures("fresh_list")
def test_a_group_without_the_field_is_refused_and_left_off_the_offices(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hobart_without_staff = FieldMap.model_validate(
        {
            "companies": {"name": "name"},
            "deals": {"name": "dealname", "stage_id": "dealstage", "pipeline_id": "pipeline"},
            "offices": [
                {
                    "label": "Melbourne",
                    "fields": {
                        "lease_expiry": "lease_expiry_melbourne_",
                        "last_moved": "last_moved_melbourne_",
                        "staff_count_text": "number_of_staff_melbourne_office_",
                    },
                },
                {
                    "label": "Hobart",
                    "fields": {
                        "lease_expiry": "lease_expiry_hobart_",
                        "last_moved": "last_moved_hobart_",
                    },
                },
            ],
        }
    )
    monkeypatch.setattr(note_fields, "load_field_map", lambda: hobart_without_staff)
    assert office_labels() == ["Melbourne"]
    assert hubspot_property("lease_end", "Hobart") == "lease_expiry_hobart_"
    with pytest.raises(NotOnTheList, match="no staff field for the Hobart office"):
        hubspot_property("staff", "Hobart")


@pytest.mark.usefixtures("fresh_list")
def test_a_made_up_office_field_stops_the_backend_from_starting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    broken = a_copy_with(tmp_path, "office_field: lease_expiry", "office_field: lease_expiration")
    monkeypatch.setattr(note_fields, "NOTE_FIELDS_FILE", broken)
    named = "'lease_end' names the office field 'lease_expiration'"
    with pytest.raises(ValueError, match=named):
        companies_app.check_rules()
    with pytest.raises(ValueError, match=named):
        create_app()  # the core runs each project's check before it builds the app


@pytest.mark.parametrize(
    ("line", "instead", "problem"),
    [
        ("id: last_move", "id: lease_end", "same id: lease_end"),
        ("office_field: last_moved", "office_field: lease_expiry", "same office field"),
        ("kind: number", "kind: money", "kind"),
        ("label: Staff", "label: Lease end", "same label"),
    ],
)
def test_a_wrong_list_is_refused(tmp_path: Path, line: str, instead: str, problem: str) -> None:
    with pytest.raises(ValueError, match=problem):
        read_note_fields(a_copy_with(tmp_path, line, instead), load_field_map())


def test_the_list_in_use_passes_the_start_up_check() -> None:
    companies_app.check_rules()
    assert [field.id for field in read_note_fields(NOTE_FIELDS_FILE, load_field_map())] == list(
        THREE
    )
