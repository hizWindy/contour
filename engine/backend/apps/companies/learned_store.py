"""The learned names table, `companies.learned_names` (PLAN-V23 T1-2): saving a pair once, the
companies taught for some words, the companies with learned names, the Admin list, and removing a
pair. The rules are in assistant_learned.py; the command step reads them in assistant_find.py.
"""

import uuid
from typing import Final

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.tables import LearnedName
from core.auth.models import User
from core.hubspot.models import HubSpotCompany

MAX_FOR_WORDS: Final = 5  # the most companies one set of words is taught for (MAX_CHOICES)


async def save_pair(
    session: AsyncSession,
    *,
    heard: str,
    heard_key: str,
    company_key: str,
    company_name: str,
    made_by: uuid.UUID | None,
) -> bool:
    """Saves the pair once. True when it is new; a pair saved before is kept as it is. The caller
    commits."""
    statement = (
        insert(LearnedName)
        .values(
            heard=heard,
            heard_key=heard_key,
            company_key=company_key,
            company_name=company_name,
            made_by=made_by,
        )
        .on_conflict_do_nothing(index_elements=[LearnedName.heard_key, LearnedName.company_key])
        .returning(LearnedName.id)
    )
    return (await session.scalar(statement)) is not None


async def taught_for(session: AsyncSession, heard_key: str) -> list[str]:
    """The companies taught for these words, the newest pair first."""
    found = await session.scalars(
        select(LearnedName.company_key)
        .where(LearnedName.heard_key == heard_key)
        .order_by(LearnedName.created_at.desc(), LearnedName.id)
        .limit(MAX_FOR_WORDS)
    )
    return list(found)


async def count_for(session: AsyncSession, heard_key: str) -> int:
    """How many companies these words are taught for."""
    found = await session.scalar(
        select(func.count()).select_from(LearnedName).where(LearnedName.heard_key == heard_key)
    )
    return found or 0


async def taught_companies(session: AsyncSession, limit: int) -> list[str]:
    """The companies with learned names: the mic gets them wrong. The most taught first, then the
    newest."""
    count = func.count(LearnedName.id)
    newest = func.max(LearnedName.created_at)
    found = await session.scalars(
        select(LearnedName.company_key)
        .group_by(LearnedName.company_key)
        .order_by(count.desc(), newest.desc(), LearnedName.company_key)
        .limit(limit)
    )
    return list(found)


async def page(
    session: AsyncSession, *, limit: int, offset: int
) -> tuple[list[tuple[LearnedName, str | None, str | None]], int]:
    """One page of pairs, the newest first, each with the company's name in our copy now (None
    when it isn't there) and who taught it. Also how many pairs there are."""
    total = await session.scalar(select(func.count()).select_from(LearnedName))
    rows = await session.execute(
        select(LearnedName, HubSpotCompany.name, User.name)
        .outerjoin(HubSpotCompany, HubSpotCompany.hubspot_id == LearnedName.company_key)
        .outerjoin(User, User.id == LearnedName.made_by)
        .order_by(LearnedName.created_at.desc(), LearnedName.id)
        .limit(limit)
        .offset(offset)
    )
    return [(pair, company, teacher) for pair, company, teacher in rows.all()], total or 0


async def remove(session: AsyncSession, pair_id: uuid.UUID) -> bool:
    """Removes one pair. False when there is none with this id. The caller commits."""
    gone = await session.execute(
        delete(LearnedName).where(LearnedName.id == pair_id).returning(LearnedName.id)
    )
    return gone.first() is not None
