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

**Speed (PLAN-V15 T1-4).** A run asks up to 3 times per company, and our copy holds about 14,000
companies. So the copy is loaded once, as small plain records with every name's cleaned forms
already made, and kept until it changes (its row counts or newest save time move). Only one
caller loads it; the others wait for it. The loose checks (4 and 5) use one batch search each
(rapidfuzz's `process.extract`, the same `token_set_ratio`, run in C++), then the same core-word
guard on the few that pass, in a thread, so other requests are answered meanwhile. The answers
are exactly those of comparing every pair.
"""

import asyncio
import re
import weakref
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Any, Literal

from rapidfuzz import fuzz, process
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

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
class _Company:
    """The four fields of a HubSpot company that matching reads."""

    hubspot_id: str
    name: str
    domain: str | None
    owner: str | None


@dataclass(frozen=True)
class _Deal:
    """The four fields of a deal that matching reads."""

    name: str
    stage: str | None
    close_date: date | None
    last_contacted: date | None


@dataclass(frozen=True)
class _Known:
    """A HubSpot company, with its deals."""

    row: _Company
    cleaned: str
    deals: tuple[_Deal, ...]


@dataclass(frozen=True)
class _Copy:
    """Our copy of HubSpot as matching needs it, with lookups by domain, name and id."""

    key: tuple[Any, ...]
    known: tuple[_Known, ...]
    by_domain: dict[str, list[_Known]]
    by_name: dict[str, list[_Known]]
    by_id: dict[str, _Known]
    # Every cleaned form of every company name (`_variants`), flat, for one batch search, with
    # each form's core words and its company (an index into `known`). The same for every deal's
    # lead name, whose core words also leave out the deal words.
    name_forms: list[str] = field(default_factory=list)
    name_cores: list[tuple[str, ...]] = field(default_factory=list)
    name_owner: list[int] = field(default_factory=list)
    deal_forms: list[str] = field(default_factory=list)
    deal_cores: list[tuple[str, ...]] = field(default_factory=list)
    deal_owner: list[int] = field(default_factory=list)


_cached: _Copy | None = None
# One lock for each event loop (the tests run one loop each), so only one caller loads.
_load_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = (
    weakref.WeakKeyDictionary()
)


def _company_of(row: HubSpotCompany) -> _Company:
    return _Company(row.hubspot_id, row.name, row.domain, row.owner)


def _deal_of(row: HubSpotDeal) -> _Deal:
    return _Deal(row.name, row.stage, row.close_date, row.last_contacted)


def _summary(deals: Sequence[_Deal]) -> tuple[Status, list[str], date | None]:
    open_deals = [d.name for d in deals if (d.stage or "").lower() != DISSOLVED]
    dissolved = [
        d.close_date or d.last_contacted for d in deals if (d.stage or "").lower() == DISSOLVED
    ]
    known_dates = [d for d in dissolved if d is not None]
    status: Status = "open_deal" if open_deals else "dissolved_deal" if dissolved else "in_hubspot"
    return status, open_deals, max(known_dates) if known_dates else None


def _found(company: _Company, deals: Sequence[_Deal], by: MatchedBy) -> HubSpotMatch:
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


async def _copy_key(session: AsyncSession) -> tuple[Any, ...]:
    """What changes whenever our copy does: every save sets `imported_at` (an insert and an
    update alike), and a removal lowers a count. The database's address keeps two databases
    apart (the tests use their own)."""
    companies = (
        await session.execute(
            select(
                func.count(),
                func.max(HubSpotCompany.imported_at),
                func.max(HubSpotCompany.hubspot_id),
            )
        )
    ).one()
    deals = (await session.execute(select(func.count(), func.max(HubSpotDeal.imported_at)))).one()
    bind = session.bind
    url = bind.url if isinstance(bind, AsyncEngine) else bind.engine.url if bind else ""
    return (str(url), *companies, *deals)


def _build(
    key: tuple[Any, ...],
    companies: Sequence[tuple[str, str, str | None, str | None]],
    deal_rows: Sequence[tuple[str, str, str | None, date | None, date | None]],
) -> _Copy:
    """Builds the records and the lookups. Pure CPU work (14,000 names to clean), so it runs in
    a thread."""
    deals: dict[str, list[_Deal]] = {}
    for company_id, name, stage, close_date, last_contacted in deal_rows:
        deals.setdefault(company_id, []).append(_Deal(name, stage, close_date, last_contacted))
    known = tuple(
        _Known(_Company(*row), clean_name(row[1]), tuple(deals.get(row[0], ())))
        for row in companies
    )
    by_domain: dict[str, list[_Known]] = {}
    by_name: dict[str, list[_Known]] = {}
    copy = _Copy(key, known, by_domain, by_name, {item.row.hubspot_id: item for item in known})
    for index, item in enumerate(known):
        if item.row.domain:
            by_domain.setdefault(item.row.domain, []).append(item)
        by_name.setdefault(item.cleaned, []).append(item)
        for form in _variants(item.row.name):
            copy.name_forms.append(form)
            copy.name_cores.append(_core(form))
            copy.name_owner.append(index)
        for deal in item.deals:
            for form in _variants(deal_lead(deal.name)):
                copy.deal_forms.append(form)
                copy.deal_cores.append(_core(form, DEAL_WORDS))
                copy.deal_owner.append(index)
    return copy


async def _load(session: AsyncSession) -> _Copy:
    """Every company except the one with no name, and its deals. Read from the database only
    when our copy changed since the last call; otherwise the kept one is used."""
    loop = asyncio.get_running_loop()
    lock = _load_locks.get(loop)
    if lock is None:
        lock = _load_locks[loop] = asyncio.Lock()
    async with lock:  # 20 matches at once after a change load it once, not 20 times
        return await _load_now(session)


async def _load_now(session: AsyncSession) -> _Copy:
    global _cached
    key = await _copy_key(session)
    cached = _cached
    if cached is not None and cached.key == key:
        return cached
    companies = (
        await session.execute(
            select(
                HubSpotCompany.hubspot_id,
                HubSpotCompany.name,
                HubSpotCompany.domain,
                HubSpotCompany.owner,
            )
            .where(func.lower(func.btrim(HubSpotCompany.name)) != PLACEHOLDER_NAME)
            .order_by(HubSpotCompany.hubspot_id)
        )
    ).all()
    deal_rows = (
        await session.execute(
            select(
                HubSpotDeal.hubspot_company_id,
                HubSpotDeal.name,
                HubSpotDeal.stage,
                HubSpotDeal.close_date,
                HubSpotDeal.last_contacted,
            ).order_by(HubSpotDeal.hubspot_deal_id)
        )
    ).all()
    built = await asyncio.to_thread(
        _build,
        key,
        [tuple(row) for row in companies],  # type: ignore[misc]
        [tuple(row) for row in deal_rows],  # type: ignore[misc]
    )
    _cached = built
    return built


def forget_loaded_copy() -> None:
    """Drops the kept copy (for tests that change our copy in ways the key can't see)."""
    global _cached
    _cached = None


def _names_to_try(name: str, found_name: str | None) -> list[str]:
    """The name that was asked for, then the name Claude found, without repeats."""
    names: list[str] = []
    seen: set[str] = set()
    for candidate in (name, found_name):
        if candidate and (key := clean_name(candidate)) and key not in seen:
            seen.add(key)
            names.append(candidate)
    return names


def _best_scores(
    lefts: Sequence[tuple[str, tuple[str, ...]]],
    forms: list[str],
    cores: list[tuple[str, ...]],
    owners: list[int],
    fuzzy_min: int,
) -> dict[int, int]:
    """For each company, the best `close_name_score` between a wanted form and its forms. The
    same as comparing every pair: the batch search keeps exactly the pairs whose
    `token_set_ratio` is `fuzzy_min` or more, and the guard then runs on those alone."""
    best: dict[int, int] = {}
    if not forms:
        return best
    for left, left_core in lefts:
        found = process.extract(
            left,
            forms,
            scorer=fuzz.token_set_ratio,
            processor=None,
            score_cutoff=fuzzy_min,
            limit=None,
        )
        for _form, score, index in found:
            if not _cores_agree(left_core, cores[index], fuzzy_min):
                continue
            owner = owners[index]
            best[owner] = max(best.get(owner, 0), round(score))
    return best


def _loose_candidates(copy: _Copy, names: Sequence[str], fuzzy_min: int) -> list[MatchCandidate]:
    """Checks 4 (`name_in_deal`: a wanted name against each deal's lead name) and 5
    (`close_name`: against each company name) over every company. CPU work: run in a thread."""
    wanted = [form for name in names for form in _variants(name)]
    in_deals = _best_scores(
        [(form, _core(form, DEAL_WORDS)) for form in wanted],
        copy.deal_forms,
        copy.deal_cores,
        copy.deal_owner,
        fuzzy_min,
    )
    in_names = _best_scores(
        [(form, _core(form)) for form in wanted],
        copy.name_forms,
        copy.name_cores,
        copy.name_owner,
        fuzzy_min,
    )
    found = [
        _candidate(copy.known[index], "name_in_deal", score / 100)
        for index, score in sorted(in_deals.items())
        if score
    ]
    found += [
        _candidate(copy.known[index], "close_name", score / 100)
        for index, score in sorted(in_names.items())
        if score
    ]
    return found


async def _similar_profile(
    session: AsyncSession,
    embedder: "Embedder",
    by_id: dict[str, _Known],
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
            return _found(_company_of(company), [_deal_of(deal) for deal in deals], "hubspot_id")

    copy = await _load(session)
    domain = normalize_domain(website)
    if domain:
        same_domain = copy.by_domain.get(domain)
        if same_domain:
            best = _best_of(same_domain)
            return _found(best.row, best.deals, "domain")

    names = _names_to_try(name, found_name)
    for wanted in (clean_name(n) for n in names):
        same_name = copy.by_name.get(wanted)
        if same_name:
            best = _best_of(same_name)
            return _found(best.row, best.deals, "name")

    # Every company is scored here: CPU work, in a thread, so the backend keeps answering.
    candidates = await asyncio.to_thread(_loose_candidates, copy, names, fuzzy_min)
    if embedder is not None and profile_text and names:
        candidates += await _similar_profile(
            session,
            embedder,
            copy.by_id,
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
