"""Look-alikes: companies that look like one lead, found by comparing company profiles.

Every researched company has a short profile saved in memory (kind `company_profile`): what it
does, where, how big. HubSpot companies have one too (app `hubspot`). This module compares the
profile of one lead with:

- HubSpot companies that have a deal (`meta.has_deal` is true): "companies like the ones we
  won or are working on";
- the profiles of other researched leads, to show what else the engine found that looks alike.

Local only: the numbers are already stored, so nothing is sent to Claude and no model runs here.
Similarity is the cosine similarity of the two profiles, from 0 (unrelated) to 1 (the same),
rounded to 3 places. The profiles are TBC with Levi until they are checked on real data.
"""

import uuid
from dataclasses import dataclass
from typing import Any, Final

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from apps.lead_finder.research import APP
from apps.lead_finder.schemas import DealLookalike, LeadLookalike, SimilarOut
from apps.lead_finder.tables import Lead, company_key
from core.api.errors import Problem
from core.hubspot.models import HubSpotDeal
from core.memory.models import MemoryItem

PROFILE_KIND: Final = "company_profile"
HUBSPOT_APP: Final = "hubspot"
DEFAULT_LIMIT: Final = 5
# How many of the nearest profiles are looked at before leads that can't be shown are dropped
# (the same company researched twice, test leads, the lead itself).
CANDIDATE_POOL: Final = 200
DEAL_NAMES_PER_COMPANY: Final = 5

NO_PROFILE_NOTE: Final = (
    "This lead has no company profile, so there is nothing to compare. A profile is saved when "
    "research finds at least one source. Research the company again to build one."
)


def similarity_of(distance: float) -> float:
    """Cosine distance as a similarity: 1 is the same, 0 is unrelated. 3 decimal places."""
    return round(min(1.0, max(0.0, 1.0 - float(distance))), 3)


def _uuid_or_none(value: object) -> uuid.UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def owner_of(item: MemoryItem) -> uuid.UUID | None:
    """The id of the lead a profile item belongs to: `meta.lead_id`, or else `meta.job_id`
    (research saves the lead's id under that name)."""
    meta = item.meta or {}
    return _uuid_or_none(meta.get("lead_id")) or _uuid_or_none(meta.get("job_id"))


def city_text(value: object) -> str | None:
    """`meta.cities` is a list of cities. The website shows them as one text."""
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list | tuple):
        names = [str(city).strip() for city in value if str(city).strip()]
        return ", ".join(names) or None
    return None


def _text(value: object) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _id_text(value: object) -> str | None:
    """A HubSpot id as text. The profile may hold it as a number."""
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return _text(value)


def nearest_profiles(profile: MemoryItem, *conditions: Any, app: str, limit: int) -> Any:
    """A query for the profile items of one app nearest to `profile`, nearest first, as rows of
    (item, cosine distance). The profile itself is left out.

    The conditions are applied FIRST (MATERIALIZED), then the distances are worked out exactly
    over what is left. Without that, Postgres may use the vector index (HNSW) to take its
    nearest items of ALL memory and only then apply the conditions, which returns too few rows
    once memory holds many other items (like source notes). The set that is left is small:
    the company profiles of one app.
    """
    pool = (
        select(MemoryItem)
        .where(
            MemoryItem.app == app,
            MemoryItem.kind == PROFILE_KIND,
            MemoryItem.id != profile.id,
            *conditions,
        )
        .cte("candidates")
        .prefix_with("MATERIALIZED")
    )
    item = aliased(MemoryItem, pool)
    distance = item.embedding.cosine_distance(profile.embedding).label("distance")
    return select(item, distance).order_by(distance, item.id).limit(limit)


async def own_profile(session: AsyncSession, lead: Lead) -> MemoryItem | None:
    """The lead's own profile item: the newest one that names the lead (`meta.lead_id` or
    `meta.job_id`). An item that names no lead at all is found by the company name instead, so
    a profile saved by another writer still counts. A profile of ANOTHER lead is never used."""
    meta: Any = MemoryItem.meta
    base = (MemoryItem.app == APP, MemoryItem.kind == PROFILE_KIND)
    text = str(lead.id)
    found = await session.scalar(
        select(MemoryItem)
        .where(*base, or_(meta.contains({"lead_id": text}), meta.contains({"job_id": text})))
        .order_by(MemoryItem.created_at.desc())
        .limit(1)
    )
    if found is not None:
        return found
    names = {lead.company.strip().lower(), lead.company_key}
    return await session.scalar(
        select(MemoryItem)
        .where(
            *base,
            and_(~meta.has_key("lead_id"), ~meta.has_key("job_id")),
            func.lower(MemoryItem.subject).in_(sorted(names)),
        )
        .order_by(MemoryItem.created_at.desc())
        .limit(1)
    )


async def deal_lookalikes(
    session: AsyncSession, profile: MemoryItem, limit: int
) -> list[DealLookalike]:
    """The HubSpot companies with a deal whose profiles are nearest, nearest first."""
    meta: Any = MemoryItem.meta
    query = nearest_profiles(
        profile, meta.contains({"has_deal": True}), app=HUBSPOT_APP, limit=limit
    )
    rows = (await session.execute(query)).all()
    found = [(item, d) for item, d in rows if _id_text((item.meta or {}).get("hubspot_id"))]
    ids = [str(_id_text(item.meta["hubspot_id"])) for item, _ in found]
    names: dict[str, list[str]] = {}
    if ids:
        deals = await session.execute(
            select(HubSpotDeal.hubspot_company_id, HubSpotDeal.name)
            .where(HubSpotDeal.hubspot_company_id.in_(ids))
            .order_by(
                HubSpotDeal.close_date.desc().nulls_last(),
                HubSpotDeal.created_in_hubspot.desc().nulls_last(),
                HubSpotDeal.hubspot_deal_id,
            )
        )
        for company_id, deal_name in deals.all():
            listed = names.setdefault(company_id, [])
            if deal_name not in listed and len(listed) < DEAL_NAMES_PER_COMPANY:
                listed.append(deal_name)
    return [
        DealLookalike(
            hubspot_id=hubspot_id,
            name=item.subject or "Unnamed company",
            similarity=similarity_of(d),
            city=city_text(item.meta.get("cities")),
            industry=_text(item.meta.get("industry")),
            deal_status=_text(item.meta.get("deal_status")),
            deal_names=names.get(hubspot_id, []),
        )
        for (item, d), hubspot_id in zip(found, ids, strict=True)
    ]


@dataclass(frozen=True)
class _Candidate:
    key: str  # the company key
    similarity: float


async def lead_lookalikes(
    session: AsyncSession, lead: Lead, profile: MemoryItem, limit: int
) -> list[LeadLookalike]:
    """Other researched companies whose profiles are nearest, nearest first, one row for each
    company: its newest research. Left out: this lead, other researches of the same company,
    and test-set leads."""
    rows = (await session.execute(nearest_profiles(profile, app=APP, limit=CANDIDATE_POOL))).all()

    # Which lead does each profile belong to? By id when it names one, else by company name.
    owners = {owner for item, _ in rows if (owner := owner_of(item)) is not None}
    known: dict[uuid.UUID, tuple[str, bool]] = {}
    if owners:
        found = await session.execute(
            select(Lead.id, Lead.company_key, Lead.is_test).where(Lead.id.in_(list(owners)))
        )
        known = {lead_id: (key, is_test) for lead_id, key, is_test in found.all()}
    candidates: list[_Candidate] = []
    for item, d in rows:
        owner = owner_of(item)
        if owner is not None:
            if owner not in known or known[owner][1]:  # a deleted lead, or a test lead
                continue
            key = known[owner][0]
        elif item.subject:
            key = company_key(item.subject)
        else:
            continue
        candidates.append(_Candidate(key=key, similarity=similarity_of(d)))

    # What to show for a company: its newest real research.
    keys = {candidate.key for candidate in candidates}
    newest: dict[str, Any] = {}
    if keys:
        shown = await session.execute(
            select(Lead.id, Lead.company, Lead.company_key, Lead.result, Lead.score)
            .where(Lead.company_key.in_(sorted(keys)), Lead.is_test.is_(False))
            .ext(distinct_on(Lead.company_key))
            .order_by(Lead.company_key, Lead.created_at.desc(), Lead.id.desc())
        )
        newest = {row.company_key: row for row in shown.all()}

    chosen: list[LeadLookalike] = []
    seen = {lead.company_key}
    for candidate in candidates:
        if candidate.key in seen or candidate.key not in newest:
            continue
        seen.add(candidate.key)
        row = newest[candidate.key]
        chosen.append(
            LeadLookalike(
                lead_id=row.id,
                name=row.company,
                result=row.result,
                score=row.score,
                similarity=candidate.similarity,
            )
        )
        if len(chosen) == limit:
            break
    return chosen


async def similar_for(
    session: AsyncSession, lead_id: uuid.UUID, limit: int = DEFAULT_LIMIT
) -> SimilarOut:
    """Look-alikes for one lead: HubSpot companies with a deal, and other leads.

    Answers `basis: "none"` with a plain note (and nothing else) when the lead has no profile.
    Raises Problem 404 only for an unknown lead.
    """
    lead = await session.get(Lead, lead_id)
    if lead is None:
        raise Problem(404, "Lead not found", "Check the id. GET /lead-finder/leads lists them.")
    profile = await own_profile(session, lead)
    if profile is None:
        return SimilarOut(basis="none", note=NO_PROFILE_NOTE, deals=[], leads=[])
    limit = max(1, limit)
    return SimilarOut(
        basis="profile",
        note=None,
        deals=await deal_lookalikes(session, profile, limit),
        leads=await lead_lookalikes(session, lead, profile, limit),
    )
