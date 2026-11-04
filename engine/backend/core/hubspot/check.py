"""The connection check (PLAN-V5 B2): which permissions (scopes) the HubSpot key has.

HubSpot has no call that lists a service key's scopes, so the check tries one small thing for
each and reads the answer. Free, and it changes nothing:
- a read scope: read one record of that kind. A "missing scopes" answer means no.
- a write scope: change record 0, which can't exist. "Missing scopes" means no; "not found"
  means the key got past the permission check, so yes.
Anything else (HubSpot down, an odd answer) is "unknown", with the reason.

The answer never holds the key, only whether one is set.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from core.hubspot.client import HubSpot, HubSpotError, HubSpotMissingScope, HubSpotUnavailable

log = logging.getLogger(__name__)

ScopeState = Literal["yes", "no", "unknown"]
Access = Literal["read", "write"]


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


async def _write(hubspot: HubSpot, what: Literal["companies", "lists"]) -> bool | None:
    return await hubspot.probe_write_scope(what)


PROBES: tuple[Probe, ...] = (
    Probe("crm.objects.companies.read", "read", "Read companies", _companies),
    Probe("crm.objects.deals.read", "read", "Read deals and their stages", _deals),
    Probe("crm.objects.owners.read", "read", "Read owners' names", _owners),
    Probe("crm.lists.read", "read", "Read lists", _lists),
    Probe("crm.schemas.companies.read", "read", "Read company fields", _company_fields),
    Probe(
        "crm.objects.companies.write",
        "write",
        "Add and update companies, and add notes to them",
        lambda hubspot: _write(hubspot, "companies"),
    ),
    Probe("crm.lists.write", "write", "Add companies to a list", lambda h: _write(h, "lists")),
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


async def check_connection(hubspot: HubSpot | None) -> ConnectionCheck:
    """Tries each scope once. `hubspot` is None when no key is set."""
    now = datetime.now(UTC)
    if hubspot is None:
        return ConnectionCheck(
            key_set=False,
            connected=False,
            problem="HUBSPOT_SERVICE_KEY is not set in engine/.env.",
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

    scopes: list[ScopeOut] = []
    for probe in PROBES:
        state: ScopeState
        detail: str | None = None
        try:
            answer = await probe.run(hubspot)
        except HubSpotMissingScope:
            state, detail = "no", "HubSpot said this permission is missing."
        except HubSpotUnavailable as error:
            state, detail = "unknown", f"{error.title}. {error.detail}"
        except HubSpotError as error:
            state, detail = "unknown", f"{error.title}. {error.detail}"
        else:
            if probe.access == "read" or answer is True:
                state = "yes"
            elif answer is False:
                state, detail = "no", "HubSpot said this permission is missing."
            else:
                state, detail = "unknown", "HubSpot's answer didn't say either way."
        scopes.append(
            ScopeOut(
                scope=probe.scope,
                access=probe.access,
                label=probe.label,
                state=state,
                detail=detail,
            )
        )
    return ConnectionCheck(
        key_set=True, connected=True, portal_id=account.portal_id, scopes=scopes, checked_at=now
    )
