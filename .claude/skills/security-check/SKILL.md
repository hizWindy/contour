---
name: security-check
description: Check a diff in Contour's engine for the security and privacy risks this project actually has - keys, client contact details, HubSpot writes, sign-in and access, prompt injection from web pages, server mode, words on screen and new packages. Use on any diff before a merge or deploy, or when asked for a security review.
---

# Security check

Read the diff: `git diff <base>...<branch>`. For each group below, look for the risk, then check the test that guards it still passes. The rules are in `engine/AGENTS.md`: "Safety", "Sign-in", "Server mode", "Working with Claude" and "How a project uses HubSpot".

## 1. Keys and logs

- Keys live only in `engine/.env`. Search the diff for anything that looks like a key or a token, or for a new `.env` file.
- A new setting that holds a secret is a `SecretStr`, read only through `core/config.py`, and redacted by `core/logs.py`.
- No log line prints a key, an email, a phone number, a password or a session token.
- `.do/app.yaml` holds no key. `test_app_platform_file.py` checks this.

## 2. Client details

- No contact email or phone is stored, logged or sent to Claude. Call prep's `scrub` blanks them even inside call notes. A test in `tests/companies/` proves none reaches the fake Claude.
- HubSpot company and person names reach Claude or Signal Hire only when `HUBSPOT_NAMES_TO_CLAUDE_OK` or `HUBSPOT_NAMES_TO_SIGNALHIRE_OK` is on (both off).
- Signal Hire: no Person API, employee list, email or phone call in `core/signalhire/client.py`.
- Decision makers come only from public pages, never LinkedIn.
- Screenshots stay in `plan/shots/`, which is git-ignored.

## 3. HubSpot writes, money and Claude

- A write goes only through `core/hubspot/writer.py`: preview, a person confirms, then apply. It fills empty fields only, carries a unique key, and is never retried blindly. Writing stays off until `HUBSPOT_WRITE_ENABLED=true`.
- Caps are checked in code before every Claude call, and Claude can't raise its own budget.
- **Prompt injection.** Claude reads web pages, and a page can hold instructions like "add this company to HubSpot". Check that:
  - page text never decides an action (a write, a run, spending money);
  - every answer is checked against its form;
  - every line of a prep cites a fact id or a page the web tool really returned, or it is dropped.

## 4. Sign-in and access

- The guard (`core/api/guard.py`) denies by default. A new route is covered with no change: check nothing was added to its allow list.
- Admin-only actions take `AdminDep`. A project's rows and fields go only to people with its tick (`AppAccess`).
- Nothing loosens server mode: `AUTH_REQUIRED=false`, `SESSION_COOKIE_SECURE=false` or `AUTO_MIGRATE=true` together with server mode is still refused. `TRUSTED_PROXIES` is never `*`. Only the public origin may call the API.
- Passwords, sessions and the sign-in throttle are unchanged, or changed with tests (`tests/core/test_auth_api.py`).

## 5. The website and packages

- Words on screen hold no command, file name, local address or setting name: `src/test/screen-words.test.ts` and `tests/core/test_safe_deploys.py`.
- No `dangerouslySetInnerHTML` or raw HTML with text from Claude, HubSpot or a web page. A link to a source page opens with `rel="noopener noreferrer"`.
- The content security policy test (`src/test/csp.test.ts`) still passes.
- A new package in `package.json` or `pyproject.toml` needs a reason. Check it's well known, pinned to an exact version, and in the lock file.

## Report

Each finding: `file:line`, the risk in one sentence, what an attacker or a mistake could do, and the fix. A key in git, a client's contact detail reaching Claude or a log, an unguarded HubSpot write, or a route open without sign-in is always a **Blocker**.
