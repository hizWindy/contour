# syntax=docker/dockerfile:1
#
# The website in a container (PLAN-V6 G2): built once, then served as plain files by Caddy. Caddy
# also sends /api to the backend, gets the HTTPS certificate by itself and adds the security
# headers (engine/deploy/Caddyfile).
#
# The Caddyfile is in engine/deploy, so build from engine/, not from this folder:
#
#   cd engine
#   docker build -f frontend/Dockerfile -t contour-web .
#
# In practice it is built and started by engine/deploy/docker-compose.prod.yml
# (see engine/deploy/README.md). frontend/Dockerfile.dockerignore says what is left out.

ARG NODE_IMAGE=node:22-slim
ARG CADDY_IMAGE=caddy:2-alpine

# --- Build: the website, once -----------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app/frontend

# The packages first, exactly as package-lock.json says, so a change to the code doesn't fetch them.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Then the code. `npm run build` checks the types and then builds into dist/.
COPY frontend/ ./
RUN npm run build

# --- Run: Caddy with the built files ----------------------------------------------------------------
FROM ${CADDY_IMAGE} AS runtime

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv

# Caddy checks its own file before it starts, so a mistake in it stops the build here and not later.
RUN SITE_ADDRESS=example.test caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 80 443 443/udp
