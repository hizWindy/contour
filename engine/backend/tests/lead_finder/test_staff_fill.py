"""The Signal Hire staff step: it fills a gap and changes nothing else (PLAN-V3 C2). A fake Signal
Hire gives saved answers, so no test costs a credit or a search."""

import asyncio
from datetime import date
from typing import Any

import pytest

from apps.lead_finder import headcount
from apps.lead_finder.context import Origin
from apps.lead_finder.fields import CompanyFacts
from apps.lead_finder.headcount import StaffFill, fill_staff_gap, wants_signalhire
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.scoring import judge
from core.config import Settings, get_settings
from core.hubspot.matching import HubSpotMatch
from core.signalhire.client import (
    CompanyRef,
    PersonOnFile,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireOutOfQuota,
    SignalHireUnavailable,
    get_signalhire,
)
from tests.lead_finder.samples import (
    ACME_SOFTWARE,
    FakeSignalHire,
    fact,
    make_facts,
    rules_with_signalhire,
    rules_without_signalhire,
)

TODAY = date(2026, 10, 26)
RULES = rules_with_signalhire(load_rules())  # Signal Hire on, the name check required
NO_STAFF = make_facts(staff_in_city=fact(None), office_m2=fact(None))
SETTINGS = Settings(_env_file=None)
COMPANY_API_OFF = SignalHireCompanyApiOff("Signal Hire said no", "The Company API is off.")


async def fill(
    client: FakeSignalHire,
    facts: CompanyFacts = NO_STAFF,
    rules: LeadFinderRules = RULES,
    city: str = "Melbourne",
) -> StaffFill:
    return await fill_staff_gap(
        facts, client, company="Acme Software", website=None, city=city, rules=rules
    )


def acme(failures: dict[str, SignalHireError] | None = None) -> FakeSignalHire:
    """A Signal Hire that knows Acme Software, with 105 people on file in the city."""
    return FakeSignalHire([ACME_SOFTWARE], people=105, failures=failures)


# --- What it writes ------------------------------------------------------------------------------


async def test_the_count_fills_the_staff_gap_and_is_multiplied_once() -> None:
    fake = acme()
    result = await fill(fake)

    staff = result.facts.staff_in_city
    assert (staff.value, staff.label) == (210, "estimated")  # 105 people on file x 2
    assert (staff.source_url, staff.source_date) == (
        None,
        None,
    )  # no link until its format is known
    assert result.facts.staff_from_linkedin is False  # so the size rule doesn't multiply again
    assert result.notes == [
        "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC)."
    ]
    assert result.problems == []
    # The name was checked for free, then one search. No "info:" call: that costs a credit.
    assert fake.calls == ["find:acme-software", "people:Acme Software|Melbourne, Australia|"]
    # Nothing but the staff number changed.
    assert result.facts == NO_STAFF.model_copy(update={"staff_in_city": staff})


async def test_it_counts_under_signal_hires_own_name_for_the_company() -> None:
    renamed = FakeSignalHire([CompanyRef(id=7, slug="acme-software", name="Acme Software Group")])
    await fill(renamed)
    assert renamed.calls[-1] == "people:Acme Software Group|Melbourne, Australia|"


async def test_the_multiplier_comes_from_the_rules() -> None:
    rules = rules_with_signalhire(load_rules(), headcount_tool_multiplier=1.5)
    result = await fill(FakeSignalHire([ACME_SOFTWARE], people=100), rules=rules)
    assert result.facts.staff_in_city.value == 150
    assert result.notes == [
        "Staff in Melbourne: about 150, from Signal Hire (100 people on file x 1.5, TBC)."
    ]


async def test_the_note_says_tbc_only_while_the_multiplier_is_unconfirmed() -> None:
    kept = [note for note in RULES.criteria.tbc if note.key != headcount.MULTIPLIER_KEY]
    confirmed = RULES.model_copy(
        update={"criteria": RULES.criteria.model_copy(update={"tbc": kept})}
    )
    result = await fill(acme(), rules=confirmed)
    assert result.notes == [
        "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2)."
    ]


# --- What it never does --------------------------------------------------------------------------


async def test_it_never_overwrites_a_staff_number() -> None:
    found = make_facts()  # 250 staff, from the research or from HubSpot
    fake = acme()
    result = await fill(fake, found)
    assert result == StaffFill(found)
    assert fake.calls == []  # and nothing was asked, so nothing was spent


async def test_a_leftover_linkedin_flag_cannot_make_the_size_rule_double_the_number() -> None:
    """The research may set `staff_from_linkedin` with no number. The step clears it, because the
    size rule doubles a LinkedIn count, and the saved number is already multiplied."""
    flagged = NO_STAFF.model_copy(update={"staff_from_linkedin": True})
    result = await fill(acme(), flagged)

    assert result.facts.staff_from_linkedin is False
    verdict = judge(result.facts, HubSpotMatch(status="new"), RULES, TODAY)
    assert verdict.office_m2 == 2100  # 210 staff x 10 m². Not 4,200
    assert verdict.result == "pass"
    doubled = result.facts.model_copy(update={"staff_from_linkedin": True})
    assert judge(doubled, HubSpotMatch(status="new"), RULES, TODAY).office_m2 == 4200


async def test_nobody_on_file_is_not_a_staff_number_of_zero() -> None:
    result = await fill(FakeSignalHire([ACME_SOFTWARE], people=0))
    assert result.facts == NO_STAFF and result.notes == []
    assert result.problems == [
        "Signal Hire staff count: no people on file in Melbourne. No count was used."
    ]


# --- When it runs --------------------------------------------------------------------------------


def wants(
    facts: CompanyFacts = NO_STAFF,
    rules: LeadFinderRules = RULES,
    settings: Settings = SETTINGS,
    origin: Origin = "typed",
    city: str | None = "Melbourne",
) -> bool:
    return wants_signalhire(facts, rules, settings, origin=origin, city=city)


def test_it_runs_only_when_every_condition_holds() -> None:
    assert wants()
    assert not wants(facts=make_facts())  # a staff number is already there
    assert not wants(city=None)  # the count is for one city
    assert not wants(rules=rules_without_signalhire(load_rules()))  # headcount_tool isn't listed
    assert wants(rules=load_rules())  # criteria.yaml lists it: Signal Hire is on since 2 Nov


@pytest.mark.parametrize("origin", ["typed", "web"])
def test_a_typed_company_and_one_the_web_found_are_asked(origin: Origin) -> None:
    assert wants(origin=origin)


def test_a_watchlist_company_is_skipped_unless_its_own_switch_is_on() -> None:
    assert not wants(origin="hubspot")
    assert wants(
        origin="hubspot", settings=Settings(_env_file=None, hubspot_names_to_signalhire_ok=True)
    )
    # The OK to send HubSpot names to Claude is not an OK to send them to Signal Hire.
    claude_only = Settings(_env_file=None, hubspot_names_to_claude_ok=True)
    assert not wants(origin="hubspot", settings=claude_only)


# --- The name rule -------------------------------------------------------------------------------


async def test_with_the_name_rule_required_a_name_signal_hire_does_not_know_is_not_counted() -> (
    None
):
    fake = FakeSignalHire([])
    result = await fill(fake)

    assert result.facts == NO_STAFF and result.notes == []
    assert result.problems == [
        "Signal Hire staff count: no company on Signal Hire matched this name. No count was used."
    ]
    assert not any(call.startswith("people:") for call in fake.calls)  # no search was spent


async def test_with_the_name_rule_required_and_the_company_api_off_nothing_is_counted() -> None:
    fake = acme({"find": COMPANY_API_OFF})
    result = await fill(fake)

    assert result.facts == NO_STAFF and result.notes == []
    assert result.problems == [
        "Signal Hire staff count: the Company API is off, so the name couldn't be checked. "
        "No count was used."
    ]
    assert fake.calls == ["find:acme-software"]


@pytest.mark.parametrize(
    "fake",
    [
        FakeSignalHire([], people=40),
        FakeSignalHire([ACME_SOFTWARE], people=40, failures={"find": COMPANY_API_OFF}),
    ],
    ids=["name not known", "company api off"],
)
async def test_with_the_name_rule_optional_the_name_as_typed_is_counted_and_said_so(
    fake: FakeSignalHire,
) -> None:
    rules = rules_with_signalhire(load_rules(), headcount_tool_name_check="optional")
    result = await fill(fake, rules=rules)

    assert result.facts.staff_in_city.value == 80
    assert fake.calls[-1] == "people:Acme Software|Melbourne, Australia|"
    (note,) = result.notes
    assert note == (
        "Staff in Melbourne: about 80, from Signal Hire (40 people on file x 2, TBC). "
        "The company name was not checked, so the count may include other companies "
        "with a like name."
    )


# --- When Signal Hire fails ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("step", "error", "line"),
    [
        (
            "people",
            SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily."),
            "Signal Hire staff count: Signal Hire has no credits or quota left. Resets daily.",
        ),
        (
            "find",
            SignalHireUnavailable("Signal Hire refused the key", "Check SIGNALHIRE_API_KEY."),
            "Signal Hire staff count: Signal Hire refused the key. Check SIGNALHIRE_API_KEY.",
        ),
        (
            "people",
            SignalHireUnavailable("Signal Hire refused the search", "Ask support."),
            "Signal Hire staff count: Signal Hire refused the search. Ask support.",
        ),
        (
            "people",
            SignalHireError("Signal Hire is busy", "Too many requests (429)."),
            "Signal Hire staff count: Signal Hire is busy. Too many requests (429).",
        ),
    ],
)
async def test_any_signal_hire_error_becomes_one_line_and_the_facts_stay(
    step: str, error: SignalHireError, line: str
) -> None:
    result = await fill(acme({step: error}))
    assert result.facts == NO_STAFF and result.notes == []
    assert result.problems == [line]


class Broken(FakeSignalHire):
    async def count_people(
        self, *, company: str, location: str | None = None, titles: str | None = None
    ) -> int:
        raise RuntimeError("secret detail that is not for a card")


async def test_a_bug_in_the_step_never_loses_the_lead() -> None:
    result = await fill(Broken([ACME_SOFTWARE]))
    assert result.facts == NO_STAFF
    assert result.problems == [
        "Signal Hire staff count: it couldn't be read."
    ]  # no detail on the card


class Slow(FakeSignalHire):
    async def count_people(
        self, *, company: str, location: str | None = None, titles: str | None = None
    ) -> int:
        await asyncio.sleep(5)
        return 5


async def test_a_slow_signal_hire_cannot_hold_the_research(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(headcount, "STEP_SECONDS", 0.05)
    result = await fill(Slow([ACME_SOFTWARE]))
    assert result.facts == NO_STAFF
    assert result.problems == ["Signal Hire staff count: Signal Hire took too long."]


def test_no_test_can_reach_signal_hire() -> None:
    """Signal Hire is on in criteria.yaml, so a research a test starts would use the daily quota
    if it could make a client. tests/conftest.py blanks the key, so it can't."""
    assert get_signalhire(get_settings()) is None


class Cancelled(FakeSignalHire):
    async def count_people(
        self, *, company: str, location: str | None = None, titles: str | None = None
    ) -> int:
        raise asyncio.CancelledError


async def test_a_cancel_is_not_swallowed() -> None:
    with pytest.raises(asyncio.CancelledError):
        await fill(Cancelled([ACME_SOFTWARE]))


# --- Senior people to talk to (PLAN-V4 C5) --------------------------------------------------------


async def leaders(fake: FakeSignalHire, rules: LeadFinderRules = RULES) -> tuple[Any, ...]:
    return await headcount.find_leaders(
        fake, company="Acme Software", website=None, city="Melbourne", rules=rules
    )


async def test_senior_people_are_kept_by_name_and_job_title_only() -> None:
    fake = FakeSignalHire(
        [ACME_SOFTWARE],
        leaders=[
            PersonOnFile("sh-1", " Pat  Example ", "Chief Financial Officer"),
            PersonOnFile("sh-2", "pat example", "CFO"),  # the same person twice
            PersonOnFile("sh-3", "Call 0400 000 000", "Head of Property"),  # digits: not a name
            PersonOnFile("sh-4", "Sam Sample", "mail me at sam@example.com"),  # an email
            PersonOnFile("sh-5", "Lee Person", None),
        ],
    )
    people, notes, problems = await leaders(fake)

    assert [(p.name, p.title, p.signalhire_id) for p in people] == [
        ("Pat Example", "Chief Financial Officer", "sh-1"),
        ("Lee Person", None, "sh-5"),
    ]
    assert notes == [] and problems == []  # the name was checked
    assert fake.calls[-1] == "leaders:Acme Software|Melbourne, Australia|5"


async def test_senior_people_under_a_name_that_was_not_checked_say_so() -> None:
    optional = rules_with_signalhire(load_rules(), headcount_tool_name_check="optional")
    people, notes, _ = await leaders(FakeSignalHire([]), optional)
    assert len(people) == 2
    assert notes == [
        "Senior people: the company name was not checked, so some may work for another "
        "company with a like name."
    ]


async def test_senior_people_follow_the_name_rule_and_never_raise() -> None:
    people, _, problems = await leaders(FakeSignalHire([]))  # required, and no match
    assert people == []
    assert problems == [
        "Signal Hire senior people: no company on Signal Hire matched this name. No one was noted."
    ]
    quota = SignalHireOutOfQuota("Signal Hire has no credits or quota left", "Resets daily.")
    people, _, problems = await leaders(acme({"leaders": quota}))
    assert people == []
    assert problems == [
        "Signal Hire senior people: Signal Hire has no credits or quota left. Resets daily."
    ]


def test_senior_people_are_asked_for_whether_or_not_staff_was_found() -> None:
    assert headcount.wants_people(RULES, SETTINGS, origin="typed", city="Melbourne")
    assert not headcount.wants_people(RULES, SETTINGS, origin="typed", city=None)
    assert not headcount.wants_people(RULES, SETTINGS, origin="hubspot", city="Melbourne")
    off = rules_without_signalhire(load_rules())
    assert not headcount.wants_people(off, SETTINGS, origin="typed", city="Melbourne")


# --- Retail and site-heavy companies (PLAN-V4 C4) -------------------------------------------------


async def test_a_retail_count_is_only_a_hint_and_gives_no_office_size() -> None:
    """Like Myer: 2,868 people on file in Melbourne would be 5,736 staff and an A$86M fitout."""
    retail = NO_STAFF.model_copy(update={"industry_group": "Retail"})
    result = await fill(FakeSignalHire([ACME_SOFTWARE], people=2868), retail)

    assert result.facts == retail  # no staff number written
    assert result.notes == [
        "Signal Hire has 2,868 people on file in Melbourne. In Retail that counts shop, site and "
        "plant staff too, so it isn't used as the office's staff. Check the office size."
    ]
    verdict = judge(result.facts, HubSpotMatch(status="new"), RULES, TODAY)
    assert verdict.office_m2 is None and verdict.fitout_aud is None


# --- The name check follows the Company API (PLAN-V4 C3) ------------------------------------------


async def test_auto_uses_the_typed_name_only_while_the_company_api_is_off() -> None:
    auto = rules_with_signalhire(load_rules(), headcount_tool_name_check="auto")

    off = await fill(
        FakeSignalHire([ACME_SOFTWARE], people=40, failures={"find": COMPANY_API_OFF}), rules=auto
    )
    assert off.facts.staff_in_city.value == 80  # the name as typed, said so in the note
    assert "was not checked" in off.notes[0]

    on_unknown = await fill(FakeSignalHire([], people=40), rules=auto)
    assert (
        on_unknown.facts.staff_in_city.value is None
    )  # the Company API answered: no match, no count

    on_known = await fill(FakeSignalHire([ACME_SOFTWARE], people=40), rules=auto)
    assert on_known.facts.staff_in_city.value == 80
    assert "was not checked" not in on_known.notes[0]
