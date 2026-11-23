"""Calls not yet sent, in Admin's Data tab: what an admin may change (PLAN-V26 choice 18).

Only while the call waits: it needs a company, is to confirm, or failed with nothing in HubSpot.
Never one that is being sorted or sent, or that is in HubSpot or may be.

The call's own rules hold:
- a new company brings its name, and drops the person and the field changes, which were the old
  company's;
- a call that needed a company waits to be confirmed, sorted by hand, so no edit spends on Claude;
- the person is one of the company's people, so the HubSpot link is never someone else's;
- an email or phone number typed in the note is left out, as saving a note does.
"""

from datetime import datetime
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.facts import scrub
from apps.companies.note_batch import parts_of
from apps.companies.notes import CardCall, NoteCard
from apps.companies.schemas import NOTE_MAX_CHARS
from apps.companies.store import people_of
from core.data.edits import Choice, Editable, Field, Row, ValueRefused, Values
from core.hubspot.activities import OUTCOME_NAMES
from core.hubspot.models import HubSpotCompany

WAITING: Final = ("needs_company", "to_confirm", "failed")
NOT_WAITING: Final = {
    "sorting": "It is being sorted. Try again in a minute.",
    "sending": "It is being sent to HubSpot, so it can't change here.",
    "logged": "It is in HubSpot. Change it there.",
    "partial": "Part of it is in HubSpot. Change it there.",
    "uncertain": "It may be in HubSpot. Check there first.",
}

FIELDS: Final = (
    Field("company", "Company", kind="company", column="company_key", max_chars=64),
    Field("person", "Person", kind="choice", column="contact_id", max_chars=32),
    Field("outcome", "Outcome", kind="choice", column="card", max_chars=64),
    Field("note", "Note", kind="long", column="text", max_chars=NOTE_MAX_CHARS),
)


def blocked(row: Row) -> str | None:
    status = row["status"]
    if status not in WAITING:
        return NOT_WAITING.get(status, "Only a call not yet sent can change here.")
    if status == "failed":
        card = NoteCard.model_validate(row["card"] or {})
        if any(part.state in ("landed", "uncertain") for part in parts_of(card)):
            return NOT_WAITING["partial"]
    return None


def read(row: Row, field: Field) -> str | None:
    if field.key == "company":
        return row.get("company_name") or row.get("company_heard")
    if field.key == "person":
        return row.get("contact_id")
    if field.key == "outcome":
        call = (row.get("card") or {}).get("call") or {}
        outcome: str | None = call.get("outcome")
        return outcome
    text: str | None = row.get("text")
    return text


def show(row: Row, field: Field) -> str | None:
    if field.key == "person":
        name: str | None = row.get("person_name")
        return name
    return read(row, field)


async def choices(db: AsyncSession, row: Row, field: Field) -> tuple[Choice, ...]:
    if field.key == "outcome":
        return tuple(Choice(name, name) for name in OUTCOME_NAMES)
    key = row["company_key"]
    if field.key != "person" or not key or key.startswith("lead:"):
        return ()
    return tuple(Choice(person.id, person.name or "No name") for person in await people_of(db, key))


async def columns(db: AsyncSession, row: Row, values: Values, now: datetime) -> dict[str, Any]:
    changed: dict[str, Any] = {}
    card = NoteCard.model_validate(row["card"] or {})
    card_changed = False
    key, moved = row["company_key"], False

    if "company" in values and values["company"] != key:
        picked = values["company"]
        if not picked:
            raise ValueRefused("company", "Pick a company.")
        company = await db.get(HubSpotCompany, picked)
        if company is None:
            raise ValueRefused("company", "Pick a company that is in our HubSpot copy.")
        key, moved = company.hubspot_id, True
        changed |= {
            "company_key": key,
            "company_name": company.name,
            "contact_id": None,
            "person_name": None,
            "person_title": None,
        }
        if row["status"] == "needs_company":
            # Sorted by hand, free. The rep's own picks stay, as note_company.py keeps them.
            card = NoteCard(call=CardCall(outcome=card.call.outcome, call_type=card.call.call_type))
            changed |= {"status": "to_confirm", "sorted_by": "person", "sorted_at": now.isoformat()}
        else:
            card.changes, card.previewed = [], None
        card_changed = True

    if "person" in values and not (moved and values["person"] is None):
        wanted = values["person"]
        if wanted != row["contact_id"] or moved:
            found = None
            if wanted:
                people = await people_of(db, key) if key and not key.startswith("lead:") else []
                found = next((p for p in people if p.id == wanted), None)
                if found is None:
                    raise ValueRefused("person", "Pick one of this company's people.")
            changed |= {
                "contact_id": found.id if found else None,
                "person_name": found.name if found else None,
                "person_title": found.title if found else None,
            }

    if "outcome" in values and values["outcome"] != card.call.outcome:
        card.call.outcome = values["outcome"]
        card_changed = True

    if "note" in values:
        words = scrub(values["note"] or "")
        if not words and not card.call.outcome:
            raise ValueRefused("note", "Write a note, or pick an outcome.")
        changed["text"] = words

    if card_changed:
        card.edited = row["status"] != "needs_company"
        changed["card"] = card.model_dump(mode="json")
    return changed


CALL_NOTES: Final = Editable(
    "companies.call_notes",
    FIELDS,
    deletable=True,
    blocked=blocked,
    read=read,
    show=show,
    columns=columns,
    choices=choices,
)
EDITABLES: Final = (CALL_NOTES,)
