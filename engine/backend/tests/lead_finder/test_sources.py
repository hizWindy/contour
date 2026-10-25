"""The source check: every fact needs a link to a page the engine actually read."""

import pytest

from apps.lead_finder.fields import TriggerFound
from apps.lead_finder.rules import load_rules
from apps.lead_finder.sources import check_sources, missing_facts, source_kind, url_key
from tests.lead_finder.samples import ASX, NEWS, SITE, fact, make_facts

CRITERIA = load_rules().criteria
SEEN = [NEWS, ASX, SITE]


def test_facts_with_pages_we_read_are_kept() -> None:
    checked = check_sources(make_facts(), SEEN, CRITERIA)
    assert checked.dropped == []
    assert checked.facts.office_m2.value == 2500


def test_a_link_we_never_read_makes_the_fact_unknown() -> None:
    facts = make_facts(office_m2=fact(2500, "https://made-up.example/page"))
    checked = check_sources(facts, SEEN, CRITERIA)
    assert checked.facts.office_m2.value is None
    assert checked.dropped[0].startswith("office_m2: link not among the pages read")


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
