"""Downloads the live backend's log from DigitalOcean App Platform into a file (PLAN-V15 T1-7).

    uv run --no-sync python ../scripts/live_log.py                 # into engine/.dev-logs/
    uv run --no-sync python ../scripts/live_log.py --out live.log
    uv run --no-sync python ../scripts/log_stats.py <the file it names>

It reads `DO_API_KEY` from the environment, or from `engine/.env`, into this process only. The
key is never printed or written anywhere. It only reads: it changes nothing on DigitalOcean.

The log holds what the running backend printed since it started (a deploy starts a new one).
`--type DEPLOY` gives the last deploy's own log instead.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx

ENGINE = Path(__file__).resolve().parent.parent
API = "https://api.digitalocean.com/v2"
TIMEOUT = httpx.Timeout(60.0, connect=10.0)


def read_key(env_file: Path = ENGINE / ".env") -> str | None:
    key = os.environ.get("DO_API_KEY")
    if key:
        return key.strip()
    if not env_file.is_file():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition("=")
        if name.strip() == "DO_API_KEY" and value.strip():
            return value.strip().strip('"').strip("'")
    return None


def find_app(client: httpx.Client, name: str) -> str:
    answer = client.get(f"{API}/apps", params={"per_page": 50})
    answer.raise_for_status()
    for app in answer.json().get("apps", []):
        if app.get("spec", {}).get("name") == name:
            return str(app["id"])
    raise LookupError(f"No app named {name!r} on this DigitalOcean account.")


def log_url(client: httpx.Client, app_id: str, component: str, kind: str) -> str:
    answer = client.get(
        f"{API}/apps/{app_id}/components/{component}/logs",
        params={"type": kind, "follow": "false"},
    )
    answer.raise_for_status()
    body = answer.json()
    url = body.get("url") or body.get("live_url") or next(iter(body.get("historic_urls") or []), "")
    if not url:
        raise LookupError("DigitalOcean gave no log address for this component.")
    return str(url)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--app", default="contour-hq", help="the App Platform app's name")
    parser.add_argument("--component", default="backend")
    parser.add_argument("--type", default="RUN", choices=["RUN", "DEPLOY", "BUILD"])
    parser.add_argument("--out", type=Path, help="where to save it (default: engine/.dev-logs/)")
    args = parser.parse_args(argv)

    key = read_key()
    if not key:
        print("DO_API_KEY isn't set (in the environment or engine/.env).", file=sys.stderr)
        return 1
    out = args.out or ENGINE / ".dev-logs" / (
        f"live-{args.component}-{datetime.now(UTC):%Y%m%d-%H%M%S}.log"
    )
    try:
        content = fetch(key, args.app, args.component, args.type)
    except httpx.HTTPStatusError as error:
        print(f"DigitalOcean answered {error.response.status_code}.", file=sys.stderr)
        return 1
    except (httpx.HTTPError, LookupError) as error:
        print(f"Couldn't get the log: {type(error).__name__}", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(content)
    print(f"Saved {content.count(NEWLINE)} lines to {out}")
    return 0


NEWLINE = b"\n"


def fetch(
    key: str,
    app: str,
    component: str,
    kind: str,
    transport: httpx.BaseTransport | None = None,
) -> bytes:
    """The log's bytes. The key goes to DigitalOcean's API only: the log address carries its own
    token, so the key isn't sent there. `transport` is for the tests."""
    headers = {"Authorization": f"Bearer {key}"}
    with httpx.Client(headers=headers, timeout=TIMEOUT, transport=transport) as client:
        url = log_url(client, find_app(client, app), component, kind)
    with httpx.Client(timeout=TIMEOUT, transport=transport) as plain:
        answer = plain.get(url)
        answer.raise_for_status()
        return answer.content


if __name__ == "__main__":
    raise SystemExit(main())
