"""Script edits and style notes (PLAN-V14 T1-3), under /api/v1/companies.

- `GET`, `PUT` and `DELETE /script-edits`: my own wording for lines of one call. Private.
- `GET /script-style`: my style, the team's active notes, and the suggestions I may see.
- `PUT /script-style/mine`: my style (an empty text clears it).
- `POST /script-style/team`: suggest a team note (an Admin's own is active at once, TBC).
- `POST /script-style/team/{id}/approve` and `/reject`, `DELETE /script-style/team/{id}`: Admins.
- `PUT /script-style/tone`: my tone preset, or none to follow the team (PLAN-V15 T3-5).
- `PUT /script-style/team-tone`: the team's default tone. Admins.

Each change to a style answers with the whole style, so the website shows it at once. The routes
sit before `/{key}` in the Companies router, so `script-style` is never read as a company key.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query, Response

from apps.companies import script_notes, store, tones
from apps.companies.schemas import (
    SLOT_PATTERN,
    ScriptEditIn,
    ScriptEditOut,
    ScriptStyleOut,
    StyleMineIn,
    StyleNoteIn,
    TeamToneIn,
    ToneIn,
)
from core.api.access import SignedInDep
from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.signin import NowDep

router = APIRouter()

CompanyKey = Annotated[str, Query(min_length=1, max_length=64)]
ContactId = Annotated[str | None, Query(max_length=32, description="None for a cold call")]
NoteId = Annotated[uuid.UUID, Path()]


def _company_not_found() -> Problem:
    return Problem(
        404,
        "Company not found",
        "There is no company with that key here.",
        code="company_not_found",
    )


def _check_key(key: str) -> None:
    if not store.valid_key(key):
        raise _company_not_found()


@router.get(
    "/script-edits",
    response_model=list[ScriptEditOut],
    summary="My own lines for one call",
    description=(
        "The lines I rewrote for a call to this person (or a cold call). Only I see them. The "
        "website lays them over the newest draft, so they survive 'Research again'."
    ),
)
async def list_script_edits(
    session: SessionDep,
    auth: SignedInDep,
    company_key: CompanyKey,
    contact_id: ContactId = None,
) -> list[ScriptEditOut]:
    _check_key(company_key)
    user = script_notes.user_of(auth)
    return await script_notes.my_edits(session, user, company_key, contact_id)


@router.put(
    "/script-edits",
    response_model=ScriptEditOut,
    summary="Save my own line",
    description=(
        "Saves my wording for one slot of one call: `opener.0`, `why_now.1`, `question.2`, "
        "`if_they_say.0` or `goal`. 422 `contact_details` for an email address or a phone number."
    ),
)
async def save_script_edit(
    body: ScriptEditIn, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptEditOut:
    _check_key(body.company_key)
    return await script_notes.save_edit(session, script_notes.user_of(auth), body, now)


@router.delete(
    "/script-edits",
    status_code=204,
    summary="Back to the draft",
    description="Removes my line for this slot, so the draft shows again. Nothing there is fine.",
)
async def reset_script_edit(
    session: SessionDep,
    auth: SignedInDep,
    company_key: CompanyKey,
    slot: Annotated[str, Query(pattern=SLOT_PATTERN)],
    contact_id: ContactId = None,
) -> Response:
    _check_key(company_key)
    user = script_notes.user_of(auth)
    await script_notes.reset_edit(session, user, company_key, contact_id, slot)
    return Response(status_code=204)


@router.get(
    "/script-style",
    response_model=ScriptStyleOut,
    summary="My style and the team's",
    description=(
        "What the next script is written with: my own style, and the team's active notes. An "
        "Admin also gets every waiting suggestion; anyone else gets their own."
    ),
)
async def get_script_style(session: SessionDep, auth: SignedInDep) -> ScriptStyleOut:
    return await script_notes.style_view(session, auth)


@router.put(
    "/script-style/mine",
    response_model=ScriptStyleOut,
    summary="Save my style",
    description=(
        "My own style note, up to 600 characters. An empty text clears it. It goes into my "
        "next scripts as style, never as facts."
    ),
)
async def save_my_style(
    body: StyleMineIn, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    return await script_notes.save_mine(session, auth, body.text, now)


@router.put(
    "/script-style/tone",
    response_model=ScriptStyleOut,
    summary="Save my tone",
    description=(
        "My tone preset: friendly, direct, consultative or formal, or null to follow the team's "
        "default. It goes into my next scripts. It never starts a prep: a ready one is still "
        "reused, and the card offers Research again."
    ),
)
async def save_my_tone(
    body: ToneIn, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    await tones.save_mine(session, script_notes.user_of(auth), body.tone, now)
    return await script_notes.style_view(session, auth)


@router.put(
    "/script-style/team-tone",
    response_model=ScriptStyleOut,
    summary="Save the team's tone",
    description="Admins only. The tone for everyone who hasn't picked their own. 403 `admin_only`.",
)
async def save_team_tone(
    body: TeamToneIn, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    if not script_notes.can_decide(auth):
        raise script_notes.admins_only()
    await tones.save_team(session, body.tone, now)
    return await script_notes.style_view(session, auth)


@router.post(
    "/script-style/team",
    response_model=ScriptStyleOut,
    status_code=201,
    summary="Suggest a team note",
    description=(
        "A note for everyone's scripts, up to 200 characters. It waits for an Admin; an Admin's "
        "own is active at once (TBC). 409 `team_style_full` at 8 active notes, "
        "`too_many_waiting` at 5 of mine waiting."
    ),
)
async def suggest_team_note(
    body: StyleNoteIn, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    return await script_notes.suggest(session, auth, body.text, now)


@router.post(
    "/script-style/team/{note_id}/approve",
    response_model=ScriptStyleOut,
    summary="Approve a team note",
    description="Admins only. The note goes into everyone's next scripts.",
)
async def approve_team_note(
    note_id: NoteId, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    return await script_notes.decide(session, auth, note_id, approve=True, now=now)


@router.post(
    "/script-style/team/{note_id}/reject",
    response_model=ScriptStyleOut,
    summary="Reject a team note",
    description="Admins only. The note stays visible to the one who suggested it, as rejected.",
)
async def reject_team_note(
    note_id: NoteId, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    return await script_notes.decide(session, auth, note_id, approve=False, now=now)


@router.delete(
    "/script-style/team/{note_id}",
    response_model=ScriptStyleOut,
    summary="Retire a team note",
    description="Admins only. The note leaves everyone's next scripts.",
)
async def retire_team_note(
    note_id: NoteId, session: SessionDep, auth: SignedInDep, now: NowDep
) -> ScriptStyleOut:
    return await script_notes.retire(session, auth, note_id, now)
