"""HubSpot company profiles: what goes in the text (fast), and rebuilding them in memory
(integration, with the real memory model)."""

import asyncio
from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.api.routes import api_routes
from core.config import ENGINE_DIR
from core.db.engine import get_session
from core.hubspot.importer import read_export
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.hubspot.profiles import (
    DEFAULT_STAFF_MULTIPLIER,
    METRO_CITIES,
    PROFILE_APP,
    PROFILE_KIND,
    build_profile_text,
    build_profile_text_from_facts,
    clean_text,
    deal_status,
    estimated_staff_by_city,
    industry_of_profile,
    is_placeholder,
    office_cities,
    rebuild_profiles,
)
from core.hubspot.service import save_export
from core.memory.embedder import Embedder
from core.memory.models import MemoryItem
from tests.lead_finder.samples import fact, make_facts

EXPORT = ENGINE_DIR.parent / "projects" / "leads" / "research" / "COMPANIES.xlsx"


def hubspot_company(**more: object) -> HubSpotCompany:
    values: dict[str, object] = {"hubspot_id": "1", "name": "Acme Software", "source": "export"}
    return HubSpotCompany(**(values | more))


def office(
    label: str, staff: int | None = None, company_id: str = "1", **more: object
) -> HubSpotOffice:
    return HubSpotOffice(hubspot_company_id=company_id, label=label, linkedin_staff=staff, **more)


def deal(name: str, stage: str | None = "Verified", company_id: str = "1") -> HubSpotDeal:
    return HubSpotDeal(
        hubspot_deal_id=f"d-{name}", hubspot_company_id=company_id, name=name, stage=stage
    )


# --- The text (fast, pure) ---------------------------------------------------------------------


def test_a_profile_text_has_the_name_industry_offices_and_deals() -> None:
    text = build_profile_text(
        hubspot_company(industry="Computer Software"),
        [office("Melbourne", 100), office("Perth", 30), office("Other Office 2", 500)],
        [deal("Acme MEL 1,000m2 Office PD Relocation", "Verified Information Deal")],
    )
    assert text.splitlines() == [
        "Acme Software",
        "Industry: Computer Software",
        "Offices: Melbourne (about 200 staff), Perth (about 60 staff)",
        "Deals: Acme MEL 1,000m2 Office PD Relocation (Verified Information Deal)",
    ]


def test_a_profile_never_holds_contacts_phones_streets_or_descriptions() -> None:
    company = hubspot_company(
        name="Acme Software",
        phone="+61 8 6000 0000",
        street="1 Example Street",
        city="Docklands",
        postal_code="3008",
        description="Jo Citizen runs it. Call 0400 123 456 or jo@acme.com.",
        website="https://acme.com.au",
        domain="acme.com.au",
        linkedin_url="https://linkedin.com/company/acme",
        hubspot_url="https://app.hubspot.com/contacts/1/company/1",
    )
    text = build_profile_text(
        company,
        [
            office(
                "Melbourne", 50, street="9 Office Road", phone="+61 3 9000 0000", postal_code="3000"
            )
        ],
        [deal("Acme MEL 500m2", "Verified")],
    )
    for private in (
        "6000", "Example Street", "Docklands", "3008", "Jo Citizen", "0400", "jo@acme.com",
        "acme.com", "linkedin", "hubspot.com", "Office Road", "9000", "3000",
    ):  # fmt: skip
        assert private not in text, private


@pytest.mark.parametrize(
    ("dirty", "clean"),
    [
        ("Acme MEL 500m2 call jo@acme.com now", "Acme MEL 500m2 call now"),
        ("Acme call 0400 123 456 today", "Acme call today"),
        ("Acme (08) 9000 0000 office", "Acme office"),
        ("Acme +61 8 6000 0000", "Acme"),
        ("Acme +61-8-6000-0000 and 03.9000.0000", "Acme and"),
        ("See https://acme.com.au/news and www.acme.com.au", "See and"),
        ("Acme 3,000m2 Office 2027", "Acme 3,000m2 Office 2027"),  # a size and a year stay
        ("209 Greenhill Road - Spec Suite", "209 Greenhill Road - Spec Suite"),
        ("  many \n\t spaces  ", "many spaces"),
        (None, ""),
    ],
)
def test_text_that_looks_like_an_email_a_phone_or_a_web_address_is_removed(
    dirty: str | None, clean: str
) -> None:
    assert clean_text(dirty) == clean


def test_deal_names_are_cleaned_in_the_profile() -> None:
    text = build_profile_text(
        hubspot_company(),
        [],
        [deal("Acme MEL 500m2 ask jo@acme.com or 0400 123 456", "Verified")],
    )
    assert text.splitlines()[-1] == "Deals: Acme MEL 500m2 ask or (Verified)"


def test_a_profile_is_short() -> None:
    deals = [deal(f"Acme deal number {i} " + "x" * 200, "Verified") for i in range(20)]
    text = build_profile_text(hubspot_company(), [], deals)
    assert len(text) <= 1500
    assert text.count("deal number") == 5  # at most five deals


def test_an_unknown_industry_and_no_offices_leave_those_lines_out() -> None:
    assert build_profile_text(hubspot_company(industry=None), [], []) == "Acme Software"
    only_other = build_profile_text(hubspot_company(), [office("Other Office 2", 90)], [])
    assert only_other == "Acme Software"


def test_staff_per_city_is_the_largest_count_times_the_multiplier() -> None:
    offices = [
        office("Melbourne", 40),
        office("melbourne ", 55),  # the same city, written differently
        office("Perth", None),
        office("Sydney", 0),  # a count of 0 is no count
        office("Brisbane", 10),
        office("Other Office 2", 999),
        office("Adelaide", 7),
    ]
    assert estimated_staff_by_city(offices) == {
        "Melbourne": 110,
        "Perth": None,
        "Sydney": None,
        "Brisbane": 20,
        "Adelaide": 14,
    }
    assert estimated_staff_by_city(offices, 3)["Melbourne"] == 165
    assert office_cities(offices) == ["Melbourne", "Adelaide", "Perth", "Sydney", "Brisbane"]
    assert office_cities([office("Other Office 2")]) == []
    assert METRO_CITIES == ("Melbourne", "Adelaide", "Perth", "Sydney", "Brisbane")


def test_the_multiplier_is_passed_in() -> None:
    company, offices = hubspot_company(), [office("Melbourne", 50)]
    assert "about 100 staff" in build_profile_text(company, offices, [])
    assert "about 150 staff" in build_profile_text(company, offices, [], staff_multiplier=3)


def test_the_default_multiplier_is_the_one_in_the_rules() -> None:
    from apps.lead_finder.rules import load_rules

    assert load_rules().criteria.size.linkedin_staff_multiplier == DEFAULT_STAFF_MULTIPLIER


def test_the_text_from_facts_has_the_same_shape_as_the_hubspot_text() -> None:
    company = hubspot_company(industry="Computer Software")
    from_hubspot = build_profile_text(company, [office("Melbourne", 125)], [])
    facts = make_facts(
        name="Acme Software",
        industry=fact("Computer Software"),
        city=fact("Cremorne, VIC"),
        staff_in_city=fact(250),
        staff_from_linkedin=False,
    )
    assert build_profile_text_from_facts(facts, city="Melbourne") == from_hubspot
    # A LinkedIn count is doubled, like the HubSpot one.
    linkedin = make_facts(
        name="Acme Software",
        industry=fact("Computer Software"),
        staff_in_city=fact(125),
        staff_from_linkedin=True,
    )
    assert build_profile_text_from_facts(linkedin, city="Melbourne") == from_hubspot


def test_the_text_from_facts_uses_the_place_text_without_a_metro_city() -> None:
    facts = make_facts(city=fact("Cremorne, VIC"), office_m2=fact(2500))
    text = build_profile_text_from_facts(facts)
    assert text.splitlines() == [
        "Acme Software",
        "Industry: Software",
        "Offices: Cremorne, VIC (about 250 staff)",
    ]
    # No summary, no office size, no website, no contact role: the HubSpot text has none.
    assert "2,500" not in text and "lease" not in text.lower() and "acme.com.au" not in text


def test_the_text_from_facts_copes_with_unknown_facts() -> None:
    facts = make_facts(industry=fact(None), city=fact(None), staff_in_city=fact(None))
    assert build_profile_text_from_facts(facts) == "Acme Software"
    # Staff without a city is not listed: there is nowhere to put it.
    assert build_profile_text_from_facts(make_facts(city=fact(None))) == (
        "Acme Software\nIndustry: Software"
    )


def test_the_text_from_facts_is_cleaned_like_the_hubspot_text() -> None:
    facts = make_facts(name="Acme jo@acme.com 0400 123 456", industry=fact("Software www.acme.com"))
    assert build_profile_text_from_facts(facts, city="Perth").splitlines()[:2] == [
        "Acme",
        "Industry: Software",
    ]


def test_the_industry_is_read_back_from_a_profile_text() -> None:
    text = build_profile_text(hubspot_company(industry="Food Beverages"), [office("Perth", 5)], [])
    assert industry_of_profile(text) == "Food Beverages"
    assert industry_of_profile("Acme\nOffices: Perth") is None
    assert industry_of_profile(None) is None
    assert industry_of_profile("") is None


def test_the_deal_status_uses_the_words_of_a_lead_status() -> None:
    assert deal_status([]) is None
    assert deal_status([deal("a", "Dissolved")]) == "dissolved_deal"
    assert deal_status([deal("a", "dissolved"), deal("b", "Verified")]) == "open_deal"
    assert deal_status([deal("a", None)]) == "open_deal"


def test_the_company_with_no_name_is_a_placeholder() -> None:
    assert is_placeholder("(no name on record)")
    assert is_placeholder(" (No Name On Record) ")
    assert not is_placeholder("Acme")
    assert not is_placeholder(None)


# --- Rebuilding (integration) --------------------------------------------------------------------


async def profiles(session: AsyncSession) -> list[MemoryItem]:
    statement = select(MemoryItem).where(
        MemoryItem.app == PROFILE_APP, MemoryItem.kind == PROFILE_KIND
    )
    return list((await session.scalars(statement)).all())


async def load_real_export(session: AsyncSession) -> int:
    result = await save_export(session, read_export(EXPORT))
    return result.companies


@pytest.mark.integration
async def test_rebuild_makes_one_profile_for_each_company_but_the_one_with_no_name(
    session: AsyncSession, embedder: Embedder
) -> None:
    companies = await load_real_export(session)
    assert companies == 100

    count = await rebuild_profiles(session, embedder)

    assert count == 99
    items = await profiles(session)
    assert len(items) == 99
    assert "(no name on record)" not in {item.subject for item in items}
    by_name = {item.subject: item for item in items}
    kyndryl = by_name["Kyndryl"]
    assert kyndryl.meta == {
        "hubspot_id": "59848091827",
        "cities": ["Melbourne", "Sydney"],
        "industry": "Information Technology And Services",
        "has_deal": True,
        "deal_status": "open_deal",
    }
    assert "Sydney (about 322 staff)" in kyndryl.content
    assert "Kyndryl MEL 787m2 Office Lease Expiry (Unqualified Information Deal)" in kyndryl.content
    assert by_name["Dollarama"].meta["deal_status"] == "dissolved_deal"
    assert by_name["Mandoon Estate"].meta["has_deal"] is False
    assert by_name["Mandoon Estate"].meta["deal_status"] is None
    # An unknown industry and no offices are None and [].
    hender = by_name["Hender Group"]
    assert (hender.meta["industry"], hender.meta["cities"]) == (None, [])
    deals = [item for item in items if item.meta["has_deal"]]
    assert len(deals) == 12
    assert sum(item.meta["deal_status"] == "open_deal" for item in deals) == 7
    assert sum(item.meta["deal_status"] == "dissolved_deal" for item in deals) == 5


@pytest.mark.integration
async def test_no_contact_phone_street_or_description_reaches_memory(
    session: AsyncSession, embedder: Embedder
) -> None:
    export = read_export(EXPORT)
    await save_export(session, export)
    await rebuild_profiles(session, embedder)
    everything = "\n".join(item.content for item in await profiles(session))

    for company in export.companies:
        for private in (company.phone, company.street, company.description, company.website):
            if private and len(private) > 8:
                assert private not in everything, private
    for office_row in export.offices:
        for private in (office_row.phone, office_row.street):
            if private and len(private) > 8:
                assert private not in everything, private
    assert "@" not in everything
    assert "http" not in everything


@pytest.mark.integration
async def test_rebuilding_again_replaces_the_profiles_and_never_duplicates(
    session: AsyncSession, embedder: Embedder
) -> None:
    await load_real_export(session)
    await rebuild_profiles(session, embedder)
    first_ids = {item.id for item in await profiles(session)}

    assert await rebuild_profiles(session, embedder) == 99
    second = await profiles(session)

    assert len(second) == 99
    assert len({item.meta["hubspot_id"] for item in second}) == 99
    assert first_ids.isdisjoint({item.id for item in second})  # replaced, not kept


@pytest.mark.integration
async def test_rebuild_only_replaces_hubspot_company_profiles(
    session: AsyncSession, embedder: Embedder
) -> None:
    await load_real_export(session)
    [vector] = await embedder.embed_passages(["something else"])
    others = [
        MemoryItem(app="lead_finder", kind="company_profile", content="a lead", embedding=vector),
        MemoryItem(app="hubspot", kind="note", content="a note", embedding=vector),
        MemoryItem(app="lead_finder", kind="source_note", content="a source", embedding=vector),
    ]
    session.add_all(others)
    await session.commit()

    await rebuild_profiles(session, embedder)

    total = await session.scalar(select(func.count()).select_from(MemoryItem))
    assert total == 99 + 3
    remaining = {(i.app, i.kind) for i in (await session.scalars(select(MemoryItem))).all()}
    assert {
        ("lead_finder", "company_profile"),
        ("hubspot", "note"),
        ("lead_finder", "source_note"),
    } <= remaining


@pytest.mark.integration
async def test_a_company_that_left_the_data_loses_its_profile(
    session: AsyncSession, embedder: Embedder
) -> None:
    await load_real_export(session)
    await rebuild_profiles(session, embedder)
    gone = await session.get(HubSpotCompany, "57248721024")  # Lactalis-Mainland Dairy
    assert gone is not None
    await session.delete(gone)
    await session.commit()

    assert await rebuild_profiles(session, embedder) == 98
    assert "Lactalis-Mainland Dairy" not in {item.subject for item in await profiles(session)}


@pytest.mark.integration
async def test_two_rebuilds_at_once_leave_one_profile_each(
    session_factory: async_sessionmaker[AsyncSession], embedder: Embedder
) -> None:
    async with session_factory() as setup:
        await load_real_export(setup)

    async def rebuild() -> int:
        async with session_factory() as own:
            return await rebuild_profiles(own, embedder)

    counts = await asyncio.gather(rebuild(), rebuild())

    assert list(counts) == [99, 99]
    async with session_factory() as check:
        assert len(await profiles(check)) == 99


@pytest.mark.integration
async def test_rebuild_with_no_companies_clears_the_old_profiles(
    session: AsyncSession, embedder: Embedder
) -> None:
    await load_real_export(session)
    await rebuild_profiles(session, embedder)
    for company in (await session.scalars(select(HubSpotCompany))).all():
        await session.delete(company)
    await session.commit()

    assert await rebuild_profiles(session, embedder) == 0
    assert await profiles(session) == []


@pytest.mark.integration
async def test_the_command_line_call_matches(session: AsyncSession, embedder: Embedder) -> None:
    """`engine rebuild-profiles` calls `rebuild_profiles(session, embedder)` and uses the count,
    without a commit of its own."""
    await load_real_export(session)
    count = await rebuild_profiles(session, embedder)  # two positional arguments, as cli.py does
    assert isinstance(count, int)
    session.expire_all()
    assert len(await profiles(session)) == count  # already committed


# --- The endpoints (integration) -----------------------------------------------------------------


@pytest.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[httpx.AsyncClient]:
    app: FastAPI = create_app()

    async def own_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as db_session:
            yield db_session

    app.dependency_overrides[get_session] = own_session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


def test_the_rebuild_route_is_built() -> None:
    [route] = [r for r in api_routes(create_app()) if r.path.endswith("/hubspot/profiles/rebuild")]
    assert route.methods == {"POST"}
    assert not route.is_stub
    assert route.name == "rebuild_profiles"  # the operation id is part of the contract


@pytest.mark.integration
async def test_the_rebuild_endpoint_reports_how_many(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await load_real_export(session)

    response = await client.post("/api/v1/hubspot/profiles/rebuild")

    assert response.status_code == 200, response.text
    assert response.json() == {"profiles_rebuilt": 99}
    assert len(await profiles(session)) == 99


@pytest.mark.integration
async def test_the_rebuild_endpoint_with_nothing_loaded_is_zero(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/hubspot/profiles/rebuild")
    assert response.status_code == 200
    assert response.json() == {"profiles_rebuilt": 0}


@pytest.mark.integration
async def test_an_import_builds_the_profiles_and_says_how_many(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    files = {"file": ("export.xlsx", EXPORT.read_bytes(), "application/octet-stream")}

    response = await client.post("/api/v1/hubspot/import", files=files)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["companies"], body["offices"], body["deals"]) == (100, 185, 12)
    assert body["profiles_rebuilt"] == 99
    assert len(await profiles(session)) == 99
    # Importing the same file again is safe: still one profile each.
    again = await client.post("/api/v1/hubspot/import", files=files)
    assert again.json()["profiles_rebuilt"] == 99
    session.expire_all()
    assert len(await profiles(session)) == 99
