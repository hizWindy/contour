"""The HubSpot sync (PLAN-V5 B4): copies HubSpot's companies, offices, deals and owners into our
copy (`core.hubspot_*`). It only reads HubSpot, and reading is free.

How one sync goes:
1. **Start** (`begin`). A row in `core.hubspot_syncs` says it is running. Only one sync can run at
   a time (a unique index), whoever starts it: the website, `engine hubspot-sync`, or the backend
   at start. A row left "running" for over `STALE_MINUTES` by a stopped process is marked
   "interrupted" first.
2. **Choose what to read.** A full sync reads everything, which also finds records deleted in
   HubSpot. A changes sync reads only what changed since the last good sync started (minus
   `OVERLAP`, so nothing slips between two). "auto" picks full when there is no good full sync
   in the last `hubspot_full_sync_days`. A changes sync with more changes than HubSpot's search
   can page through (10,000) becomes a full one.
3. **Read** (`read_hubspot`): owners, deal stages and field definitions, then the companies and
   deals, a page of 100 at a time. Nothing is saved yet, except how far it has read: every
   `PROGRESS_EVERY` records the row's `companies_read` and `deals_read` are updated, so the
   website's "Sync with HubSpot" shows the sync moving (PLAN-V10 F2).
4. **Save** (`save_snapshot`) everything in ONE transaction: owners, companies (an export row
   with the same id is replaced), their offices, and the deals whose company is in our copy. A
   full sync then removes the companies and deals HubSpot no longer has. If anything fails,
   nothing is saved.
5. **Profiles.** The memory profiles of the companies that changed are built again (all of them
   after a full sync). A failure here is a warning, not a failed sync: the data is saved.

What didn't convert cleanly (an unknown owner, a deal with no company) is counted in the row's
warnings, never with a record's values. Errors are saved in plain words.
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Collection, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import BindParameter, all_, any_, bindparam, delete, select, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.types import String

from core.config import Settings
from core.hubspot.client import (
    SEARCH_RESULTS_CAP,
    Filter,
    HubSpot,
    HubSpotError,
    HubSpotMissingScope,
    HubSpotObject,
    Owner,
    PropertyInfo,
)
from core.hubspot.importer import DealRow
from core.hubspot.mapping import (
    CompanyRows,
    Converter,
    FieldMap,
    Lookups,
    Problems,
    company_rows,
    deal_row,
    labelled_fields,
    load_field_map,
)
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotSync
from core.hubspot.people import WAITING as PEOPLE_WAITING
from core.hubspot.people import read_people, save_people
from core.hubspot.profiles import rebuild_profiles
from core.hubspot.service import replace_offices, upsert_companies, upsert_deals, upsert_owners
from core.logs import scrub
from core.memory.embedder import Embedder

log = logging.getLogger(__name__)

SOURCE = "api"
STALE_MINUTES = 20  # a full sync takes a few minutes; a "running" row older than this is left over
OVERLAP = timedelta(minutes=10)  # a changes sync reads a little before the last one started
SYNC_ERROR = "The sync stopped on an error. The reason is in the backend log."
INTERRUPTED = "The backend stopped while this sync ran."
PROFILES_FAILED = (
    "The data was saved, but the company profiles weren't rebuilt. Run "
    "`uv run engine rebuild-profiles`. The reason is in the backend log."
)

PROGRESS_EVERY = 500  # records read between two saves of how far a sync has got

ModeChoice = Literal["auto", "full", "changes"]
Mode = Literal["full", "changes"]
Trigger = Literal["command", "website", "startup", "schedule"]
HubSpotSource = Callable[[], HubSpot | None]
# Told how many companies and deals a sync has read so far.
Progress = Callable[[int, int], Awaitable[None]]


class SyncAlreadyRunning(Exception):
    """Another sync is running. Its row id is `sync_id`."""

    def __init__(self, sync_id: int | None) -> None:
        super().__init__("A HubSpot sync is already running")
        self.sync_id = sync_id


class SyncOut(BaseModel):
    """One sync, for the website and the command."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    mode: Mode
    trigger: Trigger
    status: Literal["running", "done", "failed", "interrupted"]
    changed_since: datetime | None = Field(description="A changes sync read what changed since")
    companies_read: int
    deals_read: int
    owners_read: int
    companies_saved: int
    offices_saved: int
    deals_saved: int
    deals_skipped: int = Field(description="Deals with no company, or one not in our copy")
    companies_removed: int = Field(description="Gone from HubSpot, found by a full sync")
    deals_removed: int
    profiles_rebuilt: int
    error: str | None
    warnings: list[str]
    started_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True)
class SyncPlan:
    id: int
    mode: Mode
    since: datetime | None


@dataclass
class Snapshot:
    """Everything one sync read, ready to save."""

    owners: list[Owner] = field(default_factory=list)
    companies: list[CompanyRows] = field(default_factory=list)
    deals: list[DealRow] = field(default_factory=list)
    companies_read: int = 0
    deals_read: int = 0
    warnings: list[str] = field(default_factory=list)


class TooManyChanges(Exception):
    """More changed than HubSpot's search can page through: read everything instead."""


# --- 1. Start ----------------------------------------------------------------------------------


async def mark_stale(session: AsyncSession, *, older_than: timedelta | None = None) -> int:
    """Marks syncs left "running" by a stopped process as interrupted. Returns how many. The
    caller commits."""
    now = datetime.now(UTC)
    cutoff = now - (older_than if older_than is not None else timedelta(minutes=STALE_MINUTES))
    result = await session.execute(
        update(HubSpotSync)
        .where(HubSpotSync.status == "running", HubSpotSync.started_at < cutoff)
        .values(status="interrupted", finished_at=now, error=INTERRUPTED)
        .returning(HubSpotSync.id)
    )
    return len(result.all())


async def last_good(session: AsyncSession, mode: Mode | None = None) -> HubSpotSync | None:
    query = select(HubSpotSync).where(HubSpotSync.status == "done")
    if mode is not None:
        query = query.where(HubSpotSync.mode == mode)
    return await session.scalar(query.order_by(HubSpotSync.started_at.desc()).limit(1))


async def running_sync(session: AsyncSession) -> HubSpotSync | None:
    return await session.scalar(select(HubSpotSync).where(HubSpotSync.status == "running"))


async def begin(
    sessions: async_sessionmaker[AsyncSession],
    *,
    trigger: Trigger,
    mode: ModeChoice,
    settings: Settings,
) -> SyncPlan:
    """Saves the "running" row and decides what to read. Raises `SyncAlreadyRunning`."""
    async with sessions() as session:
        await mark_stale(session)
        await session.commit()
        chosen, since = await _choose(session, mode, settings)
        row = HubSpotSync(mode=chosen, trigger=trigger, status="running", changed_since=since)
        session.add(row)
        try:
            await session.commit()
        except IntegrityError as error:
            await session.rollback()
            other = await running_sync(session)
            raise SyncAlreadyRunning(other.id if other else None) from error
        return SyncPlan(row.id, chosen, since)


async def _choose(
    session: AsyncSession, mode: ModeChoice, settings: Settings
) -> tuple[Mode, datetime | None]:
    if mode == "full":
        return "full", None
    last = await last_good(session)
    last_full = await last_good(session, "full")
    full_due = last_full is None or last_full.started_at < datetime.now(UTC) - timedelta(
        days=settings.hubspot_full_sync_days
    )
    if last is None or (mode == "auto" and full_due):
        return "full", None
    return "changes", last.started_at - OVERLAP


# --- 3. Read -----------------------------------------------------------------------------------


class _Counter:
    """Tells `progress` how far the read has got, every `PROGRESS_EVERY` records. A save that fails
    only costs the progress on screen: it never stops the read."""

    def __init__(self, snapshot: Snapshot, progress: Progress | None) -> None:
        self._snapshot = snapshot
        self._progress = progress
        self._told = 0

    async def tick(self, *, force: bool = False) -> None:
        if self._progress is None:
            return
        read = self._snapshot.companies_read + self._snapshot.deals_read
        if read == self._told or (not force and read - self._told < PROGRESS_EVERY):
            return
        self._told = read
        try:
            await self._progress(self._snapshot.companies_read, self._snapshot.deals_read)
        except Exception:
            log.warning("hubspot_sync_progress_not_saved", exc_info=True)


async def read_hubspot(
    hubspot: HubSpot,
    fields: FieldMap,
    *,
    mode: Mode,
    since: datetime | None,
    progress: Progress | None = None,
) -> Snapshot:
    """Reads what the sync saves. Raises `TooManyChanges` for a changes sync that is too big.
    `progress`, if given, hears how far it has read every `PROGRESS_EVERY` records."""
    snapshot = Snapshot()
    counter = _Counter(snapshot, progress)
    account = await hubspot.account()
    active = await hubspot.owners()
    archived = await hubspot.owners(archived=True)
    # An owner who left is still named on old records. The active entry wins a tie.
    owners = {owner.id: owner for owner in archived} | {owner.id: owner for owner in active}
    snapshot.owners = list(owners.values())
    pipelines = await hubspot.pipelines("deals")
    company_fields = await hubspot.properties("companies")
    deal_fields = await hubspot.properties("deals")
    snapshot.warnings += missing_fields(fields, company_fields, deal_fields)
    labelled = set(labelled_fields(fields))
    problems = Problems()
    convert = Converter(
        Lookups.build(
            owners=[(owner.id, owner.name) for owner in snapshot.owners],
            pipelines=pipelines,
            company_fields=[item for item in company_fields if item.name in labelled],
            time_zone=account.time_zone,
        ),
        problems,
    )

    company_properties = fields.company_properties()
    deal_properties = fields.deal_properties()
    if mode == "full":
        async for record in _every(hubspot, "companies", company_properties):
            snapshot.companies_read += 1
            snapshot.companies.append(company_rows(record, fields, convert))
            await counter.tick()
        await counter.tick(force=True)
        async for record in _every(hubspot, "deals", deal_properties, links=("companies",)):
            snapshot.deals_read += 1
            if (row := deal_row(record, fields, convert)) is not None:
                snapshot.deals.append(row)
            await counter.tick()
    else:
        if since is None:
            raise ValueError("a changes sync needs the time to read changes from")
        async for record in _changed(hubspot, "companies", company_properties, since):
            snapshot.companies_read += 1
            snapshot.companies.append(company_rows(record, fields, convert))
            await counter.tick()
        await counter.tick(force=True)
        deals = [record async for record in _changed(hubspot, "deals", deal_properties, since)]
        snapshot.deals_read = len(deals)
        # A search answer has no links, so each deal's company is read in batches.
        companies = await hubspot.primary_companies([record.id for record in deals])
        for record in deals:
            row = deal_row(record, fields, convert, company_id=companies.get(record.id))
            if row is not None:
                snapshot.deals.append(row)
    snapshot.warnings += problems.lines()
    return snapshot


async def _every(
    hubspot: HubSpot,
    object_type: Literal["companies", "deals"],
    properties: Sequence[str],
    *,
    links: Sequence[str] = (),
) -> AsyncIterator[HubSpotObject]:
    after: str | None = None
    while True:
        page = await hubspot.list_objects(
            object_type, properties=properties, after=after, associations=links
        )
        for record in page.results:
            yield record
        if not page.after:
            return
        after = page.after


async def _changed(
    hubspot: HubSpot,
    object_type: Literal["companies", "deals"],
    properties: Sequence[str],
    since: datetime,
) -> AsyncIterator[HubSpotObject]:
    filters = [Filter("hs_lastmodifieddate", "GTE", str(int(since.timestamp() * 1000)))]
    after: str | None = None
    first = True
    while True:
        page = await hubspot.search_objects(
            object_type,
            filters=filters,
            properties=properties,
            sort_by="hs_lastmodifieddate",
            after=after,
        )
        if first and page.total is not None and page.total > SEARCH_RESULTS_CAP:
            raise TooManyChanges
        first = False
        for record in page.results:
            yield record
        if not page.after:
            return
        after = page.after


def missing_fields(
    fields: FieldMap, companies: Sequence[PropertyInfo], deals: Sequence[PropertyInfo]
) -> list[str]:
    """A warning naming every field in fields.yaml that HubSpot doesn't have."""
    have_companies = {item.name for item in companies}
    have_deals = {item.name for item in deals}
    missing = [name for name in fields.company_properties() if name not in have_companies]
    missing += [f"deal field {name}" for name in fields.deal_properties() if name not in have_deals]
    if not missing:
        return []
    return [
        f"HubSpot has no field named {', '.join(missing)}. Fix core/hubspot/fields.yaml; until "
        "then those columns stay empty."
    ]


# --- 4. Save -----------------------------------------------------------------------------------


@dataclass
class Saved:
    companies: int = 0
    offices: int = 0
    deals: int = 0
    deals_skipped: int = 0
    companies_removed: int = 0
    deals_removed: int = 0
    changed_company_ids: set[str] = field(default_factory=set)


async def save_snapshot(session: AsyncSession, snapshot: Snapshot, *, full: bool) -> Saved:
    """Saves one sync's reads in the session's transaction. The caller commits."""
    saved = Saved()
    await upsert_owners(
        session,
        [{"owner_id": o.id, "name": o.name, "archived": o.archived} for o in snapshot.owners],
    )
    companies = [item.company for item in snapshot.companies]
    company_ids = [company.hubspot_id for company in companies]
    saved.companies = await upsert_companies(session, companies, source=SOURCE)
    saved.offices = await replace_offices(
        session, company_ids, [office for item in snapshot.companies for office in item.offices]
    )

    # A deal is kept under its company, so a deal whose company isn't in our copy is left out
    # (it comes in with the next sync that has its company).
    others = {deal.hubspot_company_id for deal in snapshot.deals} - set(company_ids)
    known = set(company_ids) | await _companies_we_have(session, others)
    deals = [deal for deal in snapshot.deals if deal.hubspot_company_id in known]
    saved.deals_skipped = snapshot.deals_read - len(deals)
    saved.deals = await upsert_deals(session, deals, source=SOURCE)

    # Removing what HubSpot no longer has needs a full read, and never runs on an empty one: an
    # empty answer is more likely a fault than a HubSpot with no companies.
    if full and companies:
        gone = await session.execute(
            delete(HubSpotCompany)
            .where(HubSpotCompany.hubspot_id != all_(_ids("seen_companies", company_ids)))
            .returning(HubSpotCompany.hubspot_id)
        )
        gone_companies = {row[0] for row in gone}
        removed = await session.execute(
            delete(HubSpotDeal)
            .where(
                HubSpotDeal.hubspot_deal_id
                != all_(_ids("seen_deals", [deal.hubspot_deal_id for deal in deals]))
            )
            .returning(HubSpotDeal.hubspot_company_id)
        )
        removed_deals = [row[0] for row in removed]
        saved.companies_removed = len(gone_companies)
        saved.deals_removed = len(removed_deals)
        saved.changed_company_ids |= gone_companies | set(removed_deals)
    saved.changed_company_ids |= set(company_ids) | {deal.hubspot_company_id for deal in deals}
    return saved


def _ids(name: str, ids: Collection[str]) -> BindParameter[Any]:
    """A list of ids sent as ONE Postgres array, however many there are."""
    text_array: Any = ARRAY(String())  # SQLAlchemy's stubs type ARRAY by its item, not the list
    return bindparam(name, value=list(ids), type_=text_array)


async def _companies_we_have(session: AsyncSession, ids: Collection[str]) -> set[str]:
    if not ids:
        return set()
    found = await session.scalars(
        select(HubSpotCompany.hubspot_id).where(
            HubSpotCompany.hubspot_id == any_(_ids("wanted", ids))
        )
    )
    return set(found)


# --- The whole sync ----------------------------------------------------------------------------


PEOPLE_FAILED = "Contacts and calls weren't copied this time. The companies were."


async def sync_people(
    sessions: async_sessionmaker[AsyncSession], hubspot: HubSpot, owners: Sequence[Owner]
) -> list[str]:
    """Copies contacts and calls. Returns the warnings for the sync row."""
    names = {owner.id: owner.name for owner in owners}
    try:
        people = await read_people(hubspot, names)
    except HubSpotMissingScope:
        return [PEOPLE_WAITING]
    except HubSpotError as error:
        log.warning("hubspot_people_failed", extra={"reason": error.title})
        return [f"Contacts and calls weren't copied: {error.title}."]
    except Exception:
        log.exception("hubspot_people_failed")
        return [PEOPLE_FAILED]
    try:
        async with sessions() as session:
            await save_people(session, people)
            await session.commit()
    except Exception:
        log.exception("hubspot_people_not_saved")
        return [PEOPLE_FAILED]
    return []


async def run(
    plan: SyncPlan,
    *,
    sessions: async_sessionmaker[AsyncSession],
    hubspot: HubSpot,
    embedder: Embedder,
    fields: FieldMap | None = None,
) -> SyncOut:
    """Reads, saves and rebuilds profiles for a sync `begin` started, and ends its row."""
    fields = fields or load_field_map()
    mode = plan.mode

    async def progress(companies: int, deals: int) -> None:
        async with sessions() as session:
            await _set(session, plan.id, companies_read=companies, deals_read=deals)

    try:
        try:
            snapshot = await read_hubspot(
                hubspot, fields, mode=mode, since=plan.since, progress=progress
            )
        except TooManyChanges:
            mode = "full"
            async with sessions() as session:
                await _set(session, plan.id, mode="full", changed_since=None)
            snapshot = await read_hubspot(
                hubspot, fields, mode="full", since=None, progress=progress
            )
            snapshot.warnings.insert(0, "Too much had changed for a changes sync, so all was read.")

        async with sessions() as session:
            saved = await save_snapshot(session, snapshot, full=mode == "full")
            await _set(
                session,
                plan.id,
                commit=False,
                companies_read=snapshot.companies_read,
                deals_read=snapshot.deals_read,
                owners_read=len(snapshot.owners),
                companies_saved=saved.companies,
                offices_saved=saved.offices,
                deals_saved=saved.deals,
                deals_skipped=saved.deals_skipped,
                companies_removed=saved.companies_removed,
                deals_removed=saved.deals_removed,
                warnings=snapshot.warnings,
            )
            await session.commit()

        rebuilt = 0
        warnings = list(snapshot.warnings)
        # People and calls (PLAN-V10 C1), once the key can read them. Saved on their own, so a
        # problem there never undoes the companies.
        warnings += await sync_people(sessions, hubspot, snapshot.owners)
        try:
            async with sessions() as session:
                rebuilt = await rebuild_profiles(
                    session,
                    embedder,
                    company_ids=None if mode == "full" else saved.changed_company_ids,
                )
        except Exception:
            log.exception("hubspot_sync_profiles_failed", extra={"sync_id": plan.id})
            warnings.append(PROFILES_FAILED)
        return await _finish(sessions, plan.id, "done", profiles_rebuilt=rebuilt, warnings=warnings)
    except asyncio.CancelledError:
        with contextlib.suppress(Exception):
            await asyncio.shield(_finish(sessions, plan.id, "interrupted", error=INTERRUPTED))
        raise
    except HubSpotError as error:
        log.warning("hubspot_sync_failed", extra={"sync_id": plan.id, "reason": error.title})
        return await _finish(sessions, plan.id, "failed", error=f"{error.title}. {error.detail}")
    except Exception:
        log.exception("hubspot_sync_failed", extra={"sync_id": plan.id})
        return await _finish(sessions, plan.id, "failed", error=SYNC_ERROR)


async def _set(session: AsyncSession, sync_id: int, *, commit: bool = True, **values: Any) -> None:
    await session.execute(update(HubSpotSync).where(HubSpotSync.id == sync_id).values(**values))
    if commit:
        await session.commit()


async def _finish(
    sessions: async_sessionmaker[AsyncSession], sync_id: int, status: str, **values: Any
) -> SyncOut:
    if values.get("error"):
        values["error"] = scrub(str(values["error"]))
    async with sessions() as session:
        await _set(session, sync_id, status=status, finished_at=datetime.now(UTC), **values)
        row = await session.get(HubSpotSync, sync_id)
        if row is None:  # pragma: no cover - the row was made by `begin`
            raise RuntimeError(f"sync {sync_id} has no row")
        await session.refresh(row)
        return SyncOut.model_validate(row)


async def recent_syncs(session: AsyncSession, limit: int = 10) -> list[SyncOut]:
    rows = await session.scalars(
        select(HubSpotSync).order_by(HubSpotSync.started_at.desc()).limit(limit)
    )
    return [SyncOut.model_validate(row) for row in rows]


# --- Running syncs in the background, for the website and start-up ---------------------------


class SyncRunner:
    """Starts syncs in the background, one at a time, and stops the running one at shut-down."""

    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        hubspot: HubSpotSource,
        embedder: Callable[[], Embedder],
        settings: Callable[[], Settings],
    ) -> None:
        self._sessions = sessions
        self._hubspot = hubspot
        self._embedder = embedder
        self._settings = settings
        self._task: asyncio.Task[SyncOut | None] | None = None

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, *, trigger: Trigger, mode: ModeChoice = "auto") -> SyncOut:
        """Saves the sync's row and runs it in the background. Raises `SyncAlreadyRunning`, and
        `LookupError` when no HubSpot key is set."""
        client = self._hubspot()
        if client is None:
            raise LookupError("HUBSPOT_SERVICE_KEY is not set")
        try:
            plan = await begin(
                self._sessions, trigger=trigger, mode=mode, settings=self._settings()
            )
        except BaseException:
            await client.aclose()
            raise
        self._task = asyncio.create_task(self._run(plan, client), name=f"hubspot-sync-{plan.id}")
        async with self._sessions() as session:
            row = await session.get(HubSpotSync, plan.id)
            if row is None:  # pragma: no cover - the row was made by `begin`
                raise RuntimeError(f"sync {plan.id} has no row")
            return SyncOut.model_validate(row)

    async def _run(self, plan: SyncPlan, client: HubSpot) -> SyncOut | None:
        try:
            return await run(
                plan, sessions=self._sessions, hubspot=client, embedder=self._embedder()
            )
        finally:
            await client.aclose()

    async def start_if_due(self) -> SyncOut | None:
        """At start-up: a sync when the last good one is older than `hubspot_sync_max_age_hours`.
        Never raises: start-up must not fail because of HubSpot."""
        settings = self._settings()
        if settings.hubspot_sync_max_age_hours <= 0:
            return None
        try:
            async with self._sessions() as session:
                last = await last_good(session)
            age_limit = timedelta(hours=settings.hubspot_sync_max_age_hours)
            if last is not None and last.started_at > datetime.now(UTC) - age_limit:
                return None
            return await self.start(trigger="startup")
        except LookupError:
            return None  # no key: HubSpot is off
        except SyncAlreadyRunning:
            return None
        except Exception:
            log.exception("hubspot_startup_sync_not_started")
            return None

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None or task.done():
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
