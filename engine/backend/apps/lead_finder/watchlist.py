"""The HubSpot watchlist: which companies already in HubSpot are worth watching for a trigger.

`build_watchlist` is pure code: plain rows in, lists and counts out, with no database and no
AI inside. A thin loader (`load_watchlist_rows`) reads the rows from the local HubSpot copy.
The rules are in rules/watchlist.yaml and criteria.yaml. The golden test builds the rows
straight from the export file and expects the lists in projects/leads/research/EXPORT.md.

How one company is sorted, in this order (the first rule that fits wins):

1. It has an open deal (any deal that is not Dissolved, or has no stage): left out,
   `open_deal`. A dissolved deal doesn't leave the company out. It adds a note.
2. It has no name (the "(no name on record)" placeholder): left out, counted as `no_office`.
3. It has no office in a counted city: left out, `no_office`.
4. None of its offices in a counted city has a LinkedIn staff number: the staff is unknown.
   Left out, counted in `dropped_small` and `staff_unknown`, and listed in `staff_unknown`.
   The Employees column is never used instead: it is often the whole company.
5. Estimated staff = the largest LinkedIn staff of its offices in the counted cities times
   `size.linkedin_staff_multiplier`.
6. A Director industry (hospitals, law firms, banks...) goes on the Director list when the
   estimate reaches `staff_min`. `staff_max` doesn't apply to it unless the rules say so
   (`staff.staff_max_applies_to_director`). Too small: `dropped_small`.
7. Every other company goes on the Watch list when the estimate is from `staff_min` to
   `staff_max`. Outside that range: `dropped_small`. That count is also where a company over
   `staff_max` lands, because the contract has no separate count for it.

The city of an office (its "metro city") is its label when that is one of Melbourne, Adelaide,
Perth, Sydney or Brisbane. Otherwise it is the city found in the office's own city text, and
then the state of its postcode. An office that gives no city is ignored. The company's own
City, State and Country columns are never read: they hold a suburb, a mix of spellings or
nothing, and a test proves they don't change the result.
"""

import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.rules import LeadFinderRules, industry_name_key
from apps.lead_finder.schemas import OfficeBased, WatchCounts, WatchItem, WatchlistOut
from apps.lead_finder.scoring import city_of
from core.hubspot.importer import HubSpotExport, state_from_postcode
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice

PLACEHOLDER_NAME = "(no name on record)"  # what HubSpot shows for a company without a name
DISSOLVED = "dissolved"
NOTE_DISSOLVED = "Dissolved deal"
NOTE_INDUSTRY_UNKNOWN = "Industry unknown"

# An office whose label is one of these is in that city.
METRO_CITIES = ("Melbourne", "Adelaide", "Perth", "Sydney", "Brisbane")
# The big city of a state, for an office that has only a postcode. Tasmania, the Northern
# Territory and the ACT have none of the cities above, so those offices are ignored.
STATE_CITY = {
    "VIC": "Melbourne",
    "SA": "Adelaide",
    "WA": "Perth",
    "NSW": "Sydney",
    "QLD": "Brisbane",
}

_fold = industry_name_key  # lower case, one space between words
_METRO_BY_KEY = {_fold(name): name for name in METRO_CITIES}
_POSTCODE = re.compile(r"\d{3,4}")  # Excel can drop the leading zero of 0828


# --- The rows the function reads --------------------------------------------------------


@dataclass(frozen=True)
class WatchOffice:
    label: str
    city: str | None = None
    postal_code: str | None = None
    linkedin_staff: int | None = None


@dataclass(frozen=True)
class WatchDeal:
    stage: str | None
    close_date: date | None = None


@dataclass(frozen=True)
class HubSpotRow:
    """One HubSpot company with its offices and deals. Only what the watchlist reads.

    It has no City, State, Country or Employees on purpose: they are never used.
    """

    hubspot_id: str
    name: str
    industry: str | None = None
    owner: str | None = None
    domain: str | None = None
    offices: tuple[WatchOffice, ...] = ()
    deals: tuple[WatchDeal, ...] = ()


@dataclass(frozen=True)
class WatchResult:
    """The answer of `build_watchlist`.

    `counts` always describes the whole export, whatever `include_unlikely` and
    `include_director` were. Those two only choose what is listed.
    """

    items: list[WatchItem]  # the Watch list, likely first
    director: list[WatchItem]  # the Director list. Empty unless include_director was True
    staff_unknown: list[WatchItem]  # dropped for no staff number
    counts: WatchCounts
    open_deal_names: list[str]  # left out for an open deal, sorted by name
    domains: dict[str, str | None] = field(default_factory=dict)  # hubspot_id -> website domain

    @property
    def candidates(self) -> list[WatchItem]:
        """Who a watchlist run researches: the Watch list, then the Director list if asked."""
        return [*self.items, *self.director]


# --- Rows from the export or the database -----------------------------------------------


def rows_from_export(export: HubSpotExport) -> list[HubSpotRow]:
    """Plain rows from a parsed export file. The golden test uses this."""
    offices: dict[str, list[WatchOffice]] = defaultdict(list)
    for office in export.offices:
        offices[office.hubspot_company_id].append(
            WatchOffice(office.label, office.city, office.postal_code, office.linkedin_staff)
        )
    deals: dict[str, list[WatchDeal]] = defaultdict(list)
    for deal in export.deals:
        deals[deal.hubspot_company_id].append(WatchDeal(deal.stage, deal.close_date))
    return [
        HubSpotRow(
            hubspot_id=company.hubspot_id,
            name=company.name,
            industry=company.industry,
            owner=company.owner,
            domain=company.domain,
            offices=tuple(offices[company.hubspot_id]),
            deals=tuple(deals[company.hubspot_id]),
        )
        for company in export.companies
    ]


async def load_watchlist_rows(session: AsyncSession) -> list[HubSpotRow]:
    """Every HubSpot company in the local copy, with its offices and deals."""
    offices: dict[str, list[WatchOffice]] = defaultdict(list)
    office_query = select(
        HubSpotOffice.hubspot_company_id,
        HubSpotOffice.label,
        HubSpotOffice.city,
        HubSpotOffice.postal_code,
        HubSpotOffice.linkedin_staff,
    ).order_by(HubSpotOffice.hubspot_company_id, HubSpotOffice.id)
    for company_id, label, city, postal_code, staff in await session.execute(office_query):
        offices[company_id].append(WatchOffice(label, city, postal_code, staff))

    deals: dict[str, list[WatchDeal]] = defaultdict(list)
    deal_query = select(
        HubSpotDeal.hubspot_company_id, HubSpotDeal.stage, HubSpotDeal.close_date
    ).order_by(HubSpotDeal.hubspot_company_id, HubSpotDeal.hubspot_deal_id)
    for company_id, stage, close_date in await session.execute(deal_query):
        deals[company_id].append(WatchDeal(stage, close_date))

    company_query = select(
        HubSpotCompany.hubspot_id,
        HubSpotCompany.name,
        HubSpotCompany.industry,
        HubSpotCompany.owner,
        HubSpotCompany.domain,
    ).order_by(HubSpotCompany.hubspot_id)
    return [
        HubSpotRow(
            hubspot_id=hubspot_id,
            name=name,
            industry=industry,
            owner=owner,
            domain=domain,
            offices=tuple(offices[hubspot_id]),
            deals=tuple(deals[hubspot_id]),
        )
        for hubspot_id, name, industry, owner, domain in await session.execute(company_query)
    ]


# --- The function -----------------------------------------------------------------------


def metro_city(office: WatchOffice, rules: LeadFinderRules) -> str | None:
    """The city an office is in: its label, else its own city text, else its postcode's state.

    None when the office gives no city we know (the office is then ignored).
    """
    by_label = _METRO_BY_KEY.get(_fold(office.label))
    if by_label:
        return by_label
    if office.city:
        by_text = city_of(office.city, rules)
        if by_text:
            return by_text
    code = (office.postal_code or "").strip()
    if _POSTCODE.fullmatch(code):
        state = state_from_postcode(int(code))
        return STATE_CITY.get(state) if state else None
    return None


def _id_number(hubspot_id: str) -> int:
    return int(hubspot_id) if hubspot_id.isdecimal() else 0


def _watch_key(item: WatchItem) -> tuple[bool, str, int, int, str]:
    """Likely first, then by city, the biggest first, then the newest record first."""
    return (
        item.office_based != "likely",
        *_director_key(item),
    )


def _director_key(item: WatchItem) -> tuple[str, int, int, str]:
    return (
        item.city or "",
        -(item.linkedin_staff or 0),
        -_id_number(item.hubspot_id),
        item.hubspot_id,
    )


def _industry_groups(rules: LeadFinderRules) -> tuple[set[str], set[str]]:
    """The industry names of the Director groups and of the not-office-based groups."""
    watchlist = rules.watchlist
    director = {
        industry_name_key(name)
        for names in watchlist.director_industries.values()
        for name in names
    }
    unlikely = {
        industry_name_key(name) for names in watchlist.not_office_based.values() for name in names
    }
    return director, unlikely


def build_watchlist(
    rows: Iterable[HubSpotRow],
    rules: LeadFinderRules,
    *,
    include_unlikely: bool = True,
    include_director: bool = False,
) -> WatchResult:
    """Sorts every HubSpot company onto the Watch list, the Director list or a reason to leave
    it out. See the top of this file for the order of the rules.

    `include_unlikely=False` leaves the not-office-based companies out of `items`.
    `include_director=True` fills `director` (it stays empty otherwise). The counts don't change.
    A company id that appears twice is read once: the first row wins.
    """
    size = rules.criteria.size
    watchlist = rules.watchlist
    director_names, unlikely_names = _industry_groups(rules)
    city_rank = {city: rank for rank, city in enumerate(watchlist.count_cities)}

    watch: list[WatchItem] = []
    director: list[WatchItem] = []
    unknown: list[WatchItem] = []
    open_deal_names: list[str] = []
    domains: dict[str, str | None] = {}
    companies = no_office = dropped_small = 0
    seen: set[str] = set()

    for row in rows:
        if row.hubspot_id in seen:
            continue
        seen.add(row.hubspot_id)
        companies += 1

        if any(_is_open(deal) for deal in row.deals):
            open_deal_names.append(row.name)
            continue
        if _fold(row.name) == _fold(PLACEHOLDER_NAME):
            no_office += 1  # no name, so nothing to research and nothing to show
            continue

        # The offices in a counted city, each with its city. The biggest one gives the staff.
        counted = [
            (city, office)
            for office in row.offices
            if (city := metro_city(office, rules)) in city_rank
        ]
        if not counted:
            no_office += 1
            continue
        key = _fold(row.industry or "")
        based: OfficeBased = "unlikely" if key in unlikely_names else "likely"
        with_staff = [(c, o) for c, o in counted if o.linkedin_staff is not None]
        if not with_staff:
            first_city = min((city for city, _ in counted), key=lambda c: city_rank[c])
            unknown.append(_item(row, first_city, None, None, based))
            domains[row.hubspot_id] = row.domain
            dropped_small += 1
            continue
        # The most staff wins. A tie goes to the city listed first in count_cities.
        city, biggest = max(
            with_staff,
            key=lambda pair: (pair[1].linkedin_staff or 0, -city_rank[pair[0]]),
        )
        staff = biggest.linkedin_staff or 0
        estimated = round(staff * size.linkedin_staff_multiplier)

        is_director = key in director_names
        too_big = estimated > size.staff_max and (
            not is_director or watchlist.staff.staff_max_applies_to_director
        )
        if estimated < size.staff_min or too_big:
            dropped_small += 1
            continue
        domains[row.hubspot_id] = row.domain
        (director if is_director else watch).append(_item(row, city, staff, estimated, based))

    watch.sort(key=_watch_key)
    director.sort(key=_director_key)
    unknown.sort(key=_director_key)
    likely = sum(1 for item in watch if item.office_based == "likely")
    counts = WatchCounts(
        companies=companies,
        watch=len(watch),
        likely=likely,
        unlikely=len(watch) - likely,
        director=len(director),
        open_deal=len(open_deal_names),
        dropped_small=dropped_small,
        staff_unknown=len(unknown),
        no_office=no_office,
    )
    listed = watch if include_unlikely else [i for i in watch if i.office_based == "likely"]
    return WatchResult(
        items=listed,
        director=director if include_director else [],
        staff_unknown=unknown,
        counts=counts,
        open_deal_names=sorted(open_deal_names, key=lambda name: (name.casefold(), name)),
        domains=domains,
    )


def _is_open(deal: WatchDeal) -> bool:
    """A deal is open unless its stage says Dissolved. A deal with no stage counts as open."""
    return (deal.stage or "").strip().casefold() != DISSOLVED


def _notes(row: HubSpotRow) -> str | None:
    notes: list[str] = []
    if row.deals:  # an open deal never gets here, so these are all dissolved
        notes.append(NOTE_DISSOLVED)
    if not (row.industry or "").strip():
        notes.append(NOTE_INDUSTRY_UNKNOWN)
    return "; ".join(notes) or None


def _item(
    row: HubSpotRow,
    city: str,
    staff: int | None,
    estimated: int | None,
    office_based: OfficeBased,
) -> WatchItem:
    dissolved = [deal.close_date for deal in row.deals if deal.close_date is not None]
    return WatchItem(
        hubspot_id=row.hubspot_id,
        name=row.name,
        city=city,
        industry=(row.industry or "").strip() or None,
        office_based=office_based,
        linkedin_staff=staff,
        estimated_staff=estimated,
        owner=row.owner,
        last_dissolved=max(dissolved) if dissolved else None,
        note=_notes(row),
    )


# --- For the route ----------------------------------------------------------------------


def watchlist_out(result: WatchResult, *, limit: int | None = None) -> WatchlistOut:
    """The answer of GET /watchlist. `total` is the size of the list before `limit`."""
    items = result.items if limit is None else result.items[:limit]
    return WatchlistOut(
        total=len(result.items),
        items=items,
        director=result.director,
        staff_unknown=result.staff_unknown,
        counts=result.counts,
    )


async def load_watchlist(
    session: AsyncSession,
    rules: LeadFinderRules,
    *,
    include_unlikely: bool = True,
    include_director: bool = False,
    limit: int | None = None,
) -> WatchlistOut:
    """Reads the local HubSpot copy and returns the preview. Nothing goes to Claude."""
    rows = await load_watchlist_rows(session)
    result = build_watchlist(
        rows, rules, include_unlikely=include_unlikely, include_director=include_director
    )
    return watchlist_out(result, limit=limit)


__all__ = [
    "HubSpotRow",
    "WatchDeal",
    "WatchOffice",
    "WatchResult",
    "build_watchlist",
    "load_watchlist",
    "load_watchlist_rows",
    "metro_city",
    "rows_from_export",
    "watchlist_out",
]
