"""Writing activities to HubSpot (PLAN-V17): a call, follow-up tasks, field changes and a note.

These are the S0 stubs: the shapes in the plan's contract (part 1), so Track 2 can build against
them. Track 1 builds the real writer in T1-5, beside `writer.py`. It reuses the writer's claim
(so two clicks can't both write), its step log, `note_html` and the `core.hubspot_writes` table.
Until then every write answers "Waiting for write access", and `owner_of` knows no owner.

The steps, in order: `call`, `fields`, `task:1`, `task:2` and so on, then `note`.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.client import HubSpot, HubSpotWritesOff
from core.hubspot.people import OUTCOMES
from core.hubspot.writer import WriteOut

Direction = Literal["outbound", "inbound"]
TaskKind = Literal["call", "email", "todo"]
TaskPriority = Literal["low", "medium", "high"]

# HubSpot's six standard call outcomes, by name (people.py has their ids).
OUTCOME_NAMES: tuple[str, ...] = tuple(OUTCOMES.values())
BODY_MAX_CHARS = 60_000  # HubSpot's limit for a call or note body is 65,536


class CallIn(BaseModel):
    """The call itself."""

    model_config = ConfigDict(frozen=True)

    at: datetime = Field(description="When the call was (HubSpot's hs_timestamp)")
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(max_length=BODY_MAX_CHARS, description="Plain text")
    outcome: str | None = Field(None, description="One of HubSpot's outcome names, or none")
    direction: Direction = "outbound"

    @field_validator("outcome")
    @classmethod
    def _known_outcome(cls, value: str | None) -> str | None:
        if value is not None and value not in OUTCOME_NAMES:
            raise ValueError(f"outcome must be one of: {', '.join(OUTCOME_NAMES)}")
        return value


class TaskIn(BaseModel):
    """A follow-up task."""

    model_config = ConfigDict(frozen=True)

    subject: str = Field(min_length=1, max_length=300)
    body: str = Field("", max_length=BODY_MAX_CHARS, description="Plain text")
    due: date = Field(description="The day it is due (HubSpot's hs_timestamp)")
    kind: TaskKind = "todo"
    priority: TaskPriority = "medium"
    owner_id: str | None = Field(None, description="Who it is for. None: the rep")


class FieldSet(BaseModel):
    """One company field to change. The writer reads the company again first: when HubSpot's
    value is no longer `seen`, the field is not written."""

    model_config = ConfigDict(frozen=True)

    property: str = Field(min_length=1, max_length=200, description="HubSpot's field name")
    label: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1, max_length=2_000, description="Never empty: that clears")
    seen: str | None = Field(None, description="The value the rep saw, or none")


class NoteIn(BaseModel):
    """A note on the company (and the deal, if there is one)."""

    model_config = ConfigDict(frozen=True)

    body: str = Field(min_length=1, max_length=BODY_MAX_CHARS, description="Plain text")


class ActivityRequest(BaseModel):
    """What one project asks to write on one company."""

    model_config = ConfigDict(frozen=True)

    app: str = Field(min_length=1, max_length=64)
    subject: str = Field(min_length=1, max_length=120, description="Like call_note:<id>")
    company_id: str = Field(min_length=1, max_length=64, description="The company in HubSpot")
    contact_id: str | None = None
    deal_id: str | None = None
    owner_id: str | None = Field(None, description="The rep's HubSpot owner id")
    call: CallIn | None = None
    tasks: list[TaskIn] = Field(default_factory=list, max_length=10)
    fields: list[FieldSet] = Field(default_factory=list, max_length=20)
    note: NoteIn | None = None

    @model_validator(mode="after")
    def _something_to_write(self) -> "ActivityRequest":
        if self.call is None and not self.tasks and not self.fields and self.note is None:
            raise ValueError("an activity needs a call, a task, a field or a note")
        return self


async def preview_activity(
    session: AsyncSession, hubspot: HubSpot, request: ActivityRequest
) -> WriteOut:
    """What would be written, with HubSpot's value now for each field. Saved as "previewed";
    nothing is written. S0 stub: answers "Waiting for write access" until T1-5."""
    raise HubSpotWritesOff()


async def apply_activity(session: AsyncSession, hubspot: HubSpot, write_id: uuid.UUID) -> WriteOut:
    """Writes a previewed activity step by step, each step saved as it lands. S0 stub."""
    raise HubSpotWritesOff()


async def resolve_step(
    session: AsyncSession, write_id: uuid.UUID, step: str, landed: bool
) -> WriteOut:
    """A person says whether an uncertain step is in HubSpot. S0 stub."""
    raise HubSpotWritesOff()


async def owner_of(session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
    """The rep's HubSpot owner id, or None (sign-in off, or no owner matched). S0 stub: None."""
    return None
