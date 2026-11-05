# Contour HQ on a server: the run book

Contour HQ runs in Docker: one command starts it, and one command updates it. This folder has the files and the steps.

- **Last updated:** 2026-11-05. **TBC** means not confirmed yet.
- **Plan:** [PLAN-V6](../../plan/PLAN-V6.md), Parts G and H.
- **Tried so far (4 and 5 Nov):** everything in this folder, from a clean start, on a Windows laptop with Docker Desktop: a new database migrated from nothing, the real login page in a browser, a lead card, an update, a rollback, a stop and start, a backup and a restore. **Not tried:** a real server, DigitalOcean's managed database, a real HTTPS certificate (the laptop trial uses Caddy's own), and `engine create-admin` typed at its password prompt inside a container.

## The parts

- **web:** Caddy. The only part open to the internet (ports 80 and 443). It gets the HTTPS certificate by itself, serves the website, sends `/api` to the backend, and adds the security headers.
- **backend:** the engine. **One copy only.** The engine allows one backend for each database, so never scale it up.
- **migrate:** runs `engine migrate` once, before the backend starts.
- **db:** a Postgres of its own, for a trial on a laptop only. On the server the database is a managed one (DigitalOcean), and this part is not started.

The files:

- [docker-compose.prod.yml](docker-compose.prod.yml) joins the parts.
- [Caddyfile](Caddyfile) is Caddy's settings.
- [.env.example](.env.example) lists the settings and keys. The real file is `.env`, next to it, and is never in git.
- The Dockerfiles are in [../backend](../backend/Dockerfile) and [../frontend](../frontend/Dockerfile).

## Before you start

- **A server** with Docker and its compose plugin, and ports 80 and 443 open to the internet.
- **A domain** whose DNS points at the server's IP address. Without it, Caddy can't get a certificate.
- **A database:** Postgres with pgvector. The managed one on the server, or the trial one on a laptop. The engine runs on Postgres 18 today. **TBC:** whether 17 passes the tests.
- **The keys:** Anthropic (needed), HubSpot (to copy HubSpot), Signal Hire (optional).
- **The login page.** Built and merged (PLAN-V6 C2 and C3, 5 Nov): a visitor who isn't signed in is sent to `/login`. The Account tab (C4) and the name (C5) come later, and nothing here waits for them.
- **Memory:** 4 GB is plenty to run it. Measured on a laptop, the backend uses about 150 MiB when idle, the database 55 MiB and Caddy 15 MiB, and the backend's memory model adds about 300 MiB when it first loads. The website build (`npm ci`, then Vite) needs more than all of that together, and was not measured (**TBC**), so add a 2 GB swap file to the server (see "A new server").

## First install

1. Get the code.

```bash
git clone <the repository address> contour
```

```bash
cd contour/engine/deploy
```

2. Make the settings file, and keep it private.

```bash
cp .env.example .env
```

```bash
chmod 600 .env
```

Open `.env` and fill it in: the domain, the database, and the keys. Every line says what it is for. Keep the `COMPOSE_FILE` line. It makes `docker compose` use the file in this folder. Without it, compose climbs to the folder above and starts the development database there instead.

3. Build and start. The first build takes several minutes: it also downloads the memory model (about 65 MB) into the image, so the backend never downloads it later. A build after a change takes about a minute, because the packages and the model are kept.

```bash
export TAG=$(git rev-parse --short HEAD)
```

```bash
docker compose up -d --build
```

The order is fixed: `migrate`, then `backend`, then `web`. Check that `backend` says `healthy`.

```bash
docker compose ps
```

4. Make the Admin account. It asks for the password twice and never shows it. Use at least 14 characters. A short phrase is fine.

```bash
docker compose run --rm -it backend engine create-admin --email you@example.com --name "Your Name"
```

5. Open `https://your-domain` and sign in. There is no sign-up page and no reset email: the commands below make accounts and reset passwords.

6. Look at the Schedules tab (Admin). The HubSpot copy is **on**, every day at 6:00 am. Find new leads is **off**. Do one run by hand first (Start a run), so the Schedules tab shows real prices. Then switch it on.

## An update

```bash
cd contour/engine/deploy
```

```bash
git pull
```

```bash
export TAG=$(git rev-parse --short HEAD)
```

```bash
docker compose build
```

```bash
docker compose run --rm migrate
```

```bash
docker compose up -d
```

The backend restarts, so a run in progress stops. It is marked **interrupted**. Open it and press Resume. Then check that `backend` is `healthy` and sign in.

## A rollback

Each build is named by its commit, so the older images are still on the server. Find the commit you want.

```bash
git log --oneline
```

```bash
export TAG=<the older commit>
```

```bash
docker compose up -d
```

If the update added a migration, the older code may not work with the changed database. Restore the database from before the update first (below). **TBC:** whether the engine will get a command to undo one migration.

## A restore

- **On the server:** DigitalOcean keeps daily backups and can restore to a point in time. It restores into a **new** database. Copy the new host, port and password into `.env`, then run `docker compose up -d`. The old database is not touched.
- **A trial database on a laptop:** save it, and load it back into an empty database.

`-T` stops Docker from adding a terminal to the pipe. Tried on 5 Nov: the file loads into an empty database without an error.

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > backup.sql.gz
```

```bash
gunzip -c backup.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

## The Admin account

Reset a password. This also lifts a lock and ends that account's sessions.

```bash
docker compose run --rm -it backend engine reset-password --user you@example.com
```

End every session of every account.

```bash
docker compose run --rm backend engine sign-out-everyone
```

## Looking at it

```bash
docker compose ps
```

```bash
docker compose logs -f backend
```

The logs never hold a password, a key or a cookie. Caddy's own log drops cookies on purpose.

Check the security headers. You should see `Strict-Transport-Security`, `Content-Security-Policy` (with `frame-ancestors 'none'`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`.

```bash
curl -sI https://your-domain
```

A file that isn't there must be a plain 404, never the home page. This should print `404`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://your-domain/assets/nope.js
```

## Stopping

```bash
docker compose stop
```

`docker compose down` removes the containers and keeps the data. **`docker compose down -v` also deletes the trial database and the HTTPS certificates. Never use `-v` on the server.**

## A trial on a laptop

1. In `.env`, set `SITE_ADDRESS=localhost`, `HSTS=max-age=0` and `COMPOSE_PROFILES=trial` (this adds a database of its own), and choose any database password. Leave `POSTGRES_HOST` out.
2. Build and start it, then make the Admin account as in "First install".

```bash
docker compose up -d --build
```

3. Open `https://localhost`. The browser warns about the certificate, because Caddy made it itself. Accept it for this trial.

When you are finished, `docker compose down -v` removes the trial database and the certificates with it.

## A new server (PLAN-V6 H1 and H2: **not tried on a real server yet**)

These steps cost money (the droplet and the managed database), so they start only when Al-khair says so.

1. **The droplet.** Sydney (`syd1`), Ubuntu 24.04 LTS, about 4 GB of memory, with your SSH key chosen when you make it. DigitalOcean's "Docker on Ubuntu" image already has Docker and the compose plugin. On a plain Ubuntu image, install Docker from Docker's own package source.
2. **The firewall.** Use a DigitalOcean **cloud firewall** on the droplet, not `ufw`: Docker opens the ports it publishes around `ufw`, so `ufw` would not close them. Allow 80 and 443 (TCP) from everywhere, 443 (UDP, for HTTP/3) if you want it, and 22 from Al-khair's IP address only.
3. **SSH by key only.** A droplet made with an SSH key has password sign-in off. Check it.

```bash
grep -ri '^PasswordAuthentication' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/
```

4. **Security updates.** Ubuntu installs them by itself. Check it.

```bash
systemctl is-enabled unattended-upgrades
```

5. **A swap file.** The website build can run short of memory on 4 GB.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

6. **The database (H2).** DigitalOcean managed Postgres in Sydney, with pgvector (version 18 if offered, otherwise 17: **TBC**, check that 17 passes the tests first). Make the droplet its only trusted source. Copy its host, port, user, name and password into `.env`, and set `POSTGRES_SSLMODE=require`. The first `engine migrate` makes the `vector` extension, so the database user must be allowed to (**TBC**: check with DigitalOcean's `doadmin` user).
7. **The domain.** Make a DNS **A** record (no AAAA, see "Open items") for the domain in `.env`, pointing at the droplet's IP address, and wait until it answers. Caddy needs it to get the certificate.
8. Then follow "First install", leaving `COMPOSE_PROFILES` out of `.env`.

## Open items (**TBC**)

- **No rate limit at the front door.** The standard Caddy has none. The backend limits wrong sign-ins by itself (10 wrong tries lock an account for 15 minutes, and one IP address gets 20 wrong tries in 15 minutes). A flood of requests from many addresses could still use up the backend's database connections. The DigitalOcean cloud firewall, or a Caddy build with a rate-limit module, would cover it.
- **The visitor's real IP address.** Sign in once from your own computer, then read the sign-in log (`GET /api/v1/auth/log`, or the Account tab once it is built). The address must be your own public one. If it shows `172.28.0.1` (Docker's gateway), every visitor looks the same, and the limit on tries from one IP address would lock everyone out together. This happens for visitors that reach Docker through its user-land proxy, which includes IPv6 visitors. Make a DNS **A** record only (no AAAA), or turn the user-land proxy off (`"userland-proxy": false` in `/etc/docker/daemon.json`, then restart Docker). **TBC:** check it on the live server. A laptop with Docker Desktop always shows `172.28.0.1` (tried 5 Nov), so a laptop trial can't answer this.
- **Image versions are fixed,** so a build next month gives the same images: `python:3.12.16-slim-trixie` (in `../backend/Dockerfile`), `node:22.23.4-bookworm-slim` and `caddy:2.11.8-alpine` (in `../frontend/Dockerfile`). They are the versions tried on 5 Nov. The laptop runs Python 3.12.10 and every test passes there. A fixed version gets no security fixes by itself: look for newer ones now and then, change the `ARG` line, rebuild, and run the checks above. The trial database uses `pgvector/pgvector:pg18`, which is not fixed, because it only exists on a laptop.
- **The memory model comes with the image, and nothing is downloaded or sent when it runs.** The build needs the internet once, to fetch it from Hugging Face. After that the container sets `HF_HUB_OFFLINE=1`, and it loads from a read-only disk with no network (tried 5 Nov). ONNX Runtime, the engine inside FastEmbed, sends usage events to Microsoft unless `ORT_DISABLE_TELEMETRY=1` is set, so the image sets it. If a build can't reach Hugging Face, `--build-arg BAKE_MODEL=0` skips the model and turns the offline setting off, and the backend then downloads the model the first time it needs it. Use that only to test. Don't set `EMBEDDING_MODEL` in `.env`: the image holds one model, and another name would fail.
- **Database connections.** The backend opens at most 25: 20 for the app (`DB_POOL_SIZE` 10 and `DB_MAX_OVERFLOW` 10), 4 for the run checkpoints and 1 that holds the one-backend lock. DigitalOcean's smallest managed database allows about 22 for you (**TBC**: check on the day). On that plan, add `DB_POOL_SIZE=6` and `DB_MAX_OVERFLOW=4` to `.env`, which makes at most 15.
- **The database certificate.** A managed database needs `POSTGRES_SSLMODE=require` at least. `verify-full` also needs the provider's CA file: add it as a read-only volume on `backend` and `migrate`, and set `POSTGRES_SSLROOTCERT` to its path.
- **Caddy's address is fixed** (`172.28.0.2` on `172.28.0.0/24`), and the backend trusts only that address to say who a visitor is. If that network clashes with another one on the server, change the subnet, the address and `TRUSTED_PROXIES` together.
- **Keep the `caddy-data` volume.** It holds the certificates. A new volume asks Let's Encrypt again, which has limits.
