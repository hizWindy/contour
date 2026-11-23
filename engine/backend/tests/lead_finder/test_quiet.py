"""New leads only (PLAN-V27 Part 1): when a HubSpot company counts as new, and the choose rule
that leaves the others out of a Find new leads run. Pure: no Claude, no database."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

import pytest

from apps.lead_finder.context import Signal
from apps.lead_finder.quiet import QUIET, is_quiet, months_before, quiet_check
from apps.lead_finder.rules import load_rules
from apps.lead_finder.steps.choose import Decision, ExistingLead, decide
from apps.lead_finder.steps.merge import Merged
from apps.lead_finder.tables import company_key
from core.config import Settings
from core.hubspot.matching import HubSpotMatch, MatchCandidate

RULES = load_rules()
TODAY = date(2026, 11, 24)
NEWS = "https://news.example.com/a-story"


@dataclass(frozen=True)
class Params:
    recheck: bool = False


def company(name: str) -> Merged:
    return Merged(
        name=name,
        key=company_key(name),
        website=None,
        city="Melbourne",
        names=[name],
        signals=[
            Signal(
                trigger_id="fast_growth",
                what_happened="It grew.",
                url=NEWS,
                date="2026-11-01",
                published=None,
            )
        ],
    )


def in_hubspot(hubspot_id: str, status: str = "in_hubspot", by: str = "domain") -> HubSpotMatch:
    return HubSpotMatch(
        status=status,  # type: ignore[arg-type]
        hubspot_id=hubspot_id,
        name="Sample",
        matched_by=by,  # type: ignore[arg-type]
        last_dissolved=date(2024, 1, 10) if status == "dissolved_deal" else None,
    )


def maybe() -> HubSpotMatch:
    return HubSpotMatch(
        status="possible_match",
        matched_by="same_name",
        candidates=[
            MatchCandidate(
                hubspot_id="9", name="Northwind", owner=None, reason="same_name", score=1.0
            )
        ],
    )


def choose(
    companies: list[Merged],
    matches: dict[str, HubSpotMatch],
    activity: Mapping[str, date | None],
    *,
    months: int = 12,
    new_only: bool = True,
    limit: int = 20,
    leads: list[ExistingLead] | None = None,
) -> Decision:
    return decide(
        companies,
        matches,
        leads or [],
        RULES,
        Params(),
        TODAY,
        limit,
        Settings(_env_file=None, hubspot_quiet_months=months),
        new_only=new_only,
        activity=activity,
    )


# --- Quiet --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("today", "months", "expected"),
    [
        (date(2026, 11, 24), 12, date(2025, 11, 24)),
        (date(2026, 3, 31), 1, date(2026, 2, 28)),  # a shorter month: its last day
        (date(2028, 3, 31), 1, date(2028, 2, 29)),  # a leap year
        (date(2026, 1, 15), 14, date(2024, 11, 15)),
    ],
)
def test_months_before(today: date, months: int, expected: date) -> None:
    assert months_before(today, months) == expected


def test_quiet_is_no_activity_for_the_months_or_none_at_all() -> None:
    assert is_quiet(date(2026, 9, 24), 12, TODAY) is False  # worked 2 months ago
    assert is_quiet(date(2025, 9, 24), 12, TODAY) is True  # 14 months ago
    assert is_quiet(None, 12, TODAY) is True  # never worked
    assert is_quiet(date(2020, 1, 1), 0, TODAY) is False  # 0: nothing is ever quiet
    assert is_quiet(None, 0, TODAY) is False


def test_only_a_plain_or_dissolved_hubspot_company_can_be_quiet() -> None:
    old = date(2024, 5, 1)
    assert quiet_check(in_hubspot("1"), old, 12, TODAY).status == QUIET
    assert quiet_check(in_hubspot("1", "dissolved_deal"), old, 12, TODAY).status == QUIET
    assert quiet_check(in_hubspot("1", "open_deal"), old, 12, TODAY).status == "open_deal"
    assert quiet_check(maybe(), old, 12, TODAY).status == "possible_match"
    assert quiet_check(HubSpotMatch(status="new"), None, 12, TODAY).status == "new"
    kept = quiet_check(in_hubspot("1"), date(2026, 10, 1), 12, TODAY)
    assert (kept.status, kept.last_activity) == ("in_hubspot", date(2026, 10, 1))


# --- The choose rule (T1-2) ---------------------------------------------------------------------


def test_a_hubspot_company_worked_two_months_ago_is_left_out_and_counted_once() -> None:
    recent, quiet, fresh = company("Recent Co"), company("Quiet Co"), company("Fresh Co")
    matches = {recent.key: in_hubspot("1"), quiet.key: in_hubspot("2")}
    decision = choose(
        [recent, quiet, fresh], matches, {"1": date(2026, 9, 24), "2": date(2025, 9, 24)}
    )
    assert sorted(c.name for c in decision.chosen) == ["Fresh Co", "Quiet Co"]
    assert decision.left_out_hubspot == ["Recent Co"]
    assert decision.skipped == []  # said once, as a count, not one line each


def test_a_company_with_no_activity_date_is_quiet_and_researched() -> None:
    never = company("Never Worked Co")
    decision = choose([never], {never.key: in_hubspot("3")}, {"3": None})
    assert [c.name for c in decision.chosen] == ["Never Worked Co"]


def test_zero_months_leaves_out_every_hubspot_company() -> None:
    recent, quiet = company("Recent Co"), company("Quiet Co")
    matches = {recent.key: in_hubspot("1"), quiet.key: in_hubspot("2")}
    activity = {"1": date(2026, 9, 24), "2": date(2025, 9, 24)}
    decision = choose([recent, quiet], matches, activity, months=0)
    assert decision.chosen == []
    assert sorted(decision.left_out_hubspot) == ["Quiet Co", "Recent Co"]


def test_an_open_deal_is_left_out_as_before_even_when_quiet() -> None:
    deal = company("Deal Co")
    matches = {deal.key: in_hubspot("4", "open_deal")}
    decision = choose([deal], matches, {"4": date(2020, 1, 1)})
    assert decision.chosen == [] and decision.left_out_hubspot == ["Deal Co"]


def test_an_old_dissolved_deal_follows_the_activity() -> None:
    worked, quiet = company("Worked Co"), company("Quiet Co")
    matches = {
        worked.key: in_hubspot("5", "dissolved_deal"),
        quiet.key: in_hubspot("6", "dissolved_deal"),
    }
    decision = choose([worked, quiet], matches, {"5": date(2026, 8, 1), "6": None})
    assert [c.name for c in decision.chosen] == ["Quiet Co"]
    assert decision.left_out_hubspot == ["Worked Co"]


def test_a_maybe_is_researched() -> None:
    unsure = company("Northwind")
    decision = choose([unsure], {unsure.key: maybe()}, {})
    assert [c.name for c in decision.chosen] == ["Northwind"]
    assert decision.left_out_hubspot == []


def test_a_match_the_matcher_was_not_sure_of_is_never_left_out() -> None:
    """Choice 26: only the HubSpot id, the domain or the exact name in the same city is sure."""
    loose = company("Loose Co")
    match = in_hubspot("7", by="close_name")
    decision = choose([loose], {loose.key: match}, {"7": date(2026, 11, 1)})
    assert [c.name for c in decision.chosen] == ["Loose Co"]


def test_without_new_only_the_old_rules_apply() -> None:
    """The watchlist and typed companies keep today's rules: only a deal leaves a company out."""
    recent = company("Recent Co")
    decision = choose(
        [recent], {recent.key: in_hubspot("1")}, {"1": date(2026, 11, 1)}, new_only=False
    )
    assert [c.name for c in decision.chosen] == ["Recent Co"]


def test_companies_left_out_do_not_use_up_the_limit() -> None:
    hubspot = [company(f"Known {n}") for n in range(5)]
    new = [company(f"New {n}") for n in range(5)]
    matches = {c.key: in_hubspot(str(n)) for n, c in enumerate(hubspot)}
    activity: dict[str, date | None] = {str(n): date(2026, 11, 1) for n in range(5)}
    decision = choose([*hubspot, *new], matches, activity, limit=5)
    assert sorted(c.name for c in decision.chosen) == [f"New {n}" for n in range(5)]
    assert decision.over_limit_count == 0


# --- The replay check (choice 27) ---------------------------------------------------------------


def _replay_set() -> tuple[list[Merged], dict[str, HubSpotMatch], dict[str, date | None]]:
    """A made-up set shaped like the laptop's runs of 27 Oct to 2 Nov (TBC: the live runs, S2):
    52 companies, 17 new, 29 in HubSpot (24 with a deal: 12 open, 12 dissolved long ago; 5 plain),
    and 6 maybes. Of the 17 without an open deal, about a third were worked in the last year."""
    companies: list[Merged] = []
    matches: dict[str, HubSpotMatch] = {}
    activity: dict[str, date | None] = {}
    for n in range(17):
        c = company(f"New {n:02}")
        companies.append(c)
        matches[c.key] = HubSpotMatch(status="new")
    for n in range(12):
        c = company(f"Open {n:02}")
        companies.append(c)
        matches[c.key] = in_hubspot(f"o{n}", "open_deal")
        activity[f"o{n}"] = date(2026, 10, 1)
    for n in range(12):
        c = company(f"Dissolved {n:02}")
        companies.append(c)
        matches[c.key] = in_hubspot(f"d{n}", "dissolved_deal")
        activity[f"d{n}"] = date(2026, 6, 1) if n % 3 == 0 else date(2024, 6, 1)
    for n in range(5):
        c = company(f"Plain {n:02}")
        companies.append(c)
        matches[c.key] = in_hubspot(f"p{n}")
        activity[f"p{n}"] = date(2026, 6, 1) if n % 3 == 0 else None
    for n in range(6):
        c = company(f"Maybe {n:02}")
        companies.append(c)
        matches[c.key] = maybe()
    return companies, matches, activity


def _not_in_hubspot(decision: Decision, matches: dict[str, HubSpotMatch]) -> int:
    return sum(1 for c in decision.chosen if matches[c.key].status in ("new", "possible_match"))


@pytest.mark.parametrize("limit", [10, 20, 25, 50, 100])
def test_the_new_rules_keep_at_least_as_many_companies_not_in_hubspot(limit: int) -> None:
    companies, matches, activity = _replay_set()
    before = choose(companies, matches, activity, new_only=False, limit=limit)
    after = choose(companies, matches, activity, new_only=True, limit=limit)
    assert _not_in_hubspot(after, matches) >= _not_in_hubspot(before, matches)
    # And nothing HubSpot has, worked in the last year, takes a place
    for c in after.chosen:
        match = matches[c.key]
        if match.hubspot_id is not None:
            last = activity.get(match.hubspot_id)
            assert last is None or last < date(2025, 11, 24)
