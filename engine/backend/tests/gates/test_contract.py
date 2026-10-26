"""Gate: the website's API contract file is the one the backend would write today."""

import json
from pathlib import Path

import pytest

from core.api.app import API_PREFIX, create_app
from core.api.routes import api_routes
from core.cli import DEFAULT_OPENAPI_PATH, render_openapi

pytestmark = pytest.mark.contract


def test_the_openapi_file_matches_the_app() -> None:
    path: Path = DEFAULT_OPENAPI_PATH
    assert path.is_file(), f"{path} is missing. Write it with: uv run engine openapi"
    expected = render_openapi(create_app()).encode("utf-8")
    actual = path.read_bytes()
    assert b"\r" not in actual, "openapi.json must have LF line endings"
    assert actual == expected, (
        "engine/frontend/openapi.json is out of date. From engine/backend run: "
        "uv run engine openapi ../frontend/openapi.json   then: cd ../frontend && npm run types"
    )


def test_the_openapi_file_is_made_for_the_base_address_of_the_website_client() -> None:
    """The client is created with baseUrl "/api/v1" and calls paths like "/runs". If the paths
    kept the prefix, every call would go to /api/v1/api/v1/runs and answer 404."""
    written = json.loads(DEFAULT_OPENAPI_PATH.read_bytes())
    assert written["servers"] == [{"url": API_PREFIX}]
    assert "/runs" in written["paths"]
    assert not [path for path in written["paths"] if path.startswith("/api")]
    file_routes = {(m.upper(), p) for p, item in written["paths"].items() for m in item}
    app_routes = {
        (method, route.path.removeprefix(API_PREFIX))
        for route in api_routes(create_app())
        for method in route.methods
    }
    assert file_routes == app_routes
