"""Who may use which project and tick (`features`) and whether they may make changes (PLAN-V19).

- `PlatformAdminDep` (in `core.api.signin`): Admin settings, settings switches, People, owners,
  HubSpot import/writes/profiles, Sources, Schedule edits, Test set, Round edits.
- `AdminDep` (in `core.api.signin`): Platform admin or Admin (team call notes and script style).
- `need(*features, write=False)`: guards every feature route. If `write=True`, a Viewer gets 403
  `viewer_read_only`; anyone missing every listed feature gets 403 `feature_not_allowed` naming
  the primary feature and the Platform admin's name.
- `require_app(name)`: guards a whole project router so no route inside it can open to someone
  with no tick for that project.
- `AppAccessDep`: for core routes shared across projects (`/runs`, `/searches`).
"""

from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.signin import AuthSettingsDep, NowDep, maybe_auth
from core.auth import users
from core.auth.features import (
    APP_FEATURES,
    Feature,
    effective_features,
    feature_app,
    feature_label,
    is_admin,
    is_platform_admin,
    is_viewer,
)
from core.auth.sessions import AuthContext

APP_TITLES = {"lead_finder": "Lead Finder", "companies": "Relationships"}

# Which tick grants basic project access via `AppAccessDep` (`run` / `search`).
APP_DEFAULT_FEATURES: dict[str, tuple[Feature, ...]] = {
    "lead_finder": ("lead_finder.results",),
    "companies": ("companies.companies",),
}


def feature_not_allowed(feature: str, platform_admin_name: str | None = None) -> Problem:
    asker = platform_admin_name or "the Platform admin"
    label = feature_label(feature)
    return Problem(
        403,
        "Not open to you",
        f"You don't have access to {label}. Ask {asker} to turn it on.",
        code="feature_not_allowed",
    )


def viewer_read_only(platform_admin_name: str | None = None) -> Problem:
    asker = platform_admin_name or "the Platform admin"
    return Problem(
        403,
        "View only",
        f"Viewers can look but not change things. Ask {asker} if you need more.",
        code="viewer_read_only",
    )


def platform_admin_only() -> Problem:
    return Problem(
        403,
        "Platform admin only",
        "Only the Platform admin can open Admin settings.",
        code="platform_admin_only",
    )


def not_allowed(app: str, platform_admin_name: str | None = None) -> Problem:
    default = APP_FEATURES.get(app)
    if default:
        return feature_not_allowed(default[0], platform_admin_name)
    asker = platform_admin_name or "the Platform admin"
    title = APP_TITLES.get(app, app.replace("_", " "))
    return Problem(
        403,
        "Not open to you",
        f"You don't have access to {title}. Ask {asker} to turn it on.",
        code="feature_not_allowed",
    )


def can_feature(auth: AuthContext | None, feature: str) -> bool:
    """True when sign-in is off, Admin/Platform admin, or the user has this feature tick."""
    if auth is None:
        return True
    user = auth.user
    if is_admin(user.role):
        return True
    return feature in effective_features(user.role, user.features)


def can_use(auth: AuthContext | None, app: str) -> bool:
    """True when this person may open any feature of `app`."""
    if auth is None:
        return True
    user = auth.user
    if is_admin(user.role):
        return True
    owned = effective_features(user.role, user.features)
    return any(feature_app(f) == app for f in owned)


async def signed_in(
    request: Request, db: SessionDep, settings: AuthSettingsDep, now: NowDep
) -> AuthContext | None:
    """Who is signed in, where sign-in is required. None when sign-in is off."""
    if not settings.auth_required:
        return None
    return await maybe_auth(request, db, settings, now)


SignedInDep = Annotated[AuthContext | None, Depends(signed_in)]


_GUARD_ATTR = "_contour_guard"


def require_app(app: str) -> Callable[..., Awaitable[None]]:
    """Router-level guard: refuses someone who has no tick in `app`."""

    async def check(auth: SignedInDep, db: SessionDep) -> None:
        if not can_use(auth, app):
            raise not_allowed(app, await users.platform_admin_name(db))

    setattr(check, _GUARD_ATTR, ("app", app))
    check.__name__ = f"require_{app}"
    return check


def need(*features: Feature, write: bool = False) -> Callable[..., Awaitable[None]]:
    """Route guard checking feature tick(s) and rejecting Viewer mutations (`viewer_read_only`)."""
    if not features:
        raise ValueError("need() requires at least one feature")
    primary = features[0]

    async def check(auth: SignedInDep, db: SessionDep) -> None:
        if auth is None:
            return
        if write and is_viewer(auth.user.role):
            raise viewer_read_only(await users.platform_admin_name(db))
        if not any(can_feature(auth, feature) for feature in features):
            raise feature_not_allowed(primary, await users.platform_admin_name(db))

    setattr(check, _GUARD_ATTR, ("feature", features, write))
    check.__name__ = f"need_{primary.replace('.', '_')}"
    return check


@dataclass(frozen=True)
class AppAccess:
    auth: AuthContext | None
    every: tuple[str, ...]
    platform_admin_name: str | None = None

    @property
    def open(self) -> bool:
        """True when every project is open (sign-in off, or Admin / Platform admin)."""
        return self.auth is None or is_admin(self.auth.user.role)

    @property
    def is_platform_admin(self) -> bool:
        return self.auth is None or is_platform_admin(self.auth.user.role)

    def check_not_viewer(self) -> None:
        if self.auth is not None and is_viewer(self.auth.user.role):
            raise viewer_read_only(self.platform_admin_name)

    def check_platform_admin(self) -> None:
        if self.auth is not None and not is_platform_admin(self.auth.user.role):
            raise platform_admin_only()

    def check_feature(self, *features: str, write: bool = False) -> None:
        if self.auth is None:
            return
        if write and is_viewer(self.auth.user.role):
            raise viewer_read_only(self.platform_admin_name)
        if not any(can_feature(self.auth, feature) for feature in features):
            raise feature_not_allowed(features[0], self.platform_admin_name)

    def check(self, app: str, *, feature: str | None = None, write: bool = False) -> None:
        if self.auth is None:
            return
        if write and is_viewer(self.auth.user.role):
            raise viewer_read_only(self.platform_admin_name)
        target = feature
        if target is None:
            defaults = APP_DEFAULT_FEATURES.get(app)
            if defaults:
                target = defaults[0]
        if target is not None:
            if not can_feature(self.auth, target):
                raise feature_not_allowed(target, self.platform_admin_name)
        elif not can_use(self.auth, app):
            raise not_allowed(app, self.platform_admin_name)

    def check_all(self, apps: Iterable[str] | None = None) -> None:
        for app in apps if apps is not None else self.every:
            self.check(app)

    def allowed(
        self, *, feature_by_app: Mapping[str, str | Sequence[str]] | None = None
    ) -> list[str] | None:
        """Projects visible to this caller, or None for Admins/sign-in-off."""
        if self.open:
            return None
        mapping: Mapping[str, str | Sequence[str]] = feature_by_app or APP_DEFAULT_FEATURES
        mine: list[str] = []
        for app in self.every:
            spec = mapping.get(app)
            if spec is not None:
                feats = (spec,) if isinstance(spec, str) else tuple(spec)
                if any(can_feature(self.auth, feat) for feat in feats):
                    mine.append(app)
            elif can_use(self.auth, app):
                mine.append(app)
        if not mine:
            first_app = self.every[0] if self.every else ""
            spec = mapping.get(first_app)
            if spec is not None:
                first_feat = spec if isinstance(spec, str) else spec[0]
                raise feature_not_allowed(first_feat, self.platform_admin_name)
            raise not_allowed(first_app, self.platform_admin_name)
        return mine


async def app_access(request: Request, auth: SignedInDep, db: SessionDep) -> AppAccess:
    specs = getattr(request.app.state, "apps", [])
    admin_name: str | None = None
    if auth is not None and not is_admin(auth.user.role):
        admin_name = await users.platform_admin_name(db)
    return AppAccess(
        auth=auth,
        every=tuple(spec.name for spec in specs),
        platform_admin_name=admin_name,
    )


setattr(app_access, _GUARD_ATTR, ("app_access",))
AppAccessDep = Annotated[AppAccess, Depends(app_access)]
