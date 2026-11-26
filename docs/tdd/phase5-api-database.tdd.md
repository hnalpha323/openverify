# Phase 5, Workflow 5A Stage 3: `api-database` (TDD evidence)

The database and AAMVA verifications end to end on the API, and the inputs route Workflow 5B reuses (plan C52.3, C59; owned paths in the plan's `api-database` bullet). Every unit landed as a stub (where a name was missing), then RED, then GREEN, then pins written on built code where a branch or an exit was left out; each section names its commits and the commands actually run, with their output abbreviated. Commands run from the repository root after `source scripts/env.sh`; `pnpm --filter @openverify/api exec …` stands for running the same command inside `apps/api`.

Parallel agents (`api-otp`, `api-crypto`) committed to the same tree meanwhile; their RED tests appear in some wider runs, named where they do.

## 1. The verification inputs writes (C52.3, C53.2, C59.6)

Stub `076c0bf` (two typed constants that reject, so the stub lints). RED `d9d1c26`:
```
$ pnpm --filter @openverify/db exec vitest run src/repositories/verification-inputs.test.ts --coverage.enabled=false
     × writes the entered values sealed, with their names, from the flow
     × replaces earlier values and their names, keeping when they were first entered
     × refuses once the inputs were redacted, and leaves them redacted
     × never replaces values copied from a government ID
     × writes the copied values sealed to the new attempt and bound to the ID they came from
     × writes an empty copy for a skipped attempt, still bound to its ID
     × refuses a second copy for the same attempt
 Test Files  1 failed (1)
      Tests  7 failed | 1 passed (8)
```
Each failed on `Error: putEnteredVerificationInputs is not implemented yet` (or the copy's). The one that passed ("writes nothing for a verification of another environment") passes on the stub too; it pins the refusal.

GREEN `aa87a1a`: an upsert whose update is guarded (`environment_id`, `source = 'flow'`, `redacted_at is null`) and a plain insert for the copy:
```
$ pnpm --filter @openverify/db exec vitest run src/repositories/verification-inputs.test.ts src/repositories/phase5-repositories.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

## 2. The sandbox database provider (C59.2)

Stub `95646bc` (the token list, a provider that rejects). RED `0151b2d` (also replaces Stage 1b's factory stub test, `providers/database/index.test.ts`, which asserted the stub's rejection; this folder is ours):
```
$ pnpm --filter @openverify/api exec vitest run src/providers/database --coverage.enabled=false
     × binds the sandbox provider, which answers with a record that is not authoritative
     × echoes the values it was asked about in a record that is not authoritative
     × finds no record for sandbox-database-not-found, without authority
     × gives the formal given name of a nickname for sandbox-database-nickname, and a nickname of a formal one
     × reads whole tokens only, in any case, the first in precedence order winning
     × reference sandbox-database-no-birthdate: the identity check is not_applicable ["insufficient_data"]
     … (26 in all)
 Test Files  2 failed (2)
      Tests  26 failed | 1 passed (27)
```
Every failure was `ProviderError: The sandbox database provider is not built yet` (or the factory stub's). The label test passed on the stub.

GREEN `821409a`: static whole-token patterns in the selfie tokens' shape, an echo (a number only as `identification-number-match: true`), one change per token, `authoritative: false`; the last block runs `evaluateDatabaseChecks` with the default template on each answer:
```
$ pnpm --filter @openverify/api exec vitest run src/providers/database --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  27 passed (27)
```

## 3. The sandbox AAMVA endings (C59.4)

No stub was needed (the RED test names only the existing exports). RED `dea1b2c6`, which also changes the C35 expectation of `SANDBOX_MAGIC.aamva` (a test the plan changes):
```
$ pnpm --filter @openverify/api exec vitest run src/providers/sandbox.test.ts --coverage.enabled=false
     × is labelled sandbox
     × answers a number ending in 0001: the name only
     × answers a number ending in 0002: the postal code only
     × answers a number ending in 5555: a jurisdiction outside DLDV
 Test Files  1 failed (1)
      Tests  4 failed | 41 passed (45)
-   "outcome": "no_match",
+   "outcome": "match",
```
GREEN `e0f7c4df`: one table of answers by ending; the government ID job's tests are unchanged:
```
$ pnpm --filter @openverify/api exec vitest run src/providers/sandbox.test.ts --coverage.enabled=false
      Tests  45 passed (45)
$ pnpm --filter @openverify/api exec vitest run src/jobs/process-government-id.test.ts src/jobs/government-id-contract.test.ts --coverage.enabled=false
      Tests  39 passed (39)
```

## 4. The database and AAMVA flow views (C52.2)

The hook files were Stage 1b's stubs (`guidance: null`), so no stub commit. RED `44a823b3`:
```
$ pnpm --filter @openverify/api exec vitest run src/services/guidance/database.test.ts src/services/guidance/aamva.test.ts --coverage.enabled=false
     × names the collected members and, without requiredFields, the name and the country as required
     × adds the step requiredFields to them, in the step order
     × says the values were received once they were, without any value
     × gives no guidance without a database step
     × names the form source
     × names the government_id source
     × says the values were received once they were, without any value
     × gives no guidance without an AAMVA step
 Test Files  2 failed (2)
      Tests  8 failed (8)
-   "guidance": {
-     "fields": [
```
GREEN: `services/inputs/database.ts` (`inputNameOf`, `databaseCollectedInputs`, `databaseRequiredInputs`), and the two hooks:
```
$ pnpm --filter @openverify/api exec vitest run src/services/guidance --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

## 5. The inputs route and service (C52.3)

Stub `020ceda0` (the form types, a value cleaning that keeps everything, a business rule that requires nothing, a service that answers 501). RED `c748c4ef`:
```
$ pnpm --filter @openverify/api exec vitest run src/routes/flow/inputs.test.ts src/services/inputs/index.test.ts --coverage.enabled=false
     × removes C0 controls and bidirectional characters, then trims
     × cleans every value of an object and of an array, and leaves other values alone
     × requires the business name under the default groups
     × requires what every configured group names, as body members
     × seals the cleaned values, never echoes them, and answers the flow view with inputs-received
     × replaces the earlier values while the verification is initiated
     × refuses a member the step does not collect, with a pointer to it, and keeps nothing
     × refuses a body without a required member, with a pointer to each
     × refuses a value that cleaning empties
     × takes the AAMVA form, sealed
     × refuses a body without the members the form requires, pointing at each
     × answers 409 verification_created_by_server for the silent step
     × takes a business, sealed
     × refuses associated persons unless the step collects them
     × requires an input every configured match group names
     × takes a website, and refuses members of another type with a pointer to each
      6 AssertionError: expected 501 to be 422
      1 AssertionError: expected 501 to be 409
      5 Error: expected HTTP 200, got 501: {"type":"about:blank","title":"Not Implemented",...}
```
The tests that passed on the stub are the precondition answers (a submitted verification is 409, another type is 422), the letters of every script kept, a disabled identity check requiring nothing and the type list.

GREEN: `services/inputs/{index,rules,database,aamva,database-business,business-website}.ts` and the route handler:
```
$ pnpm --filter @openverify/api exec vitest run src/routes/flow/inputs.test.ts src/services/inputs src/routes/flow/verification-mutations.contract.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  53 passed (53)
```

## 6. The database and AAMVA attributes (C52.8, C53.7)

The hook files were Stage 1b's stubs (no attribute loaded). RED `d9a417e7`:
```
$ pnpm --filter @openverify/api exec vitest run src/services/attributes/database.test.ts src/services/attributes/aamva.test.ts --coverage.enabled=false
     × are every member null before values are entered or copied
     × name the form as the source of entered values
     × name the government ID as the source of copied values, and keep it once redacted
     × are every member null before values are entered
     × are the entered values, every other member null
     × are every member null once redacted
 Test Files  2 failed (2)
      Tests  6 failed | 2 passed (8)
```
(The two mask tests passed on the stub, which already masked with the C53.7 list.)

GREEN `b6bde4f2`:
```
$ pnpm --filter @openverify/api exec vitest run src/services/attributes/database.test.ts src/services/attributes/aamva.test.ts src/services/attributes/index.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  12 passed (12)
```
`c162953f` (`test`, written after the hooks, so it passed on its first run): the exits with the real hooks, for both types: `GET /verifications/:id` (a key, a reviewer, a viewer), `?include=verifications`, the `verification.*` payload through the Events API, a stored API log body, the dashboard inquiry document, and `null` after `redactInquiryRecords` even for a reviewer:
```
$ pnpm --filter @openverify/api exec vitest run src/services/attributes/database-exits.test.ts --coverage.enabled=false
      Tests  12 passed (12)
```
A mutation check (the database hook's `mask` made a copy that hides nothing) still passed: the resource builder masks the C53.7 list again (`maskVerificationResource`), so the exits are masked twice; the hook's own masking is pinned by the unit tests above.

## 7. The database and AAMVA publish rules (C50.4, H28)

The hook files were Stage 1b's stubs (no problem). RED `3f355bd3`:
```
$ pnpm --filter @openverify/api exec vitest run src/services/publish/database.test.ts src/services/publish/aamva.test.ts --coverage.enabled=false
     × refuses a production form step whose provider is unbound, pointing at the step
     × refuses a production government_id step whose provider is unbound, pointing at the step
     × refuses a production database step whose provider is unbound, pointing at the step
     × accepts it with accept-review-without-provider
     × answers 422 provider_not_configured in production, pointing into the attributes
 Test Files  2 failed (2)
      Tests  5 failed | 5 passed (10)
```
(The cases that expect no problem pass on the stub.)

GREEN `25d45bc6`: one rule, `providerPublishRule({ stepType, verificationType, kind })`, for both types:
```
$ pnpm --filter @openverify/api exec vitest run src/services/publish --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  12 passed (12)
```

## 8. The database job (C59.1, C59.3)

The job file was Stage 1b's `unbuiltTypeJob('database')`. RED `1d8dc2ff`:
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/process-database.test.ts --coverage.enabled=false
     × passes an identity the sandbox echoes, labelled sandbox, and completes the inquiry
     × asks about the country and the collected fields only, with the reference id for the sandbox
     × gives a real provider the request alone
     × fails another surname as low_confidence_match, and the inquiry with it
     × sends a thin file to review as insufficient_data
     × answers provider_not_configured without a bound provider, which goes to review
     × retries a failed provider, then records execution_error on the last attempt
     × asks no provider when no enabled check needs one
     × compares the values with the inquiry fields it was created with
     × puts no entered value in a check result or a log
      9 PermanentJobError: The job cannot succeed (unsupported_verification)
      1 AssertionError: expected PermanentJobError: … to be an instance of ProviderError
 Test Files  1 failed (1)
      Tests  10 failed (10)
```
GREEN: `jobs/types/database.ts` with `runnable: true` (and the shared `askProvider`, `enablesAny`):
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/process-database.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  10 passed (10)
$ pnpm --filter @openverify/api exec vitest run src/routes/flow src/jobs/types src/jobs/type-hooks.test.ts src/jobs/process-verification.test.ts --coverage.enabled=false
      Tests  1 failed | 395 passed (396)
```
The one failure is `routes/flow/otp.test.ts`, the parallel `api-otp` agent's RED test of that moment.

## 9. The AAMVA job and its skip (C59.4, C59.5, C50.7)

The job file was Stage 1b's stub. RED `076b4eae`:
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/process-aamva.test.ts --coverage.enabled=false
     × passes a record the sandbox matches, labelled sandbox, and completes the inquiry
     × asks the provider about the jurisdiction and the values alone
     × judges the sandbox ending of D1230000: identity failed ["record_mismatch"], name failed ["name_mismatch"], number passed []
     × judges the sandbox ending of D1230001: …
     × judges the sandbox ending of D1230002: identity failed ["record_mismatch"], name passed [], number passed []
     × judges the sandbox ending of D1239999: …
     × passes a postal code mismatch the template ignores
     × sends a form outside DLDV to review by default
     × skips a form outside DLDV when the template says so, and the inquiry completes
     × always skips the silent step outside DLDV (C59.6)
     × answers provider_not_configured without a bound provider, which goes to review
     × retries a failed provider, then records execution_error on the last attempt
     × puts no value in a check result or a log
      9 PermanentJobError: The job cannot succeed (unsupported_verification)
 Test Files  1 failed (1)
      Tests  13 failed (13)
```
GREEN `f60b4b39`: `jobs/types/aamva.ts` with `runnable: true`. The job (`process-verification.ts`, a C54 shared file) decides only passed, failed or needs_review, so the skip is written in `evaluate`, in its own transaction with the job's lock order and redaction re-check; the job then finds the verification `skipped` and settles the inquiry (contract deviation). One RED expectation was corrected: it asserted `completed_at` on the skipped verification, which `setVerificationStatus` (packages/db) stamps only on passed, failed and needs_review.
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/process-aamva.test.ts src/jobs/process-database.test.ts src/jobs/types --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  43 passed (43)
```

## 10. The silent AAMVA hook (C59.6, V02, V06)

No stub (the hook is optional on the job interface, so the RED test compiles and finds none). RED `ac2ca315`:
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/silent-aamva.test.ts --coverage.enabled=false
     × a passed decision on a US drivers_license read from {…} creates a submitted attempt bound to it and enqueues it
     × a passed decision on a passport creates a skipped attempt
     × a passed decision on the State Department card, which has no AAMVA jurisdiction creates a skipped attempt
     × a final failure skips the step, even on an eligible licence
     × a retryable failure with an attempt left creates nothing; the last one skips
     × creates nothing for another type, a form AAMVA step, a flow without one, or a decided inquiry
     × never creates a second attempt for one ID decision
     × an ID reviewed on a passport, then passed on a US licence: skipped, then a new submitted attempt (V02)
     × a new eligible decision gets its own attempt while an earlier one is still bound to another ID
     × a US licence read from its barcode: the attempt is created, judged and the inquiry completes
     × a failure the job cannot finish skips the step, and the inquiry fails with the ID
     … (20 in all)
      Error: the aamva job has no decision hook
      AssertionError: expected undefined to be 'submitted'
      AssertionError: expected [] to deeply equal [ 'skipped' ]
 Test Files  1 failed (1)
      Tests  20 failed | 1 passed (21)
```
Before the commit, two RED-only corrections: the State Department IIN (`636027`, not Coahuila's `636056`), and the end-to-end ID's template, which judges only the synthetic barcode card's printed expiry (its other required checks fail on the fixture: no portrait, missing AAMVA mandatory elements). The one test that passed ("the silent step last after a skipped attempt") pins Stage 1b's settlement.

GREEN: `aamvaValuesOfExtraction` (the C59.6 predicate: class `drivers_license` or `national_id` established by the document, an AAMVA IIN of a US jurisdiction, name, birth date and number, the AAMVA body schema as the last word) and `onInquiryVerificationDecided`:
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/silent-aamva.test.ts src/jobs/process-aamva.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  34 passed (34)
$ pnpm --filter @openverify/api exec vitest run src/jobs src/services/inquiry-settlement.test.ts --coverage.enabled=false
 Test Files  26 passed (26)
      Tests  413 passed (413)
```

## 11. The expiry job's follow-up, the submit and cancel hooks (K201, C54.1, C52.6, C53.6)

Stage 1a found K201 fixed (`runInquiryExpiry` takes `storage`), and Stage 1b routed every cancel path, the expiry included, through the per-type cancel hooks. What was left was to pin that for Phase 5 and to say it: `0a8c7479` (`test`, written on the built code, so it passed on its first run) replaces the document cancel hook by one that returns a stored object and shows the expiry cancels `initiated` and `confirmed` verifications, runs the hook in the batch, dispatches, and only then deletes the object with its own storage; a canceled database or AAMVA attempt keeps its entered values (they are the attempt's evidence, under retention and redaction). The same commit pins that a database or AAMVA form submits only after its values (409 `inputs_required`), answers 202 and enqueues, and then refuses new values (409).
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/inquiry-expiry-cancel-hooks.test.ts --coverage.enabled=false
      Tests  2 passed (2)
$ pnpm --filter @openverify/api exec vitest run src/routes/flow/inputs.test.ts --coverage.enabled=false
      Tests  16 passed (16)
```
`b623f0e1` (`docs`): the expiry job's header (initiated and confirmed, each type's cancel hook, deletion after the batch), and the database and AAMVA submit guards and cancel hooks (no sub-resource; values kept). The K201 warning keeps its text (`capture objects …`), which a Phase 4 test reads.

While writing these, `api-otp`'s phone publish hook landed: a template with a `phone_otp` step needs an SMS sender bound for its environment kind, so the shared `phase5TemplateAttributes()` no longer creates in a harness without one. The inputs test's silent-step case now builds its own template (consent, ID, selfie, the silent AAMVA step).

## 12. The database and AAMVA contract test (C51.2)

`6d63e472` (`test`): `DATABASE_EVALUATOR_REASONS` (checks) equals `DATABASE_CHECK_REASONS` (contracts) per check, as sets (`checks-matching` lists them in table order, contracts by shared reasons first); and every result over the sandbox answers (each database token, each AAMVA ending, both AAMVA sources, an authoritative miss, an unsupported country, unbound and failed providers, no values, a PO box, a prefilled inquiry) parses as a C29 result, carries only listed reasons (34 distinct pairs reached) and no entered value. The two lists already agreed, so it passed on its first run.
```
$ pnpm --filter @openverify/api exec vitest run src/jobs/database-contract.test.ts --coverage.enabled=false
      Tests  2 passed (2)
```
A slip, disclosed: `6d63e472` was committed after a typecheck whose error (an AAMVA value may be `null`) I had not read; `ae9b4d96` (`fix`) narrowed it to text values three minutes later. From then on every commit waited for `tsc --noEmit` to exit 0.

## 13. Race tests against Postgres (C40.6, C53.6)

Written on the built writers (a race test pins a lock order; each passed on its first run), in the patterns of `selfie-race.integration.test.ts` and `selfie-capture-races.integration.test.ts`:
- `30c3fcb6` `services/inputs/inputs-races.integration.test.ts`: entered values wait for a redaction holding the inquiry lock, then 410 and nothing stored; a redaction waits for the writer's transaction (its locks and upsert) and nulls the values; entered values wait for a submit (409) and for the expiry (409); two bodies at once both commit and the last stays.
- `aamva-race.integration.test.ts`: the ID decision on the barcode card (extraction, then the silent attempt's copy, in one transaction) with a redaction started inside it: the redaction waited, then the extraction's fields and the copied values are both `null` and the attempt stays bound; a decision after a redaction (`PermanentJobError inquiry_redacted`) writes neither; the skip waits for a redaction and leaves the verification `submitted`; two jobs of one non-participating verification skip it once (one `verification.skipped`).
```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/services/inputs/inputs-races.integration.test.ts
      Tests  5 passed (5)
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/aamva-race.integration.test.ts
      Tests  4 passed (4)
```


## 14. Final gates (foreground, on the tree after `b6aec092`)

```
$ pnpm typecheck
 Tasks:    12 successful, 12 total           (1m11s)
$ pnpm lint
 Tasks:    12 successful, 12 total           (1m40s)
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm --filter @openverify/api test          # 80% gate
 Test Files  195 passed (195)
      Tests  3314 passed (3314)
All files          |   97.39 |    90.29 |    98.8 |    97.4 |
$ pnpm --filter @openverify/db test           # 80% gate
 Test Files  60 passed (60)
      Tests  768 passed (768)
All files          |   98.71 |    92.12 |   99.37 |   98.64 |
$ pnpm test:integration                       # Testcontainers, 1m49s
@openverify/api:test:integration:  Test Files  20 passed (20)   Tests  102 passed (102)
@openverify/db:test:integration:   Test Files  10 passed (10)   Tests  52 passed (52)
$ flock /tmp/openverify-e2e.lock pnpm e2e     # 10m07s wall
@openverify/flow:e2e:   38 passed (16.1s)
@openverify/e2e:e2e:   50 passed (9.8m)
```
The API and db figures include the parallel `api-otp` and `api-crypto` agents' tests committed at the time. My own files, measured on my tests alone: 95.76% statements, 85.17% branches, 98.38% functions, 95.59% lines (the uncovered lines are defensive: a template version that is gone, a flow without the type's step reached through the preconditions, a silent attempt that cannot leave `initiated`).
