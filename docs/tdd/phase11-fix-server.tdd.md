# Phase 11, Workflow 11F: fix-server (TDD evidence)

Agent: `fix-server` (claude-opus-5-5), Workflow 11F Stage 4, beside `fix-clients` (disjoint paths), 2026-11-21. Machine: Intel Xeon E5-1650 v3, 12 logical CPUs, 31 GiB, WSL2. Every timing below is this machine's, with the 1-minute load at the start of the call; none is a calibration figure. No item here was retried into green, no guard or timeout was raised and no test was skipped.

## 1. Items fixed, each RED then GREEN

### 1.1 The stack-down holder crash (dast-11f's new item, Medium)

Cause: `runCommand` (e2e/src/processes.ts) held a command's whole stdout in one JS string; after the 6.6-hour images-mode DAST stack, `docker compose logs api` passed V8's string limit (`RangeError: Invalid string length`) and the holder died before `compose down`.

- RED `778b30a15` (stub `outputFile` on `RunOptions` plus two cases): `pnpm exec vitest run src/processes.test.ts` → `× streams the output to outputFile and returns none of it` (`expected { …(2) } to deeply equal { stdout: '', stderr: '' }`), `× keeps only the end of a streamed output for a failure` (`ENOENT ... streamed-failure.log`); 2 failed, 16 passed.
- GREEN `669faa9eb`: `outputFile` pipes stdout and stderr to the file and keeps a 64 KiB tail for a failure's message; `saveContainerLogs` (e2e/setup/stack.ts) streams each service's log to `e2e/.artifacts/logs/<service>.log`. 18 of 18. The RED cases were corrected in the same commit: they no longer assume an order between the two pipes, nor that `process.exit()` flushes a pipe (the child now sets `process.exitCode`). Refactor `4152502cf` (lint).

### 1.2 KP11-70: X-Content-Type-Options on every API answer (MEDIUM, DAST rule 10021)

- RED `0ce81166d` (`src/http/nosniff.test.ts`): 9 of 9 failed, `expected undefined to be 'nosniff'` (health, 404s, 401 problems, a 400 validation problem, an authenticated JSON answer).
- GREEN `7f3853539`: the `onRequest` hook of `buildApp` sets `x-content-type-options: nosniff` beside the request id; the file routes keep their own identical header. 42 of 42 with `app.test.ts` and `hsts.test.ts`; the four test files that already asserted nosniff on file routes 80 of 80.

### 1.3 KP11-71: face-scan:benchmark out of the production image (MEDIUM)

Decision: it is a benchmark that writes a scratch organisation, so it is development tooling, as `graph:benchmark` and `analytics:benchmark` are.

- RED `8f61d6f6b`: `commands-build.test.ts` moves it to `DEVELOPMENT_TOOLS` (operator commands 20 → 19) → `× compiles exactly the operator commands to dist/commands/` (`expected [ …(20) ] to deeply equal [ …(19) ]`).
- GREEN `83fa2a705`: `apps/api/tsconfig.commands.json` no longer lists `scripts/face-scan-benchmark.ts`. 33 of 33 with `face-scan-benchmark.test.ts`.

### 1.4 F006: the verifier-table rule's vocabulary (MEDIUM)

- RED `9000f5090`: five malformed rows (`High (auth)`, `H`, `refuted-ish`, `yes?`, Fixed `yes` without commits) → 5 failed, 38 passed.
- GREEN `fe9c81cb1`: `malformedVerifierRow` (packages/docs-tools/src/release/review.ts) fails a row whose Severity is not CRITICAL, HIGH, MEDIUM or LOW, whose Verdict is not refuted, confirmed or plausible, whose Fixed is not yes or no, or which reads Fixed yes with no commit. `src/release/` 81 of 81.

### 1.5 F007: the wording rule's denial (MEDIUM)

- RED `35e9e7bba`: six sentences with a denial of something else (`There is no gap: the platform is ASVS L2 compliant.` and five more) → 6 failed, 22 passed.
- GREEN `7c5896868`: a denial counts only in the claim word's own clause (clauses end at `; : ! ? ( ) – —`, a sentence's `.`, and `and`, `but`, `so`, `while`, `whereas`, `although`, `though`, `yet`, `because`; a comma does not end one, because it also separates a list's items); "not only" denies nothing. On the real tree that made four lines of verbatim evidence fail (a vitest line inside a fenced block and a quoted fixture inside an inline code span, in `docs/tdd/phase11-contracts-11e.tdd.md`, and two lines that the clause rule then accepted), so fenced code and an inline code span holding a claim word are read as mentions, and a quoted word may close with an escaped backtick. One RED case was corrected: "nothing open; the SDK is certified" never put the standard and the claim in one sentence (a semicolon ends it), so it became a colon. 32 of 32 with `text.test.ts`. The JSON half of F007 (docs/**/*.json not read) is not changed: JSON has no sentence ends, so one unit would span a whole file (skipped, below).

### 1.6 KP11-91: the ASN seeds' negative answer is cached (LOW, 7C's R010)

- RED `2a673b05b`, `ea4c0e833` (`src/network/asn-data-cache.test.ts`, `node:fs`'s `readFileSync` counted): `× reads nothing again across session starts while a seed is missing` (`expected 15 to be +0`), `× reads nothing again while a seed is unexpected` (`expected 4 to be +0`); the two pick-up cases passed before and after.
- GREEN `29b8d0b7a`, refactor `d04a20c5e`: a `missing` or `unexpected` answer is kept with the size, `mtimeNs` and `ctimeNs` of the manifest and the seeds it looked at; a later call stats those files only and reads again when one changed (a seed fetched or corrected, a manifest naming a new digest). `src/network/` 117 of 117.

### 1.7 KP11-73: the consent-digest comments (LOW)

`1a3fa9ec6`: `apps/api/src/services/templates/consent-texts.ts:1-8` and `packages/contracts/src/flow-api.ts` now say what the code does: the digests are checked and never stored, a body without them is not checked, and the Android SDK computes and sends them. A comment has no RED; the Kotlin comment is fix-clients' KP11-79.

### 1.8 KP11-72: four ASVS test gaps (LOW)

- `9f5cd2d41` (1.3.11): CRLF, bare LF and bare CR in a subject, and a line break in an address, through nodemailer to the in-process SMTP fake: no `Bcc:` header line and no added recipient. 12 of 12. No defect.
- `09c7c1675` (13.4.4, 15.3.6, 15.3.7, `src/http/request-hardening.test.ts`): TRACE on three paths answers a 404 problem that echoes neither a marker header nor the token; a body with `__proto__` or `constructor.prototype` answers 400 and pollutes no prototype; `filter[list-match]` or `page[size]` given twice answers 400. 7 of 7. No defect.
- 16.3.1 and 16.3.2 (a refused sign-in or authorisation as an audit entry): open, below.

### 1.9 KP11-75: two report generators keep the summary block (LOW)

- TypeScript: RED `2e7725cfd` (`× keeps the committed summary block of the report it rewrites`); GREEN `0468e957b`: `withCommittedSummary` (packages/checks/src/calibration/cli.ts) appends the previous report's section from `## Summary block` through its end marker, unchanged, to both `calibration:report` writers. 8 of 8.
- Python: stub `dd0c9c3ec` (`write_report`), RED `83cdcf4f9` (`FAILED test_a_rewrite_keeps_the_committed_summary_block`, 1 failed, 2 passed), GREEN `ff91b11f3`: `with_committed_summary` in `services/vision/tools/android_document_guidance.py`. 3 of 3; ruff, format and mypy clean. No figure changed and no committed report was re-rendered.

### 1.10 KP11-27: the report and transaction redactions delete the exports listing them (MEDIUM, part)

- RED `fecde0442` (`src/services/account-export/hooks.test.ts`): `× a report redaction deletes the export listing the report` and `× a transaction redaction ...` (`expected { …(17) } to be null`).
- GREEN `1c8062441`: `redactReport` and `redactTransaction` (services/redaction.ts) call `accountExportHooks.subjectRedactedInTx` first in their own transaction and delete the manifests after the commit; this covers the C16 pass's `redactDueObjects` and an operator's redaction alike. `foundation-11b-d.test.ts`'s call count moves from 2 to 4 (a contract test of the hook sites, changed minimally). 107 of 107 over six files.
- The other eight C16 steps stay open (below).

### 1.11 F001/F002: a hydrated field is a copy (MEDIUM)

Decision: leave the hydrated keys out of the shared content (rather than refusing the whole object with `source_is_copy`), so an object's own fields can still be shared while another organisation's data never is.

- RED `21d2e60b9` (`src/services/connect/peek.test.ts`): `expected [ { key: 'name_first', …(2) }, …(1) ] to deeply equal [ { key: 'name_last', …(2) } ]`.
- GREEN `cdc7700c8`: `loadShareSource` reads each object's `hydrated_fields` and drops every listed key from the inquiry, account and transaction fields; the peek, the token create and the redeem recheck all read through it. Connect services 225 of 225 in 20 files.

### 1.12 KP11-26: the provider's amr on an SSO session (LOW, server half; fix-clients' KP11-90 waits for it)

- Stub `45c78ca0a` (the port's `providerAmr` parameter).
- RED `94f8635f3` (`oidc/service.test.ts`): `expected [ null, null, null ] to deeply equal [ [ 'pwd', 'mfa' ], null, …(1) ]`.
- RED `9e2219e4f` (`packages/db/src/migration-0037.test.ts`): `expected '0036_phase11_hardening' to be '0037_phase11f_session_amr'`, `expected [] to deeply equal [ { data_type: 'ARRAY', …(1) } ]`, and the ten-value limit.
- Route RED, run before the commit with the served member removed: `GET /dashboard/sessions` answered 500 (`expected array, received undefined` at `provider-amr`); GREEN with it, 6 of 6.
- GREEN, checkpoint `2cc6c1679` ("Workflow 11F fix-server checkpoint KP11-26"): migration `0037_phase11f_session_amr` (drizzle-kit generated; `user_sessions.provider_amr text[]`, check `cardinality between 1 and 10`, null before it); `providerAmrOf` keeps the token's string values of RFC 8176's shape (`^[A-Za-z0-9_.:-]{1,64}$`), at most ten; `openSsoSession` stores them; `userSessionAttributesSchema` serves `provider-amr` (array or null); `contracts/fixtures/api/user-sessions.json` carries both forms (a `serverOnly` fixture on Android). `pnpm --filter @openverify/api openapi:write` twice (13 lines, the second run no further change); `@openverify/node` holds no dashboard session type, so nothing to regenerate; `docs:catalog` wrote 4 files with no diff (no route or scope changed). A sign-in that passes a local factor after the provider (the 202 path) keeps no amr: the challenge stores none (limit, below).

### 1.13 KP11-68: the bucket init keeps its log (LOW, first step only)

- Stub `25ec7954a`, RED `5895337fc` (3 failed: the log is neither kept nor quoted), GREEN `b01cad1cf`: `waitForBucketInit` (e2e/src/bucket-init.ts) writes `objectstore-init`'s log to `e2e/.artifacts/logs/objectstore-init.log` and quotes its last 20 lines in the error before the project goes down. One RED assertion's capital letter was corrected with the GREEN. The cause of the one rc 1 is still not established (open, below).

## 2. Items open, with what stopped each

Failures under load (rule 6; none was met in this session's gates):

- **KP11-38**: mechanism traced, not fixed. A fixed single-threaded workload (the same regex-free loop, least of 3 rounds, 15 takes) used 38.65 ms of CPU at load 4.0 and 70.86 ms with all 12 logical CPUs busy (12 shell loops, load 4.1 → 10.1): process CPU time is not load-invariant on this SMT machine (siblings and caches shared), so an absolute 50 ms CPU budget meets the load. The project's answer elsewhere is `cpuRatio` against a reference workload (packages/checks/src/document/testing.ts); moving this test to it changes the budget's unit, which is a budget decision (no constant is moved after its figure was measured), so it is left for the owner.
- **KP11-67**: mechanism traced, not fixed. `rekey-batch.test.ts` alone: wall 21.8 s, user 27.2 s, sys 3.3 s at load 8.3 (4 of 4), so it is CPU-bound; under the all-packages run (load 35-40 on 12 logical CPUs, plus the SMT inflation above) the nine re-keys of 1,200 entries meet the 60 s guard. Cheaper means fewer entries or sizes, which "cuts a case": not done.
- **KP11-24, KP11-33, KP11-34, KP11-55, KP11-56, KP11-57, KP11-62**: not reproduced and cause not established; nothing tried beyond reading the code in this session.
- **KP11-68**: the init's output is now kept (1.13); the cause of the one failure is not known until it is met again.

Built in part:

- **KP11-27**: the report and transaction redactions are covered (1.10). Not built: `nullExpiredSignalComponents`, `drainAddresses`, `deleteExpiredDevices`, `redactExpiredListItems`, `purgeExpiredImportObjects`, `redactExpiredGraphQueries`, `runWorkflowRetention`, `runCaseRetention` and the decision-record retention. Each is a repository-level delete in `packages/db` that answers a count, not the ids it touched, inside its own statement; each needs its ids answered inside a transaction the hook can join.
- **KP11-72**: 16.3.1 and 16.3.2 are not built. A refused sign-in for an address the platform does not know has no organisation or environment to audit in, and an audit row per refusal would let an unauthenticated caller grow the audit table; this is a design decision, not a local fix.
- **KP11-26**: the 202 path (a local factor after the provider) keeps no amr.

Not built, each with its reason (fix-records places the "11F, else C286" and "11F or a later release" ones under PLAN's "Next release: Phase 11 deferrals (C286)"):

- **KP11-10** (the probe's remainder: 49 families, the name parameters, the dashboard and flow operations), **KP11-19** (the waiting position and C235.8's e2e), **KP11-20** (the unserved Connect members; checkpoint KP11-20 not committed, so fix-clients' KP11-88 cannot start), **KP11-21** (the five Connect server gaps): each is a multi-route or multi-contract build that did not fit this session after the items above and the gates.
- **KP11-28** (admission for ten queues), **KP11-29** (the double fetch), **KP11-69** (a per-route rate-policy table), **KP11-52** (a list-import end member, a contract change), **KP11-53** (lists-benchmark --measure's prints), **KP11-54** (the soak's generator), **KP11-92** (a Trust Device spec), **KP11-94** (a multi-page guarded PDF task), **KP11-74** (vision's and the code runner's logs: not decided test-first in this session): not reached.
- **KP10-24**: a contract change across the server, the flow spec, the web flow and the SDK; next release (C286).
- **KP10-28**: `signal_not_decisive_alone` itself is applied to workflows since 10B (`workflows/publish/rules.ts:226`, `rules-integrity.test.ts`); the carried part is the coupled-outcome limit for a trigger verification, which needs a design: next release.
- **KP10-55**: decision recorded: binding a provider does not re-validate published versions; such versions are never asked for a token, which is safe; re-validation at bind time is the next release's.
- **KP11-30**: decision recorded: the role change's own audit entry stands for the sessions it ends; no separate entry.
- **KP11-58, KP11-59, KP11-60**: each needs a measurement before its default can move; next release.
- **KP11-61**: shared test infrastructure; not changed.
- **KP11-76**: decision recorded: no tenth class; third-party list data stays placed as `public-and-list-data` (docs/security/data-classification.md states it), because a new class changes Connect's share categories (C230.4).
- **KP11-77**: decision recorded: no previous forms built; crypto-inventory.md states the coordinated restart as a limit.
- **F004** (the vision image's licence label): skipped; `infra/tests/images.test.sh` pins the label and is fix-records' path, so the Dockerfile cannot change alone (followup).

## 3. Gate (rules 8, 21, 22; beside fix-clients)

Each call is its own foreground call; exit codes read from the command, never from a pipe.

| Call | Result | Seconds | 1-minute load (start, or end where marked) |
|---|---|---|---|
| `pnpm format:check` | 0 | - | 4.24 |
| forced typecheck, `pnpm turbo run typecheck --force` (heavy) | 0, 20 of 20 tasks | 166 | 7.78 (end) |
| forced lint `--filter=@openverify/api` (heavy, 4 GB heap) | 0 | 285 | 5.65 (end) |
| forced lint `--filter=@openverify/contracts` | 0 | 70 | not read |
| forced lint, e2e checks config core db docs-tools emrtd flow-spec node signals ui watchlist workflow-engine | 0, 13 of 13 | 328 | 4.64 (end) |
| `pnpm turbo run test --force --filter=@openverify/db` | 0, 2,395 in 168 files, 90% lines | 208 | 13.4 (end) |
| the same, `--filter=@openverify/watchlist --filter=@openverify/e2e` | 0, 840 and 161 | 396 | 7.1 (end) |
| the same over checks, config, core, contracts, docs-tools, emrtd, flow-spec, node, signals, ui, workflow-engine | **1**: docs-tools 427 of 428 (below); the other ten pass (checks 3,858, contracts 4,905, core 2,008, workflow-engine 2,042, config 451, node 508, flow-spec 527, emrtd 338, signals 192, ui 58) | 103 | 34.1 (end) |
| API, 12 blob shards (heavy) | each exits 1 alone on partial coverage, as expected | 136-253 | 12.8-25.2 |
| API merge | 0, 10,991 in 871 files, 93.43% statements | 66 | 10.8 |
| `workflow-docs:write`, `git diff --exit-code docs/workflows` | 0, no diff | - | - |
| `pnpm --filter @openverify/db test:integration` | 0, 110 | 98 | 4.8 |
| integration `--project graph` | 0, 13 (template 22.1 s of 180) | 45 | 16.9 |
| integration `--project api --shard=1/3`, 2/3, 3/3 | 0, 121; 0, 139; 0, 196 | 137, 194, 119 | 11.0, 20.6, 12.5 |
| vision `uv lock --check`, ruff, format, mypy | 0 | - | - |
| vision pytest, three parts | 0, 836 + 903 + 986 = 2,725, 97.46% | 156, 191, 360 | 15.8, 4.6, 4.7 |
| `openapi:write` twice | 0, 0 (second: no change) | 24 | - |
| `docs:catalog` | 0, no diff under docs/ | - | - |
| rule 22's one call, `session-idle.spec.ts` and `account-export.spec.ts` on a fresh stack | first start: 1, Next.js 16.4.2's own SecurityFatalError notice in `next build` (KP11-42, load 11.76, recorded, nothing changed); second start: 0, 2 of 2 | 86, 109 | 11.76, 5.86 |

The docs-tools failure is `src/selfhost/index.test.ts > holds over the repository`: `docs/self-hosting/upgrades.md differs from a fresh render`. Migration 0037 (KP11-26) changes the page `docs:selfhost` renders from `packages/db/drizzle/`; the page is fix-records' (followup), so the suite stays red until it re-renders. No other test failed. `load/` and the watchlist benchmark's files were not touched, so neither gate ran. No Android path was touched.
