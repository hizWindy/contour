"""The Platform admin's People tab (PLAN-V9 E1, PLAN-V19 T1-3 to T1-5).

All routes here require `PlatformAdminDep` (`403 platform_admin_only` for any other role).
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
from core.api.models import OutModel, SafeText
from core.api.signin import HasherDep, NowDep, PlatformAdminDep
from core.auth import audit, clean, sessions
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
from core.auth.users import LoginTaken
from core.hubspot import owners
from core.hubspot.owners import HubSpotOwnerLink

router = APIRouter(prefix="/people", tags=["people"])

BY_ADMIN = "admin"  # what the sign-in log says made an account from the People tab


class PersonOut(OutModel):
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


class PersonCreatedOut(PersonOut):
    starting_password: str = Field(
        description="The generated starting password, returned once here and never kept."
    )


class ResetPasswordOut(OutModel):
    starting_password: str = Field(
        description="The new generated password, returned once here and never kept."
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
        description="Ticks for this account. Left out: the role's starting ticks.",
    )

    @field_validator("features")
    @classmethod
    def _clean_features(cls, value: list[Feature] | None) -> list[Feature] | None:
        return None if value is None else _dedupe_features(value)


class PersonPatch(BaseModel):
    """A merge patch: a field left out stays as it is."""

    model_config = ConfigDict(extra="forbid")

    features: list[Feature] | None = Field(None, max_length=20)
    position: SafeText | None = Field(None, max_length=clean.POSITION_MAX)
    role: AssignableRole | None = None
    active: bool | None = None

    @field_validator("features")
    @classmethod
    def _clean_features(cls, value: list[Feature] | None) -> list[Feature] | None:
        return None if value is None else _dedupe_features(value)


class HubSpotOwnerIn(BaseModel):
    """Who a person is in HubSpot, chosen by hand. null clears it."""

    model_config = ConfigDict(extra="forbid")

    owner_id: SafeText | None = Field(
        max_length=32,
        description="An active owner's id from GET /hubspot/owners, or null to clear the link",
        examples=["301"],
    )

    @field_validator("owner_id")
    @classmethod
    def _trimmed(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()


def _out_fields(user: User, hubspot_owner: HubSpotOwnerLink | None = None) -> dict[str, object]:
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
    }


def _out(user: User, hubspot_owner: HubSpotOwnerLink | None = None) -> PersonOut:
    return PersonOut.model_validate(_out_fields(user, hubspot_owner))


async def _out_with_owner(session: AsyncSession, user: User) -> PersonOut:
    links = await owners.links_of(session, [user])
    return _out(user, links.get(user.id))


def _invalid(field: str, message: str) -> Problem:
    return Problem(
        422,
        "Some fields need a fix",
        "Look at the fields listed.",
        errors=[{"field": f"body.{field}", "message": message}],
    )


@router.get("", response_model=list[PersonOut], summary="Everyone with an account")
async def list_people(session: SessionDep, admin: PlatformAdminDep) -> list[PersonOut]:
    users = list(await session.scalars(select(User).order_by(func.lower(User.name), User.email)))
    links = await owners.links_of(session, users)
    return [_out(user, links.get(user.id)) for user in users]


@router.post(
    "",
    status_code=201,
    response_model=PersonCreatedOut,
    summary="Add a person",
    description=(
        "A new account with a generated starting password shown once in this answer. "
        "Platform admin only."
    ),
)
async def add_person(
    body: PersonIn,
    response: Response,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
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

    starting = generate_password(email=cleaned_email, username=cleaned_username)
    chosen_features = (
        default_features(body.role)
        if body.features is None
        else [str(feature) for feature in body.features]
    )
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
        )
    except LoginTaken as taken:
        raise _invalid(taken.field, f"This {taken.field} already has an account.") from None
    response.headers["Cache-Control"] = "no-store"
    return PersonCreatedOut.model_validate(_out_fields(user) | {"starting_password": starting})


@router.patch(
    "/{user_id}",
    response_model=PersonOut,
    summary="Change a person's ticks, position, role or whether they can sign in",
)
async def change_person(
    user_id: Annotated[uuid.UUID, Path()],
    body: PersonPatch,
    request: Request,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
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
        },
        at=now,
    )
    await session.commit()
    await session.refresh(user)
    return await _out_with_owner(session, user)


@router.post(
    "/{user_id}/password",
    response_model=ResetPasswordOut,
    summary="Reset a person's password and sign them out",
    description=(
        "Generates a new starting password, ends all open sessions for that person, and returns "
        "the password once. Platform admin only."
    ),
)
async def reset_person_password(
    user_id: Annotated[uuid.UUID, Path()],
    response: Response,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    hasher: HasherDep,
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
    )
    response.headers["Cache-Control"] = "no-store"
    return ResetPasswordOut(starting_password=starting)


@router.put(
    "/{user_id}/hubspot-owner",
    response_model=PersonOut,
    summary="Set or clear who a person is in HubSpot",
    description=(
        "Links the account to a HubSpot owner by hand, so the calls, tasks and notes this person "
        "logs land under that owner in HubSpot. `owner_id` is an active owner from GET "
        "/hubspot/owners. The HubSpot sync never changes a link set by hand. "
        '`{"owner_id": null}` clears the link, and the next sync may then match the person by '
        "email again. Platform admin only."
    ),
)
async def set_hubspot_owner(
    user_id: Annotated[uuid.UUID, Path()],
    body: HubSpotOwnerIn,
    session: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
) -> PersonOut:
    try:
        user = await owners.set_by_hand(session, user_id, body.owner_id)
    except owners.OwnerNotActive:
        raise _invalid(
            "owner_id", "This isn't an active HubSpot owner. Pick one from the list."
        ) from None
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    audit.add_entry(
        session,
        "account_changed",
        user_id=user.id,
        details={"fields": ["hubspot_owner"], "hubspot_owner_id": user.hubspot_owner_id},
        at=now,
    )
    await session.commit()
    await session.refresh(user)
    return await _out_with_owner(session, user)
