"""What a property record means for the Lead Finder: a sign, a dampener, or neither (PLAN-V16).

Plain code, the same for every tool. A feed item gets its sign or dampener here (`FeedItem`), so
discovery knows why a company came up. The research (Track 1, T1-8) reads the records itself.

- A lease that ends in 12 to 36 months: `lease_ending`.
- A move (a new office committed or planned): `lease_ending` too, whose label says "or a
  relocation".
- A need for space (a company in the market): `tenant_advisor` (PLAN-V16 T1-4, T1-8).
- A fitout already given to a designer or builder: the dampener `recent_fitout` (TBC: the id is
  Track 1's, in T1-5).
"""

from datetime import date
from typing import Final

from core.sources.types import FeedItem, PropertyRecord

LEASE_ENDING: Final = "lease_ending"
TENANT_ADVISOR: Final = "tenant_advisor"
RECENT_FITOUT: Final = "recent_fitout"


def months_until(day: date, today: date) -> int:
    return (day.year - today.year) * 12 + (day.month - today.month)


def meaning(record: PropertyRecord, today: date) -> tuple[str | None, str | None]:
    """(sign id, dampener id) for one record."""
    if record.kind == "lease" and record.lease_end is not None:
        if 12 <= months_until(record.lease_end, today) <= 36:
            return LEASE_ENDING, None
        return None, None
    if record.kind == "move":
        return LEASE_ENDING, None
    if record.kind == "requirement":
        return TENANT_ADVISOR, None
    if record.kind == "fitout":
        return None, RECENT_FITOUT
    return None, None


def as_feed_item(record: PropertyRecord, today: date) -> FeedItem:
    sign, dampener = meaning(record, today)
    return FeedItem(**record.model_dump(), sign_id=sign, dampener_id=dampener)
