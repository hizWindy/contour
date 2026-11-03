"""Shows how Contour's HubSpot is set up: the company and deal fields, the deal stages and any
custom objects. It reads field definitions only, never a company, deal or contact.

From engine/backend:

    uv run --no-sync python scripts/hubspot_schema.py

Free and read only. It needs HUBSPOT_SERVICE_KEY in engine/.env and never prints it. The whole
answer is saved in scripts/out/ (git-ignored), and the screen shows a summary (PLAN-V5).
"""

import argparse
import io
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx2

from core.config import get_settings
from core.logs import scrub

BASE_URL = "https://api.hubapi.com"
API_VERSION = "2026-09"  # HubSpot's newest dated version on 3 Nov 2026
OUT_DIR = Path(__file__).resolve().parent / "out"
TIMEOUT_SECONDS = 30.0
MAX_WAIT_SECONDS = 30.0
MAX_OPTIONS_SHOWN = 12

# The fields the Lead Finder reads or writes today (core/hubspot, rules/hubspot_map.yaml).
COMPANY_FIELDS = (
    "name",
    "domain",
    "website",
    "city",
    "state",
    "zip",
    "country",
    "industry",
    "numberofemployees",
    "lifecyclestage",
    "hubspot_owner_id",
    "linkedin_company_page",
    "description",
    "hs_lastmodifieddate",
)
DEAL_FIELDS = (
    "dealname",
    "dealstage",
    "pipeline",
    "amount",
    "closedate",
    "hubspot_owner_id",
    "hs_next_step",
    "hs_lastmodifieddate",
)
# Built-in fields whose choices are worth seeing. Owner choices are people, so they are never shown.
SHOW_CHOICES = frozenset({"industry", "lifecyclestage"})
# Contour's own fields whose choices are staff names, like 'Validated By' (created_by) and
# 'Owner (Reporting)'. Their choices stay in the saved file only.
PEOPLE_WORDS = ("owner", "creator", "_by")


@dataclass
class Answer:
    """What HubSpot said to one check."""

    what: str
    path: str | None = None
    status: int | None = None
    data: Any = None
    problem: str | None = None
    tried: list[str] = field(default_factory=list)


def checks(version: str) -> dict[str, list[str]]:
    """Each check with the paths to try in order: the dated version first, then older ones."""
    return {
        "company fields": [f"/crm/properties/{version}/companies", "/crm/v3/properties/companies"],
        "deal fields": [f"/crm/properties/{version}/deals", "/crm/v3/properties/deals"],
        "deal pipelines": [f"/crm/pipelines/{version}/deals", "/crm/v3/pipelines/deals"],
        "custom objects": [
            f"/crm/object-schemas/{version}/schemas",
            "/crm-object-schemas/v3/schemas",
            "/crm/v3/schemas",
        ],
    }


def read(client: httpx2.Client, what: str, paths: list[str]) -> Answer:
    answer = Answer(what)
    for path in paths:
        answer.tried.append(path)
        reply = get(client, path)
        if reply.status_code == 404:
            continue  # this version doesn't have it: try the next path
        answer.path, answer.status = path, reply.status_code
        if reply.is_success:
            answer.data = reply.json()
        else:
            answer.problem = problem(reply)
        return answer
    answer.problem = "Not found at any of the paths tried"
    return answer


def get(client: httpx2.Client, path: str) -> httpx2.Response:
    """One GET. A 429 waits as long as HubSpot asks, then tries once more."""
    reply = client.get(path)
    if reply.status_code == 429:
        try:
            wait = float(reply.headers.get("Retry-After", "10"))
        except ValueError:
            wait = 10.0
        time.sleep(min(wait, MAX_WAIT_SECONDS))
        reply = client.get(path)
    return reply


def problem(reply: httpx2.Response) -> str:
    """HubSpot's reason, with the scopes it says are missing. Never the key."""
    try:
        body = reply.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return scrub(f"{reply.status_code} {reply.reason_phrase}")
    text = f"{reply.status_code} {body.get('category') or ''}: {body.get('message') or ''}"
    needed = sorted(
        {
            scope
            for error in body.get("errors") or []
            if isinstance(error, dict)
            for key, scopes in (error.get("context") or {}).items()
            if "scope" in key.lower() and isinstance(scopes, list)
            for scope in scopes
        }
    )
    if needed:
        text += f" (needs one of: {', '.join(needed)})"
    return scrub(text)


def field_line(prop: dict[str, Any]) -> str:
    line = (
        f"{prop.get('name')}  '{prop.get('label')}'  {prop.get('type')}/{prop.get('fieldType')}"
        f"  group {prop.get('groupName')}"
    )
    if prop.get("options"):
        line += f", {len(prop['options'])} choices"
    if prop.get("calculated"):
        line += ", calculated"
    if prop.get("externalOptions") or prop.get("referencedObjectType"):
        line += f", choices from {prop.get('referencedObjectType') or 'elsewhere'}"
    return line


def show_choices(prop: dict[str, Any]) -> None:
    """Label -> stored value, because the API gives and wants the stored value."""
    if prop.get("externalOptions") or prop.get("referencedObjectType"):
        return
    if any(word in str(prop.get("name")).lower() for word in PEOPLE_WORDS):
        print("        (choices are people: in the saved file only)")
        return
    options = prop.get("options") or []
    for option in options[:MAX_OPTIONS_SHOWN]:
        print(f"        {option.get('label')!r} -> {option.get('value')!r}")
    if len(options) > MAX_OPTIONS_SHOWN:
        print(f"        ... and {len(options) - MAX_OPTIONS_SHOWN} more (all in the saved file)")


def show_fields(answer: Answer, ours: tuple[str, ...]) -> None:
    print(f"\n== {answer.what} ==")
    if answer.data is None:
        print(f"  Could not read: {answer.problem}")
        return
    props: list[dict[str, Any]] = answer.data.get("results") or []
    by_name = {prop.get("name"): prop for prop in props}
    custom = [prop for prop in props if not prop.get("hubspotDefined")]
    print(f"  {len(props)} fields, {len(custom)} of them made by Contour. Read from {answer.path}")
    print("  The ones we use:")
    for name in ours:
        prop = by_name.get(name)
        print(f"    {field_line(prop) if prop else f'{name}: NOT FOUND'}")
        if prop and name in SHOW_CHOICES:
            show_choices(prop)
    print("  Made by Contour:")
    if not custom:
        print("    none")
    for prop in sorted(custom, key=lambda p: (str(p.get("groupName")), str(p.get("name")))):
        print(f"    {field_line(prop)}")
        show_choices(prop)


def show_pipelines(answer: Answer) -> None:
    print(f"\n== {answer.what} ==")
    if answer.data is None:
        print(f"  Could not read: {answer.problem}")
        return
    for pipeline in answer.data.get("results") or []:
        print(f"  {pipeline.get('label')!r} (id {pipeline.get('id')})")
        stages = sorted(pipeline.get("stages") or [], key=lambda s: s.get("displayOrder") or 0)
        for stage in stages:
            meta = stage.get("metadata") or {}
            extra = ", closed" if str(meta.get("isClosed")).lower() == "true" else ""
            if meta.get("probability") is not None:
                extra += f", win chance {meta['probability']}"
            print(f"    {stage.get('label')!r} -> {stage.get('id')!r}{extra}")


def show_custom_objects(answer: Answer) -> None:
    print(f"\n== {answer.what} ==")
    if answer.data is None:
        print(f"  Could not read: {answer.problem}")
        return
    schemas = answer.data.get("results") or []
    if not schemas:
        print("  none")
    for schema in schemas:
        labels = schema.get("labels") or {}
        props = schema.get("properties") or []
        print(
            f"  {labels.get('plural') or schema.get('name')} ({schema.get('objectTypeId')}): "
            f"{len(props)} fields"
        )
        for prop in props:
            print(f"    {field_line(prop)}")


def save(answers: dict[str, Answer], version: str) -> Path:
    OUT_DIR.mkdir(exist_ok=True)
    now = datetime.now(UTC)
    path = OUT_DIR / f"hubspot-schema-{now:%Y%m%d-%H%M%S}.json"
    record = {
        "checked_at": now.isoformat(),
        "api_version": version,
        "answers": {what: asdict(answer) for what, answer in answers.items()},
    }
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--api-version", default=API_VERSION, help=f"HubSpot's dated version ({API_VERSION})"
    )
    args = parser.parse_args(argv)
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # labels can hold any letter

    key = get_settings().hubspot_service_key
    secret = key.get_secret_value().strip() if key is not None else ""
    if not secret:
        print("HUBSPOT_SERVICE_KEY is missing or empty in engine/.env.")
        return 1

    answers: dict[str, Answer] = {}
    with httpx2.Client(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {secret}"},
        timeout=httpx2.Timeout(TIMEOUT_SECONDS),
    ) as client:
        for what, paths in checks(args.api_version).items():
            answers[what] = read(client, what, paths)
            if answers[what].status == 401:
                print("HubSpot refused the key (401). Check HUBSPOT_SERVICE_KEY in engine/.env.")
                break

    if "company fields" in answers:
        show_fields(answers["company fields"], COMPANY_FIELDS)
    if "deal fields" in answers:
        show_fields(answers["deal fields"], DEAL_FIELDS)
    if "deal pipelines" in answers:
        show_pipelines(answers["deal pipelines"])
    if "custom objects" in answers:
        show_custom_objects(answers["custom objects"])
    print(f"\nThe whole answer is saved in {save(answers, args.api_version)}")
    return 0 if any(answer.data is not None for answer in answers.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
