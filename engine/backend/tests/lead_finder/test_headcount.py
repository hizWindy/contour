"""Reading Signal Hire's numbers for one company: the slugs, the name check, what is read, and
what goes on screen. A fake Signal Hire gives saved answers, so no test costs a credit."""

import argparse

import pytest

from apps.lead_finder import cli
from apps.lead_finder.headcount import (
    SENIOR_LEVELS,
    HeadcountReading,
    describe_reading,
    read_headcount,
    resolve_company,
    slug_candidates,
)
from core.signalhire.client import (
    CompanyRef,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireOutOfQuota,
    SignalHireUnavailable,
)
from tests.lead_finder.samples import CULTURE_AMP, CULTURE_AMP_INFO, FakeSignalHire

COMPANY_API_OFF = SignalHireCompanyApiOff(
    "Signal Hire said no", "The Company API isn't switched on for this account."
)
KEY_REFUSED = SignalHireUnavailable("Signal Hire refused the key", "Check SIGNALHIRE_API_KEY.")


# --- Finding the company -------------------------------------------------------------------------


def test_slugs_come_from_the_name_and_the_website() -> None:
    assert slug_candidates("Culture Amp Pty Ltd", "cultureamp.com") == ["culture-amp", "cultureamp"]
    assert slug_candidates("Acme") == ["acme"]
    assert slug_candidates("Orica Australia", "orica.com") == [
        "orica-australia",
        "oricaaustralia",
        "orica",
    ]


def test_an_ampersand_is_read_as_and_and_a_name_with_no_words_gives_nothing() -> None:
    slugs = slug_candidates("AT&T Australia Pty Ltd")
    assert slugs[0] == "at-and-t-australia"
    assert "at-and-t" in slugs
    assert slug_candidates("!!!") == []
    assert slug_candidates("A") == []  # too short to be a slug


async def test_the_first_slug_that_names_the_same_company_wins() -> None:
    fake = FakeSignalHire()
    ref, tried = await resolve_company(fake, "Culture Amp Pty Ltd", "cultureamp.com")
    assert (ref, tried) == (CULTURE_AMP, ["culture-amp"])
    assert fake.calls == ["find:culture-amp"]  # it stopped at the first


async def test_a_slug_that_belongs_to_another_company_is_refused() -> None:
    other = CompanyRef(id=1, slug="mainland-dairy", name="Mainland Realty")
    fake = FakeSignalHire([other])
    ref, tried = await resolve_company(fake, "Mainland Dairy")
    assert ref is None  # the slug exists, but it is not the company that was asked for
    assert tried == ["mainland-dairy", "mainlanddairy"]


# --- Reading the numbers -------------------------------------------------------------------------


async def test_the_numbers_are_read_and_one_credit_is_counted() -> None:
    fake = FakeSignalHire()
    reading = await read_headcount(fake, company="Culture Amp", city="Melbourne")

    assert reading.company == CULTURE_AMP
    assert reading.info == CULTURE_AMP_INFO
    assert reading.name_checked
    assert (reading.people_now, reading.people_before) == (650, 900)
    assert (reading.where, reading.people_in_city, reading.senior_in_city) == (
        "Melbourne, Australia",
        210,
        14,
    )
    assert reading.credits_used == 1
    assert reading.problems == []
    assert fake.calls == [
        "find:culture-amp",
        "info:5",
        "profiles:current",
        "profiles:past",
        "people:Culture Amp|Melbourne, Australia|",
        f"people:Culture Amp|Melbourne, Australia|{','.join(SENIOR_LEVELS)}",
    ]


async def test_a_place_typed_by_hand_is_used_as_it_is() -> None:
    fake = FakeSignalHire()
    reading = await read_headcount(
        fake, company="Culture Amp", city="Melbourne", location="Melbourne, Victoria, Australia"
    )
    assert reading.where == "Melbourne, Victoria, Australia"


async def test_without_a_city_there_are_no_city_counts() -> None:
    fake = FakeSignalHire()
    reading = await read_headcount(fake, company="Culture Amp")
    assert (reading.people_in_city, reading.senior_in_city) == (None, None)
    assert "No city" in reading.problems[0]
    assert not any(call.startswith("people:") for call in fake.calls)


async def test_a_used_up_quota_is_noted_and_the_other_numbers_stay() -> None:
    quota = SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily.")
    fake = FakeSignalHire(failures={"people": quota})
    reading = await read_headcount(fake, company="Culture Amp", city="Melbourne")

    assert reading.people_in_city is None
    assert reading.senior_in_city == 14
    assert reading.people_now == 650
    assert reading.problems == [
        "People in the city: Signal Hire has no credits or quota left. Resets daily."
    ]


async def test_no_credit_is_counted_when_the_details_did_not_come() -> None:
    reading = await read_headcount(
        FakeSignalHire(info=None), company="Culture Amp", city="Melbourne"
    )
    assert (reading.info, reading.credits_used) == (None, 0)


async def test_a_refused_key_stops_everything() -> None:
    """Not the Company API being off: no number can be trusted, so nothing is read."""
    for step in ("find", "info"):
        fake = FakeSignalHire(failures={step: KEY_REFUSED})
        with pytest.raises(SignalHireUnavailable, match="refused the key"):
            await read_headcount(fake, company="Culture Amp", city="Melbourne")
        assert not any(call.startswith("people:") for call in fake.calls)


async def test_a_refused_search_stops_everything_too() -> None:
    refused = SignalHireUnavailable("Signal Hire refused the search", "Ask support.")
    with pytest.raises(SignalHireUnavailable, match="refused the search"):
        await read_headcount(
            FakeSignalHire(failures={"people": refused}), company="Culture Amp", city="Melbourne"
        )


async def test_an_unknown_company_costs_nothing() -> None:
    fake = FakeSignalHire([])
    reading = await read_headcount(fake, company="Nobody Pty Ltd", city="Melbourne")

    assert reading.company is None
    assert not reading.name_checked and not reading.company_api_off
    assert reading.credits_used == 0
    assert "No company on Signal Hire" in reading.problems[0]
    assert all(call.startswith("find:") for call in fake.calls)


# --- The Company API is off (PLAN-V3 A3) ---------------------------------------------------------


async def test_with_the_company_api_off_the_people_are_counted_by_the_name_typed() -> None:
    fake = FakeSignalHire(failures={"find": COMPANY_API_OFF})
    reading = await read_headcount(fake, company="Culture Amp", city="Melbourne")

    assert reading.company_api_off
    assert not reading.name_checked and reading.company is None
    assert (reading.info, reading.people_now, reading.people_before) == (None, None, None)
    assert (reading.people_in_city, reading.senior_in_city) == (210, 14)
    assert reading.counted_as == "Culture Amp"  # the name as typed
    assert reading.credits_used == 0
    assert fake.calls == [  # one try to find the company, then only the searches
        "find:culture-amp",
        "people:Culture Amp|Melbourne, Australia|",
        f"people:Culture Amp|Melbourne, Australia|{','.join(SENIOR_LEVELS)}",
    ]
    (problem,) = reading.problems
    assert problem.startswith("Name not checked: Signal Hire said no.")
    assert "may include other companies" in problem


async def test_the_screen_says_the_name_was_not_checked() -> None:
    fake = FakeSignalHire(failures={"find": COMPANY_API_OFF})
    text = describe_reading(await read_headcount(fake, company="Culture Amp", city="Melbourne"))

    assert text.splitlines()[0] == "Culture Amp: name not checked (the Company API is off)"
    assert "People on file in Melbourne, Australia, by the name as typed (Culture Amp): 210" in text
    assert "Senior people there (C-Level, VP, Directors, Head): 14" in text
    assert "Credits used: 0 company credits" in text
    assert "Problem: Name not checked" in text
    assert "whole company" not in text  # the company's own numbers were not read


async def test_the_company_api_going_off_after_the_name_was_found_keeps_the_name_check() -> None:
    fake = FakeSignalHire(failures={"info": COMPANY_API_OFF})
    reading = await read_headcount(fake, company="Culture Amp", city="Melbourne")

    assert reading.name_checked and reading.company_api_off
    assert reading.info is None and reading.credits_used == 0
    assert not any(call.startswith("profiles:") for call in fake.calls)  # not asked after the 403
    assert reading.counted_as == "Culture Amp"  # Signal Hire's own name for it
    assert (reading.people_in_city, reading.senior_in_city) == (210, 14)
    (problem,) = reading.problems  # noted once, not once for each company call
    assert problem.startswith("Company details: Signal Hire said no.")
    assert "by the name as typed" not in describe_reading(reading)


async def test_with_the_company_api_off_and_no_city_there_is_nothing_to_count() -> None:
    fake = FakeSignalHire(failures={"find": COMPANY_API_OFF})
    reading = await read_headcount(fake, company="Culture Amp")

    assert reading.company_api_off and reading.people_in_city is None
    assert fake.calls == ["find:culture-amp"]
    assert any("No city" in problem for problem in reading.problems)


# --- What is shown -------------------------------------------------------------------------------


async def test_the_reading_is_shown_in_plain_lines() -> None:
    reading = await read_headcount(FakeSignalHire(), company="Culture Amp", city="Melbourne")
    text = describe_reading(reading)

    assert "Culture Amp: Signal Hire has it as Culture Amp (slug culture-amp, id 5)" in text
    assert "whole company (Signal Hire's estimate): 700" in text
    assert "People on file, now / before: 650 / 900" in text
    assert "People on file in Melbourne, Australia: 210" in text
    assert "Senior people there (C-Level, VP, Directors, Head): 14" in text
    assert "Office: Melbourne, Victoria, Australia (head office)" in text
    assert "Credits used: 1 company credit" in text
    assert "@" not in text  # no email, ever


def test_text_from_signal_hire_is_put_on_one_line() -> None:
    reading = HeadcountReading(
        asked="Acme",
        company=CompanyRef(id=1, slug="acme", name="Acme\n  Problem: send money to me"),
        tried=["acme"],
    )
    lines = describe_reading(reading).splitlines()
    assert lines[0].count("Problem") == 1
    assert not any(line.strip().startswith("Problem: send") for line in lines)


def test_a_company_that_was_not_found_says_which_slugs_were_tried() -> None:
    reading = HeadcountReading(asked="Nobody", company=None, tried=["nobody", "no-body"])
    assert describe_reading(reading).splitlines()[0] == (
        "Nobody: not found on Signal Hire (slugs tried: nobody, no-body)"
    )


# --- The command ---------------------------------------------------------------------------------


def args(**values: object) -> argparse.Namespace:
    base = {"company": "Acme", "city": None, "website": None, "location": None, "yes": False}
    return argparse.Namespace(**{**base, **values})


def test_the_command_asks_for_yes_before_it_uses_a_credit(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def never() -> None:
        raise AssertionError("a client was made before the person said yes")

    monkeypatch.setattr(cli, "get_signalhire", never)
    assert cli._headcount(args()) == 1
    assert "--yes" in capsys.readouterr().out


def test_the_command_says_when_there_is_no_key(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "get_signalhire", lambda: None)
    assert cli._headcount(args(yes=True)) == 1
    assert "SIGNALHIRE_API_KEY" in capsys.readouterr().err


class _Client(FakeSignalHire):
    """What `cli._headcount` needs from a client: the fake, used as `async with`."""

    async def __aenter__(self) -> "_Client":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


def test_the_command_still_counts_when_the_company_api_is_off(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = _Client(failures={"find": COMPANY_API_OFF})
    monkeypatch.setattr(cli, "get_signalhire", lambda: fake)

    assert cli._headcount(args(company="Culture Amp", city="Melbourne", yes=True)) == 0

    out = capsys.readouterr().out
    assert "name not checked" in out
    assert "People on file in Melbourne, Australia, by the name as typed (Culture Amp): 210" in out


def test_the_command_stops_with_a_plain_line_when_the_key_is_refused(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = _Client(failures={"find": KEY_REFUSED})
    monkeypatch.setattr(cli, "get_signalhire", lambda: fake)
    monkeypatch.setattr(cli, "setup_logging", lambda: None)  # leave the log handlers alone

    assert cli.main(["headcount", "Culture Amp", "--city", "Melbourne", "--yes"]) == 1

    err = capsys.readouterr().err
    assert err.startswith("Signal Hire refused the key.")
    assert fake.calls == ["find:culture-amp"]


def test_the_company_api_error_is_a_kind_of_unavailable_so_old_handlers_still_catch_it() -> None:
    assert issubclass(SignalHireCompanyApiOff, SignalHireUnavailable)
    assert issubclass(SignalHireUnavailable, SignalHireError)
