"""Loads the projects listed in settings. Each project lives in apps/<name>/ and defines APP.

The core finds projects by name only, so it never imports from `apps` directly.
"""

import importlib
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter

from core.hubspot.needs import HubSpotNeeds

if TYPE_CHECKING:
    # Only for the type. Importing it would load the Claude client into every migration.
    from core.runs.types import RunKind
    from core.schedules.jobs import JobSpec


@dataclass(frozen=True)
class AppSpec:
    """What a project tells the core about itself."""

    name: str  # folder name, like "lead_finder"
    title: str  # shown in Swagger, like "Lead Finder"
    route_prefix: str  # endpoint prefix under /api/v1, like "/lead-finder"
    db_schema: str  # its own database schema, like "lead_finder"
    router: APIRouter
    check_rules: Callable[[], object]  # loads and checks the rules files; raises if one is wrong
    tables_module: str | None = None  # the module that defines its tables, for migrations
    run_kinds: "tuple[RunKind[Any], ...]" = ()  # the kinds of run it offers, like discovery
    # The HubSpot scopes it reads and writes with (PLAN-V5 B3). None: it doesn't use HubSpot.
    hubspot_needs: HubSpotNeeds | None = None
    # Called with (session, WriteOut) after one of its HubSpot writes is done (PLAN-V5 B5), like
    # the Lead Finder marking the lead as sent. The core's writer calls it, whichever route wrote.
    hubspot_written: Callable[[Any, Any], Awaitable[None]] | None = None
    # What it offers to start on a schedule (PLAN-V6 D1), like the Lead Finder's discovery run.
    jobs: "tuple[JobSpec, ...]" = ()


def load_apps(names: Sequence[str]) -> list[AppSpec]:
    specs: list[AppSpec] = []
    for name in names:
        module = importlib.import_module(f"apps.{name}.app")
        spec = getattr(module, "APP", None)
        if not isinstance(spec, AppSpec):
            raise RuntimeError(f"apps/{name}/app.py must define APP = AppSpec(...)")
        if spec.name != name:
            raise RuntimeError(f"apps/{name}/app.py gives its name as {spec.name!r}")
        specs.append(spec)
    return specs


def import_app_tables(specs: Sequence[AppSpec]) -> None:
    """Imports each project's tables, so migrations can see them."""
    for spec in specs:
        if spec.tables_module:
            importlib.import_module(spec.tables_module)
