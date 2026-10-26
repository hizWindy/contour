"""What a run would cost, before it starts (`POST /runs/estimate`).

Like `reads.py`, this sits apart from `manager.py` so the package that builds the estimate
(B1b) and the package that builds the manager (B1a) never edit the same file.
`RunManager.estimate` only calls `estimate_run` here.

This is a stub. B1b writes the body. The steps it follows:
1. Find the kind for `(body.app, body.mode)`. Unknown: Problem 404.
2. Check `body.params` with the kind's `params_model`. Errors give `valid: false` and
   `errors` as `body.params.<field>`, never an exception.
3. Get the effective settings, then `caps = make_caps(settings, kind.caps_override(params))`
   (`core.runs.types`), the same call the manager makes at start. Then call `kind.check` and
   turn a 422 from it into `valid: false`.
4. Work out `daily_left_usd` and the unit costs (`UnitCosts`: an average of at least 5 finished
   companies or slices from history, else the defaults).
5. Call `kind.estimate(EstimateContext(...))`, which fills the slices, companies and cost range.

It never starts a run, never runs a gate and never calls Claude.
"""

from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.runs.schemas import RunCreate, RunEstimate
from core.runs.types import KindKey, RunKind, SettingsProvider


async def estimate_run(
    body: RunCreate,
    *,
    kinds: Mapping[KindKey, RunKind[Any]],
    session_factory: async_sessionmaker[AsyncSession],
    settings_provider: SettingsProvider,
) -> RunEstimate:
    """What a run would cost. An invalid body is `valid: false`, not an error. Raises
    Problem 404 only for an unknown app or mode."""
    raise NotImplementedError
