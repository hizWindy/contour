"""The `engine` command: serve, migrate and import-hubspot.

Run it with `uv run engine <command>` from engine/backend.
"""

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy.exc import OperationalError

from core.config import BACKEND_DIR, get_settings
from core.logs import setup_logging
from core.runtime import loop_factory

DATABASE_DOWN = "The database isn't running. Start it from engine/ with: docker compose up -d"


def migrate() -> None:
    """Applies any new database changes."""
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["skip_logging_config"] = True  # keep our structured logs
    command.upgrade(config, "head")


def serve(reload: bool = False) -> None:
    """Starts the backend on the selector event loop (see core/runtime.py)."""
    import uvicorn

    settings = get_settings()
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
        )
        return
    config = uvicorn.Config(
        target, factory=True, host=settings.api_host, port=settings.api_port, log_config=None
    )
    asyncio.run(uvicorn.Server(config).serve(), loop_factory=loop_factory())


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


def main(argv: Sequence[str] | None = None) -> int:
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

    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            serve(reload=args.reload)
        elif args.command == "migrate":
            migrate()
            print("The database is up to date.")
        elif args.command == "import-hubspot":
            if not args.path.is_file():
                print(f"File not found: {args.path}", file=sys.stderr)
                return 1
            print(asyncio.run(_import_hubspot(args.path), loop_factory=loop_factory()))
    except OperationalError:
        print(DATABASE_DOWN, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
