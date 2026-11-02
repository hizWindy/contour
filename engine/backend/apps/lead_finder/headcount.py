"""Signal Hire's numbers for one company: the test command, and the research's staff gap-filler.

Criteria_v2 section 2 puts "a headcount tool" second in the order for staff numbers.
- `lead-finder headcount` reads them for a few companies so we can compare them with LinkedIn x 2
  (PLAN-V3 step A4): the company's staff in all, how many people Signal Hire has on file in the
  city, and how many of those are senior. It changes no lead.
- `fill_staff_gap` is the research's step (PLAN-V3 C2). It runs only when no staff number was found
  and `headcount_tool` is in `size.staff_sources`, so it fills a gap and never overwrites.

Counts only. No name, email or phone is asked for (see core/signalhire/client.py).
"""

import asyncio
import logging
import re
from collections.abc import Awaitable
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from apps.lead_finder.context import Origin
from apps.lead_finder.fields import CompanyFacts, Fact
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sanitize import clean_domain, one_line
from core.config import Settings
from core.hubspot.matching import LEGAL_WORDS, names_are_close
from core.signalhire.client import (
    CompanyInfo,
    CompanyRef,
    PersonOnFile,
    SignalHire,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireUnavailable,
)

# The job titles of the people who decide on an office, in Signal Hire's search words. Its
# `seniority` field is ignored (2 Nov 2026: 285 people at Culture Amp in Melbourne with it and
# without it), but a current job title filters: 38 of the 285.
SENIOR_TITLES = (
    'CEO OR CFO OR COO OR Chief OR Director OR Head OR "General Manager" OR Property OR '
    "Facilities OR Workplace"
)
SENIOR_WORDS = "job titles like CEO, CFO, COO, Director, Head, property, facilities, workplace"
COUNTRY = "Australia"
MAX_SLUGS = 4
MAX_OFFICES_SHOWN = 8
STEP_SECONDS = 90.0  # the whole staff step, so a slow Signal Hire can't hold a research for long
STAFF_PROBLEM = "Signal Hire staff count"  # starts each line the step adds to a card's problems
MULTIPLIER_KEY = "size.headcount_tool_multiplier"  # its TBC note in criteria.yaml
MAX_PERSON_CHARS = 120  # a person's name or job title: one line, cut after reading
_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{1,98}")
log = logging.getLogger(__name__)


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
        client.count_people(company=name, location=reading.where, titles=SENIOR_TITLES),
    )


# --- The research's step: a staff number nobody else found --------------------------------------


@dataclass(frozen=True)
class StaffFill:
    """What the Signal Hire step made of one company: the facts (changed only in the staff
    number), a plain note for a number it filled in, and a line for each thing that went wrong."""

    facts: CompanyFacts
    notes: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def wants_signalhire(
    facts: CompanyFacts,
    rules: LeadFinderRules,
    settings: Settings,
    *,
    origin: Origin,
    city: str | None,
) -> bool:
    """Whether the research should ask Signal Hire for this company's staff number. All of these
    must hold:
    - no staff number was found, by the research or by HubSpot: Signal Hire fills a gap only;
    - `headcount_tool` is listed in `size.staff_sources` (it stays off until PLAN-V3 B1 says so);
    - the office's city is known, because the count is for one city;
    - the company's name did not come from HubSpot, unless HUBSPOT_NAMES_TO_SIGNALHIRE_OK is true.
    The key is not checked here: the caller makes a client only when this is true, and does
    nothing when there is no key."""
    return (
        facts.staff_in_city.value is None
        and "headcount_tool" in rules.criteria.size.staff_sources
        and city is not None
        and (origin != "hubspot" or settings.hubspot_names_to_signalhire_ok)
    )


async def fill_staff_gap(
    facts: CompanyFacts,
    client: SignalHire,
    *,
    company: str,
    website: str | None,
    city: str,
    rules: LeadFinderRules,
) -> StaffFill:
    """The facts with Signal Hire's count in the staff gap, like HubSpot's `fill_gaps`.

    It makes one search: the people on file whose current company is this one, in "<city>,
    Australia". The staff number saved is that count times `size.headcount_tool_multiplier`,
    labelled "estimated". It has no link, because Signal Hire's page address is not known yet
    (TBC). A number already there is never overwritten, and nothing but the staff number changes.

    The multiplier is applied once, here. `staff_from_linkedin` is set to false, because the size
    rule doubles a LinkedIn count and would multiply this one again.

    It never raises: any Signal Hire error becomes one line in `problems`, so the lead is still
    saved and the run goes on. (A cancel still passes through.)
    """
    if facts.staff_in_city.value is not None:
        return StaffFill(facts)
    try:
        async with asyncio.timeout(STEP_SECONDS):
            return await _fill(facts, client, company, website, city, rules)
    except SignalHireError as error:
        return StaffFill(facts, problems=[f"{STAFF_PROBLEM}: {error.title}. {error.detail}"])
    except TimeoutError:
        return StaffFill(facts, problems=[f"{STAFF_PROBLEM}: Signal Hire took too long."])
    except Exception as error:  # a bug here must not lose a lead the research already paid for
        log.warning("signalhire_staff_failed", extra={"reason": type(error).__name__})
        return StaffFill(facts, problems=[f"{STAFF_PROBLEM}: it couldn't be read."])


async def _fill(
    facts: CompanyFacts,
    client: SignalHire,
    company: str,
    website: str | None,
    city: str,
    rules: LeadFinderRules,
) -> StaffFill:
    size = rules.criteria.size
    name, checked, why_not = await _name_to_count(
        client, company, website, size.headcount_tool_name_check
    )
    if name is None:
        return StaffFill(facts, problems=[f"{STAFF_PROBLEM}: {why_not} No count was used."])
    people = await client.count_people(company=name, location=f"{city}, {COUNTRY}")
    if people <= 0:
        # Nobody on file is not a staff number of 0: Signal Hire holds only some of the people.
        return StaffFill(
            facts,
            problems=[f"{STAFF_PROBLEM}: no people on file in {city}. No count was used."],
        )

    staff = round(people * size.headcount_tool_multiplier)
    group = facts.industry_group
    if group in rules.criteria.industries.check_office_size:
        # Signal Hire counts everyone at the company in the city: shop, site and plant staff too.
        # For these industries that says little about the office, so the number is only a hint:
        # it is not used, so no office size or fitout value is worked out from it (PLAN-V4 C4).
        return StaffFill(
            facts,
            notes=[
                f"Signal Hire has {people:,} people on file in {city}. In {group} that counts "
                "shop, site and plant staff too, so it isn't used as the office's staff. Check "
                "the office size."
            ],
        )
    tbc = ", TBC" if any(note.key == MULTIPLIER_KEY for note in rules.criteria.tbc) else ""
    note = (
        f"Staff in {city}: about {staff:,}, from Signal Hire "
        f"({people:,} people on file x {size.headcount_tool_multiplier:g}{tbc})."
    )
    if not checked:
        note += (
            " The company name was not checked, so the count may include other companies "
            "with a like name."
        )
    filled = Fact[int](value=staff, source_url=None, source_date=None, label="estimated")
    changed = facts.model_copy(update={"staff_in_city": filled, "staff_from_linkedin": False})
    return StaffFill(changed, notes=[note])


async def _name_to_count(
    client: SignalHire, company: str, website: str | None, rule: str
) -> tuple[str | None, bool, str]:
    """The name to count people under, whether Signal Hire's Company API matched it to one of its
    own companies, and why there is no name. With `required` no name is used unless it was
    matched, because a short or common name can count other companies' people."""
    try:
        ref, _ = await resolve_company(client, company, website)
    except SignalHireCompanyApiOff:
        ref, why = None, "the Company API is off, so the name couldn't be checked."
    else:
        why = "no company on Signal Hire matched this name."
    if ref is not None:
        return ref.name, True, ""
    if rule == "optional":
        return company, False, ""
    return None, False, why


# --- The research's step: senior people to talk to (PLAN-V4 C5) ----------------------------------

MAX_LEADERS = 5  # senior people kept from Signal Hire for "Who to talk to"
PEOPLE_PROBLEM = "Signal Hire senior people"  # starts each line this step adds to the problems


class SignalHirePerson(BaseModel):
    """A senior person Signal Hire has on file at the company now: the name and job title only.
    No contact details. Levi said yes to decision makers' names (2 Nov 2026)."""

    name: str
    title: str | None
    signalhire_id: str = Field(description="Signal Hire's id, to ask for a contact later")


def wants_people(
    rules: LeadFinderRules, settings: Settings, *, origin: Origin, city: str | None
) -> bool:
    """Whether the research should ask Signal Hire for the company's senior people: Signal Hire
    is on (`headcount_tool` in `size.staff_sources`), the city is known, and the name didn't
    come from HubSpot unless HUBSPOT_NAMES_TO_SIGNALHIRE_OK is true. Unlike the staff step, it
    runs whether or not a staff number was found."""
    return (
        "headcount_tool" in rules.criteria.size.staff_sources
        and city is not None
        and (origin != "hubspot" or settings.hubspot_names_to_signalhire_ok)
    )


async def find_leaders(
    client: SignalHire,
    *,
    company: str,
    website: str | None,
    city: str,
    rules: LeadFinderRules,
) -> tuple[list[SignalHirePerson], list[str], list[str]]:
    """Up to MAX_LEADERS senior people at the company in the city (one search from the daily
    quota): the people, the notes and the problems. Like the staff step it never raises, and the
    name check is the same: with `required`, nobody is noted unless the Company API matched the
    name."""
    try:
        async with asyncio.timeout(STEP_SECONDS):
            name, checked, why_not = await _name_to_count(
                client, company, website, rules.criteria.size.headcount_tool_name_check
            )
            if name is None:
                return [], [], [f"{PEOPLE_PROBLEM}: {why_not} No one was noted."]
            found = await client.senior_people(
                company=name,
                location=f"{city}, {COUNTRY}",
                titles=SENIOR_TITLES,
                size=MAX_LEADERS,
            )
    except SignalHireError as error:
        return [], [], [f"{PEOPLE_PROBLEM}: {error.title}. {error.detail}"]
    except TimeoutError:
        return [], [], [f"{PEOPLE_PROBLEM}: Signal Hire took too long."]
    except Exception as error:  # a bug here must not lose a lead the research already paid for
        log.warning("signalhire_people_failed", extra={"reason": type(error).__name__})
        return [], [], [f"{PEOPLE_PROBLEM}: they couldn't be read."]
    people = _clean_people(found)
    notes = []
    if people and not checked:
        notes.append(
            "Senior people: the company name was not checked, so some may work for another "
            "company with a like name."
        )
    return people, notes, []


def _clean_people(found: list[PersonOnFile]) -> list[SignalHirePerson]:
    """One line each, no contact details, each person once, at most MAX_LEADERS. The text is
    Signal Hire's, not ours, so it goes through `one_line`."""
    kept: list[SignalHirePerson] = []
    names: set[str] = set()
    for person in found:
        name = one_line(person.name, MAX_PERSON_CHARS)
        title = one_line(person.title, MAX_PERSON_CHARS) or None
        if (
            not name
            or any(char.isdigit() for char in name)
            or "@" in name
            or (title is not None and "@" in title)
            or name.casefold() in names
        ):
            continue
        names.add(name.casefold())
        kept.append(SignalHirePerson(name=name, title=title, signalhire_id=person.signalhire_id))
    return kept[:MAX_LEADERS]


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
        lines.append(f"  Senior people there ({SENIOR_WORDS}): {_number(reading.senior_in_city)}")
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
