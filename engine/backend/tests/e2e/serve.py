"""The fake backend for the website: the real engine on its own database, with a FakeClaude.

    uv run python -m tests.e2e.serve              # from engine/backend
    uv run python -m tests.e2e.serve --hubspot-ok # also allow the HubSpot watchlist runs
    uv run python -m tests.e2e.serve --auth       # sign-in on, with a demo Admin (PLAN-V6)
    uv run python -m tests.e2e.serve --perf       # the big database, kept as it is (PLAN-V7)

It is for clicking through the website (and for browser checks) without the real Claude:

- The database is `leadfinder_e2e`, never the dev or the test database. It is made if missing,
  migrated, and its runs, leads, searches and memory notes are wiped on every start. The HubSpot
  export (`projects/leads/research/COMPANIES.xlsx`) is loaded and the profiles are rebuilt, so
  matching and look-alikes work.
- Claude is a slow FakeClaude: every request waits a moment, so a run can be watched live. Discovery
  finds companies all named "Sample ...", spread over the three cities and the main signs, with
  every result (pass, director review, watch, drop) among them. No request leaves this computer:
  the Anthropic and Signal Hire keys are blanked before anything reads the settings.
- One lead, "Sample Headcount", is added at start. A fake Signal Hire gives it company details,
  senior people and a staff number that is far from the research's own (a conflict), so the lead
  card's Signal Hire parts, its source labels and its flag can be seen without a key.
- Sign-in is OFF, whatever engine/.env says, so the website works as it always has. `--auth` turns
  it on (`AUTH_REQUIRED=true`) and makes a demo Admin, `demo@example.test` (or `demo`), with a new
  random password printed once when it starts. The sign-in tables are wiped on every start, so the
  account and its sessions are new each time. This is how the login page is tried in a browser.
- `--perf` serves `leadfinder_perf` as it is: nothing is wiped and nothing is seeded, so the
  10,000 fake leads that `python -m tests.e2e.perf_seed` made stay (PLAN-V7 A2). Sign-in is off.
- It serves on `API_PORT` (the usual 127.0.0.1:8000), so the website's dev server proxies to it.
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
PERF_DATABASE = "leadfinder_perf"  # PLAN-V7: 10,000 fake leads, for timing the website
ENGINE_DIR = Path(__file__).resolve().parents[3]
EXPORT = ENGINE_DIR.parent / "projects" / "leads" / "research" / "COMPANIES.xlsx"
DELAY_SECONDS = 0.6
# Everything a run or a person made. HubSpot tables stay: they are reloaded from the export.
WIPED_TABLES = (
    "core.audit_log",
    "core.sessions",
    "core.users",
    "lead_finder.leads",
    "lead_finder.signalhire_details",
    "core.searches",
    "core.memory",
    "core.run_events",
    "core.runs",
    "core.settings",
    "core.hubspot_writes",
    "core.hubspot_syncs",
)


# Every environment name `use_e2e_database` sets, so a test can put them all back.
E2E_ENV_NAMES = (
    "POSTGRES_DB",
    "ANTHROPIC_API_KEY",
    "SIGNALHIRE_API_KEY",
    "HUBSPOT_SERVICE_KEY",
    "HUBSPOT_NAMES_TO_CLAUDE_OK",
    "HUBSPOT_WRITE_ENABLED",
    "HUBSPOT_SYNC_MAX_AGE_HOURS",
    "AUTH_REQUIRED",
    "SESSION_COOKIE_SECURE",
)
DEMO_EMAIL = "demo@example.test"
DEMO_USERNAME = "demo"
DEMO_WORDS = (
    "maple", "river", "lantern", "copper", "orchard", "whisper", "meadow", "harvest",
    "quiet", "thunder", "velvet", "granite", "willow", "ember", "harbour", "cobalt",
)  # fmt: skip


def use_e2e_database(
    hubspot_ok: bool = False, auth: bool = False, database: str = DATABASE
) -> None:
    """Points the settings at the e2e database (or the perf one) and blanks the Claude, Signal
    Hire and HubSpot keys, so no run can reach them, whatever engine/.env holds. Sign-in is off
    unless `auth`, and never Secure (the fake backend is plain http). Call before anything reads
    the settings."""
    os.environ["POSTGRES_DB"] = database
    os.environ["AUTH_REQUIRED"] = "true" if auth else "false"
    os.environ["SESSION_COOKIE_SECURE"] = "false"
    os.environ["ANTHROPIC_API_KEY"] = ""
    os.environ["SIGNALHIRE_API_KEY"] = ""
    os.environ["HUBSPOT_SERVICE_KEY"] = ""
    os.environ["HUBSPOT_NAMES_TO_CLAUDE_OK"] = "true" if hubspot_ok else "false"
    # HubSpot is the fake one below (`fake_hubspot`): the real client is never made, so writing
    # can be on and a send can be tried in the browser. Nothing at start syncs by itself.
    os.environ["HUBSPOT_WRITE_ENABLED"] = "true"
    os.environ["HUBSPOT_SYNC_MAX_AGE_HOURS"] = "0"
    from core.config import get_settings

    get_settings.cache_clear()
    if get_settings().postgres_db != database:
        raise SystemExit(f"The fake backend only runs on {database}.")


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


def fake_hubspot() -> Any:
    """A fake HubSpot holding the export's companies, offices and deals, with every permission,
    so the connection page, "Sync now" and "Send to HubSpot" all work without touching the real
    one. A sync from it gives the same copy as the export upload."""
    from collections import defaultdict

    from core.hubspot.client import Owner
    from core.hubspot.importer import read_export
    from core.hubspot.mapping import load_field_map
    from tests.core.hubspot_fake import SALES, FakeHubSpot

    fake = FakeHubSpot()
    fake.grant_writes()
    fake.owners_active = [Owner("1", "Sample Owner", False)]
    if not EXPORT.is_file():
        return fake
    export = read_export(EXPORT)
    groups = {office.label: office.fields for office in load_field_map().offices}
    offices: dict[str, list[Any]] = defaultdict(list)
    for office in export.offices:
        offices[office.hubspot_company_id].append(office)
    for company in export.companies:
        properties: dict[str, str | None] = {
            "name": company.name,
            "domain": company.domain,
            "website": company.website,
            "city": company.city,
            "state": company.state_raw,
            "industry": company.industry,
            "numberofemployees": str(company.employees) if company.employees else None,
        }
        for office in offices[company.hubspot_id]:
            fields = groups.get(office.label, {})
            for column in ("city", "street", "level", "postal_code", "phone"):
                if column in fields:
                    properties[fields[column]] = getattr(office, column)
            if "linkedin_staff" in fields and office.linkedin_staff is not None:
                properties[fields["linkedin_staff"]] = str(office.linkedin_staff)
        fake.add_company(company.hubspot_id, **properties)
    stages = {stage.label.casefold(): stage.id for stage in SALES.stages}
    for deal in export.deals:
        fake.add_deal(
            deal.hubspot_deal_id,
            deal.hubspot_company_id,
            dealname=deal.name,
            dealstage=stages.get((deal.stage or "").casefold()),
            pipeline="default",
        )
    return fake


def build_app(claude: "FakeClaude") -> "FastAPI":
    """The real app, with FakeClaude for runs and for the one-company research route, and the
    fake HubSpot for the connection page and sends."""
    from core.api.app import create_app
    from core.api.deps import claude_dependency

    app = create_app()
    app.state.claude_provider = lambda: claude
    app.dependency_overrides[claude_dependency] = lambda: claude
    hubspot = fake_hubspot()
    app.state.hubspot_provider = lambda: hubspot
    return app


def prepare_database(database: str = DATABASE) -> None:
    """Makes the e2e database if needed, migrates it and wipes what runs made."""
    import psycopg
    from psycopg import sql

    from core.cli import migrate
    from core.config import get_settings

    settings = get_settings()
    with psycopg.connect(_conninfo(settings, "postgres"), autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (database,)
        ).fetchone()
        if exists is None:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
    migrate()
    with psycopg.connect(_conninfo(settings, database), autocommit=True) as connection:
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


def demo_password() -> str:
    """Four different random words with dashes: easy to type, and it passes the rules (a repeated
    word would be refused as a repeated chunk). New every start."""
    import secrets

    return "-".join(secrets.SystemRandom().sample(DEMO_WORDS, 4))


async def make_demo_admin(password: str) -> str:
    """Makes the demo Admin in the e2e database (the tables were just wiped)."""
    from datetime import UTC, datetime

    from core.auth import admin
    from core.db.engine import get_engine, get_sessionmaker

    try:
        async with get_sessionmaker()() as db:
            user = await admin.create_admin(
                db,
                email=DEMO_EMAIL,
                username=DEMO_USERNAME,
                name="Demo Admin",
                password=password,
                now=datetime.now(UTC),
            )
    finally:
        await get_engine().dispose()
    return f"Made the demo Admin {user.email} (or the username {user.username})."


SIGNALHIRE_SAMPLE = "Sample Headcount"


async def research_signalhire_sample(session: Any, embedder: Any, today: date) -> Any:
    """Researches one made-up company that a fake Signal Hire knows. Signal Hire gives it company
    details, two senior people and 285 people on file in Melbourne, about 570 staff, while the
    research found 250 on a web page: the two are far apart, so the card shows a flag. Signal Hire
    is on for this one research only, whatever the real rules say. Returns the lead card."""
    from apps.lead_finder.fields import DecisionMaker
    from apps.lead_finder.research import ResearchRequest, research_company
    from apps.lead_finder.rules import load_rules
    from core.config import get_settings
    from core.signalhire.client import CompanyInfo, CompanyRef, Office
    from tests.lead_finder.samples import (
        FakeClaude,
        FakeSignalHire,
        fact,
        make_facts,
        rules_with_signalhire,
    )

    website = "sampleheadcount.com.au"
    about = f"https://{website}/about"  # FakeClaude's notes cite the company's own site here
    facts = make_facts(
        name=SIGNALHIRE_SAMPLE,
        website=fact(website, about),
        city=fact("Melbourne"),
        staff_in_city=fact(250, about),
        office_m2=fact(None),
        local_team_runs_project=fact(True, about),
        decision_makers=[
            DecisionMaker(
                name="Jo Public", role="Chief Operating Officer", source_url=about, source_date=None
            )
        ],
        summary=f"{SIGNALHIRE_SAMPLE} is a sample company. A fake Signal Hire gives it company "
        "details, senior people and a staff number far from the research's own.",
    )
    claude = FakeClaude(company_facts={SIGNALHIRE_SAMPLE.casefold(): facts})
    ref = CompanyRef(id=9, slug="sample-headcount", name=SIGNALHIRE_SAMPLE)
    info = CompanyInfo(
        name=SIGNALHIRE_SAMPLE,
        website=website,
        industry="Software Development",
        staff_count=1200,
        staffing_company=False,
        linkedin_id="123456",
        offices=(
            Office("Melbourne", "Victoria", "Australia", True),
            Office("Sydney", "New South Wales", "Australia", False),
        ),
    )
    signalhire = FakeSignalHire([ref], info=info, people=285)
    request = ResearchRequest(company=SIGNALHIRE_SAMPLE, city="Melbourne", website=website)
    return await research_company(
        session,
        embedder,
        claude,
        rules_with_signalhire(load_rules()),
        get_settings(),
        request,
        today,
        signalhire=signalhire,
    )


async def seed_signalhire_sample(today: date) -> str:
    """Adds the Signal Hire sample lead to the e2e database."""
    from core.db.engine import get_engine, get_sessionmaker
    from core.memory.embedder import get_embedder

    try:
        async with get_sessionmaker()() as session:
            card = await research_signalhire_sample(session, get_embedder(), today)
    finally:
        await get_engine().dispose()
    return f"Added {card.company}: Signal Hire details, people and a staff conflict (all fake)."


async def serve(app: "FastAPI") -> None:
    import uvicorn

    from core.config import get_settings

    settings = get_settings()
    config = uvicorn.Config(
        app, host="127.0.0.1", port=settings.api_port, log_config=None, ws="none"
    )
    await uvicorn.Server(config).serve()


def serve_perf() -> int:
    """Serves the perf database as it is: no wipe, no seeding (PLAN-V7 A2)."""
    import psycopg

    from core.config import get_settings
    from core.runtime import loop_factory

    use_e2e_database(database=PERF_DATABASE)
    settings = get_settings()
    with psycopg.connect(_conninfo(settings, "postgres"), autocommit=True) as connection:
        found = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (PERF_DATABASE,)
        ).fetchone()
    if found is None:
        raise SystemExit(
            f"No {PERF_DATABASE} yet. Make it first: uv run python -m tests.e2e.perf_seed"
        )
    app = build_app(fake_claude(date.today()))
    print(f"Fake backend on the perf database {PERF_DATABASE}.", file=sys.stderr)
    asyncio.run(serve(app), loop_factory=loop_factory())
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="The fake backend for the website.")
    parser.add_argument(
        "--hubspot-ok",
        action="store_true",
        help="Allow HubSpot watchlist runs (the names only reach the FakeClaude).",
    )
    parser.add_argument(
        "--auth",
        action="store_true",
        help="Turn sign-in on and make a demo Admin. Its password is printed once.",
    )
    parser.add_argument(
        "--perf",
        action="store_true",
        help="Serve the big perf database as it is (see tests.e2e.perf_seed). Sign-in is off.",
    )
    args = parser.parse_args(argv)
    if args.perf and args.auth:
        raise SystemExit("--perf runs without sign-in: leave out --auth.")
    if args.perf:
        return serve_perf()
    use_e2e_database(hubspot_ok=args.hubspot_ok, auth=args.auth)

    from core.runtime import loop_factory

    prepare_database()
    print(asyncio.run(load_hubspot(), loop_factory=loop_factory()), file=sys.stderr)
    seeded = asyncio.run(seed_signalhire_sample(date.today()), loop_factory=loop_factory())
    print(seeded, file=sys.stderr)
    if args.auth:
        password = demo_password()
        print(asyncio.run(make_demo_admin(password), loop_factory=loop_factory()), file=sys.stderr)
        print(f"Sign in with the password: {password}", file=sys.stderr)  # a throwaway one
    app = build_app(fake_claude(date.today()))
    print(f"Fake backend on http://127.0.0.1:8000 (database {DATABASE}).", file=sys.stderr)
    asyncio.run(serve(app), loop_factory=loop_factory())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
