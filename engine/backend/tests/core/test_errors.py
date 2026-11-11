"""The error shape: codes, extra fields and the models Swagger and the website read."""

import uuid
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI

from core.api.errors import (
    PROBLEM_RESPONSES,
    FieldError,
    Problem,
    ProblemDetails,
    ValidationProblem,
    add_error_handlers,
    problem,
)


@pytest.fixture
def app() -> FastAPI:
    app = FastAPI()
    add_error_handlers(app)
    run_id = uuid.UUID("12345678-1234-5678-1234-567812345678")

    @app.get("/plain")
    async def plain() -> None:
        raise Problem(404, "No such thing", "Try another id.")

    @app.get("/busy")
    async def busy() -> None:
        raise Problem(
            409,
            "A run is already going",
            "Wait for it to finish.",
            code="run_already_active",
            run_id=run_id,
        )

    @app.get("/extras")
    async def extras() -> None:
        raise Problem(413, "Too many rows", code="too_many_rows", limit=2000, cost=Decimal("1.50"))

    @app.get("/typed", responses=PROBLEM_RESPONSES)
    async def typed(count: int) -> dict[str, int]:
        return {"count": count}

    return app


async def get(app: FastAPI, path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        return await client.get(path)


async def test_a_problem_without_a_code_keeps_the_old_shape(app: FastAPI) -> None:
    response = await get(app, "/plain")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json() == {
        "type": "about:blank",
        "title": "No such thing",
        "status": 404,
        "detail": "Try another id.",
    }


async def test_a_problem_carries_its_code_and_run_id(app: FastAPI) -> None:
    body = (await get(app, "/busy")).json()
    assert body["code"] == "run_already_active"
    assert body["run_id"] == "12345678-1234-5678-1234-567812345678"
    assert body["status"] == 409


async def test_any_extra_field_rides_along_and_decimals_become_text(app: FastAPI) -> None:
    body = (await get(app, "/extras")).json()
    assert body == {
        "type": "about:blank",
        "title": "Too many rows",
        "status": 413,
        "code": "too_many_rows",
        "limit": 2000,
        "cost": "1.50",
    }


def test_the_problem_function_leaves_out_empty_extras() -> None:
    response = problem(400, "Bad", code=None, run_id=None, errors=[])
    assert response.body == b'{"type":"about:blank","title":"Bad","status":400,"errors":[]}'


async def test_a_bad_request_is_still_a_422_with_field_errors(app: FastAPI) -> None:
    response = await get(app, "/typed?count=x")
    assert response.status_code == 422
    body = response.json()
    assert body["errors"][0]["field"] == "query.count"
    assert set(body["errors"][0]) == {"field", "message"}


async def test_an_unexpected_error_hides_the_details() -> None:
    app = FastAPI()
    add_error_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("password=hunter2")

    response = await get(app, "/boom")
    assert response.status_code == 500
    assert "hunter2" not in response.text


def test_the_models_describe_the_body() -> None:
    body = ProblemDetails(
        title="A run is already going", status=409, code="run_already_active", run_id="x"
    )
    assert body.type == "about:blank"
    assert body.detail is None
    problem_422 = ValidationProblem(
        title="Some fields need a fix",
        status=422,
        errors=[FieldError(field="body.params.cities", message="Field required")],
    )
    assert problem_422.errors[0].field == "body.params.cities"
    with pytest.raises(ValueError):
        ValidationProblem(title="x", status=422)  # type: ignore[call-arg]  # errors is required


def test_one_dict_registers_every_error_on_a_route(app: FastAPI) -> None:
    schema = app.openapi()
    names = set(schema["components"]["schemas"])
    assert {"ProblemDetails", "ValidationProblem", "FieldError"} <= names
    responses = schema["paths"]["/typed"]["get"]["responses"]
    assert set(responses) >= {"200", "400", "403", "404", "409", "413", "422", "500", "501", "503"}

    def ref(status: str) -> str:
        return str(responses[status]["content"]["application/json"]["schema"]["$ref"])

    assert ref("404").endswith("/ProblemDetails")
    assert ref("409").endswith("/ProblemDetails")
    assert ref("422").endswith("/ValidationProblem")  # not FastAPI's own HTTPValidationError
    assert "HTTPValidationError" not in names


def test_every_registered_status_but_422_uses_the_plain_model() -> None:
    for status, entry in PROBLEM_RESPONSES.items():
        assert entry["model"] is (ValidationProblem if status == 422 else ProblemDetails)
