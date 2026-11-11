"""Checking the `params` of a run. One place, so start and estimate say the same thing.

`POST /runs` (the manager's `start`) and `POST /runs/estimate` both take `params` as plain JSON
and check it against the params model of the run kind. Both must turn a failure into the same
list of errors, so the website can show them beside the right field. This module is that one
conversion:

- `find_kind` looks up the kind for (app, mode), or raises Problem 404.
- `parse_params` checks the params and returns the model, or raises Problem 422 with `errors`.
  `start` uses it.
- `try_parse_params` is the same check, but gives the errors back instead of raising. The
  estimate uses it, because an invalid body is a normal answer there (`valid: false`).
- `field_errors_of` turns a 422 Problem a kind's own `check` raised into the same error list.

Every error is `{field, message}`. `field` is `body.params.<path>`, the same style as the 422 that
FastAPI gives for a bad body (`body.params.cities.0` for the first city). A problem with the
params as a whole is `body.params`. The message is plain text and never repeats the value that was
sent.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ValidationError

from core.api.errors import FieldError, Problem
from core.runs.types import KindKey, RunKind

PARAMS_FIELD = "body.params"
MAX_ERRORS = 50  # a body full of bad values must not make a huge answer
MAX_MESSAGE_CHARS = 300
_VALUE_ERROR_PREFIX = "Value error, "  # pydantic adds this in front of a validator's own text


def find_kind(kinds: Mapping[KindKey, RunKind[Any]], app: str, mode: str) -> RunKind[Any]:
    """The kind of run for (app, mode). Raises Problem 404 when the project or mode is unknown."""
    kind = kinds.get((app, mode))
    if kind is None:
        raise Problem(
            404,
            "Unknown kind of run",
            "This project has no run mode with that name.",
            code="unknown_run_kind",
        )
    return kind


def params_errors(error: ValidationError) -> list[FieldError]:
    """The errors of a failed check, as `body.params.<path>` and a plain message."""
    found: list[FieldError] = []
    for item in error.errors(include_url=False, include_context=False, include_input=False):
        path = ".".join(str(part) for part in item["loc"])
        message = str(item["msg"])
        if message.startswith(_VALUE_ERROR_PREFIX):
            message = message[len(_VALUE_ERROR_PREFIX) :]
        found.append(
            FieldError(
                field=f"{PARAMS_FIELD}.{path}" if path else PARAMS_FIELD,
                message=message[:MAX_MESSAGE_CHARS],
            )
        )
        if len(found) == MAX_ERRORS:
            break
    return found


def invalid_params(errors: Sequence[FieldError]) -> Problem:
    """The 422 for a list of field errors (what `parse_params` raises)."""
    return Problem(
        422,
        "Some fields need a fix",
        "Look at the fields listed.",
        errors=[error.model_dump() for error in errors],
    )


def try_parse_params[P: BaseModel](
    model: type[P], params: Mapping[str, Any]
) -> tuple[P | None, list[FieldError]]:
    """Checks `params` against `model`. Returns (the model, no errors) or (None, the errors)."""
    try:
        return model.model_validate(dict(params)), []
    except ValidationError as error:
        return None, params_errors(error)


def parse_params[P: BaseModel](model: type[P], params: Mapping[str, Any]) -> P:
    """Checks `params` against `model` and returns the model. Raises Problem 422 with `errors`
    (`body.params.<field>`) when it is not valid."""
    try:
        return model.model_validate(dict(params))
    except ValidationError as error:
        raise invalid_params(params_errors(error)) from error


def field_errors_of(problem: Problem) -> list[FieldError]:
    """The field errors of a 422 a kind's `check` raised. With none listed, one error on the
    params as a whole carries the problem's own text."""
    found: list[FieldError] = []
    raw = problem.extra.get("errors")
    if isinstance(raw, Sequence) and not isinstance(raw, str):
        for item in raw[:MAX_ERRORS]:
            try:
                found.append(FieldError.model_validate(item))
            except ValidationError:
                continue
    if not found:
        found.append(
            FieldError(
                field=PARAMS_FIELD, message=(problem.detail or problem.title)[:MAX_MESSAGE_CHARS]
            )
        )
    return found
