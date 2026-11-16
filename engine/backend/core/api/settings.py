"""Settings endpoints: read them, change some, put one back to its default.

These are the settings a person may change (caps, concurrency, models, thresholds). The hard
ceilings, the daily limit, the HubSpot approval switch and the OK for the browser's speech service
come from engine/.env and show as read-only rows. The rules and the checks are in
`core.prefs.service`.
"""

from typing import Annotated

from fastapi import APIRouter, Path

from core.api.deps import SessionDep
from core.api.models import SafeText
from core.api.signin import PlatformAdminDep
from core.prefs import service
from core.prefs.schemas import SettingsOut, SettingsPatch

router = APIRouter(prefix="/settings", tags=["settings"])
# What both routes say about the mic's browser speech service (PLAN-V18 M1).
BROWSER_SPEECH = (
    "The browser's own speech service (`voice_tool` `browser_service`) sends the voice to Google "
    "or Microsoft, so it waits for Levi's OK, set only on the server (`browser_speech_ok`, a "
    "read-only row). Until then"
)


@router.get(
    "",
    response_model=SettingsOut,
    summary="All settings, with their limits and current values",
    description=(
        "Every setting a person may change, then the ones set only on the server, as read-only "
        f"rows (`editable` false). {BROWSER_SPEECH}, `voice_tool` doesn't list it in `choices`, "
        "and a saved or server value of it shows as `browser_model` (Whisper in the browser)."
    ),
)
async def read_settings(session: SessionDep, admin: PlatformAdminDep) -> SettingsOut:
    return await service.get_settings_out(session)


@router.patch(
    "",
    response_model=SettingsOut,
    summary="Change some settings",
    description=(
        "Only the settings in `values` change. A value outside its limits is a 422 whose error "
        "field is `body.values.<key>` (like `body.values.run_cap_usd`, the same style as every "
        "other 422), and then nothing changes. Send a decimal setting (money and shares) as a "
        'string like "15.00", and an int setting as a number. A change applies to the next '
        "run and the next request. A run in progress keeps the caps it started with. "
        f"{BROWSER_SPEECH}, `voice_tool` `browser_service` is a 422 `browser_speech_off` (with "
        "`body.values.voice_tool`), and nothing changes."
    ),
)
async def update_settings(
    body: SettingsPatch, session: SessionDep, admin: PlatformAdminDep
) -> SettingsOut:
    return await service.patch_settings(session, body.values)


@router.delete(
    "/{key}",
    response_model=SettingsOut,
    summary="Put one setting back to its default",
)
async def reset_setting_to_default(
    key: Annotated[SafeText, Path(max_length=64, examples=["run_cap_usd"])],
    session: SessionDep,
    admin: PlatformAdminDep,
) -> SettingsOut:
    return await service.reset_setting(session, key)
