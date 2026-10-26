"""The run manager: starts runs, watches them, stops them and brings them back.

This file is the skeleton. It fixes the constructor and every public method. Two packages fill
it in, and each owns its own part so they never edit the same lines:
- B1a writes the bodies marked "B1a" below: start, cancel, resume, recover, shutdown, subscribe
  and stream_is_over.
- B1b writes `core/runs/reads.py` and `core/runs/estimate.py`. The reading methods at the end of
  this class (get_run, list_runs, event_log, summary, estimate) only call them, and B1a leaves
  those lines as they are.

One manager lives in each process, in `app.state.run_manager`. It is built from what it needs
(a session factory, the embedder, a Claude provider, the checkpoint source, a settings provider
and the run kinds) and never reaches for the database engine or the Claude client by itself, so
tests can build one with fakes.

How it behaves, in short (section 4 of the design has the details):
- `start` checks the body, the caps and the Idempotency-Key, then takes a slot in one step with
  no await, so two requests at once can't both get the last slot.
- `cancel` asks the task to stop once, and the run ends `cancelled`.
- `resume` continues an `interrupted` or `failed` run from its checkpoint.
- `recover` runs once at start-up and marks runs the last process left going as `interrupted`.
- `subscribe` replays the events after a number, then follows live ones.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.apps import AppSpec
from core.memory.embedder import Embedder
from core.runs import reads
from core.runs.estimate import estimate_run
from core.runs.schemas import (
    EventLog,
    RunCreate,
    RunEstimate,
    RunOut,
    RunPage,
    RunStatus,
    RunSummary,
)
from core.runs.types import (
    CheckpointerSource,
    ClaudeProvider,
    EventStream,
    KindKey,
    RunKind,
    SettingsProvider,
)


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
    ) -> None:
        """`acquire_lock` tries the Postgres advisory lock that keeps a second backend from
        running on the same database (True when taken). `release_lock` lets it go. Both are
        hooks so a test can pass fakes, or nothing."""
        self.session_factory = session_factory
        self.embedder = embedder
        self.claude_provider = claude_provider
        self.checkpointer_source = checkpointer_source
        self.settings_provider = settings_provider
        self.kinds = dict(kinds)
        self.acquire_lock = acquire_lock
        self.release_lock = release_lock

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

        A repeated `idempotency_key` returns the run the first call made.

        What it takes from the kind (`core.runs.types.RunKind`), so nothing is guessed from the
        params model:
        - the caps: `make_caps(settings, kind.caps_override(params))`, saved with the run;
        - the versions: `kind.versions()`, saved in the run row (`rules_version`,
          `prompt_versions`, cut to the column sizes), put in `run_started` and in the
          `RunContext`;
        - the size check: `kind.check(params, settings, caps)`.
        A kind without a hook gets the settings' caps and empty versions.
        """
        raise NotImplementedError

    async def cancel(self, run_id: UUID) -> RunOut:
        """Stops a run. A run that is already over (or already stopping) is returned as it is.
        Raises Problem 404 for an unknown id."""
        raise NotImplementedError

    async def resume(self, run_id: UUID) -> RunOut:
        """Continues an interrupted or failed run. Raises Problem 409 `run_not_resumable`
        (also past the cap or after 3 resumes). A run that is already going is returned as it is."""
        raise NotImplementedError

    async def recover(self) -> int:
        """Marks runs left `queued` or `running` by a dead process as `interrupted`.
        Returns how many. Call it once at start-up, after the advisory lock is taken."""
        raise NotImplementedError

    async def shutdown(self) -> None:
        """Stops active runs (they end `interrupted`), waits up to 10 s, closes the checkpoint
        pool, and lets the advisory lock go."""
        raise NotImplementedError

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
        raise NotImplementedError

    async def stream_is_over(self, run_id: UUID, after_seq: int) -> bool:
        """True when the run is over and has no event after `after_seq`. The events route
        then answers 204, so the browser's EventSource stops trying again. Raises Problem 404
        for an unknown id."""
        raise NotImplementedError

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
