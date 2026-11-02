"""Signal Hire's numbers for one company: the test command, and the research's staff gap-filler.

Criteria_v2 section 2 puts "a headcount tool" second in the order for staff numbers.
- `lead-finder headcount` reads them for a few companies so we can compare them with LinkedIn x 2
  (PLAN-V3 step A4): the company's staff in all, how many people Signal Hire has on file in the
  city, and how many of those are senior. It changes no lead.
- `fill_staff_gap` is the research's step (PLAN-V3 C2). It runs only when no staff number was found
  and `headcount_tool` is in `size.staff_sources`, so it fills a gap and never overwrites.

Counts only. No name, email or phone is asked for (see core/signalhire/client.py).
"""

import re
from collections.abc import Awaitable
from dataclasses import dataclass, field

from apps.lead_finder.sanitize import clean_domain, one_line
from core.hubspot.matching import LEGAL_WORDS, names_are_close
from core.signalhire.client import (
    CompanyInfo,
    CompanyRef,
    SignalHire,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireUnavailable,
)

# Signal Hire's own names for seniority. TBC on the first run: a wrong name is a 422.
SENIOR_LEVELS = ("C-Level", "VP", "Directors", "Head")
COUNTRY = "Australia"
MAX_SLUGS = 4
MAX_OFFICES_SHOWN = 8
_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{1,98}")


@dataclass
class HeadcountReading:
    """What Signal Hire says about one company. A number is None when it wasn't read."""

    asked: str
    company: CompanyRef | None
    tried: list[str]
    company_api_off: bool = False  # Signal Hire refused the company calls (a 403)
    counted_as: str | None = None  # the name the people in the city were counted under
    where: str | None = None
    info: CompanyInfo | None = None
    people_now: int | None = None  # people on file who work there now
    people_before: int | None = None  # people on file who used to work there
    people_in_city: int | None = None
    senior_in_city: int | None = None
    credits_used: int = 0
    problems: list[str] = field(default_factory=list)

    @property
    def name_checked(self) -> bool:
        """True when Signal Hire's own company page matched the name that was asked for. False
        means the people were counted under the name as typed, which may also match other
        companies with a like name."""
        return self.company is not None


def slug_candidates(company: str, website: str | None = None) -> list[str]:
    """The slugs to try, best first. Signal Hire has no search by name: it takes an id or a slug,
    which is usually the name in lower case with hyphens, like LinkedIn's. Each answer is checked
    against the name that was asked for, so a slug that belongs to another company is refused."""
    words = re.sub(r"[^a-z0-9 ]+", " ", company.lower().replace("&", " and ")).split()
    brand = [word for word in words if word not in LEGAL_WORDS]
    local = [word for word in brand if word != "australia"]
    options = ["-".join(brand), "".join(brand), "-".join(local)]
    domain = clean_domain(website)
    if domain:
        options.append(domain.split(".")[0])
    slugs: list[str] = []
    for option in options:
        if _SLUG.fullmatch(option) and option not in slugs:
            slugs.append(option)
    return slugs[:MAX_SLUGS]


async def resolve_company(
    client: SignalHire, company: str, website: str | None = None
) -> tuple[CompanyRef | None, list[str]]:
    """The Signal Hire company for this name, and the slugs tried. Free (findById costs nothing)."""
    tried: list[str] = []
    for slug in slug_candidates(company, website):
        tried.append(slug)
        found = await client.find_company(slug)
        if found is not None and names_are_close(found.name, company):
            return found, tried
    return None, tried


async def _attempt[T](reading: HeadcountReading, what: str, call: Awaitable[T]) -> T | None:
    """The call's answer. A problem is noted and the rest goes on, except when Signal Hire is
    unavailable (no key, the Company API off, no connection): that stops everything."""
    try:
        return await call
    except SignalHireUnavailable:
        raise
    except SignalHireError as error:
        reading.problems.append(f"{what}: {error.title}. {error.detail}")
        return None


async def read_headcount(
    client: SignalHire,
    *,
    company: str,
    website: str | None = None,
    city: str | None = None,
    location: str | None = None,
) -> HeadcountReading:
    """Reads the numbers. Uses 1 company credit, and 2 searches from the daily quota.

    When the Company API is off (Signal Hire answers 403 to a company call) it uses no credit and
    still counts the people, by the name as typed. The reading says the name was not checked. A
    refused key (401), no connection or a refused search still stops everything."""
    try:
        ref, tried = await resolve_company(client, company, website)
    except SignalHireCompanyApiOff as off:
        reading = HeadcountReading(asked=company, company=None, tried=[], company_api_off=True)
        reading.problems.append(
            f"Name not checked: {off.title}. {off.detail} The counts below use the name as "
            "typed, so they may include other companies with a like name."
        )
        await _count_in_city(client, reading, company, city, location)
        return reading

    reading = HeadcountReading(asked=company, company=ref, tried=tried)
    if ref is None:
        reading.problems.append(
            "No company on Signal Hire matched this name. Add --website, or find it on "
            "signalhire.com and tell me its slug."
        )
        return reading
    await _company_numbers(client, reading, ref)
    await _count_in_city(client, reading, ref.name, city, location)
    return reading


async def _company_numbers(client: SignalHire, reading: HeadcountReading, ref: CompanyRef) -> None:
    """The company's details (1 company credit) and its profile counts (free). All three are the
    Company API, so when it refuses one (403) the others aren't asked, and that is noted once."""
    try:
        reading.info = await _attempt(reading, "Company details", client.company_info(ref.id))
        if reading.info is not None:
            reading.credits_used = 1
        reading.people_now = await _attempt(
            reading, "People now", client.profile_count(ref.id, "current")
        )
        reading.people_before = await _attempt(
            reading, "People before", client.profile_count(ref.id, "past")
        )
    except SignalHireCompanyApiOff as off:
        reading.company_api_off = True
        reading.problems.append(f"Company details: {off.title}. {off.detail}")


async def _count_in_city(
    client: SignalHire,
    reading: HeadcountReading,
    name: str,
    city: str | None,
    location: str | None,
) -> None:
    """The people on file under `name` in the city, and the senior ones. Uses 2 searches."""
    reading.where = location or (f"{city}, {COUNTRY}" if city else None)
    if reading.where is None:
        reading.problems.append("No city was given, so there are no city counts.")
        return
    reading.counted_as = name
    reading.people_in_city = await _attempt(
        reading, "People in the city", client.count_people(company=name, location=reading.where)
    )
    reading.senior_in_city = await _attempt(
        reading,
        "Senior people in the city",
        client.count_people(company=name, location=reading.where, seniority=SENIOR_LEVELS),
    )


def _number(value: int | None) -> str:
    return "not given" if value is None else f"{value:,}"


def describe_reading(reading: HeadcountReading) -> str:
    """The reading as plain lines for the terminal. Text from Signal Hire goes through
    `one_line`, because it isn't ours."""
    asked = one_line(reading.asked, 80)
    ref = reading.company
    info = reading.info
    if ref is not None:
        lines = [
            f"{asked}: Signal Hire has it as {one_line(ref.name, 80)} "
            f"(slug {one_line(ref.slug, 60)}, id {ref.id})"
        ]
        if info is not None:
            lines.append(
                f"  Staff, whole company (Signal Hire's estimate): {_number(info.staff_count)}"
            )
        lines.append(
            f"  People on file, now / before: {_number(reading.people_now)} / "
            f"{_number(reading.people_before)}"
        )
    elif reading.company_api_off:
        lines = [f"{asked}: name not checked (the Company API is off)"]
    else:
        lines = [f"{asked}: not found on Signal Hire (slugs tried: {', '.join(reading.tried)})"]
    if reading.where:
        place = one_line(reading.where, 80)
        by = "" if reading.name_checked else f", by the name as typed ({asked})"
        lines.append(f"  People on file in {place}{by}: {_number(reading.people_in_city)}")
        lines.append(
            f"  Senior people there ({', '.join(SENIOR_LEVELS)}): {_number(reading.senior_in_city)}"
        )
    if info is not None:
        lines += _about(info)
    credits = reading.credits_used
    lines.append(f"  Credits used: {credits} company credit{'s' if credits != 1 else ''}")
    lines += [f"  Problem: {one_line(problem, 300)}" for problem in reading.problems]
    return "\n".join(lines)


def _about(info: CompanyInfo) -> list[str]:
    lines = []
    for label, value in (
        ("Industry", info.industry),
        ("Website", info.website),
        ("LinkedIn id", info.linkedin_id),
    ):
        if value:
            lines.append(f"  {label}: {one_line(value, 120)}")
    if info.staffing_company:
        lines.append("  Signal Hire marks it as a staffing company.")
    for office in info.offices[:MAX_OFFICES_SHOWN]:
        parts = [part for part in (office.city, office.area, office.country) if part]
        if parts:
            head = " (head office)" if office.headquarter else ""
            lines.append(f"  Office: {one_line(', '.join(parts), 120)}{head}")
    return lines
