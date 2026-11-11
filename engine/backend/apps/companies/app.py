"""Tells the core about the Companies page (PLAN-V10): its name, endpoints, schema and HubSpot
needs. Its rows from other projects come through their `company_leads` hook."""

from fastapi import FastAPI

from apps.companies.api import router
from apps.companies.jobs import JOBS
from apps.companies.prep import PrepRunner
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


async def stop_preps(app: FastAPI) -> None:
    """Stops the preps running in this backend when it shuts down, and logs their spend (PLAN-V15
    T3-7). The backend calls it through `AppSpec.on_shutdown` (Track 1's T1-6)."""
    runner: PrepRunner | None = getattr(app.state, "prep_runner", None)
    if runner is not None:
        await runner.stop()


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
    on_shutdown=stop_preps,  # running preps stop and log their spend (PLAN-V15)
)
