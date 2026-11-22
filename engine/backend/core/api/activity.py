"""The Platform admin's Activity page for one person (PLAN-V26 Part 3, choices 11 to 13).

Six tabs, each its own route, 50 rows to a page, newest first. Devices can also end one browser's
session, or all of them: each is recorded with the admin who did it.

Every route needs `PlatformAdminDep` (403 `platform_admin_only` for anyone else).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request
from pydantic import Field

from core import activity
from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OFFSET_MAX, OutModel
from core.api.signin import AuthSettingsDep, NowDep, PlatformAdminDep, client_ip
from core.auth import audit, clean, sessions
from core.auth.models import User, UserSession
from core.auth.sessions import AuthContext, Limits

router = APIRouter(prefix="/people/{user_id}", tags=["people"])

UserId = Annotated[uuid.UUID, Path()]
Offset = Annotated[int, Query(ge=0, le=OFFSET_MAX, description="How many rows to skip")]


class SignInItem(OutModel):
    id: int
    at: datetime
    event: str
    ip: str | None = Field(description="Where the person was")
    device: str | None = Field(description="Their browser. null: the person didn't do this")
    details: dict[str, Any] = Field(description="Facts only. Never a password or a token")


class SignInItems(OutModel):
    total: int
    items: list[SignInItem]


class DeviceItem(OutModel):
    id: uuid.UUID
    current: bool = Field(description="The admin's own browser, the one that asked")
    device: str
    ip: str | None
    first_used_at: datetime
    last_used_at: datetime = Field(description="Updated at most once a minute")


class DeviceItems(OutModel):
    total: int
    items: list[DeviceItem]


class ActivityItem(OutModel):
    id: str
    at: datetime
    what: str
    detail: str | None
    state: str | None = Field(description="Plain words, like 'In HubSpot'")


class ActivityItems(OutModel):
    total: int
    items: list[ActivityItem]


class SpendItem(OutModel):
    day: date = Field(description="A day in Melbourne")
    kind: str
    requests: int
    cost_usd: Decimal


class SpendItems(OutModel):
    total: int
    total_usd: Decimal = Field(
        description="Every day together. Requests from before PLAN-V26 didn't save who asked"
    )
    items: list[SpendItem]


class SignedOutOut(OutModel):
    sessions_ended: int


async def _person(db: SessionDep, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise Problem(404, "No such person", "The account may have been removed.")
    return user


def _made_by(admin: AuthContext | None, request: Request) -> dict[str, Any]:
    return audit.made_by(
        admin.user if admin else None,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@router.get("/activity/sign-ins", response_model=SignInItems, summary="A person's sign-ins")
async def person_sign_ins(
    user_id: UserId, db: SessionDep, admin: PlatformAdminDep, offset: Offset = 0
) -> SignInItems:
    """Sign-ins, failures, locks, sign-outs and the changes admins made to the account."""
    await _person(db, user_id)
    rows, total = await activity.sign_ins(db, user_id, offset=offset)
    items = [
        SignInItem(
            id=row.id,
            at=row.created_at,
            event=row.event,
            ip=row.ip,
            device=clean.device(row.user_agent) if row.user_agent else None,
            details=row.details,
        )
        for row in rows
    ]
    return SignInItems(total=total, items=items)


@router.get("/activity/devices", response_model=DeviceItems, summary="A person's browsers")
async def person_devices(
    user_id: UserId,
    db: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
    settings: AuthSettingsDep,
    offset: Offset = 0,
) -> DeviceItems:
    """Each browser that is signed in now, the last used first."""
    await _person(db, user_id)
    live = await sessions.open_for_user(db, user_id, now=now, limits=Limits.from_settings(settings))
    items = [
        DeviceItem(
            id=session.id,
            current=admin is not None and session.id == admin.session.id,
            device=clean.device(session.user_agent),
            ip=session.ip,
            first_used_at=session.created_at,
            last_used_at=session.last_seen_at,
        )
        for session in live[offset : offset + activity.PAGE]
    ]
    return DeviceItems(total=len(live), items=items)


async def _tab(
    request: Request, db: SessionDep, tab: activity.Tab, user_id: uuid.UUID, offset: int
) -> ActivityItems:
    await _person(db, user_id)
    items, total = await activity.tab_items(db, request.app.state.apps, tab, user_id, offset=offset)
    out = [ActivityItem.model_validate(item, from_attributes=True) for item in items]
    return ActivityItems(total=total, items=out)


@router.get("/activity/calls", response_model=ActivityItems, summary="A person's calls and notes")
async def person_calls(
    user_id: UserId, request: Request, db: SessionDep, admin: PlatformAdminDep, offset: Offset = 0
) -> ActivityItems:
    return await _tab(request, db, "calls", user_id, offset)


@router.get("/activity/preps", response_model=ActivityItems, summary="A person's call preps")
async def person_preps(
    user_id: UserId, request: Request, db: SessionDep, admin: PlatformAdminDep, offset: Offset = 0
) -> ActivityItems:
    return await _tab(request, db, "preps", user_id, offset)


@router.get("/activity/sent", response_model=ActivityItems, summary="What a person sent")
async def person_sent(
    user_id: UserId, request: Request, db: SessionDep, admin: PlatformAdminDep, offset: Offset = 0
) -> ActivityItems:
    return await _tab(request, db, "sent", user_id, offset)


@router.get("/activity/spending", response_model=SpendItems, summary="A person's Claude spending")
async def person_spending(
    user_id: UserId, request: Request, db: SessionDep, admin: PlatformAdminDep, offset: Offset = 0
) -> SpendItems:
    """The cost by day and by kind. Only requests that saved who asked are in it."""
    await _person(db, user_id)
    rows, total, total_usd = await activity.spending(
        db, request.app.state.apps, user_id, offset=offset
    )
    items = [SpendItem.model_validate(row, from_attributes=True) for row in rows]
    return SpendItems(total=total, total_usd=total_usd, items=items)


@router.post(
    "/devices/{session_id}/sign-out",
    response_model=SignedOutOut,
    summary="Sign a person out of one browser",
)
async def sign_out_device(
    user_id: UserId,
    session_id: Annotated[uuid.UUID, Path()],
    request: Request,
    db: SessionDep,
    admin: PlatformAdminDep,
    now: NowDep,
) -> SignedOutOut:
    await _person(db, user_id)
    session = await db.get(UserSession, session_id)
    if session is None or session.user_id != user_id:
        raise Problem(404, "No such browser", "It may have signed out already.")
    if session.ended_at is not None:
        return SignedOutOut(sessions_ended=0)
    details = {
        "by": "admin",
        "sessions_ended": 1,
        "signed_out_device": clean.device(session.user_agent),
        **_made_by(admin, request),
    }
    await sessions.end(db, session.id, now)
    audit.add_entry(db, "sign_out", user_id=user_id, details=details, at=now)
    await db.commit()
    return SignedOutOut(sessions_ended=1)


@router.post("/sign-out", response_model=SignedOutOut, summary="Sign a person out of every browser")
async def sign_out_everywhere(
    user_id: UserId, request: Request, db: SessionDep, admin: PlatformAdminDep, now: NowDep
) -> SignedOutOut:
    await _person(db, user_id)
    ended = await sessions.end_for_user(db, user_id, now)
    details = {"by": "admin", "sessions_ended": ended, **_made_by(admin, request)}
    audit.add_entry(db, "sign_out_everywhere", user_id=user_id, details=details, at=now)
    await db.commit()
    return SignedOutOut(sessions_ended=ended)
