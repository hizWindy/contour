"""Admin's Data tab (PLAN-V26 T4-1): every listed table, read only, 50 rows to a page.

No route here exports or downloads. Every route needs `PlatformAdminDep` (403
`platform_admin_only` for anyone else).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Request
from pydantic import Field

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX, OutModel, SafeText
from core.api.signin import PlatformAdminDep
from core.data import service

router = APIRouter(prefix="/data/tables", tags=["data"])


class DataColumnOut(OutModel):
    key: str
    label: str
    sortable: bool


class DataTableOut(OutModel):
    table: str = Field(examples=["lead_finder.leads"])
    label: str = Field(examples=["Leads"])
    group: str
    columns: list[DataColumnOut]
    newest: str = Field(description="It starts sorted by this, newest first")
    note: str | None = Field(description="Like 'Change it in HubSpot, then press Sync.'")
    screen: str | None = Field(description="The address of the table's own screen, if it has one")
    screen_label: str | None


class DataRowOut(OutModel):
    id: str
    values: dict[str, str | None] = Field(
        description="As text. Email addresses and phone numbers are hidden, like j•••@site.com.au"
    )


class DataRowsOut(OutModel):
    total: int
    items: list[DataRowOut]


@router.get("", response_model=list[DataTableOut], summary="The tables the Data tab shows")
async def data_tables(request: Request, admin: PlatformAdminDep) -> list[DataTableOut]:
    return [
        DataTableOut(
            table=table.table,
            label=table.label,
            group=table.group,
            columns=[
                DataColumnOut(
                    key=column.key, label=column.label, sortable=service.sortable(table, column)
                )
                for column in table.columns
            ],
            newest=table.newest,
            note=table.note,
            screen=table.screen,
            screen_label=table.screen_label,
        )
        for table in service.listed(request.app.state.apps)
    ]


@router.get(
    "/{table}",
    response_model=DataRowsOut,
    summary="One page of a table",
    description=(
        "50 rows to a page. `q` looks in the table's names only, never in a contact detail. "
        "`sort` is a sortable column's key; left out, the newest comes first. No hash or key is "
        "ever in the answer. Platform admin only."
    ),
)
async def data_rows(
    table: Annotated[str, Path(max_length=128, examples=["lead_finder.leads"])],
    request: Request,
    db: SessionDep,
    admin: PlatformAdminDep,
    q: Annotated[SafeText | None, Query(max_length=120)] = None,
    sort: Annotated[SafeText | None, Query(max_length=64)] = None,
    order: Literal["asc", "desc"] = "desc",
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> DataRowsOut:
    found = service.find(request.app.state.apps, table)
    if found is None:
        raise Problem(404, "No such table", "The Data tab doesn't show a table with that name.")
    can_sort = {column.key for column in found.columns if service.sortable(found, column)}
    if sort is not None and sort not in can_sort:
        raise Problem(
            422,
            "Some fields need a fix",
            "Look at the fields listed.",
            errors=[{"field": "query.sort", "message": "This column can't be sorted."}],
        )
    rows, total = await service.read_rows(db, found, q=q, sort=sort, order=order, offset=offset)
    return DataRowsOut(
        total=total, items=[DataRowOut(id=row.id, values=row.values) for row in rows]
    )
