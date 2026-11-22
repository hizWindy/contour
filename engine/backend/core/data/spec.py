"""What a table in Admin's Data tab is (PLAN-V26 Part 4, choices 16, 17 and 19).

The tab shows only the tables and the columns that are listed: the core's in
`core.data.core_tables`, each project's in its `AppSpec.data_tables`. A new column is never shown
until somebody lists it, so a hash or a key can't reach the screen by being added to a table.
"""

from dataclasses import dataclass
from typing import Literal

type Mask = Literal["phone", "email"]

HUBSPOT_NOTE = "Change it in HubSpot, then press Sync."


@dataclass(frozen=True)
class DataColumn:
    key: str  # the column's name in the database
    label: str
    mask: Mask | None = None  # always hidden like this, whatever it holds


@dataclass(frozen=True)
class DataTable:
    table: str  # schema.table
    label: str  # plain words, like "Call notes"
    group: str  # what it is listed under, like "Lead Finder"
    columns: tuple[DataColumn, ...]
    # Search looks in these only: names, never a contact detail, so it can't be used to guess one.
    search: tuple[str, ...]
    newest: str  # the column the list starts sorted by, newest first
    note: str | None = None  # like "Change it in HubSpot, then press Sync."
    screen: str | None = None  # the address of the table's own screen, if it has one
    screen_label: str | None = None
