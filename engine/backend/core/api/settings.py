"""Settings endpoints: read them, change some, put one back to its default.

These are the settings a person may change (caps, concurrency, models, thresholds). The hard
ceilings and the HubSpot approval switch come from engine/.env and show as read-only rows.
Every route answers 501 until package B2 builds it (see core/api/stubs.py).
"""

from typing import Annotated

from fastapi import APIRouter, Path

from core.api.models import SafeText
from core.api.stubs import stub
from core.prefs.schemas import SettingsOut, SettingsPatch

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get(
    "",
    response_model=SettingsOut,
    summary="All settings, with their limits and current values",
)
@stub
async def read_settings() -> SettingsOut:
    raise NotImplementedError


@router.patch(
    "",
    response_model=SettingsOut,
    summary="Change some settings",
    description=(
        "Only the settings in `values` change. A value outside its limits is a 422 whose error "
        "field is `body.values.<key>` (like `body.values.run_cap_usd`, the same style as every "
        "other 422), and then nothing changes. Send a decimal setting (money and shares) as a "
        'string like "15.00", and an int setting as a number. A change applies to the next '
        "run and the next request. A run in progress keeps the caps it started with."
    ),
)
@stub
async def update_settings(body: SettingsPatch) -> SettingsOut:
    raise NotImplementedError


@router.delete(
    "/{key}",
    response_model=SettingsOut,
    summary="Put one setting back to its default",
)
@stub
async def reset_setting_to_default(
    key: Annotated[SafeText, Path(max_length=64, examples=["run_cap_usd"])],
) -> SettingsOut:
    raise NotImplementedError
