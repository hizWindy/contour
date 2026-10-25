"""Memory: a saved note can be found by meaning, not just by matching words.

Integration tests. They need the database, and the first run downloads the memory model.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core.memory.embedder import get_embedder
from core.memory.service import remember, search

pytestmark = pytest.mark.integration

NOTES = {
    "ABC Dairy": "ABC Dairy is moving its Melbourne head office to Docklands next year.",
    "XYZ Mining": "XYZ Mining won a $200M haul road contract in the Pilbara.",
    "Example Software": "Example Software opens an Adelaide hub and plans to hire 50 developers.",
}


async def save_notes(session: AsyncSession) -> None:
    for subject, content in NOTES.items():
        await remember(
            session,
            get_embedder(),
            app="lead_finder",
            kind="source_note",
            content=content,
            subject=subject,
        )


async def test_a_note_is_found_by_meaning(session: AsyncSession) -> None:
    await save_notes(session)

    hits = await search(session, get_embedder(), "dairy company relocating offices in Melbourne")

    assert hits[0].item.subject == "ABC Dairy"
    assert hits[0].similarity > hits[1].similarity


async def test_search_can_be_limited_to_a_project_and_kind(session: AsyncSession) -> None:
    await save_notes(session)
    await remember(
        session, get_embedder(), app="other_project", kind="note", content=NOTES["ABC Dairy"]
    )

    hits = await search(
        session,
        get_embedder(),
        "dairy office move",
        app="lead_finder",
        kind="source_note",
        limit=10,
    )

    assert len(hits) == 3
    assert {hit.item.app for hit in hits} == {"lead_finder"}
