# Design refresh plan, version 13

This plan gives the website an accent colour and smooth, iOS-like motion. It redesigns Admin (with a new Health tab and one control for the city schedules), the Lead Finder's Rules and Test set pages, and the Companies table. Two Claude accounts build it at the same time, in two tracks that never touch the same files.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair, for the code and for every design. **TBC** means to be confirmed.
- **Last updated:** 2026-11-11 (written, nothing built yet).
- **Progress:** each track keeps its own count, at the top of its part.
- **Sources:** Al-khair's asks of 11 Nov, the references in `inspirations/` (8 dashboards), [motion.dev](https://motion.dev/), [Framer's animation lessons](https://www.framer.com/academy/topics/animations) and [Framer's components](https://www.framer.com/marketplace/components/), and [engine/DESIGN.md](../engine/DESIGN.md).
- **Comes after:** [PLAN-V12.md](PLAN-V12.md). It builds on the `plan-v12` branch, which holds PLAN-V11 and PLAN-V12 too. On 11 Nov both were merged into `master` (8e69375), not pushed, so `plan-v12` and `master` are the same commit.

## Go signals

Say one line to each account. The same line starts a track, and continues it later from the first step that isn't ticked.

| Account | Say | What it does |
|---|---|---|
| Account 1 | `implement v13 track1` | The backend (health checks, the schedules control, the round budget), then the Admin pages |
| Account 2 | `implement v13 track2` | The design foundation (accent and motion) first, then Rules, Test set and Companies |
| Either one | `merge v13` | Joins both tracks, at the end, on Al-khair's word |

You'll also answer two things along the way:
- **Track 2 stops at T2-2** until you pick an accent. Reply `accent A`, `accent B` or `accent C` in its session.
- **Track 1 stops at T1-5** until the foundation is ready (the `v13-foundation` tag). Then say `implement v13 track1` again.

## In short

| Al-khair asked (11 Nov) | Track | Step |
|---|---|---|
| A health panel: HubSpot, Claude, Signal Hire, the database and the API | 1 | T1-2, T1-6 |
| Schedules as one control: tap the cities, choose how often and what time, and control the money | 1 | T1-3, T1-7 |
| The other Admin parts are too long | 1 | T1-8, T1-9 |
| Name me as system admin, Al-khair M. Pama | 1 | T1-4, T1-6 |
| Redesign the Lead Finder's Rules and Test set | 2 | T2-6, T2-7 |
| Companies: the name first, an order like HubSpot's, and where each company came from | 2 | T2-8 |
| An accent colour for the whole site, and smooth Framer-like motion that stays fast | 2 | T2-2 to T2-4 |

**What stays the same:**
- the backend's rules, the research, and every result and score;
- Contour's colours (Stone, Ink, Navy and the result colours), the font, the 10px radius and the 8-point spacing;
- the Home page, Results, the lead card and the sign-in page. They get the new accent and motion through the shared tokens, and nothing else.

**What it costs:** nothing but time. The health checks never spend money. Switching the schedules on costs money, and only Al-khair does that.

## The design bar

The site must look made with care, not generated. Every step's "Done when" includes this check.

**What we take from the references** (`inspirations/`):
- **Clinova:** a warm off-white page, one strong accent on the selected menu item and the main button, section cards with a title, a one-line subtitle and a thin line under it. The name and role at the bottom of the menu ("Dr. Sarah Chen, Chief of Medicine").
- **SaasAble:** underline tabs, a segmented control for a chart's range (Daily, Monthly, Yearly), and the name with "Super Admin" under it.
- **Salesfoo:** stat tabs. The selected number gets an accent underline, and it drives the chart below.
- **AlignIQ:** the chart lights up the one bar that matters and mutes the rest. A row of numbers, each with a thin coloured line.
- **LoopAI:** compact cards, and table statuses with an icon and a word.

**What we leave out:** glass and blur, glowing gradients (Financia, Pixel Mags), sparkle icons, emoji, AI-assistant blobs, and walls of big numbers. These stay banned in `DESIGN.md`.

**Motion rules** (the foundation sets them in `DESIGN.md`):
- **Springs with no bounce** for panels, tabs and indicators, and a very small bounce only for toggles and chips. Leaving is quicker than arriving (150ms).
- **Only `transform` and `opacity` move.** Nothing animates its height, a shadow, a blur or a colour fade on a big area.
- **The indicator slides:** the selected tab, the segmented control and the menu item move from old to new (`layoutId` in Motion).
- **A press feels physical:** a button or tile shrinks to 0.98 while pressed. Hover still never grows anything.
- **Nothing loops.** A live run still shows a filling bar and a still dot.
- **Speed budget:** no animation in a table of more than 50 rows; Motion loads through `LazyMotion` (already used on the sign-in page). No dropped frames in Chrome's performance panel at 4x CPU slowdown on the Schedules control, a tab switch and the Companies table.
- **Reduced motion:** if the computer asks for it, everything changes at once.

**Every screen is checked** at 1440px, 1280px and 390px (a phone), in light and dark, with the keyboard, and with reduced motion. Screenshots go in the track's Log. Al-khair looks before the step is ticked.

## Words used here

- **Track:** one account's share of the work, on its own branch and in its own copy of the repo.
- **Foundation:** the accent colour, the motion kit and the `DESIGN.md` rules. Track 2 builds it first, and both tracks use it.
- **Round:** one pass of the city schedules (for example Melbourne Monday to Sydney Thursday). Defined in `goal.py`.
- **Round budget:** the most all of a round's city runs may spend together. New in this plan.
- **Accent:** a bright colour for what is selected, live or highlighted. Navy stays the colour of the main buttons.

## How to work this plan

**Who owns which files.** Nothing collides if each track only changes its own files.

| Files | Owner |
|---|---|
| `engine/frontend/src/styles/`, all of `src/components/` (with `ui/` and the new `motion/`), `src/lib/`, `src/hooks/`, `engine/DESIGN.md` | Track 2 |
| `src/apps/lead-finder/rules/`, `src/apps/lead-finder/test-set/`, `src/apps/companies/` | Track 2 |
| `src/apps/lead-finder/admin/` (after T2-5 moves Rules and Test set out), `src/shell/`, `src/api/`, `src/router.tsx` | Track 1 |
| All of `engine/backend/`, `engine/openapi.json`, migrations, `engine/AGENTS.md` | Track 1 |
| `plan/PLAN-V13.md` | Each track edits only its own part (its steps, its Progress line, its Log) |

- **Track 2 doesn't change the backend or the API.** If it needs to, it stops and tells Al-khair.
- **Track 1 doesn't change shared parts** (`src/components/`, `src/lib/`, `src/hooks/`). A helper only it needs goes in its own folder, like `admin/`.
- **After the `v13-foundation` tag, Track 2 changes shared parts only in ways that keep old code working.** For example, it adds an optional prop to the data table, and never renames or removes one. Otherwise Track 1's pages would merge cleanly but break.
- **No new packages** in either track. `motion` and `recharts` are already installed. A new package changes `package-lock.json`, which both tracks would clash on, so it waits for Al-khair.
- **A track that needs a change in the other's files** writes the request in its Log and carries on. Al-khair passes it on.
- **Before T2-5 only,** Track 2 also touches `src/apps/lead-finder/module.tsx`, `src/router.test.tsx` and the Admin test files, to move Rules and Test set out of `admin/`.

**Branches and copies.**
- The base is `plan-v13`: `plan-v12` plus this plan, made once before the tracks start (see "Before the tracks start").
- Track 1: `git worktree add ../contour-v13-t1 -b plan-v13-track1 plan-v13`, and work in `../contour-v13-t1`.
- Track 2: `git worktree add ../contour-v13-t2 -b plan-v13-track2 plan-v13`, and work in `../contour-v13-t2`.
- If the worktree already exists, go there and carry on.

**Ports and databases.** Each track runs its own backend and website, so they never fight over a port.

| | Backend | Website | Database |
|---|---|---|---|
| Track 1 | `API_PORT=8011` | `npm run dev -- --port 5181 --strictPort` with `API_PROXY_TARGET=http://127.0.0.1:8011` | `leadfinder_v13a` |
| Track 2 | `API_PORT=8012` | `npm run dev -- --port 5182 --strictPort` with `API_PROXY_TARGET=http://127.0.0.1:8012` | `leadfinder_v13b` |

- Set `CORS_ORIGINS` to the track's own website (`["http://localhost:5181"]` or `["http://localhost:5182"]`), and `POSTGRES_DB` to its database.
- Make each database once, as a copy of `leadfinder_v10` with `pg_dump` and `pg_restore` (a template copy fails while a backend is connected).
- Read the keys from the main folder's `engine/.env` into the process only, as the V10 preview script did. Never print them, and never write them to a file.
- Leave ports 8000 and 5173 alone. Another session's `plan-v12` preview runs there.
- Start a backend only for a browser check. The laptop is short of memory.

**Every session.**
- At the start: read this section, go to the track's worktree, find the first step that isn't ticked, and run `brain context`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs and browser checks. Its lock is shared by both tracks.
- Make small commits, and run `git branch --show-current` before each one.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the track's Progress line and add a line to the track's Log.
- **A step that waits on Al-khair** is marked "built, waiting for a look", and the track goes on to the next step.
- **Only on Al-khair's word:** merging, pushing, deploying, switching a schedule on, or anything that costs money.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the tracks start

- [x] **S0. The base branch.** Done 2026-11-11: `plan-v13` made from `plan-v12` (8e69375), with this plan and the `CLAUDE.md` go signals as its first commit. On Al-khair's word (it is a commit): make `plan-v13` from `plan-v12`, with this plan as its first commit. Add the go signals to `CLAUDE.md`.
  - **Done when:** `git branch --list plan-v13` shows it, and it holds `plan/PLAN-V13.md`.

## Track 1: the backend, then Admin (account 1)

**Progress:** 5 of 10 steps done (T1-1 to T1-5). T1-6 and T1-7 built, waiting for a look.

### Part A: the backend (starts at once, needs no design)

- [x] **T1-1. Own copy and a baseline.** Done 2026-11-11 (counts in the Log).
  - The worktree, the `leadfinder_v13a` database and the ports (see "How to work this plan").
  - Run the backend and website tests once with `heavy.sh`, and note the counts.
  - **Done when:** the counts are in the Track 1 Log.
- [x] **T1-2. Health checks.** Done 2026-11-11 (748831d; the HubSpot probes made parallel in e62d888).
  - A new `core/health/` module with one check per system. Each check is free, has a 5-second limit, and runs at the same time as the others:
    - **Database:** it answers, pgvector is on, and the migration matches the code.
    - **Claude:** the key is set and Anthropic answers a free request (the model list). It never spends money.
    - **HubSpot:** the key works, the permissions (`core/hubspot/check.py`), and when the last sync finished.
    - **Signal Hire:** the key is set and the service answers. Whether a free check exists is **TBC**. If none does, it shows "Key set, not checked".
    - **Email:** the settings are there. Nothing is sent.
    - **Schedules:** each one's next and last run, and any that failed or didn't start.
    - **API:** for each endpoint over the last hour, the requests, the errors and the slowest times. They are counted in memory by a small middleware, with no database, and reset when the backend restarts.
  - `GET /api/v1/health/details`, for admins only, with the result kept for 60 seconds so a page refresh doesn't check again. `GET /api/v1/health` stays as it is.
  - Each check gives a state (OK, Problem or Off), one plain sentence, the time it took and when it ran. Example: "HubSpot: OK. Last sync 6:02 am, 13,913 companies."
  - **Files:** `core/health/`, `core/api/health.py`, `core/api/app.py` (the middleware), tests.
  - **Done when:** tests prove each check's three states with fakes, a slow check stops at 5 seconds without holding up the others, nothing calls a paid Claude request, and staff and viewers get 403.
- [x] **T1-3. One control for the city schedules, and a round budget.** Done 2026-11-11 (4c2f79c). The US$150 starting budget is still **TBC**.
  - `GET` and `PUT /api/v1/schedules/lead-finder`: one set of choices for all city schedules:
    - on or off;
    - the cities (Melbourne, Adelaide, Perth, Sydney);
    - how often: every N days or weeks;
    - the first day and the time (Melbourne time);
    - the round budget.
  - A save changes the 4 city jobs in one transaction. Picked cities are on, one day apart in a fixed order (Melbourne, Adelaide, Perth, Sydney). The others are off. Example: Perth and Sydney picked, every 2 weeks from Wednesday at 7:00 am, gives Perth on Wednesday and Sydney on Thursday.
  - **Every N days:** check how `core/schedules/calc.py` places a schedule with no weekday, then keep the cities one day apart the same way.
  - **The round budget:** a new setting, `lead_finder_round_cap_usd` (US$150 by default, **TBC**), on the Settings page under the `hard_scheduled_run_cap_usd` ceiling.
    - Today US$150 is the limit of **each** automatic run (`scheduled_run_cap_usd`), not of all 4 cities together. This step makes it the round's limit, as Al-khair expected.
    - Before an automatic run starts, its money limit becomes the smaller of `scheduled_run_cap_usd` and what is left of the round budget. The round's runs are found the way `goal.py` finds them.
    - When nothing is left, the run doesn't start, and the schedule says why: "This round's budget (US$150) is spent. Next round: 30 Nov."
  - The daily HubSpot copy stays a schedule of its own.
  - **Files:** `core/api/schedules.py`, `core/schedules/`, `apps/lead_finder/jobs.py`, `apps/lead_finder/goal.py`, `core/config.py`, `core/prefs/service.py`, tests. No migration is expected. If one is needed, it is Track 1's.
  - **Done when:** tests prove that picking 2 cities turns the other 2 off, the days come out one apart for weeks and for days, Adelaide gets US$110 after Melbourne spent US$40 of US$150, and a spent round stops the next city with its reason.
- [x] **T1-4. The admin's name and role.** Done 2026-11-11 (4e4f16a, a9bc64d). The server's account at go-live is still **TBC**.
  - The role word for `admin` becomes "System admin" everywhere it shows. Staff stays "Staff", and viewer stays "Viewer".
  - Al-khair's account name becomes "Al-khair M. Pama" in both track databases (the People tab, or the `engine` command if the tab can't change a name). On the server, at go-live (**TBC**).
  - **Files:** the role words in `src/shell/` and `admin/people.tsx`, tests.
  - **Done when:** the user menu and People show "Al-khair M. Pama, System admin".

### Part B: Admin pages (after the foundation)

- [x] **T1-5. Take in the foundation.** Done 2026-11-11 (5f4ad32).
  - Wait for the `v13-foundation` tag (Track 2, T2-5). If it isn't there, stop and say "Waiting for the foundation (T2-5)".
  - `git merge v13-foundation`, then run the website tests with `heavy.sh`.
  - **Done when:** the merge is in and the tests pass.
- [ ] **T1-6. The Admin frame and the Health tab.** Built 2026-11-11 (e62d888), waiting for a look.
  - **Admin opens on Health.** The tabs: Health, Runs and cost, Schedules, Search log, Memory, HubSpot, People, Settings. The selected tab's underline slides (the motion kit's tab indicator).
  - **Each tab's purpose is one short line** (in `src/shell/nav.ts`), like "Is everything working?".
  - **Health page:**
    - one row per system: an icon and a word for its state, the sentence, the time it took, and when it was checked;
    - problems first, then OK;
    - "Check again" for the page. A row with a problem says what to do next;
    - the API as a small table, with errors first and the slowest endpoints next.
  - **The menu's foot** shows the name and role, like Clinova: "Al-khair M. Pama, System admin". It opens the account menu.
  - **Done when:** it works in the browser at all 3 widths, in light and dark, and Al-khair has looked.
- [ ] **T1-7. Schedules: one control.** Built 2026-11-11 (81355b8), waiting for a look.
  - One card, "Find new leads automatically", with:
    - **a switch** for the whole round;
    - **Cities:** 4 chips to tap. A picked chip gets the accent tint and a tick, with a small spring;
    - **How often:** a segmented control, "Every 2 weeks", "Every 30 days" or "Custom" (a number, and days or weeks);
    - **First day and time:** weekday chips, and a time field marked "Melbourne time";
    - **Round budget:** a dollar field, with the split under it, like "US$150 a round, so about US$37 a city if all 4 run" (the split is a guide, **TBC**);
    - **A preview line** that updates as you change things: "Next round: Mon 16 Nov, 7:00 am. Melbourne Mon, Adelaide Tue, Perth Wed, Sydney Thu. Up to US$150."
  - **One Save button,** which appears only after a change. Switching the round on asks first, because it spends money.
  - **Under the card:** the last round in a small table (each city's date, good leads and cost), and a "Run a city now" menu with the cost confirm the page already has.
  - **The HubSpot copy:** one compact row (on or off, and the time).
  - **Files:** `admin/schedules.tsx` (rewritten, much shorter), `src/api/hooks/schedules.ts`, tests.
  - **Done when:** the control saves and reloads the same, the preview line is right for days and weeks, it works by keyboard and on a phone, and Al-khair has looked.
- [ ] **T1-8. Runs and cost.**
  - **Three stat tabs:** This round, This month, and Cost per good lead. The selected one gets the accent underline and drives the chart.
  - **The chart** is spend by day, with bars. The day you point at, or today, lights up in the accent and the rest are muted. A tooltip gives the day's runs and cost. The bars grow once when the page opens. Load the `dataviz` skill before building it.
  - **A compact runs table:** the city or kind, the date, good leads, cost and status.
  - **Done when:** the numbers match the API, the chart works by keyboard, and Al-khair has looked.
- [ ] **T1-9. Shorter Search log, Memory, HubSpot, People and Settings.**
  - **Search log:** one row of filters, a compact table, and the details in the side panel.
  - **Memory:** the search box first, then results as a short list with each note's source.
  - **HubSpot:** permissions as one line ("12 of 12 permissions") that opens; syncs as a short list; writes in a table.
  - **People:** a table with the role as a word and an icon. Edits happen in a side sheet.
  - **Settings:** grouped (Money, Claude, Runs, Why now, Call prep), each setting with one line under it, and "Applies from the next run" said once at the top.
  - **The rule for each page:** cut the words by about half, one line under each heading, and details behind "More".
  - **Done when:** each page fits its main content on one laptop screen (1280 × 800), and Al-khair has looked.
- [ ] **T1-10. Track 1 check.**
  - Backend tests (`RUN_GATES=1`), website tests, lint, types, build, and `engine openapi` with `npm run types`.
  - A browser check of every Admin tab at 3 widths, light and dark, reduced motion, and the speed budget.
  - **Done when:** all pass, the screenshots are in the Log, and Al-khair says Track 1 is ready to merge.

### Track 1 Log

Newest first.

- 2026-11-11: **T1-7 built, waiting for a look** (81355b8). `admin/schedules.tsx` rewritten (513 lines to about 300, with the control in `round-card.tsx` and its pure parts in `round-plan.ts`). **Find new leads automatically:** one switch for the round; the cities as `ChipGroup` chips; how often as `Segmented` (Every 2 weeks, Every 30 days, Custom with a number and Days or Weeks); the first day as weekday chips and the time marked "Melbourne time"; the round budget with the split under it ("US$150 a round, so about US$37 a city if all 4 run", a guide, **TBC**). The preview line is the backend's own while the times are as saved (it knows which cities already ran mid-round), else the line a save would plan from now, in the backend's words. The form checks the backend's rules first (a round must end before the next, the budget's ceiling, whole cents), and a 422 from the backend lands next to its field. One Save and an Undo show only after a change. Switching the round on asks first: "Each round may spend up to US$150 between its cities, so at most about US$327 a month at this plan." **Under the card:** each city's newest run (date, good leads, cost, status), the round so far in one line, and "Run a city now" with the city's own cost confirm, as before. **Other jobs:** the HubSpot copy and the Companies page's morning search ahead, one compact row each (on or off, the time with a Save after a change, the last start, Run now); a job that spends money still asks first. Saving the plan reads the schedule list again, not the plan (the answer is the plan). Browser check at 1440, 1280 and 390, light and dark, reduced motion, **no console errors**; the switch-on confirm was opened and cancelled, so **no schedule was switched on** in `leadfinder_v13a` (checked after). Six shots in `plan/shots/v13-t1/t1-7-*.png`. The Prettier warning on `admin/schedules.tsx` is gone with the rewrite.
- 2026-11-11: **T1-6 built, waiting for a look** (e62d888). Admin opens on Health. The tabs: Health, Runs and cost, Schedules, Search log, Memory, HubSpot, People, Settings, each with one short purpose line (`shell/nav.ts`, "Is everything working?"), and the accent underline slides between them (`TabIndicator`; the focus ring is drawn inside the tab, because the row scrolls sideways and would clip it). **Health:** one row per system with an icon and a word (OK neutral, Problem in the error colour, Off outlined), the sentence, what to do next, and how long the check took; problems first; the check time is said once, beside "Check again" (all rows come from one pass, so a time on every row only repeated it); the API as a small table, errors first, then the slowest, 8 rows and "Show all". **The menu's foot** shows the name and role ("Al-khair M. Pama, System admin") and opens the account menu; the top bar keeps the account button on a phone only. **Browser check** (preview: backend 8011 on `leadfinder_v13a`, keys in the process only, `HUBSPOT_SYNC_MAX_AGE_HOURS=0`, sign-in on with a temporary account "Browser Check", removed after; website 5181; headless Chrome over the DevTools protocol, Track 2's script): 1440, 1280 and 390 wide, light and dark, reduced motion, **no console errors**. Six shots in `plan/shots/v13-t1/t1-6-*.png`. **What the live checks found:** Database OK (pgvector 0.8.7, migration 0014), Claude OK (US$13.47 spent in 24 hours), Signal Hire OK (1,160 credits), Email off (it goes to the log, and `LEAD_FINDER_NOTIFY_EMAILS` is empty), Schedules off, and **HubSpot a problem: 5 of 6 read permissions, `crm.objects.contacts.read` is missing** (the Companies page reads people and calls with it). The first HubSpot check took 6 seconds, over the 5-second limit, because its 8 probes ran one after another; they now run at the same time (`core/hubspot/check.py`, about a second; the HubSpot tab gains too).
- 2026-11-11: **T1-5 done** (5f4ad32). `git merge v13-foundation` went in with no conflict (no backend file in it). Website tests with `heavy.sh` on the merged tree: **993 passed** (Track 2's 990 and T1-4's 3), lint and types clean.
- 2026-11-11: **Full check of Part A** (`heavy.sh`, RUN_GATES=1). Backend **3,513 passed, 25 skipped, 1 failed**: `test_tables.py::test_the_search_log_time_index_is_there_when_only_the_search_log_is_imported`, which starts a fresh Python with a 120-second limit and **passes alone** (1.4 s); the laptop was low on memory then. Ruff, format and mypy clean. Prettier flags `admin/schedules.tsx` (T1-7 rewrites it) and `src/modules.ts` (neither track's file), both from the base branch. Claude Code stopped this check once for low memory; its test run went on and finished by itself.
- 2026-11-11: **T1-4 done** (4e4f16a, a9bc64d). The website's word for the `admin` role is "System admin" (`shell/roles.ts`, used by the account menu and the People tab; Staff and Viewer stay). The People tab can't change a name, so `engine rename --user <login> --name "..."` does (logged as `account_changed`). Both track databases now name the account **Al-khair M. Pama**. The backend's own messages ("Only an Admin can do this.") are unchanged.
- 2026-11-11: **T1-3 done** (4c2f79c). `GET` and `PUT /api/v1/schedules/lead-finder`. Four calls made here: (1) **the route lives in the Lead Finder** (`apps/lead_finder/api_round.py`, mounted at `/schedules/lead-finder` through a new `AppSpec.schedule_router`), not in `core/api/schedules.py`, because the core never imports a project; (2) **while the round is off**, the picked cities and the first day are kept in one row of the settings table (`lead_finder_round`, never read as a setting), so no migration; (3) **the round now begins at the first picked city's time**, not "the last 7 days": every week, 7 days would count last week's cities (with no city on, it is still 7 days); (4) **a round must end before the next starts**: 4 cities need every 4 days or more. The look-back follows how often (7, 14 or 30 days). A save that changes only the budget keeps each next time; any other change plans the next round from now. The budget is the setting `lead_finder_round_cap_usd` (US$150, under `hard_scheduled_run_cap_usd`), saved with the plan in one transaction. Before a city starts, its cap becomes the smaller of `scheduled_run_cap_usd` and what is left, saved with the run as its own lower cap. When nothing is left: "This round's budget (US$150) is spent. Next round: 30 Nov." When a little is left but too little for its searches, it says so. Tests: 31 pure and 10 on the database, with the plan's four cases.
- 2026-11-11: **T1-2 done** (748831d). `core/health/` (`checks.py`, `run.py`, `traffic.py`) and `GET /api/v1/health/details`, for Admins, kept 60 seconds (`refresh=true` checks again). Signal Hire has a free balance call, `GET /api/v1/credits`, so its row says "Key works. The account has N credits." instead of "Key set, not checked" (the docs don't say in so many words that it is free, **TBC**). The Claude check only asks for the model list: a test records every request and finds only `GET /v1/models`. The API counter is a pure ASGI middleware: one bucket a minute per endpoint, by the path in the code (FastAPI 0.162 keeps included routers nested, so the full path comes from `api_routes`). 35 tests.
- 2026-11-11: **T1-1 done.** S0 first (on Al-khair's go signal): `plan-v13` from `plan-v12` (9ff4fc6). Worktree `../contour-v13-t1` on `plan-v13-track1`, `npm ci`, database `leadfinder_v13a` as a `pg_dump` and `pg_restore` copy of `leadfinder_v10` (at 0014), its own `engine/.env` with the database lines only. Baseline with `heavy.sh`: backend **3,430 passed, 28 skipped, 1 failed** (`test_companies_speed.py`, a timing test that **passes alone**, 3.6 s; Track 2 was running too), website **933 passed**.

## Track 2: the foundation, then Lead Finder and Companies (account 2)

**Progress:** 2 of 9 steps done (T2-1, T2-5). T2-2, T2-3 and T2-4 are built and wait for Al-khair's look.

### Part A: the foundation (starts at once)

- [x] **T2-1. Own copy and a baseline.** (2026-11-11)
  - The worktree, the `leadfinder_v13b` database and the ports (see "How to work this plan").
  - Run the website tests once with `heavy.sh`, and note the count.
  - **Done when:** the count is in the Track 2 Log.
- [ ] **T2-2. The accent and the motion, as a prototype.** Al-khair picks before any code changes. **Built 2026-11-11, waiting for the pick:** https://claude.ai/artifact/HedDQgAprAGRzb1QhLEVxV
  - A clickable HTML page (an Artifact, private). It shows the Schedules control and the Companies table in each accent, light and dark, with made-up data marked as made up.
  - **Three accents**, each starting point checked for contrast (4.5:1 for text, 3:1 for the focus ring):
    - **A. Cobalt** (from about `#2F5BD8`), a bright step of Contour's Navy. **Recommended:** it lifts the warm Stone colours, it doesn't look like a warning or a result, and it reads as the same family as the site.
    - **B. Contour orange,** from Contour's own website. Warm and on brand, but close to Ochre, which means Director review and cost near its cap today.
    - **C. Deep teal** (from about `#0F6B6B`). Calm, but close to Olive (Pass) and to the Lead Finder's Eucalyptus.
  - **Where the accent goes:** the selected menu item (a soft tint, accent text and a 2px bar), the selected tab or segment, switches that are on, picked chips, the focus ring, progress bars, links, and the one bar or line a chart highlights. Navy keeps the main buttons. Results keep their own colours.
  - **The motion demo:** the segmented control, the chips, the tab underline, a side sheet, a number that rolls to its new value, and a button press. A switch shows the same thing with reduced motion.
  - **Done when:** Al-khair replies `accent A`, `B` or `C`, and the choice is in the Log. Until then, the track waits.
- [ ] **T2-3. The tokens and `DESIGN.md`.** **Built 2026-11-11, waiting for a look** (the browser check comes with T2-4, one backend start for both).
  - The picked accent as tokens in `src/styles/tokens.css`, light and dark: `--accent-strong`, `--accent-soft` (the tint) and `--accent-ink` (text on the tint). Also `--ring`, `--chart-1` and the progress colour. shadcn's own `--accent` keeps its meaning (hover backgrounds).
  - **`DESIGN.md`:**
    - Colour: the accent, where it goes, and where it never goes;
    - Motion: rewritten from "The design bar" in this plan, replacing "one curve";
    - Banned: springs with a small bounce are no longer banned for toggles and chips. Loops, glow, gradients and blur stay banned;
    - the "Check before showing any screen" list, updated.
  - **Done when:** every token passes its contrast check in light and dark, and the existing pages still look right.
- [ ] **T2-4. The motion kit.** **Built 2026-11-11, waiting for a look** (the browser check and the 4x CPU frame check come with it).
  - `src/components/motion/`, built on `motion` 14.5.0 (already installed):
    - `MotionRoot`: `LazyMotion` with `domAnimation`, and `MotionConfig` that follows reduced motion. It goes at the app's root;
    - `springs.ts`: `snappy` (0.25s, no bounce), `smooth` (0.4s, no bounce), `soft` (0.35s, bounce 0.1, toggles and chips only), and `exit` (150ms);
    - `Segmented`: a segmented control whose highlight slides, working by keyboard as a radio group;
    - `ChipGroup`: chips you tap to pick, with a tick and a press;
    - `TabIndicator`: the sliding underline for tabs;
    - `Reveal`: content fades and rises 4px once, with at most 8 items one after another;
    - `RollingNumber`: a number that rolls to its new value, in table digits;
    - `usePress`: the 0.98 press.
  - **Files:** `src/components/motion/`, `src/main.tsx` (the root), tests.
  - **Done when:** each part has tests (keyboard, reduced motion, screen reader labels), the main bundle grows by no more than 10 KB gzipped (**TBC**), and there are no dropped frames at 4x CPU slowdown.
- [x] **T2-5. Seams for the tracks, then the tag.** (2026-11-11, tag `v13-foundation`)
  - Move the views out of `admin/`: `admin/rules.tsx` to `rules/view.tsx`, and `admin/tests.tsx` to `test-set/view.tsx`.
  - Split `admin/admin.test.tsx` into one test file per page. Then Track 1 and Track 2 never edit the same test file.
  - Commit, tag `v13-foundation`, and add a line to the Track 2 Log: "Foundation ready".
  - **Done when:** all website tests pass, and the tag exists.

### Part B: Lead Finder and Companies

- [ ] **T2-6. Rules, redesigned.** It stays read only.
  - **A segmented control** at the top: Cities, Size, Signs, Timing, Score, Industries, Never suggest, Sources. It jumps to that section. On a phone it scrolls sideways.
  - **Each rule is one compact row:** the rule in plain words, its number in table digits, and marks for "TBC" and "Changed 9 Nov".
  - **The score** is one bar split into its parts, adding up to 100. Pointing at a part shows its checks. The parts grow once when the page opens.
  - **Signs** are grouped as main, boosters and other, each with its label as Claude reads it.
  - **"Waiting on Levi"** is a short list beside it on a laptop, and under it on a phone, with each TBC rule.
  - **Done when:** it shows every rule the API gives, works by keyboard, and Al-khair has looked.
- [ ] **T2-7. Test set, redesigned.**
  - **At the top:** the last run in one line ("8 of 10 as expected, US$4.10, 3 Nov"), and the run before it for comparison.
  - **A grid:** the 10 companies down the side, and the last 5 runs across, each cell the result's icon and colour. A cell that changed from the run before gets a small mark.
  - Clicking a company opens a side panel: what each run said, and what changed.
  - **"Run the test set"** keeps its cost confirm. The cost comes from the estimate, about 10 × US$0.49 today.
  - **Done when:** it matches the API's runs, works by keyboard, and Al-khair has looked.
- [ ] **T2-8. Companies, like HubSpot.**
  - **The column order:** Company name, Owner, Last activity, City, Industry, Staff, Next lease end, Deal, Source. It follows HubSpot's company list (name, owner, last activity, city, industry), so the team finds things where they expect. Al-khair checks it against the team's own HubSpot view (**TBC**).
  - **The name column** comes first and stays put when the table scrolls sideways. It shows the company's initials in a small square, the name, and the website under it. Industry moves to its own column.
  - **Source**, from the existing row fields:
    - "HubSpot": in HubSpot only;
    - "Lead Finder": found by the Lead Finder and not in HubSpot (`source = lead`);
    - "Both": in HubSpot, with a Lead Finder result.

    Each is an icon and a word in quiet text, with a tooltip, as `DESIGN.md` says for source marks. Only people with the Lead Finder tick see the column. For everyone else, every company is from HubSpot.
  - **Pointing at a row** shows "Prep a call" and "Open in HubSpot" at its end, like HubSpot's preview button.
  - The phone cards stay, with the source mark added.
  - **Done when:** the table works at 3 widths, sorting and filters still work, the source is right for all 3 kinds in tests, and Al-khair has looked.
- [ ] **T2-9. Track 2 check.**
  - Website tests, lint, types and build.
  - A browser check of Rules, Test set, Companies and a few other pages (Home, Results, a lead card) with the new accent and motion: 3 widths, light and dark, reduced motion, and the speed budget.
  - **Done when:** all pass, the screenshots are in the Log, and Al-khair says Track 2 is ready to merge.

### Track 2 Log

Newest first.

- 2026-11-11: **Foundation ready.** **T2-5 done:** `admin/rules.tsx` is now `rules/view.tsx` and `admin/tests.tsx` is `test-set/view.tsx` (their pages import `./view`; the old `/admin/rules` and `/admin/tests` addresses still redirect). `admin/admin.test.tsx` is split into one file per page: `admin/settings.test.tsx`, `admin/hubspot.test.tsx`, `admin/memory.test.tsx`, `admin/searches.test.tsx`, `admin/runs.test.tsx`, `rules/view.test.tsx` and `test-set/view.test.tsx`, with the shared fake API in `src/test/mock-api.ts` (`mockApi`, `Call`, `TEST_RUN_ID`). Full check: website 72 files, **990 tests passed**, lint, types and build clean. Tag `v13-foundation` on the commit. **For Track 1:** `git merge v13-foundation` (T1-5); then the accent classes (`bg-accent-soft`, `text-accent-ink`, `border-accent-strong`, `text-link`), the kit (`import { Segmented, ChipGroup, TabIndicator, Reveal, RollingNumber, usePress } from '@/components/motion'`) and `mockApi` from `@/test/mock-api` are there. The Admin tabs can take `<TabIndicator active={isActive} group="admin" />` inside each `NavLink` (make the link `relative`).
- 2026-11-11: **T2-4 built, waiting for a look.** `src/components/motion/`: `MotionRoot` (`LazyMotion` + `MotionConfig reducedMotion="user"`, at the app's root in `main.tsx` and around every test render in `test/render.tsx`), `springs.ts` (`snappy` 0.25s, `smooth` 0.4s, `soft` 0.35s bounce 0.1, `exit` 150ms, `INSTANT`), `Segmented` (a radio group, the highlight slides with `layoutId`), `ChipGroup` (`many` with `aria-pressed`, or `one` as a radio group; a tick on the soft spring; the press), `TabIndicator` (the sliding underline; a shadcn `TabsTrigger` hides its own underline when it holds one), `Reveal` (fade and rise 4px, at most 8 staggered 40ms apart), `RollingNumber` (digit columns on the smooth spring, the plain text for a screen reader), `usePress` (`whileTap` 0.98), `useStill` and `useTransition` (reduced motion = INSTANT, read from the media query on every render so tests can switch it), `roving.ts` (arrows, Home, End, disabled items skipped). 24 tests in `motion.test.tsx`. **The features load late:** `layoutId` needs `domMax`, which is about 20 kB gzipped, so `MotionRoot` loads it through `LazyMotion` from `features.ts` as a file of its own after the first screen. Build, gzipped: the main file went from 48.3 kB to 37.4 kB (the error page split out too), the sign-in page's file from 73.5 kB to 47.7 kB (it no longer carries its own copy of motion), and the new `features-animation` file is 19.6 kB. So the 10 kB budget holds for the main file; the features file is extra and arrives in the background (**TBC** with Al-khair). `tokens.css` wraps the spring curves over several lines after prettier, so the contrast test strips spaces first. `lib/utils.ts` knows the `ease-spring-*` classes. The design lint reads comments too, so no comment names a banned class. Not touched: `src/shell/`, `src/apps/` (except the T2-5 moves), the backend. Pre-existing prettier warnings on `admin/schedules.tsx` and `src/modules.ts` come from the base branch and are left alone (Track 1's and shared).
- 2026-11-11: **Accent A (Cobalt) picked by Al-khair.** **T2-3 built, waiting for a look.** `tokens.css`: `--accent-strong` `#2F5BD8` / `#80A4F8` (dark), `--accent-soft` `#E1E8FA` / `#243556`, `--accent-ink` `#1E3F9E` / `#B9CCFA`; `--ring`, `--link`, `--progress` and `--chart-1` are the accent; `--sidebar-selected` and `--sidebar-selected-foreground` for the selected menu item; the springs as CSS `linear()` curves (`--spring-snappy`, `--spring-smooth`, `--spring-soft`) with `--duration-snappy` 250ms, `--duration-smooth` 400ms, `--duration-soft` 350ms, `--duration-exit` 150ms. `index.css` wires them (`bg-accent-soft`, `text-accent-ink`, `border-accent-strong`, `text-link`, `bg-progress`, `ease-spring-*`). Shared shadcn parts moved onto them, keeping every prop: the switch (track on = accent, thumb on the soft spring), the tabs' line underline, progress, a pressed toggle (tint, ink and accent border = a picked chip), and the sidebar's active item (tint, ink and a 2px bar). `--selected` (rows) stays a Navy tint. `DESIGN.md`: the accent table (where it goes, where it never goes), Motion rewritten from "The design bar", Banned and the check list updated, the token table. `contrast.test.ts`: 33 new checks (link text 4.5:1 on page, card and popover; ink on tint; the accent 3:1 on page, card, popover, sidebar and its own tint; the spring curves start at 0, end at 1, and only `soft` passes 1, by under 2%). Website 966 tests, lint and types clean. Not touched: `src/shell/`, `src/apps/`, the backend.
- 2026-11-11: **T2-2 built, waiting for the pick.** The prototype is a private Artifact: https://claude.ai/artifact/HedDQgAprAGRzb1QhLEVxV. A top bar switches the accent (A, B, C), light or dark, and reduced motion. It shows the eight places the accent goes (menu with the foot "Al-khair M. Pama, System admin", tabs, stat tabs, switch, chips, focus ring, links, progress, chart), a live contrast table, the T1-7 Schedules control (cities, how often, first day, time, round budget, a preview line, Save only after a change, the money confirm), the T2-8 Companies table (name first, HubSpot's order, Source, row actions), and the motion kit (sliding indicators, a rolling number, a side sheet, the 0.98 press). Springs are CSS `linear()` curves made from the same damping maths Motion uses. All data is made up and says so. Contrast (light / dark, text needs 4.5:1, rings 3:1): **A** link on page 5.31 / 6.41, ink on tint 7.58 / 7.61; **B** 4.90 / 7.47, 7.38 / 8.12; **C** 5.74 / 7.43, 7.63 / 7.83. Contour's own orange hex is not in the repo, so B starts from `#AD4F14` (**TBC**). No code changed. Track 2 stops here until `accent A`, `B` or `C`.
- 2026-11-11: **T2-1 done.** Worktree `../contour-v13-t2` on branch `plan-v13-track2` from `plan-v13` (9ff4fc6). `npm ci` in its `engine/frontend`. Database `leadfinder_v13b` made in the Docker Postgres as a `pg_dump` and `pg_restore` copy of `leadfinder_v10` (13,915 HubSpot companies). Baseline with `heavy.sh`: website 65 files, **933 tests passed** (31 s). No backend started. The `inspirations/` folder is not committed; it is read from the main folder.

## Merge (`merge v13`, on Al-khair's word)

- [ ] **M1. Join the tracks.**
  - In the main repo on this laptop: merge `plan-v13-track1` into `plan-v13`, then `plan-v13-track2`.
  - Run `engine openapi` and `npm run types` again, instead of fixing generated files by hand.
  - Run all the tests, lint, types and build with `heavy.sh`, and check the whole site in the browser once. Code can merge with no conflict and still break, and these catch it.
  - Update this plan's Last updated and Progress lines, and fold any notes from the tracks into `DESIGN.md`.
  - **Done when:** everything passes on `plan-v13`. Merging into `master` waits until PLAN-V11 and PLAN-V12 are approved too, since `plan-v13` carries them.

## Waiting on

- **Al-khair:**
  - S0, the base branch (a commit);
  - the accent (T2-2);
  - a look at each page;
  - the round budget's starting amount (US$150, T1-3);
  - the merges.
- **Levi:** nothing new. The team may want a say on the Companies column order (**TBC**).

## Risks

- **Two sessions on one laptop.** Memory runs short. Mitigations: `heavy.sh`'s shared lock, and backends started only for browser checks.
- **The tracks drift apart in style.** Both use the same tokens, motion kit and `DESIGN.md`, and Track 1 starts its pages only after the foundation.
- **Motion slows the site.** The speed budget, `LazyMotion`, and no animation in big tables.
- **Too much accent.** `DESIGN.md` lists where it goes. The check before each screen catches the rest.
- **The round budget changes how automatic runs stop.** It can only lower a run's limit, never raise it past `scheduled_run_cap_usd` or the daily limit. T1-3's tests cover it.
- **`plan-v13` carries PLAN-V11 and PLAN-V12,** which aren't approved yet. `master` waits for all three.

## Not in this plan

- Editing the rules on the website. Rules stays read only.
- Redesigning Home, Results, the lead card or the sign-in page. They only pick up the new accent and motion.
- A column chooser on Companies, like HubSpot's "Edit columns".
- The overseas search, and merging Old offices into Find new leads.

## Log

Newest first.

- 2026-11-11: Plan written from Al-khair's asks of 11 Nov and the references in `inspirations/`. Nothing built yet.
