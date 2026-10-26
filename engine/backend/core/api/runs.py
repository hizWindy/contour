"""Run endpoints that act: start a run, watch it live, stop it, bring it back.

The routes that only read (estimate, list, summary, one run, the log) are in
`core/api/runs_read.py`, a second router on the same `/runs` prefix.

Two rules for these routes:
- The run manager is looked up INSIDE the route (`manager_of`), not as a `Depends` parameter.
  FastAPI runs a dependency before it checks the body and the query, so a dependency that
  answers 503 would hide a 422 for a bad request. Here a bad request is a 422 first, and only a
  good one finds out whether the run engine is ready.
- The events route never uses `SessionDep`. A stream can last an hour, and a database session
  must not be held that long. The manager opens short sessions of its own.
"""

import json
import re
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Header, Query, Request, Response
from sse_starlette.sse import EventSourceResponse

from core.api.deps import run_manager_dependency
from core.api.errors import ProblemDetails
from core.api.models import INT32_MAX
from core.runs.manager import RunManager
from core.runs.schemas import RunCreate, RunOut, dump_event
from core.runs.types import EventStream

router = APIRouter(prefix="/runs", tags=["runs"])

IDEMPOTENCY_PATTERN = r"^[A-Za-z0-9._:-]+$"
HEARTBEAT_SECONDS = 15  # a comment line, so proxies and browsers keep the connection open
SEND_TIMEOUT_SECONDS = 30  # a client that doesn't read for this long is dropped
_DIGITS = re.compile(r"[0-9]+")


def manager_of(request: Request) -> RunManager:
    """The run manager, or a plain 503 when the run engine isn't running (database down at
    start-up). Same answer as the `RunManagerDep` dependency; see the module text for why it
    is a call and not a parameter."""
    return run_manager_dependency(request)


def last_event_id_of(value: str | None) -> int:
    """The number in a `Last-Event-ID` header. Anything that isn't digits is ignored (0), and
    a huge number is cut to what a database integer holds, so it can't cause a 500."""
    if value is None:
        return 0
    text = value.strip()
    if not _DIGITS.fullmatch(text):
        return 0
    if len(text) > 12:  # more than any number of events, and `int()` stays fast
        return INT32_MAX
    return min(int(text), INT32_MAX)


class WatchedStream(EventSourceResponse):
    """The events response. It gives the watcher slot back whenever the response ends: when the
    client leaves, when a send times out, and when the response was never started."""

    def __init__(self, stream: EventStream, **options: Any) -> None:
        super().__init__(self._messages(stream), **options)
        self._stream = stream

    @staticmethod
    async def _messages(stream: EventStream) -> AsyncIterator[dict[str, str]]:
        # `id` and `data` only: no `event`, because the website reads the stream with
        # `onmessage`, and a listener for a named event would never fire.
        try:
            async for event in stream:
                yield {
                    "id": str(event.seq),
                    "data": json.dumps(dump_event(event), separators=(",", ":")),
                }
        finally:
            await stream.aclose()

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                await self._stream.aclose()


@router.post(
    "",
    status_code=201,
    response_model=RunOut,
    summary="Start a run",
    description=(
        "Checks the settings for this kind of run, then starts it in the background and "
        "returns it at once with status `queued` or `running`. Watch it with "
        "`GET /runs/{id}/events`. Only `max_concurrent_runs` runs go at a time: another "
        "answers 409 `run_already_active` (with the `run_id` of the run that is going). Send an "
        "`Idempotency-Key` so a double click or a retry returns the same run. Sending the same "
        "key again with a different body answers 409 `idempotency_key_reused`: a key belongs "
        "to one request."
    ),
    responses={
        201: {
            "headers": {
                "Location": {
                    "description": "The address of the new run",
                    "schema": {"type": "string"},
                }
            }
        },
        409: {
            "model": ProblemDetails,
            "description": (
                "`run_already_active` (the `run_id` of the run that is going), or "
                "`idempotency_key_reused` (the Idempotency-Key was used with a different body)"
            ),
        },
    },
)
async def create_run(
    body: RunCreate,
    request: Request,
    response: Response,
    idempotency_key: Annotated[
        str | None,
        Header(
            min_length=1,
            max_length=64,
            pattern=IDEMPOTENCY_PATTERN,
            description=(
                "Any unique text (a UUID is fine). The same key with the same body returns the "
                "same run. With a different body it is a 409 `idempotency_key_reused`."
            ),
        ),
    ] = None,
) -> RunOut:
    manager = manager_of(request)
    run = await manager.start(body.app, body.mode, body.params, idempotency_key)
    response.headers["Location"] = f"{request.url.path.rstrip('/')}/{run.id}"
    return run


# Answers 204 first if `manager.stream_is_over(run_id, after)`, then `stream = await
# manager.subscribe(run_id, after)`. That call raises the 404 and the 429 as problem answers
# before any stream starts. `WatchedStream` closes `stream` however the response ends.
@router.get(
    "/{run_id}/events",
    response_model=None,
    response_class=Response,
    summary="Watch a run live (server-sent events)",
    description=(
        "A stream of events as they happen, after replaying the saved ones that come after "
        "`after` (or after the `Last-Event-ID` header, whichever is higher). Each message has "
        "only `id` (the seq) and `data` (the event as JSON, a `RunEvent`). There is no `event:` "
        "line: the type is `data.type`, so read the stream with `EventSource.onmessage`. A "
        "listener for a named event would never fire. The stream ends after `run_finished`. "
        "Connecting to a finished run with nothing left to replay answers 204, so a browser's "
        "EventSource stops trying again. Answers 404 for an unknown run and 429 when too many "
        "people are watching."
    ),
    responses={
        200: {
            "description": (
                "Server-sent events. Each message has an `id:` line and a `data:` line, "
                "which is one `RunEvent` as JSON. There is no `event:` line."
            ),
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        },
        204: {"description": "The run is over and has no event after `after`."},
        429: {"description": "Too many people are watching (10 for one run, 50 in all)"},
    },
)
async def stream_run_events(
    run_id: uuid.UUID,
    request: Request,
    after: Annotated[
        int, Query(ge=0, le=INT32_MAX, description="Only events with a higher seq")
    ] = 0,
    last_event_id: Annotated[
        str | None, Header(description="Sent by the browser when it reconnects")
    ] = None,
) -> Response:
    manager = manager_of(request)
    start = max(after, last_event_id_of(last_event_id))
    if await manager.stream_is_over(run_id, start):
        return Response(status_code=204)  # so the browser's EventSource stops trying again
    stream = await manager.subscribe(run_id, start)
    return WatchedStream(stream, ping=HEARTBEAT_SECONDS, send_timeout=SEND_TIMEOUT_SECONDS)


@router.post(
    "/{run_id}/cancel",
    response_model=RunOut,
    summary="Stop a run",
    description=(
        "Asks the run to stop. Companies already saved stay saved. A run that is already over "
        "or already stopping is returned as it is."
    ),
)
async def cancel_run(run_id: uuid.UUID, request: Request) -> RunOut:
    return await manager_of(request).cancel(run_id)


@router.post(
    "/{run_id}/resume",
    response_model=RunOut,
    summary="Continue an interrupted or failed run",
    description=(
        "Continues from the saved progress without researching the same company twice. "
        "Answers 409 `run_not_resumable` for any other status, past the run cap, or after "
        "3 resumes. Nothing resumes by itself."
    ),
)
async def resume_run(run_id: uuid.UUID, request: Request) -> RunOut:
    return await manager_of(request).resume(run_id)
