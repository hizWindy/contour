"""No contact details are stored or sent to Claude (AGENTS.md, Safety): `scrub` blanks every email
address and phone number. A date written with dashes, dots or slashes has 8 digits too, and is
kept (PLAN-V17 T2-5), so a lease date typed in a call note isn't lost. An email said out loud, or
typed half way, is blanked too (T2-9). No database, no network.
"""

import pytest

from apps.companies.facts import EMAIL_GONE, PHONE_GONE, scrub


@pytest.mark.parametrize(
    "date",
    [
        "31-03-2028",
        "31.03.2028",
        "2028-03-31",
        "1-3-2028",
        "2028.3.1",
        "31/03/2028",
        "2028/03/31",
        "1/3/2028",
    ],
)
def test_a_date_with_dashes_dots_or_slashes_is_kept(date: str) -> None:
    assert scrub(date) == date


@pytest.mark.parametrize(
    "number",
    [
        "0412 345 678",
        "+61 8 9000 0000",
        "(08) 9000-0000",
        "0412-345-678",
        "0412345678",
        "0412/345/678",
        "08/9000/0000",
        "13-31-2028",  # no month 31: not a date
        "31-03-1899",  # a year out of range: not a date
        "31-03.2028",  # two kinds of mark: not a date
        "31/03-2028",
        "13/31/2028",  # no month 31 either way round
    ],
)
def test_a_phone_number_is_still_blanked(number: str) -> None:
    assert scrub(number) == PHONE_GONE


def test_a_note_keeps_its_date_and_loses_its_number_and_email() -> None:
    note = "Lease ends 31-03-2028. Ring Jo on 0412 345 678 or email jo.sample@sample.example."
    assert scrub(note) == (f"Lease ends 31-03-2028. Ring Jo on {PHONE_GONE} or email {EMAIL_GONE}.")


def test_a_slashed_date_stays_and_a_slashed_number_goes() -> None:
    note = "Lease ends 31/03/2028 (or 2028/03/31 on their form). Ring 0412/345/678."
    assert scrub(note) == f"Lease ends 31/03/2028 (or 2028/03/31 on their form). Ring {PHONE_GONE}."


@pytest.mark.parametrize(
    ("said", "left"),
    [
        ("Email jo at sample dot com dot au.", f"Email {EMAIL_GONE}."),
        ("Email jo at sample.com.au today.", f"Email {EMAIL_GONE} today."),
        ("Write to jo dot sample at sample dot com", f"Write to {EMAIL_GONE}"),
        ("Jo AT Sample DOT com", EMAIL_GONE),
        ("jo (at) sample dot com", EMAIL_GONE),
        ("jo [at] sample.com", EMAIL_GONE),
        ("jo @ sample.com.au", EMAIL_GONE),
        ("jo@sample dot com", EMAIL_GONE),
        ("o'brien at sample.net.au", EMAIL_GONE),
    ],
)
def test_an_email_said_out_loud_or_half_typed_is_blanked(said: str, left: str) -> None:
    assert scrub(said) == left


@pytest.mark.parametrize(
    "words",
    [
        "Meeting at 10.30 on Tuesday.",
        "They are at level 3 of 120 Collins St.",
        "Call back at 9.30am, or at 4.30 pm.",
        "Spoke to Jo at Sample Logistics. She was at home.",
        "A lift at No.5 and a lease at 2.5 floors.",
        "The fitout was A$12,500,000 in 2019.",  # money: a comma is never a separator
        "Two options at 1,250 and 2,400 square metres.",
    ],
)
def test_ordinary_words_with_at_dots_or_money_stay(words: str) -> None:
    assert scrub(words) == words


def test_a_number_beside_a_said_email_is_blanked_whole() -> None:
    # Numbers go before said emails, so no part of the number is left behind.
    assert scrub("Ring 0412 345 678 at sample.com") == f"Ring {PHONE_GONE} at sample.com"
