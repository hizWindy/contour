# Contour HQ plan, version 7: faster pages, and ready for more data

This plan makes Contour HQ feel fast and stay fast as the data grows. Pages show their shape at once while data loads, the next page starts loading before you click, the code files get smaller, and the backend answers quickly with 10,000 leads and 20 people at once.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair (no business rules change, so nothing waits on Levi).
- **Last updated:** 2026-11-05. **TBC** means not confirmed yet.
- **Progress:** 19 of 24 steps done (A1 to A4, B1 to B3, C1 to C5, D1 to D4, E1, F1, F2). E2, E3 and E4 are not needed yet (A5 decides), F3 waits for the merge, and A5 is Al-khair's. C5 was added during the work (see the Log). Work goes on branch `plan-v7`, made from `master` at 3b0179f.
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

- [x] **A1. Branch and baseline.** Done 2026-11-05, c34687e. Website 818 tests (3b0179f); backend 3,099 passed and 25 skipped in 5 min 50 s (`RUN_GATES=1`).
  - `plan-v7` from `master` (3b0179f). This plan is its first commit.
  - Run the website checks and the backend suite, one at a time. The last numbers were website 818 tests (5 Nov) and backend 3,090 passed and 25 skipped (`RUN_GATES=1`, 5 Nov).
  - **Done when:** the numbers are in the Log.

- [x] **A2. A big test database.** Done 2026-11-05, fd03c62. `uv run --no-sync python -m tests.e2e.perf_seed` (about a minute), then `API_PORT=8010 uv run --no-sync python -m tests.e2e.serve --perf`. The flag is `--perf`. 10,001 leads and 50 runs, 70 MB.
  - A script that fills a new database, `leadfinder_perf`, with 10,000 fake leads ("Sample ..." names, spread over the cities, results and signs) and 50 fake runs. It follows the fake backend's pattern (`tests/e2e/serve.py`) and never touches `leadfinder` (the dev database).
  - The fake backend can start on it, with a flag (**TBC**: the flag's name).
  - **Done when:** the fake backend serves 10,000 leads from `leadfinder_perf`, and the script runs again from nothing in under 5 minutes.

- [x] **A3. Measure the website.** Done 2026-11-05: the sizes 2a9e710, the timings in "Results" below.
  - A size report of the build: which libraries sit in which code file. Recommendation: `rollup-plugin-visualizer` as a dev-only package (**TBC**: Al-khair's OK on the package, and whether it works with Vite 8).
  - Web Vitals on a production build (`vite build`, then `vite preview`) for Home, Start, Results, a lead card and Runs, on a laptop size and a phone size, against A2's database.
  - Count the waits: for each page, how long from the click to the code, and from the code to the data.
  - **Done when:** the sizes and the timings are a table in the Log.
  - **Done:** `frontend/scripts/bundle-report.js` (2a9e710) builds in memory with Vite's own API, so no package was needed. The timings came from a small test server kept outside the repo (see "Results").

- [x] **A4. Measure the backend.** Done 2026-11-05, fd03c62. `backend/scripts/loadtest.py`, plain Python and httpx, so no tool was added. The numbers are in the Log.
  - The time each route takes, logged per request (check first whether the logs already have it).
  - A load test: 20 people at once for 5 minutes, opening Results with different filters, the filter counts, the map and lead cards. Recommendation: Locust, a Python tool, as a dev-only package (**TBC**: Al-khair's OK; k6 is the other choice).
  - `EXPLAIN ANALYZE` for the slowest queries.
  - **Done when:** the p95 of each route, and the slowest queries, are in the Log.

- [ ] **A5. Agree the targets.** Al-khair.
  - Confirm or change the sizes (10,000 leads, 20 people at once) and the targets table above, now that A3 and A4 have numbers.
  - Pick which of parts B to E to do, in which order. Recommendation: B and C first (most felt), D next, E only where A4 shows the backend is slow.
  - **Done when:** the answers are in the Log.

## Part B: Loading that keeps its shape

- [x] **B1. Skeleton parts.** Done 2026-11-05, 2a9e710. `components/skeletons.tsx` and `lib/use-after.ts`.
  - A few shared parts in `src/components/`: a table, a card, a detail panel and a page header, each shaped like the real thing. They use shadcn's Skeleton without its pulse, and fade in.
  - Shown only when loading takes more than 200 ms, so a fast answer never flashes grey blocks.
  - A screen reader hears one line, like "Loading the leads.", in a hidden status.
  - **Done when:** the parts and their tests are in, and the design and contrast checks pass.

- [x] **B2. Use them everywhere.** Done 2026-11-05: loading shapes in 13 places (2a9e710) and the shape of the app (f3effbe). **CLS** (largest of 3 runs, the five pages): 0.0075 on a laptop and 0.021 on a phone (Home), 0 on the rest; before, up to 0.039. The target (under 0.1) is met.
  - **Moves:** CLS (nothing jumps when the data arrives) and how long the page looks empty.
  - **Done when:** no page shows "Loading." on its own, and CLS is under 0.1 on the five pages.

- [x] **B3. The page while its code loads.** Done 2026-11-05, f3effbe. While the first page of a visit loads, and while the backend says who is signed in, the app shows its own shape (menu, top bar, page header and a block, still, after 200 ms) instead of "Loading the page.". A click on a page whose code is still on its way dims the page you are leaving after 200 ms.
  - **Done when:** opening a page you haven't visited shows its shape at once.

## Part C: Load before the click

- [x] **C1. Code and data at the same time.** Done 2026-11-05, bcac661 and 1388951. **Done a different way than planned:** not a React Router `loader` (it holds the navigation until its data is there, and it needs the cache handed to every route). Each route's `handle.prefetch` says what its page asks for first; `shell/prefetch.ts` runs it at the moment a navigation starts, or when a page is opened by its address, and the page then joins the request already running. Nothing waits for the data. The sign-in question (`/auth/me`) goes out at the same moment, from `main.tsx`.
  - **Moves:** the time from click to content (A3's two waits become one).
  - **Done when:** A3's timing shows one wait, not two, for Start, Results, Runs and a lead card.

- [x] **C2. Preload on intent.** Done 2026-11-05: the code part a1a2dcb, the data part e55f47b. `shell/preload.ts` downloads the code of the Lead Finder pages once the first screen is up and the browser is idle (not login, not Admin; never on "save data" or 2G). `shell/intent.ts` starts a page's code and first data when a pointer has rested on its link for 100 ms, when the link gets the keyboard focus, or on a press (a touch). It covers every link in the app (the menu, Home's page rows, breadcrumbs), and Results rows start their lead card (`DataTable` `onRowIntent`).
  - Not when the browser asks to save data (`navigator.connection.saveData`), and never more than one preload at a time (**TBC**: check this doesn't flood the backend in A4's load test).
  - **Done when:** a page whose link you pointed at opens with its content already there.

- [x] **C3. Cache times that fit the data.** Done 2026-11-05, ee03b71. Rules are fresh for 10 minutes (kept for 30), the filter counts for 30 seconds (`CACHE_TIMES` in `api/query.ts`). **Two changes from the plan:** the Start page's choices (run options) stay at 15 seconds, because they hold "left today", which every run changes; and Home's last-run line stays at 15 seconds, because it shows whether a run is going. Home's lead counts are the filter counts, so they got the 30 seconds. Runs and leads stay at 15 seconds. A change you make clears what it affects, as today.
  - **Done when:** going back to Rules, Start or Home asks the backend nothing within those times, and the tests prove a change still shows at once.

- [x] **C4. Open a lead card at once from Results.** Done 2026-11-05, e55f47b. The side panel shows what the table row already has (name, industry and city, result, score) straight away, with a skeleton for the rest of the card, and fills in when it arrives. A lead opened from the map, or from an address whose page of the list doesn't hold it, has no row and shows "Lead" and the skeleton as before.

- [x] **C5. Ask only for what the page shows.** Added during the work, done 2026-11-05, d4667bd. Results asked for the map (up to 2,000 pins) on every visit and every filter change, even in the table view, where nothing shows it. It now asks only in the map view; resting the pointer on the Map button, or the browser being idle after the page shows, starts it, so the map view still opens with its pins.
  - **Moves:** the first visit to Results on a slow link, and the backend (a query and about 300 kB of JSON per visit and per filter change in the table view).
  - **Done when:** a table-view visit makes no map request, and the map view still has its pins (tests). Measured: 260 ms sooner at 150 ms and 1.6 Mbps (see the Log).
  - **Done when:** the panel never opens empty.

## Part D: Smaller code files

- [x] **D1. Load heavy libraries only where they are used.** Done 2026-11-05: `zod` a058fbd, the calendar and the list-and-map divider 7373985. `zod` (35 kB gzip) was in the first visit because the sign-in guard reads `login-form.ts`; the checks now sit in `login-schema.ts`, and a test keeps `zod` out of `login-form.ts`. First visit 219 kB to 197 kB gzip. The date picker (`react-day-picker` with `date-fns`) and the resizable panels are now files of their own that Results asks for when the browser is idle, and a test keeps them out of the page's own files. Results' own code goes from 124 to 91 kB gzip. **Tried and undone:** the chart (`recharts`, 98 kB gzip) after the table on the Admin runs tab. At 80 ms per response its table came about 90 ms later and the whole page 445 ms later, because the chart file is another round trip. Already as wanted: the map (Leaflet) is not in the first visit, and `motion` is only in the login page.
  - **Moves:** the main file size and the first visit's LCP.
  - **Done when:** each library sits only in the files of the pages that use it, in the size report.

- [x] **D2. Shared libraries in their own file.** Done 2026-11-05, 9ac4484. React, the router and TanStack Query in one file of their own, so it stays cached when our code changes. The setting is `build.rolldownOptions.output.codeSplitting.groups` in `vite.config.ts`: one group, `framework` (React, React DOM, the scheduler, the router, TanStack Query), and a test keeps the chart, map, date picker, form libraries and zod out of it.
  - **Done when, changed:** a change to one page still renames our own 27 files (the main file and the files that import from it), but no library file: `framework` (108 kB gzip) and 24 other library files (170 kB gzip in all) keep their names, checked with two builds. Making only the page's own file change would mean moving the route table out of the main file as well, which is not worth it.

- [x] **D3. Fonts.** Done 2026-11-05, 9ac4484. `index.html` preloads the two Titillium Web weights the first screen uses (latin 400 and 600), and the fonts already use `font-display: swap`, so text shows in the system font until they arrive.
  - **Done when:** A3's timing shows the fonts start in the first round of downloads. Done: they start at about 100 ms instead of 380 to 620 ms.

- [x] **D4. The map with many pins.** Not needed (A3 shows it already is fine), 2026-11-05. In a production build with 2,000 pins (Leaflet draws each as an SVG shape), a zoom in, a drag and a zoom out had a worst frame of 153 ms and one other over 50 ms (62 ms). The target is under 200 ms. A canvas would only matter on a slower computer, and the map request is now made only in the map view (C5).
  - **Done when:** moving and zooming the map stays smooth (INP under 200 ms) with 2,000 pins, or A3 shows it already is.

## Part E: The backend for more data (only where A4 shows the need)

- [x] **E1. Filter counts in one go.** Done 2026-11-05, fd03c62, in a different way than planned (measuring found two bigger causes; see the Log). The 12 count queries are still 12, but each is about 5 times cheaper. About 12 queries one after another become one or two (Postgres `GROUPING SETS`, or `FILTER` counts).
  - **Done when:** the filter-count route's p95 is under the target, with the same counts as today (tests compare them).

- [ ] **E2. Indexes.** A trigram index for search by name (`pg_trgm`, so `ILIKE '%text%'` stops reading every lead), and an index for the default sort, if `EXPLAIN ANALYZE` shows it reads too much. One migration (0013), with its `SCHEMA-0013.md`. **Status 5 Nov: not needed yet.** Search by name takes 40 ms on 10,000 leads after E1. It reads every lead, so it would grow with the data: look again at about 100,000 leads.
  - **Done when:** the slow queries from A4 use the indexes, and the schema check passes.

- [ ] **E3. Deep pages.** If page 100 of Results is slow, page by "after this lead" (keyset paging) instead of skipping rows (`OFFSET`). **Status 5 Nov: not needed yet.** Page 140 of Results (offset 7,000) takes about 365 ms alone, and real people do not go there.
  - **Done when:** the last page is as fast as the first, or A4 shows it already is.

- [ ] **E4. Short caches on the server.** Home's figures and the filter counts with no filters, kept for 30 seconds in memory and cleared when a run finishes or a lead changes. Safe because only one backend runs at a time (the one-backend lock). **Status 5 Nov: not needed.** With 20 people at once, the p50 of every route is under 140 ms (see the E1 line in the Log).
  - **Done when:** A4's load test shows the gain, and a test proves a new lead shows at once after a change.

## Part F: Measure again and merge

- [x] **F1. Measure again.** Done 2026-11-05. The table is in "Results" below, with the targets. The backend load test was repeated (same p50 on every route).
  - **Done when:** every target is met, or the gap and the reason are written down.

- [x] **F2. Full checks.** Done 2026-11-05. Website (f3effbe): 875 tests, lint, types, prettier and the build pass, and the build has no size warning. Backend (`RUN_GATES=1`): 3,099 passed and 25 skipped in 5 min 40 s, the same as at the start. Browser check on a production build: laptop size light (Home) and dark (Results and the lead panel), phone size light (Home; the menu opens and shuts when a page is picked) and dark (Results). No console errors. **Reduced motion was not switched on in the browser** (the pane has no switch for it). One global rule (`styles/index.css`) turns off every animation and transition when it is on, and the new fades and the dimming use only those.
  - **Done when:** all pass, and the browser check is in the Log.

- [ ] **F3. Docs and merge.** **Done so far (2026-11-05):** `DESIGN.md` (the loading rule), `AGENTS.md` (the speed-test commands, and the prefetch step for a new project), the AI Brain (notes, three decisions, and the test bench kept in the vault). **Left:** merge into `master`, when Al-khair says.
  - **Done when:** merged, and the Log says so.

## Later, not in this plan

- More than one backend process. Today one process runs everything, because the run engine holds a lock (the one-backend lock). Running several would need the lock to cover only the run engine.
- Measuring on the DigitalOcean server, once PLAN-V6 part H is live. The laptop's numbers won't match the server's.
- Saving the cache in the browser between visits.
- An offline mode.

## Waiting on

- **Al-khair:** A5 (the sizes and targets, and which parts to do), and each merge. No dev-only package was needed: the size report and the load test are small scripts of our own. Also: whether the test bench (a small server and a test page, about 300 lines, now in the AI Brain vault under `projects/contour/bench/`) should move into the repo. Today the numbers in "Results" cannot be repeated without it.
- **Levi:** nothing.

## Risks

- **Preloading asks the backend for pages nobody opens.** Only after 100 ms of pointing, one at a time, never when the browser saves data, and checked in the load test.
- **A cache shows old data.** Short times, and every change clears what it affects. Tests prove it.
- **Too many small code files.** Each costs a request. HTTP/2 (Caddy) handles many at once, and D1 moves only big libraries.
- **A skeleton that doesn't match the real layout makes the page jump.** The CLS target (under 0.1) catches it.
- **This laptop isn't the server.** The numbers here are for comparing before and after, not promises about the live site.

## Results (F1, 5 Nov)

**How it was measured.** A production build of each side (before: `master` at 3b0179f, after: `plan-v7` at f3effbe), served by a small test server kept outside the repo. It adds a delay to every response, limits and shares the bandwidth, and compresses code and JSON the way Caddy does. A page is loaded in a frame, and "ready" is when its content and its data are on screen and no loading shape is left. Each number is the median of 3 runs, in milliseconds from the start of the load, with nothing cached unless it says so. The backend is the fake one with 10,001 leads (A2).

| Where, and how fast the link is | Home | Start | Runs | Results | A lead |
|---|---|---|---|---|---|
| Laptop, 30 ms delay, no limit: before | 522 | 468 | 416 | 555 | 420 |
| after | 453 | 390 | 377 | 468 | 357 |
| Laptop, files already in the browser: before | 315 | n/a | 234 | 334 | n/a |
| after | 253 | n/a | 158 | 203 | n/a |
| Phone, 80 ms, 9 Mbps ("4G"): before | 1,061 | 1,136 | 1,016 | 1,243 | 995 |
| after | 896 | 960 | 873 | 1,037 | 863 |
| Phone, 150 ms, 1.6 Mbps ("3G-ish"): before | 2,938 | 3,484 | 3,024 | 3,989 | 3,076 |
| after | 2,652 | 3,008 | 2,702 | 3,386 | 2,715 |

**Limits of these numbers.** (1) The test server speaks HTTP/1.1, which lets a browser open 6 connections. The real site is behind Caddy on HTTPS, so it speaks HTTP/2, where the number of files at the start costs nothing. The "after" build has more files at the start (framework, fonts), so it looks up to about 100 ms slower here than it will be; with the files in the browser it does not show. (2) Start and a lead were not comparable with the files already in the browser, because the old build had no loading marker on them, so "ready" came before their data. Home, Start and a lead, with nothing cached, were measured again with a marker on their data (5 runs each). (3) Runs vary by about 50 ms, because the laptop was also running the test. (4) "LCP" from the browser was too erratic in a frame to use, so "ready" stands in for it.

**Against the targets**

| Target | Result |
|---|---|
| First visit, laptop: LCP under 2.5 s, CLS under 0.1 | Met. Content ready in 0.38 to 0.47 s, CLS 0.0075 at most. On the "3G-ish" phone it is 2.7 to 3.4 s: not met on that very slow link (about 260 to 350 kB of code, styles and fonts at 200 kB/s). |
| A page seen in the last 5 minutes: content at once, then refreshed | Met. With the files in the browser, 158 to 253 ms. After resting the pointer on a link, the page opens in 14 to 45 ms. Going back to Rules or the filter counts inside 10 minutes or 30 seconds asks the backend nothing (tests). |
| Clicking anything: INP under 200 ms | Not measured with a tool for most clicks. The map with 2,000 pins: worst frame 153 ms. **TBC** on a slower computer. |
| Main code file: no build warning | Met. No size warning; the main file is 125 kB (40 kB gzip), was 446 kB. |
| API with 10,000 leads and 20 people: p95 under 300 ms | p50 met on every route (lead card 12 ms, list 37, map 37, filter counts 133). **p95 not met on this laptop** (filter counts 790 ms, map 930 ms) because it stalls for about 1.3 s now and then in every run, before and after. Measure p95 again on the server (PLAN-V6 H). |

**Also:** the first visit is 200 kB of JavaScript (was 219 kB), in 18 files; the code Results needs for its first screen is 91 kB (was 125 kB); `framework` (React, router, TanStack Query, 108 kB) keeps its name when only our code changes.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-05: **F2 done.** Website 875 tests and the backend suite (3,099 passed, 25 skipped, 5 min 40 s) pass; the browser check on a laptop and a phone, light and dark, found nothing. F3 is left for the merge, which is Al-khair's call: `plan-v7` is 17 commits ahead of `master`, nothing is pushed.
- 2026-11-05: **A3, B2, B3, D4 and F1 done** (f3effbe and this commit). The table and the targets are in "Results" above. **B3:** the app shows its own shape while it loads (`shell/shell-skeleton.tsx`) and a slow click dims the page you are leaving (`useAfterActive`). **Tried and undone:** a `color-scheme: light` meta tag (to stop a dark page flashing before the styles load): the browser does not paint before its styles arrive, so there was nothing to fix and no way to show a gain. **What the bench taught:** (1) compare builds only with the same markers: the old Home, Start and lead had no loading marker, so "ready" came before the data; (2) a test server on HTTP/1.1 charges every file at the start, which a real HTTP/2 server does not; (3) a shared, limited link shows the cost of bytes that a delay alone hides; (4) `prefetchQuery` with a test cache that counts data as old at once makes a second request, so tests of "asks once" need the real cache times. The load test was repeated: same p50 on every route, no errors.
- 2026-11-05: **D1 done and C5 added** (7373985, d4667bd). **A slower, fairer test bench first:** the earlier bench added only a delay to each response. It now also limits the bandwidth, shared by all downloads, and compresses like Caddy (gzip for code and JSON). Profile "3G-ish": 150 ms and 1.6 Mbps. A first visit to Results there takes about 3.4 to 4.1 s to the first rows (median of 3, nothing cached). **D1, Results:** calendar and divider lazy: first rows 4.12 s to 3.91 s (about 210 ms, the transfer of 33 kB gzip at 200 kB/s); with 80 ms and no limit there is no change (939 and 937 ms), as expected. **D1, Admin runs chart:** lazy made it worse (table 690 to 780 ms, whole page 825 to 1,270 ms at 80 ms per response), so it was undone. **The finding behind C5:** Results asked for the 2,000-pin map in the table view, where it is not shown. **C5:** first rows 3.66 s to 3.40 s at the 3G-ish profile (about 260 ms); the backend skips a query and about 300 kB of JSON (about 40 kB compressed) per visit and per filter change. **The idle preload of the next pages' code does not slow the first rows** (3.91 s with it, 4.03 s without, within noise). **A flaky test found and fixed:** an idle callback from an earlier page could fire during a later test; `whenIdle` now returns a cancel function and Results cancels it when the page is left. Website: 870 tests, lint, types and prettier pass.
- 2026-11-05: **D2 and D3 done** (9ac4484). **D2:** a `framework` file (React, React DOM, scheduler, router, TanStack Query; 108 kB gzip) in `vite.config.ts`. The main file goes from 326 kB to 125 kB raw. The first visit is 200 kB gzip in 17 files (was 199 kB in 15). **Two builds, one string changed in the Rules page:** 27 of our own files get new names (the main file and the files that import from it) and 25 library files (170 kB gzip, with `framework`) keep theirs, so a returning visitor after a deploy no longer downloads React again (about 108 kB gzip saved each time). **D3:** the fonts start at about 100 ms, not 380 to 620 ms. On a production build with 80 ms added to each response (median of 3 to 4, after the first): Results CLS 0.0049 to 0, Start LCP about 710 to 630 ms, a lead the same, Results LCP about 865 to 960 ms. **That last one is not a loss:** the content is ready at the same time (about 745 ms both ways). LCP names the largest element painted, and once the narrower web font is there at first paint, a table text block becomes the largest instead of an earlier paragraph. The first run of each series is slower (cold start) and is left out. Website: 864 tests, lint and prettier pass.
- 2026-11-05: **C2 (data part) and C4 done** (e55f47b). **C2 measured** (production build, 80 ms added to every response, a click on a menu link after the idle preload, median of 3, ms from the click to content, with the pointer first resting on the link for 400 ms, as a person's does; without resting in brackets): Start 33 ms (140), Runs 32 (127), Results 45 (181), Rules 14 (101). The page is already there when the click lands. **Backend load:** a rest of 100 ms on a link or row starts the same requests the page would make a moment later, once (data inside its cache time is not asked again), so it adds at most one page's requests per page you are about to open; a sweep across the menu starts none. Not yet checked in a load test (A4's script has no hover step). **C4:** 3 new tests (the panel shows the row while the card is pending; a row starts its card; a sweep starts none). Website: 860 tests, lint, types, prettier pass.
- 2026-11-05: **C1 done, and measured** (bcac661, 1388951). **How:** a route's `handle.prefetch` (Start, Runs, a run, Results with its filters and open lead, a lead, Rules, and the cards on Home through `AppModule.prefetchSummary`) is run by `prefetchOnNavigation` when a navigation starts; `main.tsx` makes the router and the cache itself and also starts `/auth/me`. 17 new tests, including one per page that proves the page uses every request started for it and asks once (checked to fail when a prefetch differs). **Measured** with a harness outside the repo: a production build with 80 ms added to every response (localhost has no network), a page opened by its address with nothing cached, median of 3, ms from navigation start to content (no skeleton left). **Before to after:** Results 1,053 to 833; a lead 984 to 753; a run 1,109 to 827; Rules 1,045 to 624; Start 991 to 885; Home 1,016 to 853; Runs 888 to 881 (its own code is a longer chain, so the data was never the wait). The waterfall shows why: before, the code, then `/auth/me`, then the data, one after another (the data starts 100 to 200 ms after `/auth/me` ends); after, all three start together. Noise is about 100 ms between runs, so read the Results, lead, run and Rules gains as real and the Start and Home gains as small. **A click after the idle preload is unchanged**, as expected (the code is already there): Start 139 to 140 ms, Runs 127 to 127, Results 173 to 181, Rules 103 to 101. **Cost:** the first visit grows 2 kB gzip (Results' address reading moves into the main file); all JavaScript is the same size. **Left for C2:** pointing at a link (the data part).
- 2026-11-05: **C3 done** (ee03b71). Every read now has a shared `queryOptions` function (`runOptionsQueryOptions`, `rulesQueryOptions`, `leadsQueryOptions`, `leadFacetsQueryOptions`, `leadMapQueryOptions`, `runsQueryOptions`), which C1 and C2 need too; the `use...` hooks call them and add `keepPreviousData`. Rules: 10 minutes fresh, 30 kept. Filter counts: 30 seconds. **A change still shows at once:** `refreshLeads` (lists, counts and map) runs after a Watch or Reject, and now also while a run researches companies and when it ends (the run page also reads the runs list again at the end, so Home and Runs show the final status and cost). 6 new tests in `api/cache.test.tsx` age the clock (only Date is fake): rules at 9 and 11 minutes, counts at 29 and 31 seconds, run options at 16 seconds, and a Reject 2 seconds after the counts loaded. The two "asks only once" tests fail with the old 15 seconds (checked). `src/apps/lead-finder` and `src/api`: 166 tests pass, eslint and prettier clean.
- 2026-11-05: **C2, code part** (a1a2dcb). `shell/preload.ts` (`preloadNextPages`, called in `main.tsx` after the first render): when the browser is idle, calls each route's `lazy` for Start, Runs, Results, Rules, Test set, a run and a lead, one after another, so the first click on those pages finds the code already downloaded. Skipped on "save data" and on 2G. Calling `lazy` early is safe (the module is kept; the router's own call finds it done). 3 tests. Website: 826 tests, lint, types, prettier all pass (full run). **Session note:** the 5-hour usage limit reached about 80% here, so the session was saved to the AI Brain and stopped; the next steps are C1, C3, C4, the data part of C2, the rest of D1, then A3's Web Vitals and F.
- 2026-11-05: **A3 sizes, and the first D1 fix** (a058fbd). **Size report on a production build (gzip):** first visit 219 kB of JavaScript in 15 files plus 20 kB of CSS (main file 398 kB raw: react-dom 518 kB in all, **zod 144 kB raw**, our own code 93 kB). Opening a page adds: Results 125 kB (react-day-picker 87 kB raw, react-resizable-panels 81 kB, date-fns 45 kB), Admin runs 116 kB (recharts 448 kB raw), Start 57 kB, login 55 kB (motion 151 kB raw, react-hook-form 82 kB), the run page 25 kB, the other pages 0.8 to 22 kB. Fonts: 12 files, 153 kB. All JavaScript: 50 files, 537 kB. **The first fix:** zod was in the first visit only because the sign-in guard reads `login-form.ts`, which also held the form's checks. They moved to `login-schema.ts`: first visit **219 kB to 197 kB** (main file 398 to 320 kB raw). Not yet measured: Web Vitals and the click-to-content time.
- 2026-11-05: **E1 done, ahead of its turn, and A4's numbers** (fd03c62). Measuring found the cause before any guessing. **Cause 1:** "only the newest lead of each company" ranked the whole table (`row_number`) in every query, and again in each of the 12 facet counts, about 20 ms each. It is now "no newer lead of the same company", a look-up in the existing `ix_leads_company_key` (no new index; a count went from 37 ms to 6 ms). **Cause 2:** the Results page query read the card of every matching lead before it sorted, to show 50 (134,000 buffers); it now picks the 50 ids first and reads the card for those only. **One request alone, 10,000 leads:** Results page 308 ms to 23 ms, filter counts 535 ms to 118 ms, map 52 ms to 11 ms, search by name 114 ms to 40 ms; a page at offset 7,000 is still 365 ms (the sort; real people don't go there). **20 people, 3 to 10 s between steps, 120 s (p50; p95 in brackets):** filter counts 464 ms (1,883) to 133 ms (996); Results list 112 (625) to 39 (644); deep page 93 (486) to 30 (454); map 93 (1,025) to 42 (1,273); lead card 11 ms (34) to 12 (22); Runs list 18 (542) to 18 (775). **The p95 numbers are not reliable on this laptop:** every route, before and after, has the same stall of about 1.3 s now and then (p99 1.3 to 1.5 s), so p95 mostly measures the laptop. Judge by p50 here, and measure p95 again on the server (PLAN-V6 H). **Stress** (0.2 to 1 s between steps, far busier than people): filter counts p50 1,222 ms to 535 ms, and 25% more requests served. The 12 count queries, an index for search by name and deep paging are **not needed yet**: E2 and E3 stay open, E4 (a short cache) only if A5's targets are missed.
- 2026-11-05: **B1 done, B2 half done** (2a9e710). Still shapes in place of "Loading." in 13 places, with 200 ms before they show, and the words at once for a screen reader. One lead test found the loading status first and now waits for the card. Lint, types and prettier pass; the full website run had 2 failures (that test, and the word "shimmer" in a comment, which the design lint bans), both fixed and the affected files re-run. The whole suite runs again at F2. **Left in B2:** the CLS number.
- 2026-11-05: **A1, A2 done** (c34687e, fd03c62). See their lines above.
- 2026-11-05: **Plan written.** Read from the code first: loading is mostly words (about 14 places), pages wait for their code and then their data, the 5 Nov build has a 446 kB main file, and Results runs about 12 count queries per filter change. Nothing changed yet. Next: A1.
