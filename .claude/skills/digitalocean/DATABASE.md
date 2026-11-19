# The database (contour-db)

The managed Postgres the app runs on. Checked 20 Nov 2026 against the docs and the live cluster. **TBC** means not confirmed yet.

## What it is (live)

- **The cluster:** `contour-db`, ID `8a2ce046-057d-497c-8c39-8400e06fae3a`, PostgreSQL 18, Standard edition (run book), 1 node, `db-s-1vcpu-1gb`, 10 GiB disk (10,240 MiB), `syd1`, online.
- **Inside it:** one database (`defaultdb`) and one user (`doadmin`, the admin). There are no connection pools.
- **Connections:** the 1 GiB plan allows 22. Each backend opens at most 9, so a deploy, with two backends plus `migrate`, uses about 19 (`.do/app.yaml`).
- **pgvector:** supported on PostgreSQL 18 Standard. The engine's first `engine migrate` created it as `doadmin`, and it has worked since 6 Nov.
- **No superuser:** nobody gets it, not even `doadmin`.
- **New plan limits:** from 30 Nov 2026, new Standard clusters above 4 GiB, or with standby or read-only nodes, are restricted. Whether this affects resizing ours is **TBC**.

Source: [PostgreSQL limits](https://docs.digitalocean.com/products/databases/postgresql/details/limits/), [supported extensions](https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/).

## Backups and restore

- **Backups:** once a day, kept 7 days, with no downtime. DigitalOcean picks the time. Live on 20 Nov there were 8, from 12 to 19 Nov, each about 35 MB, taken near 09:59 UTC (8:59 pm in Sydney).
- **Point in time:** a restore can go back to any moment in the last 7 days.
- **A restore makes a new cluster.** The old one is left as it was. The restore page says "Restore to New Cluster", while the limits page says "a new node". Follow the restore page, which is the how-to.
- **After a restore:** point the app at the new cluster (the spec's `cluster_name`), then deploy. Whether its host and password change is **TBC**, so check them.
- **How** (ask first): in the dashboard, Databases, `contour-db`, Actions, Restore from backup. With doctl: `doctl databases create <new name> --region syd1 --size db-s-1vcpu-1gb --version 18 --restore-from-cluster-name contour-db --restore-from-timestamp "2026-11-19 09:59:00 +0000 UTC"`. **Always give `--region syd1`.** Without it, the copy goes to New York (`nyc1` is doctl's default), and Contour's data leaves Australia.
- **Two warnings:** deleting a cluster deletes its backups too. Rolling back the app doesn't roll back the data.
- **Cluster limit:** a restore needs room under the account's limit (3 clusters on Tier 1). If "Restore from backup" is greyed out, that limit is the cause.

Source: [restore from backups](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/), [limits](https://docs.digitalocean.com/products/databases/postgresql/details/limits/), `doctl databases create --help`.

## Trusted sources

Trusted sources are the list of servers and addresses allowed to connect.

- **Live on 20 Nov: none.** Any address on the internet can try to connect. It still needs the password and TLS.
- **The recommendation:** make the app the only trusted source. It cuts out password guessing from the internet.
- **How** (ask first): in the dashboard, Network Access, Add Trusted Sources, then pick the app. Or run `doctl databases firewalls append <cluster id> --rule app:<app id>`.
- **What changes:** only the app can connect. Al-khair's laptop can't reach the database directly unless his address is added too. During a build nothing can connect, which is fine because our build doesn't need the database. Whether the `migrate` job counts as the app is **TBC**, so check that the next deploy's `migrate` passes. IPv6 addresses can't be added.

Source: [secure a cluster](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/), [App Platform limits](https://docs.digitalocean.com/products/app-platform/details/limits/).

## Maintenance window

- **Live:** Mondays at 22:03 UTC, which is Tuesdays at 9:03 am in Sydney while summer time runs. An update is **pending** (20 Nov), so it should run on Tuesday 24 Nov 2026, Sydney time (**TBC**).
- **What to expect:** a short drop of the database connection. Whether the backend reconnects by itself, and keeps its one-backend lock, is **TBC**. Check Admin, Health afterwards.
- **To move it** (ask first): `doctl databases maintenance-window update <cluster id> --day saturday --hour 16:00`. That is Sundays at 3 am in Sydney. Check the time format with `--help` first.
- **To see it:** `doctl databases maintenance-window get <cluster id> --context contour`.

## Resize

- **How** (ask first): `doctl databases resize <cluster id> --size <slug> --num-nodes 1 --wait`. Whether the database goes down while it resizes is **TBC**: read the docs on the day.
- **Why:** the next size up (2 GiB) allows 47 connections instead of 22.
