"""The Platform admin's People tab (PLAN-V9 E1, PLAN-V19 T1-3 to T1-5).

All routes here require `PlatformAdminDep` (`403 platform_admin_only` for any other role).

PLAN-V23 T3-1: each person's HubSpot user (`hubspot`: linked, none or not_set). Add person needs
one choice, their HubSpot user or "No HubSpot user" (422 `hubspot_choice_missing` for neither); a
new "No HubSpot user" person starts with the Call logs tick only, unless ticks are sent. The link
change also takes "No HubSpot user".

PLAN-V26 Part 2: a reset may keep the person signed in, the username can be changed, a locked
person can be unlocked, and every change here records the admin, their address and their device
(`audit.made_by`).
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OutModel, SafeText, no_default_in_types, optional_in_types
from core.api.signin import AuthSettingsDep, HasherDep, NowDep, PlatformAdminDep, client_ip
from core.auth import audit, clean, sessions, users
from core.auth.admin import BY_COMMAND, create_person, reset_password
from core.auth.features import (
    APPS_ORDER,
    FEATURES,
    AssignableRole,
    Feature,
    Role,
    apps_from_features,
    default_features,
    effective_features,
    is_admin,
    is_platform_admin,
    normalize_features,
)
from core.auth.models import User
from core.auth.passphrase import generate_password
from core.auth.sessions import AuthContext
from core.auth.users import LoginTaken
from core.config import Settings
from core.hubspot import owners
from core.hubspot.owners import HUBSPOT_USER_HELP, HubSpotOwnerLink, HubSpotUser

router = APIRouter(prefix="/people", tags=["people"])

BY_ADMIN = "admin"  # what the sign-in log says made an account from the People tab
# A new person with "No HubSpot user" starts with this tick only (PLAN-V23 choice 13): Meetings
# can be added, for someone who writes pre-reads.
NO_HUBSPOT_USER_TICKS: tuple[Feature, ...] = ("companies.call_logs",)
BOTH_CHOICES = "Pick one: their HubSpot user, or No HubSpot user."


class LockOut(OutModel):
    until: datetime = Field(description="When the lock ends by itself")
    wrong_tries: int = Field(description="The wrong passwords in a row that locked it")


class PersonOut(OutModel):
    # `hubspot` (PLAN-V23 T3-1) and `lock` (PLAN-V26 T2-4): the API always sends them, and the
    # website's types leave them optional, so older test data still type-checks.
    model_config = ConfigDict(json_schema_extra=optional_in_types("hubspot", "lock"))

    id: uuid.UUID
    name: str
    email: str
    username: str | None
    position: str | None = Field(None, description="Optional job title, like Sales Director")
    role: Role
    apps: list[str] = Field(description="The projects this person may use, filled from features")
    features: list[str] = Field(description="The feature ticks enabled on this account")
    active: bool = Field(description="false: this account can't sign in")
    created_at: datetime
    last_signed_in_at: datetime | None
    hubspot_owner: HubSpotOwnerLink | None = Field(
        description=(
            "Who this person is in HubSpot: the calls they log land under this owner. null: no "
            "link, so HubSpot shows their calls as unassigned"
        )
    )
    hubspot: HubSpotUser = Field(description="Their HubSpot user (PLAN-V23). " + HUBSPOT_USER_HELP)
    lock: LockOut | None = Field(
        None,
        description=(
            "Too many wrong passwords in a row locked this account (PLAN-V26). null: not locked"
        ),
        json_schema_extra=no_default_in_types,
    )


class PersonCreatedOut(PersonOut):
    starting_password: str = Field(
        description="The generated starting password, returned once here and never kept."
    )


class ResetPasswordOut(OutModel):
    starting_password: str = Field(
        description="The new generated password, returned once here and never kept."
    )


class ResetPasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sign_out: bool = Field(
        True,
        description=(
            "Sign them out everywhere. false: the new password works at once, and their open "
            "browsers stay signed in"
        ),
    )


def _dedupe_features(value: list[Feature]) -> list[Feature]:
    return [f for f in FEATURES if f in value]


class PersonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: SafeText = Field(min_length=1, max_length=120, examples=["Marcus Lee"])
    email: SafeText = Field(max_length=254, examples=["marcus@contourinteriors.com.au"])
    username: SafeText | None = Field(None, max_length=64)
    position: SafeText | None = Field(None, max_length=clean.POSITION_MAX)
    role: AssignableRole = "staff"
    features: list[Feature] | None = Field(
        None,
        max_length=20,
        description=(
            "Ticks for this account. Left out: the role's starting ticks, or the Call logs tick "
            "only for No HubSpot user."
        ),
    )
    hubspot_owner_id: SafeText | None = Field(
        None,
        max_length=32,
        description=(
            "Their HubSpot user: an active owner's id from GET /hubspot/owners. A new person "
            "needs this or `no_hubspot_user` (422 `hubspot_choice_missing` for neither)"
        ),
        examples=["301"],
    )
    no_hubspot_user: bool = Field(
        False,
        description=(
            "true: this person has no HubSpot login, like a designer (PLAN-V23 T3-1). Their calls "
            "go to HubSpot with no owner, and they get no HubSpot tasks"
        ),
    )

    @field_validator("features")
    @classmethod
    def _clean_features(cls, value: list[Feature] | None) -> list[Feature] | None:
        return None if value is None else _dedupe_features(value)

    @field_validator("hubspot_owner_id")
    @classmethod
    def _owner_trimmed(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class PersonPatch(BaseModel):
    """A merge patch: a field left out stays as it is."""

    model_config = ConfigDict(extra="forbid")

    features: list[Feature] | None = Field(None, max_length=20)
    username: SafeText | None = Field(
        None,
        max_length=64,
        description=(
            "Lower case, no @, not taken (409 `username_taken`). null or empty: no username, so "
            "they sign in with their email"
        ),
    )
    position: SafeText | None = Field(None, max_length=clean.POSITION_MAX)
    role: AssignableRole | None = None
    active: bool | None = None

    @field_validator("features")
    @classmethod
    def _clean_features(cls, value: list[Feature] | None) -> list[Feature] | None:
        return None if value is None else _dedupe_features(value)


class HubSpotOwnerIn(BaseModel):
    """Who a person is in HubSpot, chosen by hand. null clears it; null with `no_hubspot_user`
    marks the person "No HubSpot user"."""

    model_config = ConfigDict(extra="forbid")

    owner_id: SafeText | None = Field(
        max_length=32,
        description="An active owner's id from GET /hubspot/owners, or null to clear the link",
        examples=["301"],
    )
    # Nullable with no default value, so a call written before PLAN-V23 (`{"owner_id": ...}`)
    # still fits the website's types: null and false both mean "not marked".
    no_hubspot_user: bool | None = Field(
        None,
        description=(
            "true, with owner_id null: mark the person No HubSpot user (PLAN-V23 T3-1). It clears "
            "any link, and a link clears it. Left out, null or false: the link changes as before"
        ),
    )

    @field_validator("owner_id")
    @classmethod
    def _trimmed(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()


def _lock(user: User, now: datetime, settings: Settings) -> LockOut | None:
    """The lock, while there is one. The short waits before the 10th wrong try aren't locks."""
    until = user.locked_until
    if until is None or until <= now or user.failed_attempts < settings.login_lock_tries:
        return None
    return LockOut(until=until, wrong_tries=user.failed_attempts)


def _out_fields(
    user: User, hubspot_owner: HubSpotOwnerLink | None, lock: LockOut | None
) -> dict[str, object]:
    resolved_features = effective_features(user.role, user.features)
    resolved_apps = apps_from_features(resolved_features) or list(user.apps or [])
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "username": user.username,
        "position": user.position,
        "role": user.role,
        "apps": resolved_apps,
        "features": resolved_features,
        "active": user.active,
        "created_at": user.created_at,
        "last_signed_in_at": user.last_signed_in_at,
        "hubspot_owner": hubspot_owner,
        "hubspot": owners.hubspot_user(user),
        "lock": lock,
    }


def _out(user: User, hubspot_owner: HubSpotOwnerLink | None, lock: LockOut | None) -> PersonOut:
    return PersonOut.model_validate(_out_fields(user, hubspot_owner, lock))


async def _out_with_owner(
    session: AsyncSession, user: User, now: datetime, settings: Settings
) -> PersonOut:
    links = await owners.links_of(session, [user])
    return _out(user, links.get(user.id), _lock(user, now, settings))


def _made_by(admin: AuthContext | None, request: Request) -> dict[str, object]:
    return audit.made_by(
        admin.user if admin else None,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


def _username_taken() -> Problem:
    return Problem(
        409,
        "That username is taken",
        "Someone else has this username. Pick another.",
        code="username_taken",
        errors=[{"field": "body.username", "message": "This username already has an account."}],
    )


def _invalid(field: str, message: str) -> Problem:
    return Problem(
        422,
        "Some fields need a fix",
        "Look at the fields listed.",
        errors=[{"field": f"body.{field}", "message": message}],
    )


def hubspot_choice_missing() -> Problem:
    """A new person needs their HubSpot user, or "No HubSpot user" (PLAN-V23 T3-1)."""
    return Problem(
        422,
        "Pick their HubSpot user",
        "Pick this person's HubSpot user from the list, or pick No HubSpot user.",
        code="hubspot_choice_missing",
        errors=[
            {
                "field": "body.hubspot_owner_id",
                "message": "Pick their HubSpot user, or No HubSpot user.",
            }
        ],
    )


def owner_not_active() -> Problem:
    return _invalid("owner_id", "This isn't an active HubSpot owner. Pick one from the list.")


@router.get("", response_model=list[PersonOut], summary="Everyone with an account")
async def list_people(
    session: SessionDep, admin: PlatformAdminDep, now: NowDep, settings: AuthSettingsDep
) -> list[PersonOut]:
    people = list(await session.scalars(select(User).order_by(func.lower(User.name), User.email)))
    links = await owners.links_of(session, people)
    return [_out(user, links.get(user.id), _lock(user, now, settings)) for user in people]


@router.post(
    "",
    status_code=201,
    response_model=PersonCreatedOut,
    summary="Add a person",
    description=(
        "A new account with a generated starting password shown once in this answer. It needs "
        "one HubSpot choice: `hubspot_owner_id` (their HubSpot user, an active owner from GET "
        "/hubspot/owners) or `no_hubspot_user: true` (PLAN-V23 T3-1). 422 "
        "`hubspot_choice_missing` for neither, and a field error for both or an owner that isn't "
        "active. A No HubSpot user person starts with the Call logs tick only, unless `features` "
        "are sent. Platform admin only."
    ),
)
async def add_person(
    body: PersonIn,
    request: Request,
    response: Response,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    settings: AuthSettingsDep,
    hasher: HasherDep,
) -> PersonCreatedOut:
    try:
        cleaned_email = clean.email(body.email)
    except ValueError as error:
        raise _invalid("email", str(error)) from None
    try:
        cleaned_username = clean.username(body.username)
    except ValueError as error:
        raise _invalid("username", str(error)) from None
    try:
        cleaned_position = clean.position(body.position)
    except ValueError as error:
        raise _invalid("position", str(error)) from None
    if body.hubspot_owner_id is None and not body.no_hubspot_user:
        raise hubspot_choice_missing()
    if body.hubspot_owner_id is not None and body.no_hubspot_user:
        raise _invalid("no_hubspot_user", BOTH_CHOICES)
    if body.hubspot_owner_id is not None and not await owners.is_active(
        session, body.hubspot_owner_id
    ):
        raise _invalid(
            "hubspot_owner_id", "This isn't an active HubSpot owner. Pick one from the list."
        )

    starting = generate_password(email=cleaned_email, username=cleaned_username)
    if body.features is not None:
        chosen_features = [str(feature) for feature in body.features]
    elif body.no_hubspot_user:
        chosen_features = list(NO_HUBSPOT_USER_TICKS)
    else:
        chosen_features = default_features(body.role)
    try:
        user = await create_person(
            session,
            email=cleaned_email,
            username=cleaned_username,
            name=body.name,
            position=cleaned_position,
            role=body.role,
            features=chosen_features,
            password=starting,
            now=now,
            hasher=hasher,
            by=BY_ADMIN if admin is not None else BY_COMMAND,
            hubspot_owner_id=body.hubspot_owner_id,
            no_hubspot_user=body.no_hubspot_user,
            made_by=_made_by(admin, request),
        )
    except LoginTaken as taken:
        raise _invalid(taken.field, f"This {taken.field} already has an account.") from None
    response.headers["Cache-Control"] = "no-store"
    created = await _out_with_owner(session, user, now, settings)
    return PersonCreatedOut.model_validate(created.model_dump() | {"starting_password": starting})


@router.patch(
    "/{user_id}",
    response_model=PersonOut,
    summary="Change a person's username, ticks, position, role or whether they can sign in",
)
async def change_person(
    user_id: Annotated[uuid.UUID, Path()],
    body: PersonPatch,
    request: Request,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    settings: AuthSettingsDep,
) -> PersonOut:
    user = await session.get(User, user_id, with_for_update=True)
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    sent = body.model_fields_set
    is_self = admin is not None and admin.user.id == user.id
    if is_self and "role" in sent and body.role != user.role:
        raise _invalid("role", "You can't change your own role.")
    if is_platform_admin(user.role) and "role" in sent and body.role is not None:
        raise _invalid("role", "The Platform admin role changes with a server command.")
    if (is_self or is_platform_admin(user.role)) and "active" in sent and body.active is False:
        raise _invalid("active", "You can't switch your own account off.")
    renamed: dict[str, str | None] = {}
    if "username" in sent:
        try:
            wanted = clean.username(body.username)
        except ValueError as error:
            raise _invalid("username", str(error)) from None
        if wanted != user.username:
            renamed = {"username_from": user.username, "username_to": wanted}
            try:
                await users.change_username(session, user, wanted)  # the old one stops at once
            except LoginTaken:
                raise _username_taken() from None
    if "position" in sent:
        try:
            user.position = clean.position(body.position)
        except ValueError as error:
            raise _invalid("position", str(error)) from None
    if "role" in sent and body.role is not None:
        user.role = body.role
    if is_admin(user.role):
        user.features = list(FEATURES)
        user.apps = list(APPS_ORDER)
    elif "features" in sent and body.features is not None:
        user.features = normalize_features(body.features)
        user.apps = apps_from_features(user.features)
    if "active" in sent and body.active is not None:
        user.active = body.active
        if not user.active:
            await sessions.end_for_user(session, user.id, now)
    audit.add_entry(
        session,
        "account_changed",
        user_id=user.id,
        details={
            "fields": sorted(sent),
            "role": user.role,
            "features": list(user.features or []),
            "apps": list(user.apps or []),
            **renamed,
            **_made_by(admin, request),
        },
        at=now,
    )
    await session.commit()
    await session.refresh(user)
    return await _out_with_owner(session, user, now, settings)


@router.post(
    "/{user_id}/password",
    response_model=ResetPasswordOut,
    summary="Reset a person's password",
    description=(
        "Generates a new starting password and returns it once. It works at once, and it lifts a "
        "lock. `sign_out` (the default, also with no body) ends all open sessions of that "
        "person; false keeps their open browsers signed in (PLAN-V26). Platform admin only."
    ),
)
async def reset_person_password(
    user_id: Annotated[uuid.UUID, Path()],
    request: Request,
    response: Response,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    hasher: HasherDep,
    body: ResetPasswordIn | None = None,
) -> ResetPasswordOut:
    user = await session.get(User, user_id, with_for_update=True)
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    starting = generate_password(email=user.email, username=user.username)
    await reset_password(
        session,
        user,
        starting,
        now=now,
        hasher=hasher,
        by=BY_ADMIN if admin is not None else BY_COMMAND,
        sign_out=body.sign_out if body else True,
        made_by=_made_by(admin, request),
    )
    response.headers["Cache-Control"] = "no-store"
    return ResetPasswordOut(starting_password=starting)


@router.post(
    "/{user_id}/unlock",
    response_model=PersonOut,
    summary="Unlock a person",
    description=(
        "Lifts the lock that too many wrong passwords set and clears the count, so the right "
        "password works at once. A person who isn't locked is returned as they are. Platform "
        "admin only."
    ),
)
async def unlock_person(
    user_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    settings: AuthSettingsDep,
) -> PersonOut:
    user = await session.get(User, user_id, with_for_update=True)
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    if user.failed_attempts or user.locked_until is not None:
        # The log's kinds are a fixed list in the database, so an unlock is an `account_changed`.
        was = {
            "fields": ["lock"],
            "unlocked": True,
            "wrong_tries": user.failed_attempts,
            "locked_until": user.locked_until.isoformat() if user.locked_until else None,
        }
        users.unlock(user)
        audit.add_entry(
            session,
            "account_changed",
            user_id=user.id,
            details=was | _made_by(admin, request),
            at=now,
        )
        await session.commit()
        await session.refresh(user)
    return await _out_with_owner(session, user, now, settings)


@router.put(
    "/{user_id}/hubspot-owner",
    response_model=PersonOut,
    summary="Set or clear who a person is in HubSpot",
    description=(
        "Links the account to a HubSpot owner by hand, so the calls, tasks and notes this person "
        "logs land under that owner in HubSpot. `owner_id` is an active owner from GET "
        "/hubspot/owners. The HubSpot sync never changes a link set by hand. "
        '`{"owner_id": null}` clears the link (and the mark: `hubspot` not_set), and the next '
        "sync may then match the person by email again. "
        '`{"owner_id": null, "no_hubspot_user": true}` marks the person No HubSpot user '
        "(PLAN-V23 T3-1): it clears any link, the sync never links them, and a link set later "
        "clears the mark. Both an owner and the mark is a field error. Platform admin only."
    ),
)
async def set_hubspot_owner(
    user_id: Annotated[uuid.UUID, Path()],
    body: HubSpotOwnerIn,
    request: Request,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    settings: AuthSettingsDep,
) -> PersonOut:
    mark = body.no_hubspot_user is True
    if body.owner_id is not None and mark:
        raise _invalid("no_hubspot_user", BOTH_CHOICES)
    try:
        user = await owners.set_by_hand(session, user_id, body.owner_id, no_hubspot_user=mark)
    except owners.OwnerNotActive:
        raise owner_not_active() from None
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    audit.add_entry(
        session,
        "account_changed",
        user_id=user.id,
        details={
            "fields": ["hubspot_owner"],
            "hubspot_owner_id": user.hubspot_owner_id,
            "hubspot": owners.hubspot_user(user),
            **_made_by(admin, request),
        },
        at=now,
    )
    await session.commit()
    await session.refresh(user)
    return await _out_with_owner(session, user, now, settings)
