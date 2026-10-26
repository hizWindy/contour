"""Merging the same company found more than once. Pure: no Claude, no database."""

import itertools
import random
import time
from typing import Any

import pytest

from apps.lead_finder.context import Signal
from apps.lead_finder.params import DiscoveryParams
from apps.lead_finder.rules import load_rules
from apps.lead_finder.steps.discover import Found, discover_slice
from apps.lead_finder.steps.merge import Merged, merge
from apps.lead_finder.steps.plan import make_slices
from core.config import Settings
from tests.lead_finder.samples import FakeClaude, sample_scenario

RULES = load_rules()


def found(
    name: str,
    *,
    site: str | None = None,
    city: str | None = None,
    trigger: str = "lease_ending",
    url: str | None = None,
    date: str | None = "2026-10-20",
    published: str | None = "2026-10-21",
    what: str = "Something happened.",
    slice_id: str = "melbourne:lease_ending",
) -> Found:
    slug = "".join(ch if ch.isalnum() else "-" for ch in name.lower())
    return Found(
        name=name,
        website=site,
        city=city,
        trigger_id=trigger,
        what_happened=what,
        date=date,
        url=url or f"https://news.example/{slug}-{trigger}",
        published=published,
        slice_id=slice_id,
    )


def names_of(result: list[Merged]) -> list[list[str]]:
    return [m.names for m in result]


# --- The three ways two are the same ---------------------------------------------------------


def test_nothing_in_nothing_out() -> None:
    assert merge([]) == []


def test_one_company_stays_one_with_its_signal() -> None:
    (only,) = merge([found("Boxhill Software", site="boxhill.com.au", city="Melbourne")])
    assert only.name == "Boxhill Software"
    assert only.key == "boxhill software"
    assert only.website == "boxhill.com.au"
    assert only.city == "Melbourne"
    assert only.names == ["Boxhill Software"]
    assert only.signals == [
        Signal(
            trigger_id="lease_ending",
            what_happened="Something happened.",
            url="https://news.example/boxhill-software-lease_ending",
            date="2026-10-20",
            published="2026-10-21",
        )
    ]


def test_the_same_domain_is_the_same_company_whatever_the_names() -> None:
    result = merge(
        [
            found("Unyte", site="unyte.com"),
            found("Unyte Health", site="unyte.com", trigger="merger_or_takeover"),
        ]
    )
    (one,) = result
    assert one.name == "Unyte"  # a tie on how often: the shortest cleaned name
    assert one.names == ["Unyte", "Unyte Health"]
    assert one.website == "unyte.com"
    assert [s.trigger_id for s in one.signals] == ["lease_ending", "merger_or_takeover"]


def test_the_same_domain_is_the_same_company_even_in_different_cities() -> None:
    result = merge(
        [
            found("Acme East", site="acme.com", city="Melbourne"),
            found("Acme West", site="acme.com", city="Perth"),
        ]
    )
    assert len(result) == 1
    assert result[0].city == "Melbourne"  # a tie on how often: the first A to Z


@pytest.mark.parametrize(
    "names",
    [
        ["Acme Pty Ltd", "ACME", "Acme Pty. Ltd.", "acme limited"],
        ["Smith & Co", "Smith and Co", "SMITH AND CO."],
        ["O'Connor Group", "O’Connor Group"],  # noqa: RUF001  (the curly apostrophe is the same name)
    ],
)
def test_the_same_cleaned_name_is_the_same_company(names: list[str]) -> None:
    result = merge([found(name, url=f"https://news.example/{i}") for i, name in enumerate(names)])
    assert len(result) == 1
    assert sorted(result[0].names) == sorted(set(names))
    assert len(result[0].signals) == len(names)


def test_the_same_cleaned_name_is_the_same_company_in_any_city() -> None:
    result = merge([found("Acme", city="Melbourne"), found("ACME Pty Ltd", city="Perth")])
    assert len(result) == 1


def test_close_names_are_the_same_company_when_the_city_is_the_same_or_unknown() -> None:
    for first, second in [("Melbourne", "Melbourne"), ("Melbourne", None), (None, None)]:
        result = merge(
            [found("Cullen Jewellery", city=first), found("Cullen Jewelry", city=second)]
        )
        assert len(result) == 1, (first, second)


def test_close_names_in_different_cities_stay_apart() -> None:
    result = merge(
        [found("Cullen Jewellery", city="Melbourne"), found("Cullen Jewelry", city="Perth")]
    )
    assert len(result) == 2


def test_the_city_is_compared_without_regard_to_case() -> None:
    same = [found("Cullen Jewellery", city="MELBOURNE"), found("Cullen Jewelry", city="melbourne")]
    assert len(merge(same)) == 1


def test_generic_words_do_not_keep_close_names_apart() -> None:
    result = merge(
        [
            found("Cullen Jewellery"),
            found("Cullen Jewellery Group Pty Ltd", url="https://x.example/a"),
        ]
    )
    assert len(result) == 1
    assert result[0].name == "Cullen Jewellery"


@pytest.mark.parametrize(
    ("first", "second"),
    [
        ("Apex", "Apex Plumbing"),
        ("Unyte", "Unyte Health"),
        ("Dollarama", "The Reject Shop"),
        ("Studio 54", "Studio 55"),
        ("Alpha Bay", "Alpha Beta"),
    ],
)
def test_a_name_that_only_shares_a_word_is_not_the_same_company(first: str, second: str) -> None:
    """The core-name guard: the same one the HubSpot match uses, so "Apex" is not "Apex
    Plumbing". Only a shared domain (above) joins these."""
    result = merge([found(first, city="Melbourne"), found(second, city="Melbourne")])
    assert len(result) == 2


def test_a_stricter_fuzzy_setting_keeps_close_names_apart() -> None:
    items = [found("Cullen Jewellery"), found("Cullen Jewelry")]
    assert len(merge(items, 90)) == 1
    assert len(merge(items, 100)) == 2


def test_names_that_clean_to_nothing_never_match_another_name() -> None:
    result = merge([found("Pty Ltd"), found("Pty Limited"), found("Co Pty Ltd")])
    assert len(result) == 3
    same = merge(
        [found("Pty Ltd", url="https://a.example/1"), found("pty ltd", url="https://a.example/2")]
    )
    assert len(same) == 1  # an identical name is still the same


def test_sameness_carries_over_a_chain() -> None:
    result = merge(
        [
            found("Unyte", site="unyte.com"),  # joined to the next by domain
            found("Unyte Health", site="unyte.com"),
            found("UNYTE HEALTH PTY LTD", site="other.com"),  # joined to it by cleaned name
            found("Other Corp", site="other.com"),  # joined to that by domain
            found("Lonely Pty Ltd"),
        ]
    )
    assert [m.name for m in result] == ["Lonely Pty Ltd", "Other Corp"] or len(result) == 2
    big = max(result, key=lambda m: len(m.names))
    expected = {"Unyte", "Unyte Health", "UNYTE HEALTH PTY LTD", "Other Corp"}
    assert sorted(big.names) == sorted(expected)


# --- What is kept ---------------------------------------------------------------------------


def test_every_signal_is_kept_and_only_an_exact_repeat_is_dropped() -> None:
    first = found("Acme Pty Ltd", url="https://a.example/1")
    repeat = found("Acme", url="https://a.example/1")  # the same page, trigger and words
    other_page = found("Acme", url="https://a.example/2")
    other_trigger = found("Acme", trigger="fast_growth", url="https://a.example/1")
    other_words = found("Acme", url="https://a.example/1", what="Another sentence.")
    (one,) = merge([first, repeat, other_page, other_trigger, other_words])
    assert len(one.signals) == 4
    assert one.signals == sorted(
        one.signals,
        key=lambda s: (s.trigger_id, s.url, s.date or "", s.published or "", s.what_happened),
    )


def test_the_name_used_is_the_most_found_then_the_shortest_then_a_to_z() -> None:
    most = merge(
        [
            found("Unyte Health", site="u.com", url="https://a.example/1"),
            found("Unyte Health", site="u.com", url="https://a.example/2"),
            found("Unyte", site="u.com", url="https://a.example/3"),
        ]
    )
    assert most[0].name == "Unyte Health"
    assert most[0].names == ["Unyte Health", "Unyte"]
    shortest = merge([found("Acme Pty Ltd"), found("Acme", url="https://a.example/2")])
    assert shortest[0].name == "Acme"  # the same cleaned length: A to Z puts "Acme" first
    plain = merge([found("Zeta Corp Pty Ltd"), found("ZETA CORP", url="https://a.example/2")])
    assert plain[0].name == "ZETA CORP"  # same cleaned name and length: the first A to Z


def test_the_website_and_the_city_are_the_most_found_and_a_missing_one_never_wins() -> None:
    (one,) = merge(
        [
            found("Acme", site=None, city=None, url="https://a.example/1"),
            found("Acme", site="acme.com.au", city="Perth", url="https://a.example/2"),
            found("Acme", site="acme.com.au", city="Perth", url="https://a.example/3"),
            found("Acme", site="acme.co", city="Melbourne", url="https://a.example/4"),
        ]
    )
    assert one.website == "acme.com.au"
    assert one.city == "Perth"
    nothing = merge([found("Acme")])
    assert (nothing[0].website, nothing[0].city) == (None, None)


def test_the_key_is_the_company_key_of_the_name_and_keys_cover_every_name() -> None:
    (one,) = merge([found("Unyte", site="u.com"), found("Unyte Health Pty Ltd", site="u.com")])
    assert one.key == "unyte"
    assert one.keys == ["unyte", "unyte health"]


def test_the_answer_is_sorted_by_name() -> None:
    result = merge([found("zebra Corp"), found("Alpha Corp"), found("beta Corp")])
    assert [m.name for m in result] == ["Alpha Corp", "beta Corp", "zebra Corp"]


def test_a_merged_company_is_json_simple() -> None:
    (one,) = merge([found("Unyte", site="unyte.com")])
    again = Merged.model_validate(one.model_dump(mode="json"))
    assert again == one
    assert isinstance(again.signals[0], Signal)


# --- The order they arrive in ---------------------------------------------------------------


def test_the_answer_never_depends_on_the_order_the_slices_finished_in() -> None:
    items = [
        found("Unyte", site="unyte.com", city="Melbourne"),
        found("Unyte Health", site="unyte.com", trigger="merger_or_takeover"),
        found("Harbour Foods Pty Ltd", city="Adelaide"),
        found("Harbour Foods", trigger="fast_growth", city="Adelaide"),
        found("Cullen Jewellery"),
        found("Cullen Jewelry", url="https://x.example/c"),
        found("Apex"),
        found("Apex Plumbing"),
    ]
    expected = [m.model_dump() for m in merge(items)]
    assert len(expected) == 5
    rng = random.Random(7)
    for _ in range(60):
        shuffled = items[:]
        rng.shuffle(shuffled)
        assert [m.model_dump() for m in merge(shuffled)] == expected
    for order in itertools.permutations(items[:5]):
        assert [m.model_dump() for m in merge(order)] == [m.model_dump() for m in merge(items[:5])]


def test_merge_does_not_change_what_it_is_given() -> None:
    items = [found("Unyte", site="unyte.com"), found("Unyte Health", site="unyte.com")]
    before = [item.model_dump() for item in items]
    merge(items)
    assert [item.model_dump() for item in items] == before


def test_a_hundred_and_fifty_companies_merge_quickly() -> None:
    rng = random.Random(3)
    syllables = ["ka", "to", "mi", "ra", "ne", "lo", "su", "vi", "ba", "do"]
    items = [
        found(
            "".join(rng.choice(syllables) for _ in range(4)).title() + f" {n}",
            url=f"https://n.example/{n}",
        )
        for n in range(150)
    ]
    start = time.perf_counter()
    result = merge(items)
    assert time.perf_counter() - start < 3
    assert 1 <= len(result) <= 150


# --- With the discovery step ----------------------------------------------------------------


async def test_the_sample_world_merges_into_five_companies_with_every_signal() -> None:
    params = DiscoveryParams(
        cities=["Melbourne", "Adelaide", "Perth"],
        triggers=["lease_ending", "merger_or_takeover", "fast_growth"],
    )
    claude = FakeClaude(scenario=sample_scenario())
    settings = Settings(_env_file=None)
    candidates: list[Found] = []
    for item in make_slices(params, RULES):
        result = await discover_slice(
            claude,
            RULES,
            settings,
            item,
            30,
            __import__("datetime").date(2026, 10, 26),
            cities=params.cities,
        )
        candidates += result.candidates
    assert len(candidates) == 7

    merged = merge(candidates, settings.match_fuzzy_min)
    summary: list[tuple[Any, ...]] = [
        (m.name, m.names, m.website, m.city, len(m.signals)) for m in merged
    ]
    assert summary == [
        ("Boxhill Software", ["Boxhill Software"], "boxhillsoftware.com.au", "Melbourne", 1),
        ("Harbour Foods", ["Harbour Foods", "Harbour Foods Pty Ltd"], None, "Adelaide", 2),
        ("Kent Town Legal", ["Kent Town Legal"], None, "Adelaide", 1),
        ("Unyte", ["Unyte", "Unyte Health"], "unyte.com", "Melbourne", 2),
        ("West Perth Mining Services", ["West Perth Mining Services"], None, "Perth", 1),
    ]
