"""The run manager: starts runs, watches them, stops them and brings them back.

One manager lives in each process, in `app.state.run_manager`. It is built from what it needs
(a session factory, the embedder, a Claude provider, the checkpoint source, a settings provider
and the run kinds) and never reaches for the database engine or the Claude client by itself, so
tests can build one with fakes. Package B1b writes `core/runs/reads.py` and `estimate.py`: the
reading methods at the end of this class only call them.

How it behaves (section 4 of the design has the details):
- `start` checks the body, the caps and the Idempotency-Key, then takes a slot in one step with
  no await, so two requests at once can't both get the last slot. Then it saves the row and
  starts the task.
- The task makes the `RunContext`, emits `run_started`, runs the kind's handler, and ALWAYS
  finishes the run (a `finally`): the final status and `run_finished` are saved in one
  transaction, the totals are rebuilt from the search log, and the slot is freed.
- `cancel` asks the task to stop once. The run ends `cancelled`. A stop caused by the backend
  shutting down ends `interrupted`, so the run can be resumed.
- `resume` continues an `interrupted` or `failed` run from its checkpoint (`resume=True`).
- `recover` runs once at start-up and marks runs the last process left going as `interrupted`.
- `subscribe` replays the events after a number, then follows live ones (`core.runs.events`).

A task that dies with something that is not an `Exception` or a cancel (a `SimulatedCrash` in a
test, `KeyboardInterrupt`, `SystemExit`) is treated like a dead process: nothing more is written,
the row stays `running`, and `recover()` marks it `interrupted` at the next start.

What the log and the row never hold: the text of an unexpected exception. The row and the events
get a fixed sentence and an `error_id`; the traceback goes to the log, with secrets removed.
"""

import asyncio
import contextlib
import logging
import traceback
import uuid
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from functools import partial
from typing import TYPE_CHECKING, Any, cast
from uuid import UUID

from pydantic import BaseModel, ValidationError
from sqlalchemy import String, func, select, text, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import Problem
from core.apps import AppSpec
from core.claude.client import ClaudeUnavailable
from core.config import Settings
from core.db.base import CORE_SCHEMA
from core.logs import redact, scrub
from core.memory.embedder import Embedder
from core.runs import reads
from core.runs.budget import RunBudget
from core.runs.estimate import estimate_run
from core.runs.events import EventBus
from core.runs.models import TERMINAL_RUN_STATUSES, Run
from core.runs.models import RunEvent as RunEventRow
from core.runs.schemas import (
    EventLog,
    ProgressData,
    RunCaps,
    RunCounts,
    RunCreate,
    RunEstimate,
    RunFinishedData,
    RunOut,
    RunPage,
    RunProblemData,
    RunResumedData,
    RunStartedData,
    RunStatus,
    RunSummary,
)
from core.runs.types import (
    CheckpointerSource,
    ClaudeProvider,
    EventStream,
    KindKey,
    RunContext,
    RunKind,
    RunTotals,
    RunVersions,
    SettingsProvider,
    make_caps,
)
from core.runs.validation import find_kind, parse_params
from core.searches.models import SearchLog

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

log = logging.getLogger(__name__)

STOPPED_BY_PERSON = "Stopped by a person"
BACKEND_STOPPED = "The backend stopped while this run was going"
FAILED_SHORT = "Stopped by an error"
# The row and the events get this text for any error that is not a plain Claude problem. The
# details (and the error_id that finds them) are in the backend log.
UNEXPECTED_ERROR = (
    "The run stopped because of an unexpected error. The details are in the backend log."
)
MAX_RESUMES = 3
CANCEL_WAIT_SECONDS = 10
SHUTDOWN_WAIT_SECONDS = 10
CHECKPOINT_CLOSE_SECONDS = 5
IDEMPOTENCY_KEY_MAX = 64
REMEMBERED_KEYS = 1000  # Idempotency-Keys kept in memory (older ones are found in the database)
DEFAULT_PROGRESS_SECONDS = 2.0
COMPANY_EVENTS = ("company_started", "company_done", "company_failed")
SLICE_EVENTS = ("slice_started", "slice_done", "slice_failed")


def _length(column: str) -> int:
    length = cast(String, Run.__table__.c[column].type).length
    assert length is not None
    return length


# The column sizes. A text longer than its column would make the save fail, so it is cut first.
STOP_REASON_MAX = _length("stop_reason")
RULES_VERSION_MAX = _length("rules_version")
PROMPT_VERSIONS_MAX = _length("prompt_versions")
ERROR_ID_MAX = _length("error_id")


def clean_text(value: str, limit: int) -> str:
    """`value` without NUL characters (Postgres can't store them), cut to `limit` characters."""
    value = value.replace("\x00", "")
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"


@contextlib.contextmanager
def _database_errors() -> Iterator[None]:
    """A database that can't be reached is a plain 503, not a 500."""
    try:
        yield
    except (SQLAlchemyError, OSError) as error:
        log.warning("database_unavailable", extra={"reason": type(error).__name__})
        raise Problem(
            503,
            "The database isn't available",
            "The engine can't reach its database. Check that it is running, then try again.",
            code="database_unavailable",
        ) from None


def kinds_from_specs(specs: Sequence[AppSpec]) -> dict[KindKey, RunKind[Any]]:
    """The run kinds of every loaded project, by (app, mode). A mode listed twice is an error."""
    kinds: dict[KindKey, RunKind[Any]] = {}
    for spec in specs:
        for kind in spec.run_kinds:
            key = (spec.name, kind.mode)
            if key in kinds:
                raise RuntimeError(f"{spec.name} lists the run mode {kind.mode!r} twice")
            kinds[key] = kind
    return kinds


# --- What the manager keeps for each run ---------------------------------------------------


@dataclass
class _Entry:
    """A run that is going in this process. It is in `_active` from the moment it gets a slot
    until its task is over, so it holds the only strong reference to the task."""

    run_id: UUID
    app: str
    mode: str
    started: asyncio.Event = field(default_factory=asyncio.Event)  # the task has begun
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)  # `ctx.cancelled`
    task: "asyncio.Task[None] | None" = None
    ticker: "asyncio.Task[None] | None" = None
    finisher: "asyncio.Future[None] | None" = None
    cancel_requested: bool = False  # a person asked to stop
    shutting_down: bool = False  # the backend is stopping
    task_cancelled: bool = False  # `task.cancel()` was called (at most once)


@dataclass
class _Key:
    """An Idempotency-Key used by a run started in this process."""

    run_id: UUID
    app: str
    mode: str
    params: dict[str, Any]
    created: "asyncio.Future[None]"  # done when the row is saved; raises if it could not be


@dataclass(frozen=True)
class _Job:
    """What the task needs, worked out before it starts."""

    kind: RunKind[Any]
    params: BaseModel
    settings: Settings
    caps: RunCaps
    versions: RunVersions
    counts: RunCounts
    saver: "BaseCheckpointSaver[Any]"
    resume: bool = False
    from_status: str = ""


@dataclass(frozen=True)
class _Final:
    status: RunStatus
    stop_reason: str | None = None
    error: str | None = None
    error_id: str | None = None


@dataclass(frozen=True)
class _Logged:
    """What the search log says a run has spent."""

    cost_usd: Decimal
    web_searches: int
    claude_requests: int


def _logged_totals(run_id: UUID) -> dict[str, Any]:
    """`SET` values for a run's totals: what the search log says, never lower than the row has.

    Sums are taken inside the statement, so the read and the write are one step.
    """
    own = SearchLog.run_id == run_id
    cost = select(func.coalesce(func.sum(SearchLog.cost_usd), 0)).where(own).scalar_subquery()
    searches = (
        select(func.coalesce(func.sum(SearchLog.web_searches), 0)).where(own).scalar_subquery()
    )
    requests = select(func.count()).select_from(SearchLog).where(own).scalar_subquery()
    return {
        "cost_usd": func.greatest(Run.cost_usd, cost),
        "web_searches": func.greatest(Run.web_searches, searches),
        "claude_requests": func.greatest(Run.claude_requests, requests),
    }


def _lowest(stored: RunCaps, now: RunCaps) -> RunCaps:
    """The caps a resume uses: each one the lower of what the run started with and what the
    settings allow now. A stored 0 means "not saved", so the current value is used."""

    def low(old: Decimal, new: Decimal) -> Decimal:
        return min(old, new) if old > 0 else new

    return RunCaps(
        run_cap_usd=low(stored.run_cap_usd, now.run_cap_usd),
        max_companies=int(low(Decimal(stored.max_companies), Decimal(now.max_companies))),
        company_cap_usd=low(stored.company_cap_usd, now.company_cap_usd),
        discovery_cap_usd=low(stored.discovery_cap_usd, now.discovery_cap_usd),
    )


class RunManager:
    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession],
        embedder: Embedder,
        claude_provider: ClaudeProvider,
        checkpointer_source: CheckpointerSource,
        settings_provider: SettingsProvider,
        kinds: Mapping[KindKey, RunKind[Any]],
        acquire_lock: Callable[[], Awaitable[bool]] | None = None,
        release_lock: Callable[[], Awaitable[None]] | None = None,
        progress_interval: float = DEFAULT_PROGRESS_SECONDS,
    ) -> None:
        """`acquire_lock` tries the Postgres advisory lock that keeps a second backend from
        running on the same database (True when taken). `release_lock` lets it go. Both are
        hooks so a test can pass fakes, or nothing. `progress_interval` is how often a running
        run saves its totals and emits `progress` (only when they changed)."""
        self.session_factory = session_factory
        self.embedder = embedder
        self.claude_provider = claude_provider
        self.checkpointer_source = checkpointer_source
        self.settings_provider = settings_provider
        self.kinds = dict(kinds)
        self.acquire_lock = acquire_lock
        self.release_lock = release_lock
        self.progress_interval = progress_interval
        self.events = EventBus(session_factory, is_active=self.is_active)
        self._active: dict[UUID, _Entry] = {}
        self._keys: dict[str, _Key] = {}
        self._launching: set[asyncio.Future[Any]] = set()
        self._closing = False

    # --- State ----------------------------------------------------------------------------

    def is_active(self, run_id: UUID) -> bool:
        """True while a run is going in this process (from when it gets its slot)."""
        return run_id in self._active

    @property
    def active_run_ids(self) -> list[UUID]:
        return list(self._active)

    async def acquire_backend_lock(self) -> bool:
        """Takes the Postgres advisory lock (True when there is none to take). `lifecycle`
        calls it before `recover()`."""
        if self.acquire_lock is None:
            return True
        return await self.acquire_lock()

    # --- Small reads (own sessions, so this file never depends on reads.py) ---------------

    async def _row(self, run_id: UUID) -> Run:
        with _database_errors():
            async with self.session_factory() as session:
                row = await session.get(Run, run_id, populate_existing=True)
        if row is None:
            raise Problem(404, "Run not found", "There is no run with this id.")
        return row

    async def _out(self, run_id: UUID) -> RunOut:
        return RunOut.model_validate(await self._row(run_id))

    async def _settings(self) -> Settings:
        with _database_errors():
            return await self.settings_provider()

    async def _saver(self) -> "BaseCheckpointSaver[Any]":
        try:
            return await self.checkpointer_source.get()
        except Exception as error:
            # The reason can hold a host, a user or a password. Only its type is logged.
            log.warning("checkpoint_store_unavailable", extra={"reason": type(error).__name__})
            raise Problem(
                503,
                "Run storage isn't available",
                "The engine couldn't open the place where runs save their progress. "
                "Check that the database is running, then try again.",
                code="checkpoints_unavailable",
            ) from None

    async def _logged(self, run_id: UUID) -> _Logged:
        async with self.session_factory() as session:
            row = (
                await session.execute(
                    select(
                        func.coalesce(func.sum(SearchLog.cost_usd), 0),
                        func.coalesce(func.sum(SearchLog.web_searches), 0),
                        func.count(),
                    ).where(SearchLog.run_id == run_id)
                )
            ).one()
        return _Logged(Decimal(row[0]), int(row[1]), int(row[2]))

    async def _work_state(self, run_id: UUID) -> tuple[int, int, int]:
        """For a resume: (companies finished, companies started and not finished, slices started
        and not finished), from the run's events. The latest event of each name decides."""
        async with self.session_factory() as session:
            rows = (
                await session.execute(
                    select(RunEventRow.type, RunEventRow.data)
                    .where(
                        RunEventRow.run_id == run_id,
                        RunEventRow.type.in_((*COMPANY_EVENTS, *SLICE_EVENTS)),
                    )
                    .order_by(RunEventRow.seq)
                )
            ).all()
        companies: dict[str, str] = {}
        slices: dict[str, str] = {}
        for event_type, data in rows:
            if event_type in COMPANY_EVENTS:
                companies[str(data.get("name"))] = event_type
            else:
                slices[str(data.get("slice_id"))] = event_type
        finished = sum(1 for last in companies.values() if last != "company_started")
        open_companies = sum(1 for last in companies.values() if last == "company_started")
        open_slices = sum(1 for last in slices.values() if last == "slice_started")
        return finished, open_companies, open_slices

    # --- Doing (B1a) ----------------------------------------------------------------------

    async def start(
        self,
        app: str,
        mode: str,
        params: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> RunOut:
        """Starts a run. Raises Problem: 404 unknown app or mode, 422 bad params (errors as
        body.params.<field>), 409 run_already_active (with run_id), 503 no checkpoint store.

        A repeated `idempotency_key` returns the run the first call made. The same key with a
        different body is a 409 `idempotency_key_reused`.

        What it takes from the kind (`core.runs.types.RunKind`), so nothing is guessed from the
        params model:
        - the caps: `make_caps(settings, kind.caps_override(params))`, saved with the run;
        - the versions: `kind.versions()`, saved in the run row (`rules_version`,
          `prompt_versions`, cut to the column sizes), put in `run_started` and in the
          `RunContext`;
        - the size check: `kind.check(params, settings, caps)`.
        A kind without a hook gets the settings' caps and empty versions.
        """
        self._check_open()
        kind = find_kind(self.kinds, app, mode)  # the same checks as the estimate
        if idempotency_key is not None and not 1 <= len(idempotency_key) <= IDEMPOTENCY_KEY_MAX:
            raise Problem(
                422,
                "The request isn't valid",
                "Check the fields listed in errors.",
                errors=[
                    {
                        "field": "header.idempotency-key",
                        "message": f"Use 1 to {IDEMPOTENCY_KEY_MAX} characters",
                    }
                ],
            )
        model = parse_params(kind.params_model, params)
        settings = await self._settings()
        caps = make_caps(settings, kind.caps_override(model) if kind.caps_override else None)
        if kind.check is not None:
            kind.check(model, settings, caps)
        versions = kind.versions() if kind.versions is not None else RunVersions()
        dumped = model.model_dump(mode="json")

        if idempotency_key is not None:
            earlier = await self._earlier_run(idempotency_key, app, mode, dumped)
            if earlier is not None:
                return earlier
        saver = await self._saver()

        slot = self._take_slot(app, mode, dumped, idempotency_key, settings)
        if isinstance(slot, _Key):  # the same request again: wait for the first one to be saved
            await asyncio.shield(slot.created)
            return await self._out(slot.run_id)
        entry, key = slot
        job = _Job(
            kind=kind,
            params=model,
            settings=settings,
            caps=caps,
            versions=versions,
            counts=RunCounts(),
            saver=saver,
        )
        # The save and the launch can't be left half done if this request is cancelled.
        launch = asyncio.ensure_future(self._create(entry, job, dumped, idempotency_key, key))
        self._launching.add(launch)
        launch.add_done_callback(self._launching.discard)
        return await asyncio.shield(launch)

    def _take_slot(
        self,
        app: str,
        mode: str,
        params: dict[str, Any],
        idempotency_key: str | None,
        settings: Settings,
    ) -> "_Key | tuple[_Entry, _Key | None]":
        """The Idempotency-Key check and the slot, in ONE step with no await in it, so two
        requests at once can't both get the last slot or the same key.

        Returns the earlier `_Key` when this is a repeat of a request still being saved, else
        the new entry (it is in `_active` now) and its key.
        """
        self._check_open()
        if idempotency_key is not None:
            remembered = self._keys.get(idempotency_key)
            if remembered is not None:
                self._check_same(
                    remembered.app, remembered.mode, remembered.params, app, mode, params
                )
                return remembered
        if len(self._active) >= settings.max_concurrent_runs:
            raise Problem(
                409,
                "A run is already going",
                "Wait for it to finish, or stop it, then start this one.",
                code="run_already_active",
                run_id=str(next(iter(self._active))),
            )
        entry = _Entry(run_id=uuid.uuid4(), app=app, mode=mode)
        self._active[entry.run_id] = entry
        key: _Key | None = None
        if idempotency_key is not None:
            created: asyncio.Future[None] = asyncio.get_running_loop().create_future()
            key = _Key(entry.run_id, app, mode, params, created)
            self._remember(idempotency_key, key)
        return entry, key

    def _check_open(self) -> None:
        if self._closing:
            raise Problem(
                503,
                "The backend is stopping",
                "Try again when it is back.",
                code="backend_stopping",
            )

    @staticmethod
    def _check_same(
        old_app: str,
        old_mode: str,
        old_params: dict[str, Any],
        app: str,
        mode: str,
        params: dict[str, Any],
    ) -> None:
        if (old_app, old_mode) != (app, mode) or old_params != params:
            raise Problem(
                409,
                "This Idempotency-Key was used for a different request",
                "A key belongs to one request. Use a new key for a new run.",
                code="idempotency_key_reused",
            )

    def _remember(self, key: str, entry: _Key) -> None:
        self._keys[key] = entry
        while len(self._keys) > REMEMBERED_KEYS:  # the oldest go first; the database has them
            oldest = next(iter(self._keys))
            if self._keys[oldest].created.done():
                del self._keys[oldest]
            else:
                break

    async def _earlier_run(
        self, key: str, app: str, mode: str, params: dict[str, Any]
    ) -> RunOut | None:
        """The run an earlier request with this key made (maybe before a restart), or None."""
        with _database_errors():
            async with self.session_factory() as session:
                row = await session.scalar(select(Run).where(Run.idempotency_key == key))
        if row is None:
            return None
        self._check_same(row.app, row.mode, row.params, app, mode, params)
        return RunOut.model_validate(row)

    async def _create(
        self,
        entry: _Entry,
        job: _Job,
        dumped: dict[str, Any],
        idempotency_key: str | None,
        key: _Key | None,
    ) -> RunOut:
        """Saves the row and starts the task. On any failure the slot and the key are given back."""
        run = Run(
            id=entry.run_id,
            app=entry.app,
            mode=entry.mode,
            status="queued",
            params=dumped,
            caps=job.caps.model_dump(mode="json"),
            rules_version=clean_text(job.versions.rules, RULES_VERSION_MAX),
            prompt_versions=clean_text(job.versions.prompts, PROMPT_VERSIONS_MAX),
            counts=job.counts.model_dump(mode="json"),
            idempotency_key=idempotency_key,
        )
        duplicate = False
        try:
            with _database_errors():
                async with self.session_factory() as session:
                    try:
                        session.add(run)
                        await session.commit()
                    except IntegrityError:  # the key is already in the database
                        duplicate = True
                    else:
                        await session.refresh(run)
                        out = RunOut.model_validate(run)
            if duplicate:
                earlier = (
                    await self._earlier_run(idempotency_key, entry.app, entry.mode, dumped)
                    if idempotency_key is not None
                    else None
                )
                if earlier is None:
                    raise Problem(
                        503,
                        "The database isn't available",
                        "The run could not be saved. Try again.",
                        code="database_unavailable",
                    )
                self._give_back(entry, idempotency_key, key, None)
                return earlier
        except BaseException as error:
            self._give_back(entry, idempotency_key, key, error)
            raise
        self._launch(entry, job)
        if key is not None and not key.created.done():
            key.created.set_result(None)
        return out

    def _give_back(
        self,
        entry: _Entry,
        idempotency_key: str | None,
        key: _Key | None,
        error: BaseException | None,
    ) -> None:
        self._release(entry)
        if idempotency_key is not None and self._keys.get(idempotency_key) is key:
            del self._keys[idempotency_key]
        if key is not None and not key.created.done():
            # Anyone who sent the same request while this one was being saved gets a plain error.
            key.created.set_exception(
                Problem(
                    503,
                    "The run could not be saved",
                    "Try again.",
                    code="database_unavailable",
                )
            )
            key.created.exception()  # marks it as read, so nobody is told it was forgotten

    def _launch(self, entry: _Entry, job: _Job) -> None:
        task = asyncio.create_task(self._run_task(entry, job), name=f"run-{entry.run_id}")
        entry.task = task  # `_active` holds the entry, so it holds the task until it is over
        task.add_done_callback(partial(self._task_done, entry))

    def _task_done(self, entry: _Entry, task: "asyncio.Task[None]") -> None:
        self._release(entry)
        if not task.cancelled():
            error = task.exception()  # reading it keeps asyncio from logging it as forgotten
            if error is not None:
                log.error(
                    "run_task_crashed",
                    extra={"run_id": str(entry.run_id), "kind": type(error).__name__},
                )

    def _release(self, entry: _Entry) -> None:
        """Frees the run's slot and tells its watchers to check whether the run is over."""
        if self._active.get(entry.run_id) is entry:
            del self._active[entry.run_id]
        self.events.wake(entry.run_id)

    # --- The task -------------------------------------------------------------------------

    async def _run_task(self, entry: _Entry, job: _Job) -> None:
        entry.started.set()  # first: from here on, a cancel reaches the `finally` below
        ctx: RunContext[Any] | None = None
        final: _Final | None = None
        crash: BaseException | None = None
        stopped = False
        try:
            try:
                await self._mark_running(entry.run_id)
                ctx = await self._make_context(entry, job)
                if job.resume:
                    await ctx.emit_event(RunResumedData(from_status=job.from_status))
                else:
                    await ctx.emit_event(
                        RunStartedData(
                            mode=job.kind.mode,
                            caps=job.caps,
                            rules_version=clean_text(job.versions.rules, RULES_VERSION_MAX),
                        )
                    )
                entry.ticker = asyncio.create_task(
                    self._tick(entry.run_id, ctx), name=f"progress-{entry.run_id}"
                )
                log.info(
                    "run_started",
                    extra={"run_id": str(entry.run_id), "app": entry.app, "mode": entry.mode},
                )
                outcome = await job.kind.handler(ctx)
                if entry.cancel_requested:
                    final = _Final("cancelled", STOPPED_BY_PERSON)
                else:
                    reason = outcome.stop_reason
                    final = _Final("done", clean_text(reason, STOP_REASON_MAX) if reason else None)
            except asyncio.CancelledError:
                stopped = True
                final = self._stopped(entry)
            except ClaudeUnavailable as error:
                message = redact(f"{error.title}. {error.detail}")
                final = _Final(
                    "failed", clean_text(redact(error.title), STOP_REASON_MAX), error=message
                )
            except Exception as error:
                error_id = uuid.uuid4().hex[:12]
                self._log_failure(entry, error_id, error)
                final = _Final("failed", FAILED_SHORT, UNEXPECTED_ERROR, error_id)
            except BaseException as error:  # a dead process: write nothing more
                crash = error
                log.error(
                    "run_task_died",
                    extra={"run_id": str(entry.run_id), "kind": type(error).__name__},
                )
        finally:
            try:
                await self._wrap_up(entry, job, ctx, final)
            finally:
                self._release(entry)
        if crash is not None:
            raise crash
        if stopped:
            raise asyncio.CancelledError

    @staticmethod
    def _stopped(entry: _Entry) -> _Final:
        if entry.cancel_requested:
            return _Final("cancelled", STOPPED_BY_PERSON)
        return _Final("interrupted", BACKEND_STOPPED)

    @staticmethod
    def _log_failure(entry: _Entry, error_id: str, error: Exception) -> None:
        trace = "".join(traceback.format_exception(error))
        # The traceback is written as text with the secrets removed, not as `exc_info`.
        log.error(
            "run_failed",
            extra={"run_id": str(entry.run_id), "error_id": error_id, "trace": scrub(trace)},
        )

    async def _mark_running(self, run_id: UUID) -> None:
        async with self.session_factory() as session:
            await session.execute(
                update(Run)
                .where(Run.id == run_id, Run.status == "queued")
                .values(status="running", started_at=func.coalesce(Run.started_at, func.now()))
            )
            await session.commit()

    async def _make_context(self, entry: _Entry, job: _Job) -> RunContext[Any]:
        claude = self.claude_provider()  # raises ClaudeUnavailable (no key, bad key)
        logged = await self._logged(entry.run_id)
        spent = logged.cost_usd
        companies_started = 0
        if job.resume:
            finished, open_companies, open_slices = await self._work_state(entry.run_id)
            # What a company or slice that never finished may have spent is not all in the log.
            spent += job.caps.company_cap_usd * open_companies
            spent += job.settings.slice_reserve_usd * open_slices
            companies_started = finished
        run_id = entry.run_id

        async def emit(type: str, data: BaseModel) -> None:
            await self.events.emit(run_id, type, data)

        settings = job.settings
        return RunContext(
            run_id=run_id,
            app=entry.app,
            mode=entry.mode,
            params=job.params,
            settings=settings,
            caps=job.caps,
            rules_version=clean_text(job.versions.rules, RULES_VERSION_MAX),
            prompt_versions=clean_text(job.versions.prompts, PROMPT_VERSIONS_MAX),
            resume=job.resume,
            session_factory=self.session_factory,
            claude=claude,
            embedder=self.embedder,
            checkpointer=job.saver,
            emit=emit,
            cancelled=entry.cancelled,
            totals=RunTotals(
                cost_usd=logged.cost_usd,
                web_searches=logged.web_searches,
                claude_requests=logged.claude_requests,
                counts=job.counts.model_copy(deep=True),
            ),
            budget=RunBudget(
                job.caps.run_cap_usd,
                job.caps.max_companies,
                spent=spent,
                companies_started=companies_started,
            ),
            research_gate=asyncio.Semaphore(settings.run_company_concurrency),
            discover_gate=asyncio.Semaphore(settings.run_discover_concurrency),
        )

    async def _tick(self, run_id: UUID, ctx: RunContext[Any]) -> None:
        """While the run goes: save its totals and emit `progress`, when they changed."""
        last = None
        while True:
            await asyncio.sleep(self.progress_interval)
            snapshot = ctx.totals.progress()
            if snapshot == last:
                continue
            try:
                await self._write_progress(run_id, snapshot)
                last = snapshot
            except Exception as error:  # one missed tick is not worth stopping the run for
                log.warning(
                    "run_progress_failed",
                    extra={"run_id": str(run_id), "reason": type(error).__name__},
                )

    async def _write_progress(self, run_id: UUID, snapshot: ProgressData) -> None:
        async def build(session: AsyncSession) -> BaseModel:
            await session.execute(
                update(Run)
                .where(Run.id == run_id)
                .values(**_logged_totals(run_id), counts=snapshot.counts.model_dump(mode="json"))
            )
            return snapshot

        await self.events.emit_in_transaction(run_id, "progress", build)

    async def _wrap_up(
        self, entry: _Entry, job: _Job, ctx: RunContext[Any] | None, final: _Final | None
    ) -> None:
        """Finishes the run in a task of its own, so a cancel can't cut the final write short."""
        entry.finisher = asyncio.ensure_future(self._finish(entry, job, ctx, final))
        await asyncio.shield(entry.finisher)

    async def _finish(
        self, entry: _Entry, job: _Job, ctx: RunContext[Any] | None, final: _Final | None
    ) -> None:
        run_id = entry.run_id
        ticker = entry.ticker
        if ticker is not None:  # stopped (cancel, then await) so it can't write after the end
            ticker.cancel()
            await asyncio.wait({ticker})
        if final is None:
            return  # a dead process leaves the row as it is
        counts = ctx.totals.counts if ctx is not None else None

        async def build(session: AsyncSession) -> BaseModel | None:
            return await self._write_final(session, run_id, final, counts)

        if final.status == "failed" and final.error:
            try:
                await self.events.emit(run_id, "problem", RunProblemData(message=final.error))
            except Exception as error:
                log.warning(
                    "run_problem_event_failed",
                    extra={"run_id": str(run_id), "reason": type(error).__name__},
                )
        try:
            await self.events.emit_in_transaction(run_id, "run_finished", build)
        except Exception as error:
            # The row stays `running`, and `recover()` fixes it at the next start.
            log.error(
                "run_final_write_failed",
                extra={"run_id": str(run_id), "reason": type(error).__name__},
            )
            return
        if final.status in ("done", "cancelled"):
            # Nothing is left to resume. A failed or interrupted run keeps its checkpoints.
            try:
                await job.saver.adelete_thread(str(run_id))
            except Exception as error:
                log.warning(
                    "checkpoint_delete_failed",
                    extra={"run_id": str(run_id), "reason": type(error).__name__},
                )
        log.info(
            "run_finished",
            extra={"run_id": str(run_id), "status": final.status, "mode": entry.mode},
        )

    @staticmethod
    async def _write_final(
        session: AsyncSession,
        run_id: UUID,
        final: _Final,
        counts: RunCounts | None,
        only_from: tuple[str, ...] | None = None,
    ) -> RunFinishedData | None:
        """The last write of a run, in the caller's transaction: the status, the reason, the
        totals rebuilt from the search log (never lower than the row has) and the counts.
        Returns the `run_finished` data, or None when no row matched."""
        stop_reason = clean_text(final.stop_reason, STOP_REASON_MAX) if final.stop_reason else None
        values: dict[str, Any] = {
            **_logged_totals(run_id),
            "status": final.status,
            "stop_reason": stop_reason,
            "error": clean_text(final.error, 4000) if final.error else None,
            "error_id": clean_text(final.error_id, ERROR_ID_MAX) if final.error_id else None,
            "finished_at": func.now(),
        }
        if counts is not None:
            values["counts"] = counts.model_dump(mode="json")
        statement = update(Run).where(Run.id == run_id)
        if only_from is not None:
            statement = statement.where(Run.status.in_(only_from))
        row = (
            await session.execute(statement.values(**values).returning(Run.cost_usd, Run.counts))
        ).one_or_none()
        if row is None:
            return None
        return RunFinishedData(
            status=final.status,
            stop_reason=stop_reason,
            cost_usd=row.cost_usd,
            counts=RunCounts.model_validate(row.counts),
        )

    # --- Cancel ---------------------------------------------------------------------------

    async def cancel(self, run_id: UUID) -> RunOut:
        """Stops a run. A run that is already over (or already stopping) is returned as it is.
        Raises Problem 404 for an unknown id."""
        row = await self._row(run_id)
        entry = self._active.get(run_id)
        if entry is None:
            return RunOut.model_validate(row)
        task = await self._task_of(entry)
        if task is None:
            return await self._out(run_id)
        await entry.started.wait()  # the task has begun, so its `finally` will run
        if not entry.cancel_requested:
            entry.cancel_requested = True
            entry.cancelled.set()
            if not entry.task_cancelled:
                entry.task_cancelled = True
                task.cancel()
            await self._record_cancel_request(run_id)
        await asyncio.wait({task}, timeout=CANCEL_WAIT_SECONDS)  # never awaits the task itself
        return await self._out(run_id)

    @staticmethod
    async def _task_of(entry: _Entry) -> "asyncio.Task[None] | None":
        """The run's task. A run that has a slot but is still being saved has none for a moment."""
        for _ in range(200):
            if entry.task is not None:
                return entry.task
            await asyncio.sleep(0.05)
        return None

    async def _record_cancel_request(self, run_id: UUID) -> None:
        try:
            async with self.session_factory() as session:
                await session.execute(
                    update(Run)
                    .where(Run.id == run_id, Run.cancel_requested_at.is_(None))
                    .values(cancel_requested_at=func.now())
                )
                await session.commit()
        except Exception as error:  # stopping the spend matters more than the timestamp
            log.warning(
                "cancel_time_not_saved",
                extra={"run_id": str(run_id), "reason": type(error).__name__},
            )

    # --- Resume ---------------------------------------------------------------------------

    async def resume(self, run_id: UUID) -> RunOut:
        """Continues an interrupted or failed run. Raises Problem 409 `run_not_resumable`
        (also past the cap or after 3 resumes). A run that is already going is returned as it is."""
        self._check_open()
        row = await self._row(run_id)
        if run_id in self._active:
            return RunOut.model_validate(row)
        if row.status not in ("interrupted", "failed"):
            raise self._not_resumable(
                f"A run that is {row.status} can't be resumed. "
                "Only an interrupted or failed run can."
            )
        kind = self.kinds.get((row.app, row.mode))
        if kind is None:
            raise self._not_resumable("This kind of run isn't available any more.")
        try:
            model = kind.params_model.model_validate(row.params)
        except ValidationError:
            raise self._not_resumable("The settings this run saved are no longer valid.") from None
        settings = await self._settings()
        counts = RunCounts.model_validate(row.counts)
        if counts.resumes >= MAX_RESUMES:
            raise self._not_resumable(
                f"This run was already resumed {MAX_RESUMES} times. Start a new run instead."
            )
        caps = _lowest(RunCaps.model_validate(row.caps), make_caps(settings))
        if row.cost_usd >= caps.run_cap_usd:
            raise self._not_resumable("This run has already spent its limit. Start a new run.")
        if kind.check is not None:
            kind.check(model, settings, caps)
        saver = await self._saver()

        # One step, with no await in it.
        self._check_open()
        if run_id in self._active:  # a second resume at the same time: the first one wins
            return await self._out(run_id)
        if len(self._active) >= settings.max_concurrent_runs:
            raise Problem(
                409,
                "A run is already going",
                "Wait for it to finish, or stop it, then resume this one.",
                code="run_already_active",
                run_id=str(next(iter(self._active))),
            )
        entry = _Entry(run_id=run_id, app=row.app, mode=row.mode)
        self._active[run_id] = entry

        job = _Job(
            kind=kind,
            params=model,
            settings=settings,
            caps=caps,
            versions=RunVersions(rules=row.rules_version, prompts=row.prompt_versions),
            counts=counts,
            saver=saver,
            resume=True,
            from_status=row.status,
        )
        launch = asyncio.ensure_future(self._reopen(entry, job))
        self._launching.add(launch)
        launch.add_done_callback(self._launching.discard)
        return await asyncio.shield(launch)

    @staticmethod
    def _not_resumable(detail: str) -> Problem:
        return Problem(409, "This run can't be resumed", detail, code="run_not_resumable")

    async def _reopen(self, entry: _Entry, job: _Job) -> RunOut:
        """The compare-and-set that turns an interrupted or failed run back into `queued`, then
        the task. Nothing else may do it first: only one caller's UPDATE finds the row."""
        run_id = entry.run_id
        try:
            with _database_errors():
                async with self.session_factory() as session:
                    changed = (
                        await session.execute(
                            text(
                                f"UPDATE {CORE_SCHEMA}.runs SET status = 'queued', "
                                "stop_reason = NULL, error = NULL, error_id = NULL, "
                                "finished_at = NULL, cancel_requested_at = NULL, "
                                "counts = jsonb_set(counts, '{resumes}', "
                                "to_jsonb(COALESCE((counts->>'resumes')::int, 0) + 1), true) "
                                "WHERE id = :id AND status IN ('interrupted', 'failed') "
                                "RETURNING id"
                            ),
                            {"id": run_id},
                        )
                    ).first()
                    await session.commit()
                    row = (
                        await session.get(Run, run_id, populate_existing=True) if changed else None
                    )
                    out = RunOut.model_validate(row) if row is not None else None
        except BaseException:
            self._release(entry)
            raise
        if out is None:
            self._release(entry)
            raise self._not_resumable("Another request already changed this run.")
        job = _Job(
            kind=job.kind,
            params=job.params,
            settings=job.settings,
            caps=job.caps,
            versions=job.versions,
            counts=out.counts,
            saver=job.saver,
            resume=True,
            from_status=job.from_status,
        )
        self._launch(entry, job)
        return out

    # --- Recover and shut down ------------------------------------------------------------

    async def recover(self) -> int:
        """Marks runs left `queued` or `running` by a dead process as `interrupted`.
        Returns how many. Call it once at start-up, after the advisory lock is taken."""
        with _database_errors():
            async with self.session_factory() as session:
                ids = list(
                    await session.scalars(
                        select(Run.id)
                        .where(Run.status.in_(("queued", "running")))
                        .order_by(Run.created_at)
                    )
                )
        recovered = 0
        final = _Final("interrupted", BACKEND_STOPPED)
        for run_id in ids:
            if run_id in self._active:
                continue

            async def build(session: AsyncSession, run_id: UUID = run_id) -> BaseModel | None:
                return await self._write_final(
                    session, run_id, final, None, only_from=("queued", "running")
                )

            with _database_errors():
                event = await self.events.emit_in_transaction(run_id, "run_finished", build)
            if event is not None:
                recovered += 1
                log.info("run_recovered", extra={"run_id": str(run_id)})
        return recovered

    async def shutdown(self) -> None:
        """Stops active runs (they end `interrupted`), waits up to 10 s, closes the checkpoint
        pool, and lets the advisory lock go. Safe to call twice."""
        self._closing = True
        if self._launching:  # a run that was being saved still gets its task
            await asyncio.wait(set(self._launching), timeout=SHUTDOWN_WAIT_SECONDS)
        entries = list(self._active.values())
        tasks: set[asyncio.Task[None]] = set()
        for entry in entries:
            entry.shutting_down = True
            task = await self._task_of(entry)
            if task is None:
                continue
            tasks.add(task)
            await entry.started.wait()
            if not entry.task_cancelled:
                entry.task_cancelled = True
                task.cancel()
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=SHUTDOWN_WAIT_SECONDS)
            if pending:
                log.warning("runs_still_stopping", extra={"count": len(pending)})
        self.events.close()
        try:
            await self.checkpointer_source.close(CHECKPOINT_CLOSE_SECONDS)
        except Exception as error:
            log.warning("checkpoint_close_failed", extra={"reason": type(error).__name__})
        if self.release_lock is not None:
            try:
                await self.release_lock()
            except Exception as error:
                log.warning("backend_lock_not_released", extra={"reason": type(error).__name__})

    # --- Watching (B1a) -------------------------------------------------------------------

    async def subscribe(self, run_id: UUID, after_seq: int = 0) -> EventStream:
        """Registers a watcher and returns its stream: the saved events after `after_seq`, then
        the live ones, until the run is over.

        It is a coroutine on purpose. The checks and the registration happen when it is awaited,
        before the response starts, so the failures can still be sent as problem answers:
        Problem 404 for an unknown id, and 429 when there are too many watchers (10 for one run,
        50 in all). It takes the run's event lock to read the saved tail and to register the
        queue in one step, so no event is lost or repeated.

        The events route does, in this order:
            if await manager.stream_is_over(run_id, after):   # nothing left to say
                return Response(status_code=204)
            stream = await manager.subscribe(run_id, after)   # 404 or 429 raised here
            # build the EventSourceResponse over `stream`, and call `await stream.aclose()` in
            # its `finally`, also when the client has gone before the first event.
        """
        with _database_errors():
            return await self.events.subscribe(run_id, after_seq)

    async def stream_is_over(self, run_id: UUID, after_seq: int) -> bool:
        """True when the run is over and has no event after `after_seq`. The events route
        then answers 204, so the browser's EventSource stops trying again. Raises Problem
        404 for an unknown id."""
        with _database_errors():
            state = await self.events.run_state(run_id)
        if state is None:
            raise Problem(404, "Run not found", "There is no run with this id.")
        status, last_seq = state
        if self.is_active(run_id):
            return False
        return status in TERMINAL_RUN_STATUSES and after_seq >= last_seq

    # --- Reading (B1b; these only call reads.py and estimate.py) --------------------------

    async def get_run(self, run_id: UUID) -> RunOut:
        """One run. Raises Problem 404 for an unknown id."""
        return await reads.get_run(self.session_factory, run_id)

    async def list_runs(
        self,
        *,
        app: str | None = None,
        mode: str | None = None,
        status: Sequence[RunStatus] | None = None,
        since: date | None = None,
        until: date | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> RunPage:
        """Runs, newest first. `since` and `until` are Australia/Melbourne dates, both included."""
        return await reads.list_runs(
            self.session_factory,
            app=app,
            mode=mode,
            status=status,
            since=since,
            until=until,
            limit=limit,
            offset=offset,
        )

    async def event_log(self, run_id: UUID, after: int = 0, limit: int = 200) -> EventLog:
        """The stored events after seq `after`, oldest first. Raises Problem 404 if unknown."""
        return await reads.event_log(self.session_factory, run_id, after, limit)

    async def summary(self, since: date | None = None) -> RunSummary:
        """Cost and run counts by day, from `since` (default: 30 days ago). Days are
        Australia/Melbourne dates."""
        return await reads.summary(self.session_factory, since)

    async def estimate(self, body: RunCreate) -> RunEstimate:
        """What a run would cost. Never starts a run. An invalid body is `valid: false`, not an
        error. Raises Problem 404 only for an unknown app or mode."""
        return await estimate_run(
            body,
            kinds=self.kinds,
            session_factory=self.session_factory,
            settings_provider=self.settings_provider,
        )
