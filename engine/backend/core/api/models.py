"""Bases and small shared types for the models the API takes and sends.

A field with a default value is still always in the answer. By default the OpenAPI file lists
such a field as optional, and the website's generated types would then say `field?: string`.
`OutModel` lists them as required in answers, so the website can rely on them. Requests are not
affected: a field with a default can still be left out of a request body.

`SafeText` is for free text that comes from outside (a filter, a note). PostgreSQL can't store
a NUL character (`\\x00`) in text, so one that reached the database would be a 500. This type
refuses it at the edge, with a 422 that names the field.

`INT32_MAX` and `OFFSET_MAX` are the upper bounds for numbers that are compared with, or used
to skip rows of, a database column. Above them PostgreSQL says "out of range" (a 500).
"""

from collections.abc import Callable
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.config import JsonDict

NO_NUL_PATTERN = r"^[^\x00]*$"
SafeText = Annotated[str, StringConstraints(pattern=NO_NUL_PATTERN)]

INT32_MAX = 2_147_483_647  # the largest value of a PostgreSQL integer column
OFFSET_MAX = 1_000_000  # nobody pages past a million rows, and huge offsets are slow


class OutModel(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


def optional_in_types(*names: str) -> Callable[[JsonDict], None]:
    """Leaves these fields out of `required` in the website's types, so test data written before
    they existed still type-checks. The API always sends them (PLAN-V14; in core since PLAN-V23,
    for the signed-in answer and the People tab)."""

    def drop(schema: JsonDict) -> None:
        required = schema.get("required")
        if isinstance(required, list):
            schema["required"] = [name for name in required if name not in names]

    return drop


def no_default_in_types(schema: JsonDict) -> None:
    """Leaves one field's default out of the OpenAPI file, for its `json_schema_extra`. The
    website's types take a field with a default as always there: in an answer (with
    `optional_in_types`), test data written before it still type-checks; in a request, the
    website may leave it out. The field's description says the default (PLAN-V23; in core since
    PLAN-V24, for a request's `teach`)."""
    schema.pop("default", None)
