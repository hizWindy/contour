"""Live voice's routes (PLAN-V28 T1-2 to T1-4), under /api/v1/companies/assistant/voice.

- `POST /session` starts a talk (the checks are in `service.py`, in the plan's order).
- `WS /live?session=<id>` is the talk's socket: sound and messages both ways (`messages.py`).

The socket is refused before it opens (closed with 1008) unless every check passes: a session
where sign-in is on (the guard), our own site's `Origin` (the origin guard, and again here), V's
tick and the person's own switch, live voice on with its key, and the talk's row: this person's,
`ready` and under 60 seconds old, opened once (or carrying on after a backend restart).
"""

import logging
import uuid
from typing import Final

from fastapi import APIRouter, Depends, Request, WebSocket

from apps.companies.live_voice import service
from apps.companies.live_voice.relay import Relay
from apps.companies.live_voice.schemas import VoiceSessionIn, VoiceSessionOut
from core.api.access import SignedInDep, need
from core.api.deps import SessionDep, SettingsDep
from core.api.security import allowed_origins, socket_origin_allowed
from core.api.signin import NowDep
from core.auth.features import can_talk
from core.config import get_settings
from core.prefs.service import effective_settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant/voice")
V_TICKS = need("companies.call_logs", "companies.meetings", write=True)  # as V needs (PLAN-V22)
REFUSED: Final = 1008


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


def _talk_id(text: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(text or "")
    except ValueError:
        return None


async def _refuse(websocket: WebSocket, why: str) -> None:
    """Closes the socket before it opens. The browser can't read why, so the log says it (a word,
    never a name)."""
    log.info("live_voice_socket_refused", extra={"why": why})
    await websocket.close(code=REFUSED)


@router.websocket("/live")
async def live_voice_socket(websocket: WebSocket, auth: SignedInDep) -> None:
    """The talk's socket (see the module's notes and `messages.py`)."""
    app = websocket.app
    allowed = getattr(app.state, "allowed_origins", None) or allowed_origins(get_settings())
    if not socket_origin_allowed(websocket.headers, allowed):
        await _refuse(websocket, "origin")
        return
    talk_id = _talk_id(websocket.query_params.get("session"))
    if talk_id is None:
        await _refuse(websocket, "no_talk")
        return
    if auth is not None and not (
        auth.user.live_voice and can_talk(auth.user.role, auth.user.features)
    ):
        await _refuse(websocket, "not_allowed")
        return
    sessions = service.sessions_of(app)
    async with sessions() as session:
        settings = await effective_settings(session)
    if not settings.live_voice_ready:
        await _refuse(websocket, "off")
        return
    talks = service.talks_of(app)
    if not talks.begin_open(talk_id):
        await _refuse(websocket, "opened_already")
        return
    relay: Relay | None = None
    opened: service.Opened | None = None
    now = service.clock_of(app)()
    try:
        opened = await service.open_talk(sessions, talks, talk_id, service.owner_of(auth), now)
        if opened is not None:
            names = opened.names
            if opened.resumed and settings.live_voice_names_ok:
                async with sessions() as session:
                    names = await service.names_for(
                        session, app, auth=auth, settings=settings, company_key=None, now=now
                    )
            relay = service.make_relay(app, websocket, opened, settings, names=names)
            talks.add_live(relay)
    except Exception as error:
        log.error("live_voice_socket_failed", extra={"kind": type(error).__name__})
        relay = None
        if opened is not None:  # its row is open, but nothing carries it: end it
            await service.end_talk(sessions, talk_id, "error", now)
    finally:
        talks.end_open(talk_id)
    if relay is None:
        await _refuse(websocket, "not_this_talk")
        return
    try:
        try:
            await websocket.accept()
        except Exception:
            relay.end("left")  # gone before it opened: the relay still writes the row
        await relay.run()
    finally:
        talks.remove_live(relay)
