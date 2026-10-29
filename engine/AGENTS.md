# Agent guide

How to work in this code. It applies to people and to AI coding helpers like Claude Code. Read it before changing anything.

- **What this is:** the research engine and website for Contour's Lead Finder. The build plans are in [plan/](../plan/): [PLAN-V1.md](../plan/PLAN-V1.md) built it, and [PLAN-V2.md](../plan/PLAN-V2.md) applies the new company criteria.
- **The rules it applies:** [Criteria_v1.md](../projects/leads/criteria/Criteria_v1.md) today (version 2 is a draft: [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md)), turned into `backend/apps/lead_finder/rules/criteria.yaml`.
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
| Load a HubSpot export | `uv run engine import-hubspot ../../projects/leads/research/COMPANIES.xlsx` |
| Research one company (costs money) | `uv run lead-finder research "Culture Amp" --city Melbourne` |
| Run the test set of 10 companies (costs money) | `uv run lead-finder testset --yes` |
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
    hubspot/           the HubSpot import, matching (matching.py) and company profiles (profiles.py)
    runs/              the run engine: start, stop, resume, live events, caps (manager.py, events.py, budget.py)
    prefs/             the settings a person can change on the Settings page
  apps/
    lead_finder/       the first project
      app.py           tells the core this project's name, endpoints and rules
      api.py           the /api/v1/lead-finder endpoints (also api_leads.py, api_runs.py, api_watchlist.py)
      runs.py          the four kinds of run: find new leads, watchlist, typed companies, test set
      steps/           the run's steps: plan, discover, merge, choose, company (research one), graph (LangGraph)
      options.py       what the Start page offers (cities, areas, signs, limits)
      lead_store.py    lead filters, sorting, facets, the map and the CSV
      similar.py       look-alikes; watchlist.py the HubSpot watchlist; testing.py the test set report
      rules.py         checks the rules files
      rules/           criteria.yaml, queries.yaml, hubspot_map.yaml
      research.py      researches one company: memory, search, form, gap check, save
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
frontend/
  openapi.json         the API contract, written by `uv run engine openapi`
  src/api/             the typed API client and the data hooks
  src/shell/           the app frame: sidebar, breadcrumbs, Ctrl+K menu
  src/components/      shared parts: table, map, badges, money; ui/ is shadcn, restyled
  src/apps/lead-finder/ one folder per page: start, run, results, lead, admin
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
- Only the local website (`http://localhost:5173`) may call the API.

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
5. Add its pages in `frontend/src/apps/<name>/` (from Phase 4), and its tests in `backend/tests/<name>/`.

The core doesn't change.

## Safety

- Secrets live only in `engine/.env`. Never in code, logs, tests or git.
- No contact names, emails or phones are stored or sent to Claude. The HubSpot import skips any Contacts sheet.
- Read, don't scrape. Property Daily stays off until its terms allow a program to read it.
- Nothing is written to HubSpot unless a person clicks "Send to HubSpot".
- The database listens on `127.0.0.1` only.

## Windows note

psycopg's async mode can't use Windows' default event loop. `core/runtime.py` switches to the selector loop. Always start the backend with `uv run engine serve`, and keep the same fix at the top of `tests/conftest.py`. A script of your own needs it too: `asyncio.run(main(), loop_factory=loop_factory())`.

## Writing

Documents follow the plain-words rules in [../CLAUDE.md](../CLAUDE.md): answer first, short sentences, and **TBC** for anything not confirmed.
