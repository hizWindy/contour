"""One person's activity, for Admin's Activity page (PLAN-V26 Part 3): the reads.

The core owns sign-ins, devices and spending. The calls, the preps and what was sent live in the
projects' tables, and the core never imports a project: each one hands its part over in
`AppSpec.activity`, and says what kind of spending its Claude steps are in `AppSpec.spend_kinds`.

Everything is newest first and paged. Nothing here writes.
"""

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal

from sqlalchemy import Select, func, literal_column, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from core.apps import AppSpec
from core.auth.models import AuditEntry
from core.searches.models import SearchLog

PAGE: Final = 50
RUNS: Final = "Runs"
OTHER: Final = "Other"

type Tab = Literal["calls", "preps", "sent"]
type Rows = Select[*tuple[Any, ...]]


@dataclass(frozen=True)
class ActivityPart:
    """A project's rows for one tab.

    `rows(user_id)` selects five columns with these names: `id`, `at`, `what` (like the company),
    `detail` (like the person, or empty) and `state` (a key of `states`, or empty). `states` turns
    a saved state into plain words.
    """

    tab: Tab
    rows: Callable[[uuid.UUID], Rows]
    states: Mapping[str, str]


@dataclass(frozen=True)
class Item:
    id: str
    at: datetime
    what: str
    detail: str | None
    state: str | None


@dataclass(frozen=True)
class Spend:
    day: date  # in Melbourne
    kind: str
    requests: int
    cost_usd: Decimal


async def sign_ins(
    db: AsyncSession, user_id: uuid.UUID, *, offset: int
) -> tuple[list[AuditEntry], int]:
    """The person's part of the sign-in log, with what admins changed on the account."""
    mine = AuditEntry.user_id == user_id
    total = await db.scalar(select(func.count()).select_from(AuditEntry).where(mine))
    rows = await db.scalars(
        select(AuditEntry)
        .where(mine)
        .order_by(AuditEntry.created_at.desc(), AuditEntry.id.desc())
        .limit(PAGE)
        .offset(offset)
    )
    return list(rows), int(total or 0)


async def tab_items(
    db: AsyncSession, specs: Sequence[AppSpec], tab: Tab, user_id: uuid.UUID, *, offset: int
) -> tuple[list[Item], int]:
    """One tab's rows from every project that has some, paged in the database."""
    parts = [part for spec in specs for part in spec.activity if part.tab == tab]
    if not parts:
        return [], 0
    selects = [part.rows(user_id) for part in parts]
    rows = (selects[0] if len(selects) == 1 else union_all(*selects)).subquery()
    total = await db.scalar(select(func.count()).select_from(rows))
    found = await db.execute(
        select(rows).order_by(rows.c.at.desc(), rows.c.id.desc()).limit(PAGE).offset(offset)
    )
    words = {state: said for part in parts for state, said in part.states.items()}
    items = [
        Item(
            id=str(row.id),
            at=row.at,
            what=row.what,
            detail=row.detail or None,
            state=words.get(row.state, row.state) or None,
        )
        for row in found
    ]
    return items, int(total or 0)


async def spending(
    db: AsyncSession, specs: Sequence[AppSpec], user_id: uuid.UUID, *, offset: int
) -> tuple[list[Spend], int, Decimal]:
    """The person's Claude cost by Melbourne day and by kind: one page, the number of rows, and
    the cost of them all. Only requests that saved who asked are in it (`searches.user_id`).

    The database groups by day, step and whether a run asked, so this reads a few rows a day.
    """
    # literal_column, so the zone is the same text in SELECT and GROUP BY, as Postgres needs.
    day = func.date(func.timezone(literal_column("'Australia/Melbourne'"), SearchLog.created_at))
    in_run = SearchLog.run_id.is_not(None)
    found = await db.execute(
        select(
            day.label("day"),
            SearchLog.step,
            in_run.label("in_run"),
            func.count().label("requests"),
            func.sum(SearchLog.cost_usd).label("cost"),
        )
        .where(SearchLog.user_id == user_id)
        .group_by(day, SearchLog.step, in_run)
    )
    kinds = {step: kind for spec in specs for step, kind in spec.spend_kinds.items()}
    summed: dict[tuple[date, str], tuple[int, Decimal]] = {}
    for row in found:
        kind = RUNS if row.in_run else kinds.get(row.step, OTHER)
        requests, cost = summed.get((row.day, kind), (0, Decimal(0)))
        summed[(row.day, kind)] = (requests + row.requests, cost + row.cost)
    ordered = sorted(summed, key=lambda key: key[1])
    ordered.sort(key=lambda key: key[0], reverse=True)  # the newest day first, then A to Z
    page = [Spend(*key, *summed[key]) for key in ordered[offset : offset + PAGE]]
    return page, len(ordered), sum((cost for _, cost in summed.values()), Decimal(0))
