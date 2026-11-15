"""Log meeting (PLAN-V17 T2-15): a past client meeting's transcript becomes a call note.

- **The words:** the rep pastes the transcript, or the website reads a .txt or .vtt file and sends
  its text. The server cleans a .vtt itself: it keeps who said what ("Jo Sample: ..."), and drops
  the header, the cue numbers, the times, the tags, and the NOTE, STYLE and REGION blocks. Text
  only, up to `transcript_max_chars` (60,000, TBC) once cleaned.
- **A call note like any other:** saved through the same path as Log call, with the source
  `transcript` and the meeting it came from (`call_notes.meeting_id`), so Meetings shows "Notes
  logged". It is scrubbed (no email address or phone number is kept), goes through the same
  sorter, and joins the same batch: nothing reaches HubSpot until the rep confirms it.
- **Data, never instructions:** the transcript holds the client's words. The sorter's prompt says
  it is data, and its answer form has no place for anything code would act on, like marking a deal
  won.
- **Only a HubSpot meeting takes a transcript, for now.** A meeting typed in for New pre-read
  isn't in HubSpot, so the rep logs its notes with Log call (TBC).
- Call notes must be on too.
"""

import html
import re
from collections.abc import Sequence
from datetime import datetime
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.meeting_store import MeetingSource, client_meetings, meeting_not_found
from apps.companies.note_store import NewNote, call_notes_off, refused, store_note
from apps.companies.schemas import MeetingTranscriptIn
from apps.companies.tables import CallNote
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads
from core.config import Settings

TEXT_FILES: Final = (".txt", ".vtt")
_TIME = r"(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3}"
VTT_TIMING: Final = re.compile(rf"^\s*{_TIME}\s+-->\s+{_TIME}")
# A tag's repeats have upper limits, so a line full of "<v " with no ">" takes time in step
# with its length: the cleaning runs before the length check, on up to 200,000 characters.
VOICE: Final = re.compile(r"<v(?:\.[^\s>]{0,100})?\s{1,20}([^>]{0,200})>", re.IGNORECASE)
TAGS: Final = re.compile(rf"</?[a-z][^>]{{0,200}}>|<{_TIME}>", re.IGNORECASE)
BLANK_LINE: Final = re.compile(r"\n[ \t]*\n")
METADATA: Final = ("NOTE", "STYLE", "REGION")


def not_past() -> Problem:
    return Problem(
        409,
        "This meeting hasn't happened yet",
        "Log the meeting once it has been.",
        code="meeting_not_past",
    )


def is_vtt(text: str, file_name: str | None) -> bool:
    named = (file_name or "").strip().lower().endswith(".vtt")
    return named or text.lstrip("﻿ \t\r\n").startswith("WEBVTT")


def _spoken(line: str) -> tuple[str | None, str]:
    """Who said a cue's line (from its voice tag, if any), and its words without tags."""
    found = VOICE.search(line)
    who = " ".join(found.group(1).split()) if found is not None else ""
    words = " ".join(html.unescape(TAGS.sub(" ", VOICE.sub(" ", line))).split())
    return who or None, words


def clean_vtt(text: str) -> str:
    """The words of a .vtt transcript: one line each time someone speaks, like "Jo Sample: Hi
    all." A speaker's cues one after another join into one line."""
    spoken: list[tuple[str | None, str]] = []
    plain = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    for block in BLANK_LINE.split(plain):
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines or lines[0].strip().split(" ", 1)[0] in METADATA:
            continue
        timing = next((at for at, line in enumerate(lines) if VTT_TIMING.match(line)), None)
        if timing is None:
            if lines[0].lstrip().startswith("WEBVTT"):
                continue  # the header
            words_lines = lines
        else:
            words_lines = lines[timing + 1 :]  # the cue's number and its times go
        for line in words_lines:
            who, words = _spoken(line)
            if not words:
                continue
            if who is not None and spoken and spoken[-1][0] == who:
                spoken[-1] = (who, f"{spoken[-1][1]} {words}")
            else:
                spoken.append((who, words))
    return "\n".join(f"{who}: {words}" if who else words for who, words in spoken)


def transcript_text(body: MeetingTranscriptIn) -> str:
    """The transcript's words, from pasted text or a .txt or .vtt file's text."""
    name = (body.file_name or "").strip()
    if name and not name.lower().endswith(TEXT_FILES):
        raise refused(
            "Only a text file",
            "Only a .txt or .vtt file can be read here. Paste the words instead.",
            code="transcript_file",
        )
    text = clean_vtt(body.text) if is_vtt(body.text, name) else body.text
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip()


async def log_transcript(
    session: AsyncSession,
    meeting_id: str,
    body: MeetingTranscriptIn,
    auth: AuthContext | None,
    *,
    source: MeetingSource,
    settings: Settings,
    leads: Sequence[CompanyLeads],
    idempotency_key: str | None,
    now: datetime,
) -> tuple[CallNote, bool]:
    """Saves a past client meeting's transcript as a call note linked to the meeting, and says
    whether it is new. The same person and key give back the first note."""
    if not settings.call_notes_enabled:
        raise call_notes_off()
    meeting = await source.get(session, meeting_id)
    found = await client_meetings(session, [meeting] if meeting is not None else [])
    if not found:
        raise meeting_not_found()
    meeting, _ = found[0]
    if meeting.starts_at > now:
        raise not_past()
    text = transcript_text(body)
    if not text:
        raise refused(
            "Nothing to save", "This transcript has no words in it.", code="transcript_empty"
        )
    limit = settings.transcript_max_chars
    if len(text) > limit:
        raise refused(
            "This transcript is too long",
            f"This transcript is longer than {limit:,} characters. Shorten it, or split it into "
            "two.",
            code="transcript_too_long",
        )
    company = meeting.company_id
    if company is None:  # a client meeting always has one: client_meetings keeps no other
        raise meeting_not_found()
    new = NewNote(
        company_key=company,
        text=text,
        source="transcript",
        called_at=meeting.starts_at,
        meeting_id=meeting.id,
    )
    return await store_note(
        session,
        new,
        auth=auth,
        settings=settings,
        leads=leads,
        idempotency_key=idempotency_key,
        now=now,
        max_chars=limit,
    )
