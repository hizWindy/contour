# Lead Finder build plan

The step-by-step plan to build the Company Lead Finder ([LEADS.md](projects/leads/LEADS.md)). It has two parts: a research engine that finds and checks companies, and a small website to run it and send good leads to HubSpot.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young.
- **Last updated:** 2026-10-27. **TBC** means not confirmed yet.
- **Runs on your computer for now.** No hosting yet.
- **No timer yet.** You start every run by hand, from Swagger or the website, while we test the engine.
- Nothing reaches HubSpot unless a person clicks.

## In short

- **What we build:** the research engine (the backend that finds and checks companies) and a website to start research, review results and send leads to HubSpot.
- **How it runs:** you start a run by hand. Results show in the backend first, then on the website. You click "Send to HubSpot" for each good lead. Nothing is sent automatically.
- **Memory:** pgvector remembers everything the engine reads. It searches less, matches HubSpot better and can find look-alike companies.
- **Rules and reuse:** the criteria live in settings files, so Levi's changes need no code change. The engine's core is shared, so a future project adds its own folder and reuses the rest.
- **Order:** the engine and its endpoints first, tested in the backend. Then HubSpot matching, the website and the HubSpot button.

## Tech stack

Everything runs on your computer. Exact versions are locked when we install them in Phase 0.

### Already on your computer (checked 25 Oct 2026)

| Tool | Version | Used for |
|---|---|---|
| Python | 3.12.10 | The backend. Python 3.14 is also installed, but not every library supports it yet. |
| uv | 0.12.15 | Installs Python packages and runs the backend |
| Node.js and npm | 26.5.0 and 11.17.0 | The website |
| Docker | 29.6.2 | Runs the database. Docker Desktop is installed but not running now, so start it first. |
| PostgreSQL | 18.4 | Installed, but it has no pgvector, so we don't use it. If it's running, it holds port 5432, so the Docker database uses port 5433. |
| Git | 2.55.0 | Version history |

### Database and memory

| Tool | What it does |
|---|---|
| PostgreSQL 18 with pgvector, from the Docker image `pgvector/pgvector:pg18` | The database. pgvector adds search by meaning. |
| pgvector (Python package) | Lets the backend save and search memory |
| FastEmbed, with the BAAI/bge-small-en-v1.5 model | Turns each piece of text into a list of 384 numbers that captures its meaning. Free, no API key, and it runs on your computer. The model downloads once. |

### Backend

| Tool | What it does |
|---|---|
| FastAPI, with Uvicorn | The endpoints, and the Swagger page at `/docs` where you can try them |
| Pydantic and pydantic-settings | Checks every request and every answer form. Reads secrets from `.env`. |
| SQLAlchemy 2, with Alembic and psycopg 3 | Talks to Postgres. Alembic changes tables safely. |
| PyYAML | Reads the rules files |
| sse-starlette | Sends live run progress to the website |
| httpx and tenacity | Web requests, and retries when one fails |
| rapidfuzz and tldextract | Matches company names and website domains against HubSpot |
| hubspot-api-client and openpyxl | HubSpot's official library, and reading HubSpot export files |
| pytest, pytest-asyncio and respx | Tests. They use saved sample answers, so they don't spend money. |
| Ruff and mypy | Code style and type checks |
| pre-commit | Runs Ruff, mypy and the fast tests before each commit |

### Research engine

| Tool | What it does |
|---|---|
| Anthropic Python SDK | Talks to Claude directly |
| Claude Opus 5.5 (`claude-opus-5-5`) | The model for every step, to start |
| Claude web search and web fetch | Search and read web pages. They run on Anthropic's side, so there's nothing to host. |
| Structured outputs | Claude fills the answer form in a fixed shape. Pydantic checks it. |
| Prompt caching | The fixed instructions and rules are cached, so re-reading them costs much less |
| LangGraph, with its Postgres saver | Runs the steps in order and the workers side by side. Saves progress, so a run can continue after a crash. |

### Website

| Tool | What it does |
|---|---|
| React 19, Vite and TypeScript | The website, and a fast local server while building |
| shadcn/ui, with Tailwind CSS 4 | Ready-made parts: tables, buttons, forms, dialogs |
| React Router | Moves between pages |
| TanStack Query | Loads and refreshes data from the API |
| TanStack Table | The results table, with filters and sorting |
| React Hook Form, with Zod | Forms that check what you type |
| React-Leaflet, with OpenStreetMap | The map. Free for light use, with credit shown. |
| Recharts (shadcn charts) | Cost and results charts |
| openapi-typescript | Builds the website's data types from the API, so both sides always match |
| Vitest, ESLint and Prettier | Tests and code style |
| Fontsource | Serves our two fonts from the app itself: Titillium Web and IBM Plex Serif |
| Lucide | The icon set shadcn uses, drawn with a 1.5px line |

### Working tools

- **Claude Code**, guided by `AGENTS.md` (the backend coding practices, and how to add a project) and `DESIGN.md` (the design system).
- **GitHub:** the existing private repo.

### Not using now

| Not using | Why |
|---|---|
| DigitalOcean, or any hosting | Not yet. It runs on your computer. |
| The PostgreSQL installed on your computer | It has no pgvector. The Docker one does. |
| LangChain | LangGraph is enough. Calling Claude directly keeps all its features: web search, caching and cost limits. |
| Redis, Celery or Arq (job queues) | Not needed for one user. Runs go in the background inside the backend. |
| Voyage AI | The memory provider Anthropic's docs point to. It's paid and sends text to another service, so we use it only if the free local model isn't good enough. |
| Paid search services (Tavily, Exa, Brave) | Claude's own web search comes first. We add one only if a test shows Claude misses Australian results. |
| LangSmith or Langfuse | They send run data to another service. Our own search log comes first. |
| A Property Daily connector | Off until its terms allow a program to read it |
| A login | Not needed while it runs only on your computer |
| A timer (APScheduler) | Not yet. Runs start by hand while we test. |

## How it works

```
"Run", from Swagger or the website
  → 1. Plan: our code splits the job into slices
  → 2. Search: check memory first, then Claude workers search the web, several at once
  → 3. Check: fill gaps, check sources, match HubSpot, apply the rules
  → 4. Save and show: database and memory, then the website
  → You click "Send to HubSpot"
  → HubSpot: the company, a note, and the "AI suggested" list
```

1. **Plan (our code).** It splits the job into slices: 4 triggers × 3 cities = 12 discovery slices, plus watchlist batches of 20 companies. Each company is searched from three angles: property (lease, move), people (hiring) and money (contracts, growth).
2. **Search (Claude).**
   - First, the engine checks memory for what it already knows, so it doesn't pay to find the same thing twice.
   - Each slice gets one worker: one Claude request with web search and web fetch. Workers run at the same time, starting with 2, because new API keys have low rate limits (**TBC**: check yours).
   - Each worker returns short notes with source links. A second small step turns the notes into the answer form ([PARAMETERS.md](projects/leads/research/PARAMETERS.md) section 2).
3. **Check (our code, plus small Claude steps).**
   - **Merge:** the same company found twice becomes one record.
   - **Skip:** companies already sent, with an open deal, or with a deal dissolved in the last 12 months.
   - **Gap check:** if office size, city, trigger or source is missing, one more targeted search, then stop.
   - **Source check:** every fact needs a working link. Sources rank: Property Daily, ASX and official news, other news, job ads. Low-quality sites are dropped.
   - **HubSpot match:** see below.
   - **Rules and score:** fixed code applies [Criteria_v1.md](projects/leads/criteria/Criteria_v1.md). Each company gets Pass, Director review, Watch or Drop, and a score.
4. **Save and show.** Everything goes into the database, including every search and its cost. Each source note and company profile also goes into memory. Claude writes the lead card: what happened, why it fits, a role to contact and an opening line.

## Memory (pgvector)

pgvector stores each piece of text as a list of numbers that captures its meaning. Similar meanings get similar numbers, so the engine can search by meaning, not just exact words.

Example: a search for "dairy company moving offices in Melbourne" finds a note that says "Mainland Dairy relocating its Melbourne head office".

**What goes in**
- **Source notes:** a summary of each page the engine read, with its link, date and company.
- **Company profiles:** a short description of each company: what it does, its size and its city.
- **Lead outcomes:** sent or rejected (and why), and useful or not.

**What it's used for**
1. **Fewer paid searches:** the engine checks what it already knows before searching again.
2. **Better HubSpot matching:** a company with a different name, like "Lactalis-Mainland Dairy" and "Mainland Dairy", still shows as "Possible match".
3. **Look-alikes:** "find companies like this one", for example like the 5 Property Daily deals or Levi's past wins.
4. **Learning from feedback (later):** new leads that look like rejected ones get flagged.

**Privacy:** FastEmbed makes the numbers on your computer, so no text goes to another service.

## Built for future projects

The Lead Finder is the first project on a shared core. A future project reuses the core and adds only its own parts.

| Shared core, built once | Each project's own part |
|---|---|
| Claude, web search and fetch, caps and cost tracking | Its rules, search templates and prompts |
| Runs, live progress and the search log | Its answer form and steps |
| Memory (pgvector) | Its own tables, in its own schema |
| HubSpot import, matching and sending | Its HubSpot field map |
| The website shell: layout, run monitor, search log and settings | Its own pages |

**How a future project plugs in**
1. Add a folder in `backend/apps/`, with its rules, prompts, answer form and steps.
2. Add one file there that tells the core the project's name, steps and rules folder.
3. Add its pages in `frontend/src/apps/`.

The core doesn't change. `AGENTS.md` keeps this checklist.

- **Database:** shared tables live in a `core` schema, and each project's tables in its own schema, like `lead_finder`. A schema is a named group of tables, so projects never clash.
- **Endpoints:** shared ones sit at the top level, like `/runs` and `/memory`. Each project's endpoints sit under its own name, like `/lead-finder/...`.

## Testing in the backend

You can test the engine before the website exists, in three ways:

1. **Swagger (`/docs`):** call `POST /lead-finder/research` with a company name, and read the lead card it returns. Then call `POST /runs` for a small run, like one city and one trigger.
2. **Automatic tests (`uv run pytest`):** they use saved sample answers, so they're free and quick. They check the rules, the scoring, the HubSpot matching, memory search and the answer form.
3. **The test set (`POST /tests/run`):** real searches on known cases, like the 5 Property Daily deals. It costs money, so run it after a change to a prompt or a rule.

## Ready for later

- **HubSpot:** matching and sending are built against the export file and a HubSpot test account. When Contour's token arrives, switching to the live HubSpot API is one setting.
- **A timer:** every run starts through `POST /runs`. A timer added later just calls that endpoint on a schedule, with no change to the engine.

## Changing the rules

The engine's code is kept separate from the Lead Finder's rules, so a change from Levi means editing a file, not code.

| When this changes | Edit this | Code change? |
|---|---|---|
| Levi changes a rule, like 80 staff instead of 100 | `apps/lead_finder/rules/criteria.yaml` | No |
| A new trigger, or new search wording | `apps/lead_finder/rules/queries.yaml` | No |
| Which HubSpot field gets what | `apps/lead_finder/rules/hubspot_map.yaml` | No |
| A different model for one step | Settings | No |
| From the HubSpot export file to the live HubSpot API | Settings, once we have a token | No |
| A new fact on the lead card | The answer form, and `hubspot_map.yaml` | Small |

Every run saves which version of the rules it used, so old results stay explainable.

## Matching with HubSpot

Every company is checked against HubSpot before it shows as a lead.

- **HubSpot data:** the export you pulled ([COMPANIES.xlsx](projects/leads/research/COMPANIES.xlsx): 100 companies, 12 deals). Later, a read-only sync from the HubSpot API.
- **How it matches, in order:**
  1. Same website domain, like `kyndryl.com`.
  2. Same cleaned name, with "Pty Ltd", "Limited" and punctuation removed.
  3. A close name, or a similar profile in memory, in the same city. This shows as "Possible match" for you to confirm.
- **Labels on the website:** New, In HubSpot (with the owner), Open deal (never suggest), Dissolved deal (wait 12 months) or Possible match.
- **HubSpot's own formats:** state as VIC, SA or WA, industry from HubSpot's list, and the website as a plain domain. The export has messy states, like "South Australia" and "5000", so we write clean values.
- **When you click "Send to HubSpot":**
  - A preview shows exactly what will change. Nothing is written until you confirm.
  - A new company is created. An existing one gets a note, and only its empty fields are filled. We never overwrite what a person typed.
  - The company joins an "AI suggested" list.
  - Every send is logged, and clicking twice never makes a duplicate.
- **Needed from the HubSpot admin (TBC):** a few new company fields (AI suggested, trigger, trigger date, source link, score, result, research date) and a token. HubSpot now calls private apps "legacy apps", and only a super admin can make one. It should belong to a permanent Contour admin, because the token stops working if its creator is removed.
- **Office details:** the export has lease expiry and staff per office. Where these live in HubSpot is **TBC**.

## Website pages

1. **Start research:** a map of Melbourne, Adelaide and Perth. Click a city to include it, then pick the area (CBD, inner suburbs or the whole city). Sydney shows as "Director review". Choose the triggers, how far back (7 or 30 days) and the mode (discovery, watchlist or one company). It shows the estimated cost and the cap before you press Run.
2. **Watch a run:** live progress (slices done, companies found, searches, cost so far) and a Stop button.
3. **Results:** a table with filters (result, city, trigger, score, industry, office size, HubSpot status, date), search and sort. A map of the results, coloured by result. Export to CSV.
4. **Lead card:** each fact with its source link and label (confirmed, estimated or guessed). Why it passed or failed, rule by rule. The HubSpot match, look-alike companies, a role to contact and an opening line. Buttons: Send to HubSpot, Reject (with a reason), Watch, Re-check, and Useful or Not useful.
5. **Admin:** run history with cost, the search log, memory search, watchlist import, the rules in use (read-only), test set scores, and settings (caps and models).

## Design system (website)

How the website looks and behaves. **Phase 0 copied this section into [engine/DESIGN.md](engine/DESIGN.md) on 25 Oct 2026. Update that file, not this section.**

### Direction

- **Feel:** calm, precise and quietly premium, like Contour's own website. It's a tool for making decisions, not a showpiece.
- **Built on shadcn/ui,** with every part restyled through our tokens. Nothing ships with shadcn's default look.
- **Register:** Calm, from Khair's Brand DNA, because this is a professional data tool. We use the DNA's structure with Contour's colours. Its cut-corner signature stays out, because this is Contour's tool.
- **Dials:** design variance 3, motion 2, density 3. Density sits at the top of Calm, because tables are the content.
- **One exception:** the DNA's Calm layout is a single 960px column. A data tool needs a sidebar and wide tables, so content goes up to 1440px.

### Principles

1. **Show the work.** Every fact has a source link and a label. Every result says why, rule by rule.
2. **Always show status.** Runs show live progress and cost. Lists show when they were last updated.
3. **Prevent mistakes.** The cost shows before you run, and a preview shows before you send. Reject and Watch can be undone.
4. **Show less, reveal more.** The table comes first, then a side panel, then the full card. Advanced options stay folded away.
5. **Same thing, same look.** Each result has one badge, and each action has one place, on every page.

### Colour

Taken from Contour's website (checked 25 Oct 2026). Contour should confirm them (**TBC**).

| Role | Name | Hex | Used for |
|---|---|---|---|
| Light surface | Stone | `#E5E8DB` | The sidebar and hover. Lighter steps: `#F4F5EF` for the page, `#FBFBF8` for cards and inputs. |
| Dark surface | Ink | `#26231B` | All text, and the dark-mode background. `#5C584E` for quieter text. |
| Accent | Navy | `#233A56` | Only primary buttons, selected rows, the focus ring and live progress |
| Neutral | Sand | `#BBA087` | Chart neutrals and the Watch badge. Never text. |

| State | Name | Hex | Used for |
|---|---|---|---|
| Success | Olive | `#5F693A` | Pass |
| Warning | Ochre | `#A8742A` | Director review, and cost close to its cap |
| Danger | Terracotta | `#B4412D` | Errors, failed runs, and cost over its cap |

Olive and Terracotta come from Contour's site. Ochre is a muted step of Contour's orange.

**Rules**
- Surfaces do most of the work. Navy appears only where you act, or where something is live.
- Navy, Sand and the state colours are fills, never body text. A badge puts a dark step of its colour on a light tint of the same colour.
- Text is Ink on Stone, or Stone on Ink. All text passes 4.5:1 contrast: Ink on the page is about 14:1, quieter text about 6.5:1, and light text on Navy about 11:1.
- Form field borders use `#8F937F`, which passes 3:1, so fields are easy to see. Plain dividers can be lighter.
- One accent, Navy. No gradients.
- **Dark mode** follows your computer's setting. Ink becomes the background and Stone the text. Navy steps up to `#8EA5C3`, so it stays visible.

**Results and labels**

| Result | Colour | Icon |
|---|---|---|
| Pass | Olive | Circle with a tick |
| Director review | Ochre | Person with a tick |
| Watch | Sand | Eye |
| Drop | Grey outline | Circle with a minus |

HubSpot labels (New, In HubSpot, Open deal, Dissolved deal, Possible match) use plain outline badges with an icon. Colour is saved for results.

### Type

- **Titillium Web** for all text, in two weights: Regular (400) and SemiBold (600). It has no 500 weight.
- **IBM Plex Serif** for three moments only: empty states, the first-run welcome, and quotes from sources on the lead card.
- Two typefaces in total. Fontsource serves both from the app, and text shows in a system font until they load.
- Contour's own website uses Yellix, a paid font. This tool uses Titillium Web, which is free.
- Titillium Web's digits are all the same width (checked 25 Oct 2026), so numbers line up in tables. Numbers are right-aligned and show their unit: m², $ or staff.

| Use | Size | Weight |
|---|---|---|
| Page title | 1.5rem (24px) | 600 |
| Section title | 1.125rem (18px) | 600 |
| Reading text, like the lead card summary | 1rem (16px) | 400 |
| Tables, forms and menus | 0.875rem (14px) | 400, and 600 for headers |
| Labels and captions | 0.8125rem (13px) | 400 |

Sizes are in rem, so browser zoom works. Nothing is smaller than 13px. Sentence case everywhere, with no all-caps labels.

### Space, shape and depth

- **Spacing** on an 8-point scale: 8, 16, 24, 32, 48 and 64px.
- **One radius:** 10px (shadcn's `--radius: 0.625rem`). Small parts use shadcn's smaller steps. No pills: buttons and badges are never fully round.
- **Flat surfaces,** separated by 1px borders. Only things that float, like menus and dialogs, get a soft shadow.
- **Table rows** are 48px, or 40px in compact mode, with a toggle in the table toolbar.

### Layout

- **App frame:** a left sidebar that folds to icons, a top bar with breadcrumbs and the command menu, then the page.
- **Width:** up to 1440px. Tables and the map can use the full width.
- **List and detail:** clicking a result opens its lead card in a side panel, so the list stays in view. Each card also has its own page and link.
- **Map page:** the map and the list sit side by side, with a divider you can drag.
- **Screens:** built for desktop (1280px and up), and works on a tablet. Phones aren't a goal yet.

### shadcn parts

| Need | shadcn part |
|---|---|
| App frame | Sidebar, Breadcrumb |
| Jump anywhere, or run an action (Ctrl+K) | Command |
| Results table | Data Table, built on TanStack Table |
| Filters | Popover with Command for multi-select, Calendar for dates, Toggle Group |
| Lead card | Sheet, Tabs, Collapsible for the rule-by-rule reasons, Hover Card for source previews |
| Send to HubSpot | Alert Dialog, showing the preview |
| Feedback after an action | Sonner toasts, with Undo |
| Run progress | Progress, with a static live dot |
| Forms | Field, Input, Select and Checkbox, with React Hook Form and Zod |
| Charts | Chart, built on Recharts |
| Map and list split | Resizable |
| Hints | Tooltip, Kbd |

### Motion

- **One curve:** `cubic-bezier(0.4, 0, 0.2, 1)`. 150ms for small changes like hover, 250ms for panels and dialogs.
- **Hover** changes the border, background or opacity. Never the size or the shadow.
- **Loading:** content fades in. No shimmer and no bouncing dots, so shadcn's Skeleton is used without its pulse.
- **A live run** shows a filling progress bar and a static dot. Nothing pulses or loops.
- **Reduced motion:** if your computer asks for it, motion turns off.

### Icons

- Lucide, the set shadcn uses: outline, a 1.5px line, 16px in tables and buttons, 20px in the sidebar.
- An icon always has a label or a tooltip.

### Words on screen

- Plain words, sentence case, one idea per line. Buttons say what happens: "Start run", "Send to HubSpot", "Reject".
- Estimates look like estimates: "about 3,000 m²", with the label "estimated".
- Errors say what happened and what to do next: "HubSpot didn't answer. Nothing was sent. Try again in a minute."
- Empty states use the serif voice: "No leads yet. Start a run to see companies here."
- No em dashes, no hype, and no "AI-powered".

### Accessibility (WCAG 2.2 AA)

- Text contrast is at least 4.5:1, in light and dark mode.
- A visible 2px Navy focus ring, with a 2px gap, on everything you can tab to.
- Everything works by keyboard. Ctrl+K opens the command menu, J and K move through results, Enter opens one, and Esc closes it.
- Status is never shown by colour alone. Every badge has an icon and a word.
- Click targets are at least 24 × 24px, and buttons are 36px tall.
- Icons and map pins have text for screen readers, and tables use real column headers.

### Banned (no AI slop)

- Gradients, glow, glassmorphism and blur.
- Pills: fully round buttons or badges.
- Sparkle icons, emoji, robot mascots, and words like "magic" or "AI-powered".
- shadcn's default look shipped as is: grey on white, the default font, untouched.
- Hover that grows or adds a shadow. Bouncing, pulsing or looping animation. Shimmer.
- A wall of big vanity numbers. Every number on screen helps a decision.
- Centred body text. Text is left-aligned, and numbers are right-aligned.
- A third typeface, or Navy as body text.
- Colour as the only signal.
- Lorem ipsum, or made-up data on real screens.

### Check before showing any screen

1. Only our tokens: the colours, Titillium Web, the 10px radius and 8-point spacing.
2. Navy only on primary actions, selection, focus and progress.
3. Every status has an icon and a word.
4. The focus ring shows, and the screen works by keyboard.
5. Text contrast is 4.5:1 or more, in light and dark mode.
6. Motion uses the one curve, and nothing loops.
7. No banned item, and no em dash anywhere, including tooltips and page titles.

### Tokens for shadcn

Phase 0 sets these as CSS variables (shadcn stores them in OKLCH). In shadcn, `--accent` means hover backgrounds, not our Navy.

| shadcn variable | Light | Dark |
|---|---|---|
| `--background` | `#F4F5EF` | `#26231B` |
| `--foreground` | `#26231B` | `#E5E8DB` |
| `--card`, `--popover` | `#FBFBF8` | `#322E25` |
| `--primary` | `#233A56` | `#8EA5C3` |
| `--primary-foreground` | `#FBFBF8` | `#26231B` |
| `--secondary`, `--muted`, `--accent` | `#E5E8DB` | `#3A362C` |
| `--muted-foreground` | `#5C584E` | `#B9BCAE` |
| `--border` | `#D3D7C6` | `#4A463B` |
| `--input` | `#8F937F` | `#7F7A6D` |
| `--ring` | `#233A56` | `#8EA5C3` |
| `--destructive` | `#B4412D` | `#D98471` |
| `--chart-1` to `--chart-5` | Navy, Olive, Sand, Ochre, Terracotta | Lighter steps of the same |
| `--sidebar` | `#E5E8DB` | `#1E1B15` |
| `--radius` | `0.625rem` | Same |

## Endpoints

An endpoint is a web address that does one job, like "start a run". Swagger lists them all at `/docs`. All endpoints sit under `/api/v1/`, and the tables below leave that part out.

**Shared (core)**

| Endpoint | What it does |
|---|---|
| `GET /health` | Checks the backend is up |
| `POST /runs` | Starts a run for a project, like `lead_finder`, in discovery or watchlist mode |
| `GET /runs`, `GET /runs/{id}` | Lists runs. Shows one run's settings, status and cost. |
| `GET /runs/{id}/events` | Live progress for the website |
| `POST /runs/{id}/cancel` | Stops a run |
| `GET /searches` | The search log |
| `GET /memory/search` | Searches memory by meaning |
| `POST /hubspot/import` | Loads a HubSpot export file |
| `POST /tests/run`, `GET /tests/{id}` | Runs the test set, and shows the score |
| `GET /settings`, `PUT /settings` | Caps and models |

**Lead Finder**

| Endpoint | What it does |
|---|---|
| `POST /lead-finder/research` | Researches one company now |
| `GET /lead-finder/leads` | Lists leads, with filters |
| `GET /lead-finder/leads/{id}` | One lead card, with its facts and sources |
| `PATCH /lead-finder/leads/{id}` | Reject, Watch, a note, or Useful / Not useful |
| `GET /lead-finder/leads/{id}/similar` | Look-alike companies, from memory |
| `POST /lead-finder/leads/{id}/hubspot/preview` | Shows exactly what would change in HubSpot |
| `POST /lead-finder/leads/{id}/hubspot/send` | Writes to HubSpot, only after a person clicks |
| `GET /lead-finder/companies` | Known companies and their HubSpot match |
| `GET /lead-finder/rules` | The rules in use, and their version |

`GET /lead-finder/leads` filters by result, city, trigger, minimum score, industry, office size, HubSpot status, run and date.

## Database

**Shared (`core` schema)**

| Table | What it holds |
|---|---|
| runs | The project, settings, rules version, status and cost |
| searches | Each search, what it returned, and its cost |
| memory | Each source note, company profile and lead outcome, with its numbers, link, date and company |
| hubspot_companies | The HubSpot data: from the export now, from the live API later |
| hubspot_sends | What was written to HubSpot, when, and by whom |
| test_cases, test_results | The test set and its scores |

**Lead Finder (`lead_finder` schema)**

| Table | What it holds |
|---|---|
| companies | Name, website, industry, HubSpot ID and owner |
| offices | City, address, staff, office m² (known or estimated), lease end |
| signals | Each trigger, its date and source link |
| facts | Each fact, its source and its label (confirmed, estimated or guessed) |
| leads | Result, score, lead card, and status (new, sent, rejected or watch) |
| feedback | Useful or not, and the reason |

## Backend coding practices

**Phase 0 copied these into [engine/AGENTS.md](engine/AGENTS.md) on 25 Oct 2026, so Claude Code follows them too. Update that file, not this section.**

### Structure

- **Three layers:** endpoints check the request and call a service. Services hold the logic. Database code sits in one module per table. Each layer only calls the one below it.
- **Core never imports from apps.** Apps import from core. That keeps future projects easy to plug in.
- **Rules are data.** Pydantic checks the YAML files at start-up, and the backend won't start if one is wrong.
- **The rules engine is pure code.** The same company always gets the same result, with no AI and no database inside, so it's easy to test.
- **One settings object** reads `.env`. Nothing else reads environment variables.

### Types and data

- Type hints everywhere, checked by mypy in strict mode.
- Pydantic models at every edge: requests, responses, Claude's answer forms, HubSpot data and the rules files.
- Every table change goes through an Alembic migration. Nobody edits tables by hand.
- Times are stored in UTC with the time zone. Money is stored as exact decimals, never floats.
- Async from top to bottom: FastAPI, SQLAlchemy and httpx. No slow, blocking calls inside a request.

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
- Logs are structured and carry the run ID. They never contain secrets or contact details.

### API conventions

- All endpoints sit under `/api/v1/`, with plural nouns like `/runs` and `/leads`.
- Lists are paged and filterable. No endpoint returns an unlimited list.
- Every error has the same shape, a title and a plain detail, so the website can show a clear message.
- Every endpoint has a summary, examples and a response model, so Swagger is a complete guide.
- Only the local website (`localhost:5173`) may call the API.

### Testing and changes

- Unit tests cover the rules, the scoring and HubSpot matching, including edge cases like 99 versus 100 staff, Sydney, or an open deal.
- Integration tests run against a separate test database that resets each time.
- Tests replace Claude and HubSpot with saved sample answers, so they're free and give the same result every time.
- A git hook runs Ruff, mypy and the fast tests before each commit.
- Small commits, and one branch per phase, merged when its "Done when" is true. A change to a prompt or a rule stays only if the test set score holds.

## Models and cost

Every step starts on Claude Opus 5.5. The model for each step is a setting. Once Phase 1 has measured the cost, you can try a cheaper model on the simple steps, like Sonnet 5.5 or Haiku 5.5, and keep it only if the test set still passes.

| Item | Price (USD) |
|---|---|
| Claude Opus 5.5 | $4 per million tokens in, $20 per million out |
| Claude Sonnet 5.5 | $2 in, $10 out |
| Claude Haiku 5.5 | $0.10 in, $0.50 out |
| Web search | $10 per 1,000 searches, plus the tokens for the results |
| Web fetch | No extra charge, only the tokens for the page |
| Cached instructions | Re-read at $0.20 per million on Opus 5.5 |
| Memory (FastEmbed) | Free. It runs on your computer. |

Tokens are the unit AI usage is billed in, roughly 750 words per 1,000 tokens. Prices come from Anthropic's pricing page, checked 25 Oct 2026.

**How we keep cost down**
1. **Caps:** a cap per run and per company, on searches and tokens. A run stops cleanly when it hits one.
2. **Search limit:** each Claude request gets a maximum number of searches.
3. **Memory first:** the engine checks what it already knows before it searches.
4. **Caching:** the fixed instructions and rules are cached.
5. **Spend limit:** set one on your key in the Anthropic Console before Phase 1.

While testing, the cost depends on how many runs you start. Phase 1 measures the real cost per company, so you can set a sensible spend limit.

## Safety rules

- **Secrets:** the API key and HubSpot token live in `.env`, which git ignores. They never go in the code.
- **The AI never writes anywhere.** Only our plain code writes to HubSpot, and only after you click.
- **Web pages are data.** If a page contains text that tries to give Claude orders, Claude ignores it. This trick is called prompt injection.
- **What goes to Claude:** company names and public information only. No contact names, emails or phones.
- **Memory stays local.** FastEmbed runs on your computer, so no text goes to another service.
- **HubSpot company names:** using Contour's list, like the 12 deal companies, needs Levi's OK on data first. Until then, test with public companies from the news.
- **Read, don't scrape.** Property Daily stays off until its terms allow a program to read it.

## Phases

Each phase ends with something that works. Start the next phase only when "Done when" is true.

### Phase 0: Set up

**Status:** done, 25 Oct 2026. All 39 tests pass. 100 companies, 185 offices and 12 deals are loaded, and memory search works. How to start it: [engine/README.md](engine/README.md).

**Build**
- An `engine/` folder in this repo, split into a shared core and the Lead Finder (see "Folder layout").
- `AGENTS.md` (the backend coding practices, and how to add a project), `CLAUDE.md` (points Claude Code to AGENTS.md), `DESIGN.md` (the design system, copied from this plan), `.env.example` (the names of the secrets, no values) and `.gitignore` (keeps `.env` out of git).
- The pre-commit hook: Ruff, mypy and the fast tests.
- The database in Docker: PostgreSQL 18 with pgvector, on port 5433, with the `core` and `lead_finder` schemas.
- FastEmbed set up. Its model downloads once.
- FastAPI with `/health`, and Swagger at `/docs`.
- The rules from Criteria_v1.md in `criteria.yaml`, and the search templates in `queries.yaml`.
- The HubSpot export loaded into the database.
- Your API key in `.env`, and a spend limit in the Anthropic Console.

**Done when:** one command starts the database and one starts the backend. `/docs` opens, the 100 HubSpot companies are in the database, and a memory test works: save one note, then find it by meaning.

**Needs:** nothing from others. Start Docker Desktop first.

### Phase 1: Research one company

**Status:** done, 26 Oct 2026. All 105 tests pass, using saved sample answers. One check is left: the first real run, on the 10 test companies, is waiting on a Claude API key in `engine/.env`. That run measures the cost per company (**TBC**) and shows memory making a second look cheaper. How to run it: [engine/README.md](engine/README.md).

How it was built, and what changed from the plan:
- **Plain steps for now.** The steps are plain async code. LangGraph comes in Phase 2, when runs need many workers and need to survive a crash.
- **One leads table.** Each lead is one row, with its full card (facts, sources, rule checks). The separate companies, offices, signals and facts tables come when Phase 2 or 3 needs them.
- **Exact HubSpot matching only.** Same domain, or the same name without "Pty Ltd". Close names and "Possible match" stay in Phase 3. An open deal, or a deal dissolved in the last 12 months, already drops a lead.
- **Score weights are a proposal.** They're in `criteria.yaml` under `score`, out of 100, all **TBC** with Levi. Example: a lease ending in 1 to 3 years, from a news site, for a company that passes, scores 78.
- **Server-side fallback is on.** If Claude declines a request, the API retries it on the model Anthropic recommends, inside the same request.

**Build**
- `POST /lead-finder/research`: one company in, one lead card out.
- Memory first, then the three search angles, the answer form, the gap check, the source check, and the rules and score.
- Every search and its cost in the log. Every source note and company profile in memory.
- A first test set of 10 companies.

**Done when:** each test company has every required fact with a source link, or "unknown". We know the cost per company, and researching the same company again costs less, because memory is used.

**Needs:** Levi's OK to use HubSpot company names. Until then, use public companies.

### Phase 2: Discovery runs

**Build**
- `POST /runs`: plan the slices, run the workers side by side, merge, skip known companies, research each one, and save.
- Live progress, a Stop button, and caps per run and per company.
- The test set endpoint, with the 5 Property Daily deals added once allowed.

**Done when:** a run over the last 30 days in the 3 cities finishes under its cap, returns ranked leads, and logs every search. This run replaces the hand-test in LEADS.md, with the same settings.

**Status:** built on the branch `phase-2-4`, 27 Oct 2026, and tested with saved sample answers: the default run (3 cities, 30 days, 12 searches) finishes under its cap with ranked leads, every search is logged, and Stop, the caps and resume after a crash work. Not merged to `master` yet. The same run with the real Claude waits on the API key, so its real cost is **TBC**.

### Phase 3: Match with HubSpot (read only)

**Build**
- Matching by domain, then name, then a close name or similar profile in the same city, with the five labels.
- Watchlist mode: re-check the 47 Watch companies from [EXPORT.md](projects/leads/research/EXPORT.md), starting with the 11 likely office-based ones.
- Look-alikes: rank companies by how much they look like the deal companies.

**Done when:** all 12 deal companies match correctly, and a made-up near-duplicate with a different name shows as "Possible match".

**Status:** built and tested on `phase-2-4`, 27 Oct 2026. All 12 deal companies match as the export says, and near-duplicates show as "Possible match". The watchlist and look-alikes work, but a watchlist run stays switched off until Levi's OK on sending HubSpot names to Claude.

**Needs:** Levi's OK on data for watchlist mode and look-alikes. The live HubSpot API comes later, and switching to it is one setting.

### Phase 4: Website

**Build**
- The shared shell: layout, run monitor, search log and settings.
- The Lead Finder pages: Start research (with the map), Watch a run, Results, Lead card and Admin.

**Done when:** you can start a run from the map, watch it, filter the results and open a lead card with its look-alikes, all without Swagger. Every screen passes the design system's check list, in light and dark mode.

**Status:** built on `phase-2-4`, 27 Oct 2026. On the fake backend (the real engine with saved sample answers), a run was started from the map, watched live, filtered on Results and opened as a lead card with look-alikes, in light and dark mode. The design and contrast checks pass as tests. How to try it: [engine/README.md](engine/README.md).

### Phase 5: Send to HubSpot (click only)

**Build**
- Preview, confirm, write: a note, the "AI suggested" list, and the send log.
- Test on a HubSpot test account first (**TBC**), then on Contour's HubSpot.

**Done when:** a test lead shows in HubSpot with its note and list, and a second click doesn't make a duplicate.

**Needs:** the new HubSpot fields and a token with write access, from the HubSpot admin.

### Later (only when a test shows a need)

- A weekly timer. Every run already starts through one endpoint, so the timer just calls it.
- Hosting, with a login. The provider is not decided.
- Version 2: the AI plans its own deeper digging.
- More sources: Property Daily (if its terms allow), ASX, ABN Lookup and WGEA.
- Learning from feedback: flag new leads that look like rejected ones.
- Contacts with emails and phones, after a privacy check.
- A weekly summary email for Levi.
- Cheaper models on the simple steps, and the Batch API (half price) for timed runs.

## Folder layout

```
engine/
  AGENTS.md              how to work in this code, and how to add a project
  CLAUDE.md              points Claude Code to AGENTS.md
  DESIGN.md              how the website looks
  docker-compose.yml     starts the database (PostgreSQL 18 with pgvector)
  .env.example           names of secrets, no values
  backend/
    pyproject.toml       Python packages (uv)
    core/                shared by every project
      claude/            Claude, web search and fetch, caps and cost
      runs/              runs, live progress, the search log, background jobs
      memory/            pgvector memory and FastEmbed
      hubspot/           import, matching, preview and send
      db/                the database connection, and Alembic changes
      api/               the shared endpoints
    apps/
      lead_finder/       the first project
        app.py           tells the core this project's name, steps and rules
        steps/           plan, search, check and card (the LangGraph steps)
        rules/
          criteria.yaml      the rules, from Criteria_v1.md
          queries.yaml       the search templates
          hubspot_map.yaml   which field goes where in HubSpot
        prompts/         the instructions for Claude
        fields.py        the answer form
        api.py           the /lead-finder endpoints
        tables.py        this project's tables
    tests/
      core/              tests for the shared core
      lead_finder/       tests, and the test set
  frontend/
    package.json         website packages (npm)
    src/
      components/        shared shadcn parts
      shell/             layout, run monitor, search log and settings
      apps/
        lead-finder/     the Lead Finder pages
```

Code files use normal code names. The one-word rule in this folder is for documents only.

## How we'll know it works

- **Test set:** how many of the Property Daily deals and Levi's past wins the engine finds from the web.
- **Sources:** every fact on a lead card has a working link, or says "unknown".
- **Cost:** every company stays under its cap, and a second look at a company costs less.
- **HubSpot:** no duplicates, and no overwritten fields.
- **Useful leads (TBC with Levi):** after 4 runs, at least half the sent leads are marked useful.

After every change to a prompt or a rule, we re-run the test set. We keep the change only if the score holds or improves.

## Needs Levi's OK

These differ from what Levi saw. You can build now, but get his OK before anyone else uses the system.

| Before | Now |
|---|---|
| No website in version 1, results by email (21 Oct) | A small website to run and review research. Levi and sales still get leads in HubSpot, with no new logins. |
| Levi approves every lead by email | A person clicks "Send to HubSpot" on the website |
| Test by hand before writing code | The engine's first runs are the test, with the same settings |
| A Contour Claude account | Your own API key for now. Who pays is **TBC**. |
| A DigitalOcean server (proposed 24 Oct) | Your computer for now |
| A weekly list | Runs started by hand while we test. The timer comes later. |

Sending Contour's HubSpot company names to Claude also needs his OK.

## Open questions (TBC)

1. Levi's OK on the changes above, and on sending HubSpot company names to Claude.
2. A HubSpot read token, then later a write token and the new fields.
3. Where office details (lease expiry, staff per office) live in HubSpot.
4. Whether the HubSpot export is the full list or only the first 100.
5. Your API key's rate limits, which decide how many workers can run at once.
6. Whether the free local memory model is good enough, or we need Voyage AI.

## Sources

- Our files: [LEADS.md](projects/leads/LEADS.md), [Criteria_v1.md](projects/leads/criteria/Criteria_v1.md), [PARAMETERS.md](projects/leads/research/PARAMETERS.md), [EXAMPLES.md](projects/leads/research/EXAMPLES.md), [EXPORT.md](projects/leads/research/EXPORT.md), [HUBSPOT.md](HUBSPOT.md)
- Anthropic pricing: [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Anthropic on embeddings (points to Voyage AI): [platform.claude.com/docs/en/build-with-claude/embeddings](https://platform.claude.com/docs/en/build-with-claude/embeddings)
- pgvector Docker images for PostgreSQL 18: [docs.pgedge.com](https://docs.pgedge.com/pgvector/v0-8-2/additional-installation-methods/)
- FastEmbed and its default model: [qdrant.tech](https://qdrant.tech/documentation/fastembed/fastembed-quickstart/)
- Contour's colours and font: [contourinteriors.com.au](https://contourinteriors.com.au), checked 25 Oct 2026
- Titillium Web: [Google Fonts](https://fonts.google.com/specimen/Titillium+Web)
- LangGraph 1.0 announcement: [changelog.langchain.com](https://changelog.langchain.com/announcements/ann_lxOZRCoFw2Qn9)
- HubSpot legacy (private) apps: [developers.hubspot.com](https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview)
