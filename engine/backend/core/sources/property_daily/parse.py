"""Turns Property Daily's pages into `PropertyRecord`s (PLAN-V16 T2-5). Pure: no browser, no
database, and the same page always gives the same records.

What we keep from a page: the company, its city, its offices (floor, building, street, suburb,
m², lease expiry), the m² it wants, the firms appointed (a tenant advisor, an interior designer),
the dates, and the link. Every record's `summary` is written here, from those facts: no text is
copied from the page. Names of people, emails and phone numbers are never read into a record.

The pages are plain server pages (mapped in `tools/propertydaily.md`). They are read as text, by
their labels ("Lease Expiry:", "Requirements"), which last longer than a layout: a layout change
that moves a label is a fix here, and the tests use made-up pages shaped like the real ones.
"""

import calendar
import hashlib
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from html import unescape
from html.parser import HTMLParser
from typing import Final

from core.hubspot.matching import clean_name
from core.sources.types import PropertyRecord, RecordKind

HOST: Final = "https://www.spatialgroup.com.au"
REPORT_URL: Final = HOST + "/cgi-bin/report.cgi?id={id}"
LEASE_URL: Final = HOST + "/cgi-bin/lease_expiry_news.cgi/report?id={id}"

MONTHS: Final = {name.lower(): number for number, name in enumerate(calendar.month_name) if name}
_DAY_DATE = re.compile(r"\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b")
_MONTH_DATE = re.compile(r"\b([A-Za-z]+)\s+(\d{4})\b")
_AREA = re.compile(r"([\d,]+(?:\.\d+)?)\s*sqm", re.IGNORECASE)
_RANGE = re.compile(r"([\d,]+)\s*(?:-|to)\s*([\d,]+)\s*sqm", re.IGNORECASE)
_SUBURB_LINE = re.compile(
    r"^(?P<suburb>[A-Z][A-Z' .&-]+),?\s+(?P<state>NSW|VIC|QLD|WA|SA|ACT|TAS|NT),?\s+"
    r"(?P<postcode>\d{4})$"
)
_FLOOR = re.compile(
    r"^(?:part\s+)?(?:levels?|ground|floor|suite|mezzanine|basement|lower ground|upper ground)\b",
    re.IGNORECASE,
)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?:\+?61|\(0\d\)|\b0\d)[\d ()-]{7,}\d")
NOT_YET = ("not yet", "not appointed", "tba", "n/a")

# The capital city of each state, for a place that isn't one of the regional cities below.
STATE_CITY: Final = {
    "NSW": "Sydney",
    "VIC": "Melbourne",
    "QLD": "Brisbane",
    "WA": "Perth",
    "SA": "Adelaide",
    "ACT": "Canberra",
    "TAS": "Hobart",
    "NT": "Darwin",
}
# Regional cities in the Lead Finder's list (PLAN-V16 T1-2), by postcode (TBC: the ranges are the
# usual ones for each city's area).
REGIONAL_POSTCODES: Final = (
    ("Gold Coast", 4207, 4229),
    ("Sunshine Coast", 4550, 4575),
    ("Newcastle", 2280, 2310),
    ("Wollongong", 2500, 2530),
    ("Geelong", 3211, 3227),
    ("Townsville", 4810, 4818),
    ("Cairns", 4865, 4879),
    ("Toowoomba", 4350, 4352),
    ("Ballarat", 3350, 3356),
    ("Bendigo", 3550, 3556),
    ("Launceston", 7248, 7250),
    ("Mackay", 4740, 4741),
)


# --- Pages as text ---------------------------------------------------------------------------

BLOCK_TAGS: Final = frozenset(
    {"br", "p", "div", "tr", "table", "tbody", "li", "ul", "h1", "h2", "h3", "h4", "title"}
)
CELL_TAGS: Final = frozenset({"td", "th"})


class _PageText(HTMLParser):
    """The visible text of a page, with line breaks where blocks end and a tab between cells. Also
    the table rows (each cell's text and the links in the row), and the item anchors of the daily
    email (`<a name="summary_item_123">`), as markers in the text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.rows: list[Row] = []
        self._row: Row | None = None
        self._cell: list[str] | None = None
        self._skip = 0  # inside <script> or <style>

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "a" and (values.get("name") or "").startswith("summary_item_"):
            self.parts.append(f"\n\x00ITEM {(values.get('name') or '')[13:]}\x00\n")
        elif tag == "a" and values.get("href") and self._row is not None:
            self._row.links.append(values["href"] or "")
        if tag == "tr":
            self._row = Row()
            self.rows.append(self._row)
        elif tag in CELL_TAGS:
            self._cell = []
            self.parts.append("\n")  # each cell on its own line
        elif tag in BLOCK_TAGS:
            self._newline()

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in CELL_TAGS and self._cell is not None and self._row is not None:
            self._row.cells.append(_tidy_lines("".join(self._cell)))
            self._cell = None
        elif tag == "tr":
            self._row = None
            self._newline()
        elif tag in BLOCK_TAGS:
            self._newline()

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        data = data.replace("\r", " ").replace("\n", " ")  # a break in the source is a space
        self.parts.append(data)
        if self._cell is not None:
            self._cell.append(data)

    def _newline(self) -> None:
        self.parts.append("\n")
        if self._cell is not None:
            self._cell.append("\n")


@dataclass
class Row:
    cells: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)


def _tidy_lines(text: str) -> str:
    lines = (re.sub(r"[ \t\xa0]+", " ", line).strip() for line in unescape(text).splitlines())
    return "\n".join(line for line in lines if line)


def read_page(html: str) -> tuple[str, list[Row]]:
    """The page's text (tidy lines) and its table rows."""
    parser = _PageText()
    parser.feed(html)
    parser.close()
    return _tidy_lines("".join(parser.parts)), parser.rows


# --- Small readers ---------------------------------------------------------------------------


def read_date(text: str | None, *, month_end: bool = False) -> date | None:
    """ "29 February 2028" or "March 2008". A month alone is its last day for an expiry
    (`month_end`), else its first."""
    if not text:
        return None
    for found in _DAY_DATE.finditer(text):
        if found.group(2).lower() in MONTHS:
            day, month = int(found.group(1)), MONTHS[found.group(2).lower()]
            try:
                return date(int(found.group(3)), month, day)
            except ValueError:
                return None
    for found in _MONTH_DATE.finditer(text):
        if found.group(1).lower() in MONTHS:
            month, year = MONTHS[found.group(1).lower()], int(found.group(2))
            day = calendar.monthrange(year, month)[1] if month_end else 1
            return date(year, month, day)
    return None


def read_area(text: str | None) -> int | None:
    """The biggest m² in the text: "2,800 - 3,300sqm" gives 3,300."""
    if not text:
        return None
    ranged = _RANGE.search(text)
    if ranged:
        return round(float(ranged.group(2).replace(",", "")))
    single = _AREA.search(text)
    return round(float(single.group(1).replace(",", ""))) if single else None


def city_of(state: str | None, postcode: str | None) -> str | None:
    if postcode and postcode.isdigit():
        number = int(postcode)
        for city, low, high in REGIONAL_POSTCODES:
            if low <= number <= high:
                return city
    return STATE_CITY.get((state or "").upper())


def market_city(market: str | None) -> str | None:
    """ "SYDNEY" gives "Sydney", "GOLD COAST" gives "Gold Coast"."""
    words = (market or "").strip()
    if not words or len(words) > 40:
        return None
    return " ".join(part.capitalize() for part in words.split())


def scrub(text: str) -> str:
    """No email address or phone number survives."""
    return _PHONE.sub("", _EMAIL.sub("", text)).strip()


@dataclass(frozen=True)
class Place:
    floor: str | None
    building: str | None
    street: str | None
    suburb: str | None
    state: str | None
    postcode: str | None
    area_m2: int | None
    lease_end: date | None

    @property
    def address(self) -> str | None:
        where = " ".join(part for part in (self.suburb, self.state, self.postcode) if part)
        joined = ", ".join(part for part in (self.street, where) if part)
        return joined or None

    @property
    def city(self) -> str | None:
        return city_of(self.state, self.postcode)


def read_place(lines: list[str]) -> Place:
    """An office from its lines: "Level 5, (3,289sqm),", "The Bay Centre,", "65 Pirrama Road,",
    "PYRMONT, NSW, 2009", then "Lease Expiry:" and its date (or "(Lease Expiry: ...)")."""
    floor = building = street = suburb = state = postcode = None
    area: int | None = None
    lease_end: date | None = None
    rest: list[str] = []
    for index, raw in enumerate(lines):
        line = raw.strip().rstrip(",").strip()
        if not line:
            continue
        if "lease expiry" in line.lower():
            after = line.split(":", 1)[1] if ":" in line else ""
            target = after if read_date(after) else " ".join(lines[index + 1 : index + 2])
            lease_end = read_date(target, month_end=True)
            break
        suburb_line = _SUBURB_LINE.match(line.replace(" ,", ","))  # "PYRMONT, NSW, 2009"
        if suburb_line:
            suburb = suburb_line.group("suburb").strip().title()
            state, postcode = suburb_line.group("state"), suburb_line.group("postcode")
            continue
        if area is None and _AREA.search(line):
            area = read_area(line)
            before = line.split("(")[0].strip().rstrip(",").strip()
            floor = before or floor
            continue
        if floor is None and _FLOOR.match(line):
            floor = line
            continue
        rest.append(line)
    for line in rest:
        if street is None and re.match(r"^(?:\d|[A-Z]?\d+[A-Za-z]?\s|Lot \d|Unit \d)", line):
            street = line
        elif building is None and street is None:
            building = line
    return Place(floor, building, street, suburb, state, postcode, area, lease_end)


def record_key(*parts: object) -> str:
    """A hash of the facts that say which record it is, so a fact read twice is saved once."""
    text = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(text.encode()).hexdigest()


# --- What the parsers give back ---------------------------------------------------------------


@dataclass(frozen=True)
class Parsed:
    """One record and the meta the store keeps beside it."""

    record: PropertyRecord
    ref: str
    key: str


def _record(
    *,
    kind: RecordKind,
    company: str,
    city: str | None,
    place: Place | None,
    url: str,
    read_at: datetime,
    ref: str,
    summary: str,
    area_m2: int | None = None,
    published_on: date | None = None,
    happened_on: date | None = None,
    lease_start: date | None = None,
) -> Parsed:
    record = PropertyRecord(
        source="property_daily",
        kind=kind,
        company=company,
        city=city or (place.city if place else None),
        address=place.address if place else None,
        building=place.building if place else None,
        floor=place.floor if place else None,
        area_m2=area_m2 if area_m2 is not None else (place.area_m2 if place else None),
        lease_start=lease_start,
        lease_end=place.lease_end if place and kind == "lease" else None,
        happened_on=happened_on,
        published_on=published_on,
        summary=summary[:500],
        url=url,
        read_at=read_at,
    )
    key = record_key(
        kind,
        clean_name(company),
        record.address,
        record.floor,
        record.area_m2,
        record.lease_end,
        record.lease_start,
        ref if kind in ("requirement", "fitout", "news") else None,
        published_on if kind in ("requirement", "news") else None,
    )
    return Parsed(record, ref, key)


def _m2(area: int | None) -> str:
    return f"{area:,} m²" if area is not None else "an unknown area"


def _lease_summary(company: str, place: Place) -> str:
    where = place.address or "an address not given"
    end = place.lease_end
    ends = f", ending {end.day} {end:%B %Y}" if end else ""
    return f"{company} leases {_m2(place.area_m2)} at {where}{ends}."


# --- The daily email: /main/mailview/pd/<date> --------------------------------------------------


@dataclass(frozen=True)
class Firms:
    """The firms appointed to a company's office project, by role. Firms only, never people."""

    advisor: str | None = None
    designer: str | None = None
    builder: str | None = None

    @property
    def fitout_awarded(self) -> bool:
        return self.designer is not None or self.builder is not None


def read_firms(lines: list[str]) -> Firms:
    """From "Property Adviser:" / "CBRE" pairs. "Previous ..." roles are past projects and are left
    out; "Not yet appointed" is no firm."""
    found: dict[str, str] = {}
    for index, line in enumerate(lines[:-1]):
        if not line.endswith(":") or line.lower().startswith("previous"):
            continue
        role, firm = line[:-1].lower(), lines[index + 1].strip()
        if not firm or firm.endswith(":") or any(word in firm.lower() for word in NOT_YET):
            continue
        if "advis" in role or "advocate" in role or "agent" in role:
            found.setdefault("advisor", firm)
        elif "design" in role and "construct" not in role:
            found.setdefault("designer", firm)
        elif "construct" in role or "fit-out" in role or "fitout" in role or "builder" in role:
            found.setdefault("builder", firm)
    return Firms(found.get("advisor"), found.get("designer"), found.get("builder"))


def label_value(lines: list[str], label: str) -> str | None:
    """The value after a label: "Published 13 November 2026", or the label with its value on the
    next line."""
    for index, line in enumerate(lines):
        if line.lower().startswith(label):
            tail = line[len(label) :].strip(" :\t")
            if tail:
                return tail
            return lines[index + 1] if index + 1 < len(lines) else None
    return None


def _between(lines: list[str], start: str, stops: tuple[str, ...]) -> list[str]:
    """The lines after the first one that starts with `start`, up to one that starts with a stop."""
    out: list[str] = []
    seen = False
    for line in lines:
        lowered = line.lower()
        if not seen:
            if lowered.startswith(start):
                seen = True
                tail = line[len(start) :].strip(" :\t")
                if tail:
                    out.append(tail)
            continue
        if any(lowered.startswith(stop) for stop in stops):
            break
        out.append(line)
    return out


def parse_daily(html: str, *, url: str, read_at: datetime, published_on: date) -> list[Parsed]:
    """Every item of one day's email: what each company wants, its current lease, and a fitout
    already awarded."""
    text, _ = read_page(html)
    chunks = re.split(r"\x00ITEM (\d+)\x00", text)
    out: list[Parsed] = []
    for number in range(1, len(chunks) - 1, 2):
        out += _daily_item(chunks[number], chunks[number + 1], read_at, published_on)
    return out


def _daily_item(report_id: str, text: str, read_at: datetime, published_on: date) -> list[Parsed]:
    lines = [line for line in text.splitlines() if line.strip()]
    head = next((line for line in lines if re.search(r"\S\s+-\s+\S", line)), None)
    if head is None:
        return []
    company, _, headline = (part.strip() for part in head.partition(" - "))
    company = scrub(company)
    if not company:
        return []
    after_head = lines[lines.index(head) + 1 :]
    market = next((line for line in after_head[:3] if line.isupper() and len(line) < 40), None)
    city = market_city(market)
    url = REPORT_URL.format(id=report_id)
    ref = f"report:{report_id}"
    out: list[Parsed] = []
    wanted = _between(after_head, "requirements", ("further details", "active", "potential"))
    area = read_area(" ".join(wanted[:1])) or read_area(headline)
    if wanted or "requirement" in headline.lower():
        out.append(
            _record(
                kind="requirement",
                company=company,
                city=city,
                place=None,
                url=url,
                read_at=read_at,
                ref=ref,
                area_m2=area,
                published_on=published_on,
                summary=f"{company} is looking for {_m2(area)} of office space in "
                f"{city or 'a city not given'}.",
            )
        )
    current = _between(after_head, "current location", ("future", "previous", "click here"))
    if current:
        place = read_place(current)
        if place.address or place.area_m2:
            out.append(
                _record(
                    kind="lease",
                    company=company,
                    city=city,
                    place=place,
                    url=url,
                    read_at=read_at,
                    ref=ref,
                    published_on=published_on,
                    summary=_lease_summary(company, place),
                )
            )
    firms = read_firms(_between(after_head, "appointments", ("requirements", "further details")))
    if firms.fitout_awarded:
        out.append(_fitout(company, city, firms, url, read_at, ref, published_on))
    return out


def _fitout(
    company: str,
    city: str | None,
    firms: Firms,
    url: str,
    read_at: datetime,
    ref: str,
    published_on: date | None,
) -> Parsed:
    who = " and ".join(firm for firm in (firms.designer, firms.builder) if firm)
    return _record(
        kind="fitout",
        company=company,
        city=city,
        place=None,
        url=url,
        read_at=read_at,
        ref=ref,
        published_on=published_on,
        summary=f"{company}'s office fitout in {city or 'a city not given'} is already with {who}.",
    )


# --- A company's report: /cgi-bin/report.cgi?id=<n> ---------------------------------------------


@dataclass(frozen=True)
class Report:
    company: str
    website: str | None
    city: str | None
    records: list[Parsed]


def parse_report(html: str, *, url: str, read_at: datetime) -> Report | None:
    """A company's report: what it wants now, its current, future and past offices, and a fitout
    already awarded. The long history of news items is not copied: its facts are in the offices."""
    text, _ = read_page(html)
    lines = text.splitlines()
    title = lines[0] if lines else ""
    company = scrub(title.partition(" - ")[0]) if " - " in title else ""
    if not company:
        return None
    number = re.search(r"id=(\d+)", url)
    ref = f"report:{number.group(1) if number else url}"
    published_at = next((i for i, line in enumerate(lines) if line.startswith("Published")), None)
    if published_at is None:
        return None
    published_on = read_date(label_value(lines[published_at:], "published"))
    city = market_city(lines[published_at - 1]) if published_at > 0 else None
    panel = lines[published_at:]  # the column with the type, the firms, the m² and the offices
    website = None
    contacts = _between(lines, "key contacts", ("project appointments",))
    for line in contacts:
        if line.lower().startswith("internet:"):
            website = line.split(":", 1)[1].strip() or None
            break
    out: list[Parsed] = []
    wanted = label_value(panel, "requirements")
    if wanted:
        area = read_area(wanted if "sqm" in wanted.lower() else f"{wanted}sqm")
        out.append(
            _record(
                kind="requirement",
                company=company,
                city=city,
                place=None,
                url=url,
                read_at=read_at,
                ref=ref,
                area_m2=area,
                published_on=published_on,
                summary=f"{company} is looking for {_m2(area)} of office space in "
                f"{city or 'a city not given'}.",
            )
        )
    locations = _between(panel, "locations", ("print profile", "request update"))
    for label, block in _location_blocks(locations):
        for place in _places(block):
            if label == "future":
                if place.address or place.area_m2:
                    out.append(
                        _record(
                            kind="move",
                            company=company,
                            city=city,
                            place=place,
                            url=url,
                            read_at=read_at,
                            ref=ref,
                            published_on=published_on,
                            summary=f"{company} is moving to {place.address or 'a new office'}.",
                        )
                    )
                continue
            if place.address or place.area_m2:
                out.append(
                    _record(
                        kind="lease",
                        company=company,
                        city=city if label == "current" else None,
                        place=place,
                        url=url,
                        read_at=read_at,
                        ref=f"{ref}:{label}",
                        summary=_lease_summary(company, place),
                    )
                )
    firms = read_firms(_between(panel, "appointments", ("requirements", "further details")))
    if firms.fitout_awarded:
        out.append(_fitout(company, city, firms, url, read_at, ref, published_on))
    return Report(company, website, city, out)


def _location_blocks(lines: list[str]) -> list[tuple[str, list[str]]]:
    blocks: list[tuple[str, list[str]]] = []
    for line in lines:
        label = line.strip().rstrip(":").lower()
        if label in ("current", "future", "previous"):
            blocks.append((label, []))
        elif blocks:
            blocks[-1][1].append(line)
    return blocks


def _places(lines: list[str]) -> list[Place]:
    """Several offices in a row. Each ends at its lease expiry ("Lease Expiry:" and the date on
    the next line, or "(Lease Expiry: February 2017)"), or where the next one starts (a line with
    m² after a suburb line)."""
    places: list[Place] = []
    current: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if "lease expiry" in line.lower():
            current.append(line)
            inline = ":" in line and read_date(line.split(":", 1)[1])
            if not inline and index + 1 < len(lines) and read_date(lines[index + 1]):
                current.append(lines[index + 1])
                index += 1
            places.append(read_place(current))
            current = []
        else:
            if current and _AREA.search(line) and any(_is_suburb(seen) for seen in current):
                places.append(read_place(current))
                current = []
            current.append(line)
        index += 1
    if current and any(_is_suburb(seen) for seen in current):
        places.append(read_place(current))
    return places


def _is_suburb(line: str) -> bool:
    return _SUBURB_LINE.match(line.strip().rstrip(",").replace(" ,", ",")) is not None


# --- Search results and the lease tables ---------------------------------------------------------


@dataclass(frozen=True)
class Found:
    """One search result: a report of the company's, and the market it is in."""

    report_id: str
    organisation: str
    market: str | None
    published_on: date | None


def parse_search(html: str) -> list[Found]:
    """The rows of a search: Date, Organisation, Category, Description, Markets, ..."""
    _, rows = read_page(html)
    out: list[Found] = []
    for row in rows:
        report = next(
            (m for link in row.links if (m := re.search(r"report\.cgi\?id=(\d+)", link))), None
        )
        if report is None or len(row.cells) < 5:
            continue
        cells = [cell for cell in row.cells]
        published = read_date(cells[0]) or read_date(cells[1])
        names = [cell for cell in cells if cell and not read_date(cell)]
        organisation = scrub(names[0]) if names else ""
        market = next((cell for cell in cells if cell in _MARKETS), None)
        if organisation:
            out.append(Found(report.group(1), organisation, market, published))
    return out


_MARKETS: Final = frozenset(
    {
        "Sydney",
        "Melbourne",
        "Brisbane",
        "Perth",
        "Adelaide",
        "Canberra",
        "Newcastle",
        "Darwin",
        "Hobart",
        "Gold Coast",
        "Wollongong",
    }
)


def parse_leases(html: str, *, read_at: datetime, via_url: str | None = None) -> list[Parsed]:
    """The rows of the lease database: a view ("leases ending soon") or a search by company. Each
    row is one lease: Published, Type, Organisation, Location, Space, Expiry, ..."""
    _, rows = read_page(html)
    out: list[Parsed] = []
    for row in rows:
        lease = next(
            (
                m
                for link in row.links
                if (m := re.search(r"lease_expiry_news\.cgi/report\?id=(\d+)", link))
            ),
            None,
        )
        if lease is None:
            continue
        cells = row.cells
        expiry_index = next(
            (i for i, cell in enumerate(cells) if read_date(cell) and i > 1 and "sqm" not in cell),
            None,
        )
        location_index = next((i for i, cell in enumerate(cells) if _has_suburb(cell)), None)
        if expiry_index is None or location_index is None or location_index < 1:
            continue
        company = (
            scrub(cells[location_index - 1].splitlines()[0]) if cells[location_index - 1] else ""
        )
        if not company:
            continue
        space = next((cell for cell in cells if _AREA.search(cell)), None)
        place = read_place(cells[location_index].splitlines())
        place = Place(
            place.floor,
            place.building,
            place.street,
            place.suburb,
            place.state,
            place.postcode,
            read_area(space) if space else place.area_m2,
            read_date(cells[expiry_index], month_end=True),
        )
        published = read_date(next((cell for cell in cells[:3] if read_date(cell)), None))
        url = LEASE_URL.format(id=lease.group(1))
        out.append(
            _record(
                kind="lease",
                company=company,
                city=None,
                place=place,
                url=url,
                read_at=read_at,
                ref=f"lease:{lease.group(1)}",
                published_on=published,
                summary=_lease_summary(company, place),
            )
        )
    return out


def _has_suburb(cell: str) -> bool:
    return any(_is_suburb(line) for line in cell.splitlines())
