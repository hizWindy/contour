"""The `lead-finder` command: research one company, or run the test set.

Run it from engine/backend:
    uv run lead-finder research "Culture Amp" --city Melbourne
    uv run lead-finder testset --yes
    uv run lead-finder rejudge
    uv run lead-finder headcount "Culture Amp" --city Melbourne --yes
The first two spend money on Claude. Every request is in the search log. `rejudge` is free: it
judges the saved leads again with the current rules, from their cards, and saves nothing.
`headcount` reads Signal Hire's numbers for one company (1 company credit, plus 2 searches from
the daily quota). It needs SIGNALHIRE_API_KEY in engine/.env, and uses no database.
"""

import argparse
import asyncio
import sys
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.exc import OperationalError

from apps.lead_finder.headcount import HeadcountReading, describe_reading, read_headcount
from apps.lead_finder.rejudge import Rejudged, rejudge, table
from apps.lead_finder.research import LeadCard, ResearchRequest, research_company
from apps.lead_finder.rules import load_rules
from apps.lead_finder.sources import FACT_FIELDS
from apps.lead_finder.testing import load_testset
from core.claude.client import ClaudeError, get_claude
from core.cli import DATABASE_DOWN, migrate
from core.config import get_settings
from core.logs import setup_logging
from core.runtime import loop_factory
from core.signalhire.client import HttpSignalHire, SignalHireError, get_signalhire


def unknown_facts(card: LeadCard) -> list[str]:
    return [name for name in FACT_FIELDS if getattr(card.facts, name).value is None]


def describe(card: LeadCard) -> str:
    lines = [
        f"{card.company}: {card.result.replace('_', ' ')}, score {card.score}",
        f"  {card.summary}",
        f"  Why: {card.why_it_fits}",
    ]
    for trigger in card.triggers:
        t = trigger.trigger
        lines.append(f"  Trigger: {t.what_happened} ({t.date or 'no date'}) {t.source_url}")
    lines.append(f"  Contact: {card.contact_role or 'unknown'}")
    lines += [
        f"  Decision maker: {person.name}, {person.role} {person.source_url}"
        for person in card.facts.decision_makers
    ]
    lines.append(f"  Opening line: {card.opening_line or '-'}")
    lines.append(f"  Unknown: {', '.join(unknown_facts(card)) or 'nothing'}")
    lines += [f"  From Signal Hire: {note}" for note in card.from_signalhire]
    lines += [f"  Removed: {item}" for item in card.dropped]
    lines += [f"  Problem: {item}" for item in card.problems]
    cost = card.research
    memory = (
        f", from memory: {', '.join(cost.angles_from_memory)}" if cost.angles_from_memory else ""
    )
    lines.append(
        f"  Cost: US${cost.cost_usd:.4f} of ${cost.cap_usd} cap, "
        f"{cost.web_searches} searches, {cost.claude_requests} Claude requests{memory}"
    )
    lines.append(f"  Lead id: {card.id}")
    return "\n".join(lines)


async def _research(requests: list[ResearchRequest]) -> list[LeadCard]:
    from core.db.engine import get_engine, get_sessionmaker
    from core.memory.embedder import get_embedder

    settings = get_settings()
    claude = get_claude()
    cards = []
    try:
        async with get_sessionmaker()() as session:
            for request in requests:
                card = await research_company(
                    session, get_embedder(), claude, load_rules(), settings, request
                )
                print(describe(card), end="\n\n", flush=True)
                cards.append(card)
    finally:
        await get_engine().dispose()
    return cards


async def _rejudge() -> list[Rejudged]:
    """The saved leads, judged again with the current rules. Reads only: no migration, no save.
    It selects the card, not the whole row, so it also works on a database not yet migrated."""
    from sqlalchemy import select

    from apps.lead_finder.tables import Lead
    from core.db.engine import get_engine, get_sessionmaker

    rules, today = load_rules(), datetime.now(ZoneInfo("Australia/Melbourne")).date()
    try:
        async with get_sessionmaker()() as session:
            rows = await session.execute(
                select(Lead.company, Lead.result, Lead.score, Lead.card)
                .where(Lead.is_test.is_(False))
                .order_by(Lead.created_at)
            )
            return [rejudge(c, r, s, card, rules, today) for c, r, s, card in rows.all()]
    finally:
        await get_engine().dispose()


async def _read_headcount(client: HttpSignalHire, args: argparse.Namespace) -> HeadcountReading:
    async with client:
        return await read_headcount(
            client,
            company=args.company,
            website=args.website,
            city=args.city,
            location=args.location,
        )


def _headcount(args: argparse.Namespace) -> int:
    """Signal Hire's numbers for one company. Uses no database, so it never migrates."""
    if not args.yes:
        print(
            "This uses 1 Signal Hire company credit and 2 searches from the daily quota. "
            "Add --yes to go ahead."
        )
        return 1
    client = get_signalhire()
    if client is None:
        print("SIGNALHIRE_API_KEY is not set in engine/.env.", file=sys.stderr)
        return 1
    reading = asyncio.run(_read_headcount(client, args), loop_factory=loop_factory())
    print(describe_reading(reading))
    return 0


def _table(cards: list[LeadCard], label: str) -> None:
    print(f"{label}\n{'Company':<20} {'Result':<16} {'Score':>5} {'Unknown':>7} {'Cost US$':>9}")
    for card in cards:
        print(
            f"{card.company[:20]:<20} {card.result:<16} {card.score:>5} "
            f"{len(unknown_facts(card)):>7} {card.research.cost_usd:>9.4f}"
        )
    total = sum((card.research.cost_usd for card in cards), Decimal(0))
    average = total / len(cards) if cards else Decimal(0)
    print(f"Total US${total:.4f}, average US${average:.4f} per company\n")


def main(argv: Sequence[str] | None = None) -> int:
    setup_logging()
    parser = argparse.ArgumentParser(prog="lead-finder", description="Lead Finder commands.")
    commands = parser.add_subparsers(dest="command", required=True)
    one = commands.add_parser("research", help="Research one company (costs money).")
    one.add_argument("company")
    one.add_argument("--city")
    one.add_argument("--website")
    one.add_argument("--fresh", action="store_true", help="Search again, ignoring memory.")
    tests = commands.add_parser("testset", help="Research the 10 test companies (costs money).")
    tests.add_argument("--twice", action="store_true", help="Run again to show memory savings.")
    tests.add_argument("--yes", action="store_true", help="Confirm the spend.")
    commands.add_parser(
        "rejudge",
        help="Judge the saved leads again with the current rules, from their cards. "
        "No searches, no cost, and nothing is saved.",
    )
    head = commands.add_parser(
        "headcount",
        help="Read Signal Hire's headcount for one company (1 company credit, and 2 searches "
        "from the daily quota). Counts only, no names or contact details.",
    )
    head.add_argument("company")
    head.add_argument("--city", help="Counts the people on file in this city, in Australia.")
    head.add_argument("--website", help="Helps find the company, like cultureamp.com.")
    head.add_argument(
        "--location", help="Signal Hire's own place text, instead of CITY, Australia."
    )
    head.add_argument("--yes", action="store_true", help="Confirm the credit.")
    args = parser.parse_args(argv)

    try:
        if args.command == "rejudge":  # read only, so it never migrates the database
            print(table(asyncio.run(_rejudge(), loop_factory=loop_factory())))
            return 0
        if args.command == "headcount":  # no database either
            return _headcount(args)
        migrate()
        if args.command == "research":
            request = ResearchRequest(
                company=args.company,
                city=args.city,
                website=args.website,
                use_memory=not args.fresh,
            )
            asyncio.run(_research([request]), loop_factory=loop_factory())
        else:
            testset = load_testset()
            rounds = 2 if args.twice else 1
            most = get_settings().company_cap_usd * len(testset.companies)
            if not args.yes:
                print(
                    f"This researches {len(testset.companies)} companies, {rounds} time(s). "
                    f"At most US${most:.2f} per round, at the per-company cap. "
                    "Add --yes to go ahead."
                )
                return 1
            requests = [
                ResearchRequest(company=c.name, city=c.city, website=c.website)
                for c in testset.companies
            ]
            for number in range(1, rounds + 1):
                cards = asyncio.run(_research(requests), loop_factory=loop_factory())
                _table(cards, f"Round {number}")
    except OperationalError:
        print(DATABASE_DOWN, file=sys.stderr)
        return 1
    except (ClaudeError, SignalHireError) as error:
        print(f"{error.title}. {error.detail}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
