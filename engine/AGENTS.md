# Agent guide

How to work in this code. It applies to people and to AI coding helpers like Claude Code. Read it before changing anything.

- **What this is:** the research engine and website for Contour's Lead Finder. The build plan is [PLAN.md](../PLAN.md).
- **The rules it applies:** [COMPANY.md](../projects/leads/criteria/COMPANY.md), turned into `backend/apps/lead_finder/rules/criteria.yaml`.
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
| Fast tests (no database) | `uv run pytest -m "not integration"` |
| All tests (needs the database) | `uv run pytest` |
| Lint and format | `uv run ruff check .` and `uv run ruff format .` |
| Type checks | `uv run mypy` |
| New database change | `uv run alembic revision --autogenerate -m "what changed"`, then read and fix the file |

Swagger is at http://127.0.0.1:8000/docs while the backend runs. All endpoints sit under `/api/v1/`.

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
    memory/            pgvector memory and FastEmbed
    hubspot/           the HubSpot import (export file now, API later)
  apps/
    lead_finder/       the first project
      app.py           tells the core this project's name, endpoints and rules
      api.py           the /api/v1/lead-finder endpoints
      rules.py         checks the rules files
      rules/           criteria.yaml, queries.yaml, hubspot_map.yaml
  tests/               fast tests, and integration tests marked `integration`
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

### Working with Claude (from Phase 1)

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

psycopg's async mode can't use Windows' default event loop. `core/runtime.py` switches to the selector loop. Always start the backend with `uv run engine serve`, and keep the same fix at the top of `tests/conftest.py`.

## Writing

Documents follow the plain-words rules in [../CLAUDE.md](../CLAUDE.md): answer first, short sentences, and **TBC** for anything not confirmed.
