"""Our copy of the tools, in the database (PLAN-V16 T2-4, T2-7).

- **Records:** saved once each (`record_key`), with the company's cleaned name as its key.
- **Lookups:** the 30-day memory, one row for each tool and company.
- **The ledger** (`DbLedger`) for the browser's reader: the page log, the 24-hour pause, the last
  problem and the last sign-in. Each call opens its own short session, so a reader waiting for its
  pace never holds a database connection.
"""

import uuid
from collections.abc import Iterable, Sequence
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.browser.reader import Pause, Read
from core.browser.stops import Outcome
from core.hubspot.matching import clean_name
from core.sources.models import PropertyLookup, PropertyRecordRow, SourceRead, SourceState
from core.sources.property_daily.parse import Parsed
from core.sources.types import PropertyRecord, SourceId

FEEDS = ("feed", "lease_endings")
SIGN_IN_PROBLEMS = frozenset({"signin_page", "signin_failed", "signin_twice"})


# --- Records ---------------------------------------------------------------------------------


async def save_records(session: AsyncSession, parsed: Iterable[Parsed], *, via: str) -> int:
    """Saves new facts and leaves known ones as they are. Returns how many were new."""
    rows = [
        {
            "id": uuid.uuid4(),
            **item.record.model_dump(),
            "company_key": clean_name(item.record.company),
            "via": via,
            "ref": item.ref[:64],
            "record_key": item.key,
        }
        for item in parsed
    ]
    if not rows:
        return 0
    unique = list({(row["source"], row["record_key"]): row for row in rows}.values())
    statement = (
        insert(PropertyRecordRow)
        .values(unique)
        .on_conflict_do_nothing(index_elements=["source", "record_key"])
        .returning(PropertyRecordRow.id)
    )
    saved = (await session.execute(statement)).scalars().all()
    return len(saved)


def _record(row: PropertyRecordRow) -> PropertyRecord:
    return PropertyRecord(
        source=row.source,  # the table's check keeps it to the two tools
        kind=row.kind,
        company=row.company,
        city=row.city,
        address=row.address,
        building=row.building,
        floor=row.floor,
        area_m2=row.area_m2,
        lease_start=row.lease_start,
        lease_end=row.lease_end,
        happened_on=row.happened_on,
        published_on=row.published_on,
        summary=row.summary,
        url=row.url,
        read_at=row.read_at,
    )


def _newest_first(records: list[PropertyRecord]) -> list[PropertyRecord]:
    def when(record: PropertyRecord) -> date:
        return record.happened_on or record.published_on or record.lease_start or date.min

    return sorted(records, key=when, reverse=True)


async def records_for(
    session: AsyncSession, company_key: str, city: str | None
) -> list[PropertyRecord]:
    """A company's records, newest first: in its city, or with no city (a city of its own is
    another branch, maybe another company)."""
    query = select(PropertyRecordRow).where(PropertyRecordRow.company_key == company_key)
    if city:
        query = query.where((PropertyRecordRow.city == city) | (PropertyRecordRow.city.is_(None)))
    rows = (await session.scalars(query.limit(200))).all()
    return _newest_first([_record(row) for row in rows])


async def recent_records(
    session: AsyncSession, cities: Sequence[str] | None, since: datetime
) -> list[PropertyRecord]:
    """What the feeds brought since `since`, for these cities (None: every city)."""
    query = select(PropertyRecordRow).where(
        PropertyRecordRow.via.in_(FEEDS), PropertyRecordRow.read_at >= since
    )
    if cities:
        query = query.where(PropertyRecordRow.city.in_(list(cities)))
    rows = (
        await session.scalars(query.order_by(PropertyRecordRow.read_at.desc()).limit(2000))
    ).all()
    return _newest_first([_record(row) for row in rows])


async def last_feed_day(session: AsyncSession, source: SourceId) -> date | None:
    return await session.scalar(
        select(func.max(PropertyRecordRow.published_on)).where(
            PropertyRecordRow.source == source, PropertyRecordRow.via == "feed"
        )
    )


async def count_records(session: AsyncSession, source: SourceId) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(PropertyRecordRow)
            .where(PropertyRecordRow.source == source)
        )
        or 0
    )


# --- Lookups ---------------------------------------------------------------------------------


async def last_lookup(
    session: AsyncSession, source: SourceId, company_key: str
) -> PropertyLookup | None:
    return await session.get(PropertyLookup, (source, company_key))


async def save_lookup(
    session: AsyncSession,
    *,
    source: SourceId,
    company_key: str,
    company: str,
    city: str | None,
    status: str,
    records: int,
    at: datetime,
    run_id: uuid.UUID | None,
) -> None:
    values = {
        "source": source,
        "company_key": company_key,
        "company": company,
        "city": city,
        "status": status,
        "records": records,
        "looked_up_at": at,
        "run_id": run_id,
    }
    statement = insert(PropertyLookup).values(values)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=["source", "company_key"],
            set_={
                key: statement.excluded[key]
                for key in values
                if key not in ("source", "company_key")
            },
        )
    )


# --- The state of each tool ------------------------------------------------------------------


async def get_state(session: AsyncSession, source: SourceId) -> SourceState | None:
    return await session.get(SourceState, source)


async def _upsert_state(session: AsyncSession, source: SourceId, **values: object) -> None:
    statement = insert(SourceState).values(source=source, **values)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=["source"], set_={**values, "updated_at": func.now()}
        )
    )


async def resume(session: AsyncSession, source: SourceId) -> None:
    """Lifts a pause (an Admin's "Resume")."""
    await _upsert_state(session, source, paused_until=None, pause_reason=None)


async def pages_since(session: AsyncSession, source: SourceId, since: datetime) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(SourceRead)
            .where(SourceRead.source == source, SourceRead.at >= since)
        )
        or 0
    )


async def last_good_read(session: AsyncSession, source: SourceId) -> datetime | None:
    return await session.scalar(
        select(func.max(SourceRead.at)).where(SourceRead.source == source, SourceRead.ok)
    )


class DbLedger:
    """The browser reader's ledger, in the database (`core.browser.reader.Ledger`)."""

    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self.factory = factory

    async def pause_state(self, source: SourceId) -> Pause | None:
        async with self.factory() as session:
            state = await get_state(session, source)
        if state is None or state.paused_until is None or state.pause_reason is None:
            return None
        return Pause(state.paused_until, state.pause_reason)  # type: ignore[arg-type]

    async def pages_since(self, source: SourceId, since: datetime) -> int:
        async with self.factory() as session:
            return await pages_since(session, source, since)

    async def pages_in_run(self, source: SourceId, run_id: uuid.UUID) -> int:
        async with self.factory() as session:
            return int(
                await session.scalar(
                    select(func.count())
                    .select_from(SourceRead)
                    .where(SourceRead.source == source, SourceRead.run_id == run_id)
                )
                or 0
            )

    async def record(self, read: Read) -> None:
        async with self.factory.begin() as session:
            session.add(
                SourceRead(
                    source=read.source,
                    kind=read.kind[:24],
                    at=read.at,
                    ok=read.ok,
                    outcome=read.outcome,
                    ms=read.ms,
                    run_id=read.run_id,
                )
            )

    async def pause(self, source: SourceId, reason: Outcome, until: datetime) -> None:
        async with self.factory.begin() as session:
            await _upsert_state(session, source, paused_until=until, pause_reason=reason)

    async def problem(self, source: SourceId, outcome: Outcome, at: datetime) -> None:
        async with self.factory.begin() as session:
            await _upsert_state(session, source, last_problem=outcome, last_problem_at=at)

    async def signed_in(self, source: SourceId, at: datetime) -> None:
        async with self.factory.begin() as session:
            state = await get_state(session, source)
            clear = state is not None and state.last_problem in SIGN_IN_PROBLEMS
            values: dict[str, object] = {"signed_in_at": at}
            if clear:
                values |= {"last_problem": None, "last_problem_at": None}
            await _upsert_state(session, source, **values)
