"""Property Daily and Arealytics in the research (PLAN-V16 T1-8). Pure code, with fake records:
free, and the same every time.

What it proves (the plan's "Done when"): the source order, the flag, each sign and the dampener
from a record, that Arealytics never reaches a prompt, and that the tools being off changes
nothing. The research end to end is in test_research.py, and discovery from the feed in
test_runs.py.
"""

from datetime import UTC, date, datetime
from typing import Any

import pytest

from apps.lead_finder.company_leads import _sign
from apps.lead_finder.context import Signal
from apps.lead_finder.fields import CompanyFacts, TriggerFound
from apps.lead_finder.office_numbers import OfficeNumbers
from apps.lead_finder.params import DiscoveryParams
from apps.lead_finder.property import (
    apply_office_sources,
    for_card,
    hidden_sources,
    lookup_problems,
    office_hint_lines,
    office_readings,
    record_signs,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.run_sources import (
    check_sources,
    feed_found,
    picked_tools,
    source_options,
)
from apps.lead_finder.scoring import judge
from apps.lead_finder.sources import is_blocked, source_kind
from apps.lead_finder.sourcing import FactSource, OtherValue
from apps.lead_finder.steps.plan import make_slices
from core.api.errors import Problem
from core.hubspot.matching import HubSpotMatch
from core.sources.types import CompanyProperty, FeedItem, PropertyRecord, SourceChecks
from tests.lead_finder.conftest import lf_settings
from tests.lead_finder.samples import NEWS, fact, make_facts

RULES = load_rules()
TODAY = date(2026, 10, 26)
READ_AT = datetime(2026, 10, 20, tzinfo=UTC)
PD = "https://www.spatialgroup.com.au/cgi-bin/report.cgi?id=101"
AL = "https://app.arealytics.com.au/tenancy/77"
HUBSPOT = "https://app.hubspot.com/contacts/1/company/102"
ADDRESS = "120 Collins Street, Melbourne VIC 3000"
OLD_ADDRESS = "8 Spring Street, Melbourne VIC 3000"
AL_ADDRESS = "9 Secret Lane, Melbourne VIC 3000"
NEW_TO_US = HubSpotMatch(status="new")
READY = {
    "property_daily_enabled": True,
    "property_daily_username": "someone",
    "property_daily_password": "something",
    "tool_feeds_find_companies": True,  # the feed as before PLAN-V27 (its A6 switch)
}


def record(source: Any = "property_daily", kind: Any = "lease", **values: Any) -> PropertyRecord:
    base: dict[str, Any] = {
        "source": source,
        "kind": kind,
        "company": "Acme Software",
        "city": "Melbourne",
        "address": ADDRESS,
        "summary": "Acme Software leases an office at 120 Collins Street.",
        "url": PD if source == "property_daily" else AL,
        "read_at": READ_AT,
    }
    base.update(values)
    return PropertyRecord(**base)


def found(
    *records: PropertyRecord, property_daily: Any = "found", arealytics: Any = "found"
) -> CompanyProperty:
    checks = SourceChecks(property_daily=property_daily, arealytics=arealytics)
    return CompanyProperty(records=list(records), checked=checks)


def ordered(
    facts: CompanyFacts,
    tools: CompanyProperty | None,
    numbers: OfficeNumbers | None = None,
) -> Any:
    return apply_office_sources(facts, tools, numbers, "Melbourne", RULES, TODAY)


# --- The office now -----------------------------------------------------------------------------


def test_a_lease_that_still_runs_is_the_office_now() -> None:
    tools = found(
        record(floor="Level 12", area_m2=1400, lease_end=date(2028, 6, 30)),
        # an older lease of the same floor: it ended, but it says since when the company is there
        record(floor="Level 12", lease_start=date(2016, 7, 1), lease_end=date(2021, 6, 30)),
        record(address=OLD_ADDRESS, area_m2=900, lease_end=date(2016, 6, 30)),  # the old office
    )
    (reading,) = office_readings(tools, "Melbourne", RULES, TODAY).values()
    assert (reading.address, reading.floors, reading.area_m2) == (ADDRESS, ("Level 12",), 1400)
    assert (reading.lease_end, reading.since) == (date(2028, 6, 30), date(2016, 7, 1))


def test_each_floor_counts_once_and_the_floors_add_up() -> None:
    tools = found(
        record(floor="Level 12", area_m2=700, lease_end=date(2028, 6, 30)),
        record(floor="Level 13", area_m2=700, lease_end=date(2029, 6, 30)),
        record(floor="level 12", area_m2=650),  # the same floor again
    )
    (reading,) = office_readings(tools, "Melbourne", RULES, TODAY).values()
    assert reading.area_m2 == 1400
    assert reading.lease_end == date(2028, 6, 30)  # the first lease end to come


def test_a_move_that_has_happened_says_where_it_is_now() -> None:
    tools = found(
        record(address=OLD_ADDRESS, area_m2=900, lease_end=date(2027, 6, 30)),
        record(kind="move", happened_on=date(2026, 3, 1), area_m2=1600),
    )
    (reading,) = office_readings(tools, "Melbourne", RULES, TODAY).values()
    assert (reading.address, reading.since, reading.area_m2) == (ADDRESS, date(2026, 3, 1), 1600)


def test_one_address_with_no_dates_is_the_office_and_two_are_not_guessed() -> None:
    one = found(record(kind="occupier", area_m2=1200))
    (reading,) = office_readings(one, "Melbourne", RULES, TODAY).values()
    assert reading.area_m2 == 1200
    two = found(record(kind="occupier"), record(kind="occupier", address=OLD_ADDRESS))
    assert office_readings(two, "Melbourne", RULES, TODAY) == {}  # a past office looks the same


def test_a_unit_at_the_start_of_an_address_is_the_same_address() -> None:
    tools = found(
        record(address="Level 3, 1 Smith Street, Docklands VIC 3008", area_m2=600),
        record(address="1 Smith Street, Docklands VIC 3008", lease_end=date(2029, 1, 31)),
    )
    (reading,) = office_readings(tools, "Melbourne", RULES, TODAY).values()  # Docklands: Melbourne
    assert (reading.area_m2, reading.lease_end) == (600, date(2029, 1, 31))


def test_another_city_and_a_tool_that_is_off_dont_count() -> None:
    sydney = found(record(city="Sydney", address="1 George Street, Sydney NSW 2000"))
    assert office_readings(sydney, "Melbourne", RULES, TODAY) == {}
    off = found(record(lease_end=date(2028, 6, 30)), property_daily="off")
    assert office_readings(off, "Melbourne", RULES, TODAY) == {}
    assert for_card(off) == off.model_copy(update={"records": []})  # its records aren't kept
    assert office_readings(found(record()), None, RULES, TODAY) == {}  # no city, no office


# --- Which source wins ---------------------------------------------------------------------------


def test_the_tools_come_first_then_hubspot_then_the_research() -> None:
    tools = found(
        record(area_m2=2400, lease_end=date(2028, 6, 30)),
        record(lease_start=date(2016, 7, 1), lease_end=date(2021, 6, 30)),
    )
    numbers = OfficeNumbers(
        "Melbourne", None, date(2028, 3, 31), date(2016, 3, 1), HUBSPOT, office_m2=1800
    )
    out = ordered(make_facts(), tools, numbers)  # the research: 2,500 m², a lease end in March 2028
    facts = out.facts
    assert (facts.office_m2.value, facts.office_m2.source_url) == (2400, PD)
    assert facts.office_m2.label == "confirmed"
    assert facts.office_since.value == "2016-07-01"
    (lease,) = facts.triggers  # the research's lease sign gave way to Property Daily's
    assert (lease.id, lease.date, lease.source_url, lease.label) == (
        "lease_ending",
        "2028-06-30",
        PD,
        "confirmed",
    )
    assert lease.what_happened == f"Property Daily has the lease at {ADDRESS} ending in June 2028."
    size, since, ends = out.entries
    assert size == FactSource(
        fact="office_m2",
        used="property_daily",
        others=[
            OtherValue(source="hubspot", value="1,800 m²", url=HUBSPOT),
            OtherValue(source="claude", value="2,500 m²", url=NEWS),
        ],
        conflict="The office sizes are more than 1.25 times apart: Property Daily 2,400 m², "
        "HubSpot 1,800 m², Claude 2,500 m². Check which is right.",
    )
    assert (since.used, [o.value for o in since.others], since.conflict) == (
        "property_daily",
        ["March 2016"],
        None,
    )
    assert (ends.used, [o.source for o in ends.others]) == ("property_daily", ["hubspot", "claude"])
    assert out.from_hubspot == []  # HubSpot won nothing


def test_the_flag_from_the_plan_arealytics_1400_against_the_web_900() -> None:
    tools = found(record("arealytics", area_m2=1400, lease_end=date(2028, 6, 30)))
    out = ordered(make_facts(office_m2=fact(900)), tools)
    size = next(entry for entry in out.entries if entry.fact == "office_m2")
    assert size.used == "arealytics"
    assert size.conflict == (
        "The office sizes are more than 1.25 times apart: Arealytics 1,400 m², Claude 900 m². "
        "Check which is right."
    )


@pytest.mark.parametrize(
    ("ends", "sign"),
    [
        (date(2027, 9, 30), False),  # 11 months: too soon for the sign
        (date(2027, 10, 31), True),  # 12 months
        (date(2029, 10, 31), True),  # 36 months
        (date(2029, 11, 30), False),  # 37 months: too far
    ],
)
def test_a_tools_lease_end_is_a_sign_only_12_to_36_months_out(ends: date, sign: bool) -> None:
    out = ordered(make_facts(), found(record(lease_end=ends)))
    leases = [t for t in out.facts.triggers if t.id == "lease_ending"]
    # The research's own lease end (March 2028) gave way to the tool's either way
    assert [(t.date, t.source_url) for t in leases] == ([(ends.isoformat(), PD)] if sign else [])


def test_with_both_tools_off_or_silent_nothing_changes() -> None:
    """A run with both tools off works as today (the plan's "Done when")."""
    facts = make_facts(office_since=fact("2015"), last_fitout=fact("2019"))
    off = found(
        record(area_m2=9000, lease_end=date(2028, 6, 30)),
        record("arealytics", area_m2=9000),
        record(kind="fitout", published_on=date(2026, 9, 1)),
        property_daily="off",
        arealytics="off",
    )
    for tools in (None, off, found()):
        out = ordered(facts, tools)
        assert (out.facts, out.entries, out.from_hubspot) == (facts, [], [])
        assert record_signs(facts, tools, [], "Melbourne", RULES, TODAY) == facts


def test_a_fitout_record_is_the_last_fitout_and_the_dampener() -> None:
    def judged_with(published: date) -> Any:
        tools = found(record(kind="fitout", address=None, published_on=published))
        out = ordered(make_facts(), tools)
        verdict = judge(out.facts, NEW_TO_US, RULES, TODAY)
        return out, next(item for item in verdict.dampeners if item.id == "recent_fitout")

    out, damper = judged_with(date(2024, 10, 1))  # given to a firm 2 years ago
    assert (out.facts.last_fitout.value, out.facts.last_fitout.source_url) == ("2024-10-01", PD)
    assert out.entries == [
        FactSource(fact="last_fitout", used="property_daily", others=[], conflict=None)
    ]
    assert (damper.state, damper.strength, damper.url) == ("found", "strong", PD)
    _, damper = judged_with(date(2022, 6, 1))  # 4 years ago
    assert (damper.state, damper.strength) == ("found", "moderate")
    _, damper = judged_with(date(2020, 6, 1))  # 6 years ago: too long ago to count
    assert damper.state == "not_found"


def test_a_newer_fitout_from_the_research_stays() -> None:
    tools = found(record(kind="fitout", published_on=date(2020, 6, 1)))
    facts = make_facts(last_fitout=fact("2024-05"))
    assert ordered(facts, tools).facts == facts


def test_eight_years_at_the_address_is_the_tenure_sign() -> None:
    tools = found(
        record(area_m2=2500, lease_start=date(2016, 1, 1), lease_end=date(2031, 12, 31)),
    )
    out = ordered(make_facts(triggers=[]), tools)
    verdict = judge(out.facts, NEW_TO_US, RULES, TODAY)
    (sign,) = verdict.triggers
    assert sign.trigger.id == "long_tenure"
    assert sign.trigger.source_url == PD


# --- Signs from records ---------------------------------------------------------------------------


def test_a_search_for_space_is_the_tenant_advisor_sign() -> None:
    wants = record(
        kind="requirement",
        address=None,
        area_m2=2000,
        published_on=date(2026, 10, 1),
        summary="Acme Software is looking for 2,000 m² of office space in Melbourne.",
    )
    facts = record_signs(make_facts(triggers=[]), found(wants), [], "Melbourne", RULES, TODAY)
    assert facts.triggers == [
        TriggerFound(
            id="tenant_advisor",
            # one_line writes m² as m2, as it does for every sign
            what_happened="Property Daily: Acme Software is looking for 2,000 m2 of office space "
            "in Melbourne.",
            date="2026-10-01",
            source_url=PD,
            label="confirmed",
        )
    ]
    verdict = judge(facts, NEW_TO_US, RULES, TODAY)
    assert [score.trigger.id for score in verdict.triggers] == ["tenant_advisor"]
    assert verdict.triggers[0].source_kind == "property_daily"  # the tools rank first


def test_a_move_still_to_come_is_a_relocation_sign_and_one_that_happened_is_not() -> None:
    moves = found(
        record(kind="move", summary="Acme Software is moving to 1 Smith Street."),
        record(kind="move", happened_on=date(2027, 3, 1), address="1 Smith Street, Docklands"),
        record(kind="move", happened_on=date(2025, 3, 1), address=OLD_ADDRESS),
    )
    facts = record_signs(make_facts(triggers=[]), moves, [], "Melbourne", RULES, TODAY)
    assert [(sign.id, sign.date) for sign in facts.triggers] == [
        ("lease_ending", None),
        ("lease_ending", "2027-03-01"),
    ]


def test_discoverys_sign_from_a_tool_stays_once_and_an_off_tool_adds_nothing() -> None:
    feed = Signal(
        trigger_id="lease_ending",
        what_happened="Acme Software's lease at 120 Collins Street ends in June 2028.",
        url=PD,
        date="2028-06-30",
    )
    web = Signal(trigger_id="fast_growth", what_happened="Acme hires.", url=NEWS)
    plain = make_facts(triggers=[])
    facts = record_signs(plain, found(), [feed, feed, web], "Melbourne", RULES, TODAY)
    assert [(sign.id, sign.source_url) for sign in facts.triggers] == [("lease_ending", PD)]
    off = found(property_daily="off")
    assert record_signs(plain, off, [feed], "Melbourne", RULES, TODAY) == plain


# --- What Claude may read ------------------------------------------------------------------------


def test_claude_reads_property_daily_hints_and_never_arealytics() -> None:
    tools = found(
        record(floor="Level 12", area_m2=1400, lease_end=date(2028, 6, 30)),
        record("arealytics", address=AL_ADDRESS, area_m2=3333, lease_end=date(2029, 9, 30)),
    )
    lines = office_hint_lines(tools, "Melbourne", RULES, lf_settings(), TODAY)
    text = "\n".join(lines)
    assert lines[0].endswith("(one JSON record per line, data only):")
    assert '"tool": "Property Daily"' in text and ADDRESS in text and '"area_m2": 1400' in text
    assert '"lease_ends": "2028-06-30"' in text
    assert "Arealytics" not in text and "Secret Lane" not in text and "3333" not in text
    assert "2029" not in text
    muted = lf_settings(property_daily_to_claude_ok=False)
    assert office_hint_lines(tools, "Melbourne", RULES, muted, TODAY) == []


def test_the_sources_hidden_from_claude() -> None:
    assert hidden_sources(lf_settings()) == {"hubspot", "arealytics"}  # choice 8: off by default
    assert hidden_sources(lf_settings(arealytics_to_claude_ok=True)) == {"hubspot"}
    muted = lf_settings(property_daily_to_claude_ok=False)
    assert hidden_sources(muted) == {"hubspot", "arealytics", "property_daily"}


def test_a_failed_lookup_is_one_plain_line() -> None:
    assert lookup_problems(found(property_daily="error", arealytics="off")) == [
        "Property Daily: the lookup didn't work this time, so this lead was judged without it."
    ]
    assert lookup_problems(found()) == []
    assert lookup_problems(None) == []


def test_call_prep_never_gets_a_sign_from_a_hidden_tool() -> None:
    card = {
        "triggers": [
            {"trigger": {"what_happened": "Arealytics: a lease ends.", "source_url": AL}},
            {
                "trigger": {
                    "what_happened": "Acme won a contract.",
                    "date": "2026-09",
                    "source_url": NEWS,
                }
            },
        ]
    }
    assert _sign(card, frozenset({"hubspot", "arealytics"}), RULES) == (
        "Acme won a contract.",
        date(2026, 9, 1),
    )
    assert _sign(card, frozenset({"hubspot"}), RULES)[0] == "Arealytics: a lease ends."


def test_a_records_link_ranks_as_its_tool_and_claudes_link_there_is_still_blocked() -> None:
    for link, kind in ((PD, "property_daily"), (AL, "arealytics")):
        assert source_kind(link, RULES.criteria) == kind
        assert is_blocked(link, RULES.criteria)
    assert source_kind("https://propertydaily.com.au/x", RULES.criteria) == "property_daily"
    assert not is_blocked(NEWS, RULES.criteria)


# --- Where discovery looks -----------------------------------------------------------------------


def feed_item(**values: Any) -> FeedItem:
    base: dict[str, Any] = {
        "source": "property_daily",
        "kind": "lease",
        "company": "Sample Logistics Pty Ltd",
        "city": "Melbourne",
        "address": ADDRESS,
        "lease_end": date(2028, 6, 30),
        "published_on": date(2026, 10, 20),
        "summary": "Sample Logistics Pty Ltd's lease at 120 Collins Street ends in June 2028.",
        "url": PD,
        "read_at": READ_AT,
        "sign_id": "lease_ending",
    }
    base.update(values)
    return FeedItem(**base)


def test_feed_items_become_companies_found() -> None:
    params = DiscoveryParams(cities=["Melbourne"], triggers=["lease_ending", "tenant_advisor"])
    items = [
        feed_item(),
        feed_item(company="Sample Mining", city="Perth", address=None),  # not the run's city
        feed_item(company="Sample Studio", sign_id=None, dampener_id="recent_fitout"),  # a damper
        feed_item(company="x"),  # not a name we can use
        feed_item(company="Sample Bank", sign_id="new_ceo"),  # a sign the run doesn't look for
        feed_item(
            company="Sample Energy",
            kind="requirement",
            sign_id="tenant_advisor",
            lease_end=None,
            address=None,
            summary="Sample Energy is looking for 2,000 m² of office space in Melbourne.",
        ),
    ]
    found_ = feed_found(items, params, RULES)
    assert [(f.name, f.city, f.trigger_id, f.date) for f in found_] == [
        ("Sample Logistics Pty Ltd", "Melbourne", "lease_ending", "2028-06-30"),
        ("Sample Energy", "Melbourne", "tenant_advisor", "2026-10-20"),
    ]
    assert {f.slice_id for f in found_} == {"feed:property_daily"}
    assert found_[0].url == PD and found_[0].published == "2026-10-20"


def test_all_of_australia_takes_any_of_our_places() -> None:
    params = DiscoveryParams(cities=["Australia"], triggers=["lease_ending"])
    items = [
        feed_item(city="Darwin", address="1 Mitchell Street, Darwin NT 0800"),
        feed_item(company="Sample Town", city=None, address=None),
    ]
    assert [(f.name, f.city) for f in feed_found(items, params, RULES)] == [
        ("Sample Logistics Pty Ltd", "Darwin"),
        ("Sample Town", None),
    ]


def test_a_tool_the_run_names_must_be_ready() -> None:
    params = DiscoveryParams(sources=["web", "property_daily"])
    with pytest.raises(Problem) as refused:
        check_sources(params, lf_settings(tool_feeds_find_companies=True))
    assert refused.value.status == 422
    assert refused.value.code == "source_not_ready"
    assert "Property Daily is switched off. An Admin can switch it on." in str(refused.value.detail)
    check_sources(params, lf_settings(**READY))  # ready: no error
    with pytest.raises(Problem):
        check_sources(DiscoveryParams(sources=["arealytics"]), lf_settings(**READY))


def test_left_out_the_run_reads_every_ready_tool() -> None:
    assert picked_tools(DiscoveryParams(), lf_settings(tool_feeds_find_companies=True)) == []
    assert picked_tools(DiscoveryParams(), lf_settings(**READY)) == ["property_daily"]
    assert picked_tools(DiscoveryParams(sources=["web"]), lf_settings(**READY)) == []


def test_without_the_web_a_run_makes_no_web_searches() -> None:
    assert make_slices(DiscoveryParams(sources=["property_daily"]), RULES) == []
    assert len(make_slices(DiscoveryParams(sources=["web"]), RULES)) == len(
        make_slices(DiscoveryParams(), RULES)
    )


def test_the_start_page_sees_each_source_and_why_one_isnt_ready() -> None:
    """By id, with `message`: the names Track 3 chose where the contract left one open."""
    options = source_options(lf_settings())
    assert {key: (o.on, o.ready, o.message) for key, o in options.items()} == {
        "web": (True, True, None),
        "property_daily": (
            False,
            False,
            "Property Daily is switched off. An Admin can switch it on.",
        ),
        "arealytics": (False, False, "Arealytics isn't connected: it refused automated access."),
    }
    no_login = lf_settings(property_daily_enabled=True)
    assert source_options(no_login)["property_daily"].message == (
        "Property Daily has no login yet. An Admin needs to add one."
    )
    assert source_options(lf_settings(**READY))["property_daily"].ready


def test_a_source_is_named_once() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="List each source once"):
        DiscoveryParams(sources=["web", "web"])
    with pytest.raises(ValidationError):
        DiscoveryParams(sources=[])


def test_a_company_found_by_a_tool_and_by_the_web_is_one_candidate() -> None:
    from apps.lead_finder.steps.discover import Found
    from apps.lead_finder.steps.merge import merge

    params = DiscoveryParams(cities=["Melbourne"], triggers=["lease_ending", "fast_growth"])
    (from_feed,) = feed_found([feed_item()], params, RULES)
    from_web = Found(
        name="Sample Logistics",
        website="samplelogistics.com.au",
        city="Melbourne",
        trigger_id="fast_growth",
        what_happened="Sample Logistics is hiring 80 people.",
        date="2026-10",
        url=NEWS,
        published="2026-10-10",
        slice_id="melbourne:fast_growth",
    )
    (company,) = merge([from_feed, from_web])
    signs = sorted(signal.trigger_id for signal in company.signals)
    assert signs == ["fast_growth", "lease_ending"]
    assert company.website == "samplelogistics.com.au"
