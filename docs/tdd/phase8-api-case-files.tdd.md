# Phase 8, Workflow 8B Stage 3: `api-case-files` (TDD evidence)

Base: `baea2ae9` (foundation-8b's checkpoint (F) record). Owned paths: `apps/api/src/services/cases/{attachments,exports}/`, `apps/api/src/providers/attachment-scanner/`, `routes/server/{case-attachments,case-exports,case-print}.ts`, `routes/dashboard/file-renditions.ts`, `jobs/cases/`, `packages/db/src/repositories/{case-attachments,file-renditions,case-exports}.ts`.

Every command ran after `source scripts/env.sh`. Iteration runs used `--coverage.enabled=false`; the gates are at the end.

## Slice 1: the repositories (packages/db)

- **Stub** `2272c4ac`: the names beyond the frozen stubs (row lock, count, scan and rendition outcomes, redaction and C16 rows, file rendition request and pages, export claim, completion, failure, expiry), each rejecting with `CaseRepositoryNotBuiltError`. `CaseAttachment` and `CaseExport` widen to the opened row (a builder may widen a stub while nothing calls it).
- **RED** `1eea8d9e`, `src/repositories/case-files.test.ts`:

  ```
  $ (cd packages/db && pnpm exec vitest run src/repositories/case-files.test.ts --coverage.enabled=false)
  × seals the filename for its row, opens it on read and lists a case's in upload order
  × records a scan and a rendition only on a pending attachment
  × redacts a case's attachments once, keeping id, type, size and scan status (P34)
  × requests a file's rendition once and records it ready with its pages in order
  × discards a source's pages and marks a file's rendition deleted
  × finds discarded pages and pages whose source is gone for the C16 pass, then deletes their rows
  × seals the request until the export finishes, and one job claims it
  × fails with a code alone, and lists a creator's own newest first
  CaseRepositoryNotBuiltError: createCaseAttachmentRow is not built yet (api-case-files)
  Tests  8 failed (8)                                       (exit 1)
  ```
- **GREEN** `7858e189`: the same command, `Tests 8 passed (8)`, exit 0; with `case-file-plumbing.test.ts`, 12 passed. `case-file-plumbing.test.ts` changed with the plan: its block holding each stub to `CaseRepositoryNotBuiltError` is gone, because the stubs are built (the rewrap, subject and seed tests stand).

## Slice 2: the scanners

- **Stub** `20734814`: `AttachmentScannerOptions.clamdTimeoutMs`.
- **RED** `c655136e`, `providers/attachment-scanner/scanner.test.ts` (a fake clamd on a Unix socket in the OS temp directory and on 127.0.0.1, no network) and `phase8-providers.test.ts` (changed with the plan: the bound sandbox scanner answers `clean` for four zero bytes, where the stub rejected 501):

  ```
  $ (cd apps/api && pnpm exec vitest run src/providers/attachment-scanner/scanner.test.ts --coverage.enabled=false)
  AssertionError: promise rejected "NotImplementedError: The sandbox attachme…" instead of resolving
  Tests  7 failed | 1 passed (8)                            (exit 1)
  ```
  The one pass, "refuses to bind without its socket", passed under the stub too: the factory already refused it.
- **GREEN** `4af88897`: `Tests 26 passed (26)` with the binding test, exit 0. The EICAR string is put together from three parts in `eicar.ts` and in the test, so no file holds it whole.

## Slice 3: attachments (upload, serving, scanning, renditions, PATCH, redaction)

- **Stub** `b8ecdef3`: `PatchAttachmentStore` (the optional fourth argument of `acceptPatchAttachments`) and `requestAttachmentWork`.
- **RED** `aed4b0c8`, `services/cases/attachments/attachments.test.ts`:

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/cases/attachments/attachments.test.ts --coverage.enabled=false)
  AssertionError: {"title":"Not Implemented","status":501,"detail":"POST /cases/:id/attachments is not built yet.", ...}: expected 501 to be 201
  AssertionError: expected [ 501, undefined ] to deeply equal [ 410, 'case_redacted' ]
  NotImplementedError: Case attachments is not built yet.
  Tests  10 failed (10)                                     (exit 1)
  ```
- **GREEN** `878d6409`: `Tests 10 passed (10)`, exit 0; with `case-file-routes.test.ts`, 28 passed. Two expectations of the RED file were corrected inside GREEN, each for a reason in the test, not in the code: a new case's `lock-version` starts at 0, so one upload moves it to 1 (the test now reads it before); and the request that found a scan pending asks for it again (the content route's own retry), so the recorded scan jobs are the two uploads' and that third one. `case-file-routes.test.ts` changed with the plan: the four attachment routes answer 404 for a case this environment does not hold, where they answered 501.

## Slice 4: an inquiry file's rendition

- **RED** `c74eaa49`, `services/cases/attachments/file-renditions.test.ts`. The route's service was written before its test in one step of this slice; it was moved aside and the frozen stub put back from `HEAD` before the RED run, so the run below is against the stub:

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/cases/attachments/file-renditions.test.ts --coverage.enabled=false)
  NotImplementedError: GET /dashboard/files/:id/rendition is not built yet.
  Tests  3 failed | 2 passed (5)                            (exit 1)
  ```
  The two passes are the purge and request hooks, built in slice 3's GREEN: their tests came after their code (recorded, rule 5).
- **GREEN** `e9ddefd6`: `Tests 5 passed (5)`; with `routes/dashboard/file-renditions.test.ts`, 8 passed. That route test changed with the plan: an unknown file answers 404, where it answered 501.
- **Fix** `8f27d8d1`: the RED file read two queries through `db.execute`, whose rows the API's typecheck reads as `unknown`; lint passed and the full API typecheck did not, so the file now reads them through the typed client. No assertion changed.

## Slice 5: exports and print

- **RED** `0c69452a`, `services/cases/exports/exports.test.ts`:

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/cases/exports/exports.test.ts --coverage.enabled=false)
  TypeError: Cannot read properties of undefined (reading 'id')       (the 501 answer has no data)
  AssertionError: expected 501 to be 403
  AssertionError: expected [ 501, undefined ] to deeply equal [ 422, 'export_too_large' ]
  AssertionError: {"title":"Not Implemented","status":501,"detail":"POST /cases/:id/print is not built yet.", ...}: expected 501 to be 200
  Tests  8 failed (8)                                       (exit 1)
  ```
- **GREEN** `fc599abc`: `Tests 8 passed (8)`; with the route tests, 26 passed. Corrected inside GREEN, each in the test: a field's JSON cell opens with `{`, which no spreadsheet reads as a formula, so the neutralisation is now shown on a tag that opens with `-` (`'-synthetic`); and the test's CSV reader split on `","`, which a quoted JSON cell holds, so it now reads RFC 4180 records. `case-file-routes.test.ts` and `case-routes.test.ts` changed with the plan: the export routes and print answer as built (202, 200, 404), where they answered 501.

## Decisions (each in the report's contractDeviations)

- An attachment's scan `error` is served as a plain 409 with no code: C129.7 names no code for it, and `attachment_scan_pending` or `attachment_infected` would say something false.
- An export's selection is decided when it is asked for, in the API process that holds the blind-index key, and sealed as case ids; the job reads them again with the creator's visibility.
- The rendition job leaves a retryable vision failure `pending` (one more attempt counted), because the queues run one attempt; the content route's next request asks again.

## A plumbing test changed with the plan

The first API gate's merge exited 1 on one test, `src/case-file-plumbing.test.ts` "binds a scanner in
the worker whose stub never answers clean": foundation-8b held the bound sandbox scanner's stub to
501. `5c00c91f` changes that assertion alone: the sandbox scanner answers `clean` for bytes without the
EICAR string. The gate was then run again whole, below.

## Gates (each read from its exit code; output to files, never through a pipe)

| Gate | Command | Exit | Time | Load (start, end) |
|---|---|---|---|---|
| install | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | 1 s | 0.41 |
| format | `pnpm format:check` | 0 | 76 s | 0.41 |
| lint and typecheck | `pnpm turbo run lint typecheck --force` (4 GB heap), 32 of 32 | 0 | 4 min 43 s | 1.14, 5.97 |
| db tests | `pnpm turbo run test --force --filter=@openverify/db`: 1,980 tests in 128 files, 93.08% statements | 0 | 1 min 57 s | 5.05, 9.19 |
| API shard 1/4 (blob) | `vitest run --coverage --shard=1/4 --reporter=blob` | 1 (partial coverage) | 3 min 51 s | 5.18, 8.18 |
| API shard 2/4 | same, 2/4 | 1 (partial coverage) | 3 min 44 s | 8.18, 8.97 |
| API shard 3/4 | same, 3/4 | 1 (partial coverage) | 3 min 14 s | 7.99, 8.42 |
| API shard 4/4 | same, 4/4 | 1 (partial coverage) | 3 min 0 s | 8.42, 8.89 |
| API merge | `vitest run --merge-reports --coverage`: 8,129 tests in 567 files, 94.57% statements, 85.53% branches | 0 | 8 s | 8.18 |
| db integration | `pnpm --filter @openverify/db test:integration`: 73 in 16 files | 0 | 77 s | 6.51, 14.40 |
| API integration, graph | `--project graph`: 13 tests, template built in 14.4 s, copied in 1.4 s | 0 | 31 s | 13.33, 8.91 |
| API integration, api 1/3 | `--project api --shard=1/3`: 72 | 0 | 52 s | 8.19 |
| API integration, api 2/3 | 2/3: 91 | 0 | 2 min 26 s | 13.17 |
| API integration, api 3/3 | 3/3: 74 | 0 | 61 s | 5.65 |
| API lint and typecheck, final tree | `pnpm turbo run typecheck lint --force --filter=@openverify/api` | 0 | 2 min 38 s | 11.12 |

The forced whole-repo lint and typecheck ran before `5c00c91f`, a one-assertion test change; the API's
own forced lint and typecheck ran after it. `apps/flow` was not changed, so its mocked suite was not
run. No full-stack e2e was run (the orchestrator's decision for Stage 3).
