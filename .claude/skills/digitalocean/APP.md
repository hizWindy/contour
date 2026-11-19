# App Platform

What App Platform can and can't do, and how Contour uses it. Checked 20 Nov 2026 against the docs pages listed under each part, and against the live app. **TBC** means not confirmed yet.

## What it can do

- **Build** from GitHub with a Dockerfile or a buildpack. Ours: the backend and `migrate` use `engine/backend/Dockerfile`, and `web` uses a Node buildpack.
- **Serve** HTTPS with its own certificates, custom domains, a global CDN (Cloudflare) and DDoS protection.
- **Scale** up to a bigger size, or out to more copies. The engine allows **one** backend for each database, so never scale it out.
- **Roll back** to one of the ten most recent successful deployments.
- **Run jobs:** `PRE_DEPLOY` (our `migrate`), `POST_DEPLOY`, `FAILED_DEPLOY`, and `SCHEDULED` (cron, with a time zone).
- **Run day to day:** maintenance mode, a console, logs, alerts and per-minute metrics.

Source: [features](https://docs.digitalocean.com/products/app-platform/details/features/), [app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

## What it can't do

- **No volumes.** A container's disk is 4 GiB and is wiped on every deploy. If it fills, the container is replaced.
- **No security headers from the platform.** It doesn't set HSTS. A `.ondigitalocean.app` address acts as if HSTS were set, because browsers force HTTPS on `.app`. The spec's `secure_header` doesn't help here: it **blocks incoming requests** that lack a header, and adds nothing to answers. So the run book's open point on CSP and `X-Frame-Options` stays open.
- **The CDN cache can't be turned off for us.** `disable_edge_cache` is what allows server-sent events (the live run feed). But it can't be used with a static site (ours has one), and it needs a custom domain. So the run book's open point on the live run feed stays open.
- **No IPv6 out of the app.** It shows up as `ETIMEDOUT`. SSH, SFTP and SMTP ports can't be opened either.
- **Builds and images:** a build stops after 1 hour. Images must be Linux AMD64. Under 1 GiB is recommended, and over 2 GiB will probably fail. Build memory: the limits page says 15 GiB and the features page says 20 GiB. The docs disagree.
- **Other limits:** a job deploy times out after 30 minutes by default. Logs show UTC only. Traffic goes through Cloudflare, so the app's address can look US-based. There can be at most 500 domains and 250 containers per app.

Source: [limits](https://docs.digitalocean.com/products/app-platform/details/limits/), [app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

## Deploys

- **Ours are by hand.** A push to `master` doesn't deploy. Each deploy builds, runs `migrate`, then starts the new backend while the old one still runs. The run book's "Updates and the one-backend lock" has the rest.
- **To start one** (ask first): in the dashboard, Activity, Actions, Deploy. Or `doctl apps create-deployment <app id> --wait`. Add `--force-rebuild` to skip the build cache.
- **Spec changes and code:** doctl's help says `doctl apps update --spec` changes settings without pulling new code, unless you add `--update-sources`. The limits page says a settings change that redeploys also pulls the latest code. Which one wins is **TBC**. Treat any spec change as a deploy of `master`'s latest commit.
- **DigitalOcean can redeploy by itself** for infrastructure maintenance. Deployment alerts fire for those too.
- **Restart without a build** (ask first): `doctl apps restart <app id> --components backend`. It stops a run in progress, like a deploy.

Source: [manage deployments](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/), [alerts](https://docs.digitalocean.com/products/app-platform/how-to/create-alerts/), `doctl apps update --help`.

## Rollback

- **What:** go back to any of the ten newest successful deployments. It must be in the same region and use the same database.
- **It restores** the code, the settings and the spec. **It doesn't restore** database data. For data, restore a backup (DATABASE.md).
- **How** (ask first): in the dashboard, Activity, then Rollback beside the deployment. It shows what will change first. The API has `POST /v2/apps/{id}/rollback`. doctl 2.6.0 has **no** rollback command.
- **After a rollback,** new deploys wait until it is kept or undone. The API reference says undoing it "unpins the app to resume new deployments". How the dashboard shows this is **TBC**.
- **Our risk:** if a later deploy added a migration, the older code may not work with the changed database (run book, "A rollback").

Source: [manage deployments](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/), [revert rollback](https://docs.digitalocean.com/reference/pydo/reference/apps/revert_rollback/).

## Logs and the console

- **Log types:** `build`, `deploy`, `run`, and `run_restarted` (what a container printed before it crashed, doctl only). Build and deploy logs are kept 90 days. How long run logs are kept isn't stated. Forward them to keep them longer.
- **Read them:** `doctl apps logs <app id> backend --type run --tail 200`. Add `-f` to follow, or `--deployment <id>` for an older deploy.
- **The console** opens a shell in a running container. It works for services and workers only, so it works for `backend` but not for `web` or `migrate`. Run `doctl apps console <app id> backend`, or use the dashboard's Console tab.
- **Console warnings:** changes there don't last. Encrypted settings are readable inside it. The docs state no session limit (**TBC**).

Source: [logs](https://docs.digitalocean.com/products/app-platform/how-to/view-logs/), [console](https://docs.digitalocean.com/products/app-platform/how-to/console/).

## Settings (environment variables)

- **Levels:** app-level settings reach every part. A component-level setting with the same name wins.
- **Scopes:** `RUN_TIME`, `BUILD_TIME` or `RUN_AND_BUILD_TIME`. Type `SECRET` is the Encrypt tick. It hides the value from logs, but anyone with console access can still read it.
- **Values filled in by App Platform:**
  - `${APP_URL}` is the primary domain as an https address. It becomes the custom domain once one is primary.
  - `${APP_DOMAIN}` and `${APP_ID}`.
  - `${db.HOSTNAME}`, `${db.PORT}`, `${db.USERNAME}`, `${db.PASSWORD}`, `${db.DATABASE}`, `${db.DATABASE_URL}` and `${db.CA_CERT}`. Here `db` is the database's `name` in the spec.
- **The live list:** `doctl apps spec get <app id> --context contour | grep -- '- key:'` lists the names only. On 20 Nov there were 24. Some are only in the dashboard on purpose: the keys and the feature switches. Never print the values.

Source: [environment variables](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/).

## Alerts

- **App alerts:** `DEPLOYMENT_FAILED`, `DEPLOYMENT_LIVE`, `DEPLOYMENT_STARTED`, `DEPLOYMENT_CANCELED`, `DOMAIN_FAILED`, `DOMAIN_LIVE`, `AUTOSCALE_FAILED` and `AUTOSCALE_SUCCEEDED`.
- **Component alerts:** `CPU_UTILIZATION`, `MEM_UTILIZATION` and `RESTART_COUNT`. Services also have `REQUEST_RATE_PER_SECOND` and `REQUEST_DURATION_P95_MS`. The time windows are 5, 10 or 30 minutes, or 1 hour.
- **Live on 20 Nov:** only `DEPLOYMENT_FAILED` and `DOMAIN_FAILED`, each to one email address and no Slack. Whose address is **TBC**. The backend's alerts in `.do/app.yaml` are not live (SKILL.md, finding 1).
- **Where alerts go:** set it in the dashboard (email or Slack), or with `doctl apps update-alert-destinations <app id> <alert id>`.

Source: [app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/), [alerts](https://docs.digitalocean.com/products/app-platform/how-to/create-alerts/).

## Maintenance mode and archive

- **Maintenance mode** takes the app offline and shows a maintenance page. It is still billed.
- **To turn it on** (ask first): Settings, Maintenance mode, Turn on. Or set `maintenance: {enabled: true}` in the spec. A custom message can't be set. A custom page can be set, through the spec's `offline_page_url` only.
- **Archive** stops the charges and takes the app down. It is set with `maintenance.archive: true`. The docs advise against it for an app in use.

Source: [maintenance mode](https://docs.digitalocean.com/products/app-platform/how-to/maintenance-mode/), [archive](https://docs.digitalocean.com/products/app-platform/how-to/archive-restore/).

## Prices

From the pricing page on 20 Nov 2026, in US$ a month for one container:

| Size | CPU | Memory | Price | Contour |
|---|---|---|---|---|
| `apps-s-1vcpu-1gb` | 1 shared | 1 GiB | $12 | `migrate`, billed only while it runs |
| `apps-s-1vcpu-2gb` | 1 shared | 2 GiB | $25 | `backend` |
| `apps-s-2vcpu-4gb` | 2 shared | 4 GiB | $50 | the next size up |
| `apps-d-1vcpu-2gb` | 1 dedicated | 2 GiB | $39 | the smallest dedicated with 2 GiB |

- **Billing:** per second, with a 1-minute minimum.
- **Bandwidth:** the backend's size includes 200 GiB out a month. More costs $0.02 per GiB, and data coming in is free.
- **Static sites:** up to three apps with only static sites are free. Whether `web` inside our app is free or $3 is **TBC**. The run book says "free or about US$3".
- **The database** is priced on a separate page (DATABASE.md).
- **Spending so far this month:** `doctl balance get --context contour`.

Source: [pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/).
