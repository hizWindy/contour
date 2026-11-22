"""The Lead Finder's tables in Admin's Data tab (PLAN-V26 choice 16)."""

from typing import Final

from core.data.spec import DataColumn, DataTable

C = DataColumn
GROUP = "Lead Finder"

DATA_TABLES: Final = (
    DataTable(
        "lead_finder.leads",
        "Leads",
        GROUP,
        (
            C("created_at", "Found"),
            C("company", "Company"),
            C("city", "City"),
            C("domain", "Website"),
            C("result", "Result"),
            C("tier", "Tier"),
            C("score", "Score"),
            C("status", "Status"),
            C("note", "Note"),
        ),
        search=("company", "city", "domain", "result", "status"),
        newest="created_at",
    ),
    DataTable(
        "lead_finder.rivals",
        "Rivals",
        GROUP,
        (
            C("found_at", "Found"),
            C("name", "Rival"),
            C("lead_company", "Rival of"),
            C("city", "City"),
            C("status", "Status"),
            C("why", "Why"),
        ),
        search=("name", "lead_company", "city"),
        newest="found_at",
    ),
    DataTable(
        "lead_finder.signalhire_details",
        "Signal Hire details",
        GROUP,
        (
            C("fetched_at", "Read"),
            C("slug", "Company"),
            C("details", "Details"),
        ),
        search=("slug",),
        newest="fetched_at",
    ),
)
