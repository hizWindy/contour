"""HubSpot, through the service key: the one door to HubSpot for every project (PLAN-V5).

Projects never call HubSpot themselves. The core's sync (`sync.py`), connection check
(`check.py`) and writer (`writer.py`) use this client, and projects use those. Code depends on
the `HubSpot` protocol, not on `HttpHubSpot`, so tests swap in `FakeHubSpot`
(tests/core/hubspot_fake.py), which costs nothing and touches no real data.

What it does for every caller, so no project needs its own copy:
- **The key** goes in `Authorization: Bearer <key>` and nowhere else. It is never logged
  (core.logs removes it from any line) and never put in an error.
- **Speed:** at most `requests_per_second` requests a second, and `searches_per_second`
  searches (HubSpot allows about 19 and 5 on Contour's plan, TBC; we stay well under).
- **Busy or broken answers:** a 429 or a server error is tried again, at most `MAX_TRIES` times
  in all, after the wait HubSpot asks for (or 1, 2, 4 seconds). A read that times out is tried
  again too. A WRITE that timed out or got a server error is never sent again: it may have
  landed, so it raises `HubSpotWriteUncertain` and the writer checks HubSpot first.
- **Clear errors:** `HubSpotUnavailable`, `HubSpotMissingScope` (it names the scopes HubSpot
  asked for), `HubSpotNotFound`, `HubSpotRejected` and `HubSpotWriteUncertain`. Each has a
  `title` and `detail` that are safe to show a person. HubSpot's own answer body is never
  repeated whole: only its category and the scopes.
- **Writes are off** unless the client was made with `writes_allowed=True`, which
  `get_hubspot` does only when `HUBSPOT_WRITE_ENABLED=true` (rule 1 of PLAN-V5). The scope
  probes (`probe_write_scope`) write nothing, so they work while writes are off.

API versions have dates, like 2026-09 (`HUBSPOT_API_VERSION`). "v3" uses HubSpot's older paths,
which still work until a date HubSpot hasn't published.
"""

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Protocol, Self

import httpx2
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from core.config import Settings, get_settings

log = logging.getLogger(__name__)

BASE_URL = "https://api.hubapi.com"
PAGE_SIZE = 100  # the most HubSpot gives in one list page
SEARCH_RESULTS_CAP = 10_000  # HubSpot's search never pages past this many results
BATCH_SIZE = 100  # the most ids in one batch request
MAX_TRIES = 3  # a busy answer, a server error or a slow read: tried at most 3 times in all
MAX_WAIT_SECONDS = 10.0
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
WRITE_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
# Failures that happen before a request leaves this computer, so even a write may be sent again.
NOT_SENT = (httpx2.ConnectError, httpx2.ConnectTimeout, httpx2.PoolTimeout)
MAX_DETAIL_CHARS = 300

# contacts and calls: read for the Companies page (PLAN-V10 C1), once the key has the scope.
ObjectType = Literal["companies", "deals", "notes", "contacts", "calls"]
WriteScopeProbe = Literal["companies", "lists"]
# Searches that are reads: HubSpot uses POST for them, so the method alone can't say.
READ_POSTS = ("/search", "/batch/read")

# The paths of HubSpot's older API ("v3"), for each family of calls. A dated version puts the
# date after the family instead: /crm/objects/2026-09/companies.
LEGACY_PREFIX = {
    "crm/objects": "/crm/v3/objects",
    "crm/owners": "/crm/v3/owners",
    "crm/pipelines": "/crm/v3/pipelines",
    "crm/properties": "/crm/v3/properties",
    "crm/lists": "/crm/v3/lists",
    "crm/associations": "/crm/v4/associations",
    "account-info": "/account-info/v3",
}

# HubSpot's own association type ids (HUBSPOT_DEFINED).
NOTE_TO_COMPANY = 190
PRIMARY_COMPANY_LABEL = "Primary"


# --- Errors ----------------------------------------------------------------------------------


class HubSpotError(Exception):
    """HubSpot couldn't do it. `title` and `detail` are safe to show to a person."""

    def __init__(self, title: str, detail: str) -> None:
        super().__init__(f"{title}: {detail}")
        self.title = title
        self.detail = detail


class HubSpotUnavailable(HubSpotError):
    """No connection, a refused key (401), or HubSpot stayed busy or broken after every try."""


class HubSpotMissingScope(HubSpotError):
    """The key lacks a permission (403 MISSING_SCOPES). `scopes` are the ones HubSpot named; any
    one of them would do."""

    def __init__(self, scopes: Sequence[str]) -> None:
        self.scopes = tuple(scopes)
        named = ", ".join(self.scopes) if self.scopes else "a scope HubSpot didn't name"
        super().__init__(
            "The HubSpot key is missing a permission",
            f"It needs one of: {named}. The admin adds it on the key's page in HubSpot.",
        )


class HubSpotNotFound(HubSpotError):
    """No such record (404)."""


class HubSpotRejected(HubSpotError):
    """HubSpot refused the request itself (400, 409 or 422), like a value a field doesn't take."""


class HubSpotWriteUncertain(HubSpotError):
    """A write timed out or got a server error. It may have landed, so it was not sent again."""


class HubSpotWritesOff(HubSpotError):
    """This client was made with writes off (HUBSPOT_WRITE_ENABLED is not true)."""

    def __init__(self) -> None:
        super().__init__(
            "Waiting for write access",
            "Writing to HubSpot is switched off. An admin needs to give the key write "
            "access and switch writing on.",
        )


# --- What the calls give back ----------------------------------------------------------------


@dataclass(frozen=True)
class Association:
    id: str  # the other record's id
    primary: bool  # HubSpot's "Primary" label (a deal's main company)


@dataclass(frozen=True)
class HubSpotObject:
    """One record. `properties` holds HubSpot's text for each field asked for (None when empty)."""

    id: str
    properties: Mapping[str, str | None]
    updated_at: datetime | None = None
    archived: bool = False
    url: str | None = None  # the record's page in HubSpot
    associations: Mapping[str, tuple[Association, ...]] = field(default_factory=dict)

    def text(self, name: str) -> str | None:
        value = self.properties.get(name)
        if value is None:
            return None
        return value.strip() or None


@dataclass(frozen=True)
class Page:
    results: tuple[HubSpotObject, ...]
    after: str | None  # the cursor for the next page, None on the last one
    total: int | None = None  # searches say how many match; lists don't


@dataclass(frozen=True)
class Owner:
    """A HubSpot user who can own records. Only the id and name are kept, never the email."""

    id: str
    name: str | None
    archived: bool


@dataclass(frozen=True)
class Stage:
    id: str
    label: str
    closed: bool
    order: int


@dataclass(frozen=True)
class Pipeline:
    id: str
    label: str
    stages: tuple[Stage, ...]


@dataclass(frozen=True)
class Choice:
    label: str
    value: str


@dataclass(frozen=True)
class PropertyInfo:
    """A field's definition: its name, label, type and, for a pick list, its choices."""

    name: str
    label: str
    type: str
    field_type: str | None
    group: str | None
    hubspot_defined: bool
    choices: tuple[Choice, ...] = ()


@dataclass(frozen=True)
class HubSpotList:
    id: str
    name: str
    processing_type: str  # MANUAL lists take members by hand; DYNAMIC ones fill themselves


@dataclass(frozen=True)
class AccountInfo:
    portal_id: int
    time_zone: str | None
    ui_domain: str | None


@dataclass(frozen=True)
class Filter:
    """One search filter, like hs_lastmodifieddate GTE <milliseconds>."""

    property: str
    operator: Literal["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "HAS_PROPERTY", "IN"]
    value: str | None = None
    values: tuple[str, ...] = ()


class HubSpot(Protocol):
    """What the core uses. Every read is free; writes need the write scopes and writes on."""

    async def account(self) -> AccountInfo: ...

    async def list_objects(
        self,
        object_type: ObjectType,
        *,
        properties: Sequence[str],
        after: str | None = None,
        associations: Sequence[str] = (),
        limit: int = PAGE_SIZE,
    ) -> Page: ...

    async def search_objects(
        self,
        object_type: ObjectType,
        *,
        filters: Sequence[Filter],
        properties: Sequence[str],
        sort_by: str | None = None,
        after: str | None = None,
        limit: int = PAGE_SIZE,
    ) -> Page: ...

    async def get_object(
        self, object_type: ObjectType, object_id: str, *, properties: Sequence[str]
    ) -> HubSpotObject | None:
        """The record, or None when HubSpot has no record with this id."""
        ...

    async def primary_companies(self, deal_ids: Sequence[str]) -> dict[str, str]:
        """deal id -> its primary company's id, for deals that have one."""
        ...

    async def owners(self, *, archived: bool = False) -> list[Owner]: ...

    async def pipelines(self, object_type: ObjectType = "deals") -> list[Pipeline]: ...

    async def properties(self, object_type: ObjectType) -> list[PropertyInfo]: ...

    async def get_property(self, object_type: ObjectType, name: str) -> PropertyInfo | None:
        """One field's definition, or None when HubSpot has no field with this name."""
        ...

    async def find_lists(self, name: str) -> list[HubSpotList]:
        """Lists whose name contains `name` (HubSpot's search), any case."""
        ...

    async def create_object(
        self,
        object_type: ObjectType,
        properties: Mapping[str, str],
        *,
        associate_with_company: str | None = None,
    ) -> HubSpotObject: ...

    async def update_object(
        self, object_type: ObjectType, object_id: str, properties: Mapping[str, str]
    ) -> HubSpotObject: ...

    async def add_to_list(self, list_id: str, record_ids: Sequence[str]) -> None: ...

    async def probe_write_scope(self, what: WriteScopeProbe) -> bool | None:
        """Whether the key may write `what`: True, False, or None when HubSpot's answer says
        neither. It changes nothing: it aims at record 0, which can't exist."""
        ...

    async def aclose(self) -> None: ...


# --- Reading HubSpot's answers leniently -----------------------------------------------------


class _Reply(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class _AssocLink(_Reply):
    id: str
    type: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _text_id(cls, value: Any) -> Any:
        return str(value) if isinstance(value, int) else value


class _AssocGroup(_Reply):
    results: list[_AssocLink] = Field(default_factory=list)


class _Object(_Reply):
    id: str
    properties: dict[str, str | None] = Field(default_factory=dict)
    updated_at: datetime | None = Field(None, alias="updatedAt")
    archived: bool = False
    url: str | None = None
    associations: dict[str, _AssocGroup] = Field(default_factory=dict)

    @field_validator("properties", mode="before")
    @classmethod
    def _texts(cls, value: Any) -> dict[str, str | None]:
        if not isinstance(value, dict):
            return {}
        return {str(name): (None if item is None else str(item)) for name, item in value.items()}

    def as_object(self) -> HubSpotObject:
        return HubSpotObject(
            id=self.id,
            properties=self.properties,
            updated_at=self.updated_at,
            archived=self.archived,
            url=self.url,
            associations={kind: _links(group.results) for kind, group in self.associations.items()},
        )


def _links(found: Iterable[_AssocLink]) -> tuple[Association, ...]:
    """One entry per linked record. HubSpot lists a link once for each of its types ("x_to_y"
    and "x_to_y_unlabeled"); a link is primary when any of its types is the plain one."""
    primary: dict[str, bool] = {}
    for link in found:
        kind = (link.type or "").lower()
        is_primary = bool(kind) and not kind.endswith("_unlabeled")
        primary[link.id] = primary.get(link.id, False) or is_primary
    return tuple(Association(id=key, primary=value) for key, value in primary.items())


class _Paging(_Reply):
    next: dict[str, Any] | None = None


class _Page(_Reply):
    results: list[_Object] = Field(default_factory=list)
    paging: _Paging | None = None
    total: int | None = None

    def as_page(self) -> Page:
        after = self.paging.next.get("after") if self.paging and self.paging.next else None
        return Page(
            results=tuple(item.as_object() for item in self.results),
            after=str(after) if after not in (None, "") else None,
            total=self.total,
        )


class _Owner(_Reply):
    id: str
    first_name: str | None = Field(None, alias="firstName")
    last_name: str | None = Field(None, alias="lastName")
    archived: bool = False


class _Owners(_Reply):
    results: list[_Owner] = Field(default_factory=list)
    paging: _Paging | None = None


class _StageMeta(_Reply):
    is_closed: Any = Field(None, alias="isClosed")


class _Stage(_Reply):
    id: str
    label: str
    display_order: int = Field(0, alias="displayOrder")
    metadata: _StageMeta | None = None


class _Pipeline(_Reply):
    id: str
    label: str
    stages: list[_Stage] = Field(default_factory=list)


class _Pipelines(_Reply):
    results: list[_Pipeline] = Field(default_factory=list)


class _Choice(_Reply):
    label: str = ""
    value: str = ""


class _Property(_Reply):
    name: str
    label: str = ""
    type: str = ""
    field_type: str | None = Field(None, alias="fieldType")
    group_name: str | None = Field(None, alias="groupName")
    hubspot_defined: bool = Field(False, alias="hubspotDefined")
    options: list[_Choice] = Field(default_factory=list)

    @field_validator("hubspot_defined", mode="before")
    @classmethod
    def _flag(cls, value: Any) -> bool:
        return value is True


class _Properties(_Reply):
    results: list[_Property] = Field(default_factory=list)


class _List(_Reply):
    list_id: str = Field(alias="listId")
    name: str
    processing_type: str = Field("", alias="processingType")

    @field_validator("list_id", mode="before")
    @classmethod
    def _text_id(cls, value: Any) -> Any:
        return str(value) if isinstance(value, int) else value


class _Lists(_Reply):
    lists: list[_List] = Field(default_factory=list)


class _Account(_Reply):
    portal_id: int = Field(alias="portalId")
    time_zone: str | None = Field(None, alias="timeZone")
    ui_domain: str | None = Field(None, alias="uiDomain")


class _AssocType(_Reply):
    label: str | None = None
    type_id: int | None = Field(None, alias="typeId")


class _AssocTarget(_Reply):
    to_object_id: str = Field(alias="toObjectId")
    association_types: list[_AssocType] = Field(default_factory=list, alias="associationTypes")

    @field_validator("to_object_id", mode="before")
    @classmethod
    def _text_id(cls, value: Any) -> Any:
        return str(value) if isinstance(value, int) else value


class _AssocFrom(_Reply):
    id: str

    @field_validator("id", mode="before")
    @classmethod
    def _text_id(cls, value: Any) -> Any:
        return str(value) if isinstance(value, int) else value


class _AssocResult(_Reply):
    from_: _AssocFrom = Field(alias="from")
    to: list[_AssocTarget] = Field(default_factory=list)


class _AssocBatch(_Reply):
    results: list[_AssocResult] = Field(default_factory=list)


def _parse[M: _Reply](model: type[M], data: Any) -> M:
    try:
        return model.model_validate(data)
    except ValidationError as error:
        raise HubSpotError(
            "HubSpot sent an answer we couldn't read",
            "It didn't have the shape HubSpot's documentation describes.",
        ) from error


def owner_name(first: str | None, last: str | None) -> str | None:
    parts = [part.strip() for part in (first, last) if part and part.strip()]
    return " ".join(parts) or None


def _closed(value: Any) -> bool:
    return value is True or str(value).strip().lower() == "true"


# --- Errors from answers ---------------------------------------------------------------------


def _body(response: httpx2.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def missing_scopes(body: Mapping[str, Any]) -> tuple[str, ...]:
    """The scopes a MISSING_SCOPES answer names, in HubSpot's order, without repeats."""
    found: list[str] = []
    for error in body.get("errors") or []:
        if not isinstance(error, dict):
            continue
        for key, scopes in (error.get("context") or {}).items():
            if "scope" in str(key).lower() and isinstance(scopes, list):
                found.extend(str(scope) for scope in scopes if isinstance(scope, str))
    return tuple(dict.fromkeys(found))


def _problem(response: httpx2.Response, *, write: bool) -> HubSpotError:
    """What a failed answer means, in plain words. Only HubSpot's category is repeated."""
    status = response.status_code
    body = _body(response)
    category = str(body.get("category") or "")
    if status == 401:
        return HubSpotUnavailable(
            "HubSpot refused the key",
            "An admin needs to check the HubSpot key. It may have been deleted, or its "
            "creator removed from HubSpot.",
        )
    if status == 403 and category == "MISSING_SCOPES":
        return HubSpotMissingScope(missing_scopes(body))
    if status == 403:
        return HubSpotUnavailable(
            "HubSpot said no", f"It refused the request (403 {category or 'FORBIDDEN'})."
        )
    if status == 404:
        return HubSpotNotFound("Not in HubSpot", "HubSpot has no record with this id.")
    if status in (400, 409, 422):
        return HubSpotRejected(
            "HubSpot didn't accept the request",
            f"It answered {status} {category or 'with an error'}.".strip(),
        )
    if status == 429:
        return HubSpotUnavailable(
            "HubSpot is busy", "Too many requests (429), even after waiting. Try again soon."
        )
    if write and status >= 500:
        return HubSpotWriteUncertain(
            "HubSpot may or may not have saved it",
            f"It answered with error {status}. It was not sent again, so nothing is doubled. "
            "Check HubSpot before trying again.",
        )
    return HubSpotUnavailable("HubSpot had a problem", f"It answered with error {status}.")


# --- Pacing ----------------------------------------------------------------------------------


class Pacer:
    """At most `per_second` starts a second, spread out evenly. `clock` and `pause` are for
    tests."""

    def __init__(
        self,
        per_second: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if per_second <= 0:
            raise ValueError("per_second must be more than 0")
        self._gap = 1.0 / per_second
        self._clock = clock
        self._pause = pause
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = self._clock()
            if self._next > now:
                await self._pause(self._next - now)
                now = self._next
            self._next = now + self._gap


# --- The real HubSpot ------------------------------------------------------------------------


class HttpHubSpot:
    """The real HubSpot, over HTTPS. `client`, `pause` and `clock` are for tests."""

    def __init__(
        self,
        service_key: str,
        *,
        api_version: str = "2026-09",
        writes_allowed: bool = False,
        timeout: float = 30.0,
        requests_per_second: float = 8.0,
        searches_per_second: float = 4.0,
        client: httpx2.AsyncClient | None = None,
        pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not service_key.strip():
            raise ValueError("a HubSpot client needs a key")
        self._key = service_key.strip()
        self._version = api_version
        self.writes_allowed = writes_allowed
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(timeout))
        self._owns_client = client is None
        self._pause = pause
        self._requests = Pacer(requests_per_second, clock=clock, pause=pause)
        self._searches = Pacer(searches_per_second, clock=clock, pause=pause)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # --- Reads -------------------------------------------------------------------------------

    async def account(self) -> AccountInfo:
        data = await self._call("GET", self._path("account-info", "/details"))
        found = _parse(_Account, data)
        return AccountInfo(found.portal_id, found.time_zone, found.ui_domain)

    async def list_objects(
        self,
        object_type: ObjectType,
        *,
        properties: Sequence[str],
        after: str | None = None,
        associations: Sequence[str] = (),
        limit: int = PAGE_SIZE,
    ) -> Page:
        params: dict[str, str] = {
            "limit": str(max(1, min(limit, PAGE_SIZE))),
            "archived": "false",
        }
        if properties:
            params["properties"] = ",".join(dict.fromkeys(properties))
        if associations:
            params["associations"] = ",".join(associations)
        if after:
            params["after"] = after
        data = await self._call("GET", self._path("crm/objects", f"/{object_type}"), params=params)
        return _parse(_Page, data).as_page()

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
        body: dict[str, Any] = {
            "limit": max(1, min(limit, PAGE_SIZE)),
            "properties": list(dict.fromkeys(properties)),
        }
        if filters:
            body["filterGroups"] = [{"filters": [_filter(item) for item in filters]}]
        if sort_by:
            body["sorts"] = [{"propertyName": sort_by, "direction": "ASCENDING"}]
        if after:
            body["after"] = after
        path = self._path("crm/objects", f"/{object_type}/search")
        data = await self._call("POST", path, body=body)
        return _parse(_Page, data).as_page()

    async def get_object(
        self, object_type: ObjectType, object_id: str, *, properties: Sequence[str]
    ) -> HubSpotObject | None:
        params = {"properties": ",".join(dict.fromkeys(properties))} if properties else None
        path = self._path("crm/objects", f"/{object_type}/{_id(object_id)}")
        try:
            data = await self._call("GET", path, params=params)
        except HubSpotNotFound:
            return None
        return _parse(_Object, data).as_object()

    async def primary_companies(self, deal_ids: Sequence[str]) -> dict[str, str]:
        found: dict[str, str] = {}
        ids = list(dict.fromkeys(deal_ids))
        for start in range(0, len(ids), BATCH_SIZE):
            chunk = ids[start : start + BATCH_SIZE]
            path = self._path("crm/associations", "/deals/companies/batch/read")
            data = await self._call("POST", path, body={"inputs": [{"id": i} for i in chunk]})
            for result in _parse(_AssocBatch, data).results:
                company = _primary_target(result.to)
                if company is not None:
                    found[result.from_.id] = company
        return found

    async def owners(self, *, archived: bool = False) -> list[Owner]:
        owners: list[Owner] = []
        after: str | None = None
        while True:
            params = {"limit": str(PAGE_SIZE), "archived": "true" if archived else "false"}
            if after:
                params["after"] = after
            data = await self._call("GET", self._path("crm/owners", ""), params=params)
            page = _parse(_Owners, data)
            owners += [
                Owner(o.id, owner_name(o.first_name, o.last_name), o.archived or archived)
                for o in page.results
            ]
            nxt = page.paging.next.get("after") if page.paging and page.paging.next else None
            if not nxt:
                return owners
            after = str(nxt)

    async def pipelines(self, object_type: ObjectType = "deals") -> list[Pipeline]:
        data = await self._call("GET", self._path("crm/pipelines", f"/{object_type}"))
        return [
            Pipeline(
                id=item.id,
                label=item.label.strip(),
                stages=tuple(
                    Stage(
                        id=stage.id,
                        label=stage.label.strip(),
                        closed=_closed(stage.metadata.is_closed if stage.metadata else None),
                        order=stage.display_order,
                    )
                    for stage in sorted(item.stages, key=lambda s: s.display_order)
                ),
            )
            for item in _parse(_Pipelines, data).results
        ]

    async def properties(self, object_type: ObjectType) -> list[PropertyInfo]:
        data = await self._call("GET", self._path("crm/properties", f"/{object_type}"))
        return [_property(item) for item in _parse(_Properties, data).results]

    async def get_property(self, object_type: ObjectType, name: str) -> PropertyInfo | None:
        path = self._path("crm/properties", f"/{object_type}/{_field_name(name)}")
        try:
            data = await self._call("GET", path)
        except HubSpotNotFound:
            return None
        return _property(_parse(_Property, data))

    async def find_lists(self, name: str) -> list[HubSpotList]:
        body = {"query": name, "count": 50}
        data = await self._call("POST", self._path("crm/lists", "/search"), body=body)
        return [
            HubSpotList(item.list_id, item.name, item.processing_type)
            for item in _parse(_Lists, data).lists
        ]

    # --- Writes ------------------------------------------------------------------------------

    async def create_object(
        self,
        object_type: ObjectType,
        properties: Mapping[str, str],
        *,
        associate_with_company: str | None = None,
    ) -> HubSpotObject:
        self._check_writes()
        body: dict[str, Any] = {"properties": dict(properties)}
        if associate_with_company is not None:
            if object_type != "notes":
                raise ValueError("only a note is linked to a company when it is made")
            body["associations"] = [
                {
                    "to": {"id": _id(associate_with_company)},
                    "types": [
                        {
                            "associationCategory": "HUBSPOT_DEFINED",
                            "associationTypeId": NOTE_TO_COMPANY,
                        }
                    ],
                }
            ]
        data = await self._call("POST", self._path("crm/objects", f"/{object_type}"), body=body)
        return _parse(_Object, data).as_object()

    async def update_object(
        self, object_type: ObjectType, object_id: str, properties: Mapping[str, str]
    ) -> HubSpotObject:
        self._check_writes()
        path = self._path("crm/objects", f"/{object_type}/{_id(object_id)}")
        data = await self._call("PATCH", path, body={"properties": dict(properties)})
        return _parse(_Object, data).as_object()

    async def add_to_list(self, list_id: str, record_ids: Sequence[str]) -> None:
        self._check_writes()
        path = self._path("crm/lists", f"/{_id(list_id)}/memberships/add")
        await self._call("PUT", path, body=[_id(record) for record in record_ids])

    async def probe_write_scope(self, what: WriteScopeProbe) -> bool | None:
        body: Any
        if what == "companies":
            method, path, body = (
                "PATCH",
                self._path("crm/objects", "/companies/0"),
                {"properties": {}},
            )
        else:
            method, path, body = "PUT", self._path("crm/lists", "/0/memberships/add"), []
        try:
            await self._call(method, path, body=body, probe=True)
        except HubSpotMissingScope:
            return False
        except (HubSpotNotFound, HubSpotRejected):
            return True  # past the scope check: HubSpot looked for record 0
        except HubSpotError:
            return None
        return None  # a success on record 0 says nothing about the scope

    # --- One request -------------------------------------------------------------------------

    def _path(self, family: str, rest: str) -> str:
        if self._version == "v3":
            return f"{LEGACY_PREFIX[family]}{rest}"
        return f"/{family}/{self._version}{rest}"

    def _check_writes(self) -> None:
        if not self.writes_allowed:
            raise HubSpotWritesOff

    async def _call(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        body: Any = None,
        probe: bool = False,
    ) -> Any:
        """The answer's JSON. Raises a `HubSpotError` for anything but a success."""
        write = method in WRITE_METHODS and not path.endswith(READ_POSTS) and not probe
        search = path.endswith("/search")
        for attempt in range(MAX_TRIES):
            last = attempt == MAX_TRIES - 1
            try:
                response = await self._send(method, path, params, body, search=search)
            except NOT_SENT as error:
                # No connection was made, so nothing reached HubSpot: safe to try again.
                if last:
                    raise HubSpotUnavailable(
                        "HubSpot can't be reached", "Check the connection, then try again."
                    ) from error
                await self._pause(self._backoff(attempt))
                continue
            except httpx2.HTTPError as error:
                # The request may have reached HubSpot (a slow answer, a broken connection).
                if write:
                    raise HubSpotWriteUncertain(
                        "HubSpot didn't answer",
                        "The connection timed out or broke, so the change may or may not be "
                        "saved. It was not sent again. Check HubSpot before trying again.",
                    ) from error
                if last:
                    raise HubSpotUnavailable(
                        "HubSpot didn't answer", "It timed out or the connection broke. Try again."
                    ) from error
                await self._pause(self._backoff(attempt))
                continue
            status = response.status_code
            # A 429 was refused before anything happened, so even a write may be sent again.
            # A server error on a write may have landed, so a write is never sent again.
            retry = status == 429 or (status in RETRY_STATUSES and not write)
            if retry and not last:
                await self._pause(self._wait(response, attempt))
                continue
            if 200 <= status < 300:
                if status == 204 or not response.content:
                    return {}
                try:
                    return response.json()
                except ValueError as error:
                    raise HubSpotError(
                        "HubSpot sent an answer we couldn't read", "It wasn't JSON."
                    ) from error
            raise _problem(response, write=write)
        raise AssertionError("unreachable")  # pragma: no cover

    async def _send(
        self,
        method: str,
        path: str,
        params: Mapping[str, str] | None,
        body: Any,
        *,
        search: bool,
    ) -> httpx2.Response:
        if search:
            await self._searches.wait()
        await self._requests.wait()
        started = time.monotonic()
        response = await self._client.request(
            method,
            f"{BASE_URL}{path}",
            params=dict(params) if params else None,
            json=body,
            headers={"Authorization": f"Bearer {self._key}", "Accept": "application/json"},
        )
        log.info(
            "hubspot_call",
            extra={
                "method": method,
                "endpoint": path,
                "status": response.status_code,
                "ms": round((time.monotonic() - started) * 1000),
            },
        )
        return response

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(float(1 << attempt), MAX_WAIT_SECONDS)

    @classmethod
    def _wait(cls, response: httpx2.Response, attempt: int) -> float:
        """Seconds to wait before the next try: what HubSpot asks for, or 1, 2, 4 ..."""
        asked = str(response.headers.get("retry-after", "")).strip()
        try:
            seconds = float(asked)
        except ValueError:
            return cls._backoff(attempt)
        return max(0.0, min(seconds, MAX_WAIT_SECONDS))


def _filter(item: Filter) -> dict[str, Any]:
    out: dict[str, Any] = {"propertyName": item.property, "operator": item.operator}
    if item.operator == "IN":
        out["values"] = list(item.values)
    elif item.value is not None:
        out["value"] = item.value
    return out


def _property(item: _Property) -> PropertyInfo:
    return PropertyInfo(
        name=item.name,
        label=item.label,
        type=item.type,
        field_type=item.field_type,
        group=item.group_name,
        hubspot_defined=item.hubspot_defined,
        choices=tuple(Choice(c.label, c.value) for c in item.options),
    )


def _field_name(value: str) -> str:
    """A field's name goes into a path, so only HubSpot's own name shape passes."""
    if not re.fullmatch(r"[a-z0-9_]{1,100}", value):
        raise ValueError(f"not a HubSpot field name: {value[:40]!r}")
    return value


def _id(value: str) -> str:
    """A record id goes into a path, so only digits pass. HubSpot's ids are all digits."""
    text = str(value).strip()
    if not text.isdigit():
        raise ValueError(f"not a HubSpot record id: {text[:40]!r}")
    return text


def _primary_target(targets: Sequence[_AssocTarget]) -> str | None:
    """The company labelled Primary, else the only one. Several and none primary: no answer."""
    for target in targets:
        if any(t.label == PRIMARY_COMPANY_LABEL for t in target.association_types):
            return target.to_object_id
    unique = {target.to_object_id for target in targets}
    return unique.pop() if len(unique) == 1 else None


def primary_company(associations: Mapping[str, Sequence[Association]]) -> str | None:
    """A deal's main company from a list answer: the primary link, else the only one."""
    links = associations.get("companies", ())
    for link in links:
        if link.primary:
            return link.id
    unique = {link.id for link in links}
    return unique.pop() if len(unique) == 1 else None


def get_hubspot(settings: Settings | None = None) -> HttpHubSpot | None:
    """A client for the key in settings, or None when there is no key. Writes are allowed only
    when HUBSPOT_WRITE_ENABLED is true. The caller closes it (`async with`)."""
    settings = settings or get_settings()
    secret = settings.hubspot_service_key
    key = secret.get_secret_value().strip() if secret is not None else ""
    if not key:
        return None
    return HttpHubSpot(
        key,
        api_version=settings.hubspot_api_version,
        writes_allowed=settings.hubspot_write_enabled,
        timeout=settings.hubspot_timeout_seconds,
        requests_per_second=settings.hubspot_requests_per_second,
        searches_per_second=settings.hubspot_searches_per_second,
    )
