# Logging inventory

What each OpenVerify process writes to its log, at which level, what is redacted before a line is written, what never reaches a log, where logs may go and how long the platform's own records are kept (C276.3; ASVS v5.0.0-16.1.1 and 16.4.3 are the requirements it answers, self-assessed in `docs/security/asvs-5.0.0-l2.csv`). No log excerpt appears here.

It describes the code at its commit. Its record test, `packages/docs-tools/src/records/logging.test.ts`, expands the two redaction tables below and fails when they differ from the lists the loggers apply (`REDACT_PATHS` in `apps/api/src/logger.ts` and `WORKER_REDACT_PATHS` in `apps/api/src/jobs/logger.ts`), and when a `PERSONAL_LOG_KEYS` key, a key a stored API log redacts or a process is missing here.

## The processes

Only the API and the worker configure log redaction. The other processes write little, and what they write is described as it is; none of them has a redaction list (Workflow 11E Stage 1a amendment 8). Workflow 11F reviewed the console and the flow server: neither needs one, since neither logs personal data, and their tests hold that (KP11-80). Vision and the code runner are still to be reviewed (KP11-74, open: the next release).

| Process | How it logs | What a line holds | Redaction |
|---|---|---|---|
| `api` | pino through Fastify (`loggerOptions`, `apps/api/src/logger.ts`); outside a request, a pino logger named `openverify-api` (`createWorkerLogger`) | A request line is `{ method, route }` with the request id (C93.7: never the URL, its path values or query, the host, the client's address or port), and the response's status and duration; errors by class and problem code; start-up warnings naming a variable, never its value; metric events (below) | `REDACT_PATHS` |
| `worker` | pino, named `openverify-worker` (`createWorkerLogger`, `apps/api/src/jobs/logger.ts`) | Ids, statuses, check names, error classes and codes (`describeJobError`), durations; metric events | `REDACT_PATHS` and `WORKER_REDACT_PATHS` |
| `migrate` | The one-shot commands (`db:migrate`, `db:grant-runtime`, `kek:rewrap`, `blind-index:rebuild` and the others) write to standard output and error | Counts and outcomes only: each command's header says it prints no id, key, hash or data | None (no personal value is passed to a write) |
| `dashboard` | `console` lines from the console's server | A CSP violation as one warn line `{ level, msg: "csp-violation", effective-directive, blocked-origin }`, the blocked resource's scheme and host only, never the document, the referrer, a path or a query (`apps/dashboard/src/lib/csp/reports.ts`); a failed session end as its error class and status (`apps/dashboard/src/lib/api/sessions.ts`). A page's error boundary logs only `The page could not be loaded` with the error's kind and digest in the browser's own console, never its message or stack, and nothing on the server (`apps/dashboard/src/components/page-error.tsx`; Workflow 11F, KP11-80, held by `apps/dashboard/src/components/page-parts.test.tsx`) | None |
| `flow` | The flow server writes JSON lines to standard output through its injected log function (`apps/flow/server.ts`) | The access log is `{ entry, status }`: which kind of entry (`hosted`, `preview`, `embed`, `asset`, `config`, `not-found`, `refused`, `rate-limited`, `error`) and the status, never the path (C157.1); start-up warnings about its secret files and a missing token | None |
| `vision` | Python `logging`, and uvicorn's default access log (`services/vision/Dockerfile`) | The access log's line: the calling API or worker's address and port, the method, the path and the status; vision's paths hold no identifier. Warnings name a count or a condition; an unhandled error or a failed inference logs its class, the method and the path, with a traceback (`services/vision/src/openverify_vision/problems.py`, `services/vision/src/openverify_vision/inference.py`) | None |
| `code-runner` | Standard output and error (`packages/workflow-engine/bin/code-runner-server.mjs`) | Its configuration errors, naming each variable, and its secret-file warnings as JSON | None |

Postgres is started with `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0` (`infra/docker-compose.yml`), so a statement it logs never carries its bind parameters.

### Levels

The API and the worker log at `OPENVERIFY_LOG_LEVEL` (default `info`; `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`). The others have no level setting. The redaction below applies at every level.

### Metrics are log events

There is no metrics endpoint (C286 defers one). A metric is a pino event of the API or the worker with a stable `metric` member, a numeric `value` and its labels, an environment id and a queue name only, never personal data (C250.7, `apps/api/src/metrics-registry.ts`). `docs/self-hosting/monitoring.md` lists each registered metric and the alerts an operator builds on them.

## Redaction before a line is written

pino replaces each path below with `[REDACTED]` (`REDACTED`, `apps/api/src/logger.ts`). A path is a prefix and a key: the top level is the key alone, `*.` one level down. Code that must log personal data nests it under a `pii` key, which is redacted whole; no generic name (`code`, `message`, `values`, `destination`, `inputs`) is redacted, so a logged error keeps its message (C53.8). The ESLint rules of `packages/config/eslint/phase5-rules.js` hold the Phase 5 folders, and since Workflow 7A the signal, network and handoff folders, to these names (C53.8, C93.7).

### The API and the worker: `REDACT_PATHS`

| Keys | Where | Why |
|---|---|---|
| `headers.authorization`, `headers.cookie`, `headers["proxy-authorization"]`, `headers["set-cookie"]` | `req.`, `res.`, top level, `*.` | Credentials, wherever headers are logged |
| `pii` | top level, `*.`, `*.*.`, `*.*.*.`, `*.*.*.*.` | Personal data a line must carry is nested under `pii` (C53.8) |
| `otpCode`, `otpDestination`, `challengeMessage`, `signedMessage`, `inputValues`, `walletAddress`, `chipFile`, `aaResponse` | top level, `*.`, `*.*.` | Phase 5's personal names (`PERSONAL_LOG_KEYS`): an OTP code or destination, a challenge or signed message, entered values, a wallet address, a chip file and an Active Authentication response |
| `reportQuery`, `matchedName`, `listEntryName`, `articleTitle`, `subjectIndex` | top level, `*.`, `*.*.` | Phase 6's (`PERSONAL_LOG_KEYS`): a report's screened query, a matched or listed name, an article title and the re-screen's subject index |
| `prefillMrz` | top level, `*.`, `*.*.`, `*.*.*.` | The nfc step's MRZ key fields, wherever a logged object carries a flow session's step (C207.2, C221.1) |

### The worker only: `WORKER_REDACT_PATHS`

| Keys | Where | Why |
|---|---|---|
| `embedding`, `bytes`, `ciphertext`, `secret`, `serviceToken`, `body` | top level, `*.`, `*.*.`, `*.*.*.` | Images, embeddings, ciphertext, secrets and bodies: a second line of defence, since worker code logs ids, statuses and error classes only |
| `device`, `label`, `landmarks`, `layout`, `template` | top level, `*.`, `*.*.`, `*.*.*.` | A selfie's device snapshot and camera label (which can carry a person's name), face landmarks, background layouts and face templates (C40.5, C41.6) |
| `otpCode`, `otpDestination`, `challengeMessage`, `signedMessage`, `inputValues`, `walletAddress`, `chipFile`, `aaResponse`, `reportQuery`, `matchedName`, `listEntryName`, `articleTitle`, `subjectIndex` | top level, `*.`, `*.*.`, `*.*.*.` | `PERSONAL_LOG_KEYS` again, one level deeper than the API's paths |

## What never reaches a log

- **Secrets and tokens:** keys, peppers, service tokens, passwords, TOTP secrets, one-time codes, session, link, handoff and invitation tokens, webhook and workflow secrets (`docs/security/crypto-inventory.md`). A start-up error names the variable, never its value.
- **Personal data by value:** fields, names, addresses, document numbers, extracted data, chip files, images, embeddings and templates; a value that must travel with a line goes under `pii`.
- **Workflow 7A's values:** a client address, a coordinate, a fingerprint or a user agent appears only under `pii` (C53.8, C93.7); a handoff token or confirmation code never appears at all.
- **Workflow 7B's values:** a list item value, a match value, a transaction field, an importer row, a graph query parameter or an unmasked node value.
- **Phases 8 to 10's values:** a workflow secret, a run's inputs, variables, outputs or step console, a case's fields, comments or attachment names, an export's or bulk report's content, a decision comment, the flow-server or code-runner token, a consent digest.
- **Metric labels** are an environment id and a queue name, never a personal value (C250.7).

## The stored API log (`api_logs`)

The API keeps a record of each server API request (C12) in the database, apart from the process logs above (`apps/api/src/services/api-logs.ts`):

- **Before storage:** the value of every key below is replaced with `[REDACTED]` at any depth of the query and the bodies (`API_LOG_REDACTED_KEYS`, `packages/contracts/src/redaction.ts`): `secret`, `token`, `session-token`, `one-time-link`, `one-time-token`, `password`, `code`, `totp-code`, `recovery-code`, `flow-url` (the resume answer's flow URL carries a session token in its fragment), `secret-value`, `client-secret` and `binding`; and every value of a `custom-headers` map (`API_LOG_REDACTED_VALUE_MAPS`), whose names are kept.
- **Bodies:** a multipart body keeps each part's name, file name, content type and size, never its bytes; an importer's JSON body keeps its file's decoded length and SHA-256 only (C100.1); the access export's manifest and file answers are never kept (`UNLOGGED_RESPONSE_ROUTES`); the query, the request body and the response body are each cut at 64 KiB.
- **At rest:** the caller's address and user agent, the query and both bodies are sealed per row (`docs/security/data-classification.md`).
- **Served back:** a reader without `pii:view` gets the address and user agent nulled, every value of each `fields` object nulled, and each personal member masked wherever it appears: among them `note`, `phone-number`, `email-address`, a multipart part's `filename`, a decision's `comment`, a run's `parameters`, a form's `prefilled-value`, a case comment's `message`, a search's `query`, a transaction search's `filter[identifier][value]` and every `filter[fields.<key>]`; and a stored `next` link has its searched value emptied (C105.2, C165.3).
- **Kept** for the environment's `api-log-retention-days` (default 30), then deleted by the C16 pass; an inquiry's or account's redaction reaches its entries.

## Where logs may go and how long they are kept

- Each process writes to its standard output and error. Neither the compose file nor the chart ships logs anywhere: the container runtime holds them, and an operator who needs them kept forwards them to a log store of its own, separate from the database and the hosts it runs on, with access limited to the operators who need it (ASVS v5.0.0-16.4.3; `docs/self-hosting/monitoring.md`). Their retention there is the operator's to set; this page cannot set it.
- The platform's own records, kept in the database, are not process logs and have their own windows: the stored API log (`api-log-retention-days`, default 30), webhook deliveries (`webhook-delivery-retention-days`, default 30), events (`event-retention-days`, default 90) and the audit log, append-only and kept unless `audit-log-retention-days` is set (`docs/security/data-classification.md`, `operator-and-audit`). The audit log is the record of who did what: its address and user agent are sealed, and an HMAC of the address serves the audit explorer's search.
