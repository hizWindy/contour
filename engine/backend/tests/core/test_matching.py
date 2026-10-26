"""Matching a researched company with HubSpot: the name rules (fast, pure) and the order of the
checks on a small made-up set of companies (integration).

The real export is used in tests/lead_finder/test_matching_deals.py.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from core.hubspot.matching import (
    DEAL_WORDS,
    DEFAULT_FUZZY_MIN,
    DEFAULT_PROFILE_MIN,
    GENERIC_WORDS,
    clean_name,
    close_name_score,
    core_tokens,
    deal_lead,
    match_company,
    names_are_close,
    same_city,
)
from core.hubspot.models import HubSpotCompany, HubSpotDeal

# --- Names (fast, pure) -------------------------------------------------------------------------


def test_the_default_thresholds_are_the_settings_defaults() -> None:
    fields = Settings.model_fields
    assert fields["match_fuzzy_min"].default == DEFAULT_FUZZY_MIN == 90
    assert fields["match_profile_min"].default == DEFAULT_PROFILE_MIN == 0.90


def test_the_generic_words_are_the_agreed_list() -> None:
    agreed = {
        "australia", "australian", "aus", "group", "holdings", "holding", "services",
        "solutions", "international", "global", "the", "and", "co", "company", "pty", "ltd",
        "limited", "inc", "australasia",
    }  # fmt: skip
    assert set(GENERIC_WORDS) == agreed
    # Words of a deal name that are not the client's. "Office" is not a company.
    assert {"office", "lease", "suite"} <= DEAL_WORDS


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Lactalis-Mainland Dairy Australia", ("lactalis", "mainland", "dairy")),
        ("The Body Shop", ("body", "shop")),
        ("Alvarez & Marsal", ("alvarez", "marsal")),
        ("ABC Logistics Pty. Ltd.", ("abc", "logistics")),
        ("Australian Group Holdings Pty Ltd", ()),  # nothing but generic words
        ("Pty Ltd", ()),
        ("", ()),
        ("***", ()),
    ],
)
def test_core_tokens_drop_the_generic_words(name: str, expected: tuple[str, ...]) -> None:
    assert core_tokens(name) == expected


@pytest.mark.parametrize(
    ("asked", "in_hubspot"),
    [
        ("Lactalis Mainland Dairy Australia", "Lactalis-Mainland Dairy"),
        ("ABC Logistics Pty Ltd", "ABC Logistics"),
        ("Peritas Group", "Peritas"),  # a generic word more or less
        ("Body Shop", "The Body Shop Australia"),  # the words of one are inside the other
        ("Kyndrl", "Kyndryl"),  # a typo: the core words are nearly equal
        ("Gibson Quai International", "Gibson Quai International (GQI)"),  # a bracket left out
        ("GQI", "Gibson Quai International (GQI)"),  # the bracketed short name alone
        ("Alvarez and Marsal", "Alvarez & Marsal"),
    ],
)
def test_close_names(asked: str, in_hubspot: str) -> None:
    assert names_are_close(asked, in_hubspot)
    assert names_are_close(in_hubspot, asked)  # it does not matter which side is which


@pytest.mark.parametrize(
    ("asked", "in_hubspot"),
    [
        # The words of one name are inside the other, so token_set_ratio says 100. The core
        # words differ, so these are not the same company.
        ("Apex", "Apex Plumbing"),
        ("Aspect", "Aspect Engineering Solutions"),
        ("Unyte Health", "Unyte"),
        ("Elders", "Elders Insurance"),
        ("Q Design", "Q Design + Construct"),
        # Nothing but generic words: they say nothing about which company it is.
        ("Group Holdings", "Holdings Group Pty Ltd"),
        ("Australia", "Australian Services"),
        ("Global Solutions", "Solutions Global International"),
        # The core words are shorter than 3 letters.
        ("AB", "AB Group"),
        ("Pty Ltd", "Pty Ltd"),  # cleans to nothing
        ("", "Acme"),
        # A different number is a different company.
        ("Studio 54", "Studio 55"),
        ("Project 100", "Project 101"),
        # Only the word of an industry is shared.
        ("Mineral Resources", "MEGA Resources"),
        ("Unrelated Pty Ltd", "Totally Different Ltd"),
    ],
)
def test_names_that_are_not_close(asked: str, in_hubspot: str) -> None:
    assert close_name_score(asked, in_hubspot) is None
    assert close_name_score(in_hubspot, asked) is None


def test_the_fuzzy_threshold_is_a_parameter() -> None:
    # One letter different: 88 out of 100. Close only if the threshold allows it.
    assert close_name_score("Cyclotec", "Cyclotek Pty Ltd") is None
    assert close_name_score("Cyclotec", "Cyclotek Pty Ltd", 90) is None
    assert close_name_score("Cyclotec", "Cyclotek Pty Ltd", 85) == 88
    assert close_name_score("Cyclotek", "Cyclotek Limited", 100) == 100


def test_different_generic_words_on_both_sides_lower_the_score() -> None:
    # Neither name is inside the other ("the" against "australia"), so the score is 82, not 100.
    # The score is on the cleaned names, as agreed. A person lowering the threshold sees it.
    assert close_name_score("The Body Shop", "Body Shop Australia") is None
    assert close_name_score("The Body Shop", "Body Shop Australia", 80) == 82


def test_a_close_name_gives_its_score() -> None:
    assert close_name_score("Peritas Group", "Peritas") == 100
    score = close_name_score("Kyndrl", "Kyndryl")
    assert score is not None
    assert 90 <= score < 100


@pytest.mark.parametrize(
    ("deal", "lead"),
    [
        ("Kyndryl MEL 787m2 Office Lease Expiry", "Kyndryl"),
        ("Ascaro Padel MEL 3,000m2 Office INTEL Deal", "Ascaro Padel"),
        ("Alvarez & Marsal PERTH 800m2 Office PD Relocation", "Alvarez & Marsal"),
        ("Nilsen Group ADEL 1,000m2 Office PD Relocation", "Nilsen Group"),
        (
            "The Reject Shop - Melbourne - New Office - 3500m2 (Younghusband Building)",
            "The Reject Shop",
        ),
        ("209 Greenhill Road - Spec Suite", "209 Greenhill Road"),
        ("Acme 3,000 m2 Office", "Acme"),  # a size written with a space
        ("Perth Mint MEL 500m2 Office", "Perth Mint"),  # the first word is always kept
        ("Studio 54 MEL 300m2", "Studio 54"),  # a number without a unit is part of the name
        (f"Baker Bleu {chr(0x2013)} SYD 2,000m2", "Baker Bleu"),  # an en dash
        ("Office Lease Expiry", "Office Lease Expiry"),
        ("  Plain Name  ", "Plain Name"),
        ("", ""),
    ],
)
def test_the_start_of_a_deal_name_is_the_client(deal: str, lead: str) -> None:
    assert deal_lead(deal) == lead


@pytest.mark.parametrize("asked", ["Office", "Lease", "Suite", "Spec Suite", "New Office"])
def test_a_deal_word_never_matches_a_deal_name(asked: str) -> None:
    for deal in ("Office Lease Expiry", "Spec Suite", "New Office Suite MEL 500m2"):
        assert close_name_score(asked, deal_lead(deal), extra_generic=DEAL_WORDS) is None


def test_a_client_in_a_deal_name_is_close_to_the_name_asked() -> None:
    lead = deal_lead("The Reject Shop - Melbourne - New Office - 3500m2")
    assert close_name_score("The Reject Shop", lead, extra_generic=DEAL_WORDS) == 100
    assert close_name_score("The Reject Shop Australia", lead, extra_generic=DEAL_WORDS) == 100
    assert close_name_score("Dollarama", lead, extra_generic=DEAL_WORDS) is None


def test_an_unknown_city_never_blocks() -> None:
    offices = frozenset({"melbourne", "perth"})
    assert same_city("Melbourne", offices)
    assert same_city(" perth ", offices)
    assert not same_city("Adelaide", offices)  # known on both sides and different
    assert same_city(None, offices)  # the researched city is unknown
    assert same_city("", offices)
    assert same_city("Adelaide", frozenset())  # the company has no office city on record


def test_clean_name_is_unchanged() -> None:
    assert clean_name("ABC Logistics Pty. Ltd.") == "abc logistics"
    assert clean_name("Alvarez & Marsal") == "alvarez and marsal"
    assert clean_name("***") == ""


# --- The order of the checks, on a small made-up set (integration) -------------------------------

INTEGRATION = pytest.mark.integration


def company(
    hubspot_id: str, name: str, domain: str | None = None, **more: object
) -> HubSpotCompany:
    return HubSpotCompany(hubspot_id=hubspot_id, name=name, domain=domain, source="export", **more)


async def add(session: AsyncSession, *rows: object) -> None:
    session.add_all(rows)
    await session.commit()


@INTEGRATION
async def test_the_company_with_no_name_is_never_matched(session: AsyncSession) -> None:
    await add(
        session,
        company("1", "(no name on record)", "edl.com.au"),
        company("2", "Pty Ltd"),  # cleans to nothing
    )
    assert (await match_company(session, "Acme", "edl.com.au")).status == "new"  # its domain
    assert (await match_company(session, "(no name on record)")).status == "new"
    assert (await match_company(session, "No name on record")).status == "new"
    # Even when the watchlist names it.
    assert (await match_company(session, "Acme", hubspot_id="1")).status == "new"


@INTEGRATION
async def test_a_name_that_cleans_to_nothing_never_matches(session: AsyncSession) -> None:
    await add(session, company("2", "Pty Ltd"), company("3", "Group Holdings"))
    for name in ("Inc", "Pty Limited", "***", "", "Holdings Group"):
        assert (await match_company(session, name)).status == "new", name


@INTEGRATION
async def test_the_order_is_id_then_domain_then_name(session: AsyncSession) -> None:
    await add(
        session,
        company("1", "ABC Logistics Pty Ltd", "abclogistics.com.au", owner="Levi"),
        company("2", "Zed Mining", "zed.com.au"),
        company("3", "Quark Foods"),
    )
    by_id = await match_company(session, "Quark Foods", "zed.com.au", hubspot_id="1")
    assert (by_id.matched_by, by_id.hubspot_id, by_id.name) == (
        "hubspot_id",
        "1",
        "ABC Logistics Pty Ltd",
    )
    assert by_id.owner == "Levi"
    by_domain = await match_company(session, "Quark Foods", "https://www.zed.com.au/about")
    assert (by_domain.matched_by, by_domain.hubspot_id) == ("domain", "2")  # not "Quark Foods"
    by_name = await match_company(session, "ABC Logistics")
    assert (by_name.matched_by, by_name.hubspot_id, by_name.status) == ("name", "1", "in_hubspot")
    # An id that isn't there is not an error: the other checks run.
    missing = await match_company(session, "Quark Foods", hubspot_id="999")
    assert (missing.matched_by, missing.hubspot_id) == ("name", "3")
    assert (await match_company(session, "Nothing Like It", "other.com")).status == "new"


@INTEGRATION
async def test_the_name_asked_for_comes_before_the_name_claude_found(session: AsyncSession) -> None:
    await add(session, company("10", "Alpha Systems"), company("11", "Beta Systems"))
    first = await match_company(session, "Beta Systems", found_name="Alpha Systems")
    assert (first.matched_by, first.hubspot_id) == ("name", "11")
    second = await match_company(session, "Gamma Works", found_name="Alpha Systems")
    assert (second.matched_by, second.hubspot_id) == ("name", "10")
    same = await match_company(session, "Alpha Systems", found_name="Alpha Systems Pty Ltd")
    assert same.hubspot_id == "10"


@INTEGRATION
async def test_deals_decide_the_status(session: AsyncSession) -> None:
    from datetime import date

    await add(
        session,
        company("1", "Open Co"),
        company("2", "Gone Co"),
        company("3", "Plain Co"),
        HubSpotDeal(
            hubspot_deal_id="d1", hubspot_company_id="1", name="Open Co MEL", stage="Verified"
        ),
        HubSpotDeal(
            hubspot_deal_id="d2",
            hubspot_company_id="2",
            name="Gone Co MEL",
            stage="Dissolved",
            close_date=date(2026, 10, 1),
        ),
    )
    open_deal = await match_company(session, "Open Co")
    assert (open_deal.status, open_deal.open_deals) == ("open_deal", ["Open Co MEL"])
    gone = await match_company(session, "Gone Co")
    assert (gone.status, gone.last_dissolved) == ("dissolved_deal", date(2026, 10, 1))
    assert (await match_company(session, "Plain Co")).status == "in_hubspot"


@INTEGRATION
async def test_a_close_name_is_a_possible_match_with_the_company_as_candidate(
    session: AsyncSession,
) -> None:
    await add(session, company("1", "Lactalis-Mainland Dairy", owner="Levi"))
    match = await match_company(session, "Lactalis Mainland Dairy Australia")
    assert match.status == "possible_match"
    assert match.matched_by == "close_name"
    # Nothing is confirmed, so the company's own fields stay empty.
    assert (match.hubspot_id, match.name, match.owner) == (None, None, None)
    [candidate] = match.candidates
    assert (candidate.hubspot_id, candidate.name, candidate.owner) == (
        "1",
        "Lactalis-Mainland Dairy",
        "Levi",
    )
    assert candidate.reason == "close_name"
    assert candidate.score == 1.0
    assert candidate.open_deals == []


@INTEGRATION
async def test_a_possible_match_says_when_the_candidate_has_an_open_deal(
    session: AsyncSession,
) -> None:
    await add(
        session,
        company("1", "Peritas"),
        HubSpotDeal(
            hubspot_deal_id="d1",
            hubspot_company_id="1",
            name="Peritas PERTH 500m2",
            stage="Verified",
        ),
    )
    match = await match_company(session, "Peritas Group")
    assert match.status == "possible_match"  # still not "open_deal": a person decides
    assert match.candidates[0].open_deals == ["Peritas PERTH 500m2"]


@INTEGRATION
async def test_the_subset_traps_are_new(session: AsyncSession) -> None:
    await add(
        session,
        company("1", "Apex Plumbing"),
        company("2", "Unyte"),
        company("3", "Aspect Engineering Solutions"),
        company("4", "Holdings Group Pty Ltd"),
        company("5", "Studio 55"),
    )
    for asked in ("Apex", "Unyte Health", "Aspect", "Group Holdings", "Studio 54"):
        match = await match_company(session, asked)
        assert match.status == "new", asked
        assert match.candidates == []


@INTEGRATION
async def test_at_most_three_candidates_best_first(session: AsyncSession) -> None:
    await add(
        session,
        company("1", "Orbit Systems Group"),
        company("2", "Orbit Systems Holdings"),
        company("3", "Orbit Systems Australia"),
        company("4", "Orbit Systems Global"),
        company("5", "Orbit Systems International"),
        company("6", "Orbit Sytems"),  # a typo: close, but less than the equal ones
    )
    match = await match_company(session, "Orbit Systems")
    assert match.status == "possible_match"
    assert [c.name for c in match.candidates] == [
        "Orbit Systems Australia",
        "Orbit Systems Global",
        "Orbit Systems Group",
    ]
    scores = [c.score for c in match.candidates]
    assert scores == sorted(scores, reverse=True)


@INTEGRATION
async def test_the_fuzzy_threshold_reaches_match_company(session: AsyncSession) -> None:
    await add(session, company("1", "Cyclotek Pty Ltd"))
    assert (await match_company(session, "Cyclotec")).status == "new"
    loose = await match_company(session, "Cyclotec", fuzzy_min=85)
    assert loose.status == "possible_match"
    assert loose.candidates[0].score == 0.88


@INTEGRATION
async def test_a_name_in_a_deal_is_a_possible_match(session: AsyncSession) -> None:
    await add(
        session,
        company("1", "Dollarama"),
        HubSpotDeal(
            hubspot_deal_id="d1",
            hubspot_company_id="1",
            name="The Reject Shop - Melbourne - New Office - 3500m2 (Younghusband Building)",
            stage="Dissolved",
        ),
        company("2", "Other Co"),
        HubSpotDeal(
            hubspot_deal_id="d2",
            hubspot_company_id="2",
            name="Office Lease Expiry",
            stage="Verified",
        ),
    )
    match = await match_company(session, "The Reject Shop")
    assert (match.status, match.matched_by) == ("possible_match", "name_in_deal")
    assert [(c.name, c.reason) for c in match.candidates] == [("Dollarama", "name_in_deal")]
    # Words that are only about the deal never match.
    for asked in ("Office", "Lease Expiry", "New Office"):
        assert (await match_company(session, asked)).status == "new", asked
