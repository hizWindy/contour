"""Leads in Admin's Data tab: what an admin may change (PLAN-V26 choice 18).

The card holds everything and the columns are copies, so a change to the company, the website or
the result changes both. The company key stays: it is the name that was asked for (`company_key`
in tables.py), and one lead for each company in a run rests on it.
"""

import copy
from datetime import datetime
from typing import Any, Final, get_args

from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.rules import Result
from apps.lead_finder.sanitize import clean_domain
from apps.lead_finder.tables import LIMITS
from core.data.edits import Choice, Editable, Field, Row, ValueRefused, Values

RESULT_WORDS: Final = {
    "pass": "Pass",
    "director_review": "Director review",
    "watch": "Watch",
    "drop": "Drop",
}
NOTE_MAX: Final = 2000  # as the lead card's own note (LeadPatch)

FIELDS: Final = (
    Field("company", "Company", max_chars=LIMITS["lead.company"], required=True),
    Field("city", "City", max_chars=LIMITS["lead.city"]),
    Field("website", "Website", column="domain", max_chars=LIMITS["lead.domain"]),
    Field(
        "result",
        "Result",
        kind="choice",
        required=True,
        choices=tuple(Choice(value, RESULT_WORDS[value]) for value in get_args(Result)),
    ),
    Field("note", "Note", kind="long", max_chars=NOTE_MAX),
)


async def columns(db: AsyncSession, row: Row, values: Values, now: datetime) -> dict[str, Any]:
    changed: dict[str, Any] = {}
    card: dict[str, Any] = copy.deepcopy(row["card"])
    for key in ("city", "note"):
        if key in values:
            changed[key] = values[key]
    if "company" in values and values["company"] != row["company"]:
        changed["company"] = card["company"] = values["company"]
    if "result" in values and values["result"] != row["result"]:
        changed["result"] = card["result"] = values["result"]
    if "website" in values and values["website"] != row["domain"]:
        typed = values["website"]
        domain = clean_domain(typed) if typed else None
        if typed and not domain:
            raise ValueRefused("website", "Type a website, like northwind.com.au.")
        changed["domain"] = domain
        website = (card.get("facts") or {}).get("website")
        if isinstance(website, dict):
            website["value"] = domain
    if card != row["card"]:
        changed["card"] = card
    return changed


LEADS: Final = Editable("lead_finder.leads", FIELDS, columns=columns)
EDITABLES: Final = (LEADS,)
