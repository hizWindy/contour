"""Is this company already in HubSpot? Exact matches by domain, then by cleaned name.

Phase 3 adds a HubSpot id (the watchlist), close names, names inside deal names and similar
profiles from memory. These are shown as "possible match" and a person decides. The types
below are final. The new matching logic is not written yet, so `match_company` ignores its new
arguments and behaves as it did in Phase 1.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.importer import normalize_domain
from core.hubspot.models import HubSpotCompany, HubSpotDeal

if TYPE_CHECKING:
    from core.memory.embedder import Embedder

DISSOLVED = "dissolved"
LEGAL_WORDS = {"pty", "ltd", "limited", "inc", "incorporated", "llc", "plc", "corp", "corporation"}

Status = Literal["new", "in_hubspot", "open_deal", "dissolved_deal", "possible_match"]
MatchedBy = Literal["domain", "name", "hubspot_id", "close_name", "similar_profile", "name_in_deal"]
CandidateReason = Literal["close_name", "similar_profile", "name_in_deal"]


@dataclass(frozen=True)
class MatchCandidate:
    """A company that might be the same one. A person confirms."""

    hubspot_id: str
    name: str
    owner: str | None
    reason: CandidateReason
    score: float  # 0 to 1, higher is closer (a text score of 90 out of 100 is 0.90)
    open_deals: list[str] = field(default_factory=list)
    last_dissolved: date | None = None  # when the latest dissolved deal closed


@dataclass(frozen=True)
class HubSpotMatch:
    status: Status
    hubspot_id: str | None = None
    name: str | None = None
    owner: str | None = None
    matched_by: MatchedBy | None = None
    open_deals: list[str] = field(default_factory=list)
    last_dissolved: date | None = None  # when the latest dissolved deal closed
    candidates: list[MatchCandidate] = field(default_factory=list)  # at most 3


def clean_name(name: str) -> str:
    """'ABC Logistics Pty. Ltd.' becomes 'abc logistics'."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("&", " and ")).split()
    return " ".join(word for word in words if word not in LEGAL_WORDS)


async def match_company(
    session: AsyncSession,
    name: str,
    website: str | None = None,
    city: str | None = None,
    embedder: "Embedder | None" = None,
    hubspot_id: str | None = None,
    profile_text: str | None = None,
) -> HubSpotMatch:
    """Finds the company in HubSpot. For now only `name` and `website` are used.

    The new arguments are part of the final signature: `city` (the researched metro city),
    `embedder` and `profile_text` (for similar profiles), and `hubspot_id` (the watchlist
    already knows which company it is).
    """
    company: HubSpotCompany | None = None
    matched_by: MatchedBy | None = None
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
