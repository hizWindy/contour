"""New leads only (PLAN-V27 Part 1): when a company already in HubSpot still counts as new.

The rule lives in `core/hubspot/quiet.py` since PLAN-V27 T4-1, so the Assistant's research uses the
same one. This module keeps the Lead Finder's names for it.

A Find new leads run leaves out a company already in HubSpot (choice 3), unless it is quiet:
nobody has worked it for `hubspot_quiet_months`. A quiet company is researched, and its lead's
HubSpot status is `quiet`, so its card says "In HubSpot, quiet since March 2025" and Results shows
it with the new leads. Free: our copy only.
"""

from core.hubspot.quiet import (
    CAN_BE_QUIET,
    QUIET,
    SURE_MATCH,
    QuietCheck,
    is_quiet,
    last_activity_of,
    last_worked,
    months_before,
    quiet_check,
    quiet_status,
)

__all__ = [
    "CAN_BE_QUIET",
    "QUIET",
    "SURE_MATCH",
    "QuietCheck",
    "is_quiet",
    "last_activity_of",
    "last_worked",
    "months_before",
    "quiet_check",
    "quiet_status",
]
