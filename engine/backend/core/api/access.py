"""Who may use which project (PLAN-V9 E1).

Each account has a list of projects it may use (`core.users.apps`), like ["lead_finder"]: the
"Lead Finder" tick on the Admin's People tab. An Admin may use every project. Where sign-in is off
(the laptop's default) nobody is signed in and everything is open, as it is for every other route.

- `require_app(name)` guards a whole project: `create_app` puts it on each project's router, so a
  route a project adds later is covered with no change here.
- `AppAccessDep` is for the core routes that hold a project's data (runs, the search log,
  memory): they check the project of the data they return. A list with no project named needs
  every project, because it would show them all.

A person without the project gets a 403 `app_not_allowed`, in plain words.
"""

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.signin import AuthSettingsDep, NowDep, maybe_auth
from core.auth.sessions import AuthContext

APP_TITLES = {"lead_finder": "the Lead Finder"}


def _title(app: str) -> str:
    return APP_TITLES.get(app, app.replace("_", " "))


def not_allowed(app: str) -> Problem:
    return Problem(
        403,
        "Not open to you",
        f"Your account can't use {_title(app)}. Ask an Admin to tick it on the People tab.",
        code="app_not_allowed",
    )


def can_use(auth: AuthContext | None, app: str) -> bool:
    """True when this person may use the project (an Admin may use them all)."""
    if auth is None:
        return True  # sign-in is off: nobody is signed in, and nothing is closed
    user = auth.user
    return user.role == "admin" or app in (user.apps or [])


async def signed_in(
    request: Request, db: SessionDep, settings: AuthSettingsDep, now: NowDep
) -> AuthContext | None:
    """Who is signed in, where sign-in is required. Where it is off, None at once: no cookie is
    looked up and nothing is closed, as for every other route."""
    if not settings.auth_required:
        return None
    return await maybe_auth(request, db, settings, now)


SignedInDep = Annotated[AuthContext | None, Depends(signed_in)]


def require_app(app: str) -> Callable[..., Awaitable[None]]:
    """A dependency that refuses (403) a person who may not use `app`."""

    async def check(auth: SignedInDep) -> None:
        if not can_use(auth, app):
            raise not_allowed(app)

    check.__name__ = f"require_{app}"
    return check


@dataclass(frozen=True)
class AppAccess:
    auth: AuthContext | None
    every: tuple[str, ...]  # every project this backend runs

    @property
    def open(self) -> bool:
        """True when every project is open to this request (sign-in off, or an Admin)."""
        return self.auth is None or self.auth.user.role == "admin"

    def check(self, app: str) -> None:
        if not can_use(self.auth, app):
            raise not_allowed(app)

    def check_all(self, apps: Iterable[str] | None = None) -> None:
        """For a list that names no project: it would show them all, so all are needed."""
        for app in apps if apps is not None else self.every:
            self.check(app)


async def app_access(request: Request, auth: SignedInDep) -> AppAccess:
    specs = getattr(request.app.state, "apps", [])
    return AppAccess(auth=auth, every=tuple(spec.name for spec in specs))


AppAccessDep = Annotated[AppAccess, Depends(app_access)]
