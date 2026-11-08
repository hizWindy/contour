"""People and calls from HubSpot (PLAN-V10 C1): the daily sync copies contacts and the calls of the
last 2 years (TBC) into core.hubspot_contacts and core.hubspot_calls, for the Companies page.

It needs HubSpot's contacts scope (`crm.objects.contacts.read`; HubSpot reads logged calls with
it too, TBC). Until the admin adds it, `read_people` raises `HubSpotMissingScope`, the sync goes
on without them, and the Admin page says what it is waiting for.

Each sync reads them all and replaces our copy, so a contact or call deleted in HubSpot goes too.
Email addresses stay in our copy for the team. They are never sent to Claude (apps/companies).
"""

import html
import re
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.client import HubSpot, HubSpotObject, ObjectType
from core.hubspot.models import HubSpotCall, HubSpotContact

CALL_YEARS = 2  # TBC
WAITING = "Waiting for HubSpot access to contacts and calls (crm.objects.contacts.read)."
CONTACT_PROPERTIES = (
    "firstname",
    "lastname",
    "jobtitle",
    "phone",
    "mobilephone",
    "email",
    "associatedcompanyid",
    "notes_last_updated",
    "lastmodifieddate",
)
CALL_PROPERTIES = (
    "hs_timestamp",
    "hs_call_duration",
    "hs_call_disposition",
    "hs_call_title",
    "hs_call_body",
    "hubspot_owner_id",
)
# HubSpot's own call outcomes. A portal can add its own, which stay unnamed (TBC).
OUTCOMES = {
    "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
    "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
    "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
    "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
    "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
    "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
}
TAG = re.compile(r"<[^>]+>")
BREAK = re.compile(r"<\s*(br|/p|/div|/li)\s*/?>", re.IGNORECASE)


@dataclass
class People:
    contacts: list[HubSpotContact] = field(default_factory=list)
    calls: list[HubSpotCall] = field(default_factory=list)


def _when(value: str | None) -> datetime | None:
    """HubSpot gives a moment as ISO text or as milliseconds."""
    if not value:
        return None
    text = value.strip()
    try:
        if text.isdigit():
            return datetime.fromtimestamp(int(text) / 1000, tz=UTC)
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (ValueError, OverflowError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _text(record: HubSpotObject, name: str, limit: int) -> str | None:
    value = record.text(name)
    return value[:limit] if value else None


def plain(body: str | None) -> str | None:
    """A call note as plain text: HubSpot keeps it as HTML."""
    if not body:
        return None
    text = html.unescape(TAG.sub("", BREAK.sub("\n", body)))
    lines = [" ".join(line.split()) for line in text.splitlines()]
    joined = "\n".join(line for line in lines if line)
    return joined or None


def contact_row(record: HubSpotObject) -> HubSpotContact:
    first = _text(record, "firstname", 120)
    last = _text(record, "lastname", 120)
    name = " ".join(part for part in (first, last) if part) or "Name not on record"
    return HubSpotContact(
        hubspot_id=record.id,
        hubspot_company_id=_text(record, "associatedcompanyid", 32),
        first_name=first,
        last_name=last,
        name=name[:240],
        job_title=_text(record, "jobtitle", 200),
        phone=_text(record, "phone", 64),
        mobile=_text(record, "mobilephone", 64),
        email=_text(record, "email", 254),
        last_activity=_when(record.text("notes_last_updated")),
        hubspot_url=record.url,
        hubspot_updated_at=record.updated_at or _when(record.text("lastmodifieddate")),
    )


def _first(record: HubSpotObject, kind: str) -> str | None:
    links = record.associations.get(kind, ())
    primary = next((link.id for link in links if link.primary), None)
    return primary or (links[0].id if links else None)


def call_row(record: HubSpotObject, owners: Mapping[str, str | None]) -> HubSpotCall:
    duration = record.text("hs_call_duration")
    owner_id = _text(record, "hubspot_owner_id", 32)
    disposition = record.text("hs_call_disposition")
    try:
        seconds = round(int(float(duration)) / 1000) if duration else None
    except ValueError:
        seconds = None
    return HubSpotCall(
        hubspot_id=record.id,
        hubspot_company_id=_first(record, "companies"),
        hubspot_contact_id=_first(record, "contacts"),
        called_at=_when(record.text("hs_timestamp")),
        duration_seconds=seconds,
        outcome=OUTCOMES.get(disposition or ""),
        title=_text(record, "hs_call_title", 300),
        note=plain(record.text("hs_call_body")),
        owner=(owners.get(owner_id) or None) if owner_id else None,
        owner_id=owner_id,
        hubspot_url=record.url,
    )


async def _every(
    hubspot: HubSpot, object_type: ObjectType, properties: Sequence[str], links: Sequence[str]
) -> AsyncIterator[HubSpotObject]:
    after: str | None = None
    while True:
        page = await hubspot.list_objects(
            object_type, properties=properties, after=after, associations=links
        )
        for record in page.results:
            if not record.archived:
                yield record
        if not page.after:
            return
        after = page.after


async def read_people(
    hubspot: HubSpot, owners: Mapping[str, str | None], now: datetime | None = None
) -> People:
    """Every contact, and the calls of the last `CALL_YEARS` years with their company and person.
    Raises `HubSpotMissingScope` while the key can't read them."""
    now = now or datetime.now(UTC)
    since = now - timedelta(days=365 * CALL_YEARS)
    people = People()
    async for record in _every(hubspot, "contacts", CONTACT_PROPERTIES, ()):
        people.contacts.append(contact_row(record))
    async for record in _every(hubspot, "calls", CALL_PROPERTIES, ("companies", "contacts")):
        call = call_row(record, owners)
        if call.called_at is None or call.called_at >= since:
            people.calls.append(call)
    return people


async def save_people(session: AsyncSession, people: People) -> tuple[int, int]:
    """Replaces our copy of contacts and calls. The caller commits. Returns (contacts, calls)."""
    contacts = {contact.hubspot_id: contact for contact in people.contacts}
    calls = {call.hubspot_id: call for call in people.calls}
    await session.execute(delete(HubSpotCall))
    await session.execute(delete(HubSpotContact))
    session.add_all(contacts.values())
    session.add_all(calls.values())
    await session.flush()
    return len(contacts), len(calls)
