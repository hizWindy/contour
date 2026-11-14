# Playwright

Last updated: 2026-11-15. **TBC** means to be confirmed.

**In one line:** a free tool that lets a program drive a real browser. We would use it to read Property Daily each day, but only after Property Daily gives written OK.

## What it is

- An open-source library from Microsoft. It runs Chrome, Firefox or WebKit. Site: https://playwright.dev
- A script can do what a person does: open pages, click, type, scroll, download and read the page.
- It works from Python, so it fits our backend (`engine/backend`).

## Why we want it

- [Property Daily](propertydaily.md) has no public API. Playwright is the way to read it from the Lead Finder.
- Example: each working day at 7 am, it opens new Property Daily leads. It saves the company, address, m², lease end and link, and they show as leads.

## How it would work

1. **Log in by hand once.** Property Daily uses Google or Microsoft sign-in, and Google often blocks automated sign-in. Save the session to a file (`storageState`). Later runs reuse it until it expires.
2. **Use its own login,** not Levi's or Al-khair's. Property Daily locks out a login used by two people at once.
3. **Run slowly, once a day,** reading only new leads.
4. **Keep it behind a switch** (`PROPERTY_DAILY_ON=false`) until the written OK arrives.

## Limits

- Sites can tell it is a program, from the browser flag and its steady timing. To the site it is still a program reading it, and that is what the terms limit.
- If the site's layout changes, the script breaks until we fix it.
- **Not for [Arealytics](arealytics.md).** Its terms (clause 4.3) ban scripts and bots.
- Our rule: read, don't scrape, until a site's terms allow a program to read it ([AGENTS.md](../engine/AGENTS.md)).

## Status and next step

- Not installed. Not built.
- Next: once Property Daily says yes, build the connector behind its switch. We can build it before then and keep it off.
