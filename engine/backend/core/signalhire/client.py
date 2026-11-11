"""Signal Hire: how many people a company has, in all and in a city, and its senior people.

Names and current job titles of a company's senior people come back from a search
(`senior_people`), because Levi said yes to decision makers (2 Nov 2026, PLAN-V4 C5). There is no
method here for contact details: not the Person API, not an employee list. So no email or phone
can come back through this file. Contact details are TBC with Levi (PLAN-V4 Part E).

Projects depend on the `SignalHire` protocol, not on this class, so tests swap in a fake that
returns saved answers and costs nothing. What a call costs (Signal Hire's API pricing, TBC
against the real account):
- `find_company` and `profile_count`: nothing.
- `count_people` and `senior_people`: the daily search quota, which the Signal Hire website
  shares. Never credits.
- `company_info`: 1 company credit for each answer.
- `credits` (the balance, for the Health tab): nothing.

The Company API is off until Signal Hire's support switches it on. A 403 on a company call means
it is still off (`SignalHireCompanyApiOff`). The search doesn't need it, so counting people still
works then, but the company name can't be checked.
The key goes in an `apikey` header and is never logged (core.logs removes it from any line).
A slow answer is never asked again, so a paid call can't be paid for twice.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol, Self

import httpx2
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from core.config import Settings, get_settings

log = logging.getLogger(__name__)

BASE_URL = "https://www.signalhire.com/api/v1"
COMPANY_PATH = "/company/"  # the Company API: what the paths under it have in common
MAX_SEARCHES_AT_ONCE = 3  # Signal Hire answers 429 above this
MAX_TRIES = 3  # a 429 or a server error is tried again, at most twice
MAX_WAIT_SECONDS = 10.0
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_OFFICES = 20
MAX_PEOPLE = 10  # the most profiles one people search asks for

ProfileStatus = Literal["current", "past", "both"]


class SignalHireError(Exception):
    """Signal Hire couldn't answer. `title` and `detail` are safe to show to a person."""

    def __init__(self, title: str, detail: str) -> None:
        super().__init__(f"{title}: {detail}")
        self.title = title
        self.detail = detail


class SignalHireUnavailable(SignalHireError):
    """No connection, a refused key, or the Company API is off. Trying again won't help until
    someone fixes it."""


class SignalHireCompanyApiOff(SignalHireUnavailable):
    """A company call was refused (HTTP 403): the Company API isn't switched on for this account.
    Counting people by search still works, so a caller may go on without the company calls. A
    refused key (401) is not this: it stops everything."""


class SignalHireOutOfQuota(SignalHireError):
    """No company credits left, or the daily search quota is used up (HTTP 402)."""


@dataclass(frozen=True)
class CompanyRef:
    id: int
    slug: str
    name: str


@dataclass(frozen=True)
class Office:
    city: str | None
    area: str | None
    country: str | None
    headquarter: bool


@dataclass(frozen=True)
class PersonOnFile:
    """A person Signal Hire has on file at a company now: the name and current job title only."""

    signalhire_id: str  # Signal Hire's own id, to ask for a contact later (Part E)
    name: str
    title: str | None


@dataclass(frozen=True)
class CompanyInfo:
    name: str | None
    website: str | None
    industry: str | None
    staff_count: int | None  # Signal Hire's estimate for the whole company
    staffing_company: bool | None
    linkedin_id: str | None
    offices: tuple[Office, ...]


class SignalHire(Protocol):
    async def find_company(self, id_or_slug: str) -> CompanyRef | None:
        """The company with this id or slug, or None when Signal Hire doesn't know it. Free."""
        ...

    async def company_info(self, company_id: int) -> CompanyInfo | None:
        """Its details, or None when not found. Costs 1 company credit."""
        ...

    async def profile_count(self, company_id: int, status: ProfileStatus = "current") -> int:
        """How many people Signal Hire has on file for the company. Free."""
        ...

    async def count_people(
        self, *, company: str, location: str | None = None, titles: str | None = None
    ) -> int:
        """How many people Signal Hire has whose current company is `company`, optionally in a
        place and with a current job title that matches `titles` (Signal Hire's search words,
        like 'CEO OR "General Manager"'). Only the count is read. Uses the search quota."""
        ...

    async def senior_people(
        self, *, company: str, location: str, titles: str, size: int
    ) -> list[PersonOnFile]:
        """Up to `size` people whose current company is `company`, in `location`, with a current
        job title that matches `titles`. Name and job title only. Uses the search quota."""
        ...


# --- What Signal Hire sends. Every field is optional and read leniently: a field of an odd type
# is dropped, not an error, because the docs don't promise each type. -----------------------------


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _whole(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _flag(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


class _Reply(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class _Found(_Reply):
    id: int
    slug: str
    company: str


class _Place(_Reply):
    city: str | None = None
    area: str | None = Field(None, alias="geographicArea")
    country: str | None = None
    headquarter: bool | None = None

    @field_validator("city", "area", "country", mode="before")
    @classmethod
    def _plain(cls, value: Any) -> str | None:
        return _text(value)

    @field_validator("headquarter", mode="before")
    @classmethod
    def _boolean(cls, value: Any) -> bool | None:
        return _flag(value)


class _Info(_Reply):
    name: str | None = None
    website: str | None = None
    industry: str | None = None
    staff_count: int | None = Field(None, alias="staffCount")
    staffing_company: bool | None = Field(None, alias="staffingCompany")
    linkedin_id: str | None = Field(None, alias="linkedInId")
    places: list[_Place] = Field(default_factory=list, alias="confirmedLocations")

    @field_validator("name", "website", "industry", mode="before")
    @classmethod
    def _plain(cls, value: Any) -> str | None:
        return _text(value)

    @field_validator("linkedin_id", mode="before")
    @classmethod
    def _id(cls, value: Any) -> str | None:
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        return _text(value)

    @field_validator("staff_count", mode="before")
    @classmethod
    def _count(cls, value: Any) -> int | None:
        return _whole(value)

    @field_validator("staffing_company", mode="before")
    @classmethod
    def _boolean(cls, value: Any) -> bool | None:
        return _flag(value)

    @field_validator("places", mode="before")
    @classmethod
    def _list(cls, value: Any) -> list[Any]:
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


class _Profiles(_Reply):
    total_profiles: int


class _Total(_Reply):
    total: int


class _Job(_Reply):
    title: str | None = None

    @field_validator("title", mode="before")
    @classmethod
    def _plain(cls, value: Any) -> str | None:
        return _text(value)


class _Person(_Reply):
    uid: str
    full_name: str = Field(alias="fullName")
    experience: list[_Job] = Field(default_factory=list)

    @field_validator("experience", mode="before")
    @classmethod
    def _list(cls, value: Any) -> list[Any]:
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _parse[M: _Reply](model: type[M], data: dict[str, Any]) -> M:
    try:
        return model.model_validate(data)
    except ValidationError as error:
        raise SignalHireError(
            "Signal Hire sent an answer we couldn't read",
            "It didn't have the shape its documentation describes.",
        ) from error


def _problem(status: int, path: str) -> SignalHireError:
    """What a failed answer means, in plain words. The body is never repeated: it isn't ours.
    `path` tells a 403 on a company call (the Company API is off) from a 403 on the search."""
    if status == 401:
        return SignalHireUnavailable(
            "Signal Hire refused the key", "An admin needs to check the Signal Hire key."
        )
    if status == 402:
        return SignalHireOutOfQuota(
            "Signal Hire has no credits or quota left",
            "A search uses the daily search quota, which resets each day. A company lookup "
            "uses company credits, bought through support@signalhire.com.",
        )
    if status == 403 and path.startswith(COMPANY_PATH):
        return SignalHireCompanyApiOff(
            "Signal Hire said no",
            "The Company API isn't switched on for this account, or the account is disabled. "
            "Ask support@signalhire.com to switch it on.",
        )
    if status == 403:
        return SignalHireUnavailable(
            "Signal Hire refused the search",
            "This account can't use the search, or it is disabled. Ask support@signalhire.com.",
        )
    if status == 422:
        return SignalHireError(
            "Signal Hire didn't accept the request",
            "A value was refused (422). For a search, check the location and the job titles.",
        )
    if status == 429:
        return SignalHireError(
            "Signal Hire is busy", "Too many requests (429). Try again in a moment."
        )
    return SignalHireError("Signal Hire had a problem", f"It answered with error {status}.")


class HttpSignalHire:
    """The real Signal Hire, over HTTPS. `client` and `pause` are for tests."""

    def __init__(
        self,
        api_key: str,
        *,
        timeout: float = 30.0,
        client: httpx2.AsyncClient | None = None,
        pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._key = api_key
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(timeout))
        self._owns_client = client is None
        self._pause = pause
        self._searches = asyncio.Semaphore(MAX_SEARCHES_AT_ONCE)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # --- The four calls --------------------------------------------------------------------

    async def find_company(self, id_or_slug: str) -> CompanyRef | None:
        data = await self._call("GET", "/company/findById", params={"id": id_or_slug})
        if data is None:
            return None
        found = _parse(_Found, data)
        return CompanyRef(id=found.id, slug=found.slug, name=found.company)

    async def company_info(self, company_id: int) -> CompanyInfo | None:
        data = await self._call("GET", "/company/info", params={"id": str(company_id)})
        if data is None:
            return None
        info = _parse(_Info, data)
        return CompanyInfo(
            name=info.name,
            website=info.website,
            industry=info.industry,
            staff_count=info.staff_count,
            staffing_company=info.staffing_company,
            linkedin_id=info.linkedin_id,
            offices=tuple(
                Office(place.city, place.area, place.country, bool(place.headquarter))
                for place in info.places[:MAX_OFFICES]
            ),
        )

    async def profile_count(self, company_id: int, status: ProfileStatus = "current") -> int:
        data = await self._call(
            "GET",
            "/company/getCount",
            params={"id": str(company_id), "status": status},
            must_find=True,
        )
        return _parse(_Profiles, data).total_profiles

    async def count_people(
        self, *, company: str, location: str | None = None, titles: str | None = None
    ) -> int:
        body = _search_body(company, location, titles, size=1)
        async with self._searches:
            data = await self._call("POST", "/candidate/searchByQuery", body=body, must_find=True)
        return _parse(_Total, data).total

    async def senior_people(
        self, *, company: str, location: str, titles: str, size: int
    ) -> list[PersonOnFile]:
        body = _search_body(company, location, titles, size=max(1, min(size, MAX_PEOPLE)))
        async with self._searches:
            data = await self._call("POST", "/candidate/searchByQuery", body=body, must_find=True)
        found = data.get("profiles")
        people: list[PersonOnFile] = []
        for item in found if isinstance(found, list) else []:
            try:
                person = _Person.model_validate(item)
            except ValidationError:
                continue  # one odd profile is skipped, not an error
            current = person.experience[0].title if person.experience else None
            people.append(PersonOnFile(person.uid, person.full_name, current))
        return people

    async def credits(self) -> int:
        """The account's credit balance (`GET /credits`). It reads the balance and spends nothing,
        so Admin's Health tab uses it to check the key (PLAN-V13 T1-2). Not in the protocol: no
        project needs it."""
        data = await self._call("GET", "/credits", must_find=True)
        value = data.get("credits")
        if isinstance(value, bool) or not isinstance(value, int):
            raise SignalHireError(
                "Signal Hire sent an answer we couldn't read", "It had no credit balance."
            )
        return value

    # --- One request -----------------------------------------------------------------------

    async def _call(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        must_find: bool = False,
    ) -> Any:
        """The answer as a dict. None for a 404 (a company Signal Hire doesn't know), unless
        `must_find` says a 404 is an error."""
        response = await self._send(method, path, params, body)
        for attempt in range(MAX_TRIES - 1):
            if response.status_code not in RETRY_STATUSES:
                break
            await self._pause(self._wait(response, attempt))
            response = await self._send(method, path, params, body)
        if response.status_code == 404 and not must_find:
            return None
        if response.status_code != 200:
            raise _problem(response.status_code, path)
        try:
            data = response.json()
        except ValueError as error:
            raise SignalHireError(
                "Signal Hire sent an answer we couldn't read", "It wasn't JSON."
            ) from error
        if not isinstance(data, dict):
            raise SignalHireError(
                "Signal Hire sent an answer we couldn't read", "It wasn't a JSON object."
            )
        return data

    async def _send(
        self,
        method: str,
        path: str,
        params: dict[str, str] | None,
        body: dict[str, Any] | None,
    ) -> httpx2.Response:
        try:
            response = await self._client.request(
                method,
                f"{BASE_URL}{path}",
                params=params,
                json=body,
                headers={"apikey": self._key},
            )
        except httpx2.TimeoutException as error:
            # Not asked again: the call may have been paid for already.
            raise SignalHireError(
                "Signal Hire took too long", "It didn't answer in time. Try again in a moment."
            ) from error
        except httpx2.HTTPError as error:
            raise SignalHireUnavailable(
                "Signal Hire can't be reached", "Check the connection, then try again."
            ) from error
        log.info("signalhire_call", extra={"endpoint": path, "status": response.status_code})
        return response

    @staticmethod
    def _wait(response: httpx2.Response, attempt: int) -> float:
        """Seconds to wait before the next try: what Signal Hire asks for, or 0.5, 1, 2 ..."""
        asked = str(response.headers.get("retry-after", ""))
        if asked.isdigit():
            return min(float(asked), MAX_WAIT_SECONDS)
        return min(0.5 * (1 << attempt), MAX_WAIT_SECONDS)


def _search_body(
    company: str, location: str | None, titles: str | None, *, size: int
) -> dict[str, Any]:
    """A search for the people whose current company is `company`. The name goes in quotes, so a
    name like "AT&T" or "Bell AND Howell" is read as one phrase, not as a search with operators
    (Signal Hire reads AND, OR and NOT in this field). The job titles are Signal Hire's search
    words, as given. (A `seniority` field is not read by Signal Hire: checked on 2 Nov 2026.)"""
    name = company.replace('"', " ").strip()
    if not name:
        raise ValueError("a search needs a company name")
    body: dict[str, Any] = {"currentCompany": f'"{name}"', "size": size}
    if location:
        body["location"] = location
    if titles:
        body["currentTitle"] = titles
    return body


def get_signalhire(settings: Settings | None = None) -> HttpSignalHire | None:
    """A client for the key in settings, or None when there is no key. The caller closes it
    (`async with`)."""
    settings = settings or get_settings()
    secret = settings.signalhire_api_key
    key = secret.get_secret_value().strip() if secret is not None else ""
    if not key:
        return None
    return HttpSignalHire(key, timeout=settings.signalhire_timeout_seconds)
