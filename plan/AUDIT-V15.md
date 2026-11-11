# Audit before PLAN-V15: the exploratory test of 11 Nov

Every item from Al-khair's exploratory test can be built. Two are bigger than they look: a script that knows the relationship, and a fast sync cancel. The "racing" is mostly heavy work that blocks the server, plus 5 real races. The worst one left a HubSpot sync stuck after the 11 Nov deploy.

- **Last updated:** 2026-11-12.
- **What was checked:**
  - The code on `master` (ee47912). This is what production runs (deployed 11 Nov, 16:00 UTC).
  - The live backend log for 16:11 to 16:27 UTC on 11 Nov.
  - Three read-only code reviews.
- **Nothing was changed.** All paths below start at `engine/`. **TBC** means to be confirmed.

## What the live log shows

- **No server errors.** All 457 requests got a 200 or 202.
- **A sync was stuck as "running".**
  - The website asked for the sync status 354 times in 15 minutes, once every 2.5 seconds. It does that only while a sync shows "running".
  - The new backend made no HubSpot sync calls the whole time. The old backend stopped at 16:13:44.
  - So nothing was running the sync. The stuck row also blocks a new sync. Confirming this needs a look at the production database (**TBC**).
- **The sign-in check (`/auth/me`) ran only twice.** This fits the profile menu cause in part 4.
- **The log has no time per request.** We can't measure p95 (the time 95% of requests finish within) from it.
- **Two paid preps ran 90 seconds apart** (16:22:57 and 16:24:28). Whether they were for the same company is not known.

## 1. Backend speed and races

### Freezes: one heavy job makes every user wait

The backend has one worker loop, called the event loop. Heavy CPU work on it stalls every other request.

1. **HubSpot matching** loads all ~14,000 companies and their deals, then fuzzy-scores each one, on the event loop (`backend/core/hubspot/matching.py:427-442`). A run calls it up to 3 times per company (`steps/graph.py:296-308`, `research.py:690`, `research.py:999`). A 20-company run means 40 to 60 full loads.
   - **Fix:** cache the list per sync. Do the scoring in a thread, or with rapidfuzz `process.cdist`.
2. **The profile rebuild:**
   - The "Sync with HubSpot" button always sends a full sync (`frontend/src/apps/companies/hubspot-sync.tsx:149`). That re-embeds all ~14,000 profiles, even when nothing changed.
   - `EMBEDDING_THREADS` is not set in `.do/app.yaml`, on a 1 vCPU backend. ONNX may take every core it sees (**TBC**).
   - **Fix:** set `EMBEDDING_THREADS=1` and re-embed only profiles whose text changed. The button should send "auto".
3. **Re-embedding inside a web request** (`/hubspot/profiles/rebuild`, `/hubspot/import`). A second click waits on a lock with no time limit.
   - **Fix:** move this work to the background.

### Races: two things at once

1. **Two syncs can run at once.** `begin()` marks a sync stale 20 minutes after it started, whether or not it is still alive (`backend/core/hubspot/sync.py:78`, `157-168`, `191`). A full sync with people and profiles can take longer than 20 minutes. The first sync's last write can also flip "interrupted" back to "done".
   - **Fix:** a heartbeat column that each progress step updates. Call a sync stale only after ~5 minutes with no heartbeat. A backend that takes over at deploy also clears stuck rows. That fixes the stuck sync above.
2. **A full sync deletes companies written while it ran** (`sync.py:412-417`, `hubspot/writer.py:558-582`). Example: the sync reads HubSpot at 6:00. At 6:05 ABC Logistics is sent to HubSpot and added to our copy. When the sync saves, it deletes ABC Logistics, because it wasn't in the 6:00 read. It also overwrites newer rows with older data.
   - **Fix:** change or delete only rows saved before the sync started.
3. **Duplicate paid preps** (`backend/apps/companies/api_preps.py:207-257`). Nothing stops two clicks, or two people, from both starting a prep for one company. Each costs up to US$0.25. A prep running over 5 minutes is also missed by the "already running" check.
   - **Fix:** a unique index on (company, contact) while the prep is "searching". The second request then gets the running prep.
4. **Two first saves of a line edit or style note give a 500 error** (`backend/apps/companies/script_notes.py:115-139`, `221-236`). Two Admins can also go past the 8 team-note limit (`:266-268`).
   - **Fix:** use `INSERT ... ON CONFLICT`.
5. **The one-backend lock can be lost without notice** (`backend/core/runs/lifecycle.py:87-106`). If the database drops that connection, the backend keeps running runs without the lock. A later deploy then marks those runs interrupted, and a Resume pays twice.
   - **Fix:** check the lock connection every 30 seconds. Stop runs and the scheduler if the check fails.

### Deploys and limits

1. **Too many database connections during a deploy (TBC).** The old backend can hold 15 and the new one 11, which is 26. The database allows 22.
   - **Fix:** smaller pools, or DigitalOcean's connection pool.
2. **No database time limits** (`backend/core/db/engine.py:21-33`). A stuck query waits forever, then shows as a 500 error.
   - **Fix:** set `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout`.
3. **A busy answer from Claude (429 or 529) is never retried** (`backend/core/claude/client.py:134`). One busy answer fails the whole prep.
   - **Fix:** retry once or twice. These answers aren't billed.
   - Also, when a continued answer fails (`:240-248`), the first part's cost isn't counted, so the daily cap undercounts.
4. **A deploy kills running preps without logging their Claude spend** (`backend/core/api/app.py:47-54`).
   - **Fix:** stop them cleanly at shutdown.

**These looked safe:** starting a run, the daily cap, settings changes, the first Admin, a manual sync against the 6 am one, live run updates (SSE), and password checks.

## 2. HubSpot sync cancel

**Today a sync can't be cancelled.** There is no button and no API. Only a backend stop ends it.

**What happens to data today if a sync stops:**
- The companies, offices and deals save in one go. A stop before that save leaves our copy as it was.
- People, calls and profiles save later, on their own. A stop there leaves new companies with old people and old profiles.

**What a fast, clean cancel needs:**
1. **A cancel API** for Admins (`POST /hubspot/syncs/{id}/cancel`). It saves "cancel asked" on the sync, so it works even mid-deploy. Then it stops the job and waits up to ~5 seconds, like run cancel does (`backend/core/runs/manager.py:926-945`).
2. **A new status "cancelled".** This needs a migration, because the status list has a database check.
3. **One point of no return.**
   - Cancel before the main save, and nothing changes.
   - Cancel after it, and the new companies stay, people and profiles are skipped, and the sync is marked done with a note. The next sync rebuilds what was skipped.
4. **Smaller embedding batches,** about 64 instead of 512, with a cancel check between them. Today one batch must finish first.
5. **The screen:** a Stop button beside the progress, then "Stopping…". Also show progress for people and profiles. Today the bar sits at 95% through both.

The heartbeat from part 1 goes with this. Target: the sync stops within ~5 seconds of the click (**TBC**, measure it).

## 3. Call prep

### 3a. A tone picker

**Today:**
- The free script picks a tone line by itself: "Warm" for a customer, a past call or an open deal, otherwise "Light. A cold call" (`frontend/src/apps/companies/playbook.ts:309-337`).
- Claude's prompt has one tone rule (`backend/apps/companies/prep.py:181`). Claude's script then gets the free script's tone line, which may not match what Claude wrote (`use-guide.ts:63`).
- Your style (600 characters) and Team style (8 notes of 200 characters) reach Claude only, never the free script. With call prep off, they change nothing.

**Recommendation:**
- **Presets:** four tones, Friendly (the default), Direct, Consultative and Formal. Names **TBC**.
- **Storage:** each person's choice in a new small table. The team default goes in Admin Settings.
- **Order, where the last one wins on wording:** rules, then the relationship stage (3b), then the tone, then Team style, then Your style.
- **Free script:** a set of wording for each preset.
- **Claude:** the preset is the first line of the style block, and Claude returns its own tone line.
- **Reuse:** a ready prep is reused for 7 days only if the tone matches.

### 3b. A script that knows the relationship

**Today the opener says "We design and build offices." even when there's an open deal or the company is a customer** (`playbook.ts:375`, `402-406`).
- It skips the intro only when the last logged call was with the same person and was answered or got a voicemail (`playbook.ts:389-400`).
- Calls with a colleague, the company's "Last talk" and lost deals are ignored.
- Claude is told "say who you are and why you are calling" every time (`prep.py:173`). It isn't told when a company is a customer by its HubSpot lifecycle stage.

**Recommendation:** the backend works out one **relationship stage**. It goes to the website and to Claude, so the free script and Claude's script agree. The first match wins.

| Stage | When | Opener |
|---|---|---|
| Open deal | any open deal | No intro. "Following up on {deal}." The goal is its next step. |
| Customer | a won deal or HubSpot says Customer, and a talk in the last 12 months | No intro. "Hi Jason, it's Tom from Contour." Then check in. |
| Past customer | a customer with no talk for 12+ months | A short reminder: "We did your Perth fitout in 2023." |
| Lost deal | lost in the last 24 months | No intro. "Last time the timing wasn't right. What's changed?" |
| Contacted before | a call with anyone there, or a Last talk, in the last 24 months | "We spoke in March," or "I spoke with Sarah." |
| Cold | none of the above | Today's intro. |

- **Free and smart:** the free script follows this table, so it's free and works with call prep off. The paid script gets the stage as a fact plus one rule: "If not cold, don't introduce Contour." That covers the "use AI" part.
- **Data:**
  - Most of it is already in our copy: deals with state and stage, Last talk, calls, the lifecycle stage.
  - Adding a few company fields would sharpen it: last sales activity, the number of open deals, the last deal close date, the next activity date. The deal field "closed lost reason" also helps. Today's read access covers these, but the exact field names are **TBC**.
  - Logged emails and meetings would need a new HubSpot permission (**TBC**).
- **Limits:** 12 and 24 months are guesses (**TBC**).

### 3c. Call prep error messages

| Now | Problem |
|---|---|
| "…raise DAILY_CAP_USD in engine/.env and restart." | Written for the developer |
| "Claude returned an error (529). {raw message}" | Raw error text |
| "Can't reach Claude. Check the internet connection." | Misleading: it's the server's connection, not the user's |
| "Claude's answer didn't fit the call script form." | Jargon |
| "Contact details left out… because style notes go to Claude." | Wrong for line edits, which never go to Claude |

**Also:**
- The failed banner says both "Press Research again" and "Press Try again" (`prep-modal.tsx:445-446`).
- A failed status check may leave the card on "Researching..." for good (**TBC**).
- If Claude's lines are all removed for having no source, the card shows "Nothing sure enough to say first." It should fall back to the free script.

## 4. The profile menu disappears

**Most likely cause:** the sign-in check (`/auth/me`) fails once when the page loads, and never tries again.
- It is asked once, with no retry (`frontend/src/api/hooks/auth.ts:61-63`).
- If it fails, the app still shows (`frontend/src/shell/require-sign-in.tsx:56-69`).
- The menu hides unless the user is signed in (`frontend/src/shell/user-menu.tsx`).
- **To reproduce:** load a page while the backend restarts in a deploy, or on a network blip. The menu stays hidden until a reload. Every module also shows in the sidebar, even to people without access (`frontend/src/shell/visible-modules.ts:16-17`).

**Two smaller causes:**
- **It moved.** From 768px wide, the account sits only at the bottom of the left menu (PLAN-V13). On a tablet the menu starts folded, so the account is a 32px square of initials. `DESIGN.md:110` still says it's in the top bar.
- **On a phone, the top bar scrolls away.** It isn't sticky.

**Fix:** retry `/auth/me` on a network error or a 5xx. If it still fails, show the "Connection lost" page from part 5 instead of the app without a user.

## 5. Error messages and error pages

**Today the messages are written for the developer:**
- "Check that it is running (uv run engine serve)" (`frontend/src/api/client.ts:113-114`)
- "Start it with: docker compose up -d" (`backend/core/api/guard.py:53`)
- "Open the site at http://localhost:5173" (`client.ts:97`)
- A 500 error says "The details are in the backend log", with no reference to quote.

**Also missing:**
- No time limit on a request, so a hung call shows a loading skeleton forever (`client.ts:236-250`).
- No offline message.
- No request id: a number on each request that ties a user's report to a log line.
- No single place that handles errors for every page.

**Pages to add:**
1. **Connection lost or timed out.** A Try again button, and an automatic retry when the connection is back.
2. **Contour is updating.** For a 502 or 503 during a deploy: "Back in about a minute", with an automatic retry.
3. **Something went wrong.** For a 500, with a short reference code to send to Al-khair.
4. **No access (403) and Not found (404).** Each with a button to Home. Today's Not found offers "Start a run", which is odd for sales staff.
5. **New version.** After a deploy, an old page can't load its code. Reload once by itself, with the note "Contour was updated".

**One rule for every message:** say what happened, what it means for them, and what to do. Example: "Contour can't reach the server. Nothing you typed is lost. We'll try again in 10 seconds." Technical details go in a folded "Details for support", with the reference code.

**Where it plugs in:**
- **Request code:** a time limit of about 20 seconds (**TBC**), and an offline check.
- **One error handler for all pages,** in the query client.
- **The page frame and the router:** they choose which page to show.
- **The backend:** a request id on every log line and in every error.

## 6. What I'd add

1. **Request id and time per request in the log.** It measures p95 and links a user's report to the log line. This is the first step toward the production numbers we discussed (latency, error rate).
2. **Alerts** on restarts, memory and CPU in App Platform, plus an outside uptime check. Which alerts App Platform offers is **TBC**.
3. **Clear stuck syncs and preps** when a backend takes over at deploy (parts 1 and 2).
4. **A deploy test:** click through the site while a deploy runs, and check that no page breaks and no job is lost.
5. **A small load test before the sales team starts.** Example: k6 at 3x the expected users, watching p95 and errors.

## Suggested order for PLAN-V15

1. **Part A, the backend:** the freezes and races in part 1, and the request id. This is the "racing" fix.
2. **Part B, sync cancel:** the backend and the Stop button.
3. **Part C, errors:** the messages, the pages, and the `/auth/me` retry. The retry also fixes the profile menu.
4. **Part D, call prep:** the relationship stage first, then the tone presets.
5. **Part E, checks:** the deploy test, the load test, and one paid prompt test for the new script. The prompt test costs about US$0.75 to US$1.50, like PLAN-V14 T1-5 (**TBC**), and needs Al-khair's OK.

Parts A, C and D touch different files, so they could run as 3 tracks, like PLAN-V14. Part B touches the same sync files as A, so it goes after A or in the same track.

## Decisions for Al-khair

1. **The tone presets and the default.** Recommended: Friendly, Direct, Consultative, Formal, with Friendly as the default.
2. **The stage limits.** Recommended: 12 months for a recent customer talk, 24 months for a lost deal or a past contact.
3. **A cancel after the main save.** Recommended: keep the new companies and skip the rest.
4. **The Sync button.** Recommended: "auto" (it reads only changes, and everything once a week), not "full".
5. **The stuck sync in production.** It needs a read-only look at the production database to confirm, and then marking it interrupted.
