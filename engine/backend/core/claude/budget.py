"""Caps on spending. Code checks them before every Claude request; Claude can't raise them."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from core.claude.client import Reply


class BudgetSpent(Exception):
    """The cap is reached. The caller stops cleanly and marks what's left as unknown."""


@dataclass
class Budget:
    cap_usd: Decimal
    max_searches: int
    spent_usd: Decimal = Decimal(0)
    searches: int = 0
    _reserved: int = field(default=0, repr=False)

    def reserve_searches(self, wanted: int) -> int:
        """Call before a request. Returns how many searches it may use (at least 1).

        Requests can run at the same time, so searches are reserved up front. The money
        cap is checked here too: once it's reached, no new request starts.
        """
        if self.spent_usd >= self.cap_usd:
            raise BudgetSpent(f"Spent ${self.spent_usd} of the ${self.cap_usd} cap")
        left = self.max_searches - self.searches - self._reserved
        if left < 1:
            raise BudgetSpent(f"Used all {self.max_searches} searches")
        granted = min(wanted, left)
        self._reserved += granted
        return granted

    def release(self, reserved: int) -> None:
        """Call when a request failed, so its reserved searches go back."""
        self._reserved -= reserved

    def check(self) -> None:
        """Call before a request with no web search."""
        if self.spent_usd >= self.cap_usd:
            raise BudgetSpent(f"Spent ${self.spent_usd} of the ${self.cap_usd} cap")

    def record(self, reply: Reply[Any], reserved: int = 0) -> None:
        """Call after a request, with what it reserved, so unused searches go back."""
        self._reserved -= reserved
        self.spent_usd += reply.cost_usd
        self.searches += reply.usage.web_searches
