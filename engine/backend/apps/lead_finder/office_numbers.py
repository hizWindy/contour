"""Office numbers HubSpot already holds.

Criteria_v2 section 2 gives the order to look for staff numbers: HubSpot first, then a headcount
tool, then LinkedIn (doubled), then the AI's web research. Our HubSpot export has a LinkedIn staff
count for most offices, and few office sizes, lease expiries or last-moved dates (EXPORT.md). So
HubSpot's staff count is one candidate for `sourcing.choose_staff` (`hubspot_staff`), which makes it
win over a later source and keeps the others on the card. Its office size, lease end and move-in
date are candidates in `data_sources.office_m2`, `lease_end` and `office_since` (PLAN-V16 T1-8,
`property.apply_office_sources`): after the two property tools and before the web research.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.fields import Fact
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sanitize import safe_http_url
from apps.lead_finder.sourcing import StaffCandidate
from core.hubspot.models import HubSpotCompany, HubSpotOffice
from core.hubspot.profiles import metro_city


@dataclass(frozen=True)
class OfficeNumbers:
    """What HubSpot holds about a company's offices in one city."""

    city: str
    linkedin_staff: int | None  # the largest LinkedIn count among its offices there
    lease_expiry: date | None  # the nearest one
    last_moved: date | None  # the latest one
    record_url: str | None  # the company's record in HubSpot: the source link
    office_m2: int | None = None  # the largest "Office Space Size" there (PLAN-V16 T1-8)


async def office_numbers(
    session: AsyncSession, hubspot_id: str | None, city: str | None
) -> OfficeNumbers | None:
    """The numbers of the company's offices in `city`. None when it isn't in HubSpot, the city is
    not known, or it has no office there. An office is in a city by its label ('Melbourne')."""
    if hubspot_id is None or city is None:
        return None
    offices = await session.scalars(
        select(HubSpotOffice).where(HubSpotOffice.hubspot_company_id == hubspot_id)
    )
    here = [office for office in offices if metro_city(office.label) == city]
    if not here:
        return None
    company = await session.get(HubSpotCompany, hubspot_id)
    sizes = [round(o.office_m2) for o in here if o.office_m2 is not None and o.office_m2 >= 1]
    return OfficeNumbers(
        city=city,
        linkedin_staff=max(
            (o.linkedin_staff for o in here if o.linkedin_staff and o.linkedin_staff > 0),
            default=None,
        ),
        lease_expiry=min((o.lease_expiry for o in here if o.lease_expiry), default=None),
        last_moved=max((o.last_moved for o in here if o.last_moved), default=None),
        record_url=company.hubspot_url if company else None,
        office_m2=max(sizes, default=None),
    )


def hubspot_link(numbers: OfficeNumbers) -> str | None:
    """The company's HubSpot record, when it is a plain web link: the source of its numbers."""
    return numbers.record_url if numbers.record_url and safe_http_url(numbers.record_url) else None


def hubspot_staff(numbers: OfficeNumbers | None, rules: LeadFinderRules) -> StaffCandidate | None:
    """HubSpot's staff count for the office as a candidate. It is a LinkedIn count, so the size rule
    doubles it. None when HubSpot is off in `size.staff_sources`, or has no count for the office."""
    if numbers is None or "hubspot" not in rules.criteria.size.staff_sources:
        return None
    if not numbers.linkedin_staff:
        return None
    count = numbers.linkedin_staff
    multiplier = rules.criteria.size.linkedin_staff_multiplier
    staff = round(count * multiplier)
    fact = Fact[int](
        value=count, source_url=hubspot_link(numbers), source_date=None, label="estimated"
    )
    return StaffCandidate(
        kind="hubspot",
        fact=fact,
        from_linkedin=True,  # the size rule doubles a LinkedIn count
        staff=staff,
        text=f"about {staff:,} ({count:,} on LinkedIn x {multiplier:g}, from HubSpot)",
        note=f"Staff in {numbers.city}: {count} on LinkedIn, from HubSpot. "
        "The real number is about double.",
    )
