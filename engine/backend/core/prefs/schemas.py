"""What the Settings page reads and writes.

`SettingsOut` lists every setting the page shows: the ones a person can change, and the
env-only ones (the HubSpot approval switch, the hard ceilings) as read-only rows. A value is a
plain JSON value, and its JSON type follows the setting's `type`, always:
- `int`: a JSON number, like 20.
- `decimal` (money and shares): ALWAYS a string, like "2.50" or "0.40". Never a number, so no
  cent is lost on the way. The website turns it into a number only to show it.
- `bool`: true or false. `choice` and `choice_or_null`: a string, or null for "use the default".
`min`, `max`, `default` and `value` follow the same rule. A change (`SettingsPatch`) is sent the
same way, and its errors come back as `body.values.<key>`.
"""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from core.api.models import OutModel

SettingType = Literal["int", "decimal", "bool", "choice", "choice_or_null"]
# An int is a number, a decimal is a string, a bool is true or false, a choice is a string or null.
# Money and shares (like 0.40) are "decimal", so they are always strings.
type SettingValue = int | float | str | bool | None


class SettingField(OutModel):
    """One row on the Settings page."""

    key: str = Field(examples=["run_cap_usd"])
    label: str = Field(examples=["Cap for one run (US$)"])
    description: str = Field(description="What it does, in plain words")
    type: SettingType = Field(
        description=(
            "int: `value` is a JSON number. decimal (money and shares): `value` is ALWAYS a "
            'string like "2.50", never a number. bool: true or false. choice and '
            "choice_or_null: a string from `choices`, or null for the default."
        )
    )
    min: SettingValue = Field(
        None,
        description="The lowest allowed value, for numbers (a string for a decimal)",
    )
    max: SettingValue = Field(
        None,
        description="The highest allowed value, for numbers (a string for a decimal)",
    )
    choices: list[str] | None = Field(None, description="The allowed values, for choices")
    default: SettingValue = Field(
        description="The value used when nothing is overridden (a string for a decimal)"
    )
    value: SettingValue = Field(
        description="The value in use now (a string for a decimal, a number for an int)"
    )
    overridden: bool = Field(description="True when a person changed it from the default")
    editable: bool = Field(description="False for env-only settings, which show as read-only")


class SettingsOut(BaseModel):
    fields: list[SettingField]
    daily_left_usd: Decimal = Field(
        description="What is left of today's limit across every run and request"
    )


class SettingsPatch(BaseModel):
    """Changes some settings. Settings that are not listed stay as they are."""

    model_config = ConfigDict(extra="forbid")  # a typo next to `values` is a 422, not ignored

    values: dict[str, SettingValue] = Field(
        min_length=1,
        max_length=50,
        description=(
            "Setting key to new value. Send a decimal (money or a share) as a string like "
            '"15.00" and an int as a number. A bad value comes back as a 422 whose error field '
            "is body.values.<key>."
        ),
        examples=[{"run_cap_usd": "15.00", "run_max_companies": 10}],
    )
