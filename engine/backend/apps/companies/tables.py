"""The Companies page's own tables, in the companies schema (PLAN-V10 D3, PLAN-V14 T1-3).

`companies.preps` keeps each call script with what it rested on, what it cost, and who asked. A
prep for the same company and person is reused for `prep_reuse_days` (7, TBC), so a second person
calling the same week pays nothing. Research again (refresh) makes a new one.

`companies.script_edits` keeps one person's own wording for a line of one call. It is private: the
next person who opens the same prep sees the draft. `companies.script_styles` keeps the style
notes: each person's own (`mine`), and the team's (`team`), which an Admin approves. Style notes
go to Claude as style, never as facts.

`companies.script_prefs` keeps the tone presets (PLAN-V15 T3-5): each person's own, and the team's
default.

`companies.call_notes` keeps each call a rep logs (PLAN-V17 T2-2): the note as typed or said, what
the sorter made of it, the rep's edits, what it cost, and the write it became in HubSpot.

`companies.meeting_forms` keeps each pre-read for a client meeting (PLAN-V17 T2-10): the meeting it
is for, the facts and the three summaries, the rep's two blanks, who it went to, and its copy in
HubSpot.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Final

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.elements import TextClause

import core.auth.models  # a prep points at core.users
import core.hubspot.models  # noqa: F401  (a call note points at core.hubspot_writes)
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
        # One prep searching for each call, so two clicks never pay twice (PLAN-V15 T3-2).
        Index(
            "ux_preps_searching",
            "company_key",
            text("coalesce(contact_id, '')"),
            unique=True,
            postgresql_where=text("status = 'searching'"),
        ),
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


def _sql(expression: str) -> TextClause:
    """Any other server default, for the same reason as `_now`."""
    return text(expression)


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


TONES: Final = ("friendly", "direct", "consultative", "formal")


class ScriptPref(Base):
    """A tone preset (PLAN-V15 T3-5): one person's own (`mine`), or the team's default (`team`,
    one row with no user). No row: the person follows the team, and the team is Friendly."""

    __tablename__ = "script_prefs"
    __table_args__ = (
        CheckConstraint(_in_list("scope", SCRIPT_SCOPES), name="scope"),
        CheckConstraint(_in_list("tone", TONES), name="tone"),
        CheckConstraint("scope = 'mine' OR user_id IS NULL", name="team_has_no_user"),
        Index("ux_script_prefs_who", "scope", text(f"coalesce(user_id, {NO_USER})"), unique=True),
        {"schema": SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(8))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="CASCADE")
    )
    tone: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())


NOTE_SOURCES: Final = ("mic", "typed", "transcript")
# sorting: the sorter is at work. to_confirm: in the rep's batch. sending: on its way to HubSpot.
# logged: every step landed. partial: some landed and some failed. failed: none landed.
# uncertain: HubSpot didn't answer, so a person checks before anything more is sent.
NOTE_STATUSES: Final = (
    "sorting",
    "to_confirm",
    "sending",
    "logged",
    "partial",
    "failed",
    "uncertain",
)
NOTE_SORTERS: Final = ("ai", "person")  # Claude sorted it, or the rep picked by hand (AI off)


class CallNote(Base):
    """One call a rep logs (PLAN-V17 T2-2): the note as typed or said, what the sorter made of it,
    the rep's edits, and the write it became in HubSpot.

    `sorted` is the sorter's answer after code's checks, kept as it came, so it can be measured
    against what the rep sent. `card` is the note as it will be sent: the call (summary, outcome),
    the changes, the tasks, the unsure sentence, and what was dropped into the text. It starts as
    the sorter's answer (or the rep's own picks with the AI off) and takes the rep's edits.
    """

    __tablename__ = "call_notes"
    __table_args__ = (
        CheckConstraint(_in_list("source", NOTE_SOURCES), name="source"),
        CheckConstraint(_in_list("status", NOTE_STATUSES), name="status"),
        CheckConstraint(_in_list("sorted_by", NOTE_SORTERS), name="sorted_by"),
        # A double press is one note: one key for each person, and "no user" with sign-in off.
        Index(
            "ux_call_notes_idempotency",
            text(f"coalesce(made_by, {NO_USER})"),
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        # The rep's lists (to confirm, needs a look, logged) and their counts.
        Index("ix_call_notes_made_by_status", "made_by", "status", text("created_at DESC")),
        # History in Call logs: every one of the rep's calls, the newest first (PLAN-V18 T1-3).
        Index("ix_call_notes_made_by_called_at", "made_by", text("called_at DESC")),
        # The rep's newest note on a company, for call prep's "Last talk".
        Index("ix_call_notes_company", "company_key", text("created_at DESC")),
        # The notes logged for a meeting (Meetings' "Notes logged", PLAN-V17 T2-15).
        Index("ix_call_notes_meeting", "meeting_id"),
        {"schema": SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Who logged it. With sign-in off nobody is signed in, so there is no user.
    made_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(64))  # the Idempotency-Key header
    company_key: Mapped[str] = mapped_column(String(64))  # a HubSpot id, or lead:<id>
    company_name: Mapped[str] = mapped_column(String(300))
    contact_id: Mapped[str | None] = mapped_column(String(32))  # HubSpot's contact id, if any
    person_name: Mapped[str | None] = mapped_column(String(240))
    person_title: Mapped[str | None] = mapped_column(String(200))
    prep_id: Mapped[uuid.UUID | None] = mapped_column(  # the call prep it came from, if any
        Uuid, ForeignKey(f"{SCHEMA}.preps.id", ondelete="SET NULL")
    )
    text: Mapped[str] = mapped_column(Text)  # the note as typed or said
    source: Mapped[str] = mapped_column(String(16))
    called_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16))
    sorted_by: Mapped[str] = mapped_column(String(8), server_default="person")
    sorted: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    card: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=_sql("'{}'::jsonb")
    )
    left_out: Mapped[bool] = mapped_column(  # X leaves it out of this batch
        Boolean, default=False, server_default=_sql("false")
    )
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 6), server_default=_sql("0"))
    write_id: Mapped[uuid.UUID | None] = mapped_column(  # the write it became, once confirmed
        Uuid, ForeignKey(f"{CORE_SCHEMA}.hubspot_writes.id", ondelete="SET NULL")
    )
    hubspot_url: Mapped[str | None] = mapped_column(String(500))
    error: Mapped[str | None] = mapped_column(Text)  # plain words, for "Needs a look"
    # The HubSpot meeting a transcript came from (Log meeting, PLAN-V17 T2-15), or none.
    meeting_id: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
    # Moves on every change through SQLAlchemy, and is read back in the same statement.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=_now(), onupdate=func.now()
    )
    sorted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


MEETING_WHERE: Final = ("online", "in_person", "unknown")
# drafting: the facts are in and the summaries are being written. draft: ready for the rep.
# sent: emailed to the team. failed: the summaries couldn't be written (the facts still show).
FORM_STATUSES: Final = ("drafting", "draft", "sent", "failed")
# Its copy in HubSpot, once sent: saved; waiting (writing is off, or HubSpot isn't connected);
# off (no copy is made); failed.
HUBSPOT_COPIES: Final = ("saved", "waiting", "off", "failed")
FORM_TRIGGERS: Final = ("person", "job")  # a person asked, or the morning job (T2-13)


class MeetingForm(Base):
    """One pre-read for a client meeting (PLAN-V17 T2-10): the meeting it is for, what we know
    (`facts`, no AI), the three summaries (`summaries`: what they do, what we know about the
    project, the talks so far; each written by the AI or a person, with its sources), the rep's
    two blanks, who it went to, and its copy in HubSpot.

    A HubSpot meeting has one form (`meeting_id`, unique). "New pre-read" types the meeting in, so
    its form has no `meeting_id`. Both keep the meeting as it was (company, title, times, where),
    so the form still reads if the meeting changes or goes. `version` goes up with each edit or
    redraft: the email's key is the form's id and its version, so a retry can't send twice.
    """

    __tablename__ = "meeting_forms"
    __table_args__ = (
        # "where" is a word SQL keeps for itself, so the check quotes it.
        CheckConstraint(_in_list('"where"', MEETING_WHERE), name="where"),
        CheckConstraint(_in_list("status", FORM_STATUSES), name="status"),
        CheckConstraint(_in_list("hubspot_copy", HUBSPOT_COPIES), name="hubspot_copy"),
        CheckConstraint(_in_list("trigger", FORM_TRIGGERS), name="trigger"),
        CheckConstraint("version >= 1", name="version"),
        # One form for each HubSpot meeting, so a second start (or the job) never drafts twice.
        Index(
            "ux_meeting_forms_meeting",
            "meeting_id",
            unique=True,
            postgresql_where=text("meeting_id IS NOT NULL"),
        ),
        # A company's pre-reads, and a person's own.
        Index("ix_meeting_forms_company", "company_key", text("starts_at DESC")),
        Index("ix_meeting_forms_made_by", "made_by", text("created_at DESC")),
        {"schema": SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[str | None] = mapped_column(String(32))  # HubSpot's meeting, if any
    # The meeting as it was when the form was made (or as typed).
    company_key: Mapped[str] = mapped_column(String(64))
    company_name: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(300))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    where: Mapped[str] = mapped_column(String(16), server_default="unknown")
    status: Mapped[str] = mapped_column(String(16))
    # Each: label, value, source. No AI.
    facts: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=_sql("'[]'::jsonb")
    )
    # what_they_do, what_we_know, talks_so_far: each text, by (ai or person), sources.
    summaries: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=_sql("'{}'::jsonb")
    )
    next_step: Mapped[str | None] = mapped_column(Text)  # the rep's, never the AI's
    going: Mapped[str | None] = mapped_column(Text)  # who is going: the rep's, never the AI's
    # Who it went to: each the name (if known) and the Contour address.
    sent_to: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=_sql("'[]'::jsonb")
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=_sql("1"))
    hubspot_copy: Mapped[str | None] = mapped_column(String(16))  # none until it is sent
    hubspot_copy_sentence: Mapped[str | None] = mapped_column(Text)  # plain words
    hubspot_write_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.hubspot_writes.id", ondelete="SET NULL")
    )
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 6), server_default=_sql("0"))
    error: Mapped[str | None] = mapped_column(Text)  # plain words
    # Who started it: a person, or none for the morning job.
    made_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    trigger: Mapped[str] = mapped_column(String(8), server_default="person")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=_now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=_now(), onupdate=func.now()
    )
    drafted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
