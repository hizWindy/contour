"""Property Daily and Arealytics in the research (PLAN-V16 T1-8). Pure code.

Track 2 reads the two tools into our own tables. Before Claude searches, the research asks
`core.sources.reader.lookup_company` what they know about the company: free, and it never raises.
This module turns those records into what the rules use, so the same records always give the same
card:

- **The office now** (`office_readings`): for each tool, the office the company is in now in the
  lead's city: its address, its floor area, the first date we know it was there, and the lease end.
  A lease that still runs (its lease end is still to come) is an office now. With no lease end
  known, the only address a tool has in that city is the office. A tool with several addresses
  there and no lease end gives no office: a record of a past office looks the same, and a guess
  would be a wrong match.
- **Which source wins** (`apply_office_sources`): the office's size, its lease end and its move-in
  date follow `data_sources.office_m2`, `lease_end` and `office_since` in criteria.yaml: the tools
  first, then HubSpot, then the web research (`sourcing.choose_office_value`). The others stay on
  the card (`fact_sources`), and values far apart raise a flag.
- **Signs and a dampener from records** (code, never Claude): a lease that ends in 12 to 36 months
  is `lease_ending`, and so is a move still to come (the sign's label says "or a relocation"). A
  search for space is `tenant_advisor`. A fitout (done, or already given to a firm) is the last
  fitout, which feeds the dampener `recent_fitout`. The move-in date feeds `long_tenure`.
- **What Claude may read** (`office_hint_lines`, `hidden_sources`): records only from a tool whose
  `..._to_claude_ok` switch is on, and never HubSpot's values in the Why now. The rest never
  enters a prompt (tests/lead_finder/test_property.py proves it).

A tool whose switch is off is skipped entirely, even if our copy still has its records.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from apps.lead_finder.context import Signal
from apps.lead_finder.fields import CompanyFacts, Fact, TriggerFound
from apps.lead_finder.office_numbers import OfficeNumbers, hubspot_link
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sanitize import json_line, one_line
from apps.lead_finder.scoring import city_of, month_year, parse_date
from apps.lead_finder.sources import tool_of, url_key
from apps.lead_finder.sourcing import (
    FactSource,
    OfficeChoice,
    OfficeValue,
    OtherValue,
    choose_office_value,
)
from core.config import Settings
from core.sources.types import (
    SOURCE_IDS,
    SOURCE_NAMES,
    CompanyProperty,
    PropertyRecord,
    SourceId,
)

LEASE_SIGN = "lease_ending"  # a lease ending, or a relocation (its label says so)
SPACE_SIGN = "tenant_advisor"  # in the market for space (PLAN-V16 T1-4)
OFFICE_KINDS = frozenset({"lease", "occupier", "move"})
MAX_CARD_RECORDS = 30  # records kept on a lead card, newest first
MAX_SIGN_CHARS = 240  # a sign's sentence, like discovery's
# A unit, suite or floor at the start of an address is not part of the street address
_UNIT = re.compile(r"^(?:level|lvl|floor|suite|unit|tenancy|shop)\s+\S+\s+|^ground floor\s+")


# --- Which records count ------------------------------------------------------------------------


def tools_in_use(found: CompanyProperty | None) -> set[SourceId]:
    """The tools the lookup didn't find switched off."""
    if found is None:
        return set()
    return {tool for tool in SOURCE_IDS if getattr(found.checked, tool) != "off"}


def records_in_use(found: CompanyProperty | None) -> list[PropertyRecord]:
    """The records of the tools in use, newest first, as the lookup gave them."""
    tools = tools_in_use(found)
    return [record for record in found.records if record.source in tools] if found else []


def for_card(found: CompanyProperty | None) -> CompanyProperty | None:
    """What the card keeps: the records of the tools in use, at most `MAX_CARD_RECORDS`."""
    if found is None:
        return None
    return found.model_copy(update={"records": records_in_use(found)[:MAX_CARD_RECORDS]})


def _metro(record: PropertyRecord, rules: LeadFinderRules) -> str | None:
    """The record's city as one of ours ('Pyrmont NSW' is Sydney), from its city or its address."""
    for text in (record.city, record.address):
        if text:
            found = city_of(text, rules)
            if found is not None:
                return found
    return None


def _here(record: PropertyRecord, metro: str | None, rules: LeadFinderRules) -> bool:
    """True when the record is about the lead's city. A record with no city at all counts too."""
    if metro is None:
        return False
    place = _metro(record, rules)
    return place == metro or (place is None and not record.city and not record.address)


def _when(record: PropertyRecord) -> date | None:
    """When it happened, else when the tool published it."""
    return record.happened_on or record.published_on


def _address_key(record: PropertyRecord) -> str | None:
    """The street address, the same however it is written: no case, no commas, no unit."""
    text = record.address or record.building
    if not text:
        return None
    words = " ".join(re.sub(r"[^0-9a-z]+", " ", text.casefold()).split())
    while (cut := _UNIT.sub("", words, count=1)) != words:
        words = cut
    return words or None


# --- The office now -----------------------------------------------------------------------------


@dataclass(frozen=True)
class OfficeReading:
    """What one tool says about the company's office in the lead's city now."""

    source: SourceId
    address: str
    building: str | None
    floors: tuple[str, ...]
    area_m2: int | None
    area_url: str | None
    since: date | None  # the first date we know it was at this address
    since_url: str | None
    lease_end: date | None  # the first lease end still to come at this address
    lease_url: str | None


def _started(record: PropertyRecord, today: date) -> bool:
    start = record.lease_start or record.happened_on
    return start is None or start <= today


def _current(record: PropertyRecord, today: date) -> bool:
    """A lease or tenancy that has started and not ended, or a move that has happened."""
    if record.kind == "move":
        return record.happened_on is not None and record.happened_on <= today
    ended = record.lease_end is not None and record.lease_end < today
    return _started(record, today) and not ended


def _area(group: Sequence[PropertyRecord]) -> tuple[int | None, str | None]:
    """The floor area: each floor once (its largest record), added up. With no floor named, the
    largest record. Returns the area and the link of its largest record."""
    sized = [record for record in group if record.area_m2]
    if not sized:
        return None, None
    floors: dict[str, PropertyRecord] = {}
    for record in sized:
        floor = " ".join((record.floor or "").casefold().split())
        best = floors.get(floor)
        if best is None or (record.area_m2 or 0) > (best.area_m2 or 0):
            floors[floor] = record
    unnamed = floors.pop("", None)
    named = sum(record.area_m2 or 0 for record in floors.values())
    whole = (unnamed.area_m2 or 0) if unnamed is not None else 0
    biggest = max(sized, key=lambda record: record.area_m2 or 0)
    return max(named, whole) or None, biggest.url


def office_reading(
    records: Iterable[PropertyRecord],
    source: SourceId,
    metro: str | None,
    rules: LeadFinderRules,
    today: date,
) -> OfficeReading | None:
    """The office one tool shows for the company in the lead's city now, or None."""
    mine = [
        record
        for record in records
        if record.source == source
        and record.kind in OFFICE_KINDS
        and _address_key(record) is not None
        and _here(record, metro, rules)
    ]
    groups: dict[str, list[PropertyRecord]] = {}
    for record in mine:
        if _current(record, today):
            groups.setdefault(_address_key(record) or "", []).append(record)
    moved = {
        key: max(r.happened_on for r in group if r.kind == "move" and r.happened_on)
        for key, group in groups.items()
        if any(r.kind == "move" for r in group)
    }
    running = {
        key: group for key, group in groups.items() if any(r.lease_end is not None for r in group)
    }
    if moved:
        # A move that has happened says where it is now: the newest one
        key = max(moved, key=lambda name: (moved[name], name))
        group = groups[key]
    elif running:
        # A lease that still runs is an office now. Two offices in one city: the larger one, then
        # the one whose lease ends first
        def larger(item: tuple[str, list[PropertyRecord]]) -> tuple[int, int, str]:
            area, _ = _area(item[1])
            ends = min(r.lease_end for r in item[1] if r.lease_end is not None)
            return (area or 0, -ends.toordinal(), item[0])

        key, group = max(running.items(), key=larger)
    elif len(groups) == 1:
        key, group = next(iter(groups.items()))
    else:
        return None  # nothing there, or several addresses and nothing to tell the office by
    at_address = [record for record in mine if _address_key(record) == key]
    starts = [
        (start, record)
        for record in at_address
        if (start := record.lease_start or record.happened_on) is not None and start <= today
    ]
    since, since_record = min(starts, key=lambda item: item[0], default=(None, None))
    ends = [record for record in group if record.lease_end is not None]
    soonest = min(ends, key=lambda record: record.lease_end or date.max, default=None)
    area, area_url = _area(group)
    first = next(record for record in group if record.address or record.building)
    floors = tuple(dict.fromkeys(record.floor for record in group if record.floor))
    return OfficeReading(
        source=source,
        address=first.address or first.building or "",
        building=next((record.building for record in group if record.building), None),
        floors=floors,
        area_m2=area,
        area_url=area_url,
        since=since,
        since_url=since_record.url if since_record else None,
        lease_end=soonest.lease_end if soonest else None,
        lease_url=soonest.url if soonest else None,
    )


def office_readings(
    found: CompanyProperty | None, metro: str | None, rules: LeadFinderRules, today: date
) -> dict[SourceId, OfficeReading]:
    """The office now, from each tool in use that shows one."""
    records = records_in_use(found)
    readings = {
        tool: office_reading(records, tool, metro, rules, today) for tool in tools_in_use(found)
    }
    return {tool: reading for tool, reading in readings.items() if reading is not None}


# --- Which source wins --------------------------------------------------------------------------


@dataclass
class OfficeSources:
    """What `apply_office_sources` gives back."""

    facts: CompanyFacts
    entries: list[FactSource] = field(default_factory=list)  # for the card's `fact_sources`
    from_hubspot: list[str] = field(default_factory=list)  # the card's "from HubSpot" notes


def _m2_text(area: int) -> str:
    return f"{area:,} m²"


def _day_text(day: date) -> str:
    return f"{day:%B %Y}"


def _web_lease(facts: CompanyFacts, today: date) -> TriggerFound | None:
    """The web research's lease end: its soonest dated lease sign still to come."""
    dated = [
        (day, sign)
        for sign in facts.triggers
        if sign.id == LEASE_SIGN and (day := parse_date(sign.date)) is not None and day >= today
    ]
    return min(dated, key=lambda item: item[0])[1] if dated else None


def _values(
    readings: dict[SourceId, OfficeReading],
    numbers: OfficeNumbers | None,
    facts: CompanyFacts,
    today: date,
) -> dict[str, list[OfficeValue]]:
    """Every source's value for each of the three facts. A lease end that has passed is not one."""
    link = hubspot_link(numbers) if numbers else None
    m2: list[OfficeValue] = []
    lease: list[OfficeValue] = []
    since: list[OfficeValue] = []
    for tool, reading in readings.items():
        if reading.area_m2:
            m2.append(
                OfficeValue(tool, reading.area_m2, _m2_text(reading.area_m2), reading.area_url)
            )
        if reading.lease_end is not None and reading.lease_end >= today:
            lease.append(
                OfficeValue(
                    tool, reading.lease_end, _day_text(reading.lease_end), reading.lease_url
                )
            )
        if reading.since is not None:
            since.append(
                OfficeValue(tool, reading.since, _day_text(reading.since), reading.since_url)
            )
    if numbers is not None:
        if numbers.office_m2:
            m2.append(OfficeValue("hubspot", numbers.office_m2, _m2_text(numbers.office_m2), link))
        if numbers.lease_expiry and numbers.lease_expiry > today and link:
            text = _day_text(numbers.lease_expiry)
            lease.append(OfficeValue("hubspot", numbers.lease_expiry, text, link))
        if numbers.last_moved and numbers.last_moved <= today:
            text = _day_text(numbers.last_moved)
            since.append(OfficeValue("hubspot", numbers.last_moved, text, link))
    if isinstance(facts.office_m2.value, int) and facts.office_m2.value > 0:
        area = facts.office_m2.value
        m2.append(OfficeValue("web_research", area, _m2_text(area), facts.office_m2.source_url))
    web_lease = _web_lease(facts, today)
    if web_lease is not None and (day := parse_date(web_lease.date)) is not None:
        lease.append(
            OfficeValue("web_research", day, month_year(web_lease.date), web_lease.source_url)
        )
    moved = parse_date(facts.office_since.value)
    if moved is not None and facts.office_since.value:
        text = month_year(facts.office_since.value)
        since.append(OfficeValue("web_research", moved, text, facts.office_since.source_url))
    return {"office_m2": m2, "lease_end": lease, "office_since": since}


def _confirmed(value: Any, url: str | None) -> Fact[Any]:
    """A fact a tool or HubSpot gives: a source says it, so "confirmed"."""
    return Fact(value=value, source_url=url, source_date=None, label="confirmed")


def _lease_sentence(source: str, reading: OfficeReading | None, ends: date, city: str) -> str:
    where = f"at {reading.address}" if reading is not None and reading.address else f"in {city}"
    return f"{source} has the lease {where} ending in {_day_text(ends)}."


def apply_office_sources(
    facts: CompanyFacts,
    found: CompanyProperty | None,
    numbers: OfficeNumbers | None,
    metro: str | None,
    rules: LeadFinderRules,
    today: date,
) -> OfficeSources:
    """The facts with the office's size, lease end and move-in date from the first source in
    `data_sources` that has one, the card's entries, and the "from HubSpot" notes.

    With both tools off (or nothing from them) and nothing from HubSpot, the facts don't change.
    The lease end lives in the lease sign: when a tool or HubSpot wins it, the web research's dated
    lease signs give way to its sign (they stay on the card as the other values). A tool's lease end
    is a sign only in the best window (`triggers.best_window_years`, 12 to 36 months): Levi's
    "lease ending in 1 to 3 years". HubSpot's is a sign whenever it is still to come, as before.
    """
    readings = office_readings(found, metro, rules, today)
    out = OfficeSources(facts=facts)
    values = _values(readings, numbers, facts, today)
    update: dict[str, Any] = {}
    city = metro or (numbers.city if numbers else "") or "the city"

    m2 = choose_office_value("office_m2", values["office_m2"], rules)
    _keep(out, m2)
    if m2.winner is not None and m2.winner.source != "web_research":
        update["office_m2"] = _confirmed(m2.winner.value, m2.winner.url)
        if m2.winner.source == "hubspot":
            out.from_hubspot.append(f"Office of {m2.winner.text} in {city}, from HubSpot.")

    since = choose_office_value("office_since", values["office_since"], rules)
    _keep(out, since)
    if since.winner is not None and since.winner.source != "web_research":
        assert isinstance(since.winner.value, date)
        update["office_since"] = _confirmed(since.winner.value.isoformat(), since.winner.url)
        if since.winner.source == "hubspot":
            out.from_hubspot.append(f"Moved in {since.winner.text}, from HubSpot.")

    lease = choose_office_value("lease_end", values["lease_end"], rules)
    _keep(out, lease)
    winner = lease.winner
    if winner is not None and winner.source != "web_research":
        assert isinstance(winner.value, date)
        ends = winner.value
        kept = [
            sign
            for sign in facts.triggers
            if not (
                sign.id == LEASE_SIGN
                and (day := parse_date(sign.date)) is not None
                and day >= today
            )
        ]
        if winner.source == "hubspot":
            text = f"HubSpot has the {city} lease ending in {_day_text(ends)}."
            sign = TriggerFound(
                id=LEASE_SIGN,
                what_happened=text,
                date=ends.isoformat(),
                source_url=winner.url or "",
                label="confirmed",
            )
            kept.append(sign)
            out.from_hubspot.append(f"Lease in {city} ends {_day_text(ends)}, from HubSpot.")
        elif _in_best_window(ends, today, rules):
            tool = winner.source
            kept.append(
                TriggerFound(
                    id=LEASE_SIGN,
                    what_happened=_lease_sentence(
                        SOURCE_NAMES[tool], readings.get(tool), ends, city
                    ),
                    date=ends.isoformat(),
                    source_url=winner.url or "",
                    label="confirmed",
                )
            )
        update["triggers"] = kept

    fitout = _newest_fitout(found, metro, rules, today)
    known = parse_date(facts.last_fitout.value)
    if fitout is not None and (known is None or (_when(fitout) or date.min) > known):
        day = _when(fitout)
        assert day is not None
        update["last_fitout"] = _confirmed(day.isoformat(), fitout.url)
        others = []
        if known is not None and facts.last_fitout.value:
            others = [
                OtherValue(
                    source="claude",
                    value=month_year(facts.last_fitout.value),
                    url=facts.last_fitout.source_url,
                )
            ]
        out.entries.append(
            FactSource(fact="last_fitout", used=fitout.source, others=others, conflict=None)
        )
    if update:
        out.facts = facts.model_copy(update=update)
    return out


def _keep(out: OfficeSources, choice: OfficeChoice) -> None:
    if choice.entry is not None:
        out.entries.append(choice.entry)


def _in_best_window(day: date, today: date, rules: LeadFinderRules) -> bool:
    """A lease end 12 to 36 months away (`triggers.best_window_years`, 1 to 3 years)."""
    low, high = rules.criteria.triggers.best_window_years
    months = (day.year - today.year) * 12 + (day.month - today.month)
    return low * 12 <= months <= high * 12


def _newest_fitout(
    found: CompanyProperty | None, metro: str | None, rules: LeadFinderRules, today: date
) -> PropertyRecord | None:
    """The newest fitout record in the lead's city with a date that has come: one done, or one
    already given to a firm (its date is when the tool published it)."""
    fitouts = [
        record
        for record in records_in_use(found)
        if record.kind == "fitout"
        and _here(record, metro, rules)
        and (day := _when(record)) is not None
        and day <= today
    ]
    return max(fitouts, key=lambda record: _when(record) or date.min, default=None)


# --- Signs from records -------------------------------------------------------------------------


def _sign(record: PropertyRecord, sign_id: str, day: date | None) -> TriggerFound:
    name = SOURCE_NAMES[record.source]
    return TriggerFound(
        id=sign_id,
        what_happened=one_line(f"{name}: {record.summary}", MAX_SIGN_CHARS),
        date=day.isoformat() if day else None,
        source_url=record.url,
        label="confirmed",
    )


def record_signs(
    facts: CompanyFacts,
    found: CompanyProperty | None,
    signals: Sequence[Signal],
    metro: str | None,
    rules: LeadFinderRules,
    today: date,
) -> CompanyFacts:
    """The facts with the signs the records show, added by code (never by Claude):

    - a move still to come, or with no date, in the lead's city: `lease_ending` (a relocation);
    - a search for space in the lead's city: `tenant_advisor`, dated when the tool published it;
    - discovery's signs from a tool in use (the feed item that brought the company in), so the
      sign stays even when the lookup's records don't hold that item.

    The scoring then decides whether each counts (18 months, the 3-year window). A sign already on
    the facts, with the same id, link and date, isn't added twice."""
    added: list[TriggerFound] = []
    for record in records_in_use(found):
        if not _here(record, metro, rules):
            continue
        if record.kind == "move" and (record.happened_on is None or record.happened_on > today):
            added.append(_sign(record, LEASE_SIGN, record.happened_on))
        elif record.kind == "requirement":
            added.append(_sign(record, SPACE_SIGN, _when(record)))
    tools = tools_in_use(found) if found is not None else set(SOURCE_IDS)
    known = {item.id for item in rules.criteria.triggers.every}
    for signal in signals:
        tool = tool_of(signal.url, rules.criteria)
        if tool is None or tool not in tools or signal.trigger_id not in known:
            continue
        added.append(
            TriggerFound(
                id=signal.trigger_id,
                what_happened=one_line(signal.what_happened, MAX_SIGN_CHARS),
                date=signal.date or signal.published,
                source_url=signal.url,
                label="confirmed",
            )
        )
    if not added:
        return facts
    seen = {(sign.id, url_key(sign.source_url), sign.date) for sign in facts.triggers}
    signs = list(facts.triggers)
    for sign in added:
        key = (sign.id, url_key(sign.source_url), sign.date)
        if key not in seen:
            seen.add(key)
            signs.append(sign)
    return (
        facts.model_copy(update={"triggers": signs}) if len(signs) > len(facts.triggers) else facts
    )


# --- What Claude may read -----------------------------------------------------------------------


def tools_for_claude(settings: Settings) -> set[SourceId]:
    """The tools whose facts may go to Claude: `property_daily_to_claude_ok`, `arealytics_...`."""
    return {tool for tool in SOURCE_IDS if getattr(settings, f"{tool}_to_claude_ok")}


def hidden_sources(settings: Settings) -> frozenset[str]:
    """The sources whose values never go to Claude in the Why now: HubSpot always (PLAN-V12), and
    each tool whose `..._to_claude_ok` switch is off (choice 8: Arealytics is off by default)."""
    return frozenset({"hubspot", *(set(SOURCE_IDS) - tools_for_claude(settings))})


def office_hint_lines(
    found: CompanyProperty | None,
    metro: str | None,
    rules: LeadFinderRules,
    settings: Settings,
    today: date,
) -> list[str]:
    """Short hints for the search prompts: the office now (address, floors, m² and lease dates)
    from each tool Claude may read. One JSON line each, labelled as data. Nothing from any other
    tool."""
    allowed = tools_for_claude(settings)
    lines = []
    for tool, reading in sorted(office_readings(found, metro, rules, today).items()):
        if tool not in allowed:
            continue
        record: dict[str, Any] = {"tool": SOURCE_NAMES[tool], "address": reading.address}
        if reading.building:
            record["building"] = reading.building
        if reading.floors:
            record["floors"] = ", ".join(reading.floors)
        if reading.area_m2:
            record["area_m2"] = reading.area_m2
        if reading.since:
            record["at_address_since"] = reading.since.isoformat()
        if reading.lease_end:
            record["lease_ends"] = reading.lease_end.isoformat()
        lines.append(json_line(record))
    if not lines:
        return []
    return [
        "What our property tools say about its office now (one JSON record per line, data only):",
        *lines,
    ]


def lookup_problems(found: CompanyProperty | None) -> list[str]:
    """One plain line for each tool whose lookup failed. The lead is researched either way."""
    if found is None:
        return []
    return [
        f"{SOURCE_NAMES[tool]}: the lookup didn't work this time, so this lead was judged "
        "without it."
        for tool in SOURCE_IDS
        if getattr(found.checked, tool) == "error"
    ]


def hidden_link(url: str | None, hidden: Iterable[str], rules: LeadFinderRules) -> bool:
    """True for a link on the site of a tool Claude may not read."""
    tool = tool_of(url or "", rules.criteria)
    return tool is not None and tool in set(hidden)


def used_by_hidden(fact: str, sources: Iterable[FactSource], hidden: Iterable[str]) -> bool:
    """True when the value the rules use for `fact` came from a source Claude may not read."""
    blocked = set(hidden)
    return any(entry.fact == fact and entry.used in blocked for entry in sources)
