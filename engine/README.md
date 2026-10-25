# Contour engine

The research engine and website for the Lead Finder. The build plan is [PLAN.md](../PLAN.md). How to work in this code is in [AGENTS.md](AGENTS.md).

**Status:** Phase 1 (research one company) is built and tested with saved sample answers. The first real run is waiting on a Claude API key.

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

## Research a company

This costs money. It's about US$1 per company (**TBC**: the first real runs will measure it), and never more than the cap, US$2.50 by default.

1. Add your key to `engine/.env`: `ANTHROPIC_API_KEY=...`. Set a spend limit in the Anthropic Console first.
2. From `engine/backend/`, research one company: `uv run lead-finder research "Culture Amp" --city Melbourne`
3. Or in Swagger: `POST /api/v1/lead-finder/research` with `{"company": "Culture Amp", "city": "Melbourne"}`.
4. Run the test set of 10 companies: `uv run lead-finder testset --yes`. Add `--twice` to run it again and see memory make the second round cheaper.

Every Claude request, with its searches and cost, is in `GET /api/v1/searches`. Saved leads are in `GET /api/v1/lead-finder/leads`.

Use public companies until Levi approves using HubSpot company names with Claude.

## Test

From `engine/backend/`:

- Fast tests, no database needed: `uv run pytest -m "not integration"`
- All tests, database needed: `uv run pytest`

Tests use saved sample answers instead of Claude, so they're free.

## Stop it

- Backend: Ctrl+C.
- Database: `docker compose stop`. The data stays in a Docker volume.
