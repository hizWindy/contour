"""PLAN-V28 T1-3: what the core gives live voice's socket, without a database.

- Only our own site's `Origin` opens a WebSocket: the origin guard closes any other (or none) with
  1008 before it opens. CORS never applies to a WebSocket, so this is its only origin check.
- The sign-in dependencies work on a WebSocket as on a request.
- The socket's messages reach the API contract (`components.schemas`), named once.
- uvicorn pings the browser's socket every 20 s and takes no message over 64 KB.
"""

from collections.abc import MutableMapping
from typing import Annotated, Any, Literal

import pytest
import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from starlette.datastructures import Headers
from starlette.websockets import WebSocketDisconnect

from core import cli
from core.api.access import SignedInDep
from core.api.app import create_app, document_schemas
from core.api.security import OriginGuard, socket_origin_allowed
from core.config import Settings

OURS = frozenset({"http://localhost:5173"})


def headers(*origins: str) -> Headers:
    return Headers(raw=[(b"origin", origin.encode()) for origin in origins])


def test_a_socket_needs_exactly_one_origin_and_ours() -> None:
    assert socket_origin_allowed(headers("http://localhost:5173"), OURS)
    assert socket_origin_allowed(headers("HTTP://LOCALHOST:5173"), OURS)
    assert not socket_origin_allowed(headers(), OURS)  # none: not a browser on our site
    assert not socket_origin_allowed(headers("https://evil.example"), OURS)
    assert not socket_origin_allowed(headers("null"), OURS)
    assert not socket_origin_allowed(headers("http://localhost:5173", "https://evil.example"), OURS)


async def test_the_origin_guard_closes_a_foreign_socket_before_it_opens() -> None:
    reached: list[str] = []

    async def app(scope: Any, receive: Any, send: Any) -> None:
        reached.append(scope["path"])

    sent: list[dict[str, Any]] = []

    async def send(message: MutableMapping[str, Any]) -> None:
        sent.append(dict(message))

    async def receive() -> MutableMapping[str, Any]:
        return {"type": "websocket.connect"}

    guard = OriginGuard(app, allowed=OURS)
    for origin in (None, "https://evil.example"):
        raw = [(b"origin", origin.encode())] if origin else []
        await guard({"type": "websocket", "path": "/ws", "headers": raw}, receive, send)
    assert sent == [{"type": "websocket.close", "code": 1008}] * 2
    assert reached == []
    await guard(
        {"type": "websocket", "path": "/ws", "headers": [(b"origin", b"http://localhost:5173")]},
        receive,
        send,
    )
    assert reached == ["/ws"]


def test_the_sign_in_dependencies_work_on_a_socket() -> None:
    """With sign-in off a socket's route gets no person, as a request's does."""
    app = FastAPI()
    seen: list[object] = []

    @app.websocket("/ws")
    async def socket(websocket: WebSocket, auth: SignedInDep) -> None:
        seen.append(auth)
        await websocket.accept()
        await websocket.close()

    from core.api.signin import auth_settings_dependency

    app.dependency_overrides[auth_settings_dependency] = lambda: Settings(_env_file=None)
    with (
        TestClient(app) as client,
        client.websocket_connect("/ws") as ws,
        pytest.raises(WebSocketDisconnect),
    ):
        ws.receive_text()
    assert seen == [None]


def test_the_sockets_messages_are_in_the_contract() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    relay = schemas["VoiceRelayMessage"]
    assert relay["discriminator"]["propertyName"] == "type"
    assert set(relay["discriminator"]["mapping"]) == {
        "ready",
        "heard",
        "said",
        "interrupted",
        "turn_complete",
        "tool_call",
        "tool_cancel",
        "reconnecting",
        "reconnected",
        "ended",
    }
    browser = schemas["VoiceBrowserMessage"]
    assert set(browser["discriminator"]["mapping"]) == {"pause", "stop", "tool_answer"}
    for name in [
        *relay["discriminator"]["mapping"].values(),
        *browser["discriminator"]["mapping"].values(),
    ]:
        model = schemas[name.rsplit("/", 1)[1]]
        assert "type" in model["required"]  # the website narrows on it


class Thing(BaseModel):
    type: Literal["a"]


class OtherThing(BaseModel):
    type: Literal["b"]
    size: int


type Things = Annotated[Thing | OtherThing, Field(discriminator="type")]


def test_a_contract_type_needs_a_name_and_names_are_never_shared() -> None:
    schema: dict[str, Any] = {"components": {"schemas": {}}}
    document_schemas(schema, [(Things, "validation")])
    assert set(schema["components"]["schemas"]) == {"Things", "Thing", "OtherThing"}
    document_schemas(schema, [(Things, "validation")])  # the same again is fine
    clash: dict[str, Any] = {"components": {"schemas": {"Thing": {"type": "string"}}}}
    with pytest.raises(RuntimeError, match="Two types are called Thing"):
        document_schemas(clash, [(Things, "validation")])
    with pytest.raises(RuntimeError, match="needs a name"):
        document_schemas(schema, [(Thing | OtherThing, "validation")])


def test_uvicorn_pings_the_browsers_socket_and_caps_its_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configs: list[uvicorn.Config] = []
    reloads: list[dict[str, Any]] = []

    class FakeServer:
        def __init__(self, config: uvicorn.Config) -> None:
            configs.append(config)

        async def serve(self) -> None: ...

    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    monkeypatch.setattr(uvicorn, "run", lambda target, **kwargs: reloads.append(kwargs))
    monkeypatch.setattr(cli, "migrate", lambda: None)
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(_env_file=None))
    assert cli.serve() == 0
    assert cli.serve(reload=True) == 0
    (config,) = configs
    assert (config.ws_ping_interval, config.ws_ping_timeout, config.ws_max_size) == (
        20.0,
        20.0,
        64 * 1024,
    )
    (reload,) = reloads
    assert (reload["ws_ping_interval"], reload["ws_ping_timeout"], reload["ws_max_size"]) == (
        20.0,
        20.0,
        64 * 1024,
    )
