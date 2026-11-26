# ADR 0001: Stack and monorepo

- **Status:**
  - Core stack, decisions 1–3: **Accepted** (owner Q&A on 2026-10-19, recorded in `docs/PLAN.md` §1).
  - Local infrastructure and CI, decisions 4–5: proposed by the Phase 0 infra-ci slice on 2026-10-20 and **accepted by the orchestrating session the same day**, pending the owner's confirmation.
    - Valkey and RustFS are the only options that satisfy the license policy: Redis 8 is RSAL/SSPL/AGPL, and MinIO is AGPL with archived repositories and unpublished images.
    - `docs/PLAN.md` and `CLAUDE.md` were updated to match.
- **Date:** 2026-10-20
- **Related:** `docs/PLAN.md` §3, `THIRD_PARTY_LICENSES.md`, ADR 0002

## Context

OpenVerify is a self-hostable identity-verification platform. It needs:
- a multi-tenant REST API with background workers;
- an end-user web flow;
- an operator dashboard;
- JS, React and Node SDKs;
- an ML/vision service;
- a native Android SDK with NFC passport reading.

The platform is built by parallel agents in phases. The rules are TDD, at least 80% coverage per package, and permissive licenses only (`CLAUDE.md` rule 4).

The constraints that shaped the choice:
- **Shared contracts.** The web flow, the Android SDK and the API must agree on the same contracts: the OpenAPI spec generated from zod schemas, and the `flow-spec` JSON Schema. Drift between them is the biggest integration risk.
- **ML ecosystem.** The open ML stack (OpenCV, onnxruntime, RapidOCR, zxing-cpp) is best served from Python.
- **Android.** NFC eMRTD reading (JMRTD), CameraX quality gating and on-device MediaPipe are first-class only on native Android.
- **Parallel agents** need clear package boundaries to work side by side without conflicts.
- **Licensing.** Infrastructure that developers run locally must also respect the license policy. Its availability must be verifiable today, not assumed.

## Decision

1. **Languages and frameworks.**
   - **TypeScript (strict)** for the API (Fastify 5), the workers (BullMQ), the dashboard (Next.js), the flow (Vite + React) and the SDKs.
   - **Python 3.12 + FastAPI**, managed by uv, for `services/vision`.
   - **Kotlin + Jetpack Compose** (Gradle) for the Android SDK and demo app.
2. **Monorepo: pnpm workspaces + Turborepo.**
   - One repository holds `apps/`, `packages/`, `services/vision`, `android/` and `infra/`.
   - Contracts live in packages and every consumer uses them: zod, then OpenAPI, then `flow-spec`.
   - pnpm comes from corepack via the `packageManager` field.
3. **Data.**
   - **Postgres 17 + pgvector**: one database for relational data and face/background embeddings, so embeddings stay transactional with the rows they belong to.
   - A **Redis-protocol** store for queues, rate limits and caches.
   - The **S3 API** for files. The API encrypts files with envelope encryption before upload.
   - **SMTP** for mail.
4. **Local infrastructure** (`infra/docker-compose.yml`, contract test `infra/tests/compose.test.sh`):

   | Service | Image | Notes |
   |---|---|---|
   | `postgres` | `pgvector/pgvector:pg17` | `vector` extension created on first init |
   | `redis` | `valkey/valkey:9.1` | **Valkey**, BSD-3-Clause. Wire-compatible with Redis; password required |
   | `objectstore` | `rustfs/rustfs:1.0.3` | **RustFS**, Apache-2.0. S3-compatible |
   | `objectstore-init` | `amazon/aws-cli:2.38.2` | One-shot job. Creates `openverify-files` with versioning enabled |
   | `mailpit` | `axllent/mailpit:v1.31` | Dev SMTP sink and web UI |

   - Every service has a healthcheck and a named volume.
   - Ports are env-configurable and bind to `127.0.0.1` by default.
   - Secrets have no defaults: compose refuses to start without them, and `.env.example` holds placeholders only.
5. **CI: GitHub Actions on Ubuntu runners** (`.github/workflows/ci.yml`, contract test `infra/tests/ci-workflow.test.sh`). The jobs are:
   - `node`
   - `integration` (Testcontainers)
   - `vision`
   - `android`
   - `android-instrumented` (emulator with KVM, a no-op until `androidTest` sources exist)
   - `secrets` (gitleaks over the full history)

   Further details:
   - Node 22 matches the local toolchain, `engines` (`>=22.18.0`) and `@types/node` 22. Node 22 and 24 still bundle corepack; Node 25+ does not.
   - Actions are pinned to major tags verified with `gh api`. `astral-sh/setup-uv` has no major tags, so it is pinned to an exact release.

## Alternatives considered

### Repository and build tooling

| Option | Why not |
|---|---|
| Polyrepo (API, web, Android, vision separately) | Contracts would drift between repos, and every cross-cutting slice (most of Phases 1–3) would need coordinated multi-repo changes. |
| Nx | Capable, but heavier configuration and plugin lock-in. Turborepo's task graph and cache cover our needs with a single `turbo.json`. |
| Bazel | Hermetic builds, but a steep learning curve and a poor fit with Gradle/AGP and uv. Too costly for a project built by many short-lived agents. |
| npm/yarn workspaces without a task runner | No task-graph caching. pnpm also gives strict dependency isolation and catalogs. |

### Backend language

| Option | Why not |
|---|---|
| Go | Strong for services, but we would lose zod as the single contract source shared with the web flow and the SDKs, and we would still need TS for the web. |
| Python-only (FastAPI everywhere) | Simplifies ML calls, but weaker type sharing with the TS frontends. Python stays where it is strongest: the vision service. |
| Kotlin/JVM backend | Shares a language with Android, but splits contracts from the web stack and costs more to run for self-hosters. |

### Mobile

| Option | Why not |
|---|---|
| Flutter or React Native | Cross-platform, but NFC eMRTD (JMRTD), CameraX capture control and MediaPipe liveness are native-first. iOS is out of scope for now. |

### Vector search

| Option | Why not |
|---|---|
| Qdrant, Milvus, Weaviate | One more stateful service to operate and secure. pgvector keeps embeddings in the same transaction and backup as their records. Revisit if ANN scale demands it. |

### Queue

| Option | Why not |
|---|---|
| Postgres-backed queues (pg-boss, graphile-worker) | Fewer moving parts. BullMQ gives rate limiting, repeatable and delayed jobs, and flows out of the box. Revisit if the Redis-protocol dependency becomes a burden for self-hosters: BullMQ 6's Postgres backend and pg-boss are the documented exit (Phase 8 decision 2). |

### Redis-protocol server

| Option | Why not |
|---|---|
| Redis 8.x (the latest major is 8.10.2, checked 2026-10-20) | Tri-licensed RSALv2 / SSPLv1 / AGPLv3, and none of those is on the permissive list. Redis 7.4 is RSALv2/SSPLv1. |
| Redis 7.2 | BSD-3, but it is the old line. Pinning to it would mean falling behind on fixes. |
| Dragonfly | BSL 1.1, which is excluded by policy. |
| KeyDB | BSD-3, but much less active. |
| **Valkey 9.1 (chosen)** | BSD-3-Clause, Linux Foundation governance, wire-compatible, actively released (9.1.2 in Sept 2026). The image ships `redis-cli` and `redis-server` aliases. |

### S3-compatible object storage

| Option | Why not |
|---|---|
| MinIO (planned in `docs/PLAN.md`) | AGPL-3.0, which is not permissive. Its GitHub repositories are **archived**, and the `minio/minio` and `minio/mc` images **are no longer published on Docker Hub**. All of this was checked on 2026-10-20. |
| SeaweedFS (Apache-2.0) | Mature, but needs more moving parts (master, volume, filer, S3 identity JSON) for a dev stack. A good production alternative. |
| Garage | AGPL-3.0. |
| Ceph RGW | Heavyweight for development. |
| LocalStack | Emulator only, not representative of a real object store. |
| **RustFS 1.0.3 (chosen)** | Apache-2.0, single binary, MinIO-compatible configuration, GA since 1.0.0 (Sept 2026). Health endpoints and bucket versioning were verified. **Risk:** it is a young project. **Mitigation:** OpenVerify only talks the S3 API, so production can use AWS S3, SeaweedFS or any S3 service. |
| Bucket init with `minio/mc` | The image is no longer published, and the tool is AGPL. The AWS CLI (Apache-2.0) uses the standard S3 API instead. |

### Postgres version

| Option | Why not |
|---|---|
| Postgres 16 (named in `docs/PLAN.md` §3, `packages/db`) | The Phase 0 task fixes `pgvector/pgvector:pg17`. Use 17 everywhere, including Testcontainers, and update the plan text. |

## Consequences

**Positive:**
- One place for contracts, cached builds, and one database.
- The local infrastructure is permissive-only, loopback-bound and secret-safe by default.
- Dev uses the same protocols as production (Redis protocol, S3 API, SMTP).

**Negative:**
- Three toolchains (Node/pnpm, Python/uv, JDK/Gradle/Android SDK) on every developer machine and in CI.
- Docs must say "Redis protocol" and "S3 API" rather than naming products. Several existing documents still say "Redis" and "MinIO": `docs/PLAN.md`, `CLAUDE.md` and `README.md`.
- Testcontainers modules for MinIO and Redis default to images that are unavailable (MinIO) or non-permissive (Redis 8). Integration tests must pass explicit images: `valkey/valkey:9.1`, `rustfs/rustfs:1.0.3` and `pgvector/pgvector:pg17`.
- `up --wait` does not wait for one-shot jobs. App services added to compose must depend on `objectstore-init` with `condition: service_completed_successfully`.

**Follow-ups:**
- Owner: confirm the Valkey and RustFS substitutions.
- `docs/PLAN.md` §3/§8 and `CLAUDE.md` were updated on 2026-10-20 to say Postgres 17, Valkey and RustFS, and to use `--env-file .env`.
