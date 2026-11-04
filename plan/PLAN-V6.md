# Contour HQ plan, version 6: a secure sign-in, then DigitalOcean

This plan puts the platform online as **Contour HQ**. It adds a sign-in for one Admin account, a login page built with care, the files to run it in containers, and a server on DigitalOcean in Sydney.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young (the name and the cloud data OK).
- **Last updated:** 2026-11-04. **TBC** means not confirmed yet.
- **Progress:** 0 of 22 steps done. Work goes on branch `plan-v6`.
- **Comes after:** [PLAN-V5.md](PLAN-V5.md), merged into `master` and pushed on 4 Nov (6f676ae). Its open steps (A2 and Part F, HubSpot write access) stay there and don't block this plan.

## In short

- **Goal:** Contour HQ runs on a DigitalOcean server, behind HTTPS, and only a signed-in person can use it.
- **One account for now:** Al-khair's, as Admin. The login is simple to use (email or username, and a password), but the page is designed with care and the security is strong.
- **Why the engine can't go online today:** it is locked to this computer on purpose (`api_host` must be `127.0.0.1`, and `HostGuard` lets in only `localhost`), it has no sign-in, and it has no container files. This plan fixes all three.
- **Order:** get ready (A), accounts and sessions in the backend (B), the login page (C), containers (D), DigitalOcean (E), check and go live (F). The mockup (C1) can come right after A, so the design is agreed before the build.
- **Cost:** no Claude money to build. DigitalOcean is about US$24 a month for the server and US$15 to US$30 for the managed database (**TBC**: check the prices on the day).

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

## Part A: Get ready

- [ ] **A1. Branch and baseline.**
  - `plan-v6` from `master` (6f676ae). This plan and the login references are its first commit.
  - Run the backend suite with `RUN_GATES=1`, then the website checks, one at a time. The last numbers were backend 2,602 passed and 25 skipped, and website 708 tests.
  - **Done when:** the numbers are in the Log.

- [ ] **A2. The decisions.** Al-khair, with Levi for the first two.
  - Levi's OK on the name "Contour HQ", and on keeping HubSpot data on a server in Sydney.
  - The domain, like `hq.contourinteriors.com.au` (**TBC**), and who can add its DNS record.
  - A DigitalOcean account owned by Contour, not by a person, with a card on it.
  - The OK on the one-time line drawing (longer than 250 ms), and which "Framer" was meant.
  - **Done when:** the answers are in the Log.

- [ ] **A3. The new packages.**
  - Backend: `argon2-cffi` for the password hash. Website: `motion`. Check each one's licence, size and latest version, then add it with the lock files.
  - A list of common passwords to refuse, from a source with an open licence (**TBC**).
  - **Done when:** both are installed, the lock files are committed, and the checks still pass.

## Part B: Accounts and sessions (backend)

- [ ] **B1. The tables.** Migration 0010.
  - `core.users`: id, email (unique, compared in lower case), username (unique, may be empty), name, role (`admin` for now; `staff` and `viewer` are allowed for later), the password hash, when the password changed, active or not, the count of failed tries, locked until, created, last signed in.
  - `core.sessions`: id, a hash of the token (unique), the user (deleted with the user), created, last seen, expires, "keep me signed in", IP address, browser (cut to 300 characters), ended.
  - `core.audit_log`: id, when, the user (kept as empty if the user is deleted), the event (a fixed list), IP address, browser, details (JSON, never a password).
  - Indexes for what the code looks up: a token hash, a user's open sessions, the log by time, and the log by IP and time.
  - Then `scripts/schema_map.py`, and `engine/schema/SCHEMA-0010.md` committed with it.
  - **Done when:** the migration tests pass at the newest version, and `schema_map.py --check` passes.

- [ ] **B2. Passwords and the Admin account.**
  - `core/auth/passwords.py`: hash and check with argon2id, and check the rules (14 characters at least, not common, not the email or username). A hash made with older settings is redone at the next sign-in.
  - Commands: `uv run engine create-admin --email ... --username ...` (asks for the password twice, never shows it), `uv run engine reset-password --user ...`, and `uv run engine sign-out-everyone`.
  - **Done when:** tests cover a good password, each refused one, a wrong password, and a hash with old settings.

- [ ] **B3. Signing in and out.**
  - Routes: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-everywhere`, `GET /api/v1/auth/me`, `GET /api/v1/auth/sessions`.
  - A new random token for each sign-in, saved as a hash. The cookie as in "Security", rule 3.
  - Idle and full time limits checked on every request; "last seen" updated at most once a minute.
  - **Done when:** tests cover a sign-in, a sign-out, both time limits, "keep me signed in" and "sign out everywhere".

- [ ] **B4. Every route needs a session.**
  - One check in the core for every `/api/v1` route, except `/health` and `/auth/login`. The live run events (SSE) are covered too: the cookie goes with them.
  - The guessing limits and the sign-in log from "Security", rules 2 and 4.
  - Off on this laptop unless asked (`AUTH_REQUIRED=false`), so local work and the fake backend work as now. Server mode always turns it on.
  - **Done when:** a test calls every route without a session and gets 401 (`auth_required`), except the two; tests cover the lock and the IP limit; and no log line holds a password or a token.

- [ ] **B5. Server mode.**
  - `SERVER_MODE=true` with `PUBLIC_ORIGIN=https://<the domain>`. It lets that host through `HostGuard`, allows that origin, listens on `0.0.0.0` inside the container, trusts the client IP that Caddy passes on (and no other), turns on secure cookies, and turns off migrating at start.
  - Off, nothing changes: the laptop keeps its `127.0.0.1` lock.
  - **Done when:** tests show both modes, and server mode refuses to start without `PUBLIC_ORIGIN`, a session setting it needs, or HTTPS.

## Part C: The login page (website)

- [ ] **C1. The mockup.**
  - The page as described in "The login page", built in the browser with fake data: desktop, phone, light and dark, and each state.
  - **Done when:** Al-khair says yes to the look.

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

## Part D: Containers

- [ ] **D1. The backend container.** `engine/backend/Dockerfile`.
  - Python 3.12 and uv, installed exactly from `uv.lock`, run as a normal user, and the embedding model built in, so it doesn't download at each start. A health check on `/api/v1/health`. A `.dockerignore`, so `.env`, `.venv` and `scripts/out/` never go in.
  - **Done when:** it builds on this laptop, starts, and answers the health check.

- [ ] **D2. The website container.** `engine/frontend/Dockerfile` and `engine/deploy/Caddyfile`.
  - The website built once, then served as plain files by Caddy. Caddy also sends `/api` to the backend, gets the HTTPS certificate by itself, and adds the security headers.
  - **Done when:** it builds, and the headers are right when checked with `curl -I`.

- [ ] **D3. Everything together.** `engine/deploy/docker-compose.prod.yml` and `engine/deploy/README.md`.
  - Caddy, the backend (one copy only: the engine allows one backend per database) and a one-off `migrate` step before it. A local Postgres for the trial on this laptop.
  - The README is the run book: first install, an update, a rollback, a restore, and making the Admin account.
  - **Done when:** the whole thing runs on this laptop at `https://localhost`, the sign-in works, and a lead card opens.

## Part E: DigitalOcean

- [ ] **E1. The server.** **Costs money.**
  - A droplet in `syd1` with about 4 GB of memory, Ubuntu LTS and Docker. Sign-in by SSH key only. A firewall with 443 and 80 open, and 22 open to Al-khair's IP address only. Automatic security updates.
  - **Done when:** the droplet runs, and the firewall is checked from outside.

- [ ] **E2. The database.** **Costs money.**
  - Managed Postgres in `syd1`, with pgvector. Version 18 if DigitalOcean offers it, otherwise 17 (**TBC**: the engine runs on 18 today; check that 17 passes the tests first). Only the droplet may connect. Daily backups, and a restore to a point in time.
  - **Done when:** the droplet connects, and the migrations run.

- [ ] **E3. The deploy.**
  - The containers on the droplet. The keys in a root-only environment file on the server (mode 600), never in git. The DNS record for the domain, then HTTPS.
  - Data: a fresh database, then a HubSpot sync on the server (about 10 minutes). The 52 dev leads are moved only if Levi wants them (**TBC**).
  - **Done when:** the domain opens the login page over HTTPS.

- [ ] **E4. Backups and watching.**
  - One restore of the managed database to a new one, checked, then deleted. DigitalOcean's uptime check on `/api/v1/health`, emailing Al-khair.
  - **Done when:** the restore worked, and a test alert arrived.

## Part F: Check and go live

- [ ] **F1. The full check.**
  - The backend suite with `RUN_GATES=1` and the website checks, one at a time. A security review of the sign-in and server mode. The headers checked on the live domain.
  - **Done when:** everything passes, and the numbers and any fixes are in the Log.

- [ ] **F2. Go live.**
  - The Admin account made on the server (`engine create-admin`), the first sign-in, a HubSpot sync, and one small run with a low cap.
  - Merge `plan-v6` into `master` (Al-khair's call).
  - **Done when:** Al-khair signs in on the domain, and the Log says so.

## Later, not in this plan

- A second step at sign-in: a code from an authenticator app, with recovery codes.
- Microsoft sign-in, and more users with the `staff` and `viewer` roles.
- A sync timer on the server, now that the platform runs all the time.
- A test server beside the live one.

## Waiting on

- **Levi:** the name, the OK to keep HubSpot data on a server in Sydney, and whether the 52 dev leads move.
- **Al-khair:** the domain, the DigitalOcean account, the OK on the line drawing, and which "Framer" was meant.
- **Contour's IT:** the DNS record for the domain.

## Risks

- **A server on the internet gets attacked.** Every route needs a session; the guessing limits, a firewall, HTTPS, security updates and the sign-in log. A second sign-in step is the first thing in "Later".
- **One account means one way in.** If Al-khair loses the password, the server command resets it.
- **The database version.** If DigitalOcean doesn't offer Postgres 18, the engine must pass its tests on 17 first (E2).
- **Memory.** The embedding model and a full sync need about 2 GB, so the droplet needs 4 GB (**TBC**: watch it after the first sync).
- **Data off the laptop.** HubSpot company data moves to a server in Sydney, which needs Levi's OK first (A2).

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-04: Plan written after the ideas session: Contour HQ, one Admin account with email or username and a password, a login page from the 6 references, containers, and DigitalOcean in Sydney. No step started.
