# Contour HQ plan, version 8: DigitalOcean App Platform

This plan makes Contour HQ run on DigitalOcean's App Platform, where DigitalOcean looks after the server. It needs three small changes: the first Admin account made by itself, the visitor's address read from the front door's header, and one file that describes the whole app. The Docker and Caddy way ([PLAN-V6](PLAN-V6.md), Part G) stays and still works.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair (nothing here changes a business rule, so nothing waits on Levi, except the HubSpot-data-in-Sydney OK that is already open).
- **Last updated:** 2026-11-06. **TBC** means not confirmed yet.
- **Progress:** 3 of 7 steps done (A1 to A3), and B1, B3 and B4 half done. **The app is live** since 6 Nov: `contour-hq` in Sydney, https://contour-hq-mxeqw.ondigitalocean.app, on the managed database `contour-db`. The take-over change for B3 is on `master`, not deployed yet. The work was done on branch `app-platform`, made from `master` at a966f89. **Merged into `master` and pushed on 2026-11-06** (a fast-forward, so `master` and `app-platform` are the same commit; only `master` was pushed).
- **Comes after:** [PLAN-V7.md](PLAN-V7.md). The open steps of [PLAN-V6.md](PLAN-V6.md) (A2, and part H for a droplet) stay there.

## In short

- **Why:** Al-khair chose App Platform over a droplet: no server to patch, no firewall and no certificates to look after, and no Caddy.
- **What changed in the engine:**
  1. `engine migrate` makes the first Admin account from `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD`, so nobody types a password at a terminal. Once an Admin exists the settings are ignored.
  2. `CLIENT_IP_HEADER=do-connecting-ip` says whose word is taken for a visitor's address. App Platform's front door has no fixed address, so `TRUSTED_PROXIES` can't name it.
- **What was added:** [`.do/app.yaml`](../.do/app.yaml) (the website, the backend, the migrate step and a Postgres), its tests, and a run book ([engine/deploy/README.md](../engine/deploy/README.md), "On App Platform").
- **Not proven:** none of it has run on DigitalOcean. Part B is the first real deploy, and two of its checks could force a change (B2 and B3).
- **Cost:** about US$32 a month to start: the backend US$25 (`apps-s-1vcpu-2gb`) and a dev database US$7. About US$19 if `apps-s-1vcpu-1gb` is enough. A managed database costs more. **TBC:** check the prices on the day. Nothing is bought until Al-khair makes the app.

## Words used here

- **App Platform:** DigitalOcean's service that builds an app from a GitHub repo and runs it. We don't manage a server.
- **App spec:** the file (`.do/app.yaml`) that tells App Platform what the app is made of.
- **Front door:** App Platform's own HTTPS entrance. It does what Caddy did: HTTPS, and sending `/api` to the backend.
- **Dev database:** App Platform's cheap Postgres (US$7 a month, 512 MB, no backups). A managed database is the real one, with backups.
- **One-backend lock:** the engine takes a Postgres lock so that only one backend runs on a database. A second one refuses to start.

## How to work this plan

- At the start of a session: read this section, run `git switch app-platform`, find the first step that isn't ticked, and run `brain context`.
- **Tick a step** when its "Done when" is true, with the date and the commit. Then update **Progress** and **Last updated**, and add a line to the Log.
- **Usage, one heavy thing at a time and small commits** work as in [PLAN-V7](PLAN-V7.md). Run `git branch --show-current` right before each commit.
- **Push and merge only when Al-khair says.** The file reads the repo on GitHub, so B1 needs a push.
- **Keys:** never in a file, never in a message. They go in the DigitalOcean dashboard, encrypted. Nothing is created or bought at DigitalOcean without Al-khair's word.

## Part A: The engine and the file (done)

- [x] **A1. The first Admin account by itself.** Done 2026-11-06, ca6f3ec.
  - `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` (and `FIRST_ADMIN_USERNAME`, `FIRST_ADMIN_NAME`) in `core/config.py`. `engine migrate` (`_first_admin` in `core/cli.py`, `create_first_admin` in `core/auth/admin.py`) makes the account when both are set and no Admin exists. It does nothing when an Admin exists, and says to remove the password.
  - Same password rules as `create-admin`. The password is a `SecretStr`, redacted in logs, never printed. The sign-in log says `by: settings`. Only one of the two set, a login that isn't allowed or a weak password stops the deploy and says why.
  - **Done when:** `tests/core/test_first_admin.py` (a real database) and the settings and log tests pass.
- [x] **A2. The visitor's address behind App Platform.** Done 2026-11-06, ca6f3ec.
  - `CLIENT_IP_HEADER` in `core/config.py`: server mode needs it or `TRUSTED_PROXIES`, never both. A header a visitor can write (`X-Forwarded-For`, `Host`, ...) is refused as the setting. `client_ip` in `core/api/signin.py` reads that one header when it holds one valid address (the last line, if a visitor sent the header too and the front door added its own), and the connection's address otherwise. `engine serve` then trusts no forwarding header at all.
  - **Done when:** `tests/core/test_client_ip.py` and the server-mode tests pass, including the sign-in log.
- [x] **A3. The file, its tests and the run book.** Done 2026-11-06, in the commit that adds this plan.
  - [`.do/app.yaml`](../.do/app.yaml), `tests/core/test_app_platform_file.py` (19 tests, no DigitalOcean needed), the run book, both `.env.example` files, `AGENTS.md` and `.gitattributes`.
  - **Done when:** the whole backend suite passes, and the run book says what to do and what is not confirmed.

## Part B: The first deploy (Al-khair, needs a live app)

- [ ] **B1. Make the app.** Follow "Set up" in the run book (**Al-khair's call**: it creates paid resources). **Done when:** the website opens at the app's address and the first Admin signs in.
  - Done so far: `app-platform` merged into `master` and pushed, then the app made on 6 Nov (dashboard draft, then the spec pasted). The website opens and the backend is healthy.
  - Left: the first Admin signs in. The deploy that added the keys failed on B3, so the keys aren't in the running backend yet. The migrate step ran before it, so the account is probably there already.
- [ ] **B2. Check the visitor's address.** Run check 1 of "Check after the first deploy" in the run book. **Done when:** the sign-in log shows your own public address after you send a fake `do-connecting-ip`. **If it shows the fake one,** App Platform does not replace the header and anyone could write their address. Don't put real data in. Decide then (**TBC**): another header, or the connection's address.
- [ ] **B3. An update must work.** **Done when:** a deploy finishes with the backend healthy, and its log says `run_engine_taken_over`.
  - Done so far: the first update (6 Nov, adding the keys) failed as feared: the new backend quit with `Another backend is already running on this database` while the old one kept running. Built the **take-over** mode (`take_over_later` in `core/runs/lifecycle.py`): in server mode the new backend starts without the run engine (the run routes answer 503 `runs_not_ready`, the rest works), tries the lock every 5 seconds, and once the old one has let it go recovers the runs and starts the run engine, the scheduler and the HubSpot copy. On a laptop a second backend still refuses to start. Tests: `test_runs_lifecycle.py` (waits, takes over, recovers a run the old one left; stops trying when the app stops) and `test_contract_routes.py` (the lifespan starts the background work only on take-over).
  - Left: deploy it. The deploy that brings this change still meets the old code, which holds the lock and stops normally, so it should go through. Then one more deploy proves it.
- [ ] **B4. Before real data.** **Done when:** a backup exists and a restore is tried, and Levi has agreed to HubSpot data in Sydney.
  - Done so far (6 Nov): the dev database couldn't be used at all (`permission denied for database db` on `CREATE SCHEMA core`: a dev database doesn't let the app make schemas), so the managed cluster `contour-db` was made first (PostgreSQL 18, Sydney, US$15.15: 1 GB, 22 connections, daily backups) and the app connects as `doadmin`. pgvector and every migration worked on it. `.do/app.yaml` now matches the live spec (managed database, alerts, and no `disable_edge_cache`, which App Platform refuses for an app with a static site).
  - Left: a restore tried once, Levi's OK before the HubSpot key is used (it was added on 6 Nov), and a database user of the engine's own instead of `doadmin` (**TBC**).

## Waiting on

- **Levi:** the OK to keep HubSpot data on a server in Sydney. It is needed before the HubSpot key goes in, and PLAN-V6 has the same question open.
- **Al-khair:** whether to use a domain (`hq.contourinteriors.com.au`) or the `ondigitalocean.app` address for now. The app works without a domain. Contour owns and pays for the DigitalOcean account.

## Risks

- **The take-over mode is not proven live yet** (B3). If a deploy still fails, the old backend keeps running and nothing is lost.
- **A visitor-written header** (B2). Only the live check settles it.
- **The app uses the database's admin user** (`doadmin`). Fine for now; a user with fewer rights is safer (**TBC**).
- **The keys shown in a screenshot on 6 Nov** (Anthropic, Signal Hire, HubSpot) should be replaced with new ones.
- **The website's files come without Caddy's security headers** (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`). Not confirmed whether App Platform can add them. If it can't, serve the website through the backend or a small Caddy.
- **A deploy stops a run in progress.** It is marked interrupted: open it and press Resume. That is why a push doesn't deploy by itself.

## Log

Newest first.

- 2026-11-06: **The app is live, and the take-over mode is built.** In order: the dashboard's Create page made a backend-only draft from `engine/backend` (it can't read `.do/app.yaml`), which failed as expected; pasting the spec was refused for `disable_edge_cache` (not allowed with a static site), then accepted without it; the deploy stopped at `migrate` because the dev database doesn't let the app create schemas; the managed cluster `contour-db` was made and the spec pointed at it (`production: true`, `db_name: defaultdb`, `db_user: doadmin`), and the deploy went live at 02:46 (the `syd` region name and pgvector both worked). Adding the keys started the first update, which failed on B3; the take-over mode was built for it on `master`.
- 2026-11-06: **`master` pushed to `origin`** at Al-khair's word ("Push it"): 25 commits, a plain fast-forward push (nothing forced) from a373f0f. `app-platform` was not pushed. GitHub now has `.do/app.yaml` on `master`, which the app file reads. B1 is half done: the app is left.
- 2026-11-06: **Merged into `master`** at Al-khair's word ("Merge it"). `master` was at a966f89 and had nothing of its own, so it was fast-forwarded to the tip of `app-platform` with no merge commit. Nothing was pushed: `master` is 24 commits ahead of `origin/master` (a373f0f, as last fetched). `app-platform` is kept (it is the same commit) and can be deleted when Al-khair likes. B1 is half done: the push and the app are left.
- 2026-11-06: **A1 to A3 done** on `app-platform`, not merged, not pushed. Backend suite: 3,164 passed and 25 skipped in 6 min 31 s (`RUN_GATES=1`), against 3,099 and 25 before this plan. The sign-in tests ran again after the last change (the last line of a doubled header): 642 passed. **Read from DigitalOcean's docs the same day:** Sydney (`SYD`) is listed for App Platform apps, but the `syd` slug and a dev database there are not confirmed; `deploy_on_push` is valid on jobs; a service health check with no `http_path` is a TCP check; `preserve_path_prefix` exists. The docs do not say whether the Create page reads `.do/app.yaml`, or whether a new backend starts before the old one stops. **The file's own test caught one slip:** the migrate job had no `deploy_on_push: false`.
