"""Run endpoints that act: start a run, watch it live, stop it, bring it back.

Every route here has its final path, parameters and response model, and answers 501 until its
package builds it (see core/api/stubs.py). The routes that only read (estimate, list, summary,
one run, the log) are in `core/api/runs_read.py`, a second router on the same `/runs` prefix.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response

from core.api.errors import ProblemDetails
from core.api.models import INT32_MAX
from core.api.stubs import stub
from core.runs.schemas import RunCreate, RunOut

router = APIRouter(prefix="/runs", tags=["runs"])

IDEMPOTENCY_PATTERN = r"^[A-Za-z0-9._:-]+$"


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
@stub
async def create_run(
    body: RunCreate,
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
    raise NotImplementedError


# When this is built: answer 204 first if `manager.stream_is_over(run_id, after)`, then
# `stream = await manager.subscribe(run_id, after)`. That call raises the 404 and the 429 as
# problem answers before any stream starts. Close `stream` in a `finally` (see
# `RunManager.subscribe`). Do not use `SessionDep` here. Send each event with an `id` (the seq)
# and `data` only: no `event=`, because the website reads the stream with `onmessage`.
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
@stub
async def stream_run_events(
    run_id: uuid.UUID,
    after: Annotated[
        int, Query(ge=0, le=INT32_MAX, description="Only events with a higher seq")
    ] = 0,
    last_event_id: Annotated[
        str | None, Header(description="Sent by the browser when it reconnects")
    ] = None,
) -> Response:
    raise NotImplementedError


@router.post(
    "/{run_id}/cancel",
    response_model=RunOut,
    summary="Stop a run",
    description=(
        "Asks the run to stop. Companies already saved stay saved. A run that is already over "
        "or already stopping is returned as it is."
    ),
)
@stub
async def cancel_run(run_id: uuid.UUID) -> RunOut:
    raise NotImplementedError


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
@stub
async def resume_run(run_id: uuid.UUID) -> RunOut:
    raise NotImplementedError
