"""Fakes for live voice's tests (PLAN-V28): a made-up Google, a browser, and a row and budget that
live in memory. Nothing here reaches the real Google or uses the real key.

`FakeGoogle` is a real `websockets` server on 127.0.0.1 and a free port, so the relay's own
client (`google_live.open_link`) is what talks to it. It records what it receives (the address,
the headers, the setup, every message, the sound) and sends what a test asks: setupComplete,
resumption handles, sound, transcripts, tool calls and their cancellations, goAway and usage, in
binary frames as Google does. Each new connection follows the next plan in `plans`: `accept`
(the default), `refuse` (closes before setupComplete), `drop` (closes right after it) or
`slow` (answers the setup after half a second).
"""

import asyncio
import base64
import json
import logging
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from pydantic import SecretStr
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from apps.companies.live_voice.google_live import Endpoint
from apps.companies.live_voice.store import Save

FAKE_KEY = "test-key-not-real-7Q2Z"  # made up, and unusual enough to search for
# The fake Google's own server logs each request header at the debug level (the key's too). It is
# Google's side, not ours, so it stays above debug and the tests that search our logs for the key
# read only what our code wrote.
_google_side = logging.getLogger("tests.fake_google")
_google_side.setLevel(logging.INFO)
Plan = Literal["accept", "refuse", "drop", "slow"]


@dataclass
class FakeConnection:
    """One connection the relay opened to the fake Google."""

    socket: ServerConnection
    path: str
    headers: dict[str, str]
    setup: dict[str, Any] = field(default_factory=dict)
    received: list[dict[str, Any]] = field(default_factory=list)
    audio: bytearray = field(default_factory=bytearray)
    changed: asyncio.Event = field(default_factory=asyncio.Event)

    async def send(self, message: dict[str, Any], *, binary: bool = True) -> None:
        text = json.dumps(message)
        await self.socket.send(text.encode("utf-8") if binary else text)

    async def setup_complete(self) -> None:
        await self.send({"setupComplete": {}})

    async def handle(self, handle: str, *, resumable: bool = True) -> None:
        await self.send({"sessionResumptionUpdate": {"newHandle": handle, "resumable": resumable}})

    async def sound(self, pcm: bytes) -> None:
        data = base64.b64encode(pcm).decode("ascii")
        part = {"inlineData": {"mimeType": "audio/pcm;rate=24000", "data": data}}
        await self.send({"serverContent": {"modelTurn": {"parts": [part]}}})

    async def heard(self, text: str, *, finished: bool | None = None) -> None:
        said: dict[str, Any] = {"text": text}
        if finished is not None:
            said["finished"] = finished
        await self.send({"serverContent": {"inputTranscription": said}})

    async def said(self, text: str) -> None:
        await self.send({"serverContent": {"outputTranscription": {"text": text}}})

    async def interrupted(self) -> None:
        await self.send({"serverContent": {"interrupted": True}})

    async def turn_complete(self) -> None:
        await self.send({"serverContent": {"turnComplete": True}})

    async def tool_call(
        self, call_id: str, request: Any = None, *, name: str = "ask_contour"
    ) -> None:
        args = {} if request is None else {"request": request}
        call = {"id": call_id, "name": name, "args": args}
        await self.send({"toolCall": {"functionCalls": [call]}})

    async def tool_cancel(self, *ids: str, inside: bool = False) -> None:
        cancel = {"toolCallCancellation": {"ids": list(ids)}}
        await self.send({"serverContent": cancel} if inside else cancel)

    async def go_away(self, time_left: Any) -> None:
        await self.send({"goAway": {"timeLeft": time_left}})

    async def usage(self, **counts: Any) -> None:
        await self.send({"usageMetadata": counts})

    async def close(self, code: int = 1011, reason: str = "") -> None:
        await self.socket.close(code, reason)

    def sent(self, key: str) -> list[dict[str, Any]]:
        """The messages the relay sent with this key, like toolResponse."""
        return [message for message in self.received if key in message]

    async def wait_for(self, test: Callable[["FakeConnection"], bool], seconds: float = 5) -> None:
        async with asyncio.timeout(seconds):
            while not test(self):
                self.changed.clear()
                await self.changed.wait()


class FakeGoogle:
    def __init__(self) -> None:
        self.plans: deque[Plan] = deque()
        self.connections: list[FakeConnection] = []
        self.ready: asyncio.Queue[FakeConnection] = asyncio.Queue()
        self.got_setup = asyncio.Event()  # a connection's setup arrived
        self._server: Server | None = None

    async def __aenter__(self) -> "FakeGoogle":
        self._server = await serve(
            self._handle, "127.0.0.1", 0, max_size=8 * 1024 * 1024, logger=_google_side
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    @property
    def url(self) -> str:
        assert self._server is not None
        port = next(iter(self._server.sockets)).getsockname()[1]
        return f"ws://127.0.0.1:{port}/ws/fake.BidiGenerateContent"

    def endpoint(self, key: str = FAKE_KEY) -> Endpoint:
        return Endpoint(url=self.url, key=SecretStr(key), model="models/gemini-3.8-live")

    async def next(self, seconds: float = 5) -> FakeConnection:
        """The next connection that got its setupComplete."""
        return await asyncio.wait_for(self.ready.get(), seconds)

    async def _handle(self, socket: ServerConnection) -> None:
        request = socket.request
        assert request is not None
        conn = FakeConnection(
            socket=socket,
            path=request.path,
            headers={name.lower(): value for name, value in request.headers.raw_items()},
        )
        self.connections.append(conn)
        plan = self.plans.popleft() if self.plans else "accept"
        try:
            first = json.loads(await socket.recv())
            conn.received.append(first)
            conn.setup = first.get("setup", {})
            self.got_setup.set()
            if plan == "refuse":
                await socket.close(1011, "refused")
                return
            if plan == "slow":
                await asyncio.sleep(0.5)
            await conn.setup_complete()
            if plan == "drop":
                await socket.close(1011, "dropped")
                return
            self.ready.put_nowait(conn)
            async for raw in socket:
                message = json.loads(raw)
                conn.received.append(message)
                audio = message.get("realtimeInput", {}).get("audio")
                if audio:
                    conn.audio += base64.b64decode(audio["data"])
                conn.changed.set()
        except ConnectionClosed:
            pass
        finally:
            conn.changed.set()


class FakeBrowser:
    """The browser's side of the socket, as the relay sees it (Starlette's WebSocket)."""

    def __init__(self) -> None:
        self.incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.messages: list[dict[str, Any]] = []
        self.sound = bytearray()
        self.closed: int | None = None
        self.changed = asyncio.Event()

    async def receive(self) -> dict[str, Any]:
        return await self.incoming.get()

    async def send_text(self, data: str) -> None:
        if self.closed is not None:
            raise RuntimeError("closed")
        self.messages.append(json.loads(data))
        self.changed.set()

    async def send_bytes(self, data: bytes) -> None:
        if self.closed is not None:
            raise RuntimeError("closed")
        self.sound += data
        self.changed.set()

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed = code
        self.changed.set()

    def say(self, pcm: bytes) -> None:
        self.incoming.put_nowait({"type": "websocket.receive", "bytes": pcm})

    def send(self, message: dict[str, Any] | str) -> None:
        text = message if isinstance(message, str) else json.dumps(message)
        self.incoming.put_nowait({"type": "websocket.receive", "text": text})

    def leave(self, code: int = 1001) -> None:
        self.incoming.put_nowait({"type": "websocket.disconnect", "code": code})

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [message for message in self.messages if message.get("type") == kind]

    async def wait_for(self, kind: str, seconds: float = 5, count: int = 1) -> dict[str, Any]:
        async with asyncio.timeout(seconds):
            while len(self.of(kind)) < count:
                self.changed.clear()
                await self.changed.wait()
        return self.of(kind)[count - 1]

    async def wait_sound(self, size: int, seconds: float = 5) -> None:
        async with asyncio.timeout(seconds):
            while len(self.sound) < size:
                self.changed.clear()
                await self.changed.wait()


@dataclass
class FakeRows:
    saves: list[Save] = field(default_factory=list)
    finished: list[tuple[Save, str, str]] = field(default_factory=list)

    async def save(self, saved: Save) -> None:
        self.saves.append(saved)

    async def finish(self, saved: Save, *, status: str, reason: str) -> None:
        self.finished.append((saved, status, reason))


@dataclass
class FakeBudget:
    cap: Decimal = Decimal("4")
    others: Decimal = Decimal("0")
    reads: int = 0

    async def read(self, talk_id: Any) -> tuple[Decimal, Decimal]:
        self.reads += 1
        return self.cap, self.others


def frames(seconds: float, *, start: int = 1) -> list[bytes]:
    """Made-up 16 kHz sound in 20 ms pieces of 640 bytes, each a different level (so their order
    shows), no words."""
    return [
        (start + index).to_bytes(2, "little", signed=True) * 320
        for index in range(int(seconds * 50))
    ]
