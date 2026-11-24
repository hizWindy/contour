"""Live voice's prices, in one place (PLAN-V28 choice 19). US$ for a million tokens.

Google's bill is the truth: these make an estimate, and every choice here errs on the side of
counting more, so the month's limit stops spending early rather than late.

- **Audio:** in US$3.00, out US$12.00 (Google's price page for Gemini 3.8 Live, read 24 Nov
  2026).
- **Text:** TBC at S1 (Google's page didn't list it for the Live model). Until then text is
  charged at the audio prices, which are the higher ones Google lists, so it over-counts.
- **Cached prompt tokens** are counted at the full input price (Google may charge less).
- **Thinking tokens** are charged as output, and **tool prompt tokens** as input.
- **Tokens of no stated kind** are charged at the highest price on the list.

At about 25 tokens a second, a minute of listening is about US$0.0045 and a minute of Gemini
talking about US$0.018 (choice 19).
"""

from dataclasses import dataclass
from decimal import ROUND_UP, Decimal
from typing import Final, get_args

from core.config import LiveVoiceModel

PER_MILLION: Final = Decimal(1_000_000)
CENT: Final = Decimal("0.01")
MICRO: Final = Decimal("0.000001")


@dataclass(frozen=True)
class Prices:
    """US$ for a million tokens of each kind."""

    audio_in: Decimal
    audio_out: Decimal
    text_in: Decimal
    text_out: Decimal

    @property
    def most_in(self) -> Decimal:
        return max(self.audio_in, self.text_in)

    @property
    def most_out(self) -> Decimal:
        return max(self.audio_out, self.text_out)

    @property
    def most(self) -> Decimal:
        return max(self.most_in, self.most_out)


PRICES: Final[dict[str, Prices]] = {
    "gemini-3.8-live": Prices(
        audio_in=Decimal("3.00"),
        audio_out=Decimal("12.00"),
        text_in=Decimal("3.00"),  # TBC at S1: the audio price until then (the safe side)
        text_out=Decimal("12.00"),  # TBC at S1
    ),
}

# Every model the settings allow has its prices (a test checks this list against the settings).
MODELS: Final[tuple[str, ...]] = get_args(LiveVoiceModel)


@dataclass(frozen=True)
class Tokens:
    """A talk's tokens by kind, as Google reports them (`usageMetadata`). "Other" is a part Google
    didn't say the kind of: input at the higher input price, output at the higher output price,
    and anything else at the highest price of all."""

    in_audio: int = 0
    in_text: int = 0
    in_other: int = 0
    out_audio: int = 0
    out_text: int = 0
    out_other: int = 0
    thinking: int = 0  # output
    tool: int = 0  # tool-use prompt tokens: input
    cached: int = 0  # part of the input, already counted there: shown, never charged again
    other: int = 0  # neither input nor output said: the highest price

    def __add__(self, more: "Tokens") -> "Tokens":
        return Tokens(**{name: getattr(self, name) + getattr(more, name) for name in KINDS})

    @property
    def taken_in(self) -> int:
        return self.in_audio + self.in_text + self.in_other + self.tool

    @property
    def given_out(self) -> int:
        return self.out_audio + self.out_text + self.out_other + self.thinking


KINDS: Final[tuple[str, ...]] = tuple(Tokens.__dataclass_fields__)


def prices_for(model: str) -> Prices:
    """The prices of this model. A model with none is refused before any talk starts."""
    try:
        return PRICES[model]
    except KeyError:
        raise LookupError(f"No live voice prices for {model}: add them to pricing.py") from None


def cost(tokens: Tokens, prices: Prices) -> Decimal:
    """What these tokens cost in US$, exact, to a millionth (rounded up)."""
    total = (
        tokens.in_audio * prices.audio_in
        + tokens.in_text * prices.text_in
        + (tokens.in_other + tokens.tool) * prices.most_in
        + tokens.out_audio * prices.audio_out
        + tokens.out_text * prices.text_out
        + (tokens.out_other + tokens.thinking) * prices.most_out
        + tokens.other * prices.most
    ) / PER_MILLION
    return total.quantize(MICRO, rounding=ROUND_UP)


def about(usd: Decimal) -> Decimal:
    """A cost shown to a person: whole cents, rounded up."""
    return usd.quantize(CENT, rounding=ROUND_UP)
