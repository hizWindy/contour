"""Imports every core table, so migrations and tests see them all."""

from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from core.memory.models import MemoryItem

__all__ = ["HubSpotCompany", "HubSpotDeal", "HubSpotOffice", "MemoryItem"]
