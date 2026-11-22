"""The reads behind Admin's Data tab (PLAN-V26 T4-1): the listed tables, searched, sorted and paged.

Only the listed columns are selected, so a hash or a key never leaves the database. Table and
column names come from the lists in code, never from a request: a request can only pick one.
"""

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal

from sqlalchemy import ColumnElement, String, Table, Text, and_, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.apps import AppSpec
from core.data.core_tables import CORE_TABLES
from core.data.masking import RISKY, cell, is_plain
from core.data.spec import DataColumn, DataTable
from core.db import models as _core_tables  # noqa: F401  (so every core table is in the metadata)
from core.db.base import Base

PAGE: Final = 50
UNSORTABLE = ("JSON", "JSONB", "ARRAY")

type Order = Literal["asc", "desc"]


@dataclass(frozen=True)
class DataRow:
    id: str
    values: dict[str, str | None]


def listed(specs: Sequence[AppSpec]) -> list[DataTable]:
    """Every table the tab shows: the projects' first, then the core's."""
    return [*(table for spec in specs for table in spec.data_tables), *CORE_TABLES]


def find(specs: Sequence[AppSpec], name: str) -> DataTable | None:
    return next((table for table in listed(specs) if table.table == name), None)


def db_table(table: DataTable) -> Table:
    return Base.metadata.tables[table.table]


def sortable(table: DataTable, column: DataColumn) -> bool:
    """A contact detail isn't sortable: the order would give away what is hidden."""
    if column.mask is not None:
        return False
    return type(db_table(table).c[column.key].type).__name__ not in UNSORTABLE


def _could_hide(table: Table, key: str) -> bool:
    return not is_plain(key) and isinstance(table.c[key].type, String)


def guarded(table: Table, key: str) -> ColumnElement[Any]:
    """A column as sort may read it: empty where the value could hold something hidden (`RISKY`),
    so the order can't be used to guess it."""
    column = table.c[key]
    if not _could_hide(table, key):
        return column
    return case((column.regexp_match(RISKY, flags="i"), None), else_=column)


def matches(table: Table, key: str, term: str) -> ColumnElement[bool]:
    """Search in one column. A value that could hold something hidden never matches. The plain
    match comes first, so the slow pattern only reads the values that matched."""
    column = table.c[key]
    found = cast(column, Text).icontains(term, autoescape=True)
    if not _could_hide(table, key):
        return found
    return and_(found, ~column.regexp_match(RISKY, flags="i"))


async def read_rows(
    db: AsyncSession,
    table: DataTable,
    *,
    q: str | None,
    sort: str | None,
    order: Order,
    offset: int,
) -> tuple[list[DataRow], int]:
    """One page, with contact details hidden. `sort` must be one of the table's sortable keys, or
    None for its newest first."""
    db_rows = db_table(table)
    where: list[Any] = []
    if q and q.strip():
        term = q.strip()
        where.append(or_(*(matches(db_rows, key, term) for key in table.search)))
    total = await db.scalar(select(func.count()).select_from(db_rows).where(*where))

    keys = [column.name for column in db_rows.primary_key.columns]
    by = guarded(db_rows, sort or table.newest)
    ordered = by.asc() if sort and order == "asc" else by.desc()
    shown = [
        db_rows.c[column.key].label(f"v_{index}") for index, column in enumerate(table.columns)
    ]
    found = await db.execute(
        select(
            *(db_rows.c[key].label(f"pk_{index}") for index, key in enumerate(keys)),
            *shown,
        )
        .where(*where)
        .order_by(ordered.nulls_last(), *(db_rows.c[key].desc() for key in keys))
        .limit(PAGE)
        .offset(offset)
    )
    read = [dict(row) for row in found.mappings()]
    # Hiding looks through every character, and a JSON value can be long: off the event loop
    # (PLAN-V15 T1-4).
    rows = await asyncio.to_thread(_hidden_rows, table, keys, read)
    return rows, int(total or 0)


def _hidden_rows(
    table: DataTable, keys: list[str], read: Sequence[Mapping[str, Any]]
) -> list[DataRow]:
    return [
        DataRow(
            id=":".join(str(row[f"pk_{index}"]) for index in range(len(keys))),
            values={
                column.key: cell(row[f"v_{index}"], column.mask, plain=is_plain(column.key))
                for index, column in enumerate(table.columns)
            },
        )
        for row in read
    ]
