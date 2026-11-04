# Contour HQ plan, version 6: a secure sign-in, then DigitalOcean

This plan puts the platform online as **Contour HQ**. It adds a sign-in for one Admin account, a login page built with care, a scheduler for the regular runs, a better company list and lead card, the files to run it in containers, and a server on DigitalOcean in Sydney.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young (the name and the cloud data OK).
- **Last updated:** 2026-11-05. **TBC** means not confirmed yet.
- **Progress:** 16 of 31 steps done (A1, A3, B1 to B5, D1 to D3, E2, E3, F2, F3, G2). C1, E1 and F1 wait only for Al-khair's yes. G1 and G3 are done except one check on the laptop. I1 waits for the live domain. Work goes on branch `plan-v6` (both tracks merged on 5 Nov).
- **Comes after:** [PLAN-V5.md](PLAN-V5.md), merged into `master` and pushed on 4 Nov (6f676ae). Its open steps (A2 and Part F, HubSpot write access) stay there and don't block this plan.

## In short

- **Goal:** Contour HQ runs on a DigitalOcean server, behind HTTPS, and only a signed-in person can use it.
- **One account for now:** Al-khair's, as Admin. The login is simple to use (email or username, and a password), but the page is designed with care and the security is strong.
- **Why the engine can't go online today:** it is locked to this computer on purpose (`api_host` must be `127.0.0.1`, and `HostGuard` lets in only `localhost`), it has no sign-in, and it has no container files. This plan fixes all three.
- **Runs on their own:** a scheduler starts the Lead Finder every 2 weeks by default (Levi, 30 Oct), and syncs HubSpot every day. A person can change when, or switch a schedule off.
- **Easier to read:** the company list gets one tidy filter bar and a clear mark for where each company came from (HubSpot, found by the research, or typed in). The lead card opens with a short summary, and its details sit in tabs instead of one long page.
- **Order:** get ready (A), accounts and sessions (B), the login page (C), the scheduler (D), the company list (E), the lead card (F), containers (G), DigitalOcean (H), check and go live (I). The mockups (C1, E1, F1) can come early, so the design is agreed before the build.
- **Cost:** no Claude money to build. DigitalOcean is about US$24 a month for the server and US$15 to US$30 for the managed database (**TBC**: check the prices on the day). Each scheduled 4-city run costs about US$8 (30 Oct estimate), so about US$16 a month every 2 weeks (**TBC**).

## Words used here

- **Session:** proof that you signed in, kept on the server. Your browser holds only a random token in a cookie.
- **Hash:** a one-way scramble of a password. The real password can't be read back from it.
- **Server mode:** a setting that opens the engine to one named domain, for running on a server. On this laptop it stays off.
- **Container:** a packed copy of the backend or the website with everything it needs, so it runs the same on the laptop and on the server.
- **Droplet:** DigitalOcean's name for a server.
- **Managed database:** a Postgres database that DigitalOcean runs, backs up and updates.

## Decisions so far (4 Nov)

- **Name:** Contour HQ. Contour fits out offices, and this is the team's central place. **TBC** with Levi.
- **Sign-in:** email or username, and a password. One Admin account. A second step (a code from an authenticator app) and Microsoft sign-in come later.
- **No sign-up page and no reset email.** A server command makes the account and resets the password.
- **Animation:** the `motion` package (formerly Framer Motion) for React. Our reading of "Framer components" (**TBC**: if Framer the website builder was meant, this changes).
- **Hosting:** one droplet and a managed Postgres with pgvector, both in Sydney (`syd1`).
- **Design references:** `engine/frontend/assets/login/` (Vanta, SaleSkip, bwell, a phone layout, and Contour's wordmark), with a README saying what we take from each and what we leave.
- **Scheduler:** in the core, so every project can schedule its own jobs. "Every N weeks on a day at a time" in Melbourne time, because plain cron can't say "every 2 weeks". Defaults: the Lead Finder every 2 weeks on Monday at 7:00 am, and a HubSpot sync every day at 6:00 am. The Lead Finder schedule starts **off**, because each run costs money: Al-khair switches it on after go-live (our recommendation, **TBC**). The free HubSpot sync starts on.
- **Where a company came from:** every lead already records it (`origin`: `hubspot`, `web` or `typed`). It becomes a mark and a filter, kept apart from the HubSpot label (New, In HubSpot, Open deal...), which says whether HubSpot has the company now.

## The login page

- **Desktop:** two halves.
  - **Left:** a Navy brand panel (#233A56) with the cream Contour wordmark and "HQ". Behind it, fine topographic contour lines in Stone, a nod to the name. Its inner edge is a soft curve.
  - **Right:** a white card on the Stone page. A serif "Welcome back" (IBM Plex Serif), then "Sign in to Contour HQ".
- **The form:** "Email or username" and "Password", each with an icon. An eye shows or hides the password. "Keep me signed in". "Forgot password?" says "Ask your Contour HQ admin to reset it." A full-width Navy "Sign in" button, with a 10px radius, not a pill.
- **Footer:** "Private system. Sign-ins are logged."
- **Phone:** the brand panel shrinks to a Navy header band, and the card fills the width.
- **States, each with an icon and words:** "Signing in.", "That email or password isn't right.", "Too many tries. Try again in 12 minutes.", "You were signed out after 2 hours idle."
- **Easy to use:** the cursor starts in the first field, Enter signs in, password managers work (`autocomplete` set), a Caps Lock warning shows, and the username is remembered on the device.
- **Motion:** the card rises 8px and fades in (250 ms), the contour lines draw once, error text fades in, and the page fades into the app. All of it stops when the computer asks for reduced motion. The one-time line drawing is longer than DESIGN.md's 250 ms, so it needs an OK as an exception (**TBC**).
- **Never:** gradients, glow, pills, emoji, social buttons, a sign-up link.

## Security

1. **Passwords** are stored only as an argon2id hash. At least 14 characters; a short phrase is fine. Common passwords, and ones that contain the email or username, are refused.
2. **Guessing:** each wrong try makes the next one wait longer. 10 wrong tries in a row lock the account for 15 minutes. Tries from one IP address are limited too. The message is the same whether the email or the password was wrong, so nobody can learn which accounts exist.
3. **Sessions** live on the server, and only a hash of the token is kept. The cookie is `__Host-` named, HttpOnly, Secure and SameSite=Strict. Signed out after 2 hours idle and after 12 hours at most; 14 days with "Keep me signed in". Signing out ends the session. "Sign out everywhere" ends them all.
4. **A sign-in log** keeps every sign-in, failure, lock, sign-out and password change, with the time and IP address. Never a password.
5. **Every route needs a session,** except the health check and the sign-in itself. The engine's Origin check stays on.
6. **Around it:** HTTPS only, HSTS, a strict content security policy, no embedding in other sites, and the keys in DigitalOcean's server, never in git.

## How to work this plan

These rules are for Al-khair and for Claude. At the start of every session: read this section, run `git switch plan-v6`, find the first step that isn't ticked, and run `brain context`.

- **Tick a step** when its "Done when" is true, in the same turn, with the date and the commit: `- [x] **B1. ...** Done 2026-11-05, abc1234.` Then update **Progress** and **Last updated**, and add a line to the Log.
- **Half done:** leave the box empty and write "Done so far:" and "Left:" under the step. **Blocked:** write "Blocked:" and why, then take the next step that isn't blocked.
- **Usage:** call `get_usage` at the start of each step, after each commit, and before anything long (a full test run, a browser check, a Docker build). At 80% on any number, run `brain-save`. At 90%, save again and finish only a small step. At 95%, start nothing: tick what is done, add a Log line, save one line with `brain inbox`, and stop. The `PreCompact` hook in `.claude/settings.local.json` saves a line before the session compacts.
- **One heavy thing at a time:** the backend tests, the website tests and a Docker build each use most of this laptop's memory. Two test runs on the same test database deadlock; a second one uses `LEADFINDER_TEST_DB_SUFFIX=_b`.
- **Commits** are small, one step each, on `plan-v6`. Push only when Al-khair asks. Merging is his call.
- **Costs money** marks a step that starts a paid service. Run it only when Al-khair says so.
- **Windows App Control** has blocked `uv run` before. If it does, stop and tell Al-khair. Don't work around it.
- **Never save** a password, a key, the account's email or the server's address in this plan, the AI Brain or git.

### Two accounts, one session each

**What happened (4 and 5 Nov):** the two tracks swapped places. Track 1 ran in a cloud session (Claude Code on the web) on `claude/dazzling-hypatia-hp3wbl`; its `git push` was refused (no write access for the Claude GitHub App), so it came to the laptop as a git bundle. Track 2 ran on this laptop in a worktree (`.claude/worktrees/plan-v6-ui`). Both were merged into `plan-v6` here on 5 Nov (c1b8971). **From now on, every merge happens on this laptop**, because only it has the database, the keys, the memory model and the AI Brain. A cloud session hands its work over as a bundle (`git bundle create`), or by a push once the GitHub App can write.

| | Track 1: backend and server | Track 2: website |
|---|---|---|
| Who | Planned: account 1 on this laptop. Ran: a cloud session | Planned: account 2 in the cloud. Ran: this laptop, in a worktree |
| Steps | A, B, D, then G, H, I | C1, E, F, then C2 to C5 once B3 is merged |
| Branch | `plan-v6` | `plan-v6-ui` |
| Runs | everything, with the database and the keys | website tests, lint, types, build, and the backend's fast tests |

1. **Only track 1 ticks steps, writes the Log and merges.** Track 2 says what it finished; track 1 fetches `origin/plan-v6-ui` and merges it into `plan-v6` after each step.
2. **Track 2 runs in the cloud,** so it has no database, no `engine/.env` keys, no AI Brain and no laptop. It never needs them: its work is the website (and E2's small filter). The integration tests, the browser checks (E3, F3) and the brain saves happen on track 1 after each merge.
3. **Generated files:** after a merge, run `uv run --no-sync engine openapi` and `npm run types` again instead of fixing `openapi.json` or `schema.d.ts` conflicts by hand.
4. **Migrations** are track 1's only (0010, 0011). E2 needs no migration: it filters on the existing `origin` column.
5. **On this laptop, one heavy job at a time:** `bash engine/scripts/heavy.sh <command>` waits while another full test run, browser check or Docker build runs.

## Part A: Get ready

- [x] **A1. Branch and baseline.** Done 2026-11-04, a3c0058 (the commit that was measured). The numbers are in the Log.
  - `plan-v6` from `master` (6f676ae). This plan and the login references are its first commit.
  - Run the backend suite with `RUN_GATES=1`, then the website checks, one at a time. The last numbers were backend 2,602 passed and 25 skipped, and website 708 tests.
  - **Done when:** the numbers are in the Log.

- [ ] **A2. The decisions.** Al-khair, with Levi for the first two.
  - **Blocked (4 Nov):** these are answers from Levi and Al-khair. Nothing built in this plan can decide them. The code works without them, and each one has a recommendation in the Log.
  - Levi's OK on the name "Contour HQ", and on keeping HubSpot data on a server in Sydney.
  - The domain, like `hq.contourinteriors.com.au` (**TBC**), and who can add its DNS record.
  - A DigitalOcean account owned by Contour, not by a person, with a card on it.
  - The OK on the one-time line drawing (longer than 250 ms), and which "Framer" was meant.
  - **Done when:** the answers are in the Log.

- [x] **A3. The new packages.** Done 2026-11-04, ac004a4. `argon2-cffi` 25.1.0 (MIT), `motion` 14.5.0 (MIT, the newest release at least 14 days old). The common-password list is `core/auth/common_passwords.txt` (NCSC, 444 entries of 14+ characters); its licence is still **TBC**.
  - Backend: `argon2-cffi` for the password hash. Website: `motion`. Check each one's licence, size and latest version, then add it with the lock files.
  - A list of common passwords to refuse, from a source with an open licence (**TBC**).
  - **Done when:** both are installed, the lock files are committed, and the checks still pass.

## Part B: Accounts and sessions (backend)

- [x] **B1. The tables.** Migration 0010. Done 2026-11-04, 3d1370b.
  - `core.users`: id, email (unique, compared in lower case), username (unique, may be empty), name, role (`admin` for now; `staff` and `viewer` are allowed for later), the password hash, when the password changed, active or not, the count of failed tries, locked until, created, last signed in.
  - `core.sessions`: id, a hash of the token (unique), the user (deleted with the user), created, last seen, expires, "keep me signed in", IP address, browser (cut to 300 characters), ended.
  - `core.audit_log`: id, when, the user (kept as empty if the user is deleted), the event (a fixed list), IP address, browser, details (JSON, never a password).
  - Indexes for what the code looks up: a token hash, a user's open sessions, the log by time, and the log by IP and time.
  - Then `scripts/schema_map.py`, and `engine/schema/SCHEMA-0010.md` committed with it.
  - **Done when:** the migration tests pass at the newest version, and `schema_map.py --check` passes.

- [x] **B2. Passwords and the Admin account.** Done 2026-11-04, bbcf1e0.
  - `core/auth/passwords.py`: hash and check with argon2id, and check the rules (14 characters at least, not common, not the email or username). A hash made with older settings is redone at the next sign-in.
  - Commands: `uv run engine create-admin --email ... --username ...` (asks for the password twice, never shows it), `uv run engine reset-password --user ...`, and `uv run engine sign-out-everyone`.
  - **Done when:** tests cover a good password, each refused one, a wrong password, and a hash with old settings.

- [x] **B3. Signing in and out.** Done 2026-11-04, 3674001. Also built: `GET /api/v1/auth/log` (the sign-in log, Admin only), which C4 needs and no step listed.
  - Routes: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-everywhere`, `GET /api/v1/auth/me`, `GET /api/v1/auth/sessions`.
  - A new random token for each sign-in, saved as a hash. The cookie as in "Security", rule 3.
  - Idle and full time limits checked on every request; "last seen" updated at most once a minute.
  - **Done when:** tests cover a sign-in, a sign-out, both time limits, "keep me signed in" and "sign out everywhere".

- [x] **B4. Every route needs a session.** Done 2026-11-04, 7fa5af6.
  - One check in the core for every `/api/v1` route, except `/health` and `/auth/login`. The live run events (SSE) are covered too: the cookie goes with them.
  - The guessing limits and the sign-in log from "Security", rules 2 and 4.
  - Off on this laptop unless asked (`AUTH_REQUIRED=false`), so local work and the fake backend work as now. Server mode always turns it on.
  - **Done when:** a test calls every route without a session and gets 401 (`auth_required`), except the two; tests cover the lock and the IP limit; and no log line holds a password or a token.

- [x] **B5. Server mode.** Done 2026-11-04, c51a6e7.
  - `SERVER_MODE=true` with `PUBLIC_ORIGIN=https://<the domain>`. It lets that host through `HostGuard`, allows that origin, listens on `0.0.0.0` inside the container, trusts the client IP that Caddy passes on (and no other), turns on secure cookies, and turns off migrating at start.
  - Off, nothing changes: the laptop keeps its `127.0.0.1` lock.
  - **Done when:** tests show both modes, and server mode refuses to start without `PUBLIC_ORIGIN`, a session setting it needs, or HTTPS.

## Part C: The login page (website)

- [ ] **C1. The mockup.**
  - The page as described in "The login page", built in the browser with fake data: desktop, phone, light and dark, and each state.
  - **Done when:** Al-khair says yes to the look.
  - **Done so far (5 Nov, c9c2d60):** built as the real page part (`src/auth/login-view.tsx`), shown with fake states at `/preview/login` on the dev server only (`?state=locked&notice=idle&remembered=1&controls=0` sets a state; it is not in the build). Checked on a desktop, a phone, light and dark, every state. 15 tests. **Left:** Al-khair's yes.

- [ ] **C2. The login page.**
  - `/login`, outside the app frame. React Hook Form and Zod, our tokens and fonts, and `motion` through `LazyMotion`.
  - **Done when:** website tests cover each state, keyboard use and reduced motion, and the design and contrast tests pass.

- [ ] **C3. The app knows who is signed in.**
  - A 401 `auth_required` from any route goes to `/login`, then back to where you were. The top bar has your name and "Sign out". "You were signed out" shows after an expiry.
  - **Done when:** website tests cover the redirect, the return, and signing out.

- [ ] **C4. The Account tab.** Admin.
  - Your sessions (device, IP address, last seen), "Sign out everywhere", and the last 100 entries of the sign-in log.
  - **Done when:** website tests pass, and it looks right on a desktop, a phone and in dark colours.

- [ ] **C5. The name.**
  - "Contour HQ" in the sidebar, the browser tab, the Home page and the docs. The logo stays.
  - **Done when:** no screen says the old name, and the tests pass.

## Part D: The scheduler

- [x] **D1. Schedules in the core.** Migration 0011. Done 2026-11-04, 2b95a24.
  - `core.schedules`: the project, the job (like `lead_finder.discovery` or `core.hubspot_sync`), its settings (JSON), every how many days or weeks, the day, the time, the time zone (`Australia/Melbourne`), on or off, the next run, the last run (with its run id or sync id) and its last error.
  - A loop in the backend checks once a minute and starts what is due. A schedule never starts twice: one backend runs (the advisory lock), and the row is claimed before it starts. A job missed while the backend was off runs once when it is back, never once for each missed time. A job that is still running is skipped, with a note.
  - Daylight saving is handled: 7:00 am Melbourne stays 7:00 am all year.
  - Projects add jobs through their `AppSpec`; the core adds the HubSpot sync. The two defaults above are made at the first start.
  - Then `scripts/schema_map.py`, and `engine/schema/SCHEMA-0011.md`.
  - **Done when:** tests cover a due job, a missed job, a job still running, a schedule switched off, and the change to and from daylight saving.

- [x] **D2. The Lead Finder's scheduled run.** Done 2026-11-04, c768c62. The default is the Start page's own default (3 cities), not 4: see the Log.
  - It uses saved Start-page choices: cities, signs, areas, and "look back" matching the schedule (14 days for every 2 weeks). The default is the 4 cities (**TBC** with Levi).
  - Money: before it starts, the estimate is checked against the run cap and the daily cap. If it doesn't fit, it doesn't start, and the reason shows on the Schedules page. The run's own caps still apply while it runs.
  - Runs started by a schedule say so on the Runs page ("Scheduled").
  - **Done when:** tests cover a run that starts, one stopped by the daily cap, and the saved choices.

- [x] **D3. The Schedules page.** Admin. Done 2026-11-04, 560205a. It is a tab of the Admin page (`/admin/schedules`).
  - Each schedule: on or off, "Every [2] [weeks] on [Monday] at [7:00 am]", the next run, the last run with its link and result, the cost estimate for one run, and "Run now".
  - Switching the Lead Finder schedule on asks for a confirm, showing the monthly cost estimate.
  - **Done when:** website tests pass, and it looks right on a desktop, a phone and in dark colours.

## Part E: The company list (Results)

- [ ] **E1. The mockup.**
  - One filter bar: the search box, then the 3 filters used most (Result, City, Source), then a "Filters" button that opens the rest in one panel (sign, industry, HubSpot label, status, run, dates). The filters in use show as small chips under the bar, each with an ×, and "Clear all". On a phone, all filters sit in the bottom sheet, as now.
  - The table: company with its source mark, result, score ("x of y"), the best sign with its date, city, HubSpot label with owner, researched date. The rest stays in the card.
  - **Done when:** Al-khair says yes to the look.
  - **Done so far (5 Nov):** shown as the built page (E3) on the fake backend, desktop, phone and dark, rather than as a separate drawing. **Left:** Al-khair's yes.

- [x] **E2. Where each company came from.** Done 2026-11-05, 8b5315b.
  - A mark with an icon and a word on every row and on the card: **From HubSpot** (the watchlist), **Found** (the research found it on the web) or **Typed** (a person typed the name). A tooltip explains each.
  - A "Source" filter, sent to the backend as `origin`, and the source in the CSV.
  - **Done when:** backend and website tests cover the filter, the mark and the CSV.

- [x] **E3. The new filter bar and table.** Done 2026-11-05, 82715d7.
  - Built as in E1. The filters stay in the address, so a link shares the view.
  - **Done when:** website tests pass, and it looks right on a desktop, a phone and in dark colours.

## Part F: The lead card

- [ ] **F1. The mockup.**
  - **At the top, the quick view** (fits without scrolling on a laptop): the name, source mark and result with its stage; the score as a bar ("51 of 77 checked") and the band; one line on why it fits; the best sign with its date and source link; staff and office size, each with where it came from; the HubSpot label with owner and link; the first person to talk to; and the actions (Watch, Reject, Send to HubSpot, Re-check).
  - **Under it, tabs:** Overview (the summary and the opening line), Facts (each fact with its source and what other sources said), Signs (every sign), Score and rules, HubSpot and look-alikes, Research (cost, notes, problems).
  - Long lists show the first 3, with "Show all".
  - The same card in the Results panel and on the lead's own page. The panel is wider on a laptop, and full screen on a phone.
  - **Done when:** Al-khair says yes to the look.
  - **Done so far (5 Nov):** shown as the built card (F2) on the fake backend, in the panel and on the page. **Left:** Al-khair's yes.

- [x] **F2. The new card.** Done 2026-11-05, f753966.
  - Built as in F1, from the parts of `lead-card-view.tsx`, which is split into smaller files (one for each tab).
  - **Done when:** website tests cover each tab and the quick view, and keyboard use works (the tabs with the arrow keys).

- [x] **F3. Check it in the browser.** Done 2026-11-05, on the merged code (c1b8971, 9bcde55): Sample Headcount (every fact), Sample Analytics (few facts, no sign), Synechron Australia (from a watchlist run, then sent to the fake HubSpot).
  - On the fake backend: a lead with every fact, one with few facts, one from HubSpot, and one sent to HubSpot.
  - **Done when:** it looks right on a desktop, a phone and in dark colours, in the panel and on the page.

## Part G: Containers

- [ ] **G1. The backend container.** `engine/backend/Dockerfile`.
  - Python 3.12 and uv, installed exactly from `uv.lock`, run as a normal user, and the embedding model built in, so it doesn't download at each start. A health check on `/api/v1/health`. A `.dockerignore`, so `.env`, `.venv` and `scripts/out/` never go in.
  - **Done when:** it builds on this laptop, starts, and answers the health check.
  - **Done so far (4 Nov, in the cloud session):** it builds (`BAKE_MODEL=0`), starts as the user `contour`, and answers the health check in 7 seconds. In server mode: Swagger isn't served, a wrong `Host` gets 400, a request with no session gets 401, and `engine migrate` runs in the image on its own. The command that bakes the memory model in was run too: it reaches FastEmbed's download and stops only because Hugging Face can't be reached here.
  - **Left:** one build on the laptop with Hugging Face reachable (`docker build -t contour-backend .` from `engine/backend`), to see the model go into the image; then pin the exact Python patch (**TBC**, see the Log).

- [x] **G2. The website container.** `engine/frontend/Dockerfile` and `engine/deploy/Caddyfile`. Done 2026-11-04, e4bfd32 (checked in the cloud session, through the whole stack: see the Log).
  - The website built once, then served as plain files by Caddy. Caddy also sends `/api` to the backend, gets the HTTPS certificate by itself, and adds the security headers.
  - **Done when:** it builds, and the headers are right when checked with `curl -I`.

- [ ] **G3. Everything together.** `engine/deploy/docker-compose.prod.yml` and `engine/deploy/README.md`.
  - Caddy, the backend (one copy only: the engine allows one backend per database) and a one-off `migrate` step before it. A local Postgres for the trial on this laptop.
  - The README is the run book: first install, an update, a rollback, a restore, and making the Admin account.
  - **Done when:** the whole thing runs on this laptop at `https://localhost`, the sign-in works, and a lead card opens.
  - **Done so far (4 Nov, in the cloud session):** everything ran together with `COMPOSE_PROFILES=trial` at `https://localhost`: a new database migrated from nothing, sign-in worked through Caddy with the Secure `__Host-` cookie, and a lead card opened in a real browser with no failed request. The update (a new `TAG`) and the rollback were run. Neither log held a cookie or a password. The run book is written.
  - **Left:** the same on the laptop, after the G1 build there. Also **TBC:** the first `docker compose up -d --build` on a machine that has never built it (the cloud session built each image from a copy of its folder, with one extra line for this session's proxy certificate).

## Part H: DigitalOcean

- [ ] **H1. The server.** **Costs money.**
  - **Blocked (4 Nov):** it costs money, so it starts only when Al-khair says so, and it needs his DigitalOcean account (A2).
  - A droplet in `syd1` with about 4 GB of memory, Ubuntu LTS and Docker. Sign-in by SSH key only. A firewall with 443 and 80 open, and 22 open to Al-khair's IP address only. Automatic security updates.
  - **Done when:** the droplet runs, and the firewall is checked from outside.

- [ ] **H2. The database.** **Costs money.**
  - **Blocked (4 Nov):** it costs money, so it starts only when Al-khair says so, and it needs the same account (A2).
  - Managed Postgres in `syd1`, with pgvector. Version 18 if DigitalOcean offers it, otherwise 17 (**TBC**: the engine runs on 18 today; check that 17 passes the tests first). Only the droplet may connect. Daily backups, and a restore to a point in time.
  - **Done when:** the droplet connects, and the migrations run.

- [ ] **H3. The deploy.**
  - **Blocked (4 Nov):** it needs H1, H2 and the domain (A2). The files are ready: `engine/deploy/README.md` is the run book.
  - The containers on the droplet. The keys in a root-only environment file on the server (mode 600), never in git. The DNS record for the domain, then HTTPS.
  - Data: a fresh database, then a HubSpot sync on the server (about 10 minutes). The 52 dev leads are moved only if Levi wants them (**TBC**).
  - **Done when:** the domain opens the login page over HTTPS.

- [ ] **H4. Backups and watching.**
  - **Blocked (4 Nov):** it needs H2 and H3.
  - One restore of the managed database to a new one, checked, then deleted. DigitalOcean's uptime check on `/api/v1/health`, emailing Al-khair.
  - **Done when:** the restore worked, and a test alert arrived.

## Part I: Check and go live

- [ ] **I1. The full check.**
  - The backend suite with `RUN_GATES=1` and the website checks, one at a time. A security review of the sign-in and server mode. The headers checked on the live domain.
  - **Done when:** everything passes, and the numbers and any fixes are in the Log.
  - **Done so far (4 Nov, in the cloud session):** the backend suite with `RUN_GATES=1` (3,011 passed, 25 skipped, 75 failed: the same 75 as at A1, which need the memory model), the website checks (735 tests, lint, types, prettier on `src`, build), a check of the packages for known holes (none), and a review of the sign-in and server mode. The numbers and the findings are in the Log.
  - **Done so far (5 Nov, on the laptop, both tracks merged, 9bcde55):** the backend suite with `RUN_GATES=1`: **3,090 passed, 25 skipped, 0 failed** in 5 min 10 s (the 75 pass here; one test written on Linux failed on Windows and was fixed, see the Log); `SCHEMA-0012.md` matches the migrated database (`schema_map.py --check`); the website: 767 tests, lint, types, prettier on the whole folder, build.
  - **Left:** the headers checked on the live domain (needs H3).

- [ ] **I2. Go live.**
  - **Blocked (4 Nov):** it needs H3, the login page (Part C, the other track) and Al-khair.
  - The Admin account made on the server (`engine create-admin`), the first sign-in, a HubSpot sync, and one small run with a low cap. Then the Lead Finder schedule switched on, when Al-khair says so (**costs money** every 2 weeks).
  - Merge `plan-v6` into `master` (Al-khair's call).
  - **Done when:** Al-khair signs in on the domain, and the Log says so.

## Later, not in this plan

- A second step at sign-in: a code from an authenticator app, with recovery codes.
- Microsoft sign-in, and more users with the `staff` and `viewer` roles.
- An email or a Home page note when a scheduled run finds new leads.
- Saved views on the company list ("Melbourne, Pass, this month").
- A test server beside the live one.

## Waiting on

- **Levi:** the name, the OK to keep HubSpot data on a server in Sydney, whether the 52 dev leads move, and the scheduled run's cities and signs (every 2 weeks is his, 30 Oct).
- **Al-khair:** the domain, the DigitalOcean account, the OK on the line drawing, and which "Framer" was meant.
- **Contour's IT:** the DNS record for the domain.

## Risks

- **A server on the internet gets attacked.** Every route needs a session; the guessing limits, a firewall, HTTPS, security updates and the sign-in log. A second sign-in step is the first thing in "Later".
- **One account means one way in.** If Al-khair loses the password, the server command resets it.
- **The database version.** If DigitalOcean doesn't offer Postgres 18, the engine must pass its tests on 17 first (H2).
- **A schedule spends money by itself.** It starts off; switching it on asks for a confirm with the monthly estimate; each run checks the run cap and the daily cap before it starts.
- **A long card gets longer again.** New facts go in a tab, not in the quick view, unless a person needs them to decide.
- **Memory.** The embedding model and a full sync need about 2 GB, so the droplet needs 4 GB (**TBC**: watch it after the first sync).
- **Data off the laptop.** HubSpot company data moves to a server in Sydney, which needs Levi's OK first (A2).

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-05: **Both tracks merged into `plan-v6` on the laptop; E2, E3, F2 and F3 ticked.** Track 1 came from the cloud session as a git bundle (its push is refused), 25 commits ending 5e96642, and `plan-v6` was fast-forwarded to it. Track 2 (built on the laptop in the `plan-v6-ui` worktree: C1 c9c2d60, E2 8b5315b, E3 82715d7, F2 f753966) was merged on top (c1b8971). **No conflict:** both started from a3c0058, and git joined the five files both changed (`openapi.json`, `schema.d.ts`, `types.ts`, `router.tsx`, `test_contract_routes.py`); `engine openapi` and `npm run types` gave the same files again. **Packages:** `uv sync` added `argon2-cffi` (Windows App Control did not block its compiled part) and `npm ci` added `motion`. **Checks on the laptop:** backend `RUN_GATES=1` 3,090 passed, 25 skipped (the cloud's 75 memory-model failures pass here); one test failed only on Windows (`test_a_ca_certificate_reaches_the_address_and_the_connection_string` expected `/run/...`, and a Windows `Path` writes backslashes; the code is right on both, the test now expects the machine's own form, 9bcde55); `SCHEMA-0012.md` matches the database; website 767 tests, lint, types, prettier, build. **Browser (fake backend, sign-in off):** a discovery run and a 3-company watchlist run; the Source filter and chips, the owner column, the HubSpot lead's card, a send to the fake HubSpot (status Sent, Watch and Reject off, the link), a lead with few facts, the Schedules tab; desktop, phone and dark. **C1, E1, F1:** the built pages are the mockups; they wait for Al-khair's yes. **Next:** C2 to C5 (B3 is merged now: the contract is in the B1 to B3 Log line, and the fake backend has `--auth`), G1 and G3's laptop check (a Docker build, heavy), A2 and H (people and money).

- 2026-11-04: **I1 half done: the numbers and the security review** (54cdb3c). **Backend, `RUN_GATES=1`:** 3,011 passed, 25 skipped, 75 failed in 6 min 13 s. The 75 are the same ones as at A1 (they need the memory model, which can't download here; none is new). At A1 it was 2,527 passed, so this track added 484 tests. **Website:** 735 tests (708 at A1), lint with no warnings, types, prettier on `src`, and the build all pass. **Packages:** `npm audit --omit=dev` found 0, and `pip-audit` on the 91 pinned backend packages found none. **The review of the sign-in and server mode** read: the password hash (argon2id, 14 characters or more, common passwords refused, equal time for an unknown account), the session token (256 random bits, only its SHA-256 kept, the `__Host-` cookie Secure and HttpOnly and SameSite=Strict, seen live through Caddy), the guard (deny by default, 401 from the headers alone, an unknown path the same), the origin and host checks, the guessing limits, the Admin-only routes, Swagger off, both logs after a real sign-in (no cookie or password), the images (no `.env`, no tests, a normal user), and the containers (read-only, no capabilities, only Caddy has ports). **One fix:** the API still listed the laptop's own origins for CORS on a server. A server now lists none (the site and the API share one origin), with tests both ways. **Accepted or open (TBC):** the public `/health` also shows the pgvector version and the project names (low value; trim it if you prefer); a live-events stream that is open when its session ends keeps going until it closes; there is no rate limit in front of the backend; `style-src` keeps `'unsafe-inline'` because the UI libraries write inline styles (scripts are `'self'` only); **the visitor's real IP address has to be checked on the live server** (if the sign-in log shows Docker's gateway `172.28.0.1` for everyone, the per-IP limit would lock everyone out together: make an A record only, or turn off Docker's user-land proxy; it is in the run book). **Before go-live (I2):** the login page (Part C, the other track) has to be merged, because the website has no sign-in form without it. Left in I1: the suite on the laptop, and the headers on the live domain.

- 2026-11-04: **G1 to G3 built and run in the cloud session** (d165a90, de43395, e4bfd32, e29f1e9). **G2 is ticked; G1 and G3 are open for one check on the laptop** (the memory model downloads from Hugging Face, which this box can't reach; see each step). **What runs:** `deploy/docker-compose.prod.yml` has `web` (Caddy, the only part with open ports: 80, 443 and 443/udp), `backend` (one copy; non-root, read-only file system, no capabilities), `migrate` (before the backend) and `db` (a Postgres with pgvector, only with `COMPOSE_PROFILES=trial`). The run book is `deploy/README.md`. **Checked on this machine** (built from copies of the folders, with one extra line for this session's proxy certificate; `BAKE_MODEL=0`): all four parts up; `curl -I https://localhost` shows `Content-Security-Policy` (with `frame-ancestors 'none'` and `form-action 'self'`), `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`, and no `Server` header; `http://` answers 308 to `https://`; a page gets `no-cache` and a hashed file under `/assets` gets `immutable`; `/api` without a session is 401; sign-in through Caddy gave the `__Host-contour_session` cookie (Secure, HttpOnly, `Path=/`) and the session saw the visitor's address from `X-Forwarded-For`; the Schedules were made at the first start (HubSpot copy on, Find new leads off); a lead card and the Schedules tab opened in a real browser with no failed request; an update (`TAG`) and a rollback recreated the parts and the backend came back healthy; neither Caddy's log nor the backend's held a cookie or a password. **Three faults the real run found, now fixed:** (1) `docker compose` from `engine/deploy` climbed to `engine/docker-compose.yml` (the development database) because the production file isn't named `compose.yaml`: `COMPOSE_FILE` in `deploy/.env` fixes it (an empty network and volume it made were removed); (2) the engine's default `POSTGRES_PORT` is 5433, the laptop mapping, but the database inside Docker is on 5432: the compose file sets it; (3) Caddy's fixed address `172.28.0.2` was taken first by another part: the other parts now get addresses from `172.28.0.128/25`. **Also built:** `POSTGRES_SSLMODE` and `POSTGRES_SSLROOTCERT` (a managed database needs TLS; `verify-full` needs the certificate file; refused at start if the file is missing), with 5 tests. **Open (TBC, also in the run book):** no rate limit in front (the standard Caddy has none; the DigitalOcean cloud firewall or a Caddy build with a module would cover it); pin the exact Python 3.12 patch the laptop uses (`--build-arg PYTHON_IMAGE=python:3.12.N-slim`); the image build needs the internet for the memory model; the database certificate file has to be mounted by hand for `verify-full`; how much memory the website build needs on the 4 GB droplet. Next: I1 (the full check), and the rest waits for people and money (A2, H1 to H4).

- 2026-11-04: **D3 ticked, Part D is done** (560205a). **Backend:** `GET /schedules`, `PATCH /schedules/{id}` and `POST /schedules/{id}/run` (`core/api/schedules.py`). Reading needs a session; changing a schedule and Run now need the Admin role, because they can spend money. A job adds three optional hooks to its `JobSpec`: `estimate` (what one start costs, the prices used, why it wouldn't start now), `describe` (the saved choices in a sentence) and `check_settings`. Money is in whole cents: what a start costs is rounded up, what is left to spend is rounded down. Run now goes through the same loop code and checks as a start on time (it can answer `skipped` with the reason), works for a schedule that is off, and never moves the next run. Switching on, or changing `every`, `unit`, `weekday` or `at` of a schedule that is on, sets the next run to the first time from now. **Website:** a Schedules tab in Admin (one card for each schedule): on or off, "Every [2] [weeks] on [Monday] at [07:00]" as a form, what it does, the next and last run (with a link to the run or the syncs), what one run costs, and Run now. Switching on a job that costs money, and Run now for one, ask first and show what a run and a month of runs cost; a job that is free (the HubSpot copy) doesn't ask. If a run wouldn't start now (over the limit), the card says why, and Run now goes straight to the answer. Checked in a real browser against the real backend on a desktop, a phone (iPhone 13) and in dark colours, and fixed what that showed (the switch stays at the right on a phone, the words stay with their controls, a run over the limit no longer says "never more than"). **Not built (TBC):** there is no editor for the saved choices (cities, signs, how far back) on the page; the API takes them (`settings`), so Levi's answer on cities and signs can be applied by a call, but not yet by a click. The time field shows the browser's own style (am/pm or 24-hour). Backend integration tests for the endpoints: 36 on a fake job (the table's rules, edits, 422s, Run now, who may) and 10 with the real Lead Finder job (the plan's US$7.80 and US$16.96 a month at past prices, US$24.80 without them, Sydney too large); website 24 tests. Full backend run with `RUN_GATES=1` is repeated at I1. Fast suite 2,357 passed; website 735 tests, lint, types and prettier (`src`) pass. Next: G1 to G3.

- 2026-11-04: **D2 ticked** (c768c62). The job `lead_finder.discovery` starts a discovery run from the schedule's saved choices (the Start page's: `cities`, `triggers`, `area`, `since_days`, `caps`; a part left out gets the Start page's value). **A decision for Al-khair and Levi (TBC): the default is 3 cities, not the plan's 4.** The Start page's own default is Melbourne, Adelaide and Perth with the 4 main signs (12 searches). Sydney makes 16, and the limits allow 13: each search holds US$0.60 against 40% of the US$20 run limit (the comment in `core/config.py` says the limits were sized for 3 x 4 = 12). A default that can't start is no default. To search Sydney too: raise the run limit to US$25 in Settings (16 x US$0.60 = US$9.60 fits 40% of US$25), then add Sydney to the saved choices. **The fit check:** before it starts, the run's own estimate is checked. A typical run (never the worst case, which is above the run limit for every discovery run) must be within the run limit and within what is left of today's limit, or the schedule is skipped and says why on the schedule (`last_error`). The run's own limits still apply while it works. **A new database has no past prices,** so the estimate uses its placeholders (US$1.00 a company, US$0.40 a search): the default run shows US$24.80 and would be skipped (above US$20). With real prices (about US$0.30 a company and US$0.15 a search, from past runs) it is about US$7.80, the plan's "about US$8". **For G3 and H4:** do one run by hand on the server before switching the schedule on, so the prices are real (or raise the run limit). **The mark:** migration 0012 adds `core.runs.schedule_id`; `RunOut.schedule_id` is in `openapi.json` (three website test fixtures needed `schedule_id: null`); the Runs table shows "Scheduled" and the run page says "Started by: A schedule". **Look-back:** a run now accepts `since_days` 14 (the plan's 14 days for every 2 weeks); the Start page still offers 7 and 30 (TBC: offer 14 there too?). Full backend run with `RUN_GATES=1`: 2,957 passed, 25 skipped, 75 failed (the same 75); fast suite 2,357 passed; website 710 tests, lint and types pass (`prettier --check .` flags `assets/login/README.md`, which was committed before this work). Next: D3.

- 2026-11-04: **D1 ticked** (2b95a24). `core.schedules` holds one row per job (`project`, `job`, `settings`, `every`, `unit` days or weeks, `weekday`, `at_time`, `timezone`, `enabled`, `next_run_at`, `last_run_at`, `last_status`, `last_ref` (the run id or sync id), `last_error`). A loop in the backend wakes once a minute, claims each due row (`FOR UPDATE SKIP LOCKED`), moves `next_run_at` on **before** it starts the job, so a schedule can't start twice; it runs only on the backend that holds the advisory lock. A job missed while the backend was off runs once, never once per missed time (the next time is counted from the scheduled time, so the missed ones are skipped). A job still running is skipped with a note in `last_status` and `last_error`. Times are wall-clock in the row's zone (`zoneinfo`): 7:00 am Melbourne stays 7:00 am all year; a time that doesn't exist on the spring day runs at 3:30, and one that happens twice runs the first time. `enabled` is true exactly when `next_run_at` is set (a table check). Projects add jobs through `AppSpec.jobs` (`JobSpec`: `key`, `start`, `running`, `default`; a job says it can't run now by raising `JobSkipped` with a plain reason). The core adds `core.hubspot_sync` (every day at 6:00 am, **on**); the HubSpot sync's `trigger` gained the value `schedule`. **For track 2:** that adds one value to the `trigger` enum in `openapi.json` (the Admin page's label list gained `schedule: 'Schedule'`, one line). **For G1:** `tzdata` is now a direct dependency (the slim container has no zone files). Full backend run with `RUN_GATES=1`: 2,916 passed, 25 skipped, 75 failed (the same 75 that need the memory model); fast suite 2,332 passed; website 708 tests, lint, types and prettier pass. Next: D2.

- 2026-11-04: **Part B is done** (B4 7fa5af6, B5 c51a6e7). Full backend run with `RUN_GATES=1`: 2,848 passed, 25 skipped, 75 failed (the same 75 that need the memory model, none new); fast suite 2,301 passed; website 708 tests, lint, types. **B5:** `SERVER_MODE=true` needs `PUBLIC_ORIGIN` (https only) and `TRUSTED_PROXIES` (Caddy's address or network; `*` and `/0` are refused), or the backend won't start and names each missing piece. It also refuses `AUTH_REQUIRED=false`, `SESSION_COOKIE_SECURE=false` and `AUTO_MIGRATE=true` written next to it, so nothing you wrote is quietly ignored. On: the public host (and `localhost`, `127.0.0.1` for the container's health check) passes the host check, only the public origin may post, it listens on `0.0.0.0`, sign-in and the `__Host-` Secure cookie are on, it doesn't migrate at start, and Swagger isn't served. Only a connection from `TRUSTED_PROXIES` may say who a client is; a real uvicorn in the tests proves it (what a client writes before Caddy's entry is not believed). **For G2 and G3:** Caddy must pass the visitor's `Host` header on (it does by default) and the backend's address in `TRUSTED_PROXIES` is the Docker network's, like `172.18.0.0/16` (**TBC**: read it from `docker network inspect` on the server). The compose health check can call `http://127.0.0.1:8000/api/v1/health`. `engine migrate` must be its own step before the backend.

- 2026-11-04: **B4 ticked** (7fa5af6). The guard is plain ASGI middleware with deny by default: only `GET /health`, `POST /auth/login` and the Swagger pages (where the app has them) need no session. Anything else, even a path that doesn't exist, answers 401 `auth_required` from the headers alone, so no body is read (an anonymous 1 GB upload to the HubSpot import is turned away at its headers) and no route can be mapped. **Guessing:** the first 2 wrong tries are free, then waits of 2, 4, 8, 16, 32 and 60 seconds, and the 10th in a row locks the login for 15 minutes (every wrong try after a lock locks again). A try during a wait answers 429 and checks, counts and logs nothing. A login with no account follows the same rules in memory (by a hash of what was typed), so the lock can't show which accounts exist; one IP address gets 20 wrong tries in 15 minutes. **For track 2:** a wrong try that starts a wait answers 401 `invalid_credentials` with `retry_after_seconds` (count down on the button); a try during a wait or a lock answers 429 `too_many_attempts` with `retry_after_seconds`, the `Retry-After` header and the sentence "Too many tries. Try again in 12 minutes." in `detail`. For the browser checks (C2 to C5, E3, F3) start the fake backend with sign-in on: `uv run python -m tests.e2e.serve --auth` from `engine/backend` prints a demo Admin (`demo@example.test` or `demo`) and its random password once; without `--auth` sign-in is off in it, whatever `engine/.env` says. **A bug the new guard exposed in B3:** it loads the session in its own database session, so a route got a detached object and a logout wasn't saved; B3's own tests caught it, and it is now an UPDATE by id. **Checked over real HTTP** too (the real backend with `AUTH_REQUIRED=true`, `curl` and a cookie jar): the wait, the 429, the cookie flags, the live-events route with and without the cookie, a foreign-origin POST (403 before the guard), logout, the log. The real backend's log held no password or token. **Open (TBC):** a live-events stream that is already open when its session ends keeps going until it closes; a flood of tries from many IP addresses can still use up the database pool (a Caddy rate limit in G2 would cover it).

- 2026-11-04: B1, B2 and B3 ticked (3d1370b, bbcf1e0, 3674001). **For track 2, the contract is in `openapi.json` and `schema.d.ts` now.** `POST /auth/login` takes `{login, password, keep_signed_in}` and sets the cookie (a JSON body, no `credentials` setting needed: the site and `/api` share one origin). Wrong login or password: 401 `invalid_credentials`, "That email or password isn't right." A route with no session: 401 `auth_required`; if a session ended, `reason` is `idle`, `expired` or `ended` and `detail` is the sentence to show ("You were signed out after 2 hours idle."). `GET /auth/me` gives `{auth_required, user, session}`: `auth_required: false` means sign-in is off on this backend (the laptop default), so show no sign-in page and no "Sign out". `GET /auth/sessions` and `GET /auth/log` (Admin, `limit` 1 to 200, default 100) are for C4; `POST /auth/logout` gives 204 and `POST /auth/logout-everywhere` gives `{sessions_ended}`. **Decisions that were mine (TBC with Al-khair):** "Keep me signed in" has no idle limit and lasts 14 days (the plan didn't say; without this it would end at the first 2-hour break); the sign-in log endpoint was added. **Numbers:** full backend run with `RUN_GATES=1` 2,705 passed, 25 skipped, 75 failed (the same 75 that need the memory model); fast suite 2,184 passed; website 708 tests. New tests: 13 for the tables, 64 for the passwords, 25 for the admin commands, 31 through the app, 45 for the small parts. The commands were also run in a real terminal (a pseudo-terminal): nothing typed was echoed. **Not pushed:** the cloud session's `git push` is refused with 403 (the Claude GitHub App has no write access to `hizWindy/contour`), so the commits are only in this session until that is fixed. Next: B4, then B5.

- 2026-11-04: A1 and A3 ticked (a3c0058 measured, ac004a4 built). **Backend 2,527 passed, 25 skipped, 75 failed** with `RUN_GATES=1` in 3 min 34 s. 2,527 + 75 is the laptop's 2,602. All 75 need the memory model, which can't download here (Hugging Face is blocked), except one (`test_guards.py::test_the_guard_works_in_a_real_pytest_run`) that fails only because the scratch plugin used to fail fast renames `Embedder._load`. Each of the 74 otherwise waits 40 s on FastEmbed's retries. **Website:** lint 0 warnings, types, 708 tests, build, all pass. A3: `argon2-cffi` 25.1.0 and `motion` 14.5.0 (14.9.1 is from today, so the newest one at least 14 days old is used). The lock files only gained entries (npm 10 here drops the laptop npm's `libc` markers, so they were put back by hand).

- 2026-11-04: **Track 1 started from a cloud session** (Claude Code on the web), not the laptop, on `claude/dazzling-hypatia-hp3wbl`, which stands in for `plan-v6`. This box has Docker (Postgres 18.6 with pgvector from `pgvector/pgvector:pg18`, port 5433, test database as on the laptop) but no AI Brain, no `get_usage`, no keys, and no memory model. It runs Python 3.13.18: the system's 3.12.3 cannot import `core/runs/types.py` (a `Protocol` can't inherit `AsyncIterator` there), so the laptop's 3.12 must be a newer patch (**TBC**: check which, and use the same one in G1). Steps that start a paid service (H) and steps that need Al-khair's or Levi's answers (A2) stay open.

- 2026-11-04: Added three parts at Al-khair's ask: D the scheduler (every 2 weeks by default, changeable, a daily HubSpot sync), E the company list (one filter bar, a mark for where each company came from), F the lead card (a quick view on top, the details in tabs). Containers, DigitalOcean and go-live became G, H and I. 31 steps.

- 2026-11-04: Plan written after the ideas session: Contour HQ, one Admin account with email or username and a password, a login page from the 6 references, containers, and DigitalOcean in Sydney. No step started.
