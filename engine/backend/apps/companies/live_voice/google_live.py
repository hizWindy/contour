"""The connection to Google's Live API (PLAN-V28 T1-3, choices 1 to 4): a thin async client on
the `websockets` package, with no Google package.

- **Where:** the Gemini API (the default) or the Agent Platform in one region (A2), from settings.
  Only these two addresses are ever built, and only over `wss://`.
- **The key** goes in one header, `x-goog-api-key` (on the Agent Platform too: TBC at S1, where
  Google's pages show a sign-in token instead). Never in the address, a log line or an error:
  `websockets` writes every header to its log at the debug level, so its logger here is kept
  above debug, and an error from it is replaced by one that says what kind of failure it was.
- **Limits:** 10 seconds to open and get Google's `setupComplete`, a ping every 20 seconds, and
  messages up to 8 MB (Google's sound comes inside its JSON). Google's JSON may come in binary
  frames: they are read as UTF-8, and text frames are read too.
- **What it understands:** nothing. A message is a dict; the relay reads its fields, and an unknown
  field is never an error. A message that isn't JSON is skipped.
"""

import asyncio
import base64
import contextlib
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final

from pydantic import SecretStr
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidStatus, WebSocketException

from core.config import Settings

GEMINI_API_URL: Final = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
)
AGENT_PLATFORM_URL: Final = (
    "wss://{location}-aiplatform.googleapis.com/ws/"
    "google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
)
KEY_HEADER: Final = "x-goog-api-key"
OPEN_SECONDS: Final = 10.0  # to connect, send the setup and hear setupComplete
PING_SECONDS: Final = 20.0
CLOSE_SECONDS: Final = 2.0
MAX_MESSAGE_BYTES: Final = 8 * 1024 * 1024
AUDIO_MIME: Final = "audio/pcm;rate=16000"
EARLY_MAX: Final = 20  # messages before setupComplete that are kept for the relay

# websockets logs each request header at the debug level, the key's too. Its logger here never
# goes below info, whatever the rest of the app's level is.
_socket_log = logging.getLogger("contour.live_voice.google")
_socket_log.setLevel(logging.INFO)


@dataclass(frozen=True)
class Endpoint:
    """Where one talk's connections go, and with what. The key never shows in its text."""

    url: str
    key: SecretStr = field(repr=False)
    model: str  # the setup's model, like models/gemini-3.8-live


def endpoint_for(settings: Settings) -> Endpoint:
    """Google's address and model name for the service in settings. The settings check the key,
    the project and the region before this is ever called."""
    if settings.gemini_api_key is None:
        raise GoogleUnavailable("no_key")
    model = settings.live_voice_model
    if settings.live_voice_service == "agent_platform":
        project, location = settings.live_voice_project, settings.live_voice_location
        if project is None or location is None:
            raise GoogleUnavailable("no_place")
        return Endpoint(
            url=AGENT_PLATFORM_URL.format(location=location),
            key=settings.gemini_api_key,
            model=f"projects/{project}/locations/{location}/publishers/google/models/{model}",
        )
    return Endpoint(url=GEMINI_API_URL, key=settings.gemini_api_key, model=f"models/{model}")


class GoogleUnavailable(Exception):
    """Google couldn't be reached, refused the setup, or didn't answer in time. `why` is a short
    word for the log (like `timeout` or `refused`), and `code` the close code Google gave. Neither
    ever holds the key or the address."""

    def __init__(self, why: str, code: int | None = None) -> None:
        super().__init__(why)
        self.why = why
        self.code = code


class LinkClosed(Exception):
    """The connection closed. `code` is the WebSocket close code (None: no close frame)."""

    def __init__(self, code: int | None, reason: str) -> None:
        super().__init__(f"closed {code}")
        self.code = code
        self.reason = reason


def _closed(socket: ClientConnection) -> LinkClosed:
    return LinkClosed(socket.close_code, socket.close_reason or "")


def _parse(raw: str | bytes) -> dict[str, Any] | None:
    """One message from Google as a dict, or None for anything that isn't a JSON object."""
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        found = json.loads(text)
    except (UnicodeDecodeError, ValueError):
        return None
    return found if isinstance(found, dict) else None


class GoogleLink:
    """One open connection to Google, after its `setupComplete`."""

    def __init__(self, socket: ClientConnection) -> None:
        self._socket = socket
        self.early: list[dict[str, Any]] = []  # messages that came before setupComplete
        self.closing = False  # we are closing it (not a drop)

    async def send(self, message: Mapping[str, Any]) -> None:
        try:
            await self._socket.send(json.dumps(message, separators=(",", ":")))
        except ConnectionClosed:
            raise _closed(self._socket) from None

    async def send_audio(self, pcm: bytes) -> None:
        """A piece of the rep's sound: 16-bit PCM, 16 kHz, mono, as base64 in JSON."""
        data = base64.b64encode(pcm).decode("ascii")
        await self.send({"realtimeInput": {"audio": {"mimeType": AUDIO_MIME, "data": data}}})

    async def send_audio_end(self) -> None:
        """The rep went quiet (the browser's silence gate): Google may answer now."""
        await self.send({"realtimeInput": {"audioStreamEnd": True}})

    async def send_tool_response(
        self, call_id: str, name: str, response: Mapping[str, Any]
    ) -> None:
        await self.send(
            {
                "toolResponse": {
                    "functionResponses": [{"id": call_id, "name": name, "response": response}]
                }
            }
        )

    async def receive(self) -> dict[str, Any]:
        """The next message. Raises `LinkClosed` when the connection is closed."""
        while True:
            try:
                raw = await self._socket.recv()
            except ConnectionClosed:
                raise _closed(self._socket) from None
            message = _parse(raw)
            if message is not None:
                return message

    async def close(self) -> None:
        """Closes it, quickly. Safe to call twice."""
        self.closing = True
        with contextlib.suppress(TimeoutError, OSError, WebSocketException):
            await asyncio.wait_for(self._socket.close(), CLOSE_SECONDS + 1)


async def open_link(
    endpoint: Endpoint, setup: Mapping[str, Any], *, seconds: float = OPEN_SECONDS
) -> GoogleLink:
    """Connects, sends the setup and waits for Google's `setupComplete`, all within `seconds`.
    Raises `GoogleUnavailable` for any failure, never with the key in it."""
    socket: ClientConnection | None = None
    try:
        async with asyncio.timeout(seconds):
            socket = await connect(
                endpoint.url,
                additional_headers={KEY_HEADER: endpoint.key.get_secret_value()},
                open_timeout=None,  # the whole open is timed above
                ping_interval=PING_SECONDS,
                ping_timeout=PING_SECONDS,
                close_timeout=CLOSE_SECONDS,
                max_size=MAX_MESSAGE_BYTES,
                proxy=None,  # straight to Google: the key goes nowhere else
                logger=_socket_log,
            )
            link = GoogleLink(socket)
            await link.send({"setup": setup})
            while True:
                message = await link.receive()
                if "setupComplete" in message:
                    return link
                if len(link.early) >= EARLY_MAX:
                    raise GoogleUnavailable("no_setup_complete")
                link.early.append(message)
    except GoogleUnavailable:
        await _drop(socket)
        raise
    except TimeoutError:
        await _drop(socket)
        raise GoogleUnavailable("timeout") from None
    except LinkClosed as closed:
        await _drop(socket)
        raise GoogleUnavailable("refused", closed.code) from None
    except InvalidStatus as error:  # Google answered the opening with an HTTP error, like 403
        await _drop(socket)
        raise GoogleUnavailable("status", error.response.status_code) from None
    except (OSError, WebSocketException) as error:
        await _drop(socket)
        raise GoogleUnavailable(type(error).__name__) from None
    except asyncio.CancelledError:  # the talk ended while it opened
        await _drop(socket)
        raise


async def _drop(socket: ClientConnection | None) -> None:
    if socket is not None:
        with contextlib.suppress(TimeoutError, OSError, WebSocketException):
            await asyncio.wait_for(socket.close(), CLOSE_SECONDS)
