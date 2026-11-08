"""The lead store: filters, sorting, latest, facets, the map, the export rows, one lead, and what a
person does to a lead.

Tests without a mark are pure code and fast. The rest are marked `integration` (a real database,
no Claude, no memory model: look-alike and outcome tests use vectors made by hand).
"""

import asyncio
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder import lead_store
from apps.lead_finder.lead_store import (
    LeadFilters,
    LeadState,
    apply_patch,
    facet_values,
    lead_conditions,
    list_leads,
    newest_only,
    outcome_of,
    outcome_text,
    reason_of,
    result_rank,
)
from apps.lead_finder.schemas import LeadPatch
from apps.lead_finder.tables import Lead
from core.api.errors import Problem
from core.memory.models import MemoryItem
from tests.lead_finder.factories import (
    FakeEmbedder,
    add_all,
    make_lead,
    make_profile,
    make_run,
)

db = pytest.mark.integration


# --- Pure code: filters, rank, reasons, patches ------------------------------------------------


def pg() -> Any:
    """The PostgreSQL dialect, to show the SQL a condition makes (no connection)."""
    return postgresql.dialect()  # type: ignore[no-untyped-call]


def compiled(filters: LeadFilters, **kwargs: Any) -> tuple[str, dict[str, Any]]:
    where = lead_conditions(filters, **kwargs)
    parts = [str(w.compile(dialect=pg())) for w in where]
    params: dict[str, Any] = {}
    for w in where:
        params.update(w.compile(dialect=pg()).params)
    return " AND ".join(parts), params


def test_no_filters_leave_out_tests_and_keep_only_the_newest_row_of_each_company() -> None:
    sql, _ = compiled(LeadFilters())
    assert "is_test IS false" in sql
    # "No newer lead of the same company, test or not" (PLAN-V7 E1). It was a ranking over the
    # whole table; the rows are the same, and the tests below with real rows prove it.
    assert "NOT (EXISTS" in sql
    assert "leads_1.company_key = lead_finder.leads.company_key" in sql
    assert "leads_1.is_test = lead_finder.leads.is_test" in sql
    assert "(leads_1.created_at, leads_1.id) > (lead_finder.leads.created_at" in sql
    assert "row_number()" not in sql


def test_every_filter_becomes_a_condition() -> None:
    filters = LeadFilters(
        result=["pass"],
        city=["Perth"],
        trigger=["new_ceo"],
        industry=["Software"],
        industry_group=["Law firms"],
        min_score=50,
        office_m2_min=100,
        office_m2_max=900,
        hubspot_status=["new"],
        status=["watching"],
        origin=["hubspot"],
        run_id=uuid.uuid4(),
        created_since=date(2026, 10, 1),
        created_until=date(2026, 10, 31),
        trigger_since=date(2026, 1, 1),
        q="acme",
        include_tests=True,
        latest=False,
    )
    sql, _ = compiled(filters)
    for part in (
        "leads.result IN",
        "leads.city IN",
        "leads.trigger_ids &&",
        "leads.industry IN",
        "leads.industry_group IN",
        "leads.score >=",
        "leads.office_m2 >=",
        "leads.office_m2 <=",
        "leads.hubspot_status IN",
        "leads.status IN",
        "leads.origin IN",
        "leads.run_id =",
        "timezone(",
        "leads.trigger_date >=",
        "LIKE",
    ):
        assert part in sql, part
    assert "is_test IS false" not in sql  # include_tests
    assert "row_number" not in sql  # latest=False


def test_a_company_name_search_treats_percent_and_underscore_as_plain_text() -> None:
    sql, params = compiled(LeadFilters(q="50%_off"))
    assert "ESCAPE" in sql
    assert "50/%/_off" in params.values()


def test_the_melbourne_dates_are_read_in_the_database_time_zone() -> None:
    sql, params = compiled(LeadFilters(created_since=date(2026, 10, 1)))
    assert "timezone(" in sql
    assert "Australia/Melbourne" in params.values()


def test_a_facet_leaves_out_only_its_own_filter() -> None:
    filters = LeadFilters(city=["Perth"], result=["pass"], min_score=10)
    sql, _ = compiled(filters, skip=["city"])
    assert "leads.city" not in sql
    assert "leads.result IN" in sql
    assert "leads.score >=" in sql
    sql, _ = compiled(filters, skip=["score"])
    assert "leads.score" not in sql
    assert "leads.city IN" in sql


def test_skipping_the_run_does_not_turn_on_the_newest_row_filter() -> None:
    """With a run asked for, every lead of the run counts. Skipping the run filter (for the runs
    facet) must not change that."""
    filters = LeadFilters(run_id=uuid.uuid4())
    sql, _ = compiled(filters, skip=["run"])
    assert "run_id =" not in sql
    assert "row_number" not in sql


@pytest.mark.parametrize(
    ("latest", "run", "expected"),
    [
        (None, False, True),
        (None, True, False),
        (True, True, True),
        (False, False, False),
        (True, False, True),
        (False, True, False),
    ],
)
def test_when_only_the_newest_row_of_a_company_shows(
    latest: bool | None, run: bool, expected: bool
) -> None:
    filters = LeadFilters(latest=latest, run_id=uuid.uuid4() if run else None)
    assert newest_only(filters) is expected


def test_results_rank_pass_first_then_director_review_watch_drop() -> None:
    ranked = sorted(["drop", "watch", "pass", "director_review", "odd"], key=result_rank)
    assert ranked == ["pass", "director_review", "watch", "drop", "odd"]


def test_the_sort_names_are_a_fixed_list() -> None:
    assert set(lead_store.SORT_COLUMNS) == {
        "score",
        "created_at",
        "updated_at",
        "company",
        "city",
        "result",
        "status",
        "hubspot_status",
        "trigger_date",
        "office_m2",
        "cost_usd",
    }
    sql = " ".join(str(c.compile(dialect=pg())) for c in lead_store.lead_order("result", "asc"))
    assert "CASE leads.result" in sql.replace("lead_finder.", "")
    assert "NULLS LAST" in sql
    assert sql.rstrip().endswith("lead_finder.leads.id")


CHECKS = [
    {"rule": "HubSpot", "outcome": "fail", "detail": "Open deal in HubSpot: Acme"},
    {"rule": "City", "outcome": "director", "detail": "Sydney: a Director decides"},
    {"rule": "City", "outcome": "unknown", "detail": "City not known"},
    {"rule": "Size", "outcome": "unknown", "detail": "Office size and staff not known"},
    {"rule": "Trigger", "outcome": "ok", "detail": "Acme signed a lease."},
]


def test_the_reason_comes_from_the_stored_checks() -> None:
    assert reason_of("drop", CHECKS) == "Open deal in HubSpot: Acme"
    assert reason_of("director_review", CHECKS) == "Sydney: a Director decides"
    assert reason_of("pass", CHECKS) == "Acme signed a lease."
    # A watch lead with no trigger yet says that, and not the unknown city.
    no_trigger = [*CHECKS[:4], {"rule": "Trigger", "outcome": "unknown", "detail": "No sign yet"}]
    assert reason_of("watch", no_trigger) == "No sign yet"
    # With a trigger, a watch lead says what is not known.
    assert reason_of("watch", CHECKS) == "City not known; Office size and staff not known"


def test_several_failures_share_one_line_and_a_long_reason_is_cut() -> None:
    checks = [
        {"rule": "Size", "outcome": "fail", "detail": "300 m²: too small"},
        {"rule": "Healthy", "outcome": "fail", "detail": "In administration"},
    ]
    assert reason_of("drop", checks) == "300 m²: too small; In administration"
    long = [{"rule": "Size", "outcome": "fail", "detail": "x" * 500}]
    assert len(reason_of("drop", long)) == 240
    assert reason_of("drop", long).endswith("…")


@pytest.mark.parametrize("checks", [None, [], "oops", [1, "a"], [{"outcome": "fail"}]])
def test_an_old_or_broken_card_falls_back_to_why_it_fits_or_nothing(checks: object) -> None:
    assert reason_of("drop", checks, "City: Perth.  Result: Drop.") == "City: Perth. Result: Drop."
    assert reason_of("drop", checks) == ""


def patch(**given: Any) -> LeadPatch:
    return LeadPatch.model_validate(given)


NEW = LeadState(status="new", reject_reason=None, note=None, useful=None)
REJECTED = LeadState(status="rejected", reject_reason="too_small", note="n", useful=False)


def refused(current: LeadState, body: LeadPatch) -> Problem:
    with pytest.raises(Problem) as caught:
        apply_patch(current, body)
    return caught.value


def test_an_omitted_field_stays_and_null_clears() -> None:
    state = LeadState(status="watching", reject_reason=None, note="keep me", useful=True)
    assert apply_patch(state, patch()) == state
    assert apply_patch(state, patch(note=None)).note is None
    assert apply_patch(state, patch(useful=None)).useful is None
    assert apply_patch(state, patch(useful=None)).note == "keep me"
    assert apply_patch(state, patch(note="  new note  ")).note == "new note"
    assert apply_patch(state, patch(note="   ")).note is None


def test_rejecting_needs_a_reason_and_names_the_field() -> None:
    problem = refused(NEW, patch(status="rejected"))
    assert problem.status == 422
    assert problem.extra["errors"][0]["field"] == "body.reject_reason"
    assert refused(NEW, patch(status="rejected", reject_reason=None)).status == 422
    done = apply_patch(NEW, patch(status="rejected", reject_reason="too_small"))
    assert (done.status, done.reject_reason) == ("rejected", "too_small")


def test_a_reason_is_one_of_the_list() -> None:
    with pytest.raises(ValidationError):
        patch(status="rejected", reject_reason="Too small for us")


def test_other_needs_a_note_and_keeps_it() -> None:
    problem = refused(NEW, patch(status="rejected", reject_reason="other"))
    assert problem.extra["errors"][0]["field"] == "body.reject_note"
    assert (
        refused(NEW, patch(status="rejected", reject_reason="other", reject_note=" ")).status == 422
    )
    done = apply_patch(
        NEW, patch(status="rejected", reject_reason="other", reject_note=" Sold last week ")
    )
    assert (done.reject_reason, done.reject_note) == ("other", "Sold last week")
    assert apply_patch(done, patch(note="x")).reject_note == "Sold last week"
    assert apply_patch(done, patch(status="new")).reject_note is None
    # A new reason without a note drops the old note.
    assert apply_patch(done, patch(reject_reason="bad_timing")).reject_note is None


def test_leaving_rejected_clears_the_reason() -> None:
    assert apply_patch(REJECTED, patch(status="new")).reject_reason is None
    assert apply_patch(REJECTED, patch(status="watching")).reject_reason is None
    undone = apply_patch(REJECTED, patch(status="new", reject_reason=None))
    assert (undone.status, undone.reject_reason) == ("new", None)


def test_a_rejected_lead_keeps_or_changes_its_reason_but_cannot_lose_it() -> None:
    assert apply_patch(REJECTED, patch(note="x")).reject_reason == "too_small"
    changed = apply_patch(REJECTED, patch(reject_reason="wrong_industry"))
    assert changed.reject_reason == "wrong_industry"
    assert apply_patch(REJECTED, patch(status="rejected")).reject_reason == "too_small"
    assert refused(REJECTED, patch(reject_reason=None)).status == 422


def test_a_reason_without_rejecting_is_refused() -> None:
    assert refused(NEW, patch(reject_reason="too_small")).status == 422
    assert refused(REJECTED, patch(status="watching", reject_reason="bad_timing")).status == 422
    assert refused(NEW, patch(reject_note="a note")).status == 422


def test_a_lead_that_was_sent_keeps_its_status_but_takes_notes() -> None:
    sent = LeadState(status="sent", reject_reason=None, note=None, useful=None)
    problem = refused(sent, patch(status="new"))
    assert (problem.status, problem.code) == (409, "lead_sent")
    assert apply_patch(sent, patch(note="called")).note == "called"
    assert apply_patch(sent, patch(useful=True)).status == "sent"


@pytest.mark.parametrize(
    ("state", "outcome"),
    [
        (LeadState("new", None, None, None), None),
        (LeadState("watching", None, None, None), "watching"),
        (LeadState("rejected", "too_small", None, None), "rejected"),
        (LeadState("new", None, None, True), "useful"),
        (LeadState("new", None, None, False), "not_useful"),
        (LeadState("watching", None, None, False), "not_useful"),
        (LeadState("rejected", "x", None, True), "rejected"),
        (LeadState("sent", None, "n", None), None),
    ],
)
def test_the_outcome_word_kept_in_memory(state: LeadState, outcome: str | None) -> None:
    assert outcome_of(state) == outcome


def test_the_outcome_text_has_no_note_and_stays_one_line() -> None:
    lead = make_lead("Acme Software", city="Perth", industry="Software")
    state = LeadState(
        "rejected", "other", "my private note", False, reject_note="Too small\nfor us"
    )
    text = outcome_text(lead, state, "rejected")
    assert text == (
        "Rejected lead: Acme Software (Perth, Software). Reason: Other. Too small for us. "
        "The research was rated not useful."
    )
    assert "private" not in text
    assert "\n" not in text


def test_facet_values_list_in_order_then_by_count() -> None:
    counts = {"watch": 1, "pass": 5, "drop": 9, "other": 2, "zed": 2}
    items = facet_values(counts, order=("pass", "director_review", "watch", "drop"))
    assert [(i.value, i.count) for i in items] == [
        ("pass", 5),
        ("watch", 1),
        ("drop", 9),
        ("other", 2),
        ("zed", 2),
    ]
    by_count = facet_values(counts)
    assert [i.value for i in by_count] == ["drop", "pass", "other", "zed", "watch"]


def test_facet_values_keep_the_top_and_show_a_selected_value_with_no_count() -> None:
    counts = {"a": 3, "b": 2, "c": 1}
    items = facet_values(counts, top=2, selected=["c", "gone"])
    assert [(i.value, i.count) for i in items] == [("a", 3), ("b", 2), ("c", 1), ("gone", 0)]


# --- A small world for the database tests ------------------------------------------------------


async def world(session: AsyncSession) -> dict[str, Any]:
    """Eight leads that differ in every column the filters read. Names are one word each."""
    first = make_run(mode="discovery")
    second = make_run(mode="watchlist")
    leads: dict[str, Lead] = {
        "alpha": make_lead(
            "Alpha",
            result="pass",
            score=90,
            city="Melbourne",
            suburb="Docklands",
            industry="Software",
            trigger_id="lease_ending",
            trigger_ids=["lease_ending", "new_ceo"],
            trigger_date=date(2026, 10, 10),
            office_m2=2500,
            hubspot_status="new",
            status="new",
            run_id=first.id,
            cost_usd=Decimal("0.5"),
        ),
        "bravo": make_lead(
            "bravo",
            result="director_review",
            score=60,
            city="Sydney",
            industry="Legal",
            industry_group="Law firms",
            trigger_id="new_ceo",
            trigger_ids=["new_ceo"],
            trigger_date=date(2026, 9, 1),
            office_m2=800,
            hubspot_status="in_hubspot",
            status="watching",
            run_id=first.id,
            cost_usd=Decimal("0.7"),
        ),
        "charlie": make_lead(
            "Charlie",
            result="watch",
            score=40,
            city="Perth",
            industry="Mining",
            industry_group="Mining and metals",
            trigger_id=None,
            trigger_ids=[],
            trigger_date=None,
            office_m2=None,
            hubspot_status="dissolved_deal",
            status="new",
            run_id=second.id,
            cost_usd=Decimal("0.3"),
        ),
        "delta": make_lead(
            "Delta",
            result="drop",
            score=0,
            city="Adelaide",
            industry="Food",
            trigger_id=None,
            trigger_ids=[],
            office_m2=300,
            hubspot_status="open_deal",
            status="rejected",
            reject_reason="already_talking",
            run_id=second.id,
        ),
        "echo": make_lead(
            "echo",
            result="pass",
            score=75,
            city="Melbourne",
            suburb=None,
            industry="Software",
            trigger_id="lease_ending",
            trigger_ids=["lease_ending"],
            trigger_date=date(2026, 8, 1),
            office_m2=1200,
            hubspot_status="possible_match",
            status="watching",
        ),
        "foxtrot": make_lead("Foxtrot", is_test=True, score=95, city="Melbourne", industry="Test"),
        "golf": make_lead(
            "Golf",
            result="watch",
            score=30,
            city=None,
            industry=None,
            trigger_id=None,
            trigger_ids=[],
        ),
        "hotel": make_lead(
            "Hotel", result="pass", score=55, city="Melbourne", industry="Software", status="sent"
        ),
    }
    await add_all(session, first, second, *leads.values())
    return {**leads, "_first": first, "_second": second}


def names(page: Any) -> list[str]:
    return [row.company for row in page.items]


async def ask(session: AsyncSession, **filters: Any) -> list[str]:
    """Company names of the first page, in the list's order."""
    sort = filters.pop("sort", "score")
    order = filters.pop("order", "desc")
    page = await list_leads(session, LeadFilters(**filters), sort, order, limit=200)
    assert page.total == len(page.items)
    return names(page)


@db
async def test_no_filter_lists_every_real_lead_best_score_first(session: AsyncSession) -> None:
    await world(session)
    assert await ask(session) == ["Alpha", "echo", "bravo", "Hotel", "Charlie", "Golf", "Delta"]


@db
@pytest.mark.parametrize(
    ("filters", "expected"),
    [
        ({"result": ["pass"]}, {"Alpha", "echo", "Hotel"}),
        ({"result": ["pass", "drop"]}, {"Alpha", "echo", "Hotel", "Delta"}),
        ({"city": ["Perth"]}, {"Charlie"}),
        ({"city": ["Perth", "Sydney"]}, {"Charlie", "bravo"}),
        ({"trigger": ["new_ceo"]}, {"Alpha", "bravo"}),
        ({"trigger": ["new_ceo", "lease_ending"]}, {"Alpha", "bravo", "echo", "Hotel"}),
        ({"industry": ["Software"]}, {"Alpha", "echo", "Hotel"}),
        ({"industry": ["software"]}, set()),  # exact
        ({"industry_group": ["Law firms"]}, {"bravo"}),
        ({"min_score": 60}, {"Alpha", "echo", "bravo"}),
        ({"min_score": 90}, {"Alpha"}),
        ({"office_m2_min": 1000}, {"Alpha", "echo", "Hotel", "Golf"}),
        ({"office_m2_max": 1000}, {"bravo", "Delta"}),
        ({"office_m2_min": 800, "office_m2_max": 1200}, {"bravo", "echo"}),
        ({"hubspot_status": ["new"]}, {"Alpha", "Golf", "Hotel"}),
        ({"hubspot_status": ["open_deal", "possible_match"]}, {"Delta", "echo"}),
        ({"status": ["watching"]}, {"bravo", "echo"}),
        ({"status": ["rejected", "sent"]}, {"Delta", "Hotel"}),
        ({"trigger_since": date(2026, 9, 1)}, {"Alpha", "bravo"}),
        ({"trigger_since": date(2026, 9, 2)}, {"Alpha"}),
        ({"q": "alp"}, {"Alpha"}),
        ({"q": "ECHO"}, {"echo"}),
        ({"q": "o"}, {"bravo", "echo", "Golf", "Hotel"}),
        ({"q": "zzz"}, set()),
        ({"result": ["pass"], "city": ["Melbourne"], "min_score": 80}, {"Alpha"}),
        ({"include_tests": True, "q": "fox"}, {"Foxtrot"}),
    ],
)
async def test_each_filter(
    session: AsyncSession, filters: dict[str, Any], expected: set[str]
) -> None:
    await world(session)
    assert set(await ask(session, **filters)) == expected


@db
async def test_a_run_filter_lists_that_runs_leads(session: AsyncSession) -> None:
    found = await world(session)
    assert set(await ask(session, run_id=found["_first"].id)) == {"Alpha", "bravo"}
    assert set(await ask(session, run_id=found["_second"].id)) == {"Charlie", "Delta"}
    assert await ask(session, run_id=uuid.uuid4()) == []


@db
async def test_created_dates_are_read_as_melbourne_days(session: AsyncSession) -> None:
    # Melbourne is UTC+11 in October. 13:30 UTC on 25 Oct is 00:30 on 26 Oct there.
    early = make_lead("Early", created_at=datetime(2026, 10, 25, 13, 30, tzinfo=UTC))
    late = make_lead("Late", created_at=datetime(2026, 10, 26, 12, 59, tzinfo=UTC))  # 23:59 on 26th
    next_day = make_lead("Next", created_at=datetime(2026, 10, 26, 13, 0, tzinfo=UTC))  # 00:00 27th
    before = make_lead(
        "Before", created_at=datetime(2026, 10, 25, 12, 59, tzinfo=UTC)
    )  # 23:59 25th
    await add_all(session, early, late, next_day, before)
    day = date(2026, 10, 26)
    assert set(await ask(session, created_since=day, created_until=day)) == {"Early", "Late"}
    assert set(await ask(session, created_since=day)) == {"Early", "Late", "Next"}
    assert set(await ask(session, created_until=day)) == {"Before", "Early", "Late"}
    assert await ask(session, created_since=date(2026, 10, 28)) == []


@db
async def test_a_percent_or_underscore_in_a_search_is_plain_text(session: AsyncSession) -> None:
    await add_all(
        session,
        make_lead("100% Pure"),
        make_lead("A_B Co"),
        make_lead("Axb Co"),
        make_lead("Plain"),
    )
    assert await ask(session, q="%") == ["100% Pure"]
    assert await ask(session, q="_") == ["A_B Co"]
    assert await ask(session, q="a_b") == ["A_B Co"]
    assert await ask(session, q="/") == []


@db
async def test_tests_are_left_out_unless_asked(session: AsyncSession) -> None:
    await world(session)
    assert "Foxtrot" not in await ask(session)
    assert "Foxtrot" in await ask(session, include_tests=True)
    assert "Foxtrot" not in await ask(session, include_tests=False, q="fox")


# --- Sorting and paging ------------------------------------------------------------------------


def expected_order(leads: list[Lead], key: Callable[[Lead], Any], order: str) -> list[str]:
    """The names in the order the list must give: by `key`, missing values last, ties by id."""
    present = sorted((lead for lead in leads if key(lead) is not None), key=lambda lead: lead.id)
    present.sort(key=key, reverse=order == "desc")  # a stable sort, so ties keep id order
    missing = sorted((lead for lead in leads if key(lead) is None), key=lambda lead: lead.id)
    return [lead.company for lead in [*present, *missing]]


SORT_KEYS: dict[str, Callable[[Lead], Any]] = {
    "score": lambda lead: lead.score,
    "created_at": lambda lead: lead.created_at,
    "updated_at": lambda lead: lead.updated_at,
    "company": lambda lead: lead.company.lower(),
    "city": lambda lead: lead.city,
    "result": lambda lead: result_rank(lead.result),
    "status": lambda lead: lead.status,
    "hubspot_status": lambda lead: lead.hubspot_status,
    "trigger_date": lambda lead: lead.trigger_date,
    "office_m2": lambda lead: lead.office_m2,
    "cost_usd": lambda lead: lead.cost_usd,
}


async def sorting_world(session: AsyncSession) -> list[Lead]:
    """Seven leads where every sort key has ties and some leads have no value."""
    specs: list[dict[str, Any]] = [
        {"company": "Mike", "score": 90, "result": "pass", "city": "Perth", "status": "new"},
        {"company": "kilo", "score": 60, "result": "watch", "city": "Perth", "status": "watching"},
        {"company": "Juliet", "score": 60, "result": "drop", "city": None, "status": "rejected"},
        {"company": "india", "score": 40, "result": "pass", "city": "Adelaide", "status": "new"},
        {"company": "Hotel", "score": 0, "result": "director_review", "city": "Sydney"},
        {"company": "golf", "score": 75, "result": "watch", "city": "Melbourne", "status": "new"},
        {"company": "Foxtrot", "score": 75, "result": "pass", "city": None, "status": "sent"},
    ]
    hubspot = ["new", "open_deal", "new", "in_hubspot", None, "new", "possible_match"]
    dates = [
        date(2026, 5, 1),
        None,
        date(2026, 5, 1),
        date(2026, 6, 1),
        None,
        date(2026, 7, 1),
        None,
    ]
    areas = [100, 100, None, 300, 200, None, 50]
    costs = ["0.5", "0.5", "0.1", "0.9", "0.2", "0.2", "1.5"]
    leads = []
    for index, spec in enumerate(specs):
        leads.append(
            make_lead(
                **spec,
                hubspot_status=hubspot[index] or "new",
                trigger_date=dates[index],
                office_m2=areas[index],
                cost_usd=Decimal(costs[index]),
                updated_at=datetime(2026, 11, 1 + index % 4, tzinfo=UTC),
            )
        )
    await add_all(session, *leads)
    return leads


@db
@pytest.mark.parametrize("order", ["asc", "desc"])
@pytest.mark.parametrize("sort", list(SORT_KEYS))
async def test_each_sort_key_in_both_directions(
    session: AsyncSession, sort: str, order: str
) -> None:
    leads = await sorting_world(session)
    got = await ask(session, sort=sort, order=order)
    assert got == expected_order(leads, SORT_KEYS[sort], order)


@db
async def test_rows_that_tie_keep_a_stable_order_across_pages(session: AsyncSession) -> None:
    leads = [make_lead(f"Tie{number}", score=50) for number in range(7)]
    await add_all(session, *leads)
    seen: list[uuid.UUID] = []
    for offset in (0, 3, 6):
        page = await list_leads(session, LeadFilters(), "score", "desc", limit=3, offset=offset)
        assert page.total == 7
        seen += [row.id for row in page.items]
    assert seen == sorted(lead.id for lead in leads)  # no row twice, none missing, id order


@db
async def test_a_page_past_the_end_is_empty_and_the_total_stays(session: AsyncSession) -> None:
    await world(session)
    page = await list_leads(session, LeadFilters(), limit=5, offset=500)
    assert (page.total, page.items) == (7, [])


@db
async def test_a_row_has_the_reason_the_label_and_its_columns(session: AsyncSession) -> None:
    found = await world(session)
    page = await list_leads(session, LeadFilters(q="alpha"))
    [row] = page.items
    assert row.id == found["alpha"].id
    assert row.reason == "Acme signed a new lease."
    assert row.trigger_label == "Lease ending in 1 to 3 years, or a relocation"
    assert row.trigger_ids == ["lease_ending", "new_ceo"]
    assert (row.suburb, row.city, row.score, row.origin, row.is_test) == (
        "Docklands",
        "Melbourne",
        90,
        "typed",
        False,
    )
    assert row.cost_usd == Decimal("0.5")
    [drop] = (await list_leads(session, LeadFilters(q="delta"))).items
    assert drop.reason == "Open deal in HubSpot: Acme"
    assert drop.trigger_label is None


# --- The newest row of each company ------------------------------------------------------------


async def researched_twice(session: AsyncSession) -> dict[str, Lead]:
    """Acme researched three times (the oldest rejected), Beta once, and a test-set lead with
    Acme's key. The oldest Acme and Beta are in the first run."""
    first_run, second_run, third_run = make_run(), make_run(), make_run()
    old = make_lead("Acme", status="rejected", reject_reason="other", run_id=first_run.id)
    beta = make_lead("Beta", run_id=first_run.id)
    middle = make_lead("Acme Pty Ltd", run_id=second_run.id)  # the same company_key as "Acme"
    new = make_lead("Acme", run_id=third_run.id)
    test = make_lead("Acme", is_test=True)
    await add_all(session, first_run, second_run, third_run, old, beta, middle, new, test)
    return {"old": old, "middle": middle, "new": new, "beta": beta, "test": test}


@db
async def test_by_default_a_company_shows_once_as_its_newest_research(
    session: AsyncSession,
) -> None:
    rows = await researched_twice(session)
    page = await list_leads(session, LeadFilters(), limit=50)
    assert {row.id for row in page.items} == {rows["new"].id, rows["beta"].id}


@db
async def test_latest_false_shows_every_row(session: AsyncSession) -> None:
    rows = await researched_twice(session)
    page = await list_leads(session, LeadFilters(latest=False), limit=50)
    assert {row.id for row in page.items} == {
        rows[key].id for key in ("old", "middle", "new", "beta")
    }


@db
async def test_asking_for_a_run_shows_all_its_leads_even_when_newer_research_exists(
    session: AsyncSession,
) -> None:
    rows = await researched_twice(session)
    first_run = rows["old"].run_id
    page = await list_leads(session, LeadFilters(run_id=first_run), limit=50)
    assert {row.id for row in page.items} == {rows["old"].id, rows["beta"].id}
    # `latest=true` with a run: only companies whose newest research is in that run.
    newest = await list_leads(session, LeadFilters(run_id=first_run, latest=True), limit=50)
    assert {row.id for row in newest.items} == {rows["beta"].id}


@db
async def test_latest_is_worked_out_before_the_other_filters(session: AsyncSession) -> None:
    """The old row of Acme was rejected, but Acme was researched again. Asking for rejected
    leads must not bring the old row back."""
    rows = await researched_twice(session)
    assert (await list_leads(session, LeadFilters(status=["rejected"]))).items == []
    with_old = await list_leads(session, LeadFilters(status=["rejected"], latest=False))
    assert [row.id for row in with_old.items] == [rows["old"].id]


@db
async def test_a_test_lead_and_a_real_lead_of_one_company_are_counted_apart(
    session: AsyncSession,
) -> None:
    rows = await researched_twice(session)
    both = await list_leads(session, LeadFilters(include_tests=True), limit=50)
    assert {row.id for row in both.items} == {rows["new"].id, rows["beta"].id, rows["test"].id}
    only_tests = await list_leads(session, LeadFilters(include_tests=True, q="acme"), limit=50)
    assert rows["test"].id in {row.id for row in only_tests.items}


@db
async def test_a_newer_test_lead_does_not_hide_the_real_lead(session: AsyncSession) -> None:
    real = make_lead("Gamma")
    test = make_lead("Gamma", is_test=True)  # newer
    await add_all(session, real, test)
    assert [row.id for row in (await list_leads(session, LeadFilters())).items] == [real.id]


# --- Facets ------------------------------------------------------------------------------------


def values(items: list[Any]) -> dict[str, int]:
    return {item.value: item.count for item in items}


@db
async def test_facets_count_the_real_leads_with_no_filter(session: AsyncSession) -> None:
    await world(session)
    facets = await lead_store.lead_facets(session, LeadFilters())
    assert [i.value for i in facets.result] == ["pass", "director_review", "watch", "drop"]
    assert values(facets.result) == {"pass": 3, "director_review": 1, "watch": 2, "drop": 1}
    assert values(facets.city) == {"Melbourne": 3, "Adelaide": 1, "Perth": 1, "Sydney": 1}
    assert next(i.value for i in facets.city) == "Melbourne"  # most common first
    assert values(facets.industry) == {"Software": 3, "Food": 1, "Legal": 1, "Mining": 1}
    assert values(facets.industry_group) == {"Law firms": 1, "Mining and metals": 1}
    assert [i.value for i in facets.hubspot_status] == [
        "new",
        "in_hubspot",
        "open_deal",
        "dissolved_deal",
        "possible_match",
    ]
    assert values(facets.hubspot_status) == {
        "new": 3,
        "in_hubspot": 1,
        "open_deal": 1,
        "dissolved_deal": 1,
        "possible_match": 1,
    }
    assert [i.value for i in facets.status] == ["new", "watching", "rejected", "sent"]
    assert values(facets.status) == {"new": 3, "watching": 2, "rejected": 1, "sent": 1}
    assert (facets.score.min, facets.score.max) == (0, 90)  # the test lead's 95 is left out
    assert (facets.office_m2.min, facets.office_m2.max) == (300, 2500)


@db
async def test_trigger_facet_counts_each_lead_once_and_gives_the_label(
    session: AsyncSession,
) -> None:
    await world(session)
    facets = await lead_store.lead_facets(session, LeadFilters())
    triggers = {t.id: (t.label, t.count) for t in facets.trigger}
    assert triggers["lease_ending"] == ("Lease ending in 1 to 3 years, or a relocation", 3)
    assert triggers["new_ceo"] == ("Leadership change that changes direction or strategy", 2)
    assert [t.id for t in facets.trigger] == ["lease_ending", "new_ceo"]  # by count


@db
async def test_a_count_applies_every_filter_except_its_own(session: AsyncSession) -> None:
    await world(session)
    facets = await lead_store.lead_facets(session, LeadFilters(city=["Melbourne"], result=["pass"]))
    # The city facet ignores the city filter but obeys the result filter.
    assert values(facets.city) == {"Melbourne": 3}
    # The result facet ignores the result filter but obeys the city filter.
    assert values(facets.result) == {"pass": 3}
    # Other facets obey both.
    assert values(facets.status) == {"new": 1, "watching": 1, "sent": 1}
    assert values(facets.hubspot_status) == {"new": 2, "possible_match": 1}


@db
async def test_a_facet_without_its_own_filter_shows_what_choosing_it_gives(
    session: AsyncSession,
) -> None:
    await world(session)
    facets = await lead_store.lead_facets(session, LeadFilters(result=["drop"]))
    assert values(facets.result) == {"pass": 3, "director_review": 1, "watch": 2, "drop": 1}
    assert values(facets.city) == {"Adelaide": 1}


@db
async def test_ranges_skip_their_own_filters(session: AsyncSession) -> None:
    await world(session)
    facets = await lead_store.lead_facets(
        session, LeadFilters(min_score=70, office_m2_min=1000, office_m2_max=1500)
    )
    # score range: obeys the m2 filter (echo 75 only), ignores min_score
    assert (facets.score.min, facets.score.max) == (75, 75)
    # office_m2 range: obeys min_score (alpha 90, echo 75), ignores the m2 filters
    assert (facets.office_m2.min, facets.office_m2.max) == (1200, 2500)


@db
async def test_a_selected_value_with_no_leads_is_still_listed_with_zero(
    session: AsyncSession,
) -> None:
    await world(session)
    facets = await lead_store.lead_facets(
        session, LeadFilters(city=["Perth"], result=["pass"], trigger=["fast_growth"])
    )
    assert values(facets.city) == {"Perth": 0}  # chosen, so listed, but nothing matches
    assert "fast_growth" in [t.id for t in facets.trigger]
    assert [t.count for t in facets.trigger if t.id == "fast_growth"] == [0]


@db
async def test_the_created_range_is_in_melbourne_days(session: AsyncSession) -> None:
    await add_all(
        session,
        make_lead("A", created_at=datetime(2026, 10, 25, 13, 30, tzinfo=UTC)),
        make_lead("B", created_at=datetime(2026, 11, 3, 12, 0, tzinfo=UTC)),
    )
    facets = await lead_store.lead_facets(session, LeadFilters())
    assert (facets.created.min, facets.created.max) == (date(2026, 10, 26), date(2026, 11, 3))


@db
async def test_an_empty_table_gives_empty_facets(session: AsyncSession) -> None:
    facets = await lead_store.lead_facets(session, LeadFilters())
    assert (facets.result, facets.city, facets.trigger, facets.runs) == ([], [], [], [])
    assert (facets.score.min, facets.score.max) == (None, None)
    assert (facets.created.min, facets.created.max) == (None, None)


@db
async def test_the_industry_facet_lists_the_fifty_most_common(session: AsyncSession) -> None:
    leads = []
    for number in range(55):
        copies = 2 if number < 5 else 1
        leads += [
            make_lead(f"Co {number} {copy}", industry=f"Ind {number:02d}") for copy in range(copies)
        ]
    await add_all(session, *leads)
    facets = await lead_store.lead_facets(session, LeadFilters())
    assert len(facets.industry) == 50
    assert [i.count for i in facets.industry[:5]] == [2] * 5
    assert [i.value for i in facets.industry[5:8]] == ["Ind 05", "Ind 06", "Ind 07"]
    assert "Ind 54" not in values(facets.industry)
    picked = await lead_store.lead_facets(session, LeadFilters(industry=["Ind 54"]))
    assert values(picked.industry)["Ind 54"] == 1  # a chosen value stays, with its count
    assert len(picked.industry) == 51


@db
async def test_the_runs_facet_lists_runs_with_their_counts_newest_first(
    session: AsyncSession,
) -> None:
    found = await world(session)
    facets = await lead_store.lead_facets(session, LeadFilters())
    first, second = found["_first"], found["_second"]
    assert [r.id for r in facets.runs] == [second.id, first.id]
    assert [(r.mode, r.count) for r in facets.runs] == [("watchlist", 2), ("discovery", 2)]
    assert facets.runs[0].created_at == second.created_at
    # With the first run chosen, the runs facet still lists both (it ignores its own filter).
    chosen = await lead_store.lead_facets(session, LeadFilters(run_id=first.id))
    assert {r.id for r in chosen.runs} == {first.id, second.id}
    # And the other facets then show that run's leads, all of them.
    assert values(chosen.result) == {"pass": 1, "director_review": 1}
    # A filter on another facet changes the counts of the runs.
    drops = await lead_store.lead_facets(session, LeadFilters(result=["drop"]))
    assert [(r.id, r.count) for r in drops.runs] == [(second.id, 1)]


@db
async def test_facets_leave_out_test_leads_unless_asked(session: AsyncSession) -> None:
    await world(session)
    plain = await lead_store.lead_facets(session, LeadFilters())
    assert "Test" not in values(plain.industry)
    with_tests = await lead_store.lead_facets(session, LeadFilters(include_tests=True))
    assert values(with_tests.industry)["Test"] == 1
    assert with_tests.score.max == 95


@db
async def test_the_source_filter_and_facet_say_where_each_company_came_from(
    session: AsyncSession,
) -> None:
    await add_all(
        session,
        make_lead("From HubSpot", origin="hubspot"),
        make_lead("Found One", origin="web"),
        make_lead("Found Two", origin="web"),
        make_lead("Typed In"),  # the factory's own: typed
    )
    facets = await lead_store.lead_facets(session, LeadFilters())
    assert [i.value for i in facets.origin] == ["hubspot", "web", "typed"]  # in reading order
    assert values(facets.origin) == {"hubspot": 1, "web": 2, "typed": 1}

    page = await list_leads(session, LeadFilters(origin=["web"]))
    assert sorted(row.company for row in page.items) == ["Found One", "Found Two"]
    assert {row.origin for row in page.items} == {"web"}

    # The source facet leaves out its own filter, so it shows what each choice would give.
    picked = await lead_store.lead_facets(session, LeadFilters(origin=["web"]))
    assert values(picked.origin) == {"hubspot": 1, "web": 2, "typed": 1}
    assert sum(values(picked.result).values()) == 2  # the other facets obey it

    rows = await lead_store.export_rows(
        session, LeadFilters(origin=["hubspot", "typed"]), "company", "asc"
    )
    assert [(row.company, row.source) for row in rows] == [
        ("From HubSpot", "hubspot"),
        ("Typed In", "typed"),
    ]


@db
async def test_a_row_names_the_hubspot_owner_when_there_is_one(session: AsyncSession) -> None:
    owned = make_lead("Owned", hubspot_status="in_hubspot")
    owned.card["hubspot"]["owner"] = "Sample Owner"
    await add_all(session, owned, make_lead("Unowned"))
    page = await list_leads(session, LeadFilters(), sort="company", order="asc")
    assert [(row.company, row.hubspot_owner) for row in page.items] == [
        ("Owned", "Sample Owner"),
        ("Unowned", None),
    ]


@db
async def test_facets_count_the_newest_row_of_each_company(session: AsyncSession) -> None:
    await researched_twice(session)
    facets = await lead_store.lead_facets(session, LeadFilters())
    assert sum(values(facets.result).values()) == 2  # Acme (newest) and Beta
    assert values(facets.status) == {"new": 2}  # the rejected old row is not counted
    with_all = await lead_store.lead_facets(session, LeadFilters(latest=False))
    assert sum(values(with_all.result).values()) == 4


# --- The map -----------------------------------------------------------------------------------


@db
async def test_map_points_have_places_near_the_suburb_or_the_city(session: AsyncSession) -> None:
    found = await world(session)
    out = await lead_store.map_points(session, LeadFilters())
    by_name = {point.name: point for point in out.items}
    assert out.total == 7  # Golf has no city, so no pin
    assert "Golf" not in by_name
    assert len(out.items) == 6
    alpha = by_name["Alpha"]  # Docklands: -37.8166, 144.9460, within 0.002 degrees
    assert alpha.id == found["alpha"].id
    assert abs(alpha.lat - -37.8166) <= 0.0021 and abs(alpha.lng - 144.9460) <= 0.0021
    echo = by_name["echo"]  # no suburb: the city centre, within 0.01 degrees
    assert abs(echo.lat - -37.8136) <= 0.0101 and abs(echo.lng - 144.9631) <= 0.0101
    assert [point.score for point in out.items] == sorted(
        (point.score for point in out.items), reverse=True
    )  # best first


@db
async def test_map_places_do_not_change_between_calls(session: AsyncSession) -> None:
    await world(session)
    first = await lead_store.map_points(session, LeadFilters())
    second = await lead_store.map_points(session, LeadFilters())
    assert [(p.id, p.lat, p.lng) for p in first.items] == [
        (p.id, p.lat, p.lng) for p in second.items
    ]
    # Leads in the same city do not sit on the same spot.
    assert len({(p.lat, p.lng) for p in first.items if p.city == "Melbourne"}) == 3


@db
async def test_the_map_obeys_the_filters_and_the_pin_limit(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await add_all(session, *[make_lead(f"Pin{number}", score=number) for number in range(7)])
    monkeypatch.setattr(lead_store, "MAP_MAX_POINTS", 5)
    out = await lead_store.map_points(session, LeadFilters())
    assert (out.total, len(out.items)) == (7, 5)
    assert [p.score for p in out.items] == [6, 5, 4, 3, 2]
    filtered = await lead_store.map_points(session, LeadFilters(min_score=5))
    assert (filtered.total, len(filtered.items)) == (2, 2)


# --- Export rows -------------------------------------------------------------------------------


@db
async def test_export_rows_follow_the_list_filters_and_sort(session: AsyncSession) -> None:
    found = await world(session)
    rows = await lead_store.export_rows(session, LeadFilters(result=["pass"]), "score", "asc")
    assert [r.company for r in rows] == ["Hotel", "echo", "Alpha"]
    alpha = rows[-1]
    assert (alpha.trigger, alpha.source_link, alpha.trigger_date) == (
        "Lease ending in 1 to 3 years, or a relocation",
        "https://www.afr.com/property/acme-moves-2026",
        date(2026, 10, 10),
    )
    assert alpha.created_at == found["alpha"].created_at
    no_trigger = await lead_store.export_rows(session, LeadFilters(q="charlie"), "score", "desc")
    assert (no_trigger[0].trigger, no_trigger[0].source_link) == (None, None)


@db
async def test_a_source_link_that_is_not_a_plain_web_address_is_left_out(
    session: AsyncSession,
) -> None:
    lead = make_lead("Linky")
    lead.card["triggers"][0]["trigger"]["source_url"] = "javascript:alert(1)"
    await add_all(session, lead)
    [row] = await lead_store.export_rows(session, LeadFilters(), "score", "desc")
    assert row.source_link is None


@db
async def test_too_many_rows_is_a_413_problem(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await add_all(session, *[make_lead(f"Row{number}") for number in range(4)])
    monkeypatch.setattr(lead_store, "EXPORT_MAX_ROWS", 3)
    with pytest.raises(Problem) as caught:
        await lead_store.export_rows(session, LeadFilters(), "score", "desc")
    assert (caught.value.status, caught.value.code) == (413, "too_many_rows")
    assert "4 leads" in str(caught.value.detail)
    rows = await lead_store.export_rows(session, LeadFilters(q="row1"), "score", "desc")
    assert len(rows) == 1


# --- One lead ----------------------------------------------------------------------------------


@db
async def test_a_lead_lists_the_older_researches_of_its_company(session: AsyncSession) -> None:
    rows = await researched_twice(session)
    detail = await lead_store.get_detail(session, rows["new"].id)
    assert detail is not None
    assert [p.id for p in detail.previous] == [rows["middle"].id, rows["old"].id]  # newest first
    assert [(p.result, p.status) for p in detail.previous] == [
        ("pass", "new"),
        ("pass", "rejected"),
    ]
    assert rows["test"].id not in [p.id for p in detail.previous]  # a test lead is another company
    oldest = await lead_store.get_detail(session, rows["old"].id)
    assert oldest is not None and oldest.previous == []
    beta = await lead_store.get_detail(session, rows["beta"].id)
    assert beta is not None and beta.previous == []


@db
async def test_older_means_earlier_in_time_then_in_id_order(session: AsyncSession) -> None:
    moment = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)
    low = make_lead("Same", id=uuid.UUID(int=1), created_at=moment)
    high = make_lead("Same", id=uuid.UUID(int=2), created_at=moment)
    await add_all(session, low, high)
    detail_high = await lead_store.get_detail(session, high.id)
    detail_low = await lead_store.get_detail(session, low.id)
    assert detail_high is not None and [p.id for p in detail_high.previous] == [low.id]
    assert detail_low is not None and detail_low.previous == []
    newest = await list_leads(session, LeadFilters())
    assert [row.id for row in newest.items] == [high.id]  # the same order as "newest"


@db
async def test_the_detail_holds_the_card_and_what_a_person_did(session: AsyncSession) -> None:
    run = make_run()
    lead = make_lead(
        "Acme",
        status="rejected",
        reject_reason="too_small",
        note="call Bob",
        useful=False,
        run_id=run.id,
    )
    await add_all(session, run, lead)
    detail = await lead_store.get_detail(session, lead.id)
    assert detail is not None
    assert (detail.id, detail.company, detail.result, detail.score) == (lead.id, "Acme", "pass", 70)
    assert (detail.status, detail.reject_reason, detail.note, detail.useful) == (
        "rejected",
        "too_small",
        "call Bob",
        False,
    )
    assert (detail.run_id, detail.origin, detail.is_test) == (run.id, "typed", False)
    assert detail.updated_at == lead.updated_at
    assert detail.facts.office_m2.value == 2500
    assert await lead_store.get_detail(session, uuid.uuid4()) is None


# --- Changing a lead, and its memory item ------------------------------------------------------


async def outcome_items(session: AsyncSession, lead: Lead | None = None) -> list[MemoryItem]:
    meta: Any = MemoryItem.meta
    statement = select(MemoryItem).where(MemoryItem.kind == "lead_outcome")
    if lead is not None:
        statement = statement.where(meta.contains({"lead_id": str(lead.id)}))
    return list((await session.scalars(statement)).all())


async def one_lead(session: AsyncSession, **changes: Any) -> Lead:
    lead = make_lead("Acme Software", city="Perth", industry="Software", **changes)
    await add_all(session, lead)
    return lead


@db
async def test_rejecting_saves_one_outcome_and_undoing_removes_it(session: AsyncSession) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    detail = await lead_store.patch_lead(
        session, embedder, lead.id, patch(status="rejected", reject_reason="too_small")
    )
    assert (detail.status, detail.reject_reason) == ("rejected", "too_small")
    [item] = await outcome_items(session, lead)
    assert (item.app, item.kind, item.subject) == ("lead_finder", "lead_outcome", "Acme Software")
    assert item.meta == {"lead_id": str(lead.id), "outcome": "rejected"}
    assert "Too small" in item.content
    assert len(embedder.texts) == 1
    assert len(item.embedding) == 384

    undone = await lead_store.patch_lead(
        session, embedder, lead.id, patch(status="new", reject_reason=None)
    )
    assert (undone.status, undone.reject_reason) == ("new", None)
    assert await outcome_items(session) == []


@db
async def test_changing_the_reason_replaces_the_item_and_never_adds_a_second(
    session: AsyncSession,
) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    await lead_store.patch_lead(
        session, embedder, lead.id, patch(status="rejected", reject_reason="bad_timing")
    )
    [first] = await outcome_items(session, lead)
    await lead_store.patch_lead(session, embedder, lead.id, patch(reject_reason="too_small"))
    [second] = await outcome_items(session, lead)
    assert second.id != first.id
    assert "Reason: Too small" in second.content and "Bad timing" not in second.content
    await lead_store.patch_lead(session, embedder, lead.id, patch(status="watching"))
    [third] = await outcome_items(session, lead)
    assert third.meta["outcome"] == "watching"
    assert len(embedder.texts) == 3


@db
async def test_watching_then_undoing_leaves_no_item(session: AsyncSession) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    await lead_store.patch_lead(session, embedder, lead.id, patch(status="watching"))
    assert [i.meta["outcome"] for i in await outcome_items(session)] == ["watching"]
    await lead_store.patch_lead(session, embedder, lead.id, patch(status="new"))
    assert await outcome_items(session) == []


@db
async def test_thumbs_up_and_down_replace_one_item_and_null_removes_it(
    session: AsyncSession,
) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    await lead_store.patch_lead(session, embedder, lead.id, patch(useful=True))
    assert [i.meta["outcome"] for i in await outcome_items(session)] == ["useful"]
    detail = await lead_store.patch_lead(session, embedder, lead.id, patch(useful=False))
    assert detail.useful is False
    assert [i.meta["outcome"] for i in await outcome_items(session)] == ["not_useful"]
    cleared = await lead_store.patch_lead(session, embedder, lead.id, patch(useful=None))
    assert cleared.useful is None
    assert await outcome_items(session) == []


@db
async def test_a_note_alone_touches_neither_memory_nor_the_embedder(session: AsyncSession) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    detail = await lead_store.patch_lead(session, embedder, lead.id, patch(note="Call on Monday"))
    assert detail.note == "Call on Monday"
    assert embedder.texts == []
    assert await outcome_items(session) == []
    cleared = await lead_store.patch_lead(session, embedder, lead.id, patch(note=None))
    assert cleared.note is None


@db
async def test_a_patch_that_changes_nothing_writes_nothing(session: AsyncSession) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    before = (await lead_store.get_detail(session, lead.id)).updated_at  # type: ignore[union-attr]
    detail = await lead_store.patch_lead(session, embedder, lead.id, patch(status="new"))
    assert detail.updated_at == before
    assert (await lead_store.patch_lead(session, embedder, lead.id, patch())).updated_at == before
    assert embedder.texts == []


@db
async def test_updated_at_moves_forward_and_is_returned_after_the_commit(
    session: AsyncSession,
) -> None:
    lead = await one_lead(session)
    before = lead.updated_at
    detail = await lead_store.patch_lead(session, FakeEmbedder(), lead.id, patch(note="x"))
    assert detail.updated_at > before
    stored = await session.scalar(select(Lead.updated_at).where(Lead.id == lead.id))
    assert stored == detail.updated_at


@db
async def test_a_refused_patch_changes_nothing_and_lets_the_next_one_through(
    session: AsyncSession,
) -> None:
    embedder = FakeEmbedder()
    lead = await one_lead(session)
    with pytest.raises(Problem) as caught:
        await lead_store.patch_lead(session, embedder, lead.id, patch(status="rejected"))
    assert caught.value.status == 422
    stored = await lead_store.get_detail(session, lead.id)
    assert stored is not None and stored.status == "new"
    assert await outcome_items(session) == []
    done = await lead_store.patch_lead(session, embedder, lead.id, patch(note="ok"))
    assert done.note == "ok"


@db
async def test_other_leads_outcomes_are_left_alone(session: AsyncSession) -> None:
    embedder = FakeEmbedder()
    first, second = make_lead("First"), make_lead("Second")
    await add_all(session, first, second)
    await lead_store.patch_lead(session, embedder, first.id, patch(status="watching"))
    await lead_store.patch_lead(session, embedder, second.id, patch(status="watching"))
    await lead_store.patch_lead(session, embedder, first.id, patch(status="new"))
    [left] = await outcome_items(session)
    assert left.meta["lead_id"] == str(second.id)


@db
async def test_an_unknown_lead_is_a_404(session: AsyncSession) -> None:
    with pytest.raises(Problem) as caught:
        await lead_store.patch_lead(session, FakeEmbedder(), uuid.uuid4(), patch(note="x"))
    assert caught.value.status == 404


@db
async def test_two_patches_at_once_still_leave_one_outcome_item(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    lead = await one_lead(session)
    embedder = FakeEmbedder()

    async def reject(reason: str) -> None:
        async with session_factory() as own:
            await lead_store.patch_lead(
                own, embedder, lead.id, patch(status="rejected", reject_reason=reason)
            )

    reasons = ["too_small", "wrong_industry", "already_talking", "bad_timing", "not_a_real_sign"]
    await asyncio.gather(*(reject(reason) for reason in reasons))
    items = await outcome_items(session, lead)
    assert len(items) == 1
    count = await session.scalar(
        select(func.count()).select_from(MemoryItem).where(MemoryItem.kind == "lead_outcome")
    )
    assert count == 1


@db
async def test_the_real_memory_model_embeds_the_outcome(
    session: AsyncSession, embedder: Any
) -> None:
    lead = await one_lead(session)
    await lead_store.patch_lead(
        session, embedder, lead.id, patch(status="rejected", reject_reason="too_small")
    )
    [item] = await outcome_items(session, lead)
    assert len(item.embedding) == 384
    assert any(abs(float(number)) > 0 for number in item.embedding)


@db
async def test_a_profile_memory_item_is_not_touched_by_feedback(session: AsyncSession) -> None:
    lead = await one_lead(session)
    session.add(make_profile("Acme Software", 1.0, meta={"job_id": str(lead.id)}))
    await session.commit()
    await lead_store.patch_lead(session, FakeEmbedder(), lead.id, patch(status="watching"))
    await lead_store.patch_lead(session, FakeEmbedder(), lead.id, patch(status="new"))
    kinds = list((await session.scalars(select(MemoryItem.kind))).all())
    assert kinds == ["company_profile"]


@db
async def test_leads_whose_form_failed_can_be_listed_on_their_own(session: AsyncSession) -> None:
    """PLAN-V4 B4: a lead with no facts because the form failed is marked, and can be filtered."""
    failed, fine = make_lead("Myer"), make_lead("Acme Software")
    failed.card = {**failed.card, "form_failed": True}
    await add_all(session, failed, fine)

    page = await list_leads(session, LeadFilters(facts_missing=True))
    assert page.total == 1 and [row.company for row in page.items] == ["Myer"]
    assert page.items[0].form_failed

    every = await list_leads(session, LeadFilters())
    assert {row.company: row.form_failed for row in every.items} == {
        "Myer": True,
        "Acme Software": False,
    }


@db
async def test_reject_reasons_are_counted_over_the_last_90_days(session: AsyncSession) -> None:
    """PLAN-V9 D1: the counts on the Runs tab. Every reason is listed, most used first."""
    now = datetime(2026, 11, 8, tzinfo=UTC)
    recent = datetime(2026, 10, 20, tzinfo=UTC)
    old = datetime(2026, 7, 1, tzinfo=UTC)
    await add_all(
        session,
        make_lead("A", status="rejected", reject_reason="too_small", updated_at=recent),
        make_lead("B", status="rejected", reject_reason="too_small", updated_at=recent),
        make_lead("C", status="rejected", reject_reason="bad_timing", updated_at=recent),
        make_lead("D", status="rejected", reject_reason="too_small", updated_at=old),  # too old
        make_lead(
            "E", status="rejected", reject_reason="too_small", updated_at=recent, is_test=True
        ),
        make_lead("F", status="watching", updated_at=recent),
    )
    counts = await lead_store.reject_reason_counts(session, 90, now=now)
    assert (counts.days, counts.total) == (90, 3)
    assert [(item.reason, item.count) for item in counts.reasons[:2]] == [
        ("too_small", 2),
        ("bad_timing", 1),
    ]
    assert len(counts.reasons) == 6 and counts.reasons[0].label == "Too small"
    assert {item.count for item in counts.reasons[2:]} == {0}
