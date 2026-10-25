"""Alembic: applies database changes, using psycopg 3 in sync mode."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import core.db.models  # noqa: F401  (registers the core tables)
from core.apps import import_app_tables, load_apps
from core.config import get_settings
from core.db.base import CORE_SCHEMA, Base

config = context.config
if config.config_file_name is not None and not config.attributes.get("skip_logging_config"):
    fileConfig(config.config_file_name)

settings = get_settings()
apps = load_apps(settings.apps)
import_app_tables(apps)
SCHEMAS = {CORE_SCHEMA, *(app.db_schema for app in apps)}
target_metadata = Base.metadata


def database_url() -> str:
    return config.get_main_option("sqlalchemy.url") or settings.database_url()


def include_name(name: str | None, type_: str, parent_names: object) -> bool:
    """Only look at our own schemas when comparing models with the database."""
    if type_ == "schema":
        return name in SCHEMAS
    return True


def run_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        include_schemas=True,
        include_name=include_name,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    engine = create_engine(database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            include_name=include_name,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
