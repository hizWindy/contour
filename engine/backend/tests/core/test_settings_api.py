"""The settings routes: GET, PATCH and DELETE /api/v1/settings, on the test database."""

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.api.deps import settings_dependency
from core.claude.client import claude_holder
from core.config import EDITABLE_KEYS, get_settings
from core.db.engine import get_session

pytestmark = pytest.mark.integration

SETTINGS = "/api/v1/settings"


@pytest.fixture
def app(session_factory: async_sessionmaker[AsyncSession]) -> FastAPI:
    created = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    created.dependency_overrides[get_session] = test_session
    return created


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    claude_holder.reset()  # the shared daily limit starts clean
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client
    claude_holder.reset()


def by_key(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {field["key"]: field for field in body["fields"]}


def errors_of(response: httpx.Response) -> dict[str, str]:
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    return {error["field"]: error["message"] for error in response.json()["errors"]}


async def test_get_lists_every_setting_and_what_is_left_today(client: httpx.AsyncClient) -> None:
    response = await client.get(SETTINGS)
    assert response.status_code == 200
    body = response.json()
    fields = by_key(body)
    assert set(EDITABLE_KEYS) <= set(fields)
    assert fields["run_cap_usd"]["value"] == "20.00"
    assert fields["hubspot_names_to_claude_ok"]["editable"] is False
    assert body["daily_left_usd"] == f"{get_settings().daily_cap_usd:.2f}"  # nothing spent yet


async def test_patch_changes_only_what_it_lists_and_get_shows_it(client: httpx.AsyncClient) -> None:
    response = await client.patch(SETTINGS, json={"values": {"run_cap_usd": "15.00"}})
    assert response.status_code == 200
    changed = by_key(response.json())["run_cap_usd"]
    assert (changed["value"], changed["overridden"]) == ("15.00", True)
    again = by_key((await client.get(SETTINGS)).json())
    assert again["run_cap_usd"]["value"] == "15.00"
    assert again["run_max_companies"]["overridden"] is False


async def test_a_bad_patch_is_a_422_on_body_values_and_changes_nothing(
    client: httpx.AsyncClient,
) -> None:
    response = await client.patch(
        SETTINGS, json={"values": {"run_cap_usd": "0.10", "run_max_companies": 10}}
    )
    assert errors_of(response) == {"body.values.run_cap_usd": "Must be at least 1.00."}
    assert by_key((await client.get(SETTINGS)).json())["run_max_companies"]["value"] == 20


@pytest.mark.parametrize(
    "body",
    [
        {},  # no values
        {"values": {}},  # an empty change
        {"values": {"run_cap_usd": "15.00"}, "extra": 1},
        {"values": [1, 2]},
        {"values": {"run_cap_usd": {"nested": 1}}},
    ],
)
async def test_a_body_of_the_wrong_shape_is_a_422(
    client: httpx.AsyncClient, body: dict[str, Any]
) -> None:
    response = await client.patch(SETTINGS, json=body)
    assert response.status_code == 422


async def test_the_hubspot_approval_cant_be_turned_on_through_the_api(
    client: httpx.AsyncClient,
) -> None:
    response = await client.patch(SETTINGS, json={"values": {"hubspot_names_to_claude_ok": True}})
    assert "engine/.env" in errors_of(response)["body.values.hubspot_names_to_claude_ok"]
    fields = by_key((await client.get(SETTINGS)).json())
    assert fields["hubspot_names_to_claude_ok"]["value"] is False


async def test_delete_puts_a_setting_back_and_an_unknown_key_is_a_404(
    client: httpx.AsyncClient,
) -> None:
    await client.patch(SETTINGS, json={"values": {"run_max_companies": 7}})
    response = await client.delete(f"{SETTINGS}/run_max_companies")
    assert response.status_code == 200
    assert by_key(response.json())["run_max_companies"]["value"] == 20
    unknown = await client.delete(f"{SETTINGS}/hard_run_cap_usd")
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "setting_not_found"


async def test_no_secret_is_in_any_answer(client: httpx.AsyncClient) -> None:
    settings = get_settings()
    secrets = [settings.postgres_password.get_secret_value()]
    if settings.anthropic_api_key is not None:
        secrets.append(settings.anthropic_api_key.get_secret_value())
    answers = [
        await client.get(SETTINGS),
        await client.patch(SETTINGS, json={"values": {"run_max_companies": 8}}),
        await client.patch(SETTINGS, json={"values": {"run_cap_usd": "x"}}),
        await client.delete(f"{SETTINGS}/run_max_companies"),
    ]
    text = " ".join(answer.text for answer in answers)
    secrets = [secret for secret in secrets if secret]  # an empty key in .env is no secret
    assert [secret in text for secret in secrets] == [False] * len(secrets)
    assert "password" not in text and "api_key" not in text


async def test_a_change_reaches_the_next_request_and_the_shared_claude(
    app: FastAPI, client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await client.patch(
        SETTINGS, json={"values": {"model_discover": "claude-haiku-5-5", "claude_concurrency": 1}}
    )
    async with session_factory() as session:
        settings = await settings_dependency(session)  # what the next request's route gets
    assert settings.model_for("discover") == "claude-haiku-5-5"
    assert settings.claude_concurrency == 1
    assert claude_holder.gate.limit == 1  # the shared gate follows at once, no restart
