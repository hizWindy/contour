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
- **A lead card:** the result rule by rule, the facts with their sources, HubSpot matches and look-alikes. Watch, reject or re-check it from there, or send it to HubSpot after a preview (writing is off until the key has write access).
- **Admin:** costs by day, the search log, memory, the HubSpot connection (permissions, syncs, writes, and the export upload as a backup), the rules, the test set and the settings.
- **Companies:** every client and prospect in HubSpot, with what we know about each in a side panel. The prep box at the top ("Who are you calling?", or press /) opens a call script for a person, or a cold call. Call scripts are off until an Admin switches on "Call prep is on" in Admin, Settings; until then the panel and the facts still show. People and calls appear once HubSpot's key can read contacts.
- **Schedules (in Admin):** the Lead Finder every 2 weeks (off until you switch it on, because each run costs money) and the daily HubSpot copy. Switch one on or off, change when it runs, or start it now.

The HubSpot watchlist stays switched off until Levi approves sending HubSpot company names to Claude. Then set `HUBSPOT_NAMES_TO_CLAUDE_OK=true` in `engine/.env` and restart the backend.

## Signal Hire (company details, staff numbers and senior people)

Signal Hire is a main source for the data it is best at. For each company it knows, it gives:

- **Company details** (1 company credit): the checked name, website, industry, LinkedIn page, offices with the head office, and the staff in all. Claude gets them as hints. A copy is saved for a month, so a company is paid for once a month. A run reads at most 20 new ones (`SIGNALHIRE_MAX_CREDITS_PER_RUN`, **TBC**).
- **A staff number** for the office's city: the people it has on file there, times 2 (**TBC**, `size.headcount_tool_multiplier` in `criteria.yaml`). It costs 1 search from the daily quota.
- **Senior people:** names and job titles only, never an email or a phone. It costs 1 search.

**The first source in the rules' list wins, and the others stay on the lead card.** For staff the order is HubSpot, Signal Hire, LinkedIn (doubled), then the web research (`size.staff_sources`). For the other data it is `data_sources` in `criteria.yaml`. The lead card names the source of each fact and shows what the other sources said. It raises a flag when staff numbers are more than 2 times apart (**TBC**, `conflicts.staff_gap_ratio`), when two websites or names differ, or when Signal Hire lists no office in the lead's city. An error is only a line in the lead's problems.

It is **on** (since 2 Nov, before the test of 5 companies in [PLAN-V4](../plan/PLAN-V4.md), so the multiplier is a guess). It needs both of these:

1. `SIGNALHIRE_API_KEY` is set in `engine/.env`.
2. `headcount_tool` is listed in `size.staff_sources` in `backend/apps/lead_finder/rules/criteria.yaml`.

Signal Hire's Company API is off for our account. While it is off, no company details are read and no credit is spent, and the company name can't be checked. `size.headcount_tool_name_check` is `auto`: it counts under the name as typed while the Company API is off, and turns strict by itself once support switches it on. A short or common name can count other companies' people, so the lead card says when the name was not checked. Ask support@signalhire.com to switch the Company API on.

To switch all of it off, take `headcount_tool` out of that list, or empty the key, and restart the backend. To switch off one kind of data, take `headcount_tool` out of that row of `data_sources`. Companies from the HubSpot watchlist are not sent to it unless `HUBSPOT_NAMES_TO_SIGNALHIRE_OK=true` is set in `engine/.env`, because their names would go to another company.

To read its numbers for one company by hand (1 company credit), from `engine/backend/`: `uv run --no-sync lead-finder headcount "Culture Amp" --city Melbourne --yes`.

## Try it without Claude

The fake backend is the real engine with saved sample answers instead of Claude. It costs nothing and needs no API key. From `engine/backend/`:

```
uv run python -m tests.e2e.serve
```

It uses its own database (`leadfinder_e2e`), which it wipes on every start, and loads the HubSpot export. A run finds made-up companies named "Sample ...", slowly enough to watch. One lead, "Sample Headcount", is there from the start: a fake Signal Hire gives it company details, senior people and a staff number far from the research's own, so you can see the lead card's source labels, its flag and Signal Hire's record. No key is used, and the Claude and Signal Hire keys are blanked. Add `--hubspot-ok` to try the watchlist too. Then start the website as above.

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

## Put it on a server

Contour HQ can run on a server in Docker, behind HTTPS and a sign-in. The files and the run book are in [deploy/](deploy/README.md). It is not for this computer: the steps above stay as they are.

## Stop it

- Backend and website: Ctrl+C.
- Database: `docker compose stop`. The data stays in a Docker volume.
