"""The HubSpot client (PLAN-V5 B1): what it sends, how it pages, waits, retries and fails, that a
write is never sent twice, and that the key never reaches a log line. No real request is made."""

import logging
from collections.abc import Callable
from typing import Any

import httpx2
import pytest

from core.config import Settings
from core.hubspot.client import (
    MAX_TRIES,
    HttpHubSpot,
    HubSpotMissingScope,
    HubSpotRejected,
    HubSpotUnavailable,
    HubSpotWritesOff,
    HubSpotWriteUncertain,
    Pacer,
    get_hubspot,
    missing_scopes,
    primary_company,
)
from core.logs import REDACTED, redact

KEY = "pat-na1-test-0000-1111-2222-333344445555"
Handler = Callable[[httpx2.Request], httpx2.Response]


def make(
    handler: Handler,
    *,
    pauses: list[float] | None = None,
    writes: bool = False,
    version: str = "2026-09",
) -> HttpHubSpot:
    async def pause(seconds: float) -> None:
        if pauses is not None:
            pauses.append(seconds)

    transport = httpx2.MockTransport(handler)
    return HttpHubSpot(
        KEY,
        api_version=version,
        writes_allowed=writes,
        client=httpx2.AsyncClient(transport=transport),
        pause=pause,
        requests_per_second=1000,
        searches_per_second=1000,
    )


def answer(status: int, data: Any = None, **headers: str) -> httpx2.Response:
    named = {name.replace("_", "-"): value for name, value in headers.items()}
    return httpx2.Response(status, json=data if data is not None else {}, headers=named)


MISSING = {
    "status": "error",
    "category": "MISSING_SCOPES",
    "message": "This app hasn't been granted all required scopes to make this call.",
    "errors": [{"context": {"requiredGranularScopes": ["crm.objects.companies.write", "x.write"]}}],
}


async def test_a_list_sends_the_key_in_a_header_and_reads_every_page() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        if "after" not in request.url.params:
            return answer(
                200,
                {
                    "results": [{"id": "1", "properties": {"name": "Acme", "city": None}}],
                    "paging": {"next": {"after": "1", "link": "..."}},
                },
            )
        return answer(200, {"results": [{"id": "2", "properties": {"name": "Beta"}}]})

    client = make(handler)
    first = await client.list_objects("companies", properties=["name", "city", "name"])
    second = await client.list_objects("companies", properties=["name"], after=first.after)

    assert [r.id for r in first.results] == ["1"] and first.after == "1"
    assert first.results[0].text("name") == "Acme" and first.results[0].text("city") is None
    assert [r.id for r in second.results] == ["2"] and second.after is None
    request = seen[0]
    assert request.url.path == "/crm/objects/2026-09/companies"
    assert request.url.params["properties"] == "name,city"  # each field once
    assert request.url.params["archived"] == "false"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert KEY not in str(request.url)


async def test_the_older_v3_paths_are_used_when_asked() -> None:
    paths: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/details"):
            return answer(200, {"portalId": 1, "timeZone": "Australia/Melbourne"})
        return answer(200, {"results": []})

    client = make(handler, version="v3")
    await client.list_objects("deals", properties=["dealname"])
    await client.owners()
    await client.account()
    await client.primary_companies(["5"])
    assert paths == [
        "/crm/v3/objects/deals",
        "/crm/v3/owners",
        "/account-info/v3/details",
        "/crm/v4/associations/deals/companies/batch/read",
    ]


async def test_a_busy_answer_waits_as_asked_then_tries_again() -> None:
    pauses: list[float] = []
    replies = [answer(429, retry_after="3"), answer(200, {"results": []})]

    client = make(lambda request: replies.pop(0), pauses=pauses)
    page = await client.list_objects("companies", properties=["name"])

    retry_waits = [seconds for seconds in pauses if seconds >= 0.01]  # not the pacer's tiny gaps
    assert page.results == () and retry_waits == [3.0]


async def test_it_gives_up_after_the_last_try() -> None:
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return answer(429)

    with pytest.raises(HubSpotUnavailable, match="busy"):
        await make(handler).list_objects("companies", properties=["name"])
    assert len(calls) == MAX_TRIES


async def test_a_server_error_on_a_read_is_tried_again() -> None:
    replies = [answer(502), answer(200, {"results": [{"id": "7", "properties": {}}]})]
    page = await make(lambda request: replies.pop(0)).list_objects("deals", properties=[])
    assert [r.id for r in page.results] == ["7"]


async def test_a_missing_scope_names_the_scopes_hubspot_asked_for() -> None:
    with pytest.raises(HubSpotMissingScope) as caught:
        await make(lambda request: answer(403, MISSING)).list_objects("deals", properties=[])
    assert caught.value.scopes == ("crm.objects.companies.write", "x.write")
    assert "crm.objects.companies.write" in caught.value.detail
    assert missing_scopes({"errors": ["odd", {"context": {"other": ["a"]}}]}) == ()


async def test_a_record_hubspot_does_not_have_is_none() -> None:
    client = make(lambda request: answer(404, {"category": "OBJECT_NOT_FOUND"}))
    assert await client.get_object("companies", "123", properties=["name"]) is None


async def test_a_refused_key_says_to_check_the_key_and_never_repeats_it() -> None:
    with pytest.raises(HubSpotUnavailable) as caught:
        await make(lambda request: answer(401, {"message": KEY})).account()
    assert "HUBSPOT_SERVICE_KEY" in caught.value.detail
    assert KEY not in str(caught.value)


async def test_writes_are_refused_while_writing_is_off() -> None:
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return answer(200, {"id": "1"})

    client = make(handler, writes=False)
    with pytest.raises(HubSpotWritesOff):
        await client.create_object("companies", {"name": "Acme"})
    with pytest.raises(HubSpotWritesOff):
        await client.update_object("companies", "1", {"city": "Perth"})
    with pytest.raises(HubSpotWritesOff):
        await client.add_to_list("9", ["1"])
    assert calls == []  # nothing left this computer


async def test_a_write_that_timed_out_is_never_sent_again() -> None:
    calls: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(request.method)
        raise httpx2.ReadTimeout("slow", request=request)

    client = make(handler, writes=True)
    with pytest.raises(HubSpotWriteUncertain):
        await client.create_object("companies", {"name": "Acme"})
    assert calls == ["POST"]


async def test_a_server_error_on_a_write_is_uncertain_and_not_sent_again() -> None:
    calls: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(request.method)
        return answer(503)

    with pytest.raises(HubSpotWriteUncertain):
        await make(handler, writes=True).update_object("companies", "1", {"city": "Perth"})
    assert calls == ["PATCH"]


async def test_a_busy_write_is_sent_again_because_hubspot_refused_it_first() -> None:
    replies = [answer(429), answer(201, {"id": "55", "properties": {"name": "Acme"}})]
    made = await make(lambda r: replies.pop(0), writes=True).create_object(
        "companies", {"name": "Acme"}
    )
    assert made.id == "55"


async def test_a_note_is_linked_to_its_company_when_it_is_made() -> None:
    bodies: list[Any] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        import json

        bodies.append(json.loads(request.content))
        return answer(201, {"id": "77", "properties": {}})

    await make(handler, writes=True).create_object(
        "notes", {"hs_note_body": "hello"}, associate_with_company="123"
    )
    (body,) = bodies
    assert body["associations"][0]["to"] == {"id": "123"}
    assert body["associations"][0]["types"][0]["associationTypeId"] == 190


async def test_a_value_hubspot_refuses_is_rejected_not_uncertain() -> None:
    client = make(lambda r: answer(400, {"category": "VALIDATION_ERROR"}), writes=True)
    with pytest.raises(HubSpotRejected):
        await client.update_object("companies", "1", {"industry": "NOT_A_CODE"})


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [(403, MISSING, False), (404, {"category": "OBJECT_NOT_FOUND"}, True), (500, {}, None)],
)
async def test_the_write_scope_probe_reads_the_answer_and_works_with_writes_off(
    status: int, body: dict[str, Any], expected: bool | None
) -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return answer(status, body)

    assert await make(handler, writes=False).probe_write_scope("companies") is expected
    assert seen[0].url.path == "/crm/objects/2026-09/companies/0"  # record 0 can't exist


async def test_ids_and_field_names_are_checked_before_they_go_into_a_path() -> None:
    client = make(lambda r: answer(200, {}), writes=True)
    with pytest.raises(ValueError, match="record id"):
        await client.get_object("companies", "1/../../owners", properties=[])
    with pytest.raises(ValueError, match="field name"):
        await client.get_property("companies", "name?x=1")


async def test_no_connection_is_unavailable_after_the_tries() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down", request=request)

    with pytest.raises(HubSpotUnavailable, match="can't be reached"):
        await make(handler, writes=True).create_object("companies", {"name": "Acme"})


async def test_owners_keep_the_name_and_never_the_email() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return answer(
            200,
            {
                "results": [
                    {"id": "1", "firstName": "Pat", "lastName": "Lee", "email": "pat@contour"},
                    {"id": "2", "firstName": "", "lastName": None, "email": "x@y"},
                ]
            },
        )

    owners = await make(handler).owners()
    assert [(o.id, o.name) for o in owners] == [("1", "Pat Lee"), ("2", None)]
    assert "email" not in repr(owners)


async def test_a_deals_primary_company_comes_from_its_label() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return answer(
            207,
            {
                "results": [
                    {
                        "from": {"id": "5"},
                        "to": [
                            {"toObjectId": 8, "associationTypes": [{"typeId": 341}]},
                            {"toObjectId": 9, "associationTypes": [{"label": "Primary"}]},
                        ],
                    },
                    {"from": {"id": "6"}, "to": []},
                ]
            },
        )

    assert await make(handler).primary_companies(["5", "6"]) == {"5": "9"}


def test_a_list_answer_names_the_primary_company() -> None:
    from core.hubspot.client import Association

    assert primary_company({"companies": (Association("1", False), Association("2", True))}) == "2"
    assert primary_company({"companies": (Association("1", False),)}) == "1"
    assert (
        primary_company({"companies": (Association("1", False), Association("2", False))}) is None
    )
    assert primary_company({}) is None


async def test_the_pacer_spreads_requests_out() -> None:
    now = [0.0]
    waits: list[float] = []

    async def pause(seconds: float) -> None:
        waits.append(round(seconds, 3))
        now[0] += seconds

    pacer = Pacer(4, clock=lambda: now[0], pause=pause)
    for _ in range(3):
        await pacer.wait()
    assert waits == [0.25, 0.25]


def test_there_is_no_client_without_a_key_and_writes_follow_the_switch() -> None:
    assert get_hubspot(Settings(hubspot_service_key=None)) is None
    assert get_hubspot(Settings(hubspot_service_key="  ")) is None
    off = get_hubspot(Settings(hubspot_service_key=KEY))
    on = get_hubspot(Settings(hubspot_service_key=KEY, hubspot_write_enabled=True))
    assert off is not None and off.writes_allowed is False
    assert on is not None and on.writes_allowed is True


def test_only_the_exact_word_true_turns_writing_on() -> None:
    assert Settings.model_validate({"hubspot_write_enabled": "TRUE "}).hubspot_write_enabled
    for text in ("1", "yes", "on"):
        with pytest.raises(ValueError):
            Settings.model_validate({"hubspot_write_enabled": text})


def test_the_api_version_must_be_a_date_or_v3() -> None:
    assert Settings(hubspot_api_version="2026-03").hubspot_api_version == "2026-03"
    for bad in ("2026-13", "latest", "2026-09/../x"):
        with pytest.raises(ValueError):
            Settings(hubspot_api_version=bad)


async def test_the_key_never_reaches_a_log_line(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from core import config

    monkeypatch.setenv("HUBSPOT_SERVICE_KEY", KEY)
    config.get_settings.cache_clear()
    try:
        caplog.set_level(logging.INFO, logger="core.hubspot.client")
        await make(lambda r: answer(200, {"results": []})).list_objects("companies", properties=[])
        assert caplog.records, "the call should be logged"
        for record in caplog.records:
            assert KEY not in record.getMessage()
            assert KEY not in repr(record.__dict__)
        assert redact(f"Bearer {KEY}") == f"Bearer {REDACTED}"
    finally:
        monkeypatch.setenv("HUBSPOT_SERVICE_KEY", "")
        config.get_settings.cache_clear()
