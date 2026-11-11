"""The App Platform file (PLAN-V8): the facts it must keep, checked without DigitalOcean.

Nobody deploys on every change, so a slip in `.do/app.yaml` would first show on DigitalOcean: as a
deploy that fails or, worse, as a backend that runs and is wrong (two copies, a key written in the
file, an address nobody can reach). Each test names one thing the other files rely on.
"""

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
import yaml

from core.api.app import API_PREFIX
from core.api.security import allowed_origins, trusted_hosts
from core.config import Settings
from core.runs.checkpoint import POOL_MAX_SIZE

ENGINE = Path(__file__).resolve().parents[3]
ROOT = ENGINE.parent
SPEC = ROOT / ".do" / "app.yaml"
COMPOSE = ENGINE / "deploy" / "docker-compose.prod.yml"

# What App Platform puts in place of the ${...} names, for an app like this one.
APP_URL = "https://contour-hq-x7k2q.ondigitalocean.app"
DATABASE_VALUES = {
    "HOSTNAME": "contour-db-do-user-1-0.d.db.ondigitalocean.com",
    "PORT": "25060",
    "USERNAME": "contour",
    "PASSWORD": "a-stand-in-and-not-a-password",
    "DATABASE": "contour",
}

# The managed cluster's plan (US$15.15: 1 GB) lets an app open 22 connections (read on
# DigitalOcean's Create page, 6 Nov 2026).
SMALLEST_DATABASE_CONNECTIONS = 22


def spec() -> dict[str, Any]:
    data = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def components() -> list[dict[str, Any]]:
    """Every part App Platform builds: the services, the static sites and the jobs."""
    data = spec()
    return [*data["services"], *data["static_sites"], *data["jobs"]]


def part(kind: str, name: str) -> dict[str, Any]:
    found: list[dict[str, Any]] = [item for item in spec()[kind] if item["name"] == name]
    assert len(found) == 1, f"{kind} has {len(found)} parts called {name}"
    return found[0]


def environment() -> dict[str, Any]:
    """The settings shared by the backend and the migration step, by name."""
    return {item["key"]: item["value"] for item in spec()["envs"]}


def filled_in() -> dict[str, str]:
    """What App Platform puts in place of each ${...} name the file may use."""
    (database,) = spec()["databases"]
    values = {"APP_URL": APP_URL}
    for name, value in DATABASE_VALUES.items():
        values[f"{database['name']}.{name}"] = value
    return values


def expand(value: str) -> str:
    """The value as the backend gets it. A name App Platform would not fill in fails the test."""
    known = filled_in()

    def fill(found: re.Match[str]) -> str:
        name = found.group(1)
        assert name in known, f"${{{name}}} is not a name App Platform fills in for this app"
        return known[name]

    return re.sub(r"\$\{([^}]+)\}", fill, value)


def secret_names() -> set[str]:
    """The settings that hold a key or a password (typed SecretStr), as environment names."""
    return {
        name.upper()
        for name, field in Settings.model_fields.items()
        if "SecretStr" in str(field.annotation)
    }


@pytest.fixture
def from_the_file(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """The settings the backend builds from what the file gives it, and nothing else."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    for key, value in environment().items():
        monkeypatch.setenv(key, expand(value))
    return Settings(_env_file=None)


# --- One backend, built the way the compose file builds it --------------------------------------


def test_there_is_one_backend_and_it_is_never_scaled() -> None:
    """The engine runs one backend for each database (it takes an advisory lock), so a second
    copy would refuse to start and the deploy would never finish."""
    backend = part("services", "backend")
    assert [service["name"] for service in spec()["services"]] == ["backend"]
    assert backend["instance_count"] == 1
    assert "autoscaling" not in backend


def test_the_backend_and_the_migration_are_built_the_way_compose_builds_them() -> None:
    """Same folder as the build context (the Dockerfile copies pyproject.toml and uv.lock from
    it) and the same Dockerfile, so what runs on App Platform is what the other file tested."""
    compose = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    context = (COMPOSE.parent / compose["backend"]["build"]["context"]).resolve()
    assert (context / "Dockerfile").is_file()
    for item in (part("services", "backend"), part("jobs", "migrate")):
        assert (ROOT / item["source_dir"]).resolve() == context
        assert (ROOT / item["dockerfile_path"]).resolve() == context / "Dockerfile"
    for name in ("pyproject.toml", "uv.lock"):
        assert (context / name).is_file()


def test_the_migration_is_a_step_before_each_deploy_and_runs_what_compose_runs() -> None:
    (job,) = spec()["jobs"]
    assert job["name"] == "migrate"
    assert job["kind"] == "PRE_DEPLOY"
    compose = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    assert job["run_command"].split() == compose["migrate"]["command"]


def test_the_health_check_only_asks_the_port() -> None:
    """The backend answers only to its own public host name (core/api/security.py), and what host
    name App Platform's health check sends is not known: an HTTP check could fail for ever."""
    backend = part("services", "backend")
    check = backend["health_check"]
    assert "http_path" not in check  # no path means a TCP check
    port = Settings.model_fields["api_port"].default
    assert check["port"] == backend["http_port"] == port
    assert f"EXPOSE {port}" in (ENGINE / "backend" / "Dockerfile").read_text(encoding="utf-8")


def test_nothing_deploys_by_itself_on_a_push() -> None:
    """A deploy restarts the backend, and a run in progress stops. Someone presses Deploy."""
    for item in components():
        assert item["github"]["deploy_on_push"] is False, item["name"]


def test_every_part_is_built_from_the_same_repo_and_branch() -> None:
    """A website from one branch and a backend from another would not fit each other."""
    sources = {(item["github"]["repo"], item["github"]["branch"]) for item in components()}
    assert len(sources) == 1


def test_names_are_ones_app_platform_accepts() -> None:
    allowed = re.compile(r"[a-z][a-z0-9-]{0,30}[a-z0-9]")
    names = [component["name"] for component in components()]
    assert len(set(names)) == len(names)
    for name in [spec()["name"], *names, *(db["name"] for db in spec()["databases"])]:
        assert allowed.fullmatch(name), name


def test_the_app_is_in_sydney_and_never_asks_to_turn_the_edge_cache_off() -> None:
    """The people and the data are in Australia. App Platform refuses `disable_edge_cache` for an
    app with a static site (tried 6 Nov); the backend's own no-store keeps its answers out of it."""
    assert spec()["region"] == "syd"
    assert "disable_edge_cache" not in spec()


# --- The front door ----------------------------------------------------------------------------


def test_the_front_door_sends_the_api_to_the_backend_with_its_path_whole() -> None:
    """The backend's routes start with /api/v1. Without `preserve_path_prefix` the front door cuts
    the matched /api off, and every call would be a 404."""
    api, site = spec()["ingress"]["rules"]  # the API first, then everything else
    assert api["match"]["path"]["prefix"] == "/api"
    assert API_PREFIX.startswith("/api/")
    assert api["component"] == {"name": "backend", "preserve_path_prefix": True}
    assert site["match"]["path"]["prefix"] == "/"
    assert site["component"]["name"] == "web"


def test_the_website_calls_the_api_by_the_path_the_front_door_sends_to_the_backend() -> None:
    client = (ENGINE / "frontend" / "src" / "api" / "client.ts").read_text(encoding="utf-8")
    found = re.search(r"^export const API_BASE_URL = '([^']+)'", client, re.MULTILINE)
    assert found, "client.ts no longer names API_BASE_URL"
    assert found.group(1) == API_PREFIX  # relative: the same address as the page


def test_the_website_is_built_with_the_command_and_into_the_folder_the_file_names() -> None:
    site = part("static_sites", "web")
    folder = ROOT / site["source_dir"]
    package = json.loads((folder / "package.json").read_text(encoding="utf-8"))
    assert site["build_command"] == "npm run build"
    assert "build" in package["scripts"]
    # The exact packages the laptop used, and the folder Vite writes to when nothing says otherwise.
    assert (folder / "package-lock.json").is_file()
    assert "outDir" not in (folder / "vite.config.ts").read_text(encoding="utf-8")
    assert site["output_dir"] == "dist"
    # Every address that is not a file is a page of the website, so the catch-all must exist.
    assert site["catchall_document"] == "index.html"
    assert (folder / "index.html").is_file()


# --- What the backend is told ------------------------------------------------------------------


def test_every_setting_in_the_file_is_one_the_backend_reads() -> None:
    """The settings ignore a name they don't know, so a typo here would change nothing, quietly."""
    known = {name.upper() for name in Settings.model_fields}
    for key in environment():
        assert key in known, f"{key} is not a setting"


def test_every_value_is_text_and_none_is_baked_into_the_website() -> None:
    """Unquoted, `true` and `6` are a boolean and a number, which the app spec does not take."""
    for item in spec()["envs"]:
        assert isinstance(item["value"], str), item["key"]
        assert item["scope"] == "RUN_TIME", item["key"]


def test_with_only_what_the_file_gives_the_backend_is_a_server_behind_the_front_door(
    from_the_file: Settings,
) -> None:
    settings = from_the_file
    assert settings.server_mode is True
    assert settings.public_origin == APP_URL
    assert trusted_hosts(settings) == [urlsplit(APP_URL).hostname, "localhost", "127.0.0.1"]
    assert allowed_origins(settings) == frozenset({APP_URL})
    # Whose word is taken for a visitor's address: the front door's header, and no proxy address.
    assert (settings.client_ip_header, settings.trusted_proxies) == ("do-connecting-ip", [])
    assert (settings.auth_required, settings.session_cookie_secure) == (True, True)
    assert settings.auto_migrate is False  # the migration step runs first
    assert settings.listen_host == "0.0.0.0"


def test_the_database_is_the_one_the_file_makes_and_the_backend_talks_to_it_over_tls(
    from_the_file: Settings,
) -> None:
    settings = from_the_file
    assert settings.postgres_host == DATABASE_VALUES["HOSTNAME"]
    assert settings.postgres_port == int(DATABASE_VALUES["PORT"])
    assert settings.postgres_user == DATABASE_VALUES["USERNAME"]
    assert settings.postgres_db == DATABASE_VALUES["DATABASE"]
    assert settings.postgres_password.get_secret_value() == DATABASE_VALUES["PASSWORD"]
    assert settings.postgres_sslmode == "require"


def test_the_database_is_the_managed_cluster_and_its_version_is_text() -> None:
    """A dev database doesn't let the app create its schemas (tried 6 Nov), so it is a managed
    cluster, reached as a user that may create them."""
    (database,) = spec()["databases"]
    assert database["engine"] == "PG"
    assert isinstance(database["version"], str)  # an unquoted 18 is a number
    assert database["production"] is True
    assert (database["cluster_name"], database["db_user"]) == ("contour-db", "doadmin")


def test_the_backend_stays_inside_the_connections_the_smallest_database_allows(
    from_the_file: Settings,
) -> None:
    """The app's pool and its overflow, the run checkpoints' pool, and the one connection that
    holds the one-backend lock. During a deploy the old and the new backend both hold theirs, and
    the migration step opens one more (PLAN-V15 T1-6)."""
    settings = from_the_file
    opened = settings.db_pool_size + settings.db_max_overflow + POOL_MAX_SIZE + 1
    assert opened == 9
    assert 2 * opened + 1 <= SMALLEST_DATABASE_CONNECTIONS


def test_the_backend_alerts_when_it_is_short_of_cpu_or_memory_or_keeps_restarting() -> None:
    [backend] = spec()["services"]
    rules = {alert["rule"]: alert for alert in backend["alerts"]}
    assert set(rules) == {"CPU_UTILIZATION", "MEM_UTILIZATION", "RESTART_COUNT"}
    assert all(alert["operator"] == "GREATER_THAN" for alert in rules.values())
    assert {alert["rule"] for alert in spec()["alerts"]} >= {"DEPLOYMENT_FAILED"}
    assert environment()["EMBEDDING_THREADS"] == "1"  # PLAN-V15 T1-4


# --- No secret in the file ---------------------------------------------------------------------


def test_no_key_or_password_is_written_in_the_file() -> None:
    """The file is in git. A secret is added in the dashboard, or filled in by App Platform."""
    for key, value in environment().items():
        if key in secret_names():
            assert re.fullmatch(r"\$\{[^}]+\}", value), f"{key} must not be written in the file"
    assert "sk-ant-" not in SPEC.read_text(encoding="utf-8")


def test_the_file_names_every_secret_the_dashboard_has_to_add() -> None:
    """The list at the top is where the person setting up the app learns which keys to paste. A new
    secret setting must reach that list, so this fails until it does."""
    text = SPEC.read_text(encoding="utf-8")
    for name in sorted(secret_names() | {"FIRST_ADMIN_EMAIL"}):
        assert name in text, f"{name} is not named in .do/app.yaml"
