"""Lead Finder endpoints, under /api/v1/lead-finder."""

from fastapi import APIRouter

from apps.lead_finder.rules import LeadFinderRules, load_rules

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
