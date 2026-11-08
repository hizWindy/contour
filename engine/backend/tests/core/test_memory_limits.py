"""POST /memory takes only a person's note, for a project that is loaded, never for HubSpot.
Plus the memory helpers the matching and the profiles use (search by vector, replace, delete).
"""

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.api.deps import settings_dependency
from core.config import get_settings
from core.db.engine import get_session
from core.memory.embedder import Embedder, get_embedder
from core.memory.models import MemoryItem
from core.memory.service import (
    Note,
    delete_items,
    remember,
    replace_items,
    search,
    search_similar,
)

NOTE = {"app": "lead_finder", "kind": "note", "content": "Ask about the Docklands move."}


class NoDatabase:
    """A session that fails the test if a route uses it."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"this route used the database ({name})")


class NoEmbedder:
    """An embedder that fails the test if a route uses it: a refused note is never embedded."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"this route used the embedder ({name})")


@pytest.fixture
def app() -> FastAPI:
    created = create_app()

    async def no_database() -> AsyncIterator[NoDatabase]:
        yield NoDatabase()

    created.dependency_overrides[get_session] = no_database
    created.dependency_overrides[settings_dependency] = get_settings  # no saved overrides here
    created.dependency_overrides[get_embedder] = NoEmbedder
    return created


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


def problem_fields(response: httpx.Response) -> dict[str, str]:
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["title"] == "The request isn't valid"
    return {error["field"]: error["message"] for error in body["errors"]}


# --- The limits (fast: a refused note touches neither the database nor the memory model) ------


@pytest.mark.parametrize("kind", ["source_note", "company_profile", "lead_outcome"])
async def test_only_a_note_can_be_saved(client: httpx.AsyncClient, kind: str) -> None:
    response = await client.post("/api/v1/memory", json=NOTE | {"kind": kind})

    assert problem_fields(response) == {
        "body.kind": "Only notes can be saved here. The engine writes the other kinds."
    }


@pytest.mark.parametrize("app_name", ["hubspot", "HubSpot", "HUBSPOT"])
async def test_nothing_can_be_saved_for_hubspot(client: httpx.AsyncClient, app_name: str) -> None:
    response = await client.post("/api/v1/memory", json=NOTE | {"app": app_name})

    assert problem_fields(response) == {
        "body.app": "Notes can't be saved to the HubSpot data. It comes from the import."
    }


@pytest.mark.parametrize(
    "app_name", ["other_project", "lead-finder", " lead_finder", "Lead_Finder"]
)
async def test_only_a_loaded_project_can_have_notes(
    client: httpx.AsyncClient, app_name: str
) -> None:
    response = await client.post("/api/v1/memory", json=NOTE | {"app": app_name})

    assert problem_fields(response) == {
        "body.app": "That isn't a project this engine runs. Use one of: lead_finder, companies."
    }


async def test_a_project_that_is_loaded_in_the_settings_is_allowed(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    app.dependency_overrides[settings_dependency] = lambda: get_settings().model_copy(
        update={"apps": ["lead_finder", "other_project"]}
    )
    # It gets past the limits and so reaches the memory model, which this test does not have.
    with pytest.raises(AssertionError, match="used the embedder"):
        await client.post("/api/v1/memory", json=NOTE | {"app": "other_project"})
    hubspot = await client.post("/api/v1/memory", json=NOTE | {"app": "hubspot"})
    assert "body.app" in problem_fields(hubspot)  # still never HubSpot


async def test_every_wrong_field_is_listed(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/v1/memory", json=NOTE | {"app": "hubspot", "kind": "company_profile"}
    )
    assert set(problem_fields(response)) == {"body.kind", "body.app"}


async def test_a_value_that_is_not_a_kind_is_still_refused_by_the_form(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post("/api/v1/memory", json={"kind": "gossip"})
    assert {"body.app", "body.kind", "body.content"} <= set(problem_fields(response))


def test_the_form_of_the_request_is_unchanged() -> None:
    """The limits are checks in code, not a change to the contract: the website's types
    still list every kind."""
    kinds = create_app().openapi()["components"]["schemas"]["MemoryIn"]["properties"]["kind"]
    assert kinds["enum"] == ["source_note", "company_profile", "lead_outcome", "note"]


# --- A note that is allowed (integration) -------------------------------------------------------


@pytest.fixture
async def stored_client(
    app: FastAPI, session_factory: async_sessionmaker[AsyncSession], embedder: Embedder
) -> AsyncIterator[httpx.AsyncClient]:
    async def own_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as db_session:
            yield db_session

    app.dependency_overrides[get_session] = own_session
    app.dependency_overrides[get_embedder] = lambda: embedder
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


@pytest.mark.integration
async def test_a_note_for_a_loaded_project_is_saved_and_found(
    stored_client: httpx.AsyncClient, session: AsyncSession
) -> None:
    response = await stored_client.post(
        "/api/v1/memory",
        json=NOTE
        | {"subject": "ABC Dairy", "url": "https://example.com/abc", "source_date": "2026-10-20"},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["app"], body["kind"], body["subject"], body["meta"]) == (
        "lead_finder",
        "note",
        "ABC Dairy",
        {},
    )
    found = await stored_client.get("/api/v1/memory/search", params={"q": "Docklands move"})
    assert [hit["id"] for hit in found.json()] == [body["id"]]
    kinds = await stored_client.get(
        "/api/v1/memory/search", params={"q": "Docklands move", "kind": "company_profile"}
    )
    assert kinds.json() == []  # reading any kind is still allowed; only writing is limited


@pytest.mark.integration
async def test_a_refused_note_is_not_saved(
    stored_client: httpx.AsyncClient, session: AsyncSession
) -> None:
    for changes in ({"kind": "lead_outcome"}, {"app": "hubspot"}, {"app": "elsewhere"}):
        response = await stored_client.post("/api/v1/memory", json=NOTE | changes)
        assert response.status_code == 422
    assert await session.scalar(select(func.count()).select_from(MemoryItem)) == 0


# --- The memory helpers (integration) -----------------------------------------------------------


async def put(
    session: AsyncSession,
    embedder: Embedder,
    content: str,
    *,
    app: str = "hubspot",
    kind: str = "company_profile",
    meta: dict[str, Any] | None = None,
) -> MemoryItem:
    return await remember(
        session, embedder, app=app, kind=kind, content=content, subject=content[:30], meta=meta
    )


@pytest.mark.integration
async def test_search_similar_orders_by_meaning_and_keeps_to_one_app_and_kind(
    session: AsyncSession, embedder: Embedder
) -> None:
    dairy = await put(session, embedder, "Dairy farm and milk processing company in Melbourne")
    await put(session, embedder, "Gold mining company with sites in the Pilbara")
    await put(session, embedder, "Dairy farm and milk processing company", app="lead_finder")
    await put(session, embedder, "Dairy farm and milk processing company", kind="note")
    vector = await embedder.embed_passages(["Milk and dairy producer based in Melbourne"])

    hits = await search_similar(session, vector[0], app="hubspot", kind="company_profile", limit=10)

    assert hits[0].item.id == dairy.id
    assert len(hits) == 2  # the other app and the other kind are not in it
    assert hits[0].similarity > hits[1].similarity
    assert all(0 <= hit.similarity <= 1 for hit in hits)
    one = await search_similar(session, vector[0], app="hubspot", kind="company_profile", limit=1)
    assert [hit.item.id for hit in one] == [dairy.id]
    # The same numbers `search` gives for the same text, so the two can be compared.
    same = await search(session, embedder, "x", app="hubspot", kind="company_profile")
    assert {hit.item.id for hit in same} == {hit.item.id for hit in hits}


@pytest.mark.integration
async def test_search_similar_filters_on_meta_and_leaves_items_out(
    session: AsyncSession, embedder: Embedder
) -> None:
    deal = await put(
        session, embedder, "Law firm in Perth", meta={"has_deal": True, "cities": ["Perth"]}
    )
    other = await put(session, embedder, "Law firm in Perth", meta={"has_deal": False})
    third = await put(session, embedder, "Law firm in Melbourne", meta={"has_deal": True})
    [vector] = await embedder.embed_passages(["Law firm in Perth"])

    async def ids(**more: Any) -> list[Any]:
        hits = await search_similar(
            session, vector, app="hubspot", kind="company_profile", limit=10, **more
        )
        return [hit.item.id for hit in hits]

    assert set(await ids()) == {deal.id, other.id, third.id}
    assert set(await ids(meta_filter={"has_deal": True})) == {deal.id, third.id}
    assert await ids(meta_filter={"has_deal": True, "cities": ["Perth"]}) == [deal.id]
    assert await ids(meta_filter={"has_deal": "nothing"}) == []
    assert set(await ids(exclude_ids=[deal.id])) == {other.id, third.id}
    assert await ids(exclude_ids=[deal.id, other.id, third.id]) == []


@pytest.mark.integration
async def test_search_similar_finds_the_set_even_when_many_other_items_are_nearer(
    session: AsyncSession, embedder: Embedder
) -> None:
    """The filter is applied before the ranking, so other items that are nearer cannot push the
    wanted ones out of the answer."""
    [vector] = await embedder.embed_passages(["office lease in Melbourne"])
    session.add_all(
        MemoryItem(app="lead_finder", kind="source_note", content=f"n{i}", embedding=vector)
        for i in range(60)
    )
    await session.commit()
    far = await put(session, embedder, "Gold mining in the Pilbara")

    hits = await search_similar(session, vector, app="hubspot", kind="company_profile", limit=5)

    assert [hit.item.id for hit in hits] == [far.id]


@pytest.mark.integration
async def test_replace_items_swaps_one_app_and_kind_and_leaves_the_rest(
    session: AsyncSession, embedder: Embedder
) -> None:
    await put(session, embedder, "old profile one")
    await put(session, embedder, "old profile two")
    keep_a = await put(session, embedder, "a source note", app="hubspot", kind="source_note")
    keep_b = await put(session, embedder, "a lead profile", app="lead_finder")

    saved = await replace_items(
        session,
        embedder,
        [Note(content="new profile", subject="New", meta={"hubspot_id": "1"})],
        app="hubspot",
        kind="company_profile",
    )
    await session.commit()

    assert saved == 1
    rows = (await session.scalars(select(MemoryItem).order_by(MemoryItem.content))).all()
    assert [row.content for row in rows] == ["a lead profile", "a source note", "new profile"]
    assert {keep_a.id, keep_b.id} <= {row.id for row in rows}
    new = next(row for row in rows if row.content == "new profile")
    assert (new.app, new.kind, new.subject, new.meta) == (
        "hubspot",
        "company_profile",
        "New",
        {"hubspot_id": "1"},
    )


@pytest.mark.integration
async def test_replace_items_with_nothing_clears_and_a_failure_changes_nothing(
    session: AsyncSession, embedder: Embedder
) -> None:
    await put(session, embedder, "profile one")

    class Broken:
        async def embed_passages(self, texts: list[str]) -> list[list[float]]:
            raise RuntimeError("the memory model is not available")

    with pytest.raises(RuntimeError):
        await replace_items(
            session,
            Broken(),  # type: ignore[arg-type]
            [Note(content="x")],
            app="hubspot",
            kind="company_profile",
        )
    await session.rollback()
    assert await session.scalar(select(func.count()).select_from(MemoryItem)) == 1  # untouched

    assert await replace_items(session, embedder, [], app="hubspot", kind="company_profile") == 0
    await session.commit()
    assert await session.scalar(select(func.count()).select_from(MemoryItem)) == 0


@pytest.mark.integration
async def test_delete_items_by_app_kind_and_meta(session: AsyncSession, embedder: Embedder) -> None:
    await put(session, embedder, "with a deal", meta={"has_deal": True})
    await put(session, embedder, "without a deal", meta={"has_deal": False})
    await put(session, embedder, "other app", app="lead_finder", meta={"has_deal": True})

    assert (
        await delete_items(
            session, app="hubspot", kind="company_profile", meta_filter={"has_deal": True}
        )
        == 1
    )
    assert await delete_items(session, app="hubspot", kind="company_profile") == 1
    assert await delete_items(session, app="hubspot", kind="company_profile") == 0
    await session.commit()
    assert await session.scalar(select(func.count()).select_from(MemoryItem)) == 1
