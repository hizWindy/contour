"""Script edits and style notes (PLAN-V14 T1-3): the layers a person puts over the draft script.

Three layers, the top one wins: **Yours** (line edits, and Your style), **Team** (team style notes
an Admin approved), and the **Draft** (Claude's script, or the free one written from the HubSpot
copy).

- **A line edit** is one person's own wording for one slot of one call (`opener.0`, `goal` ...).
  It is private, never goes to Claude, and survives "Research again": the website lays it over
  whichever draft is newest.
- **Your style** is one short note per person. **Team style** is up to 8 short notes, each
  suggested by anyone and approved by an Admin (an Admin's own note is active at once, TBC). Both
  go to Claude with the next script, after the rules, as style only (T1-4).
- **No contact details.** A line or a note with an email address or a phone number is refused, as
  the facts pack blanks them (PLAN-V10 E2).

With sign-in off nobody is signed in: everything is saved with no user, and anyone may decide, as
for every other route then.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, Select, delete, func, select
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from apps.companies import tones
from apps.companies.facts import scrub
from apps.companies.schemas import (
    TEAM_MAX_NOTES,
    ScriptEditIn,
    ScriptEditOut,
    ScriptStyleOut,
    StyleNoteOut,
)
from apps.companies.tables import NO_USER, ScriptEdit, ScriptStyle
from core.api.errors import Problem
from core.auth.models import User
from core.auth.sessions import AuthContext

MAX_WAITING = 5  # suggestions one person may have waiting at once
# Two Admins adding a team note at once count one after the other, so the team never passes 8
# notes (PLAN-V15 T3-2). A Postgres advisory lock key (the keys in use: core/prefs/service.py).
TEAM_NOTES_LOCK = 7_244_501
WHO = sql_text(f"coalesce(user_id, {NO_USER})")  # the unique indexes' "user or nobody"


# --- Who is asking ----------------------------------------------------------------------------


def user_of(auth: AuthContext | None) -> uuid.UUID | None:
    return auth.user.id if auth is not None else None


def can_decide(auth: AuthContext | None) -> bool:
    """An Admin decides team notes. With sign-in off, anyone (as for every route then)."""
    return auth is None or auth.user.role == "admin"


def _owned(
    column: InstrumentedAttribute[uuid.UUID | None], user: uuid.UUID | None
) -> ColumnElement[bool]:
    """Rows of this person, or the rows with no user while sign-in is off."""
    return column.is_(None) if user is None else column == user


# --- Checking text ------------------------------------------------------------------------------


def contact_details() -> Problem:
    return Problem(
        422,
        "Contact details left out",
        "Leave out email addresses and phone numbers. Scripts and styles never hold them, "
        "because style notes go to Claude.",
        code="contact_details",
    )


def clean(text: str) -> str:
    """The text with spaces tidied, line breaks kept. Refuses contact details."""
    lines = [" ".join(line.split()) for line in text.strip().splitlines()]
    tidy = "\n".join(line for line in lines if line)
    if scrub(tidy) != tidy:
        raise contact_details()
    return tidy


def _empty() -> Problem:
    return Problem(422, "Nothing to save", "Write something first.", code="empty_text")


# --- Line edits ---------------------------------------------------------------------------------


def _edit_out(edit: ScriptEdit) -> ScriptEditOut:
    return ScriptEditOut(slot=edit.slot, text=edit.text, updated_at=edit.updated_at)


def _same_call(
    query: Select[ScriptEdit], company_key: str, contact_id: str | None
) -> Select[ScriptEdit]:
    return query.where(
        ScriptEdit.company_key == company_key, ScriptEdit.contact_id == (contact_id or "")
    )


async def my_edits(
    session: AsyncSession, user: uuid.UUID | None, company_key: str, contact_id: str | None
) -> list[ScriptEditOut]:
    query = _same_call(
        select(ScriptEdit).where(_owned(ScriptEdit.user_id, user)), company_key, contact_id
    )
    rows = (await session.scalars(query.order_by(ScriptEdit.slot))).all()
    return [_edit_out(row) for row in rows]


async def save_edit(
    session: AsyncSession, user: uuid.UUID | None, body: ScriptEditIn, now: datetime
) -> ScriptEditOut:
    text = clean(body.text)
    if not text:
        raise _empty()
    # One statement, so two first saves of the same line at once never clash (PLAN-V15 T3-2).
    upsert = (
        insert(ScriptEdit)
        .values(
            id=uuid.uuid4(),
            user_id=user,
            company_key=body.company_key,
            contact_id=body.contact_id or "",
            slot=body.slot,
            text=text,
        )
        .on_conflict_do_update(
            index_elements=[WHO, "company_key", "contact_id", "slot"],
            set_={"text": text, "updated_at": now},
        )
        .returning(ScriptEdit)
        .execution_options(populate_existing=True)
    )
    edit = (await session.scalars(upsert)).one()
    await session.commit()
    return _edit_out(edit)


async def reset_edit(
    session: AsyncSession,
    user: uuid.UUID | None,
    company_key: str,
    contact_id: str | None,
    slot: str,
) -> None:
    query = _same_call(
        select(ScriptEdit).where(_owned(ScriptEdit.user_id, user)), company_key, contact_id
    )
    edit = await session.scalar(query.where(ScriptEdit.slot == slot))
    if edit is not None:
        await session.delete(edit)
        await session.commit()


# --- Style notes --------------------------------------------------------------------------------


async def _names(session: AsyncSession, ids: Sequence[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    wanted = {item for item in ids if item is not None}
    if not wanted:
        return {}
    rows = (await session.execute(select(User.id, User.name).where(User.id.in_(wanted)))).all()
    return {row.id: row.name for row in rows}


def _note_out(note: ScriptStyle, names: dict[uuid.UUID, str]) -> StyleNoteOut:
    return StyleNoteOut(
        id=note.id,
        text=note.text,
        status=note.status,
        suggested_by=names.get(note.user_id) if note.user_id else None,
        decided_by=names.get(note.decided_by) if note.decided_by else None,
        decided_at=note.decided_at,
        created_at=note.created_at,
    )


async def _my_style(session: AsyncSession, user: uuid.UUID | None) -> ScriptStyle | None:
    query = (
        select(ScriptStyle)
        .where(_owned(ScriptStyle.user_id, user))
        .where(ScriptStyle.scope == "mine")
    )
    return await session.scalar(query)


async def _active_team(session: AsyncSession) -> list[ScriptStyle]:
    query = select(ScriptStyle).where(ScriptStyle.scope == "team", ScriptStyle.status == "active")
    return list((await session.scalars(query.order_by(ScriptStyle.created_at))).all())


async def style_view(session: AsyncSession, auth: AuthContext | None) -> ScriptStyleOut:
    user = user_of(auth)
    deciding = can_decide(auth)
    mine = await _my_style(session, user)
    team = await _active_team(session)
    others = select(ScriptStyle).where(ScriptStyle.scope == "team", ScriptStyle.status != "active")
    if deciding:
        others = others.where(ScriptStyle.status == "suggested")
    else:
        others = others.where(_owned(ScriptStyle.user_id, user)).where(
            ScriptStyle.status.in_(("suggested", "rejected"))
        )
    waiting = list((await session.scalars(others.order_by(ScriptStyle.created_at.desc()))).all())
    names = await _names(
        session, [n.user_id for n in team + waiting] + [n.decided_by for n in team + waiting]
    )
    return ScriptStyleOut(
        mine=mine.text if mine is not None else "",
        mine_updated_at=mine.updated_at if mine is not None else None,
        team=[_note_out(note, names) for note in team],
        suggestions=[_note_out(note, names) for note in waiting],
        can_decide=deciding,
        tone=await tones.tone_view(session, user),
    )


async def save_mine(
    session: AsyncSession, auth: AuthContext | None, text: str, now: datetime
) -> ScriptStyleOut:
    """Saves Your style. An empty text clears it."""
    user = user_of(auth)
    tidy = clean(text)
    if not tidy:
        await session.execute(
            delete(ScriptStyle).where(
                _owned(ScriptStyle.user_id, user), ScriptStyle.scope == "mine"
            )
        )
    else:
        # One statement, so two first saves at once never clash (PLAN-V15 T3-2).
        await session.execute(
            insert(ScriptStyle)
            .values(id=uuid.uuid4(), scope="mine", user_id=user, text=tidy, status="active")
            .on_conflict_do_update(
                index_elements=[WHO],
                index_where=sql_text("scope = 'mine'"),
                set_={"text": tidy, "updated_at": now},
            )
        )
    await session.commit()
    return await style_view(session, auth)


def _team_full() -> Problem:
    return Problem(
        409,
        "The team style is full",
        f"The team style has {TEAM_MAX_NOTES} notes. Retire one first.",
        code="team_style_full",
    )


async def _active_count(session: AsyncSession) -> int:
    """How many team notes are active. Takes the team notes' lock first, held until the commit,
    so a second Admin's count waits for the first one's note."""
    await session.execute(select(func.pg_advisory_xact_lock(TEAM_NOTES_LOCK)))
    count = await session.scalar(
        select(func.count())
        .select_from(ScriptStyle)
        .where(ScriptStyle.scope == "team", ScriptStyle.status == "active")
    )
    return int(count or 0)


async def suggest(
    session: AsyncSession, auth: AuthContext | None, text: str, now: datetime
) -> ScriptStyleOut:
    """A team note. From an Admin it is active at once (TBC); from anyone else it waits."""
    user = user_of(auth)
    tidy = clean(text)
    if not tidy:
        raise _empty()
    if can_decide(auth):
        if await _active_count(session) >= TEAM_MAX_NOTES:
            raise _team_full()
        session.add(
            ScriptStyle(
                scope="team",
                user_id=user,
                text=tidy,
                status="active",
                decided_by=user,
                decided_at=now,
            )
        )
    else:
        waiting = await session.scalar(
            select(func.count())
            .select_from(ScriptStyle)
            .where(_owned(ScriptStyle.user_id, user))
            .where(ScriptStyle.scope == "team", ScriptStyle.status == "suggested")
        )
        if int(waiting or 0) >= MAX_WAITING:
            raise Problem(
                409,
                "Too many waiting",
                f"You have {MAX_WAITING} suggestions waiting for an Admin. Wait for those first.",
                code="too_many_waiting",
            )
        session.add(ScriptStyle(scope="team", user_id=user, text=tidy, status="suggested"))
    await session.commit()
    return await style_view(session, auth)


def admins_only() -> Problem:
    return Problem(403, "Admins only", "Only an Admin can do this.", code="admin_only")


def _note_not_found() -> Problem:
    return Problem(
        404, "Note not found", "That team note isn't there any more.", code="note_not_found"
    )


async def _team_note(session: AsyncSession, note_id: uuid.UUID) -> ScriptStyle:
    note = await session.get(ScriptStyle, note_id)
    if note is None or note.scope != "team":
        raise _note_not_found()
    return note


async def decide(
    session: AsyncSession,
    auth: AuthContext | None,
    note_id: uuid.UUID,
    *,
    approve: bool,
    now: datetime,
) -> ScriptStyleOut:
    if not can_decide(auth):
        raise admins_only()
    note = await _team_note(session, note_id)
    if note.status != "suggested":
        raise Problem(
            409, "Already decided", "That note isn't waiting any more.", code="already_decided"
        )
    if approve and await _active_count(session) >= TEAM_MAX_NOTES:
        raise _team_full()
    note.status = "active" if approve else "rejected"
    note.decided_by = user_of(auth)
    note.decided_at = now
    note.updated_at = now
    await session.commit()
    return await style_view(session, auth)


async def retire(
    session: AsyncSession, auth: AuthContext | None, note_id: uuid.UUID, now: datetime
) -> ScriptStyleOut:
    if not can_decide(auth):
        raise admins_only()
    note = await _team_note(session, note_id)
    if note.status != "active":
        raise Problem(
            409, "Not active", "Only an active team note can be retired.", code="not_active"
        )
    note.status = "retired"
    note.decided_by = user_of(auth)
    note.decided_at = now
    note.updated_at = now
    await session.commit()
    return await style_view(session, auth)


# --- For the prompt (T1-4) ----------------------------------------------------------------------


@dataclass(frozen=True)
class StyleNotes:
    """What the next script is written with: the team's notes, then the asker's own."""

    team: tuple[str, ...] = ()
    mine: str | None = None

    @property
    def empty(self) -> bool:
        return not self.team and not self.mine


async def notes_for_prompt(
    session: AsyncSession, user: uuid.UUID | None, *, with_mine: bool = True
) -> StyleNotes:
    """The active team notes and, when `with_mine`, the asker's own style. The morning search
    ahead has no asker, so it gets the team's only."""
    team = tuple(note.text for note in await _active_team(session))
    mine = await _my_style(session, user) if with_mine else None
    return StyleNotes(team=team, mine=mine.text if mine is not None else None)
