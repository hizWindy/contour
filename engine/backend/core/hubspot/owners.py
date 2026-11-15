"""Who each account is in HubSpot (PLAN-V17 T1-4).

A call, a task or a note a rep logs is written under their HubSpot owner id, so HubSpot shows who
made it. This module keeps the link from an account (`core.users`) to a HubSpot owner: the
owner's id, and how it was matched. Never the owner's email.

- **The sync matches by email** (`match_accounts`, in its "people" phase, after the companies are
  saved). It reads the active owners' emails into memory, compares each account's email with them
  (case and spaces ignored), and saves the owner's id with `email`. The emails are never saved,
  logged, returned or put in an error. The rules are pure code (`plan_links`):
  - a link an Admin set by hand (`person`) is never changed;
  - an active owner with the account's email links it (two owners with one email: the lowest id
    wins);
  - otherwise an old email link is cleared (the owner left, or an email changed).
  An archived owner never matches, nor one our copy doesn't hold as active. A failure is logged
  without the email and never fails the sync: the links made before stay.
- **An Admin sets or clears a link by hand** (`set_by_hand`). Only an active owner in our copy
  (`core.hubspot_owners`) can be picked. A cleared link may be matched by email again at the next
  sync.
- **Reads:** each account's link with the owner's name from our copy (`links_of`), the active
  owners for the pick list (`active_owners`), and one account's owner id (`owner_id_of`, which
  `activities.owner_of` uses).
"""

import logging
import uuid
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.auth.models import User
from core.hubspot.client import HubSpot, HubSpotError, email_key
from core.hubspot.models import HubSpotOwner

log = logging.getLogger(__name__)

MatchedBy = Literal["email", "person"]
BY_EMAIL: MatchedBy = "email"
BY_PERSON: MatchedBy = "person"
OWNERS_CAP = 500  # the most owners the pick list sends. Contour has a few dozen.
OWNER_MATCH_FAILED = (
    "Accounts weren't matched to their HubSpot owners this time. The links made before stay."
)


class HubSpotOwnerLink(BaseModel):
    """Who an account is in HubSpot. Never the owner's email."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(description="The HubSpot owner's id", examples=["301"])
    name: str | None = Field(
        description="The owner's name, from our copy of HubSpot. null: not in our copy",
        examples=["Jo Sample"],
    )
    matched_by: MatchedBy = Field(
        description=(
            "email: the HubSpot sync found an active owner with the account's email. person: an "
            "Admin set it by hand, and the sync never changes it"
        ),
        examples=["email"],
    )


class HubSpotOwnerChoice(BaseModel):
    """An active HubSpot owner, for the pick list. Never an email."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(description="The HubSpot owner's id", examples=["301"])
    name: str | None = Field(
        description="The owner's name. null: HubSpot has none", examples=["Jo Sample"]
    )


class OwnerNotActive(ValueError):
    """The owner id isn't an active owner in our copy of HubSpot."""


# --- The sync's match by email ---------------------------------------------------------------


@dataclass(frozen=True)
class Account:
    """What matching needs to know about one account. Its email is our own, saved at sign-up."""

    id: uuid.UUID
    email: str
    owner_id: str | None
    matched_by: str | None


def plan_links(
    accounts: Iterable[Account], owners_by_email: Mapping[str, str], active: Collection[str]
) -> dict[uuid.UUID, str | None]:
    """The links the sync changes: account id -> the owner id to link, or None to clear an old
    email link. An account whose link stays as it is is left out. Pure code: no database, no
    HubSpot.

    `owners_by_email` is `HubSpot.owner_emails()`. `active` is the active owners' ids in our copy:
    an owner outside it (archived, or not copied yet) never matches.
    """
    changes: dict[uuid.UUID, str | None] = {}
    for account in accounts:
        if account.matched_by == BY_PERSON:
            continue  # set by hand: the sync never changes it
        key = email_key(account.email)
        found = owners_by_email.get(key) if key is not None else None
        if found is not None and found not in active:
            found = None
        if found is not None:
            if (account.owner_id, account.matched_by) != (found, BY_EMAIL):
                changes[account.id] = found
        elif account.owner_id is not None or account.matched_by is not None:
            changes[account.id] = None  # the owner left, or an email changed
    return changes


async def match_accounts(sessions: async_sessionmaker[AsyncSession], hubspot: HubSpot) -> list[str]:
    """The sync's step: links each account to the active HubSpot owner with its email. Returns the
    warnings for the sync row: none when it worked. Only a cancel goes on up from here."""
    try:
        async with sessions() as session:
            wanted = await session.scalar(
                select(exists().where(User.hubspot_owner_matched_by.is_distinct_from(BY_PERSON)))
            )
        if not wanted:
            return []  # no account, or every link was set by hand: HubSpot isn't asked
        # No database connection is held while HubSpot answers.
        owners_by_email = await hubspot.owner_emails()
        async with sessions() as session:
            counts = await _save_links(session, owners_by_email)
            await session.commit()
    except HubSpotError as error:
        log.warning("hubspot_owner_match_failed", extra={"reason": error.title})
        return [OWNER_MATCH_FAILED]
    except Exception as error:
        # The kind of error only: its text could quote HubSpot's answer or a row, with an email.
        log.warning("hubspot_owner_match_failed", extra={"error": type(error).__name__})
        return [OWNER_MATCH_FAILED]
    log.info("hubspot_owner_links", extra=counts)
    return []


async def _save_links(session: AsyncSession, owners_by_email: Mapping[str, str]) -> dict[str, int]:
    """Saves the sync's links in the session's transaction. Only ids are written. The caller
    commits. Returns the counts for the log line."""
    active = set(
        await session.scalars(select(HubSpotOwner.owner_id).where(HubSpotOwner.archived.is_(False)))
    )
    rows = await session.execute(
        select(User.id, User.email, User.hubspot_owner_id, User.hubspot_owner_matched_by)
    )
    accounts = [
        Account(id=account_id, email=email, owner_id=owner_id, matched_by=matched_by)
        for account_id, email, owner_id, matched_by in rows
    ]
    changes = plan_links(accounts, owners_by_email, active)
    for account_id, owner_id in changes.items():
        # A link an Admin sets while the sync runs wins: only one that isn't by hand changes.
        await session.execute(
            update(User)
            .where(User.id == account_id, User.hubspot_owner_matched_by.is_distinct_from(BY_PERSON))
            .values(
                hubspot_owner_id=owner_id,
                hubspot_owner_matched_by=None if owner_id is None else BY_EMAIL,
            )
            .execution_options(synchronize_session=False)
        )
    linked = sum(owner_id is not None for owner_id in changes.values())
    return {
        "accounts": len(accounts),
        "linked": linked,
        "cleared": len(changes) - linked,
        "by_hand": sum(account.matched_by == BY_PERSON for account in accounts),
    }


# --- An Admin's choice -----------------------------------------------------------------------


async def set_by_hand(
    session: AsyncSession, user_id: uuid.UUID, owner_id: str | None
) -> User | None:
    """Sets one account's owner by hand (`person`), or clears the link with None, so the next
    sync may match the email again. The account's row stays locked until the caller commits.

    Returns None when there is no such account. Raises `OwnerNotActive` for an owner id that
    isn't an active owner in our copy.
    """
    user = await session.get(User, user_id, with_for_update=True)
    if user is None:
        return None
    if owner_id is None:
        user.hubspot_owner_id = None
        user.hubspot_owner_matched_by = None
        return user
    active = await session.scalar(
        select(HubSpotOwner.owner_id).where(
            HubSpotOwner.owner_id == owner_id, HubSpotOwner.archived.is_(False)
        )
    )
    if active is None:
        raise OwnerNotActive(owner_id)
    user.hubspot_owner_id = owner_id
    user.hubspot_owner_matched_by = BY_PERSON
    return user


# --- Reads -----------------------------------------------------------------------------------


async def links_of(
    session: AsyncSession, users: Iterable[User]
) -> dict[uuid.UUID, HubSpotOwnerLink]:
    """Each linked account's link, with the owner's name from our copy (None when the owner isn't
    in it). An account with no link is left out. One query, however many accounts."""
    linked: list[tuple[uuid.UUID, str, str]] = []
    for user in users:
        owner_id, matched_by = user.hubspot_owner_id, user.hubspot_owner_matched_by
        if owner_id is not None and matched_by is not None:
            linked.append((user.id, owner_id, matched_by))
    if not linked:
        return {}
    rows = await session.execute(
        select(HubSpotOwner.owner_id, HubSpotOwner.name).where(
            HubSpotOwner.owner_id.in_({owner_id for _, owner_id, _ in linked})
        )
    )
    names = dict(rows.all())
    return {
        account_id: HubSpotOwnerLink.model_validate(
            {"id": owner_id, "name": names.get(owner_id), "matched_by": matched_by}
        )
        for account_id, owner_id, matched_by in linked
    }


async def active_owners(
    session: AsyncSession, *, limit: int = OWNERS_CAP
) -> list[HubSpotOwnerChoice]:
    """The active owners in our copy, by name (any case; an owner with no name last)."""
    rows = await session.execute(
        select(HubSpotOwner.owner_id, HubSpotOwner.name)
        .where(HubSpotOwner.archived.is_(False))
        .order_by(func.lower(HubSpotOwner.name).asc().nulls_last(), HubSpotOwner.owner_id)
        .limit(max(1, min(limit, OWNERS_CAP)))
    )
    return [HubSpotOwnerChoice(id=owner_id, name=name) for owner_id, name in rows]


async def owner_id_of(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """One account's HubSpot owner id. None: no link, or no such account."""
    found: str | None = await session.scalar(
        select(User.hubspot_owner_id).where(User.id == user_id)
    )
    return found
