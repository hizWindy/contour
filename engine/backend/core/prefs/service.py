"""Settings people can change from the website, stored in the database (core.settings).

The rules this follows:
- Only the keys in `EDITABLE_KEYS` can come from the database. A row for any other key (an
  env-only switch like `hubspot_names_to_claude_ok`, a ceiling, or a name nobody knows) is ignored,
  even if someone writes it straight into the table.
- An override is stored only when it differs from the default (the value from .env, or the code's
  own). Saving a value equal to the default removes its row, so `overridden` is False again.
- A decimal setting (money, and shares like 0.40) is stored, read and sent as TEXT, like "2.50".
  An int is a number. A choice is text, or null for "use the default".
- A change is checked as a whole: the result must be a valid `Settings` (so the rules between two
  settings apply, like "the reserve can't be more than its cap"), and no value may be above its
  ceiling from .env. Then everything is saved in one step, or nothing is.
- `effective_settings` never fails because of a bad row. A row that no longer fits (a bound was
  tightened, a ceiling was lowered) is left out and logged by key. The ceilings clamp the result
  as a last guard.
- The mic's browser speech service (`voice_tool` `browser_service`) waits for Levi's OK, the
  env-only `browser_speech_ok` (PLAN-V18). Until then the page doesn't offer it, a change to it is
  a 422 `browser_speech_off`, and a saved one reads as `browser_model` (`Settings` does that).
- Nothing here returns a SecretStr or any other env-only secret.

One row is not a setting: `lead_finder_round` holds the Lead Finder's round plan (the cities picked
and the first day, PLAN-V13 T1-3), so they are kept while the round is off. It is read and written
only by `apps/lead_finder/round.py`. It isn't in `EDITABLE_KEYS`, so it is never read as a setting.
"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, get_args, get_origin

from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.errors import FieldError, Problem
from core.claude.daily import whole_cents
from core.config import (
    CEILINGS,
    EDITABLE_KEYS,
    Settings,
    clamp_to_ceilings,
    field_bounds,
    get_settings,
)
from core.prefs.models import Setting
from core.prefs.schemas import SettingField, SettingsOut, SettingType, SettingValue

log = logging.getLogger(__name__)

# One transaction at a time changes the settings, so two changes can't each pass the check on
# their own and then save a pair that fails it together. The other advisory lock keys:
# 7_244_001 the checkpoint setup, 7_244_002 the one-backend lock that a running backend holds
# for its whole life (so sharing it would make every settings change wait for ever). Call prep
# (PLAN-V15 Track 3, apps/companies): 7_244_501 the team style notes' count, and 7_244_502 in
# the two-key form with hashtext(company_key), one call prep web check per company.
SETTINGS_LOCK = 7_244_003

# Shown as read-only rows. They change only in engine/.env, then a restart.
ENV_ONLY_KEYS: tuple[str, ...] = (
    "hubspot_names_to_claude_ok",
    "property_daily_to_claude_ok",
    "arealytics_to_claude_ok",
    "browser_speech_ok",  # PLAN-V18 M1
    "hard_run_cap_usd",
    "hard_scheduled_run_cap_usd",
    "hard_daily_cap_usd",
    "hard_company_cap_usd",
    "hard_concurrency",
)

ENV_ONLY_NOTE = "Changes only in engine/.env, then restart the backend."

# The mic's voice tool that sends the voice to Google or Microsoft (PLAN-V18 M1). It waits for
# Levi's OK: the env-only switch `browser_speech_ok`.
BROWSER_SERVICE = "browser_service"
BROWSER_SPEECH_OFF_TITLE = "The browser's speech service is off"
BROWSER_SPEECH_OFF_DETAIL = (
    "The browser's speech service sends the voice to Google or Microsoft, so it stays off until "
    "Levi says yes. Pick Whisper in the browser or Typing only."
)

# key: (label, what it does). Plain words, shown on the Settings page.
TEXT: dict[str, tuple[str, str]] = {
    "company_cap_usd": (
        "Cap for one company (US$)",
        "The most researching one company may cost. Code checks it before every request.",
    ),
    "company_max_searches": (
        "Searches for one company",
        "The most web searches used on one company.",
    ),
    "searches_per_request": (
        "Searches in one request",
        "The most web searches Claude may run inside a single request.",
    ),
    "fetches_per_request": (
        "Page reads in one request",
        "The most web pages Claude may open inside a single request.",
    ),
    "request_reserve_usd": (
        "Money held for each request (US$)",
        "Held back while a request runs, because its cost is known only afterwards. "
        "TBC: to be measured from Phase 1 runs.",
    ),
    "property_daily_enabled": (
        "Property Daily is on",
        "Lets the Lead Finder read Property Daily: the daily feed, and a lookup when a company "
        "is researched. Off: nothing is read from it.",
    ),
    "source_pages_per_day": (
        "Pages a day, for each tool",
        "The most pages each tool may read in one day. A slow pace keeps the account safe. TBC.",
    ),
    "source_pages_per_run": (
        "Lookup pages in one run",
        "The most live lookup pages one run may read from the two tools. 0: our copy only. TBC.",
    ),
    "property_lookup_days": (
        "Days a lookup is reused",
        "A company's lookup in the two tools is reused this long before the tools are asked again.",
    ),
    "property_daily_to_claude_ok": (
        "Property Daily facts may go to Claude",
        "Sends a company's address, office size and lease dates from Property Daily to Claude as "
        "short hints. " + ENV_ONLY_NOTE,
    ),
    "arealytics_to_claude_ok": (
        "Arealytics facts may go to Claude",
        "Off until Arealytics approves it: its terms ban AI use it hasn't approved. The rules and "
        "the lead card still use its facts. " + ENV_ONLY_NOTE,
    ),
    "run_cap_usd": (
        "Cap for one run (US$)",
        "The most one run may cost. A run in progress keeps the cap it started with.",
    ),
    "run_max_companies": (
        "Companies in one run",
        "The most companies one run researches. The best ranked come first.",
    ),
    "target_companies_default": (
        "Companies a run tries to research",
        "How many companies a run a person starts tries to research, when Start sends no number. "
        "A run short of it searches again in a new way, while discovery's money lasts. It is not "
        "a goal of good leads and never ends a run early. The company limit above still wins.",
    ),
    "discovery_max_sweeps": (
        "Search sweeps in one run",
        "The most times a run searches its signs, each time in a new way: the signs' own "
        "searches, then the source groups, by sector, and by area. 1 turns the extra sweeps off. "
        "Automatic runs always make one.",
    ),
    "scheduled_run_cap_usd": (
        "Cap for one automatic run (US$)",
        "The most a run that a schedule started may cost. It has no company limit: it goes on "
        "until no company is left, or this money is spent. A city run usually costs far less.",
    ),
    "lead_finder_round_cap_usd": (
        "Budget for one round (US$)",
        "The most all the city runs of one round may spend together. Before each automatic run "
        "starts, its cap becomes the smaller of the cap above and what is left of this. When "
        "nothing is left, the next city waits for the next round.",
    ),
    "daily_cap_usd": (
        "Cap for one day (US$)",
        "The most every run together may spend in 24 hours, manual and automatic.",
    ),
    "lead_finder_goal_good_leads": (
        "Good leads to aim for every 2 weeks",
        "The number of Pass and Director review leads the automatic runs are measured against "
        "between them, in one round of the city schedules. It never stops a run.",
    ),
    "slice_reserve_usd": (
        "Money held for each discovery request (US$)",
        "Held back while a discovery request runs. It must fit inside the discovery share.",
    ),
    "slice_max_searches": (
        "Searches in one discovery request",
        "The most web searches used to look for companies in one city and trigger.",
    ),
    "discovery_share": (
        "Share of the run cap for discovery",
        "The most of the run cap that discovery may use, from 0.05 to 0.90. "
        "The rest is for researching companies.",
    ),
    "run_company_concurrency": (
        "Companies researched at once",
        "How many companies one run researches side by side.",
    ),
    "run_discover_concurrency": (
        "Discovery requests at once",
        "How many discovery requests one run sends side by side.",
    ),
    "max_concurrent_runs": (
        "Runs at once",
        "How many runs may go at the same time.",
    ),
    "claude_model": (
        "Main Claude model",
        "Used for every step that has no model of its own below.",
    ),
    "model_discover": (
        "Model for discovery",
        "Finds new companies on the web. Empty means the main model.",
    ),
    "model_search": (
        "Model for web research",
        "Researches one company on the web. Empty means the main model.",
    ),
    "model_extract": (
        "Model for filling the form",
        "Turns the notes into the answer form. Empty means the main model.",
    ),
    "why_now_enabled": (
        "Why now is on",
        "Writes a Why now on each lead that isn't a Drop: why call, why now, and the questions "
        "to ask. One short Claude request a lead, no web search, about US$0.04 to US$0.08 (TBC). "
        "Off: the card says it wasn't written.",
    ),
    "model_why": (
        "Model for Why now",
        "Writes the Why now on the lead card. Empty means the main model.",
    ),
    "claude_effort": (
        "Claude effort",
        "How hard Claude thinks. Higher costs more. The Lead Finder's discovery and research "
        "have their own effort below; this one is for everything else, like call prep.",
    ),
    "claude_effort_discover": (
        "Claude effort for discovery",
        "How hard Claude thinks when it searches the web for new companies. Medium cost about "
        "US$0.15 a search request; max cost about US$1.00.",
    ),
    "claude_effort_research": (
        "Claude effort for research",
        "How hard Claude thinks when it researches one company: the searches, the two answer "
        "forms and Why now. Medium cost about US$0.34 to 0.42 a company; max about US$1.75. TBC: "
        "the test set decides between medium and high.",
    ),
    "claude_concurrency": (
        "Claude requests at once",
        "The most requests to Claude running together, across every run and request.",
    ),
    "prep_enabled": (
        "Call prep is on",
        "Lets the Companies page write call scripts with Claude. Off: the page still shows what "
        "we know from HubSpot, free.",
    ),
    "prep_cap_usd": (
        "Cap for one call prep (US$)",
        "The most one call script may cost. TBC: set from the first 10 real preps.",
    ),
    "prep_max_searches": (
        "Searches for one call prep",
        "The most web searches one call script may use, for news and whether the person is "
        "still there.",
    ),
    "prep_reuse_days": (
        "Days a call prep is reused",
        "A ready script for the same company and person is shown again for free this long. "
        "Refresh makes a new one.",
    ),
    "model_prep": (
        "Model for call prep",
        "The Claude model that writes call scripts. Empty: the default model.",
    ),
    "search_ahead_cap_usd": (
        "Cap for searching ahead, per day (US$)",
        "The most the morning search ahead may spend in one day. It also counts in the cap "
        "for one day.",
    ),
    "call_notes_enabled": (
        "Call notes are on",
        "Shows Log call in call prep and the Call logs page, so a rep can log a call by talking "
        "or typing. Nothing goes to HubSpot until a person confirms the batch.",
    ),
    "call_notes_ai_enabled": (
        "Claude sorts call notes",
        "Sends a rep's note to Claude, with emails and phone numbers taken out, to sort it into "
        "the call, field changes and follow-up tasks. Well under US$0.001 a note (TBC). Off: the "
        "rep picks the outcome and adds tasks by hand. Needs Levi's OK first (TBC).",
    ),
    "voice_tool": (
        "Voice to text",
        "Which tool turns a rep's voice into words, on Log call and for the Assistant's V key. "
        "The browser's own speech service, the default, sends the voice to Google or Microsoft, "
        "so it is offered only once the server allows it, after Levi's OK (TBC). Until then the "
        "mic uses Whisper in the browser in its place, which keeps the voice on the laptop. "
        "Typing hides the mic.",
    ),
    "meeting_forms_enabled": (
        "Pre-meeting forms are on",
        "Shows Meetings and the pre-read: drafted from HubSpot before a client meeting, checked "
        "by the rep, and emailed to the Contour team. About US$0.03 a draft (TBC).",
    ),
    "today_quiet_days": (
        "Days without contact before Today lists a deal",
        "Today lists each of your open deals whose company has had no contact in HubSpot (no "
        "call, email, meeting, note or task) for this many days, so it gets a nudge. A deal whose "
        "close date has passed is listed too. 14 days to start, TBC with Levi.",
    ),
    "name_hints_max": (
        "Names the mic listens for",
        "The most names the mic is told to listen for when someone presses V, most likely "
        "first: the company on screen and its people, your meetings and tasks, your companies, "
        "your teammates. The same list fixes a misheard name. A long list can make it hear names "
        "nobody said. 50 to start, TBC after the voice test.",
    ),
    "memory_fresh_days": (
        "Days a note stays fresh",
        "Notes and leads younger than this are reused instead of searched again.",
    ),
    "match_fuzzy_min": (
        "Close-name score (0 to 100)",
        "How alike two company names must be to count as a possible match in HubSpot.",
    ),
    "match_profile_min": (
        "Look-alike similarity (0 to 1)",
        "How alike two company profiles must be to count as a look-alike.",
    ),
    "hubspot_names_to_claude_ok": (
        "HubSpot names may go to Claude",
        "The data approval from Levi. While it is off, no HubSpot company name is sent to "
        "Claude. " + ENV_ONLY_NOTE,
    ),
    "browser_speech_ok": (
        "The mic may use the browser's speech service",
        "Levi's OK for the mic to send a rep's voice to Google or Microsoft, through the "
        "browser's own speech service. While it is off, Voice to text offers Whisper in the "
        "browser and Typing only. " + ENV_ONLY_NOTE,
    ),
    "hard_run_cap_usd": (
        "Highest run cap (US$)",
        "The run cap can't be set above this. " + ENV_ONLY_NOTE + " TBC with Levi.",
    ),
    "hard_scheduled_run_cap_usd": (
        "Highest automatic run cap (US$)",
        "The cap for one automatic run can't be set above this. " + ENV_ONLY_NOTE,
    ),
    "hard_daily_cap_usd": (
        "Highest daily cap (US$)",
        "The cap for one day can't be set above this. " + ENV_ONLY_NOTE,
    ),
    "hard_company_cap_usd": (
        "Highest company cap (US$)",
        "The company cap and the reserves can't be set above this. "
        + ENV_ONLY_NOTE
        + " TBC with Levi.",
    ),
    "hard_concurrency": (
        "Highest number at once",
        "No concurrency setting can be set above this. " + ENV_ONLY_NOTE + " TBC with Levi.",
    ),
}


# --- Kinds of setting ----------------------------------------------------------------------


def setting_type(key: str) -> SettingType:
    """How a setting's value is sent: from the type of its field in `Settings`.

    Money and shares (Decimal and float) are "decimal": always text on the wire.
    """
    annotation: Any = Settings.model_fields[key].annotation
    nullable = type(None) in get_args(annotation)
    if nullable:
        annotation = next(arg for arg in get_args(annotation) if arg is not type(None))
    if get_origin(annotation) is Literal:
        return "choice_or_null" if nullable else "choice"
    if annotation is bool:
        return "bool"
    if annotation is int:
        return "int"
    if annotation in (Decimal, float):
        return "decimal"
    raise TypeError(f"{key} has a type the Settings page does not know: {annotation!r}")


def setting_choices(key: str) -> list[str] | None:
    """The allowed values of a choice setting, or None."""
    annotation: Any = Settings.model_fields[key].annotation
    for arg in (annotation, *get_args(annotation)):
        if get_origin(arg) is Literal:
            return [str(item) for item in get_args(arg)]
    return None


def offered_choices(key: str, settings: Settings) -> list[str] | None:
    """The values a person may pick for a choice setting, or None. The browser's speech service
    is left out while the server doesn't allow it (`browser_speech_ok`, Levi's OK)."""
    choices = setting_choices(key)
    if choices is not None and key == "voice_tool" and not settings.browser_speech_ok:
        return [choice for choice in choices if choice != BROWSER_SERVICE]
    return choices


def decimal_text(value: Decimal | float) -> str:
    """A decimal as text with at least two places and no loss: 2.5 -> "2.50", 0.455 -> "0.455"."""
    exact = value if isinstance(value, Decimal) else Decimal(repr(value))
    text = format(exact, "f")
    if "." not in text:
        return f"{text}.00"
    places = len(text.split(".")[1])
    return text if places >= 2 else text + "0" * (2 - places)


def to_json(key: str, value: Any) -> SettingValue:
    """A setting's value as the plain JSON value the page and the table use."""
    kind = setting_type(key)
    if kind == "decimal":
        return decimal_text(value)
    if kind == "int":
        return int(value)
    plain: SettingValue = value  # a bool, a choice, or None
    return plain


def _read(key: str, raw: Any, *, strict: bool, choices: list[str] | None = None) -> Any:
    """A value from a request (strict) or from a stored row (lenient), as a Python value for
    `Settings`. Raises ValueError with a plain message when it can't be used. It does not check
    bounds: `Settings` does. `choices` narrows a choice setting's values (`offered_choices`)."""
    kind = setting_type(key)
    if kind == "int":
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise ValueError("Send a whole number, like 12.")
        return raw
    if kind == "decimal":
        if isinstance(raw, str):
            text = raw.strip()
        elif not strict and isinstance(raw, int | float) and not isinstance(raw, bool):
            text = repr(raw)  # a row someone wrote by hand with a number
        else:
            raise ValueError('Send this as a string, like "2.50".')
        try:
            number = Decimal(text)
        except InvalidOperation:
            raise ValueError("This isn't a number.") from None
        if not number.is_finite():
            raise ValueError("This isn't a number.")
        return number
    if kind == "bool":
        if not isinstance(raw, bool):
            raise ValueError("Send true or false.")
        return raw
    allowed = (setting_choices(key) if choices is None else choices) or []
    if raw is None and kind == "choice_or_null":
        return None
    if not isinstance(raw, str) or raw not in allowed:
        extra = ", or null for the default" if kind == "choice_or_null" else ""
        raise ValueError(f"Send one of: {', '.join(allowed)}{extra}.")
    return raw


# --- Working out the settings in use -------------------------------------------------------


@dataclass(frozen=True)
class Resolved:
    """The result of laying the stored overrides over .env."""

    settings: Settings  # in use now, clamped to the ceilings
    base: Settings  # .env and the defaults only, clamped. What a reset goes back to.
    used: Mapping[str, Any]  # the overrides that took part, as Python values
    ignored: tuple[str, ...]  # stored editable keys left out because they no longer fit


def resolve_settings(base: Settings, rows: Mapping[str, Any]) -> Resolved:
    """The settings in use, from `base` (.env) and the stored rows. Pure: no database.

    Rows for keys that are not editable are dropped first. Then the rest are checked together; a
    row that makes the result invalid is left out and the rest are tried again, so one bad row
    can never stop the backend.
    """
    wanted: dict[str, Any] = {}
    ignored: list[str] = []
    for key, raw in rows.items():
        if key not in EDITABLE_KEYS:
            continue  # a ceiling, an env-only switch or an unknown name: never from the table
        try:
            wanted[key] = _read(key, raw, strict=False)
        except ValueError:
            ignored.append(key)
    values = base.model_dump()
    while wanted:
        try:
            checked = Settings.model_validate(values | wanted)
        except ValidationError as error:
            bad = {str(item["loc"][0]) for item in error.errors() if item["loc"]} & wanted.keys()
            # With no override to blame, .env itself is the odd one out: use it as it is.
            for key in bad or list(wanted):
                del wanted[key]
                ignored.append(key)
            continue
        if ignored:
            log.warning("settings_rows_ignored", extra={"keys": sorted(ignored)})
        return Resolved(clamp_to_ceilings(checked), base, dict(wanted), tuple(ignored))
    if ignored:
        log.warning("settings_rows_ignored", extra={"keys": sorted(ignored)})
    return Resolved(base, base, {}, tuple(ignored))


async def _load_rows(session: AsyncSession) -> dict[str, Any]:
    result = await session.execute(
        select(Setting.key, Setting.value).where(Setting.key.in_(EDITABLE_KEYS))
    )
    return {key: value for key, value in result.all()}


async def effective_settings(session: AsyncSession, *, base: Settings | None = None) -> Settings:
    """The settings in use now: .env, then the person's overrides, clamped to the ceilings.

    `base` is for tests. It is the .env settings (the default is `get_settings()`).
    """
    return resolve_settings(base or get_settings(), await _load_rows(session)).settings


# --- The Settings page ---------------------------------------------------------------------


def _editable_field(key: str, resolved: Resolved) -> SettingField:
    kind = setting_type(key)
    label, description = TEXT[key]
    default = getattr(resolved.base, key)
    value = getattr(resolved.settings, key)
    low: SettingValue = None
    high: SettingValue = None
    if kind in ("int", "decimal"):
        raw_low, raw_high = field_bounds(key)
        if key in CEILINGS:  # the page shows the real top: the lower of the field's and the ceiling
            raw_high = min(raw_high, getattr(resolved.base, CEILINGS[key]))
        low, high = to_json(key, raw_low), to_json(key, raw_high)
    return SettingField(
        key=key,
        label=label,
        description=description,
        type=kind,
        min=low,
        max=high,
        choices=offered_choices(key, resolved.base),
        default=to_json(key, default),
        value=to_json(key, value),
        overridden=key in resolved.used and value != default,
        editable=True,
    )


def _env_only_field(key: str, base: Settings) -> SettingField:
    label, description = TEXT[key]
    code_default = Settings.model_fields[key].default
    return SettingField(
        key=key,
        label=label,
        description=description,
        type=setting_type(key),
        min=None,
        max=None,
        choices=None,
        default=to_json(key, code_default),
        value=to_json(key, getattr(base, key)),
        overridden=False,  # a person can't override these here
        editable=False,
    )


def build_settings_out(resolved: Resolved, daily_left_usd: Decimal) -> SettingsOut:
    """Every setting the page shows. Pure: no database."""
    fields = [_editable_field(key, resolved) for key in EDITABLE_KEYS]
    fields += [_env_only_field(key, resolved.base) for key in ENV_ONLY_KEYS]
    return SettingsOut(fields=fields, daily_left_usd=daily_left_usd)


async def _daily_left(session: AsyncSession) -> Decimal:
    """What is left of the daily limit, to the cent and rounded down. It counts what this process
    has spent but not logged, and what its running requests hold."""
    from core.claude.client import claude_holder

    return whole_cents(await claude_holder.daily.remaining(session=session, fresh=True))


async def get_settings_out(session: AsyncSession, *, base: Settings | None = None) -> SettingsOut:
    """Every setting for the Settings page, with its bounds, default and current value."""
    resolved = resolve_settings(base or get_settings(), await _load_rows(session))
    return build_settings_out(resolved, await _daily_left(session))


# --- Changing them -------------------------------------------------------------------------


def _error(key: str, message: str) -> FieldError:
    return FieldError(field=f"body.values.{key}", message=message)


def _speech_off() -> FieldError:
    return _error("voice_tool", BROWSER_SPEECH_OFF_DETAIL)


def _invalid(errors: list[FieldError]) -> Problem:
    """The 422 for a change that can't be saved. Asking for the browser's speech service while the
    server doesn't allow it has its own title, detail and code, `browser_speech_off`. Every field
    that is wrong is still listed."""
    listed = [error.model_dump() for error in errors]
    if _speech_off() in errors:
        return Problem(
            422,
            BROWSER_SPEECH_OFF_TITLE,
            BROWSER_SPEECH_OFF_DETAIL,
            code="browser_speech_off",
            errors=listed,
        )
    return Problem(
        422,
        "The settings aren't valid",
        "Nothing was changed. Fix the fields listed in errors.",
        errors=listed,
    )


BOUND_WORDS = {
    "greater_than_equal": ("ge", "Must be at least"),
    "less_than_equal": ("le", "Must be at most"),
    "greater_than": ("gt", "Must be more than"),
    "less_than": ("lt", "Must be less than"),
}


def _shown(key: str, value: Any) -> str:
    """A number as the page shows it: money and shares as text with two places, ints as they are."""
    return decimal_text(value) if setting_type(key) == "decimal" else str(value)


def _message(key: str, item: Mapping[str, Any]) -> str:
    """A pydantic error in plain words."""
    kind = str(item["type"])
    context: Mapping[str, Any] = item.get("ctx") or {}
    if kind in BOUND_WORDS:
        name, words = BOUND_WORDS[kind]
        if name in context:
            return f"{words} {_shown(key, context[name])}."
    if kind == "literal_error":
        return f"Send one of: {', '.join(setting_choices(key) or [])}."
    if kind.endswith(("_parsing", "_type", "_from_float")) or kind == "finite_number":
        return "This isn't a valid number."
    return str(item["msg"])


def _field_errors(error: ValidationError) -> list[FieldError]:
    seen: set[tuple[str, str]] = set()
    found: list[FieldError] = []
    for item in error.errors():
        if not item["loc"]:
            continue
        key = str(item["loc"][0])
        message = _message(key, item) if key in Settings.model_fields else str(item["msg"])
        if (key, message) not in seen:
            seen.add((key, message))
            found.append(_error(key, message))
    return found or [_error("settings", "These settings don't fit together.")]


def _parse_patch(
    values: Mapping[str, SettingValue], base: Settings
) -> tuple[dict[str, Any], list[FieldError]]:
    """Checks each key and the kind of each value. Bounds and rules between settings come next.
    The browser's speech service is refused while the server (`base`) doesn't allow it."""
    parsed: dict[str, Any] = {}
    errors: list[FieldError] = []
    for key, raw in values.items():
        if key not in Settings.model_fields:
            errors.append(_error(key, "No setting has this name."))
        elif key not in EDITABLE_KEYS:
            errors.append(_error(key, ENV_ONLY_NOTE))
        elif key == "voice_tool" and raw == BROWSER_SERVICE and not base.browser_speech_ok:
            errors.append(_speech_off())
        else:
            try:
                parsed[key] = _read(key, raw, strict=True, choices=offered_choices(key, base))
            except ValueError as problem:
                errors.append(_error(key, str(problem)))
    return parsed, errors


async def _lock(session: AsyncSession) -> None:
    """Takes the settings lock until this transaction ends."""
    await session.execute(select(func.pg_advisory_xact_lock(SETTINGS_LOCK)))


async def patch_settings(session: AsyncSession, values: dict[str, SettingValue]) -> SettingsOut:
    """Changes some settings, all or none. Returns the page as it is afterwards.

    Raises Problem 422 with `errors` as `body.values.<key>` for an unknown or env-only key, a
    value of the wrong kind, a value outside its bounds or above its ceiling, and a pair that
    breaks a rule between settings (every setting in the rule is named). The browser's speech
    service while the server doesn't allow it is a 422 `browser_speech_off`. A value equal to the
    default is not stored: it removes the override.
    """
    base = get_settings()
    parsed, errors = _parse_patch(values, base)
    if errors:
        raise _invalid(errors)
    await _lock(session)
    # Start from the overrides that are in use, so a stale row can't make this change fail.
    wanted = {**resolve_settings(base, await _load_rows(session)).used, **parsed}
    try:
        checked = Settings.model_validate(base.model_dump() | wanted)
    except ValidationError as error:
        raise _invalid(_field_errors(error)) from None
    for key in parsed:
        top = getattr(base, CEILINGS[key]) if key in CEILINGS else None
        if top is not None and getattr(checked, key) > top:
            message = f"Must be at most {_shown(key, top)}. The ceiling on the server is lower."
            errors.append(_error(key, message))
    if errors:
        raise _invalid(errors)

    store: dict[str, SettingValue] = {}
    remove: list[str] = []
    for key in parsed:
        value = getattr(checked, key)
        if value == getattr(base, key):
            remove.append(key)  # the default again: no row
        else:
            store[key] = to_json(key, value)
    await _write(session, store, remove)
    await session.commit()
    return await get_settings_out(session, base=base)


async def _write(
    session: AsyncSession, store: Mapping[str, SettingValue], remove: list[str]
) -> None:
    if remove:
        await session.execute(delete(Setting).where(Setting.key.in_(remove)))
    if store:
        statement = insert(Setting).values([{"key": k, "value": v} for k, v in store.items()])
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[Setting.key],
                set_={"value": statement.excluded.value, "updated_at": func.now()},
            )
        )


async def reset_setting(session: AsyncSession, key: str) -> SettingsOut:
    """Removes one override, so the setting goes back to its default. A key with no override is
    fine. Raises Problem 404 for a key that is not an editable setting."""
    if key not in EDITABLE_KEYS:
        raise Problem(
            404,
            "No such setting",
            "No setting a person can change has this name. "
            "Settings set on the server can't be reset here.",
            code="setting_not_found",
        )
    await _lock(session)
    await session.execute(delete(Setting).where(Setting.key == key))
    await session.commit()
    return await get_settings_out(session)
