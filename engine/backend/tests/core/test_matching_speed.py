"""PLAN-V15 T1-4: matching loads our copy once and scores in one batch, a rebuild embeds only
changed texts, and a second rebuild from the website is refused at once."""

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import Settings
from core.hubspot import matching
from core.hubspot.profiles import REBUILD_LOCK, RebuildRunning, rebuild_profiles
from core.hubspot.sync import begin, run
from tests.core.test_hubspot_sync import CountingEmbedder, contour

pytestmark = pytest.mark.integration
SETTINGS = Settings()


async def full_sync(sessions: async_sessionmaker[AsyncSession], fake, embedder) -> None:  # type: ignore[no-untyped-def]
    plan = await begin(sessions, trigger="command", mode="full", settings=SETTINGS)
    out = await run(plan, sessions=sessions, hubspot=fake, embedder=embedder)
    assert out.status == "done"


async def test_a_sync_with_nothing_changed_embeds_nothing_again(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    first, second = CountingEmbedder(), CountingEmbedder()
    await full_sync(session_factory, contour(), first)
    await full_sync(session_factory, contour(), second)
    assert len(first.texts) == 3 and second.texts == []


async def test_a_changed_company_is_embedded_again_and_the_others_are_kept(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await full_sync(session_factory, contour(), CountingEmbedder())
    changed = contour()
    changed.add_company("102", name="Beta Law", industry="LEGAL_SERVICES", hubspot_owner_id="11")
    again = CountingEmbedder()
    await full_sync(session_factory, changed, again)
    assert len(again.texts) == 1 and "Beta Law" in again.texts[0]


async def test_a_second_rebuild_is_refused_at_once_when_asked_not_to_wait(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    async with session_factory() as holder:
        await holder.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": REBUILD_LOCK})
        with pytest.raises(RebuildRunning):
            await rebuild_profiles(session, CountingEmbedder(), wait=False)  # type: ignore[arg-type]
        await holder.rollback()  # lets the lock go
    assert await rebuild_profiles(session, CountingEmbedder(), wait=False) == 0  # type: ignore[arg-type]


async def test_the_rebuild_route_answers_409_while_another_runs(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    from core.api.app import create_app
    from core.memory.embedder import get_embedder

    app = create_app()
    app.dependency_overrides[get_embedder] = lambda: CountingEmbedder()
    transport = httpx.ASGITransport(app=app)
    async with session_factory() as holder:
        await holder.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": REBUILD_LOCK})
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
            answer = await client.post("/api/v1/hubspot/profiles/rebuild")
        await holder.rollback()
    assert (answer.status_code, answer.json()["code"]) == (409, "rebuild_running")


async def test_matching_loads_the_copy_once_until_it_changes(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    await full_sync(session_factory, contour(), CountingEmbedder())
    matching.forget_loaded_copy()
    builds: list[int] = []
    real_build = matching._build

    def counting_build(*args, **kwargs):  # type: ignore[no-untyped-def]
        builds.append(1)
        return real_build(*args, **kwargs)

    monkeypatch.setattr(matching, "_build", counting_build)
    async with session_factory() as session:
        first = await matching.match_company(session, "Acme Logistics")
        again = await matching.match_company(session, "Gamma Soft Pty Ltd")
    assert (first.status, again.status, len(builds)) == ("dissolved_deal", "in_hubspot", 1)

    changed = contour()
    changed.add_company("104", name="Delta Build")
    await full_sync(session_factory, changed, CountingEmbedder())
    async with session_factory() as session:
        found = await matching.match_company(session, "Delta Build")
    assert found.status == "in_hubspot" and len(builds) == 2  # the new company is seen


async def test_the_batch_scores_are_the_pair_by_pair_scores(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    fake = contour()
    fake.add_company("104", name="Acme Logistic Services")
    fake.add_company("105", name="The Reject Shop")
    fake.add_deal("506", "105", dealname="Dollarama - Melbourne - New Office", dealstage="x")
    await full_sync(session_factory, fake, CountingEmbedder())
    matching.forget_loaded_copy()
    async with session_factory() as session:
        copy = await matching._load(session)
    for names in (["Acme Logistcs"], ["Dollarama Australia"], ["Beta Laws", "Gama Soft"]):
        pairwise = []
        for item in copy.known:
            in_deals = max(
                (
                    matching.close_name_score(
                        name,
                        matching.deal_lead(deal.name),
                        matching.DEFAULT_FUZZY_MIN,
                        extra_generic=matching.DEAL_WORDS,
                    )
                    or 0
                    for deal in item.deals
                    for name in names
                ),
                default=0,
            )
            if in_deals:
                pairwise.append((item.row.hubspot_id, "name_in_deal", in_deals))
            by_name = max(
                (
                    matching.close_name_score(name, item.row.name, matching.DEFAULT_FUZZY_MIN) or 0
                    for name in names
                ),
                default=0,
            )
            if by_name:
                pairwise.append((item.row.hubspot_id, "close_name", by_name))
        batch = [
            (found.hubspot_id, found.reason, round(found.score * 100))
            for found in matching._loose_candidates(copy, names, matching.DEFAULT_FUZZY_MIN)
        ]
        assert sorted(batch) == sorted(pairwise), names
        assert batch or names == ["Beta Laws", "Gama Soft"]
