"""Start-up and shut-down of the run engine. The app's lifespan calls these two functions.

They are stubs for now and do nothing, so the app starts without a run manager and the run
routes answer 501. Package B1a fills them in:
- `startup`: take the Postgres advisory lock (refuse to start if another backend has it), build
  the manager into `app.state.run_manager`, then `recover()`.
- `shutdown`: `manager.shutdown()`, which stops active runs and closes the checkpoint pool.
"""

from fastapi import FastAPI

from core.runs.manager import RunManager


def build(app: FastAPI) -> RunManager:
    """Builds the run manager from the engine's real parts (database, embedder, Claude)."""
    raise NotImplementedError


async def startup(app: FastAPI) -> None:
    """Called once when the app starts. Does nothing yet."""


async def shutdown(app: FastAPI) -> None:
    """Called once when the app stops. Does nothing yet."""
