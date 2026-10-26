"""The leads endpoints over HTTP: list, facets, export, map, one lead, PATCH and look-alikes.

The first tests only look at how the routes are declared (fast, no database). The rest are marked
`integration`: they put leads straight into the test database and call the real app. No Claude;
the memory model is replaced by `FakeEmbedder` (one test uses the real one).
"""

import csv
import io
import uuid
from collections.abc import AsyncIterator
from datetime import date
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.lead_store import export_filename
from core.api.app import create_app
from core.api.routes import api_routes
from core.db.engine import get_session
from core.memory.embedder import Embedder, get_embedder
from core.memory.models import MemoryItem
from tests.lead_finder.factories import (
    FakeEmbedder,
    add_all,
    deal_profile,
    lead_profile,
    make_lead,
    make_run,
)

db = pytest.mark.integration
BASE = "/api/v1/lead-finder/leads"
ROW_FIELDS = {
    "id",
    "company",
    "city",
    "suburb",
    "result",
    "score",
    "status",
    "hubspot_status",
    "trigger_id",
    "trigger_ids",
    "trigger_label",
    "trigger_date",
    "office_m2",
    "office_m2_estimated",
    "staff_in_city",
    "industry",
    "industry_group",
    "contact_role",
    "reason",
    "run_id",
    "origin",
    "is_test",
    "useful",
    "note",
    "cost_usd",
    "web_searches",
    "created_at",
    "updated_at",
}


# --- How the routes are declared (fast) --------------------------------------------------------


def test_the_fixed_paths_come_before_the_id_path() -> None:
    paths = [route.path for route in api_routes(create_app())]
    id_path = "/api/v1/lead-finder/leads/{lead_id}"
    for fixed in ("/leads/export", "/leads/facets", "/leads/map"):
        full = f"/api/v1/lead-finder{fixed}"
        assert paths.index(full) < paths.index(id_path), fixed


def test_no_leads_route_is_a_stub_any_more() -> None:
    mine = {
        ("GET", "/api/v1/lead-finder/leads"),
        ("GET", "/api/v1/lead-finder/leads/export"),
        ("GET", "/api/v1/lead-finder/leads/facets"),
        ("GET", "/api/v1/lead-finder/leads/map"),
        ("GET", "/api/v1/lead-finder/leads/{lead_id}"),
        ("PATCH", "/api/v1/lead-finder/leads/{lead_id}"),
        ("GET", "/api/v1/lead-finder/leads/{lead_id}/similar"),
    }
    found = set()
    for route in api_routes(create_app()):
        for method in route.methods:
            if (method, route.path) in mine:
                found.add((method, route.path))
                assert not route.is_stub, f"{method} {route.path} is still a stub"
    assert found == mine


# --- Setup -------------------------------------------------------------------------------------


@pytest.fixture
def fake_embedder() -> FakeEmbedder:
    return FakeEmbedder()


@pytest.fixture
def app(session: AsyncSession, fake_embedder: FakeEmbedder) -> FastAPI:
    application = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_session] = test_session
    application.dependency_overrides[get_embedder] = lambda: fake_embedder
    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def memory_count(session: AsyncSession, kind: str = "lead_outcome") -> int:
    count = await session.scalar(
        select(func.count()).select_from(MemoryItem).where(MemoryItem.kind == kind)
    )
    return count or 0


def field_errors(response: httpx.Response) -> dict[str, str]:
    body = response.json()
    assert response.headers["content-type"].startswith("application/problem+json")
    return {error["field"]: error["message"] for error in body["errors"]}


async def three_leads(session: AsyncSession) -> dict[str, Any]:
    first = make_run(mode="discovery")
    leads = {
        "alpha": make_lead(
            "Alpha", score=90, city="Melbourne", industry="Software", run_id=first.id
        ),
        "bravo": make_lead(
            "Bravo",
            result="director_review",
            score=60,
            city="Sydney",
            industry="Legal",
            trigger_ids=["new_ceo"],
            status="watching",
        ),
        "charlie": make_lead("Charlie", result="drop", score=0, city="Perth", industry="Mining"),
    }
    await add_all(session, first, *leads.values())
    return {**leads, "run": first}


# --- List --------------------------------------------------------------------------------------


@db
async def test_the_list_gives_total_and_rows_with_every_field(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    found = await three_leads(session)
    response = await client.get(BASE)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert [row["company"] for row in body["items"]] == ["Alpha", "Bravo", "Charlie"]
    first = body["items"][0]
    assert set(first) == ROW_FIELDS
    assert first["id"] == str(found["alpha"].id)
    assert first["cost_usd"] == "0.400000"  # money is text, never a float
    assert first["reason"] == "Acme signed a new lease."
    assert first["trigger_label"] == "Lease ending in 1 to 3 years"
    assert first["run_id"] == str(found["run"].id)


@db
async def test_repeated_keys_match_several_values(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await three_leads(session)
    response = await client.get(BASE, params=[("result", "pass"), ("result", "drop")])
    assert {row["company"] for row in response.json()["items"]} == {"Alpha", "Charlie"}
    response = await client.get(BASE, params=[("city", "Perth"), ("city", "Sydney")])
    assert {row["company"] for row in response.json()["items"]} == {"Bravo", "Charlie"}
    response = await client.get(BASE, params={"trigger": "new_ceo", "status": "watching"})
    assert [row["company"] for row in response.json()["items"]] == ["Bravo"]


@db
async def test_sort_order_limit_and_offset(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await three_leads(session)
    ascending = await client.get(BASE, params={"sort": "score", "order": "asc"})
    assert [row["company"] for row in ascending.json()["items"]] == ["Charlie", "Bravo", "Alpha"]
    by_result = await client.get(BASE, params={"sort": "result", "order": "asc"})
    assert [row["result"] for row in by_result.json()["items"]] == [
        "pass",
        "director_review",
        "drop",
    ]
    page = await client.get(BASE, params={"limit": 1, "offset": 1})
    assert page.json()["total"] == 3
    assert [row["company"] for row in page.json()["items"]] == ["Bravo"]


@db
@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"limit": 0}, "query.limit"),
        ({"limit": 201}, "query.limit"),
        ({"offset": -1}, "query.offset"),
        ({"offset": 1_000_001}, "query.offset"),
        ({"sort": "password"}, "query.sort"),
        ({"order": "sideways"}, "query.order"),
        ({"result": "great"}, "query.result"),
        ({"hubspot_status": "maybe"}, "query.hubspot_status"),
        ({"status": "done"}, "query.status"),
        ({"min_score": 101}, "query.min_score"),
        ({"min_score": -1}, "query.min_score"),
        ({"office_m2_min": 2_147_483_648}, "query.office_m2_min"),
        ({"office_m2_max": "many"}, "query.office_m2_max"),
        ({"run_id": "not-a-uuid"}, "query.run_id"),
        ({"created_since": "yesterday"}, "query.created_since"),
        ({"trigger_since": "2026-13-45"}, "query.trigger_since"),
        ({"q": "x" * 101}, "query.q"),
        ({"q": "a\x00b"}, "query.q"),
        ({"city": "Per\x00th"}, "query.city"),
        ({"latest": "perhaps"}, "query.latest"),
    ],
)
async def test_a_bad_value_is_a_422_that_names_the_field(
    client: httpx.AsyncClient, params: dict[str, Any], field: str
) -> None:
    response = await client.get(BASE, params=params)
    assert response.status_code == 422
    # A repeated key names the bad value by its place too: query.status.0.
    named = field_errors(response)
    assert any(name == field or name.startswith(f"{field}.") for name in named), named


@db
async def test_the_latest_switch_and_test_leads_work_through_the_query_string(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    old, new = make_lead("Acme", score=10), make_lead("Acme", score=20)
    test = make_lead("Acme", is_test=True, score=99)
    await add_all(session, old, new, test)
    shown = await client.get(BASE)
    assert [row["id"] for row in shown.json()["items"]] == [str(new.id)]
    every = await client.get(BASE, params={"latest": "false"})
    assert {row["id"] for row in every.json()["items"]} == {str(old.id), str(new.id)}
    with_tests = await client.get(BASE, params={"include_tests": "true"})
    assert {row["id"] for row in with_tests.json()["items"]} == {str(new.id), str(test.id)}


# --- Facets ------------------------------------------------------------------------------------


@db
async def test_facets_over_http(client: httpx.AsyncClient, session: AsyncSession) -> None:
    found = await three_leads(session)
    body = (await client.get(f"{BASE}/facets")).json()
    assert set(body) == {
        "result",
        "city",
        "trigger",
        "industry",
        "industry_group",
        "hubspot_status",
        "status",
        "score",
        "office_m2",
        "created",
        "runs",
    }
    assert body["result"] == [
        {"value": "pass", "count": 1},
        {"value": "director_review", "count": 1},
        {"value": "drop", "count": 1},
    ]
    assert body["score"] == {"min": 0, "max": 90}
    assert body["runs"][0]["id"] == str(found["run"].id)
    assert (body["runs"][0]["mode"], body["runs"][0]["count"]) == ("discovery", 1)
    assert body["trigger"][0] == {
        "id": "lease_ending",
        "label": "Lease ending in 1 to 3 years",
        "count": 2,
    }

    narrowed = (
        await client.get(f"{BASE}/facets", params=[("city", "Perth"), ("result", "drop")])
    ).json()
    assert {item["value"] for item in narrowed["city"]} == {"Perth"}  # the city facet obeys result
    assert {item["value"] for item in narrowed["result"]} == {"drop"}  # the result facet obeys city


@db
async def test_facets_refuse_bad_filters_like_the_list(client: httpx.AsyncClient) -> None:
    response = await client.get(f"{BASE}/facets", params={"min_score": 500})
    assert response.status_code == 422


# --- Export ------------------------------------------------------------------------------------

HOSTILE_NAMES = ["=1+1", "+cmd|' /C calc'!A0", "@SUM(1)", "\t=1+1", "-2+3"]


@db
async def test_the_export_is_a_utf8_csv_with_the_right_headers(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await three_leads(session)
    response = await client.get(f"{BASE}/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (f"attachment; filename={export_filename()}")
    assert response.headers["content-disposition"].endswith(".csv")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"), newline="")))
    assert list(rows[0]) == [
        "company",
        "result",
        "score",
        "city",
        "trigger",
        "trigger_date",
        "industry",
        "office_m2",
        "office_m2_estimated",
        "hubspot_status",
        "status",
        "source_link",
        "created_at",
    ]
    assert [row["company"] for row in rows] == ["Alpha", "Bravo", "Charlie"]
    assert rows[0]["trigger"] == "Lease ending in 1 to 3 years"
    assert rows[0]["source_link"] == "https://www.afr.com/property/acme-moves-2026"
    assert rows[0]["office_m2_estimated"] == "false"


@db
async def test_the_filename_date_is_a_date(client: httpx.AsyncClient) -> None:
    response = await client.get(f"{BASE}/export")
    name = response.headers["content-disposition"].split("filename=")[1]
    assert name.startswith("leads-") and name.endswith(".csv")
    date.fromisoformat(name.removeprefix("leads-").removesuffix(".csv"))


@db
async def test_the_export_takes_the_list_filters_and_sort(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await three_leads(session)
    response = await client.get(
        f"{BASE}/export", params={"sort": "score", "order": "asc", "min_score": 1}
    )
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"), newline="")))
    assert [row["company"] for row in rows] == ["Bravo", "Alpha"]
    bad = await client.get(f"{BASE}/export", params={"sort": "nope"})
    assert bad.status_code == 422


@db
async def test_hostile_names_are_all_written_with_a_leading_apostrophe(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    leads = [
        make_lead(name, industry=name, city="Melbourne", trigger_id=None, trigger_ids=[])
        for name in HOSTILE_NAMES
    ]
    await add_all(session, *leads)
    # "=1+1" and a tab then "=1+1" clean to one company key, so ask for every row, not the latest.
    response = await client.get(f"{BASE}/export", params={"latest": "false"})
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"), newline="")))
    assert sorted(row["company"] for row in rows) == sorted("'" + name for name in HOSTILE_NAMES)
    assert sorted(row["industry"] for row in rows) == sorted("'" + name for name in HOSTILE_NAMES)
    for row in rows:
        for column, cell in row.items():
            assert not cell.startswith(("=", "+", "-", "@", "\t", "\r")), (column, cell)


@db
async def test_the_export_stops_at_2000_rows_with_a_413(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_all(
        session, *[make_lead(f"Bulk {number}", card={"id": "x"}) for number in range(2000)]
    )
    exactly = await client.get(f"{BASE}/export")
    assert exactly.status_code == 200
    text = exactly.content.decode("utf-8-sig")
    assert len(list(csv.reader(io.StringIO(text, newline="")))) == 2001  # the header and 2000
    await add_all(session, make_lead("One too many", card={"id": "x"}))
    refused = await client.get(f"{BASE}/export")
    assert refused.status_code == 413
    assert refused.headers["content-type"].startswith("application/problem+json")
    body = refused.json()
    assert (body["code"], body["status"]) == ("too_many_rows", 413)
    assert "2001 leads match" in body["detail"]
    narrowed = await client.get(f"{BASE}/export", params={"q": "One too"})
    assert narrowed.status_code == 200


# --- Map ---------------------------------------------------------------------------------------


@db
async def test_the_map_gives_pins_with_a_total(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    found = await three_leads(session)
    body = (await client.get(f"{BASE}/map")).json()
    assert body["total"] == 3
    assert [pin["name"] for pin in body["items"]] == ["Alpha", "Bravo", "Charlie"]
    pin = body["items"][0]
    assert set(pin) == {"id", "name", "result", "score", "city", "suburb", "lat", "lng"}
    assert pin["id"] == str(found["alpha"].id)
    assert abs(pin["lat"] - -37.8136) <= 0.0101 and abs(pin["lng"] - 144.9631) <= 0.0101
    sydney = next(p for p in body["items"] if p["city"] == "Sydney")
    assert abs(sydney["lat"] - -33.8688) <= 0.0101
    filtered = (await client.get(f"{BASE}/map", params={"city": "Perth"})).json()
    assert (filtered["total"], [p["name"] for p in filtered["items"]]) == (1, ["Charlie"])


@db
async def test_the_map_sends_at_most_2000_pins_and_stable_places(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_all(
        session,
        *[
            make_lead(f"Pin {number}", score=number % 100, card={"id": "x"})
            for number in range(2003)
        ],
    )
    first = (await client.get(f"{BASE}/map")).json()
    second = (await client.get(f"{BASE}/map")).json()
    assert (first["total"], len(first["items"])) == (2003, 2000)
    assert first == second  # the same places every time
    assert first["items"][0]["score"] == 99
    assert len({(pin["lat"], pin["lng"]) for pin in first["items"]}) > 1990  # not stacked


@db
async def test_the_map_refuses_bad_filters(client: httpx.AsyncClient) -> None:
    assert (await client.get(f"{BASE}/map", params={"result": "x"})).status_code == 422


# --- One lead ----------------------------------------------------------------------------------


@db
async def test_one_lead_returns_the_card_and_older_researches(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    old, new = make_lead("Acme", score=10), make_lead("Acme", score=20)
    await add_all(session, old, new)
    response = await client.get(f"{BASE}/{new.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(new.id)
    assert (body["status"], body["reject_reason"], body["note"], body["useful"]) == (
        "new",
        None,
        None,
        None,
    )
    assert (body["origin"], body["is_test"], body["run_id"]) == ("typed", False, None)
    assert [p["id"] for p in body["previous"]] == [str(old.id)]
    assert body["facts"]["office_m2"]["value"] == 2500
    assert body["research"]["cost_usd"] == "0.4"
    assert "updated_at" in body and "notes" in body


@db
async def test_an_unknown_or_malformed_id_is_a_404_or_a_422(client: httpx.AsyncClient) -> None:
    unknown = str(uuid.uuid4())
    for suffix in ("", "/similar"):
        response = await client.get(f"{BASE}/{unknown}{suffix}")
        assert response.status_code == 404, suffix
        assert response.headers["content-type"].startswith("application/problem+json")
        assert response.json()["title"] == "Lead not found"
    assert (await client.get(f"{BASE}/not-a-uuid")).status_code == 422
    assert (await client.get(f"{BASE}/not-a-uuid/similar")).status_code == 422
    missing = await client.patch(f"{BASE}/{unknown}", json={"note": "x"})
    assert missing.status_code == 404


# --- PATCH -------------------------------------------------------------------------------------


@db
async def test_reject_without_a_reason_is_a_422_on_the_reason_field(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    response = await client.patch(f"{BASE}/{lead.id}", json={"status": "rejected"})
    assert response.status_code == 422
    assert "body.reject_reason" in field_errors(response)
    assert response.json()["title"] == "The request isn't valid"
    blank = await client.patch(
        f"{BASE}/{lead.id}", json={"status": "rejected", "reject_reason": "   "}
    )
    assert "body.reject_reason" in field_errors(blank)
    assert (await client.get(f"{BASE}/{lead.id}")).json()["status"] == "new"
    assert await memory_count(session) == 0


@db
async def test_reject_then_undo(client: httpx.AsyncClient, session: AsyncSession) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    rejected = await client.patch(
        f"{BASE}/{lead.id}", json={"status": "rejected", "reject_reason": "Too small"}
    )
    assert rejected.status_code == 200
    assert (rejected.json()["status"], rejected.json()["reject_reason"]) == (
        "rejected",
        "Too small",
    )
    assert await memory_count(session) == 1

    undone = await client.patch(f"{BASE}/{lead.id}", json={"status": "new", "reject_reason": None})
    assert undone.status_code == 200
    assert (undone.json()["status"], undone.json()["reject_reason"]) == ("new", None)
    assert await memory_count(session) == 0
    again = (await client.get(f"{BASE}/{lead.id}")).json()
    assert (again["status"], again["reject_reason"]) == ("new", None)


@db
async def test_watch_then_undo(client: httpx.AsyncClient, session: AsyncSession) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    watching = await client.patch(f"{BASE}/{lead.id}", json={"status": "watching"})
    assert watching.json()["status"] == "watching"
    assert await memory_count(session) == 1
    undone = await client.patch(f"{BASE}/{lead.id}", json={"status": "new"})
    assert undone.json()["status"] == "new"
    assert await memory_count(session) == 0


@db
async def test_leaving_rejected_for_watching_clears_the_reason(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    await client.patch(f"{BASE}/{lead.id}", json={"status": "rejected", "reject_reason": "No"})
    moved = await client.patch(f"{BASE}/{lead.id}", json={"status": "watching"})
    assert (moved.json()["status"], moved.json()["reject_reason"]) == ("watching", None)
    assert await memory_count(session) == 1  # replaced, not added


@db
async def test_useful_and_not_useful_and_undo(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    good = await client.patch(f"{BASE}/{lead.id}", json={"useful": True})
    assert (good.json()["useful"], good.json()["status"]) == (True, "new")
    assert await memory_count(session) == 1
    bad = await client.patch(f"{BASE}/{lead.id}", json={"useful": False})
    assert bad.json()["useful"] is False
    assert await memory_count(session) == 1
    cleared = await client.patch(f"{BASE}/{lead.id}", json={"useful": None})
    assert cleared.json()["useful"] is None
    assert await memory_count(session) == 0


@db
async def test_a_note_is_set_and_cleared_and_leaves_the_rest_alone(
    client: httpx.AsyncClient, session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    lead = make_lead("Acme", status="watching", useful=True)
    await add_all(session, lead)
    saved = await client.patch(f"{BASE}/{lead.id}", json={"note": "Call on Monday"})
    assert (saved.json()["note"], saved.json()["status"], saved.json()["useful"]) == (
        "Call on Monday",
        "watching",
        True,
    )
    cleared = await client.patch(f"{BASE}/{lead.id}", json={"note": None})
    assert cleared.json()["note"] is None
    blank = await client.patch(f"{BASE}/{lead.id}", json={"note": "  "})
    assert blank.json()["note"] is None
    assert fake_embedder.texts == []  # a note never goes to memory
    assert await memory_count(session) == 0


@db
async def test_an_empty_patch_changes_nothing(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme", note="keep", status="watching")
    await add_all(session, lead)
    before = (await client.get(f"{BASE}/{lead.id}")).json()
    after = await client.patch(f"{BASE}/{lead.id}", json={})
    assert after.status_code == 200
    assert after.json() == before


@db
async def test_the_patch_returns_the_updated_lead_with_a_newer_updated_at(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    before = (await client.get(f"{BASE}/{lead.id}")).json()["updated_at"]
    response = await client.patch(f"{BASE}/{lead.id}", json={"note": "x"})
    assert response.json()["updated_at"] > before
    assert response.json() == (await client.get(f"{BASE}/{lead.id}")).json()
    assert response.json()["previous"] == []


@db
@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"status": "sent"}, "body.status"),
        ({"status": "done"}, "body.status"),
        ({"status": None}, "body.status"),
        ({"useful": "maybe"}, "body.useful"),
        ({"reject_reason": "x" * 1001}, "body.reject_reason"),
        ({"note": "x" * 2001}, "body.note"),
        ({"note": "a\x00b"}, "body.note"),
        ({"company": "Hacked"}, "body.company"),
        ({"result": "pass"}, "body.result"),
    ],
)
async def test_a_refused_patch_body_names_the_field_and_changes_nothing(
    client: httpx.AsyncClient, session: AsyncSession, body: dict[str, Any], field: str
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    response = await client.patch(f"{BASE}/{lead.id}", json=body)
    assert response.status_code == 422
    assert field in field_errors(response)
    stored = (await client.get(f"{BASE}/{lead.id}")).json()
    assert (stored["status"], stored["company"], stored["note"]) == ("new", "Acme", None)
    assert await memory_count(session) == 0


@db
async def test_a_reason_without_rejecting_is_refused(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    response = await client.patch(f"{BASE}/{lead.id}", json={"reject_reason": "Too small"})
    assert response.status_code == 422
    assert "body.reject_reason" in field_errors(response)


@db
async def test_a_lead_already_sent_keeps_its_status(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme", status="sent")
    await add_all(session, lead)
    response = await client.patch(f"{BASE}/{lead.id}", json={"status": "new"})
    assert response.status_code == 409
    assert response.json()["code"] == "lead_sent"
    note = await client.patch(f"{BASE}/{lead.id}", json={"note": "called them"})
    assert (note.status_code, note.json()["status"]) == (200, "sent")


@db
async def test_the_outcome_is_saved_with_the_real_memory_model(
    app: FastAPI, client: httpx.AsyncClient, session: AsyncSession, embedder: Embedder
) -> None:
    app.dependency_overrides[get_embedder] = lambda: embedder
    lead = make_lead("Acme")
    await add_all(session, lead)
    response = await client.patch(
        f"{BASE}/{lead.id}", json={"status": "rejected", "reject_reason": "Office too small"}
    )
    assert response.status_code == 200
    [item] = list(
        (await session.scalars(select(MemoryItem).where(MemoryItem.kind == "lead_outcome"))).all()
    )
    assert item.meta == {"lead_id": str(lead.id), "outcome": "rejected"}
    assert len(item.embedding) == 384


# --- Look-alikes -------------------------------------------------------------------------------


@db
async def test_similar_without_a_profile_is_a_200_with_basis_none(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead)
    response = await client.get(f"{BASE}/{lead.id}/similar")
    assert response.status_code == 200
    body = response.json()
    assert (body["basis"], body["deals"], body["leads"]) == ("none", [], [])
    assert "no company profile" in body["note"]


@db
async def test_similar_with_a_profile_lists_deals_and_leads(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    lead, other = make_lead("Acme"), make_lead("Rival Co", score=61, result="watch")
    await add_all(
        session,
        lead,
        other,
        lead_profile(lead, 1.0),
        lead_profile(other, 0.75),
        deal_profile("Won Co", 0.9, hubspot_id="7", cities=["Perth"], industry="Legal"),
    )
    body = (await client.get(f"{BASE}/{lead.id}/similar")).json()
    assert (body["basis"], body["note"]) == ("profile", None)
    assert body["deals"] == [
        {
            "hubspot_id": "7",
            "name": "Won Co",
            "similarity": 0.9,
            "city": "Perth",
            "industry": "Legal",
            "deal_status": "open",
            "deal_names": [],
        }
    ]
    assert body["leads"] == [
        {
            "lead_id": str(other.id),
            "name": "Rival Co",
            "result": "watch",
            "score": 61,
            "similarity": 0.75,
        }
    ]
