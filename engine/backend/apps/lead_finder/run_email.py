"""The email when a scheduled run ends (PLAN-V9 C2).

When a run that a schedule started ends, the addresses in `LEAD_FINDER_NOTIFY_EMAILS` get one
email (Levi, TBC). A run a person started by hand sends none, so tests and trial runs never email
Levi. The run engine calls `run_finished` through the discovery `RunKind`'s `finished` hook.

What it shows:
- the city, and the number of good leads (Pass and Director review), Watch and Drop;
- the cost, and the cost per good lead;
- the top 5 good leads, each with one line on why it fits (its best sign);
- a "Review the leads" link to the run's review page (`/results?run_id=...`).

A run that failed or was stopped sends a short email saying why. A run that was interrupted (the
backend stopped) sends nothing: it carries on when the backend starts again.

The email holds company names, numbers and a link. No contact details. An email that can't be
sent is logged and never stops anything (`core.email`). Each email has a key made from the run and
its end, so the same end is never mailed twice.
"""

import html
import logging
import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.tables import Lead
from core.config import Settings
from core.email.sender import EmailError, EmailSender, Sent, send
from core.runs.schemas import RunOut

log = logging.getLogger(__name__)

GOOD_RESULTS = ("pass", "director_review")
TOP_LEADS = 5
WHY_MAX = 160
CENT = Decimal("0.01")
RESULT_WORDS = {
    "pass": "Pass",
    "director_review": "Director review",
    "watch": "Watch",
    "drop": "Drop",
}


@dataclass(frozen=True)
class GoodLead:
    company: str
    result: str
    score: int
    why: str


@dataclass(frozen=True)
class RunEmail:
    subject: str
    text: str
    html: str


def good_leads(by_result: dict[str, int]) -> int:
    """Good leads: a Pass or a Director review. Watch and Drop are not counted."""
    return sum(by_result.get(result, 0) for result in GOOD_RESULTS)


def cost_per_good_lead(cost_usd: Decimal, good: int) -> Decimal | None:
    """The run's cost shared over its good leads, to the cent. None when there are none."""
    if good <= 0:
        return None
    return (cost_usd / good).quantize(CENT, ROUND_HALF_UP)


def usd(amount: Decimal) -> str:
    return f"US${amount.quantize(CENT, ROUND_HALF_UP):,.2f}"


def app_url(settings: Settings) -> str:
    """The website's address for links: APP_URL, else the public origin, else the laptop's."""
    for url in (settings.app_url, settings.public_origin, *settings.cors_origins):
        if url:
            return url.rstrip("/")
    return "http://localhost:5173"


def review_link(settings: Settings, run_id: uuid.UUID) -> str:
    return f"{app_url(settings)}/results?run_id={run_id}"


def _where(params: dict[str, Any]) -> str:
    cities = [str(city) for city in params.get("cities") or []]
    if not cities:
        return "Lead Finder"
    if len(cities) == 1:
        return cities[0]
    return f"{', '.join(cities[:-1])} and {cities[-1]}"


def _why(card: dict[str, Any]) -> str:
    """One line on why a lead fits: its best sign, else its summary."""
    triggers = card.get("triggers") or []
    text = ""
    if triggers and isinstance(triggers[0], dict):
        text = str((triggers[0].get("trigger") or {}).get("what_happened") or "")
    if not text:
        text = str(card.get("summary") or "")
    text = " ".join(text.split())
    return text if len(text) <= WHY_MAX else text[: WHY_MAX - 1].rstrip() + "…"


async def top_good_leads(session: AsyncSession, run_id: uuid.UUID) -> list[GoodLead]:
    rows = await session.execute(
        select(Lead.company, Lead.result, Lead.score, Lead.card)
        .where(Lead.run_id == run_id, Lead.result.in_(GOOD_RESULTS))
        .order_by(Lead.score.desc(), Lead.company)
        .limit(TOP_LEADS)
    )
    return [
        GoodLead(company=row.company, result=row.result, score=row.score, why=_why(row.card))
        for row in rows
    ]


def build_email(run: RunOut, top: list[GoodLead], link: str) -> RunEmail:
    """The email for a finished run. Pure: the run, its top leads and the review link."""
    where = _where(run.params)
    counts = run.counts.by_result
    good = good_leads(counts)
    if run.status in ("failed", "cancelled"):
        what = "failed" if run.status == "failed" else "was stopped"
        why = run.stop_reason or run.error or "No reason was recorded."
        subject = f"Lead Finder: the {where} run {what}"
        lines = [
            f"The scheduled {where} run {what}.",
            f"Why: {why}",
            f"It cost {usd(run.cost_usd)} and saved {good} good leads before it ended.",
            "",
            f"See the run: {link}",
        ]
        text = "\n".join(lines)
        body = (
            f"<p>The scheduled {html.escape(where)} run {what}.</p>"
            f"<p><strong>Why:</strong> {html.escape(why)}</p>"
            f"<p>It cost {usd(run.cost_usd)} and saved {good} good leads before it ended.</p>"
            f'<p><a href="{html.escape(link, quote=True)}">See the run</a></p>'
        )
        return RunEmail(subject=subject, text=text, html=_page(body))

    per_good = cost_per_good_lead(run.cost_usd, good)
    lead_word = "lead" if good == 1 else "leads"
    subject = f"Lead Finder: {good} good {lead_word} in {where}"
    tally = (
        f"{good} good {lead_word} (Pass or Director review), "
        f"{counts.get('watch', 0)} Watch, {counts.get('drop', 0)} Drop."
    )
    cost = f"Cost {usd(run.cost_usd)}" + (
        f", {usd(per_good)} per good lead." if per_good is not None else ". No good leads yet."
    )
    lines = [f"The scheduled {where} run is done.", tally, cost]
    if run.stop_reason:
        lines.append(f"It stopped early: {run.stop_reason}")
    lines.append("")
    if top:
        lines.append("The top good leads:")
        for number, lead in enumerate(top, start=1):
            lines.append(
                f"{number}. {lead.company} ({RESULT_WORDS.get(lead.result, lead.result)}, "
                f"score {lead.score}): {lead.why}"
            )
        lines.append("")
    lines.append("Nothing goes to HubSpot until you approve it.")
    lines.append(f"Review the leads: {link}")
    text = "\n".join(lines)

    items = "".join(
        f"<li><strong>{html.escape(lead.company)}</strong> "
        f"({RESULT_WORDS.get(lead.result, lead.result)}, score {lead.score}): "
        f"{html.escape(lead.why)}</li>"
        for lead in top
    )
    stopped = f"<p>It stopped early: {html.escape(run.stop_reason)}</p>" if run.stop_reason else ""
    body = (
        f"<p>The scheduled {html.escape(where)} run is done.</p>"
        f"<p>{html.escape(tally)}<br>{html.escape(cost)}</p>{stopped}"
        + (f"<p>The top good leads:</p><ol>{items}</ol>" if top else "")
        + "<p>Nothing goes to HubSpot until you approve it.</p>"
        f'<p><a href="{html.escape(link, quote=True)}" style="display:inline-block;'
        "padding:10px 16px;background:#233A56;color:#ffffff;border-radius:6px;"
        'text-decoration:none">Review the leads</a></p>'
    )
    return RunEmail(subject=subject, text=text, html=_page(body))


def _page(body: str) -> str:
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;'
        f'color:#26231B">{body}</div>'
    )


def should_email(run: RunOut) -> bool:
    """A scheduled run that ended for good. Interrupted runs carry on later, so they wait."""
    return run.schedule_id is not None and run.status in ("done", "failed", "cancelled")


async def run_finished(
    run: RunOut,
    session: AsyncSession,
    settings: Settings,
    *,
    sender: EmailSender | None = None,
) -> Sent | None:
    """Emails the run's result to `lead_finder_notify_emails`, if it was a scheduled run that
    ended. Never raises: a problem is logged, and the run is not touched."""
    if not should_email(run):
        return None
    to = list(settings.lead_finder_notify_emails)
    if not to:
        log.info("run_email_skipped", extra={"run_id": str(run.id), "reason": "no_addresses"})
        return None
    try:
        top = await top_good_leads(session, run.id) if run.status == "done" else []
        email = build_email(run, top, review_link(settings, run.id))
        return await send(
            to,
            email.subject,
            email.text,
            email.html,
            settings=settings,
            sender=sender,
            key=f"lead-finder-run-{run.id}-{run.status}",
        )
    except EmailError as error:
        log.warning(
            "run_email_failed",
            extra={"run_id": str(run.id), "title": error.title, "detail": error.detail},
        )
    except Exception as error:  # an email must never break the end of a run
        log.warning(
            "run_email_failed", extra={"run_id": str(run.id), "reason": type(error).__name__}
        )
    return None
