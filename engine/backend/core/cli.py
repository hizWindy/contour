"""The `engine` command: serve, migrate, import-hubspot, hubspot-check, hubspot-sync, openapi,
rebuild-profiles and purge.

Run it with `uv run engine <command>` from engine/backend.
"""

import argparse
import asyncio
import copy
import importlib
import ipaddress
import json
import sys
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from core.config import BACKEND_DIR, ENGINE_DIR, get_settings
from core.logs import setup_logging
from core.runtime import disable_tracing, loop_factory

if TYPE_CHECKING:
    from fastapi import FastAPI
    from sqlalchemy.engine import CursorResult

DATABASE_DOWN = "The database isn't running. Start it from engine/ with: docker compose up -d"
DEFAULT_OPENAPI_PATH = ENGINE_DIR / "frontend" / "openapi.json"
GRACEFUL_SHUTDOWN_SECONDS = 15  # uvicorn waits this long for open requests and streams
# Runs that can still be resumed (failed, interrupted) keep their events: a resume reads them.
PURGEABLE_STATUSES = ("done", "cancelled")


def migrate() -> None:
    """Applies any new database changes."""
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["skip_logging_config"] = True  # keep our structured logs
    command.upgrade(config, "head")


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def serve(reload: bool = False) -> int:
    """Starts the backend on the selector event loop (see core/runtime.py).

    Refuses an address that isn't this computer: the engine is not for a network.
    """
    import uvicorn

    settings = get_settings()
    if not _is_loopback(settings.api_host):
        print(
            f"The engine only runs on this computer, so api_host can't be {settings.api_host!r}. "
            "Use 127.0.0.1 in engine/.env.",
            file=sys.stderr,
        )
        return 1
    if settings.auto_migrate:
        migrate()
    target = "core.api.app:create_app"
    if reload:
        # uvicorn's reloader runs the app in a child process on the selector loop.
        uvicorn.run(
            target,
            factory=True,
            host=settings.api_host,
            port=settings.api_port,
            reload=True,
            reload_dirs=[str(BACKEND_DIR)],
            log_config=None,
            timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
        )
        return 0
    config = uvicorn.Config(
        target,
        factory=True,
        host=settings.api_host,
        port=settings.api_port,
        log_config=None,
        timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
    )
    asyncio.run(uvicorn.Server(config).serve(), loop_factory=loop_factory())
    return 0


# --- openapi -------------------------------------------------------------------------------


def website_schema(app: "FastAPI") -> dict[str, Any]:
    """The OpenAPI schema as the website's file has it: paths WITHOUT the `/api/v1` prefix, and
    `servers` saying `/api/v1`.

    The website's client is made with the base address `/api/v1` and calls paths like `/runs`
    (see src/test/relative-urls.test.ts). With the prefix left in the paths it would call
    `/api/v1/api/v1/runs`. The schema the running app serves (`/openapi.json` and Swagger) is not
    changed: Swagger needs the full paths. The app's own cached schema is copied, never edited.
    """
    from core.api.app import API_PREFIX

    schema = copy.deepcopy(app.openapi())
    paths: dict[str, Any] = {}
    for path, item in schema["paths"].items():
        if not path.startswith(f"{API_PREFIX}/"):
            raise RuntimeError(f"The path {path!r} is not under {API_PREFIX}/")
        paths[path.removeprefix(API_PREFIX)] = item
    schema["paths"] = paths
    schema["servers"] = [{"url": API_PREFIX}]
    return schema


def render_openapi(app: "FastAPI") -> str:
    """The website's OpenAPI file as text (see `website_schema`). The same app always gives the
    same bytes: keys are sorted, two-space indent, a closing line break, and the text is written
    with LF line endings."""
    return json.dumps(website_schema(app), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def write_openapi(path: Path | None = None) -> Path:
    """Writes the API contract the website's types are made from. Needs no database."""
    from core.api.app import create_app

    target = path or DEFAULT_OPENAPI_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_openapi(create_app()), encoding="utf-8", newline="\n")
    return target


# --- import-hubspot ------------------------------------------------------------------------


async def _import_hubspot(path: Path) -> str:
    from core.db.engine import get_engine, get_sessionmaker
    from core.hubspot.importer import read_export
    from core.hubspot.service import save_export

    export = await asyncio.to_thread(read_export, path)
    try:
        async with get_sessionmaker()() as session:
            result = await save_export(session, export)
    finally:
        await get_engine().dispose()
    skipped = (
        f" Skipped sheets: {', '.join(result.skipped_sheets)}." if result.skipped_sheets else ""
    )
    return (
        f"Loaded {result.companies} companies, {result.offices} offices and {result.deals} deals. "
        f"Skipped rows: {result.skipped_rows}.{skipped}"
    )


# --- hubspot-check and hubspot-sync --------------------------------------------------------


STATE_MARKS = {"yes": "yes", "no": "NO ", "unknown": "?  "}


async def _hubspot_check() -> tuple[str, bool]:
    """Which permissions the HubSpot key has, and what each project can do. Free, read only."""
    from core.apps import load_apps
    from core.hubspot.check import check_connection
    from core.hubspot.client import get_hubspot
    from core.hubspot.connection import project_readiness

    settings = get_settings()
    client = get_hubspot(settings)
    try:
        check = await check_connection(client)
    finally:
        if client is not None:
            await client.aclose()
    lines = [
        f"Key: {'set' if check.key_set else 'missing'}. "
        f"API version: {settings.hubspot_api_version}. "
        f"Writing: {'on' if settings.hubspot_write_enabled else 'off'} (HUBSPOT_WRITE_ENABLED).",
    ]
    if check.problem:
        lines.append(f"Not connected: {check.problem}")
    else:
        lines.append(f"Connected to HubSpot account {check.portal_id}.")
    lines.append("Permissions:")
    for scope in check.scopes:
        detail = f"  ({scope.detail})" if scope.state != "yes" and scope.detail else ""
        lines.append(f"  {STATE_MARKS[scope.state]} {scope.scope}: {scope.label}{detail}")
    lines.append("Projects:")
    for project in project_readiness(load_apps(settings.apps), check, settings):
        lines.append(f"  {project.summary}")
    return "\n".join(lines), check.connected


async def _hubspot_sync(mode: str) -> tuple[str, bool]:
    """One sync, here and now. Free: it only reads HubSpot."""
    from core.db.engine import get_engine, get_sessionmaker
    from core.hubspot.client import get_hubspot
    from core.hubspot.sync import SyncAlreadyRunning, begin, run
    from core.memory.embedder import get_embedder

    settings = get_settings()
    client = get_hubspot(settings)
    if client is None:
        return "HUBSPOT_SERVICE_KEY is not set in engine/.env.", False
    try:
        sessions = get_sessionmaker()
        try:
            plan = await begin(sessions, trigger="command", mode=mode, settings=settings)  # type: ignore[arg-type]
        except SyncAlreadyRunning as error:
            return f"Sync {error.sync_id} is already running. Wait for it to finish.", False
        print(f"Sync {plan.id} started: a {plan.mode} sync. It reads HubSpot, then saves.")
        out = await run(plan, sessions=sessions, hubspot=client, embedder=get_embedder())
    finally:
        await client.aclose()
        await get_engine().dispose()
    lines = [
        f"Sync {out.id} {out.status} ({out.mode}).",
        f"Read {out.companies_read} companies, {out.deals_read} deals, {out.owners_read} owners.",
        f"Saved {out.companies_saved} companies, {out.offices_saved} offices, "
        f"{out.deals_saved} deals ({out.deals_skipped} deals left out).",
        f"Removed {out.companies_removed} companies and {out.deals_removed} deals HubSpot no "
        f"longer has. Rebuilt {out.profiles_rebuilt} company profiles.",
    ]
    if out.error:
        lines.append(f"Error: {out.error}")
    lines += [f"Warning: {warning}" for warning in out.warnings]
    return "\n".join(lines), out.status == "done"


# --- rebuild-profiles ----------------------------------------------------------------------


async def _rebuild_profiles() -> str | None:
    """Rebuilds the HubSpot company profiles in memory. None if that isn't built yet."""
    try:
        profiles = importlib.import_module("core.hubspot.profiles")
    except ModuleNotFoundError as error:
        if error.name != "core.hubspot.profiles":
            raise
        return None
    from core.db.engine import get_engine, get_sessionmaker
    from core.memory.embedder import get_embedder

    try:
        async with get_sessionmaker()() as session:
            count: Any = await profiles.rebuild_profiles(session, get_embedder())
    finally:
        await get_engine().dispose()
    return f"Rebuilt {count} HubSpot company profiles." if isinstance(count, int) else "Done."


# --- purge ---------------------------------------------------------------------------------


async def _purge(days: int) -> str:
    """Deletes the saved events of runs that finished more than `days` days ago."""
    from sqlalchemy import delete, select

    from core.db.engine import get_engine, get_sessionmaker
    from core.runs.models import Run, RunEvent

    cutoff = datetime.now(UTC) - timedelta(days=days)
    old_runs = select(Run.id).where(Run.status.in_(PURGEABLE_STATUSES), Run.finished_at < cutoff)
    try:
        async with get_sessionmaker()() as session:
            result = await session.execute(delete(RunEvent).where(RunEvent.run_id.in_(old_runs)))
            await session.commit()
    finally:
        await get_engine().dispose()
    deleted = cast("CursorResult[Any]", result).rowcount
    return (
        f"Deleted {deleted} saved events of runs that finished more than {days} days ago. "
        "The runs, their leads and the search log are kept."
    )


def _positive_days(text: str) -> int:
    try:
        days = int(text)
    except ValueError:
        days = 0
    if days < 1:
        raise argparse.ArgumentTypeError("use a whole number of days, 1 or more")
    return days


def _describe_settings_error(error: ValidationError) -> str:
    """The setting names and what is wrong with them. Never the values: they may be secrets."""
    lines = [
        f"  {'.'.join(str(part) for part in item['loc']) or 'settings'}: {item['msg']}"
        for item in error.errors(include_input=False, include_url=False)
    ]
    return "The settings in engine/.env aren't valid:\n" + "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    disable_tracing()  # first: prompts and answers must never reach LangSmith
    setup_logging()
    parser = argparse.ArgumentParser(prog="engine", description="Contour engine commands.")
    commands = parser.add_subparsers(dest="command", required=True)

    serve_cmd = commands.add_parser(
        "serve", help="Start the backend (applies database changes first)."
    )
    serve_cmd.add_argument("--reload", action="store_true", help="Restart when the code changes.")
    commands.add_parser("migrate", help="Apply database changes.")
    import_cmd = commands.add_parser("import-hubspot", help="Load a HubSpot export file (.xlsx).")
    import_cmd.add_argument("path", type=Path, help="Path to the .xlsx file")
    commands.add_parser(
        "hubspot-check",
        help="Which permissions the HubSpot key has, and what each project can do (free).",
    )
    sync_cmd = commands.add_parser(
        "hubspot-sync", help="Copy HubSpot's companies, offices, deals and owners (free)."
    )
    which = sync_cmd.add_mutually_exclusive_group()
    which.add_argument("--full", action="store_true", help="Read everything (finds deletions).")
    which.add_argument("--changes", action="store_true", help="Read only what changed.")
    openapi_cmd = commands.add_parser(
        "openapi",
        help=(
            "Write the API contract (openapi.json) the website's types come from. "
            "Its paths are relative to /api/v1, the website client's base address."
        ),
    )
    openapi_cmd.add_argument(
        "path",
        nargs="?",
        type=Path,
        help=f"Where to write it. Default: {DEFAULT_OPENAPI_PATH}",
    )
    commands.add_parser("rebuild-profiles", help="Rebuild the HubSpot company profiles in memory.")
    purge_cmd = commands.add_parser(
        "purge", help="Delete the saved events of old finished runs. The runs are kept."
    )
    purge_cmd.add_argument(
        "--older-than-days",
        type=_positive_days,
        required=True,
        help="Only runs that finished more than this many days ago",
    )

    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            return serve(reload=args.reload)
        if args.command == "migrate":
            migrate()
            print("The database is up to date.")
        elif args.command == "import-hubspot":
            if not args.path.is_file():
                print(f"File not found: {args.path}", file=sys.stderr)
                return 1
            print(asyncio.run(_import_hubspot(args.path), loop_factory=loop_factory()))
        elif args.command == "hubspot-check":
            text, ok = asyncio.run(_hubspot_check(), loop_factory=loop_factory())
            print(text)
            return 0 if ok else 1
        elif args.command == "hubspot-sync":
            mode = "full" if args.full else "changes" if args.changes else "auto"
            text, ok = asyncio.run(_hubspot_sync(mode), loop_factory=loop_factory())
            print(text)
            return 0 if ok else 1
        elif args.command == "openapi":
            print(f"Wrote {write_openapi(args.path)}")
        elif args.command == "rebuild-profiles":
            message = asyncio.run(_rebuild_profiles(), loop_factory=loop_factory())
            if message is None:
                print("Rebuilding profiles isn't built yet.", file=sys.stderr)
                return 1
            print(message)
        elif args.command == "purge":
            print(asyncio.run(_purge(args.older_than_days), loop_factory=loop_factory()))
    except OperationalError:
        print(DATABASE_DOWN, file=sys.stderr)
        return 1
    except ValidationError as error:
        print(_describe_settings_error(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
