"""One error shape for every endpoint: application/problem+json (RFC 9457).

Every error has a title, a status and, where it helps, a plain detail saying what to do next.
`code` is a stable word the website can switch on (like `run_already_active`). Extra fields
(like `run_id`) ride along when a code needs them.
"""

import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pydantic_core import to_jsonable_python
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"
log = logging.getLogger(__name__)


class Problem(Exception):
    """Raise this from an endpoint or service to return a clear error.

    `code` is a short stable word for the website (for example `run_already_active`).
    Any extra keyword (for example `run_id=...`) is added to the body.
    """

    def __init__(
        self,
        status: int,
        title: str,
        detail: str | None = None,
        code: str | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(title)
        self.status = status
        self.title = title
        self.detail = detail
        self.code = code
        self.extra = extra


# --- The error models. They are only for the API documentation (OpenAPI) and the website's
# types: the handlers below build the body by hand, so they never fail while answering.


class FieldError(BaseModel):
    field: str = Field(description="Where the problem is, like body.params.cities")
    message: str = Field(description="What is wrong, in plain words")


class ProblemDetails(BaseModel):
    """Every error body (RFC 9457)."""

    type: str = Field("about:blank", description="Always about:blank for now")
    title: str = Field(description="A short summary, safe to show a person")
    status: int = Field(description="The HTTP status code")
    detail: str | None = Field(None, description="What happened and what to do next")
    code: str | None = Field(None, description="A stable word to switch on, like run_not_active")
    errors: list[FieldError] | None = Field(None, description="The fields that are wrong")
    run_id: str | None = Field(None, description="The run this is about, if any")


class ValidationProblem(ProblemDetails):
    """The 422 body: the request was well formed but its values are not valid."""

    errors: list[FieldError] = Field(description="The fields that are wrong")


# What a router passes as `responses=` so Swagger and the website's types list every error.
PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ProblemDetails, "description": "The request can't be understood"},
    403: {"model": ProblemDetails, "description": "Blocked, or this isn't allowed"},
    404: {"model": ProblemDetails, "description": "Not found"},
    409: {"model": ProblemDetails, "description": "Not possible in the current state"},
    413: {"model": ProblemDetails, "description": "Too much data"},
    422: {"model": ValidationProblem, "description": "A value in the request isn't valid"},
    429: {"model": ProblemDetails, "description": "Too many requests"},
    500: {"model": ProblemDetails, "description": "Something went wrong"},
    501: {"model": ProblemDetails, "description": "Not built yet"},
    503: {"model": ProblemDetails, "description": "A part of the engine isn't available"},
}


def problem(status: int, title: str, detail: str | None = None, **extra: Any) -> JSONResponse:
    """The error response. Extra fields are added, except None. Decimals become text."""
    body: dict[str, Any] = {"type": "about:blank", "title": title, "status": status}
    if detail:
        body["detail"] = detail
    body.update({key: value for key, value in extra.items() if value is not None})
    return JSONResponse(to_jsonable_python(body), status_code=status, media_type=PROBLEM_JSON)


async def _problem(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, Problem)
    return problem(exc.status, exc.title, exc.detail, code=exc.code, **exc.extra)


async def _http_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    title = HTTPStatus(exc.status_code).phrase
    detail = exc.detail if isinstance(exc.detail, str) and exc.detail != title else None
    return problem(exc.status_code, title, detail)


async def _invalid_request(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return problem(
        422, "The request isn't valid", "Check the fields listed in errors.", errors=errors
    )


async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unexpected error", extra={"path": request.url.path})
    return problem(500, "Something went wrong", "The details are in the backend log.")


def add_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(Problem, _problem)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _invalid_request)
    app.add_exception_handler(Exception, _unexpected)
