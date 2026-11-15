"""Property records: what Property Daily and Arealytics told us about a company's office.

PLAN-V16, the contract part 1. Track 2 makes them (the connectors and `reader.py`). Track 1 reads
them (the research and the lead card), and the lead card sends `CompanyProperty` to the website.
A change to these shapes is a change to the plan's contract.

Every record keeps three rules:
- `summary` is one plain sentence written by our code, never text copied from the page.
- No email address, no phone number and no person's name (TBC with Levi). The connectors drop them.
- It has the link it came from (`url`) and the time we read it (`read_at`).
"""

from datetime import date, datetime
from typing import Final, Literal

from pydantic import Field, field_validator

from core.api.models import OutModel

SourceId = Literal["property_daily", "arealytics"]
SOURCE_IDS: Final[tuple[SourceId, ...]] = ("property_daily", "arealytics")
SOURCE_NAMES: Final[dict[SourceId, str]] = {
    "property_daily": "Property Daily",
    "arealytics": "Arealytics",
}

# lease: a lease and its dates. move: the company moved, or will. requirement: it is looking for
# space. fitout: a fitout, done or awarded. building: facts about the building. occupier: the
# company is a tenant there. news: a market news item about the company.
RecordKind = Literal["lease", "move", "requirement", "fitout", "building", "occupier", "news"]

# found: the tool has records. not_found: it was asked and has none. off: its switch is off.
# error: asking failed (the lookup never raises; this says so). not_checked: not asked yet.
SourceStatus = Literal["found", "not_found", "off", "error", "not_checked"]


class PropertyRecord(OutModel):
    """One fact a tool gave us about a company's office, with its link and date."""

    source: SourceId
    kind: RecordKind
    company: str = Field(min_length=1, max_length=300, description="As the tool wrote it")
    city: str | None = None
    address: str | None = None
    building: str | None = None
    floor: str | None = Field(None, description='As written, like "Level 12" or "12-14"')
    area_m2: int | None = Field(None, ge=0, description="Whole square metres")
    lease_start: date | None = None
    lease_end: date | None = None
    happened_on: date | None = Field(None, description="When the move, lease or fitout happened")
    published_on: date | None = Field(None, description="When the tool published the item")
    summary: str = Field(
        min_length=1,
        max_length=500,
        description="One plain sentence, written by our code",
        examples=["Leased 1,400 m² on level 12 of 120 Collins Street, ending in June 2028."],
    )
    url: str = Field(description="The page the fact came from")
    read_at: datetime = Field(description="When we read it")

    @field_validator("url")
    @classmethod
    def _a_web_link(cls, value: str) -> str:
        """The card shows it as a link, so it is a web address and nothing else."""
        link = value.strip()
        if not link.startswith(("https://", "http://")):
            raise ValueError("url must be a web address that starts with https:// or http://")
        return link


class SourceChecks(OutModel):
    """Where each tool stands for this company."""

    property_daily: SourceStatus = "not_checked"
    arealytics: SourceStatus = "not_checked"


class CompanyProperty(OutModel):
    """Everything both tools know about one company's office, from our copy."""

    records: list[PropertyRecord] = Field(
        default_factory=list,
        description="Newest first: by happened_on, else published_on, else lease_start",
    )
    checked: SourceChecks = Field(default_factory=SourceChecks)
    looked_up_at: datetime | None = Field(
        None, description="The last live lookup of either tool. None: never looked up"
    )


class FeedItem(PropertyRecord):
    """A new item from a tool's feed, for discovery: a record, and what it means for us."""

    sign_id: str | None = Field(
        None, description="Our sign for it, a trigger id like lease_ending, or None"
    )
    dampener_id: str | None = Field(None, description="Our dampener for it, or None")
