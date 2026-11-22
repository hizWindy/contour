"""The Companies project's part of a person's Activity page (PLAN-V26 Part 3).

Calls and notes, preps, and what the person sent: their calls that reached HubSpot and the
pre-reads they emailed. And which kind of spending each of this project's Claude steps is.
"""

import uuid
from typing import Final

from sqlalchemy import Text, cast, func, literal, select

from apps.companies import assistant, meeting_form, notes
from apps.companies.tables import CallNote, MeetingForm, Prep
from core.activity import ActivityPart, Rows

PREPS: Final = "Preps"
CALL_NOTES: Final = "Call notes"
ASSISTANT: Final = "The Assistant"
PRE_READS: Final = "Pre-reads"

SPEND_KINDS: Final = {
    "prep:web": PREPS,
    "prep:script": PREPS,
    notes.STEP: CALL_NOTES,
    assistant.STEP: ASSISTANT,
    meeting_form.STEP: PRE_READS,
}

CALL_STATES: Final = {
    "needs_company": "Needs a company",
    "sorting": "Sorting",
    "to_confirm": "To confirm",
    "sending": "Sending",
    "logged": "In HubSpot",
    "partial": "Partly in HubSpot",
    "failed": "Needs a look",
    "uncertain": "Check HubSpot",
}
PREP_STATES: Final = {"searching": "Searching", "ready": "Ready", "failed": "Failed"}
SENT_STATES: Final = {
    "call": "Call to HubSpot",
    "call_partial": "Call partly to HubSpot",
    "pre_read": "Pre-read to the team",
}


def calls(user_id: uuid.UUID) -> Rows:
    return select(
        cast(CallNote.id, Text).label("id"),
        CallNote.called_at.label("at"),
        func.coalesce(CallNote.company_name, CallNote.company_heard, "").label("what"),
        func.coalesce(CallNote.person_name, "").label("detail"),
        CallNote.status.label("state"),
    ).where(CallNote.made_by == user_id)


def preps(user_id: uuid.UUID) -> Rows:
    return select(
        cast(Prep.id, Text).label("id"),
        Prep.created_at.label("at"),
        Prep.company_name.label("what"),
        func.coalesce(Prep.person_name, "").label("detail"),
        Prep.status.label("state"),
    ).where(Prep.made_by == user_id)


def calls_sent(user_id: uuid.UUID) -> Rows:
    return select(
        cast(CallNote.id, Text).label("id"),
        func.coalesce(CallNote.finished_at, CallNote.updated_at).label("at"),
        func.coalesce(CallNote.company_name, "").label("what"),
        func.coalesce(CallNote.person_name, "").label("detail"),
        literal("call").label("state"),
    ).where(CallNote.made_by == user_id, CallNote.status == "logged")


def calls_partly_sent(user_id: uuid.UUID) -> Rows:
    return select(
        cast(CallNote.id, Text).label("id"),
        func.coalesce(CallNote.finished_at, CallNote.updated_at).label("at"),
        func.coalesce(CallNote.company_name, "").label("what"),
        func.coalesce(CallNote.person_name, "").label("detail"),
        literal("call_partial").label("state"),
    ).where(CallNote.made_by == user_id, CallNote.status == "partial")


def pre_reads_sent(user_id: uuid.UUID) -> Rows:
    return select(
        cast(MeetingForm.id, Text).label("id"),
        MeetingForm.sent_at.label("at"),
        MeetingForm.company_name.label("what"),
        MeetingForm.title.label("detail"),
        literal("pre_read").label("state"),
    ).where(
        MeetingForm.sent_by == user_id,
        MeetingForm.sent_at.is_not(None),
    )


ACTIVITY: Final = (
    ActivityPart("calls", calls, CALL_STATES),
    ActivityPart("preps", preps, PREP_STATES),
    ActivityPart("sent", calls_sent, SENT_STATES),
    ActivityPart("sent", calls_partly_sent, SENT_STATES),
    ActivityPart("sent", pre_reads_sent, SENT_STATES),
)
