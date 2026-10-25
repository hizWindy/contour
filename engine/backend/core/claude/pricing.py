"""What each Claude request costs, in US dollars.

Prices are from Anthropic's pricing page, checked 25 Oct 2026. Update this table when they
change. Web fetch has no extra charge; only the page's tokens count.
"""

from dataclasses import dataclass
from decimal import Decimal

MILLION = Decimal(1_000_000)
WEB_SEARCH_USD = Decimal("0.01")  # $10 per 1,000 searches
CACHE_WRITE_MULTIPLIER = Decimal("1.25")  # writing the 5-minute cache costs 1.25x input


@dataclass(frozen=True)
class Price:
    """US dollars per million tokens."""

    input: Decimal
    output: Decimal
    cache_read: Decimal


PRICES: dict[str, Price] = {
    "claude-opus-5-5": Price(Decimal("4"), Decimal("20"), Decimal("0.20")),
    "claude-sonnet-5-5": Price(Decimal("2"), Decimal("10"), Decimal("0.20")),
    "claude-haiku-5-5": Price(Decimal("0.10"), Decimal("0.50"), Decimal("0.01")),
    # Fallback models the API may switch to when the main model declines a request
    "claude-opus-5": Price(Decimal("5"), Decimal("25"), Decimal("0.50")),
    "claude-opus-4-8": Price(Decimal("5"), Decimal("25"), Decimal("0.50")),
}


@dataclass(frozen=True)
class Usage:
    """What one request used. Adds up across requests."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    web_searches: int = 0
    web_fetches: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cache_read_tokens=self.cache_read_tokens + other.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens + other.cache_write_tokens,
            web_searches=self.web_searches + other.web_searches,
            web_fetches=self.web_fetches + other.web_fetches,
        )


def cost_usd(model: str, usage: Usage) -> Decimal:
    """Exact cost of one request. An unknown model is priced as Opus 5.5, to be safe."""
    price = PRICES.get(model, PRICES["claude-opus-5-5"])
    tokens = (
        usage.input_tokens * price.input
        + usage.output_tokens * price.output
        + usage.cache_read_tokens * price.cache_read
        + usage.cache_write_tokens * price.input * CACHE_WRITE_MULTIPLIER
    ) / MILLION
    return (tokens + usage.web_searches * WEB_SEARCH_USD).quantize(Decimal("0.000001"))
