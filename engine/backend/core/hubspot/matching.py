"""Is this company already in HubSpot? The answer is one of: new, in HubSpot, open deal,
dissolved deal, or a possible match that a person confirms.

The checks run in this order and the first that finds the company wins:
1. `hubspot_id`: the watchlist already knows which company it is.
2. The website domain, exactly.
3. The cleaned name, exactly: the name that was asked for first, then the name Claude found.
Then, if none of those found it, three looser checks look for companies that MIGHT be the same.
They never say "it is": they give `possible_match` with up to 3 `candidates`, best first, and a
person decides. Nothing here drops a lead.
4. `name_in_deal`: the name matches the start of a deal's name. Deals are often named after the
   client ("The Reject Shop - Melbourne - New Office"), and the company is saved under another
   name (Dollarama).
5. `close_name`: the names are nearly the same ("Lactalis Mainland Dairy Australia" and
   "Lactalis-Mainland Dairy").
6. `similar_profile`: the company's profile reads like one in memory (profiles.py), and a second
   sign agrees: the same city AND a shared brand word (a core word of 3+ letters that is not an
   industry word, like "lactalis").

Names are compared with two tests together, because each one alone is wrong. A fuzzy score
(`token_set_ratio`) is 100 whenever the words of one name are inside the other, so "Apex" and
"Apex Plumbing" score 100. And a name's generic words (group, holdings, australia, ...) say
nothing about which company it is. So the score must be high AND the core words (the name
without its generic words) must be equal or nearly equal, with at least 3 letters between them.
`partial_ratio` is never used.

Measured on the real export and the real memory model (TBC, re-check on researched profiles):
the profile score alone can't tell the same company from a neighbour. A renamed company scores
0.87 to 0.91 against its own HubSpot profile, but an unrelated one in the same industry and city
scores up to 0.95 (Mineral Resources against MEGA Resources, both Perth miners), because a short
profile with no deals reads like every company of its kind. So the same industry is NOT a second
sign; a shared brand word is.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Literal

from rapidfuzz import fuzz
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.importer import normalize_domain
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.hubspot.profiles import (
    PLACEHOLDER_NAME,
    PROFILE_APP,
    PROFILE_KIND,
    is_placeholder,
    metro_city,
)
from core.memory.service import search_similar

if TYPE_CHECKING:
    from core.memory.embedder import Embedder

DISSOLVED = "dissolved"
LEGAL_WORDS = {"pty", "ltd", "limited", "inc", "incorporated", "llc", "plc", "corp", "corporation"}
# Words that say nothing about WHICH company it is. A name is compared without them.
GENERIC_WORDS = frozenset(
    {
        "australia",
        "australian",
        "aus",
        "group",
        "holdings",
        "holding",
        "services",
        "solutions",
        "international",
        "global",
        "the",
        "and",
        "co",
        "company",
        "pty",
        "ltd",
        "limited",
        "inc",
        "australasia",
    }
)
# Words a deal's name has besides the client: "Office Lease Expiry", "New Office", "Spec Suite".
# A name made only of these (and generic words) never matches a deal.
DEAL_WORDS = frozenset(
    {
        "office",
        "offices",
        "lease",
        "suite",
        "relocation",
        "expiry",
        "deal",
        "new",
        "spec",
        "intel",
        "pd",
        "space",
        "fitout",
        "refurbishment",
    }
)
# Words many companies have in their names because of what they do. Two names that only share
# one of these have not shared a brand ("Mineral Resources" and "MEGA Resources").
INDUSTRY_WORDS = frozenset(
    {
        "advisors",
        "advisory",
        "associates",
        "builders",
        "building",
        "capital",
        "care",
        "civil",
        "construction",
        "consulting",
        "data",
        "design",
        "development",
        "developments",
        "digital",
        "energy",
        "engineering",
        "engineers",
        "enterprises",
        "estate",
        "finance",
        "financial",
        "foods",
        "foundation",
        "health",
        "healthcare",
        "homes",
        "industries",
        "insurance",
        "legal",
        "logistics",
        "management",
        "media",
        "medical",
        "mining",
        "network",
        "networks",
        "partners",
        "power",
        "property",
        "resources",
        "software",
        "systems",
        "tech",
        "technologies",
        "technology",
        "trust",
    }
)
# City names and codes that end the client's name in a deal name ("Kyndryl MEL 787m2 Office").
LOCATION_WORDS = frozenset(
    {
        "mel",
        "melb",
        "melbourne",
        "adel",
        "adelaide",
        "perth",
        "syd",
        "sydney",
        "bris",
        "bne",
        "brisbane",
        "canberra",
        "cbr",
        "hobart",
        "darwin",
        "vic",
        "nsw",
        "qld",
    }
)

DEFAULT_FUZZY_MIN = 90  # the Settings default for match_fuzzy_min (0 to 100)
DEFAULT_PROFILE_MIN = 0.90  # the Settings default for match_profile_min (0 to 1)
MIN_CORE_CHARS = 3
MAX_CANDIDATES = 3
PROFILE_POOL = 25  # profiles read from memory before the second sign is checked

Status = Literal["new", "in_hubspot", "open_deal", "dissolved_deal", "possible_match"]
MatchedBy = Literal["domain", "name", "hubspot_id", "close_name", "similar_profile", "name_in_deal"]
CandidateReason = Literal["close_name", "similar_profile", "name_in_deal"]
# Which check is stronger evidence. Candidates are listed in this order, then by score.
REASON_ORDER: dict[CandidateReason, int] = {
    "name_in_deal": 0,
    "close_name": 1,
    "similar_profile": 2,
}


@dataclass(frozen=True)
class MatchCandidate:
    """A company that might be the same one. A person confirms."""

    hubspot_id: str
    name: str
    owner: str | None
    reason: CandidateReason
    score: float  # 0 to 1, higher is closer (a text score of 90 out of 100 is 0.90)
    open_deals: list[str] = field(default_factory=list)
    last_dissolved: date | None = None  # when the latest dissolved deal closed


@dataclass(frozen=True)
class HubSpotMatch:
    """For `possible_match`, `hubspot_id`, `name`, `owner` and the deals are left empty (nothing
    is confirmed): `candidates` says who it might be, and `matched_by` is the best one's reason."""

    status: Status
    hubspot_id: str | None = None
    name: str | None = None
    owner: str | None = None
    matched_by: MatchedBy | None = None
    open_deals: list[str] = field(default_factory=list)
    last_dissolved: date | None = None  # when the latest dissolved deal closed
    candidates: list[MatchCandidate] = field(default_factory=list)  # at most 3


# --- Names -------------------------------------------------------------------------------------


def clean_name(name: str) -> str:
    """'ABC Logistics Pty. Ltd.' becomes 'abc logistics'."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("&", " and ")).split()
    return " ".join(word for word in words if word not in LEGAL_WORDS)


def _core(cleaned: str, extra_generic: frozenset[str] = frozenset()) -> tuple[str, ...]:
    return tuple(
        word for word in cleaned.split() if word not in GENERIC_WORDS and word not in extra_generic
    )


def core_tokens(name: str) -> tuple[str, ...]:
    """The words that say which company it is: the cleaned name without its generic words
    (australia, group, holdings, services, solutions, the, and, ...), in order.

    'Lactalis-Mainland Dairy Australia' gives ('lactalis', 'mainland', 'dairy'). A name made
    only of generic words gives an empty tuple.
    """
    return _core(clean_name(name))


_BRACKETS = re.compile(r"\(([^()]*)\)")


def _variants(name: str) -> list[str]:
    """The cleaned forms of a name to compare, without repeats and never empty: as written,
    without its (bracketed) parts, and each bracketed part alone. So 'Gibson Quai International
    (GQI)' can be found as 'Gibson Quai International' and as 'GQI'."""
    forms = [clean_name(name), clean_name(_BRACKETS.sub(" ", name))]
    forms += [clean_name(part) for part in _BRACKETS.findall(name)]
    unique: list[str] = []
    for form in forms:
        if form and form not in unique:
            unique.append(form)
    return unique


def _digits(words: Iterable[str]) -> frozenset[str]:
    return frozenset(word for word in words if any(char.isdigit() for char in word))


def _cores_agree(a: tuple[str, ...], b: tuple[str, ...], fuzzy_min: int) -> bool:
    """The guard: the core words are equal or nearly equal, and long enough to mean something.

    Nearly equal is a spelling slip: the sorted core words score `fuzzy_min` or more with
    `fuzz.ratio` (a whole-string score, so extra words count against it). Numbers must be
    exactly equal: "Studio 54" is not "Studio 55".
    """
    if sum(map(len, a)) < MIN_CORE_CHARS or sum(map(len, b)) < MIN_CORE_CHARS:
        return False
    if _digits(a) != _digits(b):
        return False
    left, right = " ".join(sorted(a)), " ".join(sorted(b))
    return left == right or fuzz.ratio(left, right) >= fuzzy_min


def close_name_score(
    a: str,
    b: str,
    fuzzy_min: int = DEFAULT_FUZZY_MIN,
    *,
    extra_generic: frozenset[str] = frozenset(),
) -> int | None:
    """How close two company names are, 0 to 100, or None if they are not close.

    Close means `token_set_ratio` of the cleaned names is `fuzzy_min` or more AND the core
    words pass the guard (see the top of this file). Names that clean to nothing are never
    close. Used by matching, and by the merge of discovered companies.
    """
    best: int | None = None
    for left in _variants(a):
        left_core = _core(left, extra_generic)
        for right in _variants(b):
            score = fuzz.token_set_ratio(left, right)
            if score < fuzzy_min:
                continue
            if not _cores_agree(left_core, _core(right, extra_generic), fuzzy_min):
                continue
            best = max(best or 0, round(score))
    return best


def names_are_close(a: str, b: str, fuzzy_min: int = DEFAULT_FUZZY_MIN) -> bool:
    return close_name_score(a, b, fuzzy_min) is not None


# --- Deal names --------------------------------------------------------------------------------

_DASHES = "-" + chr(0x2013) + chr(0x2014)  # hyphen, en dash, em dash
_SQUARED = chr(0x00B2)  # the 2 in m2
_DEAL_SPLIT = re.compile(rf"\s+[{_DASHES}]\s+")
_SIZE = re.compile(rf"^\d[\d,.]*(?:m2|m{_SQUARED}|sqm)$", re.IGNORECASE)
_SIZE_UNITS = frozenset({"m2", f"m{_SQUARED}", "sqm"})


def deal_lead(deal_name: str) -> str:
    """The client's name at the start of a deal name: the text before the first ' - ', and
    before a city, a city code or a size.

    'Kyndryl MEL 787m2 Office Lease Expiry' gives 'Kyndryl'. 'The Reject Shop - Melbourne - New
    Office - 3500m2' gives 'The Reject Shop'. The first word is always kept.
    """
    words = _DEAL_SPLIT.split(deal_name.strip(), maxsplit=1)[0].split()
    cut = len(words)
    for index, word in enumerate(words):
        if index == 0:
            continue
        key = word.casefold().strip(",.()")
        if key in LOCATION_WORDS or _SIZE.match(word):
            cut = index
            break
        if key in _SIZE_UNITS and words[index - 1][:1].isdigit():  # "3,000 m2"
            cut = index - 1
            break
    return " ".join(words[:cut])


# --- The second sign for a similar profile ------------------------------------------------------


def _brand_words(name: str) -> frozenset[str]:
    """The words that point at one company: core words of 3+ letters that are not words of an
    industry."""
    words: set[str] = set()
    for variant in _variants(name):
        words.update(w for w in _core(variant) if len(w) >= 3 and w not in INDUSTRY_WORDS)
    return frozenset(words)


def same_city(city: str | None, office_cities: frozenset[str]) -> bool:
    """Is the researched metro city one of the company's office cities? An unknown city, or a
    company with no known office city, never says no."""
    if not city or not city.strip() or not office_cities:
        return True
    return city.strip().casefold() in office_cities


# --- The answer --------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Known:
    """A HubSpot company, loaded once for the whole call, with its deals."""

    row: HubSpotCompany
    cleaned: str
    deals: tuple[HubSpotDeal, ...]


def _summary(deals: Sequence[HubSpotDeal]) -> tuple[Status, list[str], date | None]:
    open_deals = [d.name for d in deals if (d.stage or "").lower() != DISSOLVED]
    dissolved = [
        d.close_date or d.last_contacted for d in deals if (d.stage or "").lower() == DISSOLVED
    ]
    known_dates = [d for d in dissolved if d is not None]
    status: Status = "open_deal" if open_deals else "dissolved_deal" if dissolved else "in_hubspot"
    return status, open_deals, max(known_dates) if known_dates else None


def _found(company: HubSpotCompany, deals: Sequence[HubSpotDeal], by: MatchedBy) -> HubSpotMatch:
    status, open_deals, last_dissolved = _summary(deals)
    return HubSpotMatch(
        status=status,
        hubspot_id=company.hubspot_id,
        name=company.name,
        owner=company.owner,
        matched_by=by,
        open_deals=open_deals,
        last_dissolved=last_dissolved,
    )


def _best_of(found: Sequence[_Known]) -> _Known:
    """Several companies share a name or a domain: the one with an open deal wins (so it is
    never suggested by mistake), then one with a dissolved deal, then the lowest id."""

    def rank(known: _Known) -> tuple[int, str]:
        status, _, _ = _summary(known.deals)
        return ({"open_deal": 0, "dissolved_deal": 1}.get(status, 2), known.row.hubspot_id)

    return min(found, key=rank)


def _candidate(known: _Known, reason: CandidateReason, score: float) -> MatchCandidate:
    _, open_deals, last_dissolved = _summary(known.deals)
    return MatchCandidate(
        hubspot_id=known.row.hubspot_id,
        name=known.row.name,
        owner=known.row.owner,
        reason=reason,
        score=round(score, 4),
        open_deals=open_deals,
        last_dissolved=last_dissolved,
    )


async def _load(session: AsyncSession) -> list[_Known]:
    """Every company except the one with no name, and its deals: two queries."""
    companies = (
        await session.scalars(
            select(HubSpotCompany)
            .where(func.lower(func.btrim(HubSpotCompany.name)) != PLACEHOLDER_NAME)
            .order_by(HubSpotCompany.hubspot_id)
        )
    ).all()
    deals: dict[str, list[HubSpotDeal]] = {}
    for deal in await session.scalars(select(HubSpotDeal).order_by(HubSpotDeal.hubspot_deal_id)):
        deals.setdefault(deal.hubspot_company_id, []).append(deal)
    return [
        _Known(company, clean_name(company.name), tuple(deals.get(company.hubspot_id, ())))
        for company in companies
    ]


def _names_to_try(name: str, found_name: str | None) -> list[str]:
    """The name that was asked for, then the name Claude found, without repeats."""
    names: list[str] = []
    seen: set[str] = set()
    for candidate in (name, found_name):
        if candidate and (key := clean_name(candidate)) and key not in seen:
            seen.add(key)
            names.append(candidate)
    return names


def _name_in_deal(
    known: Sequence[_Known], names: Sequence[str], fuzzy_min: int
) -> list[MatchCandidate]:
    found: list[MatchCandidate] = []
    for item in known:
        best = 0
        for deal in item.deals:
            lead = deal_lead(deal.name)
            for name in names:
                score = close_name_score(name, lead, fuzzy_min, extra_generic=DEAL_WORDS)
                best = max(best, score or 0)
        if best:
            found.append(_candidate(item, "name_in_deal", best / 100))
    return found


def _close_name(
    known: Sequence[_Known], names: Sequence[str], fuzzy_min: int
) -> list[MatchCandidate]:
    found: list[MatchCandidate] = []
    for item in known:
        best = max(
            (close_name_score(name, item.row.name, fuzzy_min) or 0 for name in names), default=0
        )
        if best:
            found.append(_candidate(item, "close_name", best / 100))
    return found


async def _similar_profile(
    session: AsyncSession,
    embedder: "Embedder",
    known: Sequence[_Known],
    *,
    names: Sequence[str],
    city: str | None,
    profile_text: str,
    profile_min: float,
) -> list[MatchCandidate]:
    [vector] = await embedder.embed_passages([profile_text])
    hits = await search_similar(
        session, vector, app=PROFILE_APP, kind=PROFILE_KIND, limit=PROFILE_POOL
    )
    by_id = {item.row.hubspot_id: item for item in known}
    near = [
        (hit.similarity, by_id[str(hit.item.meta.get("hubspot_id"))])
        for hit in hits
        if hit.similarity >= profile_min and str(hit.item.meta.get("hubspot_id")) in by_id
    ]
    if not near:
        return []
    # Office labels are read only now: most calls never get this far.
    cities: dict[str, set[str]] = {}
    wanted = [item.row.hubspot_id for _, item in near]
    for company_id, label in await session.execute(
        select(HubSpotOffice.hubspot_company_id, HubSpotOffice.label).where(
            HubSpotOffice.hubspot_company_id.in_(wanted)
        )
    ):
        if office_city := metro_city(label):
            cities.setdefault(company_id, set()).add(office_city.casefold())
    wanted_brand = frozenset().union(*(_brand_words(name) for name in names))
    found: list[MatchCandidate] = []
    for similarity, item in near:
        if not same_city(city, frozenset(cities.get(item.row.hubspot_id, ()))):
            continue
        if wanted_brand & _brand_words(item.row.name):  # the same industry is not enough
            found.append(_candidate(item, "similar_profile", similarity))
    return found


async def match_company(
    session: AsyncSession,
    name: str,
    website: str | None = None,
    city: str | None = None,
    embedder: "Embedder | None" = None,
    hubspot_id: str | None = None,
    profile_text: str | None = None,
    *,
    found_name: str | None = None,
    fuzzy_min: int = DEFAULT_FUZZY_MIN,
    profile_min: float = DEFAULT_PROFILE_MIN,
) -> HubSpotMatch:
    """Finds the company in HubSpot (the order is at the top of this file).

    - `name`: the name that was asked for. `found_name`: the name Claude found, tried second.
    - `website`: a domain or an address; only the domain is used.
    - `city`: the researched METRO city, already cleaned by the caller ('Melbourne', never a
      suburb), or None. Compared with the company's office labels. Never blocks when unknown.
    - `hubspot_id`: the company is already known (the watchlist).
    - `embedder` and `profile_text` (from `build_profile_text_from_facts`): needed for the
      similar-profile check. Without them that check is skipped.
    - `fuzzy_min` (0 to 100) and `profile_min` (0 to 1): the thresholds, from the settings.
    """
    if hubspot_id:
        company = await session.get(HubSpotCompany, hubspot_id)
        if company is not None and not is_placeholder(company.name):
            deals = (
                await session.scalars(
                    select(HubSpotDeal).where(HubSpotDeal.hubspot_company_id == hubspot_id)
                )
            ).all()
            return _found(company, deals, "hubspot_id")

    known = await _load(session)
    domain = normalize_domain(website)
    if domain:
        same_domain = [item for item in known if item.row.domain == domain]
        if same_domain:
            best = _best_of(same_domain)
            return _found(best.row, best.deals, "domain")

    names = _names_to_try(name, found_name)
    for wanted in (clean_name(n) for n in names):
        same_name = [item for item in known if item.cleaned == wanted]
        if same_name:
            best = _best_of(same_name)
            return _found(best.row, best.deals, "name")

    candidates = _name_in_deal(known, names, fuzzy_min) + _close_name(known, names, fuzzy_min)
    if embedder is not None and profile_text and names:
        candidates += await _similar_profile(
            session,
            embedder,
            known,
            names=names,
            city=city,
            profile_text=profile_text,
            profile_min=profile_min,
        )
    ranked: list[MatchCandidate] = []
    seen: set[str] = set()
    for candidate in sorted(
        candidates,
        key=lambda c: (REASON_ORDER[c.reason], -c.score, c.name.casefold(), c.hubspot_id),
    ):
        if candidate.hubspot_id not in seen:
            seen.add(candidate.hubspot_id)
            ranked.append(candidate)
    if not ranked:
        return HubSpotMatch(status="new")
    top = ranked[:MAX_CANDIDATES]
    return HubSpotMatch(status="possible_match", matched_by=top[0].reason, candidates=top)
