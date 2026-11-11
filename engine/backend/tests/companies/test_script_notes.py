"""Script edits and style notes (PLAN-V14 T1-3):

- a line edit is private: one person never sees another's, and Reset brings back the draft;
- a line or a note with an email address or a phone number is refused, as are bad slots and
  text over the limits;
- Your style saves, and an empty text clears it;
- a team note waits for an Admin; a non-Admin gets 403 on approve, reject and retire; an Admin's
  own note is active at once; a rejected note stays visible to its author;
- the team style holds at most 8 active notes;
- a retired note leaves the notes the next prompt gets.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest

from apps.companies.script_notes import notes_for_prompt
from tests.companies.helpers import API, person, signed_in_as
from tests.core.auth_world import World, sign_in

pytestmark = pytest.mark.integration
EDITS = f"{API}/script-edits"
STYLE = f"{API}/script-style"
CALL = {"company_key": "101", "contact_id": "c1"}


@asynccontextmanager
async def as_admin(world: World, login: str = "alkhair") -> AsyncIterator[httpx.AsyncClient]:
    await person(world, login, apps=[], role="admin")
    async with world.browser() as client:
        assert (await sign_in(client, login=login)).status_code == 200
        yield client


async def edits(client: httpx.AsyncClient, **call: Any) -> list[dict[str, Any]]:
    response = await client.get(EDITS, params=call or CALL)
    assert response.status_code == 200, response.text
    found: list[dict[str, Any]] = response.json()
    return found


async def save(client: httpx.AsyncClient, slot: str, text: str, **call: Any) -> httpx.Response:
    return await client.put(EDITS, json={**(call or CALL), "slot": slot, "text": text})


# --- Line edits ---------------------------------------------------------------------------------


async def test_my_lines_are_mine_only_and_reset_brings_back_the_draft(world: World) -> None:
    async with (
        signed_in_as(world, "mia", ["companies"]) as mia,
        signed_in_as(world, "lena", ["companies"]) as lena,
    ):
        saved = await save(mia, "opener.0", "Hi Jason,   it's Mia from Contour.")
        assert saved.status_code == 200, saved.text
        assert saved.json()["text"] == "Hi Jason, it's Mia from Contour."
        assert (await save(mia, "goal", "Book a site visit.")).status_code == 200
        # The same slot again replaces it.
        assert (await save(mia, "opener.0", "Hi Jason, Mia here.")).status_code == 200
        assert [(e["slot"], e["text"]) for e in await edits(mia)] == [
            ("goal", "Book a site visit."),
            ("opener.0", "Hi Jason, Mia here."),
        ]
        # Lena calls the same person and sees none of Mia's lines.
        assert await edits(lena) == []
        # A cold call to the same company is another call.
        assert await edits(mia, company_key="101") == []
        assert (
            await save(mia, "goal", "Ask for the property manager.", company_key="101")
        ).status_code == 200
        assert [e["slot"] for e in await edits(mia, company_key="101")] == ["goal"]
        # Reset: the slot is gone, the rest stays. Resetting nothing is fine too.
        reset = await mia.delete(EDITS, params={**CALL, "slot": "opener.0"})
        assert reset.status_code == 204
        assert (await mia.delete(EDITS, params={**CALL, "slot": "why_now.2"})).status_code == 204
        assert [e["slot"] for e in await edits(mia)] == ["goal"]


async def test_contact_details_bad_slots_and_long_lines_are_refused(world: World) -> None:
    async with signed_in_as(world, "mia", ["companies"]) as mia:
        for text in ("Email jason@abclogistics.com.au first.", "Ring him on 0412 345 678."):
            refused = await save(mia, "opener.0", text)
            assert refused.status_code == 422 and refused.json()["code"] == "contact_details"
        for slot in ("opener.5", "goal.0", "pitch", "question."):
            assert (await save(mia, slot, "Hi.")).status_code == 422
        assert (await save(mia, "goal", "x" * 401)).status_code == 422
        assert (await save(mia, "goal", "   ")).status_code == 422
        bad_key = await mia.put(EDITS, json={"company_key": "x y", "slot": "goal", "text": "Hi."})
        assert bad_key.status_code == 404
        assert await edits(mia) == []


async def test_without_the_companies_tick_nothing_opens(world: World) -> None:
    async with signed_in_as(world, "otto", ["lead_finder"]) as otto:
        assert (await otto.get(EDITS, params=CALL)).status_code == 403
        assert (await otto.get(STYLE)).status_code == 403


# --- Style notes --------------------------------------------------------------------------------


async def test_my_style_saves_and_an_empty_text_clears_it(world: World) -> None:
    async with (
        signed_in_as(world, "mia", ["companies"]) as mia,
        signed_in_as(world, "lena", ["companies"]) as lena,
    ):
        first = (await mia.get(STYLE)).json()
        assert first["mine"] == "" and first["team"] == [] and first["can_decide"] is False
        assert (first["mine_max_chars"], first["team_max_chars"], first["team_max_notes"]) == (
            600,
            200,
            8,
        )
        saved = await mia.put(
            f"{STYLE}/mine", json={"text": "Short openers.\n\nAsk for two minutes first."}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["mine"] == "Short openers.\nAsk for two minutes first."
        assert (await lena.get(STYLE)).json()["mine"] == ""  # Lena's own is still empty
        refused = await mia.put(f"{STYLE}/mine", json={"text": "Call me on 0412 345 678."})
        assert refused.status_code == 422 and refused.json()["code"] == "contact_details"
        assert (await mia.put(f"{STYLE}/mine", json={"text": "x" * 601})).status_code == 422
        cleared = await mia.put(f"{STYLE}/mine", json={"text": ""})
        assert cleared.json()["mine"] == "" and cleared.json()["mine_updated_at"] is None


async def test_a_team_note_waits_for_an_admin(world: World) -> None:
    async with (
        signed_in_as(world, "mia", ["companies"]) as mia,
        as_admin(world) as admin,
    ):
        suggested = await mia.post(f"{STYLE}/team", json={"text": "Ask for two minutes first."})
        assert suggested.status_code == 201, suggested.text
        view = suggested.json()
        assert view["team"] == []
        [waiting] = view["suggestions"]
        assert (waiting["status"], waiting["suggested_by"]) == ("suggested", "Mia")
        note = waiting["id"]
        # Mia may not decide.
        for path in (f"{STYLE}/team/{note}/approve", f"{STYLE}/team/{note}/reject"):
            denied = await mia.post(path)
            assert denied.status_code == 403 and denied.json()["code"] == "admin_only"
        assert (await mia.delete(f"{STYLE}/team/{note}")).status_code == 403
        # The Admin sees it waiting and approves it.
        seen = (await admin.get(STYLE)).json()
        assert seen["can_decide"] is True and [s["id"] for s in seen["suggestions"]] == [note]
        approved = await admin.post(f"{STYLE}/team/{note}/approve")
        assert approved.status_code == 200
        assert [(t["text"], t["decided_by"]) for t in approved.json()["team"]] == [
            ("Ask for two minutes first.", "Alkhair")
        ]
        again = await admin.post(f"{STYLE}/team/{note}/approve")
        assert again.status_code == 409 and again.json()["code"] == "already_decided"
        assert [t["id"] for t in (await mia.get(STYLE)).json()["team"]] == [note]
        # An Admin's own note is active at once (TBC).
        own = await admin.post(f"{STYLE}/team", json={"text": "No jargon."})
        assert [t["text"] for t in own.json()["team"]] == [
            "Ask for two minutes first.",
            "No jargon.",
        ]
        # A rejected note stays visible to its author, as rejected.
        other = (await mia.post(f"{STYLE}/team", json={"text": "Always mention the price."})).json()
        other_id = other["suggestions"][0]["id"]
        await admin.post(f"{STYLE}/team/{other_id}/reject")
        mine = (await mia.get(STYLE)).json()
        assert [(s["text"], s["status"]) for s in mine["suggestions"]] == [
            ("Always mention the price.", "rejected")
        ]
        assert (await admin.get(STYLE)).json()["suggestions"] == []  # nothing waiting
        # Retire: it leaves the team, and only an active note can be retired.
        retired = await admin.delete(f"{STYLE}/team/{note}")
        assert [t["text"] for t in retired.json()["team"]] == ["No jargon."]
        twice = await admin.delete(f"{STYLE}/team/{note}")
        assert twice.status_code == 409 and twice.json()["code"] == "not_active"
        gone = await admin.post(f"{STYLE}/team/00000000-0000-0000-0000-000000000001/approve")
        assert gone.status_code == 404


async def test_the_team_style_holds_eight_notes_and_waiting_is_capped(world: World) -> None:
    async with (
        signed_in_as(world, "mia", ["companies"]) as mia,
        as_admin(world) as admin,
    ):
        for number in range(8):
            assert (
                await admin.post(f"{STYLE}/team", json={"text": f"Note {number}."})
            ).status_code == 201
        full = await admin.post(f"{STYLE}/team", json={"text": "One too many."})
        assert full.status_code == 409 and full.json()["code"] == "team_style_full"
        waiting = (await mia.post(f"{STYLE}/team", json={"text": "A ninth idea."})).json()
        approve = await admin.post(f"{STYLE}/team/{waiting['suggestions'][0]['id']}/approve")
        assert approve.status_code == 409 and approve.json()["code"] == "team_style_full"
        for number in range(4):
            assert (
                await mia.post(f"{STYLE}/team", json={"text": f"Idea {number}."})
            ).status_code == 201
        capped = await mia.post(f"{STYLE}/team", json={"text": "A sixth waiting."})
        assert capped.status_code == 409 and capped.json()["code"] == "too_many_waiting"


async def test_the_next_prompt_gets_the_team_notes_and_my_style(world: World) -> None:
    async with (
        signed_in_as(world, "mia", ["companies"]) as mia,
        as_admin(world) as admin,
    ):
        await mia.put(f"{STYLE}/mine", json={"text": "Short openers."})
        first = (await admin.post(f"{STYLE}/team", json={"text": "Ask for two minutes."})).json()
        await admin.post(f"{STYLE}/team", json={"text": "No jargon."})
        mia_id = uuid.UUID((await mia.get("/api/v1/auth/me")).json()["user"]["id"])
        async with world.factory() as db:
            notes = await notes_for_prompt(db, mia_id)
            ahead = await notes_for_prompt(db, None, with_mine=False)
        assert (
            notes.team == ("Ask for two minutes.", "No jargon.") and notes.mine == "Short openers."
        )
        assert ahead.team == notes.team and ahead.mine is None
        await admin.delete(f"{STYLE}/team/{first['team'][0]['id']}")
        async with world.factory() as db:
            assert (await notes_for_prompt(db, mia_id)).team == ("No jargon.",)
