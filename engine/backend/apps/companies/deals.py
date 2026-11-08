"""What a deal's stage means on the Companies page (PLAN-V10 B2). Pure code.

The stages are HubSpot's labels, compared in lower case. In Contour's HubSpot (9 Nov copy):
"Ordered - Contract Signed" is a won deal (1,815 deals), "Closed lost" and "Dissolved" are closed,
and every other stage ("Lead", "Contour Validated Deal", "Qualified Deal", ...) is open.

A company is a **customer** when it has a won deal or HubSpot's lifecycle stage says "Customer".
Its **deal** on the list is "open" when any deal is open, else "customer", else "none".
Which stages count as won is **TBC** with Levi.
"""

from typing import Literal

DealState = Literal["open", "customer", "none"]
StageKind = Literal["open", "won", "lost", "dissolved"]

WON_STAGES = frozenset({"ordered - contract signed", "handed over to client relations"})
LOST_STAGES = frozenset({"closed lost"})
DISSOLVED_STAGES = frozenset({"dissolved"})
CLOSED_STAGES = WON_STAGES | LOST_STAGES | DISSOLVED_STAGES


def stage_kind(stage: str | None) -> StageKind:
    key = (stage or "").strip().lower()
    if key in WON_STAGES:
        return "won"
    if key in LOST_STAGES:
        return "lost"
    if key in DISSOLVED_STAGES:
        return "dissolved"
    return "open"
