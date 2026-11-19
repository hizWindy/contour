"""Learned names (PLAN-V23 T1-2, choice 3): when a rep picks a company by hand for words the mic
heard, the card sends the pair after it is sent, and it is kept for the whole team. The command
step tries learned names before the close-name match (`learned_hits` in assistant_find.py). The
routes are in api_assistant.py, and the table's code in learned_store.py.

- **Saved once, and only when it teaches something:** the words must differ from the company's
  name, case and spaces aside ("North Wind" and Northwind differ, "northwind" and Northwind
  don't), and hold a word of 2 letters or more. A pair saved before is kept as it is. One set
  of words may be taught for up to 5 companies: then each is a choice, and a sixth isn't kept.
- **Words only:** never audio, and never an email address or a phone number (422
  `contact_details`).
- **The company** must be open to this person: in our HubSpot copy, or a lead of a project whose
  tick they have (404 `company_not_found` otherwise).
- **Admins** see every pair and remove one.
- Log lines hold counts and ids only, never the words.
"""

import logging
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import learned_store
from apps.companies.assistant_find import company_hit, heard, heard_key, name_words
from apps.companies.assistant_schemas import (
    HEARD_MAX_CHARS,
    LearnedNameIn,
    LearnedNameOut,
    LearnedNamePage,
)
from apps.companies.assistant_tasks import company_not_found
from apps.companies.facts import scrub
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads

log = logging.getLogger(__name__)

# --- The words (PLAN-V15 "Words for errors") ----------------------------------------------------


def contact_details() -> Problem:
    return Problem(
        422,
        "Contact details left out",
        "Phone numbers and emails can't be kept as a learned name. Take them out, then try again.",
        code="contact_details",
    )


def learned_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that learned name",
        "It may have been removed already. Reload the list.",
        code="learned_not_found",
    )


# --- Saving a pair -------------------------------------------------------------------------------


async def learn(
    session: AsyncSession,
    body: LearnedNameIn,
    *,
    auth: AuthContext | None,
    leads: Sequence[CompanyLeads],
) -> bool:
    """Keeps the pair for the whole team, once. True when it was saved now; False when it teaches
    nothing (the company's own name), was saved before, or its words have 5 companies already."""
    if scrub(body.heard) != body.heard:
        raise contact_details()
    words = heard(body.heard)[:HEARD_MAX_CHARS].rstrip()
    key = heard_key(words)
    hit = await company_hit(session, body.company_key.strip(), leads)
    if hit is None:
        raise company_not_found()
    if not name_words(words) or key == heard_key(hit.name):  # nothing to learn
        await session.rollback()
        return False
    if await learned_store.count_for(session, key) >= learned_store.MAX_FOR_WORDS:
        await session.rollback()
        log.info("learned_name_full", extra={"company_key": hit.key})
        return False
    saved = await learned_store.save_pair(
        session,
        heard=words,
        heard_key=key,
        company_key=hit.key,
        company_name=hit.name,
        made_by=auth.user.id if auth is not None else None,
    )
    await session.commit()
    log.info("learned_name", extra={"company_key": hit.key, "new": saved})
    return saved


# --- The Admin list ------------------------------------------------------------------------------


async def list_pairs(session: AsyncSession, *, limit: int, offset: int) -> LearnedNamePage:
    """Every pair, the newest first, a page at a time."""
    rows, total = await learned_store.page(session, limit=limit, offset=offset)
    found = LearnedNamePage(
        total=total,
        items=[
            LearnedNameOut(
                id=pair.id,
                heard=pair.heard,
                company_key=pair.company_key,
                company_name=company or pair.company_name,
                taught_by=teacher,
                created_at=pair.created_at,
            )
            for pair, company, teacher in rows
        ],
    )
    await session.rollback()  # reads only
    return found


async def remove_pair(session: AsyncSession, pair_id: uuid.UUID) -> None:
    """Removes one pair (404 `learned_not_found` when there is none)."""
    if not await learned_store.remove(session, pair_id):
        await session.rollback()
        raise learned_not_found()
    await session.commit()
    log.info("learned_name_removed", extra={"pair_id": str(pair_id)})
