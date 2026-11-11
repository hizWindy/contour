"""Tone presets (PLAN-V15 T3-5):

- Friendly until an Admin picks another team default; the four presets come with the style;
- a person's tone beats the team's, and null follows the team again;
- a non-Admin gets 403 on the team tone;
- the prompt has the tone line before the team's notes and the caller's own;
- Claude's tone line reaches the script, and a prep says which tone and stage it was written for;
- a tone change never starts a prep: a ready one is still reused, free.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import func, select

from apps.companies.prep import PrepRunner
from apps.companies.tables import Prep
from core.api.deps import settings_dependency
from tests.companies.helpers import API, signed_in_as
from tests.companies.test_prep import (
    FakeClaude,
    ask_and_finish,
    people_and_calls,
    prep_settings,
)
from tests.companies.test_script_notes import as_admin
from tests.core.auth_world import World
from tests.lead_finder.factories import FakeEmbedder

pytestmark = pytest.mark.integration
STYLE = f"{API}/script-style"
PREPS = f"{API}/preps"


@pytest.fixture
def claude() -> FakeClaude:
    return FakeClaude()


@pytest.fixture
def runner(world: World, claude: FakeClaude) -> PrepRunner:
    made = PrepRunner(sessions=world.factory, claude=lambda: claude, embedder=FakeEmbedder)
    world.app.state.prep_runner = made
    return made


@pytest.fixture
def prep_on(world: World) -> Iterator[None]:
    world.app.dependency_overrides[settings_dependency] = lambda: prep_settings()
    yield


async def test_friendly_until_an_admin_picks_and_mine_beats_the_teams(world: World) -> None:
    async with (
        as_admin(world) as admin,
        signed_in_as(world, "mia", ["companies"]) as mia,
        signed_in_as(world, "lena", ["companies"]) as lena,
    ):
        tone = (await mia.get(STYLE)).json()["tone"]
        assert tone["mine"] is None and tone["team"] == "friendly"
        assert [choice["key"] for choice in tone["choices"]] == [
            "friendly",
            "direct",
            "consultative",
            "formal",
        ]
        assert tone["choices"][1] == {
            "key": "direct",
            "label": "Direct",
            "line": "Short sentences, the reason first, no small talk.",
        }
        # A non-Admin can't set the team's tone.
        refused = await mia.put(f"{STYLE}/team-tone", json={"tone": "direct"})
        assert refused.status_code == 403
        assert refused.json()["code"] == "admin_only"
        set_team = await admin.put(f"{STYLE}/team-tone", json={"tone": "formal"})
        assert set_team.status_code == 200, set_team.text
        assert set_team.json()["tone"]["team"] == "formal"
        # Mia picks her own; Lena follows the team.
        mine = await mia.put(f"{STYLE}/tone", json={"tone": "direct"})
        assert mine.json()["tone"] == {**mine.json()["tone"], "mine": "direct", "team": "formal"}
        assert (await lena.get(STYLE)).json()["tone"]["mine"] is None
        # Null follows the team again.
        back = await mia.put(f"{STYLE}/tone", json={"tone": None})
        assert back.json()["tone"]["mine"] is None
        assert (await mia.put(f"{STYLE}/tone", json={"tone": "loud"})).status_code == 422


@pytest.mark.usefixtures("prep_on")
async def test_the_prompt_starts_the_style_with_the_tone_and_a_prep_keeps_it(
    world: World, claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    async with as_admin(world) as admin, signed_in_as(world, "mia", ["companies"]) as mia:
        await admin.put(f"{STYLE}/team-tone", json={"tone": "formal"})
        await admin.post(f"{STYLE}/team", json={"text": "Say the lease month."})
        await mia.put(f"{STYLE}/mine", json={"text": "Short openers."})
        await mia.put(f"{STYLE}/tone", json={"tone": "direct"})
        done = await ask_and_finish(mia, runner, contact_id="c1")
    prompt = claude.asked[0]["prompt"]
    # The order: the rules (system), the stage, then the tone, the team's notes, the caller's own.
    assert prompt.index("Relationship stage:") < prompt.index("Style notes.")
    assert prompt.index("Tone: Direct: short sentences") < prompt.index("Team style:")
    assert prompt.index("Team style:") < prompt.index("The caller's own style:")
    assert "Formal" not in prompt  # Mia's own tone beats the team's
    assert done["tone_used"] == "direct"
    assert done["stage_used"] == "open_deal"
    assert done["script"]["tone_line"] == (
        "Warm and brief: you spoke on 1 Oct, so pick up from there."
    )


@pytest.mark.usefixtures("prep_on")
async def test_a_tone_change_never_starts_a_prep(
    world: World, claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as mia:
        first = await ask_and_finish(mia, runner, contact_id="c1")
        assert first["tone_used"] == "friendly"
        changed = await mia.put(f"{STYLE}/tone", json={"tone": "consultative"})
        assert changed.status_code == 200
        await runner.wait()
        again = await mia.post(PREPS, json={"company_key": "101", "contact_id": "c1"})
    assert again.status_code == 200
    assert again.json()["id"] == first["id"] and again.json()["reused"] is True
    assert again.json()["tone_used"] == "friendly"  # the card offers Research again
    async with world.factory() as db:
        assert await db.scalar(select(func.count()).select_from(Prep)) == 1
    assert len(claude.asked) == 1


async def test_the_morning_search_ahead_writes_in_the_teams_tone(world: World) -> None:
    from apps.companies.tones import tone_for

    async with as_admin(world) as admin, signed_in_as(world, "mia", ["companies"]) as mia:
        await admin.put(f"{STYLE}/team-tone", json={"tone": "consultative"})
        await mia.put(f"{STYLE}/tone", json={"tone": "formal"})
    async with world.factory() as db:
        # The search ahead has no asker, so Mia's own tone never reaches it.
        assert await tone_for(db, None, with_mine=False) == "consultative"
