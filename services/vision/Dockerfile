# syntax=docker/dockerfile:1
#
# openverify/vision (Phase 11, Workflow 11C, images-11c; C257.1): the vision service. Build with the
# repository root as the named context `repo` (it carries models/manifest.json and
# scripts/fetch_models.py; nothing else is taken from it), linux/amd64, tag 11c-local locally:
#
#   docker build --build-context repo=. -t openverify/vision:11c-local services/vision
#
# Model weights are never in the image (Q6, decision 5): fetch them with scripts/fetch_models.py and
# mount them read-only at /models. At start the service compares every fetched model with the
# SHA-256 models/manifest.json pins and refuses to start on a difference. The chart's models-fetch
# Job runs this image: python3 /app/scripts/fetch_models.py --manifest /app/models/manifest.json.
# The service token is OPENVERIFY_VISION_SERVICE_TOKEN or, mounted as a file,
# OPENVERIFY_VISION_SERVICE_TOKEN_FILE. It runs as 10001:10001 with a read-only root and a writable
# /tmp (the multipart spool); the chart's probes decide its health (no HEALTHCHECK).

ARG PYTHON_IMAGE=python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3.12 \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
# Third-party dependencies first, so editing the source does not invalidate this layer.
COPY pyproject.toml uv.lock .python-version README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable
# CLAUDE.md rule 4, Phase 10 P2 (THIRD_PARTY_LICENSES.md section 6): Eigen's source location beside
# the onnxruntime wheel's own ThirdPartyNotices.txt.
COPY licenses/onnxruntime/EIGEN-SOURCE.txt /app/licenses/onnxruntime/EIGEN-SOURCE.txt
RUN cp /app/.venv/lib/python3.12/site-packages/onnxruntime/ThirdPartyNotices.txt \
      /app/licenses/onnxruntime/ThirdPartyNotices.txt

FROM ${PYTHON_IMAGE} AS runtime
ARG VERSION=0.1.0-local
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/openverify/openverify
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openverify/vision" \
      dev.openverify.licence-status="pending-owner"
RUN groupadd --system --gid 10001 openverify \
 && useradd --system --uid 10001 --gid openverify --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin openverify
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/licenses /app/licenses
# The attribution of the vendored and derived Apache-2.0 code (RapidOCR, PaddleOCR, Minivision's
# Silent-Face-Anti-Spoofing, MediaPipe's canonical face) and the text models.
COPY NOTICE /app/NOTICE
# The pins the start-up check reads, and the fetcher the chart's models-fetch Job runs.
COPY --from=repo models/manifest.json /app/models/manifest.json
COPY --from=repo scripts/fetch_models.py /app/scripts/fetch_models.py
# C41.4: ONNX Runtime sends Microsoft telemetry from Linux builds unless this is set.
ENV ORT_DISABLE_TELEMETRY=1
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENVERIFY_VISION_MODELS_DIR=/models \
    OPENVERIFY_VISION_MODELS_MANIFEST=/app/models/manifest.json
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "openverify_vision.app:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
