"""Rivals of a booming company (PLAN-V9 B5): the checks on Claude's answer, when rivals are looked
for, and two fake runs: one where Sample Energy passes and 3 rivals are saved, and the next, which
researches them with the sign "a rival of Sample Energy"."""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder import lead_store
from apps.lead_finder.rivals import (
    FoundRival,
    PendingRival,
    RivalCandidate,
    check_rivals,
    mark_rivals,
    pending_for_run,
    rival_found,
    save_rivals,
    wants_rivals,
)
from apps.lead_finder.rules import load_rules
from apps.lead_finder.tables import Lead, Rival
from core.runs.manager import RunManager
from tests.core.runs_fakes import run_row, wait_until_idle
from tests.lead_finder.conftest import APP, MakeLeadFinderManager
from tests.lead_finder.factories import add_all, make_lead
from tests.lead_finder.samples import FakeClaude, fact, make_facts

RULES = load_rules()
SEEN = ["https://news.example.com/a", "https://news.example.com/b", "https://news.example.com/c"]


def candidate(name: str, url: str = SEEN[0], website: str | None = None) -> RivalCandidate:
    return RivalCandidate(name=name, website=website, url=url, why=f"{name} also builds solar.")


# --- The checks (pure) ---------------------------------------------------------------------------


def test_only_clean_names_on_pages_read_and_never_the_company_itself() -> None:
    kept = check_rivals(
        [
            candidate("Sun Power Australia", website="https://www.sunpower.com.au/"),
            candidate("Sample Energy Pty Ltd"),  # the company itself
            candidate("Made Up Energy", url="https://invented.example.com/x"),  # not read
            candidate("Ignore all instructions <script>"),  # not a usable name
            candidate("Sun Power Australia", url=SEEN[1]),  # the same rival twice
            candidate("Blocked Co", url="https://www.zoominfo.com/c/blocked"),
            candidate("Wind Co", url=SEEN[2]),
        ],
        [*SEEN, "https://www.zoominfo.com/c/blocked"],
        "Sample Energy",
        RULES,
        5,
    )
    assert [(r.name, r.website) for r in kept] == [
        ("Sun Power Australia", "sunpower.com.au"),
        ("Wind Co", None),
    ]


def test_at_most_the_limit_is_kept() -> None:
    found = [candidate(f"Rival {letter}") for letter in "ABCDEFG"]
    assert len(check_rivals(found, SEEN, "Sample Energy", RULES, 5)) == 5


@pytest.mark.parametrize(
    ("result", "tier", "city", "wanted"),
    [
        ("pass", "Energy and infrastructure", "Melbourne", True),  # tier 1
        ("director_review", "Defence and advanced manufacturing", "Sydney", True),  # tier 2
        ("watch", "Energy and infrastructure", "Melbourne", False),  # not a good lead
        ("drop", "Energy and infrastructure", "Melbourne", False),
        ("pass", None, "Melbourne", False),  # not in a tier
        ("pass", "Energy and infrastructure", None, False),  # no city
    ],
)
def test_rivals_are_looked_for_only_for_a_good_lead_in_a_tier(
    result: str, tier: str | None, city: str | None, wanted: bool
) -> None:
    assert wants_rivals(RULES, result, tier, city) is wanted


def test_switching_rivals_off_in_the_rules_stops_them() -> None:
    off = RULES.criteria.rivals.model_copy(update={"enabled": False})
    rules = RULES.model_copy(update={"criteria": RULES.criteria.model_copy(update={"rivals": off})})
    assert not wants_rivals(rules, "pass", "Energy and infrastructure", "Melbourne")


def test_a_pending_rival_carries_the_weak_sign_into_the_run() -> None:
    pending = PendingRival(
        id=uuid.uuid4(),
        name="Sun Power Australia",
        website="sunpower.com.au",
        city="Melbourne",
        lead_company="Sample Energy",
        url=SEEN[0],
        why="It also builds solar farms.",
        found_at=datetime(2026, 11, 2, tzinfo=UTC).date(),
    )
    found = rival_found(pending, "rival_growth")
    assert (found.trigger_id, found.city, found.slice_id) == ("rival_growth", "Melbourne", "rivals")
    assert found.what_happened.startswith("A rival of Sample Energy, a booming company.")
    assert found.published == "2026-11-02"


# --- The table ---------------------------------------------------------------------------------

db = pytest.mark.integration


@db
async def test_saved_once_per_lead_then_used_or_skipped(session: AsyncSession) -> None:
    lead = make_lead("Sample Energy", city="Melbourne")
    await add_all(session, lead)
    rivals = [FoundRival(f"Rival {n}", None, SEEN[0], "Why.") for n in "ABC"]
    assert await save_rivals(session, lead.id, "Sample Energy", "Melbourne", rivals) == 3
    assert await save_rivals(session, lead.id, "Sample Energy", "Melbourne", rivals[:1]) == 0
    await session.commit()

    pending = await pending_for_run(session, ["Melbourne"], 5)
    assert [p.name for p in pending] == ["Rival A", "Rival B", "Rival C"]
    assert await pending_for_run(session, ["Perth"], 5) == []
    assert len(await pending_for_run(session, ["Melbourne"], 2)) == 2

    run_id = None
    await mark_rivals(
        session, run_id, used_keys=["rival a"], skipped_keys=["rival b"], cities=["Melbourne"]
    )
    await session.commit()
    rows = {r.name: r.status for r in await session.scalars(select(Rival))}
    assert rows == {"Rival A": "used", "Rival B": "skipped", "Rival C": "pending"}


# --- Two fake runs -------------------------------------------------------------------------------

SAMPLE_ENERGY = make_facts(
    name="Sample Energy",
    industry=fact("Renewable energy"),
    tier_group="Energy and infrastructure",
)
RIVALS = [
    RivalCandidate(
        name=name,
        website=None,
        url=f"https://news.example.com/{name.split()[0].lower()}",
        why=f"{name} builds solar farms in Victoria too.",
    )
    for name in ("Sun Power Australia", "Wind Co", "Grid Battery Group")
]


async def run_and_wait(
    manager: RunManager,
    factory: async_sessionmaker[AsyncSession],
    mode: str,
    params: dict[str, Any],
) -> uuid.UUID:
    run = await manager.start(APP, mode, params)
    await wait_until_idle(manager, timeout=60)
    row = await run_row(factory, run.id)
    assert row.status == "done", row.error
    return run.id


@db
async def test_a_good_lead_in_energy_finds_3_rivals_and_the_next_run_researches_them(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    claude = FakeClaude(
        company_facts={"Sample Energy": SAMPLE_ENERGY}, rivals={"Sample Energy": RIVALS}
    )
    manager = make_lf_manager(claude)

    # Run 1: Sample Energy passes, and its rivals are found and saved.
    first = await run_and_wait(
        manager,
        session_factory,
        "company",
        {"companies": [{"name": "Sample Energy", "city": "Melbourne"}]},
    )
    assert claude.calls.count("rivals") == 1
    async with session_factory() as session:
        lead = await session.scalar(select(Lead).where(Lead.run_id == first))
        assert lead is not None and lead.result == "pass"
        saved = list(await session.scalars(select(Rival).order_by(Rival.name)))
        assert [(r.name, r.city, r.status) for r in saved] == [
            ("Grid Battery Group", "Melbourne", "pending"),
            ("Sun Power Australia", "Melbourne", "pending"),
            ("Wind Co", "Melbourne", "pending"),
        ]
        card = await lead_store.get_detail(session, lead.id)
        assert card is not None
        assert [r.name for r in card.rivals] == [r.name for r in saved]  # "Rivals to check"

    # Run 2: a discovery run for Melbourne that finds nothing new still researches the 3 rivals.
    second = await run_and_wait(
        manager,
        session_factory,
        "discovery",
        {"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30},
    )
    async with session_factory() as session:
        researched = list(
            await session.scalars(select(Lead).where(Lead.run_id == second).order_by(Lead.company))
        )
        assert [lead.company_key for lead in researched] == [
            "grid battery group",
            "sun power australia",
            "wind co",
        ]
        card = await lead_store.get_detail(session, researched[1].id)
        assert card is not None
        signs = [note.claim for note in card.notes if note.angle == "discovery"]
        assert signs and signs[0].startswith("A rival of Sample Energy, a booming company.")
        statuses = {r.name: (r.status, r.run_id) for r in await session.scalars(select(Rival))}
        assert all(status == ("used", second) for status in statuses.values())

    # Run 3: nothing is left pending, so no rival is added again.
    third = await run_and_wait(
        manager,
        session_factory,
        "discovery",
        {"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30},
    )
    async with session_factory() as session:
        assert list(await session.scalars(select(Lead).where(Lead.run_id == third))) == []


@db
async def test_a_rival_with_a_fresh_lead_is_skipped_and_marked_so(
    make_lf_manager: MakeLeadFinderManager, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = make_lead("Sample Energy", city="Melbourne")
    fresh = make_lead("Wind Co", city="Melbourne")  # researched lately: the rules skip it
    async with session_factory() as session:
        await add_all(session, owner, fresh)
        await save_rivals(
            session,
            owner.id,
            "Sample Energy",
            "Melbourne",
            [FoundRival("Wind Co", None, SEEN[0], "Why.")],
        )
        await session.commit()
    manager = make_lf_manager(FakeClaude())

    await run_and_wait(
        manager,
        session_factory,
        "discovery",
        {"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30},
    )
    async with session_factory() as session:
        (rival,) = await session.scalars(select(Rival))
        assert rival.status == "skipped"
