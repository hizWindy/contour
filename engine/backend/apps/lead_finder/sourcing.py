"""Which source wins for each fact, and what the others said (PLAN-V4 C2 and C3).

Several sources can give the same fact: Claude's web research, HubSpot and Signal Hire. The rules
say which is main: `size.staff_sources` for staff numbers and `data_sources` for the rest, both in
criteria.yaml. The first source with a value is the one the rules use, and a later one fills in
only when the ones before it have nothing. Every other value is kept on the lead card, and a big
gap between them is a flag for a person to check.

Pure code: nothing here asks a source for anything, so the same facts always give the same card.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from apps.lead_finder.fields import CompanyFacts, Fact
from apps.lead_finder.rules import LeadFinderRules, StaffSource
from apps.lead_finder.sanitize import clean_domain
from apps.lead_finder.scoring import city_of
from core.hubspot.matching import clean_name, names_are_close
from core.signalhire.details import SignalHireCompany, SignalHireOffice

Source = Literal["claude", "hubspot", "signalhire"]
FactKey = Literal[
    "name", "website", "industry", "city", "staff_in_city", "office_since", "decision_makers"
]
SOURCE_NAMES: dict[Source, str] = {
    "claude": "Claude",
    "hubspot": "HubSpot",
    "signalhire": "Signal Hire",
}
# The source of each kind of staff number in `size.staff_sources`. The two Claude kinds are what its
# web research read: a LinkedIn count (doubled by the size rule), or a number from any other page.
STAFF_SOURCE: dict[StaffSource, Source] = {
    "hubspot": "hubspot",
    "headcount_tool": "signalhire",
    "linkedin": "claude",
    "web_research": "claude",
}
STAFF_ORDER: tuple[StaffSource, ...] = ("hubspot", "headcount_tool", "linkedin", "web_research")
MAX_OFFICES_SHOWN = 6


class OtherValue(BaseModel):
    source: Source
    value: str = Field(description="What that source said, in plain words, like 'about 250'")
    url: str | None = Field(description="The page it comes from, when it has one")


class FactSource(BaseModel):
    """Where one fact on the card came from, when it isn't plainly the web research's or another
    source said something else. A fact with no entry came from the web research alone."""

    fact: FactKey
    used: Source = Field(description="The source of the value the rules use")
    others: list[OtherValue] = Field(
        description="What the other sources said, kept so a person can compare"
    )
    conflict: str | None = Field(
        description="A plain sentence when the sources are far apart: a flag for a person to "
        "check. Empty when they agree."
    )


# --- Staff in the city (PLAN-V4 C3) ---------------------------------------------------------


@dataclass(frozen=True)
class StaffCandidate:
    """A staff number one source gave, before the rules pick one."""

    kind: StaffSource
    fact: Fact[int]  # what `staff_in_city` becomes if this one is used
    from_linkedin: (
        bool  # what `staff_from_linkedin` becomes: the size rule doubles a LinkedIn count
    )
    staff: int  # the staff it means, after any doubling: what the numbers are compared by
    text: str  # for a person, like "about 570 (285 people on file x 2)"
    note: str | None = None  # the card's "From ..." note, shown only when this one is used


@dataclass(frozen=True)
class StaffChoice:
    facts: CompanyFacts
    entry: FactSource | None
    note: tuple[Source, str] | None  # the source that won, and its plain note if it has one


def claude_staff(facts: CompanyFacts, rules: LeadFinderRules) -> StaffCandidate | None:
    """The number Claude's web research found, if it found one."""
    value = facts.staff_in_city.value
    if value is None or value < 1:
        return None
    if facts.staff_from_linkedin:
        multiplier = rules.criteria.size.linkedin_staff_multiplier
        staff = round(value * multiplier)
        text = f"about {staff:,} ({value:,} on LinkedIn x {multiplier:g})"
        return StaffCandidate("linkedin", facts.staff_in_city, True, staff, text)
    return StaffCandidate("web_research", facts.staff_in_city, False, value, f"{value:,}")


def choose_staff(
    facts: CompanyFacts, found: Sequence[StaffCandidate | None], rules: LeadFinderRules
) -> StaffChoice:
    """The staff number the rules use: the first source in `size.staff_sources` that has one.

    `found` holds the numbers HubSpot and Signal Hire gave, if they gave any. Claude's own number is
    read from `facts`. The winner goes into `staff_in_city`; the others are kept in the entry, and
    two numbers more than `conflicts.staff_gap_ratio` times apart raise a flag. Claude's source
    kinds that the list leaves out come last.
    """
    order = rules.criteria.size.staff_sources

    def rank(candidate: StaffCandidate) -> int:
        if candidate.kind in order:
            return order.index(candidate.kind)
        return len(order) + STAFF_ORDER.index(candidate.kind)

    everyone = sorted((c for c in (claude_staff(facts, rules), *found) if c is not None), key=rank)
    if not everyone:
        return StaffChoice(facts, None, None)
    winner, others = everyone[0], everyone[1:]
    used = STAFF_SOURCE[winner.kind]
    if used != "claude":
        facts = facts.model_copy(
            update={"staff_in_city": winner.fact, "staff_from_linkedin": winner.from_linkedin}
        )
    entry = None
    if others or used != "claude":
        entry = FactSource(
            fact="staff_in_city",
            used=used,
            others=[
                OtherValue(source=STAFF_SOURCE[o.kind], value=o.text, url=o.fact.source_url)
                for o in others
            ],
            conflict=_staff_gap(everyone, rules),
        )
    note = (used, winner.note) if winner.note else None
    return StaffChoice(facts, entry, note)


def _staff_gap(everyone: list[StaffCandidate], rules: LeadFinderRules) -> str | None:
    sizes = [c.staff for c in everyone if c.staff > 0]
    ratio = rules.criteria.conflicts.staff_gap_ratio
    if len(sizes) < 2 or max(sizes) <= min(sizes) * ratio:
        return None
    said = ", ".join(
        f"{SOURCE_NAMES[STAFF_SOURCE[c.kind]]} about {c.staff:,}" for c in everyone if c.staff > 0
    )
    return f"The staff numbers are more than {ratio:g} times apart: {said}. Check which is right."


# --- The company's name, website and industry (PLAN-V4 C1 and C2) -----------------------------


def apply_company_details(
    facts: CompanyFacts, details: SignalHireCompany | None, rules: LeadFinderRules
) -> tuple[CompanyFacts, list[FactSource]]:
    """The facts with Signal Hire's checked name, website and industry, where `data_sources` makes
    it main: its value is used and Claude's is kept in the entry. Where Claude is listed first,
    Signal Hire only fills a gap. Industry groups stay as Claude set them, because they are its
    reading of the notes.

    Two names, or two websites, that are not the same company raise a flag. Two industries never
    do: they are free text that two sources write differently.
    """
    order = rules.criteria.data_sources.company_details
    if details is None or "headcount_tool" not in order:
        return facts, []
    first = _signalhire_first(order)
    update: dict[str, Any] = {}
    entries: list[FactSource] = []

    name, entry = _compare(
        "name",
        facts.name,
        details.name,
        signalhire_first=first,
        same=_same_name,
        flag=_name_flag,
    )
    if entry is not None:
        entries.append(entry)
        if entry.used == "signalhire" and name:
            update["name"] = name

    claude_site = facts.website.value
    site, entry = _compare(
        "website",
        claude_site,
        details.website,
        signalhire_first=first,
        claude_url=facts.website.source_url,
        same=_same_site,
        flag=_site_flag,
    )
    if entry is not None:
        entries.append(entry)
        if entry.used == "signalhire":
            update["website"] = _from_signalhire(site)

    industry, entry = _compare(
        "industry",
        facts.industry.value,
        details.industry,
        signalhire_first=first,
        claude_url=facts.industry.source_url,
    )
    if entry is not None:
        entries.append(entry)
        if entry.used == "signalhire":
            update["industry"] = _from_signalhire(industry)

    return (facts.model_copy(update=update) if update else facts), entries


def _signalhire_first(order: Sequence[str]) -> bool:
    """Whether Signal Hire comes before the web research in one of the `data_sources` lists."""
    if "headcount_tool" not in order:
        return False
    return "web_research" not in order or order.index("headcount_tool") < order.index(
        "web_research"
    )


def _same_name(a: str, b: str) -> bool:
    return clean_name(a) == clean_name(b)


def _name_flag(claude: str, signalhire: str) -> str | None:
    if names_are_close(claude, signalhire):
        return None
    return (
        f"The names differ: Claude found {claude}, Signal Hire has {signalhire}. "
        "Check it is the same company."
    )


def _site(value: str) -> str:
    return clean_domain(value) or value.casefold()


def _same_site(a: str, b: str) -> bool:
    return _site(a) == _site(b)


def _site_flag(claude: str, signalhire: str) -> str:
    return (
        f"The websites differ: Claude found {claude}, Signal Hire has {signalhire}. "
        "Check which is right."
    )


def _from_signalhire(value: str | None) -> Fact[str]:
    """A fact Signal Hire gave: a source says it, so "confirmed". It has no page to link to."""
    return Fact[str](value=value, source_url=None, source_date=None, label="confirmed")


def _compare(
    fact: FactKey,
    claude: str | None,
    signalhire: str | None,
    *,
    signalhire_first: bool,
    claude_url: str | None = None,
    same: Callable[[str, str], bool] | None = None,
    flag: Callable[[str, str], str | None] | None = None,
) -> tuple[str | None, FactSource | None]:
    """The value to use, and the card's entry for it (None when there is nothing to say).

    `same` says two values are one thing written two ways, so nothing is shown. `flag` gives the
    sentence for two values that are really different, or None when they only look different."""
    if signalhire is None:
        return claude, None
    if claude is None:
        return signalhire, FactSource(fact=fact, used="signalhire", others=[], conflict=None)
    if (same or _same_text)(claude, signalhire):
        return claude, None
    conflict = flag(claude, signalhire) if flag else None
    if signalhire_first:
        other = OtherValue(source="claude", value=claude, url=claude_url)
        return signalhire, FactSource(
            fact=fact, used="signalhire", others=[other], conflict=conflict
        )
    other = OtherValue(source="signalhire", value=signalhire, url=None)
    return claude, FactSource(fact=fact, used="claude", others=[other], conflict=conflict)


def _same_text(a: str, b: str) -> bool:
    return " ".join(a.split()).casefold() == " ".join(b.split()).casefold()


def hubspot_filled(before: CompanyFacts, after: CompanyFacts) -> list[FactSource]:
    """An entry for each fact HubSpot filled in where the research found none (`fill_gaps`), so
    the card says the move-in year came from HubSpot and not from Claude."""
    if before.office_since != after.office_since:
        return [FactSource(fact="office_since", used="hubspot", others=[], conflict=None)]
    return []


# --- Offices and people (PLAN-V4 C2) -----------------------------------------------------------


def office_text(office: SignalHireOffice) -> str:
    """'Melbourne (head office)': the office's city, and a mark for the head office."""
    city = office.city or office.area or office.country or "Unknown place"
    return f"{city} (head office)" if office.head_office else city


def check_offices(
    details: SignalHireCompany | None,
    place: str | None,
    rules: LeadFinderRules,
) -> FactSource | None:
    """A flag when Signal Hire lists the company's offices and none is in the lead's city.

    The lead is about one office, which the search found. Signal Hire's list can only confirm or
    question it, so an agreeing list says nothing here: the card shows the list itself."""
    if details is None or place is None:
        return None
    if "headcount_tool" not in rules.criteria.data_sources.office_cities:
        return None
    cities = [office for office in details.offices if office.city]
    if not cities:
        return None
    here = city_of(place, rules)
    wanted = place.casefold()

    def is_here(city: str) -> bool:
        if here is not None:
            return city_of(city, rules) == here
        return wanted in city.casefold() or city.casefold() in wanted

    if any(is_here(office.city or "") for office in cities):
        return None
    listed = ", ".join(office_text(office) for office in cities[:MAX_OFFICES_SHOWN])
    where = here or place
    return FactSource(
        fact="city",
        used="claude",
        others=[OtherValue(source="signalhire", value=f"Offices: {listed}", url=None)],
        conflict=f"Signal Hire lists no office in {where}. It lists {listed}. Check the city.",
    )


def people_source(
    facts: CompanyFacts, signalhire_people: int, rules: LeadFinderRules
) -> FactSource | None:
    """Which list of decision makers comes first on the card: the first source in
    `data_sources.decision_makers` that has people. None when only Claude has any."""
    if signalhire_people == 0:
        return None
    claude_people = len(facts.decision_makers)
    first = _signalhire_first(rules.criteria.data_sources.decision_makers)
    others = []
    if claude_people:
        others = [OtherValue(source="claude", value=_people(claude_people), url=None)]
    if first or not claude_people:
        return FactSource(fact="decision_makers", used="signalhire", others=others, conflict=None)
    other = OtherValue(source="signalhire", value=_people(signalhire_people), url=None)
    return FactSource(fact="decision_makers", used="claude", others=[other], conflict=None)


def _people(count: int) -> str:
    return f"{count} {'person' if count == 1 else 'people'}"
