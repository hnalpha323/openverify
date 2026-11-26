# syntax=docker/dockerfile:1
#
# openverify/api (Phase 11, Workflow 11C, images-11c; C257.1): the API server, the worker, the
# worker's health probe and every operator command, compiled, with production dependencies only.
# Build from the repository root (linux/amd64; tag 11c-local locally, never latest):
#
#   docker build -f infra/docker/api.Dockerfile -t openverify/api:11c-local .
#
# Fetch the data first: python3 scripts/fetch_data.py && pnpm --filter @openverify/watchlist
# build:variant-groups. The image runs `node dist/server.js` by default; the worker is
# `node dist/worker.js`, its probe `node dist/worker-health.js` (heartbeat under /tmp), and each
# operator command `node dist/commands/<command with ':' as '-'>.js` (db:migrate is db-migrate.js;
# apps/api/tsconfig.commands.json). It runs as 10001:10001 with a read-only root and a writable /tmp.
# No migration and no grant runs at start: the chart's migrate Job (and compose's migrate service)
# runs them. The licence label is decided: Q11 (nodemailer's MIT-0) was granted on 2026-11-21.

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
# Phase 5 (C56, F15): the disposable list the email checks read; Phase 6 (C78.3, F14): the
# filtered variant groups (SHIPPED_VARIANT_GROUPS_SHA256); Workflow 7A (C92.6): the hosting and VPN
# ASN seeds. Each is checked against its pin; a build with another file fails here. Live network
# data and the operator's anonymous-IP file never enter the image (ADR 0006).
RUN printf '%s\n' \
    "e3bd73552549f2fef7997b4892909835907f0045742a06d961bc9af8d7380f79  data/disposable_email_blocklist.conf" \
    "29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb  data/variant-groups.json" \
    "d59258ef0f777f0e8142471e4848e279bb51e813f634d4c397693dbf63c621cb  data/x4bnet-datacenter-ASN.txt" \
    "d97f44f94c96902e9049f8eba1c268a9ad50e14e9f7fba662857bb9dfee7f5a5  data/x4bnet-vpn-ASN.txt" \
    "0af8e58dc07ba070a10c9083a1a9f5c9fc76be35fab32bb6d144e72caa20a252  data/bad-asn-list.csv" \
  | sha256sum -c -
RUN --mount=type=cache,id=openverify-pnpm-store,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --offline --store-dir /home/node/.pnpm-store \
      --package-import-method copy --filter '@openverify/api...' --filter .
# The server, the worker and, through tsconfig.commands.json, the compiled commands.
RUN pnpm exec turbo run build --filter=@openverify/api
RUN --mount=type=cache,id=openverify-pnpm-store,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm --filter @openverify/api deploy --prod \
      --store-dir /home/node/.pnpm-store /home/node/deploy
# Nothing tsx or a test would run: the sources, the scripts (compiled into dist/commands/), the
# build configurations and, by orchestrator decision 24, the API's test support (11B's in-process
# OIDC provider among it), which no production module imports. The workspace packages keep their
# dist/ (and @openverify/emrtd its dist/testing/, which trust:sandbox-utopia, the sandbox chip route
# and the sandbox trust anchor import at run time) and their data files.
RUN cd /home/node/deploy \
    && rm -r -f src scripts coverage .turbo test-results dist/test-support \
      tsconfig.json tsconfig.build.json tsconfig.commands.json \
      vitest.config.ts vitest.integration.config.ts vitest.graph-template.ts \
    && find dist \( -name '*.test-support.*' -o -name '*.d.ts' -o -name '*.d.ts.map' \) -delete \
    && for package in node_modules/.pnpm/@openverify+*/node_modules/@openverify/*; do \
         rm -r -f "$package/src" "$package/coverage" "$package/.turbo" "$package/scripts" \
           "$package"/tsconfig*.json "$package"/vitest*.ts; \
         if [ -d "$package/dist" ]; then find "$package/dist" -name '*.test-support.*' -delete; fi; \
       done
# The repository-root files the API and the worker read at run time, at the image root (/app),
# where `dist/`'s modules find them four levels up: the data files, the network and watchlist
# manifests, the trust-anchor manifest, the flow texts, the default template and the webhook samples.
RUN mkdir -p /home/node/image-root/data /home/node/image-root/network \
      /home/node/image-root/watchlists /home/node/image-root/trust-anchors \
      /home/node/image-root/contracts/fixtures \
    && cp data/manifest.json data/malicious-feeds.json data/disposable_email_blocklist.conf \
      data/variant-groups.json data/x4bnet-datacenter-ASN.txt data/x4bnet-vpn-ASN.txt \
      data/bad-asn-list.csv /home/node/image-root/data/ \
    && cp network/sources.json network/asn-overrides.json /home/node/image-root/network/ \
    && cp watchlists/sources.json /home/node/image-root/watchlists/ \
    && cp trust-anchors/manifest.json /home/node/image-root/trust-anchors/ \
    && cp -r contracts/fixtures/i18n contracts/fixtures/flows contracts/fixtures/api \
      /home/node/image-root/contracts/fixtures/

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0-local
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/openverify/openverify
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openverify/api" \
      dev.openverify.licence-status="decided"
ENV NODE_ENV=production
# No package manager at run time: npm, npx, corepack and yarn go.
RUN rm -r -f /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=build --chown=root:root /home/node/image-root/ /app/
COPY --from=build --chown=root:root /home/node/deploy/ /app/apps/api/
WORKDIR /app/apps/api
USER 10001:10001
EXPOSE 3000 3101
CMD ["node", "dist/server.js"]
