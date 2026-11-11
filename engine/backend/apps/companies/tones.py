"""Tone presets (PLAN-V15 T3-5): how a call script sounds. Each person picks one, or follows the
team's default, which an Admin sets. Friendly until an Admin picks another.

The same four words mean the same thing to Claude and to the free script on the website:

- **Friendly:** warm, a short greeting, plain words.
- **Direct:** short sentences, the reason first, no small talk.
- **Consultative:** questions first, curious about their workplace.
- **Formal:** full names and titles, no slang.

The order, where the last one wins on wording: the rules, then the relationship stage, then the
tone, then the Team style, then Your style. A tone change never spends money: a ready prep keeps
being reused, and the card offers Research again when its tone differs (T3-6).
"""

import uuid
from datetime import datetime
from typing import Final

from sqlalchemy import ColumnElement, delete, select
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.schemas import ToneChoice, ToneKey, ToneView
from apps.companies.tables import NO_USER, ScriptPref

TONE_DEFAULT: Final[ToneKey] = "friendly"
# key: (label, what it means), in the order the picker shows them.
TONE_PRESETS: Final[dict[ToneKey, tuple[str, str]]] = {
    "friendly": ("Friendly", "Warm, a short greeting, plain words."),
    "direct": ("Direct", "Short sentences, the reason first, no small talk."),
    "consultative": ("Consultative", "Questions first, curious about their workplace."),
    "formal": ("Formal", "Full names and titles, no slang."),
}
WHO = sql_text(f"coalesce(user_id, {NO_USER})")  # the unique index's "user or nobody"


def choices() -> list[ToneChoice]:
    return [
        ToneChoice(key=key, label=label, line=line) for key, (label, line) in TONE_PRESETS.items()
    ]


def tone_words(tone: ToneKey) -> str:
    """'Direct: short sentences, the reason first, no small talk.', for Claude's prompt."""
    label, line = TONE_PRESETS[tone]
    return f"{label}: {line[0].lower()}{line[1:]}"


def _owned(user: uuid.UUID | None) -> ColumnElement[bool]:
    return ScriptPref.user_id.is_(None) if user is None else ScriptPref.user_id == user


async def team_tone(session: AsyncSession) -> ToneKey:
    found = await session.scalar(select(ScriptPref.tone).where(ScriptPref.scope == "team"))
    return found if found in TONE_PRESETS else TONE_DEFAULT


async def my_tone(session: AsyncSession, user: uuid.UUID | None) -> ToneKey | None:
    """The person's own tone, or None when they follow the team."""
    found = await session.scalar(
        select(ScriptPref.tone).where(ScriptPref.scope == "mine", _owned(user))
    )
    return found if found in TONE_PRESETS else None


async def tone_for(
    session: AsyncSession, user: uuid.UUID | None, *, with_mine: bool = True
) -> ToneKey:
    """The tone a script is written in: the person's own, else the team's. The morning search
    ahead has no asker, so it gets the team's."""
    mine = await my_tone(session, user) if with_mine else None
    return mine or await team_tone(session)


async def tone_view(session: AsyncSession, user: uuid.UUID | None) -> ToneView:
    return ToneView(
        mine=await my_tone(session, user), team=await team_tone(session), choices=choices()
    )


async def _save(
    session: AsyncSession, scope: str, user: uuid.UUID | None, tone: ToneKey, now: datetime
) -> None:
    await session.execute(
        insert(ScriptPref)
        .values(id=uuid.uuid4(), scope=scope, user_id=user, tone=tone)
        .on_conflict_do_update(
            index_elements=["scope", WHO], set_={"tone": tone, "updated_at": now}
        )
    )


async def save_mine(
    session: AsyncSession, user: uuid.UUID | None, tone: ToneKey | None, now: datetime
) -> None:
    """Saves the person's tone. None: they follow the team again."""
    if tone is None:
        await session.execute(delete(ScriptPref).where(ScriptPref.scope == "mine", _owned(user)))
    else:
        await _save(session, "mine", user, tone, now)
    await session.commit()


async def save_team(session: AsyncSession, tone: ToneKey, now: datetime) -> None:
    """Saves the team's default (an Admin's choice; the route checks)."""
    await _save(session, "team", None, tone, now)
    await session.commit()
