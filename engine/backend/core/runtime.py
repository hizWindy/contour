"""The event loop fix for Windows.

psycopg's async mode can't run on Windows' default event loop (Proactor), so we use the
selector loop there. Every place that starts an event loop goes through this module.
"""

import asyncio
import sys
from collections.abc import Callable


def loop_factory() -> Callable[[], asyncio.AbstractEventLoop]:
    """The event loop to pass to asyncio.run(loop_factory=...)."""
    if sys.platform == "win32":
        return asyncio.SelectorEventLoop
    return asyncio.new_event_loop


def use_selector_loop_on_windows() -> None:
    """For tools that make their own loops, like pytest. Python 3.12 still allows policies."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
