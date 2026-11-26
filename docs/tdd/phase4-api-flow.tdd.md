# TDD evidence: Phase 4, Workflow 4A Stage 3, `api-flow`

Scope: the C40 flow routes and services (create, upload fields, submit, supersede, the capture
cap with the inquiry settlement, every cancel path's capture update), C42.3 consent (optional
texts, the publish-time rule, the session's retention days and recorded keys), the `selfie`
resource with its events and inclusion, the C40.10 verification attributes, the dashboard
inquiry document's captures, the operator-decline deletion of face data, the race tests for
these writers (Testcontainers), the OpenAPI snapshot and `@openverify/node`.

Every slice: a stub commit when a test needed a name that did not exist, then the RED test
(compiling, typechecking, failing at run time for the intended reason), then GREEN. Commands
run after `source scripts/env.sh`; iterating used
`pnpm --filter <pkg> exec vitest run <files> --coverage.enabled=false`.

## 1. Consent (C42.3, C42.6)

- Stub: `ConsentRecord.optionalTextKeys?` (`packages/db/src/tables/inquiries.ts`), declared but
  not stored.
- RED: `packages/db/src/repositories/consent-optional-keys.test.ts`,
  `apps/api/src/routes/flow/consent-phase4.test.ts`.

  ```
  $ pnpm --filter @openverify/db exec vitest run src/repositories/consent-optional-keys.test.ts --coverage.enabled=false
  × are stored and read back with the consent   (expected { optional_text_keys: [...] } in the jsonb)
  × are an empty list when the user ticked none  (expected undefined to deeply equal [])
  Tests  2 failed | 1 passed (3)
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow/consent-phase4.test.ts --coverage.enabled=false
  Tests  15 failed | 2 passed (17)
  ```
  The optional texts were not recorded (`undefined`), unlisted keys were accepted (201), the
  session had no `face-template-retention-days` and the inquiry session no `consent`
  (`undefined`), and a template requiring `selfie_repeat_detection` with the matching consent
  optional was created (201, not 422). The two passing tests guard against over-refusal: the
  default template, and a template whose matching consent is a required text.
- GREEN:
  - `packages/db`: the consent jsonb stores `optional_text_keys` when the record has them and
    reads them back; a consent stored before Phase 4 reads without the member.
  - `recordConsent` refuses, with 422 naming them, required keys the pinned consent step's
    `textKeys` do not list and optional keys its `optionalTextKeys` do not list (an optional key
    sent as required, or a required one sent as optional, is refused too). Without a consent
    step, required keys are accepted as before Phase 4 and no optional key is. The ticked
    optional keys are recorded (`[]` when none).
  - `GET /flow/session` returns the environment's `face-template-retention-days`
    (`resolveFaceTemplateSettings`, default 365).
  - The inquiry session resource carries `consent` (`accepted-at`, `text-keys`,
    `optional-text-keys`, `locale`; `null` before consent), from a new optional
    `InquirySessionRecord.consent` in `@openverify/contracts`.
  - `createInquiryTemplate` (version 1 is published with it) and `publishTemplateVersion` refuse
    with 422 a version that requires `selfie_repeat_detection`, `selfie_account_comparison` or
    `selfie_similar_background_detection` unless `consent.biometric-matching` is a required
    consent text; each problem points at
    `/data/attributes/verification-config/selfie/checks/<check>/required`. Drafts may be saved
    with it; only publishing is refused.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow/consent-phase4.test.ts --coverage.enabled=false
  Tests  17 passed (17)
  $ pnpm --filter @openverify/db exec vitest run src/repositories/consent-optional-keys.test.ts --coverage.enabled=false
  Tests  3 passed (3)
  ```
  Two existing tests changed minimally because the plan changes what they check: the inquiry
  session list now shows `consent: null`, and the recorded consent has `optionalTextKeys: []`.

## 2. Capture create (C40.2): prompts, nonce, expiry, guidance, supersede, the cap

- Stub: `selfieCapturePrompts` and `RandomInt` (`apps/api/src/services/selfie-captures.ts`),
  answering `['center']`. The test helper `apps/api/src/routes/flow/selfie.test-support.ts`
  (consented selfie flow, create, per-pose upload, submit) needs only existing names.
- RED: `apps/api/src/services/selfie-captures.test.ts`,
  `apps/api/src/routes/flow/selfie-capture-create.test.ts`.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/services/selfie-captures.test.ts src/routes/flow/selfie-capture-create.test.ts --coverage.enabled=false
  × puts center first and the side poses in the order the draw gives
  × draws the side order from the CSPRNG by default: both orders occur
  ...
  Error: expected HTTP 201, got 501: {"title":"Not Implemented",...,"detail":"Selfie captures are not implemented yet."}
  AssertionError: expected 501 to be 409
  Tests  22 failed | 1 passed (23)
  ```
  Every route test met the Stage 1 501 stub; the prompt tests met the stub's `['center']`. The
  passing test is the centre-only step, which the stub already answers.
- GREEN: `createFlowSelfieCapture` (`services/flow.ts`) and the capture helpers
  (`services/selfie-captures.ts`: `selfieCapturePrompts` (Fisher-Yates on `crypto.randomInt`),
  `newSelfieCaptureNonce` (`randomBytes(16)` base64url), `nonceDigest`, `nonceMatches`
  (`timingSafeEqual` over SHA-256 digests, run even when there is no capture),
  `selfieCaptureGuidance` (the pinned `selfie_pose_detection` config, else
  `SELFIE_CAPTURE_GUIDANCE_DEFAULTS`), `selfieCaptureResourceOf`, `stageSelfieEvent`,
  `errorOpenSelfieCaptureInTx`, `deleteObjects`, `SelfieCaptureConflictError`,
  `selfieCaptureInvalid`); the route answers 201 with the flow view.
  - One transaction: the inquiry locked and re-checked (`assertInquiryOpenUnderLock`, which now
    returns the inquiry it read), the verification locked and re-checked `initiated`, then the
    cap count, the open capture errored (`expired` once `expires_at <= now`, else
    `superseded`) with its file rows deleted and `selfie.errored`, the new capture with
    `selfie.created`. Objects of the deleted rows are deleted after commit, best effort.
  - The cap (`countSelfieCaptures >= SELFIE_CAPTURE_LIMIT`): the open capture `canceled`
    (`selfie.errored`), the verification `canceled` (`verification.canceled`), and, when the
    step's attempts (every selfie verification of the inquiry, as `createFlowVerification`
    counts them) reach `maxAttempts`, `transitionInquiryInTx(..., 'failed')`; then 409
    `selfie_capture_limit` after commit.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/services/selfie-captures.test.ts src/routes/flow/selfie-capture-create.test.ts --coverage.enabled=false
  Test Files  2 passed (2)
  Tests  23 passed (23)
  ```
  `routes/selfie-stubs.test.ts` lost its "create answers 501" case (the route is built).

## 3. Upload fields (C40.3)

- Stub: `NewFileInput.selfieCaptureId?`, `clientElapsedMs?`, `receivedAt?`
  (`packages/db/src/repositories/files.ts`), declared but not written.
- RED: `packages/db/src/repositories/files-selfie-capture.test.ts`,
  `apps/api/src/routes/flow/selfie-capture-upload.test.ts`.

  ```
  $ pnpm --filter @openverify/db exec vitest run src/repositories/files-selfie-capture.test.ts --coverage.enabled=false
  AssertionError: expected { …(15) } to match object { …(3) }          (the columns stayed null)
  AssertionError: expected [] to deeply equal [ { pose: 'left', …(2) }, …(1) ]
  Tests  2 failed | 1 passed (3)
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow/selfie-capture-upload.test.ts --coverage.enabled=false
  × stores the pose with its capture, the client elapsed time and the server receipt time
  × replaces a pose uploaded again; the latest per pose counts
  × answers 409 selfie_capture_required for a selfie pose without the capture fields, and stores nothing
  × answers 422 for a pose the capture did not prompt
  × answers the same selfie_capture_invalid for a wrong nonce, a foreign, a superseded and an expired capture
  × accepts an upload one millisecond before the expiry
  × refuses an upload whose capture is superseded while its object is stored, and keeps nothing
  Tests  7 failed | 9 passed (16)
  ```
  The upload refused every capture field with 400 (`Only one "kind" field and one "file" file
  are accepted`) and took a selfie pose without them. The nine passing tests pin what must stay:
  the 400s for malformed or partial capture fields and for capture fields on a government ID
  (which the old parser gave for any extra field), and a pre-Phase 4 verification
  (`selfie_capture_required` false) that still uploads without a capture.
- GREEN:
  - `createFile` writes `selfie_capture_id`, `client_elapsed_ms` and `received_at`.
  - `readUpload` takes `kind`, the three capture fields and `file`, each once; a repeated or
    unknown part, or a value cut by the 64-byte field limit, is 400. The capture fields come all
    three or none, each checked with its contract schema (`idSchema('self')`,
    `selfieCaptureNonceSchema`, `clientElapsedMsFieldSchema`).
  - `uploadFile`: the fields on a non-selfie kind are 400; a selfie pose without them is 409
    `selfie_capture_required` when the verification's `selfie_capture_required` is true (a
    pre-Phase 4 verification still uploads without one). The capture is checked before the
    object is stored (`assertCaptureTakesPose`: `nonceMatches`, `initiated`,
    `expires_at > now`; one `selfie_capture_invalid` body for all; a pose outside the prompts
    is 422), and again in the write transaction, which now runs for every upload under the
    C40.6 order: the inquiry locked and re-checked, the verification locked and re-checked
    `initiated`, the capture locked (`lockSelfieCapture`) and re-checked, then
    `replaceVerificationFile` with `received_at` from the clock inside the transaction. A
    refused write deletes the stored object.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow --coverage.enabled=false
  Test Files  7 passed (7)
  Tests  158 passed (158)
  $ pnpm --filter @openverify/db exec vitest run src/repositories/files-selfie-capture.test.ts src/repositories/files.test.ts --coverage.enabled=false
  Tests  10 passed (10)
  ```
  `routes/flow/verifications.test.ts` "needs the center selfie for a selfie verification" now
  marks its verification as created before Phase 4 (`selfie_capture_required` false): C40.7
  changes the behaviour it checks for every newer selfie.

## 4. Submit (C40.4, C40.7)

- RED: `apps/api/src/routes/flow/selfie-capture-submit.test.ts` (no stub needed).

  ```
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow/selfie-capture-submit.test.ts --coverage.enabled=false
  × consumes the capture, moves the verification to submitted and enqueues it
  × publishes selfie.submitted then verification.submitted, after selfie.created
  × seals the device snapshot with its label cleaned and cut, and never shows it
  × accepts a submit without a device snapshot
  × answers 409 selfie_capture_incomplete while a prompted pose has no file, and changes nothing
  × answers 409 selfie_capture_required for a capture-bound selfie submitted without one (C40.7)
  × answers 422 for a government ID submitted with a capture
  × answers the same selfie_capture_invalid for a wrong nonce, a foreign, a superseded and an expired capture, and changes nothing
  × answers 202 and enqueues again for the capture that submitted the verification, publishing once
  × answers 409 for another capture, a wrong nonce or no capture while submitted
  Tests  10 failed | 8 passed (18)
  ```
  Submit ignored the capture: it never consumed it, staged no `selfie.submitted`, sealed no
  device, and took a capture-bound selfie or a wrong nonce alike. The eight passing tests pin
  behaviour that must stay: a pre-Phase 4 selfie submits without a capture, the device snapshot
  schema refuses unknown or out-of-range members (400), a submit just before the expiry, a
  repeat once the verification is decided (409), and an upload after submit (409).
- GREEN: `submitVerification(deps, session, id, body)` (the route passes the body).
  - A capture on a government ID is 422; a capture-bound selfie (`selfie_capture_required`)
    without one is 409 `selfie_capture_required`, at the first submit and on a repeat.
  - In the submit transaction (inquiry, verification, then `lockSelfieCapture`):
    `assertCaptureOpen` (`nonceMatches`, `initiated`, `expires_at > now`; one
    `selfie_capture_invalid` body), `assertCaptureComplete` (every prompt has a file under the
    capture; 409 `selfie_capture_incomplete` naming the poses), `consumeSelfieCapture` with the
    device snapshot (`sanitizeDeviceLabel` on the label; the schema bounds the rest), then
    `moveVerification`, `selfie.submitted`, `verification.submitted` (listing the capture's
    files).
  - A repeat while `submitted` must name the capture that submitted it (`submitted`, nonce
    matching), else `selfie_capture_invalid`; it only enqueues again.
  - `selfieCapturePromptTimings` (`packages/db`) breaks ties in `received_at` by the rows'
    creation, so the timings of uploads in the same millisecond keep their order (the events
    test met the tie under the frozen clock).

  ```
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow --coverage.enabled=false
  Test Files  8 passed (8)
  Tests  176 passed (176)
  ```

## 5. Cancel paths and face data on decline or failure (C40.2, C42.2)

- RED: `apps/api/src/services/selfie-cancel-paths.test.ts`.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/services/selfie-cancel-paths.test.ts --coverage.enabled=false
  × the expire action: canceled with selfie.errored, its files and objects deleted
  × the inquiry expiry job: canceled with selfie.errored and its file rows deleted
  × deletes the templates and background rows when an operator declines
  × deletes them in the transaction that fails the inquiry
  AssertionError: expected { …(15) } to match object { status: 'errored', …(1) }
  AssertionError: expected { templates: 1, backgrounds: 1 } to deeply equal { templates: +0, backgrounds: +0 }
  Tests  4 failed | 1 passed (5)
  ```
  The capture stayed `initiated` when its verification was canceled, and the face data stayed
  after a decline or a failure. The passing test pins that approving keeps them.
- GREEN:
  - `cancelInitiatedVerifications` (`services/verifications.ts`) errors each initiated selfie's
    open capture (`canceled`, `selfie.errored`, file rows deleted) before it cancels the
    verifications, and returns `{ staged, storageKeys }`.
  - `transitionInquiryInTx` (`services/inquiries.ts`) returns `storageKeys` with its result
    (`InquiryTransitionResult.storageKeys`), and on `declined` or `failed` calls
    `deleteFaceDataForInquiry` in the transition's transaction, whoever moves it (an operator
    action, the simulation, the worker, the capture cap). `performInquiryAction` and
    `performSimulateActions` delete the returned objects after commit; the expiry job has no
    storage, so its canceled captures' objects stay crypto-shredded (their wrapped keys went
    with the rows).

  ```
  $ pnpm --filter @openverify/api exec vitest run src/services/selfie-cancel-paths.test.ts --coverage.enabled=false
  Tests  5 passed (5)
  $ pnpm --filter @openverify/api exec vitest run src/services src/routes --coverage.enabled=false
  Test Files  52 passed (52)
  Tests  1026 passed (1026)
  ```

## 6. The `selfie` resource, inclusion and the C40.10 attributes

- Stub: `selfieVerificationAttributes` and its types
  (`packages/contracts/src/selfie-verification-attributes.ts`), answering every attribute `null`.
- RED: `packages/contracts/src/selfie-verification-attributes.test.ts`,
  `apps/api/src/routes/server/selfies.test.ts`, `apps/api/src/services/selfie-verification-events.test.ts`,
  `apps/api/src/routes/flow/selfie-flow-contract.test.ts`, and a new describe in
  `apps/api/src/routes/dashboard/index.test.ts`.

  ```
  $ pnpm --filter @openverify/contracts exec vitest run src/selfie-verification-attributes.test.ts --coverage.enabled=false
  × reads the scores from their metadata keys, rounded to 4 decimals, and the capture
  × answers null for a side the liveness check did not compare
  × keeps a negative cosine
  Tests  3 failed | 9 passed (12)
  $ pnpm --filter @openverify/api exec vitest run src/routes/flow/selfie-flow-contract.test.ts src/services/selfie-verification-events.test.ts src/routes/server/selfies.test.ts src/routes/dashboard/index.test.ts --coverage.enabled=false
  Error: expected HTTP 200, got 501: {"title":"Not Implemented",...,"detail":"Selfie captures are not implemented yet."}
  Error: expected HTTP 200, got 400: {... "pointer":"/include","detail":"Invalid input: expected \"verifications\""}
  AssertionError: expected undefined to deeply equal [ { type: 'selfie', …(1) }, …(1) ]   (no selfies relationship)
  AssertionError: expected { status: 'submitted', …(3) } to match object { …(5) }       (no C40.10 attributes)
  AssertionError: expected 200 to be 400                                                  (unknown include ignored)
  Tests  12 failed | 40 passed (52)
  ```
  The flow contract test passes from the start (the flow API never had these attributes): it
  is the C40.10 guard. The null cases of the derivation pass against the stub.
- GREEN:
  - `@openverify/contracts` (recorded amendments): `selfieVerificationAttributes` (scores
    rounded to 4 decimals; a missing, malformed or out-of-range key, as after redaction, gives
    `null`; the face box's four corners must lie in the image); `VerificationRecord.selfie`
    (`SelfieVerificationDetails`: capture ids newest first, the consumed capture), which makes
    `buildVerificationResource` send the C40.10 attributes and the `selfies` relationship;
    `InquiryRecord.selfieCaptureIds` (the inquiry's `selfies`); `INQUIRY_INCLUDES` gains
    `selfies` and `include` takes a comma list (`inquiryIncludeSchema`); the inquiry route answers
    `inquiryIncludeDocumentSchema` (verifications or captures in `included`; `InquiryDocument` is
    unchanged); `verificationDocumentSchema.included` takes files or captures, with
    `VERIFICATION_INCLUDES` and `getVerificationQuerySchema`.
  - API: `GET /api/v1/selfies/:id` (`getSelfieCaptureDocument`); `selfieDetailsOf`,
    `selfieDetailsForVerification`, `selfieCaptureResources` (`services/selfie-captures.ts`);
    the verification document, `stageVerificationEvent` (so the worker's `verification.*`
    events carry them), the inquiry document (`include` may name both), `inquiryResourceOf` (the
    inquiry events and actions) and the dashboard inquiry document all read the captures. The
    consumed capture is the newest `processed` or `submitted` one. The inquiry list leaves the
    `selfies` relationship out.

  ```
  $ pnpm --filter @openverify/contracts exec vitest run --coverage.enabled=false
  Test Files  46 passed (46)
  Tests  1400 passed (1400)
  $ pnpm --filter @openverify/api exec vitest run src/services src/routes src/events src/webhooks --coverage.enabled=false
  Test Files  61 passed (61)
  Tests  1345 passed (1345)
  ```
  `routes/selfie-stubs.test.ts` lost its "GET /selfies/:id answers 501" case.

## 7. The settings route for the two face template settings (C42.4, C42.6, C47)

Stage 1 already served `face-template-retention-days` and `face-search-max-templates` through
`GET` and `PATCH /dashboard/settings` (`services/settings.ts`). The route had no test of them, so
`apps/api/src/routes/dashboard/settings.test.ts` gains guards: the defaults (365, 50,000), a
change stored on the environment and audited, and 400 for 0, 1,096, 30.5 and `null` days and for
999 and 200,001 templates. They passed when written (no RED: the behaviour existed).

```
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard/settings.test.ts --coverage.enabled=false
Tests  13 passed (13)
```

## 8. Race tests (C40.6), Testcontainers

`apps/api/src/services/selfie-capture-races.integration.test.ts` (Postgres 17 with pgvector, the
pattern of `redaction-race.integration.test.ts` and `locks.integration.test.ts`): the competing
writer holds its locks in a drizzle transaction on its own connection while the service runs; the
test records whether the service waited for its commit.

- create, upload, submit and the capture-cap cancel each wait for a redaction holding the inquiry
  and then answer 410, writing nothing (no capture, no file row or object, nothing consumed or
  canceled);
- an upload waits for a supersede (inquiry, verification, capture errored) and is refused with
  `selfie_capture_invalid`, storing nothing; the stale upload (checks passed, then a real create
  commits during `storage.put`) is refused at its insert;
- a submit waits for a supersede and is refused; a create waits for a submit that consumed the
  capture and is refused (409); two concurrent creates leave one open capture and one
  superseded;
- an upload waits for the `expire` action and is refused; the action waits for an upload holding
  the inquiry, then cancels the capture and deletes its file;
- an operator decline waits for a face data write holding the inquiry, then deletes the template
  and the background row it wrote;
- the inquiry expiry job skips an inquiry a writer holds (`FOR UPDATE SKIP LOCKED`, without
  waiting) and cancels its capture on the next run (13 tests in all).

These were written after the GREEN code they check, so they passed on their first run. To show
they catch a broken lock order, a scratch mutant (not committed) removed the inquiry lock and the
capture re-check from the upload's write transaction:

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/services/selfie-capture-races.integration.test.ts
Tests  12 passed (12)                       (23 s, the container start included)
# mutant: uploadFile's transaction without assertInquiryOpenUnderLock and the capture re-check
× an upload waits for the redaction, then refuses (410), keeping no row and no object
× the stale upload: its checks passed, a supersede commits, its insert is refused
× an upload waits for the expire action, then is refused (409) and stores nothing
Tests  3 failed | 9 passed (12)
# restored from the saved copy; git diff shows no change
```
The supersede-versus-upload case still passed under the mutant: the upload's pre-check reads the
capture `FOR UPDATE` and so already waits for the supersede's row lock.

## 9. The API integration test speaks C40 (C40.7)

`apps/api/src/api.integration.test.ts` (outside my listed paths, owned by no Stage 3 agent)
uploaded a selfie without a capture, which C40.7 now refuses (409 `selfie_capture_required`).
Changed minimally: its selfie creates a capture, sends the three capture fields with the pose and
submits naming the capture, and the expected events gain `selfie.created` and
`selfie.submitted`.

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/api.integration.test.ts
Tests  4 passed (4)
```

## 10. `@openverify/node` (C40.1)

- Stub (`packages/node/src/client.ts`): `selfies.retrieve` (rejects), `include` parameters typed
  on `inquiries.retrieve` (`InquiryInclude` or a list) and `verifications.retrieve`
  (`'selfies'`), not sent yet.
- RED (`packages/node/src/resources.test.ts`): three endpoint cases and the resource group list.

  ```
  $ pnpm --filter @openverify/node exec vitest run src/resources.test.ts --coverage.enabled=false
  × inquiries.retrieve with its captures (C40.1)        OpenVerifyResponseValidationError: The API answer does not match the contract
  × verifications.retrieve with its captures (C40.1)    expected '.../api/v1/verif…' to be '.../api/v1/verif…'   (no ?include=selfies)
  × selfies.retrieve                                    Error: Selfie capture self_…: not implemented yet (stub)
  Tests  3 failed | 79 passed (82)
  ```
- GREEN: `selfies.retrieve` (`selfieCaptureDocumentSchema`); `inquiries.retrieve(id, { include })`
  sends one name or a comma list and parses `inquiryIncludeDocumentSchema`;
  `verifications.retrieve(id, { include: 'selfies' })` sends it (`includeQuery`). The e2e suite,
  which reads `data` only, still typechecks.

  ```
  $ pnpm --filter @openverify/node exec vitest run --coverage.enabled=false
  Test Files  7 passed (7)
  Tests  212 passed (212)
  $ (cd e2e && pnpm exec tsc --noEmit)      # no errors
  ```

## 11. Contract builder coverage

`packages/contracts/src/selfie-relationships.test.ts` covers the builders' new members directly
(the API RED tests proved them first): the inquiry `selfies` relationship and
`inquiryIncludeDocumentSchema`, a selfie verification's `selfies` and C40.10 attributes only when
the record carries them, and the inquiry session's `consent` (recorded, `null`, or left out).
`@openverify/contracts` is back to 100% statements.

```
$ pnpm --filter @openverify/contracts test
Test Files  47 passed (47)
Tests  1405 passed (1405)
```

## 12. OpenAPI snapshot

Regenerated twice; the second run changed nothing.

```
$ pnpm --filter @openverify/api openapi:write
Snapshots  1 updated
Tests  11 passed (11)
docs/api/openapi.json | 380 ++++++++++++++++++++++++++++++++++++++++++++++----
$ pnpm --filter @openverify/api openapi:write
Tests  11 passed (11)
$ cmp docs/api/openapi.json <copy after the first run>      # identical
```
The snapshot gains the create, upload and submit descriptions, `GET /selfies/:id` without its
501, `include` on `GET /verifications/{id}`, the comma list on `GET /inquiries/{id}` and the
included captures.

## 13. Guard: no nonce or device label in the API logs

`selfie-flow-contract.test.ts` gains a guard: after a full capture with a device label, the
environment's API logs (the control: a server API call of the same environment is logged) hold
no flow route, no nonce and no label. Flow calls have no principal, so they are never logged;
the guard passed when written.

```
$ pnpm --filter @openverify/api exec vitest run src/routes/flow/selfie-flow-contract.test.ts --coverage.enabled=false
Tests  3 passed (3)
```

## Final gates (foreground)

```
$ pnpm typecheck                     # Tasks: 12 successful, 12 total
$ pnpm lint                          # Tasks: 12 successful, 12 total
$ pnpm format:check                  # All matched files use Prettier code style!
$ pnpm --filter @openverify/api test
Test Files  124 passed (124)
Tests  2441 passed (2441)
All files  97.37 | 90.3 | 98.35 | 97.41
$ pnpm --filter @openverify/db test
Test Files  54 passed (54)
Tests  677 passed (677)
All files  98.82 | 91.8 | 99.29 | 98.76
$ pnpm --filter @openverify/contracts test      # 1,405 tests, 100% statements
$ pnpm --filter @openverify/node test           # 212 tests, 99.09 | 94.69 | 100 | 99.37
$ pnpm test:integration
@openverify/api: Test Files 14 passed (14), Tests 62 passed (62)
@openverify/db:  Test Files 8 passed (8),  Tests 46 passed (46)
$ pnpm --filter @openverify/api openapi:write   # twice; the second run changed nothing
$ flock /tmp/openverify-e2e.lock pnpm e2e        # with the Stage 1 selfie exclusion
@openverify/flow:e2e:  38 passed (15.8s)
@openverify/e2e:e2e:   36 passed (3.6m)
Tasks:    9 successful, 9 total
$ pnpm --filter @openverify/dashboard exec vitest run --coverage.enabled=false   # regression check
Test Files  174 passed (174)
Tests  1657 passed (1657)
```

One earlier `pnpm test:integration` run, at a load average of 17 on 12 cores from the parallel
agents, failed `packages/db/src/query-plans.integration.test.ts` "serves an inquiry timeline
from the events object index (C25.7)" on its 30-second test timeout (it seeds the filler rows
first). It passed alone (14.9 s) and in the whole run at a load of 9 (above). The test is not
api-flow's; making it independent of load (a longer timeout for its seeding) is a follow-up.
