"""The API contract: every route exists, errors are documented, and the stubs behave.

Most tests are fast: they build the app, read its OpenAPI file, and call routes with a database
that raises if it is touched. The few that use the database are marked `integration`.
"""

import asyncio
import copy
import inspect
import json
import os
import re
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, cast, get_type_hints

import httpx
import psycopg
import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.api import claude_dependency as lead_finder_claude_dependency
from core import cli
from core.api import app as app_module
from core.api.app import create_app
from core.api.deps import claude_dependency, run_manager_dependency, settings_dependency
from core.api.routes import api_routes
from core.api.stubs import is_stub, stub
from core.config import get_settings
from core.db.engine import get_session
from core.runs import lifecycle, reads
from core.runs import manager as manager_module
from core.runs.manager import RunManager
from core.runs.schemas import RunCreate
from core.runs.types import EventStream
from core.runtime import TRACING_VARIABLES

API = "/api/v1"
LF = f"{API}/lead-finder"
RUN_ID = "11111111-2222-3333-4444-555555555555"
LEAD_ID = "99999999-2222-3333-4444-555555555555"
RUN_BODY = {"app": "lead_finder", "mode": "discovery"}

# Every route in section 5 of the design, with the names this code uses for the ids.
ROUTES = [
    ("GET", f"{API}/health"),
    # The Companies page (PLAN-V10)
    ("GET", f"{API}/companies"),
    ("GET", f"{API}/companies/facets"),
    ("GET", f"{API}/companies/search"),
    ("GET", f"{API}/companies/{{key}}"),
    ("POST", f"{API}/auth/login"),
    ("POST", f"{API}/auth/logout"),
    ("POST", f"{API}/auth/logout-everywhere"),
    ("GET", f"{API}/auth/me"),
    ("GET", f"{API}/auth/sessions"),
    ("GET", f"{API}/auth/log"),
    ("GET", f"{API}/people"),
    ("POST", f"{API}/people"),
    ("PATCH", f"{API}/people/{{user_id}}"),
    ("POST", f"{API}/runs"),
    ("POST", f"{API}/runs/estimate"),
    ("GET", f"{API}/runs"),
    ("GET", f"{API}/runs/summary"),
    ("GET", f"{API}/runs/{{run_id}}"),
    ("GET", f"{API}/runs/{{run_id}}/log"),
    ("GET", f"{API}/runs/{{run_id}}/events"),
    ("POST", f"{API}/runs/{{run_id}}/cancel"),
    ("POST", f"{API}/runs/{{run_id}}/resume"),
    ("GET", f"{API}/settings"),
    ("PATCH", f"{API}/settings"),
    ("DELETE", f"{API}/settings/{{key}}"),
    ("GET", f"{API}/schedules"),
    ("PATCH", f"{API}/schedules/{{schedule_id}}"),
    ("POST", f"{API}/schedules/{{schedule_id}}/run"),
    ("POST", f"{API}/hubspot/import"),
    ("GET", f"{API}/hubspot/summary"),
    ("POST", f"{API}/hubspot/profiles/rebuild"),
    ("GET", f"{API}/hubspot/status"),
    ("POST", f"{API}/hubspot/sync"),
    ("GET", f"{API}/hubspot/syncs"),
    ("GET", f"{API}/hubspot/writes"),
    ("POST", f"{API}/hubspot/writes/{{write_id}}/apply"),
    ("POST", f"{API}/memory"),
    ("GET", f"{API}/memory/search"),
    ("GET", f"{API}/searches"),
    ("GET", f"{LF}/rules"),
    ("GET", f"{LF}/run-options"),
    ("POST", f"{LF}/research"),
    ("GET", f"{LF}/leads"),
    ("GET", f"{LF}/leads/facets"),
    ("GET", f"{LF}/leads/export"),
    ("GET", f"{LF}/leads/map"),
    ("GET", f"{LF}/leads/reject-reasons"),
    ("GET", f"{LF}/leads/{{lead_id}}"),
    ("PATCH", f"{LF}/leads/{{lead_id}}"),
    ("GET", f"{LF}/leads/{{lead_id}}/similar"),
    ("GET", f"{LF}/leads/{{lead_id}}/hubspot"),
    ("POST", f"{LF}/leads/{{lead_id}}/hubspot/preview"),
    ("POST", f"{LF}/leads/{{lead_id}}/hubspot/send"),
    ("POST", f"{LF}/leads/{{lead_id}}/recheck"),
    ("GET", f"{LF}/watchlist"),
    ("GET", f"{LF}/review/{{run_id}}"),
    ("POST", f"{LF}/review/status"),
    ("POST", f"{LF}/review/send"),
    ("POST", f"{LF}/tests/run"),
    ("GET", f"{LF}/tests"),
    ("GET", f"{LF}/tests/{{run_id}}"),
]


class NoDatabase:
    """A session that fails the test if a route uses it."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"this route used the database ({name})")


@pytest.fixture(scope="module")
def built_app() -> FastAPI:
    """The app and its OpenAPI schema are built once for the whole file (about half a second
    each time). Tests treat both as read-only, and the `app` fixture clears the overrides."""
    created = create_app()
    created.openapi()
    return created


@pytest.fixture
def app(built_app: FastAPI) -> Iterator[FastAPI]:
    async def no_database() -> AsyncIterator[NoDatabase]:
        yield NoDatabase()

    built_app.dependency_overrides[get_session] = no_database
    # These two resolve before the request is checked, so without them a bad request would meet
    # a missing manager (503) or the database (500) instead of the 422 being tested.
    built_app.dependency_overrides[settings_dependency] = get_settings
    built_app.dependency_overrides[run_manager_dependency] = lambda: cast(Any, object())
    try:
        yield built_app
    finally:
        built_app.dependency_overrides.clear()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


@pytest.fixture(scope="module")
def schema(built_app: FastAPI) -> dict[str, Any]:
    return built_app.openapi()


def operations(schema: dict[str, Any]) -> Iterator[tuple[str, str, dict[str, Any]]]:
    for path, item in schema["paths"].items():
        for method, operation in item.items():
            yield method.upper(), path, operation


# --- The routes -----------------------------------------------------------------------------


def test_every_route_in_the_design_is_in_the_openapi_file(schema: dict[str, Any]) -> None:
    declared = {(method, path) for method, path, _ in operations(schema)}
    missing = [route for route in ROUTES if route not in declared]
    assert not missing
    extra = declared - set(ROUTES)
    assert not extra, f"a route is not in the list above: {sorted(extra)}"


def test_every_route_has_a_summary_and_a_tag(schema: dict[str, Any]) -> None:
    for method, path, operation in operations(schema):
        assert operation.get("summary"), f"{method} {path}"
        assert operation.get("tags"), f"{method} {path}"


def test_operation_ids_are_unique_and_are_the_function_names(
    app: FastAPI, schema: dict[str, Any]
) -> None:
    ids = [operation["operationId"] for _, _, operation in operations(schema)]
    assert len(ids) == len(set(ids)), sorted(i for i in ids if ids.count(i) > 1)
    for identifier in ids:
        assert re.fullmatch(r"[a-z][a-z0-9_]*", identifier), identifier
    routes = api_routes(app)
    assert len(routes) == len(ids)
    assert set(ids) == {route.name for route in routes}


def test_two_routes_with_one_function_name_stop_the_app_from_building() -> None:
    clash = FastAPI(generate_unique_id_function=app_module.operation_id)

    def add(path: str) -> None:
        async def same() -> None: ...

        clash.get(path)(same)  # both routes get the function name "same"

    add("/one")
    add("/two")
    with pytest.raises(RuntimeError, match="operation id"):
        app_module._check_operation_ids(clash)


def non_success(operation: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    for code, response in operation["responses"].items():
        if code[:1] in ("4", "5"):
            yield code, response


def test_every_error_response_is_documented_as_problem_details(schema: dict[str, Any]) -> None:
    found = 0
    for method, path, operation in operations(schema):
        for code, response in non_success(operation):
            found += 1
            content = response.get("content", {})
            assert content, f"{method} {path} {code} has no body"
            ref = next(iter(content.values()))["schema"]["$ref"]
            expected = "ValidationProblem" if code == "422" else "ProblemDetails"
            assert ref.endswith(f"/{expected}"), f"{method} {path} {code}: {ref}"
    assert found > 100  # every route lists its errors
    assert "HTTPValidationError" not in schema["components"]["schemas"]


def test_every_route_lists_the_common_errors(schema: dict[str, Any]) -> None:
    for method, path, operation in operations(schema):
        codes = set(operation["responses"])
        assert {"400", "403", "404", "409", "422", "500", "501", "503"} <= codes, f"{method} {path}"


def test_the_health_check_keeps_its_own_503_text_and_gets_the_problem_body(
    schema: dict[str, Any],
) -> None:
    response = schema["paths"][f"{API}/health"]["get"]["responses"]["503"]
    assert response["description"] == "The database or pgvector isn't ready"
    assert response["content"]["application/json"]["schema"]["$ref"].endswith("/ProblemDetails")


def test_the_event_union_is_in_the_file_with_all_fifteen_types(schema: dict[str, Any]) -> None:
    components = schema["components"]["schemas"]
    union = components["RunEvent"]
    assert union["discriminator"]["propertyName"] == "type"
    assert len(union["oneOf"]) == 15
    assert set(union["discriminator"]["mapping"]) == {
        "run_started",
        "run_resumed",
        "plan_ready",
        "slice_started",
        "slice_done",
        "slice_failed",
        "merged",
        "company_skipped",
        "company_started",
        "company_done",
        "company_failed",
        "progress",
        "problem",
        "cap_reached",
        "run_finished",
    }
    assert components["EventLog"]["properties"]["items"]["items"]["$ref"].endswith("/RunEvent")
    for event in union["oneOf"]:
        name = event["$ref"].rsplit("/", 1)[1]
        assert "type" in components[name]["required"], name  # so a website can narrow on it


def test_a_field_with_a_default_is_still_required_in_an_answer(schema: dict[str, Any]) -> None:
    """The website reads answers as complete: RunOut.stop_reason is always there (maybe null)."""
    components = schema["components"]["schemas"]
    for name in ("RunOut", "RunCaps", "RunCounts", "RunEstimate", "SettingField", "ImportResult"):
        properties = set(components[name]["properties"])
        assert set(components[name]["required"]) == properties, name
    for name in ("LeadCard", "HubSpotOut", "LeadFinderRunParams", "SourceOut"):
        properties = set(components[name]["properties"])
        assert set(components[name]["required"]) == properties, name


def test_a_request_body_keeps_its_defaults_optional(schema: dict[str, Any]) -> None:
    components = schema["components"]["schemas"]
    assert components["RunCreate"]["required"] == ["app", "mode"]
    assert not [name for name in components if name.endswith(("-Input", "-Output"))]


def test_creating_a_run_documents_the_location_and_the_idempotency_key(
    schema: dict[str, Any],
) -> None:
    operation = schema["paths"][f"{API}/runs"]["post"]
    created = operation["responses"]["201"]
    assert "Location" in created["headers"]
    assert created["content"]["application/json"]["schema"]["$ref"].endswith("/RunOut")
    header = next(p for p in operation["parameters"] if p["in"] == "header")
    assert header["name"] == "idempotency-key"
    assert header["required"] is False
    assert header["schema"]["anyOf"][0]["maxLength"] == 64


def test_the_events_route_is_documented_as_a_stream_with_a_204(schema: dict[str, Any]) -> None:
    operation = schema["paths"][f"{API}/runs/{{run_id}}/events"]["get"]
    assert "text/event-stream" in operation["responses"]["200"]["content"]
    assert "204" in operation["responses"]
    names = {(p["in"], p["name"]) for p in operation["parameters"]}
    assert ("query", "after") in names
    assert ("header", "last-event-id") in names


def test_the_run_list_filters_are_declared(schema: dict[str, Any]) -> None:
    operation = schema["paths"][f"{API}/runs"]["get"]
    names = {p["name"] for p in operation["parameters"]}
    assert names == {"app", "mode", "status", "since", "until", "limit", "offset"}
    status = next(p for p in operation["parameters"] if p["name"] == "status")
    assert status["schema"]["anyOf"][0]["type"] == "array"
    limit = next(p for p in operation["parameters"] if p["name"] == "limit")
    assert limit["schema"]["maximum"] == 200


def test_the_lead_filters_sort_and_paging_are_declared_on_the_list(schema: dict[str, Any]) -> None:
    operation = schema["paths"][f"{LF}/leads"]["get"]
    parameters = {p["name"]: p for p in operation["parameters"]}
    assert set(parameters) == {
        "result",
        "city",
        "trigger",
        "industry",
        "industry_group",
        "min_score",
        "office_m2_min",
        "office_m2_max",
        "hubspot_status",
        "status",
        "origin",
        "run_id",
        "created_since",
        "created_until",
        "trigger_since",
        "q",
        "include_tests",
        "latest",
        "facts_missing",
        "sort",
        "order",
        "limit",
        "offset",
    }
    assert set(parameters["sort"]["schema"]["enum"]) == {
        "score",
        "created_at",
        "updated_at",
        "company",
        "city",
        "result",
        "status",
        "hubspot_status",
        "trigger_date",
        "office_m2",
        "cost_usd",
    }
    assert parameters["order"]["schema"]["enum"] == ["asc", "desc"]
    assert parameters["sort"]["schema"]["default"] == "score"
    assert parameters["order"]["schema"]["default"] == "desc"
    assert parameters["include_tests"]["schema"]["default"] is False
    assert "default" not in parameters["latest"]["schema"]  # no default: it depends on run_id
    assert {t["type"] for t in parameters["latest"]["schema"]["anyOf"]} == {"boolean", "null"}
    assert parameters["result"]["schema"]["anyOf"][0]["type"] == "array"  # repeated keys
    assert parameters["q"]["schema"]["anyOf"][0]["maxLength"] == 100
    assert parameters["limit"]["schema"]["maximum"] == 200
    assert parameters["hubspot_status"]["schema"]["anyOf"][0]["items"]["enum"] == [
        "new",
        "in_hubspot",
        "open_deal",
        "dissolved_deal",
        "possible_match",
    ]


def test_export_facets_and_map_take_the_same_filters(schema: dict[str, Any]) -> None:
    listed = {p["name"] for p in schema["paths"][f"{LF}/leads"]["get"]["parameters"]}
    paging = {"sort", "order", "limit", "offset"}
    filters = listed - paging
    for name, extra in (("export", {"sort", "order"}), ("facets", set()), ("map", set())):
        parameters = {p["name"] for p in schema["paths"][f"{LF}/leads/{name}"]["get"]["parameters"]}
        assert parameters == filters | extra, name


def test_the_csv_export_is_documented_as_a_file(schema: dict[str, Any]) -> None:
    ok = schema["paths"][f"{LF}/leads/export"]["get"]["responses"]["200"]
    assert "text/csv" in ok["content"]
    assert "Content-Disposition" in ok["headers"]


def test_the_watchlist_and_test_routes_have_their_final_shapes(schema: dict[str, Any]) -> None:
    paths = schema["paths"]
    assert paths[f"{LF}/tests/run"]["post"]["responses"]["201"]
    assert paths[f"{LF}/leads/{{lead_id}}/recheck"]["post"]["responses"]["201"]
    names = {p["name"] for p in paths[f"{LF}/watchlist"]["get"]["parameters"]}
    assert names == {"include_unlikely", "include_director", "limit"}
    assert {p["name"] for p in paths[f"{LF}/tests"]["get"]["parameters"]} == {"limit", "offset"}


def test_the_searches_route_has_the_run_and_step_filters(schema: dict[str, Any]) -> None:
    names = {p["name"] for p in schema["paths"][f"{API}/searches"]["get"]["parameters"]}
    assert {"run_id", "step"} <= names
    source = schema["components"]["schemas"]["SourceOut"]
    assert set(source["properties"]) == {"url", "title", "page_age"}
    assert schema["components"]["schemas"]["SearchOut"]["properties"]["sources"]["items"][
        "$ref"
    ].endswith("/SourceOut")


def test_memory_answers_carry_meta_and_imports_say_how_many_profiles(
    schema: dict[str, Any],
) -> None:
    components = schema["components"]["schemas"]
    assert "meta" in components["MemoryOut"]["properties"]
    assert "meta" in components["MemoryHitOut"]["properties"]
    assert "profiles_rebuilt" in components["ImportResult"]["properties"]


# --- What the schema says (the website's types and Swagger read these words) ------------------


def operation(schema: dict[str, Any], method: str, path: str) -> dict[str, Any]:
    found: dict[str, Any] = schema["paths"][path][method]
    return found


def test_the_event_stream_has_no_event_line_so_the_website_reads_it_with_onmessage(
    schema: dict[str, Any],
) -> None:
    events = operation(schema, "get", f"{API}/runs/{{run_id}}/events")
    text = events["description"]
    assert "no `event:` line" in text
    assert "data.type" in text
    assert "onmessage" in text
    assert "`event` (the type)" not in text  # the old wording promised a line that is not sent
    ok = events["responses"]["200"]["description"]
    assert "`id:`" in ok
    assert "`data:`" in ok
    assert "no `event:` line" in ok


def test_a_run_started_twice_with_one_key_is_documented_as_a_409(schema: dict[str, Any]) -> None:
    start = operation(schema, "post", f"{API}/runs")
    assert "idempotency_key_reused" in start["description"]
    assert "different body" in start["description"]
    assert "run_already_active" in start["description"]
    conflict = start["responses"]["409"]
    assert "idempotency_key_reused" in conflict["description"]
    assert "run_already_active" in conflict["description"]
    assert conflict["content"]["application/json"]["schema"]["$ref"].endswith("/ProblemDetails")
    header = next(p for p in start["parameters"] if p["in"] == "header")
    assert "idempotency_key_reused" in header["description"]


def test_settings_say_how_values_are_sent_and_where_an_error_points(
    schema: dict[str, Any],
) -> None:
    components = schema["components"]["schemas"]
    patch = operation(schema, "patch", f"{API}/settings")["description"]
    assert "body.values.<key>" in patch
    assert "string" in patch
    assert "body.values" in components["SettingsPatch"]["properties"]["values"]["description"]
    assert "string" in components["SettingsPatch"]["properties"]["values"]["description"]
    field = components["SettingField"]["properties"]
    assert "ALWAYS a string" in field["type"]["description"]
    assert "int: `value` is a JSON number" in field["type"]["description"]
    for name in ("min", "max", "default", "value"):
        assert "string for a decimal" in field[name]["description"], name


def test_run_days_are_melbourne_dates_and_the_run_filters_use_the_same_kind_of_date(
    schema: dict[str, Any],
) -> None:
    components = schema["components"]["schemas"]
    assert "Australia/Melbourne" in components["RunSummary"]["description"]
    assert "Australia/Melbourne" in components["RunSummaryDay"]["description"]
    assert "Australia/Melbourne" in components["RunSummary"]["properties"]["since"]["description"]
    runs = {p["name"]: p for p in operation(schema, "get", f"{API}/runs")["parameters"]}
    summary = {p["name"]: p for p in operation(schema, "get", f"{API}/runs/summary")["parameters"]}
    date_or_null = [{"type": "string", "format": "date"}, {"type": "null"}]
    assert summary["since"]["schema"]["anyOf"] == date_or_null
    assert runs["since"]["schema"]["anyOf"] == date_or_null  # the same type as the summary's
    assert runs["until"]["schema"]["anyOf"] == date_or_null
    assert "Australia/Melbourne" in runs["since"]["description"]
    assert "Australia/Melbourne" in runs["until"]["description"]
    assert "Australia/Melbourne" in summary["since"]["description"]


def test_every_part_of_the_run_params_says_which_mode_uses_it(schema: dict[str, Any]) -> None:
    components = schema["components"]["schemas"]
    parts = components["LeadFinderRunParams"]["properties"]
    assert set(parts) == {
        "cities",
        "area",
        "triggers",
        "since_days",
        "caps",
        "watchlist",
        "companies",
        "recheck",
    }
    expected = {
        "cities": "discovery",
        "area": "discovery",
        "triggers": "discovery",
        "since_days": "discovery",
        "watchlist": "watchlist",
        "companies": "company",
        "recheck": "company",
    }
    for name, mode in expected.items():
        assert f"mode {mode}" in parts[name]["description"], name
    assert "every mode" in parts["caps"]["description"]
    defaults = components["RunOptions"]["properties"]["defaults"]["description"]
    assert "only the parts of its mode" in defaults


def test_the_lead_list_describes_latest_and_the_bounds(schema: dict[str, Any]) -> None:
    leads = operation(schema, "get", f"{LF}/leads")
    parameters = {p["name"]: p for p in leads["parameters"]}
    latest = parameters["latest"]["description"]
    assert "run_id" in latest
    assert "BEFORE the other filters" in latest
    assert "test-set lead and a real lead" in latest
    assert "run_id" in leads["description"]
    for name in ("office_m2_min", "office_m2_max"):
        assert parameters[name]["schema"]["anyOf"][0]["maximum"] == 2_147_483_647, name
    assert parameters["offset"]["schema"]["maximum"] == 1_000_000


def test_a_company_done_event_says_the_hubspot_status_in_words_the_website_can_switch_on(
    schema: dict[str, Any],
) -> None:
    done = schema["components"]["schemas"]["CompanyDoneData"]["properties"]
    assert done["hubspot_status"]["enum"] == [
        "new",
        "in_hubspot",
        "open_deal",
        "dissolved_deal",
        "possible_match",
    ]
    assert done["result"]["type"] == "string"  # the result stays plain text


# --- Route order ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", f"{API}/runs/summary", None),
        ("POST", f"{API}/runs/estimate", RUN_BODY),
        ("GET", f"{LF}/leads/export", None),
        ("GET", f"{LF}/leads/facets", None),
        ("GET", f"{LF}/leads/map", None),
    ],
)
async def test_fixed_paths_are_not_swallowed_by_the_id_routes(
    client: httpx.AsyncClient, method: str, path: str, body: dict[str, str] | None
) -> None:
    response = await client.request(method, path, json=body)
    text = response.text
    assert response.status_code != 422, text  # the id route would say the id isn't a UUID
    assert "run_id" not in text
    assert "lead_id" not in text
    assert "valid UUID" not in text


@pytest.mark.parametrize("path", [f"{API}/runs/not-a-uuid", f"{LF}/leads/not-a-uuid"])
async def test_the_id_routes_do_check_the_id(client: httpx.AsyncClient, path: str) -> None:
    response = await client.get(path)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] in ("path.run_id", "path.lead_id")


# --- Who builds what: the run routes and the run manager are split in two ---------------------

# The routes that only read. Package B1b builds them, in core/api/runs_read.py.
READ_ROUTES = {
    ("POST", f"{API}/runs/estimate"),
    ("GET", f"{API}/runs"),
    ("GET", f"{API}/runs/summary"),
    ("GET", f"{API}/runs/{{run_id}}"),
    ("GET", f"{API}/runs/{{run_id}}/log"),
}
# The routes that act. Package B1a builds them, in core/api/runs.py.
ACTION_ROUTES = {
    ("POST", f"{API}/runs"),
    ("GET", f"{API}/runs/{{run_id}}/events"),
    ("POST", f"{API}/runs/{{run_id}}/cancel"),
    ("POST", f"{API}/runs/{{run_id}}/resume"),
}


def test_the_run_routes_are_split_between_the_two_files(app: FastAPI) -> None:
    found: dict[tuple[str, str], str] = {}
    for route in api_routes(app):
        if route.path.startswith(f"{API}/runs"):
            for method in route.methods:
                found[(method, route.path)] = route.endpoint.__module__
    assert set(found) == READ_ROUTES | ACTION_ROUTES
    assert {key for key, module in found.items() if module == "core.api.runs_read"} == READ_ROUTES
    assert {key for key, module in found.items() if module == "core.api.runs"} == ACTION_ROUTES


def test_the_fixed_run_paths_come_before_the_id_route(app: FastAPI) -> None:
    order = [label for route in api_routes(app) for label in route.labels]
    id_route = order.index(f"GET {API}/runs/{{run_id}}")
    assert order.index(f"GET {API}/runs/summary") < id_route
    assert order.index(f"POST {API}/runs/estimate") < order.index(
        f"POST {API}/runs/{{run_id}}/cancel"
    )


def test_subscribing_is_a_coroutine_so_the_404_and_429_come_before_the_stream() -> None:
    assert inspect.iscoroutinefunction(RunManager.subscribe)
    assert inspect.iscoroutinefunction(RunManager.stream_is_over)
    assert get_type_hints(RunManager.subscribe)["return"] is EventStream
    assert {"aclose", "__anext__", "__aiter__"} <= set(dir(EventStream))


class Parts:
    """Stands in for everything the manager is built from. The reading methods use none of it."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"the reading methods must not use {name}")


async def test_the_reading_methods_only_call_the_read_modules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """So the package that builds reads.py and estimate.py never needs to edit manager.py."""
    calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def recorder(name: str) -> Any:
        async def record(*args: Any, **kwargs: Any) -> str:
            calls.append((name, args, kwargs))
            return name

        return record

    for name in ("get_run", "list_runs", "event_log", "summary"):
        monkeypatch.setattr(reads, name, recorder(name))
    monkeypatch.setattr(manager_module, "estimate_run", recorder("estimate_run"))

    parts: Any = Parts()
    manager = RunManager(
        session_factory=parts,
        embedder=parts,
        claude_provider=parts,
        checkpointer_source=parts,
        settings_provider=parts,
        kinds={},
    )
    run_id = uuid.uuid4()
    body = RunCreate(app="lead_finder", mode="discovery")
    answers: list[Any] = [  # each fake returns its own name, so the answer shows who was called
        await manager.get_run(run_id),
        await manager.list_runs(app="lead_finder", limit=5),
        await manager.event_log(run_id, 3, 10),
        await manager.summary(date(2026, 10, 1)),
        await manager.estimate(body),
    ]
    assert answers == ["get_run", "list_runs", "event_log", "summary", "estimate_run"]

    by_name = {name: (args, kwargs) for name, args, kwargs in calls}
    assert by_name["get_run"][0] == (parts, run_id)
    assert by_name["list_runs"][1]["app"] == "lead_finder"
    assert by_name["list_runs"][1]["limit"] == 5
    assert by_name["event_log"][0] == (parts, run_id, 3, 10)
    assert by_name["summary"][0] == (parts, date(2026, 10, 1))
    assert by_name["estimate_run"][0] == (body,)
    assert by_name["estimate_run"][1]["kinds"] == {}


# --- Stubs ----------------------------------------------------------------------------------


def stub_routes(app: FastAPI) -> set[tuple[str, str]]:
    return {
        (method, route.path)
        for route in api_routes(app)
        if route.is_stub
        for method in route.methods
    }


def test_the_routes_that_work_now_are_not_stubs_and_the_rest_are(app: FastAPI) -> None:
    stubs = stub_routes(app)
    working = {
        ("GET", f"{API}/health"),
        ("POST", f"{API}/hubspot/import"),
        ("GET", f"{API}/hubspot/summary"),
        ("POST", f"{API}/memory"),
        ("GET", f"{API}/memory/search"),
        ("GET", f"{API}/searches"),
        ("GET", f"{LF}/rules"),
        ("POST", f"{LF}/research"),
        ("GET", f"{LF}/leads"),
        ("GET", f"{LF}/leads/{{lead_id}}"),
    }
    assert stubs.isdisjoint(working)  # these were built here, so they are not marked
    assert stubs <= set(ROUTES)  # a package that builds a route removes its mark


STUB_CASES = [
    ("POST", f"{API}/runs", RUN_BODY),
    ("POST", f"{API}/runs/estimate", RUN_BODY),
    ("GET", f"{API}/runs", None),
    ("GET", f"{API}/runs/summary", None),
    ("GET", f"{API}/runs/{{run_id}}", None),
    ("GET", f"{API}/runs/{{run_id}}/log", None),
    ("GET", f"{API}/runs/{{run_id}}/events", None),
    ("POST", f"{API}/runs/{{run_id}}/cancel", None),
    ("POST", f"{API}/runs/{{run_id}}/resume", None),
    ("GET", f"{API}/settings", None),
    ("PATCH", f"{API}/settings", {"values": {"run_cap_usd": "15.00"}}),
    ("DELETE", f"{API}/settings/{{key}}", None),
    ("POST", f"{API}/hubspot/profiles/rebuild", None),
    ("GET", f"{LF}/run-options", None),
    ("GET", f"{LF}/leads/facets", None),
    ("GET", f"{LF}/leads/export", None),
    ("GET", f"{LF}/leads/map", None),
    ("PATCH", f"{LF}/leads/{{lead_id}}", {"note": "Call in March"}),
    ("GET", f"{LF}/leads/{{lead_id}}/similar", None),
    ("POST", f"{LF}/leads/{{lead_id}}/recheck", None),
    ("GET", f"{LF}/watchlist", None),
    ("POST", f"{LF}/tests/run", None),
    ("GET", f"{LF}/tests", None),
    ("GET", f"{LF}/tests/{{run_id}}", None),
]


def skip_unless_stub(app: FastAPI, method: str, template: str) -> str:
    """The real path for a route that is still a stub. A route that was built is skipped."""
    if (method, template) not in stub_routes(app):
        pytest.skip("this route is built now")
    return template.format(run_id=RUN_ID, lead_id=LEAD_ID, key="run_cap_usd")


@pytest.mark.parametrize(("method", "template", "body"), STUB_CASES)
async def test_a_stub_answers_501_in_the_problem_format(
    app: FastAPI,
    client: httpx.AsyncClient,
    method: str,
    template: str,
    body: dict[str, Any] | None,
) -> None:
    path = skip_unless_stub(app, method, template)
    response = await client.request(method, path, json=body)
    assert response.status_code == 501, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    problem = response.json()
    assert problem["title"] == "Not built yet"
    assert problem["code"] == "not_implemented"
    assert problem["status"] == 501


async def test_a_stub_still_checks_its_request_first(client: httpx.AsyncClient) -> None:
    """The contract is real: a bad body or query is a 422 even before the route is built."""
    bad_body = await client.post(f"{API}/runs", json={"app": "Lead Finder", "mode": "x"})
    assert bad_body.status_code == 422
    assert bad_body.json()["errors"][0]["field"] == "body.app"
    bad_query = await client.get(f"{API}/runs", params={"limit": 500})
    assert bad_query.status_code == 422
    assert bad_query.json()["errors"][0]["field"] == "query.limit"
    bad_status = await client.get(f"{API}/runs", params={"status": "sleeping"})
    assert bad_status.status_code == 422
    bad_sort = await client.get(f"{LF}/leads", params={"sort": "mood"})
    assert bad_sort.status_code == 422
    bad_patch = await client.patch(f"{LF}/leads/{LEAD_ID}", json={"status": "sent"})
    assert bad_patch.status_code == 422
    empty_settings = await client.patch(f"{API}/settings", json={"values": {}})
    assert empty_settings.status_code == 422


async def test_a_bad_idempotency_key_is_a_422(client: httpx.AsyncClient) -> None:
    for key in ("has spaces", "x" * 65, ""):
        response = await client.post(f"{API}/runs", json=RUN_BODY, headers={"Idempotency-Key": key})
        assert response.status_code == 422, key
        assert response.json()["errors"][0]["field"] == "header.idempotency-key"


async def test_a_good_idempotency_key_passes_the_check(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    skip_unless_stub(app, "POST", f"{API}/runs")
    ok = await client.post(
        f"{API}/runs", json=RUN_BODY, headers={"Idempotency-Key": str(uuid.uuid4())}
    )
    assert ok.status_code == 501


# --- Bounds: a value the database can't hold is a 422, never a 500 -----------------------------

NUL = chr(0)  # PostgreSQL can't store it in text
INT32_OVER = 2_147_483_648  # one above the largest integer column
OFFSET_OVER = 1_000_001
BAD_VALUES = [
    (f"{LF}/leads", {"office_m2_min": INT32_OVER}, "query.office_m2_min"),
    (f"{LF}/leads", {"office_m2_max": INT32_OVER}, "query.office_m2_max"),
    (f"{LF}/leads", {"offset": OFFSET_OVER}, "query.offset"),
    (f"{LF}/leads", {"q": f"a{NUL}b"}, "query.q"),
    (f"{LF}/leads", {"city": ["Melbourne", f"x{NUL}"]}, "query.city.1"),
    (f"{LF}/leads", {"trigger": f"{NUL}"}, "query.trigger.0"),
    (f"{LF}/leads", {"industry": f"Law{NUL}"}, "query.industry.0"),
    (f"{LF}/leads", {"industry_group": f"Law{NUL}"}, "query.industry_group.0"),
    (f"{LF}/leads/export", {"office_m2_max": INT32_OVER}, "query.office_m2_max"),
    (f"{LF}/leads/facets", {"q": f"a{NUL}"}, "query.q"),
    (f"{LF}/leads/map", {"city": f"a{NUL}"}, "query.city.0"),
    (f"{API}/runs", {"offset": OFFSET_OVER}, "query.offset"),
    (f"{API}/runs", {"app": f"lead{NUL}"}, "query.app"),
    (f"{API}/runs", {"mode": f"x{NUL}"}, "query.mode"),
    (f"{API}/runs", {"since": "2026-13-45"}, "query.since"),
    (f"{API}/runs", {"until": "2026-10-26T09:30:00+11:00"}, "query.until"),
    (f"{API}/runs/{RUN_ID}/log", {"after": INT32_OVER}, "query.after"),
    (f"{API}/runs/{RUN_ID}/events", {"after": INT32_OVER}, "query.after"),
    (f"{API}/searches", {"offset": OFFSET_OVER}, "query.offset"),
    (f"{API}/searches", {"app": f"lead{NUL}"}, "query.app"),
    (f"{API}/searches", {"subject": f"Seek{NUL}"}, "query.subject"),
    (f"{API}/searches", {"step": f"search{NUL}"}, "query.step"),
    (f"{API}/memory/search", {"q": f"dairy{NUL} moving"}, "query.q"),
    (f"{API}/memory/search", {"q": "dairy moving", "app": f"a{NUL}"}, "query.app"),
    (f"{LF}/tests", {"offset": OFFSET_OVER}, "query.offset"),
]


@pytest.mark.parametrize(("path", "params", "field"), BAD_VALUES)
async def test_a_value_the_database_cannot_hold_is_a_422_that_names_the_field(
    client: httpx.AsyncClient, path: str, params: dict[str, Any], field: str
) -> None:
    response = await client.get(path, params=params)
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["errors"][0]["field"] == field


async def test_text_the_database_cannot_hold_is_refused_in_a_path_and_in_bodies(
    client: httpx.AsyncClient,
) -> None:
    key = await client.delete(f"{API}/settings/run%00cap")
    assert key.status_code == 422
    assert key.json()["errors"][0]["field"] == "path.key"
    note = await client.post(
        f"{API}/memory", json={"app": "lead_finder", "kind": "note", "content": f"a{NUL}b"}
    )
    assert note.status_code == 422
    assert note.json()["errors"][0]["field"] == "body.content"
    subject = await client.post(
        f"{API}/memory",
        json={"app": "lead_finder", "kind": "note", "content": "ok", "subject": f"{NUL}"},
    )
    assert subject.status_code == 422
    assert subject.json()["errors"][0]["field"] == "body.subject"
    for field in ("note", "reject_reason"):
        patch = await client.patch(f"{LF}/leads/{LEAD_ID}", json={field: f"call{NUL}"})
        assert patch.status_code == 422, field
        assert patch.json()["errors"][0]["field"] == f"body.{field}"


@pytest.mark.parametrize(
    ("path", "params"),
    [
        (f"{LF}/leads/export", {"office_m2_min": 2_147_483_647, "office_m2_max": 2_147_483_647}),
        (f"{LF}/leads/export", {"q": "a\nb\t(c) 100%", "city": ["Melbourne", "Port Melbourne"]}),
        (f"{API}/runs", {"offset": 1_000_000, "since": "2026-10-01", "until": "2026-10-31"}),
        (f"{API}/runs/{RUN_ID}/log", {"after": 2_147_483_647}),
        (f"{API}/runs/{RUN_ID}/events", {"after": 2_147_483_647}),
        (f"{LF}/tests", {"offset": 1_000_000}),
    ],
)
async def test_the_largest_allowed_values_are_not_refused(
    client: httpx.AsyncClient, path: str, params: dict[str, Any]
) -> None:
    response = await client.get(path, params=params)
    assert response.status_code != 422, response.text  # a stub answers 501, a built route 200


async def test_a_lead_patch_that_clears_the_status_names_that_field(
    client: httpx.AsyncClient,
) -> None:
    cleared = await client.patch(f"{LF}/leads/{LEAD_ID}", json={"status": None})
    assert cleared.status_code == 422
    error = cleared.json()["errors"][0]
    assert error["field"] == "body.status"
    assert error["message"] == "status can't be cleared. Choose a status."
    # A patch that leaves the status out, or changes it, is fine.
    for body in ({"note": None}, {"status": "watching"}, {"useful": True, "status": "new"}):
        ok = await client.patch(f"{LF}/leads/{LEAD_ID}", json=body)
        assert ok.status_code != 422, body


def test_the_stub_decorator_marks_the_route_and_keeps_its_parameters() -> None:
    class Body(BaseModel):
        name: str

    little = FastAPI()

    @little.post("/things/{thing_id}")
    @stub
    async def make_thing(thing_id: int, body: Body, size: int = 3) -> Body:
        raise NotImplementedError

    route = next(r for r in little.routes if isinstance(r, APIRoute))
    assert route.endpoint.__stub__ is True  # type: ignore[attr-defined]
    assert is_stub(route.endpoint)
    assert not is_stub(test_the_stub_decorator_marks_the_route_and_keeps_its_parameters)
    assert list(inspect.signature(route.endpoint).parameters) == ["thing_id", "body", "size"]
    schema = little.openapi()
    operation = schema["paths"]["/things/{thing_id}"]["post"]
    assert {p["name"] for p in operation["parameters"]} == {"thing_id", "size"}
    assert operation["requestBody"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/Body"
    )


# --- The shared Claude dependency -----------------------------------------------------------


def test_the_lead_finder_re_exports_the_same_claude_dependency() -> None:
    assert lead_finder_claude_dependency is claude_dependency


async def test_an_override_set_on_the_re_exported_function_reaches_the_route(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    app.dependency_overrides[lead_finder_claude_dependency] = lambda: None
    # With the override the route gets past the Claude dependency and meets the body check.
    response = await client.post(f"{LF}/research", json={"company": "<script>"})
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "body.company"


async def test_a_bad_company_name_is_a_422_that_names_the_field(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    app.dependency_overrides[claude_dependency] = lambda: None
    response = await client.post(f"{LF}/research", json={"company": "Acme\x00; DROP TABLE"})
    assert response.status_code == 422
    error = response.json()["errors"][0]
    assert error["field"] == "body.company"
    assert "2 to 80 characters" in error["message"]
    assert "Value error" not in error["message"]


# --- Start-up -------------------------------------------------------------------------------


async def test_the_host_check_and_origin_guard_are_in_place(client: httpx.AsyncClient) -> None:
    wrong_host = await client.get(f"{API}/runs/summary", headers={"Host": "evil.example"})
    assert wrong_host.status_code == 400
    foreign = await client.post(
        f"{API}/runs/{RUN_ID}/cancel", headers={"Origin": "http://evil.example"}
    )
    assert foreign.status_code == 403
    assert foreign.json()["code"] == "origin_not_allowed"
    ours = await client.post(
        f"{API}/runs/{RUN_ID}/cancel", headers={"Origin": "http://localhost:5173"}
    )
    assert ours.status_code != 403  # it reaches the route
    plain = await client.get(f"{API}/runs/summary")
    assert plain.headers["cache-control"] == "no-store"
    assert plain.headers["x-content-type-options"] == "nosniff"


def test_building_the_app_switches_langsmith_tracing_off(monkeypatch: pytest.MonkeyPatch) -> None:
    import langsmith
    import langsmith.utils as ls_utils

    langsmith.configure(enabled=None)  # forget an earlier switch-off in this process
    ls_utils.get_env_var.cache_clear()  # type: ignore[attr-defined]
    for name in TRACING_VARIABLES:
        monkeypatch.setenv(name, "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2-secret")
    assert ls_utils.tracing_is_enabled() is True  # the setup really turns it on
    try:
        create_app()
        assert ls_utils.tracing_is_enabled() is False
        assert os.environ["LANGSMITH_TRACING"] == "false"
        assert "LANGSMITH_API_KEY" not in os.environ
    finally:
        langsmith.configure(enabled=False)


async def test_the_lifespan_starts_the_run_engine_then_stops_it_and_closes_the_database(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    steps: list[str] = []

    async def started(received: FastAPI) -> None:
        assert received is app
        steps.append("startup")

    async def stopped(received: FastAPI) -> None:
        assert received is app
        steps.append("shutdown")

    class FakeEngine:
        async def dispose(self) -> None:
            steps.append("dispose")

    monkeypatch.setattr(lifecycle, "startup", started)
    monkeypatch.setattr(lifecycle, "shutdown", stopped)
    monkeypatch.setattr(app_module, "get_engine", FakeEngine)
    async with app.router.lifespan_context(app):
        assert steps == ["startup"]
    assert steps == ["startup", "shutdown", "dispose"]


async def test_the_engine_is_still_closed_when_start_up_fails(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    steps: list[str] = []

    async def refuses(received: FastAPI) -> None:
        raise RuntimeError("Another backend is already running")

    async def stopped(received: FastAPI) -> None:
        steps.append("shutdown")

    class FakeEngine:
        async def dispose(self) -> None:
            steps.append("dispose")

    monkeypatch.setattr(lifecycle, "startup", refuses)
    monkeypatch.setattr(lifecycle, "shutdown", stopped)
    monkeypatch.setattr(app_module, "get_engine", FakeEngine)
    with pytest.raises(RuntimeError, match="Another backend"):
        async with app.router.lifespan_context(app):
            pytest.fail("the app must not start")
    assert steps == ["shutdown", "dispose"]


async def test_a_backend_waiting_for_the_lock_starts_its_background_work_only_on_take_over(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Server mode during a deploy (PLAN-V8 B3): the old backend still holds the run engine, so
    the scheduler and the HubSpot copy start only once this one has taken it over."""
    steps: list[str] = []

    async def started(received: FastAPI) -> None:
        received.state.run_engine_waiting = True
        steps.append("startup, waiting")

    async def background_work(received: FastAPI) -> None:
        steps.append("background work")

    def take_over_later(received: FastAPI, then: Any) -> None:
        assert (received, then) == (app, background_work)
        steps.append("take over later")

    async def stop_waiting(received: FastAPI) -> None:
        steps.append("stop waiting")

    async def stopped(received: FastAPI) -> None:
        steps.append("shutdown")

    class FakeEngine:
        async def dispose(self) -> None:
            steps.append("dispose")

    monkeypatch.setattr(lifecycle, "startup", started)
    monkeypatch.setattr(lifecycle, "take_over_later", take_over_later)
    monkeypatch.setattr(lifecycle, "stop_waiting", stop_waiting)
    monkeypatch.setattr(lifecycle, "shutdown", stopped)
    monkeypatch.setattr(app_module, "start_background_work", background_work)
    monkeypatch.setattr(app_module, "get_engine", FakeEngine)
    async with app.router.lifespan_context(app):
        assert steps == ["startup, waiting", "take over later"]
    assert steps == ["startup, waiting", "take over later", "stop waiting", "shutdown", "dispose"]


async def test_the_app_starts_without_a_run_manager_when_the_database_is_down(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeEngine:
        async def dispose(self) -> None: ...

    class NoDatabaseManager:
        async def acquire_backend_lock(self) -> bool:
            raise psycopg.OperationalError("connection refused")

        async def shutdown(self) -> None: ...

    monkeypatch.setattr(app_module, "get_engine", FakeEngine)
    monkeypatch.setattr(lifecycle, "build", lambda _app: NoDatabaseManager())
    async with app.router.lifespan_context(app):
        assert not hasattr(app.state, "run_manager")


# --- The openapi command --------------------------------------------------------------------


def test_the_openapi_text_is_the_same_every_time_and_sorted(built_app: FastAPI) -> None:
    first = cli.render_openapi(built_app)
    second = cli.render_openapi(create_app())  # a second, separate build gives the same text
    assert first == second
    assert first.endswith("}\n")
    assert "\r" not in first
    assert first.startswith('{\n  "components"')  # keys are sorted: components before info
    assert '"summary": "Start a run"' in first


def test_the_website_file_has_paths_without_the_prefix_and_says_where_they_live(
    app: FastAPI,
) -> None:
    """The website's client has the base address /api/v1 and calls paths like /runs."""
    written = json.loads(cli.render_openapi(app))
    assert written["servers"] == [{"url": API}]
    assert not [path for path in written["paths"] if path.startswith("/api")]
    found = {(method, path) for method, path, _ in operations(written)}
    assert found == {(method, path.removeprefix(API)) for method, path in ROUTES}
    assert ("GET", "/runs/{run_id}") in found
    assert ("GET", "/lead-finder/leads") in found
    # The base address and the path together are the real address of the route.
    served = {(method, path) for method, path, _ in operations(app.openapi())}
    assert {(method, f"{API}{path}") for method, path in found} == served


def test_writing_the_website_file_leaves_the_served_schema_alone(app: FastAPI) -> None:
    """Swagger and /openapi.json keep the full paths: only the website's file is changed."""
    before = copy.deepcopy(app.openapi())
    cli.render_openapi(app)
    cli.render_openapi(app)
    assert app.openapi() == before
    assert all(path.startswith(f"{API}/") for path in app.openapi()["paths"])
    assert "servers" not in app.openapi()


def test_a_path_outside_the_api_prefix_stops_the_website_file() -> None:
    little = FastAPI()

    @little.get("/elsewhere")
    async def elsewhere() -> None: ...

    with pytest.raises(RuntimeError, match="not under /api/v1/"):
        cli.website_schema(little)


def test_the_openapi_file_is_written_with_unix_line_endings(
    built_app: FastAPI, tmp_path: Path
) -> None:
    target = tmp_path / "nested" / "openapi.json"
    written = cli.write_openapi(target)  # builds its own app
    assert written == target
    data = target.read_bytes()
    assert b"\r" not in data
    assert data == cli.render_openapi(built_app).encode("utf-8")


def test_the_openapi_command_writes_to_the_path_it_is_given(
    built_app: FastAPI,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_module, "create_app", lambda: built_app)  # the build is tested above
    target = tmp_path / "openapi.json"
    assert cli.main(["openapi", str(target)]) == 0
    assert target.is_file()
    assert "Wrote" in capsys.readouterr().out


def test_the_default_openapi_path_is_the_website_folder() -> None:
    assert cli.DEFAULT_OPENAPI_PATH.parts[-3:] == ("engine", "frontend", "openapi.json")


def test_rebuild_profiles_says_so_when_it_is_not_built_yet(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import importlib

    real = importlib.import_module

    def missing(name: str, package: str | None = None) -> Any:
        if name == "core.hubspot.profiles":
            raise ModuleNotFoundError("No module named 'core.hubspot.profiles'", name=name)
        return real(name, package)

    monkeypatch.setattr(importlib, "import_module", missing)
    assert cli.main(["rebuild-profiles"]) == 1
    assert "isn't built yet" in capsys.readouterr().err


def test_purge_needs_a_number_of_days(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        cli.main(["purge"])
    with pytest.raises(SystemExit):
        cli.main(["purge", "--older-than-days", "0"])
    with pytest.raises(SystemExit):
        cli.main(["purge", "--older-than-days", "soon"])


def test_serve_refuses_an_address_that_is_not_this_computer(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class Wide:
        api_host = "0.0.0.0"

    monkeypatch.setattr(cli, "get_settings", lambda: Wide())
    assert cli.serve() == 1
    assert "only runs on this computer" in capsys.readouterr().err


def test_serve_gives_uvicorn_a_graceful_shutdown_time(monkeypatch: pytest.MonkeyPatch) -> None:
    import uvicorn

    seen: dict[str, Any] = {}

    class FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            seen["timeout"] = config.timeout_graceful_shutdown
            seen["host"] = config.host
            seen["proxy_headers"] = config.proxy_headers

        async def serve(self) -> None: ...

    class Local:
        api_host = "127.0.0.1"
        listen_host = "127.0.0.1"
        api_port = 8765
        auto_migrate = False
        server_mode = False
        trusted_proxies = ()

    monkeypatch.setattr(cli, "get_settings", lambda: Local())
    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    assert cli.serve() == 0
    # On this computer: its own address, and no proxy's word is taken for a client's address.
    assert seen == {"timeout": 15, "host": "127.0.0.1", "proxy_headers": False}


def test_a_bad_setting_is_explained_without_showing_its_value(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from core.config import get_settings

    monkeypatch.setenv("API_HOST", "10.9.8.7")
    get_settings.cache_clear()
    try:
        assert cli.main(["serve"]) == 1
    finally:
        monkeypatch.delenv("API_HOST")
        get_settings.cache_clear()
    err = capsys.readouterr().err
    assert "api_host" in err
    assert "10.9.8.7" not in err


def test_a_logged_reply_carries_the_run_it_belongs_to() -> None:
    from core.claude.client import Reply, Source
    from core.claude.pricing import Usage
    from core.searches.service import log_reply

    class Collector:
        def __init__(self) -> None:
            self.rows: list[Any] = []

        def add(self, row: Any) -> None:
            self.rows.append(row)

    reply: Reply[BaseModel] = Reply(
        model="claude-opus-5-5",
        stop_reason="end_turn",
        parsed=None,
        text="",
        sources=(Source(url="https://example.com/a", title="A page", page_age="2 days"),),
        queries=("acme lease",),
        usage=Usage(web_searches=1),
        cost_usd=Decimal("0.10"),
    )
    run_id, job_id = uuid.uuid4(), uuid.uuid4()
    collector = Collector()
    log_reply(
        collector,  # type: ignore[arg-type]
        reply,
        app="lead_finder",
        step="discover",
        job_id=job_id,
        run_id=run_id,
        subject="Melbourne: lease",
    )
    log_reply(collector, reply, app="lead_finder", step="extract")  # type: ignore[arg-type]
    first, second = collector.rows
    assert (first.run_id, first.job_id) == (run_id, job_id)
    assert first.sources == [
        {"url": "https://example.com/a", "title": "A page", "page_age": "2 days"}
    ]
    assert (second.run_id, second.job_id) == (None, None)  # a plain research has no run


# --- With the database (integration) --------------------------------------------------------

NOW = datetime(2026, 10, 26, 9, 30, tzinfo=UTC)


@pytest.fixture
async def db_client(app: FastAPI, session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    async def real_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = real_session
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


@pytest.mark.integration
async def test_the_search_log_filters_by_run_and_by_the_start_of_the_step(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    from core.searches.models import SearchLog

    run_a, run_b = uuid.uuid4(), uuid.uuid4()

    def row(step: str, run_id: uuid.UUID | None, subject: str = "Acme") -> SearchLog:
        return SearchLog(
            app="lead_finder",
            run_id=run_id,
            subject=subject,
            step=step,
            model="claude-opus-5-5",
            sources=[{"url": "https://example.com/a", "title": "A page", "page_age": "2 days"}],
            web_searches=1,
            cost_usd=Decimal("0.10"),
            answer_ok=True,
        )

    session.add_all(
        [
            row("search:property", run_a),
            row("search:people", run_a),
            row("extract", run_a),
            row("discover", run_b, subject="Melbourne: lease"),
            row("search_x", None),
            row("research_100%", run_a),
        ]
    )
    await session.commit()

    everything = (await db_client.get(f"{API}/searches", params={"limit": 200})).json()
    assert everything["total"] == 6

    by_run = (await db_client.get(f"{API}/searches", params={"run_id": str(run_a)})).json()
    assert by_run["total"] == 4
    assert {item["run_id"] for item in by_run["items"]} == {str(run_a)}

    prefix = (
        await db_client.get(f"{API}/searches", params={"run_id": str(run_a), "step": "search"})
    ).json()
    assert sorted(item["step"] for item in prefix["items"]) == ["search:people", "search:property"]

    assert (await db_client.get(f"{API}/searches", params={"step": "search"})).json()["total"] == 3
    assert (await db_client.get(f"{API}/searches", params={"step": "search:pr"})).json()[
        "total"
    ] == 1
    # `%` and `_` in the prefix are plain characters, not wildcards.
    assert (await db_client.get(f"{API}/searches", params={"step": "%"})).json()["total"] == 0
    assert (await db_client.get(f"{API}/searches", params={"step": "search_"})).json()["total"] == 1
    assert (await db_client.get(f"{API}/searches", params={"step": "research_100%"})).json()[
        "total"
    ] == 1

    first = by_run["items"][0]
    assert first["sources"] == [
        {"url": "https://example.com/a", "title": "A page", "page_age": "2 days"}
    ]
    assert first["job_id"] is None
    assert Decimal(first["cost_usd"]) == Decimal("0.10")


def make_lead(name: str, **changes: Any) -> Any:
    from apps.lead_finder.tables import Lead

    card = {"why_it_fits": f"City: Melbourne. {name} is a good fit.\nResult: Pass."}
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "company": name,
        "company_key": name.lower(),
        "city": "Melbourne",
        "result": "pass",
        "score": 70,
        "status": "new",
        "hubspot_status": "new",
        "card": card,
        "cost_usd": Decimal("1.00"),
        "web_searches": 4,
        "rules_version": "abc123def456",
        "prompt_version": "research 1, extract 2",
        "trigger_ids": [],
        "created_at": NOW,
    }
    return Lead(**(values | changes))


@pytest.mark.integration
async def test_the_leads_list_filters_sorts_and_pages(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    run = uuid.uuid4()
    from core.runs.models import Run

    session.add(Run(id=run, app="lead_finder", mode="discovery"))
    await session.flush()
    session.add_all(
        [
            make_lead(
                "Alpha Pty",
                score=90,
                result="pass",
                office_m2=3000,
                trigger_id="lease_ending",
                trigger_ids=["lease_ending", "fast_growth"],
                trigger_date=date(2027, 3, 1),
                industry="Software",
                industry_group=None,
                run_id=run,
                origin="web",
            ),
            make_lead(
                "Beta Group",
                score=60,
                result="watch",
                city="Perth",
                office_m2=1500,
                hubspot_status="open_deal",
                status="watching",
                industry="Law Practice",
                industry_group="Law firms",
            ),
            make_lead(
                "Gamma 100%",
                score=75,
                result="director_review",
                city="Sydney",
                hubspot_status="possible_match",
                office_m2=None,
            ),
            make_lead("Delta_Test", score=99, result="pass", is_test=True),
            make_lead(
                "Epsilon", score=10, result="drop", city=None, status="rejected", office_m2=500
            ),
        ]
    )
    await session.commit()
    leads = f"{LF}/leads"

    async def names(**params: Any) -> list[str]:
        response = await db_client.get(leads, params=params)
        assert response.status_code == 200, response.text
        return [item["company"] for item in response.json()["items"]]

    # Best score first, and the test set is left out.
    assert await names() == ["Alpha Pty", "Gamma 100%", "Beta Group", "Epsilon"]
    assert await names(include_tests="true") == [
        "Delta_Test",
        "Alpha Pty",
        "Gamma 100%",
        "Beta Group",
        "Epsilon",
    ]
    assert await names(result="pass") == ["Alpha Pty"]
    assert await names(result=["pass", "watch"]) == ["Alpha Pty", "Beta Group"]
    assert await names(city="Perth") == ["Beta Group"]
    assert await names(trigger="fast_growth") == ["Alpha Pty"]
    assert await names(trigger=["nothing", "lease_ending"]) == ["Alpha Pty"]
    assert await names(industry="Law Practice") == ["Beta Group"]
    assert await names(industry_group="Law firms") == ["Beta Group"]
    assert await names(min_score=70) == ["Alpha Pty", "Gamma 100%"]
    assert await names(office_m2_min=2000) == ["Alpha Pty"]
    assert await names(office_m2_max=2000) == ["Beta Group", "Epsilon"]
    assert await names(hubspot_status="open_deal") == ["Beta Group"]
    assert await names(hubspot_status=["open_deal", "possible_match"]) == [
        "Gamma 100%",
        "Beta Group",
    ]
    assert await names(status="watching") == ["Beta Group"]
    assert await names(run_id=str(run)) == ["Alpha Pty"]
    assert await names(trigger_since="2027-01-01") == ["Alpha Pty"]
    assert await names(trigger_since="2027-06-01") == []
    # The name search: `%` and `_` are plain characters.
    assert await names(q="alpha") == ["Alpha Pty"]
    assert await names(q="100%") == ["Gamma 100%"]
    assert await names(q="%") == ["Gamma 100%"]
    assert await names(q="_") == []
    assert await names(q="elta_", include_tests="true") == ["Delta_Test"]
    # Dates are read as Australia/Melbourne: 09:30 UTC on 26 Oct is 20:30 that day there.
    assert len(await names(created_since="2026-10-26", created_until="2026-10-26")) == 4
    assert await names(created_since="2026-10-27") == []
    assert await names(created_until="2026-10-25") == []

    # Sorting: a whitelist, NULLS LAST, and result sorts by rank.
    assert await names(sort="company", order="asc") == [
        "Alpha Pty",
        "Beta Group",
        "Epsilon",
        "Gamma 100%",
    ]
    assert await names(sort="result", order="asc") == [
        "Alpha Pty",
        "Gamma 100%",
        "Beta Group",
        "Epsilon",
    ]
    assert await names(sort="office_m2", order="desc") == [
        "Alpha Pty",
        "Beta Group",
        "Epsilon",
        "Gamma 100%",  # no size: last, whichever way it sorts
    ]
    assert await names(sort="office_m2", order="asc") == [
        "Epsilon",
        "Beta Group",
        "Alpha Pty",
        "Gamma 100%",
    ]
    assert await names(sort="score", order="asc", limit=2, offset=1) == ["Beta Group", "Gamma 100%"]

    page = (await db_client.get(leads, params={"limit": 2, "offset": 2})).json()
    assert page["total"] == 4
    assert len(page["items"]) == 2


@pytest.mark.integration
async def test_the_leads_list_rows_have_the_final_fields(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    session.add(
        make_lead(
            "Alpha Pty",
            trigger_id="lease_ending",
            trigger_ids=["lease_ending"],
            suburb="Docklands",
            origin="web",
            useful=True,
            note="Call in March",
        )
    )
    await session.commit()
    body = (await db_client.get(f"{LF}/leads")).json()
    row = body["items"][0]
    assert row["trigger_label"] == "Lease ending in 1 to 3 years, or a relocation"
    assert row["reason"] == "City: Melbourne. Alpha Pty is a good fit. Result: Pass."  # one line
    assert row["suburb"] == "Docklands"
    assert row["origin"] == "web"
    assert row["is_test"] is False
    assert row["useful"] is True
    assert row["note"] == "Call in March"
    assert row["status"] == "new"
    assert row["cost_usd"] == "1.000000"
    assert row["trigger_ids"] == ["lease_ending"]
    assert row["updated_at"]


@pytest.mark.integration
async def test_latest_shows_one_row_for_each_company(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    session.add_all(
        [
            make_lead(
                "Alpha Pty", company_key="alpha", score=50, created_at=NOW - timedelta(days=9)
            ),
            make_lead("Alpha Pty", company_key="alpha", score=80, created_at=NOW),
            make_lead("Beta Group", company_key="beta", score=60),
            make_lead(
                "Alpha Test",
                company_key="alpha",
                score=95,
                is_test=True,
                created_at=NOW + timedelta(days=1),
            ),
        ]
    )
    await session.commit()
    leads = f"{LF}/leads"
    latest = (await db_client.get(leads)).json()
    assert [(i["company"], i["score"]) for i in latest["items"]] == [
        ("Alpha Pty", 80),
        ("Beta Group", 60),
    ]
    assert latest["total"] == 2
    every = (await db_client.get(leads, params={"latest": "false"})).json()
    assert every["total"] == 3
    # A test lead and a real lead with one company_key are two companies: neither hides the other.
    with_tests = (await db_client.get(leads, params={"include_tests": "true"})).json()
    assert [(i["company"], i["score"]) for i in with_tests["items"]] == [
        ("Alpha Test", 95),
        ("Alpha Pty", 80),
        ("Beta Group", 60),
    ]
    assert with_tests["total"] == 3


async def lead_names(client: httpx.AsyncClient, **params: Any) -> list[str]:
    """The company names of GET /leads, sorted by name so a tie on the score can't reorder them."""
    response = await client.get(f"{LF}/leads", params={"sort": "company", "order": "asc"} | params)
    assert response.status_code == 200, response.text
    return [item["company"] for item in response.json()["items"]]


@pytest.mark.integration
async def test_a_real_lead_and_a_test_lead_of_one_company_both_show_when_tests_are_included(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    session.add_all(
        [
            make_lead("Canva old", company_key="canva", created_at=NOW - timedelta(days=3)),
            make_lead("Canva real", company_key="canva", created_at=NOW),
            make_lead("Canva test", company_key="canva", is_test=True, created_at=NOW),
            make_lead(
                "Canva old test",
                company_key="canva",
                is_test=True,
                created_at=NOW - timedelta(days=9),
            ),
        ]
    )
    await session.commit()
    # Without tests: the newest real lead only.
    assert await lead_names(db_client) == ["Canva real"]
    # With tests: the newest real lead AND the newest test lead, not the older ones.
    both = ["Canva real", "Canva test"]
    assert await lead_names(db_client, include_tests="true") == both
    assert await lead_names(db_client, include_tests="true", latest="true") == both
    # latest=false shows every row.
    assert await lead_names(db_client, latest="false") == ["Canva old", "Canva real"]
    assert len(await lead_names(db_client, include_tests="true", latest="false")) == 4


@pytest.mark.integration
async def test_latest_is_worked_out_before_the_filters_and_is_off_for_a_run(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    """A company rejected and then researched again: its newest lead is not rejected."""
    from core.runs.models import Run

    first_run, second_run = uuid.uuid4(), uuid.uuid4()
    session.add_all(
        [
            Run(id=first_run, app="lead_finder", mode="company"),
            Run(id=second_run, app="lead_finder", mode="company"),
        ]
    )
    await session.flush()
    session.add_all(
        [
            make_lead(
                "Gamma old",
                company_key="gamma",
                status="rejected",
                run_id=first_run,
                created_at=NOW - timedelta(days=9),
            ),
            make_lead("Gamma new", company_key="gamma", status="new", run_id=second_run),
            make_lead("Delta rejected", company_key="delta", status="rejected"),
        ]
    )
    await session.commit()

    # By default each company shows its newest research, and the filters apply to that row.
    assert await lead_names(db_client) == ["Delta rejected", "Gamma new"]
    assert await lead_names(db_client, status="rejected") == ["Delta rejected"]
    assert await lead_names(db_client, status="new") == ["Gamma new"]
    # Gamma was researched again after it was rejected, so the old row only shows with
    # latest=false.
    every_rejected = ["Delta rejected", "Gamma old"]
    assert await lead_names(db_client, status="rejected", latest="false") == every_rejected
    assert len(await lead_names(db_client, latest="false")) == 3
    # Asking for a run turns `latest` off: that run's own leads are all there.
    assert await lead_names(db_client, run_id=str(first_run)) == ["Gamma old"]
    assert await lead_names(db_client, run_id=str(first_run), status="rejected") == ["Gamma old"]
    assert await lead_names(db_client, run_id=str(second_run)) == ["Gamma new"]
    # ...unless `latest` is asked for on purpose.
    assert await lead_names(db_client, run_id=str(first_run), latest="true") == []
    assert await lead_names(db_client, run_id=str(second_run), latest="true") == ["Gamma new"]


@pytest.mark.integration
async def test_one_lead_is_the_card_plus_what_a_person_did(
    session: AsyncSession, db_client: httpx.AsyncClient
) -> None:
    from tests.lead_finder.test_schemas import card_json

    card = card_json()
    lead_id = uuid.UUID(card["id"])
    older = make_lead(
        "Acme Software",
        company_key="acme software",
        score=40,
        result="watch",
        created_at=NOW - timedelta(days=40),
        status="rejected",
    )
    newer = make_lead(
        "Acme Software",
        id=lead_id,
        company_key="acme software",
        card=card,
        status="watching",
        reject_reason=None,
        note="Ring them",
        useful=False,
        origin="web",
    )
    test_copy = make_lead(
        "Acme Software",
        company_key="acme software",
        is_test=True,
        created_at=NOW - timedelta(days=2),
    )
    session.add_all([older, newer, test_copy])
    await session.commit()

    response = await db_client.get(f"{LF}/leads/{lead_id}")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["company"] == "Acme Software"
    assert detail["facts"]["name"] == "Acme Software"  # flat: the card's fields are at the top
    assert detail["status"] == "watching"
    assert detail["note"] == "Ring them"
    assert detail["useful"] is False
    assert detail["origin"] == "web"
    assert detail["is_test"] is False
    assert detail["notes"] == []
    assert detail["hubspot"]["candidates"] == []
    assert [p["id"] for p in detail["previous"]] == [str(older.id)]  # not the test lead
    assert detail["previous"][0]["status"] == "rejected"
    assert detail["updated_at"]

    missing = await db_client.get(f"{LF}/leads/{uuid.uuid4()}")
    assert missing.status_code == 404
    assert missing.json()["title"] == "Lead not found"


@pytest.mark.integration
async def test_purge_deletes_the_events_of_old_finished_runs_only(
    session: AsyncSession,
) -> None:
    from sqlalchemy import func, select

    from core.runs.models import Run, RunEvent

    def run(status: str, finished_days_ago: int) -> Run:
        finished = datetime.now(UTC) - timedelta(days=finished_days_ago)
        return Run(
            id=uuid.uuid4(),
            app="lead_finder",
            mode="discovery",
            status=status,
            finished_at=finished,
        )

    old_done, new_done, old_cancelled = run("done", 40), run("done", 3), run("cancelled", 31)
    old_failed, old_interrupted = run("failed", 90), run("interrupted", 90)
    runs = [old_done, new_done, old_cancelled, old_failed, old_interrupted]
    session.add_all(runs)
    await session.flush()
    session.add_all(
        RunEvent(run_id=r.id, seq=seq, type="progress", data={}) for r in runs for seq in (1, 2)
    )
    await session.commit()
    # Read the ids now. An async session can't load an attribute later: reading `run.id` after
    # `expire_all()` would raise MissingGreenlet. The query below returns plain columns, never
    # objects, so there is nothing stale to expire.
    kept = {new_done.id, old_failed.id, old_interrupted.id}

    message = await cli._purge(30)
    assert "Deleted 4 saved events" in message

    left = {
        run_id: count
        for run_id, count in (
            await session.execute(select(RunEvent.run_id, func.count()).group_by(RunEvent.run_id))
        ).all()
    }
    assert left == dict.fromkeys(kept, 2)
    assert await session.scalar(select(func.count()).select_from(Run)) == 5  # the runs stay


@pytest.mark.integration
async def test_research_still_works_through_the_endpoint_and_the_new_leads_routes(
    app: FastAPI, session: AsyncSession
) -> None:
    from tests.lead_finder.samples import FakeClaude

    async def real_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = real_session
    app.dependency_overrides[lead_finder_claude_dependency] = lambda: FakeClaude()
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        response = await asyncio.wait_for(
            client.post(f"{LF}/research", json={"company": "Acme Software"}), timeout=120
        )
        assert response.status_code == 200, response.text
        card = response.json()
        assert card["result"] == "pass"
        # What each source said, as a summary, with its link (one note per angle in the sample).
        assert len(card["notes"]) == 4
        assert {note["angle"] for note in card["notes"]} == {"property", "people", "money"}
        assert all(note["url"].startswith("https://") for note in card["notes"])
        assert card["hubspot"]["candidates"] == []

        listed = (await client.get(f"{LF}/leads", params={"result": "pass"})).json()
        assert listed["total"] == 1
        row = listed["items"][0]
        assert row["id"] == card["id"]
        assert row["status"] == "new"
        assert row["origin"] == "typed"
        assert row["company"] == card["company"]
        assert row["reason"]

        one = (await client.get(f"{LF}/leads/{card['id']}")).json()
        assert one["facts"]["office_m2"]["value"] == 2500
        assert one["status"] == "new"
        assert one["previous"] == []
