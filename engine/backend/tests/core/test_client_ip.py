"""`client_ip`: whose word is taken for a visitor's address behind App Platform (PLAN-V8).

On a server behind App Platform there is no proxy of ours with a fixed address. Its front door
writes the visitor's real address in one header (`do-connecting-ip`), and settings name that header
(`CLIENT_IP_HEADER`). The sign-in log and the limit on wrong tries from one address both rely on
this being right, so each way it could go wrong has a test.
"""

import pytest
from fastapi import FastAPI
from starlette.requests import Request

from core.api.signin import client_ip

FRONT_DOOR = ("10.1.2.3", 50000)  # whoever connected: App Platform's front door, not the visitor
HEADER = "do-connecting-ip"


def request(
    headers: dict[str, str] | list[tuple[str, str]],
    *,
    header: str | None = HEADER,
    peer: tuple[str, int] | None = FRONT_DOOR,
) -> Request:
    app = FastAPI()
    app.state.client_ip_header = header
    lines = list(headers.items()) if isinstance(headers, dict) else headers
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": [(name.lower().encode(), value.encode()) for name, value in lines],
        "client": peer,
        "server": ("backend", 8000),
        "scheme": "http",
        "app": app,
    }
    return Request(scope)


def test_the_address_in_the_named_header_is_the_visitors() -> None:
    assert client_ip(request({"Do-Connecting-IP": "203.0.113.9"})) == "203.0.113.9"


def test_an_ipv6_address_is_written_the_one_way() -> None:
    found = client_ip(request({HEADER: " 2001:0DB8:0000:0000:0000:0000:0000:0001 "}))
    assert found == "2001:db8::1"


@pytest.mark.parametrize(
    "value", ["", "not an address", "203.0.113.9, 198.51.100.7", "999.1.1.1", "203.0.113.9:443"]
)
def test_a_header_that_holds_anything_but_one_address_is_not_believed(value: str) -> None:
    assert client_ip(request({HEADER: value})) == FRONT_DOOR[0]


def test_a_request_without_the_header_gets_the_address_of_whoever_connected() -> None:
    """A health check from inside, for one. It did not come through the front door."""
    assert client_ip(request({})) == FRONT_DOOR[0]


def test_a_forwarding_header_is_never_read_when_a_header_is_named() -> None:
    """On App Platform X-Forwarded-For holds the front server's address, and a visitor can add to
    it. Only the one header in settings counts."""
    forged = {"X-Forwarded-For": "198.51.100.7", "Forwarded": "for=198.51.100.8"}
    assert client_ip(request({**forged, HEADER: "203.0.113.9"})) == "203.0.113.9"
    assert client_ip(request(forged)) == FRONT_DOOR[0]


def test_when_the_header_comes_twice_the_last_line_is_the_front_doors() -> None:
    """A visitor can send the header too. A front door that adds its own line, rather than
    replacing theirs, adds it last."""
    written = [(HEADER, "198.51.100.7"), (HEADER, "203.0.113.9")]
    assert client_ip(request(written)) == "203.0.113.9"
    # A last line that is not an address is not believed, and an earlier line is not looked at.
    junk_last = [(HEADER, "203.0.113.9"), (HEADER, "not an address")]
    assert client_ip(request(junk_last)) == FRONT_DOOR[0]


def test_where_no_header_is_named_the_header_is_just_a_header() -> None:
    """On the laptop, and behind Caddy, anyone could write it."""
    assert client_ip(request({HEADER: "203.0.113.9"}, header=None)) == FRONT_DOOR[0]


def test_a_request_with_no_peer_and_no_header_has_no_address() -> None:
    assert client_ip(request({}, header=None, peer=None)) is None
