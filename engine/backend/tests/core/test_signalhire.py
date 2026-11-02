"""The Signal Hire client: what it sends, what it makes of the answers, and that it never asks for
a person. No real request is made."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx2
import pytest

from core.config import Settings, get_settings
from core.logs import REDACTED, redact
from core.signalhire.client import (
    MAX_SEARCHES_AT_ONCE,
    MAX_TRIES,
    CompanyRef,
    HttpSignalHire,
    Office,
    PersonOnFile,
    SignalHireCompanyApiOff,
    SignalHireError,
    SignalHireOutOfQuota,
    SignalHireUnavailable,
    get_signalhire,
)

KEY = "sh-test-key-1234567890abcdef"
Handler = Callable[[httpx2.Request], httpx2.Response | Awaitable[httpx2.Response]]


def make(handler: Handler, pauses: list[float] | None = None) -> HttpSignalHire:
    async def pause(seconds: float) -> None:
        if pauses is not None:
            pauses.append(seconds)

    transport = httpx2.MockTransport(handler)  # type: ignore[arg-type]
    return HttpSignalHire(KEY, client=httpx2.AsyncClient(transport=transport), pause=pause)


def answer(status: int, data: Any = None, **headers: str) -> httpx2.Response:
    named = {name.replace("_", "-"): value for name, value in headers.items()}  # retry_after
    return httpx2.Response(status, json=data if data is not None else {}, headers=named)


async def test_find_company_sends_the_key_and_reads_the_company() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return answer(200, {"id": 1033, "slug": "accenture", "company": "Accenture"})

    found = await make(handler).find_company("accenture")

    assert found == CompanyRef(id=1033, slug="accenture", name="Accenture")
    (request,) = seen
    assert request.method == "GET"
    assert request.url.path == "/api/v1/company/findById"
    assert request.url.params["id"] == "accenture"
    assert request.headers["apikey"] == KEY
    assert KEY not in str(request.url)  # the key is in a header, never in the address


async def test_a_company_signal_hire_does_not_know_is_none_and_is_not_asked_twice() -> None:
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return answer(404)

    assert await make(handler).find_company("nobody") is None
    assert len(calls) == 1


async def test_company_info_reads_the_numbers_and_drops_odd_values() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/api/v1/company/info"
        return answer(
            200,
            {
                "name": "Acme",
                "website": "https://acme.example",
                "industry": ["not", "a", "string"],
                "staffCount": 700,
                "staffCountRange": 5,
                "staffingCompany": False,
                "linkedInId": 98765,
                "phone": "+61 3 0000 0000",  # never read
                "confirmedLocations": [
                    {
                        "city": "Melbourne",
                        "geographicArea": "Victoria",
                        "country": "Australia",
                        "headquarter": True,
                    },
                    {"city": None, "country": 7},
                    "junk",
                ],
            },
        )

    info = await make(handler).company_info(5)

    assert info is not None
    assert (info.name, info.website, info.staff_count) == ("Acme", "https://acme.example", 700)
    assert info.industry is None  # an odd type is dropped, not an error
    assert (info.staffing_company, info.linkedin_id) == (False, "98765")
    assert info.offices == (
        Office("Melbourne", "Victoria", "Australia", True),
        Office(None, None, None, False),
    )
    assert not hasattr(info, "phone")


async def test_profile_count_sends_the_status() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return answer(200, {"total_profiles": 41})

    assert await make(handler).profile_count(7, "past") == 41
    assert seen[0].url.path == "/api/v1/company/getCount"
    assert dict(seen[0].url.params) == {"id": "7", "status": "past"}


async def test_count_people_asks_for_one_profile_and_reads_only_the_total() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return answer(
            200,
            {
                "requestId": "r1",
                "total": 214,
                "profiles": [{"uid": "u1", "fullName": "A Person", "contactsFetched": False}],
            },
        )

    total = await make(handler).count_people(
        company="Culture Amp", location="Melbourne, Australia", titles='CEO OR "Head of"'
    )

    assert total == 214
    (request,) = seen
    assert (request.method, request.url.path) == ("POST", "/api/v1/candidate/searchByQuery")
    assert request.headers["apikey"] == KEY
    assert json.loads(request.content) == {
        "currentCompany": '"Culture Amp"',
        "size": 1,
        "location": "Melbourne, Australia",
        "currentTitle": 'CEO OR "Head of"',
    }


async def test_a_company_name_is_searched_as_one_phrase_never_as_operators() -> None:
    sent: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(json.loads(request.content))
        return answer(200, {"total": 1})

    client = make(handler)
    await client.count_people(company='Bell "AND" Howell')

    phrase = sent[0]["currentCompany"]
    assert phrase.startswith('"') and phrase.endswith('"') and phrase.count('"') == 2
    assert "location" not in sent[0] and "currentTitle" not in sent[0]
    with pytest.raises(ValueError, match="company name"):
        await client.count_people(company=' "" ')


@pytest.mark.parametrize(
    ("status", "kind", "words"),
    [
        (401, SignalHireUnavailable, "SIGNALHIRE_API_KEY"),
        (402, SignalHireOutOfQuota, "quota"),
        (403, SignalHireCompanyApiOff, "Company API"),
        (422, SignalHireError, "refused"),
        (500, SignalHireError, "error 500"),
    ],
)
async def test_each_failure_says_what_to_do_and_never_repeats_the_key(
    status: int, kind: type[SignalHireError], words: str
) -> None:
    client = make(lambda request: answer(status, {"echo": KEY}), pauses=[])

    with pytest.raises(kind) as caught:
        await client.profile_count(1)

    assert words in caught.value.detail
    assert KEY not in str(caught.value)
    if kind is SignalHireError:
        assert not isinstance(caught.value, SignalHireUnavailable)


async def test_a_403_on_any_company_call_means_the_company_api_is_off() -> None:
    client = make(lambda request: answer(403, {"echo": KEY}))

    for call in (client.find_company("acme"), client.company_info(1), client.profile_count(1)):
        with pytest.raises(SignalHireCompanyApiOff, match="said no") as caught:
            await call
        assert isinstance(caught.value, SignalHireUnavailable)  # old handlers still catch it
        assert KEY not in str(caught.value)


async def test_a_403_on_the_search_is_not_the_company_api_being_off() -> None:
    """The search doesn't need the Company API, so a refused search is another problem: no
    caller may go on as if only the company calls were missing."""
    client = make(lambda request: answer(403))

    with pytest.raises(SignalHireUnavailable, match="refused the search") as caught:
        await client.count_people(company="Acme")

    assert not isinstance(caught.value, SignalHireCompanyApiOff)


async def test_a_busy_answer_is_tried_again_after_the_wait_signal_hire_asks_for() -> None:
    replies = [
        answer(429, retry_after="2"),
        answer(429, retry_after="2"),
        answer(200, {"total": 9}),
    ]
    pauses: list[float] = []

    total = await make(lambda request: replies.pop(0), pauses).count_people(company="Acme")

    assert total == 9
    assert pauses == [2.0, 2.0]


async def test_without_a_wait_signal_the_wait_doubles() -> None:
    replies = [answer(503), answer(503), answer(200, {"total_profiles": 3})]
    pauses: list[float] = []

    assert await make(lambda request: replies.pop(0), pauses).profile_count(1) == 3
    assert pauses == [0.5, 1.0]


async def test_it_gives_up_after_the_last_try() -> None:
    calls: list[int] = []
    pauses: list[float] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return answer(429)

    with pytest.raises(SignalHireError, match="busy"):
        await make(handler, pauses).profile_count(1)

    assert len(calls) == MAX_TRIES
    assert len(pauses) == MAX_TRIES - 1


async def test_a_slow_answer_is_not_asked_again_because_a_paid_call_may_have_been_paid_for() -> (
    None
):
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        raise httpx2.ReadTimeout("slow", request=request)

    with pytest.raises(SignalHireError, match="too long"):
        await make(handler).company_info(1)

    assert len(calls) == 1


async def test_no_connection_is_unavailable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down", request=request)

    with pytest.raises(SignalHireUnavailable, match="reached"):
        await make(handler).find_company("acme")


@pytest.mark.parametrize("response", [httpx2.Response(200, text="<html>"), answer(200, [1, 2])])
async def test_an_answer_that_is_not_a_json_object_is_an_error(response: httpx2.Response) -> None:
    with pytest.raises(SignalHireError, match="couldn't read"):
        await make(lambda request: response).find_company("acme")


async def test_an_answer_without_what_the_docs_promise_is_an_error() -> None:
    with pytest.raises(SignalHireError, match="couldn't read"):
        await make(lambda request: answer(200, {"slug": "acme"})).find_company("acme")


async def test_searches_run_three_at_a_time_at_most() -> None:
    running = 0
    most = 0

    async def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal running, most
        running += 1
        most = max(most, running)
        await asyncio.sleep(0.01)
        running -= 1
        return answer(200, {"total": 1})

    client = make(handler)
    await asyncio.gather(*(client.count_people(company=f"Acme {n}") for n in range(8)))

    assert most == MAX_SEARCHES_AT_ONCE


async def test_only_the_company_numbers_are_ever_asked_for() -> None:
    """The client has no call for a person, an employee list or contact details."""
    paths: set[str] = set()

    def handler(request: httpx2.Request) -> httpx2.Response:
        paths.add(request.url.path)
        return answer(200, {"id": 1, "slug": "a", "company": "A", "total": 1, "total_profiles": 1})

    client = make(handler)
    await client.find_company("a")
    await client.company_info(1)
    await client.profile_count(1)
    await client.count_people(company="A")

    assert paths == {
        "/api/v1/company/findById",
        "/api/v1/company/info",
        "/api/v1/company/getCount",
        "/api/v1/candidate/searchByQuery",
    }
    public = {name for name in dir(HttpSignalHire) if not name.startswith("_")}
    assert public == {
        "find_company",
        "company_info",
        "profile_count",
        "count_people",
        "senior_people",
        "aclose",
    }


async def test_senior_people_keeps_only_the_id_name_and_current_job_title() -> None:
    """Levi said yes to decision makers' names (2 Nov 2026). A search never brings contact
    details, and nothing else in a profile is kept."""
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return answer(
            200,
            {
                "total": 38,
                "profiles": [
                    {
                        "uid": "u1",
                        "fullName": "Pat Example",
                        "photo": "https://example.com/p.jpg",
                        "location": "Melbourne",
                        "experience": [
                            {"company": "Acme", "title": "Chief Financial Officer"},
                            {"company": "Old Co", "title": "Analyst"},
                        ],
                        "skills": ["finance"],
                        "openToWork": False,
                    },
                    {"uid": "u2", "fullName": "Sam Sample", "experience": "odd"},
                    {"fullName": "No Id"},
                ],
            },
        )

    people = await make(handler).senior_people(
        company="Acme", location="Melbourne, Australia", titles="CEO OR CFO", size=50
    )

    assert people == [
        PersonOnFile("u1", "Pat Example", "Chief Financial Officer"),
        PersonOnFile("u2", "Sam Sample", None),  # no job list: name only
    ]  # the profile with no id is skipped
    sent = json.loads(seen[0].content)
    assert sent == {
        "currentCompany": '"Acme"',
        "location": "Melbourne, Australia",
        "currentTitle": "CEO OR CFO",
        "size": 10,  # at most MAX_PEOPLE, whatever is asked
    }


def test_there_is_no_client_without_a_key() -> None:
    assert get_signalhire(Settings(_env_file=None)) is None
    assert get_signalhire(Settings(_env_file=None, signalhire_api_key="   ")) is None
    assert isinstance(
        get_signalhire(Settings(_env_file=None, signalhire_api_key=KEY)), HttpSignalHire
    )


def test_the_key_is_taken_out_of_every_log_line(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIGNALHIRE_API_KEY", KEY)
    get_settings.cache_clear()
    try:
        assert redact(f"apikey: {KEY}") == f"apikey: {REDACTED}"
    finally:
        get_settings.cache_clear()  # no later test sees the key
