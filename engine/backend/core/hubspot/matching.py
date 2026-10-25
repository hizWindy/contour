"""Is this company already in HubSpot? Exact matches only, by domain, then by cleaned name.

Phase 3 adds close names and similar profiles from memory, shown as "Possible match".
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.importer import normalize_domain
from core.hubspot.models import HubSpotCompany, HubSpotDeal

DISSOLVED = "dissolved"
LEGAL_WORDS = {"pty", "ltd", "limited", "inc", "incorporated", "llc", "plc", "corp", "corporation"}

Status = Literal["new", "in_hubspot", "open_deal", "dissolved_deal"]


@dataclass(frozen=True)
class HubSpotMatch:
    status: Status
    hubspot_id: str | None = None
    name: str | None = None
    owner: str | None = None
    matched_by: Literal["domain", "name"] | None = None
    open_deals: list[str] = field(default_factory=list)
    last_dissolved: date | None = None  # when the latest dissolved deal closed


def clean_name(name: str) -> str:
    """'ABC Logistics Pty. Ltd.' becomes 'abc logistics'."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("&", " and ")).split()
    return " ".join(word for word in words if word not in LEGAL_WORDS)


async def match_company(
    session: AsyncSession, name: str, website: str | None = None
) -> HubSpotMatch:
    company: HubSpotCompany | None = None
    matched_by: Literal["domain", "name"] | None = None
    domain = normalize_domain(website)
    if domain:
        company = await session.scalar(
            select(HubSpotCompany).where(HubSpotCompany.domain == domain).limit(1)
        )
        matched_by = "domain" if company else None
    if company is None:
        wanted = clean_name(name)
        for candidate in await session.scalars(select(HubSpotCompany)):
            if clean_name(candidate.name) == wanted:
                company, matched_by = candidate, "name"
                break
    if company is None:
        return HubSpotMatch(status="new")

    deals = list(
        await session.scalars(
            select(HubSpotDeal).where(HubSpotDeal.hubspot_company_id == company.hubspot_id)
        )
    )
    open_deals = [d.name for d in deals if (d.stage or "").lower() != DISSOLVED]
    dissolved = [
        d.close_date or d.last_contacted for d in deals if (d.stage or "").lower() == DISSOLVED
    ]
    known_dates = [d for d in dissolved if d is not None]
    status: Status = "open_deal" if open_deals else "dissolved_deal" if dissolved else "in_hubspot"
    return HubSpotMatch(
        status=status,
        hubspot_id=company.hubspot_id,
        name=company.name,
        owner=company.owner,
        matched_by=matched_by,
        open_deals=open_deals,
        last_dissolved=max(known_dates) if known_dates else None,
    )
