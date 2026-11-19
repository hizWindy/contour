"""Links into the website, for emails and HubSpot tasks: its address, a company's page, a pre-read's
page and Call logs. Plain functions that import no other part of the app, so any module may use
them (call notes' sending can't import the morning pre-reads: they import call notes).
"""

import uuid
from urllib.parse import quote

from core.config import Settings

LAPTOP = "http://localhost:5173"  # the website's address when no other is set


def app_url(settings: Settings) -> str:
    """The website's address for links: APP_URL, else the public origin, else the laptop's (as
    the Lead Finder's run email does)."""
    for url in (settings.app_url, settings.public_origin, *settings.cors_origins):
        if url:
            return url.rstrip("/")
    return LAPTOP


def form_link(settings: Settings, form_id: uuid.UUID) -> str:
    """The pre-read's page on the website: the Assistant's Meetings (PLAN-V22 T1-6)."""
    return f"{app_url(settings)}/assistant/meetings/{quote(str(form_id))}"


def company_link(settings: Settings, company_key: str) -> str:
    """A company's page on the website, with its Call history."""
    return f"{app_url(settings)}/companies/{quote(company_key, safe='')}"


def call_logs_link(settings: Settings) -> str:
    """Call logs on the website: the Assistant's, opening on To confirm (PLAN-V22)."""
    return f"{app_url(settings)}/assistant/call-logs"
