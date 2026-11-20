"""Picking the company of a call saved before it was found (PLAN-V24 T3-1, choices 17 and 21).
The route is the call note PATCH in api_notes.py, with `company_key`.

- **Only while it needs one.** A call saved with only its company's name as heard is
  `needs_company`. Its company is taken only then: a call that has its company gives 409
  `company_set` (TBC).
- **A company open to this person:** in our HubSpot copy, or a lead of a project whose tick they
  have, as saving checks it (422 `company_not_found` otherwise).
- **With it, only the person, the outcome and `teach`.** The sort makes the rest of the card
  anew, so anything else is refused (409 `company_first`).
- **Then it carries on as any call does:** it is sorted exactly as a new call is
  (`note_store.start_sort`): by Claude in the background, or by hand at once with the AI off or
  no words to sort. Then it waits in To confirm.
- **Picking teaches the mic** (choice 21): the words heard and the picked company are kept as a
  learned name for the whole team (PLAN-V23 T1-2), by the card's rules: only when the words
  differ from the company's name, case and spaces aside, once, and for at most 5 companies.
  Never words that held an email address or a phone number. A pick sent with `teach` false
  teaches nothing: the card sends it for a company picked from the command's own choices
  ("Which Sample?"), which PLAN-V23 says shouldn't teach. The sort is the same either way.
- **One step:** the company, the sort's start and the learned name are saved together, under the
  call's lock, with only database reads while it is held. Log lines hold ids, never the words.
"""

import logging
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import learned_store
from apps.companies.assistant_find import heard, heard_key
from apps.companies.assistant_learned import teaches
from apps.companies.assistant_schemas import HEARD_MAX_CHARS
from apps.companies.facts import EMAIL_GONE, PHONE_GONE
from apps.companies.note_store import (
    company_first,
    company_named,
    maker_of,
    note_not_found,
    person_at,
    refused,
    start_sort,
)
from apps.companies.notes import NoteCard
from apps.companies.schemas import CallNotePatch
from apps.companies.tables import CallNote
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads
from core.config import Settings

log = logging.getLogger(__name__)

WITH_COMPANY: Final = frozenset({"company_key", "contact_id", "outcome", "teach"})
# How a left-out email address or phone number starts in the words kept (facts.scrub), even when
# the words were cut to fit: such words never teach the mic.
LEFT_OUT: Final = tuple(gone.split(" out")[0] for gone in (EMAIL_GONE, PHONE_GONE))

# --- The words (PLAN-V15 "Words for errors"): what happened, then one thing to do ---------------


def company_set() -> Problem:
    return Problem(
        409,
        "The company is set already",
        "This call has its company already, so it can't be picked again. Reload Call logs to "
        "see it.",
        code="company_set",
    )


def company_not_open() -> Problem:
    """The picked company isn't open to this person: 422, as the plan has it. Saving a call
    answers 404 with the same code."""
    return refused(
        "We can't find that company",
        "It may have been removed, or it isn't open to your account. Pick another company, or "
        "search for it again.",
        code="company_not_found",
    )


# --- Picking ---------------------------------------------------------------------------------


async def pick_company(
    session: AsyncSession,
    note: CallNote,
    patch: CallNotePatch,
    *,
    auth: AuthContext | None,
    leads: Sequence[CompanyLeads],
    settings: Settings,
    now: datetime,
) -> None:
    """Sets the company of a call that needs one, with the person and the outcome if they came,
    and sends it to be sorted as a new call is: `sorting` (the caller starts the sorter once this
    returns), or in the rep's batch at once, sorted by hand. The words heard teach the mic,
    unless the pick says not to (`teach` false)."""
    key = patch.company_key
    if key is None:  # the route sends only a pick here
        raise company_first()
    locked = await session.get(CallNote, note.id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise note_not_found()
    note = locked  # the same object, as the database has it now
    if note.status != "needs_company":
        raise company_set()
    given = patch.model_fields_set
    if given - WITH_COMPANY:
        raise company_first()
    name = await company_named(session, key, leads)
    if name is None:
        raise company_not_open()
    contact = await person_at(session, key, patch.contact_id) if patch.contact_id else None
    # All at once, so no write ever sees a company without its status: the table keeps a call
    # with a company out of `needs_company`. start_sort settles the status.
    note.company_key, note.company_name, note.status = key, name, "sorting"
    if contact is not None:
        note.contact_id = contact.hubspot_id
        note.person_name = contact.name
        note.person_title = contact.job_title
    if "outcome" in given:  # the rep's own pick: the sort keeps it
        card = NoteCard.model_validate(note.card or {})
        card.call.outcome = patch.outcome
        note.card = card.model_dump(mode="json")
    await start_sort(session, note, settings=settings, now=now)
    taught = await teach(session, note, maker=maker_of(auth)) if patch.teach else False
    await session.commit()
    log.info(
        "call_company_picked",
        extra={"note_id": str(note.id), "status": note.status, "taught": taught},
    )


async def teach(session: AsyncSession, note: CallNote, *, maker: uuid.UUID | None) -> bool:
    """Keeps the words heard and the picked company as a learned name for the whole team, by the
    card's rules (`assistant_learned.learn`). True when the pair is new. The caller commits."""
    said, key, name = note.company_heard, note.company_key, note.company_name
    if said is None or key is None or name is None or any(mark in said for mark in LEFT_OUT):
        return False
    words = heard(said)[:HEARD_MAX_CHARS].rstrip()
    if not teaches(words, name):
        return False
    words_key = heard_key(words)
    if await learned_store.count_for(session, words_key) >= learned_store.MAX_FOR_WORDS:
        return False
    return await learned_store.save_pair(
        session,
        heard=words,
        heard_key=words_key,
        company_key=key,
        company_name=name,
        made_by=maker,
    )
