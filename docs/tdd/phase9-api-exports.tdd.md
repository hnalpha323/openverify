# Phase 9, Workflow 9B, Stage 3: `api-exports` (family X)

Evidence for C165.1-C165.5 (saved views, the new list filters, the delivery search) and C166.1-C166.6 (exports, bulk report creation), and the C178.2 Testcontainers case, built on `foundation-9b`'s (X) checkpoint (`cf9f3b14`). Every command was run from the repository root, or from `apps/api` where shown, after `source scripts/env.sh`. Output is abbreviated; the counts and codes are as printed.

## Slices

Each slice was committed as RED (the failing test, run and seen to fail for the intended reason: the stub's 501 or `*_not_built`), then GREEN. A test that needed a name the stubs did not have got a `chore` stub commit first, so every RED commit compiled and type-checked.

### 1. The new list filters (C165.3; B16-B18)

- Stub commit `6297ec3f`: `TransactionListFilterInput.blindIndexKey?` and a refusing `listTransactionFilterValues`.
- RED `ed980783`: `pnpm exec vitest run src/services/list-filters/list-filters.test.ts src/phase9b-exports-plumbing.test.ts --coverage.enabled=false --maxWorkers=2` exited 1: `Tests 13 failed | 31 passed (44)`. Every failure was the stub: `"detail":"filter[list-match] is not built yet (api-exports)."` (and the same for `list-id`, `check`, `next-step-name`, `filter[fields.<key>]`), `Error: listTransactionFilterValues is not built yet (api-exports)`, `expected [ 501, 501, 200 ] to deeply equal [ 400, 400, 200 ]`.
- GREEN `c7263441`: the same command exited 0, `Tests 44 passed (44)`. The test was made lint-clean in the GREEN commit (two type assertions, an unnecessary generic), no assertion changed.

### 2. Saved views (C165.1, C165.2, C165.5; B20)

- RED `bc3c4014`: `pnpm exec vitest run src/services/saved-views src/routes/dashboard/phase9b-saved-view-routes.test.ts ...` exited 1: `Tests 9 failed | 2 passed (11)`, each `"detail":"Saving a view is not built yet (api-exports)."` or `expected [ 501, 501, 501, 501, 401 ] to deeply equal [ 200, 201, 404, 404, 401 ]`.
- GREEN `b2789fb5`: first run `1 failed | 10 passed`: `expected [ 'filter[colour]', 'filter[status]' ] to deeply equal [ 'filter[colour]' ]` (zod reports an unknown key of a strict schema as one `unrecognized_keys` issue with no path, so every key was named); fixed by reading `issue.keys`; then `Tests 11 passed (11)`.

### 3. The webhook delivery search (C165.4; B22)

- RED `41424692`: `Tests 5 failed | 31 passed (36)`: `"detail":"Searching webhook deliveries is not built yet (api-exports)."`, `expected [ 501, 403 ] to deeply equal [ 200, 403 ]`.
- GREEN `d88faa1f`: `Tests 36 passed (36)`, then lint-clean (one unnecessary assertion, fixed by `eslint --fix`).

### 4. Exports (C166.1-C166.4, C166.6, C169.3, C174.3; B19)

- Stub commit `50f17308`: `ExportJobDeps.exportByteLimit?` and a refusing `getExportRow`.
- RED `a066ea5e`: `pnpm exec vitest run src/services/exports/exports.test.ts src/worker-exports.test.ts ...` exited 1: `Tests 15 failed | 4 passed (19)`: `"detail":"Creating an export is not built yet (api-exports)."`, `expected [ 501, 501 ] to deeply equal [ 400, 403 ]`, `PermanentJobError: The job cannot succeed (export_not_built)`; the plumbing file `3 failed | 29 passed` (the frozen 501s).
- GREEN `d06d87c7`: first run `2 failed | 49 passed`: `SyntaxError: Expected ':' after property name in JSON` (the test's own CSV split did not undo doubled quotes); the test now reads the file with `readCsv`; then `Tests 51 passed (51)` across the three files.

### 5. Bulk report creation (C166.5, C166.6; B21)

- RED `4c90d869`: `Tests 10 failed | 34 passed (44)`: `"detail":"Creating reports in bulk is not built yet (api-exports)."`, `expected [ 501, 501 ] to deeply equal [ 422, 404 ]`, `PermanentJobError ... (report_bulk_not_built)`.
- GREEN `b3a881f1`: first run `2 failed | 42 passed`: rows recorded failed, because `seedReportTemplate`'s empty config is no valid watchlist config (`ZodError ... "search-lists" expected array` inside `resolveReportTemplateConfig`); the test now seeds `reportConfigDefaultValues(type)` as `actions-objects.test.ts` does; then `Tests 58 passed (58)` across the export, bulk, worker and plumbing files.

### 6. C178.2: the exports job on Postgres

- `ffbdc4bf` (`src/services/exports/exports.integration.test.ts`), written after the job: `pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/exports/exports.integration.test.ts` exited 0, `Tests 2 passed (2)`, at a load of 3.60.
- It discriminates: with the masking removed in `rows.ts` (`redacted ? REDACTED : (value ?? null)`), the same command exited 1 (`AssertionError: expected 'synthetic-integration-ref' to be ''`); the mutation was reverted (`git diff` empty).

## Existing tests changed by the plan

The stub tests `foundation-9b` handed over, each now reading the feature built: `phase9b-exports-plumbing.test.ts` (the inquiry filters answer 200; a field filter on no filterable field 400; the delivery search 200; `POST /exports` 202, `[403, 403, 202]`; the list 200 and an unknown export 404 twice; an unknown bulk template 422 and an unknown job 404; the stored-log test's upload now 422), `routes/dashboard/phase9b-saved-view-routes.test.ts` (`[200, 201, 404, 404, 401]`) and `worker-exports.test.ts` (the export and report-bulk jobs resolve on an unknown row, the sweep answers zero counts and logs no "not built").

## Measurements

- CSV assembly at the row cap (the job's write path, page by page as the job writes it): 50,000 synthetic inquiry rows of the 16 documented columns, a 21,178,004-byte file; RSS 212.3 MiB before, 269.4 MiB at its peak (+57 MiB); heap 48.5 to 101.2 MiB; 544 ms of CPU; load 2.62 before, 2.57 after (under the e2e lock, one step). The database reads (one page of 100 at a time) are not in it.

## Final gates

Each call's exit code was read from the command itself, never from a summary; heavy calls went through `bash /tmp/openverify-heavy.sh`.

| Call | Exit | Result (load average) |
|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | |
| `pnpm exec prettier --check --ignore-path=.gitignore <my files>` | 0 | all matched files formatted |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --filter=@openverify/db --concurrency=1` | 0 | 2 tasks, 104 s (2.06 to 2.72) |
| the same for `--filter=@openverify/api` | 0 | 2 tasks, 268 s (2.58 to 1.78) |
| `pnpm turbo run test --force --filter=@openverify/db` | 0 | 149 files, 2,161 tests, 91.23% statements, 150 s (1.64 to 9.70) |
| API unit, 6 blob shards `--maxWorkers=3` | 1 each (partial coverage, as expected) | 283, 322, 343, 300, 387, 321 s (5.7 to 10.1) |
| API unit merge `--merge-reports --coverage` | **1** | 678 files, 9,287 tests: 7 failed, 9,280 passed; 92.97% statements. The 7 failures are in `api-cases-reports`' paths, none in mine: `services/cases/layout/named-problems.test.ts` (4; its RED `545530ac`, passing again when re-run alone 30 minutes later) and `services/attributes/crypto-wallet.test.ts` (3: the exact verification attributes now hold `redacted-at`, from `dc29d06a`, C173.2), still failing after about 30 minutes of polling. Reported as failed by those tests and their owner. |
| `pnpm --filter @openverify/db test:integration` | 0 | 17 files, 78 tests, 161 s (13.8 to 33.8) |
| `vitest run --config vitest.integration.config.ts --project graph` | 0 | 13 tests, template built in 36.3 s of its 180 s guard, 64 s (32.0 to 20.6) |
| `--project api --shard=1/3` | 0 | 89 tests, 175 s (20.1 to 33.2) |
| `--project api --shard=2/3` | 0 | 99 tests, 256 s (33.0 to 17.5) |
| `--project api --shard=3/3` | 1, then 0 | first run at a load of 18.9 to 31.1: 8 failures in `services/otp/limits.integration.test.ts` (the Valkey send limits, not my paths, unchanged since 9A); re-run: 79 tests passed, 104 s (25.7 to 24.9) |

No file rule 16 names was changed, so the watchlist benchmark's checks were not due; `apps/flow` was not changed, so the mocked flow suite was not due.
