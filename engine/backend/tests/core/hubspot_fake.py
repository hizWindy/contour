"""A fake HubSpot for tests and the fake backend: it keeps records in memory, costs nothing and
touches no real data. It follows the `HubSpot` protocol (core/hubspot/client.py).

- `scopes` says which permissions the fake key has; a call without its scope raises
  `HubSpotMissingScope`, like HubSpot's 403.
- `writes_allowed` is the HUBSPOT_WRITE_ENABLED switch.
- `fail` holds errors to raise, by call name, one per call (like a timeout on the next write).
- `calls` lists every call by name, so a test can see what was asked.
- A record made with links keeps them (`companies`, `contacts`, `deals`), and `linked` answers
  from them. A link the client's table (`LINK_TYPES`) has no number for is refused with
  `HubSpotRejected`, the way HubSpot refuses a bad request.
- An owner may have an email (`owner_email`, or `add_owner(..., email=...)`). Only
  `owner_emails` returns it, for the active owners, as the client does (PLAN-V17 T1-4).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from itertools import count

from core.hubspot.check import ACTIVITY_WRITE_SCOPE
from core.hubspot.client import (
    LINK_TYPES,
    PAGE_SIZE,
    AccountInfo,
    Association,
    Choice,
    Filter,
    HubSpotError,
    HubSpotList,
    HubSpotMissingScope,
    HubSpotNotFound,
    HubSpotObject,
    HubSpotRejected,
    HubSpotWritesOff,
    Link,
    ObjectType,
    Owner,
    Page,
    Pipeline,
    PropertyInfo,
    Stage,
    WriteScopeProbe,
    owner_email_index,
    primary_company,
)

# The key reads calls, notes, tasks and meetings (PLAN-V17 T1-2). The names are the ones in
# HubSpot's docs: HubSpot names a scope only when it is missing, so they are TBC.
ACTIVITY_READ_SCOPES = (
    "crm.objects.calls.read",
    "crm.objects.notes.read",
    "crm.objects.tasks.read",
    "crm.objects.meetings.read",
)
READ_SCOPES = (
    "crm.objects.companies.read",
    "crm.objects.deals.read",
    "crm.objects.owners.read",
    "crm.lists.read",
    "crm.schemas.companies.read",
    *ACTIVITY_READ_SCOPES,
)
WRITE_SCOPES = ("crm.objects.companies.write", "crm.lists.write", ACTIVITY_WRITE_SCOPE)
# People need the contacts scope (PLAN-V10 C1). The fake key starts without it.
PEOPLE_SCOPE = "crm.objects.contacts.read"
SCOPE_FOR: dict[str, str] = {
    "companies": "crm.objects.companies.read",
    "deals": "crm.objects.deals.read",
    "notes": "crm.objects.notes.read",
    "contacts": PEOPLE_SCOPE,
    "calls": "crm.objects.calls.read",
    "tasks": "crm.objects.tasks.read",
    "meetings": "crm.objects.meetings.read",
}
# Writing a call, a task or a meeting needs the activity scope (its name is TBC, see
# core/hubspot/check.py). A note keeps the companies scope: the Lead Finder's note on a company.
# Every other kind needs the companies scope, as before.
ACTIVITY_WRITES = frozenset({"calls", "tasks", "meetings"})
PORTAL_ID = 1234567

SALES = Pipeline(
    "default",
    "Sales Pipeline",
    (
        Stage("34700939", "Unqualified Information Deal", False, 0),
        Stage("presentationscheduled", "Qualified Deal", False, 3),
        Stage("closedwon", "Ordered - Contract Signed", True, 12),
        Stage("closedlost", "Closed lost", True, 13),
        Stage("contractsent", "Dissolved", True, 14),
    ),
)
WHALES = Pipeline(
    "68405822", "Whales Pipeline", (Stage("132920979", "Unqualified Deal", False, 0),)
)
INDUSTRY = PropertyInfo(
    "industry",
    "Industry",
    "enumeration",
    "select",
    "companyinformation",
    True,
    (
        Choice("Computer Software", "COMPUTER_SOFTWARE"),
        Choice("Law Practice", "LAW_PRACTICE"),
        Choice("Logistics and Supply Chain", "LOGISTICS_AND_SUPPLY_CHAIN"),
    ),
)
LIFECYCLE = PropertyInfo(
    "lifecyclestage",
    "Lifecycle Stage",
    "enumeration",
    "radio",
    "companyinformation",
    True,
    (Choice("Lead", "lead"), Choice("Customer", "customer"), Choice("Opportunity", "opportunity")),
)


def _plain(name: str) -> PropertyInfo:
    return PropertyInfo(name, name, "string", "text", "companyinformation", False)


def _write_scope(object_type: str) -> str:
    return ACTIVITY_WRITE_SCOPE if object_type in ACTIVITY_WRITES else "crm.objects.companies.write"


def _associations(ids: Sequence[str]) -> tuple[Association, ...]:
    """The fake's links: the first is primary, as a deal's main company is."""
    return tuple(Association(item, primary=i == 0) for i, item in enumerate(ids))


@dataclass
class FakeRecord:
    id: str
    properties: dict[str, str | None]
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    companies: tuple[str, ...] = ()  # for a deal or an activity: its companies, the first primary
    contacts: tuple[str, ...] = ()  # for an activity: the people on it
    deals: tuple[str, ...] = ()  # for an activity: its deals

    def links_to(self, kind: str) -> tuple[str, ...]:
        return {"companies": self.companies, "contacts": self.contacts, "deals": self.deals}.get(
            kind, ()
        )

    def as_object(self, wanted: Sequence[str], with_links: bool) -> HubSpotObject:
        links = {}
        if with_links:
            links = {
                "companies": _associations(self.companies),
                "contacts": _associations(self.contacts),
                "deals": _associations(self.deals),
            }
        return HubSpotObject(
            id=self.id,
            properties={name: self.properties.get(name) for name in wanted} if wanted else {},
            updated_at=self.updated_at,
            url=f"https://app.hubspot.com/contacts/{PORTAL_ID}/record/0-2/{self.id}",
            associations=links,
        )


@dataclass
class FakeHubSpot:
    companies: dict[str, FakeRecord] = field(default_factory=dict)
    deals: dict[str, FakeRecord] = field(default_factory=dict)
    notes: dict[str, FakeRecord] = field(default_factory=dict)
    contacts: dict[str, FakeRecord] = field(default_factory=dict)
    call_log: dict[str, FakeRecord] = field(default_factory=dict)  # HubSpot's calls (PLAN-V10)
    tasks: dict[str, FakeRecord] = field(default_factory=dict)  # PLAN-V17
    meetings: dict[str, FakeRecord] = field(default_factory=dict)  # PLAN-V17
    owners_active: list[Owner] = field(default_factory=list)
    owners_archived: list[Owner] = field(default_factory=list)
    # owner id -> email, as HubSpot has it. Only `owner_emails` reads it (PLAN-V17 T1-4).
    owner_email: dict[str, str] = field(default_factory=dict)
    pipeline_list: list[Pipeline] = field(default_factory=lambda: [SALES, WHALES])
    company_fields: list[PropertyInfo] | None = None  # None: every field asked for exists
    deal_fields: list[PropertyInfo] | None = None
    lists: dict[str, HubSpotList] = field(
        default_factory=lambda: {"9": HubSpotList("9", "AI suggested", "MANUAL")}
    )
    list_members: dict[str, list[str]] = field(default_factory=dict)
    scopes: set[str] = field(default_factory=lambda: set(READ_SCOPES))
    writes_allowed: bool = False
    page_size: int = PAGE_SIZE
    fail: dict[str, list[HubSpotError]] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)
    time_zone: str = "Australia/Melbourne"
    closed: bool = False
    _ids: "count[int]" = field(default_factory=lambda: count(900_000_001))

    # --- helpers for tests -------------------------------------------------------------------

    def add_company(self, company_id: str, **properties: str | None) -> FakeRecord:
        record = FakeRecord(company_id, dict(properties))
        self.companies[company_id] = record
        return record

    def add_deal(self, deal_id: str, company: str | None, **properties: str | None) -> FakeRecord:
        record = FakeRecord(deal_id, dict(properties), companies=(company,) if company else ())
        self.deals[deal_id] = record
        return record

    def add_contact(self, contact_id: str, **properties: str | None) -> FakeRecord:
        record = FakeRecord(contact_id, dict(properties))
        self.contacts[contact_id] = record
        return record

    def add_call(
        self,
        call_id: str,
        company: str | None,
        contact: str | None = None,
        **properties: str | None,
    ) -> FakeRecord:
        record = FakeRecord(
            call_id,
            dict(properties),
            companies=(company,) if company else (),
            contacts=(contact,) if contact else (),
        )
        self.call_log[call_id] = record
        return record

    def add_owner(
        self, owner_id: str, name: str | None, *, email: str | None = None, archived: bool = False
    ) -> Owner:
        owner = Owner(owner_id, name, archived)
        (self.owners_archived if archived else self.owners_active).append(owner)
        if email is not None:
            self.owner_email[owner_id] = email
        return owner

    def grant_people(self) -> None:
        self.scopes.add(PEOPLE_SCOPE)

    def grant_writes(self) -> None:
        self.scopes |= set(WRITE_SCOPES)
        self.writes_allowed = True

    def _call(self, name: str, scope: str | None = None) -> None:
        self.calls.append(name)
        queued = self.fail.get(name)
        if queued:
            raise queued.pop(0)
        if scope is not None and scope not in self.scopes:
            raise HubSpotMissingScope([scope])

    def _store(self, object_type: ObjectType) -> dict[str, FakeRecord]:
        return {
            "companies": self.companies,
            "deals": self.deals,
            "notes": self.notes,
            "contacts": self.contacts,
            "calls": self.call_log,
            "tasks": self.tasks,
            "meetings": self.meetings,
        }[object_type]

    def _links(
        self, from_kind: ObjectType, to_kind: ObjectType, ids: Sequence[str]
    ) -> dict[str, tuple[Association, ...]]:
        """Each record's links to `to_kind`, both ways (HubSpot's links go both ways): the ones
        the record keeps, then the `to_kind` records that keep a link to it."""
        found: dict[str, tuple[Association, ...]] = {}
        for record_id in dict.fromkeys(ids):
            record = self._store(from_kind).get(record_id)
            kept = record.links_to(to_kind) if record is not None else ()
            back = tuple(
                other.id
                for other in self._store(to_kind).values()
                if record_id in other.links_to(from_kind)
            )
            targets = tuple(dict.fromkeys((*kept, *back)))
            if targets:
                found[record_id] = _associations(targets)
        return found

    def _page(
        self, records: list[FakeRecord], wanted: Sequence[str], after: str | None, links: bool
    ) -> Page:
        start = int(after or 0)
        chunk = records[start : start + self.page_size]
        nxt = start + self.page_size
        return Page(
            results=tuple(record.as_object(wanted, links) for record in chunk),
            after=str(nxt) if nxt < len(records) else None,
            total=len(records),
        )

    # --- reads -------------------------------------------------------------------------------

    async def account(self) -> AccountInfo:
        self._call("account")
        return AccountInfo(PORTAL_ID, self.time_zone, "app.hubspot.com")

    async def list_objects(
        self,
        object_type: ObjectType,
        *,
        properties: Sequence[str],
        after: str | None = None,
        associations: Sequence[str] = (),
        limit: int = PAGE_SIZE,
    ) -> Page:
        self._call(f"list_{object_type}", SCOPE_FOR[object_type])
        records = sorted(self._store(object_type).values(), key=lambda r: int(r.id))
        page = self._page(records, properties, after, bool(associations))
        return Page(page.results, page.after, None)  # a list answer has no total

    async def search_objects(
        self,
        object_type: ObjectType,
        *,
        filters: Sequence[Filter],
        properties: Sequence[str],
        sort_by: str | None = None,
        after: str | None = None,
        limit: int = PAGE_SIZE,
    ) -> Page:
        self._call(f"search_{object_type}", SCOPE_FOR[object_type])
        records = list(self._store(object_type).values())
        for item in filters:
            records = [r for r in records if _passes(r, item)]
        records.sort(key=lambda r: (r.updated_at, int(r.id)))
        return self._page(records, properties, after, links=False)

    async def get_object(
        self, object_type: ObjectType, object_id: str, *, properties: Sequence[str]
    ) -> HubSpotObject | None:
        self._call(f"get_{object_type}", SCOPE_FOR[object_type])
        record = self._store(object_type).get(object_id)
        return record.as_object(properties, False) if record else None

    async def linked(
        self, from_kind: ObjectType, to_kind: ObjectType, ids: Sequence[str]
    ) -> dict[str, tuple[Association, ...]]:
        self._call(f"linked_{from_kind}_{to_kind}", SCOPE_FOR[from_kind])
        return self._links(from_kind, to_kind, ids)

    async def primary_companies(self, deal_ids: Sequence[str]) -> dict[str, str]:
        self._call("primary_companies", SCOPE_FOR["deals"])
        found: dict[str, str] = {}
        for deal_id, links in self._links("deals", "companies", deal_ids).items():
            company = primary_company({"companies": links})
            if company is not None:
                found[deal_id] = company
        return found

    async def owners(self, *, archived: bool = False) -> list[Owner]:
        self._call("owners_archived" if archived else "owners", "crm.objects.owners.read")
        return list(self.owners_archived if archived else self.owners_active)

    async def owner_emails(self) -> dict[str, str]:
        self._call("owner_emails", "crm.objects.owners.read")
        return owner_email_index(
            (owner.id, self.owner_email.get(owner.id))
            for owner in self.owners_active
            if not owner.archived
        )

    async def pipelines(self, object_type: ObjectType = "deals") -> list[Pipeline]:
        self._call("pipelines", "crm.objects.deals.read")
        return list(self.pipeline_list)

    async def properties(self, object_type: ObjectType) -> list[PropertyInfo]:
        self._call(f"properties_{object_type}", "crm.schemas.companies.read")
        given = self.company_fields if object_type == "companies" else self.deal_fields
        if given is not None:
            return list(given)
        from core.hubspot.mapping import load_field_map

        fields = load_field_map()
        names = (
            fields.company_properties() if object_type == "companies" else fields.deal_properties()
        )
        special = {"industry": INDUSTRY, "lifecyclestage": LIFECYCLE}
        return [special.get(name, _plain(name)) for name in names]

    async def get_property(self, object_type: ObjectType, name: str) -> PropertyInfo | None:
        self._call("get_property", "crm.schemas.companies.read")
        for item in await self.properties(object_type):
            if item.name == name:
                return item
        return None

    async def find_lists(self, name: str) -> list[HubSpotList]:
        self._call("find_lists", "crm.lists.read")
        return [item for item in self.lists.values() if name.casefold() in item.name.casefold()]

    # --- writes ------------------------------------------------------------------------------

    def _write(self, name: str, scope: str) -> None:
        if not self.writes_allowed:
            self.calls.append(name)
            raise HubSpotWritesOff
        self._call(name, scope)

    async def create_object(
        self,
        object_type: ObjectType,
        properties: Mapping[str, str],
        *,
        links: Sequence[Link] = (),
    ) -> HubSpotObject:
        self._write(f"create_{object_type}", _write_scope(object_type))
        wanted: dict[tuple[str, str], None] = {}  # (kind, id), each once, in the order given
        for link in links:
            if (object_type, link.kind) not in LINK_TYPES:
                raise HubSpotRejected(
                    "HubSpot didn't accept the request",
                    f"It has no link from {object_type} to {link.kind} (400 VALIDATION_ERROR).",
                )
            record_id = link.id.strip()
            if not record_id.isdigit():  # the client refuses it too, before sending
                raise ValueError(f"not a HubSpot record id: {record_id[:40]!r}")
            wanted[(link.kind, record_id)] = None

        def ids(kind: str) -> tuple[str, ...]:
            return tuple(record_id for linked_kind, record_id in wanted if linked_kind == kind)

        record = FakeRecord(
            str(next(self._ids)),
            dict(properties),
            companies=ids("companies"),
            contacts=ids("contacts"),
            deals=ids("deals"),
        )
        self._store(object_type)[record.id] = record
        return record.as_object(list(properties), False)

    async def update_object(
        self, object_type: ObjectType, object_id: str, properties: Mapping[str, str]
    ) -> HubSpotObject:
        self._write(f"update_{object_type}", _write_scope(object_type))
        record = self._store(object_type).get(object_id)
        if record is None:
            raise HubSpotNotFound("Not in HubSpot", "HubSpot has no record with this id.")
        record.properties.update(properties)
        record.updated_at = datetime.now(UTC)
        return record.as_object(list(properties), False)

    async def add_to_list(self, list_id: str, record_ids: Sequence[str]) -> None:
        self._write("add_to_list", "crm.lists.write")
        if list_id not in self.lists:
            raise HubSpotNotFound("Not in HubSpot", "HubSpot has no list with this id.")
        members = self.list_members.setdefault(list_id, [])
        members += [record for record in record_ids if record not in members]

    async def probe_write_scope(self, what: WriteScopeProbe) -> bool | None:
        self.calls.append(f"probe_{what}")
        scope = "crm.lists.write" if what == "lists" else _write_scope(what)
        return scope in self.scopes

    async def aclose(self) -> None:
        self.closed = True


def _passes(record: FakeRecord, item: Filter) -> bool:
    if item.property == "hs_lastmodifieddate":
        moment = int(record.updated_at.timestamp() * 1000)
        target = int(item.value or 0)
        return {"GTE": moment >= target, "GT": moment > target, "LT": moment < target}.get(
            item.operator, True
        )
    value = record.properties.get(item.property)
    if item.operator == "EQ":
        return (value or "").casefold() == (item.value or "").casefold()
    if item.operator == "IN":
        return (value or "") in item.values
    if item.operator == "HAS_PROPERTY":
        return bool(value)
    return True
