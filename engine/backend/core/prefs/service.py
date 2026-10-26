"""Settings people can change from the website, stored in the database (core.settings).

The signatures are final; package B2 writes the bodies. The rules it follows:
- An override is stored only when it differs from the default, and Decimal values are stored
  as text.
- A value is checked against its bounds from `core.config.field_bounds`, and then the whole
  result is clamped to the env-only ceilings with `clamp_to_ceilings`.
- `effective_settings` is `Settings.model_validate({env values | overrides})`, clamped.
- Errors are `Problem(422, ...)` with `errors=[{field: "body.values.<key>", message}]`, the same
  style as the 422 FastAPI gives for a bad body.
- A decimal setting's value, default, min and max are ALWAYS strings in `SettingsOut`; an int
  is a number (see `core/prefs/schemas.py`).
"""

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from core.prefs.schemas import SettingsOut, SettingValue


async def effective_settings(session: AsyncSession) -> Settings:
    """The settings in use now: .env, then the person's overrides, clamped to the ceilings."""
    raise NotImplementedError


async def get_settings_out(session: AsyncSession) -> SettingsOut:
    """Every setting for the Settings page, with its bounds, default and current value."""
    raise NotImplementedError


async def patch_settings(session: AsyncSession, values: dict[str, SettingValue]) -> SettingsOut:
    """Changes some settings, all or none. Returns the page as it is afterwards."""
    raise NotImplementedError


async def reset_setting(session: AsyncSession, key: str) -> SettingsOut:
    """Removes one override, so the setting goes back to its default. Raises Problem 404 for
    a key that is not an editable setting."""
    raise NotImplementedError
