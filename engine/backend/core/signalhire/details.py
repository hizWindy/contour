"""A company's details as Signal Hire has them (PLAN-V4 C1).

The lead card shows these, and a saved copy is kept in the database, so a company that costs 1
company credit to read is paid for once a month and not once for each run. Every text here came from
Signal Hire, not from us: the code that builds one cuts and cleans it first
(apps/lead_finder/signalhire_company.py).
"""

from datetime import datetime

from pydantic import BaseModel, Field


class SignalHireOffice(BaseModel):
    city: str | None
    area: str | None
    country: str | None
    head_office: bool


class SignalHireCompany(BaseModel):
    signalhire_id: int
    slug: str = Field(description="Signal Hire's address for the company, like culture-amp")
    name: str = Field(description="The company's name as Signal Hire has it: the checked name")
    website: str | None = Field(description="A bare domain, like cultureamp.com")
    industry: str | None
    linkedin_url: str | None = Field(description="The company's LinkedIn page, from its id")
    staff_count: int | None = Field(
        description="Signal Hire's estimate for the whole company, not for one office"
    )
    staffing_company: bool | None
    offices: list[SignalHireOffice]
    fetched_at: datetime = Field(description="When Signal Hire was asked. A saved copy keeps it.")
