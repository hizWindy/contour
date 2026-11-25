---
name: user-sim
description: Simulate real Contour users in a browser (Playwright) across roles, viewports, keyboard-only flows, bad networks and messy commands to catch click friction, focus traps, dead ends and real-browser bugs before Levi or the team sees them. Use after building a screen or flow, before merge vNN or deploy vNN, or when asked to test like a user or run a QA pass.
---

# User-flow simulator

Mocked tests prove parts work alone. This skill drives the running app in a real browser as real Contour users, so click friction and end-to-end breaks show up before Levi or the team hits them.

This skill never edits app code. It runs the app, simulates users, and reports findings with evidence.

## Safety and setup

- **No cost, no real records.** Never point at live (`contourhq.online`), real HubSpot, real email, or real Claude.
- **Backend choice:** start the fake backend (`uv run --no-sync python -m tests.e2e.serve`, add `--auth` to test roles) on a free port like `8010` with `API_PORT=8010` and `CORS_ORIGINS=["http://localhost:5174"]`, and Vite on `5174` with `API_PROXY_TARGET=http://127.0.0.1:8010`. If testing against a branch's copy database, blank `ANTHROPIC_API_KEY` (it is a Windows user setting) and confirm `GET /api/v1/health/details` says no Claude key is set and HubSpot writing is off.
- **Leave ports `8000` and `5173` alone** if another session holds them. Check `netstat -ano | findstr :8000` first.
- **One heavy thing at a time:** run Playwright passes through `bash engine/scripts/heavy.sh <cmd>`.
- **Made-up data only** ("Sample Logistics Pty Ltd", "Jo Sample"). Save screenshots under `plan/shots/sim/` (git-ignored).
- **Clean up:** stop every backend, Vite server and browser you started before reporting back.

## 1. Personas

Pick every persona touched by the change:

| Persona | Role and ticks | What they care about |
|---|---|---|
| **BD rep (like Levi)** | Staff, HubSpot linked, Companies + Call logs + Meetings | Fewest clicks, fast call prep (`P`), quick voice/text logging (`V`, `L`), smooth batch confirm |
| **Non-HubSpot staff (like Jo Sample)** | Staff, `no_hubspot_user`, Call logs (+ Meetings) | No HubSpot tasks on Today, no "Open in HubSpot", self-task refused cleanly, teammate follow-up works |
| **Platform admin (like Al-khair)** | Platform admin, all ticks | People tab (add, roles, ticks, HubSpot link), Schedules, Settings, Health |
| **Viewer / narrow access** | Viewer, or Staff without Lead Finder | No write buttons or `V`, 403 enforced, Lead Finder rows and fields stay hidden |

## 2. Journeys to drive

Run every journey the diff touches (or all of them before a release):

1. **Sign-in and session:** bad password error, sign in, reload on a deep URL, sign out.
2. **Assistant and voice/text loop:** open the bar (`V` or Speak), run messy commands (misheard company name, unclear words, two teammates with one name, company not in copy), edit fields on the card, keep for Later vs Send, and chain 2 to 3 commands in a row.
3. **Companies, call prep and Call logs:** filter/sort Companies, open Prep (`P`), press `L` to log a call, edit and confirm a batch in Call logs, filter History.
4. **Meetings and pre-read:** switch All / My meetings / My team, open a pre-read, check the preview wording (never send to real HubSpot or email).
5. **Lead Finder (when touched):** Start form estimate, Results filters, chips, side panel, map view, Watch/Reject and Undo.

For Assistant prompt changes, also run a 20 to 30 phrase set of everyday Australian rep phrasings (mishearings, filler words, half sentences, ambiguous dates) against fakes for free — or live only on Al-khair's word.

## 3. Conditions to test

- **Viewports and themes:** `1440x900`, `1280x800` and `390x844` (phone); light and dark (`localStorage['lead-finder-theme']`); reduced motion.
- **Keyboard only:** `Tab`, `Enter`, `Esc`, `V`, `P`, `L`, `J`/`K`, `Ctrl+K` and "Skip to the page". Check focus never traps and returns to the right row after closing a panel or card.
- **Bad network and load:** 4x CPU slowdown, throttled network, offline or backend `503` (thin connection bar, no red wall; `/auth/me` failure shows the error page instead of an empty menu), and page reload mid-draft.
- **Errors:** fail on any uncaught page error, console error, `404` asset or unexpected `5xx`.

## 4. Friction check

For the main task of the diff, count the clicks or keypresses from start to finish. Flag:
- unnecessary clicks or repeated openings;
- silent failures or unclear states;
- buttons covered on a phone (such as a toast over Speak);
- jargon, codes, file names or setting names on screen (`screen-words` rules);
- sluggish clicks (> 200ms INP) or card opens (> 50ms at 4x CPU).

## Report

Verdict first: **Smooth**, **Rough edges** or **Broken**. Then:

1. **Broken (Blocker):** persona, viewport, exact steps, expected vs actual, console/network output, screenshot path.
2. **Friction (Should fix):** extra clicks, focus issues, phone overlap, slow response or confusing wording, with evidence.
3. **Tested:** personas, journeys, viewports, conditions and click counts.
4. **Not tested:** what could not run (real mic, real HubSpot, Safari, real phone, NVDA) and why.
