# syntax=docker/dockerfile:1
#
# The backend in a container (PLAN-V6 G1): the same packages as uv.lock, run by a normal user, with
# the memory model inside, so nothing downloads when it starts.
#
#   cd engine/backend
#   docker build -t contour-backend .
#
# In practice it is built and started by engine/deploy/docker-compose.prod.yml (see
# engine/deploy/README.md).
#
# Python: the newest 3.12 patch on the day of the last check (5 Nov 2026: 3.12.16 on Debian 13).
# The laptop runs 3.12.10 and every test passes there, so the code works on both. (The image brings
# its own Python because the 3.12.3 that ships with Ubuntu 24.04 can't import core/runs/types.py.)
# To move to a newer patch, change PYTHON_IMAGE below, rebuild, and run the checks in the run book.
#
# The memory model (FastEmbed, about 65 MB) is downloaded into the image while it is built
# (BAKE_MODEL=1, the default), before the code is copied in, so a change to the code doesn't
# download it again. After that the running container never goes to the internet for it:
# HF_HUB_OFFLINE=1 makes Hugging Face's library use the saved files only.
# BAKE_MODEL=0 skips the download, for a build on a network that can't reach Hugging Face. The
# backend then downloads the model the first time it needs it, so use that only to test the rest.
#
# ONNX Runtime (FastEmbed's engine) sends usage events to Microsoft unless it is told not to (see
# its Privacy.md). ORT_DISABLE_TELEMETRY=1 turns that off for the whole process.

ARG PYTHON_IMAGE=python:3.12.16-slim-trixie

# --- Build: the packages, installed exactly as uv.lock says ---------------------------------------
FROM ${PYTHON_IMAGE} AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    ORT_DISABLE_TELEMETRY=1 \
    HF_HUB_DISABLE_TELEMETRY=1

# A fixed uv. (The laptop has a newer one: both read the same uv.lock, checked on 5 Nov.)
RUN pip install uv==0.11.32

WORKDIR /app/backend

# The packages first, so a change to the code doesn't install them again.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# The memory model, in a folder of its own, so the run-time image can copy only that. It comes before
# the code, so a change to the code doesn't download it again. EMBEDDING_MODEL must be the model in
# core/config.py: a test (tests/core/test_deploy_files.py) fails when the two differ.
ARG BAKE_MODEL=1
ARG EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
RUN mkdir -p /opt/fastembed \
    && if [ "$BAKE_MODEL" = "1" ]; then \
         .venv/bin/python -c 'import sys; from fastembed import TextEmbedding; m = TextEmbedding(model_name=sys.argv[1], cache_dir="/opt/fastembed"); print("model ok,", len(next(iter(m.passage_embed(["warm up"])))), "numbers")' "$EMBEDDING_MODEL"; \
       fi

# Then the code (what .dockerignore leaves in), and the project itself.
COPY . .
RUN uv sync --frozen --no-dev

# --- Run: only what is needed, as a normal user ---------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime

# An ARG belongs to the stage that names it, so this one is named again here.
ARG BAKE_MODEL=1

RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin contour

# The venv's scripts name /app/backend/.venv, so the code lives at the same path here.
COPY --from=build --chown=contour:contour /app/backend /app/backend
COPY --from=build --chown=contour:contour /opt/fastembed /opt/fastembed

ENV PATH="/app/backend/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    EMBEDDING_CACHE_DIR=/opt/fastembed \
    ORT_DISABLE_TELEMETRY=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_OFFLINE=${BAKE_MODEL}

WORKDIR /app/backend
USER contour
EXPOSE 8000

# `engine serve` with SERVER_MODE=true listens on 0.0.0.0. The health route needs no sign-in, and the
# host check lets 127.0.0.1 through for exactly this call.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"]

# The migrations are a step of their own (`engine migrate`), run before this one starts.
CMD ["engine", "serve"]
