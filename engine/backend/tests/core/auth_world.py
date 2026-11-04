"""The harness the sign-in tests share (PLAN-V6 B3 and B4): the real app, a clock the test can
move, a cheap password hasher, a fresh database session for every request, and a browser that keeps
cookies the way a browser does. The fixtures `world` and `browser` are in `conftest.py`.

Every password here is made up.
"""

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.api.signin import auth_settings_dependency
from core.auth import admin
from core.auth.models import User
from core.auth.passwords import Hasher
from core.config import Settings
from core.db.engine import get_session

API = "/api/v1/auth"
GOOD = "tulip harbour bicycle moonlight"
FAST = Hasher(time_cost=1, memory_cost=8, parallelism=1)
CHROME = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
START = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
Factory = async_sessionmaker[AsyncSession]


class Clock:
    """The time the app sees. `advance` moves it, as the days of a real session would."""

    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **change: float) -> None:
        self.now += timedelta(**change)


@dataclass
class World:
    app: FastAPI
    clock: Clock
    factory: Factory

    def settings(self, **values: Any) -> Settings:
        """Replaces the sign-in settings the app sees. Sign-in is required unless said otherwise."""
        chosen = Settings(_env_file=None, **{"auth_required": True, **values})
        self.app.dependency_overrides[auth_settings_dependency] = lambda: chosen
        return chosen

    def browser(
        self, agent: str = CHROME, *, base_url: str = "http://localhost", ip: str = "127.0.0.1"
    ) -> httpx.AsyncClient:
        """A browser on this app, coming from this IP address."""
        transport = httpx.ASGITransport(
            app=self.app, raise_app_exceptions=False, client=(ip, 40000)
        )
        return httpx.AsyncClient(
            transport=transport, base_url=base_url, headers={"User-Agent": agent}
        )


def build_world(session_factory: Factory) -> World:
    app = create_app()
    clock = Clock()
    app.state.clock = clock
    app.state.hasher = FAST
    app.state.session_factory = session_factory  # the guard's own look-ups

    async def a_session_for_each_request() -> AsyncIterator[AsyncSession]:
        async with session_factory() as db:
            yield db

    app.dependency_overrides[get_session] = a_session_for_each_request
    made = World(app, clock, session_factory)
    made.settings()
    return made


async def make_account(world: World, **changes: Any) -> User:
    values: dict[str, Any] = {
        "email": "al.khair@example.test",
        "username": "alkhair",
        "name": "Al Khair",
        "password": GOOD,
        "now": world.clock.now,
        "hasher": FAST,
    }
    async with world.factory() as db:
        return await admin.create_admin(db, **{**values, **changes})


async def sign_in(client: httpx.AsyncClient, **changes: Any) -> httpx.Response:
    body = {"login": "alkhair", "password": GOOD, **changes}
    return await client.post(f"{API}/login", json=body)


async def me(client: httpx.AsyncClient) -> httpx.Response:
    return await client.get(f"{API}/me")


def moment(text_value: str) -> datetime:
    return datetime.fromisoformat(text_value)


async def all_rows(world: World, model: type[Any]) -> list[Any]:
    async with world.factory() as db:
        return list(await db.scalars(select(model)))


def token_in(response: httpx.Response) -> str:
    found = re.match(r"(?:__Host-)?contour_session=([^;]+);", response.headers["set-cookie"])
    assert found is not None
    return found.group(1)


class CountingHasher(Hasher):
    """A cheap hasher that counts the work it was asked to do: real checks and the dummy ones a
    login that matches no account gets. A try that is refused for waiting must add to neither."""

    def __init__(self) -> None:
        super().__init__(time_cost=1, memory_cost=8, parallelism=1)
        self.checked = 0
        self.burned = 0

    async def averify(self, stored: str, password: str) -> tuple[bool, bool]:
        self.checked += 1
        return await super().averify(stored, password)

    async def aburn(self, password: str) -> None:
        self.burned += 1
        await super().aburn(password)

    @property
    def work(self) -> int:
        return self.checked + self.burned
