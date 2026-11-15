"""No contact details are stored or sent to Claude (AGENTS.md, Safety): `scrub` blanks every email
address and phone number. A date written with dashes or dots has 8 digits too, and is kept
(PLAN-V17 T2-5), so a lease date typed in a call note isn't lost. No database, no network.
"""

import pytest

from apps.companies.facts import EMAIL_GONE, PHONE_GONE, scrub


@pytest.mark.parametrize("date", ["31-03-2028", "31.03.2028", "2028-03-31", "1-3-2028", "2028.3.1"])
def test_a_date_with_dashes_or_dots_is_kept(date: str) -> None:
    assert scrub(date) == date


@pytest.mark.parametrize(
    "number",
    [
        "0412 345 678",
        "+61 8 9000 0000",
        "(08) 9000-0000",
        "0412-345-678",
        "0412345678",
        "13-31-2028",  # no month 31: not a date
        "31-03-1899",  # a year out of range: not a date
        "31-03.2028",  # two kinds of mark: not a date
    ],
)
def test_a_phone_number_is_still_blanked(number: str) -> None:
    assert scrub(number) == PHONE_GONE


def test_a_note_keeps_its_date_and_loses_its_number_and_email() -> None:
    note = "Lease ends 31-03-2028. Ring Jo on 0412 345 678 or email jo.sample@sample.example."
    assert scrub(note) == (f"Lease ends 31-03-2028. Ring Jo on {PHONE_GONE} or email {EMAIL_GONE}.")
