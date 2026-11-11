"""PLAN-V15 T1-5: a full sync never removes or overwrites what our copy saved after it started."""

import asyncio

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import Settings
from core.hubspot.importer import CompanyRow, DealRow
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.hubspot.service import upsert_companies, upsert_deals
from core.hubspot.sync import begin, run
from tests.core.test_hubspot_sync import CountingEmbedder, contour
from tests.core.test_hubspot_sync_cancel import gated_read

pytestmark = pytest.mark.integration
SETTINGS = Settings()


async def test_a_full_sync_keeps_what_was_saved_while_it_read(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    first = await begin(session_factory, trigger="command", mode="full", settings=SETTINGS)
    await run(first, sessions=session_factory, hubspot=contour(), embedder=CountingEmbedder())  # type: ignore[arg-type]
    offices_before = await session.scalar(
        select(func.count())
        .select_from(HubSpotOffice)
        .where(HubSpotOffice.hubspot_company_id == "101")
    )

    fake = contour()  # what HubSpot said when the sync read: no ABC Logistics, the old Acme name
    gate = gated_read(fake)
    plan = await begin(session_factory, trigger="website", mode="full", settings=SETTINGS)
    assert plan.started_at is not None
    syncing = asyncio.create_task(
        run(plan, sessions=session_factory, hubspot=fake, embedder=CountingEmbedder())  # type: ignore[arg-type]
    )
    await asyncio.sleep(0.05)
    # Meanwhile a lead is sent to HubSpot and lands in our copy, a company is renamed by a
    # newer save, and a new deal is saved.
    async with session_factory() as other:
        await upsert_companies(
            other, [CompanyRow(hubspot_id="201", name="ABC Logistics")], source="api"
        )
        await other.execute(
            update(HubSpotCompany)
            .where(HubSpotCompany.hubspot_id == "101")
            .values(name="Acme Logistics Group", imported_at=func.now())
        )
        await upsert_deals(
            other,
            [DealRow(hubspot_deal_id="601", hubspot_company_id="102", name="Beta - Sydney")],
            source="api",
        )
        await other.commit()
    gate.set()
    out = await asyncio.wait_for(syncing, 10)

    assert out.status == "done"
    abc = await session.get(HubSpotCompany, "201")
    assert abc is not None and abc.name == "ABC Logistics"  # not removed by the full sync
    acme = await session.get(HubSpotCompany, "101")
    assert acme is not None
    await session.refresh(acme)
    assert acme.name == "Acme Logistics Group"  # not overwritten by the older read
    offices_after = await session.scalar(
        select(func.count())
        .select_from(HubSpotOffice)
        .where(HubSpotOffice.hubspot_company_id == "101")
    )
    assert offices_after == offices_before  # its offices weren't replaced either
    assert await session.get(HubSpotDeal, "601") is not None  # the new deal stays
    assert out.companies_saved == 2 and out.companies_removed == 0  # 102 and 103; 101 was newer


async def test_a_company_gone_from_hubspot_before_the_sync_is_still_removed(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    first = await begin(session_factory, trigger="command", mode="full", settings=SETTINGS)
    with_extra = contour()
    with_extra.add_company("104", name="Delta Build")
    await run(first, sessions=session_factory, hubspot=with_extra, embedder=CountingEmbedder())  # type: ignore[arg-type]
    plan = await begin(session_factory, trigger="command", mode="full", settings=SETTINGS)
    out = await run(plan, sessions=session_factory, hubspot=contour(), embedder=CountingEmbedder())  # type: ignore[arg-type]
    assert out.companies_removed == 1
    assert await session.get(HubSpotCompany, "104") is None
