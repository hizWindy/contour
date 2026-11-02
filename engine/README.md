# Contour engine

The research engine and website for the Lead Finder. The build plans are in [plan/](../plan/). How to work in this code is in [AGENTS.md](AGENTS.md).

Last updated: 27 Oct 2026. **TBC** means not confirmed yet.

**Status:** Phases 0 to 4 are built and tested with saved sample answers (Phases 2 to 4 on the branch `phase-2-4`). You can start runs, watch them and review the leads in the website. No run has used the real Claude yet: that waits on an API key, so real costs and results are **TBC**.

## Start it

1. Start Docker Desktop.
2. In `engine/`, check that `.env` exists. If not, copy `.env.example` to `.env` and set a database password.
3. Start the database: `docker compose up -d`
4. In `engine/backend/`, install once: `uv sync`
5. Start the backend: `uv run engine serve`
6. Open Swagger: http://127.0.0.1:8000/docs

The backend applies any new database changes when it starts.

Then start the website. In `engine/frontend/`, install once with `npm ci`, then run `npm run dev` and open http://localhost:5173.

## Use the website

- **Start a run:** pick the cities, areas, signs and how far back to look. The page shows the likely and the highest cost before you start. Three kinds of run: find new leads, the HubSpot watchlist, or companies you type in.
- **Runs:** watch a run live, stop it, or resume one that was cut off.
- **Results:** every lead in a table, or as a list beside a map. Filter, sort and download a CSV. Click a lead to open its card in a side panel.
- **A lead card:** the result rule by rule, the facts with their sources, HubSpot matches and look-alikes. Watch, reject or re-check it from there. Sending to HubSpot comes in Phase 5.
- **Admin:** costs by day, the search log, memory, the HubSpot upload, the rules, the test set and the settings.

The HubSpot watchlist stays switched off until Levi approves sending HubSpot company names to Claude. Then set `HUBSPOT_NAMES_TO_CLAUDE_OK=true` in `engine/.env` and restart the backend.

## Signal Hire (staff numbers, off for now)

Signal Hire can fill a staff number that the research and HubSpot both missed. It counts the people it has on file at the company in one city, and the number saved is that count times 2 (**TBC**, `size.headcount_tool_multiplier` in `criteria.yaml`). It never changes a number that is already there, and an error is only a line in the lead's problems. The lead card shows "From Signal Hire" when it filled one in.

It is **off**. It switches on only when both of these are true:

1. `SIGNALHIRE_API_KEY` is set in `engine/.env`. Signal Hire's support must switch the Company API on for the account first.
2. `headcount_tool` is listed in `size.staff_sources` in `backend/apps/lead_finder/rules/criteria.yaml`. It is left out until the test of 5 companies ([PLAN-V3](../plan/PLAN-V3.md) steps A4 and B1) shows its counts can be trusted.

To switch it off again, take `headcount_tool` out of that list, or empty the key, and restart the backend. Companies from the HubSpot watchlist are not sent to it unless `HUBSPOT_NAMES_TO_SIGNALHIRE_OK=true` is set in `engine/.env`, because their names would go to another company.

To read its numbers for one company by hand (1 company credit), from `engine/backend/`: `uv run --no-sync lead-finder headcount "Culture Amp" --city Melbourne --yes`.

## Try it without Claude

The fake backend is the real engine with saved sample answers instead of Claude. It costs nothing and needs no API key. From `engine/backend/`:

```
uv run python -m tests.e2e.serve
```

It uses its own database (`leadfinder_e2e`), which it wipes on every start, and loads the HubSpot export. A run finds made-up companies named "Sample ...", slowly enough to watch. Add `--hubspot-ok` to try the watchlist too. Then start the website as above.

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

From `engine/frontend/`: `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.

Tests use saved sample answers instead of Claude, so they're free. They can't show what a real run costs or finds: that needs the first live runs (**TBC**).

## Stop it

- Backend and website: Ctrl+C.
- Database: `docker compose stop`. The data stays in a Docker volume.
