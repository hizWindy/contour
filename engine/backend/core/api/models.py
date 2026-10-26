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

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

NO_NUL_PATTERN = r"^[^\x00]*$"
SafeText = Annotated[str, StringConstraints(pattern=NO_NUL_PATTERN)]

INT32_MAX = 2_147_483_647  # the largest value of a PostgreSQL integer column
OFFSET_MAX = 1_000_000  # nobody pages past a million rows, and huge offsets are slow


class OutModel(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
