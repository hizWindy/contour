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

## How it works (PLAN-V16, built 15 Nov)

The code is in `engine/backend/core/browser/` (the browser) and `core/sources/` (Property Daily).

1. **Its own thread.** One headless browser runs in a thread with its own event loop, because the backend's loop on Windows can't start a program. It starts when a page is needed and closes after 5 minutes idle. A crash starts a new one; it never stops the backend.
2. **Only Property Daily loads.** Every other host is blocked inside the browser, and so are images, fonts and video. Some pages are never opened: Logout, the shortlist, reminders, notes, payments, account details and "Request Update" (the list is in `core/sources/property_daily/pages.yaml`).
3. **A slow pace.** One page at a time, 4 to 9 seconds apart (at random), at most 300 pages a day and 60 live lookup pages a run (Settings). Every page is one row in `core.source_reads`: the kind of page, how it went and how long it took. Never the page itself.
4. **Sign-in.** When the sign-in page shows, it signs in once with the username and password from `engine/.env` (or the App Platform dashboard), then tries the page again. The session is kept in memory and a temp folder made for this process, never in git and never in a log.
5. **It stops at the first block.** A person-check, a lockout, a 403 or 429, a sign-in that fails, or the sign-in page again right after signing in pauses Property Daily for 24 hours. Health and Admin's Sources tab show it, and an Admin can resume it. Nothing hides that it is a program.
6. **Behind a switch.** "Property Daily is on" in Settings, off by default.

## Limits

- Sites can tell it is a program, from the browser flag and its steady timing. To the site it is still a program reading it, and that is what the terms limit.
- If the site's layout changes, the script breaks until we fix it.
- **Not for [Arealytics](arealytics.md).** Its terms (clause 4.3) ban scripts and bots, and its site refused automated access on 15 Nov.
- Our rule: read, don't scrape, until a site's terms allow a program to read it ([AGENTS.md](../engine/AGENTS.md)).

## On this laptop and on the server

- **Installed** on 2026-11-15: the Python package `playwright` 1.65.2 (in `uv.lock`). Its own browser is Chromium build 1255 (Chrome for Testing 159.0.8154.6).
- **On this laptop, Windows Application Control blocks Playwright's own Chromium** ("spawn UNKNOWN", as it blocks other new programs). So the laptop drives the installed Google Chrome instead (Playwright's `channel="chrome"`, 157 on 15 Nov). It starts a fresh, empty profile each time, so it never touches your own Chrome's sign-ins. Edge works too.
- **On the server,** the container installs Playwright's own Chromium at the version in `uv.lock` (PLAN-V16 T2-9).

## Status and next step

- [PLAN-V16.md](../plan/PLAN-V16.md) Track 2 builds it: the browser (T2-3), the Property Daily connector (T2-5) and the container (T2-9).
- **Sign-in:** Property Daily takes a username and password in a form, so the program signs in by itself. The session is kept in memory and a temp file, never in git.
- **Arealytics is dropped** (15 Nov): its site refused automated access at the sign-in page.
- Levi gave the green light on 2026-11-15 (as Al-khair reports). The limits above are the vendors' terms, and the risk stays Levi's call.
