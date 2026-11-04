# syntax=docker/dockerfile:1
#
# The backend in a container (PLAN-V6 G1): the same packages as uv.lock, run by a normal user, with
# the memory model inside, so nothing downloads when it starts.
#
#   cd engine/backend
#   docker build -t contour-backend .
#   docker run --rm -p 127.0.0.1:8000:8000 --env-file ../.env -e SERVER_MODE=true ... contour-backend
#
# In practice it is started by engine/deploy/docker-compose.prod.yml (see engine/deploy/README.md).
#
# Python: the newest 3.12 (the 3.12.3 that ships with Ubuntu 24.04 can't import core/runs/types.py).
# TBC: pin the exact patch the laptop uses once it is known, by building with
#   --build-arg PYTHON_IMAGE=python:3.12.N-slim
#
# BAKE_MODEL=1 (the default) downloads the memory model (FastEmbed, BAAI/bge-small-en-v1.5, about
# 130 MB) into the image. BAKE_MODEL=0 skips that, for a build on a network that can't reach
# Hugging Face: the backend then downloads the model the first time it needs it, so use it only to
# test the rest of the image.

ARG PYTHON_IMAGE=python:3.12-slim

# --- Build: the packages, installed exactly as uv.lock says ---------------------------------------
FROM ${PYTHON_IMAGE} AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# The same uv as on the laptop.
RUN pip install uv==0.11.32

WORKDIR /app/backend

# The packages first, so a change to the code doesn't install them again.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Then the code (what .dockerignore leaves in), and the project itself.
COPY . .
RUN uv sync --frozen --no-dev

# The memory model, in a folder of its own, so the run-time image can copy only that.
ARG BAKE_MODEL=1
ENV EMBEDDING_CACHE_DIR=/opt/fastembed
RUN mkdir -p /opt/fastembed \
    && if [ "$BAKE_MODEL" = "1" ]; then \
         .venv/bin/python -c "from core.memory.embedder import get_embedder; get_embedder().passages(['warm up'])"; \
       fi

# --- Run: only what is needed, as a normal user ---------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime

RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin contour

# The venv's scripts name /app/backend/.venv, so the code lives at the same path here.
COPY --from=build --chown=contour:contour /app/backend /app/backend
COPY --from=build --chown=contour:contour /opt/fastembed /opt/fastembed

ENV PATH="/app/backend/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    EMBEDDING_CACHE_DIR=/opt/fastembed

WORKDIR /app/backend
USER contour
EXPOSE 8000

# `engine serve` with SERVER_MODE=true listens on 0.0.0.0. The health route needs no sign-in, and the
# host check lets 127.0.0.1 through for exactly this call.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"]

# The migrations are a step of their own (`engine migrate`), run before this one starts.
CMD ["engine", "serve"]
