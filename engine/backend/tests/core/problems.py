"""Helpers for tests that compare a whole error body (PLAN-V15 T1-2)."""

import httpx


def without_id(response: httpx.Response) -> dict[str, object]:
    """The error body without its `request_id`, after checking that the id is there and is the
    same as the `X-Request-ID` header. So a test can still compare the rest exactly."""
    body = dict(response.json())
    assert body.pop("request_id") == response.headers["x-request-id"]
    return body
