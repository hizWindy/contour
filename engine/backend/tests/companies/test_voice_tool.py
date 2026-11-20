"""The mic's voice tool on Log call, and Levi's OK for the browser's speech service (PLAN-V18 M1).

The browser's own speech service (`browser_service`) sends a rep's voice to Google or Microsoft,
so the mic uses it only once the server allows it (`BROWSER_SPEECH_OK=true`). Until then
`GET /call-notes/options` gives `browser_model` (a free model on the device) in its place, whether
it was saved on the Settings page or set on the server. With the OK, both come through. The
Settings page's side (the 422 `browser_speech_off`) is in tests/core/test_prefs.py and
tests/core/test_settings_api.py.
"""

from collections.abc import Callable

import pytest

from core.prefs.models import Setting
from tests.companies.helpers import API, add, signed_in_as
from tests.core.auth_world import World

pytestmark = pytest.mark.integration
OPTIONS = f"{API}/call-notes/options"
OK = pytest.mark.parametrize(
    ("allowed", "used"),
    [("false", "browser_model"), ("true", "browser_service")],
)


async def voice_tool(world: World) -> object:
    """What the mic uses, as the website reads it: through the real settings, saved rows and all."""
    async with signed_in_as(world, "mia", ["companies"]) as client:
        response = await client.get(OPTIONS)
    assert response.status_code == 200, response.text
    return response.json()["voice_tool"]


@OK
async def test_a_saved_browser_speech_service_waits_for_the_ok(
    world: World, server_env: Callable[..., None], allowed: str, used: str
) -> None:
    server_env(BROWSER_SPEECH_OK=allowed)
    await add(world, Setting(key="voice_tool", value="browser_service"))
    assert await voice_tool(world) == used


@OK
async def test_a_browser_speech_service_set_on_the_server_waits_for_the_ok(
    world: World, server_env: Callable[..., None], allowed: str, used: str
) -> None:
    server_env(VOICE_TOOL="browser_service", BROWSER_SPEECH_OK=allowed)
    assert await voice_tool(world) == used


async def test_a_saved_choice_still_wins_over_the_server_one(
    world: World, server_env: Callable[..., None]
) -> None:
    """Typing saved on the Settings page beats the server's browser speech service, OK or not."""
    server_env(VOICE_TOOL="browser_service", BROWSER_SPEECH_OK="true")
    await add(world, Setting(key="voice_tool", value="typing"))
    assert await voice_tool(world) == "typing"
