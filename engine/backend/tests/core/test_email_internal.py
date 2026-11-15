"""Only Contour addresses get a pre-read (PLAN-V17 T1-10): exact domains, no look-alikes."""

import pytest

from core.config import Settings
from core.email.internal import only_internal

OURS = ["contourinteriors.com.au"]


def test_a_contour_address_is_allowed() -> None:
    assert only_internal(["jo.sample@contourinteriors.com.au"], OURS) == (
        ["jo.sample@contourinteriors.com.au"],
        [],
    )


@pytest.mark.parametrize(
    "address",
    [
        "jo@contourinteriors.com.au.evil.com",  # our domain at the front of someone else's
        "jo@evil-contourinteriors.com.au",
        "jo@evilcontourinteriors.com.au",
        "jo@contourinteriors.com",
        "jo@mail.contourinteriors.com.au",  # a sub-domain is not on the list
        "jo@contourinteriors.com.au.",
        "jo@contour" + chr(0x456) + "nteriors.com.au",  # a Cyrillic i that looks like ours
        "jo@contourinteriors.com.au@evil.com",
        "jo@evil.com@contourinteriors.com.au",  # two @: not one plain address
        "Jo Sample <jo@contourinteriors.com.au>",
        "jo sample@contourinteriors.com.au",
        "@contourinteriors.com.au",
        ".jo@contourinteriors.com.au",
        "jo..sample@contourinteriors.com.au",
        "contourinteriors.com.au",
    ],
)
def test_a_look_alike_or_a_broken_address_is_refused(address: str) -> None:
    assert only_internal([address], OURS) == ([], [address])


def test_upper_case_and_spaces_still_match_and_come_back_plain() -> None:
    checked = only_internal(["  Jo.Sample@ContourInteriors.COM.AU "], [" ContourInteriors.com.au "])
    assert checked.allowed == ["jo.sample@contourinteriors.com.au"]
    assert checked.refused == []


def test_an_empty_list_gives_nothing_either_way() -> None:
    assert only_internal([], OURS) == ([], [])


def test_blanks_are_skipped_and_each_address_comes_back_once() -> None:
    checked = only_internal(
        [
            "",
            "   ",
            "jo.sample@contourinteriors.com.au",
            "JO.SAMPLE@contourinteriors.com.au",
            "pat@example.com",
            "pat@example.com",
        ],
        OURS,
    )
    assert checked == (["jo.sample@contourinteriors.com.au"], ["pat@example.com"])


def test_no_domains_refuses_everyone() -> None:
    assert only_internal(["jo.sample@contourinteriors.com.au"], []) == (
        [],
        ["jo.sample@contourinteriors.com.au"],
    )


def test_it_reads_the_setting_as_it_comes() -> None:
    """The default setting is Contour's own domain (TBC with Levi), and more can be listed."""
    domains = Settings(_env_file=None).internal_email_domains
    assert only_internal(["jo@contourinteriors.com.au", "pat@example.com"], domains) == (
        ["jo@contourinteriors.com.au"],
        ["pat@example.com"],
    )
    two = Settings(_env_file=None, internal_email_domains=["contourinteriors.com.au", "contour.nz"])
    assert only_internal(["kim@contour.nz"], two.internal_email_domains).allowed == [
        "kim@contour.nz"
    ]


def test_both_lists_may_be_read_once_and_the_answer_unpacks_as_two_lists() -> None:
    """Track 2's call (its stand-in until M5) unpacks (allowed, refused) and may pass any list."""
    addresses = (address for address in ["jo@contourinteriors.com.au", "pat@example.com"])
    domains = (domain for domain in OURS)
    allowed, refused = only_internal(addresses, domains)
    assert (allowed, refused) == (["jo@contourinteriors.com.au"], ["pat@example.com"])
