"""Imports every core table, so migrations and tests see them all."""

from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.models import MemoryItem
from core.prefs.models import Setting
from core.runs.models import Run, RunEvent
from core.searches.models import SearchLog

__all__ = [
    "HubSpotCompany",
    "HubSpotDeal",
    "HubSpotOffice",
    "MemoryItem",
    "Run",
    "RunEvent",
    "SearchLog",
    "Setting",
]
