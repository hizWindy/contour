"""The review page (PLAN-V9 C3): Results for one run, with tick boxes and three actions.

- `GET /review/{run_id}`: what the bar above the list shows: the run's city, its good leads, Watch
  and Drop, the cost and the cost per good lead, and whether HubSpot writing is on.
- `POST /review/status`: Watch or Reject the ticked leads. Rejecting needs a reason (PLAN-V9 D1).
  Each lead goes through the same patch as the lead card, so memory and Undo work the same way.
- `POST /review/send`: Approve and send to HubSpot. Each ticked lead is previewed and written with
  the existing writer, which has the once-only key and the write log. A lead that fails is
  reported on its own line; the others still go. While writing is off it answers 409
  `hubspot_write_off` before it touches anything, and the page greys the button out.

Nothing here costs money: HubSpot reads and writes are free, and no Claude request is made.
"""

import uuid
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from apps.lead_finder import lead_store
from apps.lead_finder.api_hubspot import card_url
from apps.lead_finder.hubspot_send import APP, mark_sent, send_request
from apps.lead_finder.rules import load_rules
from apps.lead_finder.run_email import cost_per_good_lead, good_leads
from apps.lead_finder.schemas import LeadPatch, RejectReason
from apps.lead_finder.tables import Lead
from core.api.deps import EmbedderDep, SessionDep
from core.api.errors import Problem
from core.api.hubspot import KEY_MISSING
from core.api.models import SafeText
from core.config import get_settings
from core.hubspot.client import HubSpotError
from core.hubspot.connection import open_hubspot
from core.hubspot.writer import WriteInProgress, WriteNotFound, apply_write, preview_write
from core.runs.models import Run
from core.runs.schemas import RunStatus

router = APIRouter(prefix="/review", tags=["review"])

MAX_LEADS = 100  # ticked leads in one action
MAX_SEND = 50  # leads sent to HubSpot in one click
WRITE_OFF = "HubSpot writing is off"
WRITE_OFF_DETAIL = (
    "Sending waits for HubSpot write access (PLAN-V5 F1 to F3). Watch and Reject still work."
)


class ReviewOut(BaseModel):
    """What the review bar shows for one run."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    run_id: uuid.UUID
    cities: list[str]
    status: RunStatus
    scheduled: bool = Field(description="A schedule started the run")
    good_leads: int = Field(description="Pass and Director review")
    watch: int
    drop: int
    cost_usd: Decimal
    cost_per_good_lead_usd: Decimal | None = Field(
        description="The run's cost shared over its good leads. Empty when there are none."
    )
    hubspot_write_enabled: bool
    hubspot_write_off: str | None = Field(
        description="Why the send button is greyed out, or empty when sending works"
    )


def _unique(ids: list[uuid.UUID]) -> list[uuid.UUID]:
    return list(dict.fromkeys(ids))


class ReviewStatusBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lead_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_LEADS)
    status: Literal["watching", "rejected"]
    reject_reason: RejectReason | None = Field(
        None, description="Required with rejected: too_small, wrong_industry, ... or other"
    )
    reject_note: SafeText | None = Field(None, max_length=1000)

    _lead_ids = field_validator("lead_ids")(_unique)


class ReviewSendBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lead_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_SEND)

    _lead_ids = field_validator("lead_ids")(_unique)


class ReviewItem(BaseModel):
    lead_id: uuid.UUID
    company: str | None = Field(description="Empty when there is no such lead")
    ok: bool
    problem: str | None = Field(description="Why this lead failed, in plain words")
    hubspot_url: str | None = None


class ReviewResult(BaseModel):
    done: int
    failed: int
    items: list[ReviewItem] = Field(description="One line for each ticked lead, in the order sent")


@router.get(
    "/{run_id}",
    response_model=ReviewOut,
    summary="The review bar for one run",
    description=(
        "The run's city, its good leads (Pass and Director review), Watch and Drop, the cost and "
        "the cost per good lead, and whether HubSpot writing is on. Free."
    ),
)
async def get_review(run_id: Annotated[uuid.UUID, Path()], session: SessionDep) -> ReviewOut:
    run = await session.get(Run, run_id)
    if run is None or run.app != APP:
        raise Problem(404, "Run not found", "It may have been removed. Go back to the runs.")
    by_result: dict[str, int] = dict((run.counts or {}).get("by_result") or {})
    good = good_leads(by_result)
    settings = get_settings()
    on = settings.hubspot_write_enabled
    return ReviewOut(
        run_id=run.id,
        cities=[str(city) for city in (run.params or {}).get("cities") or []],
        status=run.status,
        scheduled=run.schedule_id is not None,
        good_leads=good,
        watch=by_result.get("watch", 0),
        drop=by_result.get("drop", 0),
        cost_usd=run.cost_usd,
        cost_per_good_lead_usd=cost_per_good_lead(run.cost_usd, good),
        hubspot_write_enabled=on,
        hubspot_write_off=None if on else WRITE_OFF,
    )


@router.post(
    "/status",
    response_model=ReviewResult,
    summary="Watch or reject the ticked leads",
    description=(
        "Each lead is changed as the lead card changes it. Rejecting needs reject_reason, and the "
        "reason other needs reject_note. A lead that can't change (it was sent, or it is gone) "
        "gets its own line with the reason; the others still change."
    ),
)
async def review_status(
    body: ReviewStatusBody, session: SessionDep, embedder: EmbedderDep
) -> ReviewResult:
    patch = LeadPatch.model_validate(
        {"status": body.status}
        if body.status == "watching"
        else {
            "status": "rejected",
            "reject_reason": body.reject_reason,
            "reject_note": body.reject_note,
        }
    )
    items: list[ReviewItem] = []
    for lead_id in body.lead_ids:
        try:
            detail = await lead_store.patch_lead(session, embedder, lead_id, patch)
        except Problem as problem:
            if problem.status == 422:  # the same for every lead: say it once, as the request's
                raise
            company = await session.scalar(select(Lead.company).where(Lead.id == lead_id))
            items.append(
                ReviewItem(
                    lead_id=lead_id,
                    company=company,
                    ok=False,
                    problem=problem.detail or problem.title,
                )
            )
            continue
        items.append(ReviewItem(lead_id=lead_id, company=detail.company, ok=True, problem=None))
    done = sum(item.ok for item in items)
    return ReviewResult(done=done, failed=len(items) - done, items=items)


@router.post(
    "/send",
    response_model=ReviewResult,
    summary="Approve the ticked leads and send them to HubSpot",
    description=(
        "Each lead is previewed and written with the HubSpot writer, once only (a lead already "
        "sent is reported as done). A lead that fails gets its own line; the others still go. "
        "While HUBSPOT_WRITE_ENABLED is false it answers 409 hubspot_write_off and writes nothing."
    ),
)
async def review_send(request: Request, body: ReviewSendBody, session: SessionDep) -> ReviewResult:
    if not get_settings().hubspot_write_enabled:
        raise Problem(409, WRITE_OFF, WRITE_OFF_DETAIL, code="hubspot_write_off")
    rules = load_rules()
    items: list[ReviewItem] = []
    async with open_hubspot(request.app) as client:
        if client is None:
            raise KEY_MISSING
        for lead_id in body.lead_ids:
            lead = await session.get(Lead, lead_id)
            if lead is None:
                items.append(
                    ReviewItem(lead_id=lead_id, company=None, ok=False, problem="Lead not found.")
                )
                continue
            company = lead.company
            try:
                change = send_request(lead, rules, card_url=card_url(lead_id))
                preview = await preview_write(session, client, change)
                out = await apply_write(session, client, preview.id, on_written=mark_sent)
            except (WriteNotFound, WriteInProgress, HubSpotError) as error:
                await session.rollback()
                said = getattr(error, "detail", None) or str(error) or type(error).__name__
                items.append(ReviewItem(lead_id=lead_id, company=company, ok=False, problem=said))
                continue
            ok = out.status == "done"
            items.append(
                ReviewItem(
                    lead_id=lead_id,
                    company=company,
                    ok=ok,
                    problem=None if ok else (out.error or f"The send is {out.status}."),
                    hubspot_url=out.hubspot_url,
                )
            )
    done = sum(item.ok for item in items)
    return ReviewResult(done=done, failed=len(items) - done, items=items)
