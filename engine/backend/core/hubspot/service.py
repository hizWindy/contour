"""Saves a HubSpot export into the local copy. Safe to run again: it updates, never duplicates."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.importer import HubSpotExport
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice


class ImportResult(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    companies: int
    offices: int
    deals: int
    skipped_sheets: list[str]
    skipped_rows: int
    profiles_rebuilt: int = 0  # company profiles built for memory after the import


class HubSpotSummary(BaseModel):
    companies: int
    offices: int
    deals: int
    last_imported_at: datetime | None


async def save_export(
    session: AsyncSession, export: HubSpotExport, source: str = "export"
) -> ImportResult:
    if export.companies:
        company_rows = [company.model_dump() | {"source": source} for company in export.companies]
        companies = insert(HubSpotCompany).values(company_rows)
        await session.execute(
            companies.on_conflict_do_update(
                index_elements=[HubSpotCompany.hubspot_id],
                set_={
                    **{
                        column: companies.excluded[column]
                        for column in company_rows[0]
                        if column != "hubspot_id"
                    },
                    "imported_at": func.now(),
                },
            )
        )

        # Offices have no ID in the export, so they're replaced for these companies.
        company_ids = [company.hubspot_id for company in export.companies]
        await session.execute(
            delete(HubSpotOffice).where(HubSpotOffice.hubspot_company_id.in_(company_ids))
        )
        if export.offices:
            await session.execute(
                insert(HubSpotOffice).values([office.model_dump() for office in export.offices])
            )

        if export.deals:
            deal_rows = [deal.model_dump() for deal in export.deals]
            deals = insert(HubSpotDeal).values(deal_rows)
            await session.execute(
                deals.on_conflict_do_update(
                    index_elements=[HubSpotDeal.hubspot_deal_id],
                    set_={
                        column: deals.excluded[column]
                        for column in deal_rows[0]
                        if column != "hubspot_deal_id"
                    },
                )
            )
    await session.commit()
    return ImportResult(
        companies=len(export.companies),
        offices=len(export.offices),
        deals=len(export.deals),
        skipped_sheets=export.skipped_sheets,
        skipped_rows=export.skipped_rows,
    )


async def summary(session: AsyncSession) -> HubSpotSummary:
    async def count(model: type[HubSpotCompany | HubSpotOffice | HubSpotDeal]) -> int:
        return (await session.scalar(select(func.count()).select_from(model))) or 0

    return HubSpotSummary(
        companies=await count(HubSpotCompany),
        offices=await count(HubSpotOffice),
        deals=await count(HubSpotDeal),
        last_imported_at=await session.scalar(select(func.max(HubSpotCompany.imported_at))),
    )
