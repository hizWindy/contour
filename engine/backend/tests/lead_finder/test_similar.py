"""Look-alikes: a lead's profile against HubSpot companies with a deal and against other leads.

Tests without a mark are pure code. The rest are marked `integration` (a real database). They use
vectors made by hand (`vector(cos)` has cosine similarity `cos` with `vector(1.0)`), so no memory
model is loaded and every similarity is known in advance.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.similar import (
    NO_PROFILE_NOTE,
    city_text,
    deal_lookalikes,
    lead_lookalikes,
    own_profile,
    owner_of,
    similar_for,
    similarity_of,
)
from apps.lead_finder.tables import Lead
from core.api.errors import Problem
from core.hubspot.models import HubSpotCompany, HubSpotDeal
from core.memory.models import MemoryItem
from tests.lead_finder.factories import (
    add_all,
    deal_profile,
    lead_profile,
    make_lead,
    make_profile,
    vector,
)

db = pytest.mark.integration


# --- Pure code ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("distance", "similarity"),
    [(0.0, 1.0), (0.1, 0.9), (0.12345, 0.877), (0.5, 0.5), (1.0, 0.0), (1.4, 0.0), (-0.0001, 1.0)],
)
def test_similarity_is_one_minus_the_distance_in_three_places_within_zero_and_one(
    distance: float, similarity: float
) -> None:
    assert similarity_of(distance) == similarity


def test_the_owner_of_a_profile_is_its_lead_id_or_job_id() -> None:
    lead_id, job_id = uuid.uuid4(), uuid.uuid4()
    both = make_profile("A", meta={"lead_id": str(lead_id), "job_id": str(job_id)})
    assert owner_of(both) == lead_id
    assert owner_of(make_profile("A", meta={"job_id": str(job_id)})) == job_id
    assert owner_of(make_profile("A", meta={"lead_id": "not a uuid"})) is None
    assert owner_of(make_profile("A", meta={"lead_id": 5})) is None
    assert owner_of(make_profile("A")) is None


@pytest.mark.parametrize(
    ("value", "text_out"),
    [
        (["Melbourne", "Perth"], "Melbourne, Perth"),
        (["Melbourne"], "Melbourne"),
        ([], None),
        ([" ", ""], None),
        ("Sydney", "Sydney"),
        ("  ", None),
        (None, None),
        (5, None),
    ],
)
def test_the_cities_of_a_hubspot_profile_are_shown_as_one_text(
    value: object, text_out: str | None
) -> None:
    assert city_text(value) == text_out


# --- The profile of a lead ---------------------------------------------------------------------


@db
async def test_a_lead_without_a_profile_says_so_in_plain_words(session: AsyncSession) -> None:
    lead = make_lead("Acme Software")
    await add_all(session, lead, deal_profile("Rival", 0.9, hubspot_id="1"))
    out = await similar_for(session, lead.id)
    assert out.basis == "none"
    assert out.note == NO_PROFILE_NOTE
    assert (out.deals, out.leads) == ([], [])
    assert "no company profile" in NO_PROFILE_NOTE


@db
async def test_an_unknown_lead_is_a_404(session: AsyncSession) -> None:
    with pytest.raises(Problem) as caught:
        await similar_for(session, uuid.uuid4())
    assert caught.value.status == 404


@db
async def test_the_own_profile_is_found_by_lead_id_or_job_id(session: AsyncSession) -> None:
    by_job, by_lead = make_lead("ByJob"), make_lead("ByLead")
    job_item = lead_profile(by_job)
    lead_item = make_profile("Other name", meta={"lead_id": str(by_lead.id)})
    await add_all(session, by_job, by_lead, job_item, lead_item)
    found_job = await own_profile(session, by_job)
    found_lead = await own_profile(session, by_lead)
    assert found_job is not None and found_job.id == job_item.id
    assert found_lead is not None and found_lead.id == lead_item.id


@db
async def test_a_profile_with_no_lead_id_is_found_by_the_company_name(
    session: AsyncSession,
) -> None:
    lead = make_lead("Acme Pty Ltd")  # company_key: acme
    plain = make_profile("ACME PTY LTD")  # no ids, same name in capitals
    await add_all(session, lead, plain)
    found = await own_profile(session, lead)
    assert found is not None and found.id == plain.id
    keyed = make_lead("Beta Group Pty Ltd")
    by_key = make_profile("beta group")  # the cleaned name
    await add_all(session, keyed, by_key)
    found_key = await own_profile(session, keyed)
    assert found_key is not None and found_key.id == by_key.id


@db
async def test_the_profile_of_another_researchs_lead_is_never_borrowed(
    session: AsyncSession,
) -> None:
    """Acme was researched twice. Only the first research saved a profile. The second lead must
    not use it: it says nothing was found."""
    older, newer = make_lead("Acme"), make_lead("Acme")
    await add_all(session, older, newer, lead_profile(older))
    out = await similar_for(session, newer.id)
    assert out.basis == "none"
    assert (await similar_for(session, older.id)).basis == "profile"


@db
async def test_the_newest_profile_of_a_lead_is_used(session: AsyncSession) -> None:
    lead = make_lead("Acme")
    old, new = lead_profile(lead, 0.5), lead_profile(lead, 1.0)
    await add_all(session, lead, old)
    await add_all(session, new)  # saved later
    found = await own_profile(session, lead)
    assert found is not None and found.id == new.id


# --- HubSpot companies with a deal -------------------------------------------------------------


async def hubspot_world(session: AsyncSession) -> Lead:
    lead = make_lead("Acme Software")
    won = deal_profile(
        "Won Co", 0.9, hubspot_id="101", cities=["Melbourne", "Perth"], industry="Software"
    )
    open_ = deal_profile("Open Co", 0.5, hubspot_id="102", deal_status="dissolved")
    no_deal = deal_profile("No Deal Co", 0.99, hubspot_id="103", has_deal=False)
    elsewhere = make_profile("Not HubSpot", 0.98, meta={"hubspot_id": "104", "has_deal": True})
    await add_all(
        session,
        lead,
        lead_profile(lead, 1.0),
        won,
        open_,
        no_deal,
        elsewhere,
        HubSpotCompany(hubspot_id="101", name="Won Co", source="export"),
        HubSpotCompany(hubspot_id="102", name="Open Co", source="export"),
    )
    session.add_all(
        [
            HubSpotDeal(
                hubspot_deal_id="1", hubspot_company_id="101", name="Won - 2,500 m2", stage="Won"
            ),
            HubSpotDeal(
                hubspot_deal_id="2", hubspot_company_id="101", name="Won - second", stage="Verified"
            ),
            HubSpotDeal(
                hubspot_deal_id="3",
                hubspot_company_id="102",
                name="Open - fit-out",
                stage="Dissolved",
            ),
        ]
    )
    await session.commit()
    return lead


@db
async def test_look_alike_deals_are_ranked_and_only_companies_with_a_deal(
    session: AsyncSession,
) -> None:
    lead = await hubspot_world(session)
    out = await similar_for(session, lead.id)
    assert out.basis == "profile" and out.note is None
    assert [(d.name, d.similarity) for d in out.deals] == [("Won Co", 0.9), ("Open Co", 0.5)]
    won = out.deals[0]
    assert (won.hubspot_id, won.city, won.industry, won.deal_status) == (
        "101",
        "Melbourne, Perth",
        "Software",
        "open",
    )
    assert sorted(won.deal_names) == ["Won - 2,500 m2", "Won - second"]
    assert out.deals[1].deal_names == ["Open - fit-out"]
    assert out.deals[1].deal_status == "dissolved"
    assert out.leads == []  # no other lead has a profile


@db
async def test_a_deal_company_without_deal_rows_has_no_deal_names(session: AsyncSession) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead, lead_profile(lead), deal_profile("Lone Co", 0.7, hubspot_id="9"))
    [deal] = (await similar_for(session, lead.id)).deals
    assert deal.deal_names == []


@db
async def test_similarity_is_rounded_to_three_places(session: AsyncSession) -> None:
    lead = make_lead("Acme")
    await add_all(
        session,
        lead,
        lead_profile(lead),
        deal_profile("Down", 0.8764, hubspot_id="1"),
        deal_profile("Up", 0.8766, hubspot_id="2"),
    )
    out = await similar_for(session, lead.id)
    assert [d.similarity for d in out.deals] == [0.877, 0.876]


@db
async def test_a_hubspot_id_saved_as_a_number_still_works_and_a_missing_one_is_skipped(
    session: AsyncSession,
) -> None:
    lead = make_lead("Acme")
    numeric = deal_profile("Numeric", 0.9, hubspot_id="x")
    numeric.meta = {**numeric.meta, "hubspot_id": 42}
    nameless = deal_profile("No id", 0.8, hubspot_id="y")
    nameless.meta = {"has_deal": True}
    await add_all(session, lead, lead_profile(lead), numeric, nameless)
    out = await similar_for(session, lead.id)
    assert [(d.name, d.hubspot_id) for d in out.deals] == [("Numeric", "42")]


@db
async def test_the_limit_applies_to_each_list(session: AsyncSession) -> None:
    lead = make_lead("Acme")
    deals = [deal_profile(f"Deal {n}", 0.9 - n / 100, hubspot_id=str(n)) for n in range(8)]
    others = [make_lead(f"Other {n}") for n in range(8)]
    await add_all(session, lead, lead_profile(lead), *deals, *others)
    await add_all(session, *[lead_profile(o, 0.9 - n / 100) for n, o in enumerate(others)])
    default = await similar_for(session, lead.id)
    assert (len(default.deals), len(default.leads)) == (5, 5)
    two = await similar_for(session, lead.id, limit=2)
    assert [d.name for d in two.deals] == ["Deal 0", "Deal 1"]
    assert [item.name for item in two.leads] == ["Other 0", "Other 1"]
    assert len((await similar_for(session, lead.id, limit=0)).deals) == 1  # at least one


@db
async def test_nearer_items_that_are_not_profiles_cannot_push_deal_companies_out(
    session: AsyncSession,
) -> None:
    """A vector index could take the nearest items of ALL memory first and filter afterwards,
    and return nothing here. The filters must come first. (Postgres chooses its plan by table
    size, so this guard can only fail where a plan uses the index.)"""
    lead = make_lead("Acme")
    notes = [
        MemoryItem(
            app="lead_finder",
            kind="source_note",
            subject=f"N{n}",
            content="x",
            embedding=vector(0.99),
        )
        for n in range(150)
    ]
    await add_all(
        session, lead, lead_profile(lead), deal_profile("Far Co", 0.2, hubspot_id="1"), *notes
    )
    await session.execute(text("SET enable_seqscan = off"))
    try:
        out = await similar_for(session, lead.id)
    finally:
        await session.execute(text("RESET enable_seqscan"))
    assert [d.name for d in out.deals] == ["Far Co"]


# --- Other leads -------------------------------------------------------------------------------


@db
async def test_look_alike_leads_are_ranked_and_leave_out_itself_tests_and_the_same_company(
    session: AsyncSession,
) -> None:
    lead = make_lead("Acme Software", score=70)
    near = make_lead("Near Co", result="pass", score=81)
    far = make_lead("Far Co", result="watch", score=33)
    test = make_lead("Test Co", is_test=True)
    again = make_lead("Acme Software")  # the same company, researched again
    await add_all(session, lead, near, far, test, again)
    await add_all(
        session,
        lead_profile(lead, 1.0),
        lead_profile(near, 0.8),
        lead_profile(far, 0.6),
        lead_profile(test, 0.97),
        lead_profile(again, 0.99),
    )
    out = await similar_for(session, lead.id)
    assert [
        (item.lead_id, item.name, item.result, item.score, item.similarity) for item in out.leads
    ] == [
        (near.id, "Near Co", "pass", 81, 0.8),
        (far.id, "Far Co", "watch", 33, 0.6),
    ]
    assert out.deals == []


@db
async def test_a_company_researched_twice_shows_once_as_its_newest_research(
    session: AsyncSession,
) -> None:
    lead = make_lead("Acme")
    old, new = make_lead("Rival", score=10), make_lead("Rival", score=99)
    await add_all(session, lead, old, new)
    await add_all(session, lead_profile(lead, 1.0), lead_profile(old, 0.9), lead_profile(new, 0.7))
    [item] = (await similar_for(session, lead.id)).leads
    assert (item.lead_id, item.score) == (new.id, 99)  # the newest research is shown
    assert item.similarity == 0.9  # with the nearer of its two profiles


@db
async def test_profiles_of_deleted_leads_and_of_other_apps_are_ignored(
    session: AsyncSession,
) -> None:
    lead = make_lead("Acme")
    gone = make_profile("Gone Co", 0.95, meta={"job_id": str(uuid.uuid4())})
    other_app = make_profile(
        "Other App", 0.96, app="other_project", meta={"job_id": str(uuid.uuid4())}
    )
    await add_all(session, lead, lead_profile(lead), gone, other_app)
    assert (await similar_for(session, lead.id)).leads == []


@db
async def test_a_profile_with_no_lead_id_shows_its_companys_newest_real_lead(
    session: AsyncSession,
) -> None:
    lead = make_lead("Acme")
    rival = make_lead("Rival Pty Ltd", score=44)
    only_test = make_lead("Secret Co", is_test=True)
    await add_all(
        session,
        lead,
        rival,
        only_test,
        lead_profile(lead),
        make_profile("Rival", 0.8),  # saved by a writer that names no lead
        make_profile("Secret Co", 0.9),
        make_profile("Nobody Co", 0.85),  # no lead at all
    )
    out = await similar_for(session, lead.id)
    assert [(i.name, i.score, i.similarity) for i in out.leads] == [("Rival Pty Ltd", 44, 0.8)]


@db
async def test_the_two_lists_do_not_mix_hubspot_profiles_into_leads(session: AsyncSession) -> None:
    lead = make_lead("Acme")
    await add_all(session, lead, lead_profile(lead), deal_profile("Won Co", 0.99, hubspot_id="1"))
    out = await similar_for(session, lead.id)
    assert [d.name for d in out.deals] == ["Won Co"]
    assert out.leads == []


@db
async def test_lookalike_functions_work_on_a_profile_directly(session: AsyncSession) -> None:
    lead = make_lead("Acme")
    profile = lead_profile(lead)
    await add_all(session, lead, profile, deal_profile("Won Co", 0.7, hubspot_id="1"))
    assert [d.name for d in await deal_lookalikes(session, profile, 5)] == ["Won Co"]
    assert await lead_lookalikes(session, lead, profile, 5) == []
