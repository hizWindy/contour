"""Lead Finder endpoints, under /api/v1/lead-finder.

This file puts the pieces together: the rules and the synchronous research here, the leads in
api_leads.py, and the run-related routes in api_runs.py.
"""

from fastapi import APIRouter

from apps.lead_finder import api_hubspot, api_leads, api_review, api_runs, api_watchlist
from apps.lead_finder.research import LeadCard, ResearchRequest, research_company
from apps.lead_finder.rules import LeadFinderRules, load_rules
from core.api.deps import ClaudeDep, EmbedderDep, SessionDep, SettingsDep, claude_dependency
from core.api.errors import Problem
from core.claude.client import ClaudeError, ClaudeUnavailable

# `claude_dependency` is the same function as in core.api.deps, so a test that overrides it
# here reaches every route that uses it.
__all__ = ["ClaudeDep", "claude_dependency", "router"]

router = APIRouter()


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
        "rules. Costs money: about US$1 per company, capped by the company cap. It also counts "
        "toward the daily limit. This is for Swagger and the command line: the website uses "
        "runs. Use public companies until Levi approves using HubSpot names."
    ),
)
async def research(
    body: ResearchRequest,
    session: SessionDep,
    embedder: EmbedderDep,
    claude: ClaudeDep,
    settings: SettingsDep,
) -> LeadCard:
    try:
        return await research_company(session, embedder, claude, load_rules(), settings, body)
    except ClaudeUnavailable as error:
        raise Problem(503, error.title, error.detail) from error
    except ClaudeError as error:
        raise Problem(502, error.title, error.detail) from error


# The leads routes go first so their fixed paths (/leads/export, /leads/facets, /leads/map)
# come before /leads/{lead_id}. Each router keeps its own order too.
router.include_router(api_leads.router)
router.include_router(api_hubspot.router)
router.include_router(api_runs.router)
router.include_router(api_watchlist.router)
router.include_router(api_review.router)
