# syntax=docker/dockerfile:1
#
# openverify/flow (Phase 11, Workflow 11C, images-11c; C157 as built, C257.1, C289): the end-user flow,
# served by Phase 9's flow server. Build from the repository root (linux/amd64; tag 11c-local locally,
# never latest), with face guidance (the release's image) and without it (Phase 10 P2's decline
# outcome, which the owner may still choose):
#
#   docker build -f infra/docker/flow.Dockerfile -t openverify/flow:11c-local .
#   docker build -f infra/docker/flow.Dockerfile --build-arg OPENVERIFY_FLOW_FACE_GUIDANCE=off \
#     -t openverify/flow:11c-local-noguidance .
#
# Fetch YuNet first (python3 scripts/fetch_models.py --only face_detection_yunet); the build checks it
# against models/manifest.json. The bundle is built without VITE_OPENVERIFY_API_URL: the flow server
# reads the API's origin at start (C257.1), so one image serves any install. The image holds Node,
# the server's source with the import-free modules it loads, the contracts package's compiled
# origin-pattern module and the built bundle; no package manager, no TypeScript compiler, no Vite.
# OPENVERIFY_FLOW_SERVER_TOKEN may come from OPENVERIFY_FLOW_SERVER_TOKEN_FILE. It runs as
# 10001:10001 with a read-only root and a writable /tmp; the chart's probes decide its health.

ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    CI=true
RUN corepack enable
WORKDIR /app
RUN chown node:node /app
USER node

# Dependencies first, from the lockfile alone, so editing sources keeps this layer cached.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=openverify-pnpm-store,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm fetch --store-dir /home/node/.pnpm-store

COPY --chown=node:node . .
RUN --mount=type=cache,id=openverify-pnpm-store,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --offline --store-dir /home/node/.pnpm-store \
      --package-import-method copy --filter '@openverify/flow...' --filter .
# C289: on (the default) or off; off builds no onnxruntime-web, WASM, YuNet or their notices.
ARG OPENVERIFY_FLOW_FACE_GUIDANCE=on
# C46.1, C48: the flow serves the YuNet model it guides the capture with, checked against its pin.
RUN if [ "$OPENVERIFY_FLOW_FACE_GUIDANCE" != off ]; then \
      echo "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0  models/face_detection_yunet_2026may.onnx" \
        | sha256sum -c -; \
    fi
# The workspace packages through turbo, then the bundle itself with Vite directly: turbo's strict
# environment mode would hide OPENVERIFY_FLOW_FACE_GUIDANCE from the build and cache across it.
RUN pnpm exec turbo run build --filter='@openverify/flow^...'
RUN OPENVERIFY_FLOW_FACE_GUIDANCE="$OPENVERIFY_FLOW_FACE_GUIDANCE" \
    pnpm --filter @openverify/flow run build
# The server (run from source by Node's type stripping) and what it imports: the flow's import-free
# security modules and @openverify/contracts' compiled origin-pattern module, linked as pnpm links it.
RUN mkdir -p /home/node/flow/apps/flow/src/security /home/node/flow/apps/flow/node_modules/@openverify \
      /home/node/flow/packages/contracts/dist \
    && cp apps/flow/server.ts apps/flow/package.json /home/node/flow/apps/flow/ \
    && cp apps/flow/src/security/csp-policy.ts apps/flow/src/security/response-headers.ts \
      apps/flow/src/security/runtime-config.ts apps/flow/src/security/secret-files.ts \
      /home/node/flow/apps/flow/src/security/ \
    && cp -a apps/flow/dist /home/node/flow/apps/flow/dist \
    && cp packages/contracts/package.json /home/node/flow/packages/contracts/ \
    && cp packages/contracts/dist/origin-pattern.js /home/node/flow/packages/contracts/dist/ \
    && ln -s ../../../../packages/contracts /home/node/flow/apps/flow/node_modules/@openverify/contracts

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0-local
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/openverify/openverify
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openverify/flow" \
      dev.openverify.licence-status="decided"
ENV NODE_ENV=production
# No package manager at run time: npm, npx, corepack and yarn go.
RUN rm -r -f /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=build --chown=root:root /home/node/flow/ /app/
WORKDIR /app/apps/flow
USER 10001:10001
EXPOSE 4173
CMD ["node", "server.ts", "--hostname", "0.0.0.0", "--port", "4173", "--dist", "dist"]
