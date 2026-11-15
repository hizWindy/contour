"""PLAN-V17 S0: the shapes Track 2 builds against, before Track 1 builds the real parts.

The activity writer is built (T1-5): its checks are in test_hubspot_activities.py. Track 1
replaces the meeting checks in T1-8 (our copy of meetings).
"""

from datetime import UTC, date, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from core.hubspot import meetings
from core.hubspot.activities import ActivityRequest, CallIn, FieldSet, NoteIn, TaskIn

AT = datetime(2026, 11, 16, 9, 30, tzinfo=UTC)


def a_request(**parts: Any) -> ActivityRequest:
    return ActivityRequest(app="companies", subject="call_note:1", company_id="101", **parts)


def test_a_call_note_fits_the_request() -> None:
    request = a_request(
        contact_id="201",
        call=CallIn(
            at=AT, title="Call with Jo Sample", body="Lease ends March.", outcome="Connected"
        ),
        tasks=[TaskIn(subject="Send the floor plan", due=date(2026, 11, 20), kind="email")],
        fields=[FieldSet(property="lease_end", label="Lease end", value="2028-03-31", seen=None)],
        note=NoteIn(body="Pre-read for Sample Logistics Pty Ltd"),
    )
    assert request.call is not None and request.call.direction == "outbound"
    assert (request.tasks[0].priority, request.tasks[0].owner_id) == ("medium", None)


def test_an_outcome_must_be_one_of_hubspots_names() -> None:
    with pytest.raises(ValidationError):
        CallIn(at=AT, title="Call", body="", outcome="Booked a meeting")


def test_a_request_with_nothing_to_write_is_refused() -> None:
    with pytest.raises(ValidationError):
        a_request()


def test_a_field_change_never_sends_an_empty_value() -> None:
    """An empty text clears a HubSpot field."""
    with pytest.raises(ValidationError):
        FieldSet(property="lease_end", label="Lease end", value="")


async def test_the_meeting_reads_find_nothing_yet() -> None:
    session: Any = object()
    assert await meetings.upcoming(session, owner_id=None, days=7) == []
    assert await meetings.past(session, owner_id="301", days=30) == []
    assert await meetings.for_company(session, "101") == []
    assert await meetings.get(session, "401") is None
    assert await meetings.refresh(session, object()) == 0  # type: ignore[arg-type]
    status = await meetings.status(session)
    assert (status.state, status.sentence) == ("waiting", meetings.NOT_READ_YET)


def test_a_meeting_keeps_people_as_ids() -> None:
    meeting = meetings.Meeting(id="401", title="Fitout chat", starts_at=AT, contact_ids=["201"])
    assert (meeting.where, meeting.company_id, meeting.contact_ids) == ("unknown", None, ["201"])
