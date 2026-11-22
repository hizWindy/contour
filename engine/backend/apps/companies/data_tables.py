"""The Companies project's tables in Admin's Data tab (PLAN-V26 choice 16)."""

from typing import Final

from core.data.spec import DataColumn, DataTable

C = DataColumn
GROUP = "Companies"

DATA_TABLES: Final = (
    DataTable(
        "companies.call_notes",
        "Call notes",
        GROUP,
        (
            C("called_at", "When"),
            C("company_name", "Company"),
            C("company_heard", "As heard"),
            C("person_name", "Person"),
            C("status", "Status"),
            C("text", "Note"),
            C("made_by", "Logged by (id)"),
            C("error", "Error"),
        ),
        search=("company_name", "company_heard", "person_name", "status"),
        newest="called_at",
    ),
    DataTable(
        "companies.preps",
        "Call preps",
        GROUP,
        (
            C("created_at", "When"),
            C("company_name", "Company"),
            C("person_name", "Person"),
            C("status", "Status"),
            C("cost_usd", "Cost (US$)"),
            C("made_by", "Asked by (id)"),
            C("error", "Error"),
        ),
        search=("company_name", "person_name", "status"),
        newest="created_at",
    ),
    DataTable(
        "companies.meeting_forms",
        "Pre-reads",
        GROUP,
        (
            C("starts_at", "Meeting"),
            C("company_name", "Company"),
            C("title", "Title"),
            C("status", "Status"),
            C("next_step", "Next step"),
            C("going", "Who is going"),
            C("sent_to", "Sent to"),
            C("sent_at", "Sent"),
        ),
        search=("company_name", "title", "status"),
        newest="starts_at",
    ),
    DataTable(
        "companies.learned_names",
        "Learned names",
        GROUP,
        (
            C("heard", "Heard"),
            C("company_name", "Company"),
            C("made_by", "Taught by (id)"),
            C("created_at", "When"),
        ),
        search=("heard", "company_name"),
        newest="created_at",
        screen="/admin/settings",
        screen_label="Learned names",
    ),
    DataTable(
        "companies.script_edits",
        "Rewritten script lines",
        GROUP,
        (
            C("updated_at", "Changed"),
            C("company_key", "Company id"),
            C("slot", "Line"),
            C("text", "Words"),
            C("user_id", "Person id"),
        ),
        search=("slot", "company_key"),
        newest="updated_at",
    ),
    DataTable(
        "companies.script_styles",
        "Style notes",
        GROUP,
        (
            C("updated_at", "Changed"),
            C("scope", "Whose"),
            C("text", "Note"),
            C("status", "Status"),
            C("user_id", "Person id"),
        ),
        search=("scope", "status"),
        newest="updated_at",
    ),
    DataTable(
        "companies.script_prefs",
        "Script tones",
        GROUP,
        (
            C("updated_at", "Changed"),
            C("scope", "Whose"),
            C("tone", "Tone"),
            C("user_id", "Person id"),
        ),
        search=("scope", "tone"),
        newest="updated_at",
    ),
)
