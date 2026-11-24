"""Roles and feature ticks (`features`): the four roles, the role ladder, and the eight ticks
across Lead Finder and Relationships (PLAN-V19 T1-3 and T1-4).

Everything here is pure data and helpers with zero imports from any app module.
"""

from collections.abc import Iterable, Sequence
from typing import Literal

Role = Literal["platform_admin", "admin", "staff", "viewer"]
AssignableRole = Literal["admin", "staff", "viewer"]

# The full role list, kept in sync with core.users' ck_users_role check constraint.
ROLES: tuple[str, ...] = ("platform_admin", "admin", "staff", "viewer")

# Rank on the role ladder: platform_admin > admin > staff > viewer.
ROLE_RANK: dict[str, int] = {
    "viewer": 0,
    "staff": 1,
    "admin": 2,
    "platform_admin": 3,
}

Feature = Literal[
    "lead_finder.start_run",
    "lead_finder.results",
    "lead_finder.rules",
    "lead_finder.send_to_hubspot",
    "companies.companies",
    "companies.call_logs",
    "companies.meetings",
    "companies.call_prep",
]

FEATURES: tuple[Feature, ...] = (
    "lead_finder.start_run",
    "lead_finder.results",
    "lead_finder.rules",
    "lead_finder.send_to_hubspot",
    "companies.companies",
    "companies.call_logs",
    "companies.meetings",
    "companies.call_prep",
)

FEATURE_SET: frozenset[str] = frozenset(FEATURES)

FEATURE_LABELS: dict[str, str] = {
    "lead_finder.start_run": "Start a run",
    "lead_finder.results": "See results",
    "lead_finder.rules": "Rules",
    "lead_finder.send_to_hubspot": "Send to HubSpot",
    "companies.companies": "Companies",
    "companies.call_logs": "Call logs",
    "companies.meetings": "Meetings",
    "companies.call_prep": "Call prep",
}

APPS_ORDER: tuple[str, ...] = ("lead_finder", "companies")

APP_FEATURES: dict[str, tuple[Feature, ...]] = {
    "lead_finder": (
        "lead_finder.start_run",
        "lead_finder.results",
        "lead_finder.rules",
        "lead_finder.send_to_hubspot",
    ),
    "companies": (
        "companies.companies",
        "companies.call_logs",
        "companies.meetings",
        "companies.call_prep",
    ),
}

# Starting ticks for each role (PLAN-V19 Question 2 and Contract 1).
ROLE_DEFAULT_FEATURES: dict[str, tuple[Feature, ...]] = {
    "platform_admin": FEATURES,
    "admin": FEATURES,
    "staff": (
        "lead_finder.start_run",
        "lead_finder.results",
        "lead_finder.send_to_hubspot",
        "companies.companies",
        "companies.call_logs",
        "companies.meetings",
        "companies.call_prep",
    ),
    "viewer": (
        "lead_finder.results",
        "companies.companies",
        "companies.call_logs",
        "companies.meetings",
    ),
}


def is_platform_admin(role: str) -> bool:
    return role == "platform_admin"


def is_admin(role: str) -> bool:
    """True for both Platform admin and Admin."""
    return ROLE_RANK.get(role, -1) >= ROLE_RANK["admin"]


def is_viewer(role: str) -> bool:
    return role == "viewer"


def at_least(role: str, minimum: Role) -> bool:
    return ROLE_RANK.get(role, -1) >= ROLE_RANK[minimum]


def feature_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature, feature.replace(".", " ").replace("_", " "))


def feature_app(feature: str) -> str:
    return feature.split(".", 1)[0]


def normalize_features(values: Iterable[str]) -> list[str]:
    """Known feature names only, deduplicated and ordered canonically."""
    picked = set(values)
    return [feature for feature in FEATURES if feature in picked]


def default_features(role: str) -> list[str]:
    return list(ROLE_DEFAULT_FEATURES.get(role, ()))


def features_from_apps(apps: Iterable[str]) -> list[str]:
    """Expands legacy module-level `apps` into all ticks of each module (Choice 3)."""
    selected = set(apps)
    return [feature for app in APPS_ORDER if app in selected for feature in APP_FEATURES[app]]


def apps_from_features(features: Sequence[str]) -> list[str]:
    """Derives `apps` from feature ticks so older readers keep working."""
    owned = set(features)
    return [app for app in APPS_ORDER if any(f.startswith(f"{app}.") for f in owned)]


def effective_features(role: str, features: Sequence[str] | None) -> list[str]:
    """What a user can use: Platform admin and Admin get all eight; others keep their ticks."""
    if is_admin(role):
        return list(FEATURES)
    return normalize_features(features or ())


# The Assistant's V key (PLAN-V22 choice 18): the Call logs or the Meetings tick, never a Viewer.
VOICE_FEATURES: tuple[Feature, ...] = ("companies.call_logs", "companies.meetings")


def can_talk(role: str, features: Sequence[str] | None) -> bool:
    """V's rule: not a Viewer, with the Call logs or the Meetings tick (Admins have every tick).
    Live voice (PLAN-V28) adds the person's own switch on top of it."""
    if is_viewer(role):
        return False
    owned = effective_features(role, features)
    return any(feature in owned for feature in VOICE_FEATURES)
