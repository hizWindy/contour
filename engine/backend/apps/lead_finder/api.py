"""Lead Finder endpoints, under /api/v1/lead-finder."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from apps.lead_finder.research import LeadCard, ResearchRequest, research_company
from apps.lead_finder.rules import LeadFinderRules, Result, load_rules
from apps.lead_finder.tables import Lead
from core.api.deps import EmbedderDep, SessionDep
from core.api.errors import Problem
from core.claude.client import Claude, ClaudeError, ClaudeUnavailable, get_claude
from core.config import get_settings

router = APIRouter()


def claude_dependency() -> Claude:
    try:
        return get_claude()
    except ClaudeUnavailable as error:
        raise Problem(503, error.title, error.detail) from error


ClaudeDep = Annotated[Claude, Depends(claude_dependency)]


@router.get(
    "/rules",
    response_model=LeadFinderRules,
    summary="The rules in use, and their version",
    description=(
        "The company criteria, search templates and HubSpot field map, as checked at start-up. "
        "Anything not confirmed is listed in criteria.tbc."
    ),
)
async def get_rules() -> LeadFinderRules:
    return load_rules()


@router.post(
    "/research",
    response_model=LeadCard,
    summary="Research one company now",
    description=(
        "Checks memory first, then searches the web from three angles (property, people, "
        "money), fills the answer form, checks every source, matches HubSpot and applies the "
        "rules. Costs money: about US$1 per company, capped by COMPANY_CAP_USD. "
        "Use public companies until Levi approves using HubSpot names."
    ),
)
async def research(
    body: ResearchRequest, session: SessionDep, embedder: EmbedderDep, claude: ClaudeDep
) -> LeadCard:
    try:
        return await research_company(session, embedder, claude, load_rules(), get_settings(), body)
    except ClaudeUnavailable as error:
        raise Problem(503, error.title, error.detail) from error
    except ClaudeError as error:
        raise Problem(502, error.title, error.detail) from error


class LeadRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company: str
    city: str | None
    result: str
    score: int
    status: str
    hubspot_status: str
    cost_usd: Decimal
    web_searches: int
    created_at: datetime


class LeadPage(BaseModel):
    total: int
    items: list[LeadRow]


@router.get("/leads", response_model=LeadPage, summary="Lists leads, best score first")
async def list_leads(
    session: SessionDep,
    result: Result | None = None,
    min_score: int = Query(default=0, ge=0, le=100),
    company: str | None = Query(default=None, description="Part of the name", examples=["seek"]),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> LeadPage:
    statement = select(Lead).where(Lead.score >= min_score)
    if result is not None:
        statement = statement.where(Lead.result == result)
    if company:
        statement = statement.where(Lead.company.ilike(f"%{company}%"))
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    page = statement.order_by(Lead.score.desc(), Lead.created_at.desc()).limit(limit)
    rows = await session.scalars(page.offset(offset))
    return LeadPage(total=total or 0, items=[LeadRow.model_validate(row) for row in rows])


@router.get("/leads/{lead_id}", response_model=LeadCard, summary="One lead card")
async def get_lead(lead_id: uuid.UUID, session: SessionDep) -> LeadCard:
    lead = await session.get(Lead, lead_id)
    if lead is None:
        raise Problem(404, "Lead not found", "Check the id. GET /lead-finder/leads lists them.")
    return LeadCard.model_validate(lead.card)
