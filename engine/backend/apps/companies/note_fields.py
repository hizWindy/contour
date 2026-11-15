"""What a call may change in HubSpot (PLAN-V17 T2-3, choice 3).

The list is `note_fields.yaml`: each office's lease end, last move and staff count (TBC with
Levi). Each field there names our office column, and HubSpot's field for each office group comes
from the field map (`core/hubspot/fields.yaml`), so no HubSpot field name is typed twice. Perth is
HubSpot's "other office 1" group: ("lease_end", "Perth") is `lease_expiry_other_office_1_`.

The backend checks the list when it starts (`check_note_fields`, through the project's
`check_rules`), and won't start if a field isn't an office field in the map. A field or an office
group that isn't on the list raises `NotOnTheList`: what the rep said about it stays in the call's
text.
"""

from functools import lru_cache
from pathlib import Path
from typing import Final, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.hubspot.mapping import FieldMap, OfficeColumn, OfficeMap, load_field_map

NOTE_FIELDS_FILE: Final = Path(__file__).with_name("note_fields.yaml")
NoteKind = Literal["date", "number"]


class NotOnTheList(ValueError):
    """A field, or an office group, that a call may not change. The words are plain."""


class _Listed(BaseModel):
    """One field as note_fields.yaml writes it, before it is checked against the field map."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    label: str = Field(min_length=1, max_length=40)
    kind: NoteKind
    office_field: str = Field(min_length=1, max_length=64)


class _NoteFieldsFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    fields: list[_Listed] = Field(min_length=1)

    @field_validator("fields")
    @classmethod
    def _each_once(cls, value: list[_Listed]) -> list[_Listed]:
        for part, seen in (
            ("id", [field.id for field in value]),
            ("label", [field.label.casefold() for field in value]),
            ("office field", [field.office_field for field in value]),
        ):
            repeated = sorted({item for item in seen if seen.count(item) > 1})
            if repeated:
                raise ValueError(f"Two call note fields have the same {part}: {repeated[0]}")
        return value


class NoteField(BaseModel):
    """One field a call may change: its id, the label on screen, its kind, and our office column
    in the field map (like `lease_expiry`)."""

    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    kind: NoteKind
    office_field: OfficeColumn


def read_note_fields(path: Path, field_map: FieldMap) -> tuple[NoteField, ...]:
    """Reads a list of call note fields, and checks each one is an office field in the map.

    Raises ValueError, naming the field, when one isn't.
    """
    listed = _NoteFieldsFile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
    mapped = {column for office in field_map.offices for column in office.fields}
    for field in listed.fields:
        if field.office_field not in mapped:
            raise ValueError(
                f"The call note field {field.id!r} names the office field "
                f"{field.office_field!r}, which no office in the HubSpot field map has."
            )
    return tuple(NoteField.model_validate(field.model_dump()) for field in listed.fields)


@lru_cache
def _note_fields() -> tuple[NoteField, ...]:
    """The list in use, read once. Restart the backend after editing it."""
    return read_note_fields(NOTE_FIELDS_FILE, load_field_map())


def check_note_fields() -> None:
    """The start-up check: raises if the list names a field the field map doesn't have."""
    _note_fields()


def note_fields() -> list[NoteField]:
    """The fields a call may change, in the list's order."""
    return list(_note_fields())


def note_field(field_id: str) -> NoteField:
    """One field from the list. A field off the list raises NotOnTheList."""
    for field in _note_fields():
        if field.id == field_id:
            return field
    labels = ", ".join(field.label.lower() for field in _note_fields())
    raise NotOnTheList(f"A call can change only these office fields: {labels}.")


def office_labels() -> list[str]:
    """Every office group in the field map that has all the listed fields, like Melbourne or
    Perth, in the map's order."""
    wanted = {field.office_field for field in _note_fields()}
    return [office.label for office in load_field_map().offices if wanted <= office.fields.keys()]


def hubspot_property(field_id: str, office_label: str) -> str:
    """HubSpot's field for one listed field in one office group, like
    `lease_expiry_other_office_1_` for ("lease_end", "Perth").

    A field off the list, an office group the map doesn't have, or a group without that field
    raises NotOnTheList. The group's name may differ in case or spaces ("perth").
    """
    field = note_field(field_id)
    office = _office_group(office_label)
    name = office.fields.get(field.office_field)
    if name is None:
        raise NotOnTheList(
            f"HubSpot has no {field.label.lower()} field for the {office.label} office."
        )
    return name


def _office_group(label: str) -> OfficeMap:
    wanted = label.strip().casefold()
    for office in load_field_map().offices:
        if office.label.casefold() == wanted:
            return office
    raise NotOnTheList(f"HubSpot has no office group called {label.strip() or 'that'}.")
