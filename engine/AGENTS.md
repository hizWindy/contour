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
| Make the Admin account (asks for the password twice, never shows it; needs a terminal) | `uv run engine create-admin --email name@company.com.au --username name` |
| Give an account a new password, lift its lock and end its sessions (the only way to reset one) | `uv run engine reset-password --user <email or username>` |
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
| Write the API contract the website's types come from | `uv run engine openapi` |

From `engine/frontend/`:

| Task | Command |
|---|---|
| Install packages | `npm ci` |
| Start the website (proxies `/api` to the backend) | `npm run dev` |
| New types after the API contract changed | `npm run types` |
| Lint, types, tests, build | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| Format | `npm run format` |

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
    api/               the FastAPI app, shared endpoints, the error format
    db/                the database connection, the base model, migrations
    claude/            Claude with web search and fetch (client.py), prices (pricing.py), caps (budget.py)
    searches/          the search log: every Claude request and its cost
    memory/            pgvector memory and FastEmbed
    hubspot/           HubSpot for every project: client.py, check.py, needs.py, sync.py (+ fields.yaml, mapping.py), writer.py; the export import, matching.py, profiles.py
    signalhire/        Signal Hire (client.py): company details, staff and people counts, senior people's names and job titles; details.py is the saved company record
    runs/              the run engine: start, stop, resume, live events, caps (manager.py, events.py, budget.py)
    prefs/             the settings a person can change on the Settings page
    schedules/         jobs that start on their own (PLAN-V6 Part D): calc.py (when a schedule runs next, daylight saving included), models.py (core.schedules), jobs.py (JobSpec: what a project offers), core_jobs.py (the HubSpot sync), service.py, runner.py (the loop), runtime.py (start and stop)
    auth/              who may sign in (PLAN-V6): models.py (users, sessions, the sign-in log), passwords.py (argon2id, the rules, common_passwords.txt), clean.py, audit.py, users.py, sessions.py, admin.py (what the server commands do)
  apps/
    lead_finder/       the first project
      app.py           tells the core this project's name, endpoints and rules
      api.py           the /api/v1/lead-finder endpoints (also api_leads.py, api_runs.py, api_watchlist.py)
      runs.py          the four kinds of run: find new leads, watchlist, typed companies, test set
      steps/           the run's steps: plan, discover, merge, choose, company (research one), graph (LangGraph)
      options.py       what the Start page offers (cities, areas, signs, limits)
      lead_store.py    lead filters, sorting, facets, the map and the CSV
      similar.py       look-alikes; watchlist.py the HubSpot watchlist; testing.py the test set report
      headcount.py     Signal Hire's numbers: the `headcount` command, who the company is, and the research's staff and people steps (on while `headcount_tool` is in `size.staff_sources`, since 2 Nov)
      signalhire_company.py  Signal Hire's company details, read before Claude searches: the saved copy (a month), the run's credit cap, the hints for Claude
      sourcing.py      which source wins for each fact (staff, name, website, industry, offices, people), what the others said, and the flags (pure code)
      rules.py         checks the rules files
      rules/           criteria.yaml, queries.yaml, hubspot_map.yaml
      research.py      researches one company: memory, Signal Hire's details, search, form, gap check, then HubSpot and Signal Hire next to the research's own numbers, save
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

### API conventions

- All endpoints sit under `/api/v1/`, with plural nouns like `/runs` and `/leads`.
- Lists are paged and filterable. No endpoint returns an unlimited list.
- Every error has the same shape (`application/problem+json`: a title, a status and a plain detail), so the website can show a clear message.
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
7. If it uses HubSpot, see "How a project uses HubSpot" below.
8. If it has work that should start on its own, list `JobSpec`s in `AppSpec.jobs` (see "Schedules" below).

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

## Schedules

[PLAN-V6](../plan/PLAN-V6.md) Part D. A schedule starts a job on its own: "every N days or weeks, on a weekday, at a time, in Melbourne time". Plain cron can't say "every 2 weeks".

- **The time is the wall clock in the zone.** 7:00 am stays 7:00 am all year, though it is a different hour in UTC before and after daylight saving (`core/schedules/calc.py`). A time that doesn't exist runs at 3:30 instead of 2:30, and one that happens twice runs once.
- **The loop** (`core/schedules/runner.py`) checks the `core.schedules` table once a minute and starts what is on and due. It runs only in the backend that holds the run engine's lock, so there is one of it for a database. A due schedule is **claimed first** (its next time moved on, saved) and started after, so it never starts twice. A schedule **missed** while the backend was off runs once when it is back, and keeps its own days. A job **still running** is skipped, with a note on the schedule. A job that fails never stops the loop, and its error text stays in the log: the table gets a fixed sentence.
- **A project adds a job** with `JobSpec(key, project, title, start, running, default)` in `AppSpec.jobs`. `start(context)` begins the work and returns at once with the id of the run or sync it made (`JobResult(ref=...)`), or raises `JobSkipped("a reason in plain words")`. `running(context)` says whether the last start's work is still going. `default` is the schedule made at the first start, and never again: a person's edits and switch-offs stay. A schedule that is off has no next time (the table keeps the two together).
- **The core's own job** is the HubSpot sync, on by default, every day at 6:00 am (`core/schedules/core_jobs.py`). A sync a schedule starts has the trigger `schedule`.

## Sign-in

[PLAN-V6](../plan/PLAN-V6.md). One Admin account, signed in with an email or a username and a password.

- **Off on this computer** (`AUTH_REQUIRED=false`, the default), so local work and the fake backend need no password. Where it is on, **every route needs a session**, except `GET /health`, `POST /auth/login` and the Swagger pages. The guard (`core/api/guard.py`) is plain ASGI middleware with deny by default: it answers 401 `auth_required` from the headers alone, before any body is read, and an unknown path gets the same 401, so a route a project adds later is covered with no change. The fake backend takes `--auth` to turn sign-in on and make a demo Admin (its password is printed once).
- **The account is made on the server:** `uv run engine create-admin`. There is no sign-up page and no reset by email. `reset-password` and `sign-out-everyone` are commands too.
- **Passwords** are saved only as an argon2id hash (RFC 9106's low-memory settings). A new one has 14 to 256 characters, isn't common (`core/auth/common_passwords.txt`), doesn't hold the email, the username or "contour", and isn't a repeat or a simple run. A hash made with older settings is saved again at the next sign-in.
- **Sessions:** the cookie holds a random 256-bit token and the database only its SHA-256. Signed out after 2 hours idle and after 12 hours at most. "Keep me signed in" has no idle limit and lasts 14 days. The numbers are `SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS` and `SESSION_REMEMBER_DAYS`. "Last seen" is written at most once a minute.
- **The cookie** is `HttpOnly` and `SameSite=Strict`. Over HTTPS (`SESSION_COOKIE_SECURE=true`) it is `Secure` and named `__Host-contour_session`.
- **A wrong sign-in** answers 401 `invalid_credentials` with one sentence ("That email or password isn't right."), and takes as long whether the login is unknown, the account is switched off or the password is wrong.
- **Guessing is limited** (`core/auth/throttle.py`, the `LOGIN_*` settings). The first 2 wrong tries in a row are free, then each wait doubles (2 seconds up to a minute), and the 10th locks the login for 15 minutes. A try during a wait answers 429 `too_many_attempts` (with `Retry-After`), checks nothing, counts nothing and isn't logged. A login that matches no account is slowed and locked the same way, kept in memory by a hash, so the lock never says which accounts exist. One IP address may make 20 wrong tries in 15 minutes (counted from the sign-in log). The account's row is locked while a try is checked, so parallel tries can't beat the count.
- **The sign-in log** (`core.audit_log`, `GET /auth/log` for an Admin) keeps every sign-in, failure, lock, sign-out and password change, with the time and the IP address. It never holds a password, a token or a login that was typed: `audit.add_entry` refuses a detail whose name sounds like a secret.
- **In a route:** take `MaybeAuthDep` (the signed-in user, or none where sign-in is off) or `AdminDep` from `core/api/signin.py`. A 401 has the code `auth_required`, and for a session that ended it says why (`reason`: `idle`, `expired` or `ended`). Tests move time with `app.state.clock` and use a cheap hasher in `app.state.hasher` (see `tests/core/test_auth_api.py`).

## Server mode

[PLAN-V6](../plan/PLAN-V6.md) B5. The engine on a server, behind Caddy and HTTPS. Off on this laptop, where nothing changes: the engine answers to `localhost` and `127.0.0.1` and listens on `127.0.0.1`.

- **On** with `SERVER_MODE=true`. It needs `PUBLIC_ORIGIN` (the website's `https://` address, no path) and `TRUSTED_PROXIES` (Caddy's address or network, never `*`), or the backend refuses to start and names what is missing.
- **It sets up:** the host check lets the public host through (and `localhost` and `127.0.0.1`, for the container's own health check); the origin guard allows the public origin and no other; the backend listens on `0.0.0.0` inside its container; sign-in is required; the cookie is `Secure` and `__Host-` named; the backend doesn't migrate at start (a one-off `engine migrate` runs first); the Swagger pages aren't served (`engine openapi` still writes the contract).
- **Whose word is taken for a client's IP address:** only a connection from `TRUSTED_PROXIES`, by uvicorn's `forwarded_allow_ips`. Caddy adds the real address at the end of `X-Forwarded-For`, and what a client writes before it is not believed. On this computer no header is believed at all.
- **Nothing is quietly overruled:** `AUTH_REQUIRED=false`, `SESSION_COOKIE_SECURE=false` or `AUTO_MIGRATE=true` together with server mode is refused.

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

## Windows note

psycopg's async mode can't use Windows' default event loop. `core/runtime.py` switches to the selector loop. Always start the backend with `uv run engine serve`, and keep the same fix at the top of `tests/conftest.py`. A script of your own needs it too: `asyncio.run(main(), loop_factory=loop_factory())`.

## Writing

Documents follow the plain-words rules in [../CLAUDE.md](../CLAUDE.md): answer first, short sentences, and **TBC** for anything not confirmed.
