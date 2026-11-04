"""What each project needs from HubSpot, and whether it has it (PLAN-V5 B3).

A project lists the scopes it reads and writes with in its `AppSpec` (`hubspot_needs`). The core
joins those with the connection check, so the Admin page can say, for example: "Lead Finder:
reading ready. Sending waits for crm.objects.companies.write."
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

from core.hubspot.check import ConnectionCheck

ReadState = Literal["ready", "waiting", "unknown"]
WriteState = Literal["ready", "waiting", "off", "unknown", "not_needed"]


@dataclass(frozen=True)
class HubSpotNeeds:
    """The scopes a project needs. `uses` says why, in plain words, for the Admin page."""

    read: tuple[str, ...] = ()
    write: tuple[str, ...] = ()
    uses: str = ""


class ProjectReadiness(BaseModel):
    app: str = Field(description="The project's folder name, like lead_finder")
    title: str = Field(description="The project's name, like Lead Finder")
    uses: str = Field(description="What the project uses HubSpot for")
    reading: ReadState
    sending: WriteState
    waiting_for: list[str] = Field(description="The scopes still missing, reads first")
    summary: str = Field(description="One line for a person, like 'reading ready'")


def readiness(
    app: str,
    title: str,
    needs: HubSpotNeeds,
    check: ConnectionCheck,
    *,
    write_enabled: bool,
) -> ProjectReadiness:
    missing_reads = [s for s in needs.read if check.state_of(s) == "no"]
    unknown_reads = [s for s in needs.read if check.state_of(s) == "unknown"]
    missing_writes = [s for s in needs.write if check.state_of(s) == "no"]
    unknown_writes = [s for s in needs.write if check.state_of(s) == "unknown"]

    reading: ReadState = (
        "waiting" if missing_reads else "unknown" if unknown_reads or not check.key_set else "ready"
    )
    sending: WriteState
    if not needs.write:
        sending = "not_needed"
    elif missing_writes:
        sending = "waiting"
    elif unknown_writes or not check.key_set:
        sending = "unknown"
    elif not write_enabled:
        sending = "off"
    else:
        sending = "ready"

    parts = [_reading_words(reading, missing_reads, check)]
    if sending != "not_needed":
        words = _sending_words(sending, missing_writes)
        parts.append(words[:1].upper() + words[1:])  # a new sentence
    return ProjectReadiness(
        app=app,
        title=title,
        uses=needs.uses,
        reading=reading,
        sending=sending,
        waiting_for=[*missing_reads, *missing_writes],
        summary=f"{title}: {'. '.join(parts)}.",
    )


def _reading_words(state: ReadState, missing: Sequence[str], check: ConnectionCheck) -> str:
    if state == "ready":
        return "reading ready"
    if state == "waiting":
        return f"reading waits for {', '.join(missing)}"
    return "reading not known yet" if check.key_set else "reading needs the HubSpot key"


def _sending_words(state: WriteState, missing: Sequence[str]) -> str:
    if state == "ready":
        return "sending ready"
    if state == "waiting":
        return f"sending waits for {', '.join(missing)}"
    if state == "off":
        return "sending is switched off (HUBSPOT_WRITE_ENABLED)"
    return "sending not known yet"
