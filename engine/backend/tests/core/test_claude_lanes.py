"""Claude's three lanes and the wait (PLAN-V26 T1-1, T1-2): no request waits for another lane."""

import asyncio
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, TypedDict, cast

import anthropic
import httpx
import httpx2
import pytest
from fastapi import FastAPI
from langgraph.graph import END, START, StateGraph

from apps.companies.prep import PrepRunner, prep_out, wait_key
from apps.companies.schemas import PrepStatus
from apps.lead_finder.app import APP as LEAD_FINDER
from core import work
from core.api.guard import SessionGuard
from core.api.signin import auth_settings_dependency
from core.claude.client import AnthropicClaude, claude_holder, lane_sizes
from core.claude.daily import DailyCap, DailyLimitReached
from core.claude.limiter import ClaudeLanes
from core.config import CEILINGS, EDITABLE_KEYS, Settings
from core.runs.manager import RunManager, run_key
from core.schedules.jobs import JobContext, JobResult, JobSpec
from core.schedules.runner import Scheduler
from core.work import LANES, Lane, Work
from tests.core.test_claude import FINAL, Answer

KEYS = tuple(f"claude_{lane}_concurrency" for lane in LANES)
SOMEONE = uuid.UUID(int=7)


class Network:
    """Claude's API, held: each request waits until the test lets it go."""

    def __init__(self) -> None:
        self.started: list[str] = []
        self.one_more = asyncio.Event()
        self.go: dict[str, asyncio.Event] = {}

    def claude(self, lanes: ClaudeLanes, daily: DailyCap | None = None) -> AnthropicClaude:
        async def handler(request: httpx2.Request) -> httpx2.Response:
            name = work.current().key or "?"
            self.started.append(name)
            self.one_more.set()
            await self.go.setdefault(name, asyncio.Event()).wait()
            return httpx2.Response(200, json=FINAL.to_dict())

        transport = httpx2.MockTransport(handler)
        sdk = anthropic.AsyncAnthropic(
            api_key="test-key", http_client=httpx2.AsyncClient(transport=transport)
        )
        return AnthropicClaude(client=sdk, lanes=lanes, daily=daily)

    def ask(self, claude: AnthropicClaude, lane: Lane, name: str) -> "asyncio.Task[Any]":
        with work.doing(Work(lane, key=name)):  # a task keeps the work it was made in
            return asyncio.create_task(claude.ask(system="s", prompt="p", form=Answer))

    def release(self, *names: str) -> None:
        for name in names:
            self.go.setdefault(name, asyncio.Event()).set()

    async def until(self, count: int) -> None:
        async with asyncio.timeout(10):
            while len(self.started) < count:
                self.one_more.clear()
                await self.one_more.wait()


async def test_a_run_holding_both_runs_places_never_delays_a_prep() -> None:
    net, lanes = Network(), ClaudeLanes()
    claude = net.claude(lanes)
    runs = [net.ask(claude, "runs", name) for name in ("run-1", "run-2", "run-3")]
    await net.until(2)
    assert (lanes["runs"].in_flight, lanes["runs"].waiting) == (2, 1)

    prep = net.ask(claude, "people", "prep")
    await net.until(3)
    assert "prep" in net.started  # it began while both Runs places were held
    assert "run-3" not in net.started

    net.release("run-1", "run-2", "run-3", "prep")
    await asyncio.gather(prep, *runs)


async def test_four_people_run_at_once_and_the_fifth_waits() -> None:
    net, lanes = Network(), ClaudeLanes()
    claude = net.claude(lanes)
    names = [f"prep-{n}" for n in range(5)]
    tasks = [net.ask(claude, "people", name) for name in names]
    await net.until(4)
    await asyncio.sleep(0.05)
    assert sorted(net.started) == names[:4]
    assert lanes["people"].waiting == 1

    net.release(names[0])
    await net.until(5)
    net.release(*names)
    await asyncio.gather(*tasks)


async def test_a_search_ahead_prep_waits_in_jobs_not_people() -> None:
    net, lanes = Network(), ClaudeLanes()
    claude = net.claude(lanes)
    first = net.ask(claude, "jobs", "form")
    await net.until(1)
    ahead = net.ask(claude, "jobs", "search-ahead-prep")
    await asyncio.sleep(0.05)
    assert (lanes["jobs"].in_flight, lanes["jobs"].waiting) == (1, 1)
    assert (lanes["people"].in_flight, lanes["people"].waiting) == (0, 0)

    net.release("form", "search-ahead-prep")
    await asyncio.gather(first, ahead)


@pytest.mark.parametrize("lane", LANES)
async def test_the_daily_limit_stops_every_lane(lane: Lane) -> None:
    class Spent:
        def reserve(self) -> Any:
            none = Decimal(0)
            raise DailyLimitReached(cap=Decimal(1), spent=Decimal(1), held=none, needed=Decimal(1))

    net, lanes = Network(), ClaudeLanes()
    claude = net.claude(lanes, cast(DailyCap, Spent()))
    with pytest.raises(DailyLimitReached):
        await net.ask(claude, lane, "over")
    assert net.started == []  # nothing was sent
    assert lanes[lane].in_flight == 0  # and the place came back


# --- The settings ------------------------------------------------------------------------


def test_the_settings_are_four_two_and_one_and_replace_the_old_one() -> None:
    settings = Settings(_env_file=None)
    assert lane_sizes(settings) == {"people": 4, "runs": 2, "jobs": 1}
    for key in KEYS:
        assert key in EDITABLE_KEYS
        assert CEILINGS[key] == "hard_concurrency"
    assert "claude_concurrency" not in EDITABLE_KEYS
    assert "claude_concurrency" not in Settings.model_fields


def test_new_sizes_reach_each_lane() -> None:
    lanes = ClaudeLanes()
    lanes.set_limits(people=3, runs=1, jobs=2)
    assert [lanes[lane].limit for lane in LANES] == [3, 1, 2]


# --- The lane follows who started the work -----------------------------------------------


def test_work_nobody_started_is_a_job() -> None:
    assert work.current() == Work("jobs")


async def test_a_request_is_people_and_so_is_a_task_it_starts() -> None:
    app = FastAPI()
    seen: list[Work] = []

    @app.get("/who")
    async def who() -> None:
        async def background() -> None:
            seen.append(work.current())

        await asyncio.create_task(background())

    settings = Settings(_env_file=None, auth_required=False)
    app.dependency_overrides[auth_settings_dependency] = lambda: settings
    app.add_middleware(SessionGuard)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/who")).status_code == 200
    assert seen == [Work("people")]
    assert work.current() == Work("jobs")  # and nothing is left behind


def run_work(mode: str, *, schedule: uuid.UUID | None = None, **params: Any) -> Work:
    kind = next(kind for kind in LEAD_FINDER.run_kinds if kind.mode == mode)
    entry = SimpleNamespace(run_id=uuid.UUID(int=1))
    job = SimpleNamespace(
        kind=kind,
        params=kind.params_model.model_construct(**params),
        schedule_id=schedule,
        started_by=None if schedule else SOMEONE,
    )
    return RunManager._work(cast(Any, entry), cast(Any, job))


def test_research_again_on_a_lead_is_people_and_other_runs_are_runs() -> None:
    key = run_key(uuid.UUID(int=1))
    one, two = [object()], [object(), object()]
    assert run_work("company", companies=one, recheck=True) == Work("people", SOMEONE, key)
    assert run_work("company", companies=one, recheck=False).lane == "runs"
    assert run_work("company", companies=two, recheck=True).lane == "runs"
    assert run_work("discovery").lane == "runs"
    on_time = run_work("company", schedule=uuid.UUID(int=2), companies=one, recheck=True)
    assert on_time == Work("runs", None, key)  # a schedule started it: nobody waits


def test_the_assistants_research_is_people_behind_the_rest_with_two_places() -> None:
    """PLAN-V27 T4-3: a run the Assistant started is People work that waits behind the lane's
    other requests and holds at most 2 places (`BACKGROUND_PLACES`)."""
    key = run_key(uuid.UUID(int=1))
    one = [object()]
    found = run_work("company", companies=one, recheck=False, from_assistant=True)
    assert found == Work("people", SOMEONE, key, behind=True, most=2)
    assert run_work("company", companies=one, recheck=False, from_assistant=False).lane == "runs"


async def test_while_a_research_runs_another_persons_command_starts_at_once() -> None:
    """PLAN-V27 T4-3 at the lane: the Assistant's research asks 4 questions at once in the People
    lane (4 places); it gets 2. Another person's command starts at once, and a command that waits
    goes ahead of the research's waiting questions."""
    lanes = ClaudeLanes(people=3)
    research = run_work("company", companies=[object()], recheck=False, from_assistant=True)
    entered: list[str] = []
    leave: dict[str, asyncio.Event] = {}

    def ask(name: str, who: Work) -> "asyncio.Task[None]":
        leave[name] = asyncio.Event()

        async def request() -> None:
            async with lanes.acquire():
                entered.append(name)
                await leave[name].wait()

        with work.doing(who):
            return asyncio.create_task(request())

    async def settle() -> None:
        for _ in range(10):
            await asyncio.sleep(0)

    tasks = [ask(f"q{n}", research) for n in range(4)]
    await settle()
    assert entered == ["q0", "q1"]  # 2 places, though 3 are free
    tasks.append(ask("command", Work("people", uuid.UUID(int=8), "cmd:1")))
    await settle()
    assert entered == ["q0", "q1", "command"]  # someone else's command starts at once
    tasks.append(ask("later", Work("people", uuid.UUID(int=9), "cmd:2")))  # the lane is full
    await settle()
    leave["q0"].set()  # one place frees: q2 and q3 waited longer, the later command goes first
    await settle()
    assert entered == ["q0", "q1", "command", "later"]
    for event in leave.values():
        event.set()
    async with asyncio.timeout(5):
        await asyncio.gather(*tasks)
    assert sorted(entered[-2:]) == ["q2", "q3"]


@pytest.mark.parametrize("person", [None, SOMEONE])
async def test_a_scheduled_job_is_jobs_also_from_run_now(
    monkeypatch: pytest.MonkeyPatch, person: uuid.UUID | None
) -> None:
    seen: list[Work] = []

    async def start(context: JobContext) -> JobResult:
        async def a_prep_made_ahead() -> None:
            seen.append(work.current())

        await asyncio.create_task(a_prep_made_ahead())
        return JobResult(ref="done")

    async def finish(*args: Any, **options: Any) -> None:
        return None

    job = JobSpec(key="test.ahead", project="core", title="Ahead", start=start)
    scheduler = Scheduler(app=FastAPI(), sessions=cast(Any, None), jobs=[job])
    monkeypatch.setattr(scheduler, "_finish", finish)
    claim = SimpleNamespace(id=uuid.uuid4(), job=job.key, settings={})
    with work.doing(Work("people", person)):  # "Run now" comes from a request
        await scheduler._fire(cast(Any, claim), datetime.now(UTC))
    assert seen == [Work("jobs", person)]


# --- The wait ----------------------------------------------------------------------------


async def test_a_wait_says_how_many_are_ahead_then_goes() -> None:
    net, lanes = Network(), ClaudeLanes(people=2)
    claude = net.claude(lanes)
    gate = lanes["people"]
    tasks = [net.ask(claude, "people", name) for name in ("a", "b", "c", "d")]
    await net.until(2)
    await asyncio.sleep(0.05)

    assert (gate.ahead("c", waited=0), gate.ahead("d", waited=0)) == (1, 2)
    assert gate.ahead("c") is None  # not yet a second
    assert gate.ahead("a", waited=0) is None  # it started at once, so it never waits
    assert gate.ahead("nobody", waited=0) is None

    net.release("a")
    await net.until(3)
    assert gate.ahead("c", waited=0) is None  # it began, so the words go
    assert gate.ahead("d", waited=0) == 1

    net.release("a", "b", "c", "d")
    await asyncio.gather(*tasks)


async def test_after_a_second_the_wait_is_found_in_its_lane() -> None:
    net, lanes = Network(), ClaudeLanes(jobs=1)
    claude = net.claude(lanes)
    tasks = [net.ask(claude, "jobs", "form"), net.ask(claude, "jobs", "prep")]
    await net.until(1)
    assert lanes.ahead("prep") is None
    await asyncio.sleep(1.1)
    assert lanes.ahead("prep") == 1
    assert lanes.ahead("form") is None

    net.release("form", "prep")
    await asyncio.gather(*tasks)


async def test_a_cancelled_wait_leaves_no_count_behind() -> None:
    net, lanes = Network(), ClaudeLanes(jobs=1)
    claude = net.claude(lanes)
    first, second = net.ask(claude, "jobs", "first"), net.ask(claude, "jobs", "second")
    await net.until(1)
    assert lanes["jobs"].ahead("second", waited=0) == 1
    second.cancel()
    await asyncio.gather(second, return_exceptions=True)
    assert lanes["jobs"].ahead("second", waited=0) is None
    net.release("first")
    await first


async def test_a_prep_asks_claude_under_the_key_its_wait_is_read_by() -> None:
    seen: list[Work] = []

    class Stops(Exception):
        pass

    class Asked:
        async def ask(self, **options: Any) -> Any:
            seen.append(work.current())
            raise Stops

    prep_id = uuid.uuid4()
    runner = PrepRunner(sessions=cast(Any, None), claude=lambda: cast(Any, Asked()), embedder=None)
    with work.doing(Work("people", SOMEONE)), pytest.raises(Stops):
        await runner._ask(
            cast(Any, None),
            cast(Any, SimpleNamespace(id=prep_id)),
            cast(Any, SimpleNamespace(check=lambda: None)),
            prompt="p",
            web=False,
            context=cast(Any, SimpleNamespace(model=None, max_searches=0)),
            subject=None,
        )
    assert seen == [Work("people", SOMEONE, wait_key(prep_id))]
    assert claude_holder.lanes.ahead(wait_key(prep_id)) is None


@pytest.mark.parametrize(("status", "said"), [("searching", 1), ("ready", None), ("failed", None)])
def test_only_a_searching_prep_says_how_many_are_ahead(
    monkeypatch: pytest.MonkeyPatch, status: PrepStatus, said: int | None
) -> None:
    monkeypatch.setattr(claude_holder.lanes, "ahead", lambda key: 1)
    prep = SimpleNamespace(
        id=uuid.uuid4(),
        company_key="101",
        company_name="Northwind",
        contact_id=None,
        person_name=None,
        person_title=None,
        kind="cold",
        trigger="person",
        status=status,
        stage=1,
        facts={},
        error=None,
        script=None,
        sources=[],
        web_searches=0,
        created_at=datetime.now(UTC),
        finished_at=None,
    )
    assert prep_out(cast(Any, prep), made_by=None).waiting_ahead == said


class _Step(TypedDict):
    lane: str


async def test_a_runs_lane_reaches_langgraphs_steps() -> None:
    async def step(state: _Step) -> _Step:
        return {"lane": work.current().lane}

    builder = StateGraph(_Step)
    builder.add_node("step", step)
    builder.add_edge(START, "step")
    builder.add_edge("step", END)
    with work.doing(Work("runs", SOMEONE)):
        task = asyncio.create_task(builder.compile().ainvoke({"lane": ""}))
    assert (await task)["lane"] == "runs"
