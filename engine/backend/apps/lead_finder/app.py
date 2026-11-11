"""Tells the core about the Lead Finder: its name, endpoints, schema, rules check and runs."""

from apps.lead_finder.api import router
from apps.lead_finder.api_round import router as round_router
from apps.lead_finder.company_leads import COMPANY_LEADS
from apps.lead_finder.hubspot_send import mark_sent
from apps.lead_finder.jobs import JOBS
from apps.lead_finder.rules import load_rules
from apps.lead_finder.runs import RUN_KINDS
from core.apps import AppSpec
from core.hubspot.needs import HubSpotNeeds

# What the Lead Finder uses HubSpot for (PLAN-V5, "What each project needs from HubSpot").
HUBSPOT_NEEDS = HubSpotNeeds(
    read=(
        "crm.objects.companies.read",
        "crm.objects.deals.read",
        "crm.objects.owners.read",
        "crm.lists.read",
        "crm.schemas.companies.read",
    ),
    write=("crm.objects.companies.write", "crm.lists.write"),
    uses=(
        "Reads companies, offices, deals and owners for the watchlist and the 'already in "
        "HubSpot' check. Sends a lead as a company (empty fields only), a note and the "
        "'AI suggested' list."
    ),
)

APP = AppSpec(
    name="lead_finder",
    title="Lead Finder",
    route_prefix="/lead-finder",
    db_schema="lead_finder",
    router=router,
    check_rules=load_rules,
    tables_module="apps.lead_finder.tables",
    run_kinds=RUN_KINDS,
    jobs=JOBS,
    hubspot_needs=HUBSPOT_NEEDS,
    hubspot_written=mark_sent,
    company_leads=COMPANY_LEADS,  # its leads on the Companies page (PLAN-V10 B2)
    schedule_router=round_router,  # one control for the city schedules (PLAN-V13 T1-3)
)
