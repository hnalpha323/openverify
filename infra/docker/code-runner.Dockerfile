# syntax=docker/dockerfile:1
#
# The Evaluate Code runner for the compose profile `app` (C123.3, P17): the child pool in a container
# of its own, reached over a Unix socket on a volume shared with the worker. Compose runs it with no
# network, a read-only root, every capability dropped and no secret. Build from the repository root:
#
#   docker build -f infra/docker/code-runner.Dockerfile -t openverify/code-runner:11c-local .
#
# Phase 11 (Workflow 11C, images-11c; C257.1, C258.1): the base by digest, the OCI labels, linux/amd64
# only, and a read-only root with a writable /tmp and its socket volume; the chart's probes decide its
# health (no HEALTHCHECK).
#
# The QuickJS variant's .wasm comes from the lockfile's packages; nothing is fetched at run time. The
# final image holds Node, the built package and its production dependencies, and no package manager,
# no source and no test fixture.

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
      --package-import-method copy --filter '@openverify/workflow-engine...' --filter .
RUN pnpm exec turbo run build --filter=@openverify/workflow-engine
RUN --mount=type=cache,id=openverify-pnpm-store,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm --filter @openverify/workflow-engine deploy --prod \
      --store-dir /home/node/.pnpm-store /home/node/deploy

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0-local
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/openverify/openverify
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openverify/code-runner" \
      dev.openverify.licence-status="decided"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /home/node/deploy/ /app/
# Nothing here is needed at run time, and an escape should find no tool: the package managers go,
# and so do the sources, the tests and the tests' compromised child, here and in the workspace
# packages the deploy copied.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
      /app/src /app/coverage /app/.turbo /app/pnpm-lock.yaml /app/pnpm-workspace.yaml \
      /app/tsconfig.json /app/tsconfig.build.json /app/vitest.config.ts \
      /app/node_modules/.pnpm/@openverify+*/node_modules/@openverify/*/src \
      /app/node_modules/.pnpm/@openverify+*/node_modules/@openverify/*/coverage \
      /app/node_modules/.pnpm/@openverify+*/node_modules/@openverify/*/.turbo \
    && mkdir -p /run/code-runner \
    && chown 10001:10001 /run/code-runner
USER 10001:10001
VOLUME ["/run/code-runner"]
# C263.6 (Workflow 11C): with OPENVERIFY_CODE_RUNNER_LISTEN=0.0.0.0:7700 and the token it listens on
# TCP instead of the socket; no EXPOSE (Phase 8's contract: the image publishes no port itself, and the
# chart's Service names 7700).
CMD ["node", "bin/code-runner-server.mjs"]
