"""Only Contour's own addresses (PLAN-V17 T2-14, choice 10): the rules Track 1's T1-10 lists for
`core.email.internal.only_internal`, which replaces this one at M5. No database, no network.
"""

import pytest

from core.email.internal import only_internal

OURS = ["contourinteriors.com.au"]


def test_an_address_on_our_domain_is_allowed_in_any_case() -> None:
    allowed, refused = only_internal(
        [
            "jo@contourinteriors.com.au",
            " LEE@ContourInteriors.COM.AU ",
            "jo@contourinteriors.com.au",
        ],
        OURS,
    )
    assert (allowed, refused) == (["jo@contourinteriors.com.au", "lee@contourinteriors.com.au"], [])


@pytest.mark.parametrize(
    "address",
    [
        "jo@contourinteriors.com.au.evil.com",  # our name inside another domain
        "jo@mail.contourinteriors.com.au",  # a sub-domain: the match is exact
        "jo@evilcontourinteriors.com.au",
        "jo@sample.example",
        "contourinteriors.com.au",  # no address at all
        "jo@contourinteriors.com.au@sample.example",
        "Jo Sample <jo@contourinteriors.com.au>",  # a name with it isn't a plain address
    ],
)
def test_anything_else_is_refused_as_given(address: str) -> None:
    assert only_internal([address], OURS) == ([], [address])


def test_one_outside_address_is_named_and_ours_still_listed() -> None:
    allowed, refused = only_internal(
        ["jo@contourinteriors.com.au", "jo@sample.example"], ["contourinteriors.com.au"]
    )
    assert (allowed, refused) == (["jo@contourinteriors.com.au"], ["jo@sample.example"])


def test_an_empty_list_sends_nothing() -> None:
    assert only_internal([], OURS) == ([], [])
    assert only_internal(["   "], OURS) == ([], [])
    # With no domain of our own, nothing is ours.
    assert only_internal(["jo@contourinteriors.com.au"], []) == ([], ["jo@contourinteriors.com.au"])
