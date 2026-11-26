# TDD evidence: Workflow 3B review fixes, TypeScript (Phase 3, government ID checks)

- **Slice owner:** the TypeScript fixer of the Workflow 3B review (Stage 2), in parallel with the Python and Android fixers.
- **Date:** 2026-10-21.
- **Paths owned:** `apps/` (api, dashboard, flow, demo-web), `packages/`, `e2e/`, `contracts/fixtures/` except `contracts/fixtures/vision/`, `docs/plans/phase-3.plan.md`, `docs/api/openapi.json`, `docs/checks/`, `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh` and this file.
- **Input:** the blocking items (K101, G001, G002, G004) and the MEDIUM items (K103, G003, G009, G012, G005, G006, G007, G008) of the Workflow 3B review of `f212cb5..HEAD`.

Each fix follows the same cycle:
1. A stub commit (`chore`) only when a test needs a name that does not exist yet, so the RED commit compiles and type-checks.
2. The regression test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest … " stands for `pnpm exec vitest run <files> --coverage.enabled=false` in the package named; "vitest-int" for `pnpm exec vitest run --config vitest.integration.config.ts <files>` in `apps/api`. Output is trimmed to the lines that matter.

## K101 (HIGH): the API half: a stored ID front is re-embedded as a document

The contract (Workflow 3B review, K101): `POST /v1/embed/face` takes an optional multipart text field `subject`, `selfie` (the default, the largest face on the whole image) or `document` (the largest face whose box centre lies inside the found document quad). The API sends `subject=document` whenever it re-embeds a stored government ID front (`idPortraitOf` for `selfie_id_comparison`, and the C34 inconsistent-repeat candidates), and no subject for a selfie (`id_selfie_comparison`'s newest selfie). Vision ignores an unknown multipart field until the Python half lands, so either order of the two halves works.

Stub (`chore`): `VisionClient.embedFace` takes `subject?: FaceEmbeddingSubject` (`'selfie' | 'document'`), and the fake vision (`jobs/testing.ts`) records it on an `embed-face` call only when one was named.

Tests:
- `src/vision/index.test.ts`: the stub vision server now records the multipart text fields. No subject sends no text field; `document` and `selfie` are sent as a `subject` text field after the image.
- `src/jobs/process-verification.test.ts`: the selfie job's re-embedding of the stored ID front carries `subject: 'document'`.
- `src/jobs/process-government-id.test.ts`: an inconsistent-repeat candidate's front is re-embedded with `document`; the newest selfie (`id_selfie_comparison`) without a subject.
- `src/worker.integration.test.ts`: the stub vision service sees `image` and `subject` on `/v1/embed/face`.

```text
RED   $ vitest (apps/api) src/vision/index.test.ts src/jobs/process-verification.test.ts src/jobs/process-government-id.test.ts
     × names the subject document of a face embedding in a text field after the image (K101)
     × names the subject selfie of a face embedding in a text field after the image (K101)
     × fails the same number with another name, re-embedding the earlier front
     × compares the selfie with the stored ID front re-embedded (C30.4) and completes the inquiry
AssertionError: expected undefined to be 'document' // Object.is equality
-     "subject": "document",
AssertionError: expected [] to deeply equal [ { field: 'subject', …(1) } ]
      Tests  4 failed | 120 passed (124)
RED   $ vitest-int src/worker.integration.test.ts
     × passes both verifications, completes the inquiry and delivers signed webhooks
AssertionError: expected [ { …(2) }, …(3) ] to deep equally contain { path: '/v1/embed/face', …(1) }
      Tests  1 failed | 5 passed (6)
```

GREEN: `createVisionClient`'s `post` appends the given text fields after the images, and `embedFace` passes `{ subject }`; `idPortraitOf` sends `subject: 'document'`; `embedStored` (government-id.ts) sends `document` for a `front` file and no subject for a `selfie-center` file.

```text
GREEN $ vitest (apps/api) src/vision/index.test.ts src/jobs/process-verification.test.ts src/jobs/process-government-id.test.ts
      Tests  124 passed (124)
GREEN $ vitest-int src/worker.integration.test.ts
      Tests  6 passed (6)
```

## G001 (CRITICAL): the API log masker leaves the government ID extraction in clear

`apiLogResource` serves a reader without `pii:view` (for example the built-in Developer role, which has `api-logs:read` and `verifications:read`) the stored query and bodies through `maskPersonalData`. That masker nulled only `fields`, `note`, `ip-address` and `user-agent`, so a stored `GET /verifications/:id`, `?include=verifications` or `GET /events` answer of an unmasked API key gave the C31.5 extraction back in clear, in the whole body and in a truncated value's preview alike. The dashboard's `JsonView` marks what the API masked as "Hidden" from the same member list.

Tests (synthetic values: every `GOVERNMENT_ID_EXTRACTION_ATTRIBUTES` member set to `synthetic-<name>`):
- `apps/api/src/services/api-logs.test.ts`: `maskPersonalData` nulls every extraction attribute of a resource's `attributes`, at any depth (a verification answer, an event's payload, `included`), keeps `extraction-sources` and the other attributes, and leaves the same names alone outside `attributes`; the preview of a truncated events answer holds no extracted value; `apiLogResource` serves a Developer the stored verification and events answers without any, and a reader with `pii:view` the answer whole.
- `apps/dashboard/src/components/integrations/json-view.test.tsx`: a masked extraction attribute in a resource reads "Hidden" (with the explanation), `extraction-sources` stays as sent, and a `null` under the same name outside `attributes` stays `null`.

```text
RED   $ vitest (apps/api) src/services/api-logs.test.ts
     × builds the preview of a truncated answer without the extraction of a government ID (G001)
     × nulls the C31.5 extraction attributes of every resource, at any depth, and keeps their sources (G001)
     × serves a reader without pii:view (the Developer role) the stored extraction masked (G001)
AssertionError: expected '{"data":[{"type":"event","id":"evt_0"…' to contain '"name-last":null'
AssertionError: expected { data: { …(3) } } to deeply equal { data: { …(3) } }
AssertionError: expected '{"data":{"type":"verification/governm…' not to contain 'synthetic-'
      Tests  3 failed | 20 passed (23)
RED   $ vitest (apps/dashboard) src/components/integrations/json-view.test.tsx
     × shows the government ID extraction the API masked in a resource as Hidden, its sources as sent (G001)
TestingLibraryElementError: Unable to find an element with the text: Hidden.
      Tests  1 failed | 8 passed (9)
```

GREEN: `maskPersonalData` (apps/api `services/api-logs.ts`) walks with a flag that says whether the object is a resource's `attributes`; there it also nulls every `GOVERNMENT_ID_EXTRACTION_ATTRIBUTES` member. The truncated preview is cut from the same masked JSON, so it is fixed by the same change. `JsonView` (dashboard) marks the same members maskable inside an `attributes` object.

```text
GREEN $ vitest (apps/api) src/services/api-logs.test.ts
      Tests  23 passed (23)
GREEN $ vitest (apps/dashboard) src/components/integrations/json-view.test.tsx
      Tests  9 passed (9)
```

## G002 (HIGH): a verification processed while its inquiry is redacted writes a fresh extraction and event

`processVerification` analyses the images outside any lock, then writes the checks, the C31.7 extraction and the `verification.*` event in a transaction that never locked the inquiry or read `redacted_at`. A redaction during the analysis found no extraction to clear and no event to stub; the job then inserted an unredacted extraction (sealed fields, blind index, pHash) and an event carrying it. A redaction during the job's write transaction did not wait for it either, so it missed the uncommitted rows. (Postgres happens to lock the inquiry `FOR KEY SHARE` when the transaction writes the verification row twice, as filling an established class does, so the second order was closed only by chance, and not for a card that established no class or country.)

Tests:
- `apps/api/src/jobs/process-government-id.test.ts` (unit, one connection): the fake vision redacts the inquiry (`redactInquiryRecords`) while it analyses. Expected: no extraction row, no event payload with the holder's name, the job fails for good with `PermanentJobError` `inquiry_redacted` and leaves the verification `submitted` without checks; `failVerificationAfterError` (what the worker runs next) then fails it with no checks, no extraction and a `verification.failed` event without extracted values.
- `apps/api/src/jobs/redaction-race.integration.test.ts` (new, Postgres 17): the golden card without its MRZ or class keyword (an extraction, no class or country), under a template that requires `id_blur_detection` only. (1) The redaction starts inside the job's write transaction (from the event publisher's `stage`): it must wait for the job's commit, then redact the extraction and stub the event. (2) A transaction holds the inquiry `FOR UPDATE` and stamps `redacted_at` while the job runs: the job must wait for it, then store nothing and fail with `inquiry_redacted`.

```text
RED   $ vitest (apps/api) src/jobs/process-government-id.test.ts -t G002
     × stores no extraction and publishes none, and the worker then fails the verification without data
AssertionError: expected { …(10) } to be null
      Tests  1 failed | 31 skipped (32)
RED   $ vitest-int src/jobs/redaction-race.integration.test.ts
     × a redaction during the write waits for its commit, then redacts the extraction and the event
     × a job whose write follows a redaction waits for its commit, then writes nothing
AssertionError: expected { …(10) } to match object { fields: null, …(3) }
AssertionError: expected { …(10) } to be null
      Tests  2 failed (2)
```

A probe during development (`pg_stat_activity` while the redaction waited, with the golden card) showed the chance lock: the redaction's `select "redacted_at" from "inquiries" ... for update` waiting on the job's transaction id, which held the inquiry `FOR KEY SHARE` from the foreign-key check of its second `UPDATE verifications`. Hence the unclassified card in the integration test.

GREEN: the write transaction of `processVerification` first locks the inquiry (`lockInquiry`, `FOR UPDATE`, the row the redaction locks first, and the inquiry-then-verification order `submitVerification` uses), then reads `redacted_at` under that lock (`isInquiryRedacted`). A redacted inquiry rolls the transaction back with `PermanentJobError('inquiry_redacted')`; the worker then fails the verification without data (`failVerificationAfterError`), as for a file a redaction deleted (C30.3). A redaction that starts while the job writes waits for its commit and redacts the extraction and the event it finds.

```text
GREEN $ vitest (apps/api) src/jobs/
 Test Files  13 passed (13)
      Tests  187 passed (187)
GREEN $ vitest-int src/jobs/redaction-race.integration.test.ts src/worker.integration.test.ts src/services/locks.integration.test.ts
      Tests  12 passed (12)
```

## G004 (HIGH): an AAMVA IIN is compared with the visual zone's header country code

`fieldsAgree` compared `issuing-authority-code` as an exact string. C31.5 lets that field hold either scheme, an AAMVA IIN (`636014`) from the barcode or an ICAO code from the MRZ or the card's header line (Stage 2 amendment 15). A genuine US licence whose header prints `USA` alone therefore "disagreed" with its own barcode: the required `id_extraction_inconsistency_detection` failed with `extraction_inconsistent` and the advisory `id_barcode_inconsistency_detection` with `barcode_viz_mismatch`. ICAO codes were also compared as text, so the MRZ's `D` disagreed with a printed `DEU`.

Tests (`packages/checks`):
- `src/extraction/agreement.test.ts`: `D` and `DEU` agree as issuer codes, `UTO` and `DEU` do not.
- `src/extraction/consolidate.test.ts`: a barcode IIN and a visual-zone `USA` are not compared: the IIN is kept, read by the barcode alone, and there is no disagreement; `fieldsReadByBoth` does not count the field. ICAO codes compare as countries (`D`/`DEU` agree, `UTO`/`DEU` disagree).
- `src/government-id/id-extraction-inconsistency-detection.test.ts`: the finding's card (the `dl-636014-real-id` barcode on the back, a front with `LN`/`FN`/`DOB`/`EXP`/`DLN` and a `USA` header line) passes; the test first checks that the visual zone did read `USA`.
- `src/government-id/id-barcode-inconsistency-detection.test.ts`: the California licence with a `USA` header passes and does not list `issuing-authority-code` among its compared fields.

```text
RED   $ vitest (packages/checks) src/extraction/agreement.test.ts src/extraction/consolidate.test.ts src/government-id/id-barcode-inconsistency-detection.test.ts src/government-id/id-extraction-inconsistency-detection.test.ts
     × issuing-authority-code: "D" and "DEU" agree: true
     × compares an issuer code only with one of the same scheme: an AAMVA IIN is not an ICAO code (G004)
     × compares ICAO issuer codes as countries: D is DEU, UTO is not (G004)
     × passes a genuine licence that prints USA alone in its header beside its AAMVA barcode (G004)
     × passes a front that prints USA alone in its header: the IIN is not compared with it (G004)
AssertionError: expected false to be true // Object.is equality
AssertionError: expected [ 'issuing-authority-code' ] to deeply equal []
AssertionError: expected { …(8) } to match object { status: 'passed', reasons: [], …(1) }
      Tests  5 failed | 78 passed (83)
```

GREEN: `agreement.ts` gains `fieldsComparable(field, a, b)`: `issuing-authority-code` readings compare only within one scheme (six digits: an AAMVA IIN; one to three letters: an ICAO code). ICAO codes agree through `normalizeCountryCode` (`D` = `DEU`), other codes exactly. `consolidateExtraction` leaves out a reading that is not comparable with the value kept (so it is neither in `readBy`, `agreeing` nor a disagreement, and `fieldsReadByBoth` does not count it), and `id_barcode_inconsistency_detection` skips such a pair.

```text
GREEN $ vitest (packages/checks)
 Test Files  51 passed (51)
      Tests  1089 passed (1089)
```

## K103 (MEDIUM): the CI model cache misses the OCR dictionary; an API fixture shows an old threshold

Confirmed: both the `vision` and `e2e` jobs cache `models/*.onnx` only, while `models/manifest.json` also downloads `ppocrv6_small_rec_inference.yml` (the OCR dictionary), so every run fetched it again. `contracts/fixtures/api/verification-government-id.json` showed `min-front-back-phash-distance` 12, the value the Stage 4 calibration replaced with 13.

Tests:
- `infra/tests/ci-workflow.test.sh`: in each of `vision` and `e2e`, the one `actions/cache` step for `models/` must match every file the manifest downloads (its `path` globs against `models/<filename>` of each entry), and its key must hash `models/manifest.json`.
- `packages/contracts/src/fixtures.test.ts`: every provenance threshold the government ID fixture shows for a key with a default equals `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS`.

```text
RED   $ bash infra/tests/ci-workflow.test.sh
FAIL - vision: the model cache keeps every file of models/manifest.json (not cached: ['models/ppocrv6_small_rec_inference.yml'])
ok   - vision: the model cache key hashes models/manifest.json
FAIL - e2e: the model cache keeps every file of models/manifest.json (not cached: ['models/ppocrv6_small_rec_inference.yml'])
ok   - e2e: the model cache key hashes models/manifest.json
# 123 passed, 2 failed, 0 skipped
RED   $ vitest (packages/contracts) src/fixtures.test.ts
     × verification-government-id.json shows the current default thresholds (K103)
-   "value": 13,
+   "value": 12,
      Tests  1 failed | 83 passed (84)
```

GREEN: both model cache steps keep `models/*.onnx` and `models/*.yml`, under a new key prefix (`models-v2-`) so a cache saved before, without the dictionary, is not restored as a hit; the fixture shows 13. No other test reads that value (`packages/node` and the webhook samples parse the fixture whole and still pass).

```text
GREEN $ bash infra/tests/ci-workflow.test.sh        (actionlint ran)
ok   - vision: the model cache keeps every file of models/manifest.json
ok   - e2e: the model cache keeps every file of models/manifest.json
# 125 passed, 0 failed, 0 skipped
GREEN $ vitest (packages/contracts) src/fixtures.test.ts        Tests  84 passed (84)
      $ vitest (packages/node)                                  Tests  208 passed (208)
      $ vitest (apps/api) src/webhooks                          Tests  287 passed (287)
```

## G003 (MEDIUM): the blind index is the same value in every environment

Confirmed: `identificationNumberIndex` hashed `"<issuer>|<class group>|<number>"` under the one `OPENVERIFY_BLIND_INDEX_KEY`, so the same document number gave the same 64-hex value in a sandbox and a production environment, and in two organizations of one install. Isolation rested on the `environment_id` predicate of the lookups only: anyone reading the table (a backup, a replica) could join people across environments and tenants on `identification_number_index` without the KEK. The fix is local: the index is computed under a per-environment subkey, `HMAC-SHA-256(key, "openverify/blind-index/v1|<environment id>")`, and the worker and `blind-index:rebuild` already have the environment id. Lookups stay within one environment, so they find the same rows; an existing database needs one `blind-index:rebuild` (the rebuild re-indexes every row whose value changed).

Stub (`chore`): `IdentificationNumberIndexInput` and `ExtractionIndexInput` take an optional `environmentId`, ignored.

Tests (`packages/db`):
- `src/blind-index.test.ts`: new HMAC vectors computed with OpenSSL 3.0.13 (the subkey, then the index under it; the commands are in the file's header) for every earlier case, the same document in a second environment, and the other key; equal numbers in two environments differ; `extractionIndexOf` gives the same vectors.
- `src/repositories/government-id-lookups.test.ts`: after `rebuildIdentificationNumberIndexes`, each row has the index of its own environment, and the same holder and class in two environments have different indexes.

```text
$ printf '%s' 'openverify/blind-index/v1|env_01K0000000000000000000SBXA' | openssl dgst -sha256 -mac HMAC -macopt hexkey:000102…1f
… 24781f304bdaf2cd40dce38d90880194d7125b7ab481d472b53ee43f9d740507
$ printf '%s' 'UTO|passport|L898902C3' | openssl dgst -sha256 -mac HMAC -macopt hexkey:24781f30…0507
… eae9d19e5288c05f2a6b491eaa3c95942fb6432856054d4236e5b529920d21fa
RED   $ vitest (packages/db) src/blind-index.test.ts src/repositories/government-id-lookups.test.ts
     × matches the HMAC-SHA-256 vector for the ICAO TD3 example of the test issuer
     × matches the HMAC-SHA-256 vector for the same document in another environment
     × depends on the key
     × separates environments: equal numbers give unrelated indexes (G003)
     × is the C31.8 index of the issuer code, the class group and the number, per environment
     × re-indexes every unredacted extraction of every environment under the new key
AssertionError: expected '3f92f9ea962cb9852512c874097caee2ff7bb…' to be 'eae9d19e5288c05f2a6b491eaa3c95942fb64…'
AssertionError: expected '3f92f9ea962cb9852512c874097caee2ff7bb…' not to be '3f92f9ea962cb9852512c874097caee2ff7bb…'
AssertionError: expected '63cde6a412afa8e2ed30283d985597e6cf51f…' not to be '63cde6a412afa8e2ed30283d985597e6cf51f…'
      Tests  9 failed | 27 passed (36)
```

GREEN: `identificationNumberIndex` computes the subkey `HMAC-SHA-256(key, "openverify/blind-index/v1|<environment id>")`, refuses a blank environment id (`TypeError`), and hashes the C31.8 string under it; `environmentId` is required in both inputs. `extractionIndexOf` passes it through; the worker passes `job.environmentId`; `rebuildIdentificationNumberIndexes` reads each row's `environment_id` and checks the key with the new `assertBlindIndexKey` before reading. The API tests that store an earlier extraction compute its index for their tenant. `docs/checks/government-id.md` says so and names the one rebuild an existing database needs.

```text
GREEN $ vitest (packages/db)
 Test Files  49 passed (49)
      Tests  638 passed (638)
GREEN $ vitest (apps/api) src/jobs src/blind-index-rebuild.test.ts
 Test Files  14 passed (14)
      Tests  194 passed (194)
```

(G003 note: the `TypeError` guard for a blank environment id and its test were added together in the GREEN commit; the RED commit holds the vectors and the environment separation.)

## G009 (MEDIUM): `id_tamper_detection` counts a not-measured error level as measured

Confirmed: vision's `ela_score` is non-nullable and answers `0.0` when the side has no portrait box (the back, or a front without a detected face; `forensics/ela.py`). `tamperComponents` always added `'error-level'`, so a front without a portrait reported error-level as measured: the coverage (the share of components measured on the front) and, through `heuristicConfidence`, the confidence of a passed `id_tamper_detection` were inflated, and `id_entity_detection`'s tamper input with them. The side's `portrait` is exactly the box vision measures ELA around, so it is the input to test.

Test (`packages/checks/src/government-id/heuristics.test.ts`): a front with forensics `ela_score: 0`, `portrait_boundary_score: null` and `portrait: null` has no `error-level` component and a coverage of 0.6 (editing software, double compression, copy-move), in `tamperScore` and in the check's metadata.

```text
RED   $ vitest (packages/checks) src/government-id/heuristics.test.ts
     × does not count error-level as measured on a front without a portrait (G009)
AssertionError: expected { 'editing-software': +0, …(3) } to not have property "error-level"
      Tests  1 failed | 35 passed (36)
```

GREEN: `tamperComponents` takes the side and adds `error-level` only when the side has a portrait; `tamperScore` walks every side with forensics and takes the front's components for the coverage. The score itself cannot change (a missing 0 weighed nothing in the maximum), so the calibration report, which shows the score only, stays as committed.

```text
GREEN $ vitest (packages/checks)
 Test Files  51 passed (51)
      Tests  1090 passed (1090)
```

## G005 (MEDIUM): MRZ issuing state and nationality are never checked against ICAO 9303 Part 3

Confirmed: `parseMrz` only tested `^[A-Z]{1,3}<*$`, so a made-up `ZZZ` (or a two-letter `AB`) with correct check digits was a valid MRZ, and `id_mrz_inconsistency_detection` passed it against an agreeing visual zone. `isIcaoIssuerCode` (ISO alpha-3 and the Part 3 §5 codes, `D` included) existed but only the feature table used it. Utopia (`UTO`) is the specimen state every synthetic card and vector uses; it stays accepted by the parser, and a production environment still fails it through `id_compromised_detection` (`specimen_issuer`, C30.7).

Tests (`packages/checks`):
- `src/mrz.test.ts`: `ZZZ` and `AB` as issuing state, `ZZZ` and `AB` as nationality, are format issues; `UTO`, `D`, `DEU`, `GBR`, `XXA`, `XXX`, `EUE` and `UNO` are accepted in both places with the MRZ still valid. The earlier test of one-letter state codes used `U`, which no state has; it now uses Germany's `D`, the one-letter code Part 3 defines (same intent, a real code).
- `src/id-mrz-inconsistency-detection.test.ts`: a TD3 with `ZZZ` in both places fails with `mrz_issuing_state_invalid` and `mrz_nationality_invalid` although the visual zone agrees.

```text
RED   $ vitest (packages/checks) src/mrz.test.ts src/id-mrz-inconsistency-detection.test.ts
     × reports an invalid issuing state outside ICAO 9303 Part 3
     × reports an invalid two-letter issuing state
     × reports an invalid nationality outside ICAO 9303 Part 3
     × reports an invalid two-letter nationality
     × fails a made-up issuing state and nationality, even when the visual zone agrees (G005)
AssertionError: expected [] to include 'issuing_state_invalid'
AssertionError: expected [] to include 'nationality_invalid'
AssertionError: expected { …(8) } to match object { status: 'failed', reasons: [ …(2) ] }
      Tests  5 failed | 152 passed (157)
```

GREEN: `parseMrz` judges the issuing state and the nationality with `isValidStateCode`: the filler-padded pattern as before, and the code must be `UTO` (`SANDBOX_TEST_ISSUER`) or pass `isIcaoIssuerCode`. Every MRZ vector of `contracts/fixtures/mrz` still parses as expected (all use `UTO` or Part 3 codes such as `XXX`).

```text
GREEN $ vitest (packages/checks)
 Test Files  51 passed (51)
      Tests  1103 passed (1103)
```

## G006 (MEDIUM): MRZ dates accept 29 February of any year

Confirmed: `isValidDate` allowed day 29 in February whatever the two-digit year, so `990229` or `270229` with valid check digits was a valid MRZ date; the extraction then built `1999-02-29`, which `consolidateExtraction` refuses as a calendar date, and the MRZ birth date vanished without a failure. A two-digit year `yy` can be a leap year in some century only when `yy % 4 = 0`; with an unknown year (`<<`, allowed for a birth date) day 29 stays possible.

Tests (`packages/checks`):
- `src/mrz.test.ts`: birth date `990229` and expiry `270229` are format issues; `960229`/`280229` and `000229`/`320229` (check digits recomputed in the test) parse valid, and an unknown birth year with `0229` has no issue.
- `src/id-mrz-inconsistency-detection.test.ts`: the finding's case, a TD3 born `990229` with its own check digit (9) and composite (4) right and a visual zone that agrees on the document number and surname, fails with `mrz_birth_date_invalid` alone.

```text
RED   $ vitest (packages/checks) src/mrz.test.ts src/id-mrz-inconsistency-detection.test.ts
     × reports an invalid birth date 29 February 99
     × reports an invalid expiration date 29 February 27
     × fails an impossible 29 February with valid check digits (G006)
AssertionError: expected 'passed' to be 'failed' // Object.is equality
AssertionError: expected [] to include 'birth_date_invalid'
AssertionError: expected [] to include 'expiration_date_invalid'
      Tests  3 failed | 158 passed (161)
```

(The G005 `overwrite` test helper was rewritten here without spreading a string, which lint refuses; it replaces the same characters.)

GREEN: `isValidDate` reads the year pair and allows 29 February only when the year is unknown or `YY % 4 = 0`. Left as it was: a date that passes this and that the extraction still cannot place (the `00` year read as 1900 or 2100) is a century question, not this finding.

```text
GREEN $ vitest (packages/checks)
 Test Files  51 passed (51)
      Tests  1107 passed (1107)
```

## G012 (MEDIUM): the full-stack happy path reads check rows the C37 layout folds away

Confirmed at HEAD: the inquiry page folds passed checks into a closed `<details>` ("All checks: …" or "Other checks: …", Workflow 3B Stage 1), and `checkRow` in `e2e/tests/support/dashboard.ts` queries a table Playwright then treats as hidden. The fix is the one surfaces-dashboard proved: open each card's disclosure before reading its rows. It changes the spec only; every assertion stays.

```text
RED   $ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/verification-completes.spec.ts'
    Error: expect(locator).toContainText(expected) failed
    Expected substring: "Passed"
    Error: element(s) not found
      - waiting for getByRole('table', { name: 'Government ID checks' }).getByRole('row').filter({ has: getByRole('rowheader', { name: 'id_blur_detection', exact: true }) })
    > 182 |         await expect(checkRow(dashboard, 'Government ID', name)).toContainText('Passed');
  1 failed
    [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed
GREEN $ (same command, after the patch)
  ✓  1 [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (10.9s)
  1 passed (45.8s)
```

## G007 (MEDIUM): name agreement lets any last token be a prefix of the other

Confirmed: `tokensPair` let the last token of either name be a prefix of the other's for every comparison between document sources, so `SMITH`/`SMITHSON`, `DOE`/`DOEBERT` and even `D`/`DOE` agreed, and `id_mrz_inconsistency_detection` passed an MRZ `DOE` beside a printed `DOEBERT` (its `namesMatch` tried `namesAgree` before its own truncation test). C31.2 defines per-token Jaro-Winkler ≥ 0.92 and no prefix rule; the comment tied the escape to a cut MRZ name but nothing checked that the MRZ field was full. ICAO 9303 Part 3 lets a full name field cut components, down to initials, and drop trailing ones, and only the MRZ side.

Stub (`chore`): `NamesAgreeOptions.truncated` and `SourceReading.truncatedFields`, unused.

Tests (`packages/checks`):
- `src/extraction/agreement.test.ts`: `SMITH`/`SMITHSON`, `DOE`/`DOEBERT`, `KIM`/`KIMBERLY`, `LEE`/`LEEDS`, `D`/`DOE` and `ALEXANDRA B`/`Alexandra Beatrix` disagree, and `name-last` `DOE`/`DOEBERT` through `fieldsAgree`; with `truncated` (the first name is an MRZ name whose field was full) a cut name agrees (`ALEXANDRA B`, a cut surname, a dropped trailing name, initials), but not a longer one, another initial, or the cut on the other side. Two earlier expectations encoded the escape (`ALEXANDRA B` agreeing with `Alexandra Beatrix`, `ANNA M` with `ANNA MARIA`); they move to the `truncated` test, the plain comparison now disagreeing.
- `src/extraction/consolidate.test.ts`: an MRZ reading with `truncatedFields` agrees with the full printed names; without them, `DOE`/`DOEBERT` disagree.
- `src/id-mrz-inconsistency-detection.test.ts`: MRZ `DOE` (field not full) with printed `Doebert` fails with `surname_mismatch`.
- `src/government-id/id-extraction-inconsistency-detection.test.ts`: the golden card with the printed surname `VALEMONTSON` fails on `name-last`; a TD1 whose 30-character name field ends in a letter (`VALEMONT<<QUINN<ALEXANDRA<BEAT`) beside the printed `QUINN ALEXANDRA BEATRIX` passes (this one guards the wiring and passes today).

```text
RED   $ vitest (packages/checks) src/extraction/agreement.test.ts src/extraction/consolidate.test.ts src/id-mrz-inconsistency-detection.test.ts src/government-id/id-extraction-inconsistency-detection.test.ts
     × disagrees on "SMITH" and "SMITHSON"
     × disagrees on "DOE" and "DOEBERT"
     × disagrees on "KIM" and "KIMBERLY"
     × disagrees on "LEE" and "LEEDS"
     × disagrees on "D" and "DOE"
     × disagrees on "ALEXANDRA B" and "Alexandra Beatrix"
     × pairs tokens one to one and in order between sources, none cut short
     × lets an MRZ name whose field was full be cut short, down to initials, and nothing else (G007)
     × name-last: "DOE" and "DOEBERT" agree: false
     × compares a name the MRZ may have cut short as a truncation, and only that one (G007)
     × fails a printed surname that only starts like the MRZ one (G007)
       × rejects a printed surname longer than an MRZ surname that did not fill its field (G007)
AssertionError: expected 'passed' to be 'failed' // Object.is equality
AssertionError: expected true to be false // Object.is equality
AssertionError: expected [] to deeply equal [ 'name-last' ]
      Tests  12 failed | 129 passed (141)
```

GREEN: `tokensPair` pairs tokens one to one, each by Jaro-Winkler, with no prefix escape; with `truncated` (the first name is an MRZ name whose field was full) its tokens may also be prefixes of the other's, down to initials, and its trailing tokens may be missing. `fieldsAgree` takes which reading is so cut; `consolidateExtraction` carries `truncatedFields` per reading (also into the C31.3 confirmation), and `extractGovernmentId` sets `name-first` and `name-last` there when the parsed MRZ says `nameTruncated`. `id_mrz_inconsistency_detection` keeps its own truncation test, which now is the only way a prefix agrees.

Two RED expectations were wrong and are corrected in this commit, with the probe that shows why (the RED commit's rule, run from `git show HEAD:…/agreement.ts`):

```text
$ vitest probe: [namesAgree_old('VALEMONT','VALEMONTBERGER'), namesAgree_old('SMITH','SMITHSON'), jaroWinkler('VALEMONT','VALEMONTBERGER'), jaroWinkler('SMITH','SMITHSON')]
+   true, true, 0.9142857142857143, 0.925
```

`SMITH`/`SMITHSON` agree under C31.2 itself (Jaro-Winkler 0.925 ≥ 0.92, not through the prefix rule; the finding's "about 0.90" is not what the C31.2 measure gives), so that pair leaves the "disagrees" list with a comment, and the extraction test uses `VALEMONTBERGER` (0.914, accepted before only by the prefix escape) instead of `VALEMONTSON` (0.945). Tightening Jaro-Winkler itself would change C31.2 and is not this fix.

```text
GREEN $ vitest (packages/checks)
 Test Files  51 passed (51)
      Tests  1117 passed (1117)
GREEN $ vitest (apps/api) src/jobs
 Test Files  13 passed (13)
      Tests  187 passed (187)
```

## G008 (MEDIUM): a holder with a single name always fails `id_extracted_properties_detection`

Confirmed: ICAO 9303 Part 3 writes a single name as the primary identifier with an empty secondary identifier (`SUHARTO<<<<…`). `givenNames` is then empty, `name-first` is never extracted, and the default `required-fields` (C29.5: `name-first`, `name-last`, `birthdate`, `identification-number`, `expiration-date`) fail with `required_fields_missing`. The check is `user_behavior`, so the holder is asked to retake a photo that can never give a first name. The fix keeps the C29.5 default and reads what the document states: a check-digit-valid MRZ whose name field has a primary identifier, no secondary one and room left (not cut, so nothing was lost) says the holder has no first name, unless another source read one.

Tests (`packages/checks/src/government-id/id-extracted-properties-detection.test.ts`): the golden card with the TD1 name line `SUHARTO<<<…` and no visual zone passes with no missing field and `single-name: true`; with a failing MRZ check digit, or a name field filled to its end (`SUHARTOKUSUMOWARDHANIPRAWIRANE`, possibly cut), `name-first` is still missing (these two guard the limits and pass today).

```text
RED   $ vitest (packages/checks) src/government-id/id-extracted-properties-detection.test.ts
       × does not miss a first name a valid MRZ says the holder does not have
AssertionError: expected { …(8) } to match object { status: 'passed', reasons: [], …(1) }
      Tests  1 failed | 6 passed (7)
```

GREEN: `idExtractedPropertiesDetection` excuses a missing `name-first` when it is required, no source read one, and the MRZ states a single name (`checkDigitsValid`, a surname, empty `givenNames`, `nameTruncated` false); the result then carries `single-name: true`. The C29.5 default list is unchanged. `docs/checks/government-id.md` describes this rule, and the G004 and G007 agreement rules under `id_extraction_inconsistency_detection`.

```text
GREEN $ vitest (packages/checks)
 Test Files  51 passed (51)
      Tests  1119 passed (1119)
```

## Final gates

`pnpm lint` first found one error in the K103 test: `data.attributes.checks` is not optional, so `?? []` was an unnecessary condition (`@typescript-eslint/no-unnecessary-condition`). The test now reads the list directly; it still passes (84 tests).

All after `source scripts/env.sh`, at the head of these fixes (the Python fixer's K101 vision half, G010, G011 and K102 already in the tree, so the full-stack run exercised both halves of K101):

```text
$ pnpm typecheck                         Tasks: 12 successful, 12 total
$ pnpm lint                              Tasks: 12 successful, 12 total
$ pnpm test                              Tasks: 12 successful, 12 total (4m51s)
  coverage (statements/branches/functions/lines):
  api 97.54/90.51/98.46/97.6 (108 files)   dashboard 98.43/94.33/98.74/98.45 (174)
  checks 98.7/90.15/99.52/98.62 (51)       db 98.84/92.37/99.41/98.78 (49)
  contracts 100/100/100/100 (41)           flow 98.81/95.63/99.27/98.87 (41)
  node 99.08/94.64/100/99.37               core, config, flow-spec 100; ui 100/97.72/100/100; e2e 96.69/88.07/93.15/97.68
$ pnpm format:check                      All matched files use Prettier code style!
$ pnpm test:integration                  api 12 files, 38 tests passed; db 8 files, 46 tests passed
$ pnpm --filter @openverify/api openapi:write   (twice)   docs/api/openapi.json unchanged both times (no route or schema changed)
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   29 passed (9.0s)
@openverify/e2e:e2e:   ✓  43 [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (9.9s)
@openverify/e2e:e2e:   44 passed (4.0m)
```
