"""Tells the core about the Lead Finder: its name, endpoints, schema and rules check."""

from apps.lead_finder.api import router
from apps.lead_finder.rules import load_rules
from core.apps import AppSpec

APP = AppSpec(
    name="lead_finder",
    title="Lead Finder",
    route_prefix="/lead-finder",
    db_schema="lead_finder",
    router=router,
    check_rules=load_rules,
    tables_module="apps.lead_finder.tables",
)
