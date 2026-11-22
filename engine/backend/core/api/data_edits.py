"""The Data tab's edit screens (PLAN-V26 T4-3, choices 18 and 20).

Only the tables and fields the code lists can change. Every edit is recorded with who and when,
and has an Undo. Every route needs `PlatformAdminDep` (403 `platform_admin_only` for anyone else).
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX, OutModel, SafeText
from core.api.signin import NowDep, PlatformAdminDep
from core.auth.models import User
from core.auth.sessions import AuthContext
from core.data import edits
from core.data.edits import Editable, EditRefused, ValueRefused

router = APIRouter(prefix="/data", tags=["data"])

EDITS_PAGE = 20

TableName = Annotated[str, Path(max_length=128, examples=["lead_finder.leads"])]
RowId = Annotated[str, Path(max_length=64)]


class EditChoiceOut(OutModel):
    value: str
    label: str


class EditFieldOut(OutModel):
    key: str
    label: str
    kind: Literal["text", "long", "choice", "company"]
    value: str | None = Field(description="As it is, with emails and phone numbers hidden")
    hidden: bool = Field(
        description="Part of it is hidden. A change to this field has to be the whole value"
    )
    required: bool
    max_chars: int
    choices: list[EditChoiceOut]


class EditFormOut(OutModel):
    blocked: str | None = Field(description="Why it can't change now, or null")
    deletable: bool
    fields: list[EditFieldOut]


class EditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[SafeText, SafeText | None] = Field(
        max_length=20, description="Only the fields that changed, by key. null clears one"
    )


class EditDoneOut(OutModel):
    edit_id: uuid.UUID | None = Field(description="For Undo. null: nothing was different")


class EditChangeOut(OutModel):
    label: str
    before: str | None
    after: str | None


class EditOut(OutModel):
    id: uuid.UUID
    at: datetime
    admin_name: str | None
    row_id: str
    action: Literal["change", "delete", "undo"]
    changes: list[EditChangeOut]
    can_undo: bool


class EditsOut(OutModel):
    total: int
    items: list[EditOut]


def _editable(request: Request, table: str) -> Editable:
    found = edits.editables(request.app.state.apps).get(table)
    if found is None:
        raise Problem(404, "This table can't be edited", "The Data tab only shows it.")
    return found


def _refused(error: EditRefused) -> Problem:
    if isinstance(error, ValueRefused):
        return Problem(
            422,
            "Some fields need a fix",
            "Look at the fields listed.",
            errors=[{"field": f"body.values.{error.field}", "message": error.reason}],
        )
    if error.reason == edits.NOT_THERE:
        return Problem(404, "No such row", error.reason)
    return Problem(409, "It can't be changed", error.reason, code="edit_refused")


def _admin_id(admin: AuthContext | None) -> uuid.UUID | None:
    return admin.user.id if admin else None


@router.get(
    "/tables/{table}/rows/{row_id}",
    response_model=EditFormOut,
    summary="One row's edit screen",
)
async def data_edit_form(
    table: TableName, row_id: RowId, request: Request, db: SessionDep, admin: PlatformAdminDep
) -> EditFormOut:
    editable = _editable(request, table)
    row = await edits.read_row(db, table, row_id)
    if row is None:
        raise Problem(404, "No such row", edits.NOT_THERE)
    fields = [
        EditFieldOut(
            key=item.field.key,
            label=item.field.label,
            kind=item.field.kind,
            value=item.value,
            hidden=item.hidden,
            required=item.field.required,
            max_chars=item.field.max_chars,
            choices=[EditChoiceOut(value=c.value, label=c.label) for c in item.choices],
        )
        for item in await edits.form(db, editable, row)
    ]
    return EditFormOut(blocked=editable.blocked(row), deletable=editable.deletable, fields=fields)


@router.patch(
    "/tables/{table}/rows/{row_id}",
    response_model=EditDoneOut,
    summary="Change a row",
    description=(
        "Only the listed fields can change (422 for any other). A value that still holds the "
        "dots of a hidden detail is refused. A row that is being used, like a call that is "
        "sending or logged, is 409 `edit_refused`. The old and new value, who and when are "
        "saved. Platform admin only."
    ),
)
async def edit_data_row(
    table: TableName,
    row_id: RowId,
    body: EditIn,
    request: Request,
    db: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
) -> EditDoneOut:
    editable = _editable(request, table)
    try:
        edit = await edits.change(
            db, editable, row_id, body.values, admin_id=_admin_id(admin), now=now
        )
    except EditRefused as error:
        await db.rollback()
        raise _refused(error) from error
    edit_id = edit.id if edit else None
    await db.commit()
    return EditDoneOut(edit_id=edit_id)


@router.delete(
    "/tables/{table}/rows/{row_id}",
    response_model=EditDoneOut,
    summary="Delete a row",
    description=(
        "Only where the code allows it: a call not yet sent, or a Memory note. The whole row "
        "is saved first, so Undo can put it back. Platform admin only."
    ),
)
async def delete_data_row(
    table: TableName,
    row_id: RowId,
    request: Request,
    db: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
) -> EditDoneOut:
    editable = _editable(request, table)
    try:
        edit = await edits.delete(db, editable, row_id, admin_id=_admin_id(admin), now=now)
    except EditRefused as error:
        await db.rollback()
        raise _refused(error) from error
    edit_id = edit.id
    await db.commit()
    return EditDoneOut(edit_id=edit_id)


@router.get("/edits", response_model=EditsOut, summary="A table's edits, newest first")
async def data_table_edits(
    request: Request,
    db: SessionDep,
    admin: PlatformAdminDep,
    table: Annotated[SafeText, Query(max_length=128)],
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> EditsOut:
    editable = _editable(request, table)
    rows, total, undone = await edits.newest(db, table, limit=EDITS_PAGE, offset=offset)
    ids = {row.admin_id for row in rows if row.admin_id}
    found = await db.execute(select(User.id, User.name).where(User.id.in_(ids)))
    names = {user_id: name for user_id, name in found}
    items = [
        EditOut(
            id=row.id,
            at=row.created_at,
            admin_name=names.get(row.admin_id) if row.admin_id else None,
            row_id=row.row_id,
            action=row.action,
            changes=[
                EditChangeOut(label=item.label, before=item.before, after=item.after)
                for item in edits.what_changed(editable, row)
            ],
            can_undo=row.action != "undo" and row.id not in undone,
        )
        for row in rows
    ]
    return EditsOut(total=total, items=items)


@router.post(
    "/edits/{edit_id}/undo",
    response_model=EditDoneOut,
    summary="Undo an edit",
    description=(
        "Puts the old value back and records that too. 409 `edit_refused` once the row changed "
        "since, or when it was undone already. Platform admin only."
    ),
)
async def undo_data_edit(
    edit_id: Annotated[uuid.UUID, Path()], db: SessionDep, admin: PlatformAdminDep, now: NowDep
) -> EditDoneOut:
    try:
        undone = await edits.undo(db, edit_id, admin_id=_admin_id(admin), now=now)
    except EditRefused as error:
        await db.rollback()
        raise _refused(error) from error
    undone_id = undone.id
    await db.commit()
    return EditDoneOut(edit_id=undone_id)
