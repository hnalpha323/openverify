# TDD evidence: Workflow 7B Stage 3, `api-importers` (Phase 7)

- **Slice owner:** the Workflow 7B Stage 3 `api-importers` agent, beside `api-lists`, `api-biometric-lists`, `api-transactions` and `api-graph`.
- **Date:** 2026-10-31.
- **Base:** `57ac714f` (the end of `foundation-7b`'s checkpoint (L)).
- **Input:** the `api-importers` bullet of `docs/plans/phase-7.plan.md`, C100 except the writer, C107.3, C107.5, and Stage 1b (L) amendments 5, 13, 14 and 18.
- **Owned paths:** `apps/api/src/services/importers/`, `apps/api/src/routes/server/importers.ts`, `apps/api/src/jobs/importers/`, `packages/db/src/repositories/importers.ts`.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every value is synthetic: generated rows, addresses at example.com, the fictional phone range, documentation-range IP addresses.

## 1. What the parser does, measured before the reader was designed

C100.2 names `csv-parse` options, and a `skip-invalid` import has to step over bad rows, which takes `skip_records_with_error`. A probe of 7.0.3 (scratch script, `max_record_size: 40`) showed that this option cannot be trusted with every error, and that `to_line` truncates:

```
mismatch     rows 1,2,4              skipped CSV_RECORD_INCONSISTENT_FIELDS_LENGTH@3
tooLong      rows 1,2                skipped CSV_MAX_RECORD_SIZE@3            rows 4 and 5 are gone, no error
badQuote     rows 1                  skipped CSV_INVALID_CLOSING_QUOTE@2, CSV_QUOTE_NOT_CLOSED@4
                                                                              rows 3 and 4 are gone, swallowed by the quote
quoteMid     rows 1,3                skipped INVALID_OPENING_QUOTE@2
toLineMulti  rows 1                  skipped none                             a multi-line cell cut off with no error
to           rows 1,2,3              skipped none
```

So only `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` and `INVALID_OPENING_QUOTE` are stepped over; any other parser error refuses the whole file in both modes, and the row cap is on records (`to`), not lines. Without this a `skip-invalid` import would apply the rows before a long record and report the file as read.

The same probe showed `TextDecoder` labels the contract's pattern lets through: `csunicode` and `iso-10646-ucs-2` are UTF-16LE, and `shift_jis` and `gbk` are multi-byte, against decision 31. `resolveImportEncoding` decides on the name WHATWG gives a label.

## 2. The repository (stub `775af0f8`, RED `a6d20f06`, GREEN `79ffd1c8`)

RED compiled, type-checked and linted, and failed on the stubs:

```
$ pnpm --filter @openverify/db exec tsc --noEmit -p tsconfig.json              tsc=0
$ (cd packages/db && pnpm exec eslint src/repositories/importers.test.ts)      lint=0
$ pnpm --filter @openverify/db exec vitest run src/repositories/importers.test.ts --coverage.enabled=false
     21 ListRepositoryNotBuiltError: createImporter is not built yet
      1 ListRepositoryNotBuiltError: lockImportFile is not built yet
      1 ListRepositoryNotBuiltError: getImportList is not built yet
      1 ListRepositoryNotBuiltError: completeImporter is not built yet
      Tests  25 failed (25)
```

GREEN:

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/importers.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

`list-plumbing.test.ts` listed `createImporter` and `listImporters` among the stubs that must reject; both left that list, as the plan's build changes what it checks.

## 3. The reader (stub `ed12a4e7`, RED, GREEN `9e6c2a80`)

RED:

```
$ (cd apps/api && pnpm exec vitest run src/services/importers/read-file.test.ts --coverage.enabled=false)
     25 Error: readImportFile is not built yet
      6 Error: decodeImportFile is not built yet
      2 Error: resolveImportEncoding is not built yet
      Tests  54 failed (54)
```

The first GREEN pass failed two tests, both of them expectations of mine:

- Byte `0xAA` in windows-1253: WHATWG leaves it undefined, but the platform's ICU table maps it to `ª`. Measured per encoding, `0xD2` and `0xFF` are the bytes that refuse, so the vector moved to `0xD2`.
- A record of 4,097 bytes passed. The parser checks the size before it appends, so a record gets through at one byte over; the vector moved to two over, with a comment.

```
 Test Files  1 passed (1)
      Tests  54 passed (54)
 read-file.ts |     100 |       92 |     100 |     100 | 74,159
```

## 4. The job, the sweep and the purge (stub, RED, GREEN `539c51c9`)

RED:

```
$ (cd apps/api && pnpm exec vitest run src/jobs/importers src/services/importers/purge.test.ts --coverage.enabled=false)
     16 Error: processListImport is not built yet (api-importers)
 Test Files  3 failed (3)
      Tests  53 failed | 5 passed (58)
```

The 5 that passed hold whichever way the stub answers (`runListImportSweep` stubbed to do nothing leaves an ended import alone, and so on). GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/jobs/importers src/services/importers --coverage.enabled=false)
 Test Files  4 passed (4)
      Tests  112 passed (112)
```

`read-row.test.ts` came after the code, for two branches a real file cannot reach (a kind that gives no key, a normaliser that throws something else), so it holds no RED of its own.

## 5. The routes (RED, GREEN `982a9769`)

RED, against the 501 stubs:

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/importers.test.ts --coverage.enabled=false)
      9 AssertionError: expected 501 to be 201 // Object.is equality
      8 AssertionError: expected 501 to be 400 // Object.is equality
      2 AssertionError: expected 501 to be 500 // Object.is equality
      2 AssertionError: expected 501 to be 422 // Object.is equality
      2 AssertionError: expected 501 to be 413 // Object.is equality
      2 AssertionError: expected 501 to be 404 // Object.is equality
      Tests  56 failed | 6 passed (62)
```

Two findings on the way to GREEN:

- **"Past 24 hours the same file is a new import" failed:** `created_at` came from the database's clock and the window from the injected one. `NewImporter` gained an optional `createdAt`, and the service passes `clock.now()`.
- **A real leak, outside my paths.** A test that a reader without `pii:view` sees no filename failed: `multipartLogValue` stores the part's `filename`, and `MASKED_MEMBERS` (`services/api-logs.ts`) does not name it. Rule 11 refuses that. The file is not mine, so the test left my suite and the exact change is in contractDeviations.

`list-routes.test.ts` lost its importer stubs' 501 expectations, and keeps "no route for faces or backgrounds".

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/importers.test.ts src/routes/list-routes.test.ts --coverage.enabled=false)
 Test Files  2 passed (2)
      Tests  68 passed (68)
```

## 6. Real Postgres (RED `7b99c3eb`, GREEN `37191ff3`)

`jobs/importers/importers.integration.test.ts` found a defect PGlite could not. Its first run hung past a 5-minute call, because `beginImportAttempt` is an `UPDATE`, which waits on the row the first run holds `FOR UPDATE`. The second run was not leaving the row to the first: it was holding a worker slot until the first ended. The test was bounded with a race, which gave the intended failure:

```
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs/importers/importers.integration.test.ts)
- Expected: { "status": "skipped" }
+ Received: "still waiting"
      Tests  1 failed | 4 passed (5)
```

`beginImportAttempt` now selects its row `FOR UPDATE SKIP LOCKED`, so a held row counts no attempt and answers `null`:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

The real `createListItemWriter` landed while this was built, so three tests went through it (the row level of idempotency on the partial unique index, and a full list refusing rows in both modes):

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## 7. Final gates (all in the foreground, exit code read from the command itself)

HEAD for every gate: `05769f58` (nothing has touched my paths since `6eaae7e2`).

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/api typecheck` | rc 0 |
| API unit suite, `--shard=1/4` .. `4/4` as blobs (four shards, because one half did not fit a 10-minute call at load 40), then `vitest run --merge-reports=<dir> --coverage` | merge rc 0: 414 files, 5,691 passed, 0 failed; 96.27 / 88.49 / 97.94 / 96.32. Each lone shard exits 1 on its partial coverage only. The earlier merge's one failure (`jobs/signals/process.test.ts`, api-lists') is gone after `05769f58`. |
| `pnpm --filter @openverify/db test` | rc 0: 95 files, 1,467 tests, 95.64 / 88.65 / 97.02 / 95.87 |
| `pnpm test:integration` | rc 0: db 15 files / 68 tests; api 34 files / 201 tests (importers.integration 8) |
| `pnpm turbo run lint typecheck --force` | rc 0, 30 of 30 (its first run failed on api-transactions' `transactions.ts:228`, fixed by `cea18d7b`) |
| `pnpm format:check` | rc 0 |
| e2e gate | mocked flow 79 passed; full stack shards 32, 34 and 29 passed |
| Android gate | not run: no fixture or SDK-decoded contract changed |

Coverage of my files in the merged run: `services/importers/importers.ts` 98.78 / 90.62, `read-file.ts` 100 / 92, `read-row.ts` 100 / 90, `upload.ts` 100 / 96.55, `jobs/importers/process.ts` 98.27 / 94.73.

## 8. Measurements

The harness (`throughput.measure.ts`, a vitest file run with its own config, never committed) builds a 100,000-row synthetic file, seals it as the route does, writes the importer row and runs `processListImport` on Testcontainers Postgres (pgvector pg17, `POSTGRES_TEST_COMMAND`) through the real `createListItemWriter`, mode `all-or-nothing`. Every value is generated (`person<n>@example.com`, `Jane<n>,Example<n>`, padded strings).

| File | Bytes | Load (1/5/15 min) | Result |
|---|---|---|---|
| email (2026-11-01, under `/tmp/openverify-e2e.lock`) | 3,788,907 | before 17.63 27.74 31.21; at start 16.33 27.12 30.97; after 34.86 33.88 32.95 | round 0: 108.5 s, writer 78.4 s, 922 rows/s; round 1: 169.8 s, writer 89.6 s, 589 rows/s; 100,000 ok, 0 errors each |
| email (2026-10-31) | 3.8 MB | 31 to 38 | 545 and 679 rows/s, writer about 98 and 83 s |
| name (2026-10-31) | 2.0 MB | about 4.8 | 724 rows/s; round 2 hit the harness's 280 s bound |
| string, 198-character values (2026-10-31) | 20 MB | high | 1,124 and 1,306 rows/s |

- Parsing a 20 MB multipart body with `Response.formData()` took 35 to 62 ms.
- A file one byte over 20 MB is refused with `PayloadTooLargeError` (413).
- The writer (api-lists') is 55 to 90% of an import's time; staging and parsing the rest. No low-load figure exists: the machine never fell below load 16 while the other Stage 3 agents ran their suites.

## Report (api-importers)

### Handoff

**How to run** (after `source scripts/env.sh`):
- db: `pnpm --filter @openverify/db exec vitest run src/repositories/importers.test.ts --coverage.enabled=false` (25 tests).
- API: `(cd apps/api && pnpm exec vitest run src/services/importers src/jobs/importers src/routes/server/importers.test.ts --coverage.enabled=false)`.
- Real Postgres: `(cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs/importers/importers.integration.test.ts)` (8 tests, through the real `createListItemWriter`).

**Routes** (`apps/api/src/routes/server/importers.ts`, frozen schemas from `@openverify/contracts`; service `apps/api/src/services/importers/importers.ts`):
- `POST /api/v1/importer/list-item/<plural>` for the eleven `IMPORTER_LIST_KINDS`; scopes `importers:write` and `lists:write`. Body: JSON by `createImporterBodySchema` (base64 `file`), or a buffered multipart form (`parseAs: 'buffer'`) whose parts are `data[attributes][file]` (must be a file part), `data[attributes][list-id]`, `[mode]`, `[encoding]`; any other or repeated part is 400. `IMPORTER_BODY_LIMIT_BYTES` = ceil(20,000,000/3)*4 + 4,096; the decoded file over `IMPORT_LIMITS.fileBytes` (20,000,000) is 413. 201 with the importer (status `pending`). 404 for a list not in the environment; 422 `list_kind_mismatch` (pointer `/data/attributes/list-id`); 409 `list_archived`; 422 `invalid_value` for an encoding that is not UTF-8 or a WHATWG single-byte encoding (pointer `/data/attributes/encoding`); 429 with `Retry-After` beyond the `importers` policy (10 per 3,600 s per environment, `consumeImporterRate(deps, environmentId)`, key `importers:<environment id>`, fails open like C12). Defaults: mode `all-or-nothing`, encoding `utf-8`.
- `GET /api/v1/importers` (`importers:read`): newest first, `filter[list-id]`, `filter[status]`, cursor pages.
- `GET /api/v1/importers/:id` (`importers:read`): 404 outside the environment.
- `GET /api/v1/importers/:id/errors` (`importers:read`): `{ row, column, code }` in row order, whole-file errors (row null) first; `page[after]` is a row number, `page[size]` default 10.

**Upload storage and idempotency.** The file is sealed with `encryptBytes(bytes, keyring, { context: <importer id> })` and put at `newStorageKey(environmentId)`; the row keeps `storage_key` and `wrapped_dek`. Three levels: the request (C107.3 Idempotency-Key, by the existing plugin); the file (`lockImportFile` serialises uploads of one list+mode+encoding+SHA-256, and `findRecentImporter` within `IMPORT_LIMITS.fileIdempotencyHours` = 24 answers the earlier importer with 201 and consumes no rate token; the encoding is part of the key); the row (the writer's partial unique index; a repeat counts as `already-present-count`). An audit entry `importer.created` carries list id, importer type, mode, encoding and byte count only. A failed transaction deletes the object it wrote. Enqueue failure leaves the row `pending` for the sweep.

**The job** (`apps/api/src/jobs/importers/process.ts`, `processListImport(job: ListImportJob, deps: ListImportDeps)`, deps `{ db, clock, logger, storage, keyring, blindIndexKey?, writer: ListItemWriter }`): `beginImportAttempt` (`FOR UPDATE SKIP LOCKED`, counts an attempt; a held row answers `skipped`), decrypt, `readImportFile(bytes, encoding, kind)` (strict decoding, `csv-parse` 7.0.3 with `bom`, `max_record_size` 4,096, `to` = `IMPORT_LIMITS.rows`+1, `skip_records_with_error`), `readImportRow` (list-logic's `importRowItem` and `listKeyInputs`/`listNameKeyInputs`, the match key through `identifierKey`), stage sealed rows in `list_import_rows` (1,000 per batch; a repeat within the file is counted in `duplicate-count`, not staged), apply through `writer.insertItems` in file order inside a savepoint, record errors (cap 1,000), `completeImporter` (deletes the staged rows), audit `importer.completed` (counts and codes only) — all in one transaction under the importer row lock. `all-or-nothing`: any row error or writer refusal rolls back every write and ends `errored`. `skip-invalid`: good rows are applied; `errored` only when the file is refused or nothing applied. Results `ready | errored | skipped`. `IMPORT_MAX_ATTEMPTS` = 10. Ended without a verdict (`last_error_code`): `attempts_exhausted`, `blind_index_key_missing`, `list_archived`, `object_missing`, `object_unreadable`. Retried (`recordImportFailure`, stays pending, throws `ImportRunError(reason)`): `object_unavailable`, `import_failed` (any other error, replaced so no driver message reaches the job record).

**Error codes** (`IMPORT_ERROR_CODES`): file scope `invalid_encoding`, `missing_column`, `unknown_column` (column null), `duplicate_column`, `row_limit_exceeded`; row scope `record_too_large`, `field_count_mismatch`, `invalid_value`, `unparseable_phone`, `host_bits_set`, `out_of_range`, `unsupported_class`. Only `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` and `INVALID_OPENING_QUOTE` are stepped over as row errors; every other parser error (a record too large, an unclosed quote) refuses the whole file in both modes. A writer refusal is a row error with column null.

**Sweep and purge.** `runListImportSweep` (`jobs/importers/sweep.ts`): re-enqueues up to `LIST_IMPORT_SWEEP_LIMIT` (100) pending importers enqueued more than `LIST_IMPORT_REENQUEUE_AFTER_MS` (2 min) ago, every `LIST_SWEEP_INTERVAL_MS`. `purgeExpiredImportObjects({ db, storage }, options)` (`services/importers/purge.ts`, called by the C16 pass): deletes the object, then `markImportObjectDeleted`, for ended importers past `least(list.item_retention_days, 7)` days.

**Repository** (`packages/db/src/repositories/importers.ts`): `createImporter` (`NewImporter.createdAt` optional), `getImportList`, `lockImportFile`, `getImporter` (`StoredImporter` with `kind`), `listImporters`, `findRecentImporter`, `listPendingImporters`, `markImportersEnqueued`, `beginImportAttempt`, `lockPendingImporter`, `recordImportFailure`, `stageImportRows`, `listStagedImportRows`, `recordImportErrors`, `listImporterErrors`, `completeImporter`, `listImportObjectsDue`, `markImportObjectDeleted`; types `ImportList`, `ImporterFilters`, `StagedImportRow`, `StoredImportError`, `ImporterOutcome`.

**Other exports:** `resolveImportEncoding(label)`, `decodeImportFile(bytes, encoding)` (`services/importers/encoding.ts`); `readImportFile`, `ImportFileError`, `ImportFileRow`, `ImportFileReading` (`read-file.ts`); `readImportRow`, `ReadImportRow` (`read-row.ts`); `readImporterUpload`, `ImporterBody`, `ImporterUpload` (`upload.ts`).

**Measured throughput** (100,000 rows, real writer, Testcontainers Postgres): email 922 and 589 rows/s at load 16 to 35 (writer 78 and 90 s of 108 and 170 s), earlier 545 and 679 rows/s at load 31 to 38; name 724 rows/s at load about 4.8; 20 MB string file 1,124 and 1,306 rows/s. A 20 MB multipart body parses in 35 to 62 ms.

### contractDeviations

1. Rule 11 leak outside my paths: `multipartLogValue` (`apps/api/src/services/api-logs.ts:209-215`) stores each part's `filename`, and `MASKED_MEMBERS` (`api-logs.ts:235`) does not name it, so a stored API log read without `pii:view` shows the uploaded file's name. Exact change: add `'filename'` to `MASKED_MEMBERS` (or set `filename` to null in `multipartLogValue` for every part), with a test that a multipart importer upload's stored log shows no filename without `pii:view`. My test of it left my suite because the file is not mine.
2. C100.2's `skip_records_with_error` cannot be trusted with every csv-parse 7.0.3 error: on `CSV_MAX_RECORD_SIZE` the following records vanish with no error, and an unclosed quote swallows the rest of the file. Only `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` and `INVALID_OPENING_QUOTE` are stepped over as row errors; every other parser error refuses the whole file in both modes. The row cap counts records (`to`), not lines (`to_line` cuts a multi-line cell with no error).
3. Decision 31's encodings are decided on the WHATWG name `TextDecoder` gives the label, not on the contract's label pattern: `csunicode` and `iso-10646-ucs-2` (UTF-16LE), `shift_jis` and `gbk` (multi-byte) pass the pattern and are refused with 422 `invalid_value`. A UTF-16 BOM refuses a single-byte decode. The parser checks a record's size before appending, so a record of exactly 4,097 characters passes; the refusal starts at 4,098.
4. The file-level idempotency key includes the encoding (list, mode, encoding, SHA-256 within 24 h), so a file refused as invalid UTF-8 can come back under its real encoding. A repeat answers 201 with the earlier importer and consumes no `importers` token.
5. `NewImporter.createdAt` is optional, and the service passes `clock.now()`, so the 24-hour window and the row's `created_at` read one clock.
6. `beginImportAttempt` selects the row `FOR UPDATE SKIP LOCKED` (`37191ff3`): a second run of one import answers `skipped` at once, counting no attempt, instead of holding a worker slot until the first run ends.
7. Beyond C100: the job's `last_error_code` values `attempts_exhausted`, `blind_index_key_missing`, `list_archived`, `object_missing`, `object_unreadable` (ended `errored` without a verdict) and `object_unavailable`, `import_failed` (retried); `IMPORT_MAX_ATTEMPTS` 10; the sweep's 2-minute re-enqueue age and batch of 100.
8. Existing tests changed with the plan, none weakened: `packages/db/src/repositories/list-plumbing.test.ts` dropped `createImporter` and `listImporters` from its must-reject list, and `apps/api/src/routes/list-routes.test.ts` dropped the importer routes' 501 expectations (it keeps "no route for faces or backgrounds").

### followups

- api-lists (or integration-7b): `apps/api/src/worker.ts:1014` passes `lists: { screens, imports, embeds }` with no `writer`, so line 753 falls back to `unbuiltListItemWriter` and every production import run rejects (and is retried until `attempts_exhausted`). Pass `writer: createListItemWriter({ blindIndexKey })` there. Still unwired at `05769f58`.
- Owner of `services/api-logs.ts` (integration-7b): the filename masking of contractDeviations item 1.
- integration-7b: a full-stack importer spec (upload, the job on the worker, the errors route) once the worker passes the real writer; docs for the importer limits, the encodings refused, the two stepped-over parser errors.
- Phase 11 or the owner: import throughput is about 600 to 900 rows/s under load, mostly the writer (55 to 90% of the time); a 100,000-row import takes 2 to 3 minutes. No low-load figure was possible during Stage 3.

### measurements

- API unit suite at `05769f58`, four blob shards plus merge: 414 files, 5,691 passed, 0 failed; 96.27 / 88.49 / 97.94 / 96.32; merge rc 0 (load 23 to 41).
- db: 95 files, 1,467 tests, 95.64 / 88.65 / 97.02 / 95.87. Integration: db 68 tests, api 201 (importers 8). e2e: mocked 79; full stack 32, 34, 29. Forced turbo lint+typecheck 30/30.
- My tests: db importers 25; API read-file 54, job/sweep/purge/read-row 112 (with the reader), routes 62, integration 8.
- Import throughput, 100,000 rows, real writer: email 922 and 589 rows/s (load 16 to 35, under the e2e lock), 545 and 679 (load 31 to 38); name 724 (load 4.8); string 20 MB 1,124 and 1,306.
- Multipart parse of 20 MB: 35 to 62 ms. One byte over 20 MB: 413.
