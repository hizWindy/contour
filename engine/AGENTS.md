# Agent guide

How to work in this code. It applies to people and to AI coding helpers like Claude Code. Read it before changing anything.

- **What this is:** the research engine and website for Contour's Lead Finder. The build plans are in [plan/](../plan/): [PLAN-V1.md](../plan/PLAN-V1.md) built it, and [PLAN-V2.md](../plan/PLAN-V2.md) applies the new company criteria.
- **The rules it applies:** [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md) (numbers still TBC with Levi; [Criteria_v1.md](../projects/leads/criteria/Criteria_v1.md) is the old version), turned into `backend/apps/lead_finder/rules/criteria.yaml`.
- **How the website looks:** [DESIGN.md](DESIGN.md).

## Commands

From `engine/`:

| Task | Command |
|---|---|
| Start the database | `docker compose up -d` |
| Stop the database | `docker compose stop` |

From `engine/backend/`:

| Task | Command |
|---|---|
| Install packages | `uv sync` |
| Start the backend (applies database changes first) | `uv run engine serve` |
| Start with auto-reload while coding | `uv run engine serve --reload` |
| Apply database changes only | `uv run engine migrate` |
| Make the Admin account (asks for the password twice, never shows it; needs a terminal. A server makes the first one by itself from `FIRST_ADMIN_*`: see Sign-in) | `uv run engine create-admin --email name@company.com.au --username name` |
| Give an account a new password, lift its lock and end its sessions (the only way to reset one) | `uv run engine reset-password --user <email or username>` |
| Change the name an account shows (the People tab can't) | `uv run engine rename --user <email or username> --name "Al-khair M. Pama"` |
| Send one test email (`EMAIL_PROVIDER=log`, the default, only writes it to the log) | `uv run engine email-test --to you@example.com` |
| End every session of every account | `uv run engine sign-out-everyone` |
| Load a HubSpot export | `uv run engine import-hubspot ../../projects/leads/research/COMPANIES.xlsx` |
| Which permissions the HubSpot key has, and what each project can do (free, changes nothing) | `uv run engine hubspot-check` |
| Copy HubSpot into our database now (free; `--full` reads everything and finds deleted records, about 10 minutes) | `uv run engine hubspot-sync` |
| Research one company (costs money) | `uv run lead-finder research "Culture Amp" --city Melbourne` |
| Run the test set of 10 companies (costs money) | `uv run lead-finder testset --yes` |
| Read Signal Hire's headcount for one company (1 company credit, no database) | `uv run lead-finder headcount "Culture Amp" --city Melbourne --yes` |
| Judge the saved leads again with the current rules (free, read only, no migration) | `uv run lead-finder rejudge` |
| Check every answer form is under Anthropic's limits for strict forms (free; add `--live --yes` to send each to Claude once, a few cents) | `uv run lead-finder forms` |
| Fill the answer form again for the leads whose form failed, from saved notes (about US$0.25 a lead, no web search; without `--yes` it only lists them) | `uv run lead-finder refill --yes` |
| Fast tests (no database) | `uv run pytest -m "not integration"` |
| All tests (needs the database) | `uv run pytest` |
| Lint and format | `uv run ruff check .` and `uv run ruff format .` |
| Type checks | `uv run mypy` |
| New database change | `uv run alembic revision --autogenerate -m "what changed"`, then read and fix the file |

| Fake backend for the website (sample companies, no Claude, own database; **not** the real one) | `uv run python -m tests.e2e.serve` |
| A fake database of 10,001 leads and 50 runs for speed tests (about a minute; own database `leadfinder_perf`, never the real one) | `uv run --no-sync python -m tests.e2e.perf_seed` |
| The fake backend on that big database, on its own port | `$env:API_PORT = '8010'; uv run --no-sync python -m tests.e2e.serve --perf` |
| A load test: 20 people at once, reading only, against that fake backend (it refuses a live server and port 8000) | `uv run --no-sync python scripts/loadtest.py --users 20 --seconds 120` |
| Write the API contract the website's types come from | `uv run engine openapi` |

From `engine/frontend/`:

| Task | Command |
|---|---|
| Install packages | `npm ci` |
| Start the website (proxies `/api` to the backend) | `npm run dev` |
| New types after the API contract changed | `npm run types` |
| Lint, types, tests, build | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| Format | `npm run format` |
| Where the bytes go: the first visit and each page, in gzip (builds in memory, adds no package) | `node scripts/bundle-report.js` |

**If Windows App Control blocks a command** (`engine.exe` and `mypy.exe` were blocked on 8 Nov, os error 4551): run the same code through Python, as Al-khair agreed then. `uv run --no-sync python -m core.cli <command>` instead of `uv run engine <command>` (like `python -m core.cli serve`), and `uv run --no-sync python -m mypy`. The commit hook already uses `python -m mypy`.

Swagger is at http://127.0.0.1:8000/docs while the backend runs. All endpoints sit under `/api/v1/`. Don't run the backend tests and the website tests at the same time on this laptop: together they run out of memory.

## Which backend is running

The real backend and the fake backend both listen on `127.0.0.1:8000`, and the website talks to whichever one is up. The website looks the same on both, and `/api/v1/health` says `ok` on both. So check before you trust what you see.

| | Real backend | Fake backend |
|---|---|---|
| Start (from `engine/backend/`) | `uv run engine serve` | `uv run python -m tests.e2e.serve` |
| Name in `.claude/launch.json` | `backend` | `backend-fake` |
| Claude | the real one (costs money) | saved sample answers (free) |
| Database | `leadfinder` | `leadfinder_e2e`, wiped on every start |
| Companies | real names | all named "Sample ..." |

- "Run the app", "start the backend" and "run the project" mean the **real** backend. Start the fake one only when the user asks for it by name, and say so in the reply.
- The real backend needs the database first: `docker compose up -d` in `engine/`.
- Only one can run at a time, because they share port 8000. Before you start either, check what holds the port: `netstat -ano | findstr :8000`, and `docker ps` for an old container such as `contour-backend` or `contour-backend-fake`. Stop it first, or the new one fails to start.
- After it starts, check which one answered: `curl.exe "http://127.0.0.1:8000/api/v1/lead-finder/leads?limit=3"`. Names that start with "Sample" mean the fake backend.

## Map

```
backend/
  core/                shared by every project
    config.py          the one settings object (reads engine/.env)
    runtime.py         the Windows event loop fix
    cli.py             the `engine` command: serve, migrate, import-hubspot
    apps.py            loads the projects listed in settings
    logs.py            structured logs
    api/               the FastAPI app, shared endpoints, the error format; access.py (who may use which project: the Lead Finder tick, PLAN-V9 E1), people.py (Admin's People tab)
    email/             sending email (PLAN-V9 C1): sender.py, one send(); EMAIL_PROVIDER log (the default) or resend
    db/                the database connection, the base model, migrations
    claude/            Claude with web search and fetch (client.py), prices (pricing.py), caps (budget.py)
    searches/          the search log: every Claude request and its cost
    memory/            pgvector memory and FastEmbed
    hubspot/           HubSpot for every project: client.py, check.py, needs.py, sync.py (+ fields.yaml, mapping.py), writer.py; the export import, matching.py, profiles.py
    signalhire/        Signal Hire (client.py): company details, staff and people counts, senior people's names and job titles; details.py is the saved company record
    runs/              the run engine: start, stop, resume, live events, caps (manager.py, events.py, budget.py)
    prefs/             the settings a person can change on the Settings page
    health/            Admin's Health tab (PLAN-V13 T1-2): checks.py (one free check per system: the database, Claude's model list, HubSpot, Signal Hire's balance, email, the runs, the schedules, the API; a problem means it needs you, so a 503 the backend sends on purpose, like the run engine's hand-over after a deploy, is said in the sentence and never a problem), run.py (all at once, 5 seconds each), traffic.py (the API's requests over the last hour, in memory: failed (500 and up, but not 503), not ready (503) and refused (4xx) apart, with the slowest times; counting can't fail a request). GET /health/details, for Admins
    schedules/         jobs that start on their own (PLAN-V6 Part D): calc.py (when a schedule runs next, daylight saving included), models.py (core.schedules), jobs.py (JobSpec: what a project offers), core_jobs.py (the HubSpot sync), service.py (reads, writes, a person's edits), schemas.py (what the Schedules endpoints send and take), runner.py (the loop), runtime.py (start and stop)
    auth/              who may sign in (PLAN-V6): models.py (users, sessions, the sign-in log), passwords.py (argon2id, the rules, common_passwords.txt), clean.py, audit.py, users.py, sessions.py, admin.py (what the server commands do)
  apps/
    lead_finder/       the first project
      app.py           tells the core this project's name, endpoints and rules
      api.py           the /api/v1/lead-finder endpoints (also api_leads.py, api_runs.py, api_watchlist.py)
      runs.py          the four kinds of run: find new leads, watchlist, typed companies, test set. A watchlist run's focus "tenure" is the Start page's "Old offices" (PLAN-V11 C2)
      jobs.py          the scheduled runs: one for each city (`lead_finder.discovery.melbourne` ...), off by default, and the check against the limits before one starts
      goal.py          the automatic runs' goal and budget: each aims for its share of the good leads still needed this round (100 every 2 weeks), and may spend at most what is left of the round's budget (US$150, PLAN-V13 T1-3). The round begins at the first picked city's time
      round.py         the four city schedules as one control (PLAN-V13 T1-3): the cities, how often, the first day and time, the budget; api_round.py is GET and PUT /schedules/lead-finder
      run_email.py     the email when a scheduled run ends (PLAN-V9 C2), to LEAD_FINDER_NOTIFY_EMAILS
      rivals.py        rivals of a good lead in a booming industry (PLAN-V9 B5): the search, the rivals table, and what the next run adds
      api_review.py    the review page's routes (PLAN-V9 C3): the bar, Watch and Reject for many leads, Approve and send to HubSpot
      steps/           the run's steps: plan, discover, merge, choose, company (research one), graph (LangGraph)
      options.py       what the Start page offers (cities, areas, signs, limits)
      lead_store.py    lead filters, sorting, facets, the map and the CSV
      similar.py       look-alikes; watchlist.py the HubSpot watchlist; testing.py the test set report
      headcount.py     Signal Hire's numbers: the `headcount` command, who the company is, and the research's staff and people steps (on while `headcount_tool` is in `size.staff_sources`, since 2 Nov)
      signalhire_company.py  Signal Hire's company details, read before Claude searches: the saved copy (a month), the run's credit cap, the hints for Claude
      sourcing.py      which source wins for each fact (staff, name, website, industry, offices, people), what the others said, and the flags (pure code)
      rules.py         checks the rules files
      rules/           criteria.yaml, queries.yaml, hubspot_map.yaml
      research.py      researches one company: memory, Signal Hire's details, the too-small check before any Claude request (PLAN-V9 B2), search, form, gap check, then HubSpot and Signal Hire next to the research's own numbers, Why now, save
      why.py           the lead card's Why now (PLAN-V12): the When, Size, confidence and Missing lines (pure code, free), then one short Claude request for the reason and the questions, checked by code. Off until `why_now_enabled`; `lead-finder why-now` writes it for saved leads
      fields.py        the answer forms Claude fills in
      sources.py       the source check (pure code)
      scoring.py       the rules and the score (pure code)
      prompts/         the instructions for Claude; prompts.py gives each a version
      tables.py        the leads table
      cli.py           the `lead-finder` command
      testset.yaml     the 10 test companies
  tests/               fast tests, and integration tests marked `integration`
                       tests/lead_finder/samples.py holds the fake Claude
                       tests/e2e/serve.py is the fake backend for the website
  scripts/             checks run by hand: hubspot_schema.py (Contour's HubSpot fields) and schema_map.py (our database); see scripts/README.md
schema/                our database schema, one file for each migration, like SCHEMA-0008.md, made by scripts/schema_map.py
deploy/                the server files: docker-compose.prod.yml, Caddyfile, .env.example and README.md (the run book)
../.do/app.yaml        the DigitalOcean App Platform app (PLAN-V8); its run book is deploy/README.md, "On App Platform"
frontend/
  openapi.json         the API contract, written by `uv run engine openapi`
  src/api/             the typed API client and the data hooks
  src/modules.ts       the projects on the website (MODULES) and the ones still to be developed
                       (PLANNED); the menu, Home, Ctrl+K and routes read both
  src/shell/           the app frame: sidebar, Home, breadcrumbs, Ctrl+K menu, the shared page list (nav.ts)
  src/components/      shared parts: table, map, badges, money; ui/ is shadcn, restyled
  src/apps/lead-finder/ module.tsx (its menu pages and addresses), then one folder per page:
                       start, run, results, lead, rules, test-set; admin/ still holds the shared Admin tabs
  src/test/            test helpers, and the design and contrast checks
```

## Coding practices

### Structure

- **Three layers:** endpoints check the request and call a service. Services hold the logic. Database code sits in one module per table. Each layer only calls the one below it.
- **Core never imports from apps.** Apps import from core. The core finds apps only by the names in settings.
- **Rules are data.** Pydantic checks the YAML files at start-up, and the backend won't start if one is wrong.
- **The rules engine is pure code.** The same company always gets the same result, with no AI and no database inside, so it's easy to test.
- **One settings object** (`core/config.py`) reads `.env`. Nothing else reads environment variables.

### Types and data

- Type hints everywhere, checked by mypy in strict mode.
- Pydantic models at every edge: requests, responses, Claude's answer forms, HubSpot data and the rules files.
- Every table change goes through an Alembic migration. Nobody edits tables by hand.
- After each migration, run `uv run --no-sync python scripts/schema_map.py` from `backend/` and commit the new `schema/SCHEMA-<number>.md` with it. `--check` fails when the saved file is missing or no longer matches the database.
- Times are stored in UTC with the time zone. Money is stored as exact decimals, never floats.
- Async from top to bottom: FastAPI, SQLAlchemy and httpx. Slow work that blocks (like FastEmbed or reading a spreadsheet) runs in a thread.

### Working with Claude

- Prompts live in files, each with a version. Every run saves the prompt versions it used.
- Claude's answers are never trusted as they are. Each one is checked against its answer form. A failed check is retried once, then the fact is marked "unknown".
- The code checks why Claude stopped (it finished, hit a limit or declined) before reading the answer.
- Every Claude call logs the model, tokens, searches and cost, linked to its run.
- Caps are checked in code before every call. Claude can't raise its own budget.

### Reliability and safety

- Every outside call has a timeout: Claude, HubSpot and websites.
- Retries happen only where a repeat is safe (timeouts, rate limits, server errors), with longer waits between tries. A HubSpot write is never retried blindly.
- Each HubSpot send carries a unique key, so a second click or a retry never makes a duplicate.
- Runs save progress as they go, so after a crash they continue instead of starting again and spending twice.
- Logs are structured. They never contain secrets or contact details.
- **Request ids** ([PLAN-V15](../plan/PLAN-V15.md) T1-2, `core/api/request_id.py`): every request gets an 8-character code like `7F3K92QD`, in the `X-Request-ID` header, in every error body (`request_id`) and on every log line of the request. One `request_done` line per request has the route pattern (never the real path), the status and the ms. `core/health/loop_lag.py` logs `loop_lag` when the event loop wakes over 250 ms late (TBC). uvicorn's own access log is off.
- **Measuring** (PLAN-V15 T1-7, `engine/scripts/`): `live_log.py` downloads the live backend's log from App Platform (`DO_API_KEY`, never printed); `log_stats.py` gives p50, p95 and p99 per route, the 5xx rate and the loop lags from a log; `load.py` is a load test on this computer only (unless `--allow-remote`, on Al-khair's word); `lag_check.py` measures how long 20 matches block the loop. Run them from `engine/backend` with `uv run --no-sync python ../scripts/<name>.py`.
- **Limits** (PLAN-V15 T1-6): every app connection starts with `statement_timeout` 30 s, `lock_timeout` 10 s and `idle_in_transaction_session_timeout` 10 minutes (`DB_*_TIMEOUT_MS`, TBC); a HubSpot sync's save and a profile rebuild set longer ones for themselves. A pool that stays busy is a 503 `busy`, and every 503 carries `Retry-After`. The one-backend lock is checked every 30 s; a lost lock stops the run engine and the scheduler, and the backend takes it back as after a deploy. Claude's 429 and 529 are tried twice more after their `retry-after`, nothing else is.
- **Heavy work stays off the event loop** (PLAN-V15 T1-4): HubSpot matching keeps our copy in memory until it changes and scores with one rapidfuzz batch search in a thread; a profile rebuild embeds only texts that changed.

### API conventions

- All endpoints sit under `/api/v1/`, with plural nouns like `/runs` and `/leads`.
- Lists are paged and filterable. No endpoint returns an unlimited list.
- Every error has the same shape (`application/problem+json`: a title, a status, a plain detail and the `request_id`), so the website can show a clear message. The words follow PLAN-V15's "Words for errors": no commands, file names, local addresses or setting names on screen (`tests/core/test_safe_deploys.py` scans for them); the technical details go to the log under the request id.
- Every endpoint has a summary, examples and a response model, so Swagger is a complete guide.
- Only the local website (`http://localhost:5173`) may call the API. In server mode, only the public origin may.

### Testing and changes

- Unit tests cover the rules, the scoring and HubSpot matching, including edge cases like 99 versus 100 staff, Sydney, or an open deal.
- Integration tests are marked `integration`. They run against a separate test database (`leadfinder_test`) that resets for each test.
- Tests replace Claude and HubSpot with saved sample answers, so they're free and give the same result every time.
- A git hook runs Ruff, mypy and the fast tests before each commit.
- Small commits, and one branch per phase, merged when its "Done when" is true. A change to a prompt or a rule stays only if the test set score holds.

## How to add a project

1. Make a folder `backend/apps/<name>/`, with its rules, prompts, answer form and steps.
2. In `backend/apps/<name>/app.py`, define `APP = AppSpec(...)`: the project's name, title, endpoint prefix, database schema, router and rules check.
3. Add the name to `apps` in settings.
4. Put its tables in its own schema, added with a migration.
5. Add its pages in `frontend/src/apps/<name>/`, and its tests in `backend/tests/<name>/`.
6. In `frontend/src/apps/<name>/module.tsx`, define its `AppModule`: name, icon, one-line description, menu pages and routes. Add it to `MODULES` in `frontend/src/modules.ts`, and take it out of `PLANNED` there (the list of projects still to be developed, each with one "to be developed" page). The sidebar group, its card on Home and the Ctrl+K entries then appear by themselves. Its own admin pages go in its menu; only what every project shares goes under Admin.
7. For each page, put what it asks for first in the route's `handle.prefetch` (a function that calls `client.prefetchQuery(...)` with the same `xxxQueryOptions` the page uses, built from the same address). The website starts it when a navigation starts, and when someone points at a link, so the data downloads with the page's code (PLAN-V7). Add the page to the list in `frontend/src/apps/lead-finder/prefetch.test.tsx` (or one like it): it proves the page uses everything started for it and asks once.
8. If it uses HubSpot, see "How a project uses HubSpot" below.
9. If it has work that should start on its own, list `JobSpec`s in `AppSpec.jobs` (see "Schedules" below).
10. If it finds companies of its own, give them to the Companies page with `AppSpec.company_leads` (see "The Companies page and call prep" below).
11. A project with one page shows as a plain link under Home, not as a dropdown (`shell/app-sidebar.tsx`).

The core doesn't change.

## How a project uses HubSpot

One connection in `backend/core/hubspot/` serves every project ([PLAN-V5](../plan/PLAN-V5.md)). A project never calls HubSpot and never holds the key.

1. **Say what it needs.** In its `AppSpec`, set `hubspot_needs=HubSpotNeeds(read=(...), write=(...), uses="...")` with the scopes. The Admin HubSpot page then shows it as ready, or waiting for a named scope.
2. **Read our copy.** Use the `core.hubspot_*` tables (`HubSpotCompany`, `HubSpotOffice`, `HubSpotDeal`, `HubSpotOwner`). The sync fills them. Pick lists and deal stages are saved as their labels, like the export.
3. **Write through the core.** Build a `WriteRequest` (the company, the fields, a note, a list), then call `preview_write` and, after a person confirms, `apply_write` (`core/hubspot/writer.py`). The core fills empty fields only, writes once only, and logs it in `core.hubspot_writes`. Example: `apps/lead_finder/hubspot_send.py`.
4. **Act after a write.** Set `hubspot_written` in its `AppSpec`; the core calls it when one of its writes is done (the Lead Finder marks the lead as sent).
5. **Show it.** Use `SendToHubSpotDialog`, `InHubSpotBadge` and `useHubSpotStatus` from `frontend/src/components/hubspot/`.
6. **Test it** with `FakeHubSpot` (`backend/tests/core/hubspot_fake.py`). No test reaches HubSpot: the tests blank the key.

Commands, from `backend/`: `uv run engine hubspot-check` (which scopes the key has, free) and `uv run engine hubspot-sync` (copy HubSpot now, free; `--full` reads everything and finds deleted records).

## The Companies page and call prep

[PLAN-V10](../plan/PLAN-V10.md). A project of its own, `apps/companies` (routes under `/companies`, schema `companies`, the "Companies" tick). Its spec is [PREP.md](../projects/prep/PREP.md).

- **The list** reads our HubSpot copy. Search, filters, sort and paging run in SQL (a page of 13,913 companies takes 35 to 75 ms, the prep box 40 ms, with no trigram index).
- **Another project's companies** come through `AppSpec.company_leads` (`core/company_leads.py`): SELECTs the Companies page joins and pages in the database, and a panel section. The Lead Finder's (`apps/lead_finder/company_leads.py`) adds its good leads that aren't in HubSpot yet (the newest research of each company decides). Only people with that project's tick get those rows and fields: the server leaves them out for everyone else.
- **Two projects:** a core list that names no project (runs, the search log, memory) shows the projects this person may use (`AppAccess.allowed`), and refuses someone who may use none.
- **The facts pack** (`facts.py`) is everything we know about a company and a person, each fact with an id (F1, F2 ...) and a source. It is free.
- **The free script** (`frontend/src/apps/companies/playbook.ts`, PLAN-V10 F1): the prep card's sales script and guided questions, each question with why it is asked and what to ask next for each likely answer. It is written in the browser from the company's data, at once and free, even while call prep is off. Call prep's script takes its place once ready, in the same shape (`guideFromPrep`). The wording is TBC with Levi.
- **"Sync with HubSpot"** on the page (`hubspot-sync.tsx`, PLAN-V10 F2) starts a sync (`POST /hubspot/sync?mode=auto` since PLAN-V15; the Admin page keeps "Full copy") and follows `GET /hubspot/syncs`. The sync saves its read counts every `PROGRESS_EVERY` (500) records (`core/hubspot/sync.py`), its `phase` (reading, saving, people, profiles) and the profile counts, so the bar fills.
- **Stopping a sync** (PLAN-V15 T1-3, T2-6): the Stop button calls `POST /hubspot/syncs/{sync_id}/cancel`. A heartbeat (`heartbeat_at`, every 10 s) shows a sync is alive; one with no heartbeat for 2 minutes is left over and is cleared at start-up. Stopped before its save, our copy doesn't change; after it, the companies stay and the next sync rebuilds the profiles (`profiles_skipped`). A full sync never removes or overwrites rows saved after it started (T1-5).
- **A prep** (`prep.py`) is one Claude request in a fixed form. Every line must cite a fact id or a page the web tool really returned (W1 ...), or it is dropped. Never sent to Claude: email addresses and phone numbers (`scrub` blanks them even inside call notes), and, while `HUBSPOT_NAMES_TO_CLAUDE_OK` is off, company and person names (written `{company}` and `{person}`, and no web check). A prep runs in a background task (`PrepRunner`); the website asks for it every 2 seconds. It is saved in `companies.preps`, logged in the search log (so the daily limit counts it) and reused free for `prep_reuse_days`. A prep made with the Lead Finder's facts is never shown to someone without its tick.
- **News has no age limit** ([PLAN-V14](../plan/PLAN-V14.md) T1-2): the most recent news, however old. Code dates each news line (`NewsLine.date`) from the pages and saved notes it cites, sorts newest first with undated lines last, and the card shows each item's age. The rules say an item over three months old says when it happened.
- **The call technique** (PLAN-V14 T1-4, T3-2) is in both scripts: Claude's (`SYSTEM` in `prep.py`) and the free one (`playbook.ts`). The opener asks for time; questions go from their situation to what fixing it is worth; pushback gets three beats (name the feeling, agree with what is fair, ask one question); a tone line (warm or light); a feeling only as a question; no pushing twice. The wording is TBC with Levi.
- **Edits and style notes** (PLAN-V14 T1-3, T3-3 to T3-6): three layers, the top one wins: Yours, Team, Draft.
  - A **line edit** (`companies.script_edits`, `PUT /companies/script-edits`) is one person's wording for one slot of one call (`opener.0`, `why_now.1`, `question.2`, `if_they_say.0`, `goal`). Private, never sent to Claude. The website lays it over the newest draft (`applyEdits` in `script-layers.ts`, through `useGuide`), so it survives "Research again", and "Copy script" copies it.
  - **Style notes** (`companies.script_styles`, `/companies/script-style`): one per person ("Your style", up to 600 characters) and up to 8 team notes (up to 200 each). Anyone suggests a team note; an Admin approves, rejects or retires it (an Admin's own is active at once, TBC). They go last in Claude's prompt, after the facts, as wording only (`STYLE_RULE`), with names hidden while names are off. The morning search ahead uses the team's only. A prep records `style_used`.
  - A line or a note with an email address or a phone number is refused (422 `contact_details`). With sign-in off, rows have no user and anyone may decide.
- **The card** (PLAN-V14 T2-2 to T2-5): Still there?, Last talk and News sit in the card's header (`before-you-dial.tsx`); Connections waits for Levi's customer list. "Research again" (the old Refresh) sits at the top of the script (`script-header.tsx`), with its cost from `prep_cap_usd`, greyed out while call prep is off. The script's parts: `sales-script.tsx`, `line-editor.tsx`, `style-sheet.tsx`.
- **The relationship stage** (PLAN-V15 T3-3, T3-4, `apps/companies/relationship.py`): open deal, customer, past customer, lost deal, contacted before, or cold, worked out once from our copy (12 and 24 months, TBC) and sent as `CompanyDetail.relationship` and as a fact to Claude. Only a cold call introduces Contour; the free script (`playbook.ts`) and Claude's prompt follow the same stage.
- **Tone presets** (PLAN-V15 T3-5, T3-6): Friendly (the default), Direct, Consultative and Formal, each person's in `companies.script_prefs`, the team's default set by an Admin (`/companies/script-style/tone`, `/team-tone`). The free script has wording for each; Claude gets it first in the style block. A tone change never starts a paid prep: a ready prep in another tone shows a hint to press Research again.
- **Races** (PLAN-V15 T3-2): one searching prep per call (a partial unique index, migration 0017), one web check per company (advisory lock 7_244_502), first saves of edits and notes by `ON CONFLICT`, and the 8 team notes under a lock (7_244_501). Running preps stop and log their spend when the backend stops (`on_shutdown=stop_preps`).
- **The switches** are on the Settings page: `prep_enabled` (off by default), `prep_cap_usd`, `prep_max_searches`, `prep_reuse_days`, `model_prep` and `search_ahead_cap_usd`. The numbers are TBC until 10 real preps are measured (PLAN-V10 E3).
- **People and calls** (`core/hubspot/people.py`): the daily sync copies contacts and the calls of the last 2 years into `core.hubspot_contacts` and `core.hubspot_calls` once the key has `crm.objects.contacts.read`. Until then it goes on without them and says it is waiting.
- **Tests:** `backend/tests/companies/` (a fake Claude records every request; one test checks that no email or phone number ever reaches it; `test_script_notes.py` for edits and style notes) and `frontend/src/apps/companies/` (`companies.test.tsx`, `call-card.test.tsx`, `script-layers.test.ts`, `line-editor.test.tsx`, `style-sheet.test.tsx`, `use-guide.test.tsx`, `playbook.test.ts`).

## Schedules

[PLAN-V6](../plan/PLAN-V6.md) Part D. A schedule starts a job on its own: "every N days or weeks, on a weekday, at a time, in Melbourne time". Plain cron can't say "every 2 weeks".

- **The time is the wall clock in the zone.** 7:00 am stays 7:00 am all year, though it is a different hour in UTC before and after daylight saving (`core/schedules/calc.py`). A time that doesn't exist runs at 3:30 instead of 2:30, and one that happens twice runs once.
- **The loop** (`core/schedules/runner.py`) checks the `core.schedules` table once a minute and starts what is on and due. It runs only in the backend that holds the run engine's lock, so there is one of it for a database. A due schedule is **claimed first** (its next time moved on, saved) and started after, so it never starts twice. A schedule **missed** while the backend was off runs once when it is back, and keeps its own days. A job **still running** is skipped, with a note on the schedule. A job that fails never stops the loop, and its error text stays in the log: the table gets a fixed sentence.
- **A project adds a job** with `JobSpec(key, project, title, start, running, default)` in `AppSpec.jobs`. `start(context)` begins the work and returns at once with the id of the run or sync it made (`JobResult(ref=...)`), or raises `JobSkipped("a reason in plain words")`. `running(context)` says whether the last start's work is still going. `default` is the schedule made at the first start, and never again: a person's edits and switch-offs stay. A schedule that is off has no next time (the table keeps the two together).
- **The core's own job** is the HubSpot sync, on by default, every day at 6:00 am (`core/schedules/core_jobs.py`). A sync a schedule starts has the trigger `schedule`.
- **The Companies page's job** is `companies.search_ahead` (`apps/companies/jobs.py`): every day at 6:30 am, after the sync, **off** until a person switches it on. It skips itself on a weekend and while call prep is off. It preps companies with an open deal, then good leads, skips one with a prep or saved news under 7 days old, and stops at `search_ahead_cap_usd` for the day. Its ref is `search-ahead:<date>`, not a run.
- **The Schedules tab** (Admin) reads and changes them through `core/api/schedules.py`: `GET /schedules` (every schedule with its cadence in words, the saved choices in a sentence, the next and last run, whether it is going, and what one start costs), `PATCH /schedules/{id}` (on or off, `every`, `unit`, `weekday`, `at` as `07:00`, `settings`) and `POST /schedules/{id}/run` ("Run now": the same loop code and checks as a start on time, so it can answer `skipped` with the reason, and it never moves the next run). Reading needs a session; the other two need the Admin role (`AdminDep`). Off has no next run; on has one, kept as it is unless it was off or the cadence changed. A job adds three optional hooks to its `JobSpec`: `estimate` (what one start costs: typical, the most, the prices used, why it wouldn't start now), `describe` (the choices in a sentence) and `check_settings` (cleans the saved choices, or raises `JobSettingsError`). Money on the page is in whole cents: what a start costs is rounded up, and what is left to spend is rounded down.
- **The Lead Finder's round** (PLAN-V13 T1-3): the four city schedules (`lead_finder.discovery.melbourne` to `.sydney`) are one control, `GET` and `PUT /schedules/lead-finder` (`apps/lead_finder/round.py`, mounted through `AppSpec.schedule_router`, since the core never imports a project). Picked cities are on, one day apart in the order Melbourne, Adelaide, Perth, Sydney, from the first day; the others are off. A save changes all four in one transaction, and keeps each next time when only the budget changed. While the round is off, the picked cities and the first day are kept in the settings table's `lead_finder_round` row (never read as a setting). The round's budget is the setting `lead_finder_round_cap_usd` (US$150, TBC): before a city's run starts, its cap becomes the smaller of `scheduled_run_cap_usd` and what is left, and a spent round skips the city with "This round's budget (US$150) is spent. Next round: 30 Nov." (`goal.py`).
- **The Lead Finder's job** is `lead_finder.discovery` (`apps/lead_finder/jobs.py`): every 2 weeks, Monday at 7:00 am, **off** until a person switches it on (each run costs money). Its `settings` are the Start page's choices (`cities`, `triggers`, `area`, `since_days`, `caps`); a part left out gets the Start page's starting value. The default is the Start page's own default (Melbourne, Adelaide, Perth, the 4 main signs, 12 searches) looking back 14 days. The plan said 4 cities, but Sydney makes 16 searches and the default limits allow 13, so Sydney needs the run limit raised first. Before it starts, the run's estimate is checked: a typical run (never the worst case) must be within the run limit and within what is left of today's limit, or the schedule is skipped with the reason in `last_error`. A run a schedule starts has `schedule_id` (`RunOut.schedule_id`), and the Runs page says "Scheduled". The run's own limits still apply while it works.

## Sign-in

[PLAN-V6](../plan/PLAN-V6.md). One Admin account, signed in with an email or a username and a password.

- **Off on this computer** (`AUTH_REQUIRED=false`, the default), so local work and the fake backend need no password. Where it is on, **every route needs a session**, except `GET /health`, `POST /auth/login` and the Swagger pages. The guard (`core/api/guard.py`) is plain ASGI middleware with deny by default: it answers 401 `auth_required` from the headers alone, before any body is read, and an unknown path gets the same 401, so a route a project adds later is covered with no change. The fake backend takes `--auth` to turn sign-in on and make a demo Admin (its password is printed once).
- **The account is made on the server:** `uv run engine create-admin`. There is no sign-up page and no reset by email. `reset-password`, `rename` and `sign-out-everyone` are commands too. The website calls the `admin` role "System admin" (PLAN-V13 T1-4).
- **The first Admin can be made by `engine migrate`** ([PLAN-V8](../plan/PLAN-V8.md)): with `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` set and no Admin yet, the migrate step makes the account (`_first_admin` in `core/cli.py`, `create_first_admin` in `core/auth/admin.py`), so a deploy needs nobody at a terminal. It does nothing once an Admin exists (it says to remove the password), so the settings can stay without failing a deploy. Only one of the two set, a login that isn't allowed, or a password that breaks the rules fails the migrate and names the reason. The password follows the same rules as a typed one, is a `SecretStr` that `core/logs.py` redacts, and is never printed. The sign-in log says `by: settings`.
- **Passwords** are saved only as an argon2id hash (RFC 9106's low-memory settings). A new one has 14 to 256 characters, isn't common (`core/auth/common_passwords.txt`), doesn't hold the email, the username or "contour", and isn't a repeat or a simple run. A hash made with older settings is saved again at the next sign-in.
- **Sessions:** the cookie holds a random 256-bit token and the database only its SHA-256. Signed out after 2 hours idle and after 12 hours at most. "Keep me signed in" has no idle limit and lasts 14 days. The numbers are `SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS` and `SESSION_REMEMBER_DAYS`. "Last seen" is written at most once a minute.
- **The cookie** is `HttpOnly` and `SameSite=Strict`. Over HTTPS (`SESSION_COOKIE_SECURE=true`) it is `Secure` and named `__Host-contour_session`.
- **A wrong sign-in** answers 401 `invalid_credentials` with one sentence ("That email or password isn't right."), and takes as long whether the login is unknown, the account is switched off or the password is wrong.
- **Guessing is limited** (`core/auth/throttle.py`, the `LOGIN_*` settings). The first 2 wrong tries in a row are free, then each wait doubles (2 seconds up to a minute), and the 10th locks the login for 15 minutes. A try during a wait answers 429 `too_many_attempts` (with `Retry-After`), checks nothing, counts nothing and isn't logged. A login that matches no account is slowed and locked the same way, kept in memory by a hash, so the lock never says which accounts exist. One IP address may make 20 wrong tries in 15 minutes (counted from the sign-in log). The account's row is locked while a try is checked, so parallel tries can't beat the count.
- **The sign-in log** (`core.audit_log`, `GET /auth/log` for an Admin) keeps every sign-in, failure, lock, sign-out and password change, with the time and the IP address. It never holds a password, a token or a login that was typed: `audit.add_entry` refuses a detail whose name sounds like a secret.
- **In a route:** take `MaybeAuthDep` (the signed-in user, or none where sign-in is off) or `AdminDep` from `core/api/signin.py`. A 401 has the code `auth_required`, and for a session that ended it says why (`reason`: `idle`, `expired` or `ended`). Tests move time with `app.state.clock` and use a cheap hasher in `app.state.hasher` (see `tests/core/test_auth_api.py`).

## Server mode

[PLAN-V6](../plan/PLAN-V6.md) B5. The engine on a server, behind Caddy and HTTPS. Off on this laptop, where nothing changes: the engine answers to `localhost` and `127.0.0.1` and listens on `127.0.0.1`.

- **On** with `SERVER_MODE=true`. It needs `PUBLIC_ORIGIN` (the website's `https://` address, no path) and one of `TRUSTED_PROXIES` (Caddy's address or network, never `*`) or `CLIENT_IP_HEADER` (App Platform, below), or the backend refuses to start and names what is missing.
- **It sets up:** the host check lets the public host through (and `localhost` and `127.0.0.1`, for the container's own health check); the origin guard allows the public origin and no other; the backend listens on `0.0.0.0` inside its container; sign-in is required; the cookie is `Secure` and `__Host-` named; the backend doesn't migrate at start (a one-off `engine migrate` runs first); the Swagger pages aren't served (`engine openapi` still writes the contract).
- **Whose word is taken for a client's IP address:** only a connection from `TRUSTED_PROXIES`, by uvicorn's `forwarded_allow_ips`. Caddy adds the real address at the end of `X-Forwarded-For`, and what a client writes before it is not believed. On this computer no header is believed at all.
- **Behind App Platform** ([PLAN-V8](../plan/PLAN-V8.md)): the front door has no fixed address, so `TRUSTED_PROXIES` can't name it. Set `CLIENT_IP_HEADER=do-connecting-ip` instead (never both). `client_ip` in `core/api/signin.py` then reads the address from that one header (the last line, if it comes more than once), only if it holds one valid IP address, and from the connection otherwise; uvicorn trusts no forwarding header at all (`proxy_headers` is off). A name a visitor can write (`X-Forwarded-For`, `Forwarded`, `Host`, ...) is refused as the setting. It is safe only if App Platform replaces a header a visitor sends: check the live app (run book, "Check after the first deploy").
- **Nothing is quietly overruled:** `AUTH_REQUIRED=false`, `SESSION_COOKIE_SECURE=false` or `AUTO_MIGRATE=true` together with server mode is refused.

## Containers

[PLAN-V6](../plan/PLAN-V6.md) Part G. Three images and one compose file. The run book is [deploy/README.md](deploy/README.md).

- **Backend** (`backend/Dockerfile`, built from `backend/`): Python 3.12.16 on Debian 13 (fixed in `ARG PYTHON_IMAGE`; the laptop runs 3.12.10 and passes every test), uv installing exactly `uv.lock`, a normal user (`contour`, uid 10001), the memory model baked in **before** the code is copied (`BAKE_MODEL=1`, the default, so a code change doesn't download it again; `0` skips it, only for a build that can't reach Hugging Face), and a health check on `/api/v1/health`. When it runs it sets `HF_HUB_OFFLINE=1` (nothing is downloaded) and `ORT_DISABLE_TELEMETRY=1` (ONNX Runtime sends usage events to Microsoft unless told not to). `ARG EMBEDDING_MODEL` must match `embedding_model` in `core/config.py`. `backend/.dockerignore` keeps `.env`, `.venv`, `scripts/out/` and `tests/` out. The migrations are a step of their own: `engine migrate`.
- **Website** (`frontend/Dockerfile`, built from `engine/`, because the Caddyfile is in `deploy/`): Node 22.23.4 builds the site once (fixed in `ARG NODE_IMAGE`), then Caddy 2.11.8 (`ARG CADDY_IMAGE`) serves it as plain files, sends `/api` to the backend, gets the HTTPS certificate and adds the security headers (`deploy/Caddyfile`). The files under `/assets` have their own `handle` block, so a missing one is a 404 and never `index.html`: Caddy's `try_files` takes no matcher, and a first word like `@pages` is read as a file name. `frontend/Dockerfile.dockerignore` says what is left out.
- **Compose** (`deploy/docker-compose.prod.yml`): `web` (Caddy, the only part with open ports), `backend` (one copy only), `migrate` (before the backend) and `db` (a Postgres of its own, for a laptop trial only: `COMPOSE_PROFILES=trial`). Each part keeps its log to 5 files of 10 MB (`x-logging`), so a busy server can't fill its disk. The keys are in `deploy/.env`, never in git. `COMPOSE_FILE` in that file makes `docker compose` use the production file; without it compose climbs to `engine/docker-compose.yml`, the development database.
- **Tests without Docker:** `backend/tests/core/test_deploy_files.py` checks what these files must keep: the baked model is the settings' model, telemetry is off, only Caddy publishes ports, Caddy's one trusted address, a missing asset is a 404, and the logs are kept small. A change to a deploy file runs it on every commit.
- **Line endings:** `.gitattributes` checks out the files that go into Linux containers (`deploy/`, `backend/Dockerfile`, `backend/.dockerignore`) with LF on every machine, as it does for `frontend/`.
- **Caddy's address is fixed** (`172.28.0.2`), and `TRUSTED_PROXIES` is that one address. The other parts get addresses from the upper half of the network, so none of them can take it first.
- **Database TLS:** `POSTGRES_SSLMODE` and `POSTGRES_SSLROOTCERT` (a managed database needs `require` at least; `verify-full` also needs the certificate file).

## App Platform

[PLAN-V8](../plan/PLAN-V8.md). The same backend image on DigitalOcean App Platform, with no Caddy and no server of our own. Live since 6 Nov 2026: app `contour-hq` in Sydney. The file is `../.do/app.yaml`, and the run book is [deploy/README.md](deploy/README.md), "On App Platform".

- **Parts:** the backend (`instance_count: 1`, never more: the engine allows one backend for each database), the website (a static site built by `npm run build`), the `migrate` job (`PRE_DEPLOY`: runs `engine migrate` before every deploy, and makes the first Admin) and the managed Postgres cluster `contour-db`, reached as `doadmin` (a dev database can't be used: it won't let the app create its schemas). The front door sends `/api` to the backend with `preserve_path_prefix` (the backend's routes start with `/api/v1`) and the rest to the website.
- **Settings** are the file's `envs`: `SERVER_MODE`, `PUBLIC_ORIGIN=${APP_URL}`, `CLIENT_IP_HEADER=do-connecting-ip`, the `POSTGRES_*` values from the database part, `POSTGRES_SSLMODE=require` and a smaller connection pool (at most 15 connections). **No key is in the file:** the keys and `FIRST_ADMIN_*` are added in the dashboard, encrypted.
- **No deploy on push** (`deploy_on_push: false`): a deploy restarts the backend and stops a run in progress, so someone presses Deploy.
- **A TCP health check, on purpose:** the host check answers only to the public host name, and what host name App Platform's check sends is not known. The backend opens its port once its start-up is done, with or without the run engine.
- **A deploy replaces the one backend by taking over** (`take_over_later` in `core/runs/lifecycle.py`): App Platform starts the new backend while the old one still runs. In server mode the new one starts without the run engine (`app.state.run_engine_waiting`; the run routes answer 503 `runs_not_ready` titled "Runs are restarting", Health's Runs row says "Starting", and the API row counts those answers as not ready, not failed; the rest works), tries the lock every `LOCK_RETRY_SECONDS` (5), and once the old one has let it go recovers the runs and starts the run engine, then the scheduler and the HubSpot copy (`start_background_work` in `core/api/app.py`). On a laptop a second backend still refuses to start. Before this, no update could finish (6 Nov).
- **Tests without DigitalOcean:** `backend/tests/core/test_app_platform_file.py` checks what the file must keep: one backend, the same build as compose, the migrate step first, the `/api` path kept whole, every setting is a real setting and builds a valid server-mode `Settings`, no key in the file, and the connection count. `test_client_ip.py` and `test_first_admin.py` cover the two backend changes.
- **Not confirmed (TBC):** that App Platform replaces a `do-connecting-ip` a visitor sends, that a run's live feed streams through the front door (`disable_edge_cache` can't be set with a static site), and the website's security headers (App Platform serves the static files, without Caddy's).

## Safety

- Secrets live only in `engine/.env`. Never in code, logs, tests or git.
- No contact emails or phones are stored or sent to Claude. The HubSpot import skips any Contacts sheet.
- Signal Hire: company numbers, and the names and job titles of senior people. Never contact details: `core/signalhire/client.py` has no call for the Person API, an employee list, an email or a phone. Levi said yes to decision makers' names on 2 Nov; emails and phones are still open (**TBC**, PLAN-V4 Part E). The key is `SIGNALHIRE_API_KEY` in `engine/.env`, and tests blank it. Its Company API is off until Signal Hire's support switches it on (a 403 on a company call means it is off, `SignalHireCompanyApiOff`). While it is off, no company details are read and nothing is paid, `lead-finder headcount` still counts people by the name as typed and prints "name not checked", because the search doesn't need the Company API. A refused key (401) still stops it.
- Signal Hire in the research ([PLAN-V4](../plan/PLAN-V4.md)): it is on since 2 Nov (Al-khair's say, before the 5-company test): `headcount_tool` is listed in `size.staff_sources` in `criteria.yaml` (the one switch for all of it), and it needs the key. To turn it off, take `headcount_tool` out of that list or empty the key, then restart the backend; to turn off one kind of data, take it out of that row of `data_sources`. It never stops a lead or a run (an error is one line in the card's problems), and holds no database connection while it answers.
  - **One lookup for each company.** Who it is (free), its details (1 company credit: checked name, website, industry, LinkedIn page, offices, staff in all), the staff count in the city (1 search from the daily quota) and the senior people (1 search). The details are saved for a month in `lead_finder.signalhire_details`, so a company is paid for once a month. A run reads at most `SIGNALHIRE_MAX_CREDITS_PER_RUN` (20) new ones. A re-fill (`lead-finder refill`) uses saved copies only.
  - **The first source in the list wins, and the others stay.** `size.staff_sources` is the order for staff numbers (HubSpot, Signal Hire, LinkedIn doubled, the web research), and `data_sources` is the order for the name, website, industry, offices and decision makers. The winner is used by the rules. The other values stay on the lead card (`fact_sources`) and a gap of more than `conflicts.staff_gap_ratio` (2) between staff numbers, two websites or names that are not the same company, or no office in the lead's city is a flag for a person. All of it is in `sourcing.py`, in plain code.
  - **Retail and site-heavy companies:** a staff count from Signal Hire is only a note, never a staff number (`industries.check_office_size`).
  - A company that came from HubSpot (the watchlist) is not sent to Signal Hire unless `HUBSPOT_NAMES_TO_SIGNALHIRE_OK=true`, a switch of its own beside the one for Claude. Its Company API is off for our account (a 403, checked 2 Nov), so the company name can't be checked, and `size.headcount_tool_name_check` is `auto`: it counts under the name as typed while the API is off, and turns strict by itself when support switches it on. The card says when the name was not checked.
- Decision makers: the research may note up to 3 leaders (CEO, COO, CFO, head of property or workplace) by name and job title, only from public pages it read (the company's site, annual report, ASX, news), each with its link. Never LinkedIn or any page behind a login, never an email or phone number (`fields.py` and `sources.py` remove them). Whether Contour keeps names is **TBC** with Levi (question 17 in `LEVI.md`).
- Read, don't scrape. Property Daily stays off until its terms allow a program to read it.
- Nothing is written to HubSpot unless a person clicks "Send to HubSpot" and confirms the preview. Writing is off until `HUBSPOT_WRITE_ENABLED=true` in `engine/.env` and the key has the write scopes. A write fills empty fields only, and is written once only. The HubSpot key (`HUBSPOT_SERVICE_KEY`) is never logged or sent to the website, and the tests and the fake backend blank it.
- The HubSpot sync stores no contacts and no owner emails. HubSpot company names reach Claude or Signal Hire only when `HUBSPOT_NAMES_TO_CLAUDE_OK` or `HUBSPOT_NAMES_TO_SIGNALHIRE_OK` is true (both off).
- The database listens on `127.0.0.1` only.
- ONNX Runtime, the engine inside FastEmbed, sends usage events to Microsoft unless `ORT_DISABLE_TELEMETRY=1` is set (its `Privacy.md`; found 5 Nov, PLAN-V6 G1). The container image sets it. On this laptop it is **not** set yet: **TBC** whether to set it in `core/memory/embedder.py` for every run (Al-khair's call).

## Windows note

psycopg's async mode can't use Windows' default event loop. `core/runtime.py` switches to the selector loop. Always start the backend with `uv run engine serve`, and keep the same fix at the top of `tests/conftest.py`. A script of your own needs it too: `asyncio.run(main(), loop_factory=loop_factory())`.

## Claude Code agents

Added 14 Nov 2026. Four agents in `.claude/agents/` split the work. Their skills are in `.claude/skills/`.

| Agent | Owns | Its own skills |
|---|---|---|
| `frontend-agent` | `frontend/`, [DESIGN.md](DESIGN.md) and `design/principles/` | `ui-build`, `design-review`, `speed-check`, `design-extract` |
| `backend-agent` | `backend/`, except the Lead Finder's rules, prompts and scoring | `api-change`, `db-migration` |
| `rules-agent` | The Lead Finder's rules, prompts, scoring, sourcing, Why now and test set, and `projects/leads/criteria/` | `rule-change` |
| `review-agent` | Nothing: it reads, runs the checks and reports, before a merge or a deploy | `merge-check`, `security-check`, `design-review` |

All four use `plain` and `git-workflow`. Merging, pushing, deploying and anything that costs money stay with Al-khair.

## Writing

Documents follow the plain-words rules in [../CLAUDE.md](../CLAUDE.md): answer first, short sentences, and **TBC** for anything not confirmed.
