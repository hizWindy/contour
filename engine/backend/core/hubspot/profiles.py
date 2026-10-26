"""Company profiles: a short text for each HubSpot company, kept in memory as numbers.

A profile says what kind of company it is: its name, industry, the cities it has offices in with
an estimate of its staff there, and the names and stages of its deals. The text is turned into
numbers (an embedding) so two companies that read alike are close. That gives two things: a
researched company that looks like one in HubSpot is shown as a "possible match" (matching.py),
and a lead can be shown next to the companies Contour has done deals with (look-alikes).

What goes in a profile is chosen on purpose. Never a contact, a phone number, a street or a
description. Deal names are cleaned of anything that looks like an email, a web address or a
phone number first.

A researched company gets a profile in the SAME shape (`build_profile_text_from_facts`), so a
cosine score between the two means something. Both builders call one private formatter.

Pure code here, except `rebuild_profiles`, which reads the HubSpot tables and writes memory.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Protocol

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.embedder import Embedder
from core.memory.service import Note, replace_items

PROFILE_APP = "hubspot"
PROFILE_KIND = "company_profile"
# HubSpot's export holds one company with no name. It is never matched, profiled or watched.
PLACEHOLDER_NAME = "(no name on record)"
# An office whose label is one of these is an office in that city. Other labels ("Other Office 2")
# say nothing about a city.
METRO_CITIES = ("Melbourne", "Adelaide", "Perth", "Sydney", "Brisbane")
# Real staff is about LinkedIn staff x 2 (criteria.yaml: size.linkedin_staff_multiplier). Core
# can't read the rules, so callers that have them pass the value in.
DEFAULT_STAFF_MULTIPLIER = 2.0
MAX_DEALS_IN_TEXT = 5
MAX_FIELD_CHARS = 120  # one name, label or stage
MAX_TEXT_CHARS = 1500
DEAL_OPEN = "open_deal"
DEAL_DISSOLVED = "dissolved_deal"
# Two rebuilds at once would each delete the old profiles and each add new ones: duplicates.
# This lock (a Postgres advisory lock, held until the transaction ends) makes them take turns.
REBUILD_LOCK = 7_244_411

_METRO_BY_KEY = {city.casefold(): city for city in METRO_CITIES}
_EMAIL = re.compile(r"\S+@\S+")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
# 8 or more digits, with the spaces, dashes, dots and brackets people put in phone numbers, and
# an optional leading plus. A size like "3,000m2" has a comma and a unit, so it stays.
_PHONE = re.compile(r"[+(]?\d[\d ().\-]{6,}\d")
_INDUSTRY_LINE = re.compile(r"^Industry: (.+)$", re.MULTILINE)


def is_placeholder(name: str | None) -> bool:
    """True for the company HubSpot holds with no name."""
    return (name or "").strip().casefold() == PLACEHOLDER_NAME


def clean_text(value: str | None, max_chars: int = MAX_FIELD_CHARS) -> str:
    """One line of text for a profile: anything that looks like an email address, a web address
    or a phone number is removed, white space is collapsed and the length is capped."""
    if not value:
        return ""
    text_ = _PHONE.sub(" ", _URL.sub(" ", _EMAIL.sub(" ", value)))
    one_line = " ".join(text_.split())
    return one_line[:max_chars].rstrip()


def metro_city(label: str | None) -> str | None:
    """'melbourne ' becomes 'Melbourne'. Any other label (like 'Other Office 2') is not a city."""
    return _METRO_BY_KEY.get((label or "").strip().casefold())


def office_cities(offices: Iterable[HubSpotOffice]) -> list[str]:
    """The cities a company has offices in, from the office LABELS, in a fixed order. Never the
    company's own `city` field: that is a suburb."""
    found = {city for office in offices if (city := metro_city(office.label))}
    return [city for city in METRO_CITIES if city in found]


def estimated_staff_by_city(
    offices: Iterable[HubSpotOffice], multiplier: float = DEFAULT_STAFF_MULTIPLIER
) -> dict[str, int | None]:
    """City -> estimated staff there: the largest LinkedIn count among the offices with that
    label, times `multiplier`. None when no office there has a count (a count of 0 is none)."""
    best: dict[str, int | None] = {}
    for office in offices:
        city = metro_city(office.label)
        if city is None:
            continue
        staff = (
            office.linkedin_staff if office.linkedin_staff and office.linkedin_staff > 0 else None
        )
        current = best.get(city)
        best[city] = staff if current is None else (max(current, staff) if staff else current)
    return {
        city: None if staff is None else round(staff * multiplier) for city, staff in best.items()
    }


def _format_profile(
    *,
    name: str,
    industry: str | None,
    cities: Mapping[str, int | None],
    deals: Sequence[tuple[str, str | None]] = (),
) -> str:
    """The one text shape. Every field is cleaned here, so nothing private gets in by a caller
    forgetting to clean it. Lines: the name, `Industry: ...`, `Offices: ...`, `Deals: ...`."""
    lines = [clean_text(name) or "Company"]
    if cleaned_industry := clean_text(industry):
        lines.append(f"Industry: {cleaned_industry}")
    if cities:
        ordered = sorted(cities.items(), key=lambda item: (-(item[1] or 0), item[0]))
        parts = [
            f"{clean_text(city, 40)} (about {staff:,} staff)" if staff else clean_text(city, 40)
            for city, staff in ordered
        ]
        lines.append("Offices: " + ", ".join(part for part in parts if part))
    deal_parts = []
    for deal_name, stage in deals[:MAX_DEALS_IN_TEXT]:
        cleaned = clean_text(deal_name)
        if not cleaned:
            continue
        cleaned_stage = clean_text(stage, 60)
        deal_parts.append(f"{cleaned} ({cleaned_stage})" if cleaned_stage else cleaned)
    if deal_parts:
        lines.append("Deals: " + "; ".join(deal_parts))
    return "\n".join(lines)[:MAX_TEXT_CHARS]


def build_profile_text(
    company: HubSpotCompany,
    offices: Iterable[HubSpotOffice],
    deals: Iterable[HubSpotDeal],
    *,
    staff_multiplier: float = DEFAULT_STAFF_MULTIPLIER,
) -> str:
    """The profile text of one HubSpot company.

    From its name, industry, the staff estimate for each office city (the LinkedIn count times
    `staff_multiplier`), and its deal names and stages. Never contacts, phones, streets or
    descriptions.
    """
    return _format_profile(
        name=company.name,
        industry=company.industry,
        cities=estimated_staff_by_city(offices, staff_multiplier),
        deals=[(deal.name, deal.stage) for deal in deals],
    )


class _Value(Protocol):
    @property
    def value(self) -> Any: ...


class ProfileFacts(Protocol):
    """What `build_profile_text_from_facts` reads from the researched facts
    (apps.lead_finder.fields.CompanyFacts has all of it). Core never imports from apps."""

    @property
    def name(self) -> str: ...
    @property
    def industry(self) -> _Value: ...
    @property
    def city(self) -> _Value: ...
    @property
    def staff_in_city(self) -> _Value: ...
    @property
    def staff_from_linkedin(self) -> bool: ...


def build_profile_text_from_facts(
    facts: ProfileFacts,
    *,
    city: str | None = None,
    staff_multiplier: float = DEFAULT_STAFF_MULTIPLIER,
) -> str:
    """The profile text of a researched company, in the same shape as a HubSpot one.

    Pure, so it can run BEFORE matching. `city` is the researched metro city (like 'Melbourne')
    if the caller has it; otherwise the place text from the facts is used as it is. Staff is
    the number found for that city, times `staff_multiplier` when it is a LinkedIn count. No
    summary and no office size go in: a HubSpot profile has neither, and the score would drop.
    """
    place = clean_text(city, 40) or clean_text(str(facts.city.value or ""), 40)
    staff = facts.staff_in_city.value
    estimate: int | None = None
    if isinstance(staff, int) and staff > 0:
        estimate = round(staff * staff_multiplier) if facts.staff_from_linkedin else staff
    industry = facts.industry.value
    return _format_profile(
        name=facts.name,
        industry=industry if isinstance(industry, str) else None,
        cities={place: estimate} if place else {},
    )


def industry_of_profile(profile_text: str | None) -> str | None:
    """The industry line of a profile text, read back. None when it has none."""
    if not profile_text:
        return None
    found = _INDUSTRY_LINE.search(profile_text)
    return found.group(1).strip() if found else None


def deal_status(deals: Iterable[HubSpotDeal]) -> str | None:
    """'open_deal' if any deal is not dissolved, 'dissolved_deal' if all are, None with no deals.
    The same words as a lead's `hubspot_status`."""
    stages = [(deal.stage or "").strip().lower() for deal in deals]
    if not stages:
        return None
    return DEAL_DISSOLVED if all(stage == "dissolved" for stage in stages) else DEAL_OPEN


async def rebuild_profiles(
    session: AsyncSession,
    embedder: Embedder,
    *,
    staff_multiplier: float = DEFAULT_STAFF_MULTIPLIER,
) -> int:
    """Replaces every HubSpot company profile in memory with new ones. Returns how many.

    One profile for each company except the one with no name. Each memory item has
    `app="hubspot"`, `kind="company_profile"`, the company name as its subject, and meta
    `{hubspot_id, cities, industry, has_deal, deal_status}`. Safe to run again: the old profiles
    are deleted in the same transaction, so there are never duplicates. Commits.
    """
    # The lock comes first, so a second rebuild waits and then reads the data the first left.
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": REBUILD_LOCK})
    companies = list(
        await session.scalars(
            select(HubSpotCompany)
            .where(func.lower(func.btrim(HubSpotCompany.name)) != PLACEHOLDER_NAME)
            .order_by(HubSpotCompany.hubspot_id)
        )
    )
    offices: dict[str, list[HubSpotOffice]] = {}
    for office in await session.scalars(select(HubSpotOffice).order_by(HubSpotOffice.id)):
        offices.setdefault(office.hubspot_company_id, []).append(office)
    deals: dict[str, list[HubSpotDeal]] = {}
    for deal in await session.scalars(select(HubSpotDeal).order_by(HubSpotDeal.hubspot_deal_id)):
        deals.setdefault(deal.hubspot_company_id, []).append(deal)

    notes: list[Note] = []
    for company in companies:
        company_offices = offices.get(company.hubspot_id, [])
        company_deals = deals.get(company.hubspot_id, [])
        status = deal_status(company_deals)
        notes.append(
            Note(
                content=build_profile_text(
                    company, company_offices, company_deals, staff_multiplier=staff_multiplier
                ),
                subject=company.name[:300],
                meta={
                    "hubspot_id": company.hubspot_id,
                    "cities": office_cities(company_offices),
                    "industry": company.industry,
                    "has_deal": bool(company_deals),
                    "deal_status": status,
                },
            )
        )
    count = await replace_items(session, embedder, notes, app=PROFILE_APP, kind=PROFILE_KIND)
    await session.commit()
    return count
