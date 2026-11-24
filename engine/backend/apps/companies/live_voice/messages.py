"""The messages on live voice's socket (PLAN-V28 T1-3): one list, both ways.

**Sound is binary frames**, never JSON:
- browser to relay: 16-bit PCM, mono, 16 kHz, little-endian, in 20 ms pieces (640 bytes);
- relay to browser: Gemini's 16-bit PCM at 24 kHz, as Google sent it.

**Everything else is a JSON text frame with a `type`:**

| From the browser | What it does |
|---|---|
| `pause` | The rep went quiet (the browser's silence gate): Google's `audioStreamEnd` |
| `tool_answer` | The answer to a `tool_call`, with the same `id` |
| `stop` | Ends the talk |

| From the relay | What it says |
|---|---|
| `ready` | Google is ready: the browser may send sound now |
| `heard` | The rep's words as Google heard them (`final`: finished; `interim`: a guess) |
| `said` | The Assistant's words as it says them |
| `interrupted` | The rep talked over the Assistant: stop its sound at once |
| `turn_complete` | The Assistant finished its turn |
| `tool_call` | Gemini asks Contour (`request`): run the command step, then send a `tool_answer` |
| `tool_cancel` | Stop working on these tool calls: Google cancelled them, or 20 s passed |
| `reconnecting`, `reconnected` | The connection to Google dropped, and the relay is resuming it |
| `ended` | The talk ended: `reason`, and `line` to show (none for a plain stop) |

The caps on what the browser sends are here too. The website's types come from these models
(`engine openapi`, then `npm run types`): `VoiceBrowserMessage` and `VoiceRelayMessage`.
"""

from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from pydantic.json_schema import JsonSchemaMode

from core.api.models import OutModel

SAMPLE_RATE_IN: Final = 16_000
SAMPLE_RATE_OUT: Final = 24_000
FRAME_MS: Final = 20
FRAME_BYTES: Final = SAMPLE_RATE_IN * 2 * FRAME_MS // 1000  # 640
MAX_BINARY_BYTES: Final = 4 * 1024  # a frame of sound from the browser
MAX_TEXT_BYTES: Final = 8 * 1024  # a JSON message from the browser
AUDIO_RATE_MAX: Final = 1.5  # sound may average at most this many times real time
MESSAGE_MAX_CHARS: Final = 500  # a tool answer's words
REQUEST_MAX_CHARS: Final = 2_000  # what Gemini asks: the command step's own limit
ID_MAX_CHARS: Final = 128  # a tool call's id

EndReason = Literal[
    "stopped",
    "left",
    "dropped",
    "unreachable",
    "time_limit",
    "limit",
    "idle",
    "replaced",
    "expired",
    "refused",
    "restart",
    "error",
]
ToolStatus = Literal["ok", "unsure", "error", "timeout"]


# --- From the browser ----------------------------------------------------------------------------


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VoicePause(_In):
    """The rep went quiet: Google may answer now. Becomes Google's `audioStreamEnd`."""

    type: Literal["pause"]


class VoiceStop(_In):
    """End the talk: Stop, V, Esc, "that's all", or the browser's 2-minute quiet stop."""

    type: Literal["stop"]


class VoiceToolAnswer(_In):
    """What Contour did with a `tool_call`, for Gemini to say. Never empty when it reaches
    Google: a blank `message` gets the status's own words."""

    type: Literal["tool_answer"]
    id: str = Field(min_length=1, max_length=ID_MAX_CHARS, description="The tool call's id")
    status: ToolStatus = Field(
        description="ok: done or ready (a card opened); unsure: `message` is a question to ask; "
        "error: it failed; timeout: it took too long"
    )
    retryable: bool = Field(False, description="Asking again may work")
    message: str = Field(
        "",
        max_length=MESSAGE_MAX_CHARS,
        description='The line for Gemini to say, like "Ready. Say send it." or Claude\'s question',
        examples=["Ready. Say send it."],
    )


type VoiceBrowserMessage = Annotated[
    VoicePause | VoiceStop | VoiceToolAnswer, Field(discriminator="type")
]
BROWSER_MESSAGE: Final[TypeAdapter[VoiceBrowserMessage]] = TypeAdapter(VoiceBrowserMessage)


# --- From the relay ------------------------------------------------------------------------------


class VoiceReady(OutModel):
    """Google is ready: send sound now."""

    type: Literal["ready"] = "ready"
    resumed: bool = Field(False, description="This talk carried on after the backend restarted")


class VoiceHeard(OutModel):
    """The rep's words as Google heard them. Shown as captions; kept nowhere."""

    type: Literal["heard"] = "heard"
    text: str
    final: bool = Field(False, description="Google says these words are finished")
    interim: bool = Field(False, description="A guess: the next `heard` replaces it")


class VoiceSaid(OutModel):
    """The Assistant's words as it says them. Shown as captions; kept nowhere."""

    type: Literal["said"] = "said"
    text: str


class VoiceInterrupted(OutModel):
    """The rep talked over the Assistant: stop its sound and empty the buffer at once."""

    type: Literal["interrupted"] = "interrupted"


class VoiceTurnComplete(OutModel):
    """The Assistant finished its turn."""

    type: Literal["turn_complete"] = "turn_complete"


class VoiceToolCall(OutModel):
    """Gemini asks Contour: run the command step with `request`, then answer with the same id."""

    type: Literal["tool_call"] = "tool_call"
    id: str
    request: str = Field(
        description="The rep's request, in their words as Gemini heard them",
        examples=["Log a call with Jo at Sample Logistics. They want a site tour next week."],
    )


class VoiceToolCancel(OutModel):
    """Stop working on these tool calls (Google cancelled them, or no answer came in time). A late
    answer is ignored."""

    type: Literal["tool_cancel"] = "tool_cancel"
    ids: list[str]


class VoiceReconnecting(OutModel):
    """The connection to Google dropped: the relay is resuming it (up to 2 tries in 10 s)."""

    type: Literal["reconnecting"] = "reconnecting"


class VoiceReconnected(OutModel):
    """The talk carries on."""

    type: Literal["reconnected"] = "reconnected"


class VoiceEnded(OutModel):
    """The talk ended. The socket closes next."""

    type: Literal["ended"] = "ended"
    reason: EndReason
    line: str | None = Field(
        description='What to show, like "Live voice can\'t reach Google. Using the free mic." '
        "None for a plain stop"
    )


type VoiceRelayMessage = Annotated[
    VoiceReady
    | VoiceHeard
    | VoiceSaid
    | VoiceInterrupted
    | VoiceTurnComplete
    | VoiceToolCall
    | VoiceToolCancel
    | VoiceReconnecting
    | VoiceReconnected
    | VoiceEnded,
    Field(discriminator="type"),
]
RELAY_MESSAGE: Final[TypeAdapter[VoiceRelayMessage]] = TypeAdapter(VoiceRelayMessage)

# For the API contract (core.apps.AppSpec.schemas): what the browser sends is read as a request,
# and what the relay sends is written as an answer.
CONTRACT: Final[tuple[tuple[Any, JsonSchemaMode], ...]] = (
    (VoiceBrowserMessage, "validation"),
    (VoiceRelayMessage, "serialization"),
)
