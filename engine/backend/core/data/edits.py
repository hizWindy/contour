"""Editing in Admin's Data tab: what may change, the record of each edit, and Undo (PLAN-V26
T4-2 and T4-3, choices 18 and 20).

An edit saves the table, the row, the old and the new value, who and when, in the same transaction
as the change. Undo puts the old value back and is recorded too. It is refused when the row
changed since the edit, so it can never write over somebody's newer work.

A project says which fields of which table may change (`Editable`) and keeps its own rules in
three hooks: when a row is blocked, how a field reads, and which columns a change writes.

A hidden email or phone number stays hidden on the edit screen. A value sent back with the dots
still in it is refused, so the dots are never saved over the real detail.

Postgres turns a row to JSON and back (`to_jsonb`, `jsonb_populate_record`), so every type comes
back as it was. Table and column names come from the `Editable` in code and are checked against
the models, never from a request. The caller commits.
"""

import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from sqlalchemy import Table, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.apps import AppSpec
from core.data.masking import DOTS, hide_contacts
from core.data.models import AdminEdit
from core.db.base import Base
from core.logs import REDACTED

type Row = dict[str, Any]
type Values = Mapping[str, str | None]
type FieldKind = Literal["text", "long", "choice", "company"]

NOT_THERE: Final = "That row isn't there any more."
CHANGED_SINCE: Final = "The row changed since that edit, so it can't be undone."
UNDONE: Final = "That edit was undone already."
NOT_HERE: Final = "That field can't be changed here."
STILL_HIDDEN: Final = (
    f"It still has {DOTS} in it. Type the whole value, or take the hidden part out."
)
# When it was last changed isn't a change of its own, and an Undo moves it.
CLOCK: Final = "updated_at"


class EditRefused(Exception):
    """The edit can't be made. `reason` is safe to show to a person."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class ValueRefused(EditRefused):
    """One field's value is wrong. `field` is its key."""

    def __init__(self, field: str, reason: str) -> None:
        super().__init__(reason)
        self.field = field


@dataclass(frozen=True)
class Choice:
    value: str
    label: str


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: FieldKind = "text"
    column: str | None = None  # the column it lives in, when that isn't `key`
    max_chars: int = 300
    required: bool = False
    choices: tuple[Choice, ...] = ()  # a choice field's, when they don't depend on the row

    @property
    def stored_in(self) -> str:
        return self.column or self.key


def _read_plain(row: Row, field: Field) -> str | None:
    value = row.get(field.stored_in)
    return None if value is None else str(value)


async def _columns_plain(
    db: AsyncSession, row: Row, values: Values, now: datetime
) -> dict[str, Any]:
    return dict(values)


async def _no_choices(db: AsyncSession, row: Row, field: Field) -> tuple[Choice, ...]:
    return field.choices


@dataclass(frozen=True)
class Editable:
    """What may be edited in one table. Nothing else in it can change here."""

    table: str  # schema.table, with one key column
    fields: tuple[Field, ...]
    deletable: bool = False
    # Why this row can't be edited or deleted now, in plain words, or None when it can.
    blocked: Callable[[Row], str | None] = lambda row: None
    # A field as a person reads it, like the outcome inside a call's card.
    read: Callable[[Row, Field], str | None] = _read_plain
    # The columns to write for the values sent. It may refuse one (`ValueRefused`).
    columns: Callable[[AsyncSession, Row, Values, datetime], Awaitable[dict[str, Any]]] = (
        _columns_plain
    )
    choices: Callable[[AsyncSession, Row, Field], Awaitable[tuple[Choice, ...]]] = _no_choices
    # A field in the list of edits, when it doesn't read as `read` does, like a person's name.
    show: Callable[[Row, Field], str | None] | None = None


def editables(specs: Sequence[AppSpec]) -> dict[str, Editable]:
    """Every table that can be edited: the projects' and the core's."""
    from core.data.editables import CORE_EDITABLES  # that file imports this one

    found = [*(item for spec in specs for item in spec.editables), *CORE_EDITABLES]
    return {item.table: item for item in found}


# --- The row -------------------------------------------------------------------------------------


def _parts(name: str) -> tuple[Table, str, str]:
    """The table, its quoted name, and its one key's name."""
    table = Base.metadata.tables[name]
    (key,) = table.primary_key.columns
    return table, f'"{table.schema}"."{table.name}"', key.name


def fingerprint(row: Row) -> str:
    facts = {key: value for key, value in row.items() if key != CLOCK}
    return hashlib.sha256(json.dumps(facts, sort_keys=True, default=str).encode()).hexdigest()


async def read_row(db: AsyncSession, name: str, row_id: str, *, lock: bool = False) -> Row | None:
    """The row as JSON. With `lock`, locked until the transaction ends."""
    _, quoted, key = _parts(name)
    statement = f'SELECT to_jsonb(t) FROM {quoted} t WHERE CAST(t."{key}" AS text) = :id'
    row: Row | None = await db.scalar(
        text(statement + (" FOR UPDATE" if lock else "")), {"id": row_id}
    )
    return row


async def _write(
    db: AsyncSession, name: str, row_id: str, values: Mapping[str, Any], now: datetime
) -> Row:
    table, quoted, key = _parts(name)
    sets, sent = [], dict(values)
    if CLOCK in table.c and CLOCK not in sent:
        sent[CLOCK] = now.isoformat()
    for field in sent:
        column = table.c[field].name  # a KeyError for a name that isn't one of the table's
        sets.append(f'"{column}" = new."{column}"')
    await db.execute(
        text(
            f"UPDATE {quoted} AS t SET {', '.join(sets)} "
            f"FROM jsonb_populate_record(NULL::{quoted}, CAST(:values AS jsonb)) AS new "
            f'WHERE CAST(t."{key}" AS text) = :id'
        ),
        {"values": json.dumps(sent, default=str), "id": row_id},
    )
    db.expire_all()  # the write went round the ORM, so what it holds may be old
    row = await read_row(db, name, row_id)
    if row is None:
        raise EditRefused(NOT_THERE)
    return row


# --- Changing ------------------------------------------------------------------------------------


async def _checked(
    db: AsyncSession, editable: Editable, row: Row, values: Values
) -> dict[str, str | None]:
    """The values sent, trimmed and checked against their fields."""
    fields = {field.key: field for field in editable.fields}
    checked: dict[str, str | None] = {}
    for key, value in values.items():
        field = fields.get(key)
        if field is None:
            raise ValueRefused(key, NOT_HERE)
        kept = (value or "").strip() or None
        if kept is not None and (DOTS in kept or REDACTED in kept):
            raise ValueRefused(key, STILL_HIDDEN)
        if kept is None and field.required:
            raise ValueRefused(key, f"{field.label} can't be empty.")
        if kept is not None and len(kept) > field.max_chars:
            raise ValueRefused(key, f"Use {field.max_chars:,} characters or fewer.")
        if kept is not None and field.kind == "choice":
            allowed = {choice.value for choice in await editable.choices(db, row, field)}
            if kept not in allowed:
                raise ValueRefused(key, "Pick one from the list.")
        checked[key] = kept
    return checked


async def change(
    db: AsyncSession,
    editable: Editable,
    row_id: str,
    values: Values,
    *,
    admin_id: uuid.UUID | None,
    now: datetime,
) -> AdminEdit | None:
    """Changes the listed fields of one row and records it. None when nothing is different."""
    row = await read_row(db, editable.table, row_id, lock=True)
    if row is None:
        raise EditRefused(NOT_THERE)
    if reason := editable.blocked(row):
        raise EditRefused(reason)
    wanted = await editable.columns(db, row, await _checked(db, editable, row, values), now)
    new = {column: value for column, value in wanted.items() if row[column] != value}
    if not new:
        return None
    try:
        saved = await _write(db, editable.table, row_id, new, now)
    except IntegrityError as error:
        raise EditRefused("The database can't take that change.") from error
    edit = AdminEdit(
        created_at=now,
        admin_id=admin_id,
        table_name=editable.table,
        row_id=row_id,
        action="change",
        before={column: row[column] for column in new},
        after={column: saved[column] for column in new},
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
    row = await read_row(db, editable.table, row_id, lock=True)
    if row is None:
        raise EditRefused(NOT_THERE)
    if reason := editable.blocked(row):
        raise EditRefused(reason)
    _, quoted, key = _parts(editable.table)
    try:
        await db.execute(
            text(f'DELETE FROM {quoted} WHERE CAST("{key}" AS text) = :id'), {"id": row_id}
        )
    except IntegrityError as error:
        raise EditRefused("Something else still uses that row, so it can't be deleted.") from error
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

    table_name, row_id, before, after = edit.table_name, edit.row_id, edit.before, edit.after
    action, row_after = edit.action, edit.row_after
    row = await read_row(db, table_name, row_id, lock=True)
    try:
        if action == "delete":
            if row is not None:
                raise EditRefused(CHANGED_SINCE)
            _, quoted, _key = _parts(table_name)
            await db.execute(
                text(
                    f"INSERT INTO {quoted} "
                    f"SELECT * FROM jsonb_populate_record(NULL::{quoted}, CAST(:row AS jsonb))"
                ),
                {"row": json.dumps(before)},
            )
            was = None
        else:
            if row is None or fingerprint(row) != row_after:
                raise EditRefused(CHANGED_SINCE)
            await _write(db, table_name, row_id, before, now)
            was = after
    except IntegrityError as error:
        raise EditRefused(
            "It can't be put back: something it belongs to is gone, or took its place."
        ) from error
    undone = AdminEdit(
        created_at=now,
        admin_id=admin_id,
        table_name=table_name,
        row_id=row_id,
        action="undo",
        before=was,
        after=before,
        undoes=edit_id,
    )
    db.add(undone)
    await db.flush()
    return undone


# --- Reading, for the screens --------------------------------------------------------------------


@dataclass(frozen=True)
class FieldValue:
    field: Field
    value: str | None  # with contact details hidden
    hidden: bool  # part of it is hidden
    choices: tuple[Choice, ...]


async def form(db: AsyncSession, editable: Editable, row: Row) -> list[FieldValue]:
    """The edit screen's fields. A choice's own value stays as it is, so it can be picked."""
    shown = []
    for field in editable.fields:
        value = editable.read(row, field)
        choices = await editable.choices(db, row, field) if field.kind == "choice" else ()
        seen = value
        if value is not None and field.kind != "choice":
            seen = hide_contacts(value)
        shown.append(FieldValue(field, seen, seen != value, choices))
    return shown


@dataclass(frozen=True)
class Changed:
    label: str
    before: str | None
    after: str | None


def what_changed(editable: Editable | None, edit: AdminEdit) -> list[Changed]:
    """An edit in the fields a person knows, with contact details hidden."""
    if editable is None or edit.before is None or edit.after is None:
        return []
    found = []
    for field in editable.fields:
        if field.stored_in not in edit.before and field.stored_in not in edit.after:
            continue
        show = editable.show or editable.read
        old, new = show(edit.before, field), show(edit.after, field)
        said = {choice.value: choice.label for choice in field.choices}
        old = said.get(old, old) if old else old
        new = said.get(new, new) if new else new
        if old != new:
            found.append(
                Changed(
                    field.label,
                    hide_contacts(old) if old else None,
                    hide_contacts(new) if new else None,
                )
            )
    return found


async def newest(
    db: AsyncSession, table: str, *, limit: int, offset: int
) -> tuple[list[AdminEdit], int, set[uuid.UUID]]:
    """A table's edits, newest first, the total, and which of these were undone."""
    here = AdminEdit.table_name == table
    total = await db.scalar(select(func.count()).select_from(AdminEdit).where(here))
    rows = list(
        await db.scalars(
            select(AdminEdit)
            .where(here)
            .order_by(AdminEdit.created_at.desc(), AdminEdit.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    undone = await db.scalars(
        select(AdminEdit.undoes).where(AdminEdit.undoes.in_([row.id for row in rows]))
    )
    return rows, int(total or 0), {found for found in undone if found is not None}
