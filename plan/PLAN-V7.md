# Contour HQ plan, version 7: faster pages, and ready for more data

This plan makes Contour HQ feel fast and stay fast as the data grows. Pages show their shape at once while data loads, the next page starts loading before you click, the code files get smaller, and the backend answers quickly with 10,000 leads and 20 people at once.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair (no business rules change, so nothing waits on Levi).
- **Last updated:** 2026-11-05. **TBC** means not confirmed yet.
- **Progress:** 0 of 23 steps done. Work goes on branch `plan-v7`, made from `master` at 3b0179f.
- **Comes after:** [PLAN-V6.md](PLAN-V6.md). Its open steps (A2, part H and part I) stay there. This plan doesn't block them, and they don't block it.

## In short

- **Goal:** every page shows something useful in under 2.5 seconds on a first visit, a page you've seen before opens almost at once, and the backend keeps up with 10,000 leads and 20 people at once (**TBC**: these sizes are our guess, see A5).
- **Measure first.** Nothing is changed until part A has numbers. Then each fix is checked against them, and a fix that doesn't help is dropped.
- **Heavy traffic is not the main risk.** Contour HQ has a small team. The real risks are a slow first visit, waiting twice for each page, and more data every run (13,913 HubSpot companies; 52 leads in the dev database today, more after each run).
- **Order:** measure (A), loading that keeps its shape (B), load before the click (C), smaller code files (D), the backend for more data (E), measure again and merge (F).
- **Cost:** no money. The tests use fake data and no Claude calls. A load test runs only against this laptop, never against a live server without Al-khair's OK.

## Words used here

- **Skeleton:** grey blocks in the shape of the content that is coming, like rows of a table, shown while it loads. Ours stay still: DESIGN.md bans pulsing and shimmer.
- **Code file:** the JavaScript the browser downloads for the site. The site is split into one file per page plus shared files. Smaller files mean a faster first visit.
- **Preload:** loading a page's code and data when you point at its link, so it is ready when you click.
- **Cache:** answers the site keeps for a while, so going back to a page shows it at once.
- **Web Vitals:** Google's three speed measures. LCP (the main content shows) under 2.5 s, INP (the page reacts to a click) under 200 ms, CLS (things jump while loading) under 0.1. These are Google's "good" levels.
- **p95:** 95 out of 100 requests are this fast or faster. It shows the slow cases an average hides.
- **Index:** a lookup table in the database that finds rows without reading them all, like the index at the back of a book.

## What we know today (5 Nov, read from the code)

1. **Loading shows words, not shapes.** About 14 places say "Loading." or "Loading the lead." Only the Schedules tab has a skeleton. The page itself says "Loading the page." while its code downloads.
2. **Each page waits twice.** A page's code loads when you open it (a lazy route). Its data starts loading only after that code arrives. Nothing loads before a click.
3. **Caching is short.** Data is fresh for 15 seconds and kept for 5 minutes (`src/api/query.ts`). It isn't fetched again when you come back to the browser tab.
4. **Some code files are big.** A build from 5 Nov in `frontend/dist/` has the main file at 446 kB, the Runs page at 342 kB (likely the charts), Results at 150 kB and the login page at 141 kB (likely the `motion` animation library). The 27 Oct build warned that the main file was over 500 kB. These are sizes before compression.
5. **Results asks a lot each time a filter changes.** The page of 50 leads, a total count, and about 12 count queries for the filter lists, one after another (`lead_store.py`, `lead_facets`). The map draws up to 2,000 pins. Search by name reads every lead (`company ILIKE '%text%'`), because no index can help that search today.

Also good to know: Caddy already compresses answers on the server (zstd and gzip), the run page already streams live events, and lists already keep the old page on screen while the next one loads.

## Targets (TBC until A5)

| What | Target |
|---|---|
| First visit to any page (laptop, production build) | LCP under 2.5 s, CLS under 0.1 |
| A page you have seen in the last 5 minutes | content at once, then quietly refreshed |
| Clicking anything | INP under 200 ms |
| Main code file | no build warning; size set after A3 |
| API with 10,000 leads and 20 people at once | p95 under 300 ms for Results, the filter counts, the map and a lead card |

## How to work this plan

These rules are for Al-khair and for Claude. At the start of every session: read this section, run `git switch plan-v7`, find the first step that isn't ticked, and run `brain context`.

- **Tick a step** when its "Done when" is true, in the same turn, with the date and the commit: `- [x] **B1. ...** Done 2026-11-06, abc1234.` Then update **Progress** and **Last updated**, and add a line to the Log.
- **Half done:** leave the box empty and write "Done so far:" and "Left:" under the step. **Blocked:** write "Blocked:" and why, then take the next step that isn't blocked.
- **Measure, then change.** Every step in parts B to E says which number it should move. Note the number before and after in the Log. A change that moves nothing is undone.
- **Usage:** call `get_usage` at the start of each step, after each commit, and before anything long. At 80% on any number, run `brain-save`. At 90%, save again and finish only a small step. At 95%, start nothing: tick what is done, add a Log line, save one line with `brain inbox`, and stop.
- **One heavy thing at a time:** the backend tests, the website tests, a build and a load test each use most of this laptop's memory.
- **Commits** are small, one step each, on `plan-v7`. Run `git branch --show-current` right before each commit. Push only when Al-khair asks. Merging is his call.
- **Never** run a load test against a live server, and never put real company names in the test database.
- **Design rules still hold** ([engine/DESIGN.md](../engine/DESIGN.md)): skeletons stay still and fade in, one motion curve, nothing loops.

## Part A: Measure first

- [ ] **A1. Branch and baseline.**
  - `plan-v7` from `master` (3b0179f). This plan is its first commit.
  - Run the website checks and the backend suite, one at a time. The last numbers were website 818 tests (5 Nov) and backend 3,090 passed and 25 skipped (`RUN_GATES=1`, 5 Nov).
  - **Done when:** the numbers are in the Log.

- [ ] **A2. A big test database.**
  - A script that fills a new database, `leadfinder_perf`, with 10,000 fake leads ("Sample ..." names, spread over the cities, results and signs) and 50 fake runs. It follows the fake backend's pattern (`tests/e2e/serve.py`) and never touches `leadfinder` (the dev database).
  - The fake backend can start on it, with a flag (**TBC**: the flag's name).
  - **Done when:** the fake backend serves 10,000 leads from `leadfinder_perf`, and the script runs again from nothing in under 5 minutes.

- [ ] **A3. Measure the website.**
  - A size report of the build: which libraries sit in which code file. Recommendation: `rollup-plugin-visualizer` as a dev-only package (**TBC**: Al-khair's OK on the package, and whether it works with Vite 8).
  - Web Vitals on a production build (`vite build`, then `vite preview`) for Home, Start, Results, a lead card and Runs, on a laptop size and a phone size, against A2's database.
  - Count the waits: for each page, how long from the click to the code, and from the code to the data.
  - **Done when:** the sizes and the timings are a table in the Log.

- [ ] **A4. Measure the backend.**
  - The time each route takes, logged per request (check first whether the logs already have it).
  - A load test: 20 people at once for 5 minutes, opening Results with different filters, the filter counts, the map and lead cards. Recommendation: Locust, a Python tool, as a dev-only package (**TBC**: Al-khair's OK; k6 is the other choice).
  - `EXPLAIN ANALYZE` for the slowest queries.
  - **Done when:** the p95 of each route, and the slowest queries, are in the Log.

- [ ] **A5. Agree the targets.** Al-khair.
  - Confirm or change the sizes (10,000 leads, 20 people at once) and the targets table above, now that A3 and A4 have numbers.
  - Pick which of parts B to E to do, in which order. Recommendation: B and C first (most felt), D next, E only where A4 shows the backend is slow.
  - **Done when:** the answers are in the Log.

## Part B: Loading that keeps its shape

- [ ] **B1. Skeleton parts.**
  - A few shared parts in `src/components/`: a table, a card, a detail panel and a page header, each shaped like the real thing. They use shadcn's Skeleton without its pulse, and fade in.
  - Shown only when loading takes more than 200 ms, so a fast answer never flashes grey blocks.
  - A screen reader hears one line, like "Loading the leads.", in a hidden status.
  - **Done when:** the parts and their tests are in, and the design and contrast checks pass.

- [ ] **B2. Use them everywhere.** The table (`data-table.tsx`), the lead card and side panel, the run page, Start, Rules, Settings, the Admin tabs and Home's status lines. About 14 places today.
  - **Moves:** CLS (nothing jumps when the data arrives) and how long the page looks empty.
  - **Done when:** no page shows "Loading." on its own, and CLS is under 0.1 on the five pages.

- [ ] **B3. The page while its code loads.** Instead of "Loading the page.", the menu and top bar stay, and the page shows a skeleton of its header and main block.
  - **Done when:** opening a page you haven't visited shows its shape at once.

## Part C: Load before the click

- [ ] **C1. Code and data at the same time.** Each Lead Finder page starts its main data request while its code downloads (a React Router `loader` that fills the same cache the page reads, `queryClient.ensureQueryData`).
  - **Moves:** the time from click to content (A3's two waits become one).
  - **Done when:** A3's timing shows one wait, not two, for Start, Results, Runs and a lead card.

- [ ] **C2. Preload on intent.** Pointing at a link for 100 ms, focusing it with the keyboard, or touching it starts loading that page's code and first data. For the menu, Home's page rows, and Results rows (a lead card).
  - Not when the browser asks to save data (`navigator.connection.saveData`), and never more than one preload at a time (**TBC**: check this doesn't flood the backend in A4's load test).
  - **Done when:** a page whose link you pointed at opens with its content already there.

- [ ] **C3. Cache times that fit the data.** Rules and the Start page's choices change rarely: fresh for 10 minutes. Filter counts and Home's figures: 30 seconds. Runs and leads stay at 15 seconds. A change you make (Watch, Reject, a new run) clears what it affects, as today.
  - **Done when:** going back to Rules, Start or Home asks the backend nothing within those times, and the tests prove a change still shows at once.

- [ ] **C4. Open a lead card at once from Results.** The side panel shows what the table row already has (name, result, score, city) straight away, and fills in the rest when it arrives.
  - **Done when:** the panel never opens empty.

## Part D: Smaller code files

- [ ] **D1. Load heavy libraries only where they are used.** Charts (Recharts) only on Runs and the cost chart; the map (Leaflet) only on Start and Results; `motion` only on the login page; the date picker only in the filters. Which ones to move comes from A3's report.
  - **Moves:** the main file size and the first visit's LCP.
  - **Done when:** each library sits only in the files of the pages that use it, in the size report.

- [ ] **D2. Shared libraries in their own file.** React, the router and TanStack Query in one file of their own, so it stays cached when our code changes. Vite 8 does this with its chunk settings (**TBC**: the exact setting).
  - **Done when:** a change to one page changes only that page's file, checked with two builds.

- [ ] **D3. Fonts.** Load early (preload) the two Titillium Web weights the first screen uses, and check that text shows in the system font until they arrive.
  - **Done when:** A3's timing shows the fonts start in the first round of downloads.

- [ ] **D4. The map with many pins.** If A3 shows the map slow with 2,000 pins, draw them on a canvas (Leaflet's canvas renderer) instead of one shape each.
  - **Done when:** moving and zooming the map stays smooth (INP under 200 ms) with 2,000 pins, or A3 shows it already is.

## Part E: The backend for more data (only where A4 shows the need)

- [ ] **E1. Filter counts in one go.** About 12 queries one after another become one or two (Postgres `GROUPING SETS`, or `FILTER` counts).
  - **Done when:** the filter-count route's p95 is under the target, with the same counts as today (tests compare them).

- [ ] **E2. Indexes.** A trigram index for search by name (`pg_trgm`, so `ILIKE '%text%'` stops reading every lead), and an index for the default sort, if `EXPLAIN ANALYZE` shows it reads too much. One migration (0013), with its `SCHEMA-0013.md`.
  - **Done when:** the slow queries from A4 use the indexes, and the schema check passes.

- [ ] **E3. Deep pages.** If page 100 of Results is slow, page by "after this lead" (keyset paging) instead of skipping rows (`OFFSET`).
  - **Done when:** the last page is as fast as the first, or A4 shows it already is.

- [ ] **E4. Short caches on the server.** Home's figures and the filter counts with no filters, kept for 30 seconds in memory and cleared when a run finishes or a lead changes. Safe because only one backend runs at a time (the one-backend lock).
  - **Done when:** A4's load test shows the gain, and a test proves a new lead shows at once after a change.

## Part F: Measure again and merge

- [ ] **F1. Measure again.** Repeat A3 and A4 exactly. A table in the Log: before, after and the target, for each number.
  - **Done when:** every target is met, or the gap and the reason are written down.

- [ ] **F2. Full checks.** The website (tests, lint, types, prettier, build) and the backend suite with `RUN_GATES=1`, one at a time. A browser check on a phone size and a laptop size, light and dark, with reduced motion on.
  - **Done when:** all pass, and the browser check is in the Log.

- [ ] **F3. Docs and merge.** DESIGN.md (the loading rule: skeleton shapes, the 200 ms delay), AGENTS.md (the measuring commands and the test database), the AI Brain. Then merge into `master` when Al-khair says.
  - **Done when:** merged, and the Log says so.

## Later, not in this plan

- More than one backend process. Today one process runs everything, because the run engine holds a lock (the one-backend lock). Running several would need the lock to cover only the run engine.
- Measuring on the DigitalOcean server, once PLAN-V6 part H is live. The laptop's numbers won't match the server's.
- Saving the cache in the browser between visits.
- An offline mode.

## Waiting on

- **Al-khair:** A5 (the sizes and targets, and which parts to do), the OK on two dev-only tools (a size report and a load-test tool), and each merge.
- **Levi:** nothing.

## Risks

- **Preloading asks the backend for pages nobody opens.** Only after 100 ms of pointing, one at a time, never when the browser saves data, and checked in the load test.
- **A cache shows old data.** Short times, and every change clears what it affects. Tests prove it.
- **Too many small code files.** Each costs a request. HTTP/2 (Caddy) handles many at once, and D1 moves only big libraries.
- **A skeleton that doesn't match the real layout makes the page jump.** The CLS target (under 0.1) catches it.
- **This laptop isn't the server.** The numbers here are for comparing before and after, not promises about the live site.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-05: **Plan written.** Read from the code first: loading is mostly words (about 14 places), pages wait for their code and then their data, the 5 Nov build has a 446 kB main file, and Results runs about 12 count queries per filter change. Nothing changed yet. Next: A1.
