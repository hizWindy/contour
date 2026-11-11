"""The Companies page's own tables, in the companies schema (PLAN-V10 D3, PLAN-V14 T1-3).

`companies.preps` keeps each call script with what it rested on, what it cost, and who asked. A
prep for the same company and person is reused for `prep_reuse_days` (7, TBC), so a second person
calling the same week pays nothing. Research again (refresh) makes a new one.

`companies.script_edits` keeps one person's own wording for a line of one call. It is private: the
next person who opens the same prep sees the draft. `companies.script_styles` keeps the style
notes: each person's own (`mine`), and the team's (`team`), which an Admin approves. Style notes
go to Claude as style, never as facts.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Final

from sqlalchemy import (
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.elements import TextClause

import core.auth.models  # noqa: F401  (a prep points at core.users)
from core.db.base import CORE_SCHEMA, Base

SCHEMA: Final = "companies"
PREP_STATUSES: Final = ("searching", "ready", "failed")
PREP_KINDS: Final = ("person", "cold")  # a named person, or the switchboard
PREP_TRIGGERS: Final = ("person", "search_ahead")  # a person asked, or the morning search


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class Prep(Base):
    """One call script: for a person at a company, or a cold call to its switchboard."""

    __tablename__ = "preps"
    __table_args__ = (
        CheckConstraint(_in_list("status", PREP_STATUSES), name="status"),
        CheckConstraint(_in_list("kind", PREP_KINDS), name="kind"),
        CheckConstraint(_in_list("trigger", PREP_TRIGGERS), name="trigger"),
        # The newest prep for a company and person: the reuse check, and the "Today" chips.
        Index("ix_preps_company_contact", "company_key", "contact_id", text("created_at DESC")),
        Index("ix_preps_made_by_created_at", "made_by", text("created_at DESC")),
        {"schema": SCHEMA},
    )
    # Fetch server defaults (created_at) in the same statement, so async code never lazy-loads.
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_key: Mapped[str] = mapped_column(String(64))  # a HubSpot id, or lead:<id>
    company_name: Mapped[str] = mapped_column(String(300))
    contact_id: Mapped[str | None] = mapped_column(String(32))  # HubSpot's contact id, if any
    person_name: Mapped[str | None] = mapped_column(String(240))
    person_title: Mapped[str | None] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), server_default="person")
    trigger: Mapped[str] = mapped_column(String(16), server_default="person")
    status: Mapped[str] = mapped_column(String(16), server_default="searching")
    # How far it got: 1 facts, 2 web check, 3 script (the 3-step bar).
    stage: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    facts: Mapped[dict[str, Any]] = mapped_column(  # the facts pack, as the script used it
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    script: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # the call script, checked
    sources: Mapped[list[Any]] = mapped_column(  # every source a line may point at
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), server_default=text("0"))
    web_searches: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    error: Mapped[str | None] = mapped_column(Text)  # plain words, for the failed state
    made_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def _now() -> TextClause:
    """`now()` for a server default. A class with a column named `text` can't call `text()`."""
    return text("now()")


SCRIPT_SCOPES: Final = ("mine", "team")
STYLE_STATUSES: Final = ("active", "suggested", "rejected", "retired")
# With sign-in off nobody is signed in, so an edit or a style has no user. The unique indexes
# count "no user" as one person.
NO_USER: Final = "'00000000-0000-0000-0000-000000000000'::uuid"


class ScriptEdit(Base):
    """One line of one call, in one person's own words (PLAN-V14 T1-3). Only they see it."""

    __tablename__ = "script_edits"
    __table_args__ = (
        Index(
            "ux_script_edits_slot",
            text(f"coalesce(user_id, {NO_USER})"),
            "company_key",
            "contact_id",
            "slot",
            unique=True,
        ),
        {"schema": SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE")
    )
    company_key: Mapped[str] = mapped_column(String(64))
    contact_id: Mapped[str] = mapped_column(String(32), server_default="")  # "" for a cold call
    slot: Mapped[str] = mapped_column(String(32))  # opener.0, question.2, goal ...
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())


class ScriptStyle(Base):
    """A style note: one person's own (`mine`, one each), or one of the team's (PLAN-V14 T1-3).

    A team note starts `suggested`; an Admin makes it `active` or `rejected`, and later `retired`.
    """

    __tablename__ = "script_styles"
    __table_args__ = (
        CheckConstraint(_in_list("scope", SCRIPT_SCOPES), name="scope"),
        CheckConstraint(_in_list("status", STYLE_STATUSES), name="status"),
        CheckConstraint("scope = 'team' OR status = 'active'", name="mine_is_active"),
        Index(
            "ux_script_styles_mine",
            text(f"coalesce(user_id, {NO_USER})"),
            unique=True,
            postgresql_where=text("scope = 'mine'"),
        ),
        Index("ix_script_styles_team", "scope", "status"),
        {"schema": SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(8))
    # The owner of a `mine` note, or who suggested a team note. The website never deletes an
    # account (it switches sign-in off), so a team note keeps its author.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE")
    )
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), server_default="active")
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
