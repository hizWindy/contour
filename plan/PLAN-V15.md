# Speed, safety and clear errors: plan, version 15

This plan fixes what Al-khair found when he tested the live site on 11 Nov. The backend stops freezing and racing. A HubSpot sync can be stopped. Errors say what happened in plain words, and connection problems get their own pages. The call script knows when we already talk to a company, and each salesperson can pick a tone. Three Claude sessions build it at the same time, in one account, in three tracks that never touch the same files.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair, for the code and for every screen. Levi hasn't seen any of this (**TBC**, to be confirmed).
- **Last updated:** 2026-11-12 (written; nothing built yet).
- **Progress:** each track keeps its own count, at the top of its part. S0: 1 of 1. M1 to M3: 0 of 3.
- **Sources:** Al-khair's test notes (12 Nov chat), the audit [AUDIT-V15.md](AUDIT-V15.md) (file and line references for every finding), and the live backend log of 11 Nov.
- **Comes after:** [PLAN-V14.md](PLAN-V14.md) (merged into `master` and deployed: production runs ee47912). Call prep stays off until Al-khair switches it on. This plan doesn't switch it on.

## Go signals

Say one line to each session. The same line starts a track, and continues it later from the first step that isn't ticked. Saying a go signal counts as Al-khair's word for S0.

| Session | Say | What it does |
|---|---|---|
| Session 1 | `implement v15 track1` | The backend: request ids, the sync heartbeat and cancel, no more freezes, safe deploys |
| Session 2 | `implement v15 track2` | The website: timeouts, plain error words, error pages, the profile menu, the sync Stop button |
| Session 3 | `implement v15 track3` | Call prep: its races, the relationship stage, tone presets, its error words |
| Any one | `merge v15` | Joins the three tracks into `plan-v15`, checks everything, then moves `master` to it |
| Any one | `deploy v15` | Pushes `master`, deploys to App Platform, and checks the live site during and after |

You'll also answer things along the way:
- **Track 2 stops at T2-6** until the tag `v15-api` exists (Track 1, T1-3). Track 1 sends a message when it does. Then say `implement v15 track2` again if Track 2 didn't carry on by itself.
- **Each screen waits for your look.** The track marks it "built, waiting for a look" and carries on.
- **The 5 recommended choices** in "Choices made for you" stand unless you change them before that step starts.

## In short

| Al-khair asked (12 Nov) | Track | Step |
|---|---|---|
| Better backend performance, and fix the racing | 1, 3 | T1-2 to T1-6, T3-2 |
| Cancel a HubSpot sync, quickly and cleanly | 1, 2 | T1-3, T2-6 |
| A tone the salesperson picks, with a default | 3 | T3-5, T3-6 |
| The profile menu disappears sometimes | 2 | T2-2, T2-5 |
| A script that doesn't introduce Contour when we already talk | 3 | T3-3, T3-4 |
| Clear error messages, for Al-khair and the users | 1, 2, 3 | T1-6, T2-3, T3-7 |
| A page for connection timeouts and other errors | 2 | T2-4 |

**Added by the audit:**
- A request id, a time for each request and an event-loop lag warning in the log, so p95 and errors can be measured (T1-2, T1-7).
- A load test before the sales team starts (T1-7, M1).
- A test of the site during a deploy (M3).
- Alerts for CPU, memory, restarts and failed deploys (T1-6).

**What stays the same:**
- The Lead Finder's rules and scoring.
- The call prep limits: US$0.25 for each prep, 3 web searches, reuse of a ready prep for 7 days, and the US$150 daily limit.
- The edit layers from PLAN-V14 (line edits, Your style, Team style).
- Who can open what (the access ticks).
- HubSpot stays read only.

**What it costs:**
- **To build:** nothing but time. Every check runs with no Claude key, or with test data. A full HubSpot sync on a track's database is free, because reading HubSpot is free.
- **To run:** nothing new. The relationship stage and the tone add a few lines to Claude's prompt (under US$0.001 for each prep). Claude retries after a busy answer cost nothing, because a busy answer isn't billed.
- **One optional paid check:** 6 preps with the new prompt, one per relationship stage, at most US$1.50 (6 × the US$0.25 cap). Only on Al-khair's word (T3-3).

## Words used here

- **Track:** one session's share of the work, on its own branch and in its own copy of the repo.
- **Event loop:** the backend's one worker that answers every request. Heavy work on it makes everyone wait.
- **Heartbeat:** a time a running sync writes every few seconds, to show it is still alive.
- **Request id:** a short code on every request, like `7F3K92QD`. It ties what a user saw to a line in the log.
- **Relationship stage:** where we stand with a company: open deal, customer, past customer, lost deal, contacted before, or cold.
- **Tone preset:** one of four ways a script sounds: Friendly, Direct, Consultative or Formal.

## Choices made for you

These are the audit's recommendations. They stand unless Al-khair changes them before the step starts.

1. **Tone presets:** Friendly, Direct, Consultative and Formal. Friendly is the default (T3-5).
2. **Stage limits:** a customer is "recent" with a talk in the last 12 months. A lost deal or a past contact counts for 24 months (T3-3). Both numbers sit in one place, so they're easy to change.
3. **Stopping a sync after the main save:** keep the new companies, skip people and profiles, and let the next sync rebuild them (T1-3).
4. **The "Sync with HubSpot" button sends "auto"**, not "full". Auto reads only what changed, and everything once a week. The Admin page keeps a "Full copy" button (T2-6).
5. **A tone change never spends money by itself.** A ready prep written in another tone shows a hint to press Research again (T3-5).

## Words for errors

Every track uses these words, so the site speaks with one voice. The rule: say what happened, what it means for them, and what to do. Technical details go in a folded "Details for support" part, with the request id. The wording is Al-khair's to change at his look.

| When | Title | Then |
|---|---|---|
| Offline | You're offline | Contour will carry on when your connection is back. |
| No answer in time | Contour took too long to answer | Nothing was lost. Try again. |
| Can't reach the server | Contour can't reach its server | We'll try again in 10 seconds. |
| Deploy (502, 503 or 504) | Contour is updating | It'll be back in about a minute. This page will reload by itself. |
| Too busy (503 `busy`) | Contour is busy | Try again in a few seconds. |
| Server fault (500) | Something went wrong on our side | Try again. If it happens again, send this code to an admin: {code}. |
| No access (403) | This page isn't open to you | Ask an admin if you need it. |
| Not found (404) | We can't find that | It may have moved or been removed. |
| Bad fields (422) | Some fields need a fix | Then each field in plain words, like "Name: fill this in". |
| New version | Contour was updated | Reloading… |
| Claude busy | Claude is busy right now | Try again in a minute. |
| The server can't reach Claude | Our server can't reach Claude | Try again in a few minutes. |
| Claude's daily limit | Call prep has reached today's limit | It starts again tomorrow. An admin can raise the limit. |
| Claude key problem | Claude isn't set up correctly | An admin needs to check the Claude key. |

**Never on screen:** a command (`uv run engine serve`, `docker compose up -d`), a file name (`engine/.env`), a local address (`localhost:5173`), or a raw error from a library. These go to the log, under the request id.

## How the tracks talk

- **At the start,** each session names itself "V15 Track 1", "V15 Track 2" or "V15 Track 3", if it has a tool for that. If not, it asks Al-khair to rename it in the sidebar.
- **To send news,** a session finds the others with `ListAgents` and writes with `SendMessage`. Send a message when:
  - a tag is made;
  - a track needs a change in another track's files;
  - the contract looks wrong.
- **A message is news, never a go-ahead.** Merging, pushing, deploying, switching call prep on and spending money happen only on Al-khair's own words in his own session.
- **Waiting:** a track that must wait ends its turn with "Waiting for the tag `v15-api` (T1-3)". When the message comes, it carries on. If it doesn't wake up by itself (not confirmed), Al-khair says the go signal again.
- **The record is git and this plan, not the messages.** A tag either exists or it doesn't. Each track also writes what it sent in its Log. A lost message loses nothing.
- **Only one waiting point:** T2-6 waits for `v15-api`. T3-7 merges `v15-api` if it exists, and skips that part if it doesn't. Nothing else waits.

## How to work this plan

**Who owns which files.** Nothing collides if each track only changes its own files.

| Files | Owner |
|---|---|
| `engine/backend/core/`, `engine/backend/apps/lead_finder/`, `engine/scripts/`, `.do/app.yaml`, migration `0016` | Track 1 |
| `engine/backend/tests/` except `tests/companies/` | Track 1, but Track 3 adds its new table to the 4 table lists (below) |
| `engine/frontend/src/` except `src/apps/companies/` and `src/api/hooks/{companies,script}.ts`; plus `src/apps/companies/hubspot-sync.tsx` and a new `hubspot-sync.test.tsx` beside it; plus `engine/DESIGN.md` | Track 2 |
| `engine/backend/apps/companies/`, `engine/backend/tests/companies/`, migration `0017` | Track 3 |
| `engine/frontend/src/apps/companies/` except `hubspot-sync.tsx`; `src/api/hooks/companies.ts` and `src/api/hooks/script.ts` | Track 3 |
| `engine/frontend/openapi.json`, `engine/frontend/src/api/schema.d.ts` | Generated. Any track runs `engine openapi` and `npm run types`. Never edit them by hand. At a merge conflict, run them again. |
| `plan/PLAN-V15.md` | Each track edits only its own part (its steps, its Progress line, its Log) |
| `engine/AGENTS.md`, `projects/prep/PREP.md`, `CLAUDE.md` | M1 only |

- **Track 3's table lists:** its new table `companies.script_prefs` goes into `TEST_TABLES` (`tests/conftest.py`), `fill_every_table` (`tests/core/test_fixtures.py`), and the `TRUNCATE` lines in `tests/core/test_first_admin.py` and `tests/core/test_auth_admin.py`. Track 1 adds no table, so these lines don't clash.
- **The sync tests** sit in `src/apps/companies/companies.test.tsx` today (Track 3's file), and one checks that the button sends "full". In T2-6, Track 2 moves only the "Sync with HubSpot" tests into its new `hubspot-sync.test.tsx`, with its own copy of their test helpers. It changes nothing else in `companies.test.tsx`, and Track 3 doesn't touch those tests.
- **Type names:** Track 3 keeps any new hand-written type names in its own hook files, not in `src/api/types.ts` (Track 2's).
- **`tests/core/test_contract_routes.py`** lists every route. Tracks 1 and 3 both add lines there. Expect a small conflict at M1: keep both sides.
- **The migrations:** Track 1 writes `0016_sync_cancel` after `0015_script_notes`. Track 3 writes `0017_call_prep`, also after `0015_script_notes` in its own branch. At M1, one line in `0017` changes its `down_revision` to `0016_sync_cancel`.
- **No track changes another's files.** If one needs a change there, it sends a message to the owner and writes the request in its Log, then carries on.
- **No new packages.** A new package changes `package-lock.json` or `uv.lock`, which all three tracks would clash on.
- **The contract (below) is fixed.** Track 2 builds against it with `mockApi` until the `v15-api` tag. If a track finds the contract wrong, it stops and tells Al-khair.

**Branches and copies.**
- The base is `plan-v15`, made from `master` (see S0).
- Track 1: `git worktree add ../contour-v15-t1 -b plan-v15-track1 plan-v15`.
- Track 2: `git worktree add ../contour-v15-t2 -b plan-v15-track2 plan-v15`.
- Track 3: `git worktree add ../contour-v15-t3 -b plan-v15-track3 plan-v15`.
- Work in your own copy. If it already exists, go there and carry on.
- In a new copy:
  - Run `npm ci` in `engine/frontend` once.
  - Copy `projects/leads/research/COMPANIES.xlsx` from the main folder. It is kept off GitHub, and `test_profiles.py` needs it.

**Ports and databases.** Each track runs its own backend and website. Ports 8000 to 8023 and 5173 to 5193 are taken by the running app and older previews.

| | Backend | Website | Database | Test database suffix |
|---|---|---|---|---|
| Track 1 | `API_PORT=8031` | `npm run dev -- --port 5201 --strictPort` with `API_PROXY_TARGET=http://127.0.0.1:8031` | `leadfinder_v15a` | `LEADFINDER_TEST_DB_SUFFIX=_v15a` |
| Track 2 | `API_PORT=8032` | port 5202, proxy to 8032 | `leadfinder_v15b` | `_v15b` |
| Track 3 | `API_PORT=8033` | port 5203, proxy to 8033 | `leadfinder_v15c` | `_v15c` |

- **The track's `engine/.env`** holds the `POSTGRES_*` lines only, with `POSTGRES_DB` set to the track's database. **Never put `API_PORT` or `CORS_ORIGINS` in it:** the backend tests read that file, and 8 of them fail when `CORS_ORIGINS` names a track port (found in T1-1). Pass both as environment variables only when starting the track's backend, like `API_PORT=8031 CORS_ORIGINS='["http://localhost:5201"]'`.
- **Make each database once,** as a copy of `leadfinder_v14a` (at migration 0015) with `pg_dump` and `pg_restore`. If the HNSW index `ix_memory_embedding` fails in the restore, build it again with `max_parallel_maintenance_workers=0`.
- **Keys:** a track backend starts with **no Claude key**. Only Track 1 loads the HubSpot key, and only for the free full sync in T1-6. Read the key from the main folder's `engine/.env` into the process only. Never print it, and never write it to a file.
- **After merging `v15-api`,** Track 2 runs `uv run engine migrate` on its database (migration 0016), then `npm run types`.
- Leave ports 8000 and 5173 alone: the running app uses them. Start a backend only for a browser check, and stop it after.

**Every session.**
- **At the start:** read this section, go to the track's worktree, find the first step that isn't ticked, and run `brain context`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks. Its lock is shared by all three tracks.
- **Windows Application Control** blocks a new venv's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest`, and `python -c "from core.cli import main; ..."` for `engine` commands.
- **Commits:** make small ones, and run `git branch --show-current` before each.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the track's Progress line and add a line to the track's Log.
- **A step that waits on Al-khair** is marked "built, waiting for a look", and the track goes on to the next step.
- **Only on Al-khair's word:** merging, pushing, deploying, switching call prep on, stopping a process this plan didn't start, or anything that costs money.
- **Screens:** follow `engine/DESIGN.md`. Check each at 1440px, 1280px and 390px (a phone), in light and dark, with the keyboard, and with reduced motion. Screenshots go in `plan/shots/v15-t<number>/`. They are git-ignored, because they can show a real HubSpot client.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step. All three sessions share one account's limits, so they reach this point about three times faster.

## Before the tracks start

- [x] **S0. The base branch.** Done 2026-11-12 by Track 1, on Al-khair's go signal: `plan-v15` made from `master` (ee47912), with this plan, the audit and the `CLAUDE.md` go signals as its first commit, made in the Track 1 worktree, so the main folder stayed on `master`. Done by the first session to start. The others check `git branch --list plan-v15`. If it's missing, they stop and say "Waiting for the base branch (S0)".
  - Make `plan-v15` from `master` (ee47912). Its first commit holds this plan, `plan/AUDIT-V15.md` and the `CLAUDE.md` go signals. All three sit uncommitted in the main folder: copy them from there.
  - Don't switch the main folder's branch (the running app uses it). Use a temporary worktree, commit there, then remove it.
  - Leave `plan/PLAN-V1.md` alone: it holds Al-khair's own uncommitted edit.
  - Older previews still run (ports 8011, 8021, 8023, 5181 to 5183, 5190, 5191 and 5193). Tell Al-khair that stopping them frees memory for the tracks. Stop them only on his word.
  - **Done when:** `git branch --list plan-v15` shows it, and it holds `plan/PLAN-V15.md`.

## The contract

Track 1 builds parts 1 to 3. Track 2 reads them. Track 3 builds and reads part 4 by itself.

**1. Request ids (T1-2).**
- Every response has the header `X-Request-ID`: an 8-character code like `7F3K92QD`, from letters and digits with no look-alikes, so a person can read it out. The backend always makes its own. A safe id the edge sends (up to 64 letters, digits and dashes) only goes in the log, as `edge_request_id`: it can be 36 characters, too long to read out (changed in T1-2).
- Every error body (`ProblemDetails`) gains `request_id`, the same code.
- Every log line made during the request carries `request_id`.

**2. Errors (T1-6).**
- A 503 always has a `Retry-After` header in seconds.
- New 503 code `busy`: the database had no free connection in time. `Retry-After: 5`.
- The existing "starting" and "runs restarting" 503s keep their codes and gain `Retry-After`.
- Titles and details follow "Words for errors". A 500 reads "Something went wrong on our side", with the request id.

**3. Sync cancel (T1-3).** `SyncOut` gains:

| Field | What it is |
|---|---|
| `phase` | `reading`, `saving`, `people` or `profiles` while it runs; null when it's finished |
| `heartbeat_at` | the last time the sync showed it was alive |
| `cancel_requested_at` | when someone pressed Stop, or null |
| `people_saved` | progress counter for the people phase |
| `profiles_done`, `profiles_total` | progress counters for the profiles phase |
| `status` | gains `cancelled` |
| `profiles_skipped` | (added in T1-3) the companies were saved but their profiles weren't rebuilt; the next sync rebuilds them all |

- **`POST /api/v1/hubspot/syncs/{id}/cancel`**, for whoever may start a sync.
  - It answers 202 with the `SyncOut`.
  - A sync that already finished gets 409 `not_running`. An unknown id gets 404.
- **When it stops:**
  - **Before the main save:** status `cancelled`, warning "Stopped. Our copy didn't change."
  - **After it:** status `cancelled`, warning "Stopped after saving companies. People and profiles update with the next sync."
- The hook goes in `src/api/hooks/hubspot.ts` (Track 2): `useCancelHubSpotSync`.

**4. Call prep (Track 3 only).**
- **`CompanyDetail` gains `relationship`:** `{stage, since, reason, source}`.
  - `stage` is one of `open_deal`, `customer`, `past_customer`, `lost_deal`, `contacted`, `cold`.
  - `since` is a date or null.
  - `reason` is one plain sentence, like "Open deal: Perth fitout, at Proposal".
  - `source` is like "HubSpot deal" or "HubSpot call, 3 Mar 2026".
- **`GET /api/v1/companies/script-style` gains `tone`:** `{mine, team, choices}`.
  - `mine` is the person's tone, or null to follow the team.
  - `team` is the team's default.
  - `choices` is the four presets.
- **`PUT /script-style/tone`** saves the person's tone (or null).
- **`PUT /script-style/team-tone`** is for an Admin only, and saves the team default.
- Both answer with the whole style, like the other style routes.
- **A prep gains `tone_used` and `stage_used`,** kept in its `facts` (no migration).
- **Claude's answer form gains `tone_line`.**

## Track 1: the backend (session 1)

**Progress:** 7 of 8 steps done (T1-1 to T1-7).

- [x] **T1-1. Own copy and a baseline.** Done 2026-11-12 (counts in the Log).
  - The worktree, the `leadfinder_v15a` database and the ports (see "How to work this plan").
  - Run the backend tests once with `heavy.sh` and `RUN_GATES=1`, and note the counts.
  - **Done when:** the counts are in the Track 1 Log.
- [x] **T1-2. Request id, time per request, and loop lag.** Done 2026-11-12 (see the Log).
  - **The request id:** a middleware in a new `core/api/request_id.py`, kept in a context variable. It goes on every log line (`core/logs.py`), the response header and the error body (`core/api/errors.py`).
  - **The request log:** one `request_done` line per request, with the request id, the method, the route pattern (like `/companies/{key}`, never the real path), the status and the time in ms. Turn off uvicorn's own access log in `serve` (`core/cli.py`), so lines aren't doubled.
  - **Loop lag:** a small task measures how late the event loop wakes up, every second. It logs `loop_lag` with the ms when it's over 250 ms (**TBC**).
  - **Files:** `core/api/request_id.py` (new), `core/api/app.py`, `core/api/errors.py`, `core/logs.py`, `core/cli.py`, tests.
  - **Done when:** tests prove these, and `engine openapi` and `npm run types` have run:
    - every response has the header;
    - an error body and its log line have the same id;
    - a test route that blocks for 0.5 seconds makes a `loop_lag` line;
    - the access log isn't doubled.
- [x] **T1-3. The sync heartbeat and cancel, then the tag `v15-api`.** Done 2026-11-12 (see the Log).
  - **Migration `0016_sync_cancel`** on `core.hubspot_syncs`:
    - `heartbeat_at`, `cancel_requested_at`, `phase` and the 3 counters;
    - the status `cancelled`, which changes the check constraint (keep the rule that a running row has no `finished_at`).
  - **Heartbeat:** written at least every 15 seconds and at each phase change, including between embedding batches.
  - **Stale:** a running sync is stale when its heartbeat is over 2 minutes old, or when it has no heartbeat and started over 2 minutes ago. That catches the sync stuck in production today. `STALE_MINUTES` (20, counted from the start) goes.
  - **When stale rows are marked:** at backend start and when this backend takes the run engine, not only when a new sync starts.
  - **`SyncRunner`** keeps one task for each sync id and never overwrites one. `stop()` stops them all.
  - **Cancel:** the route in the contract.
    - It saves `cancel_requested_at`, then stops the task if this backend runs it, and waits up to 5 seconds, like `RunManager.cancel` does.
    - A sync on another backend (during a deploy) sees the flag at its next heartbeat.
    - Before the main save commits, a cancel rolls the save back. After it, people and profiles are skipped. The next sync rebuilds the profiles of companies saved since the stopped sync started.
  - **Embedding batches** drop from 512 to 64 texts, with a cancel check between batches.
  - **Files:** `core/hubspot/sync.py`, `core/hubspot/models.py`, `core/api/hubspot.py`, `core/memory/service.py`, the migration, tests, `engine/openapi.json`, `src/api/schema.d.ts`.
  - **Done when:** tests prove each of these, and the migration runs up and down:
    - a cancel while reading ends as `cancelled` within 5 seconds, with our copy unchanged;
    - a cancel while rebuilding profiles keeps the companies, and the next sync rebuilds the skipped profiles;
    - a sync with a fresh heartbeat is never marked stale, even after 20 minutes;
    - a row with no heartbeat that started long ago is marked interrupted at start;
    - two syncs never run at once.
  - Then tag `v15-api`, send "API ready" to V15 Track 2, and add it to the Track 1 Log.
- [x] **T1-4. No more freezes.** Done 2026-11-12 (see the Log).
  - **Matching** (`core/hubspot/matching.py:427-442`):
    - Load the companies and deals once, and keep them until our copy changes. The key is the newest `imported_at` and the row count.
    - Do the fuzzy scoring in a thread (`asyncio.to_thread`), with rapidfuzz's batch functions.
    - Results must stay exactly the same: the existing matching tests don't change.
  - **Embeddings:**
    - Set `EMBEDDING_THREADS=1` in `.do/app.yaml`.
    - A profile is embedded again only when its text changed.
  - **Rebuild and import routes** (`/hubspot/profiles/rebuild`, `/hubspot/import`): a second request gets 409 `rebuild_running` at once, instead of waiting on the lock.
  - **Measure it:** a script `engine/scripts/lag_check.py` runs 20 matches at once on `leadfinder_v15a` (about 14,000 companies) and reports the worst loop lag. Run it before and after.
  - **Files:** `core/hubspot/matching.py`, `core/memory/`, `core/api/hubspot.py`, `.do/app.yaml`, `scripts/lag_check.py`, tests.
  - **Done when:**
    - the matching tests pass unchanged;
    - the worst loop lag during 20 matches drops below 100 ms (**TBC**), with the before and after numbers in the Log;
    - a rebuild with unchanged texts embeds nothing.
- [x] **T1-5. A sync never removes newer data.** Done 2026-11-12 (see the Log).
  - A full sync deletes or updates only companies, offices and deals saved before it started (`imported_at` older than the sync's `started_at`).
  - **Example:** the sync reads HubSpot at 6:00. At 6:05 ABC Logistics is sent to HubSpot and saved to our copy. The 6:00 sync's save now keeps it.
  - **Files:** `core/hubspot/sync.py`, `core/hubspot/writer.py` if needed, tests.
  - **Done when:** a test with a company saved during the sync keeps it, with its newer fields.
- [x] **T1-6. Safe deploys and limits.** Done 2026-11-12 (see the Log).
  - **The one-backend lock:**
    - Check its connection every 30 seconds.
    - If the check fails, stop the run engine and the scheduler, log `run_engine_lost`, and try to take the lock again every 30 seconds.
  - **Database connections:**
    - Pools in `.do/app.yaml` so one backend uses at most 9, counting the main pool, the checkpoint pool and the lock. Two backends during a deploy then stay under the database's limit.
    - The limit (22 by the audit) is **TBC**: Al-khair can check it with `SHOW max_connections`.
  - **Database time limits** (`core/db/engine.py`):
    - `statement_timeout` 30 s, `lock_timeout` 10 s, `idle_in_transaction_session_timeout` 60 s. The numbers are **TBC**.
    - The sync's save sets a longer limit for itself (10 minutes).
    - A pool wait that runs out becomes 503 `busy`, not a 500.
  - **Claude** (`core/claude/client.py`):
    - Retry a 429 or 529 at most twice, after the time in `retry-after`.
    - Count the cost of every part of a continued answer as it arrives, so the daily cap never undercounts.
  - **Plain words** from "Words for errors" in `core/api/guard.py`, `core/api/errors.py`, `core/claude/client.py` and `core/claude/daily.py`. The technical details go to the log.
  - **App shutdown hook:**
    - `AppSpec` gains an optional `on_shutdown`, which the lifespan in `core/api/app.py` calls for each app.
    - Track 3 uses it for preps in T3-7.
  - **Alerts** in `.do/app.yaml`:
    - CPU over 80% for 5 minutes, memory over 80%, more than 2 restarts in 5 minutes, and a failed deploy.
    - Where alerts are sent (the DigitalOcean account's email) is **TBC**.
  - **One real sync:** load the HubSpot key into the Track 1 backend (free, read only), and run one full sync on `leadfinder_v15a`. Press cancel once while it reads and once while it rebuilds profiles. This checks the time limits and the cancel for real.
  - **Files:** `core/runs/lifecycle.py`, `core/db/engine.py`, `core/api/`, `core/claude/`, `core/apps.py`, `.do/app.yaml`, tests.
  - **Done when:**
    - tests prove the lock check, the 503 `busy` with `Retry-After`, the Claude retry and the cost count;
    - no screen text holds a command, a file name or a local address;
    - the real sync finished and was cancelled twice, with the times in the Log.
- [x] **T1-7. Tools to measure.** Done 2026-11-12 (see the Log).
  - `engine/scripts/live_log.py`: downloads the live backend log from DigitalOcean with `DO_API_KEY` (read from `engine/.env` into the process only, never printed) into a file.
  - `engine/scripts/log_stats.py` reads a log file and prints:
    - for each route: the count, p50, p95 and p99 (the times that half, 95% and 99% of requests finish within);
    - the 5xx rate;
    - the `loop_lag` lines.
  - `engine/scripts/load.py`: N pretend users ask the common pages for T seconds, then it prints the same numbers. It runs only against `localhost`, unless `--allow-remote` is given on Al-khair's word.
  - **Run it:** 10 users for 2 minutes on the Track 1 backend. Note the numbers.
  - **Targets:** p95 under 300 ms for the read pages, no 5xx, and no `loop_lag` over 250 ms. All three are **TBC**.
  - **Done when:** the three scripts have tests, and the load numbers are in the Log.
- [ ] **T1-8. Track 1 check.**
  - Backend tests with `RUN_GATES=1`, lint, types, `engine openapi` and `npm run types` (nothing should change).
  - **Done when:** all pass, and Track 1 is marked ready to merge in its Log.

### Track 1 Log

Newest first.

- 2026-11-12: **T1-7 done** (feed711). `scripts/log_stats.py`, `scripts/load.py` and `scripts/live_log.py`, 9 tests in `tests/core/test_measure_scripts.py`. `live_log.py` was tried once on the live app (read only): 491 lines, the same as 11 Nov; it has uvicorn's lines only (no `request_done` until this is deployed), so it gives the error rate but no times. **The load test** on the Track 1 backend (port 8031, `leadfinder_v15a`, no keys, the laptop's default pool of 10): 10 users for 120 s, 5,381 requests, 44.8 a second, **0 server errors, 0 503s**; p50 148 ms, **p95 658 ms**, p99 952 ms. By page (p95): `auth/me` 108, `health` 121, `hubspot/syncs` 152, `companies` 429, `runs` 445, `lead-finder/leads` 465, `lead-finder/leads/facets` 782, `companies/facets` 991 ms. Two `loop_lag` lines (266 and 282 ms) in the 120 s. **Against the targets (TBC): no 5xx is met; p95 under 300 ms is met for the small reads but not overall, and not under this load.** The load is far above real use (45 requests a second, every user asking again at once, the load test on the same laptop as the backend). The facet counts are the slowest and the likely cause of the two lags: `companies/facets` is Track 3's file, `lead-finder/leads/facets` mine. Not changed here (not in this plan); a follow-up: measure them on the live site once `request_done` lines exist, and cache or move their counting off the loop if they stay slow.
- 2026-11-12: **T1-6 done** (code 4410cd2). **503s:** every 503 carries `Retry-After` (10 s unless the error names its own, in `problem()`); a pool that stays busy (`sqlalchemy.exc.TimeoutError`) is a 503 `busy`, "Contour is busy", `Retry-After: 5`. **Database limits:** each app connection starts with `statement_timeout` 30 s, `lock_timeout` 10 s and `idle_in_transaction_session_timeout` 10 minutes (new settings `DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`; the plan said 60 s for the last, but a request can wait on Claude inside an open transaction, so 10 minutes, **TBC**); the sync's save sets 10 minutes for itself, and a profile rebuild 10 minutes with no lock limit. **The lock:** `BackendLock.still_held` asks the lock's connection; `watch_lock` checks it every 30 s, and a lost lock logs `run_engine_lost`, stops the scheduler and the run engine (runs end interrupted, resumable) and takes it back with `take_over_later`, as after a deploy (`lifecycle.when_engine_is_lost`, set in the lifespan). **Claude:** a 429 or 529 is tried twice more after its `retry-after` (5 s if none, 20 s at most); any other error is never sent again; when a later part of a paused turn fails, the parts already answered are noted against the daily cap. **Plain words:** Claude's errors ("Claude is busy right now", "Claude isn't set up yet", "Our server can't reach Claude", "Today's Claude limit is reached", numbers to the log), the database-down 503 ("Contour can't reach its database"), HubSpot not connected, the key refusals (HubSpot, Signal Hire, email), the names-not-approved run message, and every 422 ("Some fields need a fix", "Look at the fields listed."). A test scans every error a person can see in `core/` and `apps/lead_finder/` for commands, file names, local addresses and setting names. Two are left on purpose: the laptop-only host check, and the Settings page's "ceiling in engine/.env" text, which the website's own check repeats (`round-plan.ts`, Track 2's): for M1. **`AppSpec.on_shutdown`**, called by the lifespan (`stop_apps`) before the pool closes; Track 3 was told. **App Platform:** `DB_POOL_SIZE` 4 and `DB_MAX_OVERFLOW` 0, so 9 connections per backend and 19 during a deploy with the migration step (the test checks it); CPU over 80%, memory over 80% and more than 2 restarts in 5 minutes alert the account (who gets them is **TBC**). Track 3 was told about the hook and the new Claude words; Track 2 wasn't reachable by message, so here is its note: every 503 has `Retry-After`, the 503 `busy` above, and the new 422 and database-down words. 9 tests in `tests/core/test_safe_deploys.py`, 5 in `test_claude_daily.py`; the tests that pinned old words now check the plain ones. **The real sync** (`leadfinder_v15a`, the HubSpot key in the process only, free): a Stop while reading (1,000 companies read) ended in 0.07 s with our copy unchanged; with the copy's profiles removed first, a Stop while rebuilding profiles (64 of 13,887 done) ended in 0.04 s, the 13,915 companies kept and `profiles_skipped` set; the next full sync ran to the end in 1,599 s (13,915 companies, 8,046 deals, 0 contacts and calls because the key can't read them yet, all 13,887 profiles embedded on one thread, as on App Platform), with no time-limit error. Embedding all ~14,000 on one thread took about 23 minutes; since T1-4 a sync embeds only changed texts, so that only happens when the profiles are gone. Checks: 1,956 passed, 25 skipped in `tests/core`, the gates and the Lead Finder run tests.
- 2026-11-12: **T1-5 done.** `begin` reads the sync's `started_at` (the database's clock) into `SyncPlan`, and `save_snapshot` passes it on: companies and deals are upserted only where our copy's row was saved before it (`saved_before`, an `ON CONFLICT ... DO UPDATE ... WHERE imported_at < started_at`, with `RETURNING` the ids it wrote), offices are replaced only for the companies it wrote, and a full sync deletes only rows saved before it started. `upsert_company_rows` is new in `core/hubspot/service.py`; `upsert_companies` keeps its shape for the export import and the writer, which save as before. `companies_saved` and `deals_saved` now count what was written. 2 tests in `tests/core/test_hubspot_sync_newer.py`: the ABC Logistics example (a company and a deal saved mid-sync are kept, a newer rename and its offices aren't overwritten), and a company gone from HubSpot before the sync is still removed. 64 passed in the sync, import, writer and matching tests.
- 2026-11-12: **T1-4 done.** **Matching** (`core/hubspot/matching.py`): our copy is loaded once as small plain records (no ORM objects), with every company name's and deal lead's cleaned forms made up front, and kept until it changes (its counts, newest `imported_at` or database move); one lock per event loop, so 20 calls after a change load it once. Checks 4 and 5 use one rapidfuzz `process.extract` per wanted form (the same `token_set_ratio`, in C++), then the same core-word guard on the few that pass, in a thread. **Same answers:** 0 differences against the old pair-by-pair code on 300 names (150 company names, 100 deal leads, 25 with a slip, 25 with extra words) over the real 13,887 companies, and the 83 matching tests and 1,705 matching plus Lead Finder tests pass unchanged. **Before and after** (`scripts/lag_check.py`, 20 matches at once on `leadfinder_v15a`, 13,915 companies): 19.3 s with the event loop blocked up to 1,084 ms; then 1.0 s and 0.9 s with the worst block 37 ms and 68 ms (p95 21 ms and 6 ms). The scoring alone: 97.4 s for 300 names before, 9.6 s after. **Embeddings:** `EMBEDDING_THREADS=1` in `.do/app.yaml`; a rebuild (`rebuild_profiles`, now through `replace_changed_items` in `core/memory/service.py`) embeds only new or changed texts, and an unchanged one keeps its item and embedding (its meta is updated in place if it changed). A full sync with nothing changed now embeds nothing (it embedded all ~14,000 before). **Rebuild and import routes:** a second request gets 409 `rebuild_running` at once (`pg_try_advisory_xact_lock`); the sync still waits its turn. Two tests changed on purpose: `test_profiles.py` (a second rebuild keeps the same items) and the T1-3 cancel test (it adds a new company, so the stopped rebuild has something to embed). 6 new tests in `tests/core/test_matching_speed.py`.
- 2026-11-12: **T1-3 done, then the tag `v15-api`.** Migration `0016_sync_cancel` on `core.hubspot_syncs`: `heartbeat_at`, `cancel_requested_at`, `phase` (with a check), `people_saved`, `profiles_done`, `profiles_total`, `profiles_skipped`, and the status `cancelled`; it runs up and down (`test_migrations.py`), and `leadfinder_v15a` is at 0016. In `core/hubspot/sync.py`: a heartbeat task beside each run writes `heartbeat_at` every 10 s and reads `cancel_requested_at`; a Stop it sees (asked on the other backend, or for a command's sync) ends the run normally with the cancelled row. A row is left over only after 2 minutes with no heartbeat (or, with none, since its start), so a long sync is never cleared; `STALE_MINUTES` is gone. Left-over rows are cleared when a sync starts, at backend start and at take-over (`connection.start_up`, only when HubSpot is set up, so a test backend never touches the database). `SyncRunner` keeps one task per sync id; `cancel()` saves the Stop, stops the task and waits up to 5 s, or ends at once a row nobody runs. `_finish` never flips a row another backend already ended. The phases are saved as the sync goes; profiles report each batch (`profiles_done`/`profiles_total`), and embedding batches are 64 (`EMBED_BATCH`, was 512). After the save, a Stop keeps the companies and sets `profiles_skipped`; the next sync then rebuilds every profile (`_profiles_owed`). The route `POST /api/v1/hubspot/syncs/{sync_id}/cancel`: 202 with the sync, 409 `not_running`, 404 `sync_not_found`. `SyncOut` also carries `profiles_skipped` (the contract table has the new line). 15 tests in `tests/core/test_hubspot_sync_cancel.py` (a Stop while reading ends within 5 s with our copy unchanged; a Stop while rebuilding profiles keeps the companies and the next changes sync rebuilds all 3; a fresh heartbeat 45 minutes in is never cleared; left-over rows with no or old heartbeats are cleared at start; a Stop on another backend is seen by the heartbeat; a late finish never flips a cleared row; one task per sync; the route). Track 3's two lock keys (7_244_501, 7_244_502) are listed in `core/prefs/service.py`, as it asked. Checks: ruff, mypy (242 files), and 233 passed, 25 skipped in the sync, migration, schedule, contract and gate tests with `RUN_GATES=1`.
- 2026-11-12: **T1-2 done.** `core/api/request_id.py`: every request gets an 8-character code from letters and digits with no look-alikes (like `7F3K92QD`), in the `X-Request-ID` header, in every error body (`request_id`, also in `ProblemDetails`) and on every log line made during the request (a log-record factory, so the tests' log capture sees it too). It wraps the whole stack (`EngineApp.build_middleware_stack`), outside Starlette's error layer, so a 500 carries the header too. An edge id is only logged, as `edge_request_id` (the contract line is changed: a 36-character id is too long to read out). One `request_done` line per request: method, route pattern (never the real path), status, ms to the first byte. `RoutePaths` (in `core/api/routes.py`) is shared with the Health tab's traffic counter. uvicorn's access log is off (`access_log=False` in `serve`). `core/health/loop_lag.py`: a watcher started in the lifespan logs `loop_lag` with `lag_ms` when the loop wakes over 250 ms late (**TBC**). A 500 now reads "Something went wrong on our side" with "Try again. If it happens again, send this code to an admin: {code}." 10 tests in `tests/core/test_request_id.py`. Tests that compared a whole error body now use `tests/core/problems.py`'s `without_id`, which also checks the id equals the header; the sign-in test that says "not a word differs" compares the bodies without the id (it is random, so it tells nothing about the account). The contract file is `engine/frontend/openapi.json` (the plan said `engine/openapi.json`; fixed): it and `schema.d.ts` gain `request_id`. Checks: ruff, ruff format, mypy (241 files), and 408 passed, 25 skipped in the touched areas with `RUN_GATES=1`.
- 2026-11-12: **T1-1 done.** S0 first, on the go signal: `plan-v15` from `master` (ee47912), plan commit 9ff63aa, made in this worktree, so the main folder stayed on `master`. Then `plan-v15-track1`. Worktree `../contour-v15-t1`; `COMPANIES.xlsx` copied in; `uv sync` and `npm ci` done. Database `leadfinder_v15a`: a `pg_dump` and `pg_restore` copy of `leadfinder_v14a` (at 0015, 13,915 companies); `ix_memory_embedding` failed in the restore (Docker's small shared memory) and was built again with `max_parallel_maintenance_workers=0`. Tests on `leadfinder_test_v15a`. **Baseline with `heavy.sh` and `RUN_GATES=1`: 3,521 passed, 25 skipped, 9 failed.** None was the base code's: 8 came from `CORS_ORIGINS` in this worktree's `engine/.env` (the tests read it); with the `.env` cut to the `POSTGRES_*` lines, those 8 files ran again: 292 passed, 25 skipped. The 9th is the known speed test, which passes alone. So: **3,530 passed, 25 skipped**, the same as PLAN-V14's merge. The `.env` rule in "How to work this plan" is fixed; Track 2 was told by message, and Track 3 wasn't reachable by message then. Two first tries were lost: one stopped at the first failure (`-x`), and one collected a new test file written while the run waited for the `heavy.sh` lock. Lesson: write nothing into the worktree until the run has really started.

## Track 2: the website (session 2)

**Progress:** 0 of 7 steps done.

- [ ] **T2-1. Own copy and a baseline.**
  - The worktree, the `leadfinder_v15b` database and the ports.
  - Run the website tests once with `heavy.sh`, and note the count.
  - **Done when:** the count is in the Track 2 Log.
- [ ] **T2-2. The request layer.** Built against the contract with `mockApi`.
  - **A time limit on every request** (`src/api/client.ts`): 20 seconds by default, 120 for uploads and CSV downloads, none for live run updates (SSE). The numbers are **TBC**. A request that runs out becomes code `timeout`.
  - **Tell the cases apart:**
    - `offline`: the browser says so (`navigator.onLine`);
    - `unreachable`: a network error while online;
    - `updating`: a 502, 503 or 504 that isn't JSON, or a 503 `starting`;
    - `busy`: a 503 `busy`.
    - Only a real network error counts as "can't reach". A bug in page code doesn't.
  - **The request id:** read it from the error body or the `X-Request-ID` header into `ApiProblem`.
  - **Retries** (`src/api/query.ts`):
    - Reads retry on `unreachable`, `timeout` and 5xx, as today.
    - `updating` and `busy` wait for `Retry-After`.
  - **One place for errors:** `QueryCache` and `MutationCache` get an `onError` that feeds a small connection state (online, offline, updating, unreachable). The connection bar and pages in T2-4 read it.
  - **`/auth/me`** (`src/api/hooks/auth.ts`) retries on a network error, a timeout or a 5xx, like other reads. It is asked again when the connection comes back. This is the main fix for the profile menu.
  - **Files:** `src/api/client.ts`, `src/api/query.ts`, `src/api/hooks/auth.ts`, a new `src/api/connection.ts`, tests.
  - **Done when:** tests cover each case above, plus a `/auth/me` that fails once and then works.
- [ ] **T2-3. The words.**
  - **Every message** from the client fallbacks (`client.ts`), `src/lib/problems.ts` and `src/components/error-state.tsx` follows "Words for errors".
  - **422 messages:** Pydantic's field messages become plain words, like "Field required" to "fill this in".
  - **`ErrorState`:**
    - Always has Try again.
    - Has a folded "Details for support" part with the status, the code, the request id, the time and the page, plus a Copy button.
  - Hints that name `engine/.env` or a command go.
  - **Files:** `src/api/client.ts`, `src/lib/problems.ts`, `src/components/error-state.tsx`, tests.
  - **Done when:**
    - a test finds no command, file name or `localhost` in any message the website can show;
    - each status in "Words for errors" has a test;
    - Al-khair has looked.
- [ ] **T2-4. Error pages and the connection bar.**
  - **The connection bar:** a thin bar at the top of the app while the connection state isn't "online", instead of a red box in every card.
    - Offline: "You're offline…". Updating: "Contour is updating…", with a countdown.
    - It retries by itself: when the browser is back online, and every 10 seconds while updating, by asking the backend's health route.
    - When it's back, the bar goes and the failed reads run again.
  - **Full pages** (a new `src/shell/error-pages/`), for when there is nothing to show:
    1. **Connection lost:** Try again, and an automatic retry when back online.
    2. **Updating:** an automatic retry, with "Back in about a minute".
    3. **Something went wrong:** for a 500, with the request id and a Copy button.
    4. **No access (403)** and **Not found (404):** each with a "Go to Home" button. "Start a run" goes from Not found.
    5. **New version:** code that fails to load after a deploy reloads the page once by itself (marked in `sessionStorage`). If it still fails, the page says "Contour was updated" with a Reload button.
  - **Where they plug in:**
    - `RouteError` (`src/shell/route-error.tsx`) picks the page by the error's status or code.
    - `src/shell/page-route.tsx` handles code that fails to load.
    - Detail pages use `throwOnError` for 403 and 404.
  - **Files:** `src/shell/`, `src/router.tsx`, `src/components/` (only what the pages need), `engine/DESIGN.md` (the error pages section), tests.
  - **Done when:**
    - each page and the bar show in the browser, at 3 widths, light and dark, by keyboard and with reduced motion;
    - the automatic retries work in tests;
    - Al-khair has looked.
- [ ] **T2-5. The profile menu.**
  - **No app without a user:** when `/auth/me` still fails after its retries, and it isn't a 401, the frame shows Connection lost or Updating, not the app without a menu (`src/shell/require-sign-in.tsx`). The sidebar never shows every module to someone whose access isn't known (`src/shell/visible-modules.ts`).
  - **On a phone,** the top bar stays at the top while the page scrolls. Built, waiting for a look.
  - `engine/DESIGN.md` says where the account sits now: the bottom of the left menu from 768px, the top bar below that.
  - **Files:** `src/shell/require-sign-in.tsx`, `src/shell/visible-modules.ts`, `src/shell/top-bar.tsx`, `engine/DESIGN.md`, tests.
  - **Done when:** tests prove each of these, and Al-khair has looked:
    - a `/auth/me` that fails once still ends with the menu showing;
    - one that keeps failing shows Connection lost;
    - the sidebar shows no modules while access is unknown.
- [ ] **T2-6. The sync Stop button.** Waits for `v15-api`.
  - Wait for the tag. If it's missing, stop and say "Waiting for the API (T1-3)".
  - `git merge v15-api`. Run `uv run engine migrate` on `leadfinder_v15b`, then `npm run types`.
  - **The hook:** `useCancelHubSpotSync` in `src/api/hooks/hubspot.ts`.
  - **Stop:**
    - A Stop button beside the progress, in `src/apps/companies/hubspot-sync.tsx` and on the Admin HubSpot page (`src/apps/lead-finder/admin/connection.tsx`).
    - After a press: "Stopping…", with the button off.
    - Then the result in the words of the contract.
  - **Progress for each phase:** "Reading HubSpot", "Saving to our copy", "Saving people (1,200)", "Updating profiles (3,400 of 13,900)". Today the bar sits at 95% through the last two.
  - **The Sync button sends "auto".** The Admin page keeps "Full copy".
  - **The sync tests move** from `companies.test.tsx` into the new `hubspot-sync.test.tsx` (see "How to work this plan"). The "sends full" check becomes "sends auto".
  - **Files:** `src/api/hooks/hubspot.ts`, `hubspot-sync.tsx`, `hubspot-sync.test.tsx` (new), the moved tests in `companies.test.tsx`, `admin/connection.tsx`, tests.
  - **Done when:** tests cover Stop in each phase and a 409 `not_running`, the button sends "auto", and Al-khair has looked.
- [ ] **T2-7. Track 2 check.**
  - Website tests, lint, types and build.
  - **A browser check of each error case:**
    - offline (DevTools);
    - a timeout and a 500 (test data in the browser, like PLAN-V14's `card.mjs`);
    - updating (stop the Track 2 backend, then start it again);
    - 403 and 404;
    - a new version (rename a built code file).
  - Also the profile menu, and the Stop button against the Track 2 backend.
  - **Done when:** all pass, the screenshots are in the Log, and Track 2 is marked ready to merge.

### Track 2 Log

Newest first.

- (empty)

## Track 3: call prep (session 3)

**Progress:** 0 of 8 steps done.

- [ ] **T3-1. Own copy and a baseline.**
  - The worktree, the `leadfinder_v15c` database and the ports.
  - Run the `tests/companies` backend tests and the website tests once with `heavy.sh`, and note the counts.
  - **Done when:** the counts are in the Track 3 Log.
- [ ] **T3-2. Call prep races, and migration `0017`.**
  - **Migration `0017_call_prep`** (its `down_revision` is `0015_script_notes` in this branch; M1 changes it):
    - A unique index on `companies.preps` (`company_key`, `contact_id`) where `status = 'searching'`.
    - **Before the index,** the migration marks every "searching" prep older than 5 minutes as failed, and keeps only the newest searching one for each call. Otherwise the index could fail on the live database during the deploy.
    - The table `companies.script_prefs`: user (null for the team default), tone, updated at. One row per user, and one team row.
    - Add the table to the 4 table lists (see "How to work this plan").
  - **Duplicate preps** (`api_preps.py:207-257`):
    - A second start for the same call gets the running prep, from the unique index, not a second paid prep.
    - The "already running" check no longer skips preps over 5 minutes old. Stuck ones are marked failed first.
  - **One web check, not two** (`prep.py:628-631`): two preps for one company never both pay for "still there?".
  - **First saves** (`script_notes.py:115-139`, `221-236`): `INSERT ... ON CONFLICT DO UPDATE`, so two first saves never give a 500.
  - **Team notes:** the 8-note limit holds even when two Admins add one at once (a lock while counting).
  - **Files:** `apps/companies/api_preps.py`, `prep.py`, `script_notes.py`, `tables.py`, the migration, tests.
  - **Done when:** tests that start two of each at once prove one prep, one web check, no 500 and at most 8 notes, and the migration runs up and down.
- [ ] **T3-3. The relationship stage.**
  - **A new `apps/companies/relationship.py`** works out one stage from our copy: deals (state, stage, close date), HubSpot's lifecycle stage, the company's Last talk, logged calls with anyone there, and contacts' last activity. The first match wins:

    | Stage | When | Opener |
    |---|---|---|
    | Open deal | any open deal | No intro. "Following up on {deal}." The goal is its next step. |
    | Customer | a won deal or lifecycle "Customer", and a talk in the last 12 months | No intro. "Hi Jason, it's Tom from Contour." Then check in. |
    | Past customer | a customer with no talk for 12+ months | A short reminder: "We did your Perth fitout in 2023." |
    | Lost deal | lost in the last 24 months | No intro. "Last time the timing wasn't right. What's changed?" |
    | Contacted before | a call with anyone there, a Last talk, or contact activity, in the last 24 months | "We spoke in March," or "I spoke with Sarah." |
    | Cold | none of the above | Today's intro. |

  - The 12 and 24 months are constants at the top of the file (**TBC**).
  - **`CompanyDetail.relationship`** carries it, as in the contract.
  - **The facts pack** gives Claude the stage as a fact with its source, plus the lifecycle stage (missing today).
  - **The prompt** (`prep.py:173`):
    - The opener rule becomes: "If the stage isn't cold, don't say who Contour is or what we do. Open from the relationship."
    - On a switchboard call that isn't cold, ask for the last contact by name.
    - Prompt version `prep-5`.
  - **Files:** `relationship.py` (new), `facts.py`, `prep.py`, `schemas.py`, the company route, tests.
  - **Done when:** each of these is tested:
    - each stage and each edge (12 and 24 months exactly, a won and a lost deal together, a lifecycle "Customer" with no deal);
    - the prompt says "don't introduce" for every stage but cold.
  - **Optional, on Al-khair's word (paid):** 6 preps on `leadfinder_v15c`, one per stage, with call prep switched on in that copy only. At most US$1.50. Save the scripts in `plan/shots/v15-t3/`. Needs Levi's OK for HubSpot names to go to Claude (PLAN-V10 A2), or companies from the Lead Finder only (**TBC**).
- [ ] **T3-4. The free script follows the stage.**
  - `playbook.ts` reads `company.relationship` instead of working out "customer" and "spoke" by itself, so the free script and Claude's agree.
  - **The openers** follow the table in T3-3. "We design and build offices." stays only for a cold call.
  - **A switchboard call** that isn't cold asks for the last contact by name ("Could I speak to Sarah Lee? We spoke in March.").
  - **The tone line** follows the stage. Today's rule only knew a customer, a call with this person, or an open deal.
  - **Files:** `playbook.ts`, `playbook.test.ts`, `use-guide.ts`.
  - **Done when:**
    - tests cover each stage, a switchboard call and a direct call;
    - six sample scripts, one per stage, are in `plan/shots/v15-t3/stages.md`;
    - Al-khair has read them.
  - The wording is **TBC** with Levi.
- [ ] **T3-5. Tone presets, the backend.**
  - **The routes** in the contract (`tone` in `GET /script-style`, `PUT /script-style/tone`, `PUT /script-style/team-tone`), stored in `companies.script_prefs`.
  - **The default:** Friendly, until an Admin picks another team default.
  - **What each preset means,** in one line each, the same for Claude and the free script:
    - **Friendly:** warm, a short greeting, plain words.
    - **Direct:** short sentences, the reason first, no small talk.
    - **Consultative:** questions first, curious, about their workplace.
    - **Formal:** full names and titles, no slang.
  - **Claude:**
    - Gets the preset as the first line of the style block.
    - Returns `tone_line` in its answer, so the card shows Claude's own tone line instead of the free script's (`use-guide.ts:63`).
  - **The order,** where the last one wins on wording: rules, then stage, then tone, then Team style, then Your style.
  - **No spend from a tone change:** a ready prep keeps being reused. If its `tone_used` differs from the person's tone, the card says "Written in a Friendly tone. Research again to use Direct." (T3-6 shows it).
  - **Files:** `script_notes.py` or a new `tones.py`, `api_script.py`, `prep.py`, `schemas.py`, tests.
  - **Done when:** tests prove these, and `engine openapi` and `npm run types` have run:
    - a person's tone beats the team's;
    - null follows the team;
    - a non-Admin gets 403 on the team tone;
    - the prompt has the preset line before the notes;
    - a tone change never starts a prep.
- [ ] **T3-6. The tone picker.**
  - **In the style sheet** (`style-sheet.tsx`), at the top: "Tone", with the four presets as a segmented control (the existing `Segmented` from `src/components/motion/`, used, not changed). Under it: "Team default: Friendly".
  - An Admin also sees "Set as team default".
  - **The Style row** says "Tone: Direct · Team (3 notes) and yours".
  - **The free script** gets a set of words per preset in `playbook.ts`: the greeting, the time ask, the pushback lines and the close. Example for Formal: "Good morning Mr Lee, my name is Tom Brown, from Contour Commercial Interiors."
  - **The hint** from T3-5 shows in the script header when the tones differ.
  - **Files:** `style-sheet.tsx`, `playbook.ts`, `sales-script.tsx`, `script-header.tsx`, `src/api/hooks/script.ts`, tests.
  - **Done when:**
    - it saves and reloads;
    - the free script changes at once when the tone changes;
    - an Admin can set the team default and a non-Admin can't see it;
    - it works by keyboard and on a phone;
    - Al-khair has looked.
  - The wording is **TBC** with Levi.
- [ ] **T3-7. Call prep error words.**
  - **The backend** (`prep.py`, `api_preps.py`, `script_notes.py`):
    - Messages follow "Words for errors".
    - "Claude's answer didn't fit the call script form" becomes "Claude's answer came back incomplete. Press Research again."
    - A line edit with a phone or email says "Phone numbers and emails can't be saved in a script line." It no longer says style notes go to Claude.
  - **The card** (`prep-modal.tsx`, `script-header.tsx`):
    - **One instruction, not two:** no "Press Research again" plus "Press Try again".
    - **A failed status check:** after 3 failed checks in a row, the card stops on "Lost touch with the server" with Try again, instead of "Researching..." forever.
    - **Nothing sure enough:** when all of Claude's lines are removed for having no source, the card shows the free script, with "Claude found nothing sure enough, so this is the free script."
    - **Saved edits that fail to load:** the card says so in one line.
    - **An old HubSpot copy:** when the copy is over 2 days old (**TBC**), the header says "HubSpot copy from 3 days ago".
  - **Preps at shutdown:** if the tag `v15-api` exists, merge it and give the companies app an `on_shutdown` that stops running preps and logs their spend. If it doesn't exist yet, leave this for M1 and say so in the Log.
  - **Files:** the backend files above, `prep-modal.tsx`, `script-header.tsx`, `use-guide.ts`, `apps/companies/app.py`, tests.
  - **Done when:** a test finds no command, file name or `localhost` in call prep's messages, each change above has a test, and Al-khair has looked.
- [ ] **T3-8. Track 3 check.**
  - The backend tests (`RUN_GATES=1`), website tests, lint, types and build.
  - **A browser check** of a card in each stage, the tone picker and the error states, at 3 widths, light and dark, with reduced motion. Use test data in the browser for the paid parts, like PLAN-V14 did.
  - **Done when:** all pass, the screenshots are in the Log, and Track 3 is marked ready to merge.

### Track 3 Log

Newest first.

- (empty)

## Merge and deploy

- [ ] **M1. Join the tracks** (`merge v15`, on Al-khair's word).
  - In a worktree on `plan-v15`, not the main folder: merge `plan-v15-track1`, then `plan-v15-track2`, then `plan-v15-track3`, each as a merge commit.
  - **Fix the known joins:**
    - `0017_call_prep`'s `down_revision` becomes `0016_sync_cancel`;
    - `test_contract_routes.py` keeps both tracks' lines;
    - run `engine openapi` and `npm run types` again instead of fixing generated files by hand.
  - **Wire the preps' `on_shutdown`** if T3-7 left it.
  - **Checks with `heavy.sh`:**
    - all tests (`RUN_GATES=1`), lint, types and build;
    - `load.py` on the merged backend, against the T1-7 targets;
    - one browser pass of the whole flow: an error page, the profile menu, a sync with Stop, a call prep card in two stages with two tones.
  - **Docs:** `engine/AGENTS.md` (request ids, the error words, sync cancel, the stage, tones), `projects/prep/PREP.md`, and this plan in `CLAUDE.md`.
  - **Done when:** everything passes on `plan-v15`, and the docs match the screens.
- [ ] **M2. Move `master`** (part of `merge v15`).
  - Only when M1 is done: fast-forward `master` to `plan-v15` in the main folder.
  - Before that, put back the main folder's uncommitted `CLAUDE.md` and remove its untracked copies of this plan and the audit, after a backup, as PLAN-V14's merge did. Leave `plan/PLAN-V1.md` alone.
  - **Not pushed, not deployed.**
  - **Done when:** `master` equals `plan-v15`, and the main folder is clean apart from `plan/PLAN-V1.md`.
- [ ] **M3. Deploy and check live** (`deploy v15`, on Al-khair's word).
  - Push `master` to `origin`. Deploy `contour-hq` (App Platform; `deploy_on_push` is false), so migrations 0016 and 0017 run.
  - **During the deploy:** keep the live site open in the browser, signed in. Click through Home, Companies and a lead, and note anything that breaks. Expected: at most the "Contour is updating" bar, then the page comes back by itself, with no lost work.
  - **After it:**
    - `live_log.py` and `log_stats.py` on the new log: the 5xx rate, p95 for each route, and any `loop_lag`.
    - The sync stuck since 11 Nov shows as interrupted, and a new sync can start and stop.
    - The profile menu shows after a reload during the deploy.
  - **Done when:** the numbers are in the Log, and Al-khair has clicked through.

## Waiting on

- **Al-khair:**
  - a look at each screen (T2-3 to T2-6, T3-4, T3-6, T3-7);
  - the 5 choices made for him (above), if he wants another;
  - the optional paid check (T3-3, at most US$1.50);
  - the database connection limit (T1-6, `SHOW max_connections`) and where alerts go;
  - stopping the old previews (S0);
  - `merge v15` and `deploy v15`.
- **Levi:** none of these has been asked yet.
  - The wording of the stage openers and the four tones.
  - His OK for HubSpot names to go to Claude (PLAN-V10 A2). Without it, call prep has no web check.

## Risks

- **Three sessions, one account, one laptop.** They share the same limits, and memory is short (about 0.5 GB free during tests). Mitigations: `heavy.sh`'s shared lock, backends started only for browser checks, asking Al-khair to stop the old previews, and saving to the AI Brain at 80%. If limits run out, finish Track 1 first, because Track 2 waits on its tag.
- **The time limits cut off real work.** A full sync or a long query could hit the 30-second statement limit. The sync sets its own longer limit, and T1-6 runs a real full sync to check.
- **A cache hides new companies from matching.** The cache key is the newest `imported_at` and the count, so a lead sent to HubSpot changes it.
- **The stage is wrong for a company.** HubSpot data can be patchy (a won deal never marked). The card shows the stage's reason and source, so the caller can see why. The limits sit in one place.
- **A tone or stage script sounds wrong.** The wording waits for Al-khair's read, and Levi's (**TBC**). The facts and the source rules don't change.
- **A deploy still breaks a page.** M3 tests this live, and the new pages make it a short "updating" bar instead of a broken screen.

## Not in this plan

- New HubSpot fields for the stage (last sales activity, the number of open deals, the last deal close date, the next activity date, "closed lost reason"). Today's data covers every stage. These would make it sharper later.
- Logged emails and meetings: they need a new HubSpot permission (**TBC**).
- A load test against the live site. M1 runs one on the laptop only.
- DigitalOcean's connection pool (PgBouncer): only if T1-6's numbers show a need.
- Switching call prep on, and its email to Levi (PLAN-V10 A2 and E4).

## Log

Newest first.

- 2026-11-12: Plan written from Al-khair's test notes of 12 Nov and [AUDIT-V15.md](AUDIT-V15.md). Nothing built yet.
