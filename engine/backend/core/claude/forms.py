"""How complex an answer form is, counted the way Anthropic limits strict forms.

A strict form (structured outputs) is compiled into a grammar before Claude answers. Anthropic's
documented limits for one request: at most 16 fields that can be "null or a value" (union types,
`anyOf` or a list of types), and at most 24 optional fields. Over them, or over an internal size
limit, the request is refused with a 400 ("The compiled grammar is too large"), and nothing is
answered. A field in a shared definition (`$defs`) counts once, however often it is used: the
Lead Finder's form passed with 16 such fields on 27 Oct 2026 and failed with 18 (PLAN-V4).

The size of the whole schema counts too, and Anthropic doesn't publish that limit. On 16 Nov 2026
the company form grew from 7,687 to 10,357 characters (5 more facts, PLAN-V16). It still had only
3 null-or-value fields and no optional ones, far under both limits above, yet Claude refused every
request for it with the same 400. A run paid for the research of 9 companies and threw each one
away. 7,687 characters is the biggest form we know works live, so that is the limit here
(`CHARACTERS_LIMIT`). A bigger form is split in two requests, like the company form
(`fields.CompanyCoreForm` and `CompanyExtrasForm`), or tried live first with
`lead-finder forms --live --yes` (a few cents).

Tests check every form against these numbers, with room to spare, so a new field can't break the
research again without a failing test first.
"""

import json
from dataclasses import dataclass
from typing import Any

from anthropic import transform_schema
from pydantic import BaseModel

UNION_FIELDS_LIMIT = 16  # Anthropic's limit for one request
OPTIONAL_FIELDS_LIMIT = 24  # Anthropic's limit for one request
MARGIN = 4  # what the tests keep free under each limit
# The biggest form we know Claude accepts (live until 15 Nov 2026). 10,357 was refused on 16 Nov.
# Raise it only after `lead-finder forms --live --yes` accepted a bigger form, and say so here.
CHARACTERS_LIMIT = 8_000


@dataclass(frozen=True)
class FormSize:
    union_fields: int  # fields that can be "null or a value"
    optional_fields: int  # fields an object doesn't require
    characters: int  # the schema as sent, in characters

    @property
    def within_limits(self) -> bool:
        """True when the form is under both limits with the margin to spare, and no bigger than
        the biggest form we know works."""
        return (
            self.union_fields <= UNION_FIELDS_LIMIT - MARGIN
            and self.optional_fields <= OPTIONAL_FIELDS_LIMIT - MARGIN
            and self.characters <= CHARACTERS_LIMIT
        )


def form_schema(form: type[BaseModel]) -> dict[str, Any]:
    """The schema Claude gets for this form: the same call the client makes."""
    return transform_schema(form.model_json_schema())


def form_size(form: type[BaseModel]) -> FormSize:
    """How complex the form is that Claude gets for `form`."""
    schema = form_schema(form)
    counts = {"union": 0, "optional": 0}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            properties = node.get("properties")
            if isinstance(properties, dict):
                required = set(node.get("required", []))
                counts["optional"] += sum(1 for name in properties if name not in required)
                counts["union"] += sum(
                    1
                    for field in properties.values()
                    if isinstance(field, dict)
                    and ("anyOf" in field or isinstance(field.get("type"), list))
                )
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    return FormSize(
        union_fields=counts["union"],
        optional_fields=counts["optional"],
        characters=len(json.dumps(schema)),
    )
