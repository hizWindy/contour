"""How a HubSpot record becomes a row of our copy (PLAN-V5 B4). Pure code: no database."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from core.hubspot.client import Association, HubSpotObject
from core.hubspot.mapping import (
    Converter,
    FieldMap,
    Lookups,
    Problems,
    company_rows,
    deal_row,
    load_field_map,
)
from core.hubspot.profiles import PLACEHOLDER_NAME
from tests.core.hubspot_fake import INDUSTRY, LIFECYCLE, SALES, WHALES

FIELDS = load_field_map()


def convert(owners: dict[str, str | None] | None = None) -> Converter:
    lookups = Lookups.build(
        owners=(owners or {"11": "Pat Lee"}).items(),
        pipelines=[SALES, WHALES],
        company_fields=[INDUSTRY, LIFECYCLE],
        time_zone="Australia/Melbourne",
    )
    return Converter(lookups, Problems())


def record(record_id: str = "100", **properties: str | None) -> HubSpotObject:
    return HubSpotObject(id=record_id, properties=properties, url=f"https://hs/{record_id}")


def test_the_field_map_loads_and_every_name_is_hubspots_shape() -> None:
    assert "total_staff_on_linkedin_in_aus_recorded" in FIELDS.company_properties()
    assert [office.label for office in FIELDS.offices] == [
        "Melbourne",
        "Adelaide",
        "Brisbane",
        "Sydney",
        "Perth",
        "Other Office 2",
    ]
    assert FIELDS.offices[4].fields["linkedin_staff"] == "staff_on_linkedin__perth_"
    assert "linkedin_staff" not in FIELDS.offices[5].fields  # Other Office 2 has none


@pytest.mark.parametrize(
    "bad",
    [
        {"companies": {"nope": "x"}},  # not one of our columns
        {"companies": {"name": "Name With Spaces"}},  # not a HubSpot field name
        {"deals": {"name": "dealname"}},  # no stage or pipeline
    ],
)
def test_a_wrong_field_map_is_refused(bad: dict[str, object]) -> None:
    data = FIELDS.model_dump() | bad
    with pytest.raises(ValidationError):
        FieldMap.model_validate(data)


def test_a_company_reads_like_an_export_row() -> None:
    rows = company_rows(
        record(
            name="  Acme   Logistics ",
            website="https://www.acme.com.au/about",
            domain=None,
            state="Western Australia",
            industry="LOGISTICS_AND_SUPPLY_CHAIN",
            lifecyclestage="customer",
            hubspot_owner_id="11",
            numberofemployees="1,250",
            total_staff_on_linkedin_in_aus_recorded="310.0",
            createdate="2025-03-31T14:30:00Z",  # 1 April in Melbourne
            hs_lastmodifieddate="2026-11-01T01:02:03.456Z",
            city_other_office_1_="Perth",
            staff_on_linkedin__perth_="120",
            lease_expiry_other_office_1_="2027-06-30",
            office_space_size__other_office_1_="1850.25",
            quality_of_office_other_office_1_="Needs an Upgrade",
        ),
        FIELDS,
        convert(),
    )
    company = rows.company
    assert company.name == "Acme Logistics"
    assert (company.domain, company.state, company.state_raw) == (
        "acme.com.au",
        "WA",
        "Western Australia",
    )
    assert company.industry == "Logistics and Supply Chain"  # the label, as the export has it
    assert company.lifecycle_stage == "Customer"
    assert (company.owner, company.owner_id) == ("Pat Lee", "11")
    assert (company.employees, company.linkedin_staff_au) == (1250, 310)
    assert company.created_in_hubspot == date(2025, 4, 1)
    assert company.hubspot_updated_at == datetime(2026, 11, 1, 1, 2, 3, 456000, tzinfo=UTC)
    assert company.hubspot_url == "https://hs/100"
    (office,) = rows.offices
    assert (office.label, office.city, office.linkedin_staff) == ("Perth", "Perth", 120)
    assert office.lease_expiry == date(2027, 6, 30)
    assert office.office_m2 == Decimal("1850.2")  # rounded to one place, half to even
    assert office.quality == "Needs an Upgrade"
    assert company.offices_on_record == "Perth"


def test_an_office_group_with_nothing_in_it_is_no_office() -> None:
    rows = company_rows(record(name="Acme", city_melbourne_="  "), FIELDS, convert())
    assert rows.offices == () and rows.company.offices_on_record is None


def test_a_linkedin_count_of_zero_alone_is_no_office_but_a_count_above_is() -> None:
    zero = company_rows(record(name="Acme", staff_on_linkedin_adelaide_="0"), FIELDS, convert())
    assert zero.offices == ()
    some = company_rows(record(name="Acme", staff_on_linkedin_adelaide_="12"), FIELDS, convert())
    assert [(o.label, o.linkedin_staff) for o in some.offices] == [("Adelaide", 12)]
    real = company_rows(
        record(name="Acme", staff_on_linkedin_adelaide_="0", city_adelaide_="Adelaide"),
        FIELDS,
        convert(),
    )
    assert [(o.label, o.linkedin_staff) for o in real.offices] == [("Adelaide", 0)]  # kept


def test_odd_values_are_left_empty_and_counted_never_fatal() -> None:
    c = convert()
    rows = company_rows(
        record(
            name=None,
            numberofemployees="lots",
            createdate="yesterday",
            hubspot_owner_id="99",
            zip="3" * 40,
        ),
        FIELDS,
        c,
    )
    assert rows.company.name == PLACEHOLDER_NAME
    assert rows.company.employees is None and rows.company.created_in_hubspot is None
    assert rows.company.owner is None and rows.company.owner_id == "99"
    assert rows.company.postal_code == "3" * 16  # cut to the column's 16 characters
    assert (
        c.problems.bad_value == 2 and c.problems.unknown_owner == 1 and c.problems.cut_to_fit == 1
    )
    assert all("99" not in line for line in c.problems.lines())  # counts only, never values


def test_a_deal_stage_label_comes_from_its_pipeline_never_from_the_id() -> None:
    deal = deal_row(
        HubSpotObject(
            id="500",
            properties={
                "dealname": "Acme - Perth - New Office",
                "dealstage": "contractsent",
                "pipeline": "default",
                "amount": "1500000",
                "closedate": "2026-02-27T13:00:00Z",
                "hubspot_owner_id": "11",
            },
            associations={"companies": (Association("100", True),)},
        ),
        FIELDS,
        convert(),
    )
    assert deal is not None
    assert (deal.stage, deal.stage_id, deal.pipeline) == (
        "Dissolved",
        "contractsent",
        "Sales Pipeline",
    )
    assert deal.hubspot_company_id == "100"
    assert deal.amount_aud == Decimal("1500000.00")
    assert deal.close_date == date(2026, 2, 28)  # the day it was in Melbourne
    assert deal.owner == "Pat Lee"


def test_a_stage_no_pipeline_lists_is_no_stage_and_counted() -> None:
    c = convert()
    deal = deal_row(
        HubSpotObject(
            id="501",
            properties={"dealname": "X", "dealstage": "gone", "pipeline": "default"},
            associations={"companies": (Association("100", True),)},
        ),
        FIELDS,
        c,
    )
    assert deal is not None and deal.stage is None and deal.stage_id == "gone"
    assert c.problems.unknown_stage == 1


def test_a_deal_with_no_company_is_left_out_and_counted() -> None:
    c = convert()
    assert deal_row(record("502", dealname="X"), FIELDS, c) is None
    assert c.problems.no_company == 1
    found = deal_row(record("503", dealname="Y"), FIELDS, c, company_id="100")
    assert found is not None and found.hubspot_company_id == "100"


def test_a_checkbox_list_keeps_every_label() -> None:
    from core.hubspot.client import Choice, PropertyInfo

    lookups = Lookups.build(
        owners=[],
        pipelines=[],
        company_fields=[
            PropertyInfo(
                "x",
                "X",
                "enumeration",
                "checkbox",
                None,
                False,
                (Choice("A", "a"), Choice("B", "b")),
            )
        ],
        time_zone=None,
    )
    assert Converter(lookups, Problems()).label("x", "a;b;c") == "A, B, c"
