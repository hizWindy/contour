"""Matching on the REAL HubSpot export (projects/leads/research/COMPANIES.xlsx), with the real
memory model for the profile check. These pin what the matcher says about Contour's own data:
the 12 deal companies, the traps measured on this export, and the 10 test-set companies.

Integration: they load the export into the test database.
"""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import ENGINE_DIR
from core.hubspot.importer import read_export
from core.hubspot.matching import DEFAULT_PROFILE_MIN, HubSpotMatch, match_company
from core.hubspot.profiles import (
    PROFILE_APP,
    PROFILE_KIND,
    build_profile_text_from_facts,
    rebuild_profiles,
)
from core.hubspot.service import save_export
from core.memory.embedder import Embedder
from core.memory.service import search_similar
from tests.lead_finder.samples import fact, make_facts

EXPORT = ENGINE_DIR.parent / "projects" / "leads" / "research" / "COMPANIES.xlsx"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not EXPORT.exists(), reason=f"the HubSpot export is not at {EXPORT}"),
]

# name, domain in HubSpot, status, when the latest dissolved deal closed (EXPORT.md section 4)
DEALS = [
    ("Kyndryl", "kyndryl.com", "open_deal", None),
    ("Ascaro Padel", "ascaropadel.com", "open_deal", None),
    ("Online Lead Management", "onlineleadmanagement.com.au", "dissolved_deal", date(2026, 10, 22)),
    ("Shakespeare Financial Group", "shakes.com.au", "open_deal", None),
    ("Alvarez & Marsal", "australia-alvarezandmarsal.com", "open_deal", None),
    ("Nilsen Group", "nilsen.com.au", "open_deal", None),
    ("Patties Food Group", "pattiesfoodgroup.com", "dissolved_deal", date(2026, 10, 7)),
    ("Dollarama", "dollarama.com", "dissolved_deal", date(2026, 10, 8)),
    ("PYC Therapeutics", "pyctx.com", "open_deal", None),
    ("209 Greenhill Road", None, "open_deal", None),  # no website on record: found by name
    ("FYI", "fyi.app", "dissolved_deal", date(2026, 9, 21)),
    ("Baker Bleu", "bakerbleu.com.au", "dissolved_deal", date(2026, 9, 14)),
]

# The 10 companies of testset.yaml (with an industry in HubSpot's words, as research would find
# it), and the Acme of the samples. None of them is in Contour's HubSpot.
TEST_SET = [
    ("Culture Amp", "cultureamp.com", "Melbourne", "Computer Software", 400),
    ("Seek", "seek.com.au", "Melbourne", "Internet", 1500),
    ("Kogan.com", "kogan.com", "Melbourne", "Retail", 300),
    ("Elders", "elders.com.au", "Adelaide", "Farming", 300),
    ("Beach Energy", "beachenergy.com.au", "Adelaide", "Oil Energy", 600),
    ("Maptek", "maptek.com", "Adelaide", "Computer Software", 150),
    ("Mineral Resources", "mineralresources.com.au", "Perth", "Mining Metals", 3000),
    ("Perenti", "perenti.com", "Perth", "Mining Metals", 1500),
    ("Bankwest", "bankwest.com.au", "Perth", "Banking", 2000),
    ("Canva", "canva.com", "Sydney", "Computer Software", 2000),
    ("Acme Software", "acme.com.au", "Melbourne", "Software", 250),
]


async def load_export(session: AsyncSession) -> None:
    await save_export(session, read_export(EXPORT))


def profile_of(name: str, city: str, industry: str, staff: int | None) -> str:
    facts = make_facts(
        name=name, city=fact(city), industry=fact(industry), staff_in_city=fact(staff)
    )
    return build_profile_text_from_facts(facts, city=city)


def summary(match: HubSpotMatch) -> tuple[str, str | None, str | None, date | None]:
    return (match.status, match.matched_by, match.name, match.last_dissolved)


# --- The 12 deal companies ---------------------------------------------------------------------


async def test_the_twelve_deal_companies_are_found_by_their_website(session: AsyncSession) -> None:
    await load_export(session)
    found = {}
    for name, domain, _, _ in DEALS:
        website = f"https://www.{domain}/about" if domain else None
        found[name] = summary(await match_company(session, name, website=website))
    assert found == {
        name: (status, "domain" if domain else "name", name, dissolved)
        for name, domain, status, dissolved in DEALS
    }
    assert sum(status == "open_deal" for status, *_ in found.values()) == 7
    assert sum(status == "dissolved_deal" for status, *_ in found.values()) == 5


async def test_the_twelve_deal_companies_are_found_by_name_alone(session: AsyncSession) -> None:
    await load_export(session)
    found = {name: summary(await match_company(session, name)) for name, *_ in DEALS}
    assert found == {
        name: (status, "name", name, dissolved) for name, _, status, dissolved in DEALS
    }


async def test_a_deal_names_its_open_deals(session: AsyncSession) -> None:
    await load_export(session)
    kyndryl = await match_company(session, "Kyndryl Pty Ltd")  # the legal words are ignored
    assert kyndryl.matched_by == "name"
    assert kyndryl.open_deals == ["Kyndryl MEL 787m2 Office Lease Expiry"]


async def test_alvarez_and_marsal_is_found_with_a_website_hubspot_does_not_have(
    session: AsyncSession,
) -> None:
    await load_export(session)
    match = await match_company(
        session, "Alvarez & Marsal", website="https://www.alvarezandmarsal.com", city="Perth"
    )
    assert summary(match) == ("open_deal", "name", "Alvarez & Marsal", None)


async def test_dollarama_is_found_as_the_reject_shop_through_its_deal(
    session: AsyncSession,
) -> None:
    await load_export(session)
    match = await match_company(session, "The Reject Shop", city="Melbourne")
    assert (match.status, match.matched_by) == ("possible_match", "name_in_deal")
    assert match.hubspot_id is None  # nothing is confirmed: a person decides
    (best,) = match.candidates
    assert (best.name, best.reason, best.last_dissolved) == (
        "Dollarama",
        "name_in_deal",
        date(2026, 10, 8),
    )
    assert best.open_deals == []


async def test_a_longer_form_of_a_name_is_a_possible_match(session: AsyncSession) -> None:
    await load_export(session)
    match = await match_company(session, "Lactalis Mainland Dairy Australia")
    assert (match.status, match.matched_by) == ("possible_match", "close_name")
    assert [c.name for c in match.candidates] == ["Lactalis-Mainland Dairy"]


@pytest.mark.parametrize(
    "asked",
    [
        "Unyte Health",  # HubSpot has Unyte (civil engineering)
        "Q Construct",  # HubSpot has Q Design + Construct
        "Capital Partners",  # HubSpot has Capital Partners Private Wealth Advisers
        "Patties Bakery",  # HubSpot has Patties Food Group
        "Mega Corp",  # HubSpot has MEGA Resources
    ],
)
async def test_a_name_inside_another_name_is_not_a_match(session: AsyncSession, asked: str) -> None:
    await load_export(session)
    match = await match_company(session, asked)
    assert match.status == "new", match.candidates


async def test_the_company_with_no_name_on_record_is_never_matched(session: AsyncSession) -> None:
    await load_export(session)
    # The placeholder row has the domain edl.com.au.
    assert (await match_company(session, "EDL", website="edl.com.au")).status == "new"
    assert (await match_company(session, "(no name on record)")).status == "new"


# --- The profile check (real memory model) -----------------------------------------------------


async def test_the_test_set_companies_are_all_new_even_with_their_profiles(
    session: AsyncSession, embedder: Embedder
) -> None:
    await load_export(session)
    await rebuild_profiles(session, embedder)
    found = {}
    for name, domain, city, industry, staff in TEST_SET:
        match = await match_company(
            session,
            name,
            website=domain,
            city=city,
            embedder=embedder,
            profile_text=profile_of(name, city, industry, staff),
        )
        found[name] = (match.status, [c.name for c in match.candidates])
    assert found == {name: ("new", []) for name, *_ in TEST_SET}


async def test_the_same_industry_and_city_is_not_a_second_sign(
    session: AsyncSession, embedder: Embedder
) -> None:
    """Why a shared brand word is required (measured on this export, TBC on researched profiles):
    Mineral Resources reads MORE like MEGA Resources, an unrelated Perth miner with a short
    profile, than a renamed company reads like itself. So the profile score alone can't decide."""
    await load_export(session)
    await rebuild_profiles(session, embedder)
    [vector] = await embedder.embed_passages(
        [profile_of("Mineral Resources", "Perth", "Mining Metals", 3000)]
    )
    hits = await search_similar(session, vector, app=PROFILE_APP, kind=PROFILE_KIND, limit=1)
    assert hits[0].item.subject == "MEGA Resources"
    assert hits[0].similarity >= DEFAULT_PROFILE_MIN + 0.02  # well over the line, and unrelated


async def test_a_profile_and_a_brand_word_find_a_company_whose_name_differs(
    session: AsyncSession, embedder: Embedder
) -> None:
    """The profile-only positive: 'Lactalis Australia' is too far from 'Lactalis-Mainland Dairy'
    for the name checks, but its profile is close, it has a Melbourne office, and both names
    share 'lactalis'."""
    await load_export(session)
    await rebuild_profiles(session, embedder)
    profile = profile_of("Lactalis Australia", "Melbourne", "Food Beverages", 424)

    match = await match_company(
        session, "Lactalis Australia", city="Melbourne", embedder=embedder, profile_text=profile
    )

    assert (match.status, match.matched_by) == ("possible_match", "similar_profile")
    best = match.candidates[0]
    assert (best.name, best.reason) == ("Lactalis-Mainland Dairy", "similar_profile")
    # The margin is small (TBC): the score was 0.909 when this was written.
    assert DEFAULT_PROFILE_MIN <= best.score < DEFAULT_PROFILE_MIN + 0.03
    # Without the profile the name checks alone don't find it.
    assert (await match_company(session, "Lactalis Australia")).status == "new"
    # A city where it has no office breaks the second sign.
    elsewhere = await match_company(
        session, "Lactalis Australia", city="Brisbane", embedder=embedder, profile_text=profile
    )
    assert elsewhere.status == "new"
    # A stricter threshold leaves it out.
    strict = await match_company(
        session,
        "Lactalis Australia",
        city="Melbourne",
        embedder=embedder,
        profile_text=profile,
        profile_min=0.95,
    )
    assert strict.status == "new"
