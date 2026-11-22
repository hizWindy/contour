"""The record of each edit in Admin's Data tab, and its Undo (PLAN-V26 T4-2, choice 20).

An edit saves the table, the row, the old and the new value, who and when, in the same transaction
as the change. Undo puts the old value back and is recorded too. It is refused when the row
changed since the edit, so it can never write over somebody's newer work.

Postgres turns a row to JSON and back (`to_jsonb`, `jsonb_populate_record`), so every type comes
back exactly as it was. Table and column names come from the `Editable` in code and are checked
against the models, never from a request. The caller commits.
"""

import hashlib
import json
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Table, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.data.models import AdminEdit
from core.db.base import Base

type Row = dict[str, Any]


@dataclass(frozen=True)
class Editable:
    """What may be edited in one table. Nothing else in it can change here."""

    table: str  # schema.table, with one key column
    fields: tuple[str, ...]
    deletable: bool = False
    # Why this row can't be edited now, in plain words, or None when it can.
    blocked: Callable[[Row], str | None] = lambda row: None


class EditRefused(Exception):
    """The edit can't be made. `reason` is safe to show to a person."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


NOT_THERE = "That row isn't there any more."
CHANGED_SINCE = "The row changed since that edit, so it can't be undone."
UNDONE = "That edit was undone already."


def _parts(name: str) -> tuple[Table, str, str]:
    """The table, its quoted name, and its one key's name."""
    table = Base.metadata.tables[name]
    (key,) = table.primary_key.columns
    return table, f'"{table.schema}"."{table.name}"', key.name


def fingerprint(row: Row) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()


async def _read(db: AsyncSession, name: str, row_id: str) -> Row | None:
    """The row as JSON, locked until the transaction ends."""
    _, quoted, key = _parts(name)
    row: Row | None = await db.scalar(
        text(f'SELECT to_jsonb(t) FROM {quoted} t WHERE CAST(t."{key}" AS text) = :id FOR UPDATE'),
        {"id": row_id},
    )
    return row


async def _write(db: AsyncSession, name: str, row_id: str, values: Mapping[str, Any]) -> Row:
    table, quoted, key = _parts(name)
    sets = []
    for field in values:
        column = table.c[field].name  # a KeyError for a name that isn't one of the table's
        sets.append(f'"{column}" = new."{column}"')
    await db.execute(
        text(
            f"UPDATE {quoted} AS t SET {', '.join(sets)} "
            f"FROM jsonb_populate_record(NULL::{quoted}, CAST(:values AS jsonb)) AS new "
            f'WHERE CAST(t."{key}" AS text) = :id'
        ),
        {"values": json.dumps(dict(values)), "id": row_id},
    )
    row = await _read(db, name, row_id)
    if row is None:
        raise EditRefused(NOT_THERE)
    return row


async def change(
    db: AsyncSession,
    editable: Editable,
    row_id: str,
    values: Mapping[str, Any],
    *,
    admin_id: uuid.UUID | None,
    now: datetime,
) -> AdminEdit | None:
    """Changes the listed fields of one row and records it. None when nothing is different."""
    if not set(values) <= set(editable.fields):
        raise EditRefused("That field can't be changed here.")
    row = await _read(db, editable.table, row_id)
    if row is None:
        raise EditRefused(NOT_THERE)
    if reason := editable.blocked(row):
        raise EditRefused(reason)
    new = {field: value for field, value in values.items() if row[field] != value}
    if not new:
        return None
    saved = await _write(db, editable.table, row_id, new)
    edit = AdminEdit(
        created_at=now,
        admin_id=admin_id,
        table_name=editable.table,
        row_id=row_id,
        action="change",
        before={field: row[field] for field in new},
        after={field: saved[field] for field in new},
        row_after=fingerprint(saved),
    )
    db.add(edit)
    await db.flush()
    return edit


async def delete(
    db: AsyncSession, editable: Editable, row_id: str, *, admin_id: uuid.UUID | None, now: datetime
) -> AdminEdit:
    """Deletes one row and records all of it, so Undo can put it back."""
    if not editable.deletable:
        raise EditRefused("This can't be deleted here.")
    row = await _read(db, editable.table, row_id)
    if row is None:
        raise EditRefused(NOT_THERE)
    if reason := editable.blocked(row):
        raise EditRefused(reason)
    _, quoted, key = _parts(editable.table)
    await db.execute(
        text(f'DELETE FROM {quoted} WHERE CAST("{key}" AS text) = :id'), {"id": row_id}
    )
    edit = AdminEdit(
        created_at=now,
        admin_id=admin_id,
        table_name=editable.table,
        row_id=row_id,
        action="delete",
        before=row,
    )
    db.add(edit)
    await db.flush()
    return edit


async def undo(
    db: AsyncSession, edit_id: uuid.UUID, *, admin_id: uuid.UUID | None, now: datetime
) -> AdminEdit:
    """Puts an edit's old value back, and records that too."""
    edit = await db.get(AdminEdit, edit_id, with_for_update=True)
    if edit is None:
        raise EditRefused("That edit isn't there.")
    if edit.action == "undo" or edit.before is None:
        raise EditRefused("An undo can't be undone.")
    if await db.scalar(select(AdminEdit.id).where(AdminEdit.undoes == edit.id)):
        raise EditRefused(UNDONE)

    row = await _read(db, edit.table_name, edit.row_id)
    if edit.action == "delete":
        if row is not None:
            raise EditRefused(CHANGED_SINCE)
        _, quoted, _key = _parts(edit.table_name)
        await db.execute(
            text(
                f"INSERT INTO {quoted} "
                f"SELECT * FROM jsonb_populate_record(NULL::{quoted}, CAST(:row AS jsonb))"
            ),
            {"row": json.dumps(edit.before)},
        )
        was, saved = None, edit.before
    else:
        if row is None or fingerprint(row) != edit.row_after:
            raise EditRefused(CHANGED_SINCE)
        await _write(db, edit.table_name, edit.row_id, edit.before)
        was, saved = edit.after, edit.before
    undone = AdminEdit(
        created_at=now,
        admin_id=admin_id,
        table_name=edit.table_name,
        row_id=edit.row_id,
        action="undo",
        before=was,
        after=saved,
        undoes=edit.id,
    )
    db.add(undone)
    await db.flush()
    return undone
