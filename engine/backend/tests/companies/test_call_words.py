"""A call command's own words, read by code (PLAN-V25 T3-1 and T3-3): the call type, and a call
that is only an outcome. Pure code, no database. Made-up names only."""

from typing import get_args

import pytest

from apps.companies.call_words import (
    call_type_of,
    call_type_said,
    only_outcome,
    outcome_said,
)
from apps.companies.schemas import CallType
from core.hubspot.activities import CALL_TYPES


def test_the_contracts_call_types_are_hubspots() -> None:
    assert get_args(CallType) == CALL_TYPES


@pytest.mark.parametrize(
    ("words", "kind"),
    [
        ("log a follow-up call with Jo Sample", "Follow Up Call"),
        ("log a follow up call", "Follow Up Call"),
        ("Make it a follow-up call", "Follow Up Call"),
        ("log a networking call with Jo", "Agent/Networking Phone Call"),
        ("an agent phone call", "Agent/Networking Phone Call"),
        ("prospecting", "Prospecting Call"),
        ("log a call with Jo", None),
        ("follow up Friday", None),  # a follow-up task, not the call's type
    ],
)
def test_the_call_type_said(words: str, kind: str | None) -> None:
    assert call_type_said(words) == kind


def test_the_call_type_defaults_to_prospecting_and_reads_the_start_only() -> None:
    assert call_type_of("", "Log a call with Jo Sample, no answer") == "Prospecting Call"
    assert call_type_of("log a follow-up call with Jo", "anything") == "Follow Up Call"
    # With no command words from Claude, only the first words count.
    assert call_type_of("", "Follow-up call with Jo Sample") == "Follow Up Call"
    late = "Log a call with Jo Sample about the lease and the fit-out, then a follow-up call"
    assert call_type_of("", late) == "Prospecting Call"


@pytest.mark.parametrize(
    ("words", "outcome"),
    [
        ("No answer", "No answer"),
        ("Jo Sample didn't pick up", "No answer"),
        (f"she didn{chr(0x2019)}t answer", "No answer"),  # a curly apostrophe
        ("left a voicemail", "Left voicemail"),
        ("voicemail", "Left voicemail"),
        ("line was engaged", "Busy"),
        ("busy", "Busy"),
        ("wrong number", "Wrong number"),
        ("we talked about the lease", None),
        ("no answer, then left a voicemail", None),  # two outcomes: not sure
    ],
)
def test_the_outcome_said(words: str, outcome: str | None) -> None:
    assert outcome_said(words) == outcome


@pytest.mark.parametrize(
    "words",
    [
        "No answer, Jo Sample",
        "Log a call with Jo Sample at Sample Logistics, no answer",
        "Called Jo Sample, didn't pick up",
        "Left Jo Sample a voicemail",
        "Jo Sample: wrong number",
        "Tried Jo, line busy",
        "Log a follow-up call with Jo Sample, no answer",  # a call type, not a follow-up
    ],
)
def test_only_an_outcome_is_a_quick_log(words: str) -> None:
    assert only_outcome(words, ["Jo Sample", "Sample Logistics Pty Ltd", "Jo"]) is not None


@pytest.mark.parametrize(
    "words",
    [
        "No answer from Jo Sample, follow up Friday",  # a follow-up opens the card
        "No answer from Jo Sample, follow up",  # with no day too (M1 review)
        "No answer, Jo Sample, try again",
        "No answer Jo Sample, call again this afternoon",
        "Tried Jo again, line busy",
        "Jo Sample didn't answer, she's moving in March",  # words open the card
        "Jo Sample is busy with a move",
        "Log a call with Jo Sample",  # no outcome
        "Spoke to Jo Sample",  # Connected has something to say
    ],
)
def test_more_than_an_outcome_is_not(words: str) -> None:
    found = only_outcome(words, ["Jo Sample"])
    assert found is None or found == "Connected"
