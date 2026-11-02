"""The one settings object. It reads engine/.env. Nothing else reads environment variables.

Two kinds of setting:
- **Env-only:** the HubSpot approval switch, the hard ceilings, the daily cap, the database
  pool, the allowed web origins, the API address and the Signal Hire key. They change only in
  engine/.env, then a restart. The website can't change them.
- **Editable:** caps, concurrency, models and thresholds (the keys in EDITABLE_KEYS). The
  `core.prefs` package stores overrides in the database, checks each against its min and max
  here, and then clamps the result to the ceilings with `clamp_to_ceilings`.
"""

import re
from decimal import ROUND_DOWN, Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, Literal, get_args
from urllib.parse import quote, urlsplit

from annotated_types import Ge, Le
from psycopg.conninfo import make_conninfo
from pydantic import Field, SecretStr, StrictBool, ValidationError, field_validator, model_validator
from pydantic_core import InitErrorDetails, PydanticCustomError
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENGINE_DIR = BACKEND_DIR.parent

CONNECT_TIMEOUT_SECONDS = 5
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")  # for the web origins in cors_origins
API_HOSTS = ("localhost", "127.0.0.1")  # for api_host: the host check in core/api accepts these
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
    db_pool_size: int = Field(10, ge=1, le=50)
    db_max_overflow: int = Field(10, ge=0, le=50)
    db_pool_timeout: float = Field(10, gt=0, le=120)  # seconds to wait for a free connection
    langgraph_schema: str = "langgraph"  # Postgres schema for the run checkpoints

    # Projects to load, by folder name in apps/
    apps: list[str] = ["lead_finder"]

    # --- API (env-only) ----------------------------------------------------------------
    api_host: str = "127.0.0.1"  # must be this computer; the engine is not for a network
    api_port: int = Field(8000, ge=1, le=65535)
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    auto_migrate: bool = True

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
    daily_cap_usd: Decimal = Field(Decimal("50"), gt=0, le=10_000)

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

    @field_validator("hubspot_names_to_claude_ok", "hubspot_names_to_signalhire_ok", mode="before")
    @classmethod
    def _exact_bool(cls, value: Any) -> Any:
        """The env gives text. Only 'true' and 'false' become a bool. StrictBool checks the rest."""
        if isinstance(value, str):
            text = value.strip().lower()
            if text in ("true", "false"):
                return text == "true"
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

    def database_url(self, database: str | None = None) -> str:
        """The SQLAlchemy address for psycopg 3. Works for both sync and async engines."""
        password = quote(self.postgres_password.get_secret_value(), safe="")
        name = database or self.postgres_db
        return (
            f"postgresql+psycopg://{self.postgres_user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{name}"
        )

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
