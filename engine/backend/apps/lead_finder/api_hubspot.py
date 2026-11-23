"""Send a lead to HubSpot (PLAN-V5 D4): preview it, then send it after a person confirms.

The core does the work (core/hubspot/writer.py): this file only finds the lead, builds its change
(hubspot_send.py) and marks the lead as sent when the write is done. A send needs the write
scopes and HUBSPOT_WRITE_ENABLED=true; until then the preview works and sending answers 409
`hubspot_write_off` ("Waiting for write access").

Many leads at once (PLAN-V27 Part 3): `preview-many` and `send-many`, up to 25 leads, each through
the same writer, one at a time, with its own result (`hubspot_batch.py`).
"""

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from apps.lead_finder.hubspot_batch import (
    BatchPreview,
    BatchPreviewBody,
    BatchSendBody,
    BatchSendOut,
    SendOwner,
    preview_batch,
    send_batch,
)
from apps.lead_finder.hubspot_send import APP, mark_sent, send_request, subject_of
from apps.lead_finder.rules import load_rules
from apps.lead_finder.tables import Lead
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.hubspot import KEY_MISSING, write_problem
from core.config import get_settings
from core.hubspot.client import HubSpotError
from core.hubspot.connection import open_hubspot
from core.hubspot.models import HubSpotWrite
from core.hubspot.writer import (
    WriteInProgress,
    WriteNotFound,
    WriteOut,
    apply_write,
    get_write,
    preview_write,
    write_out,
)

router = APIRouter(prefix="/leads", tags=["leads"])


class SendBody(BaseModel):
    write_id: uuid.UUID = Field(description="The id the preview gave. It is the write's key")


async def _lead(session: SessionDep, lead_id: uuid.UUID) -> Lead:
    lead = await session.get(Lead, lead_id)
    if lead is None:
        raise Problem(404, "Lead not found", "It may have been removed. Go back to the results.")
    return lead


def card_url(lead_id: uuid.UUID) -> str | None:
    """The lead card's address on the website (this computer only until hosting, TBC)."""
    origins = get_settings().cors_origins
    return f"{origins[0]}/leads/{lead_id}" if origins else None


@router.post(
    "/hubspot/preview-many",
    response_model=BatchPreview,
    dependencies=[Depends(need("lead_finder.send_to_hubspot", write=True))],
    summary="Preview adding many leads to HubSpot",
    description=(
        "Up to 25 leads (PLAN-V27 T3-1). Each is previewed as a single send is, one at a time, "
        "in the order given: a new company or the empty fields of one HubSpot has, the note and "
        "the list. A lead sent before gets its send back with `already_sent`. A lead that can't "
        "be previewed has its `problem`, and the others go on. The owner is the person asking, "
        "when they have a HubSpot user; otherwise none (TBC with Levi). Writes nothing, and works "
        "while writing is switched off."
    ),
)
async def preview_many(
    request: Request, body: BatchPreviewBody, session: SessionDep, auth: SignedInDep
) -> BatchPreview:
    try:
        async with open_hubspot(request.app) as client:
            if client is None:
                raise KEY_MISSING
            return await preview_batch(
                session,
                client,
                body.lead_ids,
                load_rules(),
                owner=_owner(auth),
                card_url_of=card_url,
            )
    except HubSpotError as error:
        raise write_problem(error) from error


@router.post(
    "/hubspot/send-many",
    response_model=BatchSendOut,
    dependencies=[Depends(need("lead_finder.send_to_hubspot", write=True))],
    summary="Send many previewed leads to HubSpot",
    description=(
        "Up to 25 (lead, write) pairs from `preview-many` (PLAN-V27 T3-1). Each is sent as a "
        "single send is, one at a time, once only: `sent`, `already_sent` (a second call sends "
        "nothing twice), or `failed` with plain words, and one failure never stops the rest. A "
        "sent lead's status is `sent`. Needs HUBSPOT_WRITE_ENABLED=true; until then the whole "
        "batch answers 409 hubspot_write_off and nothing is written."
    ),
)
async def send_many(request: Request, body: BatchSendBody, session: SessionDep) -> BatchSendOut:
    try:
        async with open_hubspot(request.app) as client:
            if client is None:
                raise KEY_MISSING
            return await send_batch(session, client, body.items)
    except HubSpotError as error:
        raise write_problem(error) from error


def _owner(auth: object) -> SendOwner:
    """The person asking, and their HubSpot owner id when they have one (choice 15)."""
    user = getattr(auth, "user", None)
    if user is None:
        return SendOwner(name="A person on this computer", hubspot_owner_id=None)
    owner_id = None if getattr(user, "no_hubspot_user", False) else user.hubspot_owner_id
    return SendOwner(name=user.name or user.email, hubspot_owner_id=owner_id)


@router.get(
    "/{lead_id}/hubspot",
    response_model=WriteOut | None,
    dependencies=[Depends(need("lead_finder.send_to_hubspot"))],
    summary="This lead's HubSpot send, if there is one",
    description="The newest write for this lead: previewed, sent, or part sent. Null if none.",
)
async def get_lead_hubspot(lead_id: uuid.UUID, session: SessionDep) -> WriteOut | None:
    await _lead(session, lead_id)
    row = await session.scalar(
        select(HubSpotWrite)
        .where(HubSpotWrite.app == APP, HubSpotWrite.subject == subject_of(lead_id))
        .order_by(HubSpotWrite.created_at.desc())
        .limit(1)
    )
    return write_out(row) if row is not None else None


@router.post(
    "/{lead_id}/hubspot/preview",
    response_model=WriteOut,
    dependencies=[Depends(need("lead_finder.send_to_hubspot", write=True))],
    summary="Preview sending this lead to HubSpot",
    description=(
        "Reads HubSpot (free) and says what would be written: a new company or an update of its "
        "empty fields, the note and the list. Writes nothing. A lead that was sent gets its send "
        "back. Works while writing is switched off."
    ),
)
async def preview_lead_hubspot(
    request: Request, lead_id: uuid.UUID, session: SessionDep
) -> WriteOut:
    lead = await _lead(session, lead_id)
    change = send_request(lead, load_rules(), card_url=card_url(lead_id))
    try:
        async with open_hubspot(request.app) as client:
            if client is None:
                raise KEY_MISSING
            return await preview_write(session, client, change)
    except HubSpotError as error:
        raise write_problem(error) from error


@router.post(
    "/{lead_id}/hubspot/send",
    response_model=WriteOut,
    dependencies=[Depends(need("lead_finder.send_to_hubspot", write=True))],
    summary="Send this lead to HubSpot, as previewed",
    description=(
        "Writes the preview with this write_id, once only: a second click returns the first "
        "result. When it is done the lead's status is sent. Needs the write scopes and "
        "HUBSPOT_WRITE_ENABLED=true; until then it answers 409 hubspot_write_off."
    ),
)
async def send_lead_hubspot(
    request: Request, lead_id: uuid.UUID, body: SendBody, session: SessionDep
) -> WriteOut:
    await _lead(session, lead_id)
    try:
        row = await get_write(session, body.write_id)
        if row.app != APP or row.subject != subject_of(lead_id):
            raise Problem(
                422, "This preview is for another lead", "Preview this lead again, then send."
            )
        async with open_hubspot(request.app) as client:
            if client is None:
                raise KEY_MISSING
            return await apply_write(session, client, body.write_id, on_written=mark_sent)
    except (WriteNotFound, WriteInProgress, HubSpotError) as error:
        raise write_problem(error) from error
