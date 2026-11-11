"""The Admin's People tab (PLAN-V9 E1): who has an account, which projects each may use, and adding
a person. Admins only.

- `GET /people`: every account: name, email, role, projects, whether it can sign in, last sign-in.
- `POST /people`: a new account with a name, an email, a role, its projects (the Lead Finder tick)
  and a starting password under today's rules. The password is never shown again or logged.
- `PATCH /people/{user_id}`: change the projects, the role or whether it can sign in. An Admin
  can't take their own Admin role away or switch themselves off, so there is always one Admin.

Changing your own password is PLAN-V6 C4, still open. A password a person forgot is reset with
`engine reset-password`.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OutModel, SafeText
from core.api.signin import AdminDep, HasherDep, NowDep
from core.auth import audit
from core.auth.admin import BY_COMMAND, create_person
from core.auth.models import User
from core.auth.passwords import PasswordRefused
from core.auth.users import LoginTaken

router = APIRouter(prefix="/people", tags=["people"])

Role = Literal["admin", "staff", "viewer"]
BY_ADMIN = "admin"  # what the sign-in log says made an account from the People tab


class PersonOut(OutModel):
    id: uuid.UUID
    name: str
    email: str
    username: str | None
    role: Role
    apps: list[str] = Field(description="The projects this person may use. An Admin may use all")
    active: bool = Field(description="false: this account can't sign in")
    created_at: datetime
    last_signed_in_at: datetime | None


def _apps(value: list[str], request: Request | None = None) -> list[str]:
    return list(dict.fromkeys(value))


class PersonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: SafeText = Field(min_length=1, max_length=120, examples=["Marcus Lee"])
    email: SafeText = Field(max_length=254, examples=["marcus@contourinteriors.com.au"])
    username: SafeText | None = Field(None, max_length=64)
    role: Role = "staff"
    apps: list[str] = Field(default_factory=list, max_length=20, examples=[["lead_finder"]])
    password: str = Field(
        min_length=1,
        max_length=1024,
        description="The starting password, under today's rules. Never shown again.",
    )

    _apps = field_validator("apps")(_apps)


class PersonPatch(BaseModel):
    """A merge patch: a field left out stays as it is."""

    model_config = ConfigDict(extra="forbid")

    apps: list[str] | None = Field(None, max_length=20)
    role: Role | None = None
    active: bool | None = None

    _apps = field_validator("apps")(lambda value: None if value is None else _apps(value))


def _out(user: User) -> PersonOut:
    return PersonOut.model_validate(
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "username": user.username,
            "role": user.role,
            "apps": list(user.apps or []),
            "active": user.active,
            "created_at": user.created_at,
            "last_signed_in_at": user.last_signed_in_at,
        }
    )


def _known_apps(request: Request, apps: list[str]) -> None:
    known = {spec.name for spec in getattr(request.app.state, "apps", [])}
    unknown = [app for app in apps if app not in known]
    if unknown:
        raise Problem(
            422,
            "Some fields need a fix",
            "Look at the fields listed.",
            errors=[{"field": "body.apps", "message": f"No such project: {', '.join(unknown)}"}],
        )


def _invalid(field: str, message: str) -> Problem:
    return Problem(
        422,
        "Some fields need a fix",
        "Look at the fields listed.",
        errors=[{"field": f"body.{field}", "message": message}],
    )


@router.get("", response_model=list[PersonOut], summary="Everyone with an account")
async def list_people(session: SessionDep, admin: AdminDep) -> list[PersonOut]:
    rows = await session.scalars(select(User).order_by(func.lower(User.name), User.email))
    return [_out(user) for user in rows]


@router.post(
    "",
    status_code=201,
    response_model=PersonOut,
    summary="Add a person",
    description=(
        "A new account with a starting password under today's rules (the same rules as "
        'create-admin). `apps` is the projects it may use, like ["lead_finder"]. Admins only.'
    ),
)
async def add_person(
    body: PersonIn,
    request: Request,
    session: SessionDep,
    admin: AdminDep,
    now: NowDep,
    hasher: HasherDep,
) -> PersonOut:
    _known_apps(request, body.apps)
    try:
        user = await create_person(
            session,
            email=body.email,
            username=body.username,
            name=body.name,
            role=body.role,
            apps=body.apps,
            password=body.password,
            now=now,
            hasher=hasher,
            by=BY_ADMIN if admin is not None else BY_COMMAND,
        )
    except LoginTaken as taken:
        raise _invalid(taken.field, f"This {taken.field} already has an account.") from None
    except PasswordRefused as refused:
        raise _invalid("password", " ".join(refused.problems)) from None
    except ValueError as error:
        raise _invalid("email", str(error)) from None
    return _out(user)


@router.patch(
    "/{user_id}",
    response_model=PersonOut,
    summary="Change a person's projects, role or whether they can sign in",
)
async def change_person(
    user_id: Annotated[uuid.UUID, Path()],
    body: PersonPatch,
    request: Request,
    session: SessionDep,
    admin: AdminDep,
    now: NowDep,
) -> PersonOut:
    user = await session.get(User, user_id, with_for_update=True)
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    sent = body.model_fields_set
    is_self = admin is not None and admin.user.id == user.id
    if is_self and "role" in sent and body.role != "admin":
        raise _invalid("role", "You can't take your own Admin role away.")
    if is_self and "active" in sent and body.active is False:
        raise _invalid("active", "You can't switch your own account off.")
    if "apps" in sent and body.apps is not None:
        _known_apps(request, body.apps)
        user.apps = body.apps
    if "role" in sent and body.role is not None:
        user.role = body.role
    if "active" in sent and body.active is not None:
        user.active = body.active
    audit.add_entry(
        session,
        "account_changed",
        user_id=user.id,
        details={"fields": sorted(sent), "role": user.role, "apps": list(user.apps or [])},
        at=now,
    )
    await session.commit()
    await session.refresh(user)
    return _out(user)
