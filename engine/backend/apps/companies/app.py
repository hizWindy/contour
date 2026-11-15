"""Tells the core about the Companies page (PLAN-V10): its name, endpoints, schema and HubSpot
needs. Its rows from other projects come through their `company_leads` hook."""

from fastapi import FastAPI

from apps.companies.api import router
from apps.companies.jobs import JOBS
from apps.companies.meeting_form import MeetingFormRunner
from apps.companies.note_batch import NoteSender
from apps.companies.note_fields import check_note_fields
from apps.companies.notes import NoteSorter
from apps.companies.prep import PrepRunner
from core.apps import AppSpec
from core.hubspot.needs import HubSpotNeeds

# The scope that lets the key write calls, notes and tasks (PLAN-V17 T1-2 found the key has it;
# its name is TBC). Until M1: at the join this becomes
# `from core.hubspot.check import ACTIVITY_WRITE_SCOPE` (Track 1's constant, the same text).
ACTIVITY_WRITE_SCOPE = "crm.objects.contacts.write"

# What the Companies page uses HubSpot for. People need the contacts scope. HubSpot reads logged
# calls without it (PLAN-V17 T1-2, 15 Nov). Call notes and the pre-read's copy write a call, its
# tasks and a note with ACTIVITY_WRITE_SCOPE, and a call's field changes with the companies
# scope (PLAN-V17).
HUBSPOT_NEEDS = HubSpotNeeds(
    read=(
        "crm.objects.companies.read",
        "crm.objects.deals.read",
        "crm.objects.owners.read",
        "crm.objects.contacts.read",
    ),
    write=("crm.objects.companies.write", ACTIVITY_WRITE_SCOPE),
    uses=(
        "Reads companies, offices, deals and owners for the list and the company panel, and "
        "people and their logged calls for the People list, Call history and call prep. Writes "
        "the calls, tasks and field changes a rep confirms from call notes, and a pre-read's "
        "copy as a note."
    ),
)


async def stop_preps(app: FastAPI) -> None:
    """Stops the preps running in this backend when it shuts down, and logs their spend (PLAN-V15
    T3-7). The backend calls it through `AppSpec.on_shutdown` (Track 1's T1-6)."""
    runner: PrepRunner | None = getattr(app.state, "prep_runner", None)
    if runner is not None:
        await runner.stop()


async def stop_note_sorts(app: FastAPI) -> None:
    """Stops the call notes this backend is sorting (PLAN-V17 T2-4). Each goes to the rep's batch
    to be sorted by hand, never lost, and its spend is logged."""
    sorter: NoteSorter | None = getattr(app.state, "note_sorter", None)
    if sorter is not None:
        await sorter.stop()


async def stop_note_sending(app: FastAPI) -> None:
    """Stops the batch of call notes this backend is sending to HubSpot (PLAN-V17 T2-6). What was
    sent stays sent, the note in flight takes what its write says, and the rest go back to the
    rep's batch."""
    sender: NoteSender | None = getattr(app.state, "note_sender", None)
    if sender is not None:
        await sender.stop()


async def stop_meeting_forms(app: FastAPI) -> None:
    """Stops the pre-reads this backend is drafting (PLAN-V17 T2-12). Each fails in plain words,
    keeps its facts and the rep's edits, and what it had spent is logged."""
    runner: MeetingFormRunner | None = getattr(app.state, "meeting_form_runner", None)
    if runner is not None:
        await runner.stop()


async def stop_background(app: FastAPI) -> None:
    """What runs in the background stops when the backend does: the preps, the sorts, the
    sending, then the pre-reads. One that fails never keeps the others running."""
    try:
        await stop_preps(app)
    finally:
        try:
            await stop_note_sorts(app)
        finally:
            try:
                await stop_note_sending(app)
            finally:
                await stop_meeting_forms(app)


def check_rules() -> None:
    """The Companies page's one rules file is what a call may change (PLAN-V17 T2-3): the backend
    won't start if it names a field the HubSpot field map doesn't have. The prep settings are
    checked with the others."""
    check_note_fields()


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
    on_shutdown=stop_background,  # running preps and sorts stop and log their spend
)
