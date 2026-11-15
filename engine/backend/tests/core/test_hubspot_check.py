"""The connection check (PLAN-V5 B2) and each project's readiness (B3), on the fake HubSpot.
PLAN-V17 T1-3: a probe for calls, notes, tasks and meetings each, one for logging them, and the
scopes HubSpot asks for when one is missing."""

import re

import pytest

from core.hubspot.check import (
    ACTIVITY_WRITE_SCOPE,
    KNOWN_SCOPES,
    MISSING_DETAIL,
    PROBES,
    ConnectionCheck,
    ScopeOut,
    check_connection,
)
from core.hubspot.client import HubSpotMissingScope, HubSpotUnavailable, WriteScopeProbe
from core.hubspot.needs import HubSpotNeeds, readiness
from tests.core.hubspot_fake import (
    ACTIVITY_READ_SCOPES,
    PEOPLE_SCOPE,
    READ_SCOPES,
    WRITE_SCOPES,
    FakeHubSpot,
)

LEAD_FINDER = HubSpotNeeds(read=READ_SCOPES, write=WRITE_SCOPES, uses="leads")


def states(check: ConnectionCheck) -> dict[str, str]:
    return {item.scope: item.state for item in check.scopes}


def scope(check: ConnectionCheck, name: str) -> ScopeOut:
    (found,) = [item for item in check.scopes if item.scope == name]
    return found


async def test_with_no_key_nothing_is_called_and_every_scope_is_unknown() -> None:
    check = await check_connection(None)
    assert not check.key_set and not check.connected
    assert set(states(check).values()) == {"unknown"}
    assert check.problem == "The HubSpot key isn't set on the server."


async def test_a_read_key_reads_yes_and_writes_no_and_nothing_is_written() -> None:
    fake = FakeHubSpot()
    check = await check_connection(fake)

    assert check.connected and check.portal_id == 1234567
    assert states(check) == {
        **dict.fromkeys(READ_SCOPES, "yes"),
        **dict.fromkeys(WRITE_SCOPES, "no"),
        PEOPLE_SCOPE: "no",  # contacts wait for the HubSpot admin (PLAN-V10 C1)
    }
    assert not any(call.startswith(("create", "update", "add_to")) for call in fake.calls)


async def test_calls_notes_tasks_and_meetings_are_each_read_on_their_own() -> None:
    """PLAN-V17 T1-2: the key reads calls without the contacts scope, so each kind has a probe,
    and the contacts probe reads people only."""
    labels = {probe.scope: probe.label for probe in PROBES}
    assert labels[PEOPLE_SCOPE] == "Read people at companies"
    assert [labels[name] for name in ACTIVITY_READ_SCOPES] == [
        "Read logged calls",
        "Read notes",
        "Read tasks",
        "Read meetings",
    ]
    fake = FakeHubSpot(scopes=set(READ_SCOPES) - {"crm.objects.calls.read"})
    fake.grant_people()
    found = states(await check_connection(fake))
    assert found["crm.objects.calls.read"] == "no"
    assert found[PEOPLE_SCOPE] == "yes"  # people no longer wait for calls
    assert all(found[name] == "yes" for name in ACTIVITY_READ_SCOPES[1:])
    assert {"list_calls", "list_notes", "list_tasks", "list_meetings"} <= set(fake.calls)


async def test_a_key_with_write_scopes_reads_yes_everywhere() -> None:
    fake = FakeHubSpot()
    fake.scopes |= set(WRITE_SCOPES)
    fake.grant_people()
    assert set(states(await check_connection(fake)).values()) == {"yes"}


async def test_a_missing_read_scope_is_no_and_a_hubspot_fault_is_unknown() -> None:
    fake = FakeHubSpot(scopes=set(READ_SCOPES) - {"crm.lists.read"})
    fake.fail["owners"] = [HubSpotUnavailable("HubSpot had a problem", "error 502")]
    found = states(await check_connection(fake))
    assert found["crm.lists.read"] == "no"
    assert found["crm.objects.owners.read"] == "unknown"
    assert found["crm.objects.companies.read"] == "yes"


async def test_a_refused_key_says_why_and_checks_nothing_else() -> None:
    fake = FakeHubSpot()
    fake.fail["account"] = [HubSpotUnavailable("HubSpot refused the key", "Check the key.")]
    check = await check_connection(fake)
    assert check.key_set and not check.connected
    assert check.problem == "HubSpot refused the key. Check the key."
    assert fake.calls == ["account"]


@pytest.mark.parametrize(
    ("answers", "expected"),
    [
        ((True, True, True), "yes"),
        ((True, False, True), "no"),
        ((False, None, None), "no"),  # one refusal is enough
        ((True, None, True), "unknown"),
    ],
)
async def test_logging_calls_tasks_and_notes_is_yes_only_when_all_three_may_be_written(
    answers: tuple[bool | None, bool | None, bool | None],
    expected: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeHubSpot()
    given = dict(zip(("calls", "notes", "tasks"), answers, strict=True))

    async def probe(what: WriteScopeProbe) -> bool | None:
        fake.calls.append(f"probe_{what}")
        return given.get(what, True)

    monkeypatch.setattr(fake, "probe_write_scope", probe)
    found = scope(await check_connection(fake), ACTIVITY_WRITE_SCOPE)
    assert (found.access, found.state) == ("write", expected)
    assert found.label == "Log calls, tasks and notes (HubSpot's scope name TBC)"
    assert {"probe_calls", "probe_notes", "probe_tasks"} <= set(fake.calls)
    assert not any(call.startswith(("create", "update")) for call in fake.calls)


async def test_the_fake_key_logs_activities_once_it_has_the_scope() -> None:
    """The fake's own answers: calls and tasks need the activity scope, a note the companies
    one (the Lead Finder's note path)."""
    fake = FakeHubSpot()
    fake.scopes.add("crm.objects.companies.write")
    assert states(await check_connection(fake))[ACTIVITY_WRITE_SCOPE] == "no"
    fake.scopes.add(ACTIVITY_WRITE_SCOPE)
    assert states(await check_connection(fake))[ACTIVITY_WRITE_SCOPE] == "yes"


async def test_a_missing_scope_says_what_hubspot_asks_for() -> None:
    fake = FakeHubSpot()  # no contacts scope: the fake names the one it lacks
    fake.fail["list_tasks"] = [HubSpotMissingScope([])]  # HubSpot named none
    fake.fail["list_meetings"] = [
        HubSpotMissingScope(["crm.objects.meetings.read", "crm.schemas.meetings.read"])
    ]
    check = await check_connection(fake)
    people = scope(check, PEOPLE_SCOPE)
    assert (people.state, people.detail) == (
        "no",
        "HubSpot asks for one of: crm.objects.contacts.read.",
    )
    assert scope(check, "crm.objects.meetings.read").detail == (
        "HubSpot asks for one of: crm.objects.meetings.read, crm.schemas.meetings.read."
    )
    assert scope(check, "crm.objects.tasks.read").detail == MISSING_DETAIL
    writes = scope(check, "crm.objects.companies.write")  # a write probe answers no, not why
    assert (writes.state, writes.detail) == ("no", MISSING_DETAIL)


def test_every_scope_a_project_names_is_one_the_check_tries() -> None:
    from apps.lead_finder.app import HUBSPOT_NEEDS

    assert set(HUBSPOT_NEEDS.read) | set(HUBSPOT_NEEDS.write) <= KNOWN_SCOPES
    assert len({probe.scope for probe in PROBES}) == len(PROBES)


def _check(**states_by_scope: str) -> ConnectionCheck:
    from datetime import UTC, datetime

    from core.hubspot.check import ScopeOut

    scopes = [
        ScopeOut(
            scope=p.scope,
            access=p.access,
            label=p.label,
            state=states_by_scope.get(p.scope.replace(".", "_"), "yes"),
        )
        for p in PROBES
    ]
    return ConnectionCheck(
        key_set=True, connected=True, scopes=scopes, checked_at=datetime.now(UTC)
    )


@pytest.mark.parametrize(
    ("given", "write_enabled", "reading", "sending", "summary"),
    [
        (
            {"crm_objects_companies_write": "no", "crm_lists_write": "no"},
            False,
            "ready",
            "waiting",
            "Lead Finder: reading ready. Sending waits for crm.objects.companies.write, "
            "crm.lists.write.",
        ),
        ({}, False, "ready", "off", "Lead Finder: reading ready. Sending is switched off"),
        ({}, True, "ready", "ready", "Lead Finder: reading ready. Sending ready."),
        (
            {"crm_lists_read": "no"},
            True,
            "waiting",
            "ready",
            "Lead Finder: reading waits for crm.lists.read",
        ),
        ({"crm_lists_write": "unknown"}, True, "ready", "unknown", "sending not known yet"),
    ],
)
def test_readiness_says_what_a_project_waits_for(
    given: dict[str, str], write_enabled: bool, reading: str, sending: str, summary: str
) -> None:
    ready = readiness(
        "lead_finder", "Lead Finder", LEAD_FINDER, _check(**given), write_enabled=write_enabled
    )
    assert (ready.reading, ready.sending) == (reading, sending)
    assert summary.lower() in ready.summary.lower()


def test_a_project_that_only_reads_never_waits_on_write_scopes() -> None:
    needs = HubSpotNeeds(read=("crm.objects.companies.read",))
    check = _check(crm_objects_companies_write="no")
    ready = readiness("x", "X", needs, check, write_enabled=False)
    assert (ready.reading, ready.sending, ready.waiting_for) == ("ready", "not_needed", [])


async def test_no_line_a_person_sees_names_a_setting_or_a_file() -> None:
    """The HubSpot page shows these lines as they come (PLAN-V17, asked by Track 3)."""
    no_key = await check_connection(None)
    assert no_key.problem == "The HubSpot key isn't set on the server."
    lines = [no_key.problem or ""] + [
        readiness("x", "X", LEAD_FINDER, _check(**given), write_enabled=on).summary
        for given in ({}, {"crm_lists_read": "no"}, {"crm_lists_write": "unknown"})
        for on in (False, True)
    ]
    setting_or_file = re.compile(r"\b[A-Z]+_[A-Z_]+\b|\.env\b|\.py\b")
    assert [line for line in lines if setting_or_file.search(line)] == []
