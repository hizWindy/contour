"""The run routes over real HTTP: start, stop, and the live event stream (server-sent events).

httpx's ASGITransport collects a whole response before it returns, so the stream is tested on a
real local server (`live_server`). Integration: the runs live in the test database.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from core.api.app import create_app
from core.runs.manager import RunManager
from tests.core.runs_fakes import APP, FakeState, wait_until, wait_until_idle

pytestmark = pytest.mark.integration

RUNS = "/api/v1/runs"


@pytest.fixture
def app(run_manager: RunManager) -> FastAPI:
    created = create_app()
    created.state.run_manager = run_manager
    return created


async def messages(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    """The messages of an SSE response: each one's lines, by field (`id`, `data`, `event`)."""
    fields: dict[str, Any] = {}
    async for line in response.aiter_lines():
        if line == "":
            if fields:
                yield fields
                fields = {}
            continue
        if line.startswith(":"):  # a heartbeat comment
            continue
        name, _, value = line.partition(":")
        fields[name] = value.removeprefix(" ")
    if fields:
        yield fields


async def read(
    client: httpx.AsyncClient,
    run_id: uuid.UUID,
    *,
    count: int | None = None,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Reads `count` messages (or until the stream ends), then hangs up."""
    found: list[dict[str, Any]] = []
    async with asyncio.timeout(15):
        async with client.stream(
            "GET", f"{RUNS}/{run_id}/events", headers=headers, params=params
        ) as response:
            assert response.status_code == 200, await response.aread()
            assert response.headers["content-type"].startswith("text/event-stream")
            async for message in messages(response):
                found.append(message)
                if count is not None and len(found) == count:
                    break
    return found


def seqs(found: list[dict[str, Any]]) -> list[int]:
    return [int(message["id"]) for message in found]


async def log_of(client: httpx.AsyncClient, run_id: uuid.UUID) -> list[dict[str, Any]]:
    response = await client.get(f"{RUNS}/{run_id}/log", params={"limit": 200})
    assert response.status_code == 200
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def start(client: httpx.AsyncClient, mode: str, **params: Any) -> dict[str, Any]:
    response = await client.post(RUNS, json={"app": APP, "mode": mode, "params": params})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    assert response.headers["location"] == f"{RUNS}/{body['id']}"
    return body


# --- Start and stop over HTTP --------------------------------------------------------------------


async def test_start_answers_201_with_the_address_and_cancel_stops_it(
    live_server: httpx.AsyncClient, fakes: FakeState
) -> None:
    run = await start(live_server, "block")
    assert run["status"] == "queued"
    await fakes.entered.wait()

    busy = await live_server.post(RUNS, json={"app": APP, "mode": "work", "params": {}})
    assert busy.status_code == 409
    assert busy.json()["code"] == "run_already_active"
    assert busy.json()["run_id"] == run["id"]

    stopped = await live_server.post(f"{RUNS}/{run['id']}/cancel")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "cancelled"


async def test_the_idempotency_key_header_returns_the_same_run(
    live_server: httpx.AsyncClient, run_manager: RunManager
) -> None:
    body = {"app": APP, "mode": "work", "params": {"units": 0}}
    headers = {"Idempotency-Key": "2b6f0c7e-click"}
    first = await live_server.post(RUNS, json=body, headers=headers)
    second = await live_server.post(RUNS, json=body, headers=headers)
    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["id"] == second.json()["id"]
    bad = await live_server.post(RUNS, json=body, headers={"Idempotency-Key": "has spaces"})
    assert bad.status_code == 422
    await wait_until_idle(run_manager)


# --- The stream ---------------------------------------------------------------------------------


async def test_each_message_has_an_id_and_data_and_no_event_line(
    live_server: httpx.AsyncClient, fakes: FakeState
) -> None:
    run = await start(live_server, "block")
    await fakes.entered.wait()

    async def release_soon() -> None:
        await asyncio.sleep(0.3)
        fakes.gate.set()

    releaser = asyncio.ensure_future(release_soon())
    found = await read(live_server, run["id"])  # ends by itself after run_finished
    await releaser

    assert found, "the stream sent nothing"
    assert all(set(message) == {"id", "data"} for message in found)
    data = [json.loads(message["data"]) for message in found]
    assert seqs(found) == [item["seq"] for item in data] == list(range(1, len(found) + 1))
    assert data[0]["type"] == "run_started"
    assert data[-1]["type"] == "run_finished"
    assert data == await log_of(live_server, run["id"])  # live equals the log


async def test_a_reconnect_with_last_event_id_carries_on_where_it_stopped(
    live_server: httpx.AsyncClient, run_manager: RunManager, fakes: FakeState
) -> None:
    run = await start(live_server, "block")
    await fakes.entered.wait()

    async def two_events() -> bool:
        return await run_manager.events.last_seq(uuid.UUID(run["id"])) >= 2

    await wait_until(two_events)  # run_started, then the first progress
    first = await read(live_server, run["id"], count=2)
    await wait_until(lambda: _no_watchers(run_manager))  # hanging up gave the slot back

    fakes.gate.set()
    rest = await read(live_server, run["id"], headers={"Last-Event-ID": first[-1]["id"]})

    together = [json.loads(message["data"]) for message in [*first, *rest]]
    assert together == await log_of(live_server, run["id"])


async def test_the_higher_of_after_and_last_event_id_wins(
    live_server: httpx.AsyncClient, run_manager: RunManager
) -> None:
    run = await start(live_server, "work", units=2)
    await wait_until_idle(run_manager)
    total = len(await log_of(live_server, run["id"]))

    by_query = await read(
        live_server, run["id"], params={"after": 2}, headers={"Last-Event-ID": "1"}
    )
    by_header = await read(
        live_server, run["id"], params={"after": 1}, headers={"Last-Event-ID": "3"}
    )
    assert seqs(by_query) == list(range(3, total + 1))
    assert seqs(by_header) == list(range(4, total + 1))


@pytest.mark.parametrize("header", ["abc", "-5", "1.5", "0x10"])
async def test_a_last_event_id_that_is_not_a_number_is_ignored(
    live_server: httpx.AsyncClient, run_manager: RunManager, header: str
) -> None:
    run = await start(live_server, "work", units=0)
    await wait_until_idle(run_manager)
    found = await read(live_server, run["id"], headers={"Last-Event-ID": header})
    assert seqs(found)[0] == 1  # the whole replay


async def test_a_finished_run_with_nothing_left_is_a_204(
    live_server: httpx.AsyncClient, run_manager: RunManager
) -> None:
    run = await start(live_server, "work", units=0)
    await wait_until_idle(run_manager)
    last = len(await log_of(live_server, run["id"]))

    for options in (
        {"params": {"after": last}},
        {"headers": {"Last-Event-ID": str(last)}},
        {"headers": {"Last-Event-ID": "9" * 30}},  # cut to the largest number, not a 500
    ):
        response = await live_server.get(f"{RUNS}/{run['id']}/events", **options)
        assert response.status_code == 204
        assert response.content == b""


async def test_an_unknown_run_is_a_404_and_a_bad_id_a_422(live_server: httpx.AsyncClient) -> None:
    unknown = await live_server.get(f"{RUNS}/{uuid.uuid4()}/events")
    assert unknown.status_code == 404
    assert unknown.headers["content-type"].startswith("application/problem+json")
    bad = await live_server.get(f"{RUNS}/not-a-uuid/events")
    assert bad.status_code == 422
    too_far = await live_server.get(f"{RUNS}/{uuid.uuid4()}/events", params={"after": -1})
    assert too_far.status_code == 422


async def test_too_many_watchers_is_a_429(
    live_server: httpx.AsyncClient, run_manager: RunManager, fakes: FakeState
) -> None:
    run_manager.events.max_per_run = 1
    run = await start(live_server, "block")
    await fakes.entered.wait()
    async with live_server.stream("GET", f"{RUNS}/{run['id']}/events") as watching:
        assert watching.status_code == 200
        second = await live_server.get(f"{RUNS}/{run['id']}/events")
        assert second.status_code == 429
        assert second.json()["code"] == "too_many_watchers"
    fakes.gate.set()
    await wait_until_idle(run_manager)
    await wait_until(lambda: _no_watchers(run_manager))


async def _no_watchers(manager: RunManager) -> bool:
    return manager.events.watchers == 0


async def test_runs_answer_503_when_the_run_engine_is_not_running(
    app: FastAPI, live_server: httpx.AsyncClient
) -> None:
    del app.state.run_manager
    response = await live_server.post(RUNS, json={"app": APP, "mode": "work", "params": {}})
    assert response.status_code == 503
    assert response.json()["code"] == "runs_not_ready"
    # A bad request is still a 422 first, so the person can fix it.
    bad = await live_server.post(RUNS, json={"app": APP})
    assert bad.status_code == 422
