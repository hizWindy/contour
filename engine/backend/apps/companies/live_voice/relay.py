"""One live voice talk's relay (PLAN-V28 T1-3 to T1-5): the browser's socket on one side, Google's
connection on the other, and the meter in between.

**What it carries** (`messages.py` has the list): the rep's sound to Google as it comes, and
Gemini's sound back as Google sent it; "pause" as Google's `audioStreamEnd`; the transcripts,
`interrupted`, `turnComplete`, tool calls and their cancellations as small JSON messages; and the
browser's tool answers back to Google with the same id. It understands nothing else: an unknown
field from Google is never an error.

**Caps on the browser** (choice 11): a sound frame is at most 4 KB of whole 16-bit samples, a JSON
message at most 8 KB and one of ours, sound may average at most 1.5 times real time (so nobody
can spend faster than talking), and JSON at most 10 messages a second. Breaking one ends the talk.

**The tool** (choice 6): only `ask_contour` with a `request` reaches the browser. Anything else
gets an error answer from the relay. An answer the browser doesn't send in 20 seconds is the
relay's own: "That took too long. Try again." (TBC), and the browser is told to stop working on it.
A tool answer goes to Google with every email address and phone number blanked (`facts.scrub`).

**Long talks and drops** (choice 15, T1-4): each resumable `sessionResumptionUpdate` keeps its
handle (a secret: never logged or sent to the browser). At `goAway` a new connection opens with
the handle, and the talk moves to it at a quiet moment (no sound from the rep for 300 ms, Gemini
not speaking, no tool call waiting), or at once when 10 seconds are left. The rep's sound goes to
the old connection until the move, then to the new one, so none is lost. A connection that drops
by surprise is resumed: up to 2 tries in 10 seconds, with `reconnecting` and `reconnected`; after
that the talk ends with "the connection dropped". The rep's sound waits (3 seconds at most) while
it reconnects.

**How a talk ends:** the browser's `stop`, the browser leaving, Google closing for good, the talk's
time limit, the month's limit (after Gemini's sentence: its `turnComplete`, 8 seconds at most), or
nothing from the browser for 5 minutes. Then both sides close and the row is written. When the
backend stops (uvicorn closes the browser's socket with 1012, or the task is cancelled), the talk
is `dropped` instead, with its handle, so the browser can come back within 30 seconds.

**The meter** (T1-5): every `usageMetadata` is counted, the month's total is checked after each,
and the row is written every 30 seconds and at the end. Log lines hold counts, seconds, US$ and
why a talk ended: never words, names, sound, a handle or the key.
"""

import asyncio
import base64
import binascii
import contextlib
import logging
import re
import time
import traceback
import uuid
from collections import deque
from collections.abc import Awaitable, Callable, Coroutine, Mapping, MutableMapping
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, Protocol

from pydantic import BaseModel, ValidationError

from apps.companies.facts import scrub
from apps.companies.live_voice.google_live import GoogleLink, GoogleUnavailable, LinkClosed
from apps.companies.live_voice.messages import (
    AUDIO_RATE_MAX,
    BROWSER_MESSAGE,
    ID_MAX_CHARS,
    MAX_BINARY_BYTES,
    MAX_TEXT_BYTES,
    REQUEST_MAX_CHARS,
    SAMPLE_RATE_IN,
    EndReason,
    ToolStatus,
    VoiceEnded,
    VoiceHeard,
    VoiceInterrupted,
    VoicePause,
    VoiceReady,
    VoiceReconnected,
    VoiceReconnecting,
    VoiceSaid,
    VoiceStop,
    VoiceToolAnswer,
    VoiceToolCall,
    VoiceToolCancel,
    VoiceTurnComplete,
)
from apps.companies.live_voice.meter import Counts, Meter
from apps.companies.live_voice.setup import TOOL_NAME
from apps.companies.live_voice.store import Save
from apps.companies.live_voice.words import TIMEOUT_TOOL_DETAIL, ended_line

log = logging.getLogger(__name__)

SERVICE_RESTART: Final = 1012  # uvicorn closes a socket with this when the backend stops
POLICY: Final = 1008  # the close code for a browser that broke a cap
NORMAL: Final = 1000
TEXT_MAX_CHARS: Final = 2_000  # a transcript piece passed to the browser
HANDLE_MAX_CHARS: Final = 4_096
MAX_WAITING_CALLS: Final = 3  # tool calls waiting for the browser at once
# The words Gemini gets when the browser's answer has none, and the relay's own answers.
SAY_FOR: Final[dict[str, str]] = {
    "ok": "Done.",
    "unsure": "I'm not sure. Can you say that again?",
    "error": "That didn't work. Try again.",
    "timeout": TIMEOUT_TOOL_DETAIL,
}
WRONG_TOOL_WORDS: Final = "Use ask_contour, with the rep's request in their words."
BUSY_TOOL_WORDS: Final = "One thing at a time. Wait for the last answer first."
LIMIT_TOOL_WORDS: Final = "This month's live voice limit is reached. Say so in one sentence."
_DURATION: Final = re.compile(r"\s*(\d+(?:\.\d+)?)s\s*")
TAKEN_AT_ONCE: Final = frozenset({"usageMetadata", "sessionResumptionUpdate"})


@dataclass(frozen=True)
class RelayLimits:
    """The relay's numbers (choices 15 and 20; all TBC). Tests make them small."""

    talk_seconds: float = 30 * 60
    idle_seconds: float = 5 * 60
    tool_seconds: float = 20
    save_every_seconds: float = 30
    open_seconds: float = 10  # Google's connection, with its setupComplete
    limit_finish_seconds: float = 8  # Gemini finishes its sentence at the month's limit
    resume_window_seconds: float = 10
    resume_tries: int = 2
    steady_seconds: float = 10  # a connection up this long starts the count of tries again
    quiet_seconds: float = 0.3  # no sound from the rep for this long: a quiet moment to move
    move_lead_seconds: float = 10  # at goAway, move at once when this little time is left
    old_drain_seconds: float = 2  # after a move, the old connection's last counts
    tick_seconds: float = 0.25
    audio_burst_seconds: float = 3  # how much sound may come at once, at the most rate
    text_per_second: float = 10
    text_burst: int = 20
    buffer_seconds: float = 3  # the rep's sound kept while a connection is replaced


class BrowserSocket(Protocol):
    """The browser's side, as Starlette's WebSocket has it."""

    async def receive(self) -> MutableMapping[str, Any]: ...

    async def send_text(self, data: str) -> None: ...

    async def send_bytes(self, data: bytes) -> None: ...

    async def close(self, code: int = 1000, reason: str | None = None) -> None: ...


class Rows(Protocol):
    """Where the relay writes its talk's row (the database, or a test's list)."""

    async def save(self, saved: Save) -> None: ...

    async def finish(self, saved: Save, *, status: str, reason: str) -> None: ...


class Budget(Protocol):
    """The month's limit, and what every other talk has spent this month."""

    async def read(self, talk_id: uuid.UUID) -> tuple[Decimal, Decimal]: ...


type Dial = Callable[[str | None, float], Awaitable[GoogleLink]]  # (handle, seconds) -> link


@dataclass
class Bucket:
    """A rate cap: `rate` a second on average, `burst` at once."""

    rate: float
    burst: float
    level: float = -1.0
    at: float = 0.0

    def take(self, amount: float, now: float) -> bool:
        if self.level < 0:
            self.level, self.at = self.burst, now
        self.level = min(self.burst, self.level + (now - self.at) * self.rate)
        self.at = now
        if amount > self.level:
            return False
        self.level -= amount
        return True


@dataclass
class Waiting:
    """A tool call sent to the browser, waiting for its answer."""

    name: str
    timer: asyncio.TimerHandle = field(repr=False)


def seconds_of(value: Any) -> float | None:
    """Google's Duration as seconds: "50s", "1.5s", {"seconds": 50, "nanos": 0} or a number."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        found = _DURATION.fullmatch(value)
        return float(found.group(1)) if found else None
    if isinstance(value, Mapping):
        try:
            return float(value.get("seconds") or 0) + float(value.get("nanos") or 0) / 1e9
        except (TypeError, ValueError):
            return None
    return None


def _text(value: Any) -> str | None:
    """A transcript piece, or None. Cut to a size the browser can show."""
    if isinstance(value, Mapping):
        text = value.get("text")
        if isinstance(text, str) and text:
            return text[:TEXT_MAX_CHARS]
    return None


def _request(text: str) -> str:
    """Gemini's request as the command step takes it: no NUL, and its length cap."""
    return text.replace("\x00", "").strip()[:REQUEST_MAX_CHARS]


def _where(error: BaseException) -> str:
    """Where an error happened (a file and a line), never its message: a message can hold
    words."""
    frames = traceback.extract_tb(error.__traceback__)
    if not frames:
        return ""
    last = frames[-1]
    return f"{Path(last.filename).name}:{last.lineno}"


class Relay:
    """One talk. `run` carries it until it ends, then writes its row."""

    def __init__(
        self,
        *,
        talk_id: uuid.UUID,
        owner: uuid.UUID | None,
        browser: BrowserSocket,
        dial: Dial,
        rows: Rows,
        budget: Budget,
        meter: Meter,
        limits: RelayLimits | None = None,
        talk_minutes: int = 30,
        handle: str | None = None,
        resumed: bool = False,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.talk_id = talk_id
        self.owner = owner
        self._browser = browser
        self._dial = dial
        self._rows = rows
        self._budget = budget
        self._meter = meter
        self._limits = limits or RelayLimits()
        self._talk_minutes = talk_minutes
        self._handle = handle  # a secret: never logged, never sent to the browser
        self._resumed = resumed
        self._clock = clock
        self._loop = asyncio.get_running_loop()
        self._log: dict[str, Any] = {"talk": str(talk_id)}

        self._link: GoogleLink | None = None  # where the rep's sound goes now
        self._next: GoogleLink | None = None  # goAway: the new connection, ready to take over
        self._next_early: list[dict[str, Any]] = []  # its content before the move
        self._retired: set[GoogleLink] = set()  # old connections, giving their last counts
        self._old_forward = False  # an old connection's sentence is still being passed on
        self._moving = False
        self._streak = 0  # connections lost in a row (T1-4)
        self._resumed_at = float("-inf")

        self._waiting: dict[str, Waiting] = {}
        self._held_answers: list[tuple[str, str, dict[str, Any]]] = []  # while reconnecting
        self._sound: deque[bytes] = deque()  # the rep's sound while reconnecting
        self._sound_bytes = 0
        self._tool_timeouts = 0
        self._late_answers = 0

        self._speaking = False  # Gemini is in the middle of a turn
        self._rep_heard_at = float("-inf")
        self._opened = clock()
        self._browser_seen_at = self._opened
        self._limit_hit_at: float | None = None
        self._cap = Decimal("0")
        self._others = Decimal("0")
        rate = SAMPLE_RATE_IN * 2 * AUDIO_RATE_MAX
        self._sound_cap = Bucket(rate=rate, burst=rate * self._limits.audio_burst_seconds)
        self._text_cap = Bucket(rate=self._limits.text_per_second, burst=self._limits.text_burst)

        self._ending = asyncio.Event()
        self._end_reason: EndReason | None = None
        self._done = asyncio.Event()
        self._shut: set[str] = set()  # the shutdown's steps already taken
        self._browser_gone = False
        self._tasks: set[asyncio.Task[None]] = set()
        self._saving: asyncio.Task[None] | None = None
        self._opening: asyncio.Future[GoogleLink] | None = None  # the first connection

    # --- For the registry -------------------------------------------------------------------------

    def cost_usd(self) -> Decimal:
        return self._meter.cost_usd()

    def counts(self) -> Counts:
        """What the talk has counted so far (its row may be up to 30 seconds behind)."""
        return self._counts()

    def end(self, reason: EndReason) -> None:
        """Ends the talk (the first reason wins). The relay closes both sides and writes its row."""
        if self._end_reason is None:
            self._end_reason = reason
            self._ending.set()

    async def finished(self) -> None:
        await self._done.wait()

    # --- The talk ---------------------------------------------------------------------------------

    async def run(self) -> None:
        try:
            await self._run()
        except asyncio.CancelledError:
            # The backend is stopping: close both sides, and keep the talk for a resume. A
            # shutdown already under way finishes the steps it hadn't reached.
            self.end("restart")
            await self._shutdown()
            raise
        except Exception as error:
            log.error(
                "live_voice_fault",
                extra={**self._log, "kind": type(error).__name__, "where": _where(error)},
            )
            self.end("error")
            await self._shutdown()
        finally:
            self._done.set()

    async def _run(self) -> None:
        await self._read_budget()
        if self._others + self.cost_usd() >= self._cap:
            self.end("limit")
            await self._shutdown()
            return
        self._spawn(self._from_browser())
        opening = self._spawn_link(self._dial(self._handle, self._limits.open_seconds))
        self._opening = opening
        ending = asyncio.ensure_future(self._ending.wait())
        waits: set[asyncio.Future[Any]] = {opening, ending}
        try:
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
        finally:
            ending.cancel()
            if not opening.done():
                opening.cancel()  # the talk ended while Google opened: stop opening
        if opening.cancelled():
            await asyncio.gather(opening, return_exceptions=True)
            await self._shutdown()
            return
        try:
            link = opening.result()
        except GoogleUnavailable as error:
            log.warning(
                "live_voice_unreachable", extra={**self._log, "why": error.why, "code": error.code}
            )
            self.end("unreachable")
            await self._shutdown()
            return
        if self._ending.is_set():
            await link.close()
            await self._shutdown()
            return
        self._use(link)
        log.info("live_voice_open", extra={**self._log, "resumed": self._resumed})
        await self._send(VoiceReady(resumed=self._resumed))
        await self._flush_waiting()
        self._spawn(self._timers())
        await self._ending.wait()
        await self._shutdown()

    def _spawn(self, work: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
        task = asyncio.ensure_future(self._guarded(work))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        # A task stopped before it began leaves its work never started: close it quietly.
        task.add_done_callback(lambda _: work.close())
        return task

    def _spawn_link(self, work: Awaitable[GoogleLink]) -> "asyncio.Future[GoogleLink]":
        return asyncio.ensure_future(work)

    async def _guarded(self, work: Coroutine[Any, Any, None]) -> None:
        """A task that fails ends the talk, with where it failed (never its message)."""
        try:
            await work
        except asyncio.CancelledError:
            raise
        except Exception as error:
            log.error(
                "live_voice_fault",
                extra={**self._log, "kind": type(error).__name__, "where": _where(error)},
            )
            self.end("error")

    def _use(self, link: GoogleLink) -> None:
        self._link = link
        self._spawn(self._from_google(link))

    # --- The end ----------------------------------------------------------------------------------

    async def _shutdown(self) -> None:
        """Stops the talk's tasks, writes the row, closes both sides and logs the end. Each step
        runs once, so a shutdown cut short (the backend stopping) can be finished by calling it
        again."""
        reason: EndReason = self._end_reason or "error"
        if "tasks" not in self._shut:
            self._shut.add("tasks")
            current = asyncio.current_task()
            tasks = [task for task in self._tasks if task is not current]
            for task in tasks:
                task.cancel()
            for waiting in self._waiting.values():
                waiting.timer.cancel()
            self._waiting.clear()
            try:
                await asyncio.gather(*tasks, return_exceptions=True)
            finally:
                await self._write_end(reason)
        await self._write_end(reason)
        if "sides" not in self._shut:
            self._shut.add("sides")
            links = [self._link, self._next, *self._retired, self._spare()]
            for link in links:
                if link is not None:
                    await link.close()
            if reason not in ("restart", "left"):
                line = ended_line(reason, talk_minutes=self._talk_minutes)
                await self._send(VoiceEnded(reason=reason, line=line))
                await self._close_browser(POLICY if reason == "refused" else NORMAL)

    def _spare(self) -> GoogleLink | None:
        """A first connection that opened just as the talk ended: never used, so closed."""
        opening = self._opening
        if opening is None or not opening.done() or opening.cancelled():
            return None
        if opening.exception() is not None:
            return None
        link = opening.result()
        return None if link is self._link else link

    def _status(self, reason: EndReason) -> str:
        """`dropped` when the backend stopped and the talk can carry on, else `ended`."""
        return "dropped" if reason == "restart" and self._handle else "ended"

    async def _write_end(self, reason: EndReason) -> None:
        if "row" in self._shut:
            return
        self._shut.add("row")
        status = self._status(reason)
        counts = self._counts()
        saved = Save(counts, self._handle if status == "dropped" else None)
        try:
            await self._rows.finish(saved, status=status, reason=reason)
        except Exception as error:
            log.error(
                "live_voice_row_failed",
                extra={**self._log, "kind": type(error).__name__, "where": _where(error)},
            )
        log.info(
            "live_voice_end",
            extra={
                **self._log,
                "reason": reason,
                "status": status,
                "seconds": counts.talk_seconds,
                "listen_seconds": counts.listen_seconds,
                "speak_seconds": counts.speak_seconds,
                "tool_calls": counts.tool_calls,
                "tool_timeouts": self._tool_timeouts,
                "late_answers": self._late_answers,
                "reconnects": counts.reconnects,
                "tokens_in": counts.tokens.taken_in,
                "tokens_out": counts.tokens.given_out,
                "cost_usd": str(counts.cost_usd),
            },
        )

    def _counts(self) -> Counts:
        return self._meter.counts(self._clock() - self._opened)

    # --- To the browser ---------------------------------------------------------------------------

    async def _send(self, message: BaseModel) -> None:
        if self._browser_gone:
            return
        try:
            await self._browser.send_text(message.model_dump_json())
        except Exception:
            self._browser_gone = True
            self.end("left")

    async def _send_sound(self, sound: bytes) -> None:
        if self._browser_gone:
            return
        try:
            await self._browser.send_bytes(sound)
        except Exception:
            self._browser_gone = True
            self.end("left")

    async def _close_browser(self, code: int) -> None:
        if self._browser_gone:
            return
        self._browser_gone = True
        with contextlib.suppress(Exception):
            await self._browser.close(code)

    # --- From the browser -------------------------------------------------------------------------

    async def _from_browser(self) -> None:
        while not self._ending.is_set():
            try:
                message = await self._browser.receive()
            except Exception:
                self._browser_gone = True
                self.end("left")
                return
            kind = message.get("type")
            if kind == "websocket.disconnect":
                self._browser_gone = True
                self.end("restart" if message.get("code") == SERVICE_RESTART else "left")
                return
            if kind != "websocket.receive":
                continue
            self._browser_seen_at = self._clock()
            data, text = message.get("bytes"), message.get("text")
            if data is not None:
                await self._on_sound(bytes(data))
            elif text is not None:
                await self._on_text(str(text))

    def _refuse(self, why: str) -> None:
        log.warning("live_voice_refused", extra={**self._log, "why": why})
        self.end("refused")

    async def _on_sound(self, sound: bytes) -> None:
        if len(sound) > MAX_BINARY_BYTES:
            self._refuse("too_big")
            return
        if len(sound) % 2:
            self._refuse("not_sound")  # 16-bit samples come in pairs of bytes
            return
        now = self._clock()
        if not self._sound_cap.take(len(sound), now):
            self._refuse("too_fast")
            return
        if not sound or self._limit_hit_at is not None:
            return  # nothing, or the month's limit: no new talk
        self._meter.listen_bytes += len(sound)
        self._rep_heard_at = now
        link = self._link
        if link is None:
            self._keep_sound(sound)
            return
        try:
            await link.send_audio(sound)
        except LinkClosed:
            self._keep_sound(sound)  # the drop is handled where Google's messages are read

    def _keep_sound(self, sound: bytes) -> None:
        """The rep's sound while a connection is replaced: the newest few seconds."""
        self._sound.append(sound)
        self._sound_bytes += len(sound)
        most = SAMPLE_RATE_IN * 2 * self._limits.buffer_seconds
        while self._sound_bytes > most and self._sound:
            self._sound_bytes -= len(self._sound.popleft())

    async def _on_text(self, text: str) -> None:
        if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
            self._refuse("too_big")
            return
        if not self._text_cap.take(1, self._clock()):
            self._refuse("too_fast")
            return
        try:
            message = BROWSER_MESSAGE.validate_json(text)
        except ValidationError:
            self._refuse("not_ours")  # never the message's text: it may hold words
            return
        if isinstance(message, VoiceStop):
            self.end("stopped")
        elif isinstance(message, VoicePause):
            link = self._link
            if link is not None:
                with contextlib.suppress(LinkClosed):
                    await link.send_audio_end()
        elif isinstance(message, VoiceToolAnswer):
            await self._answer(message)

    async def _answer(self, answer: VoiceToolAnswer) -> None:
        waiting = self._waiting.pop(answer.id, None)
        if waiting is None:
            self._late_answers += 1  # timed out or cancelled already: Google has its answer
            return
        waiting.timer.cancel()
        # No email address or phone number goes to Google, whatever the card's line held.
        words = scrub(answer.message).strip() or SAY_FOR[answer.status]
        await self._tool_response(answer.id, waiting.name, answer.status, answer.retryable, words)

    async def _tool_response(
        self, call_id: str, name: str, status: ToolStatus, retryable: bool, message: str
    ) -> None:
        """An answer to Google's tool call: never empty (Google's advice), spoken once the rep is
        quiet (`WHEN_IDLE`, inside `response`, as Google's own example has it: TBC at S1)."""
        response = {
            "status": status,
            "retryable": retryable,
            "message": message,
            "scheduling": "WHEN_IDLE",
        }
        link = self._link
        if link is None:
            self._held_answers.append((call_id, name, response))
            return
        try:
            await link.send_tool_response(call_id, name, response)
        except LinkClosed:
            self._held_answers.append((call_id, name, response))

    async def _flush_waiting(self) -> None:
        """What waited while there was no connection: the rep's sound, then the tool answers."""
        link = self._link
        if link is None:
            return
        while self._sound:
            sound = self._sound.popleft()
            self._sound_bytes -= len(sound)
            try:
                await link.send_audio(sound)
            except LinkClosed:
                self._sound.appendleft(sound)
                self._sound_bytes += len(sound)
                return
        held, self._held_answers = self._held_answers, []
        for call_id, name, response in held:
            try:
                await link.send_tool_response(call_id, name, response)
            except LinkClosed:
                self._held_answers.append((call_id, name, response))

    # --- From Google ------------------------------------------------------------------------------

    async def _from_google(self, link: GoogleLink) -> None:
        try:
            for message in link.early:
                await self._on_google(link, message)
            link.early = []
            while True:
                await self._on_google(link, await link.receive())
        except LinkClosed as closed:
            await self._lost(link, closed)

    async def _on_google(self, link: GoogleLink, message: Mapping[str, Any]) -> None:
        usage = message.get("usageMetadata")
        if isinstance(usage, Mapping):
            self._meter.add_usage(usage, link)
            self._check_limit()
        update = message.get("sessionResumptionUpdate")
        if isinstance(update, Mapping) and link not in self._retired:
            self._keep_handle(update)
        if link is self._next:
            # Passed on once the talk moves to it; its counts and handle are taken already.
            rest = {k: v for k, v in message.items() if k not in TAKEN_AT_ONCE}
            if rest:
                self._next_early.append(rest)
            return
        if link in self._retired:
            content = message.get("serverContent")
            if self._old_forward and isinstance(content, Mapping):
                await self._content(content)  # the end of a sentence begun before the move
                if content.get("turnComplete") is True or content.get("interrupted") is True:
                    self._old_forward = False
            return
        if link is not self._link:
            return
        content = message.get("serverContent")
        if isinstance(content, Mapping):
            await self._content(content)
        for key in ("inputTranscription", "outputTranscription"):  # Agent Platform: top level
            if key in message and not (isinstance(content, Mapping) and key in content):
                await self._content({key: message[key]})
        calls = message.get("toolCall")
        if isinstance(calls, Mapping):
            await self._tool_calls(calls)
        cancelled = message.get("toolCallCancellation")
        if isinstance(cancelled, Mapping):
            await self._cancel(cancelled)
        going = message.get("goAway")
        if isinstance(going, Mapping):
            self._go_away(going)

    async def _content(self, content: Mapping[str, Any]) -> None:
        turn = content.get("modelTurn")
        parts = turn.get("parts") if isinstance(turn, Mapping) else None
        for part in parts if isinstance(parts, list) else []:
            inline = part.get("inlineData") if isinstance(part, Mapping) else None
            if not isinstance(inline, Mapping):
                continue
            if not str(inline.get("mimeType", "")).startswith("audio/"):
                continue
            data = inline.get("data")
            if not isinstance(data, str):
                continue
            try:
                sound = base64.b64decode(data, validate=True)
            except (binascii.Error, ValueError):
                continue
            if sound:
                self._meter.speak_bytes += len(sound)
                self._speaking = True
                await self._send_sound(sound)
        for key, interim in (("inputTranscription", False), ("interimInputTranscription", True)):
            heard = content.get(key)
            text = _text(heard)
            if text is not None:
                final = isinstance(heard, Mapping) and heard.get("finished") is True
                await self._send(VoiceHeard(text=text, final=final, interim=interim))
        said = _text(content.get("outputTranscription"))
        if said is not None:
            await self._send(VoiceSaid(text=said))
        cancelled = content.get("toolCallCancellation")
        if isinstance(cancelled, Mapping):  # the Agent Platform's docs put it here too
            await self._cancel(cancelled)
        if content.get("interrupted") is True:
            self._speaking = False
            await self._send(VoiceInterrupted())
            if self._limit_hit_at is not None:
                self.end("limit")
        if content.get("turnComplete") is True:
            self._speaking = False
            await self._send(VoiceTurnComplete())
            if self._limit_hit_at is not None:
                self.end("limit")

    async def _tool_calls(self, calls: Mapping[str, Any]) -> None:
        found = calls.get("functionCalls")
        for call in found if isinstance(found, list) else []:
            if not isinstance(call, Mapping):
                continue
            call_id, name, args = call.get("id"), call.get("name"), call.get("args")
            if not isinstance(call_id, str) or not call_id or len(call_id) > ID_MAX_CHARS:
                log.warning("live_voice_tool_without_id", extra=self._log)
                continue
            named = name if isinstance(name, str) and name else TOOL_NAME
            request = args.get("request") if isinstance(args, Mapping) else None
            if name != TOOL_NAME or not isinstance(request, str) or not _request(request):
                log.warning("live_voice_wrong_tool", extra=self._log)
                await self._tool_response(call_id, named, "error", False, WRONG_TOOL_WORDS)
                continue
            if self._limit_hit_at is not None:
                await self._tool_response(call_id, named, "error", False, LIMIT_TOOL_WORDS)
                continue
            if call_id in self._waiting:
                continue  # the same call again
            if len(self._waiting) >= MAX_WAITING_CALLS:
                await self._tool_response(call_id, named, "error", True, BUSY_TOOL_WORDS)
                continue
            self._meter.tool_calls += 1
            timer = self._loop.call_later(self._limits.tool_seconds, self._timed_out, call_id)
            self._waiting[call_id] = Waiting(name=named, timer=timer)
            await self._send(VoiceToolCall(id=call_id, request=_request(request)))

    def _timed_out(self, call_id: str) -> None:
        waiting = self._waiting.pop(call_id, None)
        if waiting is None or self._ending.is_set():
            return
        self._tool_timeouts += 1
        self._spawn(self._answer_for_the_browser(call_id, waiting.name))

    async def _answer_for_the_browser(self, call_id: str, name: str) -> None:
        await self._tool_response(call_id, name, "timeout", False, TIMEOUT_TOOL_DETAIL)
        await self._send(VoiceToolCancel(ids=[call_id]))

    async def _cancel(self, cancelled: Mapping[str, Any]) -> None:
        ids = cancelled.get("ids")
        stopped: list[str] = []
        for call_id in ids if isinstance(ids, list) else []:
            waiting = self._waiting.pop(call_id, None) if isinstance(call_id, str) else None
            if waiting is not None:
                waiting.timer.cancel()
                stopped.append(call_id)
        if stopped:
            await self._send(VoiceToolCancel(ids=stopped))

    def _keep_handle(self, update: Mapping[str, Any]) -> None:
        """Only a handle Google says can resume (not one from the middle of a turn)."""
        handle = update.get("newHandle")
        if update.get("resumable") is not True or not isinstance(handle, str):
            return
        if not handle or len(handle) > HANDLE_MAX_CHARS:
            return
        first = self._handle is None
        self._handle = handle
        if first:
            self._save_soon()  # so a backend that dies early can still resume it

    # --- The month's limit ------------------------------------------------------------------------

    async def _read_budget(self) -> None:
        self._cap, self._others = await self._budget.read(self.talk_id)

    def _check_limit(self) -> None:
        if self._limit_hit_at is not None or self._ending.is_set():
            return
        if self._others + self.cost_usd() < self._cap:
            return
        self._limit_hit_at = self._clock()
        log.info("live_voice_limit", extra={**self._log, "cap_usd": str(self._cap)})
        if not self._speaking:
            self.end("limit")  # Gemini isn't mid-sentence: end now

    # --- Timers and the row -----------------------------------------------------------------------

    async def _timers(self) -> None:
        limits = self._limits
        next_save = self._clock() + limits.save_every_seconds
        while not self._ending.is_set():
            await asyncio.sleep(limits.tick_seconds)
            now = self._clock()
            # A talk that carried on after a restart keeps the time it had already.
            if now - self._opened + self._meter.start.talk_seconds >= limits.talk_seconds:
                self.end("time_limit")
            elif now - self._browser_seen_at >= limits.idle_seconds:
                self.end("idle")
            elif self._limit_hit_at is not None and (
                now - self._limit_hit_at >= limits.limit_finish_seconds
            ):
                self.end("limit")
            elif now >= next_save:
                next_save = now + limits.save_every_seconds
                self._save_soon()

    def _save_soon(self) -> None:
        if self._saving is None or self._saving.done():
            self._saving = self._spawn(self._save())

    async def _save(self) -> None:
        try:
            await self._rows.save(Save(self._counts(), self._handle))
            await self._read_budget()
        except Exception as error:
            log.warning(
                "live_voice_save_failed",
                extra={**self._log, "kind": type(error).__name__, "where": _where(error)},
            )
            return
        self._check_limit()

    # --- Long talks and drops (T1-4) --------------------------------------------------------------

    def _quiet(self) -> bool:
        heard_ago = self._clock() - self._rep_heard_at
        return not self._speaking and not self._waiting and heard_ago >= self._limits.quiet_seconds

    def _go_away(self, going: Mapping[str, Any]) -> None:
        left = seconds_of(going.get("timeLeft"))
        log.info("live_voice_go_away", extra={**self._log, "seconds_left": left})
        if self._moving or self._handle is None:
            return  # nothing to move with: when it closes, the drop is handled
        self._moving = True
        deadline = self._clock() + (left if left is not None else self._limits.move_lead_seconds)
        self._spawn(self._move(deadline))

    async def _move(self, deadline: float) -> None:
        try:
            seconds = max(1.0, min(self._limits.open_seconds, deadline - self._clock()))
            try:
                new = await self._dial(self._handle, seconds)
            except GoogleUnavailable as error:
                log.warning(
                    "live_voice_move_failed",
                    extra={**self._log, "why": error.why, "code": error.code},
                )
                if self._link is None:
                    await self._resume()  # the old one is gone already
                return
            if self._ending.is_set():
                await new.close()
                return
            self._next = new
            self._spawn(self._from_google(new))
            move_at = deadline - self._limits.move_lead_seconds
            while self._link is not None and self._clock() < move_at and not self._quiet():
                await asyncio.sleep(min(0.05, self._limits.tick_seconds))
                if self._next is not new:
                    return  # it closed before the move: the old one carries on until it drops
            if self._next is new:
                await self._take_over(new)
        finally:
            self._moving = False

    async def _take_over(self, new: GoogleLink) -> None:
        """The talk moves to `new`. The old connection passes on the end of a sentence it was
        saying, gives its last counts, then closes."""
        old, self._link, self._next = self._link, new, None
        self._meter.reconnects += 1
        self._resumed_at = self._clock()
        early, self._next_early = self._next_early, []
        if old is not None:
            self._retired.add(old)
            self._old_forward = self._speaking
            self._spawn(self._retire(old))
        log.info("live_voice_moved", extra={**self._log, "old_speaking": self._old_forward})
        await self._flush_waiting()
        for message in early:
            await self._on_google(new, message)

    async def _retire(self, old: GoogleLink) -> None:
        waited = 0.0
        step = min(0.05, self._limits.tick_seconds)
        while self._old_forward and waited < self._limits.move_lead_seconds:
            await asyncio.sleep(step)
            waited += step
        self._old_forward = False
        await asyncio.sleep(self._limits.old_drain_seconds)
        await old.close()
        self._retired.discard(old)

    async def _lost(self, link: GoogleLink, closed: LinkClosed) -> None:
        """A connection closed. Only the one in use, closed by Google, is a drop."""
        if link is self._next:
            self._next = None
            self._next_early = []
            return
        if link is not self._link or link.closing or self._ending.is_set():
            return
        log.warning("live_voice_dropped", extra={**self._log, "code": closed.code})
        self._link = None  # the rep's sound waits
        self._speaking = False  # its sentence never finishes: don't wait for it
        if self._next is not None:
            await self._take_over(self._next)
            return
        if self._moving:
            return  # the move's new connection takes over as soon as it opens
        await self._resume()

    async def _resume(self) -> None:
        if self._handle is None:
            self.end("dropped")
            return
        now = self._clock()
        if now - self._resumed_at >= self._limits.steady_seconds:
            self._streak = 0
        await self._send(VoiceReconnecting())
        deadline = now + self._limits.resume_window_seconds
        while self._streak < self._limits.resume_tries and not self._ending.is_set():
            self._streak += 1
            left = deadline - self._clock()
            if left <= 0:
                break
            try:
                new = await self._dial(self._handle, min(self._limits.open_seconds, left))
            except GoogleUnavailable as error:
                log.warning(
                    "live_voice_resume_failed",
                    extra={**self._log, "try": self._streak, "why": error.why, "code": error.code},
                )
                continue
            if self._ending.is_set():
                await new.close()
                return
            self._resumed_at = self._clock()
            self._meter.reconnects += 1
            self._use(new)
            log.info("live_voice_resumed", extra={**self._log, "try": self._streak})
            await self._flush_waiting()
            await self._send(VoiceReconnected())
            return
        self.end("dropped")
