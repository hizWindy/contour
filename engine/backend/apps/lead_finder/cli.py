"""The `lead-finder` command: research one company, or run the test set.

Run it from engine/backend:
    uv run lead-finder research "Culture Amp" --city Melbourne
    uv run lead-finder testset --yes
    uv run lead-finder rejudge
    uv run lead-finder headcount "Culture Amp" --city Melbourne --yes
    uv run lead-finder forms
    uv run lead-finder refill --yes
The first two spend money on Claude. Every request is in the search log. `rejudge` is free: it
judges the saved leads again with the current rules, from their cards, and saves nothing.
`headcount` reads Signal Hire's numbers for one company (1 company credit, plus 2 searches from
the daily quota). It needs SIGNALHIRE_API_KEY in engine/.env, and uses no database.
`forms` checks that every answer form Claude gets is under Anthropic's limits for strict forms
(free). With `--live --yes` it also sends each form to Claude once, at low effort (a few cents).
`refill` fills the answer form again for the leads whose form failed, from the notes memory
keeps: no web search, about US$0.25 a lead (PLAN-V4 B5).
"""

import argparse
import asyncio
import sys
import uuid
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy.exc import OperationalError

from apps.lead_finder.fields import AngleNotes, Candidates, CompanyFacts
from apps.lead_finder.headcount import HeadcountReading, describe_reading, read_headcount
from apps.lead_finder.rejudge import Rejudged, rejudge, table
from apps.lead_finder.research import (
    LeadCard,
    ResearchRequest,
    refill_lead,
    research_company,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.sources import FACT_FIELDS
from apps.lead_finder.testing import load_testset
from core.claude.client import ClaudeError, close_claude, configure_claude, get_claude
from core.claude.forms import OPTIONAL_FIELDS_LIMIT, UNION_FIELDS_LIMIT, form_size
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


# The answer forms Claude gets, with the kind of step that sends each one.
FORMS: dict[str, tuple[Literal["search", "extract", "discover"], type[BaseModel]]] = {
    "search notes": ("search", AngleNotes),
    "company facts": ("extract", CompanyFacts),
    "discovery": ("discover", Candidates),
}
FORM_CHECK_SYSTEM = (
    "This request only checks that an answer form is accepted. Fill in the form for a made-up "
    "company, Example Pty Ltd, with as little as the form allows: empty lists, null or empty text."
)


def _forms(args: argparse.Namespace) -> int:
    """Each form's size against Anthropic's limits. Free. `--live --yes` also sends each once."""
    ok = True
    for name, (_, form) in FORMS.items():
        size = form_size(form)
        ok = ok and size.within_limits
        print(
            f"{name}: {size.union_fields} of {UNION_FIELDS_LIMIT} null-or-value fields, "
            f"{size.optional_fields} of {OPTIONAL_FIELDS_LIMIT} optional fields, "
            f"{size.characters:,} characters: {'ok' if size.within_limits else 'TOO COMPLEX'}"
        )
    if not args.live:
        return 0 if ok else 1
    if not args.yes:
        print("This sends each form to Claude once, at low effort (a few cents). Add --yes.")
        return 1
    return asyncio.run(_forms_live(), loop_factory=loop_factory())


async def _forms_live() -> int:
    settings = get_settings()
    configure_claude(settings)
    claude = get_claude()
    refused = 0
    try:
        for name, (step, form) in FORMS.items():
            try:
                reply = await claude.ask(
                    system=FORM_CHECK_SYSTEM,
                    prompt="Fill in the form.",
                    form=form,
                    model=settings.model_for(step),
                    effort="low",
                )
            except ClaudeError as error:
                refused += 1
                print(f"{name}: REFUSED. {error.title}. {error.detail}")
                continue
            print(f"{name}: accepted by {reply.model} (US${reply.cost_usd:.4f})")
    finally:
        await close_claude()
    return 1 if refused else 0


REFILL_COST_USD = Decimal("0.25")  # one form fill, measured on 2 Nov 2026 (PLAN-V4 B1)


async def _failed_leads() -> list[tuple[uuid.UUID, str]]:
    """The leads whose answer form failed, oldest first: their id and company."""
    from sqlalchemy import select

    from apps.lead_finder.tables import Lead
    from core.db.engine import get_engine, get_sessionmaker

    try:
        async with get_sessionmaker()() as session:
            rows = await session.execute(
                select(Lead.id, Lead.company)
                .where(Lead.card["form_failed"].as_boolean().is_(True))
                .order_by(Lead.created_at)
            )
            return [(lead_id, company) for lead_id, company in rows.all()]
    finally:
        await get_engine().dispose()


async def _refill(leads: list[tuple[uuid.UUID, str]]) -> Decimal:
    """Fills each lead's form again, one at a time. Prints a line each, returns the cost."""
    from core.db.engine import get_engine, get_sessionmaker
    from core.memory.embedder import get_embedder

    settings, rules, claude = get_settings(), load_rules(), get_claude()
    spent = Decimal(0)
    try:
        for lead_id, company in leads:
            async with get_sessionmaker()() as session:
                card = await refill_lead(session, get_embedder(), claude, rules, settings, lead_id)
            if card is None:
                print(f"{company}: skipped, memory has no fresh notes about it", flush=True)
                continue
            if card.form_failed:
                print(f"{company}: the form failed again. {'; '.join(card.problems)}", flush=True)
                continue
            known = len(FACT_FIELDS) - len(unknown_facts(card))
            print(
                f"{company}: {card.result.replace('_', ' ')}, score {card.score}, "
                f"{known} of {len(FACT_FIELDS)} facts found",
                flush=True,
            )
            spent += card.research.cost_usd
    finally:
        await get_engine().dispose()
    return spent


def _refill_command(args: argparse.Namespace) -> int:
    """Lists the leads whose form failed and what refilling them costs; `--yes` refills them."""
    leads = asyncio.run(_failed_leads(), loop_factory=loop_factory())
    if not leads:
        print("No lead has missing facts. Nothing to refill.")
        return 0
    names = ", ".join(company for _, company in leads)
    if not args.yes:
        print(
            f"{len(leads)} leads have missing facts: {names}. Filling their forms again from the "
            f"notes memory keeps costs about US${REFILL_COST_USD} each, about "
            f"US${REFILL_COST_USD * len(leads):.2f} in all, and no web searches. Add --yes."
        )
        return 1
    asyncio.run(_refill(leads), loop_factory=loop_factory())
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
    forms = commands.add_parser(
        "forms",
        help="Check that every answer form is under Anthropic's limits for strict forms (free).",
    )
    forms.add_argument(
        "--live", action="store_true", help="Also send each form to Claude once (a few cents)."
    )
    forms.add_argument("--yes", action="store_true", help="Confirm the spend for --live.")
    refill = commands.add_parser(
        "refill",
        help="Fill the answer form again for the leads whose form failed, from saved notes "
        "(about US$0.25 a lead, no web search).",
    )
    refill.add_argument("--yes", action="store_true", help="Confirm the spend.")
    args = parser.parse_args(argv)

    try:
        if args.command == "rejudge":  # read only, so it never migrates the database
            print(table(asyncio.run(_rejudge(), loop_factory=loop_factory())))
            return 0
        if args.command == "headcount":  # no database either
            return _headcount(args)
        if args.command == "forms":  # no database either
            return _forms(args)
        migrate()
        if args.command == "refill":
            return _refill_command(args)
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
