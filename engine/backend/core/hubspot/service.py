"""Saves HubSpot rows into our copy, from an export file or from the sync. Safe to run again: it
updates, never duplicates.

The export and the sync share the same savers (`upsert_companies`, `replace_offices`,
`upsert_deals`), so a row means the same thing whichever way it came in. Rows go in chunks:
Postgres takes at most 65,535 values in one statement, and Contour has about 14,000 companies.
"""

from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.importer import CompanyRow, DealRow, HubSpotExport, OfficeRow
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice, HubSpotOwner

CHUNK = 500  # rows in one statement: 500 rows x about 30 columns stays far under the limit
ID_CHUNK = 5000  # ids in one IN list


class ImportResult(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    companies: int
    offices: int
    deals: int
    skipped_sheets: list[str]
    skipped_rows: int
    profiles_rebuilt: int = 0  # company profiles built for memory after the import


class SourceCounts(BaseModel):
    export: int = 0
    api: int = 0


class HubSpotSummary(BaseModel):
    companies: int
    offices: int
    deals: int
    owners: int = 0
    last_imported_at: datetime | None
    companies_by_source: SourceCounts = SourceCounts()


def _chunks[T](items: Sequence[T], size: int = CHUNK) -> Iterable[Sequence[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


async def upsert_companies(
    session: AsyncSession, companies: Sequence[CompanyRow], *, source: str
) -> int:
    """Adds or updates each company by `hubspot_id`. Every column is replaced, and `source` and
    `imported_at` say where and when this copy came from. The caller commits."""
    rows = [company.model_dump() | {"source": source} for company in companies]
    for chunk in _chunks(rows):
        statement = insert(HubSpotCompany).values(list(chunk))
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[HubSpotCompany.hubspot_id],
                set_={
                    **{name: statement.excluded[name] for name in chunk[0] if name != "hubspot_id"},
                    "imported_at": func.now(),
                },
            )
        )
    return len(rows)


async def replace_offices(
    session: AsyncSession, company_ids: Sequence[str], offices: Sequence[OfficeRow]
) -> int:
    """Offices have no id in HubSpot (they are company fields), so the offices of these
    companies are deleted and saved again. The caller commits."""
    for ids in _chunks(list(dict.fromkeys(company_ids)), ID_CHUNK):
        await session.execute(
            delete(HubSpotOffice).where(HubSpotOffice.hubspot_company_id.in_(list(ids)))
        )
    rows = [office.model_dump() for office in offices]
    for chunk in _chunks(rows):
        await session.execute(insert(HubSpotOffice).values(list(chunk)))
    return len(rows)


async def upsert_deals(session: AsyncSession, deals: Sequence[DealRow], *, source: str) -> int:
    """Adds or updates each deal by `hubspot_deal_id`. The caller commits."""
    rows = [deal.model_dump() | {"source": source} for deal in deals]
    for chunk in _chunks(rows):
        statement = insert(HubSpotDeal).values(list(chunk))
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[HubSpotDeal.hubspot_deal_id],
                set_={
                    **{
                        name: statement.excluded[name]
                        for name in chunk[0]
                        if name != "hubspot_deal_id"
                    },
                    "imported_at": func.now(),
                },
            )
        )
    return len(rows)


async def upsert_owners(session: AsyncSession, owners: Sequence[dict[str, Any]]) -> int:
    """Adds or updates each owner (`owner_id`, `name`, `archived`). The caller commits."""
    for chunk in _chunks(list(owners)):
        statement = insert(HubSpotOwner).values(list(chunk))
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[HubSpotOwner.owner_id],
                set_={
                    "name": statement.excluded.name,
                    "archived": statement.excluded.archived,
                    "synced_at": func.now(),
                },
            )
        )
    return len(owners)


async def save_export(
    session: AsyncSession, export: HubSpotExport, source: str = "export"
) -> ImportResult:
    if export.companies:
        await upsert_companies(session, export.companies, source=source)
        await replace_offices(
            session, [company.hubspot_id for company in export.companies], export.offices
        )
        if export.deals:
            await upsert_deals(session, export.deals, source=source)
    await session.commit()
    return ImportResult(
        companies=len(export.companies),
        offices=len(export.offices),
        deals=len(export.deals),
        skipped_sheets=export.skipped_sheets,
        skipped_rows=export.skipped_rows,
    )


async def summary(session: AsyncSession) -> HubSpotSummary:
    async def count(model: type[Any]) -> int:
        return (await session.scalar(select(func.count()).select_from(model))) or 0

    by_source = dict(
        (
            await session.execute(
                select(HubSpotCompany.source, func.count()).group_by(HubSpotCompany.source)
            )
        ).all()
    )
    return HubSpotSummary(
        companies=await count(HubSpotCompany),
        offices=await count(HubSpotOffice),
        deals=await count(HubSpotDeal),
        owners=await count(HubSpotOwner),
        last_imported_at=await session.scalar(select(func.max(HubSpotCompany.imported_at))),
        companies_by_source=SourceCounts(
            export=by_source.get("export", 0), api=by_source.get("api", 0)
        ),
    )
