"""The fake backend for the website: the real engine on its own database, with a FakeClaude.

    uv run python -m tests.e2e.serve              # from engine/backend
    uv run python -m tests.e2e.serve --hubspot-ok # also allow the HubSpot watchlist runs

It is for clicking through the website (and for browser checks) without the real Claude:

- The database is `leadfinder_e2e`, never the dev or the test database. It is made if missing,
  migrated, and its runs, leads, searches and memory notes are wiped on every start. The HubSpot
  export (`projects/leads/research/COMPANIES.xlsx`) is loaded and the profiles are rebuilt, so
  matching and look-alikes work.
- Claude is a slow FakeClaude: every request waits a moment, so a run can be watched live. Discovery
  finds companies all named "Sample ...", spread over the three cities and the main signs, with
  every result (pass, director review, watch, drop) among them. No request leaves this computer:
  the Anthropic key is blanked before anything reads the settings.
- It serves on the usual address (127.0.0.1:8000), so the website's dev server proxies to it.
"""

import argparse
import asyncio
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI

    from tests.lead_finder.samples import FakeClaude

DATABASE = "leadfinder_e2e"
ENGINE_DIR = Path(__file__).resolve().parents[3]
EXPORT = ENGINE_DIR.parent / "projects" / "leads" / "research" / "COMPANIES.xlsx"
DELAY_SECONDS = 0.6
# Everything a run or a person made. HubSpot tables stay: they are reloaded from the export.
WIPED_TABLES = (
    "lead_finder.leads",
    "core.searches",
    "core.memory",
    "core.run_events",
    "core.runs",
    "core.settings",
)


def use_e2e_database(hubspot_ok: bool = False) -> None:
    """Points the settings at the e2e database and blanks the Claude key. Call before anything
    reads the settings."""
    os.environ["POSTGRES_DB"] = DATABASE
    os.environ["ANTHROPIC_API_KEY"] = ""
    os.environ["HUBSPOT_NAMES_TO_CLAUDE_OK"] = "true" if hubspot_ok else "false"
    from core.config import get_settings

    get_settings.cache_clear()
    if get_settings().postgres_db != DATABASE:
        raise SystemExit(f"The fake backend only runs on {DATABASE}.")


def sample_world(today: date) -> tuple[dict[tuple[str, str], list[Any]], dict[str, Any]]:
    """What discovery finds (by sign and city) and the facts of the companies that are not the
    plain "passes every rule" sample. Dates are a few days before `today`, so a 7-day run finds
    them too."""
    from tests.lead_finder.samples import candidate, fact, make_facts

    found = (today - timedelta(days=3)).isoformat()

    def sample(name: str, trigger: str, city: str, **extra: Any) -> Any:
        slug = name.lower().replace(" ", "")
        return candidate(
            name,
            trigger,
            city=city,
            website=f"{slug}.com.au",
            date=found,
            published=found,
            **extra,
        )

    scenario = {
        ("lease_ending", "Melbourne"): [
            sample("Sample Software", "lease_ending", "Melbourne"),
            sample("Sample Analytics", "lease_ending", "Melbourne"),
        ],
        ("merger_or_takeover", "Melbourne"): [
            sample("Sample Insurance Group", "merger_or_takeover", "Melbourne"),
        ],
        ("fast_growth", "Melbourne"): [sample("Sample Studio", "fast_growth", "Melbourne")],
        ("big_new_contract", "Adelaide"): [
            sample("Sample Defence Systems", "big_new_contract", "Adelaide"),
        ],
        ("lease_ending", "Adelaide"): [sample("Sample Health", "lease_ending", "Adelaide")],
        ("fast_growth", "Perth"): [sample("Sample Mining Services", "fast_growth", "Perth")],
        ("merger_or_takeover", "Perth"): [
            sample("Sample Energy", "merger_or_takeover", "Perth"),
        ],
    }

    def facts(name: str, city: str, **changes: Any) -> Any:
        slug = name.lower().replace(" ", "")
        return make_facts(
            name=name,
            website=fact(f"{slug}.com.au"),
            city=fact(city),
            summary=f"{name} is a sample company for the fake backend.",
            **changes,
        )

    company_facts = {
        # Too small: drop.
        "Sample Studio": facts(
            "Sample Studio", "Melbourne", staff_in_city=fact(30), office_m2=fact(300)
        ),
        # No sign of an office change found: watch.
        "Sample Analytics": facts("Sample Analytics", "Melbourne", triggers=[]),
        # Between the two size bands: director review.
        "Sample Health": facts(
            "Sample Health", "Adelaide", staff_in_city=fact(85), office_m2=fact(850)
        ),
        "Sample Defence Systems": facts("Sample Defence Systems", "Adelaide"),
        "Sample Mining Services": facts(
            "Sample Mining Services", "Perth", office_m2=fact(1800, label="estimated")
        ),
        "Sample Energy": facts("Sample Energy", "Perth", staff_in_city=fact(400)),
        "Sample Insurance Group": facts("Sample Insurance Group", "Melbourne"),
    }
    return scenario, company_facts


def fake_claude(today: date, delay_seconds: float = DELAY_SECONDS) -> "FakeClaude":
    from tests.lead_finder.samples import FakeClaude

    scenario, company_facts = sample_world(today)
    return FakeClaude(
        scenario=scenario,
        company_facts={name.casefold(): value for name, value in company_facts.items()},
        delay_seconds=delay_seconds,
    )


def build_app(claude: "FakeClaude") -> "FastAPI":
    """The real app, with FakeClaude for runs and for the one-company research route."""
    from core.api.app import create_app
    from core.api.deps import claude_dependency

    app = create_app()
    app.state.claude_provider = lambda: claude
    app.dependency_overrides[claude_dependency] = lambda: claude
    return app


def prepare_database() -> None:
    """Makes the e2e database if needed, migrates it and wipes what runs made."""
    import psycopg
    from psycopg import sql

    from core.cli import migrate
    from core.config import get_settings

    settings = get_settings()
    with psycopg.connect(_conninfo(settings, "postgres"), autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,)
        ).fetchone()
        if exists is None:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DATABASE)))
    migrate()
    with psycopg.connect(_conninfo(settings, DATABASE), autocommit=True) as connection:
        connection.execute(f"TRUNCATE {', '.join(WIPED_TABLES)} CASCADE")
        connection.execute("DROP SCHEMA IF EXISTS langgraph CASCADE")


def _conninfo(settings: Any, database: str) -> str:
    from psycopg.conninfo import make_conninfo

    return make_conninfo(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_password.get_secret_value(),
        dbname=database,
        connect_timeout=5,
    )


async def load_hubspot() -> str:
    """Loads the HubSpot export and rebuilds the company profiles."""
    from core.db.engine import get_engine, get_sessionmaker
    from core.hubspot.importer import read_export
    from core.hubspot.profiles import rebuild_profiles
    from core.hubspot.service import save_export
    from core.memory.embedder import get_embedder

    if not EXPORT.exists():
        return f"No HubSpot export at {EXPORT}: matching and look-alikes will be empty."
    export = await asyncio.to_thread(read_export, EXPORT)
    try:
        async with get_sessionmaker()() as session:
            result = await save_export(session, export)
        async with get_sessionmaker()() as session:
            profiles = await rebuild_profiles(session, get_embedder())
    finally:
        await get_engine().dispose()
    return f"Loaded {result.companies} HubSpot companies and {profiles} profiles."


async def serve(app: "FastAPI") -> None:
    import uvicorn

    from core.config import get_settings

    settings = get_settings()
    config = uvicorn.Config(
        app, host="127.0.0.1", port=settings.api_port, log_config=None, ws="none"
    )
    await uvicorn.Server(config).serve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="The fake backend for the website.")
    parser.add_argument(
        "--hubspot-ok",
        action="store_true",
        help="Allow HubSpot watchlist runs (the names only reach the FakeClaude).",
    )
    args = parser.parse_args(argv)
    use_e2e_database(hubspot_ok=args.hubspot_ok)

    from core.runtime import loop_factory

    prepare_database()
    print(asyncio.run(load_hubspot(), loop_factory=loop_factory()), file=sys.stderr)
    app = build_app(fake_claude(date.today()))
    print(f"Fake backend on http://127.0.0.1:8000 (database {DATABASE}).", file=sys.stderr)
    asyncio.run(serve(app), loop_factory=loop_factory())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
