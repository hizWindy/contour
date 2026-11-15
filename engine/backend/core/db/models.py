"""Imports every core table, so migrations and tests see them all."""

from core.auth.models import AuditEntry, User, UserSession
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.models import MemoryItem
from core.prefs.models import Setting
from core.runs.models import Run, RunEvent
from core.schedules.models import Schedule
from core.searches.models import SearchLog
from core.sources.models import PropertyLookup, PropertyRecordRow, SourceRead, SourceState

__all__ = [
    "AuditEntry",
    "HubSpotCompany",
    "HubSpotDeal",
    "HubSpotOffice",
    "MemoryItem",
    "PropertyLookup",
    "PropertyRecordRow",
    "Run",
    "RunEvent",
    "Schedule",
    "SearchLog",
    "Setting",
    "SourceRead",
    "SourceState",
    "User",
    "UserSession",
]
