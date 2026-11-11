"""The Companies page's reads (PLAN-V10 B2, B3, D1): the list, its filter values, one company and
the prep box's matches. Everything reads our HubSpot copy and, for people with the tick, the
companies another project found (`core/company_leads.py`). Nothing here calls HubSpot or Claude.

The list is filtered, sorted and paged in the database: the HubSpot copy has about 14,000
companies. A project's rows are joined in SQL too, so a page is one query.
"""

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Date,
    Integer,
    String,
    Text,
    case,
    cast,
    exists,
    func,
    literal,
    null,
    or_,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from apps.companies.deals import CLOSED_STAGES, WON_STAGES, DealState, stage_kind
from apps.companies.relationship import Pieces, relationship_of
from apps.companies.schemas import (
    CompanyCall,
    CompanyDeal,
    CompanyDetail,
    CompanyFacets,
    CompanyFacetValue,
    CompanyHit,
    CompanyLead,
    CompanyNote,
    CompanyOffice,
    CompanyPage,
    CompanyPerson,
    CompanyRow,
    CompanySearch,
    PersonHit,
    SortKey,
    SortOrder,
    Source,
)
from core.company_leads import AnySelect, CompanyLeadInfo, CompanyLeads
from core.hubspot.models import (
    HubSpotCall,
    HubSpotCompany,
    HubSpotContact,
    HubSpotDeal,
    HubSpotOffice,
)
from core.memory.models import MemoryItem

MELBOURNE = ZoneInfo("Australia/Melbourne")
PAGE_SIZE = 50
NOTE_DAYS = 30  # saved notes younger than this show on the panel
MAX_NOTES = 20
MAX_CALLS = 20
SEARCH_LIMIT = 4  # people and companies the prep box shows, each
# The cities the filter offers: Contour's own, then the other capitals.
CITIES = ("Melbourne", "Adelaide", "Perth", "Sydney", "Brisbane", "Canberra", "Hobart", "Darwin")
_KEY = re.compile(r"^(lead:[0-9a-fA-F-]{36}|[A-Za-z0-9_-]{1,32})$")


def today() -> date:
    return datetime.now(UTC).astimezone(MELBOURNE).date()


def valid_key(key: str) -> bool:
    return bool(_KEY.match(key))


def _like(text: str) -> str:
    """`text` as an ILIKE pattern that finds it anywhere, with % and _ taken literally."""
    escaped = text.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@dataclass(frozen=True)
class ListQuery:
    q: str | None = None
    city: str | None = None
    owner: str | None = None
    deal: DealState | None = None
    source: Source | None = None
    sort: SortKey = "name"
    order: SortOrder | None = None
    limit: int = PAGE_SIZE
    offset: int = 0


# --- The list ----------------------------------------------------------------------------------


def _offices_summary(on: date) -> Any:
    office = HubSpotOffice
    return (
        select(
            office.hubspot_company_id.label("cid"),
            func.min(office.lease_expiry).filter(office.lease_expiry >= on).label("next_lease"),
        )
        .group_by(office.hubspot_company_id)
        .subquery("offices")
    )


def _deals_summary() -> Any:
    deal = HubSpotDeal
    stage = func.lower(func.coalesce(deal.stage, ""))
    return (
        select(
            deal.hubspot_company_id.label("cid"),
            func.bool_or(stage.not_in(sorted(CLOSED_STAGES))).label("has_open"),
            func.bool_or(stage.in_(sorted(WON_STAGES))).label("has_won"),
        )
        .group_by(deal.hubspot_company_id)
        .subquery("deals")
    )


def _hubspot_rows(query: ListQuery, on: date, hook: CompanyLeads | None) -> AnySelect:
    company = HubSpotCompany
    offices = _offices_summary(on)
    deals = _deals_summary()
    customer = or_(deals.c.has_won.is_(True), func.lower(company.lifecycle_stage) == "customer")
    deal = case((deals.c.has_open.is_(True), "open"), (customer, "customer"), else_="none")
    joined = company.__table__.outerjoin(offices, offices.c.cid == company.hubspot_id).outerjoin(
        deals, deals.c.cid == company.hubspot_id
    )
    lead_result: ColumnElement[Any] = cast(null(), String(32))
    lead_score: ColumnElement[Any] = cast(null(), Integer)
    if hook is not None:
        leads = hook.by_hubspot().subquery("leads")
        joined = joined.outerjoin(leads, leads.c.hubspot_id == company.hubspot_id)
        lead_result, lead_score = leads.c.result, leads.c.score
    statement = select(
        cast(company.hubspot_id, Text).label("key"),
        company.name.label("name"),
        company.domain.label("domain"),
        company.city.label("city"),
        company.industry.label("industry"),
        company.employees.label("staff"),
        company.owner.label("owner"),
        company.last_contacted.label("last_talk"),
        offices.c.next_lease.label("next_lease_end"),
        cast(deal, Text).label("deal"),
        cast(literal("hubspot"), Text).label("source"),
        lead_result.label("lead_result"),
        lead_score.label("lead_score"),
    ).select_from(joined)
    if query.q:
        pattern = _like(query.q)
        statement = statement.where(
            or_(
                company.name.ilike(pattern),
                company.domain.ilike(pattern),
                company.industry.ilike(pattern),
            )
        )
    if query.city:
        city = query.city.strip().lower()
        office = HubSpotOffice
        statement = statement.where(
            or_(
                func.lower(company.city) == city,
                exists().where(
                    office.hubspot_company_id == company.hubspot_id,
                    or_(func.lower(office.label) == city, func.lower(office.city) == city),
                ),
            )
        )
    if query.owner:
        statement = statement.where(company.owner == query.owner)
    if query.deal:
        statement = statement.where(deal == query.deal)
    return statement


def _lead_rows(query: ListQuery, hook: CompanyLeads) -> AnySelect | None:
    """The rows of companies a project found that HubSpot doesn't have. None when a filter can't
    match them (they have no owner and no deal)."""
    if query.owner or (query.deal and query.deal != "none"):
        return None
    leads = hook.lead_only().subquery("lead_only")
    statement = select(
        cast(leads.c.key, Text).label("key"),
        leads.c.name.label("name"),
        leads.c.domain.label("domain"),
        leads.c.city.label("city"),
        leads.c.industry.label("industry"),
        leads.c.staff.label("staff"),
        cast(null(), String(120)).label("owner"),
        cast(null(), Date).label("last_talk"),
        cast(null(), Date).label("next_lease_end"),
        cast(literal("none"), Text).label("deal"),
        cast(literal("lead"), Text).label("source"),
        leads.c.result.label("lead_result"),
        leads.c.score.label("lead_score"),
    )
    if query.q:
        pattern = _like(query.q)
        statement = statement.where(
            or_(
                leads.c.name.ilike(pattern),
                leads.c.domain.ilike(pattern),
                leads.c.industry.ilike(pattern),
            )
        )
    if query.city:
        statement = statement.where(func.lower(leads.c.city) == query.city.strip().lower())
    return statement


def _ordering(rows: Any, sort: SortKey, order: SortOrder | None) -> list[Any]:
    name = func.lower(rows.c.name)
    column = {
        "name": name,
        "staff": rows.c.staff,
        "lease": rows.c.next_lease_end,
        "last_talk": rows.c.last_talk,
    }[sort]
    natural: SortOrder = "asc" if sort in ("name", "lease") else "desc"
    direction = order or natural
    first = column.asc() if direction == "asc" else column.desc()
    if sort != "name":
        first = first.nulls_last()
    return [first, name, rows.c.key]


async def list_companies(
    session: AsyncSession, query: ListQuery, hooks: Sequence[CompanyLeads]
) -> CompanyPage:
    """A page of companies. `hooks` are the projects this person may see (their tick)."""
    hook = hooks[0] if hooks else None  # one project adds companies today: the Lead Finder
    on = today()
    parts: list[AnySelect] = []
    if query.source in (None, "hubspot"):
        parts.append(_hubspot_rows(query, on, hook))
    if hook is not None and query.source in (None, "lead"):
        lead_part = _lead_rows(query, hook)
        if lead_part is not None:
            parts.append(lead_part)
    if not parts:
        return CompanyPage(total=0, items=[], leads_shown=hook is not None)
    rows = (union_all(*parts) if len(parts) > 1 else parts[0]).subquery("rows")
    total = int(await session.scalar(select(func.count()).select_from(rows)) or 0)
    page = await session.execute(
        select(rows)
        .order_by(*_ordering(rows, query.sort, query.order))
        .limit(query.limit)
        .offset(query.offset)
    )
    items = [
        CompanyRow(
            key=row.key,
            name=row.name,
            domain=row.domain,
            city=row.city,
            industry=row.industry,
            staff=row.staff,
            owner=row.owner,
            last_talk=row.last_talk,
            next_lease_end=row.next_lease_end,
            deal=row.deal,
            source=row.source,
            lead_result=row.lead_result if hook is not None else None,
            lead_score=row.lead_score if hook is not None else None,
        )
        for row in page
    ]
    return CompanyPage(total=total, items=items, leads_shown=hook is not None)


async def facets(session: AsyncSession, hooks: Sequence[CompanyLeads]) -> CompanyFacets:
    """What the filters offer: the cities, and the owners with the most companies first."""
    owners = await session.execute(
        select(HubSpotCompany.owner, func.count())
        .where(HubSpotCompany.owner.is_not(None))
        .group_by(HubSpotCompany.owner)
        .order_by(func.count().desc(), HubSpotCompany.owner)
        .limit(60)
    )
    office = HubSpotOffice
    company = HubSpotCompany
    cities = []
    for city in CITIES:
        lowered = city.lower()
        count = await session.scalar(
            select(func.count()).where(
                or_(
                    func.lower(company.city) == lowered,
                    exists().where(
                        office.hubspot_company_id == company.hubspot_id,
                        or_(
                            func.lower(office.label) == lowered, func.lower(office.city) == lowered
                        ),
                    ),
                )
            )
        )
        cities.append(CompanyFacetValue(value=city, count=int(count or 0)))
    return CompanyFacets(
        cities=cities,
        owners=[CompanyFacetValue(value=str(name), count=int(count)) for name, count in owners],
        leads_shown=bool(hooks),
    )


# --- One company -------------------------------------------------------------------------------


def _lead_out(hook: CompanyLeads, info: CompanyLeadInfo) -> CompanyLead:
    return CompanyLead(
        title=hook.title,
        lead_id=info.lead_id,
        result=info.result,
        result_label=info.result_label,
        score=info.score,
        score_checked=info.score_checked,
        summary=info.summary,
        best_sign=info.best_sign,
        sign_date=info.sign_date,
        status=info.status,
        found_at=info.found_at,
        link=info.link,
    )


async def notes_about(
    session: AsyncSession, names: Sequence[str], now: datetime
) -> list[CompanyNote]:
    """Saved source notes about the company, from any project, under `NOTE_DAYS` old."""
    wanted = sorted({name.strip().lower() for name in names if name and name.strip()})
    if not wanted:
        return []
    rows = await session.scalars(
        select(MemoryItem)
        .where(
            MemoryItem.kind == "source_note",
            func.lower(MemoryItem.subject).in_(wanted),
            MemoryItem.created_at >= now - timedelta(days=NOTE_DAYS),
        )
        .order_by(MemoryItem.created_at.desc())
        .limit(MAX_NOTES)
    )
    return [
        CompanyNote(
            text=item.content,
            url=item.url,
            date=item.source_date or item.created_at.date(),
            found_by=item.app,
        )
        for item in rows
    ]


async def people_ready(session: AsyncSession) -> bool:
    """True once HubSpot has given us any contact or call: its scopes are there."""
    contact = await session.scalar(select(HubSpotContact.hubspot_id).limit(1))
    call = (
        None
        if contact is not None
        else await session.scalar(select(HubSpotCall.hubspot_id).limit(1))
    )
    return contact is not None or call is not None


async def people_of(session: AsyncSession, hubspot_id: str) -> list[CompanyPerson]:
    rows = await session.scalars(
        select(HubSpotContact)
        .where(HubSpotContact.hubspot_company_id == hubspot_id)
        .order_by(HubSpotContact.last_activity.desc().nulls_last(), HubSpotContact.name)
        .limit(50)
    )
    return [
        CompanyPerson(
            id=person.hubspot_id,
            name=person.name,
            title=person.job_title,
            phone=person.phone or person.mobile,
            last_activity=person.last_activity,
        )
        for person in rows
    ]


async def calls_of(
    session: AsyncSession, hubspot_id: str, limit: int = MAX_CALLS
) -> list[CompanyCall]:
    contact = HubSpotContact
    rows = await session.execute(
        select(HubSpotCall, contact.name)
        .outerjoin(contact, contact.hubspot_id == HubSpotCall.hubspot_contact_id)
        .where(HubSpotCall.hubspot_company_id == hubspot_id)
        .order_by(HubSpotCall.called_at.desc().nulls_last())
        .limit(limit)
    )
    return [
        CompanyCall(
            id=call.hubspot_id,
            called_at=call.called_at,
            person=name,
            owner=call.owner,
            minutes=round(call.duration_seconds / 60) if call.duration_seconds else None,
            outcome=call.outcome,
            note=call.note,
            hubspot_url=call.hubspot_url,
        )
        for call, name in rows
    ]


def _deal_rank(deal: HubSpotDeal) -> tuple[int, int]:
    kind = stage_kind(deal.stage)
    order = {"open": 0, "won": 1, "lost": 2, "dissolved": 3}[kind]
    closed = deal.close_date or deal.last_contacted
    return order, -(closed.toordinal() if closed else 0)


async def company_detail(
    session: AsyncSession, key: str, hooks: Sequence[CompanyLeads], now: datetime | None = None
) -> CompanyDetail | None:
    """One company's panel. None when there is no such company, or the person may not see it."""
    now = now or datetime.now(UTC)
    if key.startswith("lead:"):
        return await _lead_only_detail(session, key, hooks, now)
    company = await session.get(HubSpotCompany, key)
    if company is None:
        return None
    on = today()
    offices = list(
        await session.scalars(
            select(HubSpotOffice)
            .where(HubSpotOffice.hubspot_company_id == key)
            .order_by(HubSpotOffice.lease_expiry.asc().nulls_last(), HubSpotOffice.label)
        )
    )
    deals = sorted(
        await session.scalars(select(HubSpotDeal).where(HubSpotDeal.hubspot_company_id == key)),
        key=_deal_rank,
    )
    kinds = {stage_kind(deal.stage) for deal in deals}
    customer = "won" in kinds or (company.lifecycle_stage or "").lower() == "customer"
    deal_state: DealState = "open" if "open" in kinds else "customer" if customer else "none"
    ready = await people_ready(session)
    calls = await calls_of(session, key) if ready else []
    lead: CompanyLead | None = None
    for hook in hooks:
        info = await hook.detail(session, key, None)
        if info is not None:
            lead = _lead_out(hook, info)
            break
    leases = [
        office.lease_expiry
        for office in offices
        if office.lease_expiry and office.lease_expiry >= on
    ]
    deal_rows = [
        CompanyDeal(
            name=deal.name,
            stage=deal.stage,
            state=stage_kind(deal.stage),
            pipeline=deal.pipeline,
            amount_aud=deal.amount_aud,
            close_date=deal.close_date,
            owner=deal.owner,
            next_step=deal.next_step,
            hubspot_url=deal.hubspot_url,
        )
        for deal in deals
    ]
    people = await people_of(session, key) if ready else []
    stage = relationship_of(
        Pieces(
            source="hubspot",
            deals=deal_rows,
            lifecycle_stage=company.lifecycle_stage,
            last_talk=company.last_contacted,
            calls=calls,
            people=people,
        ),
        on,
    )
    return CompanyDetail(
        key=key,
        source="hubspot",
        name=company.name,
        domain=company.domain,
        website=company.website,
        city=company.city,
        state=company.state,
        industry=company.industry,
        staff=company.employees,
        linkedin_staff=company.linkedin_staff_au,
        description=company.description,
        owner=company.owner,
        lifecycle_stage=company.lifecycle_stage,
        last_talk=company.last_contacted,
        last_talk_note=next((call.note for call in calls if call.note), None),
        next_lease_end=min(leases) if leases else None,
        deal=deal_state,
        hubspot_url=company.hubspot_url,
        offices=[
            CompanyOffice(
                label=office.label,
                city=office.city,
                street=office.street,
                level=office.level,
                lease_end=office.lease_expiry,
                moved_in=office.last_moved,
                office_m2=office.office_m2,
                linkedin_staff=office.linkedin_staff,
                quality=office.quality,
            )
            for office in offices
        ],
        deals=deal_rows,
        notes=await notes_about(session, [company.name], now),
        people=people,
        calls=calls,
        people_status="ready" if ready else "waiting",
        lead=lead,
        relationship=stage,
    )


async def _lead_only_detail(
    session: AsyncSession, key: str, hooks: Sequence[CompanyLeads], now: datetime
) -> CompanyDetail | None:
    try:
        lead_id = uuid.UUID(key.removeprefix("lead:"))
    except ValueError:
        return None
    for hook in hooks:
        info = await hook.detail(session, None, lead_id)
        if info is None:
            continue
        name = info.name or "Unnamed company"
        return CompanyDetail(
            key=key,
            source="lead",
            name=name,
            domain=info.domain,
            website=info.domain,
            city=info.city,
            state=None,
            industry=info.industry,
            staff=info.staff,
            linkedin_staff=None,
            description=info.summary or None,
            owner=None,
            lifecycle_stage=None,
            last_talk=None,
            last_talk_note=None,
            next_lease_end=None,
            deal="none",
            hubspot_url=None,
            offices=[],
            deals=[],
            notes=await notes_about(session, [name], now),
            people=[],
            calls=[],
            people_status="ready" if await people_ready(session) else "waiting",
            lead=_lead_out(hook, info),
            relationship=relationship_of(Pieces(source="lead"), today()),
        )
    return None


# --- The prep box ------------------------------------------------------------------------------


async def search(
    session: AsyncSession, q: str, hooks: Sequence[CompanyLeads], limit: int = SEARCH_LIMIT
) -> CompanySearch:
    """Up to `limit` people and `limit` companies whose name matches, best first: a name that
    starts with what was typed, then shorter names."""
    text = q.strip()
    if len(text) < 2:
        return CompanySearch(people=[], companies=[])
    pattern = _like(text)
    starts = func.lower(HubSpotCompany.name).like(f"{text.lower()}%")
    companies = await session.execute(
        select(
            HubSpotCompany.hubspot_id,
            HubSpotCompany.name,
            HubSpotCompany.city,
            HubSpotCompany.industry,
        )
        .where(or_(HubSpotCompany.name.ilike(pattern), HubSpotCompany.domain.ilike(pattern)))
        .order_by(starts.desc(), func.length(HubSpotCompany.name), HubSpotCompany.name)
        .limit(limit)
    )
    hits = [
        CompanyHit(
            key=row.hubspot_id,
            name=row.name,
            city=row.city,
            industry=row.industry,
            source="hubspot",
        )
        for row in companies
    ]
    if hooks and len(hits) < limit:
        leads = hooks[0].lead_only().subquery("lead_only")
        found = await session.execute(
            select(leads.c.key, leads.c.name, leads.c.city, leads.c.industry)
            .where(leads.c.name.ilike(pattern))
            .order_by(func.length(leads.c.name), leads.c.name)
            .limit(limit - len(hits))
        )
        hits += [
            CompanyHit(
                key=row.key, name=row.name, city=row.city, industry=row.industry, source="lead"
            )
            for row in found
        ]
    contact = HubSpotContact
    person_starts = func.lower(contact.name).like(f"{text.lower()}%")
    people = await session.execute(
        select(contact, HubSpotCompany.name)
        .outerjoin(HubSpotCompany, HubSpotCompany.hubspot_id == contact.hubspot_company_id)
        .where(contact.name.ilike(pattern))
        .order_by(person_starts.desc(), contact.last_activity.desc().nulls_last(), contact.name)
        .limit(limit)
    )
    return CompanySearch(
        people=[
            PersonHit(
                id=person.hubspot_id,
                name=person.name,
                title=person.job_title,
                company_key=person.hubspot_company_id,
                company_name=company_name,
            )
            for person, company_name in people
        ],
        companies=hits,
    )
