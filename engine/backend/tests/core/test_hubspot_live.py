"""Finding a company in HubSpot itself by its name, and reading it into our copy (PLAN-V23 T1-3
and T1-4), on the fake HubSpot:

- the searches a name makes: each core word starts a word of the name, then the words run
  together; generic words alone make none;
- a search that finds something is the last, the company with no name is left out, and nothing
  is written to HubSpot;
- what is read is saved into our copy as the sync saves it: the pick lists' labels, the owner's
  name and the offices.

Made-up companies only (Northwind, Sample Logistics Pty Ltd).
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.client import Filter
from core.hubspot.live import name_searches, save_records, search_by_name
from core.hubspot.models import HubSpotCompany, HubSpotOffice, HubSpotOwner
from tests.core.hubspot_fake import FakeHubSpot, FakeRecord, _passes


def token(value: str) -> Filter:
    return Filter("name", "CONTAINS_TOKEN", value)


def test_the_searches_a_name_makes() -> None:
    assert name_searches("North Wind") == [
        [token("north*"), token("wind*")],
        [token("northwind*")],
    ]
    assert name_searches("Northwind") == [[token("northwind*")]]
    assert name_searches("Sample Logistics Pty. Ltd.") == [
        [token("sample*"), token("logistics*")],
        [token("samplelogistics*")],
    ]
    assert name_searches("The Group Australia") == []  # generic words only
    assert name_searches("A & B") == []  # no word of 2 letters or more
    words = " ".join(f"word{n}" for n in range(9))
    assert len(name_searches(words)[0]) == 6  # at most 6 words


def test_the_fake_matches_a_word_of_the_name_with_a_star_for_any_letters() -> None:
    record = FakeRecord("1", {"name": "Sample-Logistics (WA) Pty Ltd"})
    assert _passes(record, token("sample*"))
    assert _passes(record, token("logistics*"))
    assert _passes(record, token("wa"))
    assert not _passes(record, token("logistic"))  # a whole word, unless a star says otherwise
    assert not _passes(record, token("ample*"))
    assert _passes(record, token("*istics"))


async def test_a_search_that_finds_something_is_the_last() -> None:
    fake = FakeHubSpot()
    fake.add_company("900", name="Northwind Freight Australia")
    fake.add_company("901", name="North Wind Pty Ltd")
    fake.add_company("902", name="Sample Logistics Pty Ltd")
    fake.add_company("903", name="(No value)")

    found = await search_by_name(fake, "North Wind")
    assert [record.id for record in found or []] == ["901"]
    assert fake.calls == ["search_companies"]  # the first search found it

    fake.calls.clear()
    joined = await search_by_name(fake, "Northwind")
    assert [record.id for record in joined or []] == ["900"]

    fake.calls.clear()
    assert await search_by_name(fake, "Zebra Holdings") == []
    assert fake.calls == ["search_companies"]  # one word: one search

    fake.calls.clear()
    assert await search_by_name(fake, "Zebra Stripes") == []
    assert fake.calls == ["search_companies", "search_companies"]  # then the words run together
    assert await search_by_name(fake, "The Group") is None
    fake.add_company("904", name="Zebra Stripes Pty Ltd")
    record = (await search_by_name(fake, "zebra stripes") or [])[0]
    assert record.properties["city"] is None and "name" in record.properties  # every field
    assert not [call for call in fake.calls if call.startswith(("create", "update"))]


@pytest.mark.integration
async def test_what_is_read_is_saved_into_our_copy_as_the_sync_saves_it(
    session: AsyncSession,
) -> None:
    session.add(HubSpotOwner(owner_id="o1", name="Mia Sample"))
    await session.commit()
    fake = FakeHubSpot()
    fake.add_company(
        "905",
        name="Northwind Freight Australia",
        city="Perth",
        industry="LOGISTICS_AND_SUPPLY_CHAIN",
        hubspot_owner_id="o1",
        city_other_office_1_="Perth",  # HubSpot's group for the Perth office
        lease_expiry_other_office_1_="2027-06-30",
    )
    records = await search_by_name(fake, "Northwind Freight") or []
    saved = await save_records(session, records, await fake.properties("companies"))
    assert saved == ["905"]
    company = await session.scalar(select(HubSpotCompany).where(HubSpotCompany.hubspot_id == "905"))
    assert company is not None
    assert (company.name, company.city, company.industry, company.owner, company.source) == (
        "Northwind Freight Australia",
        "Perth",
        "Logistics and Supply Chain",  # the label, as the sync saves it
        "Mia Sample",
        "api",
    )
    offices = list(await session.scalars(select(HubSpotOffice.label)))
    assert offices == ["Perth"]
    assert await save_records(session, [], []) == []
