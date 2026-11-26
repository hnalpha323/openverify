# Phase 8, Workflow 8B Stage 4: integration-8b

Base `7b1aca30`. Every command ran after `source scripts/env.sh`, in the foreground, alone: no other agent ran in this stage. Commits `76a3bce5..` (24 code and doc commits before this record). Plan record: "Workflow 8B Stage 1a amendments (contracts-8b, call 2)", "Workflow 8B Stage 2 amendments", "Stage 3 amendments" and "Stage 4 amendments (integration-8b)".

## 1. The case view and the review recipe (C140.2, C140.5)

RED `76a3bce5`:

```text
$ (cd packages/workflow-engine && pnpm exec vitest run src/variables/scope.test.ts --coverage.enabled=false)
 × a case trigger reads the case view: its status and resolution plain, its fields PII (C140.2)
AssertionError: expected { ok: true, …(3) } to match object { ok: true, pii: false }
      Tests  1 failed | 35 passed (36)
$ (cd apps/api && pnpm exec vitest run src/workflows/actions/cases/cases.test.ts src/workflows/recipes/recipes.test.ts src/seed/workflows.test.ts --coverage.enabled=false)
 × registers "Review on report match", whose draft the check takes now that a case is typed
AssertionError: expected [] to deeply equal [ { …(5) } ]
 × lists each recipe with its trigger and what it needs
      Tests  2 failed | 22 passed (24)
```

GREEN `82840c3d` (`OBJECT_VIEW_NAMES.case = 'case'`, `CASE_RECIPE_ROWS = [REVIEW_ON_REPORT_MATCH]`):

```text
$ (cd packages/workflow-engine && pnpm exec vitest run src/variables --coverage.enabled=false)      Tests  115 passed (115)
$ (cd apps/api && pnpm exec vitest run src/workflows/actions/cases src/workflows/recipes src/seed src/case-joins.test.ts src/workflows/definitions src/workflows/publish --coverage.enabled=false)
 Test Files  20 passed (20)      Tests  241 passed (241)
$ pnpm --filter @openverify/api workflow-docs:write          # no diff
```

## 2. The case-bulk job's publisher and its sweep (C137.4, C143.2)

Stub `d4508e89` (`CaseRepeatableDeps.bulk`), RED `42d73f70`:

```text
$ (cd apps/api && pnpm exec vitest run src/jobs/repeatable/phase8b.test.ts src/worker-cases.test.ts --coverage.enabled=false)
 × schedules the sweep every 60 seconds when the worker holds the case-bulk producer
 × enqueues again the bulk actions left unfinished for a minute, through the producer
 × starts the job with the case options, and hands each job to its processor
      Tests  3 failed | 7 passed (10)
```

GREEN `0eebeb30`: `caseDeps` gains `events`; `case-bulk-sweep` (60 s) calls `requeueUnfinishedCaseBulkActions` with the worker's `case-bulk` producer, which `main` builds and closes. The RED commit's `expect.anything()` failed the forced lint (`no-unsafe-assignment`) and is `expect.any(Object) as unknown` in the GREEN.

```text
$ (cd apps/api && pnpm exec vitest run src/jobs/repeatable src/worker-cases.test.ts src/worker.test.ts --coverage.enabled=false)   Tests  123 passed (123)
$ (cd apps/api && pnpm exec eslint ...)   lint=0
```

## 3. A case's attachments on its own routes, PATCH items, redaction (C129.2, C135.1, C139.1)

RED `42b0ab3b`:

```text
$ (cd apps/api && pnpm exec vitest run src/services/cases/attachments/attachments.test.ts -t "own routes" --coverage.enabled=false)
 × serves them on GET /cases/:id, and an event’s case names no file          AssertionError: expected [] to deeply equal [ { …(11) } ]
 × stores a PATCH item, serves it on the case, and asks for its rendition    expected 501 to be 200 ("Case attachments is not built yet.")
 × deletes their objects when the case is redacted, keeping id, type, ...     expected Buffer[ 222, 229, … ] to be null
      Tests  3 failed | 10 skipped (13)
```

GREEN `3faf54f9`: `caseRecord` reads `caseAttachmentRecordsOf` (filenames off for an event); `updateCase` passes the store and asks for the scan and rendition after the commit, staging `case.updated`; `redactCasesInTx` calls `redactCaseAttachmentsInTx` and hands its keys back. The third RED test went through `DELETE`, which the harness answers with a recording `RedactionService`; it now calls `redactCasesInTx` as the service does (a setup correction, in the GREEN commit).

```text
$ (cd apps/api && pnpm exec vitest run src/services/cases src/workflows/actions/cases src/case-plumbing.test.ts src/case-file-plumbing.test.ts src/case-joins.test.ts src/routes/server --coverage.enabled=false)
 Test Files  70 passed (70)   (1270 tests with the corrected one)
```

## 4. The scanner's name for the API (C135.5, Stage 1b item 40)

RED `dd02fefb`:

```text
$ bash infra/tests/compose.test.sh --static-only
FAIL - api receives OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX
FAIL - api and worker read OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX the same way (expected '', got 'null')
# 501 passed, 4 failed
$ (cd e2e && pnpm exec vitest run src/env.test.ts --coverage.enabled=false)
 × binds the sandbox attachment scanner, read the same by the API and the worker (C146.3)
```

GREEN `a591b260`: the two names move to the compose block both processes read; the e2e stack binds `sandbox`. The older check that the API reads no scanner name (`provider_kinds_api`) changes with the plan: `ATTACHMENT_SCANNER` joins the kinds the API reads by name, as `SLACK` did. `compose.test.sh --static-only`: 505 passed.

## 5. The case field label and its rebuild (C136.4, P25)

Stub `5e071aa8`, RED `a09d937f`:

```text
$ (cd packages/db && pnpm exec vitest run src/repositories/case-field-index.test.ts --coverage.enabled=false)
AssertionError: expected '79231fdb342f30f5ee794aa9e0cb9e974c27f…' to be '56733593e58f8d593ed72ea827f903608cad0…'
$ (cd apps/api && pnpm exec vitest run src/services/cases/rebuild.test.ts --coverage.enabled=false)
 × rewrites a case’s searchable keys under the key, once, and leaves a redacted case alone
 × runs in blind-index:rebuild after the transaction field keys, printing counts only
      Tests  2 failed (2)
```

The vectors are OpenSSL 3.0.13's: `printf '%s' 'openverify/identifier-case-field/v1|synthetic-input' | openssl dgst -sha256 -mac HMAC -macopt hexkey:<subkey>` gives `4759febc…0d06`; the same recipe reproduces the existing transaction vector `e060d602…f659`.

GREEN `d7de96ed`: `IDENTIFIER_KEY_LABELS['identifier-case-field']`; `caseFieldValueKey` uses it; `listCaseFieldKeys`, `listCasesForRebuild`; `rebuildCaseFieldKeys` under the case row lock; `blind-index:rebuild` prints the case line after the transaction field keys (`blind-index-rebuild.test.ts` reads the devices line one place earlier, changed with the plan). db 49 tests and API 59 tests pass; lint caught a `prefer-optional-chain` before the commit.

## 6. `create_case` defers at `case-create` (C143.3, H30)

RED `1b1b7d80` (`cases.test.ts`: `create_case` retries at 60, 300, 900 s, the others never), GREEN `811c82e7`. The API's `steps.test.ts` "stops at the case-create budget" then answered `errorCode: null` (the step waits for its retry); it changes with the plan in `4c276966`: the run stays `in_progress`, the step is not `done`, and no case is made, whether the limiter refuses or cannot answer.

## 7. The case filter subject (C143.4), found by the SLA spec

The first run of `case-sla.spec.ts` wrote `case.sla-expired` with no delivery: `events` held the event in the webhook's environment, for its template, and `webhook_deliveries` held none. `toEventSubject` dropped `caseTemplateId` and `heldInquiryTemplateIds`, so a strict case subject failed every present `case-template-ids` filter.

RED `31b197b6`:

```text
$ (cd apps/api && pnpm exec vitest run src/events/subject-workflows.test.ts --coverage.enabled=false)
 × passes a case’s template and its held inquiries’ templates on, which the SQL filter reads (C143.4; Workflow 8B Stage 4)
      Tests  1 failed | 8 passed (9)
```

GREEN `2f3cd434`: both members pass on. `src/events src/services/cases src/case-plumbing.test.ts src/case-joins.test.ts`: 272 passed.

## 8. The full-stack specs (C146.3)

`251b8d40`: `case-review-recipe.spec.ts` (both paths), `case-sla.spec.ts`, `case-attachments.spec.ts`, `tests/support/cases.ts`. First runs on a stack: the attachment spec passed; the recipe's draft was refused `on_null_missing` at `/trigger/config` (the added criterion reads `trigger.inquiry.id`, which a report may lack), fixed with `on-null: skip`; the SLA spec's exact 5,000 ms lead between `created-at` and `sla-expires-at` did not hold (the deadline is counted from the request's own instant), now a bound of 5 to 6 s; then the delivery defect of section 7. On a fresh stack after the fix:

```text
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/case-sla.spec.ts tests/case-attachments.spec.ts tests/case-review-recipe.spec.ts'
  ✓ an attachment is scanned by the sandbox scanner and downloaded as a rendition without EXIF (1.1s)
  ✓ "Review on report match" on a matched completion report: … not solely automated (11.2s)
  ✓ "Review on report match" on an errored completion report: … not solely automated (15.0s)
  ✓ a case with sla-expires-in-seconds: 5 fires case.sla-expired once to a webhook (1.1m)
  4 passed (1.6m)
```

The synthetic EXIF was checked with Pillow before the spec ran: `{34853: 38, 270: 'synthetic-gps-canary'} {1: 'N'}`.

## 9. CI (F08)

RED `dcfd08ff` (`ci-workflow.test.sh`: unit-api at least 40 minutes): `# 218 passed, 1 failed`. GREEN `a68b4279`: `timeout-minutes: 40`; 219 passed. Estimate: shard 1 took 22.3 of 30 minutes on CI 41557289819 with 7,673 API tests; this tree has 8,137 (+6%), and the local shards took 7.0 and 6.1 minutes alone against 8A's 6.2 and 5.4 (+13%), so shard 1 is estimated at 23.6 to 25.2 minutes, past 22.5.

## 10. The validation (Validation, as the 8A Stage 4 amendments order it)

Each step's exit code was read from the command, its output in a file. Alone on the machine.

| Step | Result | Time, load |
|---|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | 0, 0 | 75 s together, load 0.7 |
| `pnpm turbo run lint typecheck --force` (`NODE_OPTIONS=--max-old-space-size=4096`) | 0, 32 of 32 tasks, in one call | 281 s, load 1.2 to 4.2 |
| `fetch_models.py`, `fetch_data.py`, `build:variant-groups` | 0, 0, 0 (sha256 `29d05838…3bfb`) | 6 s |
| `pnpm turbo run test --force --filter=!@openverify/api` | 0, 15 of 15, in one call: 21,059 tests | 532 s, load 3.3 to 13.6 |
| API unit suite, two blob shards and a merge (`/tmp/i8b-api-gate1`) | merge 0: 8,137 tests in 568 files, 94.58% statements, 85.55% branches | shards 421 s and 363 s, load 1.5 to 10; merge 7 s |
| `benchmark:typecheck`, `benchmark:test` | 0, 0 (119 tests) | 48 s |
| `pnpm --filter @openverify/db test:integration` | 0: 73 tests in 16 files | 76 s, load 2.4 |
| `--project graph` | 0: 13 tests; template built in 15,509 ms, copied in 1,462 ms | 32 s, load 9.7 |
| `--project api --shard=i/3` | 0, 0, 0: 72, 91, 74 tests in 14 files each | 50, 143, 60 s, load 5.8 to 14.5 |
| vision: ruff, format, mypy | 0 | 1 s |
| vision: pytest files 1 to 58, `--cov-fail-under=0` | 0: 1,470 passed | 251 s, load 13.4 to 2.0 |
| vision: pytest files 59 to 103, `--cov-append` | 0: 1,130 passed, total coverage 97.48% | 316 s, load 2.0 to 1.2 |
| Android gate | 0; 1,334 SDK host tests (unchanged, so the CI floor stays) | 95 s, load 1.1 |
| `openapi:write` + `git diff --exit-code docs/api/openapi.json`; `workflow-docs:write` + `git diff --exit-code docs/workflows` | 0, 0 | |
| mocked flow suite | 0: 79 passed | 23 s, load 3.9 |
| fresh stack: down and build; up | 0; 0 | 0 s (cached); 65 s, load 4.6 |
| full stack `--shard=1/3`, `2/3`, `3/3` | 0, 0, 0: 39, 40, 38 passed (117 in 61 files) | 218, 294, 242 s, load 1.0 to 4.2 |
| stack down | 0 | 3 s |
| `docker build` apps (tagged `openverify/apps:dev`), vision, code-runner | 0, 0, 0 | 184, 32, 51 s, load 2 to 3 |
| every `infra/tests/*.test.sh` | 0 each: 43, 11, 219, 55, 531, 11, 9, 11, 55 | |
| workflow benchmark (under the e2e lock) | effectful 16, 47, 48 steps/s at 1, 8, 32 clients; control flow 89, 194, 209 | 137 s, load 1.4 to 2.3 |
| `gitleaks git --redact .` | 0: 4,571 commits, no leaks | 7 s |

`apps/api/src/services/cases/redaction.test.ts` holds an uncommitted prettier reformatting by an earlier agent (`api-cases`), formatting only, in a path `.prettierignore` leaves out; it is left as found.
