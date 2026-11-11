"""The call prep routes (PLAN-V10 D1 to D4), under /api/v1/companies.

- `GET /{key}/facts`: the facts pack, free and at once, for the modal's HubSpot parts.
- `POST /preps`: a prep for a company and a person (or a cold call). A ready one from the last
  `prep_reuse_days` comes back free (200). Otherwise a new one starts and comes back searching
  (202); the website asks for it again every 2 seconds.
- `GET /preps/{id}`: one prep, to see it finish.
- `GET /preps/today`: my preps from today, for the chips under the prep box.

A prep made with the Lead Finder's facts is never shown to someone without its tick.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy import Select, or_, select
from sqlalchemy.exc import IntegrityError

from apps.companies import store
from apps.companies.deps import LeadsDep
from apps.companies.facts import build_facts, facts_out
from apps.companies.prep import (
    PrepContext,
    PrepRunner,
    fail_stuck,
    is_stuck,
    prep_out,
)
from apps.companies.schemas import PrepAsk, PrepChip, PrepFacts, PrepOut
from apps.companies.tables import Prep
from core.api.access import SignedInDep
from core.api.deps import SessionDep, SettingsDep
from core.api.errors import Problem
from core.auth.models import User
from core.claude.client import get_claude
from core.company_leads import CompanyLeads
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.memory.embedder import get_embedder

router = APIRouter()
MELBOURNE = ZoneInfo("Australia/Melbourne")
TODAY_LIMIT = 8


def prep_runner(request: Request) -> PrepRunner:
    """The app's prep runner, made on first use. A test puts its own in app.state."""
    runner: PrepRunner | None = getattr(request.app.state, "prep_runner", None)
    if runner is None:
        sessions = getattr(request.app.state, "session_factory", None) or get_sessionmaker()
        runner = PrepRunner(sessions=sessions, claude=get_claude, embedder=get_embedder)
        request.app.state.prep_runner = runner
    return runner


RunnerDep = Annotated[PrepRunner, Depends(prep_runner)]
Key = Annotated[str, Path(min_length=1, max_length=64)]


def company_not_found() -> Problem:
    return Problem(
        404,
        "Company not found",
        "There is no such company, or it isn't open to your account.",
        code="company_not_found",
    )


def prep_not_found() -> Problem:
    return Problem(
        404,
        "Prep not found",
        "There is no such call prep, or it isn't open to your account.",
        code="prep_not_found",
    )


def prep_off() -> Problem:
    return Problem(
        409,
        "Call prep is off",
        "Call scripts are switched off. An Admin switches them on in Admin, Settings. The facts "
        "from HubSpot still show.",
        code="prep_off",
    )


def prep_running() -> Problem:
    return Problem(
        409,
        "Someone is preparing this call",
        "Someone else is preparing a script for this call right now. Try again in a minute.",
        code="prep_running",
    )


def may_see(prep: Prep, leads: list[CompanyLeads]) -> bool:
    """A lead-only company, or a prep made with the Lead Finder's facts, needs its tick."""
    used_leads = bool((prep.facts or {}).get("leads_used"))
    return bool(leads) or not (used_leads or prep.company_key.startswith("lead:"))


async def _out(session: SessionDep, prep: Prep, *, reused: bool = False) -> PrepOut:
    name = None
    if prep.made_by is not None:
        name = await session.scalar(select(User.name).where(User.id == prep.made_by))
    return prep_out(prep, made_by=name, reused=reused)


def context_for(settings: Settings, leads: list[CompanyLeads]) -> PrepContext:
    return PrepContext(
        hooks=leads,
        names_ok=settings.hubspot_names_to_claude_ok,
        cap_usd=settings.prep_cap_usd,
        max_searches=settings.prep_max_searches,
        reuse_days=settings.prep_reuse_days,
        model=settings.model_prep or settings.claude_model,
    )


@router.get(
    "/preps/today",
    response_model=list[PrepChip],
    summary="My call preps from today",
    description="For the chips under the prep box: newest first, at most 8, one per person.",
)
async def my_preps_today(session: SessionDep, auth: SignedInDep, leads: LeadsDep) -> list[PrepChip]:
    start = datetime.now(MELBOURNE).replace(hour=0, minute=0, second=0, microsecond=0)
    statement = select(Prep).where(Prep.created_at >= start.astimezone(UTC))
    if auth is not None:
        statement = statement.where(Prep.made_by == auth.user.id)
    rows = await session.scalars(statement.order_by(Prep.created_at.desc()).limit(40))
    chips: list[PrepChip] = []
    seen: set[tuple[str, str | None]] = set()
    for prep in rows:
        target = (prep.company_key, prep.contact_id)
        if target in seen or not may_see(prep, leads):
            continue
        seen.add(target)
        chips.append(
            PrepChip(
                id=prep.id,
                company_key=prep.company_key,
                company_name=prep.company_name,
                person_name=prep.person_name,
                kind="cold" if prep.kind == "cold" else "person",
                status=prep.status,
                created_at=prep.created_at,
            )
        )
    return chips[:TODAY_LIMIT]


@router.get(
    "/preps/{prep_id}",
    response_model=PrepOut,
    summary="One call prep",
    description=(
        "Asked again every 2 seconds while it is searching. A prep left searching for 5 minutes "
        "with nothing running it (after a restart) is marked failed. 404 `prep_not_found`."
    ),
)
async def get_prep(
    prep_id: uuid.UUID, session: SessionDep, leads: LeadsDep, runner: RunnerDep
) -> PrepOut:
    prep = await session.get(Prep, prep_id)
    if prep is None or not may_see(prep, leads):
        raise prep_not_found()
    if is_stuck(prep, runner, datetime.now(UTC)):
        fail_stuck(prep, datetime.now(UTC))
        await session.commit()
    return await _out(session, prep)


async def _searching(
    session: SessionDep, call: Select[Prep], runner: PrepRunner, now: datetime
) -> Prep | None:
    """The prep searching for this call, if any (the unique index allows one). One that a restart
    left searching is marked failed first, so a new one can start."""
    prep = await session.scalar(
        call.where(Prep.status == "searching").order_by(Prep.created_at.desc()).limit(1)
    )
    if prep is not None and is_stuck(prep, runner, now):
        fail_stuck(prep, now)
        await session.commit()
        return None
    return prep


async def _join(session: SessionDep, prep: Prep, leads: list[CompanyLeads]) -> PrepOut:
    """The prep already searching for this call. One made with the Lead Finder's facts stays with
    its tick: anyone else is asked to try again."""
    if not may_see(prep, leads):
        raise prep_running()
    return await _out(session, prep)


@router.post(
    "/preps",
    response_model=PrepOut,
    status_code=202,
    summary="Prep a call",
    description=(
        "For a person at the company (`contact_id`), or a cold call to the switchboard (`cold`). "
        "A ready prep for the same company and person from the last `prep_reuse_days` days comes "
        "back free, with 200. `refresh` makes a new one. A new one comes back `searching` (202). "
        "409 `prep_off` while call prep is switched off. 404 `company_not_found` when the company "
        "isn't open to this account, `person_not_found` when the person isn't at it."
    ),
)
async def start_prep(
    body: PrepAsk,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    leads: LeadsDep,
    auth: SignedInDep,
    runner: RunnerDep,
) -> PrepOut:
    if not store.valid_key(body.company_key):
        raise company_not_found()
    contact_id = None if body.cold else body.contact_id
    now = datetime.now(UTC)
    call = select(Prep).where(
        Prep.company_key == body.company_key,
        Prep.contact_id == contact_id if contact_id else Prep.contact_id.is_(None),
    )
    same = call
    if not leads:  # without the Lead Finder tick, only preps made without its facts
        same = same.where(
            or_(
                Prep.facts["leads_used"].astext.is_(None),
                Prep.facts["leads_used"].astext == "false",
            )
        )
    if not body.refresh:
        ready = await session.scalar(
            same.where(
                Prep.status == "ready",
                Prep.created_at >= now - timedelta(days=settings.prep_reuse_days),
            )
            .order_by(Prep.created_at.desc())
            .limit(1)
        )
        if ready is not None:
            response.status_code = 200
            return await _out(session, ready, reused=True)
    # One already running for this call comes back, even from another backend during a deploy.
    running = await _searching(session, call, runner, now)
    if running is not None:
        return await _join(session, running, leads)
    if not settings.prep_enabled:
        raise prep_off()
    pack = await build_facts(session, body.company_key, contact_id, leads, now)
    if pack is None:
        raise company_not_found()
    person = pack.person
    if contact_id is not None and person is None:
        raise Problem(
            404,
            "Person not found",
            "That person isn't at this company in the HubSpot copy.",
            code="person_not_found",
        )
    prep = Prep(
        company_key=body.company_key,
        company_name=pack.company.name,
        contact_id=person.hubspot_id if person is not None else None,
        person_name=person.name if person is not None else None,
        person_title=person.job_title if person is not None else None,
        kind="person" if person is not None else "cold",
        trigger="person",
        status="searching",
        stage=0,
        facts={"leads_used": pack.leads_used},
        made_by=auth.user.id if auth is not None else None,
    )
    session.add(prep)
    try:
        await session.commit()
    except IntegrityError:
        # Another start for the same call won the race: the unique index allows one searching.
        await session.rollback()
        running = await _searching(session, call, runner, now)
        if running is None:
            raise prep_running() from None
        return await _join(session, running, leads)
    runner.start(prep.id, context_for(settings, leads))
    return await _out(session, prep)


@router.get(
    "/{key}/facts",
    response_model=PrepFacts,
    summary="What we know, before any Claude request",
    description=(
        "The facts pack for a company and, with `contact_id`, a person at it: each fact with its "
        "source. Free and quick, so the modal shows it at once. No Claude request is made."
    ),
)
async def get_facts(
    key: Key,
    session: SessionDep,
    settings: SettingsDep,
    leads: LeadsDep,
    contact_id: Annotated[str | None, Query(max_length=32)] = None,
) -> PrepFacts:
    if not store.valid_key(key):
        raise company_not_found()
    pack = await build_facts(session, key, contact_id, leads)
    if pack is None:
        raise company_not_found()
    return facts_out(
        pack,
        prep_enabled=settings.prep_enabled,
        names_ok=settings.hubspot_names_to_claude_ok,
        people_ready=pack.company.people_status == "ready",
        prep_cap_usd=settings.prep_cap_usd,
    )
