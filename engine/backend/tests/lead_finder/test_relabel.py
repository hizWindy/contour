"""HubSpot labels for saved leads after a sync (PLAN-V5 D2)."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.relabel import describe, relabel
from core.hubspot.importer import CompanyRow, DealRow, HubSpotExport
from core.hubspot.service import save_export
from tests.lead_finder.factories import add_all, make_lead

pytestmark = pytest.mark.integration


async def test_relabel_finds_what_the_copy_says_now_and_saves_only_when_asked(
    session: AsyncSession,
) -> None:
    open_deal = make_lead("Acme Logistics", domain="acme.com.au")
    dissolved = make_lead("Beta Law", domain="betalaw.com.au")
    unknown = make_lead("Gamma Soft", domain="gamma.io")
    sent = make_lead("Delta Group", domain="delta.com.au", status="sent")
    await add_all(session, open_deal, dissolved, unknown, sent)
    await save_export(
        session,
        HubSpotExport(
            companies=[
                CompanyRow(
                    hubspot_id="1", name="Acme Logistics", domain="acme.com.au", owner="Pat"
                ),
                CompanyRow(hubspot_id="2", name="Beta Law", domain="betalaw.com.au"),
                CompanyRow(hubspot_id="4", name="Delta Group", domain="delta.com.au"),
            ],
            offices=[],
            deals=[
                DealRow(
                    hubspot_deal_id="10",
                    hubspot_company_id="1",
                    name="Acme fitout",
                    stage="Qualified Deal",
                ),
                DealRow(
                    hubspot_deal_id="20",
                    hubspot_company_id="2",
                    name="Beta move",
                    stage="Dissolved",
                ),
            ],
            skipped_sheets=[],
            skipped_rows=0,
        ),
        source="api",
    )

    dry = await relabel(session, write=False)
    assert (dry.total, dry.changed) == (3, 2)  # the sent lead is left alone
    assert dry.moves == {("new", "open_deal"): 1, ("new", "dissolved_deal"): 1, ("new", "new"): 1}
    await session.refresh(open_deal)
    assert open_deal.hubspot_status == "new"  # a dry run saves nothing
    assert "Add --yes" in describe(dry, written=False)

    done = await relabel(session, write=True)
    assert done.changed == 2
    await session.refresh(open_deal)
    await session.refresh(dissolved)
    await session.refresh(sent)
    assert (open_deal.hubspot_status, open_deal.hubspot_id) == ("open_deal", "1")
    assert open_deal.card["hubspot"]["open_deals"] == ["Acme fitout"]
    assert open_deal.card["hubspot"]["owner"] == "Pat"
    assert open_deal.result == "pass"  # the research result stays
    assert dissolved.hubspot_status == "dissolved_deal"
    assert sent.hubspot_status == "new" and sent.status == "sent"
    assert (await relabel(session, write=True)).changed == 0  # nothing left to change
