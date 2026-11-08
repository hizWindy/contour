"""The one settings object. It reads engine/.env. Nothing else reads environment variables.

Two kinds of setting:
- **Env-only:** the HubSpot approval switches, the hard ceilings, the daily cap, the database
  pool, the allowed web origins, the API address, the sign-in settings (on or off, the session
  times), the Signal Hire key and every HubSpot setting (the key, the version, the write switch,
  the pace and the sync times). They change only in engine/.env, then a restart. The website
  can't change them.
- **Editable:** caps, concurrency, models and thresholds (the keys in EDITABLE_KEYS). The
  `core.prefs` package stores overrides in the database, checks each against its min and max
  here, and then clamps the result to the ceilings with `clamp_to_ceilings`.
"""

import ipaddress
import json
import re
from decimal import ROUND_DOWN, Decimal
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Final, Literal, get_args
from urllib.parse import quote, urlsplit

from annotated_types import Ge, Le
from psycopg.conninfo import make_conninfo
from pydantic import Field, SecretStr, StrictBool, ValidationError, field_validator, model_validator
from pydantic_core import InitErrorDetails, PydanticCustomError
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENGINE_DIR = BACKEND_DIR.parent

CONNECT_TIMEOUT_SECONDS = 5
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")  # for the web origins in cors_origins
API_HOSTS = ("localhost", "127.0.0.1")  # for api_host: the host check in core/api accepts these
# Headers a visitor can write themselves, so none of them can say who the visitor is.
FORGEABLE_ADDRESS_HEADERS = frozenset(
    {"x-forwarded-for", "forwarded", "x-real-ip", "host", "cookie", "authorization", "user-agent"}
)
# Schemas that belong to something else. The run checkpoints may not live in any of them.
RESERVED_SCHEMAS = frozenset({"public", "core", "lead_finder", "information_schema"})

ClaudeModel = Literal["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
ClaudeEffort = Literal["low", "medium", "high", "xhigh", "max"]
MODEL_CHOICES: Final[tuple[str, ...]] = get_args(ClaudeModel)
EFFORT_CHOICES: Final[tuple[str, ...]] = get_args(ClaudeEffort)

# The settings a person can change through the website (core.prefs). Each has a min and a
# max (field_bounds), and the max is at or below its ceiling. Everything else is env-only.
EDITABLE_KEYS: Final[list[str]] = [
    "company_cap_usd",
    "company_max_searches",
    "searches_per_request",
    "fetches_per_request",
    "request_reserve_usd",
    "run_cap_usd",
    "run_max_companies",
    "scheduled_run_cap_usd",
    "daily_cap_usd",
    "lead_finder_goal_good_leads",
    "slice_reserve_usd",
    "slice_max_searches",
    "discovery_share",
    "run_company_concurrency",
    "run_discover_concurrency",
    "max_concurrent_runs",
    "claude_model",
    "model_discover",
    "model_search",
    "model_extract",
    "claude_effort",
    "claude_concurrency",
    "memory_fresh_days",
    "match_fuzzy_min",
    "match_profile_min",
]

# Which env-only ceiling caps each editable key.
CEILINGS: Final[dict[str, str]] = {
    "company_cap_usd": "hard_company_cap_usd",
    "request_reserve_usd": "hard_company_cap_usd",
    "slice_reserve_usd": "hard_company_cap_usd",
    "run_cap_usd": "hard_run_cap_usd",
    "scheduled_run_cap_usd": "hard_scheduled_run_cap_usd",
    "daily_cap_usd": "hard_daily_cap_usd",
    "run_company_concurrency": "hard_concurrency",
    "run_discover_concurrency": "hard_concurrency",
    "max_concurrent_runs": "hard_concurrency",
    "claude_concurrency": "hard_concurrency",
}


def discovery_cap_usd(run_cap_usd: Decimal, discovery_share: float) -> Decimal:
    """The money discovery may spend in a run: its share of the run cap, in whole cents rounded
    down. `core.runs.types.make_caps` makes the run's discovery cap the same way."""
    return (run_cap_usd * Decimal(str(discovery_share))).quantize(
        Decimal("0.01"), rounding=ROUND_DOWN
    )


def _usd(value: Decimal) -> str:
    return f"${value:.2f}"


def _clean_origin(value: str) -> str:
    """One web origin like http://localhost:5173. Only the computer's own addresses pass."""
    text = value.strip()
    if "*" in text:
        raise ValueError("cors_origins can't contain '*'. List each origin.")
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https"):
        raise ValueError("Each cors_origins entry must start with http:// or https://")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("A cors_origins entry is a scheme, a host and a port. Nothing else.")
    if parts.path not in ("", "/"):
        raise ValueError("A cors_origins entry can't have a path")
    host = parts.hostname
    if host not in LOOPBACK_HOSTS:
        raise ValueError("cors_origins may only list this computer: localhost or 127.0.0.1")
    try:
        port = parts.port
    except ValueError as error:
        raise ValueError("A cors_origins entry has a bad port") from error
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc += f":{port}"
    return f"{parts.scheme}://{netloc}"


def _clean_public_origin(value: str) -> str | None:
    """The one address the website has on the internet, like https://hq.contourinteriors.com.au.

    Only HTTPS, and only a scheme, a host and maybe a port: the host check and the origin guard
    compare against it, so anything more (a path, a login, a query) would never match a request.
    """
    text = value.strip()
    if not text:
        return None
    parts = urlsplit(text)
    if parts.scheme != "https":
        raise ValueError(
            "public_origin must start with https://. The engine on a server only runs behind HTTPS"
        )
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("public_origin is a scheme, a host and a port. Nothing else.")
    if parts.path not in ("", "/"):
        raise ValueError("public_origin can't have a path")
    host = parts.hostname
    if not host:
        raise ValueError("public_origin needs a host name, like https://hq.contourinteriors.com.au")
    try:
        port = parts.port
    except ValueError as error:
        raise ValueError("public_origin has a bad port") from error
    netloc = f"[{host}]" if ":" in host else host
    return f"https://{netloc}" + (f":{port}" if port is not None else "")


def _clean_proxy(value: str) -> str:
    """One trusted proxy: an IP address or a network, never "everything"."""
    text = value.strip()
    if text == "*":
        raise ValueError(
            "trusted_proxies can't be *: that would trust every client's word about its address"
        )
    try:
        network = ipaddress.ip_network(text, strict=False)
    except ValueError as error:
        raise ValueError(
            f"trusted_proxies has {text!r}, which is not an IP address or a network like "
            "172.18.0.0/16"
        ) from error
    if network.prefixlen == 0:
        raise ValueError("trusted_proxies can't be every address (a /0 network)")
    return str(network)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENGINE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Database (Docker, see engine/docker-compose.yml) ------------------------------
    postgres_user: str = "leadfinder"
    postgres_password: SecretStr = SecretStr("")
    postgres_db: str = "leadfinder"
    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5433
    # TLS to the database. None keeps libpq's own default (`prefer`: TLS if the server offers it). A
    # managed database (DigitalOcean) needs `require` at least, and `verify-full` with the
    # provider's CA certificate file is the safest: it also checks who answered.
    postgres_sslmode: (
        Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"] | None
    ) = None
    postgres_sslrootcert: Path | None = None
    db_pool_size: int = Field(10, ge=1, le=50)
    db_max_overflow: int = Field(10, ge=0, le=50)
    db_pool_timeout: float = Field(10, gt=0, le=120)  # seconds to wait for a free connection
    langgraph_schema: str = "langgraph"  # Postgres schema for the run checkpoints

    # Projects to load, by folder name in apps/
    apps: list[str] = ["lead_finder", "companies"]  # companies: PLAN-V10

    # --- API (env-only) ----------------------------------------------------------------
    api_host: str = "127.0.0.1"  # must be this computer; the engine is not for a network
    api_port: int = Field(8000, ge=1, le=65535)
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    auto_migrate: bool = True

    # --- Sign-in (PLAN-V6, env-only) ---------------------------------------------------
    # Off on this computer unless asked, so local work and the fake backend work as they did. When
    # it is on, every route except the health check and the sign-in itself needs a session.
    auth_required: StrictBool = False
    # How long a session lasts. Idle: signed out after this long without a request. Longest:
    # signed out after this long, whatever. "Keep me signed in" has no idle limit and lasts this
    # many days at most.
    session_idle_minutes: int = Field(120, ge=5, le=1440)
    session_max_hours: int = Field(12, ge=1, le=168)
    session_remember_days: int = Field(14, ge=1, le=90)
    # Over HTTPS the cookie is marked Secure and gets the __Host- prefix (the browser then keeps it
    # off every other site and every other path). Over plain http://localhost it can't be.
    session_cookie_secure: StrictBool = False
    # Guessing (PLAN-V6, security rule 2). The first `login_free_tries` wrong tries in a row cost
    # nothing. Each one after that makes the next wait longer (2 seconds, then double, up to a
    # minute). The `login_lock_tries`-th wrong try in a row locks the account for
    # `login_lock_minutes`. Tries from one IP address are limited too: after
    # `login_ip_max_failures` wrong tries in `login_ip_window_minutes`, that address waits until
    # the oldest one leaves the window.
    login_free_tries: int = Field(2, ge=0, le=10)
    login_lock_tries: int = Field(10, ge=3, le=100)
    login_lock_minutes: int = Field(15, ge=1, le=1440)
    login_ip_max_failures: int = Field(20, ge=5, le=1000)
    login_ip_window_minutes: int = Field(15, ge=1, le=1440)

    # --- Server mode (PLAN-V6 B5, env-only) ----------------------------------------------
    # On a server, behind Caddy and HTTPS. It makes the engine answer to one named domain instead of
    # this computer only. Off on this laptop, where nothing changes. When it is on:
    # - it needs `public_origin` (https only) and `trusted_proxies`, or it won't start;
    # - the host check lets that host through, and the origin guard allows that origin only;
    # - it listens on 0.0.0.0 (inside the container: only Caddy can reach it);
    # - only a connection from a trusted proxy may say what the client's IP address is;
    # - sign-in is required and the cookie is Secure (setting either off is refused);
    # - it doesn't migrate at start (the migrate step runs first; AUTO_MIGRATE=true is refused);
    # - the Swagger pages are not served.
    server_mode: StrictBool = False
    public_origin: str | None = None  # like https://hq.contourinteriors.com.au
    # The proxy's address (or its network, like Docker's 172.18.0.0/16), as the engine sees it.
    # A comma-separated list. Without it every visitor would look like the proxy.
    trusted_proxies: Annotated[list[str], NoDecode] = []
    # The other way to say whose word is taken for a client's IP address (server mode needs this
    # or TRUSTED_PROXIES, never both). Behind DigitalOcean App Platform there is no proxy of ours
    # with a fixed address: its front door writes the visitor's real address in a header of its
    # own, `do-connecting-ip`, and this is that header's name. It is only safe where nothing can
    # reach the backend except through that front door, which sets the header itself.
    client_ip_header: str | None = None

    # --- The first Admin account, made by `engine migrate` (env-only) ----------------------
    # With the email and the password both set, and no Admin yet, `engine migrate` makes the
    # account, so a deploy needs nobody at a terminal. Once an Admin exists these are ignored, and
    # the password can be removed. The password follows the same rules as one typed at
    # `create-admin`. An empty value counts as not set.
    first_admin_email: str | None = None
    first_admin_password: SecretStr | None = None
    first_admin_username: str | None = None
    first_admin_name: str | None = None

    # --- Memory (FastEmbed runs on this computer) --------------------------------------
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_cache_dir: Path = BACKEND_DIR / ".cache" / "fastembed"
    embedding_threads: int | None = Field(None, ge=1, le=64)  # None: let FastEmbed choose

    # --- Safety switches and ceilings (env-only, TBC with Levi) ------------------------
    # The Levi data OK: may company names from HubSpot go to Claude? Off until Levi says yes.
    # Only the exact text true or false counts, so a stray "1" or "yes" can't turn it on.
    hubspot_names_to_claude_ok: StrictBool = False
    # The same question for Signal Hire: may the name of a company that came from HubSpot (a
    # watchlist company) be sent to Signal Hire, to count its people? Off until Levi says yes. It is
    # a switch of its own because the data goes to another company. Same exact-text rule.
    hubspot_names_to_signalhire_ok: StrictBool = False
    # A ceiling can't sit below the lowest value its editable settings allow (a test checks this
    # against CEILINGS), or a valid setting would be clamped to something its own minimum refuses.
    hard_run_cap_usd: Decimal = Field(Decimal("50"), ge=Decimal("1"), le=1000)
    hard_company_cap_usd: Decimal = Field(Decimal("5"), ge=Decimal("0.10"), le=1000)
    hard_concurrency: int = Field(4, ge=1, le=16)
    # The ceilings of the two limits below. The Settings page can't go above them, so a typo there
    # (US$1,000 for US$100) is stopped. They change only in .env, then a restart. TBC with Al-khair.
    hard_scheduled_run_cap_usd: Decimal = Field(Decimal("200"), ge=Decimal("1"), le=10_000)
    hard_daily_cap_usd: Decimal = Field(Decimal("300"), ge=Decimal("1"), le=100_000)
    # All Claude spending in 24 hours, every run together (core/claude/daily.py). On the Settings
    # page since 9 Nov, up to hard_daily_cap_usd. US$150: an automatic run may spend that much.
    daily_cap_usd: Decimal = Field(Decimal("150"), ge=Decimal("1"), le=Decimal("300"))

    # --- Claude. Prices per model are in core/claude/pricing.py. -----------------------
    anthropic_api_key: SecretStr | None = None
    claude_model: ClaudeModel = "claude-opus-5-5"
    claude_effort: ClaudeEffort = "medium"
    claude_timeout_seconds: float = Field(300, gt=0, le=3600)
    claude_concurrency: int = Field(2, ge=1, le=4)  # requests at once. New keys have low limits.
    # One model per kind of step. None means use claude_model.
    model_discover: ClaudeModel | None = None
    model_search: ClaudeModel | None = None
    model_extract: ClaudeModel | None = None

    # --- Signal Hire: company headcount, counts only (core/signalhire). None turns it off. ---
    signalhire_api_key: SecretStr | None = None
    signalhire_timeout_seconds: float = Field(30, gt=0, le=120)
    # Reading a company's details costs 1 company credit (PLAN-V4 C1). A run reads at most this
    # many (a saved copy is free, so 0 means saved copies only), and a saved copy is used for this
    # many days. The first number is our guess, TBC with Al-khair until support says what the
    # account has.
    signalhire_max_credits_per_run: int = Field(20, ge=0, le=1000)
    signalhire_details_fresh_days: int = Field(30, ge=1, le=365)

    # --- Email (PLAN-V9 C1, env-only): core/email/sender.py ---------------------------
    # log writes each email to the log and sends nothing (the laptop and the tests). resend sends
    # through Resend's web API, with EMAIL_API_KEY and EMAIL_FROM.
    email_provider: Literal["log", "resend"] = "log"
    email_api_key: SecretStr | None = None
    email_from: str | None = None  # like "Contour HQ <leads@contourinteriors.com.au>"
    # The website's address, for links in emails. Empty: the public origin, else the laptop's.
    app_url: str | None = None
    # Who gets the email when a scheduled Lead Finder run ends (PLAN-V9 C2, Levi TBC). A
    # comma-separated list. Empty: no email.
    lead_finder_notify_emails: Annotated[list[str], NoDecode] = []

    # --- HubSpot: the service key (PLAN-V5). None means no call reaches HubSpot. ---------
    hubspot_service_key: SecretStr | None = None
    # HubSpot's dated API version, like 2026-09 (the newest on 3 Nov 2026), or v3 for its older
    # paths, which still work until a date HubSpot hasn't published.
    hubspot_api_version: str = "2026-09"
    # Writing to HubSpot (PLAN-V5 rule 1). Off until the key has the write scopes and one live
    # write has been checked (F2). Only the exact text true turns it on.
    hubspot_write_enabled: StrictBool = False
    hubspot_timeout_seconds: float = Field(30, gt=0, le=120)
    # How fast we call HubSpot. Its limit headers allowed 19 requests and 5 searches a second on
    # 4 Nov 2026 (TBC with the admin); we stay well under, so other tools keep room.
    hubspot_requests_per_second: float = Field(8, gt=0, le=15)
    hubspot_searches_per_second: float = Field(4, gt=0, le=5)
    # The sync (core/hubspot/sync.py). When the backend starts and the last good sync is older
    # than this many hours, a sync starts in the background. 0 = never at start. TBC.
    hubspot_sync_max_age_hours: int = Field(24, ge=0, le=720)
    # A sync reads everything (and so finds deleted records) when the last full one is older
    # than this many days. Otherwise it reads only what changed. TBC.
    hubspot_full_sync_days: int = Field(7, ge=1, le=90)

    # --- Caps for researching one company. Code checks them before every request. ------
    company_cap_usd: Decimal = Field(Decimal("2.50"), ge=Decimal("0.10"), le=Decimal("5"))
    company_max_searches: int = Field(12, ge=1, le=40)
    searches_per_request: int = Field(3, ge=1, le=10)
    fetches_per_request: int = Field(3, ge=1, le=10)
    # Money held back for each request that is running, since its cost is known only after.
    # TBC: measure from Phase 1 runs.
    request_reserve_usd: Decimal = Field(Decimal("0.80"), ge=Decimal("0.10"), le=Decimal("5"))

    # --- Caps for one run --------------------------------------------------------------
    run_cap_usd: Decimal = Field(Decimal("20.00"), ge=Decimal("1"), le=Decimal("50"))
    run_max_companies: int = Field(20, ge=1, le=100)
    # --- Automatic runs: the ones a schedule starts (9 Nov, Al-khair) ----------------------
    # They have no company limit of their own: they go on until their share of the goal below, or
    # until no company is left. This is their money limit, a brake against a fault: a normal city
    # run costs about US$25 to US$30 (TBC). A run a person starts keeps run_cap_usd and
    # run_max_companies above.
    scheduled_run_cap_usd: Decimal = Field(Decimal("150.00"), ge=Decimal("1"), le=Decimal("200"))
    # The Lead Finder's goal: good leads (Pass or Director review) that the automatic runs find
    # together in one round of the city schedules, every 2 weeks (Levi, 5 Nov: about 100; 90 or
    # 100 is TBC with him).
    lead_finder_goal_good_leads: int = Field(100, ge=1, le=1000)
    # Held for each discovery request. 0.60 lets the default Start choice (3 cities x 4 main
    # triggers = 12 requests, US$7.20) fit discovery's share of the default run cap (US$8.00).
    # A discovery request is expected to cost about US$0.40 (TBC: measure on the first runs).
    slice_reserve_usd: Decimal = Field(Decimal("0.60"), ge=Decimal("0.10"), le=Decimal("5"))
    slice_max_searches: int = Field(6, ge=1, le=20)
    # The most of the run cap that discovery may use. The rest is for researching companies.
    discovery_share: float = Field(0.40, ge=0.05, le=0.90)
    run_company_concurrency: int = Field(2, ge=1, le=4)
    run_discover_concurrency: int = Field(3, ge=1, le=4)
    max_concurrent_runs: int = Field(1, ge=1, le=4)

    # --- Memory first and matching -----------------------------------------------------
    memory_fresh_days: int = Field(30, ge=1, le=365)  # notes younger than this are reused
    match_fuzzy_min: int = Field(90, ge=70, le=100)  # close-name score, 0 to 100
    match_profile_min: float = Field(0.90, ge=0.70, le=1.0)  # look-alike similarity

    # --- Validators --------------------------------------------------------------------

    @field_validator(
        "hubspot_names_to_claude_ok",
        "hubspot_names_to_signalhire_ok",
        "hubspot_write_enabled",
        "auth_required",
        "session_cookie_secure",
        "server_mode",
        mode="before",
    )
    @classmethod
    def _exact_bool(cls, value: Any) -> Any:
        """The env gives text. Only 'true' and 'false' become a bool. StrictBool checks the rest."""
        if isinstance(value, str):
            text = value.strip().lower()
            if text in ("true", "false"):
                return text == "true"
        return value

    @field_validator("hubspot_api_version")
    @classmethod
    def _hubspot_version(cls, value: str) -> str:
        # It goes into every request path, so it must be a date version or v3.
        version = value.strip()
        if version != "v3" and not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", version):
            raise ValueError("hubspot_api_version must be a date version like 2026-09, or v3")
        return version

    @field_validator("public_origin")
    @classmethod
    def _public_origin(cls, value: str | None) -> str | None:
        return None if value is None else _clean_public_origin(value)

    @field_validator("trusted_proxies", mode="before")
    @classmethod
    def _split_proxies(cls, value: Any) -> Any:
        """The env gives text: a comma-separated list (or a JSON list, as other list settings)."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as error:
                    raise ValueError("trusted_proxies isn't a valid list") from error
            return [part for part in re.split(r"[,\s]+", text) if part]
        return value

    @field_validator("lead_finder_notify_emails", mode="before")
    @classmethod
    def _split_emails(cls, value: Any) -> Any:
        """A comma-separated list (or a JSON list), like trusted_proxies."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as error:
                    raise ValueError("lead_finder_notify_emails isn't a valid list") from error
            return [part for part in re.split(r"[,;\s]+", text) if part]
        return value

    @field_validator("lead_finder_notify_emails")
    @classmethod
    def _emails(cls, value: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(address.strip().lower() for address in value if address))
        for address in cleaned:
            if not re.fullmatch(r"[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+", address):
                raise ValueError("lead_finder_notify_emails has something that isn't an address")
        return cleaned

    @field_validator("email_from", "app_url")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("trusted_proxies")
    @classmethod
    def _proxy_addresses(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(_clean_proxy(entry) for entry in value))

    @field_validator("client_ip_header")
    @classmethod
    def _client_ip_header_name(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        name = value.strip().lower()
        if name in FORGEABLE_ADDRESS_HEADERS:
            raise ValueError(
                f"client_ip_header can't be {name}: a visitor can write it. Behind a proxy of your "
                "own with a fixed address, use TRUSTED_PROXIES instead"
            )
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", name):
            raise ValueError("client_ip_header must be a header name, like do-connecting-ip")
        return name

    @field_validator("first_admin_email", "first_admin_username", "first_admin_name")
    @classmethod
    def _blank_is_not_set(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("first_admin_password", mode="before")
    @classmethod
    def _blank_password_is_not_set(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("cors_origins")
    @classmethod
    def _loopback_origins(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(_clean_origin(origin) for origin in value))

    @field_validator("api_host")
    @classmethod
    def _loopback_host(cls, value: str) -> str:
        host = value.strip().lower()
        if host not in API_HOSTS:
            raise ValueError("api_host must be 127.0.0.1 or localhost. It is not for a network.")
        return host

    @field_validator("langgraph_schema")
    @classmethod
    def _schema_name(cls, value: str) -> str:
        # It goes into SQL and into a connection option, so it must be a plain name.
        name = value.strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", name):
            raise ValueError(
                "langgraph_schema must be lowercase letters, digits and underscores, "
                "starting with a letter, at most 63 characters"
            )
        # LangGraph makes its own tables here, so the schema must be one nothing else uses.
        if name in RESERVED_SCHEMAS or name.startswith("pg_"):
            raise ValueError(
                "langgraph_schema needs a schema of its own. It can't be public, core, "
                "lead_finder, information_schema, or a name that starts with pg_"
            )
        return name

    @model_validator(mode="after")
    def _server_mode_is_whole(self) -> "Settings":
        """Server mode refuses to start with a missing or unsafe piece, and turns on what it needs.

        What it needs must not be contradicted: AUTH_REQUIRED=false, SESSION_COOKIE_SECURE=false
        or AUTO_MIGRATE=true in .env is refused rather than quietly overruled, so nobody believes
        a setting they wrote is in force. (The origin is already known to be https if it is there.)
        """
        if not self.server_mode and self.client_ip_header is not None:
            raise ValidationError.from_exception_data(
                "Settings",
                [
                    InitErrorDetails(
                        type=PydanticCustomError(
                            "server_mode",
                            "{message}",
                            {
                                "message": "CLIENT_IP_HEADER only works with SERVER_MODE=true: it "
                                "says whose word is taken for a visitor's address on a server."
                            },
                        ),
                        loc=("client_ip_header",),
                        input=self.client_ip_header,
                    )
                ],
            )
        if not self.server_mode:
            return self
        asked = self.model_fields_set
        problems: list[tuple[str, str]] = []
        if self.public_origin is None:
            problems.append(
                (
                    "public_origin",
                    "SERVER_MODE needs PUBLIC_ORIGIN: the https address of the website, like "
                    "https://hq.contourinteriors.com.au",
                )
            )
        if self.trusted_proxies and self.client_ip_header:
            problems.append(
                (
                    "client_ip_header",
                    "Use TRUSTED_PROXIES (behind a proxy with a fixed address, like Caddy) or "
                    "CLIENT_IP_HEADER (behind App Platform), not both.",
                )
            )
        elif not self.trusted_proxies and not self.client_ip_header:
            problems.append(
                (
                    "trusted_proxies",
                    "SERVER_MODE needs TRUSTED_PROXIES: the address of the proxy that passes on "
                    "the client's IP address, like 172.18.0.0/16. Without it every visitor looks "
                    "like the proxy, and the limit on tries from one IP address would lock "
                    "everyone out together. Behind DigitalOcean App Platform, set "
                    "CLIENT_IP_HEADER=do-connecting-ip instead.",
                )
            )
        if "auth_required" in asked and not self.auth_required:
            problems.append(
                ("auth_required", "SERVER_MODE always requires sign-in. Remove AUTH_REQUIRED=false")
            )
        if "session_cookie_secure" in asked and not self.session_cookie_secure:
            problems.append(
                (
                    "session_cookie_secure",
                    "SERVER_MODE always uses a Secure cookie. Remove SESSION_COOKIE_SECURE=false",
                )
            )
        if "auto_migrate" in asked and self.auto_migrate:
            problems.append(
                (
                    "auto_migrate",
                    "SERVER_MODE doesn't change the database at start: the migrate step runs "
                    "first. Remove AUTO_MIGRATE=true",
                )
            )
        if problems:
            raise ValidationError.from_exception_data(
                "Settings",
                [
                    InitErrorDetails(
                        type=PydanticCustomError("server_mode", "{message}", {"message": text}),
                        loc=(field,),
                        input=getattr(self, field),
                    )
                    for field, text in problems
                ],
            )
        self.auth_required = True
        self.session_cookie_secure = True
        self.auto_migrate = False
        return self

    @model_validator(mode="after")
    def _a_verifying_sslmode_has_its_certificate(self) -> "Settings":
        if (
            self.postgres_sslmode in ("verify-ca", "verify-full")
            and self.postgres_sslrootcert is None
        ):
            raise ValueError(
                f"POSTGRES_SSLMODE={self.postgres_sslmode} needs POSTGRES_SSLROOTCERT: the path of "
                "the database's CA certificate file"
            )
        return self

    @model_validator(mode="after")
    def _the_waits_come_before_the_lock(self) -> "Settings":
        if self.login_free_tries >= self.login_lock_tries:
            raise ValueError(
                "login_free_tries must be below login_lock_tries, or the waits would never start"
            )
        return self

    @model_validator(mode="after")
    def _reserves_fit_their_caps(self) -> "Settings":
        """A reserve bigger than the cap it is held from would make every request fail.

        Each error names every setting involved, so the Settings page can show it beside the
        one a person just changed: a lone lower `company_cap_usd` is refused here, not
        accepted and then failing at the first request. Both rules are checked together, so
        one answer lists every problem.
        """
        problems: list[tuple[str, tuple[str, ...]]] = []
        if self.request_reserve_usd > self.company_cap_usd:
            message = (
                f"request_reserve_usd ({_usd(self.request_reserve_usd)}) is more than "
                f"company_cap_usd ({_usd(self.company_cap_usd)}), so no request could start. "
                "Lower the reserve or raise the cap."
            )
            problems.append((message, ("request_reserve_usd", "company_cap_usd")))
        room = discovery_cap_usd(self.run_cap_usd, self.discovery_share)
        if self.slice_reserve_usd > room:
            message = (
                f"slice_reserve_usd ({_usd(self.slice_reserve_usd)}) is more than discovery may "
                f"spend in a run ({_usd(room)}: discovery_share {self.discovery_share:g} of "
                f"run_cap_usd {_usd(self.run_cap_usd)}), so no discovery request could start. "
                "Lower the reserve, or raise the run cap or the discovery share."
            )
            problems.append((message, ("slice_reserve_usd", "run_cap_usd", "discovery_share")))
        if problems:
            raise ValidationError.from_exception_data(
                "Settings",
                [
                    InitErrorDetails(
                        type=PydanticCustomError("reserve_too_big", "{message}", {"message": text}),
                        loc=(field,),
                        input=getattr(self, field),
                    )
                    for text, fields in problems
                    for field in fields
                ],
            )
        return self

    # --- Helpers -----------------------------------------------------------------------

    @property
    def listen_host(self) -> str:
        """Where the backend listens: this computer only, unless it is a server (inside its
        container, where only the proxy can reach it)."""
        return "0.0.0.0" if self.server_mode else self.api_host

    @property
    def public_host(self) -> str | None:
        """The host name of `public_origin`, in lower case, or None."""
        return urlsplit(self.public_origin).hostname if self.public_origin else None

    def database_url(self, database: str | None = None) -> str:
        """The SQLAlchemy address for psycopg 3. Works for both sync and async engines."""
        password = quote(self.postgres_password.get_secret_value(), safe="")
        name = database or self.postgres_db
        address = (
            f"postgresql+psycopg://{self.postgres_user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{name}"
        )
        options: list[str] = []
        if self.postgres_sslmode is not None:
            options.append(f"sslmode={self.postgres_sslmode}")
        if self.postgres_sslrootcert is not None:
            options.append(f"sslrootcert={quote(str(self.postgres_sslrootcert), safe='/')}")
        return f"{address}?{'&'.join(options)}" if options else address

    def psycopg_conninfo(self, database: str | None = None, **options: str | int | None) -> str:
        """A libpq connection string for psycopg (the checkpoint pool, the advisory lock).

        Built in keyword form, so a password with spaces or quotes is escaped correctly. It
        holds the password: never log it, and never put it in an error or an event.
        """
        params: dict[str, str | int | None] = {
            "host": self.postgres_host,
            "port": self.postgres_port,
            "user": self.postgres_user,
            "password": self.postgres_password.get_secret_value(),
            "dbname": database or self.postgres_db,
            "connect_timeout": CONNECT_TIMEOUT_SECONDS,
            "sslmode": self.postgres_sslmode,
            "sslrootcert": str(self.postgres_sslrootcert) if self.postgres_sslrootcert else None,
        }
        params.update(options)
        # mypy reads a possible "conninfo" key in params as the first argument.
        return make_conninfo(**params)  # type: ignore[arg-type]

    def model_for(self, step: Literal["discover", "search", "extract"]) -> str:
        """The model for one kind of step: its own setting, or claude_model."""
        own: str | None = {
            "discover": self.model_discover,
            "search": self.model_search,
            "extract": self.model_extract,
        }[step]
        return own or self.claude_model


def field_bounds(key: str) -> tuple[Any | None, Any | None]:
    """The (min, max) of an editable number setting, from its field definition."""
    low: Any | None = None
    high: Any | None = None
    for item in Settings.model_fields[key].metadata:
        if isinstance(item, Ge):
            low = item.ge
        elif isinstance(item, Le):
            high = item.le
    return low, high


def clamp_to_ceilings(settings: Settings) -> Settings:
    """A copy with every capped setting at or below its ceiling (see CEILINGS).

    Overrides can't go above a ceiling, and a ceiling lowered in .env pulls the values down
    with it. Values already within bounds pass through unchanged.

    A reserve follows its cap down, so the copy keeps the rule `Settings` checks: the request
    reserve is at most the company cap, and the slice reserve is at most what discovery may
    spend (`discovery_cap_usd`). The one case that can't be kept whole: a run ceiling so low
    that discovery gets less than $0.10, the slice reserve's own minimum (a $1 ceiling with a
    discovery share under 0.10). Then the reserve is cut to what discovery has, below that
    minimum, so a request can still start.
    """
    update: dict[str, Any] = {}
    for key, ceiling in CEILINGS.items():
        value = getattr(settings, key)
        limit = getattr(settings, ceiling)
        if value > limit:
            update[key] = limit

    def now(key: str) -> Any:
        return update.get(key, getattr(settings, key))

    if now("request_reserve_usd") > now("company_cap_usd"):
        update["request_reserve_usd"] = now("company_cap_usd")
    room = discovery_cap_usd(now("run_cap_usd"), settings.discovery_share)
    if now("slice_reserve_usd") > room:
        update["slice_reserve_usd"] = room
    return settings.model_copy(update=update) if update else settings


@lru_cache
def get_settings() -> Settings:
    return clamp_to_ceilings(Settings())
