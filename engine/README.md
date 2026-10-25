# Contour engine

The research engine and website for the Lead Finder. The build plan is [PLAN.md](../PLAN.md). How to work in this code is in [AGENTS.md](AGENTS.md).

**Status:** Phase 0 (set up). The backend runs with the database, memory and the HubSpot export. It doesn't research companies yet.

## Start it

1. Start Docker Desktop.
2. In `engine/`, check that `.env` exists. If not, copy `.env.example` to `.env` and set a database password.
3. Start the database: `docker compose up -d`
4. In `engine/backend/`, install once: `uv sync`
5. Start the backend: `uv run engine serve`
6. Open Swagger: http://127.0.0.1:8000/docs

The backend applies any new database changes when it starts.

## Load the HubSpot export

From `engine/backend/`:

```
uv run engine import-hubspot ../../projects/leads/research/COMPANIES.xlsx
```

Running it again updates the same companies and never duplicates them. If the file has a Contacts sheet, it's skipped, because it holds personal data.

## Test

From `engine/backend/`:

- Fast tests, no database needed: `uv run pytest -m "not integration"`
- All tests, database needed: `uv run pytest`

## Stop it

- Backend: Ctrl+C.
- Database: `docker compose stop`. The data stays in a Docker volume.
