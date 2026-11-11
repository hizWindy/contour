"""The HubSpot sync (PLAN-V5 B4): copies HubSpot's companies, offices, deals and owners into our
copy (`core.hubspot_*`). It only reads HubSpot, and reading is free.

How one sync goes:
1. **Start** (`begin`). A row in `core.hubspot_syncs` says it is running. Only one sync can run at
   a time (a unique index), whoever starts it: the website, `engine hubspot-sync`, or the backend
   at start. While it runs, a heartbeat writes `heartbeat_at` every `HEARTBEAT_SECONDS`. A row
   still "running" with no heartbeat for `STALE_AFTER` was left by a stopped process: it is
   marked "interrupted" when a sync starts and when the backend starts (PLAN-V15 T1-3).
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
   after a full sync, or when an earlier sync skipped them). A failure here is a warning, not a
   failed sync: the data is saved.

**Stopping** (PLAN-V15 T1-3). A person can stop a running sync (`SyncRunner.cancel`). Before the
save commits, nothing in our copy changes. After it, the companies stay, people and profiles are
skipped (`profiles_skipped`), and the next sync rebuilds every profile. The row ends `cancelled`
with a plain warning. The row's `phase` says which step it is in, for the website.

What didn't convert cleanly (an unknown owner, a deal with no company) is counted in the row's
warnings, never with a record's values. Errors are saved in plain words.
"""

import asyncio
import contextlib
import functools
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Collection, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import BindParameter, all_, any_, bindparam, delete, func, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.engine import CursorResult
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
from core.hubspot.service import (
    replace_offices,
    upsert_company_rows,
    upsert_deals,
    upsert_owners,
)
from core.logs import scrub
from core.memory.embedder import Embedder

log = logging.getLogger(__name__)

SOURCE = "api"
HEARTBEAT_SECONDS = 10.0  # a running sync writes heartbeat_at this often, and looks for a Stop
STALE_AFTER = timedelta(minutes=2)  # a running row with no heartbeat for this long is left over
CANCEL_WAIT_SECONDS = 5.0  # how long a Stop waits for the sync to end
SAVE_TIMEOUT = "10min"  # the save's own statement limit (the app's is 30 s, PLAN-V15 T1-6)
OVERLAP = timedelta(minutes=10)  # a changes sync reads a little before the last one started
SYNC_ERROR = "The sync stopped on an error. Try again. If it happens again, tell an admin."
INTERRUPTED = "The backend stopped while this sync ran."
CANCELLED_BEFORE_SAVE = "Stopped. Our copy didn't change."
CANCELLED_AFTER_SAVE = (
    "Stopped after saving companies. People and profiles update with the next sync."
)
AFTER_SAVE: tuple[str, ...] = ("people", "profiles")  # the phases after the save has committed
PROFILES_FAILED = (
    "The data was saved, but the company profiles weren't rebuilt. The next sync rebuilds them."
)

PROGRESS_EVERY = 500  # records read between two saves of how far a sync has got

ModeChoice = Literal["auto", "full", "changes"]
Mode = Literal["full", "changes"]
Trigger = Literal["command", "website", "startup", "schedule"]
Phase = Literal["reading", "saving", "people", "profiles"]
HubSpotSource = Callable[[], HubSpot | None]
# Told how many companies and deals a sync has read so far.
Progress = Callable[[int, int], Awaitable[None]]


class SyncAlreadyRunning(Exception):
    """Another sync is running. Its row id is `sync_id`."""

    def __init__(self, sync_id: int | None) -> None:
        super().__init__("A HubSpot sync is already running")
        self.sync_id = sync_id


class SyncNotFound(Exception):
    """No sync has this id."""


class SyncNotRunning(Exception):
    """The sync has already finished, so there is nothing to stop."""


class SyncOut(BaseModel):
    """One sync, for the website and the command."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    mode: Mode
    trigger: Trigger
    status: Literal["running", "done", "failed", "interrupted", "cancelled"]
    phase: Phase | None = Field(
        None, description="What it is doing while it runs: reading, saving, people or profiles"
    )
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
    people_saved: int = Field(0, description="Contacts and calls saved")
    profiles_done: int = Field(0, description="Company profiles rebuilt so far")
    profiles_total: int = Field(0, description="Company profiles this sync rebuilds")
    profiles_skipped: bool = Field(
        False, description="Companies were saved but their profiles weren't rebuilt"
    )
    error: str | None
    warnings: list[str]
    started_at: datetime
    finished_at: datetime | None
    heartbeat_at: datetime | None = Field(None, description="When it last showed it was alive")
    cancel_requested_at: datetime | None = Field(None, description="When someone pressed Stop")


@dataclass(frozen=True)
class SyncPlan:
    id: int
    mode: Mode
    since: datetime | None
    # When the sync began (the database's clock). Its save leaves alone what our copy saved at
    # or after this moment: a lead sent to HubSpot meanwhile (PLAN-V15 T1-5).
    started_at: datetime | None = None


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
    caller commits.

    A sync is left over when its last heartbeat (or, with none, its start) is older than
    `older_than` (`STALE_AFTER` by default). A live sync beats every `HEARTBEAT_SECONDS`, so it
    is never marked, however long it runs. One that stopped after its save owes its profiles
    (`profiles_skipped`).
    """
    now = datetime.now(UTC)
    cutoff = now - (older_than if older_than is not None else STALE_AFTER)
    last_sign = func.coalesce(HubSpotSync.heartbeat_at, HubSpotSync.started_at)
    result = await session.execute(
        update(HubSpotSync)
        .where(HubSpotSync.status == "running", last_sign < cutoff)
        .values(
            status="interrupted",
            finished_at=now,
            error=INTERRUPTED,
            phase=None,
            # SET reads the row as it was, so this is the phase it stopped in.
            profiles_skipped=func.coalesce(HubSpotSync.phase.in_(AFTER_SAVE), False),
        )
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
        started_at = await session.scalar(
            select(HubSpotSync.started_at).where(HubSpotSync.id == row.id)
        )
        return SyncPlan(row.id, chosen, since, started_at)


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


async def save_snapshot(
    session: AsyncSession,
    snapshot: Snapshot,
    *,
    full: bool,
    started_at: datetime | None = None,
) -> Saved:
    """Saves one sync's reads in the session's transaction. The caller commits.

    With `started_at` (the sync's start), a company, office or deal our copy saved at or after
    that moment is newer than what this sync read, so it is never overwritten or removed
    (PLAN-V15 T1-5). Example: the sync reads at 6:00, ABC Logistics is sent to HubSpot and saved
    to our copy at 6:05, and the save at 6:10 keeps it, though the 6:00 read hadn't seen it.
    """
    saved = Saved()
    await upsert_owners(
        session,
        [{"owner_id": o.id, "name": o.name, "archived": o.archived} for o in snapshot.owners],
    )
    companies = [item.company for item in snapshot.companies]
    company_ids = [company.hubspot_id for company in companies]
    written = set(
        await upsert_company_rows(session, companies, source=SOURCE, saved_before=started_at)
    )
    saved.companies = len(written)
    saved.offices = await replace_offices(
        session,
        [company_id for company_id in company_ids if company_id in written],
        [
            office
            for item in snapshot.companies
            if item.company.hubspot_id in written
            for office in item.offices
        ],
    )

    # A deal is kept under its company, so a deal whose company isn't in our copy is left out
    # (it comes in with the next sync that has its company).
    others = {deal.hubspot_company_id for deal in snapshot.deals} - set(company_ids)
    known = set(company_ids) | await _companies_we_have(session, others)
    deals = [deal for deal in snapshot.deals if deal.hubspot_company_id in known]
    saved.deals_skipped = snapshot.deals_read - len(deals)
    saved.deals = await upsert_deals(session, deals, source=SOURCE, saved_before=started_at)

    # Removing what HubSpot no longer has needs a full read, and never runs on an empty one: an
    # empty answer is more likely a fault than a HubSpot with no companies.
    if full and companies:
        older = [] if started_at is None else [HubSpotCompany.imported_at < started_at]
        gone = await session.execute(
            delete(HubSpotCompany)
            .where(HubSpotCompany.hubspot_id != all_(_ids("seen_companies", company_ids)), *older)
            .returning(HubSpotCompany.hubspot_id)
        )
        gone_companies = {row[0] for row in gone}
        older_deals = [] if started_at is None else [HubSpotDeal.imported_at < started_at]
        removed = await session.execute(
            delete(HubSpotDeal)
            .where(
                HubSpotDeal.hubspot_deal_id
                != all_(_ids("seen_deals", [deal.hubspot_deal_id for deal in deals])),
                *older_deals,
            )
            .returning(HubSpotDeal.hubspot_company_id)
        )
        removed_deals = [row[0] for row in removed]
        saved.companies_removed = len(gone_companies)
        saved.deals_removed = len(removed_deals)
        saved.changed_company_ids |= gone_companies | set(removed_deals)
    saved.changed_company_ids |= written | {deal.hubspot_company_id for deal in deals}
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
) -> tuple[list[str], int]:
    """Copies contacts and calls. Returns the warnings for the sync row, and how many contacts
    and calls were saved."""
    names = {owner.id: owner.name for owner in owners}
    try:
        people = await read_people(hubspot, names)
    except HubSpotMissingScope:
        return [PEOPLE_WAITING], 0
    except HubSpotError as error:
        log.warning("hubspot_people_failed", extra={"reason": error.title})
        return [f"Contacts and calls weren't copied: {error.title}."], 0
    except Exception:
        log.exception("hubspot_people_failed")
        return [PEOPLE_FAILED], 0
    try:
        async with sessions() as session:
            contacts, calls = await save_people(session, people)
            await session.commit()
    except Exception:
        log.exception("hubspot_people_not_saved")
        return [PEOPLE_FAILED], 0
    return [], contacts + calls


async def run(
    plan: SyncPlan,
    *,
    sessions: async_sessionmaker[AsyncSession],
    hubspot: HubSpot,
    embedder: Embedder,
    fields: FieldMap | None = None,
) -> SyncOut:
    """Reads, saves and rebuilds profiles for a sync `begin` started, and ends its row.

    While it runs, a heartbeat writes `heartbeat_at` and looks for a Stop. A Stop the heartbeat
    sees (asked on the other backend during a deploy, or for a command's sync) ends this call
    normally, with the cancelled row. A cancel from outside (the runner's Stop, or the backend
    stopping) ends the row, then goes on up as a cancel.
    """
    fields = fields or load_field_map()
    mode = plan.mode
    heartbeat = _Heartbeat(sessions, plan.id, asyncio.current_task())
    beating = asyncio.create_task(heartbeat.run(), name=f"hubspot-sync-{plan.id}-heartbeat")
    saved = False

    async def progress(companies: int, deals: int) -> None:
        async with sessions() as session:
            await _set(session, plan.id, companies_read=companies, deals_read=deals)

    async def profile_progress(done: int, total: int) -> None:
        await _note(sessions, plan.id, profiles_done=done, profiles_total=total)

    try:
        await _note(sessions, plan.id, phase="reading")
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

        await _note(sessions, plan.id, phase="saving")
        async with sessions() as session:
            # One transaction for all ~14,000 companies: longer than a request's limit.
            await session.execute(text(f"SET LOCAL statement_timeout = '{SAVE_TIMEOUT}'"))
            stored = await save_snapshot(
                session, snapshot, full=mode == "full", started_at=plan.started_at
            )
            await _set(
                session,
                plan.id,
                commit=False,
                companies_read=snapshot.companies_read,
                deals_read=snapshot.deals_read,
                owners_read=len(snapshot.owners),
                companies_saved=stored.companies,
                offices_saved=stored.offices,
                deals_saved=stored.deals,
                deals_skipped=stored.deals_skipped,
                companies_removed=stored.companies_removed,
                deals_removed=stored.deals_removed,
                warnings=snapshot.warnings,
            )
            await session.commit()
        saved = True  # the point of no return: a Stop from here on keeps the companies

        warnings = list(snapshot.warnings)
        # People and calls (PLAN-V10 C1), once the key can read them. Saved on their own, so a
        # problem there never undoes the companies.
        await _note(sessions, plan.id, phase="people")
        people_warnings, people_saved = await sync_people(sessions, hubspot, snapshot.owners)
        warnings += people_warnings
        await _note(sessions, plan.id, phase="profiles", people_saved=people_saved)
        owed = await _profiles_owed(sessions, plan.id)
        rebuilt, skipped = 0, False
        try:
            async with sessions() as session:
                rebuilt = await rebuild_profiles(
                    session,
                    embedder,
                    company_ids=None if mode == "full" or owed else stored.changed_company_ids,
                    progress=profile_progress,
                )
        except Exception:
            log.exception("hubspot_sync_profiles_failed", extra={"sync_id": plan.id})
            warnings.append(PROFILES_FAILED)
            skipped = True
        return await _finish(
            sessions,
            plan.id,
            "done",
            profiles_rebuilt=rebuilt,
            profiles_skipped=skipped,
            warnings=warnings,
        )
    except asyncio.CancelledError:
        ended: SyncOut | None = None
        with contextlib.suppress(Exception):
            ended = await asyncio.shield(_end_stopped(sessions, plan.id, saved=saved))
        current = asyncio.current_task()
        if heartbeat.stopped_it and ended is not None and current is not None:
            current.uncancel()  # our own heartbeat stopped it: a normal end for the caller
            return ended
        raise
    except HubSpotError as error:
        log.warning("hubspot_sync_failed", extra={"sync_id": plan.id, "reason": error.title})
        return await _finish(
            sessions,
            plan.id,
            "failed",
            error=f"{error.title}. {error.detail}",
            profiles_skipped=saved,
        )
    except Exception:
        log.exception("hubspot_sync_failed", extra={"sync_id": plan.id})
        return await _finish(sessions, plan.id, "failed", error=SYNC_ERROR, profiles_skipped=saved)
    finally:
        beating.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beating


class _Heartbeat:
    """Writes the sync's `heartbeat_at` every `HEARTBEAT_SECONDS` while it runs, and stops the
    sync when someone asked (`cancel_requested_at`). A failed write only costs one beat."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        sync_id: int,
        main: asyncio.Task[Any] | None,
    ) -> None:
        self._sessions = sessions
        self._sync_id = sync_id
        self._main = main
        self.stopped_it = False

    async def run(self) -> None:
        warned = False
        while True:
            try:
                async with self._sessions() as session:
                    asked = await session.scalar(
                        update(HubSpotSync)
                        .where(HubSpotSync.id == self._sync_id, HubSpotSync.status == "running")
                        .values(heartbeat_at=datetime.now(UTC))
                        .returning(HubSpotSync.cancel_requested_at)
                    )
                    await session.commit()
                main = self._main
                if asked is not None and main is not None and not main.done():
                    if not main.cancelling():  # a Stop from the runner may have got there first
                        self.stopped_it = True
                        main.cancel()
                    return
            except Exception:
                if not warned:
                    warned = True
                    log.warning(
                        "hubspot_sync_heartbeat_failed",
                        extra={"sync_id": self._sync_id},
                        exc_info=True,
                    )
            await asyncio.sleep(HEARTBEAT_SECONDS)


async def _note(sessions: async_sessionmaker[AsyncSession], sync_id: int, **values: Any) -> None:
    """Saves a phase or a progress count. A failure only costs what the screen shows: it never
    stops the sync."""
    try:
        async with sessions() as session:
            await _set(session, sync_id, **values)
    except Exception:
        log.warning("hubspot_sync_progress_not_saved", extra={"sync_id": sync_id}, exc_info=True)


async def _profiles_owed(sessions: async_sessionmaker[AsyncSession], sync_id: int) -> bool:
    """True when a sync since the last clean one saved companies but skipped their profiles
    (stopped, or the rebuild failed): this sync then rebuilds every profile."""
    async with sessions() as session:
        last_clean = await session.scalar(
            select(func.max(HubSpotSync.started_at)).where(
                HubSpotSync.status == "done",
                HubSpotSync.profiles_skipped.is_(False),
                HubSpotSync.id != sync_id,
            )
        )
        owed = select(HubSpotSync.id).where(
            HubSpotSync.profiles_skipped.is_(True), HubSpotSync.id != sync_id
        )
        if last_clean is not None:
            owed = owed.where(HubSpotSync.started_at > last_clean)
        return await session.scalar(owed.limit(1)) is not None


async def _end_stopped(
    sessions: async_sessionmaker[AsyncSession], sync_id: int, *, saved: bool
) -> SyncOut | None:
    """Ends a sync that was stopped: `cancelled` when someone pressed Stop, `interrupted` when the
    backend stopped. A row already ended elsewhere is left as it is."""
    async with sessions() as session:
        row = await session.get(HubSpotSync, sync_id)
        if row is None:
            return None
        if row.status == "running":
            values: dict[str, Any] = {
                "finished_at": datetime.now(UTC),
                "phase": None,
                "profiles_skipped": saved,
            }
            if row.cancel_requested_at is not None:
                line = CANCELLED_AFTER_SAVE if saved else CANCELLED_BEFORE_SAVE
                values |= {"status": "cancelled", "warnings": [*row.warnings, line]}
            else:
                values |= {"status": "interrupted", "error": INTERRUPTED}
            await session.execute(
                update(HubSpotSync)
                .where(HubSpotSync.id == sync_id, HubSpotSync.status == "running")
                .values(**values)
            )
            await session.commit()
            await session.refresh(row)
        return SyncOut.model_validate(row)


async def _set(session: AsyncSession, sync_id: int, *, commit: bool = True, **values: Any) -> None:
    await session.execute(update(HubSpotSync).where(HubSpotSync.id == sync_id).values(**values))
    if commit:
        await session.commit()


async def _finish(
    sessions: async_sessionmaker[AsyncSession], sync_id: int, status: str, **values: Any
) -> SyncOut:
    """Ends a running sync. A row that was already ended (marked left over by a backend that
    didn't see this one's heartbeat) keeps its end: this never flips it back."""
    if values.get("error"):
        values["error"] = scrub(str(values["error"]))
    async with sessions() as session:
        result = await session.execute(
            update(HubSpotSync)
            .where(HubSpotSync.id == sync_id, HubSpotSync.status == "running")
            .values(status=status, finished_at=datetime.now(UTC), phase=None, **values)
        )
        if cast("CursorResult[Any]", result).rowcount == 0:
            log.warning("hubspot_sync_ended_elsewhere", extra={"sync_id": sync_id})
        await session.commit()
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
    """Starts syncs in the background, stops one when asked, and stops them all at shut-down.

    It keeps one task for each sync id, so a sync that was marked left over while it still ran
    is never lost from sight: `stop` stops every one.
    """

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
        self._tasks: dict[int, asyncio.Task[SyncOut | None]] = {}

    @property
    def busy(self) -> bool:
        return bool(self.running_ids())

    def running_ids(self) -> set[int]:
        return {sync_id for sync_id, task in self._tasks.items() if not task.done()}

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
        task = asyncio.create_task(self._run(plan, client), name=f"hubspot-sync-{plan.id}")
        self._tasks[plan.id] = task
        task.add_done_callback(functools.partial(self._forget, plan.id))
        async with self._sessions() as session:
            row = await session.get(HubSpotSync, plan.id)
            if row is None:  # pragma: no cover - the row was made by `begin`
                raise RuntimeError(f"sync {plan.id} has no row")
            return SyncOut.model_validate(row)

    def _forget(self, sync_id: int, task: asyncio.Task[SyncOut | None]) -> None:
        if self._tasks.get(sync_id) is task:
            del self._tasks[sync_id]

    async def _run(self, plan: SyncPlan, client: HubSpot) -> SyncOut | None:
        try:
            return await run(
                plan, sessions=self._sessions, hubspot=client, embedder=self._embedder()
            )
        finally:
            await client.aclose()

    async def wait(self, sync_id: int) -> None:
        """Waits for a sync this runner started to end, however it ends."""
        task = self._tasks.get(sync_id)
        if task is not None:
            await asyncio.wait({task})

    async def cancel(self, sync_id: int, *, wait: float = CANCEL_WAIT_SECONDS) -> SyncOut:
        """Stops a running sync (PLAN-V15 T1-3). Raises `SyncNotFound` and `SyncNotRunning`.

        The Stop is saved on the row first, so it works whichever backend runs the sync. If this
        one runs it, its task is stopped now, and this waits up to `wait` seconds for it to end.
        If nobody runs it (no heartbeat for `STALE_AFTER`), the row ends at once. Otherwise the
        other backend's heartbeat sees the Stop within `HEARTBEAT_SECONDS`, and the row this
        returns is still running, with `cancel_requested_at` set.
        """
        async with self._sessions() as session:
            row = await session.get(HubSpotSync, sync_id)
            if row is None:
                raise SyncNotFound(sync_id)
            if row.status != "running":
                raise SyncNotRunning(sync_id)
            if row.cancel_requested_at is None:
                await _set(session, sync_id, cancel_requested_at=datetime.now(UTC))
        task = self._tasks.get(sync_id)
        if task is not None and not task.done():
            if not task.cancelling():  # its heartbeat may have stopped it already
                task.cancel()
            await asyncio.wait({task}, timeout=wait)
        else:
            await self._end_left_over(sync_id)
        async with self._sessions() as session:
            row = await session.get(HubSpotSync, sync_id)
            if row is None:  # pragma: no cover - rows are never deleted
                raise SyncNotFound(sync_id)
            return SyncOut.model_validate(row)

    async def _end_left_over(self, sync_id: int) -> None:
        """Ends a running row nobody runs any more (no heartbeat for `STALE_AFTER`) as cancelled.
        A row with a fresh heartbeat runs on another backend: its own heartbeat ends it."""
        async with self._sessions() as session:
            row = await session.get(HubSpotSync, sync_id)
            if row is None or row.status != "running":
                return
            if (row.heartbeat_at or row.started_at) >= datetime.now(UTC) - STALE_AFTER:
                return
            saved = row.phase in AFTER_SAVE
            await session.execute(
                update(HubSpotSync)
                .where(HubSpotSync.id == sync_id, HubSpotSync.status == "running")
                .values(
                    status="cancelled",
                    finished_at=datetime.now(UTC),
                    phase=None,
                    profiles_skipped=saved,
                    warnings=[
                        *row.warnings,
                        CANCELLED_AFTER_SAVE if saved else CANCELLED_BEFORE_SAVE,
                    ],
                )
            )
            await session.commit()

    async def clear_left_over(self) -> int:
        """Marks syncs a stopped backend left "running" as interrupted. Called at start-up, so a
        stuck row never blocks the next sync or keeps the website asking. Returns how many."""
        async with self._sessions() as session:
            cleared = await mark_stale(session)
            await session.commit()
        if cleared:
            log.warning("hubspot_sync_left_over_cleared", extra={"count": cleared})
        return cleared

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
        """Stops every sync this runner started (their rows end interrupted)."""
        tasks = [task for task in self._tasks.values() if not task.done()]
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
