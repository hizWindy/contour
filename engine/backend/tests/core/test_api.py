"""The API: routes, the error format and the health check. No database needed."""

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from core.api.app import create_app
from core.db.engine import get_session


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def test_swagger_lists_the_endpoints(client: httpx.AsyncClient) -> None:
    paths = (await client.get("/openapi.json")).json()["paths"]
    for path in (
        "/api/v1/health",
        "/api/v1/memory",
        "/api/v1/memory/search",
        "/api/v1/hubspot/import",
        "/api/v1/hubspot/summary",
        "/api/v1/hubspot/profiles/rebuild",
        "/api/v1/searches",
        "/api/v1/runs",
        "/api/v1/runs/estimate",
        "/api/v1/runs/summary",
        "/api/v1/runs/{run_id}",
        "/api/v1/runs/{run_id}/log",
        "/api/v1/runs/{run_id}/events",
        "/api/v1/runs/{run_id}/cancel",
        "/api/v1/runs/{run_id}/resume",
        "/api/v1/settings",
        "/api/v1/settings/{key}",
        "/api/v1/lead-finder/rules",
        "/api/v1/lead-finder/run-options",
        "/api/v1/lead-finder/research",
        "/api/v1/lead-finder/leads",
        "/api/v1/lead-finder/leads/export",
        "/api/v1/lead-finder/leads/facets",
        "/api/v1/lead-finder/leads/map",
        "/api/v1/lead-finder/leads/{lead_id}",
        "/api/v1/lead-finder/leads/{lead_id}/similar",
        "/api/v1/lead-finder/leads/{lead_id}/recheck",
        "/api/v1/lead-finder/watchlist",
        "/api/v1/lead-finder/tests/run",
        "/api/v1/lead-finder/tests",
        "/api/v1/lead-finder/tests/{run_id}",
    ):
        assert path in paths, path


async def test_rules_endpoint_returns_the_rules_and_version(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/lead-finder/rules")
    assert response.status_code == 200
    body = response.json()
    assert body["criteria"]["cities"]["pass"] == ["Melbourne", "Adelaide", "Perth"]
    assert len(body["version"]) == 12


async def test_unknown_address_returns_a_problem(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/nothing-here")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["title"] == "Not Found"


async def test_bad_request_lists_the_fields(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/memory", json={"kind": "gossip"})
    assert response.status_code == 422
    body = response.json()
    assert body["title"] == "The request isn't valid"
    fields = {error["field"] for error in body["errors"]}
    assert {"body.app", "body.kind", "body.content"} <= fields


async def test_upload_must_be_an_xlsx(client: httpx.AsyncClient) -> None:
    files = {"file": ("export.csv", b"a,b\n1,2\n", "text/csv")}
    response = await client.post("/api/v1/hubspot/import", files=files)
    assert response.status_code == 422
    assert response.json()["title"] == "Upload an .xlsx file"


async def test_health_says_when_the_database_is_down(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    class DownSession:
        async def scalar(self, *args: object, **kwargs: object) -> object:
            raise OSError("connection refused")

    async def down() -> AsyncIterator[DownSession]:
        yield DownSession()

    app.dependency_overrides[get_session] = down
    response = await client.get("/api/v1/health")
    assert response.status_code == 503
    body = response.json()
    assert body["title"] == "The database can't be reached"
    assert "docker compose up -d" in body["detail"]
