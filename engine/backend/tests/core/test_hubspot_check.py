"""The connection check (PLAN-V5 B2) and each project's readiness (B3), on the fake HubSpot."""

import pytest

from core.hubspot.check import KNOWN_SCOPES, PROBES, ConnectionCheck, check_connection
from core.hubspot.client import HubSpotUnavailable
from core.hubspot.needs import HubSpotNeeds, readiness
from tests.core.hubspot_fake import READ_SCOPES, WRITE_SCOPES, FakeHubSpot

LEAD_FINDER = HubSpotNeeds(read=READ_SCOPES, write=WRITE_SCOPES, uses="leads")


def states(check: ConnectionCheck) -> dict[str, str]:
    return {item.scope: item.state for item in check.scopes}


async def test_with_no_key_nothing_is_called_and_every_scope_is_unknown() -> None:
    check = await check_connection(None)
    assert not check.key_set and not check.connected
    assert set(states(check).values()) == {"unknown"}
    assert check.problem and "HUBSPOT_SERVICE_KEY" in check.problem


async def test_a_read_key_reads_yes_and_writes_no_and_nothing_is_written() -> None:
    fake = FakeHubSpot()
    check = await check_connection(fake)

    assert check.connected and check.portal_id == 1234567
    assert states(check) == {
        **dict.fromkeys(READ_SCOPES, "yes"),
        **dict.fromkeys(WRITE_SCOPES, "no"),
    }
    assert not any(call.startswith(("create", "update", "add_to")) for call in fake.calls)


async def test_a_key_with_write_scopes_reads_yes_everywhere() -> None:
    fake = FakeHubSpot()
    fake.scopes |= set(WRITE_SCOPES)
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
