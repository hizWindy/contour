"""The connection check (PLAN-V5 B2): which permissions (scopes) the HubSpot key has.

HubSpot has no call that lists a service key's scopes, so the check tries one small thing for
each and reads the answer. The probes run at the same time (the client's pacer keeps to HubSpot's
rate, 8 requests a second), so the whole check, 17 requests, takes 2 to 3 seconds (an estimate),
not one after another (PLAN-V13 T1-2: Admin's Health tab gives each check 5 seconds). Free, and it
changes nothing:
- a read scope: read one record of that kind. A "missing scopes" answer means no, and the detail
  names the scopes HubSpot asked for.
- a write scope: change record 0, which can't exist. "Missing scopes" means no; "not found" (or
  "not valid", for an empty change) means the key got past the permission check, so yes.
Anything else (HubSpot down, an odd answer) is "unknown", with the reason.

The answer never holds the key, only whether one is set.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from core.hubspot.client import (
    HubSpot,
    HubSpotError,
    HubSpotMissingScope,
    HubSpotUnavailable,
    ObjectType,
    WriteScopeProbe,
)

log = logging.getLogger(__name__)

ScopeState = Literal["yes", "no", "unknown"]
Access = Literal["read", "write"]
MISSING_DETAIL = "HubSpot said this permission is missing."

# Logging calls, tasks and notes (PLAN-V17). HubSpot's docs name no write scope for them, and
# HubSpot names a scope only when one is missing. On 15 Nov 2026 (T1-2) the key could write all
# three, so HubSpot named none: this name is TBC. Older integrations wrote them with the contacts
# write scope, so that is the likely one. The probe tries the three kinds themselves, so its
# answer is right whatever the name turns out to be.
ACTIVITY_WRITE_SCOPE = "crm.objects.contacts.write"
ACTIVITY_WRITE_KINDS: tuple[WriteScopeProbe, ...] = ("calls", "notes", "tasks")


@dataclass(frozen=True)
class Probe:
    scope: str
    access: Access
    label: str  # what the scope lets us do, in plain words
    run: Callable[[HubSpot], Awaitable[object]]


async def _companies(hubspot: HubSpot) -> object:
    return await hubspot.list_objects("companies", properties=["name"], limit=1)


async def _deals(hubspot: HubSpot) -> object:
    await hubspot.list_objects("deals", properties=["dealname"], limit=1)
    return await hubspot.pipelines("deals")  # the stage names come with the deals scope


async def _owners(hubspot: HubSpot) -> object:
    return await hubspot.owners()


async def _lists(hubspot: HubSpot) -> object:
    return await hubspot.find_lists("AI suggested")


async def _company_fields(hubspot: HubSpot) -> object:
    return await hubspot.get_property("companies", "name")


async def _people(hubspot: HubSpot) -> object:
    """People at companies (PLAN-V10 C1). Their logged calls have a probe of their own: the key
    reads calls without this scope (PLAN-V17 T1-2)."""
    return await hubspot.list_objects("contacts", properties=["firstname"], limit=1)


async def _read_one(hubspot: HubSpot, kind: ObjectType) -> object:
    """One call, note, task or meeting, with one field."""
    return await hubspot.list_objects(kind, properties=["hs_timestamp"], limit=1)


async def _write(hubspot: HubSpot, what: WriteScopeProbe) -> bool | None:
    return await hubspot.probe_write_scope(what)


async def _write_activities(hubspot: HubSpot) -> bool | None:
    """Yes only when the key may write calls, notes and tasks; no when HubSpot refuses any one;
    otherwise HubSpot's answers don't say."""
    answers = await asyncio.gather(*(_write(hubspot, kind) for kind in ACTIVITY_WRITE_KINDS))
    if all(answer is True for answer in answers):
        return True
    if any(answer is False for answer in answers):
        return False
    return None


PROBES: tuple[Probe, ...] = (
    Probe("crm.objects.companies.read", "read", "Read companies", _companies),
    Probe("crm.objects.deals.read", "read", "Read deals and their stages", _deals),
    Probe("crm.objects.owners.read", "read", "Read owners' names", _owners),
    Probe("crm.lists.read", "read", "Read lists", _lists),
    Probe("crm.schemas.companies.read", "read", "Read company fields", _company_fields),
    Probe("crm.objects.contacts.read", "read", "Read people at companies", _people),
    Probe("crm.objects.calls.read", "read", "Read logged calls", lambda h: _read_one(h, "calls")),
    Probe("crm.objects.notes.read", "read", "Read notes", lambda h: _read_one(h, "notes")),
    Probe("crm.objects.tasks.read", "read", "Read tasks", lambda h: _read_one(h, "tasks")),
    Probe("crm.objects.meetings.read", "read", "Read meetings", lambda h: _read_one(h, "meetings")),
    Probe(
        "crm.objects.companies.write",
        "write",
        "Add and update companies, and add notes to them",
        lambda hubspot: _write(hubspot, "companies"),
    ),
    Probe("crm.lists.write", "write", "Add companies to a list", lambda h: _write(h, "lists")),
    Probe(
        ACTIVITY_WRITE_SCOPE,
        "write",
        "Log calls, tasks and notes (HubSpot's scope name TBC)",
        _write_activities,
    ),
)
KNOWN_SCOPES = frozenset(probe.scope for probe in PROBES)


class ScopeOut(BaseModel):
    scope: str = Field(description="HubSpot's name for the permission")
    access: Access
    label: str = Field(description="What it lets the platform do, in plain words")
    state: ScopeState = Field(description="yes, no, or unknown when the check couldn't tell")
    detail: str | None = Field(None, description="Why it is no or unknown, in plain words")


class ConnectionCheck(BaseModel):
    key_set: bool = Field(description="Whether HUBSPOT_SERVICE_KEY is set. The key is never sent")
    connected: bool = Field(description="Whether HubSpot accepted the key and answered")
    portal_id: int | None = Field(None, description="Contour's HubSpot account number")
    problem: str | None = Field(None, description="Why the check couldn't connect, if it couldn't")
    scopes: list[ScopeOut]
    checked_at: datetime

    def state_of(self, scope: str) -> ScopeState:
        for item in self.scopes:
            if item.scope == scope:
                return item.state
        return "unknown"


def _unknown(detail: str) -> list[ScopeOut]:
    return [
        ScopeOut(scope=p.scope, access=p.access, label=p.label, state="unknown", detail=detail)
        for p in PROBES
    ]


async def _probe(hubspot: HubSpot, probe: Probe) -> ScopeOut:
    """One scope: yes, no, or unknown with the reason."""
    state: ScopeState
    detail: str | None = None
    try:
        answer = await probe.run(hubspot)
    except HubSpotMissingScope as error:
        state, detail = "no", _missing(error)
    except HubSpotUnavailable as error:
        state, detail = "unknown", f"{error.title}. {error.detail}"
    except HubSpotError as error:
        state, detail = "unknown", f"{error.title}. {error.detail}"
    else:
        if probe.access == "read" or answer is True:
            state = "yes"
        elif answer is False:
            state, detail = "no", MISSING_DETAIL
        else:
            state, detail = "unknown", "HubSpot's answer didn't say either way."
    return ScopeOut(
        scope=probe.scope, access=probe.access, label=probe.label, state=state, detail=detail
    )


def _missing(error: HubSpotMissingScope) -> str:
    """What HubSpot asked for, so the admin can find the scope's real name on the key's page."""
    if not error.scopes:
        return MISSING_DETAIL
    return f"HubSpot asks for one of: {', '.join(error.scopes)}."


async def check_connection(hubspot: HubSpot | None) -> ConnectionCheck:
    """Tries each scope once. `hubspot` is None when no key is set."""
    now = datetime.now(UTC)
    if hubspot is None:
        return ConnectionCheck(
            key_set=False,
            connected=False,
            problem="The HubSpot key isn't set on the server.",
            scopes=_unknown("No key is set."),
            checked_at=now,
        )
    try:
        account = await hubspot.account()
    except HubSpotError as error:
        log.warning("hubspot_check_failed", extra={"reason": error.title})
        return ConnectionCheck(
            key_set=True,
            connected=False,
            problem=f"{error.title}. {error.detail}",
            scopes=_unknown("HubSpot couldn't be reached with this key."),
            checked_at=now,
        )

    scopes = list(await asyncio.gather(*(_probe(hubspot, probe) for probe in PROBES)))
    return ConnectionCheck(
        key_set=True, connected=True, portal_id=account.portal_id, scopes=scopes, checked_at=now
    )
