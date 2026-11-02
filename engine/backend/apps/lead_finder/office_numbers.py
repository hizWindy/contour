"""Office numbers HubSpot already holds.

Criteria_v2 section 2 gives the order to look for staff numbers: HubSpot first, then a headcount
tool, then LinkedIn (doubled), then the AI's web research. Our HubSpot export has a LinkedIn staff
count for most offices, and almost no lease expiry or last-moved dates (EXPORT.md). So HubSpot's
staff count is one candidate for `sourcing.choose_staff` (`hubspot_staff`), which makes it win
over a later source and keeps the others on the card. Its move-in year and lease end fill a gap the
research left, and never overwrite a figure the research found (`fill_gaps`).
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.fields import CompanyFacts, Fact, TriggerFound
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


def _link(numbers: OfficeNumbers) -> str | None:
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
    fact = Fact[int](value=count, source_url=_link(numbers), source_date=None, label="estimated")
    return StaffCandidate(
        kind="hubspot",
        fact=fact,
        from_linkedin=True,  # the size rule doubles a LinkedIn count
        staff=staff,
        text=f"about {staff:,} ({count:,} on LinkedIn x {multiplier:g}, from HubSpot)",
        note=f"Staff in {numbers.city}: {count} on LinkedIn, from HubSpot. "
        "The real number is about double.",
    )


def fill_gaps(
    facts: CompanyFacts, numbers: OfficeNumbers | None, rules: LeadFinderRules, today: date
) -> tuple[CompanyFacts, list[str]]:
    """The facts with HubSpot's numbers in the gaps, and a plain note for each number used.

    Pure code. Nothing is overwritten: the move-in year and a lease trigger are added only when
    the research found none. A fact from HubSpot links to the company's HubSpot record. The staff
    count is not here: it is chosen with the other sources' (`hubspot_staff`).
    """
    if numbers is None or "hubspot" not in rules.criteria.size.staff_sources:
        return facts, []
    link = _link(numbers)
    update: dict[str, Any] = {}
    notes: list[str] = []

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
