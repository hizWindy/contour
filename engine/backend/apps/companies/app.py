"""Tells the core about the Companies page (PLAN-V10): its name, endpoints, schema and HubSpot
needs. Its rows from other projects come through their `company_leads` hook."""

from apps.companies.api import router
from apps.companies.jobs import JOBS
from core.apps import AppSpec
from core.hubspot.needs import HubSpotNeeds

# What the Companies page uses HubSpot for. People and calls need the contacts scope: HubSpot
# reads logged calls with it too (TBC, PLAN-V10 A2).
HUBSPOT_NEEDS = HubSpotNeeds(
    read=(
        "crm.objects.companies.read",
        "crm.objects.deals.read",
        "crm.objects.owners.read",
        "crm.objects.contacts.read",
    ),
    uses=(
        "Reads companies, offices, deals and owners for the list and the company panel, and "
        "people and their logged calls for the People list, Call history and call prep."
    ),
)


def check_rules() -> None:
    """The Companies page has no rules file. The prep settings are checked with the others."""


APP = AppSpec(
    name="companies",
    title="Companies",
    route_prefix="/companies",
    db_schema="companies",
    router=router,
    check_rules=check_rules,
    tables_module="apps.companies.tables",
    hubspot_needs=HUBSPOT_NEEDS,
    jobs=JOBS,  # the morning search ahead (PLAN-V10 D5)
)
