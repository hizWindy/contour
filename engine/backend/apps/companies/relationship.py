"""Where we stand with a company (PLAN-V15 T3-3): one relationship stage, from our HubSpot copy.

The free script and Claude's script both open from it, so they agree. The first match wins:

| Stage | When |
|---|---|
| open_deal | any open deal |
| customer | a won deal or HubSpot's lifecycle stage "Customer", and a talk in the last 12 months |
| past_customer | a customer with no talk for 12 months or more |
| lost_deal | a deal lost in the last 24 months |
| contacted | a call with anyone there, a Last talk, or contact activity, in the last 24 months |
| cold | none of the above |

A **talk** is the newest of: the company's Last talk, a logged call with anyone there, and a
contact's last activity. "In the last 12 months" counts the day 12 months ago itself.

Pure code: it reads what the company panel holds (`Pieces`) and nothing else. The month limits
are guesses (TBC), kept here so they're easy to change.
"""

import calendar
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final

from apps.companies.schemas import (
    CompanyCall,
    CompanyDeal,
    CompanyDetail,
    CompanyPerson,
    Relationship,
    Source,
)

CUSTOMER_MONTHS: Final = 12  # a customer with a talk this recent is a customer, else a past one
LOST_MONTHS: Final = 24  # a deal lost this recently is a lost deal
CONTACT_MONTHS: Final = 24  # a talk this recent makes them "contacted before"
LIFECYCLE_CUSTOMER: Final = "customer"


def months_before(day: date, months: int) -> date:
    """The same day `months` earlier, or the month's last day when it has no such day."""
    year, month = divmod(day.year * 12 + (day.month - 1) - months, 12)
    last = calendar.monthrange(year, month + 1)[1]
    return date(year, month + 1, min(day.day, last))


def day_words(value: date) -> str:
    """'3 Mar 2026'."""
    return f"{value.day} {value.strftime('%b %Y')}"


@dataclass(frozen=True)
class Pieces:
    """What the stage is worked out from: the parts of the company panel it reads."""

    source: Source
    deals: Sequence[CompanyDeal] = ()
    lifecycle_stage: str | None = None
    last_talk: date | None = None
    calls: Sequence[CompanyCall] = ()
    people: Sequence[CompanyPerson] = ()

    @classmethod
    def of(cls, company: CompanyDetail) -> "Pieces":
        return cls(
            source=company.source,
            deals=company.deals,
            lifecycle_stage=company.lifecycle_stage,
            last_talk=company.last_talk,
            calls=company.calls,
            people=company.people,
        )


@dataclass(frozen=True)
class Talk:
    """The newest talk with the company, and where it shows."""

    on: date
    source: str
    with_whom: str | None = None
    kind: str = "last_talk"  # last_talk, call or activity


def last_talk(company: Pieces) -> Talk | None:
    """The newest of the Last talk, the logged calls and the contacts' last activity."""
    talks: list[Talk] = []
    if company.last_talk is not None:
        talks.append(Talk(company.last_talk, "HubSpot: last contacted"))
    for call in company.calls:
        if call.called_at is not None:
            when = call.called_at.date()
            talks.append(Talk(when, f"HubSpot call, {day_words(when)}", call.person, "call"))
    for person in company.people:
        if person.last_activity is not None:
            when = person.last_activity.date()
            talks.append(Talk(when, "HubSpot contact", person.name, "activity"))
    # Newest first; on the same day a call says most, then a contact's activity.
    order = {"call": 0, "activity": 1, "last_talk": 2}
    talks.sort(key=lambda talk: (-talk.on.toordinal(), order[talk.kind]))
    return talks[0] if talks else None


def _talk_words(talk: Talk) -> str:
    if talk.kind == "call":
        who = f" with {talk.with_whom}" if talk.with_whom else ""
        return f"a call{who} on {day_words(talk.on)}"
    if talk.kind == "activity" and talk.with_whom:
        return f"HubSpot activity with {talk.with_whom} on {day_words(talk.on)}"
    return f"the last talk on record, on {day_words(talk.on)}"


def _newest(deals: Sequence[CompanyDeal], state: str) -> CompanyDeal | None:
    """The deal in this state with the latest close date (undated ones last)."""
    found = [deal for deal in deals if deal.state == state]
    found.sort(
        key=lambda deal: (deal.close_date is None, -(deal.close_date or date.min).toordinal())
    )
    return found[0] if found else None


def relationship_of(company: Pieces, today: date) -> Relationship:
    """The one stage that fits first, with its reason and source in plain words."""
    if company.source != "hubspot":
        return Relationship(
            stage="cold",
            since=None,
            reason="Not in HubSpot yet: the Lead Finder found it.",
            source="Lead Finder",
        )
    open_deal = next((deal for deal in company.deals if deal.state == "open"), None)
    if open_deal is not None:
        at = f", at {open_deal.stage}" if open_deal.stage else ""
        return Relationship(
            stage="open_deal",
            since=None,
            reason=f"Open deal: {open_deal.name}{at}.",
            source="HubSpot deal",
        )
    talk = last_talk(company)
    won = _newest(company.deals, "won")
    lifecycle = (company.lifecycle_stage or "").strip().lower() == LIFECYCLE_CUSTOMER
    if won is not None or lifecycle:
        what = (
            f"we won {won.name}"
            + (f" in {won.close_date.year}" if won.close_date is not None else "")
            if won is not None
            else "HubSpot lists them as a customer"
        )
        if talk is not None and talk.on >= months_before(today, CUSTOMER_MONTHS):
            return Relationship(
                stage="customer",
                since=talk.on,
                reason=f"A customer: {what}, and {_talk_words(talk)}.",
                source=talk.source,
            )
        quiet = (
            f" No talk since {day_words(talk.on)}." if talk is not None else " No talk on record."
        )
        return Relationship(
            stage="past_customer",
            since=won.close_date if won is not None else None,
            reason=f"A past customer: {what}.{quiet}",
            source="HubSpot deal" if won is not None else "HubSpot: lifecycle stage",
        )
    lost = _newest(company.deals, "lost")
    if (
        lost is not None
        and lost.close_date is not None
        and lost.close_date >= months_before(today, LOST_MONTHS)
    ):
        return Relationship(
            stage="lost_deal",
            since=lost.close_date,
            reason=f"Lost deal: {lost.name}, closed {day_words(lost.close_date)}.",
            source="HubSpot deal",
        )
    if talk is not None and talk.on >= months_before(today, CONTACT_MONTHS):
        return Relationship(
            stage="contacted",
            since=talk.on,
            reason=f"Contacted before: {_talk_words(talk)}.",
            source=talk.source,
        )
    return Relationship(
        stage="cold",
        since=None,
        reason=f"No deal, and no talk on record in the last {CONTACT_MONTHS} months.",
        source="HubSpot copy",
    )
