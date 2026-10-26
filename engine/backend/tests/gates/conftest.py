"""The integrator's gates. They are skipped unless the environment variable RUN_GATES is 1.

    RUN_GATES=1 uv run pytest tests/gates

They check things that only hold at the end of a build (the contract file is current, and no
route is left as a stub), so they would fail halfway through and stop everyone else's work.
"""

import os
from pathlib import Path

import pytest

GATES_DIR = Path(__file__).resolve().parent


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get("RUN_GATES") == "1":
        return
    skip = pytest.mark.skip(reason="a gate: run it with RUN_GATES=1")
    for item in items:
        if GATES_DIR in Path(str(item.path)).resolve().parents:
            item.add_marker(skip)
