"""What live voice's routes take and send (PLAN-V28 T1-2, T1-5). The socket's own messages are in
`messages.py`."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from apps.companies.live_voice.messages import (
    AUDIO_RATE_MAX,
    FRAME_BYTES,
    MAX_BINARY_BYTES,
    MAX_TEXT_BYTES,
    SAMPLE_RATE_IN,
    SAMPLE_RATE_OUT,
)
from core.api.models import OutModel, SafeText


class VoiceSessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company_key: SafeText | None = Field(
        None,
        max_length=64,
        description="The company on screen (a HubSpot id, or lead:<id>), so its names come first "
        "in the hints. Only its key: the names are read on the server, from our copy",
        examples=["101"],
    )


class VoiceLimits(OutModel):
    """What the browser must keep to, and the talk's own limits."""

    talk_seconds: int = Field(description="A talk ends after this long (30 minutes, TBC)")
    idle_seconds: int = Field(
        description="A talk ends after this long with nothing at all from the browser"
    )
    tool_seconds: int = Field(
        description="A tool call not answered in this long gets the relay's own answer"
    )
    sample_rate_in: int = Field(SAMPLE_RATE_IN, description="Sound to the relay: 16-bit PCM, mono")
    sample_rate_out: int = Field(SAMPLE_RATE_OUT, description="Sound from the relay: 16-bit PCM")
    frame_bytes: int = Field(FRAME_BYTES, description="One 20 ms piece of sound to the relay")
    max_binary_bytes: int = Field(MAX_BINARY_BYTES, description="The largest sound frame taken")
    max_text_bytes: int = Field(MAX_TEXT_BYTES, description="The largest JSON message taken")
    audio_rate_max: float = Field(
        AUDIO_RATE_MAX, description="Sound may average at most this many times real time"
    )


class VoiceSessionOut(OutModel):
    """A talk that is ready: open its socket within 60 seconds."""

    id: uuid.UUID
    socket: str = Field(
        description="The socket's path on this site, with the talk's id",
        examples=["/api/v1/companies/assistant/voice/live?session=0b6f..."],
    )
    expires_at: datetime = Field(description="Open the socket before this, or start again")
    limits: VoiceLimits


class VoiceMonth(OutModel):
    """Live voice this month, for Admin settings (Melbourne months, TBC)."""

    month: str = Field(description="Like 2026-11", examples=["2026-11"])
    minutes: int = Field(description="How long talks were open this month, in whole minutes")
    talks: int
    spent_usd: Decimal = Field(description="About this much (the meter's estimate, rounded up)")
    cap_usd: Decimal = Field(description="This month's limit, from the Settings page")
    line: str = Field(
        examples=["Live voice this month: 42 minutes, about US$0.51 of US$4.00."],
    )
