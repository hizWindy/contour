"""Which source wins for each fact, and what the others said (PLAN-V4 C2 and C3). Pure code, so
every case here is free and the same every time."""

from typing import Any

import pytest

from apps.lead_finder.fields import CompanyFacts, DecisionMaker, Fact
from apps.lead_finder.office_numbers import OfficeNumbers, hubspot_staff
from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.sourcing import (
    FactSource,
    OtherValue,
    StaffCandidate,
    apply_company_details,
    check_offices,
    choose_staff,
    claude_staff,
    hubspot_filled,
    people_source,
)
from core.signalhire.details import SignalHireOffice
from tests.lead_finder.samples import SITE, fact, make_details, make_facts

RULES = load_rules()
LINK = "https://app.hubspot.com/contacts/1/company/102"


def with_criteria(**parts: Any) -> LeadFinderRules:
    """The rules with a whole part of criteria.yaml swapped, like `size` or `data_sources`."""
    return RULES.model_copy(update={"criteria": RULES.criteria.model_copy(update=parts)})


def with_staff_sources(*sources: str) -> LeadFinderRules:
    size = RULES.criteria.size.model_copy(update={"staff_sources": list(sources)})
    return with_criteria(size=size)


def with_data_sources(**lists: list[str]) -> LeadFinderRules:
    return with_criteria(data_sources=RULES.criteria.data_sources.model_copy(update=lists))


def signalhire_staff(people: int = 105) -> StaffCandidate:
    staff = people * 2
    return StaffCandidate(
        kind="headcount_tool",
        fact=Fact[int](value=staff, source_url=None, source_date=None, label="estimated"),
        from_linkedin=False,
        staff=staff,
        text=f"about {staff:,} ({people:,} people on file x 2)",
        note=f"Staff in Melbourne: about {staff:,}, from Signal Hire.",
    )


def hubspot_numbers(linkedin: int = 60) -> StaffCandidate:
    candidate = hubspot_staff(OfficeNumbers("Melbourne", linkedin, None, None, LINK), RULES)
    assert candidate is not None
    return candidate


NO_STAFF = make_facts(staff_in_city=fact(None))


# --- Staff: the first source in the list wins (C3) -------------------------------------------


def test_claude_alone_needs_no_entry_and_changes_nothing() -> None:
    facts = make_facts()  # 250, a number from a web page
    choice = choose_staff(facts, [None, None], RULES)
    assert choice.facts == facts and choice.entry is None and choice.note is None

    linkedin = make_facts(staff_in_city=fact(125), staff_from_linkedin=True)
    candidate = claude_staff(linkedin, RULES)
    assert candidate is not None
    assert (candidate.kind, candidate.staff) == ("linkedin", 250)  # a LinkedIn count is doubled
    assert choose_staff(linkedin, [], RULES).entry is None


def test_nobody_has_a_number() -> None:
    choice = choose_staff(NO_STAFF, [None], RULES)
    assert choice.facts == NO_STAFF and choice.entry is None and choice.note is None


def test_hubspot_beats_signal_hire_and_the_web_research() -> None:
    facts = make_facts(staff_in_city=fact(150))  # the research found 150 on a web page
    choice = choose_staff(facts, [signalhire_staff(), hubspot_numbers()], RULES)

    # HubSpot says 60 on LinkedIn, so about 120 staff. It is first in staff_sources.
    assert choice.facts.staff_in_city.value == 60
    assert choice.facts.staff_in_city.source_url == LINK
    assert choice.facts.staff_from_linkedin is True  # the size rule doubles a LinkedIn count
    assert choice.entry is not None and choice.entry.used == "hubspot"
    assert [(o.source, o.value) for o in choice.entry.others] == [
        ("signalhire", "about 210 (105 people on file x 2)"),
        ("claude", "150"),
    ]
    assert choice.entry.conflict is None  # 120, 210 and 150 are within 2 times of each other
    assert choice.note is not None and choice.note[0] == "hubspot"


def test_signal_hire_beats_the_web_research_when_hubspot_has_nothing() -> None:
    facts = make_facts(staff_in_city=fact(125), staff_from_linkedin=True)  # about 250
    choice = choose_staff(facts, [None, signalhire_staff()], RULES)

    assert choice.facts.staff_in_city.value == 210
    assert choice.facts.staff_from_linkedin is False  # Signal Hire's number is already doubled
    assert choice.entry == FactSource(
        fact="staff_in_city",
        used="signalhire",
        others=[
            OtherValue(
                source="claude", value="about 250 (125 on LinkedIn x 2)", url=fact(1).source_url
            )
        ],
        conflict=None,
    )
    assert choice.note == ("signalhire", "Staff in Melbourne: about 210, from Signal Hire.")
    # Nothing but the staff number changed.
    changed = {"staff_in_city": choice.facts.staff_in_city, "staff_from_linkedin": False}
    assert choice.facts == facts.model_copy(update=changed)


def test_a_backup_fills_in_when_the_main_sources_have_nothing() -> None:
    # Only Signal Hire has a number: it fills the gap, and there is nothing to compare it with.
    choice = choose_staff(NO_STAFF, [None, signalhire_staff()], RULES)
    assert choice.facts.staff_in_city.value == 210
    assert choice.entry is not None and choice.entry.used == "signalhire"
    assert choice.entry.others == [] and choice.entry.conflict is None

    # And the research's own number is the backup of both: it is used when they have nothing.
    found = make_facts()
    assert choose_staff(found, [None, None], RULES).facts == found


def test_the_order_comes_from_the_rules() -> None:
    facts = make_facts(staff_in_city=fact(150))
    rules = with_staff_sources("web_research", "headcount_tool", "hubspot")
    choice = choose_staff(facts, [signalhire_staff(), hubspot_numbers()], rules)

    assert choice.facts == facts  # the research's own number comes first now
    assert choice.entry is not None and choice.entry.used == "claude"
    assert [o.source for o in choice.entry.others] == ["signalhire", "hubspot"]
    assert choice.note is None  # a number from the research has no "From ..." note


def test_a_kind_of_claude_number_that_is_not_listed_comes_last() -> None:
    facts = make_facts(staff_in_city=fact(150))
    choice = choose_staff(facts, [signalhire_staff()], with_staff_sources("headcount_tool"))
    assert choice.entry is not None and choice.entry.used == "signalhire"
    assert [o.source for o in choice.entry.others] == ["claude"]


# --- Staff: a big gap raises a flag --------------------------------------------------------------


def test_numbers_far_apart_raise_a_flag_with_every_value() -> None:
    facts = make_facts(staff_in_city=fact(250))  # the research found 250 on a web page
    choice = choose_staff(facts, [None, signalhire_staff(285)], RULES)  # Signal Hire: about 570

    assert choice.entry is not None and choice.entry.used == "signalhire"
    assert choice.facts.staff_in_city.value == 570  # the main source wins
    assert choice.entry.others[0].value == "250"  # and Claude's number is kept
    assert choice.entry.conflict == (
        "The staff numbers are more than 2 times apart: Signal Hire about 570, Claude about 250. "
        "Check which is right."
    )


@pytest.mark.parametrize(("other", "flag"), [(200, False), (201, True)])
def test_exactly_the_ratio_apart_is_not_a_flag(other: int, flag: bool) -> None:
    facts = make_facts(staff_in_city=fact(other))
    choice = choose_staff(facts, [signalhire_staff(50)], RULES)  # Signal Hire: 100
    assert choice.entry is not None
    assert (choice.entry.conflict is not None) is flag


def test_the_ratio_comes_from_the_rules() -> None:
    conflicts = RULES.criteria.conflicts.model_copy(update={"staff_gap_ratio": 1.2})
    facts = make_facts(staff_in_city=fact(150))
    choice = choose_staff(facts, [signalhire_staff(105)], with_criteria(conflicts=conflicts))
    assert choice.entry is not None and choice.entry.conflict is not None  # 210 against 150


# --- The company's name, website and industry (C1, C2) -------------------------------------------


def test_signal_hire_is_main_for_the_checked_website_and_industry() -> None:
    facts = make_facts(website=fact("acme-software.com", SITE))
    details = make_details(website="acme.com.au", industry="Software Development")
    new, entries = apply_company_details(facts, details, RULES)

    assert (new.website.value, new.website.source_url, new.website.label) == (
        "acme.com.au",
        None,
        "confirmed",
    )
    assert new.industry.value == "Software Development"
    assert new.industry_group == facts.industry_group  # Claude's reading of the notes stays
    website, industry = entries
    assert website.fact == "website" and website.used == "signalhire"
    assert website.others == [OtherValue(source="claude", value="acme-software.com", url=SITE)]
    assert website.conflict == (
        "The websites differ: Claude found acme-software.com, Signal Hire has acme.com.au. "
        "Check which is right."
    )
    assert industry.used == "signalhire" and industry.conflict is None  # free text: never a flag
    assert industry.others[0].value == "Software"


def test_the_same_value_written_two_ways_says_nothing() -> None:
    facts = make_facts(name="Acme Software Pty Ltd", website=fact("www.ACME.com.au/", SITE))
    details = make_details(industry="software")
    new, entries = apply_company_details(facts, details, RULES)
    assert new == facts and entries == []


def test_a_different_company_name_is_used_and_flagged() -> None:
    new, entries = apply_company_details(make_facts(), make_details(name="Zenith Mining"), RULES)
    assert new.name == "Zenith Mining"
    (name,) = [entry for entry in entries if entry.fact == "name"]
    assert name.used == "signalhire" and name.others[0].value == "Acme Software"
    assert name.conflict is not None and "Check it is the same company" in name.conflict


def test_an_empty_name_from_signal_hire_changes_nothing() -> None:
    facts = make_facts()
    new, entries = apply_company_details(facts, make_details(name=""), RULES)
    assert new.name == "Acme Software"
    assert [entry for entry in entries if entry.fact == "name"] == []


def test_signal_hire_fills_a_gap_wherever_it_is_listed() -> None:
    bare = make_facts(website=fact(None), industry=fact(None))
    for rules in (RULES, with_data_sources(company_details=["web_research", "headcount_tool"])):
        new, entries = apply_company_details(bare, make_details(), rules)
        assert new.website.value == "acme.com.au" and new.industry.value == "Software Development"
        assert [(e.fact, e.used, e.others) for e in entries] == [
            ("website", "signalhire", []),
            ("industry", "signalhire", []),
        ]


def test_when_claude_is_listed_first_signal_hire_is_only_the_backup() -> None:
    rules = with_data_sources(company_details=["web_research", "headcount_tool"])
    facts = make_facts(website=fact("acme-software.com", SITE))
    new, entries = apply_company_details(facts, make_details(website="acme.com.au"), rules)

    assert new.website == facts.website  # Claude's value is used
    website = entries[0]
    assert website.used == "claude"
    assert website.others == [OtherValue(source="signalhire", value="acme.com.au", url=None)]
    assert website.conflict is not None  # and the two websites are still flagged


def test_the_details_are_not_used_when_the_rules_do_not_list_signal_hire() -> None:
    rules = with_data_sources(company_details=["web_research"])
    facts = make_facts(website=fact("acme-software.com", SITE))
    assert apply_company_details(facts, make_details(), rules) == (facts, [])
    assert apply_company_details(facts, None, RULES) == (facts, [])


# --- Offices (C2) --------------------------------------------------------------------------------


def test_an_office_in_the_leads_city_is_enough() -> None:
    # The list has "Melbourne" with the head office mark, and the lead says "Melbourne VIC".
    assert check_offices(make_details(), "Melbourne VIC", RULES) is None


def test_no_office_in_the_leads_city_is_a_flag() -> None:
    offices = [
        SignalHireOffice(city="Sydney", area=None, country="Australia", head_office=True),
        SignalHireOffice(city="London", area=None, country="United Kingdom", head_office=False),
    ]
    entry = check_offices(make_details(offices=offices), "Melbourne", RULES)
    assert entry == FactSource(
        fact="city",
        used="claude",
        others=[
            OtherValue(source="signalhire", value="Offices: Sydney (head office), London", url=None)
        ],
        conflict=(
            "Signal Hire lists no office in Melbourne. It lists Sydney (head office), London. "
            "Check the city."
        ),
    )


def test_offices_say_nothing_without_a_list_a_city_or_the_rule() -> None:
    far = [SignalHireOffice(city="Sydney", area=None, country=None, head_office=True)]
    assert check_offices(make_details(offices=[]), "Melbourne", RULES) is None
    assert check_offices(make_details(offices=far), None, RULES) is None
    assert check_offices(None, "Melbourne", RULES) is None
    off = with_data_sources(office_cities=["web_research"])
    assert check_offices(make_details(offices=far), "Melbourne", off) is None


# --- Decision makers (C2) ------------------------------------------------------------


def two_leaders() -> CompanyFacts:
    people = [
        DecisionMaker(name="Pat Example", role="CFO", source_url=SITE, source_date=None),
        DecisionMaker(name="Sam Sample", role="COO", source_url=SITE, source_date=None),
    ]
    return make_facts(decision_makers=people)


def test_signal_hires_people_come_first_when_it_is_main() -> None:
    entry = people_source(two_leaders(), 3, RULES)
    assert entry == FactSource(
        fact="decision_makers",
        used="signalhire",
        others=[OtherValue(source="claude", value="2 people", url=None)],
        conflict=None,
    )


def test_the_web_researchs_people_come_first_when_it_is_listed_first() -> None:
    rules = with_data_sources(decision_makers=["web_research", "headcount_tool"])
    entry = people_source(two_leaders(), 1, rules)
    assert entry is not None and entry.used == "claude"
    assert entry.others == [OtherValue(source="signalhire", value="1 person", url=None)]


def test_one_list_alone_needs_no_order_unless_it_is_signal_hires() -> None:
    assert people_source(two_leaders(), 0, RULES) is None  # only Claude has people
    alone = people_source(make_facts(), 2, RULES)
    assert alone is not None and alone.used == "signalhire" and alone.others == []


# --- A move-in year that HubSpot filled in -------------------------------------------------------


def test_a_move_in_year_filled_in_by_hubspot_is_labelled_as_hubspots() -> None:
    before = make_facts(office_since=fact(None))
    after = make_facts(office_since=fact("2016-03-01", LINK))

    assert hubspot_filled(before, after) == [
        FactSource(fact="office_since", used="hubspot", others=[], conflict=None)
    ]
    assert hubspot_filled(after, after) == []  # HubSpot changed nothing
    found = make_facts(office_since=fact("2019"))
    assert hubspot_filled(found, found) == []  # the research's own year stays Claude's
