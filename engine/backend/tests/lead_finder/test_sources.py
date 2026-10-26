"""The source check: every fact needs a link to a page the engine actually read."""

from typing import Any

import pytest

from apps.lead_finder.fields import BoosterFound, CompanyFacts, Fact, TriggerFound
from apps.lead_finder.rules import load_rules
from apps.lead_finder.sources import check_sources, missing_facts, source_kind, url_key
from tests.lead_finder.samples import ASX, NEWS, SITE, fact, make_facts

CRITERIA = load_rules().criteria
SEEN = [NEWS, ASX, SITE]


def assert_fully_unknown(fact: Fact[Any]) -> None:
    """A dropped fact keeps nothing: no value, no label, and no link or date that could be odd."""
    assert (fact.value, fact.label, fact.source_url, fact.source_date) == (None, None, None, None)


def test_facts_with_pages_we_read_are_kept() -> None:
    checked = check_sources(make_facts(), SEEN, CRITERIA)
    assert checked.dropped == []
    assert checked.facts.office_m2.value == 2500


def test_a_link_we_never_read_makes_the_fact_unknown() -> None:
    facts = make_facts(office_m2=fact(2500, "https://made-up.example/page"))
    checked = check_sources(facts, SEEN, CRITERIA)
    assert checked.facts.office_m2.value is None
    assert checked.dropped[0].startswith("office_m2: link not among the pages read")
    assert_fully_unknown(checked.facts.office_m2)


def test_a_fact_without_a_link_is_unknown() -> None:
    checked = check_sources(make_facts(industry=fact("Software", None)), SEEN, CRITERIA)
    assert checked.facts.industry.value is None


def test_blocked_sites_and_unknown_trigger_ids_are_removed() -> None:
    blocked = "https://www.zoominfo.com/c/acme/123"
    facts = make_facts(
        staff_in_city=fact(250, blocked),
        triggers=[
            TriggerFound(
                id="moon_landing", what_happened="x", date=None, source_url=NEWS, label="guessed"
            ),
            TriggerFound(
                id="fast_growth",
                what_happened="x",
                date=None,
                source_url=blocked,
                label="confirmed",
            ),
        ],
    )
    checked = check_sources(facts, [*SEEN, blocked], CRITERIA)
    assert checked.facts.staff_in_city.value is None
    assert checked.facts.triggers == []
    assert len(checked.dropped) == 3


def test_the_website_stands_if_we_read_pages_on_it() -> None:
    facts = make_facts(website=fact("acme.com.au", None))
    assert check_sources(facts, SEEN, CRITERIA).facts.website.value == "acme.com.au"


@pytest.mark.parametrize(
    ("url", "kind"),
    [
        (ASX, "asx_or_official_news"),
        ("https://abr.business.gov.au/x", "asx_or_official_news"),
        ("https://au.indeed.com/jobs?q=acme", "job_ads"),
        (NEWS, "other_news"),
        ("https://lusha.com/acme", "blocked"),
        (SITE, "asx_or_official_news"),
    ],
)
def test_source_kinds(url: str, kind: str) -> None:
    assert source_kind(url, CRITERIA, company_domain="acme.com.au") == kind


def test_the_same_page_written_differently_matches() -> None:
    assert url_key("https://www.afr.com/a/b/") == url_key("http://afr.com/a/b#top")
    assert url_key("https://afr.com/a?id=1") != url_key("https://afr.com/a?id=2")


def test_missing_facts_for_the_gap_check() -> None:
    assert missing_facts(make_facts()) == []
    facts = make_facts(city=fact(None), office_m2=fact(None), staff_in_city=fact(None), triggers=[])
    assert missing_facts(facts) == [
        "city",
        "office size or staff in the city",
        "a sign of an office change",
    ]


# --- Web addresses that are not web addresses ------------------------------------------------

UNSAFE_URLS = [
    "javascript://news.example/%0Aalert(1)",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://news.example/report.pdf",
    "https://user:pw@news.example/a",
    "https://news.example/a b",
    "https://news.example/a\nb",
    "https://news.example/" + "a" * 600,
]


@pytest.mark.parametrize("url", UNSAFE_URLS)
def test_a_fact_with_an_unsafe_link_becomes_unknown_with_a_plain_reason(url: str) -> None:
    """Even when the page is on the 'pages read' list, an address that isn't plain is dropped."""
    facts = make_facts(office_m2=fact(2500, url))
    checked = check_sources(facts, [*SEEN, url], CRITERIA)
    reason = "office_m2: not a plain web link (http or https only). Marked unknown."
    assert checked.dropped == [reason]
    assert url not in checked.dropped[0]  # the odd address is not repeated in the card
    # The odd address is not stored on the fact either, so it never reaches the card JSON.
    assert_fully_unknown(checked.facts.office_m2)
    assert url not in checked.facts.model_dump_json()


@pytest.mark.parametrize("url", UNSAFE_URLS)
def test_a_trigger_or_booster_with_an_unsafe_link_is_removed(url: str) -> None:
    trigger = TriggerFound(
        id="lease_ending", what_happened="x", date=None, source_url=url, label="confirmed"
    )
    booster = BoosterFound(id="can_pay", evidence="x", source_url=url)
    facts = make_facts(triggers=[trigger], boosters=[booster])
    checked = check_sources(facts, [*SEEN, url], CRITERIA)
    assert checked.facts.triggers == []
    assert checked.facts.boosters == []
    assert len(checked.dropped) == 2
    assert all("not a plain web link" in line for line in checked.dropped)


def test_a_scheme_less_link_is_not_a_web_address_either() -> None:
    facts = make_facts(office_m2=fact(2500, "afr.com/property/acme-moves-2026"))
    checked = check_sources(facts, ["afr.com/property/acme-moves-2026"], CRITERIA)
    assert checked.facts.office_m2.value is None


def test_a_fact_that_stands_on_a_safe_link_is_unchanged() -> None:
    checked = check_sources(make_facts(), SEEN, CRITERIA)
    assert checked.dropped == []
    assert checked.facts.office_m2.source_url == NEWS


# --- The website is a bare domain ------------------------------------------------------------


def test_the_website_is_stored_as_a_bare_domain() -> None:
    facts = make_facts(website=fact("HTTPS://www.Acme.com.au/", SITE))
    checked = check_sources(facts, SEEN, CRITERIA)
    assert checked.dropped == []
    assert checked.facts.website.value == "acme.com.au"
    assert checked.facts.website.source_url == SITE


@pytest.mark.parametrize(
    "website",
    [
        "javascript:alert(1)",
        "acme.com.au/about",
        "https://user:pw@acme.com.au",
        "acme",
        "acme.com.au evil.example",
        "<img src=x onerror=alert(1)>",
        "a" * 120 + ".com",
    ],
)
def test_an_invalid_website_is_dropped_to_unknown_with_a_message(website: str) -> None:
    facts = make_facts(website=fact(website, SITE))
    checked = check_sources(facts, SEEN, CRITERIA)
    assert_fully_unknown(checked.facts.website)
    assert checked.dropped == ["website: not a valid domain name. Marked unknown."]


def test_an_invalid_website_gives_no_company_domain_for_the_source_kinds() -> None:
    """With no website, the company's own pages are no longer 'official'."""
    own_page = "https://acme.com.au/about"
    facts = make_facts(website=fact("not a domain", SITE), industry=fact("Software", own_page))
    checked = check_sources(facts, [own_page], CRITERIA)
    assert checked.facts.industry.value == "Software"  # still read, so it is kept
    assert source_kind(own_page, CRITERIA, company_domain=None) == "other_news"


def test_the_website_stands_without_its_unsafe_link() -> None:
    """We read pages on the site, so the domain stands. The bad link is not kept as a source."""
    facts = make_facts(website=fact("acme.com.au", "javascript://acme.com.au/%0Aalert(1)"))
    checked = check_sources(facts, SEEN, CRITERIA)
    assert checked.dropped == []
    assert checked.facts.website.value == "acme.com.au"
    assert checked.facts.website.source_url is None
    assert checked.facts.website.source_date is None


def facts_citing_news(website: Fact[Any]) -> CompanyFacts:
    """Facts whose links are all on pages in NEWS or ASX, so only the website is in question."""
    return make_facts(website=website, local_team_runs_project=fact(True, NEWS))


def test_the_website_stands_if_we_read_a_subdomain_of_it() -> None:
    facts = facts_citing_news(fact("acme.com.au", NEWS))
    seen = [NEWS, ASX, "https://careers.acme.com.au/jobs"]
    checked = check_sources(facts, seen, CRITERIA)
    assert checked.dropped == []
    assert checked.facts.website.value == "acme.com.au"


def test_a_website_that_only_a_news_page_names_is_dropped() -> None:
    """Nothing on acme.com.au was read. A news page saying 'acme.com.au' is not enough."""
    facts = facts_citing_news(fact("acme.com.au", NEWS))
    checked = check_sources(facts, [NEWS, ASX], CRITERIA)
    assert checked.dropped == ["website: no page on this site was read. Marked unknown."]
    assert_fully_unknown(checked.facts.website)


def test_a_domain_nobody_read_is_dropped_even_with_a_link_that_was_read() -> None:
    facts = make_facts(website=fact("evil-not-read.com", NEWS))
    checked = check_sources(facts, SEEN, CRITERIA)
    assert checked.facts.website.value is None
    assert checked.dropped == ["website: no page on this site was read. Marked unknown."]


@pytest.mark.parametrize(
    "read_page",
    [
        "https://notacme.com.au/about",  # ends with the same letters, but is another site
        "https://acme.com.au.evil.example/about",  # the domain is only the front of the host
        "https://example.com/acme.com.au",  # the domain is only in the path
    ],
)
def test_a_look_alike_host_does_not_count_as_reading_the_site(read_page: str) -> None:
    facts = facts_citing_news(fact("acme.com.au", read_page))
    checked = check_sources(facts, [NEWS, ASX, read_page], CRITERIA)
    assert checked.facts.website.value is None
    assert checked.dropped == ["website: no page on this site was read. Marked unknown."]


# --- A fact with no value keeps no link --------------------------------------------------------


def test_a_fact_with_no_value_keeps_no_link_or_date() -> None:
    """Claude can leave the value empty and still fill in a link. It is not stored."""
    odd = Fact[str](
        value=None, source_url="javascript:alert(1)", source_date="2026-10-01", label=None
    )
    checked = check_sources(make_facts(industry=odd), SEEN, CRITERIA)
    assert checked.dropped == []  # nothing was claimed, so nothing was removed
    assert_fully_unknown(checked.facts.industry)
    assert "javascript:" not in checked.facts.model_dump_json()


# --- Property Daily is blocked -----------------------------------------------------------------

PROPERTY_DAILY = "https://www.propertydaily.com.au/news/acme-moves"


def test_property_daily_is_a_blocked_site() -> None:
    assert source_kind(PROPERTY_DAILY, CRITERIA) == "blocked"
    assert source_kind("https://propertydaily.com.au/x", CRITERIA) == "blocked"
    assert source_kind("https://news.propertydaily.com.au/x", CRITERIA) == "blocked"
    assert source_kind("https://notpropertydaily.com.au/x", CRITERIA) == "other_news"
    assert "propertydaily.com.au" in CRITERIA.source_domains.blocked
    assert CRITERIA.source_domains.property_daily == []  # the list of kept sources stays empty


def test_a_fact_from_property_daily_is_dropped_even_if_it_was_read() -> None:
    facts = make_facts(
        office_m2=fact(2500, PROPERTY_DAILY),
        triggers=[
            TriggerFound(
                id="lease_ending",
                what_happened="x",
                date=None,
                source_url=PROPERTY_DAILY,
                label="confirmed",
            )
        ],
    )
    checked = check_sources(facts, [*SEEN, PROPERTY_DAILY], CRITERIA)
    assert_fully_unknown(checked.facts.office_m2)
    assert checked.facts.triggers == []
    assert checked.dropped == [
        "office_m2: blocked site (propertydaily.com.au). Marked unknown.",
        "trigger lease_ending: blocked site (propertydaily.com.au). Removed.",
    ]
