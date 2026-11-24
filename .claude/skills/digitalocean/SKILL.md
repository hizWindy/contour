---
name: digitalocean
description: Contour's DigitalOcean set-up and how to work it safely - the doctl context, the live app contour-hq and its address, custom domains and DNS, the managed database contour-db (backups, restore, trusted sources, maintenance), deploys, rollback, restart, logs, the console, settings, alerts, limits and prices, each checked against DigitalOcean's docs and the live account. Use before any doctl command, deploy or DigitalOcean change, and whenever asked where the app, the domain or the database is, what it costs, or what DigitalOcean or App Platform can or can't do.
---

# DigitalOcean

Contour HQ runs on DigitalOcean App Platform, in Sydney. This skill holds the account rules, what is live, and where each answer comes from. Every fact was checked on 20 Nov 2026, against DigitalOcean's docs and the live account (doctl 2.6.0). **TBC** means not confirmed yet.

## The files

| File | What's in it |
|---|---|
| [APP.md](APP.md) | App Platform: what it can and can't do, deploys, rollback, restart, logs, console, settings, alerts, maintenance mode, prices |
| [DOMAINS.md](DOMAINS.md) | Custom domains, DNS and certificates, and what a domain would change for Contour |
| [DATABASE.md](DATABASE.md) | The managed Postgres: connections, backups, restore, trusted sources, maintenance window |
| [DOCTL.md](DOCTL.md) | Every doctl command we use, checked against the local doctl, and the ones that show secrets |

The run book is [engine/deploy/README.md](../../../engine/deploy/README.md) ("On App Platform"). The app's spec is [.do/app.yaml](../../../.do/app.yaml). Don't copy them here.

## The account

- **doctl** is at `C:\Users\Asus\AppData\Local\Programs\doctl\doctl.exe`. It is not on PATH, so use the full path (see DOCTL.md).
- **Always add `--context contour`.** The current context is `default`, and there is also `instacredit`. Both are other accounts. Without the flag, a command runs on the wrong account.
- **Check the account:** `doctl account get --context contour` shows the contourinteriors.com.au account, active.
- **Don't switch the current context** (`doctl auth switch`). It changes it for Al-khair's other projects too.
- **Never read, print or store a token or password.** If sign-in is needed, Al-khair does it himself: `! doctl auth init --context contour`.
- **The claude.ai DigitalOcean connector:** which account it is signed into is **TBC**. Use doctl instead.
- **Since 25 Nov 2026, Windows App Control blocks `doctl.exe`** ("An Application Control policy has blocked this file"). Look through the connector instead: `apps/apps-get-deployment-status` with the app ID sees `contour-hq`, so for apps it reaches this account. It has no deploy action, so Al-khair presses Actions, Deploy in the dashboard.

## What is live (20 Nov 2026)

- **The app:** `contour-hq`, ID `ee6c11e8-3b86-4755-8aa6-4c35ae7c48fe`, region `syd`. It has `backend` (apps-s-1vcpu-2gb, one copy), `web` (a static site) and `migrate` (a pre-deploy job, apps-s-1vcpu-1gb).
- **The address:** https://contourhq.online, since 20 Nov 2026 (PLAN-V24's Log). The old `contour-hq-mxeqw.ondigitalocean.app` still serves the website, but the backend answers it with 400 `host_not_allowed`.
- **The domain:** `contourhq.online` (20 Nov 2026). DOMAINS.md was written before it, so its DNS set-up is **TBC** there.
- **The database:** `contour-db`, PostgreSQL 18, 1 node, `db-s-1vcpu-1gb`, 10 GiB disk, `syd1`. See DATABASE.md.
- **Deploys:** by hand only (`deploy_on_push` is false). The last four were all manual, 17 to 19 Nov. The active one is from 24 Nov 2026, 22:09 UTC (PLAN-V27, `b52190b`).
- **The project** "Contour HQ" holds the app and the database. The account's default project is "first-project".

These facts change. Check them live before you state one (DOCTL.md, "Look").

## Found on 20 Nov (for Al-khair to decide)

1. **The live app doesn't match `.do/app.yaml`.** The live app is missing `EMBEDDING_THREADS=1` and the backend's three alerts (CPU, memory, restarts) from PLAN-V15 T1-6. Add them at Settings, App Spec, Edit. Don't use `doctl apps update` with the file, because it drops the keys.
2. **`FIRST_ADMIN_PASSWORD` is still in the live settings.** The run book says to delete it once the first Admin exists.
3. **The database has no trusted sources.** Any address on the internet can try to connect, though it still needs the password and TLS. Recommendation: make the app the only trusted source (DATABASE.md). The run book says this happens when the app attaches, but the live list is empty.
4. **A database update is pending.** It runs in the maintenance window: Mondays at 22:03 UTC, which is Tuesdays at 9:03 am in Sydney, during work hours. The next window is 24 Nov 2026, Sydney time. Recommendation: move the window to a weekend night (DATABASE.md).
5. **The project lists a second database that no longer exists** (`doctl databases get` gives 404). It is probably the dev database tried on 6 Nov. It is harmless and costs nothing (**TBC**).

## Check, don't guess

- **A live fact:** run the "Look" commands in DOCTL.md. They are free and change nothing.
- **A feature, limit or price:** read the right file here, then the docs page it cites. For a doctl flag, run `doctl <command> --help`.
- **The docs disagree** in places, for example on build memory and on what a restore makes. The files say which page says what. Say so too, and don't pick one silently.
- **Nothing answers it:** say "not confirmed yet". Don't fill the gap from memory.
- **A new fact found:** update the file it belongs in, with the date and the source.

## Ask first

Looking is fine. These need Al-khair's word first:

1. **A deploy, restart or rollback.** Each one restarts the backend, and a run in progress stops (it is marked interrupted). A deploy normally comes with the go signal `deploy vNN`.
2. **A spec change** (`doctl apps update --spec`, or App Spec, Edit). Applying `.do/app.yaml` drops the keys added in the dashboard. Export the live spec first, change that copy, and keep `.do/app.yaml` the same.
3. **Anything that costs money or deletes:** a new app, droplet or database, a bigger size, a domain, or any `delete`. Never raise the backend above one copy: the engine allows one backend for each database.
4. **Keys and settings:** Al-khair sets them in the dashboard, with Encrypt ticked. Never put a key in a command line or in a file in git.
5. **Database changes:** a resize, users, trusted sources, the maintenance window or a restore.
