---
name: flow-trace
description: Trace every new or changed user action in Contour's engine end to end - from UI trigger and preview through the API contract, role and HubSpot access checks, service logic, database or external writes, and back to cache updates and errors - to catch cross-layer bugs before merge vNN or deploy vNN. Read-only.
---

# Code-flow trace

Unit tests check one file at a time. This skill traces a whole user action across every layer, to catch bugs that live in the joins between frontend, API, permissions, database and external services.

This skill is read-only. Report gaps with `file:line` on both sides; never edit files.

## Steps

Start from the diff (`git diff <base>...<branch>`), list every new or changed user action (a click, key press, schedule job or API write), and trace each one through all six hops:

### 1. Trigger and UI preview (`engine/frontend/src/`)
- What starts the action (click, shortcut `V`/`P`/`L`/Enter, timer, idle warm)?
- Can it fire twice from double-click, key repeat, StrictMode or a late response?
- Is it blocked while typing in an input, inside an open dialog, or for a Viewer?
- Does the preview show **every** external write that Confirm will trigger (for example, an FYI task or email in addition to the call)?

### 2. Wire and contract (`openapi.json`, `schema.d.ts`, `src/api/`)
- Do request fields, query params, status codes and response shapes match on both sides?
- Are new required fields safe for an open browser tab from before a deploy (or called out for reload)?
- Does every write send an `Idempotency-Key` where duplicates are possible?

### 3. Access, roles and HubSpot state (`core/api/guard.py`, `access.py`, `signin.py`)
- Walk all four roles (`Platform admin`, `Admin`, `Staff`, `Viewer`), project ticks (`Companies`, `Call logs`, `Meetings`, `Lead Finder`), and HubSpot states (`linked`, `none`, `not_set`).
- Can a user with only one tick (like `Call logs` without `Meetings`) call every helper route their screen needs (like `/companies/team`)?
- Can a `no_hubspot_user` account create an ownerless HubSpot task, or see "Open in HubSpot"?
- Can a Lead Finder lead or its fields leak through Companies, Today or pre-reads to someone without the Lead Finder tick?

### 4. Logic, ambiguity and concurrency (`apps/`, `core/`)
- **Names and IDs:** what happens if two teammates or companies share a name? Does the payload carry stable IDs?
- **Matching order:** can a learned or fuzzy match override an exact match?
- **Locks and pools:** is the database connection released before calling Claude, HubSpot, Signal Hire or Playwright? Are races guarded (`ON CONFLICT`, advisory lock, unique index)?
- **Switches and live defaults:** check `SERVER_MODE`, `HUBSPOT_WRITE_ENABLED`, `BROWSER_SPEECH_OK`, `NOTIFY_OWNER_CALLS` and `EMAIL_PROVIDER`. Will a default switch turn on a live write or alert before Levi approves it?

### 5. External writes, retries and errors (`core/hubspot/`, `core/claude/`, `core/email/`)
- Every HubSpot write goes through `core/hubspot/writer.py` or `activities.py`, fills only allowed fields, logs in `core.hubspot_writes`, and never retries blindly after a timeout (`HubSpotWriteUncertain`).
- Non-retryable AI errors (`400 ClaudeRefused`) stop cleanly instead of wasting budget.
- Every failure returns `application/problem+json` with plain words, a next step and a `request_id` (`screen-words` and `test_safe_deploys` rules).

### 6. Aftermath and recovery (`engine/frontend/src/`)
- After success, does the UI refresh every affected cache key (for example `Today`, `To confirm`, `History` and badge counts)?
- Trace `409`, `422`, `429`, `503` and offline: does the user keep their typed or spoken words and see one clear next step?

## Report

First, one short summary table:

| Action | Hops checked | Status |
|---|---|---|
| Example: Log call with follow-up | 1 to 6 | Gap at hop 3 |

Then:
1. **Blockers:** broken access check, unpreviewed external write, data leak, wrong target on duplicate/learned name, or contract mismatch — each with `file:line` on both sides and the fix.
2. **Should fix:** stale cache key, double-fire race, missing lock, or rough deploy-reload edge.
3. **Notes:** live switch defaults to check before deploy, or open **TBC** items.
4. **Not traced:** anything skipped and why.
