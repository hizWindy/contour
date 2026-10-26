"""Process setup that must happen before anything else: the Windows event loop fix, and
switching LangSmith tracing off.

psycopg's async mode can't run on Windows' default event loop (Proactor), so we use the
selector loop there. Every place that starts an event loop goes through this module.
"""

import asyncio
import os
import sys
from collections.abc import Callable

# Any of these set to "true" would send prompts and answers to LangSmith's servers.
TRACING_VARIABLES = (
    "LANGSMITH_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_TRACING",
    "LANGSMITH_TRACING_V2",
)
TRACING_KEYS = ("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY")


def loop_factory() -> Callable[[], asyncio.AbstractEventLoop]:
    """The event loop to pass to asyncio.run(loop_factory=...)."""
    if sys.platform == "win32":
        return asyncio.SelectorEventLoop
    return asyncio.new_event_loop


def use_selector_loop_on_windows() -> None:
    """For tools that make their own loops, like pytest. Python 3.12 still allows policies."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def disable_tracing() -> None:
    """Forces LangSmith tracing off. Prompts and answers must never leave this computer.

    Call it at the top of create_app() and of every command line entry point, before
    langgraph is imported. Setting the variables alone is not enough, because the library
    can read them earlier, so it is also switched off in code.
    """
    for name in TRACING_VARIABLES:
        os.environ[name] = "false"
    for name in TRACING_KEYS:
        os.environ.pop(name, None)
    import langsmith
    import langsmith.utils

    # The library caches what it read from the environment.
    cached = getattr(langsmith.utils.get_env_var, "cache_clear", None)
    if cached is not None:
        cached()
    langsmith.configure(enabled=False)
