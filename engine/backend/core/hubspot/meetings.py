"""Meetings from HubSpot (PLAN-V17 Stage B), always read from our copy.

These are the S0 stubs: the shapes in the plan's contract (part 1), so Track 2 can build against
them. Track 1 builds the real reads in T1-8: the table `core.hubspot_meetings`, filled by the
daily sync and by `refresh` (the meetings changed since the last read, at most once every 15
minutes). People are kept as contact ids, never as addresses. Until then every read finds
nothing.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.hubspot.client import HubSpot

MeetingWhere = Literal["online", "in_person", "unknown"]
MeetingsState = Literal["ready", "waiting", "off"]
NOT_READ_YET = "Meetings from HubSpot aren't read yet."


class Meeting(BaseModel):
    id: str = Field(description="The meeting in HubSpot")
    company_id: str | None = Field(None, description="The first company it is linked to")
    contact_ids: list[str] = Field(default_factory=list)
    owner_id: str | None = None
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    where: MeetingWhere = Field(
        "unknown", description="online: Teams, Meet or Zoom. in_person: an address."
    )
    location: str | None = None
    outcome: str | None = Field(None, description="Like scheduled, completed or canceled")
    notes: str | None = Field(None, description="Plain text")
    hubspot_url: str | None = None


class MeetingsStatus(BaseModel):
    state: MeetingsState
    sentence: str | None = Field(None, description="One plain sentence when not ready")


async def upcoming(session: AsyncSession, *, owner_id: str | None, days: int) -> list[Meeting]:
    """The meetings in the next `days` days, soonest first. S0 stub: none."""
    return []


async def past(session: AsyncSession, *, owner_id: str | None, days: int) -> list[Meeting]:
    """The meetings in the last `days` days, newest first. S0 stub: none."""
    return []


async def for_company(session: AsyncSession, company_id: str) -> list[Meeting]:
    """One company's meetings. S0 stub: none."""
    return []


async def get(session: AsyncSession, meeting_id: str) -> Meeting | None:
    """One meeting, or None. S0 stub: None."""
    return None


async def refresh(sessions: async_sessionmaker[AsyncSession], hubspot: HubSpot) -> int:
    """Reads the meetings changed since the last read, at most once every 15 minutes, and says
    how many changed. S0 stub: 0."""
    return 0


async def status(session: AsyncSession) -> MeetingsStatus:
    """Whether meetings can be read. S0 stub: waiting."""
    return MeetingsStatus(state="waiting", sentence=NOT_READ_YET)
