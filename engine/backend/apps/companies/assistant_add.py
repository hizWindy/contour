"""Adding a company to HubSpot from the card (PLAN-V23 T1-4, choice 5, the contract's part 4). The
routes are in api_assistant.py.

- **The preview** searches HubSpot itself for companies with a close name (assistant_live.py, one
  free request), reads them into our copy so the card can use one, and says whether adding can
  happen now. It writes nothing to HubSpot. With no HubSpot connection it lists none, and says
  adding is off.
- **The send** goes through core's writer, as the Lead Finder's send does (`preview_write`, then
  `apply_write`): its duplicate check looks for the name in HubSpot first, the write is a row in
  `core.hubspot_writes`, and the new company is read into our copy at once (saved from what we
  know when that read fails). Only the name and the city are sent: no owner and no note (TBC).
- **Never twice:** the write's subject is the person and the card's Idempotency-Key
  (`assistant_company:<person>:<key>`), so a repeated key gives back the first company (200),
  and HubSpot gets one. A send that timed out is never sent again blind: HubSpot is searched by
  name first (the writer's rule). One add runs at a time in this backend, so two people adding the
  same name at once can't both make it.
- **The same name is refused** (409 `company_exists`): our copy or HubSpot has a company with
  this name (case and spaces aside). The plan says "the same name and city"; a company of the
  same name in another city is refused too, because the writer's duplicate check goes by the name
  alone and would fill in that company instead of adding one (TBC).
- **Limits:** writing must be on (409 `hubspot_writing_off`), and at most 5 new companies a minute
  a person (429 `too_many_companies`, TBC), kept in memory: the count starts again when the
  backend restarts. A repeated key isn't counted.
- No database connection is held while HubSpot answers. Log lines hold ids and states only, never
  the name.
"""

import asyncio
import logging
from datetime import datetime
from typing import Final

from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant import CommandLimit, person_key
from apps.companies.assistant_find import company_hit, heard_key, hubspot_hits
from apps.companies.assistant_live import live_search
from apps.companies.assistant_schemas import (
    AssistantCompanyAdded,
    AssistantCompanyIn,
    AssistantCompanyPreview,
)
from apps.companies.assistant_tasks import hubspot_unavailable
from apps.companies.facts import scrub
from apps.companies.note_store import sending_state
from apps.companies.schemas import CompanyHit
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.config import Settings
from core.hubspot.client import MISSING_SCOPE_TITLE, HubSpotError, HubSpotWritesOff
from core.hubspot.connection import hubspot_set_up, open_hubspot
from core.hubspot.importer import CompanyRow
from core.hubspot.models import HubSpotCompany
from core.hubspot.profiles import PLACEHOLDER_NAME
from core.hubspot.service import upsert_companies
from core.hubspot.writer import (
    OPEN,
    CompanyTarget,
    WriteInProgress,
    WritePlan,
    WriteRequest,
    apply_write,
    latest_write,
    preview_write,
)

log = logging.getLogger(__name__)

APP: Final = "companies"
SUBJECT: Final = "assistant_company"  # the write's subject: assistant_company:<person>:<key>
ANYONE: Final = "anyone"  # the person, while sign-in is off
COMPANIES_PER_MINUTE: Final = 5  # added by one person (TBC)

# --- The words (PLAN-V15 "Words for errors", PLAN-V23 "Words for when things go wrong") ---------

ADDING_OFF: Final = "Adding companies to HubSpot is off for now. Pick a company that's there."


def like_it(other: str, name: str) -> str:
    """PLAN-V23 "Words for when things go wrong": HubSpot has a company like it."""
    return f"HubSpot already has {other}. Use it, or add {name} anyway."


def already_there(name: str, city: str | None) -> str:
    where = f" in {city}" if city else ""
    return f"HubSpot already has {name}{where}, so it isn't added again. Use it from the list."


def adding_off() -> Problem:
    return Problem(409, "Adding companies is off", ADDING_OFF, code="hubspot_writing_off")


def company_exists(name: str, city: str | None) -> Problem:
    return Problem(409, "It's already in HubSpot", already_there(name, city), code="company_exists")


def too_many_companies(wait_seconds: int) -> Problem:
    return Problem(
        429,
        "Too many companies",
        "That's a lot of companies in one minute. Wait a moment, then try again.",
        code="too_many_companies",
        headers={"Retry-After": str(wait_seconds)},
    )


def company_adding() -> Problem:
    return Problem(
        409,
        "This company is being added",
        "It is being sent to HubSpot right now. Wait a moment, then try again.",
        code="company_adding",
    )


def company_not_added() -> Problem:
    return Problem(
        502,
        "HubSpot didn't take the company",
        "HubSpot refused the new company, so it wasn't added. Check the name, then try again.",
        code="company_not_added",
    )


def company_uncertain() -> Problem:
    return Problem(
        502,
        "HubSpot didn't answer in time",
        "We can't tell yet if the company was added. Try again: it won't be added twice.",
        code="company_not_added",
    )


def name_empty() -> Problem:
    return Problem(
        422,
        "A company needs a name",
        "Type the company's name, then try again.",
        code="company_name_empty",
    )


def contact_details() -> Problem:
    return Problem(
        422,
        "Contact details left out",
        "Phone numbers and emails can't go in a company's name or city. Take them out, then "
        "try again.",
        code="contact_details",
    )


# --- One add at a time, at most 5 a minute a person ----------------------------------------------


class CompanyAdds:
    """What adding companies keeps while the backend runs: the limit a person, and one add at a
    time. It lives on `app.state.company_adds`; a test puts its own."""

    def __init__(self, per_minute: int = COMPANIES_PER_MINUTE) -> None:
        self.limit = CommandLimit(per_minute=per_minute)
        self.lock = asyncio.Lock()


# --- Checks --------------------------------------------------------------------------------------


def tidied(body: AssistantCompanyIn) -> tuple[str, str | None]:
    """The name and the city with their spaces tidied: one between words, none at the ends."""
    name = " ".join(body.name.split())
    city = " ".join((body.city or "").split()) or None
    if not name:
        raise name_empty()
    if scrub(name) != name or (city is not None and scrub(city) != city):
        raise contact_details()
    return name, city


async def named_in_copy(session: AsyncSession, name: str) -> CompanyHit | None:
    """A company in our copy with this name, case and spaces aside."""
    spaced = func.lower(func.regexp_replace(func.btrim(HubSpotCompany.name), r"\s+", " ", "g"))
    key = await session.scalar(
        select(HubSpotCompany.hubspot_id)
        .where(spaced == heard_key(name), spaced != PLACEHOLDER_NAME)
        .order_by(HubSpotCompany.hubspot_id)
        .limit(1)
    )
    return await company_hit(session, key, []) if key is not None else None


def write_subject(auth: AuthContext | None, key: str) -> str:
    """The write's subject: one per person and key, so a repeated key is the same write."""
    who = auth.user.id.hex if auth is not None else ANYONE
    return f"{SUBJECT}:{who}:{key}"


def city_in(plan: WritePlan) -> str | None:
    """The city HubSpot has for the company the writer found, when the add said one."""
    return next((change.current for change in plan.fields if change.property == "city"), None)


# --- The preview ---------------------------------------------------------------------------------


async def preview_company(
    session: AsyncSession, body: AssistantCompanyIn, *, app: FastAPI, settings: Settings
) -> AssistantCompanyPreview:
    """The companies like it in HubSpot (read into our copy), the one with the same name if any,
    and whether it can be added now. Nothing is written to HubSpot. HubSpot not answering: 503."""
    name, city = tidied(body)
    can_write = sending_state(app, settings).ready
    exists = await named_in_copy(session, name)
    similar: list[CompanyHit] = []
    if hubspot_set_up(app):
        found = await live_search(session, app, name, fuzzy_min=settings.match_fuzzy_min)
        if found.failed:
            raise hubspot_unavailable("nothing was checked")
        similar = await hubspot_hits(session, found.keys)
    if exists is None:
        exists = next((hit for hit in similar if heard_key(hit.name) == heard_key(name)), None)
    if session.in_transaction():
        await session.rollback()  # reads, and the companies found were saved already
    if not can_write:
        sentence: str | None = ADDING_OFF
    elif exists is not None:
        sentence = already_there(exists.name, exists.city)
    elif similar:
        sentence = like_it(similar[0].name, name)
    else:
        sentence = None
    return AssistantCompanyPreview(
        name=name,
        city=city,
        similar=similar,
        exists=exists,
        can_write=can_write,
        waiting_for=None if can_write else ADDING_OFF,
        sentence=sentence,
    )


# --- The send ------------------------------------------------------------------------------------


async def add_company(
    session: AsyncSession,
    body: AssistantCompanyIn,
    *,
    app: FastAPI,
    auth: AuthContext | None,
    settings: Settings,
    adds: CompanyAdds,
    key: str,
    now: datetime,
) -> tuple[AssistantCompanyAdded, bool]:
    """Adds the company to HubSpot and our copy, once for this key: the company, and whether
    this call made it (a repeated key gives back the first one, and sends nothing)."""
    name, city = tidied(body)
    if not sending_state(app, settings).ready:
        raise adding_off()
    subject = write_subject(auth, key)
    known = await latest_write(session, APP, subject)
    if known is not None and known.status == "done" and known.hubspot_company_id is not None:
        first = await added(session, known.hubspot_company_id, known.hubspot_url, name, city)
        return first, False
    new = known is None or known.status in OPEN  # a repeated key isn't a new company
    if new:
        wait = adds.limit.take(person_key(auth), now)
        if wait is not None:
            raise too_many_companies(wait)
    async with adds.lock:
        if new:
            there = await named_in_copy(session, name)
            if there is not None:
                raise company_exists(there.name, there.city)
        await session.commit()  # no connection waits on HubSpot
        request = WriteRequest(
            app=APP,
            subject=subject,
            company=CompanyTarget(name=name),
            fields={"city": city} if city else {},
            labels={"city": "City"} if city else {},
        )
        try:
            async with open_hubspot(app) as hubspot:
                if hubspot is None:
                    raise HubSpotWritesOff
                previewed = await preview_write(session, hubspot, request, release=True)
                if previewed.status in OPEN and previewed.plan.action == "update":
                    # The writer's duplicate check: HubSpot has this name already.
                    raise company_exists(previewed.plan.company_name, city_in(previewed.plan))
                made = previewed.status == "previewed"
                written = await apply_write(session, hubspot, previewed.id)
        except HubSpotWritesOff:
            raise adding_off() from None
        except WriteInProgress:
            raise company_adding() from None
        except HubSpotError as error:
            log.warning("assistant_company_add_failed", extra={"error": type(error).__name__})
            raise hubspot_unavailable("the company wasn't added") from None
    log.info(
        "assistant_company_added",
        extra={"write_id": str(written.id), "status": written.status, "new": made},
    )
    if written.status == "done" and written.hubspot_company_id is not None:
        company = await added(session, written.hubspot_company_id, written.hubspot_url, name, city)
        return company, made
    if written.status == "uncertain":
        raise company_uncertain()
    step = next((step for step in written.steps if step.step == "company"), None)
    if step is not None and (step.detail or "").startswith(MISSING_SCOPE_TITLE):
        raise adding_off()  # the key can't make companies: the same as switched off
    raise company_not_added()


async def added(
    session: AsyncSession, company_id: str, url: str | None, name: str, city: str | None
) -> AssistantCompanyAdded:
    """The new company as our copy has it. When the writer couldn't read it back into our copy,
    it is saved from what we know, so the card can use it at once; the next sync fills in the
    rest."""
    hit = await company_hit(session, company_id, [])
    if hit is None:
        row = CompanyRow(hubspot_id=company_id, name=name, city=city, hubspot_url=url)
        await upsert_companies(session, [row], source="api")
        await session.commit()
        hit = CompanyHit(key=company_id, name=name, city=city, industry=None, source="hubspot")
    elif session.in_transaction():
        await session.rollback()
    return AssistantCompanyAdded(company_key=hit.key, company=hit, hubspot_url=url)
