"""Every table change has a migration: the models and the database agree."""

import pytest
from alembic import command

from tests.conftest import alembic_config


@pytest.mark.integration
def test_models_match_the_migrations(database_url: str) -> None:
    command.check(alembic_config(database_url))  # fails if a model change has no migration
