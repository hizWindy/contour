"""Office numbers HubSpot already holds, used when the web research found none.

Criteria_v2 section 2 gives the order to look for staff numbers: HubSpot first, then a headcount
tool, then LinkedIn (doubled), then the AI's web research. Our HubSpot export has a LinkedIn staff
count for most offices, and almost no lease expiry or last-moved dates (EXPORT.md). So HubSpot
fills a gap the research left, and never overwrites a figure the research found.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.fields import CompanyFacts, Fact, TriggerFound
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sanitize import safe_http_url
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
    return OfficeNumbers(
        city=city,
        linkedin_staff=max(
            (o.linkedin_staff for o in here if o.linkedin_staff and o.linkedin_staff > 0),
            default=None,
        ),
        lease_expiry=min((o.lease_expiry for o in here if o.lease_expiry), default=None),
        last_moved=max((o.last_moved for o in here if o.last_moved), default=None),
        record_url=company.hubspot_url if company else None,
    )


def fill_gaps(
    facts: CompanyFacts, numbers: OfficeNumbers | None, rules: LeadFinderRules, today: date
) -> tuple[CompanyFacts, list[str]]:
    """The facts with HubSpot's numbers in the gaps, and a plain note for each number used.

    Pure code. Nothing is overwritten: staff, the move-in year and a lease trigger are added only
    when the research found none. A fact from HubSpot links to the company's HubSpot record.
    """
    if numbers is None or "hubspot" not in rules.criteria.size.staff_sources:
        return facts, []
    link = numbers.record_url if numbers.record_url and safe_http_url(numbers.record_url) else None
    update: dict[str, Any] = {}
    notes: list[str] = []

    if facts.staff_in_city.value is None and numbers.linkedin_staff:
        update["staff_in_city"] = Fact[int](
            value=numbers.linkedin_staff, source_url=link, source_date=None, label="estimated"
        )
        update["staff_from_linkedin"] = True  # the size rule doubles a LinkedIn count
        notes.append(
            f"Staff in {numbers.city}: {numbers.linkedin_staff} on LinkedIn, from HubSpot. "
            "The real number is about double."
        )
    if facts.office_since.value is None and numbers.last_moved:
        update["office_since"] = Fact[str](
            value=numbers.last_moved.isoformat(),
            source_url=link,
            source_date=None,
            label="confirmed",
        )
        notes.append(f"Moved in {numbers.last_moved:%B %Y}, from HubSpot.")
    has_lease = any(trigger.id == "lease_ending" for trigger in facts.triggers)
    if numbers.lease_expiry and numbers.lease_expiry > today and link and not has_lease:
        ends = f"{numbers.lease_expiry:%B %Y}"
        update["triggers"] = [
            *facts.triggers,
            TriggerFound(
                id="lease_ending",
                what_happened=f"HubSpot has the {numbers.city} lease ending in {ends}.",
                date=numbers.lease_expiry.isoformat(),
                source_url=link,
                label="confirmed",
            ),
        ]
        notes.append(f"Lease in {numbers.city} ends {ends}, from HubSpot.")
    return (facts.model_copy(update=update) if update else facts), notes
