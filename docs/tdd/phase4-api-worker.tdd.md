# Phase 4, Workflow 4A Stage 3: `api-worker` TDD evidence

Area: the selfie job v2 (C40.9, C43), face templates and the background index (C42), the A-tier
selfie ports and sandbox providers (C44), `stateOf`'s capture-cap count, template retention,
`face-index:rebuild`, and the race tests for the worker's writers.

Every cycle below records the commands actually run and their abbreviated output: a stub commit
where a test needed a name that did not exist yet, the RED run (the test compiles and fails for
the intended reason), the GREEN run, and any refactor on a green suite. Unit tests run with
`pnpm --filter @openverify/api exec vitest run <files> --coverage.enabled=false` (PGlite, no
Docker); race tests run on Postgres 17 through Testcontainers (`pnpm --filter @openverify/api
test:integration`). Every embedding, landmark set and background layout in these tests is
synthetic (seeded vectors and the golden vision fixtures).

## Cycle 1: the C44 selfie ports and sandbox providers

### Stub (`chore(api)`)

`ports.ts` gains the sandbox port types (`SandboxSelfieAgeEstimateProvider`,
`SandboxSelfiePublicFigureProvider`, `SandboxSuspiciousEntityProvider`, each `sandbox: true` with
the `SandboxSelfieContext` second argument), real adapters become `sandbox: false` with one
argument, and `ProviderBindings` holds `BoundProviders` (government ID and selfie ports).
`providers/index.ts` names `PROVIDER_KINDS` and the three `OPENVERIFY_PROVIDER_*` prefixes;
`providers/sandbox.ts` names `SANDBOX_SELFIE_MAGIC` and the three factories, whose methods reject.

```
$ pnpm exec tsc --noEmit -p . && pnpm exec eslint src/providers src/ports.ts
(no output)
```

### RED (`test(api)`)

Tests: `providers/index.test.ts` (the six prefixes and `PROVIDER_KINDS`; the selfie variables
read for sandbox environments; each `_PRODUCTION` selfie variable refused; the selfie sandbox
providers bound and labelled), `providers/sandbox.test.ts` (every C44 magic value: the whole
`sandbox-public-figure` token, upper case, inside a longer word or continued by a hyphen; the
`sandbox-age-(\d{1,3})` regex with 0, 17, 150, 151 and four digits; the precedence public figure,
then suspicious entity, then age; the birthdate's age otherwise and 30 without one; no image is
looked at), `config.test.ts` (the provider expectations: every kind unbound by default; the
selfie sandbox bindings; a negative test per `_PRODUCTION` variable).

```
$ pnpm exec vitest run src/providers src/config.test.ts --coverage.enabled=false
 FAIL  src/config.test.ts > ... > refuses to start with the sandbox provider bound to production (OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_PRODUCTION)
 FAIL  src/providers/index.test.ts > readProviderSettings (C35) > reads the C44 selfie bindings for sandbox environments
 FAIL  src/providers/sandbox.test.ts > the sandbox selfie age-estimate provider (C44) > answers the magic age of sandbox-age-17
 ...
      3 AssertionError: expected [] to deeply equal [ Array(1) ]          (no issue for a _PRODUCTION selfie variable)
      1 AssertionError: expected { aamva: null, …(2) } to deeply equal { aamva: null, …(5) }
      1 Error: expected loadConfig to throw a ConfigError
      8 Error: the selfie sandbox providers are not built yet
 Test Files  3 failed (3)
      Tests  38 failed | 77 passed (115)
```

### GREEN (`feat(api)`)

`readProviderSettings` reads every `PROVIDER_KINDS` variable, `NO_PROVIDERS` lists all six kinds,
and `createProviderBindings` binds the three selfie sandbox providers (a selfie kind left out of a
hand-written settings object stays unbound). The selfie sandbox providers lower-case the
reference id and apply `SANDBOX_SELFIE_MAGIC` by precedence. `.env.example` and the compose
`x-api-environment` gain the six `OPENVERIFY_PROVIDER_SELFIE_*`/`_SUSPICIOUS_ENTITY_*` variables.
One existing expectation (`reads every sandbox binding, case-insensitively, ...`) listed the
settings object with the three government ID kinds; it now spreads `NO_PROVIDERS` for the others.

```
$ pnpm exec vitest run src/providers src/config.test.ts src/worker.test.ts src/jobs/process-government-id.test.ts --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  172 passed (172)
$ bash infra/tests/compose.test.sh | tail -1
# 191 passed, 0 failed
```

## Cycle 2: `stateOf` counts a capture-cap cancel as a failed attempt (C40.2)

### RED (`test(api)`)

`inquiry-outcome.test.ts`: a `canceled` selfie (the 11th capture create cancels its verification
while the inquiry stays pending) is a retryable failed attempt; three such attempts, or two
failures and a cancel, fail the inquiry; a later passed attempt outweighs them.

```
$ pnpm exec vitest run src/jobs/inquiry-outcome.test.ts --coverage.enabled=false
 FAIL  src/jobs/inquiry-outcome.test.ts > decideInquiryOutcome > a verification canceled by the capture cap (C40.2) > fails the inquiry when it was the last attempt
AssertionError: expected null to be 'failed' // Object.is equality
      Tests  1 failed | 29 passed (30)
```

### GREEN (`feat(api)`)

`stateOf` treats `failed` and `canceled` as failed attempts; a canceled latest attempt is always
retryable (its count still exhausts `maxAttempts`).

```
$ pnpm exec vitest run src/jobs/inquiry-outcome.test.ts --coverage.enabled=false
      Tests  30 passed (30)
```

## Cycle 3: selfie model provenance and the worker's redaction paths (C39.1, C40.5)

### Stubs (`chore(api)`)

`selfieModels(versions)` returning `{}`, and `CANONICAL_FACE_MESH` (the MediaPipe canonical face
points vision's head pose solves against, pinned by the `canonical_face_mesh` manifest digest).

### RED (`test(api)`)

`models.test.ts`: `MODEL_DIGESTS` pins both MiniFASNet models by their manifest SHA-256;
`selfieModels` names the detector, recogniser, both anti-spoofing models and the canonical mesh,
and leaves out a model that did not run or that it cannot pin. `logger.test.ts`: a device
snapshot, a camera label, landmarks and a layout never reach a log line, at any depth.

```
$ pnpm exec vitest run src/jobs/models.test.ts src/jobs/logger.test.ts --coverage.enabled=false
 FAIL  src/jobs/logger.test.ts > createWorkerLogger > redacts selfie device snapshots, camera labels, landmarks and layouts at any depth (C40.5)
AssertionError: expected '[{"level":30,"time":1792608636729,"pi…' not to contain 'Synthetic Person'
 FAIL  src/jobs/models.test.ts > model digests (C29.2 provenance) > pins every model the government ID and selfie analyses report, by its manifest SHA-256
AssertionError: expected [ 'pp-ocrv6-small-det', …(3) ] to deeply equal [ 'minifasnet-v1se-4.0', …(5) ]
 FAIL  src/jobs/models.test.ts > selfie model provenance (C39.1) > names the face, anti-spoofing and canonical mesh models by the role the evaluators read
AssertionError: expected {} to deeply equal { faceDetector: { …(2) }, …(4) }
 Test Files  2 failed (2)
```

### GREEN (`feat(api)`)

`MODEL_DIGESTS` gains `minifasnet-v2-2.7` and `minifasnet-v1se-4.0`; `selfieModels` pins every
role vision reports and always adds `CANONICAL_FACE_MESH`. The worker's pino redaction keys gain
`device`, `label`, `landmarks`, `layout` and `template` (no existing worker log uses those keys).

```
$ pnpm exec vitest run src/jobs/models.test.ts src/jobs/logger.test.ts src/worker.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  38 passed (38)
```

## Cycle 4: the template and background repository (`packages/db`, C42)

### Stub (`chore(db)`)

`packages/db/src/repositories/face-templates.ts` names `writeFaceData`, `listInquiryIdsOfAccount`
(the existing `listAccountInquiryIds` is capped at 100 for the C13 relationship, so the scan's
exclusion has its own), `listAccountFaceTemplates`, `findNearestSelfieBackgrounds`,
`deleteExpiredFaceData`, `listFaceTemplateRefs`, `lockFaceTemplate`, `rewriteFaceTemplate`,
`rewriteSelfieBackground` and `deleteFaceTemplate`; every body rejects. Exported from the
repositories index.

```
$ pnpm --filter @openverify/db exec tsc --noEmit && pnpm --filter @openverify/db exec eslint src/repositories/face-templates.ts
(no output)
```

### RED (`test(db)`)

`face-templates.test.ts` (PGlite with pgvector): the write seals the template to its row (the
stored value does not contain the embedding and opens to it) and writes the background row
beside it, none without a layout; every inquiry of an account, following a consolidation; the
account's templates without the current inquiry, other accounts or environments; the nearest
backgrounds of other accounts within the window, nearest first, with their templates (`null`
for one that cannot be opened); retention by `face-template-retention-days` (30 set, 365 by
default) in batches; the rebuild helpers page refs by id with no template, lock a row, rewrite in
place keeping `created_at`, rewrite nothing that does not exist, and delete a row with its
background.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/face-templates.test.ts --coverage.enabled=false
 FAIL  src/repositories/face-templates.test.ts > writeFaceData (C42.2) > seals the template to its row and writes the background row beside it
Error: not implemented yet (3 inputs)
 ...
 FAIL  src/repositories/face-templates.test.ts > the rebuild helpers (C42.7) > deletes a template with its background row
Error: not implemented yet (3 inputs)
      Tests  13 failed (13)
```

### GREEN (`feat(db)`)

`writeFaceData` generates the internal `ftpl_`/`sbg_` ids and calls Stage 1's
`createFaceTemplate` and `createSelfieBackground`. `findNearestSelfieBackgrounds` runs in its own
transaction with `SET LOCAL hnsw.iterative_scan = strict_order` and `hnsw.ef_search = 100`, ordered
by `l2Distance`, joined to the inquiry (other accounts, unredacted) and the template (opened per
row, `null` when it cannot be). `deleteExpiredFaceData` selects one batch of due templates, then
per inquiry locks the inquiry, re-selects the still-due templates `FOR UPDATE` and deletes their
background rows, then the templates. `lockFaceTemplate` reports the background row through a
left join locked `FOR UPDATE OF face_templates` (a correlated `exists` first rendered the outer
column unqualified, so it compared the background's own id; the left join fixed it).

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/face-templates.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

## Cycle 5: the face search (C42.4, C42.8)

### Stub (`chore(api)`)

`jobs/face-search.ts` names `scanFaceTemplates`, `bestTemplateCosine`, `faceGroups` and
`FACE_SCAN_BATCH_SIZE`; the scan rejects, the others answer nothing useful.

### RED (`test(api)`)

`face-search.test.ts` (PGlite): the scan scores every template outside the excluded inquiries
(the current one and its account's), reports only cosines at or above the floor, reads newest
first in batches, stops at the cap and says it was truncated (the oldest, best match is past
the cap), is not truncated when the cap covers the gallery, and searches an empty gallery;
`bestTemplateCosine` is the highest cosine or `null`; `faceGroups` groups faces matching at the
threshold transitively. The test support lands here too: `jobs/selfie-testing.ts`
(`threePoseAnalysis`, `seedSubmittedCapture`, `unitVector`, `vectorAtCosine`) and the fake vision
recording `source` and answering `/v1/compare/background`.

```
$ pnpm exec vitest run src/jobs/face-search.test.ts --coverage.enabled=false
 FAIL  ... > scores every template outside the excluded inquiries, reporting cosines at or above the floor
Error: not implemented yet (env_01M5FXNV3MQHJ6NPSXXRNGN5VF, 50000)
 FAIL  ... > bestTemplateCosine (C42.8) > is the highest cosine, or null without templates
AssertionError: expected null to be close to 0.7, received difference is 0.7, but expected 5e-7
 FAIL  ... > faceGroups (C42.8) > puts faces that match at the threshold in one group, transitively
AssertionError: expected [ 0.363, 0.363, 0.363, 0.363 ] to deeply equal [ +0, 1, +0, +0 ]
      Tests  7 failed (7)
```

### GREEN (`feat(api)`)

`scanFaceTemplates` pages Stage 1's `listFaceTemplates` with `before`, asking one row past the cap
only to tell a truncated scan from a complete one (that row is not scored); `cosineOf` is the dot
product of the unit vectors; `faceGroups` is a union-find over every pair, numbered by first
appearance.

```
$ pnpm exec vitest run src/jobs/face-search.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## Cycle 6: the selfie job v2 (C40.8-C40.10, C42.2-C42.8, C43, C44)

### RED (`test(api)`)

`process-selfie.test.ts` (PGlite, the C45.1 default template, consent recorded on a session):
- every prompted pose of the submitted capture (prompted centre, right, left) goes to vision with
  `source: camera`; every enabled check is evaluated, none `pending`/`not_implemented`; liveness
  passes with all three components and a confidence of at most 0.6;
- the capture becomes `processed` with its device cleared, and the staged events are
  `verification.passed`, `selfie.processed`, then the `inquiry.*` events;
- the C40.10 metadata keys (`similarity`, `liveness-score`, `face-cosines`, `face-box`), the
  pinned models and `threshold-basis` in provenance, `stage: beta` everywhere;
- a selfie without a capture (C40.7) is evaluated with `capture_not_live` and no `selfie.*` event;
  an upload capture is sent as `source: upload`; a mirrored image's yaws are flipped;
- the last attempt's vision failure gives `execution_error` and still processes the capture; an
  outage before it is rethrown and leaves the capture `submitted` with its device; an image vision
  cannot read fails the quality check and processes the capture;
- capture integrity: production fails a file-path label (`automated_capture`) and a replayed pose
  (`capture_replayed`); a sandbox records `test-capture-device` and passes;
- face data: a passed selfie with matching consent leaves a sealed template (opening to the centre
  embedding) and a background row; nothing without consent (the three matching checks answer
  `not_consented` and no comparison is sent), nothing for a spoof passed only because liveness is
  advisory, nothing for a selfie in review, nothing for an inquiry declined meanwhile; an inquiry
  that fails loses its face data;
- history: the account comparison with the account's earlier template; the 1:N scan finds the same
  face on another account (`searched: 2`, one match) and leaves the account's own templates out;
  the background search compares the centre with the centre files of three other faces in the
  window (not an older one, not the same face), skips and counts a missing file, compares at most
  five, and records a failed comparison on the last attempt as `execution_error`;
- providers: the sandbox ones get `{ image }` (the centre bytes) and `{ referenceId, birthdate }`
  (the compared ID's extraction); a real one gets one argument; unbound answers
  `provider_not_configured`; a failure is retried, then `execution_error`;
- `failVerificationAfterError` errors the capture (`processing_failed`, device cleared) with
  `verification.failed` then `selfie.errored`;
- a missing prompted file is left out of the analysis (`input_missing` for the pose), and only
  files under the capture count; the reference portrait says whether the ID or its portrait is
  missing.

```
$ pnpm exec vitest run src/jobs/process-selfie.test.ts --coverage.enabled=false
 FAIL  ... > analyses every prompted pose of the submitted capture with its source and evaluates every enabled check
-   "inquiryStatus": "completed",           (liveness had no capture: the selfie went to review)
 FAIL  ... > moves the capture to processed, clears its device, and announces it after the verification
 FAIL  ... > sends an upload capture to vision as an upload, which liveness cannot judge
AssertionError: expected undefined to be 'upload' // Object.is equality
 FAIL  ... > stores the sealed template and the background row of a passed selfie with matching consent
AssertionError: expected [] to have a length of 1 but got +0
 FAIL  ... > deletes the inquiry's face data when the inquiry fails
AssertionError: expected { templates: [ { …(8) } ], …(1) } to deeply equal { templates: [], backgrounds: [] }
 ...
      Tests  27 failed | 6 passed (33)
```

The six that pass already are guards the old job happens to satisfy (the legacy path, the outage
rethrow, nothing stored for a selfie in review or a declined inquiry, unbound providers, the
liveness metadata keys).

### GREEN (`feat(api)`)

- `jobs/selfie.ts` (`evaluateSelfieVerification`, `matchingConsentHolds`): the newest submitted
  capture and its pose files (only files under it; without a capture, every selfie file); the
  analysis with `source`; inside the decrypted-images scope, the providers (`{ image }`, plus
  `{ referenceId, birthdate }` only when `sandbox === true`) and the background search
  (`findNearestSelfieBackgrounds`, 20 nearest; a template that cannot be opened or a missing centre
  file is skipped and counted; a face matching the current one at the 1:1 threshold is left out;
  at most five compared; `faceGroups`); then the reference portrait (`missing: government_id |
  portrait`, or `error`), the account comparison and the 1:N scan (both only with matching
  consent; a `DecryptionError` is recorded as `execution_error`, any other error rethrown), the
  replay lookup and the capture input (`captureDeviceFlags` of the parsed snapshot,
  `selfieCapturePromptTimings`), and `evaluateSelfieChecks` with `selfieModels`. The compared
  ID's birthdate is decrypted only when `selfie_age_comparison` is enabled.
- `jobs/selfie-events.ts`: `stageSelfieCaptureEvent` (`buildSelfieCaptureResource` with the
  prompt timings).
- `process-verification.ts`: the decision transaction locks the inquiry (its status read under the
  lock), moves the verification, stages its event, then `markSelfieCaptureProcessed` and
  `selfie.processed`, then `writeFaceData` when the decision is `passed`, liveness and the ID
  comparison passed, the inquiry is neither declined nor failed, and matching consent still holds
  under the lock. `settleInquiry` deletes the inquiry's face data in the transaction that fails it.
  `failVerificationAfterError` locks the inquiry first, fails the verification, then each submitted
  capture (`markSelfieCaptureFailed`) with `selfie.errored` after `verification.failed`.
- The replay lookup is the worker's own query (see the deviations): Stage 1's `findReplayedFiles`
  joins `selfie_captures`, so it never sees a file without a capture (an ID image, a pre-Phase 4
  selfie), and it leaves out every file of the current inquiry.

Two RED expectations were wrong and are corrected here: the staged events also hold
`inquiry-session.canceled` (the fixture's session is canceled when the inquiry completes), so the
test asserts the first four; and the provider spy kept a reference to the image bytes, which the
job wipes after use (as it must), so the spy copies them when called.

Changed existing tests (C43 changes what they check):
- `process-verification.test.ts`: the three "fails the comparison when ..." tests now expect
  `not_applicable`/`no_reference_data` with `metadata.reference` (`government_id` or
  `portrait`) and a selfie in review (owner decision 5);
- `phase1-contract.test.ts`: the legacy selfie reasons are left out of "every listed code" (C39.2
  keeps them listed for stored rows only), the second face is large enough for the 25% area
  floor, and `input_missing` joins the shared reasons of checks that did not run.

```
$ pnpm exec vitest run src/jobs/process-selfie.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  33 passed (33)
$ pnpm exec vitest run src/jobs src/worker.test.ts --coverage.enabled=false
 Test Files  17 passed (17)
      Tests  272 passed (272)
```

## Cycle 7: the selfie contract (C39.2, C39.3, C39.4, C43), guards

`selfie-contract.test.ts` grows from Stage 1's scaffold to every evaluator path the worker can
reach (23 inputs with all 15 checks enabled and required: production and sandbox, a spoof, no
face, a dark centre, a shallow turn, nothing measured, an upload marked `trainedAlgorithmicMedia`,
a mirrored image, a file-path label with `webdriver` in production and in a sandbox, a virtual
camera, a replay, no snapshot, a centre-only passive capture, no capture, no consent, the ID or its
portrait missing, every history and provider outcome including errors), plus the default config,
`unreadableImageChecks`, `visionFailureChecks` and `executionError` of every result. It asserts:
every §4.2 check is covered; only `SELFIE_CHECK_REASONS` are emitted, never `not_implemented`
(the Stage 1 filter is gone; `pending` only on the unreadable path, with `image_unreadable`);
`SELFIE_EVALUATOR_REASONS[id]` is a subset of `SELFIE_CHECK_REASONS[id]` for every id; a
`not_applicable` result has a reason; the C29.2 schema; the registry stage and version; only
pinned models (an id with its manifest digest, or the canonical mesh); a basis for every default
threshold and none for a key not judged; a confidence in [0, 1] on every decided H-tier and
liveness result; no embedding, landmark, layout or device label in any result. The two C43
cascade cases run end to end through `processVerification`: an insufficient left turn alone, and a
too-dark centre alone, each fail the verification, retryable (`isRetryableFailure`), the inquiry
pending, with `pose_not_left` or `image_too_dark`; liveness and pose repeat do not fail.

These pass on commit: the behaviour they pin landed with the Stage 2 evaluators and cycle 6, so
there is no RED step. My first run failed one assertion I had written too broadly (no `pending` at
all); the unreadable path's `pending`/`image_unreadable` is Phase 1 behaviour the plan keeps, so
the assertion now allows exactly that.

```
$ pnpm exec vitest run src/jobs/selfie-contract.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

## Cycle 8: `id_selfie_comparison` compares with an eligible selfie only (C43)

### RED (`test(api)`)

`process-government-id.test.ts`: with a passed selfie followed by a failed one, the ID job
re-embeds the passed one; with only a failed selfie, it embeds nothing and the check has no input.

```
$ pnpm exec vitest run src/jobs/process-government-id.test.ts -t "ID-selfie comparison" --coverage.enabled=false
 FAIL  ... > compares with the latest passed, submitted or needs_review selfie, never a failed one (C43)
AssertionError: expected [ 255, 216, 255, 224, 55, 9, …(46) ] to deeply equal [ 255, 216, 255, 224, 61, 13, …(46) ]
 FAIL  ... > has no input with only a failed selfie
AssertionError: expected [ 'government-id', 'embed-face' ] to deeply equal [ 'government-id' ]
      Tests  2 failed | 2 passed | 30 skipped (34)
```

### GREEN (`fix(api)`)

`government-id.ts` filters the inquiry's selfies by `COMPARED_SELFIE_STATUSES` (`passed`,
`submitted`, `needs_review`); a failed attempt is never the reference.

```
$ pnpm exec vitest run src/jobs/process-government-id.test.ts src/jobs/government-id-contract.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  39 passed (39)
```

## Cycle 9: template retention in the C16 run (C42.6)

### Stub (`chore(api)`)

`RetentionReport` gains `deletedFaceTemplates` and `deletedSelfieBackgrounds`, always 0.

### RED (`test(api)`)

`services/retention.test.ts`: a pending inquiry's template 366 days old goes, one 300 days old
stays (default 365); in an environment with `face-template-retention-days: 30`, a completed
inquiry's template 31 days old goes and one 29 days old stays, whatever the inquiry's own
retention (none set); the report counts two templates and two backgrounds, and a second run finds
nothing. The report shape (`EMPTY` there, the `--json` line in `retention-run.test.ts`) gains the
two counts: the plan adds them.

```
$ pnpm exec vitest run src/services/retention.test.ts src/retention-run.test.ts --coverage.enabled=false
 FAIL  ... > deletes face templates and their backgrounds past face-template-retention-days, whatever the inquiry's retention (C42.6)
AssertionError: expected { redactedInquiries: +0, …(12) } to deeply equal { redactedInquiries: +0, …(12) }
      Tests  1 failed | 27 passed (28)
```

### GREEN (`feat(api)`)

`runRetention` drains `deleteExpiredFaceData` (each inquiry's rows under its lock, batch by
batch) and reports both counts; the `retention:run` script prints them like the others.

```
$ pnpm exec vitest run src/services/retention.test.ts src/retention-run.test.ts src/jobs/retention.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  40 passed (40)
```

## Cycle 10: `face-index:rebuild` (C42.7)

### Stub (`chore(api)`)

`jobs/face-index-rebuild.ts` names `rebuildFaceIndex` and its report (`examined`, `rewritten`,
`deleted`, `failed`); `scripts/face-index-rebuild.ts` names the arguments, the usage error and the
output line.

### RED (`test(api)`)

`jobs/face-index-rebuild.test.ts` (PGlite): an existing template is re-embedded from its
verification's centre file (as a selfie, no subject) and rewritten with the new model id, its
background row rewritten from a new centre analysis, `created_at` kept on both; a verification
with a centre file but no template gets none; a template without a background gets none and no
centre analysis; a row whose file is gone or shows no face to the new model is deleted; so is a
row whose consent no longer holds (a later consent without the key) or whose inquiry was
redacted, declined or failed; a vision failure leaves the row and counts it; a dry run counts
what it would do, calls no vision endpoint and writes nothing. `face-index-rebuild.test.ts`: the
command line (`--dry-run`, `--batch-size` in both spellings, capped; unknown or bad flags refused
with the usage) and the output line, counts only.

```
$ pnpm exec vitest run src/face-index-rebuild.test.ts src/jobs/face-index-rebuild.test.ts --coverage.enabled=false
 FAIL  src/face-index-rebuild.test.ts > parseFaceIndexRebuildArgs > reads --dry-run and --batch-size in both spellings, capping the size
AssertionError: expected { dryRun: false, batchSize: 100 } to deeply equal { dryRun: true, batchSize: 25 }
 FAIL  src/face-index-rebuild.test.ts > describeFaceIndexRebuild > prints counts only
AssertionError: expected '4 false' to be 'face-index:rebuild: done: examined 4 …' // Object.is equality
 FAIL  src/jobs/face-index-rebuild.test.ts > face-index:rebuild (C42.7) > re-embeds an existing template from its centre file and rewrites it and its background, keeping created_at
Error: not implemented yet (2, object)
 ...
      Tests  12 failed | 1 passed (13)
```

### GREEN (`feat(api)`)

`rebuildFaceIndex` pages `listFaceTemplateRefs` by id; per row it decrypts the centre file
(`readStoredImage`), calls `/v1/embed/face` (no subject) and, for a row with a background,
`/v1/analyze/selfie` with the centre only, all before the transaction; then one transaction locks
the inquiry, re-checks redaction, status and matching consent (`matchingConsentHolds` on the
pinned version's flow) under the lock, locks the template row (`null`: deleted meanwhile, nothing
created) and rewrites it and its background, or deletes the row. An existing background row is
kept when the new analysis measures no layout. Vision 413/415/422 count as an unreadable file
(deleted); any other vision failure is counted and leaves the row. A dry run decrypts the files
and reads eligibility, calls no vision endpoint and writes nothing. The script reads the API's
settings with `loadConfig`, prints one line of counts and exits 1 when a row was left after a
vision failure; `apps/api/package.json` gains `face-index:rebuild`.

```
$ pnpm exec vitest run src/face-index-rebuild.test.ts src/jobs/face-index-rebuild.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  13 passed (13)
$ pnpm --filter @openverify/api face-index:rebuild --bogus
Unknown argument --bogus. usage: face-index:rebuild [--dry-run] [--batch-size=<1-10000>]
```

## Refactor (`refactor(api)`): provider calls receive the bound provider

`ask` in `jobs/selfie.ts` takes `(provider) => ...` as the government ID job's does, so the
`sandbox` discriminant narrows each port to its one- or two-argument form with no unreachable
fallback.

```
$ pnpm exec vitest run src/jobs --coverage.enabled=false
 Test Files  17 passed (17)
      Tests  264 passed (264)
```

## Cycle 11: race tests for the worker's writers (C40.6), on Postgres 17

`jobs/selfie-race.integration.test.ts` (Testcontainers `pgvector/pgvector:pg17`, the G002
pattern: a hook inside the writer's transaction at its first staged event, or a raw client holding
the inquiry row lock):
- a redaction during the decision write waits for its commit, then deletes the template and the
  background row and clears the device (the capture stays `processed`, `redacted_at` set);
- a decision write after a redaction waits, then writes nothing (`inquiry_redacted`, no face
  data, the capture still `submitted`); `failVerificationAfterError` then errors the capture
  (`processing_failed`, no device);
- a decline that commits while the decision write waits leaves no template (the verification
  still passes);
- `failVerificationAfterError` waits for a redaction holding the inquiry, then errors the capture;
  and holds the inquiry while it writes, so a redaction waits for its commit;
- the retention deletion waits for a writer holding the inquiry, then deletes;
- a rebuild whose row a redaction or the retention deletion removed while vision re-embedded it
  creates nothing; a rebuild row transaction waits for a redaction holding the inquiry, then
  deletes the row.

These pin the lock order built in cycles 4, 6 and 10, so they pass on commit. Two mutations show
they can fail: without the inquiry lock in `failVerificationAfterError`, and without it in
`deleteExpiredFaceData`, the redaction (and the retention deletion) no longer wait. Both files
were restored from copies afterwards (no diff).

```
$ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/selfie-race.integration.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
# mutation: no inquiry lock in failVerificationAfterError and in deleteExpiredFaceData
 FAIL  ... > holds the inquiry while it writes, so a redaction waits for its commit
AssertionError: expected false to be true // Object.is equality
 FAIL  ... > the retention deletion waits for a writer holding the inquiry, then deletes
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 7 passed (9)
```

The same file also holds C45.3's Testcontainers check (a guard over cycle 6): a passed
verification with matching consent has a template and a background row on Postgres; one without
the consent has none.

```
$ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/selfie-race.integration.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Cycle 12: the C42.4 scan measurement, `face-scan:benchmark`

### Stub (`chore(api)`)

`scripts/face-scan-benchmark.ts` names the arguments, the result, `measureFaceScan` and the output
line.

### RED (`test(api)`)

`face-scan-benchmark.test.ts`: 50,000 templates and 3 runs by default; `--templates`
(1-200,000) and `--runs` (1-20) in both spellings, bad values refused with the usage; on PGlite,
25 synthetic sealed templates are all scored, untruncated, with one timing per run, and the
synthetic organization is removed afterwards; the output line holds timings and counts only.

```
$ pnpm exec vitest run src/face-scan-benchmark.test.ts --coverage.enabled=false
 FAIL  ... > reads --templates and --runs in both spellings
AssertionError: expected { templates: 50003, runs: 3 } to deeply equal { templates: 1000, runs: 5 }
 FAIL  ... > measureFaceScan > scores every synthetic sealed template, then removes what it wrote
Error: not implemented yet (25, object)
      Tests  8 failed | 1 passed (9)
```

### GREEN (`feat(api)`)

`measureFaceScan` writes a scratch organization (one sandbox environment, one inquiry, the
verifications and the sealed templates, 500 rows per insert, seeded LCG unit vectors, never a
face), times `scanFaceTemplates` over all of them (`maxTemplates` = the gallery, the
`FACE_SCAN_FLOOR`), and deletes the organization, whose deletion cascades to everything it wrote.
`apps/api/package.json` gains `face-scan:benchmark`.

```
$ pnpm exec vitest run src/face-scan-benchmark.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### The C42.4 measurement (re-measured, as the plan asks)

A throwaway `pgvector/pgvector:pg17` container of my own (`docker run --rm`, port 55432 on
loopback, migrated with `scripts/migrate.ts`), the Xeon E5-1650 v3 (12 logical CPUs) shared with
the other Stage 3 agent's suites:

```
$ uptime
 15:47:57 up 1 day, 16:31,  0 user,  load average: 27.85, 12.65, 7.09
$ pnpm exec tsx --conditions=@openverify/source scripts/face-scan-benchmark.ts --templates=50000 --runs=5
face-scan:benchmark: decrypted and scored 50000 sealed templates in 2583 ms (median of 5 runs: 2356, 2536, 2583, 2636, 2702 ms; seeding took 22326 ms).
$ uptime
 15:48:48 up 1 day, 16:32,  0 user,  load average: 18.53, 12.80, 7.46
$ pnpm exec tsx --conditions=@openverify/source scripts/face-scan-benchmark.ts --templates=50000 --runs=5
face-scan:benchmark: decrypted and scored 50000 sealed templates in 5058 ms (median of 5 runs: 3364, 4322, 5058, 5532, 7125 ms; seeding took 14135 ms).
$ docker exec ov-api-worker-scanbench psql -U postgres -d bench -tAc "select count(*) from face_templates; select count(*) from organizations;"
0
0
```

Under a load average of 15 to 28, the scan of 50,000 sealed templates took a median of 2.58 s
(best run 2.36 s) and, in a second, busier reading, 5.06 s. The plan's 2.1 s was taken on an idle
machine; the best runs here are close to it. The scan is CPU-bound (per-row AES-GCM opening and a
128-value dot product) and runs once per selfie with matching consent and the repeat check
enabled. Stage 4 (`integration`) re-runs it on an idle machine.

## Cycle 13: the C45.1 default through the real worker (guard)

`worker.integration.test.ts` (Postgres 17, Valkey 9.1, the HTTP stub vision service) gains one
test: an inquiry of the C45.1 default with matching consent, a passed ID and a submitted
three-pose capture goes through BullMQ and `createVisionClient`; vision receives `center`,
`left`, `right` and `source` on `/v1/analyze/selfie` and `probe`, `candidate_0` on
`/v1/compare/background` (another account's background row in the window); the verification
passes, the capture is `processed` without its device, `selfie.processed` is written, and the
template is stored. The stub's multipart field pattern now also reads digits and underscores
(`candidate_0`). The six Phase 1-3 tests keep the centre-only passive template, now the
documented workaround for users who cannot turn their head.

My first run found no candidate: every inquiry of that file shares one reference id, so they
share an account and the candidate was rightly excluded as the same account; the candidate now
has its own reference id (a scratch reproduction on Postgres, deleted afterwards, confirmed the
query plan uses `selfie_backgrounds_layout_hnsw_idx` and returns the row).

```
$ pnpm exec vitest run --config vitest.integration.config.ts src/worker.integration.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## Cycle 14: the vision client's selfie source and background comparison (C41.1, C41.2)

### RED (`test(api)`)

`vision/index.test.ts`: two guards over Stage 1's client (the `source` text field after the
images, none when not given; `probe` and `candidate_0`... posted to `/v1/compare/background` and
the answer parsed), and one new rule: the client refuses a comparison of no candidate or more
than five (`RangeError`) without calling vision, which answers 422 to a sixth field (a status the
worker reads as an unreadable image).

```
$ pnpm exec vitest run src/vision --coverage.enabled=false
 FAIL  ... > refuses a background comparison of no candidate or more than five, without calling vision
AssertionError: promise resolved "{ results: [] }" instead of rejecting
      Tests  1 failed | 88 passed (89)
```

### GREEN (`feat(api)`) and refactor

`createVisionClient().compareBackground` rejects with a `RangeError` outside 1 to
`MAX_BACKGROUND_CANDIDATES` (5) before any request. The selfie job's `BACKGROUND_CANDIDATES` now
is that constant.

```
$ pnpm exec vitest run src/vision src/jobs/process-selfie.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  122 passed (122)
```

## Cycle 15: edges of the selfie job (guards) and a refactor

`process-selfie.test.ts` gains guards for the paths coverage showed untested: a consent step
without `consent.biometric-matching` (no matching consent); an ID front whose object is gone or
that vision cannot read (no portrait) and one whose embedding fails on the last attempt
(`execution_error`); stored templates that cannot be opened (another row's sealed value, so the
row AAD fails): the account comparison and the 1:N scan answer `execution_error` with a warning
naming the check, and such a background candidate is skipped and counted; a layout below
`min-coverage` searches nothing; a capture without its centre file fails for good. My first
version cleared `optionalTextKeys` to `[]`, which the flow schema refuses (the job then failed on
`invalid_template`); the test now removes the key.

Refactor: the replay lookup's empty-digest check was unreachable (the centre file always exists
by then) and is gone.

```
$ pnpm exec vitest run src/jobs/process-selfie.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  38 passed (38)
```

## Final gates (foreground, on `main` with the other Stage 3 agent's commits)

```
$ pnpm typecheck
 Tasks:    12 successful, 12 total
$ pnpm lint
 Tasks:    12 successful, 12 total
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm --filter @openverify/api test          # the 80% gate
 Test Files  124 passed (124)
      Tests  2449 passed (2449)
All files          |    97.6 |    90.58 |   98.55 |   97.64 |
$ pnpm --filter @openverify/db test
 Test Files  54 passed (54)
      Tests  677 passed (677)
All files          |   98.82 |     91.8 |   99.29 |   98.76 |
$ pnpm test:integration
@openverify/api:test:integration:       Tests  62 passed (62)
@openverify/db:test:integration:       Tests  46 passed (46)
 Tasks:    2 successful, 2 total
$ flock /tmp/openverify-e2e.lock pnpm e2e     # with Stage 1's selfie spec exclusion
@openverify/flow:e2e:   38 passed (12.4s)
@openverify/e2e:e2e:   36 passed (3.2m)
```

My first full `pnpm test:integration` run (both packages in parallel, load average about 13 to
28 on 12 CPUs) failed one db test outside my paths, `query-plans.integration.test.ts` "serves an
inquiry timeline from the events object index (C25.7)", after 48.8 s; I did not capture its
message. It passed alone and in both later full runs (above). It is reported to the orchestrator
rather than changed here.
