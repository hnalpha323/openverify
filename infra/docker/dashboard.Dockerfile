# syntax=docker/dockerfile:1
#
# openverify/dashboard (Phase 11, Workflow 11C, images-11c; C257.1, plan amendment 12): the operator
# console. Build from the repository root (linux/amd64; tag 11c-local locally, never latest):
#
#   docker build -f infra/docker/dashboard.Dockerfile -t openverify/dashboard:11c-local .
#
# Next.js writes its standalone output (output: 'standalone'): the build and the production files it
# traced, nothing else. The image runs the console's custom server (apps/dashboard/server.ts, C21)
# over that output with Node's type stripping, never Next's generated server.js, which would drop the
# peer-address header the BFF reads; the custom server hands Next.js the configuration the build
# resolved (.next/required-server-files.json). The build runs with OPENVERIFY_HSTS_MAX_AGE unset, so
# the console sends no Strict-Transport-Security of its own: the chart's ingress sends it (C255.1,
# orchestrator decision 22). OPENVERIFY_DASHBOARD_BFF_TOKEN may come from
# OPENVERIFY_DASHBOARD_BFF_TOKEN_FILE. It runs as 10001:10001 with a read-only root and a writable
# /tmp (Next's cache is a link into /tmp); the chart's probes decide its health (no HEALTHCHECK).

ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
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
      --package-import-method copy --filter '@openverify/dashboard...' --filter .
# No OPENVERIFY_HSTS_MAX_AGE here: the console reads it only when it is built (C255.1).
RUN pnpm exec turbo run build --filter=@openverify/dashboard
# The standalone output, the static files beside it, and the custom server with the two import-free
# modules it loads; Next's generated server.js and any next.config stay out.
RUN mkdir -p /home/node/console \
    && cp -a apps/dashboard/.next/standalone/. /home/node/console/ \
    && cp -a apps/dashboard/.next/static /home/node/console/apps/dashboard/.next/static \
    && if [ -d apps/dashboard/public ]; then cp -a apps/dashboard/public /home/node/console/apps/dashboard/public; fi \
    && mkdir -p /home/node/console/apps/dashboard/src/lib/api \
    && cp apps/dashboard/server.ts apps/dashboard/package.json /home/node/console/apps/dashboard/ \
    && cp apps/dashboard/src/lib/api/peer-address.ts /home/node/console/apps/dashboard/src/lib/api/ \
    && cp apps/dashboard/src/lib/secret-files.ts /home/node/console/apps/dashboard/src/lib/ \
    && rm -f /home/node/console/apps/dashboard/server.js /home/node/console/apps/dashboard/next.config.* \
    && rm -r -f /home/node/console/apps/dashboard/.next/cache \
    && ln -s /tmp/next-cache /home/node/console/apps/dashboard/.next/cache

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0-local
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/openverify/openverify
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openverify/dashboard" \
      dev.openverify.licence-status="decided"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# No package manager at run time: npm, npx, corepack and yarn go.
RUN rm -r -f /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=build --chown=root:root /home/node/console/ /app/
WORKDIR /app/apps/dashboard
USER 10001:10001
EXPOSE 3001
CMD ["node", "server.ts", "--hostname", "0.0.0.0", "--port", "3001"]
