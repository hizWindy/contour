"""A rep's open HubSpot tasks for Today (PLAN-V22 T1-3, `core/hubspot/tasks.py`): what the read
asks HubSpot (one search and one read of links: two requests), and what it keeps. No real request
is made: the client talks to a mock, and the rest uses the fake HubSpot. Made-up tasks only."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2
import pytest

from core.hubspot.client import HttpHubSpot, HubSpotMissingScope, HubSpotObject
from core.hubspot.tasks import TASKS_CAP, open_tasks, subject_of, task_of
from tests.core.hubspot_fake import SCOPE_FOR, FakeHubSpot

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)  # 8 pm Wednesday 4 Nov in Melbourne
UNTIL = datetime(2026, 11, 11, 13, 0, tzinfo=UTC)  # the end of Wednesday 11 Nov in Melbourne


def ms(moment: datetime) -> str:
    return str(int(moment.timestamp() * 1000))


def a_task(fake: FakeHubSpot, task_id: str, due: datetime, **more: Any) -> None:
    companies = more.pop("companies", ("201",))
    values: dict[str, str | None] = {
        "hs_task_subject": f"Task {task_id}",
        "hs_task_status": "NOT_STARTED",
        "hs_task_type": "TODO",
        "hs_timestamp": ms(due),
        "hubspot_owner_id": "11",
        **more,
    }
    fake.add_task(task_id, companies=companies, **values)


# --- What the real client sends: two requests ------------------------------------------------


async def test_the_read_is_one_search_then_one_read_of_links() -> None:
    sent: list[tuple[str, str, dict[str, Any]]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        sent.append((request.method, request.url.path, body))
        if request.url.path.endswith("/tasks/search"):
            found = {
                "total": 3,
                "results": [
                    {
                        "id": "502",
                        "properties": {
                            "hs_task_subject": "Call Jo Sample back",
                            "hs_task_status": "IN_PROGRESS",
                            "hs_task_type": "CALL",
                            "hs_task_priority": "HIGH",
                            "hs_timestamp": "2026-11-04T22:00:00Z",
                            "hubspot_owner_id": "11",
                        },
                        "url": "https://app.hubspot.com/tasks/1/view/all/task/502",
                    },
                    {
                        "id": "501",
                        "properties": {
                            "hs_task_subject": "Send the quote",
                            "hs_task_status": "NOT_STARTED",
                            "hs_task_type": "TODO",
                            "hs_timestamp": ms(NOW - timedelta(days=2)),
                            "hubspot_owner_id": "11",
                        },
                    },
                ],
            }
            return httpx2.Response(200, json=found)
        links = {
            "status": "COMPLETE",
            "results": [
                {
                    "from": {"id": "502"},
                    "to": [
                        {"toObjectId": 301, "associationTypes": [{"typeId": 192, "label": None}]},
                        {
                            "toObjectId": 201,
                            "associationTypes": [{"typeId": 192, "label": "Primary"}],
                        },
                    ],
                },
                {"from": {"id": "501"}, "to": [{"toObjectId": 202, "associationTypes": []}]},
            ],
        }
        return httpx2.Response(200, json=links)

    client = HttpHubSpot(
        "pat-na1-test-0000-1111-2222-333344445555",
        client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
        requests_per_second=1000,
        searches_per_second=1000,
    )
    read = await open_tasks(client, "11", due_before=UNTIL)

    assert [(method, path) for method, path, _ in sent] == [
        ("POST", "/crm/objects/2026-09/tasks/search"),
        ("POST", "/crm/associations/2026-09/tasks/companies/batch/read"),
    ]
    search = sent[0][2]
    assert search["filterGroups"] == [
        {
            "filters": [
                {"propertyName": "hubspot_owner_id", "operator": "EQ", "value": "11"},
                {"propertyName": "hs_task_status", "operator": "NEQ", "value": "COMPLETED"},
                {"propertyName": "hs_timestamp", "operator": "LT", "value": ms(UNTIL)},
            ]
        }
    ]
    assert search["sorts"] == [{"propertyName": "hs_timestamp", "direction": "DESCENDING"}]
    assert search["limit"] == TASKS_CAP == 100
    assert "hs_task_body" not in search["properties"]  # a task's body is never read
    assert sent[1][2] == {"inputs": [{"id": "502"}, {"id": "501"}]}

    called, quote = read.tasks
    assert (called.id, called.kind, called.status, called.priority) == (
        "502",
        "call",
        "IN_PROGRESS",
        "high",
    )
    assert called.due_at == datetime(2026, 11, 4, 22, 0, tzinfo=UTC)
    assert called.company_id == "201"  # the primary company, though HubSpot listed it second
    assert called.url == "https://app.hubspot.com/tasks/1/view/all/task/502"
    assert (quote.kind, quote.priority, quote.company_id) == ("todo", None, "202")
    assert read.more == 1  # HubSpot has 3, and 2 came back


async def test_no_task_found_makes_no_second_request() -> None:
    fake = FakeHubSpot()
    read = await open_tasks(fake, "11", due_before=UNTIL)
    assert read.tasks == () and read.more == 0
    assert fake.calls == ["search_tasks"]


# --- What is kept ------------------------------------------------------------------------------


async def test_only_my_open_tasks_due_in_the_window_are_kept_latest_due_first() -> None:
    fake = FakeHubSpot()
    a_task(fake, "501", NOW - timedelta(days=3))  # overdue
    a_task(fake, "502", NOW + timedelta(hours=1), companies=("202", "201"))
    a_task(fake, "503", NOW + timedelta(days=3))
    a_task(fake, "504", NOW, hubspot_owner_id="12")  # another rep's
    a_task(fake, "505", NOW, hs_task_status="COMPLETED")  # done
    a_task(fake, "506", UNTIL + timedelta(days=1))  # after the window
    a_task(fake, "507", NOW, companies=())  # no company
    read = await open_tasks(fake, "11", due_before=UNTIL)
    assert [task.id for task in read.tasks] == ["503", "502", "507", "501"]
    assert {task.id: task.company_id for task in read.tasks} == {
        "503": "201",
        "502": "202",  # the first one linked
        "507": None,
        "501": "201",
    }
    assert fake.calls == ["search_tasks", "linked_tasks_companies"]


def test_a_task_of_someone_else_completed_or_with_no_due_time_is_never_kept() -> None:
    def record(**properties: str | None) -> HubSpotObject:
        values: dict[str, str | None] = {
            "hs_task_subject": "Send the quote",
            "hs_task_status": "NOT_STARTED",
            "hs_timestamp": ms(NOW),
            "hubspot_owner_id": "11",
            **properties,
        }
        return HubSpotObject(id="501", properties=values)

    assert task_of(record(), "11") is not None
    assert task_of(record(hubspot_owner_id="12"), "11") is None
    assert task_of(record(hubspot_owner_id=None), "11") is None
    assert task_of(record(hs_task_status="completed"), "11") is None
    assert task_of(record(hs_timestamp=None), "11") is None
    assert task_of(record(hs_timestamp="not a time"), "11") is None
    blank = task_of(record(hs_task_status=None, hs_task_subject=None), "11")
    assert blank is not None and (blank.status, blank.subject) == ("NOT_STARTED", "Untitled task")


def test_a_subject_loses_its_email_addresses_and_phone_numbers() -> None:
    said = "Email jo.sample@sample.example the quote,\n then call 0412 345 678"
    assert subject_of(said) == "Email [email left out] the quote, then call [number left out]"
    assert len(subject_of("x" * 500)) == 300


async def test_a_key_that_cant_read_tasks_is_refused_as_missing_a_permission() -> None:
    fake = FakeHubSpot()
    fake.scopes.discard(SCOPE_FOR["tasks"])
    with pytest.raises(HubSpotMissingScope):
        await open_tasks(fake, "11", due_before=UNTIL)
