"""The HubSpot watchlist: the golden test on the real export, then each rule on made-up rows.

The golden test reads projects/leads/research/COMPANIES.xlsx and expects the lists in
projects/leads/research/EXPORT.md (sections 3, 8 and 9). It needs no database and is fast.
The two integration tests at the end check the loader and the route against the same export.
"""

from collections.abc import AsyncIterator
from datetime import date

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.rules import LeadFinderRules, load_rules
from apps.lead_finder.schemas import WatchCounts
from apps.lead_finder.watchlist import (
    PLACEHOLDER_NAME,
    HubSpotRow,
    WatchDeal,
    WatchOffice,
    WatchResult,
    build_watchlist,
    load_watchlist,
    load_watchlist_rows,
    metro_city,
    rows_from_export,
    watchlist_out,
)
from core.api.app import create_app
from core.config import BACKEND_DIR
from core.db.engine import get_session
from core.hubspot.importer import HubSpotExport, read_export
from core.hubspot.service import save_export

RESEARCH_DIR = BACKEND_DIR.parents[1] / "projects" / "leads" / "research"
EXPORT_XLSX = RESEARCH_DIR / "COMPANIES.xlsx"
EXPORT_MD = RESEARCH_DIR / "EXPORT.md"
RULES = load_rules()

# --- The golden test: the real export against EXPORT.md ---------------------------------

FIRST_ELEVEN_LIKELY = [
    "Synechron Australia",
    "SME Powered Services",
    "JAM TV",
    "Cullen Jewellery",
    "Clinibase",
    "Cyclotek Pty Ltd",
    "Gibson Quai International (GQI)",
    "Otic Group",
    "AusWISE",
    "Crux Biolabs",
    "Horizon Nexus Partners",
]
OPEN_DEAL_NAMES = [
    "209 Greenhill Road",
    "Alvarez & Marsal",
    "Ascaro Padel",
    "Kyndryl",
    "Nilsen Group",
    "PYC Therapeutics",
    "Shakespeare Financial Group",
]
GOLDEN_COUNTS = WatchCounts(
    companies=100,
    watch=47,
    likely=11,
    unlikely=36,
    director=15,
    open_deal=7,
    dropped_small=21,  # 20 under 100 staff, and BG&E Resources with no staff number
    staff_unknown=1,
    no_office=10,  # this includes the "(no name on record)" company
)


@pytest.fixture(scope="module")
def export() -> HubSpotExport:
    if not EXPORT_XLSX.is_file():
        pytest.skip(f"The golden test needs {EXPORT_XLSX}, and it is missing")
    return read_export(EXPORT_XLSX)


@pytest.fixture(scope="module")
def golden(export: HubSpotExport) -> WatchResult:
    return build_watchlist(rows_from_export(export), RULES, include_director=True)


def doc_table(section: str) -> list[list[str]]:
    """The rows of the first table under the heading that starts with `section`, as cells."""
    if not EXPORT_MD.is_file():
        pytest.skip(f"The golden test needs {EXPORT_MD}, and it is missing")
    lines = EXPORT_MD.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(section))
    rows: list[list[str]] = []
    for line in lines[start + 1 :]:
        if line.startswith("## "):
            break
        if line.startswith("|") and not line.startswith(("|---", "| #")):
            rows.append([cell.strip() for cell in line.strip().strip("|").split("|")])
    return rows


def test_the_counts_are_the_ones_in_the_export_document(golden: WatchResult) -> None:
    assert golden.counts == GOLDEN_COUNTS
    counts = golden.counts
    # Every company is counted once.
    assert counts.companies == (
        counts.watch + counts.director + counts.open_deal + counts.dropped_small + counts.no_office
    )
    assert counts.watch == counts.likely + counts.unlikely
    assert counts.staff_unknown <= counts.dropped_small


def test_the_watch_list_is_47_companies_with_the_cities_of_the_document(
    golden: WatchResult,
) -> None:
    assert len(golden.items) == 47
    cities = [item.city for item in golden.items]
    assert {city: cities.count(city) for city in ("Melbourne", "Perth", "Adelaide")} == {
        "Melbourne": 26,
        "Perth": 20,
        "Adelaide": 1,
    }


def test_the_first_eleven_likely_companies_are_in_the_order_of_the_document(
    golden: WatchResult,
) -> None:
    likely = [item.name for item in golden.items if item.office_based == "likely"]
    assert likely == FIRST_ELEVEN_LIKELY
    assert [item.name for item in golden.items[:11]] == FIRST_ELEVEN_LIKELY  # then all unlikely
    assert {item.office_based for item in golden.items[11:]} == {"unlikely"}


def test_the_whole_watch_list_equals_section_8_of_the_document(golden: WatchResult) -> None:
    table = doc_table("## 8.")
    assert len(table) == 47
    expected = [
        {
            "name": cells[1],
            "city": cells[2],
            "linkedin_staff": int(cells[3]),
            "estimated_staff": int(cells[4].removeprefix("~")),
            "industry": cells[5],
            "office_based": cells[6].lower(),
            "note": cells[7] or None,
        }
        for cells in table
    ]
    actual = [item.model_dump(include=set(expected[0])) for item in golden.items]
    assert actual == expected


def test_the_director_list_equals_section_9_of_the_document(golden: WatchResult) -> None:
    table = doc_table("## 9.")
    assert len(table) == 15
    expected = [
        {
            "name": cells[1],
            "city": cells[2],
            "linkedin_staff": int(cells[3]),
            "estimated_staff": int(cells[4].removeprefix("~")),
            "industry": cells[5],
        }
        for cells in table
    ]
    actual = [item.model_dump(include=set(expected[0])) for item in golden.director]
    assert actual == expected
    assert [item.name for item in golden.director[:2]] == ["Altaira", "Bayside Health"]
    bayside = golden.director[1]
    assert bayside.estimated_staff == 856  # over staff_max (600), and still listed


def test_the_director_list_is_empty_unless_asked_for(export: HubSpotExport) -> None:
    result = build_watchlist(rows_from_export(export), RULES)
    assert result.director == []
    assert result.counts.director == 15  # the counts describe the whole export
    assert result.counts == GOLDEN_COUNTS
    assert [item.name for item in result.candidates] == [item.name for item in result.items]


def test_the_seven_open_deal_companies_are_left_out(golden: WatchResult) -> None:
    assert golden.open_deal_names == OPEN_DEAL_NAMES
    listed = {item.name for item in [*golden.items, *golden.director, *golden.staff_unknown]}
    assert not listed & set(OPEN_DEAL_NAMES)


def test_bge_resources_has_no_staff_number_and_is_listed_apart(
    golden: WatchResult, export: HubSpotExport
) -> None:
    assert [item.name for item in golden.staff_unknown] == ["BG&E Resources"]
    item = golden.staff_unknown[0]
    assert (item.linkedin_staff, item.estimated_staff, item.city) == (None, None, "Perth")
    assert "BG&E Resources" not in {i.name for i in golden.items}


def test_the_employees_column_never_fills_in_a_missing_staff_number(
    export: HubSpotExport, golden: WatchResult
) -> None:
    bge = next(c for c in export.companies if c.name == "BG&E Resources")
    changed = export.model_copy(
        update={
            "companies": [
                c.model_copy(update={"employees": 900, "linkedin_staff_au": 900}) if c is bge else c
                for c in export.companies
            ]
        }
    )
    assert build_watchlist(rows_from_export(changed), RULES, include_director=True) == golden


def test_patties_stays_on_the_list_with_its_note(golden: WatchResult) -> None:
    patties = next(item for item in golden.items if item.name == "Patties Food Group")
    assert patties.note == "Dissolved deal"
    assert patties.last_dissolved == date(2026, 10, 7)
    assert patties.office_based == "unlikely"
    others = [item for item in golden.items if item.note]
    assert others == [patties]


def test_the_companys_own_city_state_and_country_are_never_read(
    export: HubSpotExport, golden: WatchResult
) -> None:
    scrambled = export.model_copy(
        update={
            "companies": [
                company.model_copy(
                    update={
                        "city": "Hobart",
                        "state": "TAS",
                        "state_raw": "Tasmania",
                        "country": "Mexico",
                        "postal_code": "7000",
                        "street": "1 Nowhere Road",
                    }
                )
                for company in export.companies
            ]
        }
    )
    assert build_watchlist(rows_from_export(scrambled), RULES, include_director=True) == golden


def test_the_order_of_the_rows_does_not_change_the_answer(
    export: HubSpotExport, golden: WatchResult
) -> None:
    rows = rows_from_export(export)
    reversed_rows = [
        HubSpotRow(
            row.hubspot_id,
            row.name,
            row.industry,
            row.owner,
            row.domain,
            tuple(reversed(row.offices)),
            tuple(reversed(row.deals)),
        )
        for row in reversed(rows)
    ]
    assert build_watchlist(reversed_rows, RULES, include_director=True) == golden


def test_leaving_out_the_unlikely_companies_keeps_the_counts(export: HubSpotExport) -> None:
    result = build_watchlist(rows_from_export(export), RULES, include_unlikely=False)
    assert [item.name for item in result.items] == FIRST_ELEVEN_LIKELY
    assert result.counts == GOLDEN_COUNTS


def test_the_preview_answer_has_the_full_total_and_a_limited_list(golden: WatchResult) -> None:
    answer = watchlist_out(golden, limit=5)
    assert answer.total == 47
    assert [item.name for item in answer.items] == FIRST_ELEVEN_LIKELY[:5]
    assert len(answer.director) == 15
    assert [item.name for item in answer.staff_unknown] == ["BG&E Resources"]
    assert answer.counts == GOLDEN_COUNTS
    assert watchlist_out(golden).items == golden.items


def test_each_listed_company_has_its_domain(golden: WatchResult, export: HubSpotExport) -> None:
    by_id = {company.hubspot_id: company.domain for company in export.companies}
    for item in [*golden.items, *golden.director, *golden.staff_unknown]:
        assert golden.domains[item.hubspot_id] == by_id[item.hubspot_id]


# --- Each rule on made-up rows ----------------------------------------------------------


def office(
    label: str = "Melbourne",
    staff: int | None = 60,
    city: str | None = None,
    postcode: str | None = None,
) -> WatchOffice:
    return WatchOffice(label=label, city=city, postal_code=postcode, linkedin_staff=staff)


def company(
    hubspot_id: str = "100",
    name: str = "Acme",
    industry: str | None = "Information Technology And Services",
    offices: tuple[WatchOffice, ...] | None = None,
    deals: tuple[WatchDeal, ...] = (),
    owner: str | None = None,
    domain: str | None = None,
) -> HubSpotRow:
    return HubSpotRow(
        hubspot_id=hubspot_id,
        name=name,
        industry=industry,
        owner=owner,
        domain=domain,
        offices=(office(),) if offices is None else offices,
        deals=deals,
    )


def build(*rows: HubSpotRow, rules: LeadFinderRules = RULES, **options: bool) -> WatchResult:
    return build_watchlist(rows, rules, **options)


def with_staff_max_for_director(rules: LeadFinderRules, applies: bool) -> LeadFinderRules:
    staff = rules.watchlist.staff.model_copy(update={"staff_max_applies_to_director": applies})
    return rules.model_copy(
        update={"watchlist": rules.watchlist.model_copy(update={"staff": staff})}
    )


def test_a_blank_industry_is_likely_with_a_note() -> None:
    for blank in (None, "", "   "):
        result = build(company(industry=blank))
        (item,) = result.items
        assert item.office_based == "likely"
        assert item.note == "Industry unknown"
        assert item.industry is None


def test_a_known_industry_has_no_note() -> None:
    (item,) = build(company()).items
    assert (item.note, item.industry, item.office_based) == (
        None,
        "Information Technology And Services",
        "likely",
    )


def test_an_unknown_industry_name_is_likely_not_unlikely() -> None:
    (item,) = build(company(industry="Underwater Basket Weaving")).items
    assert item.office_based == "likely"
    assert item.note is None


def test_industry_names_match_exactly_ignoring_case_and_extra_spaces() -> None:
    result = build(
        company("1", "Lower", "construction"),
        company("2", "Spaced", "  Civil   Engineering "),
        company("3", "Longer", "Construction Management"),  # not a match: no substring rule
        company("4", "Retail Trade", "Retail Trade"),
    )
    based = {item.name: item.office_based for item in result.items}
    assert based == {
        "Lower": "unlikely",
        "Spaced": "unlikely",
        "Longer": "likely",
        "Retail Trade": "likely",
    }


def test_the_none_group_names_are_unlikely_too() -> None:
    result = build(company("1", "Oil", "Oil Energy"), company("2", "Clinic", "Medical Practice"))
    assert {item.office_based for item in result.items} == {"unlikely"}


def test_a_director_industry_goes_to_the_director_list_not_the_watch_list() -> None:
    result = build(company("1", "Firm", "law practice"), include_director=True)
    assert result.items == []
    assert [item.name for item in result.director] == ["Firm"]
    assert result.director[0].office_based == "likely"
    assert (result.counts.watch, result.counts.director) == (0, 1)


def test_the_director_list_has_no_upper_staff_limit() -> None:
    big = company("1", "Big Hospital", "Hospital Health Care", (office(staff=400),))  # est. 800
    ordinary = company("2", "Big Builder", "Construction", (office(staff=400),))
    result = build(big, ordinary, include_director=True)
    assert [item.name for item in result.director] == ["Big Hospital"]
    assert result.items == []
    assert result.counts.dropped_small == 1  # the builder is over 600, so it is left out


def test_the_staff_limit_can_be_made_to_apply_to_the_director_list() -> None:
    rules = with_staff_max_for_director(RULES, True)
    big = company("1", "Big Hospital", "Hospital Health Care", (office(staff=400),))
    result = build(big, rules=rules, include_director=True)
    assert result.director == []
    assert result.counts.director == 0
    assert result.counts.dropped_small == 1


def test_a_director_company_under_the_minimum_is_dropped() -> None:
    small = company("1", "Small Law", "Law Practice", (office(staff=49),))
    result = build(small, include_director=True)
    assert result.director == []
    assert result.counts.dropped_small == 1


def test_the_staff_limits_include_their_own_numbers() -> None:
    result = build(
        company("1", "Exactly 100", offices=(office(staff=50),)),
        company("2", "Just under", offices=(office(staff=49),)),
        company("3", "Exactly 600", offices=(office(staff=300),)),
        company("4", "Just over", offices=(office(staff=301),)),
    )
    assert sorted(item.name for item in result.items) == ["Exactly 100", "Exactly 600"]
    assert result.counts.dropped_small == 2


def test_estimated_staff_is_the_biggest_office_in_a_counted_city_times_the_multiplier() -> None:
    offices = (
        office("Perth", 40),
        office("Melbourne", 60),
        office("Sydney", 500),  # Sydney is not a counted city
        office("Brisbane", 900),
    )
    (item,) = build(company(offices=offices)).items
    assert (item.city, item.linkedin_staff, item.estimated_staff) == ("Melbourne", 60, 120)


def test_staff_is_not_added_up_across_offices() -> None:
    offices = (office("Melbourne", 30), office("Perth", 30))  # 60 together, 30 in the biggest
    result = build(company(offices=offices))
    assert result.items == []
    assert result.counts.dropped_small == 1


def test_a_tie_between_cities_goes_to_the_city_listed_first_in_the_rules() -> None:
    for offices in (
        (office("Perth", 60), office("Melbourne", 60)),
        (office("Melbourne", 60), office("Perth", 60)),
    ):
        (item,) = build(company(offices=offices)).items
        assert item.city == "Melbourne"


def test_a_missing_staff_number_is_unknown_and_listed_apart() -> None:
    result = build(
        company("1", "No number", offices=(office("Melbourne", None), office("Sydney", 500))),
    )
    assert result.items == []
    (item,) = result.staff_unknown
    assert (item.name, item.city, item.linkedin_staff, item.estimated_staff) == (
        "No number",
        "Melbourne",
        None,
        None,
    )
    assert (result.counts.dropped_small, result.counts.staff_unknown) == (1, 1)


def test_a_company_with_one_office_missing_staff_uses_the_office_that_has_it() -> None:
    offices = (office("Melbourne", None), office("Perth", 60))
    (item,) = build(company(offices=offices)).items
    assert (item.city, item.linkedin_staff) == ("Perth", 60)


def test_a_director_company_with_no_staff_number_is_unknown_too() -> None:
    result = build(
        company("1", "Unknown Law", "Law Practice", (office(staff=None),)), include_director=True
    )
    assert result.director == []
    assert [item.name for item in result.staff_unknown] == ["Unknown Law"]


def test_zero_staff_is_a_number_not_a_missing_one() -> None:
    result = build(company(offices=(office(staff=0),)))
    assert result.staff_unknown == []
    assert result.counts.dropped_small == 1


def test_a_company_with_no_office_in_a_counted_city_is_dropped() -> None:
    result = build(
        company("1", "Sydney only", offices=(office("Sydney", 500),)),
        company("2", "No offices", offices=()),
    )
    assert result.items == []
    assert result.counts.no_office == 2


def test_an_open_deal_leaves_the_company_out_first() -> None:
    result = build(
        company("1", "Open Deal Co", deals=(WatchDeal("Verified Information Deal"),)),
        company("2", "Open and no office", offices=(), deals=(WatchDeal("Unqualified"),)),
        company("3", "Open and small", offices=(office(staff=1),), deals=(WatchDeal("Won"),)),
    )
    assert result.items == []
    assert result.open_deal_names == ["Open and no office", "Open and small", "Open Deal Co"]
    assert (result.counts.open_deal, result.counts.no_office, result.counts.dropped_small) == (
        3,
        0,
        0,
    )


def test_an_open_deal_comes_before_the_director_split() -> None:
    law = company("1", "Law With Deal", "Law Practice", deals=(WatchDeal("Verified"),))
    plain_law = company("2", "Law", "Law Practice")
    result = build(law, plain_law, include_director=True)
    assert [item.name for item in result.director] == ["Law"]
    assert result.open_deal_names == ["Law With Deal"]
    assert result.counts.director == 1


def test_a_deal_with_no_stage_counts_as_open() -> None:
    result = build(company(deals=(WatchDeal(None),)))
    assert result.items == []
    assert result.counts.open_deal == 1


def test_a_dissolved_deal_keeps_the_company_with_a_note() -> None:
    deals = (
        WatchDeal("Dissolved", date(2026, 5, 1)),
        WatchDeal(" DISSOLVED ", date(2026, 10, 7)),
        WatchDeal("Dissolved", None),
    )
    (item,) = build(company(deals=deals)).items
    assert item.note == "Dissolved deal"
    assert item.last_dissolved == date(2026, 10, 7)  # the latest one


def test_a_dissolved_deal_and_a_blank_industry_give_both_notes() -> None:
    (item,) = build(company(industry=None, deals=(WatchDeal("Dissolved", None),))).items
    assert item.note == "Dissolved deal; Industry unknown"
    assert item.last_dissolved is None


def test_the_label_of_an_office_is_its_city_when_it_is_a_known_metro_city() -> None:
    # The label wins over the city text.
    assert metro_city(office("Sydney", city="Richmond"), RULES) == "Sydney"
    assert metro_city(office(" perth ", city="Sydney"), RULES) == "Perth"
    assert metro_city(office("Brisbane", city=None), RULES) == "Brisbane"


def test_an_other_office_is_placed_by_its_city_text() -> None:
    assert metro_city(office("Other Office 2", city="Richmond"), RULES) == "Melbourne"
    assert metro_city(office("Other Office 2", city="Kent Town"), RULES) == "Adelaide"
    assert metro_city(office("Other Office 2", city="Melbourne VIC", postcode="2600"), RULES) == (
        "Melbourne"
    )


def test_an_other_office_is_placed_by_the_state_of_its_postcode_when_the_city_is_no_help() -> None:
    assert metro_city(office("Other Office 2", city="Footscray", postcode="3011"), RULES) == (
        "Melbourne"
    )
    assert metro_city(office("Other Office 2", city=None, postcode="5000"), RULES) == "Adelaide"
    assert metro_city(office("Other Office 2", city=None, postcode="6000"), RULES) == "Perth"
    assert metro_city(office("Other Office 2", city=None, postcode="2000"), RULES) == "Sydney"
    assert metro_city(office("Other Office 2", city=None, postcode="4000"), RULES) == "Brisbane"


def test_an_other_office_in_the_act_the_nt_or_with_no_usable_postcode_is_ignored() -> None:
    for city, postcode in (
        ("Lyneham", "2602"),  # ACT
        ("Berrimah", "0828"),  # NT
        ("Berrimah", "828"),  # NT, with the leading zero lost
        ("Hobart", "7000"),  # TAS
        ("Nowhere", None),
        ("Nowhere", "abc"),
        (None, "99999"),
    ):
        assert metro_city(office("Other Office 2", city=city, postcode=postcode), RULES) is None


def test_an_other_office_can_make_a_company_fit() -> None:
    offices = (office("Other Office 2", 80, city="Richmond"),)
    (item,) = build(company(offices=offices)).items
    assert (item.city, item.estimated_staff) == ("Melbourne", 160)
    ignored = (office("Other Office 2", 80, city="Lyneham", postcode="2602"),)
    assert build(company(offices=ignored)).counts.no_office == 1


def test_the_list_is_sorted_likely_first_then_city_then_biggest_then_newest() -> None:
    def small(hubspot_id: str, industry: str, label: str, staff: int) -> HubSpotRow:
        return company(hubspot_id, f"Co {hubspot_id}", industry, (office(label, staff),))

    result = build(
        small("1", "Construction", "Adelaide", 200),  # unlikely, so after every likely one
        small("2", "Biotechnology", "Perth", 90),
        small("3", "Biotechnology", "Melbourne", 60),
        small("4", "Biotechnology", "Melbourne", 80),
        small("5", "Biotechnology", "Adelaide", 60),
        small("6", "Biotechnology", "Melbourne", 60),  # same staff as 3: the newer id comes first
        small("10", "Biotechnology", "Melbourne", 60),
        small("7", "Retail", "Melbourne", 70),
    )
    assert [item.hubspot_id for item in result.items] == ["5", "4", "10", "6", "3", "2", "1", "7"]


def test_the_director_list_ignores_office_based_and_uses_the_same_order() -> None:
    def firm(hubspot_id: str, industry: str, label: str, staff: int) -> HubSpotRow:
        return company(hubspot_id, f"Firm {hubspot_id}", industry, (office(label, staff),))

    result = build(
        firm("1", "Insurance", "Perth", 70),
        firm("2", "Law Practice", "Melbourne", 60),
        firm("3", "Hospital Health Care", "Melbourne", 90),
        firm("4", "Banking", "Adelaide", 55),
        include_director=True,
    )
    assert [item.hubspot_id for item in result.director] == ["4", "3", "2", "1"]


def test_ids_that_are_not_numbers_do_not_break_the_sort() -> None:
    result = build(
        company("abc", "A", offices=(office(staff=60),)),
        company("12", "B", offices=(office(staff=60),)),
        company("xyz", "C", offices=(office(staff=60),)),
    )
    assert [item.hubspot_id for item in result.items] == ["12", "abc", "xyz"]


def test_a_company_id_that_appears_twice_is_read_once_and_the_first_row_wins() -> None:
    first = company("5", "First", offices=(office(staff=60),))
    second = company("5", "Second", offices=(office(staff=90),), deals=(WatchDeal("Open"),))
    result = build(first, second)
    assert [item.name for item in result.items] == ["First"]
    assert result.counts.companies == 1
    assert result.counts.open_deal == 0


def test_the_company_with_no_name_is_never_listed() -> None:
    nameless = (PLACEHOLDER_NAME, "(No  Name On Record)")
    rows = [
        company(str(i), name, offices=(office(staff=200),), industry="Law Practice")
        for i, name in enumerate(nameless, start=1)
    ]
    result = build(*rows, company("9", "Real"), include_director=True)
    assert [item.name for item in result.items] == ["Real"]
    assert result.director == []
    assert result.counts.no_office == 2  # counted with the companies that have no office
    assert result.counts.companies == 3


def test_a_company_with_no_name_and_an_open_deal_is_an_open_deal() -> None:
    result = build(company("1", PLACEHOLDER_NAME, deals=(WatchDeal("Open"),)))
    assert result.counts.open_deal == 1
    assert result.counts.no_office == 0


def test_the_owner_and_the_domain_come_along() -> None:
    result = build(company("1", "Acme", owner="Levi Young", domain="acme.com.au"))
    (item,) = result.items
    assert item.owner == "Levi Young"
    assert result.domains == {"1": "acme.com.au"}


def test_the_counts_add_up_for_a_mixed_set_of_rows() -> None:
    result = build(
        company("1", "Watch"),
        company("2", "Director", "Law Practice"),
        company("3", "Open", deals=(WatchDeal("Won"),)),
        company("4", "Small", offices=(office(staff=10),)),
        company("5", "Unknown", offices=(office(staff=None),)),
        company("6", "Nowhere", offices=()),
        company("7", "Builder", "Construction"),
    )
    counts = result.counts
    assert counts.companies == 7
    assert (counts.watch, counts.likely, counts.unlikely) == (2, 1, 1)
    assert (counts.director, counts.open_deal, counts.no_office) == (1, 1, 1)
    assert (counts.dropped_small, counts.staff_unknown) == (2, 1)
    assert counts.companies == (
        counts.watch + counts.director + counts.open_deal + counts.dropped_small + counts.no_office
    )


def test_no_rows_give_an_empty_answer() -> None:
    result = build()
    assert result.items == result.director == result.staff_unknown == []
    assert result.counts == WatchCounts(
        companies=0,
        watch=0,
        likely=0,
        unlikely=0,
        director=0,
        open_deal=0,
        dropped_small=0,
        staff_unknown=0,
        no_office=0,
    )


def test_candidates_are_the_watch_list_then_the_director_list_when_asked() -> None:
    rows = (company("1", "Watch"), company("2", "Law", "Law Practice"))
    assert [i.name for i in build(*rows).candidates] == ["Watch"]
    assert [i.name for i in build(*rows, include_director=True).candidates] == ["Watch", "Law"]


# --- With the database (integration) ----------------------------------------------------


@pytest.mark.integration
async def test_the_loader_gives_the_same_answer_as_the_function_on_the_export(
    session: AsyncSession, export: HubSpotExport
) -> None:
    await save_export(session, export)
    loaded = await load_watchlist_rows(session)
    assert len(loaded) == 100

    from_database = build_watchlist(loaded, RULES, include_director=True)
    from_file = build_watchlist(rows_from_export(export), RULES, include_director=True)
    assert from_database == from_file
    assert from_database.counts == GOLDEN_COUNTS

    answer = await load_watchlist(session, RULES, include_director=True)
    assert answer == watchlist_out(from_file)
    assert answer.total == 47


@pytest.mark.integration
async def test_the_loader_on_an_empty_database_gives_an_empty_answer(
    session: AsyncSession,
) -> None:
    answer = await load_watchlist(session, RULES)
    assert (answer.total, answer.items, answer.director, answer.staff_unknown) == (0, [], [], [])
    assert answer.counts.companies == 0


@pytest.fixture
async def db_client(session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    app: FastAPI = create_app()

    async def real_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = real_session
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        yield client


WATCHLIST = "/api/v1/lead-finder/watchlist"


@pytest.mark.integration
async def test_the_route_returns_the_preview_with_the_counts(
    session: AsyncSession, db_client: httpx.AsyncClient, export: HubSpotExport
) -> None:
    await save_export(session, export)
    response = await db_client.get(WATCHLIST)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 47
    assert len(body["items"]) == 47
    assert [item["name"] for item in body["items"][:11]] == FIRST_ELEVEN_LIKELY
    assert body["director"] == []  # only when asked for
    assert [item["name"] for item in body["staff_unknown"]] == ["BG&E Resources"]
    assert body["counts"] == GOLDEN_COUNTS.model_dump()
    patties = next(item for item in body["items"] if item["name"] == "Patties Food Group")
    assert (patties["note"], patties["last_dissolved"]) == ("Dissolved deal", "2026-10-07")
    assert body["items"][0] == {
        "hubspot_id": body["items"][0]["hubspot_id"],
        "name": "Synechron Australia",
        "city": "Adelaide",
        "industry": "Information Technology And Services",
        "office_based": "likely",
        "linkedin_staff": 107,
        "estimated_staff": 214,
        "owner": body["items"][0]["owner"],
        "last_dissolved": None,
        "note": None,
    }


@pytest.mark.integration
async def test_the_route_takes_its_three_parameters(
    session: AsyncSession, db_client: httpx.AsyncClient, export: HubSpotExport
) -> None:
    await save_export(session, export)

    limited = (await db_client.get(WATCHLIST, params={"limit": 5})).json()
    assert (limited["total"], len(limited["items"])) == (47, 5)
    assert [item["name"] for item in limited["items"]] == FIRST_ELEVEN_LIKELY[:5]

    likely_only = (await db_client.get(WATCHLIST, params={"include_unlikely": "false"})).json()
    assert likely_only["total"] == 11
    assert likely_only["counts"] == GOLDEN_COUNTS.model_dump()

    with_director = (await db_client.get(WATCHLIST, params={"include_director": "true"})).json()
    assert [item["name"] for item in with_director["director"][:2]] == ["Altaira", "Bayside Health"]
    assert len(with_director["director"]) == 15
    assert with_director["total"] == 47

    for bad in (0, 201):
        assert (await db_client.get(WATCHLIST, params={"limit": bad})).status_code == 422


@pytest.mark.integration
async def test_the_route_needs_no_claude_and_no_approval(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    response = await db_client.get(WATCHLIST)  # an empty database, no Claude key set up
    assert response.status_code == 200
    assert response.json()["counts"]["companies"] == 0
