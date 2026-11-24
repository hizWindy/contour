"""The meter (PLAN-V28 T1-5, choices 19 and 21): what one talk has used, in tokens and US$.

Google reports a talk's tokens in `usageMetadata`. Whether each report is that message's own count
or a running total for the connection is TBC at S1, so both are supported (`totals`, the setting
`live_voice_usage_totals`):

- **Per message** (the default): every report is added. If the reports are really running
  totals, this counts too much, which is the safe side for the month's limit.
- **Running totals:** each report replaces the last one of the same connection, and a new
  connection (after a resume) starts its own. A report that goes down is taken as a new count,
  never as a refund.

Counts only: the meter never sees a word or a sound, only the sizes of the sound it carried.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field, fields
from decimal import Decimal
from typing import Any, Final

from apps.companies.live_voice.pricing import KINDS, Prices, Tokens, cost

BYTES_PER_SECOND_IN: Final = 16_000 * 2  # 16 kHz, 16-bit, mono
BYTES_PER_SECOND_OUT: Final = 24_000 * 2  # 24 kHz, 16-bit, mono


@dataclass(frozen=True)
class Counts:
    """What a talk's row holds: tokens by kind, its US$, and its counts."""

    tokens: Tokens = field(default_factory=Tokens)
    cost_usd: Decimal = Decimal("0")
    listen_seconds: int = 0  # the rep's sound we carried to Google
    speak_seconds: int = 0  # Gemini's sound we carried back
    talk_seconds: int = 0  # how long the talk was open
    tool_calls: int = 0
    reconnects: int = 0


def _count(raw: Mapping[str, Any], name: str) -> int:
    """A whole number of tokens, or 0 for anything else (a missing field is never an error)."""
    value = raw.get(name)
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, str) and value.isdigit():  # JSON may write a 64-bit count as text
        return int(value)
    return 0


def _by_modality(details: Any) -> dict[str, int]:
    """Google's `[{modality, tokenCount}]` as {modality: tokens}."""
    found: dict[str, int] = {}
    if not isinstance(details, list):
        return found
    for item in details:
        if isinstance(item, Mapping):
            kind = str(item.get("modality") or "OTHER").upper()
            found[kind] = found.get(kind, 0) + _count(item, "tokenCount")
    return found


def read_usage(raw: Mapping[str, Any]) -> Tokens:
    """One `usageMetadata` as tokens by kind. Unknown fields are ignored. Whatever Google didn't
    say the kind of is counted as "other", at the higher price."""
    prompt = _count(raw, "promptTokenCount")
    response = _count(raw, "responseTokenCount") or _count(raw, "candidatesTokenCount")
    tool = _count(raw, "toolUsePromptTokenCount")
    thinking = _count(raw, "thoughtsTokenCount")
    cached = _count(raw, "cachedContentTokenCount")
    total = _count(raw, "totalTokenCount")
    taken = _by_modality(raw.get("promptTokensDetails"))
    given = _by_modality(raw.get("responseTokensDetails") or raw.get("candidatesTokensDetails"))
    in_audio, in_text = taken.pop("AUDIO", 0), taken.pop("TEXT", 0)
    out_audio, out_text = given.pop("AUDIO", 0), given.pop("TEXT", 0)
    stated_in = in_audio + in_text + sum(taken.values())
    stated_out = out_audio + out_text + sum(given.values())
    in_other = sum(taken.values()) + max(0, prompt - stated_in)
    out_other = sum(given.values()) + max(0, response - stated_out)
    counted = max(prompt, stated_in) + max(response, stated_out) + tool + thinking
    return Tokens(
        in_audio=in_audio,
        in_text=in_text,
        in_other=in_other,
        out_audio=out_audio,
        out_text=out_text,
        out_other=out_other,
        thinking=thinking,
        tool=tool,
        cached=cached,
        other=max(0, total - counted),
    )


def _went_down(new: Tokens, old: Tokens) -> bool:
    return any(getattr(new, name) < getattr(old, name) for name in KINDS)


class Meter:
    """One talk's tokens, sound and counts. A resumed talk starts from what its row held."""

    def __init__(self, prices: Prices, *, totals: bool, start: Counts | None = None) -> None:
        self.prices = prices
        self.totals = totals
        self.start = start or Counts()
        self._closed = Tokens()  # totals mode: the connections that are done
        self._current = Tokens()  # the newest report of this connection (totals) or every report
        self._connection: object | None = None
        self.listen_bytes = 0
        self.speak_bytes = 0
        self.tool_calls = 0
        self.reconnects = 0

    def add_usage(self, raw: Mapping[str, Any], connection: object) -> None:
        """Counts one `usageMetadata` from this connection."""
        report = read_usage(raw)
        if not self.totals:
            self._current = self._current + report
            return
        if connection is not self._connection or _went_down(report, self._current):
            self._closed = self._closed + self._current
            self._connection = connection
        self._current = report

    def new_tokens(self) -> Tokens:
        """The tokens counted since this meter started (not the row's earlier ones)."""
        return self._closed + self._current

    def tokens(self) -> Tokens:
        return self.start.tokens + self.new_tokens()

    def cost_usd(self) -> Decimal:
        """The talk's US$ so far: the row's, plus what this meter counted, priced now."""
        return self.start.cost_usd + cost(self.new_tokens(), self.prices)

    def counts(self, talk_seconds: float) -> Counts:
        """A snapshot for the row. `talk_seconds` is how long it has been open since this meter
        started."""
        return Counts(
            tokens=self.tokens(),
            cost_usd=self.cost_usd(),
            listen_seconds=self.start.listen_seconds + self.listen_bytes // BYTES_PER_SECOND_IN,
            speak_seconds=self.start.speak_seconds + self.speak_bytes // BYTES_PER_SECOND_OUT,
            talk_seconds=self.start.talk_seconds + int(talk_seconds),
            tool_calls=self.start.tool_calls + self.tool_calls,
            reconnects=self.start.reconnects + self.reconnects,
        )


def token_columns(tokens: Tokens) -> dict[str, int]:
    """The row's token columns: `tokens_<kind>` for each kind."""
    return {f"tokens_{item.name}": getattr(tokens, item.name) for item in fields(tokens)}
