"""Live voice's routes (PLAN-V28 T1-2), under /api/v1/companies/assistant/voice.

- `POST /session` starts a talk (the checks are in `service.py`, in the plan's order).
"""

import logging

from fastapi import APIRouter, Depends, Request

from apps.companies.live_voice import service
from apps.companies.live_voice.schemas import VoiceSessionIn, VoiceSessionOut
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.signin import NowDep

log = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant/voice")
V_TICKS = need("companies.call_logs", "companies.meetings", write=True)  # as V needs (PLAN-V22)


@router.post(
    "/session",
    response_model=VoiceSessionOut,
    status_code=201,
    dependencies=[Depends(V_TICKS)],
    summary="Start a live voice talk",
    description=(
        "PLAN-V28: makes a `ready` talk and answers its `id`, the socket's path (`socket`, "
        "`WS ...?session=<id>`) and the limits. Open the socket within 60 seconds "
        "(`expires_at`), or start again. The checks, in this order: the Call logs or the "
        "Meetings tick (a Viewer gets 403 `viewer_read_only`); my own live voice switch (403 "
        "`live_voice_not_allowed`); live voice on, with its key, on the server (409 "
        "`live_voice_off`); this month's limit (429 `live_voice_limit`, with `Retry-After` until "
        "the month changes); and the talks at once on the server (503 `live_voice_busy`, with "
        "`Retry-After`). Starting many times in a minute is 429 `too_many_starts`. A start ends "
        "my other talk, if any: its socket closes with `ended` and reason `replaced`. With the "
        "names OK on the server, up to 50 names I'm likely to say (read from our copy, with "
        "`company_key` first) go to Google as hints; they are never kept. No sound, words or "
        "names are kept: the talk's row holds counts only."
    ),
)
async def start_live_voice(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    auth: SignedInDep,
    now: NowDep,
    body: VoiceSessionIn | None = None,
) -> VoiceSessionOut:
    return await service.start_talk(
        session,
        request.app,
        auth=auth,
        settings=settings,
        company_key=body.company_key if body is not None else None,
        now=now,
    )
