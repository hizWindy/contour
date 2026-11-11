"""The facts pack (PLAN-V10 D2): everything we already know about a company and a person, each fact
with its source. Building it is free: it reads our HubSpot copy, the shared memory and, for people
with the Lead Finder tick, the Lead Finder's lead. The prep modal shows it at once, before any
Claude request, and the call script may only say what these facts (or pages it finds) say.

What goes to Claude is made from the pack by `claude_text`, never from raw rows:
- **Never an email address or a phone number.** They are left out of the facts, and anything that
  looks like one in free text (a call note) is blanked by `scrub`.
- **No names unless Levi has said yes** (`hubspot_names_to_claude_ok`). Until then the company
  is written as {company} and the person as {person}, and there is no web check.

The pack ends with HubSpot's lifecycle stage and the relationship stage (PLAN-V15 T3-3), so the
script opens from where we stand. They come last, so the other facts keep their numbers.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Final, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import store
from apps.companies.schemas import (
    CompanyCall,
    CompanyDetail,
    PrepFact,
    PrepFacts,
    PrepPerson,
    PrepSource,
)
from core.company_leads import CompanyLeads
from core.hubspot.models import HubSpotCompany, HubSpotContact

SourceKind = Literal["hubspot", "call", "memory", "lead", "web"]

CALL_YEARS = 2  # calls older than this are left out (TBC)
MAX_CALLS = 5  # the newest calls in the pack
MAX_NOTES = 8  # saved notes in the pack
MAX_DEALS = 5
NOTE_CHARS = 600  # a call note is cut to this many characters
TEXT_CHARS = 400  # a description or a summary is cut to this many

# The relationship stage in a few words, for the facts pack.
STAGE_WORDS: Final = {
    "open_deal": "open deal",
    "customer": "customer",
    "past_customer": "past customer",
    "lost_deal": "lost deal",
    "contacted": "contacted before",
    "cold": "cold",
}

COMPANY_MARK = "{company}"
PERSON_MARK = "{person}"

EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
# A run of 8 or more digits with phone-like separators: "0412 345 678", "+61 8 9000 0000",
# "(08) 9000-0000". Dates in the pack are written in words, and money with commas, so they
# never look like this.
PHONE = re.compile(r"(?<![\w])\+?\(?\d[\d\s().-]{6,}\d(?![\w])")
EMAIL_GONE = "[email left out]"
PHONE_GONE = "[number left out]"


def _phone_like(match: re.Match[str]) -> str:
    digits = sum(character.isdigit() for character in match.group(0))
    return PHONE_GONE if digits >= 8 else match.group(0)


def scrub(text: str) -> str:
    """The text with every email address and phone number blanked."""
    return PHONE.sub(_phone_like, EMAIL.sub(EMAIL_GONE, text))


def day(value: date | datetime | None) -> str:
    """'9 Nov 2026'. Words, so a date never looks like a phone number."""
    if value is None:
        return "an unknown date"
    if isinstance(value, datetime):
        value = value.date()
    return f"{value.day} {value.strftime('%b %Y')}"


def money(value: object) -> str:
    try:
        return f"A${int(float(str(value))):,}"
    except (TypeError, ValueError):
        return "an unknown amount"


def _cut(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else f"{text[: limit - 3].rstrip()}..."


@dataclass(frozen=True)
class Fact:
    id: str
    text: str
    kind: SourceKind
    label: str
    url: str | None = None
    when: date | None = None

    def source(self) -> PrepSource:
        return PrepSource(
            id=self.id, kind=self.kind, label=self.label, url=self.url, date=self.when
        )


@dataclass
class FactsPack:
    company: CompanyDetail
    person: HubSpotContact | None
    phone: str | None
    last_call: CompanyCall | None
    leads_used: bool  # True when the Lead Finder's lead is in it (only for its tick)
    facts: list[Fact] = field(default_factory=list)
    stage_fact: str | None = None  # the id of the relationship stage's fact, like F14

    def add(
        self,
        text: str,
        kind: SourceKind,
        label: str,
        *,
        url: str | None = None,
        when: date | None = None,
    ) -> None:
        self.facts.append(Fact(f"F{len(self.facts) + 1}", text, kind, label, url, when))

    @property
    def ids(self) -> set[str]:
        return {fact.id for fact in self.facts}

    def by_id(self) -> dict[str, Fact]:
        return {fact.id: fact for fact in self.facts}


def _person(contact: HubSpotContact | None) -> PrepPerson | None:
    if contact is None:
        return None
    return PrepPerson(id=contact.hubspot_id, name=contact.name, title=contact.job_title)


async def build_facts(
    session: AsyncSession,
    key: str,
    contact_id: str | None,
    hooks: Sequence[CompanyLeads],
    now: datetime | None = None,
) -> FactsPack | None:
    """The pack for a company (and a person at it), or None when there is no such company or the
    person may not see it. A contact from another company is ignored."""
    now = now or datetime.now(UTC)
    company = await store.company_detail(session, key, hooks, now)
    if company is None:
        return None
    contact = await session.get(HubSpotContact, contact_id) if contact_id else None
    if contact is not None and contact.hubspot_company_id != key:
        contact = None
    row = await session.get(HubSpotCompany, key) if company.source == "hubspot" else None
    phone = (contact.phone or contact.mobile) if contact is not None else None
    if phone is None and row is not None:
        phone = row.phone
    since = now - timedelta(days=365 * CALL_YEARS)
    calls = [call for call in company.calls if call.called_at is None or call.called_at >= since]
    if contact is not None:
        # The person's own calls first, then the rest, newest first in each.
        calls.sort(key=lambda call: call.person != contact.name)
    pack = FactsPack(
        company=company,
        person=contact,
        phone=phone,
        last_call=calls[0] if calls else None,
        leads_used=company.lead is not None,
    )
    _company_facts(pack, company)
    if contact is not None:
        title = contact.job_title or "someone"
        pack.add(f"{contact.name} is {title} at {company.name}.", "hubspot", "HubSpot: contact")
        if contact.last_activity is not None:
            pack.add(
                f"HubSpot's last activity with {contact.name} was on {day(contact.last_activity)}.",
                "hubspot",
                "HubSpot: contact",
                when=contact.last_activity.date(),
            )
    for call in calls[:MAX_CALLS]:
        who = f" with {call.person}" if call.person else ""
        by = f" by {call.owner}" if call.owner else ""
        how = f" ({call.outcome})" if call.outcome else ""
        said = f" Note: {_cut(call.note, NOTE_CHARS)}" if call.note else ""
        pack.add(
            f"Call on {day(call.called_at)}{by}{who}{how}.{said}",
            "call",
            f"HubSpot call, {day(call.called_at)}",
            url=call.hubspot_url,
            when=call.called_at.date() if call.called_at else None,
        )
    for note in company.notes[:MAX_NOTES]:
        pack.add(
            _cut(note.text, TEXT_CHARS),
            "memory",
            "Saved research" if note.found_by != "companies" else "An earlier call prep",
            url=note.url,
            when=note.date,
        )
    if company.lead is not None:
        lead = company.lead
        pack.add(
            f"The Lead Finder rated it {lead.result_label}, score {lead.score}. "
            f"{_cut(lead.summary, TEXT_CHARS)}",
            "lead",
            "Lead Finder",
            when=lead.found_at.date(),
        )
        if lead.best_sign:
            pack.add(
                f"Its best sign of an office change: {lead.best_sign}"
                + (f" ({day(lead.sign_date)})." if lead.sign_date else "."),
                "lead",
                "Lead Finder: best sign",
                when=lead.sign_date,
            )
    _stage_facts(pack, company)
    return pack


def _stage_facts(pack: FactsPack, company: CompanyDetail) -> None:
    """HubSpot's lifecycle stage, then where we stand with the company (PLAN-V15 T3-3)."""
    if company.lifecycle_stage:
        pack.add(
            f"HubSpot's lifecycle stage for {company.name} is '{company.lifecycle_stage}'.",
            "hubspot",
            "HubSpot: lifecycle stage",
        )
    stage = company.relationship
    kind: SourceKind = (
        "call"
        if stage.source.startswith("HubSpot call")
        else "lead"
        if stage.source == "Lead Finder"
        else "hubspot"
    )
    pack.add(
        f"Relationship stage: {STAGE_WORDS[stage.stage]}. {stage.reason}",
        kind,
        stage.source,
        when=stage.since,
    )
    pack.stage_fact = pack.facts[-1].id


def _company_facts(pack: FactsPack, company: CompanyDetail) -> None:
    place = ", ".join(part for part in (company.city, company.state) if part)
    about = [
        f"Industry: {company.industry}." if company.industry else None,
        f"Based in {place}." if place else None,
        f"About {company.staff:,} staff." if company.staff is not None else None,
        f"About {company.linkedin_staff:,} staff in Australia on LinkedIn."
        if company.linkedin_staff is not None
        else None,
    ]
    for text in about:
        if text:
            pack.add(text, "hubspot", "HubSpot: company")
    if company.description:
        pack.add(
            f"What it does: {_cut(company.description, TEXT_CHARS)}", "hubspot", "HubSpot: company"
        )
    if company.owner:
        pack.add(f"Its owner at Contour is {company.owner}.", "hubspot", "HubSpot: owner")
    if company.last_talk:
        pack.add(
            f"The last talk on record was on {day(company.last_talk)}.",
            "hubspot",
            "HubSpot: last contacted",
            when=company.last_talk,
        )
    for office in company.offices:
        parts = [f"Office '{office.label}'" + (f" in {office.city}" if office.city else "")]
        if office.lease_end:
            parts.append(f"lease ends {day(office.lease_end)}")
        if office.office_m2 is not None:
            parts.append(f"about {int(office.office_m2):,} m2")
        if office.quality:
            parts.append(f"rated '{office.quality}'")
        pack.add(", ".join(parts) + ".", "hubspot", f"HubSpot: {office.label} office")
    for deal in company.deals[:MAX_DEALS]:
        parts = [f"Deal '{deal.name}' is {deal.state}"]
        if deal.stage:
            parts.append(f"stage '{deal.stage}'")
        if deal.amount_aud is not None:
            parts.append(money(deal.amount_aud))
        if deal.close_date:
            parts.append(f"close date {day(deal.close_date)}")
        text = ", ".join(parts) + "."
        if deal.next_step:
            text += f" Next step: {_cut(deal.next_step, TEXT_CHARS)}"
        pack.add(text, "hubspot", "HubSpot: deal", url=deal.hubspot_url)


def facts_out(
    pack: FactsPack,
    *,
    prep_enabled: bool,
    names_ok: bool,
    people_ready: bool,
    prep_cap_usd: Decimal,
) -> PrepFacts:
    company = pack.company
    return PrepFacts(
        company_key=company.key,
        company_name=company.name,
        city=company.city,
        industry=company.industry,
        staff=company.staff,
        owner=company.owner,
        deal=company.deal,
        next_lease_end=company.next_lease_end,
        last_talk=company.last_talk,
        hubspot_url=company.hubspot_url,
        person=_person(pack.person),
        phone=pack.phone,
        last_call=pack.last_call,
        facts=[PrepFact(id=f.id, text=f.text, source=f.source()) for f in pack.facts],
        people=company.people,
        people_status="ready" if people_ready else "waiting",
        prep_enabled=prep_enabled,
        names_ok=names_ok,
        prep_cap_usd=prep_cap_usd,
    )


# --- What Claude sees --------------------------------------------------------------------------


def _names(pack: FactsPack) -> list[tuple[str, str]]:
    """(name, mark) pairs to hide, longest first, so "ABC Logistics Pty Ltd" goes before "ABC"."""
    pairs: list[tuple[str, str]] = []
    company = pack.company
    for name in (company.name, store_clean_name(company.name), company.domain):
        if name and len(name) >= 3:
            pairs.append((name, COMPANY_MARK))
    if pack.person is not None:
        full = pack.person.name
        pairs.append((full, PERSON_MARK))
        for part in (pack.person.first_name, pack.person.last_name, *full.split()):
            if part and len(part) >= 3:
                pairs.append((part, PERSON_MARK))
    return sorted(set(pairs), key=lambda pair: -len(pair[0]))


SUFFIXES = re.compile(r"\b(pty|ltd|limited|group|holdings|australia|inc|co)\b\.?", re.IGNORECASE)


def store_clean_name(name: str) -> str:
    """The name without "Pty Ltd" and the like: "ABC Logistics Pty Ltd" gives "ABC Logistics"."""
    return " ".join(SUFFIXES.sub(" ", name).split())


def hide_names(text: str, pack: FactsPack) -> str:
    for name, mark in _names(pack):
        text = re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", mark, text, flags=re.IGNORECASE)
    return text


def claude_text(text: str, pack: FactsPack, *, names_ok: bool) -> str:
    """`text` as it may go to Claude: no email, no phone number, and no names unless allowed."""
    text = scrub(text)
    return text if names_ok else hide_names(text, pack)


def facts_for_claude(pack: FactsPack, *, names_ok: bool) -> str:
    return "\n".join(
        f"{fact.id} ({claude_text(fact.label, pack, names_ok=names_ok)}): "
        f"{claude_text(fact.text, pack, names_ok=names_ok)}"
        for fact in pack.facts
    )
