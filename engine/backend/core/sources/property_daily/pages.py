"""Property Daily's pages file (`pages.yaml`), checked when the backend starts (PLAN-V16 T2-5).

A wrong file stops the start with a clear message, as a wrong rules file does: an address on a
host the browser won't load, a missing sign-in field, or a lease window that makes no sense.
"""

from functools import cache
from pathlib import Path
from typing import Self
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.browser.sites import Site

PAGES_FILE = Path(__file__).with_name("pages.yaml")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SiteFile(_Strict):
    name: str
    hosts: list[str] = Field(min_length=1)
    never_open: list[str] = Field(min_length=1)
    signin_url_marks: list[str] = []
    signin_text_marks: list[str] = []
    lockout_marks: list[str] = []
    captcha_marks: list[str] = []


class PageAddresses(_Strict):
    home: str
    signin: str
    daily: str
    report: str
    search: str
    lease_search: str
    lease_views: list[str] = Field(min_length=1)


class SignInForm(_Strict):
    login: str
    password: str
    submit: str


class FeedFile(_Strict):
    first_read_days: int = Field(ge=1, le=31)
    most_days: int = Field(ge=1, le=31)


class LeaseEndingsFile(_Strict):
    from_months: int = Field(ge=0, le=120)
    to_months: int = Field(ge=1, le=120)
    smallest_m2: int = Field(ge=0)


class Pages(_Strict):
    site: SiteFile
    pages: PageAddresses
    signin_form: SignInForm
    feed: FeedFile
    lease_endings: LeaseEndingsFile

    @model_validator(mode="after")
    def _every_address_is_on_the_sites_hosts(self) -> Self:
        hosts = {host.lower() for host in self.site.hosts}
        addresses = [
            self.pages.home,
            self.pages.signin,
            self.pages.daily,
            self.pages.report,
            self.pages.search,
            self.pages.lease_search,
            *self.pages.lease_views,
        ]
        for address in addresses:
            parts = urlsplit(address)
            if parts.scheme != "https" or (parts.hostname or "") not in hosts:
                raise ValueError(f"{address} isn't an https address on the site's hosts")
        if not self.site.signin_url_marks and not self.site.signin_text_marks:
            raise ValueError("the site needs a way to tell its sign-in page")
        if self.lease_endings.from_months >= self.lease_endings.to_months:
            raise ValueError("lease_endings: from_months must be below to_months")
        return self

    def as_site(self) -> Site:
        return Site(
            id="property_daily",
            name=self.site.name,
            hosts=frozenset(host.lower() for host in self.site.hosts),
            never_open=tuple(mark.lower() for mark in self.site.never_open),
            signin_url_marks=tuple(mark.lower() for mark in self.site.signin_url_marks),
            signin_text_marks=tuple(mark.lower() for mark in self.site.signin_text_marks),
            captcha_marks=tuple(mark.lower() for mark in self.site.captcha_marks),
            lockout_marks=tuple(mark.lower() for mark in self.site.lockout_marks),
        )


def read_pages(path: Path = PAGES_FILE) -> Pages:
    return Pages.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


@cache
def property_daily_pages() -> Pages:
    return read_pages()
