"""One live voice talk's row, `companies.voice_sessions` (PLAN-V28 T1-2, choices 16 to 21).

A talk is one conversation with Gemini, from V to its end. Its row holds who, when, its status,
why it ended, the service and model, and counts: tokens by kind, seconds of listening and
talking, tool calls, reconnects and the estimated US$. **No sound, no words, no names** (choice
21): nothing a rep or Gemini said is ever kept.

- **Status:** `ready` (started, waiting for the browser's socket, at most 60 seconds), `open` (the
  relay is carrying it), `dropped` (the backend stopped while it was open: the browser may come
  back within the resume window and carry on) and `ended`.
- **The resume handle** is Google's id for carrying a talk on over a new connection (choice 15).
  It is kept like a secret: never logged, never sent to the browser, and cleared when the talk
  ends (the database refuses an ended row that still has one).
- **Money** is an exact decimal, to a millionth of a dollar (a second of listening costs about
  US$0.000075). Times are UTC.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Final

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.elements import TextClause

import core.auth.models  # noqa: F401  (a talk points at core.users)
from core.db.base import CORE_SCHEMA, Base

SCHEMA: Final = "companies"
STATUSES: Final = ("ready", "open", "dropped", "ended")
# Why a talk ended. The relay's own list (relay.END_REASONS) is the same; a test keeps them equal.
END_REASONS: Final = (
    "stopped",  # the rep stopped it: Stop, V, "that's all", or the browser's 2-minute quiet stop
    "left",  # the browser went away: the page closed, or the network dropped
    "dropped",  # Google's connection dropped, and resuming failed (or there was nothing to resume)
    "unreachable",  # Google couldn't be reached, or refused the setup, at the start
    "time_limit",  # the talk's own limit (30 minutes, TBC)
    "limit",  # this month's limit was reached
    "idle",  # nothing at all from the browser for 5 minutes (a backstop)
    "replaced",  # the same person started another talk
    "expired",  # a ready talk nobody opened in time, or a dropped one nobody came back to
    "refused",  # the browser broke a cap: too big, too fast, or not one of our messages
    "restart",  # the backend stopped (a deploy): the talk is `dropped`, and may carry on
    "error",  # something went wrong on our side
)
SERVICES: Final = ("gemini_api", "agent_platform")
COST_PLACES: Final = 6  # US$ to a millionth
# One column for each kind in pricing.Tokens, named tokens_<kind> (a test keeps them equal).
TOKEN_COLUMNS: Final = (
    "tokens_in_audio",
    "tokens_in_text",
    "tokens_in_other",
    "tokens_out_audio",
    "tokens_out_text",
    "tokens_out_other",
    "tokens_thinking",
    "tokens_tool",
    "tokens_cached",
    "tokens_other",
)
COUNT_COLUMNS: Final = (
    *TOKEN_COLUMNS,
    "listen_seconds",
    "speak_seconds",
    "talk_seconds",
    "tool_calls",
    "reconnects",
)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _now() -> TextClause:
    return text("now()")


class VoiceSession(Base):
    """One live voice talk: counts only (see the module's notes)."""

    __tablename__ = "voice_sessions"
    __table_args__ = (
        CheckConstraint(_in_list("status", STATUSES), name="status"),
        CheckConstraint(
            "end_reason IS NULL OR " + _in_list("end_reason", END_REASONS), name="end_reason"
        ),
        CheckConstraint(_in_list("service", SERVICES), name="service"),
        # The handle goes when a talk ends (choice 15).
        CheckConstraint("status <> 'ended' OR resume_handle IS NULL", name="handle_cleared"),
        # An ended or dropped talk says when, and why; a ready or open one says neither.
        CheckConstraint(
            "(status IN ('ended', 'dropped')) = (ended_at IS NOT NULL)", name="ended_at"
        ),
        CheckConstraint(
            "(status IN ('ended', 'dropped')) = (end_reason IS NOT NULL)", name="ended_why"
        ),
        CheckConstraint(
            " AND ".join(f"{column} >= 0" for column in COUNT_COLUMNS) + " AND cost_usd >= 0",
            name="counts",
        ),
        # The month's total (Melbourne months): every talk started in it.
        Index("ix_voice_sessions_created_at", "created_at"),
        # A person's talks that haven't ended: a new start ends them.
        Index("ix_voice_sessions_user_live", "user_id", postgresql_where=text("status <> 'ended'")),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Who. With sign-in off nobody is signed in, so there is no user. A deleted account leaves
    # its talks, so the month still adds up.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(16))
    end_reason: Mapped[str | None] = mapped_column(String(16))
    service: Mapped[str] = mapped_column(String(16))  # SERVICES
    model: Mapped[str] = mapped_column(String(64))  # like gemini-3.8-live
    prompt_version: Mapped[str] = mapped_column(String(32))  # the instruction's version
    resume_handle: Mapped[str | None] = mapped_column(Text)  # a secret, never logged or sent
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The last write: the relay writes the counts every 30 seconds and at the end.
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
    # Tokens by kind (pricing.Tokens). "Other": Google didn't say the kind, so the higher price.
    tokens_in_audio: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_in_text: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_in_other: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_out_audio: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_out_text: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_out_other: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_thinking: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_tool: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    # Prompt tokens Google served from its cache: part of the input, counted at the full rate.
    tokens_cached: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    tokens_other: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    listen_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # rep
    speak_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # Gemini
    talk_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # open
    tool_calls: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reconnects: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, COST_PLACES), default=Decimal("0"), server_default="0"
    )
