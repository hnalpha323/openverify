# Self-hosting OpenVerify

This guide is for an operator who runs OpenVerify on their own machines (C277). It says what the code at this commit does, what only the operator can do, and where a figure comes from. It indexes the pages earlier phases wrote (`docs/network/`, `docs/flow/`, `docs/lists/`, `docs/graph/`, `docs/transactions/`, `docs/workflows/`, `docs/cases/`, `docs/flows/`, `docs/settings/`, `docs/android/`) instead of repeating them.

Nothing in this release is signed, attested or published to a registry ([verify-artifacts.md](verify-artifacts.md)). The project's security checklists (`docs/security/`) are self-assessed. Installing OpenVerify does not by itself make a deployment meet any law or standard: the compliance guide (`docs/compliance/README.md`) is not legal advice.

## The processes and what each talks to

Seven processes, five images (`infra/docker/` and `services/vision/Dockerfile`; every image runs as uid and gid 10001 on a read-only root with a writable `/tmp`):

| Process | Image and entry | Talks to | Listens on |
|---|---|---|---|
| API | `openverify/api`, `node dist/server.js` | Postgres (runtime role), Valkey, S3, vision, SMTP, the SMS and other providers bound per environment | 3000 (public); `/api/v1/internal/*` on `OPENVERIFY_INTERNAL_LISTEN` (3101 in the chart) |
| Worker | `openverify/api`, `node dist/worker.js` | Postgres (runtime role), Valkey (BullMQ), S3, vision, the code runner, SMTP, webhooks, list publishers, network data publishers, providers | nothing; its liveness is the heartbeat file read by `node dist/worker-health.js` |
| Migrate and the operator commands | `openverify/api`, `node dist/commands/db-migrate.js` and the other `dist/commands/*.js` | Postgres (migration role for `db:migrate` and `db:grant-runtime`; runtime role for most others), S3 and SMTP for some | nothing |
| Console | `openverify/dashboard`, its custom `server.ts` over Next.js's standalone output | the API only, through its BFF with `OPENVERIFY_DASHBOARD_BFF_TOKEN` | 3000 in the image (3001 as the chart's service port) |
| Flow | `openverify/flow`, `node server.ts` | the API's internal embed-policy route with `OPENVERIFY_FLOW_SERVER_TOKEN`; browsers reach the API directly | 4173 |
| Vision | `openverify/vision` | nothing outbound (no egress in compose or the chart) | 8000, behind `OPENVERIFY_VISION_SERVICE_TOKEN` |
| Code runner | `openverify/code-runner`, `bin/code-runner-server.mjs` | nothing (no network in compose; no egress in the chart) | a Unix socket in compose, `tcp:` port 7700 in the chart with `OPENVERIFY_CODE_RUNNER_TOKEN` |

Which variables each process reads is [configuration.md](configuration.md), generated from `apps/api/src/config-registry.ts`.

## The boundaries

The trust boundaries, the threats at each and the accepted risks are the threat model, `docs/security/threat-model.md`. In short: the browser and the SDKs are untrusted; the API is the only process that holds the KEK and the blind-index key besides the worker and the commands; vision and the code runner hold no data key and reach no network; the stores are the operator's. Plain-text transport inside one namespace is the operator's choice, stated as an accepted risk ([requirements.md](requirements.md#tls-and-the-accepted-transport-risk)).

## The pages

| Page | What it covers | Contract |
|---|---|---|
| [requirements.md](requirements.md) | what you need before installing, and what only you can provide | C277.1, C277.3, C277.4 |
| [install-compose.md](install-compose.md) | one host, the compose `app` profile on the production images | C277.1 |
| [install-kubernetes.md](install-kubernetes.md) | the Helm chart on Kubernetes 1.35 or later | C277.1 |
| [configuration.md](configuration.md) | every variable, generated | C277.2 |
| [sizing.md](sizing.md) | memory, connections and throughput from the one machine 11D measured | C277.11 |
| [secrets-and-rotation.md](secrets-and-rotation.md) | where each secret lives and how it rotates | C277.5 |
| [backups-and-restore.md](backups-and-restore.md) | backups, the keys apart, the restore drill, the erasure delay | C277.6 |
| [upgrades.md](upgrades.md) | migrations, the chart's first release, retention settings | C277.1 |
| [database.md](database.md) | the two roles, timeouts, jit, logging, `pg_upgrade` | C277.7 |
| [valkey.md](valkey.md) | AOF, `noeviction`, ACL users | C277.7 |
| [first-run.md](first-run.md) | the first organisation, providers, list syncs, trust anchors, retention | C277.8 |
| [break-glass.md](break-glass.md) | `user:reset-mfa` and `user:allow-password` | C277.9 |
| [monitoring.md](monitoring.md) | the registered metrics as log events, and the operator checks | C277.10 |
| [sso.md](sso.md) | OIDC sign-in for the console | C248 |
| [hardening-checklist.md](hardening-checklist.md) | the checklist rows only the operator can meet, generated | C277.1, C277.3 |
| [verify-artifacts.md](verify-artifacts.md) | what can and cannot be verified about this release's artifacts | C277.1 |
