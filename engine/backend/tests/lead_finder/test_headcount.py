"""Reading Signal Hire's numbers for one company: the slugs, the name check, what is read, and
what goes on screen. A fake Signal Hire gives saved answers, so no test costs a credit."""

import argparse
from collections.abc import Sequence

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
    CompanyInfo,
    CompanyRef,
    Office,
    ProfileStatus,
    SignalHireError,
    SignalHireOutOfQuota,
    SignalHireUnavailable,
)

AMP = CompanyRef(id=5, slug="culture-amp", name="Culture Amp")
INFO = CompanyInfo(
    name="Culture Amp",
    website="cultureamp.com",
    industry="Software",
    staff_count=700,
    staffing_company=False,
    linkedin_id="98765",
    offices=(
        Office("Melbourne", "Victoria", "Australia", True),
        Office("Sydney", None, None, False),
    ),
)


class FakeSignalHire:
    """Saved answers, the way the tests fake Claude. `calls` lists every call it got."""

    def __init__(
        self,
        known: Sequence[CompanyRef] = (AMP,),
        *,
        info: CompanyInfo | None = INFO,
        failures: dict[str, SignalHireError] | None = None,
    ) -> None:
        self.known = {ref.slug: ref for ref in known}
        self.info = info
        self.failures = failures or {}
        self.calls: list[str] = []

    def _fail(self, step: str) -> None:
        if step in self.failures:
            raise self.failures[step]

    async def find_company(self, id_or_slug: str) -> CompanyRef | None:
        self.calls.append(f"find:{id_or_slug}")
        return self.known.get(id_or_slug)

    async def company_info(self, company_id: int) -> CompanyInfo | None:
        self.calls.append(f"info:{company_id}")
        self._fail("info")
        return self.info

    async def profile_count(self, company_id: int, status: ProfileStatus = "current") -> int:
        self.calls.append(f"profiles:{status}")
        return {"current": 650, "past": 900, "both": 1550}[status]

    async def count_people(
        self, *, company: str, location: str | None = None, seniority: Sequence[str] = ()
    ) -> int:
        self.calls.append(f"people:{company}|{location}|{','.join(seniority)}")
        self._fail("senior" if seniority else "people")
        return 14 if seniority else 210


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
    assert (ref, tried) == (AMP, ["culture-amp"])
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

    assert reading.company == AMP
    assert reading.info == INFO
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


async def test_when_signal_hire_is_unavailable_everything_stops() -> None:
    off = SignalHireUnavailable("Signal Hire said no", "The Company API isn't switched on.")
    with pytest.raises(SignalHireUnavailable):
        await read_headcount(FakeSignalHire(failures={"info": off}), company="Culture Amp")


async def test_an_unknown_company_costs_nothing() -> None:
    fake = FakeSignalHire([])
    reading = await read_headcount(fake, company="Nobody Pty Ltd", city="Melbourne")

    assert reading.company is None
    assert reading.credits_used == 0
    assert "No company on Signal Hire" in reading.problems[0]
    assert all(call.startswith("find:") for call in fake.calls)


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
