"""Add many leads to HubSpot at once (PLAN-V27 Part 3, choices 12 to 16).

A person ticks leads on Results, sees one preview for the batch, and presses Send. Each lead goes
through the same writer as a single send (`hubspot_send.py`, `core/hubspot/writer.py`), one at a
time, with its own result:

- **At most 25 a batch** (choice 13, TBC). The routes refuse 26.
- **One failure never stops the rest.** A lead that HubSpot refuses, or that is gone, gets its
  plain words; the next one goes on.
- **Nothing is sent twice.** Each lead's write has the writer's once-only key: a second call
  returns the first result ("already sent").
- **The owner** (choice 15, TBC with Levi) is the person who presses Send, when they have a
  HubSpot user (`User.hubspot_owner_id`, PLAN-V23). Otherwise there is none. It fills HubSpot's
  owner only when the company has none (the writer's empty-fields rule).
- **Who may:** the same people who may send one lead (`lead_finder.send_to_hubspot`).

Free of AI: HubSpot calls only. Writing needs HUBSPOT_WRITE_ENABLED, as a single send does.
"""

import uuid
from collections.abc import Callable, Sequence
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.hubspot_send import APP, mark_sent, send_request, subject_of
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.tables import Lead
from core.api.hubspot import write_problem
from core.hubspot.client import HubSpot, HubSpotError, HubSpotWritesOff
from core.hubspot.writer import (
    WriteInProgress,
    WriteNotFound,
    WriteOut,
    apply_write,
    get_write,
    preview_write,
)

BATCH_MAX = 25  # choice 13, TBC
OWNER_FIELD = "hubspot_owner_id"
OWNER_LABEL = "Owner"
GONE = "This lead was removed. Go back to the results."
WRONG_WRITE = "This preview is for another lead. Preview the batch again."

ItemResult = Literal["sent", "failed", "already_sent"]
# The lead card's address, as the single send gives it (`api_hubspot.card_url`)
type CardUrl = Callable[[uuid.UUID], str | None]


class SendOwner(BaseModel):
    name: str = Field(description="The person who presses Send")
    hubspot_owner_id: str | None = Field(
        description="Their HubSpot owner id. null: the companies get no owner (choice 15, TBC)"
    )


class BatchPreviewItem(BaseModel):
    lead_id: uuid.UUID
    company: str | None = Field(description="The lead's company. null when the lead is gone")
    write: WriteOut | None = Field(description="Its preview, or its earlier send. null on failure")
    already_sent: bool = Field(description="It was sent before: Send leaves it as it is")
    problem: str | None = Field(description="Why it couldn't be previewed, in plain words")


class BatchPreview(BaseModel):
    items: list[BatchPreviewItem]
    owner: SendOwner
    can_write: bool = Field(description="Whether writing is switched on (HUBSPOT_WRITE_ENABLED)")
    waiting_for: str | None = Field(None, description="Why writing can't happen yet, if it can't")


class BatchSendItem(BaseModel):
    lead_id: uuid.UUID
    company: str | None
    result: ItemResult
    write: WriteOut | None
    problem: str | None = Field(description="Why it failed, in plain words")


class BatchSendOut(BaseModel):
    items: list[BatchSendItem]
    sent: int
    failed: int
    already_sent: int


class BatchPreviewBody(BaseModel):
    lead_ids: list[uuid.UUID] = Field(
        min_length=1, max_length=BATCH_MAX, description="1 to 25 leads, each once"
    )


class BatchSendPair(BaseModel):
    lead_id: uuid.UUID
    write_id: uuid.UUID = Field(description="The write id the batch preview gave this lead")


class BatchSendBody(BaseModel):
    items: list[BatchSendPair] = Field(min_length=1, max_length=BATCH_MAX)


def _unique[T](items: Sequence[T]) -> list[T]:
    return list(dict.fromkeys(items))


async def _leads(session: AsyncSession, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Lead]:
    rows = (await session.scalars(select(Lead).where(Lead.id.in_(list(ids))))).all()
    return {row.id: row for row in rows}


def _words(error: Exception) -> str:
    problem = write_problem(error)
    return problem.detail or problem.title


async def preview_batch(
    session: AsyncSession,
    hubspot: HubSpot,
    lead_ids: Sequence[uuid.UUID],
    rules: LeadFinderRules,
    *,
    owner: SendOwner,
    card_url_of: CardUrl,
) -> BatchPreview:
    """Each lead's preview, in the order asked, one at a time. A lead already sent gets its send
    back, marked `already_sent`. A failure is that lead's `problem`, never the batch's."""
    ids = _unique(lead_ids)
    found = await _leads(session, ids)
    items: list[BatchPreviewItem] = []
    can_write, waiting_for = False, None
    for lead_id in ids:
        lead = found.get(lead_id)
        if lead is None:
            items.append(
                BatchPreviewItem(
                    lead_id=lead_id, company=None, write=None, already_sent=False, problem=GONE
                )
            )
            continue
        company = lead.company
        change = send_request(lead, rules, card_url=card_url_of(lead_id))
        if owner.hubspot_owner_id:
            change = change.model_copy(
                update={
                    "fields": {**change.fields, OWNER_FIELD: owner.hubspot_owner_id},
                    "labels": {**change.labels, OWNER_FIELD: OWNER_LABEL},
                }
            )
        try:
            write = await preview_write(session, hubspot, change, release=True)
        except HubSpotError as error:
            await session.rollback()
            items.append(
                BatchPreviewItem(
                    lead_id=lead_id,
                    company=company,
                    write=None,
                    already_sent=False,
                    problem=_words(error),
                )
            )
            continue
        can_write, waiting_for = write.can_write, write.waiting_for
        items.append(
            BatchPreviewItem(
                lead_id=lead_id,
                company=company,
                write=write,
                already_sent=write.status == "done",
                problem=None,
            )
        )
    return BatchPreview(items=items, owner=owner, can_write=can_write, waiting_for=waiting_for)


async def send_batch(
    session: AsyncSession,
    hubspot: HubSpot,
    pairs: Sequence[BatchSendPair],
) -> BatchSendOut:
    """Sends each previewed lead, one at a time, in the order asked. Writing switched off refuses
    the whole batch before anything is written (409 `hubspot_write_off`, raised)."""
    if not getattr(hubspot, "writes_allowed", False):
        raise HubSpotWritesOff
    wanted = _unique([(pair.lead_id, pair.write_id) for pair in pairs])
    found = await _leads(session, [lead_id for lead_id, _ in wanted])
    companies = {lead_id: lead.company for lead_id, lead in found.items()}
    items: list[BatchSendItem] = []
    for lead_id, write_id in wanted:
        company = companies.get(lead_id)
        if lead_id not in found:
            items.append(_failed(lead_id, None, GONE))
            continue
        try:
            row = await get_write(session, write_id)
            if row.app != APP or row.subject != subject_of(lead_id):
                items.append(_failed(lead_id, company, WRONG_WRITE))
                continue
            before = row.status
            write = await apply_write(session, hubspot, write_id, on_written=mark_sent)
        except (WriteNotFound, WriteInProgress, HubSpotError) as error:
            await session.rollback()
            items.append(_failed(lead_id, company, _words(error)))
            continue
        if before == "done":
            result: ItemResult = "already_sent"
        elif write.status == "done":
            result = "sent"
        else:
            items.append(_failed(lead_id, company, write.error or "HubSpot didn't take it all."))
            items[-1] = items[-1].model_copy(update={"write": write})
            continue
        items.append(
            BatchSendItem(
                lead_id=lead_id, company=company, result=result, write=write, problem=None
            )
        )
    return BatchSendOut(
        items=items,
        sent=sum(1 for item in items if item.result == "sent"),
        failed=sum(1 for item in items if item.result == "failed"),
        already_sent=sum(1 for item in items if item.result == "already_sent"),
    )


def _failed(lead_id: uuid.UUID, company: str | None, problem: str) -> BatchSendItem:
    return BatchSendItem(
        lead_id=lead_id, company=company, result="failed", write=None, problem=problem
    )
