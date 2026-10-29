"""Choosing which companies to research, and ranking them. Pure: no Claude, no database."""

import random
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import pytest

from apps.lead_finder.context import Signal
from apps.lead_finder.rules import load_rules
from apps.lead_finder.steps.choose import (
    OVER_LIMIT_REASON,
    Decision,
    ExistingLead,
    decide,
    rank,
    rank_candidate,
    signal_day,
    signal_points,
)
from apps.lead_finder.steps.merge import Merged
from apps.lead_finder.tables import company_key
from core.config import Settings
from core.hubspot.matching import HubSpotMatch, MatchCandidate

RULES = load_rules()
TODAY = date(2026, 10, 26)
SETTINGS = Settings(_env_file=None)  # memory_fresh_days = 30
NEWS = "https://www.afr.com/property/a-story"
ASX = "https://www.asx.com.au/announcements/a-story"


@dataclass(frozen=True)
class Params:
    recheck: bool = False


def signal(
    trigger: str = "fast_growth",
    when: str | None = "2026-10-10",
    *,
    url: str = NEWS,
    published: str | None = None,
) -> Signal:
    return Signal(
        trigger_id=trigger, what_happened="It happened.", url=url, date=when, published=published
    )


def company(
    name: str, *signals: Signal, website: str | None = None, aliases: tuple[str, ...] = ()
) -> Merged:
    return Merged(
        name=name,
        key=company_key(name),
        website=website,
        city="Melbourne",
        names=[name, *aliases],
        signals=list(signals) or [signal()],
    )


def lead(
    name: str,
    status: str = "new",
    *,
    days_ago: int = 100,
    decided_days_ago: int | None = None,
    is_test: bool = False,
) -> ExistingLead:
    now = datetime(2026, 10, 26, 12, tzinfo=UTC)
    return ExistingLead(
        company_key=company_key(name),
        status=status,
        created_at=now - timedelta(days=days_ago),
        updated_at=None if decided_days_ago is None else now - timedelta(days=decided_days_ago),
        is_test=is_test,
    )


def choose(
    companies: list[Merged],
    matches: dict[str, HubSpotMatch] | None = None,
    leads: list[ExistingLead] | None = None,
    *,
    recheck: bool = False,
    max_companies: int = 20,
) -> Decision:
    return decide(
        companies,
        matches or {},
        leads or [],
        RULES,
        Params(recheck=recheck),
        TODAY,
        max_companies,
        SETTINGS,
    )


def chosen_names(companies: list[Merged], **kwargs: object) -> list[str]:
    return [c.name for c in choose(companies, **kwargs).chosen]  # type: ignore[arg-type]


# --- Points for one signal ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sig", "points"),
    [
        # trigger group + timing + source kind (main 15, other 10, weak 4; news 5, ASX 8)
        (signal("fast_growth", "2026-10-10"), 15 + 6 + 5),  # 16 days ago
        (signal("fast_growth", "2026-08-01"), 15 + 4 + 5),  # 86 days ago
        (signal("fast_growth", "2026-03-01"), 15 + 2 + 5),  # 239 days ago
        (signal("fast_growth", "2025-01-01"), 15 + 0 + 5),  # older than 12 months: no timing
        (signal("fast_growth", None), 15 + 1 + 5),  # undated
        (signal("fast_growth", None, published="2026-10-20"), 15 + 6 + 5),  # the page's date
        (signal("merger_or_takeover", "2027-03-01"), 15 + 6 + 5),  # announced, still to come
        (signal("merger_or_takeover", "2031-01-01"), 15 + 0 + 5),  # too far ahead
        (signal("restructure", "2026-10-20"), 10 + 6 + 5),
        (signal("new_ceo", "2026-10-20"), 10 + 6 + 5),  # a leadership change: Other, not Weak
        (signal("hiring_push", "2026-10-20"), 4 + 6 + 5),
        (signal("fast_growth", "2026-10-10", url=ASX), 15 + 6 + 8),
        (signal("lease_ending", "2028-06-01"), 15 + 6 + 5),  # 1 to 3 years out: the best window
        (signal("lease_ending", "2027-03-01"), 15 + 2 + 5),  # under a year: the lowest step
        (signal("lease_ending", "2024-01-01"), 15 + 0 + 5),  # already ended
        (signal("lease_ending", None, published="2026-10-20"), 15 + 1 + 5),  # a page date is not
        (signal("not_a_trigger", "2026-10-20"), 0),  # the end of the lease
    ],
)
def test_signal_points(sig: Signal, points: int) -> None:
    assert signal_points(sig, RULES, TODAY) == points


def test_the_company_own_website_counts_as_an_official_source() -> None:
    own = signal("fast_growth", "2026-10-10", url="https://boxhill.com.au/news/growing")
    assert signal_points(own, RULES, TODAY) == 15 + 6 + 5
    assert signal_points(own, RULES, TODAY, company_domain="boxhill.com.au") == 15 + 6 + 8


def test_the_news_day_of_a_lease_is_the_page_date_not_when_the_lease_ends() -> None:
    lease = signal("lease_ending", "2028-06-01", published="2026-10-01")
    assert signal_day(lease) == date(2026, 10, 1)
    assert signal_day(signal("lease_ending", "2028-06-01")) is None
    assert signal_day(signal("fast_growth", "2026-09-01", published="2026-10-01")) == date(
        2026, 9, 1
    )
    assert signal_day(signal("fast_growth", None, published="2026-10")) == date(2026, 10, 1)


def test_a_company_ranks_by_its_best_signal() -> None:
    weak_and_strong = company("Both", signal("hiring_push", "2026-10-20"), signal("fast_growth"))
    assert rank_candidate(weak_and_strong, RULES, TODAY) == 15 + 6 + 5
    assert rank_candidate(company("Nothing known", signal("not_a_trigger")), RULES, TODAY) == 0


def test_rank_is_best_first_then_by_name_and_never_depends_on_the_input_order() -> None:
    companies = [
        company("Weak Co", signal("hiring_push", "2026-10-20")),
        company("beta Partners", signal("fast_growth", url=ASX)),
        company("Alpha Partners", signal("fast_growth", url=ASX)),  # same points as beta
        company("Middle Co", signal("restructure", "2026-10-20")),
    ]
    expected = ["Alpha Partners", "beta Partners", "Middle Co", "Weak Co"]
    for _ in range(20):
        shuffled = random.sample(companies, len(companies))
        assert [c.name for c in rank(shuffled, RULES, TODAY)] == expected


# --- HubSpot -------------------------------------------------------------------------------


def test_an_open_deal_is_skipped_with_the_deal_names() -> None:
    acme = company("Acme Software")
    matches = {acme.key: HubSpotMatch(status="open_deal", open_deals=["Acme 2,000 m²"])}

    decision = choose([acme, company("Boxhill")], matches)

    assert [c.name for c in decision.chosen] == ["Boxhill"]
    assert decision.skipped == [("Acme Software", "Open deal in HubSpot: Acme 2,000 m²")]


def test_a_deal_dissolved_this_year_waits_twelve_months() -> None:
    patties = company("Patties Food Group", signal("fast_growth", "2026-09-01"))
    matches = {patties.key: HubSpotMatch(status="dissolved_deal", last_dissolved=date(2026, 10, 7))}

    decision = choose([patties], matches)

    assert decision.chosen == []
    assert decision.skipped == [
        (
            "Patties Food Group",
            "Deal dissolved 2026-10-07. Wait until 2027-10-07, unless a new trigger",
        )
    ]


def test_a_signal_newer_than_the_dissolved_deal_brings_it_back() -> None:
    patties = company("Patties Food Group", signal("fast_growth", "2026-10-20"))
    matches = {patties.key: HubSpotMatch(status="dissolved_deal", last_dissolved=date(2026, 10, 7))}
    assert chosen_names([patties], matches=matches) == ["Patties Food Group"]


def test_a_lease_signal_counts_as_newer_only_by_its_page_date() -> None:
    dissolved = HubSpotMatch(status="dissolved_deal", last_dissolved=date(2026, 10, 7))
    # The lease ends after the deal closed, but the news is older: still waiting.
    old_news = company("Old News", signal("lease_ending", "2028-06-01", published="2026-09-01"))
    new_news = company("New News", signal("lease_ending", "2028-06-01", published="2026-10-20"))
    matches = {old_news.key: dissolved, new_news.key: dissolved}
    assert chosen_names([old_news, new_news], matches=matches) == ["New News"]


def test_a_deal_dissolved_long_ago_does_not_block() -> None:
    old = company("Old Deal Co")
    matches = {old.key: HubSpotMatch(status="dissolved_deal", last_dissolved=date(2025, 6, 1))}
    assert chosen_names([old], matches=matches) == ["Old Deal Co"]


@pytest.mark.parametrize(
    "match",
    [
        HubSpotMatch(status="new"),
        HubSpotMatch(status="in_hubspot", hubspot_id="1", name="Acme Software"),
        HubSpotMatch(
            status="possible_match",
            candidates=[
                MatchCandidate(
                    hubspot_id="2",
                    name="Acme Group",
                    owner=None,
                    reason="close_name",
                    score=0.92,
                    open_deals=["Acme Group fitout"],
                )
            ],
        ),
    ],
)
def test_other_hubspot_answers_never_skip(match: HubSpotMatch) -> None:
    acme = company("Acme Software")
    assert chosen_names([acme], matches={acme.key: match}) == ["Acme Software"]


# --- Leads that already exist ----------------------------------------------------------------


def test_a_fresh_lead_is_skipped_and_says_how_old_it_is() -> None:
    decision = choose(
        [company("Acme Software"), company("Boxhill")],
        leads=[lead("Acme Software", days_ago=10), lead("Boxhill", days_ago=1)],
    )
    assert decision.chosen == []
    assert decision.skipped == [
        ("Acme Software", "researched 10 days ago (memory is fresh for 30 days)"),
        ("Boxhill", "researched 1 day ago (memory is fresh for 30 days)"),
    ]


def test_a_lead_older_than_the_fresh_days_is_researched_again() -> None:
    assert chosen_names([company("Acme")], leads=[lead("Acme", days_ago=30)]) == ["Acme"]
    assert chosen_names([company("Acme")], leads=[lead("Acme", days_ago=29)]) == []


def test_a_recheck_ignores_the_fresh_rule() -> None:
    fresh = [lead("Acme", days_ago=2)]
    assert chosen_names([company("Acme")], leads=fresh, recheck=True) == ["Acme"]


def test_test_leads_never_count() -> None:
    leads = [lead("Acme", days_ago=2, is_test=True), lead("Acme", "rejected", is_test=True)]
    assert chosen_names([company("Acme")], leads=leads) == ["Acme"]


def test_a_lead_saved_under_another_name_of_the_company_is_found() -> None:
    acme = company("Acme Software", aliases=("Acme Software Pty Ltd", "ACME Holdings"))
    decision = choose([acme], leads=[lead("ACME Holdings", days_ago=3)])
    assert decision.skipped == [
        ("Acme Software", "researched 3 days ago (memory is fresh for 30 days)")
    ]


@pytest.mark.parametrize("status", ["sent", "rejected"])
def test_a_sent_or_rejected_lead_is_skipped_unless_something_newer_was_found(status: str) -> None:
    decided = [lead("Acme", status, days_ago=60, decided_days_ago=40)]  # decided 2026-09-16
    older = company("Acme", signal("fast_growth", "2026-09-01"))
    newer = company("Acme", signal("fast_growth", "2026-10-01"))

    assert choose([older], leads=decided).skipped == [
        ("Acme", f"already {status} on 2026-09-16, and nothing newer was found")
    ]
    assert chosen_names([newer], leads=decided) == ["Acme"]


def test_the_decision_date_is_when_it_was_created_if_never_changed() -> None:
    decided = [lead("Acme", "rejected", days_ago=60)]  # 2026-08-27
    skipped = choose([company("Acme", signal("fast_growth", "2026-08-01"))], leads=decided).skipped
    assert skipped == [("Acme", "already rejected on 2026-08-27, and nothing newer was found")]


def test_watching_or_new_leads_older_than_fresh_do_not_block() -> None:
    leads = [lead("Acme", "watching", days_ago=90), lead("Acme", "new", days_ago=200)]
    assert chosen_names([company("Acme")], leads=leads) == ["Acme"]


def test_an_open_deal_is_the_reason_given_before_a_fresh_lead() -> None:
    acme = company("Acme")
    decision = choose(
        [acme],
        matches={acme.key: HubSpotMatch(status="open_deal", open_deals=["Acme lease"])},
        leads=[lead("Acme", days_ago=1)],
    )
    assert decision.skipped == [("Acme", "Open deal in HubSpot: Acme lease")]


# --- The company limit -----------------------------------------------------------------------


def test_the_top_companies_are_kept_and_the_rest_counted() -> None:
    companies = [
        company("Weak Co", signal("hiring_push", "2026-10-20")),
        company("Best Co", signal("fast_growth", url=ASX)),
        company("Middle Co", signal("restructure", "2026-10-20")),
        company("Good Co", signal("fast_growth")),
        company("Lowest Co", signal("hiring_push", "2025-01-01")),
    ]
    decision = choose(companies, max_companies=2)
    assert [c.name for c in decision.chosen] == ["Best Co", "Good Co"]
    assert decision.over_limit_count == 3
    assert decision.skipped == []  # the over-limit ones are counted, not listed
    assert OVER_LIMIT_REASON == "over the run's company limit"


def test_skipped_companies_do_not_use_up_the_limit() -> None:
    acme = company("Acme", signal("fast_growth", url=ASX))
    matches = {acme.key: HubSpotMatch(status="open_deal", open_deals=["A deal"])}
    decision = choose([acme, company("Boxhill"), company("Cobalt")], matches, max_companies=2)
    assert [c.name for c in decision.chosen] == ["Boxhill", "Cobalt"]
    assert decision.over_limit_count == 0


@pytest.mark.parametrize("limit", [0, -1])
def test_a_limit_of_zero_keeps_nobody(limit: int) -> None:
    decision = choose([company("Acme"), company("Boxhill")], max_companies=limit)
    assert decision.chosen == []
    assert decision.over_limit_count == 2


def test_nothing_in_nothing_out() -> None:
    decision = choose([])
    assert (decision.chosen, decision.skipped, decision.over_limit_count) == ([], [], 0)


def test_the_answer_never_depends_on_the_input_order() -> None:
    companies = [
        company(f"Company {n}", signal("fast_growth", f"2026-10-{n:02d}")) for n in range(1, 13)
    ]
    leads = [lead("Company 3", days_ago=5), lead("Company 7", "rejected", decided_days_ago=40)]
    first = choose(companies, leads=leads, max_companies=5)
    for _ in range(20):
        again = choose(random.sample(companies, len(companies)), leads=leads, max_companies=5)
        assert again == first
    assert [name for name, _ in first.skipped] == ["Company 3"]  # 7 has a newer signal
    assert len(first.chosen) == 5
    assert first.over_limit_count == 6


def test_unranked_keeps_the_order_the_companies_came_in() -> None:
    companies = [
        company("Zed Co", signal("hiring_push", "2026-10-20")),
        company("Best Co", signal("fast_growth", url=ASX)),
        company("Middle Co"),
    ]
    decision = decide(companies, {}, [], RULES, Params(), TODAY, 2, SETTINGS, ranked=False)
    assert [c.name for c in decision.chosen] == ["Zed Co", "Best Co"]
    assert decision.over_limit_count == 1
