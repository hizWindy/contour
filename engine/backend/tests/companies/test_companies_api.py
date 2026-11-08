"""The Companies page's reads (PLAN-V10 B1 to B3, D1): the list with its filters and sorts, the
Lead Finder rows only for its tick, one company, and the prep box's matches. Signed in, as on the
live site."""

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI

from core.api.routes import api_routes
from core.hubspot.models import (
    HubSpotCall,
    HubSpotContact,
)
from core.memory.models import EMBEDDING_DIM, MemoryItem
from tests.companies.helpers import (
    API,
    LEAD_FIELDS,
    a_small_copy,
    add,
    company,
    names,
    person,
    signed_in_as,
    soon,
)
from tests.core.auth_world import World, make_account, sign_in
from tests.lead_finder.factories import make_lead

pytestmark = pytest.mark.integration


# --- B1: the tick ------------------------------------------------------------------------------


def companies_routes(app: FastAPI) -> list[tuple[str, str]]:
    found = [
        (method, route.path)
        for route in api_routes(app)
        if route.path == API or route.path.startswith(f"{API}/")
        for method in sorted(route.methods)
    ]
    assert len(found) >= 4  # every Companies route, so a new one is walked too
    return found


def filled(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "101", path)


async def test_every_companies_route_refuses_a_person_without_the_tick(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "sam", ["lead_finder"]) as client:
        for method, path in companies_routes(world.app):
            answer = await client.request(method, filled(path) + "?q=ab", json={})
            assert answer.status_code == 403, (method, path, answer.status_code, answer.text)
            assert answer.json()["code"] == "app_not_allowed"
            assert "Companies page" in answer.json()["detail"]


@pytest.mark.parametrize(
    ("login", "apps", "role", "open_"),
    [
        ("nobody", [], "staff", False),
        ("mia", ["companies"], "staff", True),
        ("lena", ["companies", "lead_finder"], "staff", True),
        ("boss", [], "admin", True),
    ],
)
async def test_every_companies_route_walked_as_four_accounts(
    world: World, login: str, apps: list[str], role: str, open_: bool
) -> None:
    """E2: no tick, Companies only, Companies and the Lead Finder, and an Admin."""
    await a_small_copy(world)
    await person(world, login, apps=apps, role=role)
    async with world.browser() as client:
        assert (await sign_in(client, login=login)).status_code == 200
        for method, path in companies_routes(world.app):
            answer = await client.request(method, filled(path) + "?q=ab", json={})
            if open_:
                assert answer.status_code != 403, (login, method, path, answer.text)
            else:
                assert answer.status_code == 403, (login, method, path, answer.status_code)
                assert answer.json()["code"] == "app_not_allowed"


async def test_with_the_tick_every_companies_route_is_open(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        for method, path in companies_routes(world.app):
            answer = await client.request(method, filled(path) + "?q=ab", json={})
            assert answer.status_code != 403, (method, path, answer.text)


# --- B2: the list ------------------------------------------------------------------------------


async def test_the_list_is_by_name_with_each_rows_facts(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        page = (await client.get(API)).json()
    assert page["total"] == 4
    assert page["leads_shown"] is False
    assert names(page) == ["ABC Logistics", "Nimbus Software", "Quark Foods", "Zed Mining"]
    abc = page["items"][0]
    assert abc["key"] == "101"
    assert abc["deal"] == "open"
    assert abc["owner"] == "Levi"
    assert abc["next_lease_end"] == soon(365).isoformat()  # the past lease end is skipped
    assert abc["source"] == "hubspot"
    by_name = {row["name"]: row for row in page["items"]}
    assert by_name["Quark Foods"]["deal"] == "customer"  # a won deal
    assert by_name["Nimbus Software"]["deal"] == "customer"  # HubSpot's lifecycle stage
    assert by_name["Zed Mining"]["deal"] == "none"


async def test_without_the_lead_finder_tick_no_lead_finder_field_comes_back(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        for path in (API, f"{API}?source=lead", f"{API}?q=delta"):
            page = (await client.get(path)).json()
            assert "Delta Freight" not in names(page)
            for row in page["items"]:
                assert row["source"] == "hubspot"
                for field in LEAD_FIELDS:
                    assert row[field] is None, (path, row)
        detail = (await client.get(f"{API}/101")).json()
        assert detail["lead"] is None
        assert (await client.get(f"{API}/lead:{uuid.uuid4()}")).status_code == 404


async def test_with_the_lead_finder_tick_good_leads_not_in_hubspot_are_added(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        page = (await client.get(API)).json()
        assert page["leads_shown"] is True
        assert names(page) == [
            "ABC Logistics",
            "Delta Freight",  # a Pass, not in HubSpot yet
            "Nimbus Software",
            "Quark Foods",
            "Zed Mining",
        ]  # Echo Legal is a Drop, so it stays out
        by_name = {row["name"]: row for row in page["items"]}
        delta = by_name["Delta Freight"]
        assert delta["source"] == "lead"
        assert delta["key"].startswith("lead:")
        assert (delta["lead_result"], delta["lead_score"]) == ("pass", 82)
        abc = by_name["ABC Logistics"]
        assert (abc["lead_result"], abc["lead_score"]) == ("director_review", 74)
        only_leads = (await client.get(f"{API}?source=lead")).json()
        assert names(only_leads) == ["Delta Freight"]


async def test_a_newer_drop_hides_an_older_pass(world: World) -> None:
    long_ago = datetime(2026, 1, 1, tzinfo=UTC)
    await add(
        world,
        make_lead("Delta Freight", result="pass", created_at=long_ago),
        make_lead("Delta Freight", result="drop", created_at=long_ago + timedelta(days=30)),
        make_lead("Fox Legal", result="director_review"),
        make_lead("Gale Rejected", result="pass", status="rejected"),
        make_lead("Test Set Co", result="pass", is_test=True),
    )
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        assert names((await client.get(f"{API}?source=lead")).json()) == ["Fox Legal"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("q=logist", ["ABC Logistics"]),  # the name
        ("q=quark.com", ["Quark Foods"]),  # the website
        ("q=mining", ["Zed Mining"]),  # the industry
        ("q=100%25", []),  # % is a plain character
        ("city=Perth", ["ABC Logistics"]),
        ("city=adelaide", ["Zed Mining"]),  # an office's city, any case
        ("owner=Levi", ["ABC Logistics"]),
        ("deal=open", ["ABC Logistics"]),
        ("deal=customer", ["Nimbus Software", "Quark Foods"]),
        ("deal=none", ["Zed Mining"]),
        ("source=hubspot", ["ABC Logistics", "Nimbus Software", "Quark Foods", "Zed Mining"]),
        ("sort=staff", ["Zed Mining", "ABC Logistics", "Quark Foods", "Nimbus Software"]),
        ("sort=staff&order=asc", ["Nimbus Software", "Quark Foods", "ABC Logistics", "Zed Mining"]),
        ("sort=lease", ["Quark Foods", "ABC Logistics", "Zed Mining", "Nimbus Software"]),
        ("sort=last_talk", ["ABC Logistics", "Quark Foods", "Nimbus Software", "Zed Mining"]),
        ("sort=name&order=desc", ["Zed Mining", "Quark Foods", "Nimbus Software", "ABC Logistics"]),
        ("limit=2&offset=1", ["Nimbus Software", "Quark Foods"]),
    ],
)
async def test_each_filter_and_sort(world: World, query: str, expected: list[str]) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        answer = await client.get(f"{API}?{query}")
    assert answer.status_code == 200, answer.text
    assert names(answer.json()) == expected


async def test_lead_rows_follow_the_filters(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        assert "Delta Freight" in names((await client.get(f"{API}?city=perth")).json())
        assert "Delta Freight" in names((await client.get(f"{API}?deal=none")).json())
        assert "Delta Freight" in names((await client.get(f"{API}?q=freight")).json())
        # A lead has no owner and no deal, so these leave it out.
        assert "Delta Freight" not in names((await client.get(f"{API}?owner=Levi")).json())
        assert "Delta Freight" not in names((await client.get(f"{API}?deal=open")).json())
        assert "Delta Freight" not in names((await client.get(f"{API}?city=Sydney")).json())


async def test_the_filters_offer_cities_and_owners(world: World) -> None:
    await a_small_copy(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        facets = (await client.get(f"{API}/facets")).json()
    cities = {item["value"]: item["count"] for item in facets["cities"]}
    assert cities["Perth"] == 1
    assert cities["Adelaide"] == 1  # Zed Mining's office
    assert cities["Darwin"] == 0
    assert [item["value"] for item in facets["owners"]] == ["Levi", "Sara"]


async def test_bad_values_are_refused(world: World) -> None:
    async with signed_in_as(world, "mia", ["companies"]) as client:
        for query in ("deal=maybe", "sort=score", "limit=0", "limit=101", "offset=-1"):
            assert (await client.get(f"{API}?{query}")).status_code == 422, query


# --- B3: one company ---------------------------------------------------------------------------


async def test_one_hubspot_company_has_its_offices_deals_and_notes(world: World) -> None:
    await a_small_copy(world)
    now = datetime.now(UTC)
    await add(
        world,
        MemoryItem(
            app="lead_finder",
            kind="source_note",
            subject="abc logistics",
            content="ABC Logistics signed a new Perth warehouse lease.",
            url="https://example.com/abc",
            embedding=[0.0] * EMBEDDING_DIM,
            created_at=now - timedelta(days=3),
        ),
        MemoryItem(
            app="lead_finder",
            kind="source_note",
            subject="ABC Logistics",
            content="An old note.",
            embedding=[0.0] * EMBEDDING_DIM,
            created_at=now - timedelta(days=45),
        ),
    )
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        detail = (await client.get(f"{API}/101")).json()
    assert detail["name"] == "ABC Logistics"
    assert detail["source"] == "hubspot"
    assert detail["description"] == "Moves freight across WA."
    assert detail["deal"] == "open"
    assert detail["next_lease_end"] == soon(365).isoformat()
    assert [item["label"] for item in detail["offices"]] == ["Old Perth", "Perth"]
    assert [(item["name"], item["state"]) for item in detail["deals"]] == [("Deal d1", "open")]
    assert [note["text"] for note in detail["notes"]] == [
        "ABC Logistics signed a new Perth warehouse lease."
    ]  # the 45-day-old note is left out
    assert detail["people_status"] == "waiting"
    assert detail["people"] == [] and detail["calls"] == []
    assert detail["lead"]["result_label"] == "Director review"
    assert detail["lead"]["link"].startswith("/leads/")


async def test_a_company_with_no_offices_or_deals(world: World) -> None:
    await add(world, company("200", "Lonely Pty Ltd"))
    async with signed_in_as(world, "mia", ["companies"]) as client:
        detail = (await client.get(f"{API}/200")).json()
    assert detail["offices"] == [] and detail["deals"] == []
    assert detail["next_lease_end"] is None
    assert detail["deal"] == "none"


async def test_a_lead_only_company_opens_with_the_lead_finder_tick(world: World) -> None:
    lead = make_lead("Delta Freight", result="pass", score=82, city="Perth", domain="delta.com.au")
    await add(world, lead)
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        detail = (await client.get(f"{API}/lead:{lead.id}")).json()
        assert detail["source"] == "lead"
        assert detail["name"] == "Delta Freight"
        assert detail["city"] == "Perth"
        assert detail["hubspot_url"] is None
        assert detail["lead"]["score"] == 82
        assert (await client.get(f"{API}/lead:not-a-uuid")).status_code == 404
        assert (await client.get(f"{API}/999")).status_code == 404
        assert (await client.get(f"{API}/bad%20key")).status_code == 404


async def test_people_and_calls_show_once_hubspot_gives_them(world: World) -> None:
    await a_small_copy(world)
    called = datetime(2026, 10, 1, 1, 0, tzinfo=UTC)
    await add(
        world,
        HubSpotContact(
            hubspot_id="c1",
            hubspot_company_id="101",
            name="Jason Reeds",
            job_title="Head of Operations",
            phone="+61 8 9000 0000",
            email="jason@abclogistics.com.au",
        ),
        HubSpotCall(
            hubspot_id="k1",
            hubspot_company_id="101",
            hubspot_contact_id="c1",
            called_at=called,
            duration_seconds=420,
            outcome="Connected",
            note="Lease is up next year. Call back in March.",
            owner="Levi",
        ),
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        detail = (await client.get(f"{API}/101")).json()
    assert detail["people_status"] == "ready"
    assert [(p["name"], p["title"]) for p in detail["people"]] == [
        ("Jason Reeds", "Head of Operations")
    ]
    assert "email" not in detail["people"][0]
    call = detail["calls"][0]
    assert (call["person"], call["minutes"], call["outcome"]) == ("Jason Reeds", 7, "Connected")
    assert detail["last_talk_note"] == "Lease is up next year. Call back in March."


# --- D1: the prep box --------------------------------------------------------------------------


async def test_the_prep_box_finds_people_and_companies(world: World) -> None:
    await a_small_copy(world)
    await add(
        world,
        HubSpotContact(hubspot_id="c1", hubspot_company_id="101", name="Abby Stone"),
        HubSpotContact(hubspot_id="c2", hubspot_company_id="102", name="Jason Reeds"),
    )
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        found = (await client.get(f"{API}/search?q=ab")).json()
        assert [c["name"] for c in found["companies"]] == ["ABC Logistics"]
        assert [(p["name"], p["company_name"]) for p in found["people"]] == [
            ("Abby Stone", "ABC Logistics")
        ]
        assert (await client.get(f"{API}/search?q=a")).json() == {"people": [], "companies": []}
        delta = (await client.get(f"{API}/search?q=delta")).json()
        assert [(c["name"], c["source"]) for c in delta["companies"]] == [("Delta Freight", "lead")]
    async with signed_in_as(world, "mia", ["companies"]) as no_tick:
        assert (await no_tick.get(f"{API}/search?q=delta")).json()["companies"] == []


async def test_an_admin_sees_everything(world: World) -> None:
    await a_small_copy(world)
    await make_account(world)
    async with world.browser() as client:
        assert (await sign_in(client)).status_code == 200
        page = (await client.get(API)).json()
    assert page["leads_shown"] is True
    assert "Delta Freight" in names(page)
