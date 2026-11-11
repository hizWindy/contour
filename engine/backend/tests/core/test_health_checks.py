"""The health checks' pure parts and the runner (PLAN-V13 T1-2). Fast: no database, no network.

Each system's states are driven with made-up facts. The calls to the outside are proven free with
a fake transport that records every request: Claude is only asked for its model list, and Signal
Hire only for its credit balance.
"""

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from datetime import time as clock
from decimal import Decimal
from typing import Any, cast

import anthropic
import httpx2
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from core.config import Settings
from core.health import checks
from core.health.checks import (
    Migrations,
    api_finding,
    claude_error_finding,
    claude_models,
    claude_ok,
    database_finding,
    email_finding,
    hubspot_finding,
    schedules_finding,
    signalhire_finding,
)
from core.health.run import Check, Finding, run_checks
from core.health.traffic import ApiTraffic, TrafficMiddleware
from core.hubspot.check import PROBES, ConnectionCheck, ScopeOut
from core.hubspot.sync import SyncOut
from core.schedules.models import Schedule
from core.signalhire.client import HttpSignalHire, SignalHireUnavailable

D = Decimal
# Wednesday 11 Nov 2026, 9:00 am in Melbourne (UTC+11).
NOW = datetime(2026, 11, 10, 22, 0, tzinfo=UTC)


def settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def bare_context(chosen: Settings) -> checks.Context:
    """For a check that returns before it needs the database."""
    return checks.Context(app=FastAPI(), settings=chosen, sessions=cast(Any, None), now=NOW)


# --- The runner -----------------------------------------------------------------------------------


async def test_a_slow_check_stops_at_its_limit_without_holding_up_the_others() -> None:
    async def quick() -> Finding:
        return Finding("ok", "Fine.")

    async def slow() -> Finding:
        await asyncio.sleep(30)
        return Finding("ok", "Never seen.")

    started = time.perf_counter()
    results = await run_checks(
        [Check("database", "Database", quick), Check("claude", "Claude", slow)],
        limit_seconds=0.2,
        clock=lambda: NOW,
    )
    took = time.perf_counter() - started
    assert took < 1.0  # the slow one was stopped at 0.2 seconds, not waited for
    fine, stopped = results
    assert (fine.id, fine.finding.state, fine.finding.sentence) == ("database", "ok", "Fine.")
    assert fine.took_ms < 200
    assert stopped.finding.state == "problem"
    assert stopped.finding.sentence == "No answer in 0.2 seconds."
    assert 150 <= stopped.took_ms < 1000
    assert stopped.checked_at == NOW


async def test_the_checks_run_at_the_same_time() -> None:
    async def wait() -> Finding:
        await asyncio.sleep(0.2)
        return Finding("ok", "Done.")

    started = time.perf_counter()
    results = await run_checks([Check("database", "A", wait) for _ in range(5)], clock=lambda: NOW)
    assert time.perf_counter() - started < 0.6  # 5 x 0.2 seconds one after another would be 1
    assert all(result.finding.state == "ok" for result in results)


async def test_a_check_that_crashes_is_a_problem_with_no_error_text() -> None:
    async def crash() -> Finding:
        raise RuntimeError("sk-ant-secret-key in the error text")

    (result,) = await run_checks([Check("claude", "Claude", crash)], clock=lambda: NOW)
    assert result.finding.state == "problem"
    assert "secret" not in result.finding.sentence
    assert result.finding.next_step == "The details are in the backend log."


# --- Database -------------------------------------------------------------------------------------


def test_database_ok_when_pgvector_is_on_and_the_migration_matches() -> None:
    code = Migrations(heads=frozenset({"0014_companies"}), known=frozenset({"0014_companies"}))
    found = database_finding("0.8.1", ["0014_companies"], code)
    assert (found.state, found.sentence) == (
        "ok",
        "It answers. pgvector 0.8.1, migration 0014_companies.",
    )


def test_database_problem_when_pgvector_is_off_or_the_migration_differs() -> None:
    heads = Migrations(
        heads=frozenset({"0015_next"}), known=frozenset({"0014_companies", "0015_next"})
    )
    assert database_finding(None, ["0015_next"], heads).state == "problem"
    behind = database_finding("0.8.1", ["0014_companies"], heads)
    assert behind.state == "problem"
    assert (
        behind.sentence
        == "The database is at migration 0014_companies, and the code needs 0015_next."
    )
    assert behind.next_step == "Run: engine migrate"
    ahead = database_finding("0.8.1", ["0016_future"], heads)
    assert ahead.state == "problem" and "doesn't know" in ahead.sentence


def test_the_code_knows_its_own_newest_migration() -> None:
    code = checks.code_migrations()
    assert len(code.heads) == 1 and next(iter(code.heads)).startswith("00")
    assert code.heads <= code.known and "0001_core_tables" in code.known


# --- Claude ---------------------------------------------------------------------------------------


async def test_claude_off_when_no_key_is_set() -> None:
    context = bare_context(settings(anthropic_api_key=None))
    found = await checks.check_claude(context)
    assert found.state == "off" and "ANTHROPIC_API_KEY" in (found.next_step or "")


def test_claude_ok_says_what_was_spent() -> None:
    found = claude_ok(D("12.401"), D("150"))
    assert found.state == "ok"
    assert (
        found.sentence
        == "Key works. US$12.41 spent in the last 24 hours, of the US$150.00 daily limit."
    )


def _status_error(cls: type[anthropic.APIStatusError], status: int) -> anthropic.APIStatusError:
    request = httpx2.Request("GET", "https://api.anthropic.com/v1/models")
    response = httpx2.Response(status, request=request, json={"error": {"message": "secret"}})
    return cls("secret words from outside", response=response, body=None)


@pytest.mark.parametrize(
    ("error", "words"),
    [
        (_status_error(anthropic.AuthenticationError, 401), "Anthropic refused the key."),
        (
            _status_error(anthropic.RateLimitError, 429),
            "Anthropic says the key is over its rate limit right now.",
        ),
        (_status_error(anthropic.InternalServerError, 529), "Anthropic had a problem (error 529)."),
        (
            anthropic.APIConnectionError(
                request=httpx2.Request("GET", "https://api.anthropic.com")
            ),
            "Anthropic can't be reached.",
        ),
    ],
)
def test_claude_problems_are_our_own_words(error: Exception, words: str) -> None:
    found = claude_error_finding(error)
    assert (found.state, found.sentence) == ("problem", words)
    assert "secret" not in found.sentence + (found.next_step or "")


async def test_the_claude_check_only_asks_for_the_model_list() -> None:
    """Nothing here can cost money: the only request is GET /v1/models."""
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(
            200,
            json={"data": [], "has_more": False, "first_id": None, "last_id": None},
        )

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    await claude_models("sk-ant-test", http_client=client)
    assert [(request.method, request.url.path) for request in seen] == [("GET", "/v1/models")]
    sent = seen[0].headers.get("x-api-key", "") + seen[0].headers.get("authorization", "")
    assert "sk-ant-test" in sent


async def test_a_refused_claude_key_raises_for_the_check_to_read() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            401, json={"type": "error", "error": {"type": "authentication_error"}}
        )

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    with pytest.raises(anthropic.AuthenticationError):
        await claude_models("sk-ant-test", http_client=client)


# --- HubSpot --------------------------------------------------------------------------------------


def connection(*, key_set: bool = True, connected: bool = True, **states: str) -> ConnectionCheck:
    scopes = [
        ScopeOut(
            scope=probe.scope,
            access=probe.access,
            label=probe.label,
            state=states.get(
                probe.scope.replace(".", "_"), "yes" if probe.access == "read" else "no"
            ),
        )
        for probe in PROBES
    ]
    return ConnectionCheck(
        key_set=key_set,
        connected=connected,
        problem=None if connected else "HubSpot refused the key. Check HUBSPOT_SERVICE_KEY.",
        scopes=scopes,
        checked_at=NOW,
    )


def sync(status: str = "done", finished: datetime | None = NOW - timedelta(hours=3)) -> SyncOut:
    return SyncOut(
        id=1,
        mode="changes",
        trigger="schedule",
        status=status,
        changed_since=None,
        companies_read=0,
        deals_read=0,
        owners_read=0,
        companies_saved=0,
        offices_saved=0,
        deals_saved=0,
        deals_skipped=0,
        companies_removed=0,
        deals_removed=0,
        profiles_rebuilt=0,
        error=None,
        warnings=[],
        started_at=(finished or NOW) - timedelta(minutes=2),
        finished_at=finished,
    )


DAY2 = timedelta(hours=48)


def test_hubspot_ok_says_the_last_sync_and_the_companies() -> None:
    good = sync(finished=datetime(2026, 11, 10, 19, 2, tzinfo=UTC))  # 6:02 am Melbourne
    found = hubspot_finding(connection(), good, good, 13913, NOW, DAY2)
    assert (found.state, found.sentence) == ("ok", "Last sync 6:02 am, 13,913 companies.")


def test_hubspot_off_with_no_key() -> None:
    found = hubspot_finding(connection(key_set=False, connected=False), None, None, 0, NOW, DAY2)
    assert found.state == "off" and "HUBSPOT_SERVICE_KEY" in (found.next_step or "")


def test_hubspot_problems() -> None:
    good = sync()
    refused = hubspot_finding(connection(connected=False), good, good, 5, NOW, DAY2)
    assert (
        refused.state == "problem"
        and refused.next_step
        and "HUBSPOT_SERVICE_KEY" in refused.next_step
    )
    missing = hubspot_finding(connection(crm_objects_deals_read="no"), good, good, 5, NOW, DAY2)
    assert missing.state == "problem"
    assert missing.sentence == "5 of 6 read permissions. Missing: Read deals and their stages."
    failed = hubspot_finding(connection(), sync("failed", None), good, 5, NOW, DAY2)
    assert failed.state == "problem" and failed.sentence.startswith("The last sync failed")
    never = hubspot_finding(connection(), None, None, 0, NOW, DAY2)
    assert (never.state, never.sentence) == ("problem", "No sync has finished yet.")
    old = sync(finished=NOW - timedelta(days=3))
    stale = hubspot_finding(connection(), old, old, 5, NOW, DAY2)
    assert stale.state == "problem" and stale.sentence.startswith("The last good sync was 8 Nov")


def test_write_permissions_still_waiting_are_not_a_problem() -> None:
    """Writing waits for the write scopes (PLAN-V5 Part F): the check is about reading."""
    good = sync()
    assert hubspot_finding(connection(), good, good, 5, NOW, DAY2).state == "ok"


# --- Signal Hire ----------------------------------------------------------------------------------


async def test_signalhire_off_with_no_key() -> None:
    context = bare_context(settings(signalhire_api_key=None))
    assert (await checks.check_signalhire(context)).state == "off"


def test_signalhire_ok_and_problem() -> None:
    assert signalhire_finding(27, None) == Finding("ok", "Key works. The account has 27 credits.")
    refused = signalhire_finding(
        None, SignalHireUnavailable("Signal Hire refused the key", "Check SIGNALHIRE_API_KEY.")
    )
    assert refused == Finding(
        "problem", "Signal Hire refused the key.", "Check SIGNALHIRE_API_KEY."
    )
    assert (
        signalhire_finding(None, RuntimeError("secret")).sentence
        == "The check of Signal Hire failed."
    )


async def test_the_signalhire_check_only_reads_the_credit_balance() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, json={"credits": 27}, headers={"X-Credits-Left": "27"})

    client = HttpSignalHire(
        "sh-key",
        client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )
    assert await client.credits() == 27
    assert [(request.method, request.url.path) for request in seen] == [("GET", "/api/v1/credits")]
    assert seen[0].headers["apikey"] == "sh-key"


# --- Email ----------------------------------------------------------------------------------------


def test_email_off_when_it_goes_to_the_log() -> None:
    found = email_finding(settings(email_provider="log"))
    assert found.state == "off"
    assert found.sentence.startswith("Emails are written to the backend log, not sent.")


def test_email_problem_when_resend_lacks_its_key() -> None:
    found = email_finding(settings(email_provider="resend", email_from="leads@contour.example"))
    assert found.state == "problem"
    assert found.sentence.startswith("Email is set to Resend, but EMAIL_API_KEY is missing")


def test_email_ok_names_only_the_domain_and_sends_nothing() -> None:
    found = email_finding(
        settings(
            email_provider="resend",
            email_api_key="re_test",
            email_from="Contour HQ <leads@contour.example>",
            lead_finder_notify_emails="a@contour.example,b@contour.example",
        )
    )
    assert found.state == "ok"
    assert found.sentence == (
        "Sends through Resend, from an address at contour.example. The run email goes to 2 people."
    )
    assert "leads@" not in found.sentence


# --- Schedules ------------------------------------------------------------------------------------


def schedule(name: str, *, enabled: bool = True, **values: Any) -> Schedule:
    return Schedule(
        id=uuid.uuid4(),
        project="lead_finder",
        job=f"job.{name.lower()}",
        name=name,
        settings={},
        every=2,
        unit="weeks",
        weekday=0,
        at_time=clock(7, 0),
        timezone="Australia/Melbourne",
        enabled=enabled,
        next_run_at=values.pop("next_run_at", NOW + timedelta(days=5) if enabled else None),
        **values,
    )


def test_schedules_off_when_every_one_is_off() -> None:
    found = schedules_finding([schedule("Perth", enabled=False)], NOW, loop_running=True)
    assert (found.state, found.sentence) == ("off", "Every schedule is off.")


def test_schedules_ok_says_the_next_one() -> None:
    soon = datetime(2026, 11, 15, 20, 0, tzinfo=UTC)  # Mon 16 Nov, 7:00 am Melbourne
    found = schedules_finding(
        [schedule("Find new leads: Melbourne", next_run_at=soon), schedule("Off", enabled=False)],
        NOW,
        loop_running=True,
    )
    assert found.state == "ok"
    assert found.sentence == "1 schedule on. Next: Find new leads: Melbourne, 16 Nov, 7:00 am."
    assert [item.state for item in found.data] == ["ok", "off"]


def test_schedules_problem_for_a_failed_a_skipped_a_late_or_a_stopped_loop() -> None:
    failed = schedule("Perth", last_status="failed", last_error="It could not start.")
    found = schedules_finding([failed], NOW, loop_running=True)
    assert (
        found.state == "problem"
        and found.sentence == "Perth: It failed last time. It could not start."
    )
    skipped = schedule("Sydney", last_status="skipped", last_error="A run is already going.")
    assert schedules_finding([skipped], NOW, loop_running=True).sentence == (
        "Sydney: It didn't start last time. A run is already going."
    )
    late = schedule("Adelaide", next_run_at=NOW - timedelta(minutes=30))
    assert "hasn't started" in schedules_finding([late], NOW, loop_running=True).sentence
    stopped = schedules_finding([schedule("Melbourne")], NOW, loop_running=False)
    assert stopped.state == "problem" and "scheduler isn't running" in stopped.sentence


# --- API ------------------------------------------------------------------------------------------


class FakeTime:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now


def test_the_counter_keeps_one_hour_errors_first_then_the_slowest() -> None:
    fake = FakeTime()
    traffic = ApiTraffic(clock=fake)
    traffic.record("GET", "/api/v1/old", 200, 5000)
    fake.now += 61 * 60  # more than an hour later: the old one is gone
    traffic.record("GET", "/api/v1/runs", 200, 40)
    traffic.record("GET", "/api/v1/runs", 200, 60)
    traffic.record("GET", "/api/v1/companies", 200, 900)
    traffic.record("POST", "/api/v1/runs", 500, 10)
    traffic.record("POST", "/api/v1/runs", 422, 10)
    snapshot = traffic.snapshot()
    assert [(item.method, item.path) for item in snapshot.endpoints] == [
        ("POST", "/api/v1/runs"),
        ("GET", "/api/v1/companies"),
        ("GET", "/api/v1/runs"),
    ]
    runs = snapshot.endpoints[2]
    assert (runs.requests, runs.errors, runs.average_ms, runs.slowest_ms) == (2, 0, 50, 60)
    post = snapshot.endpoints[0]
    assert (post.requests, post.errors, post.refused) == (2, 1, 1)
    assert (snapshot.requests, snapshot.errors) == (5, 1)


def test_api_finding_ok_and_problem() -> None:
    fake = FakeTime()
    traffic = ApiTraffic(clock=fake)
    fake.now += 2 * 3600
    traffic.record("GET", "/api/v1/companies", 200, 840)
    ok = api_finding(traffic.snapshot(), NOW)
    assert ok.state == "ok"
    assert (
        ok.sentence
        == "1 request in the last hour, no errors. Slowest: GET /api/v1/companies, 840 ms."
    )
    traffic.record("GET", "/api/v1/runs/{run_id}", 500, 10)
    bad = api_finding(traffic.snapshot(), NOW)
    assert bad.state == "problem"
    assert bad.sentence == "1 error in the last hour, 1 on GET /api/v1/runs/{run_id}."


def test_the_middleware_counts_each_endpoint_by_its_path_in_the_code() -> None:
    app = FastAPI()
    traffic = ApiTraffic()

    @app.get("/api/v1/things/{thing_id}")
    async def thing(thing_id: int) -> dict[str, int]:
        return {"id": thing_id}

    @app.get("/api/v1/broken")
    async def broken() -> None:
        raise RuntimeError("boom")

    app.add_middleware(TrafficMiddleware, traffic=traffic)
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/api/v1/things/1").status_code == 200
        assert client.get("/api/v1/things/2").status_code == 200
        assert client.get("/api/v1/things/x").status_code == 422
        assert client.get("/api/v1/nowhere").status_code == 404  # no endpoint: not counted
        assert client.get("/api/v1/broken").status_code == 500
    counted = {(item.method, item.path): item for item in traffic.snapshot().endpoints}
    assert set(counted) == {("GET", "/api/v1/things/{thing_id}"), ("GET", "/api/v1/broken")}
    things = counted[("GET", "/api/v1/things/{thing_id}")]
    assert (things.requests, things.refused, things.errors) == (3, 1, 0)
    assert counted[("GET", "/api/v1/broken")].errors == 1
