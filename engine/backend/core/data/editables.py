"""The core's tables that can be edited in the Data tab (PLAN-V26 choice 18): Memory, where a wrong
note can be deleted. Nothing in a note can be changed."""

from typing import Final

from core.data.edits import Editable

CORE_EDITABLES: Final = (Editable("core.memory", fields=(), deletable=True),)
