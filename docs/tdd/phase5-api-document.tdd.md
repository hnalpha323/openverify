# Phase 5, Workflow 5B Stage 3: `api-document` (TDD evidence)

Owner: `api-document`.

**Paths:**
- `apps/api/src/jobs/types/document.ts`
- `apps/api/src/services/{guidance,attributes,submit,sub-resources}/document.ts`
- `apps/api/src/routes/dashboard/files.ts`
- `packages/db/src/repositories/document-extractions.ts`
- tests beside them, plus `apps/api/src/jobs/{process-document,document-contract}.test.ts` and `apps/api/src/jobs/document-race.integration.test.ts`

**Contracts:** C60 (the document job over vision's `/v1/analyze/document` and `checks-5b`'s evaluators, with the cascade), C53.3 (`document_extractions`), C54.1 (the preview through `storeServerFile` on every run; the guidance, attribute, submit and cancel hooks), C52.2, C52.4, C52.6, C52.8, C53.6, C53.7, C66 (the console file route's PDF attachment and per-kind checks).

Every command ran after `source scripts/env.sh`, from the directory shown. Output is abbreviated with `…`. `api-kyb` and `api-nfc` were editing the same tree at the same time, so package-wide runs below name the failures that were theirs (`providers/business-registry/sec-edgar.test.ts`, `services/attributes/government-id-nfc-exits.test.ts`, the typecheck errors in `services/chip-challenges/rules.test.ts`).

## 1. The extraction write (`packages/db`)

**Stub:** `f078d467 chore(db): stub the document extraction write …`. `putDocumentExtraction(db, environmentId, input)` and `DocumentExtractionInput`; the stub rejects with `not implemented (3 arguments)`. `tsc --noEmit`, `eslint` and `prettier --check` were clean.

**RED:** `2172e21c test(db): …`, `src/repositories/document-extractions.test.ts` on PGlite: the class, confidence, pages and media type in the clear and the values sealed to the row (no printed value in the raw row); `unknown` with a `null` confidence; a re-run replaces the values and keeps `created_at`; another environment refused before and after a row exists; a redacted row never written again; a value that is not text refused with `RangeError`, nothing written.

```
$ cd packages/db && pnpm exec vitest run src/repositories/document-extractions.test.ts --coverage.enabled=false
 FAIL  src/repositories/document-extractions.test.ts > putDocumentExtraction (C53.3) > writes the class, confidence, pages and media type, and seals the values to the row
Error: not implemented (3 arguments)
 …
 FAIL  … > refuses a value that is an object, writing nothing
AssertionError: expected Error: not implemented (3 arguments) to be an instance of RangeError
 Test Files  1 failed (1)
      Tests  7 failed (7)
```

**GREEN:** `c635dc35 feat(db): …`. An upsert on `verification_id` that seals `fields` with `sealJson('document_extractions.fields', <verification id>)`, updates only while `environment_id` matches and `redacted_at is null`, and throws `… in another environment or redacted` when no row comes back; a member that is neither a string nor `null` throws first.

```
$ cd packages/db && pnpm exec vitest run src/repositories/document-extractions.test.ts src/repositories/phase5b-repositories.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  19 passed (19)
```

## 2. The attribute hook (`services/attributes/document.ts`)

The hook file existed as Stage 1b's `unbuiltAttributeHook()`, so the tests compiled against it.

**RED:** `04a898fe test(api): …`.
- `services/attributes/document.test.ts` (PGlite, the hook itself): the upload's media type alone before the job ran; nothing without an upload or an extraction; the extraction with every C52.8 member; only what the contract takes (an unknown member left out, an invalid date and a three-letter country `null`); `fields: null` after redaction with the class, confidence, pages and media type kept; `mask` member-wise without `pii:view`.
- `services/attributes/document-exits.test.ts`, in the pattern of `database-exits.test.ts`: `GET /verifications/:id`, `?include=verifications`, the `verification.*` payload and the Events API, a stored API log body, the redacted inquiry, and the dashboard inquiry document. Values are searched as JSON strings of their own.

```
$ cd apps/api && pnpm exec vitest run src/services/attributes/document.test.ts src/services/attributes/document-exits.test.ts --coverage.enabled=false
 FAIL  src/services/attributes/document-exits.test.ts > the server API exits of a document verification (C52.8, C53.7) > GET /verifications/:id: unmasked for a key and with pii:view, masked without it
AssertionError: expected {} to deeply equal { …(5) }
 …
 FAIL  src/services/attributes/document.test.ts > documentAttributes.load (C52.8) > serves the uploaded media type alone before the job read the document
AssertionError: expected {} to deeply equal { 'document-type': null, …(4) }
 Test Files  2 failed (2)
      Tests  11 failed | 2 passed (13)
```
The two that passed are the `mask` cases, which the stub's `mask.attributes` already met.

**GREEN:** `5d677f06 feat(api): …`. `load` reads `getDocumentExtraction` and `openDocumentExtractionFields`; `mime-type` is the extraction's, else the latest `document` upload's; `servedDocumentFields(stored)` parses each member with `documentFieldsSchema.shape`.

One RED expectation was a test defect, corrected in the GREEN commit: the case "an invalid value null" seeded `typeConfidence: null`, which `seedDocumentExtraction` turns into its 0.82 default; the case now seeds and expects 0.31. The hook was not changed for it.

```
$ cd apps/api && pnpm exec vitest run src/services/attributes/document.test.ts src/services/attributes/document-exits.test.ts src/services/attributes/index.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

## 3. The guidance hook (`services/guidance/document.ts`)

**RED:** `e92e68ed test(api): …`, `services/guidance/document.test.ts`: the step's classes, 90 days by default, 50 pages and every media type; the configured `max-age-days` (365); the default for a missing type or a refused value (0); images alone for a camera-only step; `null` without a document step. Each answer parses with `documentGuidanceSchema`.

```
$ cd apps/api && pnpm exec vitest run src/services/guidance/document.test.ts --coverage.enabled=false
 FAIL  … > names the accepted classes, the 90-day default window, the page limit and every media type
AssertionError: expected { guidance: null } to deeply equal { guidance: { …(4) } }
 …
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

**GREEN:** `660c2c48 feat(api): …`. `documentRecencyWindow(config)` parses the check's config with `documentRecencyDetectionConfigSchema`, else `phase5ConfigDefaults('document_recency_detection')`; `max-pages` is `MAX_DOCUMENT_PAGES`; the media types are `DOCUMENT_MIME_TYPES` with `upload`, else `ACCEPTED_IMAGE_MIME_TYPES`.

```
$ cd apps/api && pnpm exec vitest run src/services/guidance/ --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  18 passed (18)
```

## 4. The document job (`jobs/types/document.ts`)

The job file existed as Stage 1b's `unbuiltTypeJob('document')` (`runnable: false`), so the tests compiled against it and failed on its refusal.

**RED:** `c0636276 test(api): …`.
- `jobs/process-document.test.ts` (PGlite, the fake vision of `jobs/testing.ts` with the golden C60.1 answers), through `processVerification`:
  - the decrypted PDF sent to vision as `application/pdf`, then page 1 rendered; a recent bill in the applicant's name passes and completes the inquiry; the extraction (class, confidence, pages, media type, every field) and one `document-preview` PNG stored; the OCR models pinned in the type check's provenance;
  - `verification.passed` carries the extraction in its payload;
  - the golden bill with its covered line fails the advisory fabrication check (`pdf_hidden_text`, components in metadata) and still passes;
  - a photo sent as `image/jpeg`, its preview rendered too;
  - a class outside the step's fails `document_type_not_accepted` and nothing else;
  - vision's 413, 422 `too_many_pages`, `pdf_encrypted`, `pdf_unprocessable` or no code, and 415 fail the type check with its user-behaviour reason, store nothing, and leave the inquiry pending for a retry;
  - a 503 `guarded_worker_failed` or an outage rethrown for a retry, nothing written; on the last attempt `execution_error` and review, logged with ids, status and code; a contract-breaking answer recorded at once;
  - a render outage rethrown while attempts remain, then the decision without a preview on the last attempt; a render that cannot succeed leaves no preview;
  - an earlier preview replaced and its object deleted after the commit;
  - the references: the latest passed or reviewed government ID's extraction when the inquiry has no fields, never a failed one, the account's fields last, another person's name failing `document_name_mismatch`;
  - a missing object or a digest mismatch fails for good before any vision call;
  - no upload: every check `not_applicable`, review;
  - no printed value in any log entry or check;
  - `failVerificationAfterError` writes no extraction or preview.
- `jobs/document-race.integration.test.ts` (Testcontainers, `pgvector/pgvector:pg17`), in the pattern of `redaction-race.integration.test.ts`: a redaction started inside the decision transaction waits, then redacts the extraction and lists the preview among the files to delete; a job behind a redaction waits, then writes nothing (`inquiry_redacted`); two runs of the job at once leave one extraction and one preview.

```
$ cd apps/api && pnpm exec vitest run src/jobs/process-document.test.ts --coverage.enabled=false
 FAIL  src/jobs/process-document.test.ts > the document job (C54.1) > is built and runnable
AssertionError: expected { type: 'document', …(4) } to match object { type: 'document', runnable: true }
 FAIL  … > sends the decrypted PDF to vision, passes a recent bill in the applicant’s name, stores the extraction and a preview, and completes the inquiry
PermanentJobError: The job cannot succeed (unsupported_verification)
 …
 FAIL  … > rethrows a guarded worker failure for a retry while attempts remain, writing nothing
AssertionError: expected PermanentJobError: The job cannot succeed… { reason: '…' } to be VisionServiceError: Vision service answer… { …(4) } // Object.is equality
 …
 Test Files  1 failed (1)
      Tests  27 failed | 1 passed (28)

$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs/document-race.integration.test.ts
     × a redaction during the write waits for its commit, then redacts the extraction and takes the preview 55ms
     × a job whose write follows a redaction waits for its commit, then writes nothing 51ms
     × one decides; the other finds it decided and writes nothing: one extraction, one preview 31ms
PermanentJobError: The job cannot succeed (unsupported_verification)
AssertionError: expected false to be true // Object.is equality      (the job refused at once instead of waiting)
 Test Files  1 failed (1)
      Tests  3 failed (3)
```
The one unit case that passed is `failVerificationAfterError`, whose stub hook already wrote nothing.

**Pin:** `ca1d0e15 test(api): pin …`, `jobs/document-contract.test.ts`, the hook `checks-5b` asked for: `DOCUMENT_EVALUATOR_REASONS` equals contracts `DOCUMENT_CHECK_REASONS`; every result over the golden analyses, each refusal, a failure and no file, with and without references, parses as C29, gives only listed reasons and holds no printed value; every vision refusal (413, 415, 422 with each `DOCUMENT_PROBLEM_CODES` code or none) fails the type check with a frozen user-behaviour reason. It ties two vocabularies that already agreed, so it passed on its first run (3 tests).

**GREEN:** `be4d264f feat(api): …`. `documentJob` is runnable:
- `evaluate` decrypts the latest `document` upload (`file_missing`, `file_undecryptable`, `file_integrity`, `file_type`), calls `analyzeDocument`, maps 413, 415 and 422 through `documentVisionRefusalOf`, rethrows a retryable failure while attempts remain and records `{ kind: 'error' }` otherwise; after an analysis it renders page 1 under the same rule, keeping no preview when it cannot; it wipes the decrypted bytes; it reads the references (inquiry fields, the latest passed or `needs_review` government ID extraction, the account's fields) only when a comparison check is enabled, pins the OCR models with `MODEL_DIGESTS`, and calls `evaluateDocument`.
- `persistInDecisionTx` writes `putDocumentExtraction` (the fields through `servedDocumentFields`), then `storeServerFile(…, 'document-preview')`, then the verification event; `afterCommit` deletes the replaced objects (`deleteObjects`) and logs a count on failure; `onProcessingFailed` stages nothing.

Two existing tests used `document` as the type the server does not run yet; the plan now runs it, so each file mocks the document job back to `unbuiltTypeJob('document')` (file-level `vi.mock`, test bodies unchanged): `jobs/process-verification.test.ts` ("fails permanently, touching nothing, on a type the worker does not run yet") and `routes/flow/verifications.test.ts` ("answers 422 for a type whose step the server does not run yet").

```
$ cd apps/api && pnpm exec vitest run src/jobs/process-document.test.ts src/jobs/document-contract.test.ts src/jobs/process-verification.test.ts src/routes/flow/verifications.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  141 passed (141)

$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs/document-race.integration.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ cd apps/api && pnpm exec vitest run --coverage.enabled=false
 FAIL  src/providers/business-registry/sec-edgar.test.ts > the SEC EDGAR register (C61.1) > finds a business entered without a CIK among the listed companies, by the closest name   (api-kyb's, in progress)
 Test Files  1 failed | 221 passed (222)
      Tests  1 failed | 3590 passed (3591)
```

**Pins on built code:** `6e25d564 test(api): pin …` adds tampered ciphertext (`file_undecryptable`), content that is no document (`file_type`) and a replaced preview whose object cannot be deleted (the decision stands, `{ verificationId, failed: 1 }` logged), found uncovered by a coverage run; they passed on their first run. **Refactor:** `669ee099`: an inquiry's account always has fields, so the reference reader takes a record (`account?.fields ?? {}`), suite green.

## 5. The submit guard and the cancel hook

Stage 1b's `standardSubmitGuard()` and `noSubResources()` already did what C52.6 and C54.1 ask of a document (no other type's member, the `document` file stored; no sub-resource), so these are pins on built code, written once the type could be created.

**Pin:** `290f433f test(api): pin …`, `services/submit/document.test.ts` through the flow API: created (201) with its guidance; submit before the upload is a 422 naming `document`; a PDF and a photo stored as `application/pdf` and `image/jpeg`; 202 and an enqueue, a repeat enqueuing again; `document-preview` refused (422) and plain text refused (415); a `capture` or `crypto` member refused (422 "A document verification takes no …"); `documentSubResources` stages nothing and deletes no object.

```
$ cd apps/api && pnpm exec vitest run src/services/submit/document.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Refactor:** `e68ee403`: the two files' headers say what they do now (comment only); `services/submit` and `services/sub-resources` 18 passed.

## 6. The console file route (`routes/dashboard/files.ts`)

**RED:** `5d9e60fb test(api): …`, `routes/dashboard/files.test.ts`: a document's PDF served with `content-type: application/pdf` and `content-disposition: attachment; filename="document-<file id>.pdf"`, `nosniff`, no-store, and audited; a document photo and the preview PNG inline; the chip portrait inline; a preview or chip portrait that is not a PNG, an ID photo that is a PDF, a document whose record names another type, and a document that is neither image nor PDF refused with an opaque 500 and no audit entry; a raw chip file (`chip-dg1`) answered 404 with no audit entry.

```
$ cd apps/api && pnpm exec vitest run src/routes/dashboard/files.test.ts --coverage.enabled=false
 FAIL  … > serves a document’s PDF as an attachment named by the server, uncached, and audits the view
AssertionError: expected 500 to be 200 // Object.is equality
 FAIL  … > refuses a preview that is not a PNG with an opaque 500 and audits nothing
 FAIL  … > refuses a chip portrait that is not a PNG with an opaque 500 and audits nothing
AssertionError: expected 200 to be 500 // Object.is equality
 FAIL  … > serves no raw chip file: 404, and no audit entry
AssertionError: expected 500 to be 404 // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
```

**GREEN:** `d34f5c10 feat(api): …`. `openFile` sniffs with `detectUploadMimeType(file.kind, bytes)` and requires it to equal the record's `mime-type` and be a served type; the raw chip kinds (`government_id_nfc`'s kinds but `chip-portrait`) answer 404 before the object is read; a PDF gets `content-disposition: attachment; filename="<kind>-<file id>.pdf"`. The route's frozen schema and description are unchanged (`openapi.test.ts` passes).

```
$ cd apps/api && pnpm exec vitest run src/routes/dashboard/files.test.ts src/routes/dashboard/inquiries-files.test.ts src/routes/dashboard/index.test.ts src/openapi.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  69 passed (69)
```

## 7. The job against the real vision analysis (no commit)

A scratch run (outside the repository) sent eight generated proof-of-address fixtures to vision's app in process with the real PP-OCRv6 models, then judged each answer with `evaluateDocument` as the job calls it (the sidecar's `inquiry_fields` as the inquiry reference, `read_on` as today):

| Fixture | Vision | Decision | Against the sidecar |
|---|---|---|---|
| `en/utility-bill/happy.pdf` | 200, preview 200 PNG | passed | matches |
| `en/utility-bill/happy-photo.jpg` | 200, preview 200 PNG | passed | matches |
| `en/utility-bill/edited-covered-amount.pdf` | 200 | passed (advisory fabrication failed, `pdf_hidden_text` among its reasons) | matches (the sidecar names the reasons a failure must include) |
| `en/utility-bill/too-old.pdf` | 200 | failed (`document_too_old`) | matches |
| `en/utility-bill/password-protected.pdf` | 422 `pdf_encrypted`, render 422 | failed (`document_password_protected`) | matches |
| `en/bank-statement/happy.pdf` | 200 | passed | matches |
| `es/utility-bill/happy.pdf` | 200 | passed | the advisory address check fails `address_mismatch`: the reference `Calle del Puerto 27, 2B` reads `2B` as the house number |
| `en/lease/happy.pdf` | 200 | needs_review | the addressee block takes the landlord's address, the issuer is the title line, and the term sentence is not read, so recency is `input_missing` and expiry `periodic-tenancy` |

The two disagreements are in the evaluators (`checks-5b`, `checks-matching`), not in the job; they are follow-ups for `integration-5b`.

## 8. Final gates (foreground)

```
$ pnpm typecheck
 Tasks:    13 successful, 13 total                (35.6 s)
$ pnpm lint
 Tasks:    13 successful, 13 total                (1 min 16 s)
$ pnpm format:check
All matched files use Prettier code style!

$ pnpm --filter @openverify/api test
 Test Files  239 passed (239)
      Tests  3694 passed (3694)
All files          |   97.11 |    89.56 |   98.66 |   97.12 |      (5 min 53 s)
$ pnpm --filter @openverify/db test
 Test Files  66 passed (66)
      Tests  844 passed (844)
All files          |   98.72 |    92.24 |   99.46 |   98.66 |      (1 min 40 s)

$ pnpm test:integration
@openverify/api:test:integration:  Test Files  21 passed (21)
@openverify/api:test:integration:       Tests  105 passed (105)
@openverify/db:test:integration:  Test Files  11 passed (11)
@openverify/db:test:integration:       Tests  57 passed (57)
 Tasks:    2 successful, 2 total                  (1 min 42 s)
```

This area's sources: `jobs/types/document.ts` 100% lines and 90% branches; `routes/dashboard/files.ts` 100% lines; the attribute, guidance, submit and cancel hooks 90-100% lines (one unreachable `throw` in `services/guidance/document.ts`, a missing provisional default).

**End to end.** A full `pnpm e2e` takes longer than one 10-minute foreground call, so the e2e lock was held by one background `flock /tmp/openverify-e2e.lock` holder for the whole run, and the parts ran in the foreground under it, as `fixtures-5b` did:

```
$ pnpm turbo run build --filter=@openverify/e2e^...
 Tasks:    5 successful, 5 total
$ pnpm --filter @openverify/flow e2e
  68 passed (19.0s)
$ pnpm --filter @openverify/e2e exec playwright test --shard=1/2
  31 passed (2.4m)
$ pnpm --filter @openverify/e2e exec playwright test --shard=2/2
  29 passed (6.4m)
```
The full-stack suite has no document spec yet (`document-poa.spec.ts` is `integration-5b`'s); these runs show the runnable document type broke none of the 60.
