"""The server files (PLAN-V6 Part G): the facts they must keep, checked without Docker.

Nobody builds the images on every change, so a slip in these files would first show on the server.
Each test names one thing the other files rely on.
"""

import ipaddress
import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from core.config import Settings

ENGINE = Path(__file__).resolve().parents[3]
DOCKERFILE = ENGINE / "backend" / "Dockerfile"
COMPOSE = ENGINE / "deploy" / "docker-compose.prod.yml"
CADDYFILE = ENGINE / "deploy" / "Caddyfile"


def compose() -> dict[str, Any]:
    data = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def test_the_image_bakes_in_the_model_the_settings_name() -> None:
    """The container never downloads the model (HF_HUB_OFFLINE), so it must hold the right one."""
    found = re.search(r"^ARG EMBEDDING_MODEL=(\S+)$", DOCKERFILE.read_text("utf-8"), re.MULTILINE)
    assert found, "the Dockerfile has no ARG EMBEDDING_MODEL"
    assert found.group(1) == Settings.model_fields["embedding_model"].default


def test_the_image_runs_as_a_normal_user_with_telemetry_off() -> None:
    text = DOCKERFILE.read_text("utf-8")
    stages = re.split(r"^FROM ", text, flags=re.MULTILINE)[1:]
    assert len(stages) == 2  # build, then run
    for stage in stages:
        # ONNX Runtime sends usage events to Microsoft unless this is set (its Privacy.md).
        assert "ORT_DISABLE_TELEMETRY=1" in stage
    assert re.search(r"^USER contour$", stages[-1], re.MULTILINE)


@pytest.mark.parametrize("name", [".dockerignore", "../frontend/Dockerfile.dockerignore"])
def test_the_keys_file_stays_out_of_every_image(name: str) -> None:
    lines = (ENGINE / "backend" / name).read_text("utf-8").splitlines()
    assert ".env" in lines


def test_only_caddy_is_open_to_the_internet() -> None:
    services = compose()["services"]
    assert services["web"]["ports"]
    for name in ("backend", "migrate", "db"):
        assert "ports" not in services[name], f"{name} must not publish a port"


def test_the_backend_trusts_caddys_address_and_no_other() -> None:
    """If these drifted apart, every visitor would look like the proxy, and the limit on wrong
    sign-ins from one address would lock everybody out together."""
    data = compose()
    caddy = ipaddress.IPv4Address(data["services"]["web"]["networks"]["inside"]["ipv4_address"])
    assert data["services"]["backend"]["environment"]["TRUSTED_PROXIES"] == str(caddy)
    pool = data["networks"]["inside"]["ipam"]["config"][0]
    subnet = ipaddress.IPv4Network(pool["subnet"])
    others = ipaddress.IPv4Network(pool["ip_range"])
    assert caddy in subnet
    # The other parts draw their addresses from this range, which must not hold Caddy's.
    assert caddy not in others
    assert others.subnet_of(subnet)


def test_there_is_one_backend_and_a_migration_before_it() -> None:
    services = compose()["services"]
    assert "scale" not in services["backend"]
    assert "replicas" not in services["backend"].get("deploy", {})
    needs = services["backend"]["depends_on"]["migrate"]["condition"]
    assert needs == "service_completed_successfully"


def test_a_missing_asset_is_a_404_and_never_the_home_page() -> None:
    """Caddy's `try_files` takes no matcher: a first word like `@pages` is read as a file name, so
    every address that isn't a file got index.html, a missing /assets file too, with a year-long
    cache header. The assets have a route of their own, with no `try_files`."""
    text = CADDYFILE.read_text("utf-8")
    assert not re.search(r"^\s*try_files\s+@", text, re.MULTILINE)
    found = re.search(r"^\thandle /assets/\*\s*\{\n(.*?)\n\t\}$", text, re.MULTILINE | re.DOTALL)
    assert found, "the Caddyfile has no handle for /assets/*"
    block = found.group(1)
    assert "try_files" not in block
    assert "file_server" in block
    # The long cache header goes only to a file that is there, so a 404 is never kept for a year.
    assert re.search(r"^\t\theader @found Cache-Control .*immutable", block, re.MULTILINE)


def test_every_part_keeps_its_logs_small() -> None:
    """Docker keeps a log for ever unless told not to: a busy server would fill its disk."""
    for name, service in compose()["services"].items():
        options = service["logging"]["options"]
        assert options["max-size"] and options["max-file"], name


def caddy_header(name: str) -> str:
    """One header's value, from the site's `header` block."""
    text = CADDYFILE.read_text("utf-8")
    found = re.search(rf'^\t\t{re.escape(name)} "([^"]*)"$', text, re.MULTILINE)
    assert found, f"the Caddyfile has no {name} header"
    return found.group(1)


def content_policy() -> dict[str, list[str]]:
    return {
        parts[0]: parts[1:]
        for parts in (item.split() for item in caddy_header("Content-Security-Policy").split(";"))
        if parts
    }


def test_the_mic_works_on_our_own_pages_and_the_rest_stays_off() -> None:
    """Call notes (PLAN-V17 T1-6): a rep talks to the app after a call, so the mic is allowed
    for our own pages, and for no other site's. The camera, the location, payments and USB stay
    off."""
    features = dict(
        item.strip().split("=", 1) for item in caddy_header("Permissions-Policy").split(",")
    )
    assert features["microphone"] == "(self)"
    for name in ("camera", "geolocation", "payment", "usb"):
        assert features[name] == "()", name


def test_our_own_worker_may_run_webassembly_and_nothing_else_opens() -> None:
    """The speech model runs in a Web Worker from our own site, as WebAssembly (PLAN-V17 T1-6).
    So scripts may compile WebAssembly, a worker may come from our own origin only, and no
    script may be inline or built from text. The only places outside our own site are the
    ones that were there before: the map tiles and inline images."""
    policy = content_policy()
    assert policy["script-src"] == ["'self'", "'wasm-unsafe-eval'"]
    assert policy["worker-src"] == ["'self'"]
    assert policy["default-src"] == policy["connect-src"] == ["'self'"]
    keywords = {"'self'", "'none'", "'unsafe-inline'", "'wasm-unsafe-eval'"}
    elsewhere = {value for values in policy.values() for value in values if value not in keywords}
    assert elsewhere == {"data:", "https://tile.openstreetmap.org"}
    assert "'unsafe-inline'" not in policy["script-src"]
    assert "'unsafe-inline'" in policy["style-src"]  # only for styles, as before
