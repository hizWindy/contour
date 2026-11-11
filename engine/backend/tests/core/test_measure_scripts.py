"""PLAN-V15 T1-7: the scripts that measure the backend (engine/scripts): the log's numbers, the
load test, and the live log's download."""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import httpx
import pytest
from fastapi import FastAPI

SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def _script(name: str) -> ModuleType:
    """A script from engine/scripts, loaded from its file (it isn't a package)."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


log_stats = _script("log_stats")  # first: load.py imports it
load = _script("load")
live_log = _script("live_log")


def done(route: str, status: int, ms: float, method: str = "GET") -> str:
    record = {
        "time": "2026-11-12T03:00:00+00:00",
        "level": "info",
        "logger": "core.api.request",
        "message": "request_done",
        "request_id": "7F3K92QD",
        "method": method,
        "route": route,
        "status": status,
        "ms": ms,
    }
    return "backend 2026-11-12T03:00:00.000000000Z " + json.dumps(record)


# --- log_stats --------------------------------------------------------------------------------


def test_the_percentile_is_the_nearest_rank() -> None:
    values = [float(n) for n in range(1, 101)]  # 1 to 100 ms
    assert log_stats.percentile(values, 0.50) == 50
    assert log_stats.percentile(values, 0.95) == 95
    assert log_stats.percentile(values, 0.99) == 99
    assert log_stats.percentile([], 0.95) == 0


def test_the_log_gives_each_routes_times_and_the_error_rate(tmp_path: Path) -> None:
    lines = [done("/api/v1/companies", 200, float(ms)) for ms in range(10, 110)]  # 100 fast
    lines += [
        done("/api/v1/companies/{key}", 200, 900.0),
        done("/api/v1/companies/{key}", 500, 30.0),
        done("/api/v1/runs", 503, 2.0),
        "backend 2026-11-12T03:00:01Z "
        + json.dumps({"message": "loop_lag", "lag_ms": 640, "logger": "core.health.loop_lag"}),
        "not json at all",
        "backend 2026-11-12T03:00:02Z {broken",
    ]
    path = tmp_path / "live.log"
    path.write_text("\n".join(lines), encoding="utf-8")

    stats = log_stats.summarize(log_stats.read_log(path))

    assert (stats.requests, stats.errors, stats.unavailable) == (103, 1, 1)
    assert stats.error_rate == pytest.approx(1 / 103)
    assert (stats.loop_lags, stats.worst_lag_ms) == (1, 640)
    companies = next(item for item in stats.routes if item.route == "/api/v1/companies")
    assert (companies.requests, companies.p50_ms, companies.p95_ms) == (100, 59, 104)
    assert stats.routes[0].route == "/api/v1/companies/{key}"  # the slowest p95 first
    table = log_stats.format_stats(stats)
    assert "Server errors (5xx, not 503): 1 (0.97%)" in table
    assert "worst 640 ms" in table


def test_an_old_log_with_access_lines_still_gives_the_error_rate(tmp_path: Path) -> None:
    access = {
        "logger": "uvicorn.access",
        "message": '100.127.1.112:44102 - "GET /api/v1/companies/123/facts HTTP/1.1" 500',
    }
    path = tmp_path / "old.log"
    path.write_text("backend 2026-11-11T16:12:36Z " + json.dumps(access), encoding="utf-8")
    stats = log_stats.summarize(log_stats.read_log(path))
    assert (stats.requests, stats.errors, stats.timed) == (1, 1, 0)
    assert stats.routes[0].route == "/api/v1/companies/{id}/facts"  # no real ids
    assert "no request_done lines" in log_stats.format_stats(stats)


def test_a_missing_file_is_said_plainly(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert log_stats.main([str(tmp_path / "nothing.log")]) == 1
    assert "No such file" in capsys.readouterr().err


# --- load ------------------------------------------------------------------------------------


def test_the_load_test_runs_only_on_this_computer_unless_allowed(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert load.is_local("http://127.0.0.1:8031") and load.is_local("http://localhost:5201")
    assert not load.is_local("https://contour-hq.ondigitalocean.app")
    assert load.main(["--base", "https://contour-hq.ondigitalocean.app"]) == 1
    assert "--allow-remote" in capsys.readouterr().err
    assert load.main(["--users", "0"]) == 1


async def test_the_load_test_measures_every_answer() -> None:
    app = FastAPI()

    @app.get("/api/v1/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/v1/broken")
    async def broken() -> None:
        raise RuntimeError("a bug")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    records = await load.load(
        "http://127.0.0.1:8031",
        users=2,
        seconds=0.3,
        pages=("/api/v1/health", "/api/v1/broken"),
        transport=transport,
    )
    stats = log_stats.summarize(records)
    routes = {item.route: item for item in stats.routes}
    assert routes["/api/v1/health"].errors == 0
    assert routes["/api/v1/broken"].errors == routes["/api/v1/broken"].requests > 0
    assert stats.timed == stats.requests == len(records)


# --- live_log --------------------------------------------------------------------------------


def test_the_key_comes_from_the_environment_or_the_env_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = tmp_path / ".env"
    env.write_text('POSTGRES_DB=x\nDO_API_KEY="from-the-file"\n', encoding="utf-8")
    monkeypatch.delenv("DO_API_KEY", raising=False)
    assert live_log.read_key(env) == "from-the-file"
    monkeypatch.setenv("DO_API_KEY", "from-the-environment")
    assert live_log.read_key(env) == "from-the-environment"
    monkeypatch.delenv("DO_API_KEY")
    assert live_log.read_key(tmp_path / "none") is None


def test_the_log_is_fetched_and_the_key_goes_to_the_api_only() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/v2/apps":
            return httpx.Response(
                200, json={"apps": [{"id": "app-1", "spec": {"name": "contour-hq"}}]}
            )
        if request.url.path == "/v2/apps/app-1/components/backend/logs":
            return httpx.Response(200, json={"url": "https://logs.example.test/x?token=abc"})
        if request.url.host == "logs.example.test":
            return httpx.Response(200, content=b"line one\nline two\n")
        return httpx.Response(404)

    content = live_log.fetch(
        "the-secret-key", "contour-hq", "backend", "RUN", transport=httpx.MockTransport(answer)
    )
    assert content == b"line one\nline two\n"
    api, logs_call, download = seen
    assert api.headers["authorization"] == "Bearer the-secret-key"
    assert logs_call.url.params["type"] == "RUN"
    assert "authorization" not in download.headers  # the log's own token is enough


def test_an_unknown_app_is_said_plainly() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"apps": []})

    with pytest.raises(LookupError, match="No app named"):
        live_log.fetch("k", "contour-hq", "backend", "RUN", transport=httpx.MockTransport(answer))
