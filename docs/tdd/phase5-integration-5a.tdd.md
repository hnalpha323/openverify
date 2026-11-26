# TDD evidence: Phase 5, Workflow 5A Stage 4, `integration-5a`

The integration of Workflow 5A (plan "Stage 4: `integration-5a`"): the defects found when the
Stage 2 and 3 work met, the missing hooks the builders reported, the e2e provider bindings, the
four 5A full-stack specs, the route-schema changes, the CI changes and the final validation.
Commands ran from the repository root after `source scripts/env.sh` unless a section says
otherwise; outputs are abbreviated to the lines that matter.

## 0. Starting state (`150059a0`)

- `flow-5a` stopped twice without a report. Its last run committed the database and AAMVA form
  stub (`58f0da09`) and its RED tests (`d4d1f60c`), then ended with "API Error: Output blocked by
  content filtering policy" while writing the GREEN. The web flow's suite was therefore red on
  `main`:

  ```
  $ (cd apps/flow && pnpm exec vitest run --coverage.enabled=false)
   Test Files  5 failed | 56 passed (61)
        Tests  26 failed | 876 passed (902)
  ```

  The 26 are flow-5a's RED cases: the database and AAMVA form (18), the silent step (3), the
  renderer (3), and the code and wallet steps' "no photo words" cases (one each).
- Every other Stage 2 and 3 agent reported `done`; their reports were read from the run's
  journal, because the task text that carried them was cut off.

## 1. The database and AAMVA forms and the silent AAMVA wait (C64.1, C52.3, C59.6)

Finishing `flow-5a`'s last slice: its RED commit (`d4d1f60c`) stands as the RED of this GREEN.

- **RED corrected for an amendment** (`fb2b50e8`, `test(flow)`). `api-database` made the inputs
  route require, for every database body, the step's `requiredFields` and always the three
  `DATABASE_REQUIRED_FIELDS` (`name-first`, `name-last`, `address-country-code`), and serves
  that union as guidance `required-fields`. The first GREEN run, with the client requiring the
  same set before any request, failed seven of flow-5a's cases that leave the country empty:

  ```
  $ (cd apps/flow && pnpm exec vitest run src/steps/forms src/flow/flow-renderer.test.tsx --coverage.enabled=false)
       × runs a database step from its form to the completion screen
       × sends a phone number typed with spaces in E.164
       × shows a 422 refusal at the field its pointer /birthdate names
       × shows a 400 refusal at the field its pointer /data/attributes/birthdate names
       × says some details were refused when no pointer names a field on the screen
       × explains a request that failed, and sends again on request
       × reloads the session when the verification has moved on
        Tests  7 failed | 166 passed (173)
  ```

  Each case now chooses a country (the phone case's expected body gains `address-country-code`),
  and the fake flow API requires the server's set and serves it as guidance. No assertion about
  what the form does was changed.
- **GREEN** (`993d9670`, `feat(flow)`):
  - `steps/forms/fields.ts`: the database fields in `DATABASE_FIELDS` order and the AAMVA form's
    eight members, each checked with its contract schema (`databaseInputsSchema.shape`,
    `aamvaInputsSchema.shape`): empty and required, too long (the schema's maximum), or of the
    wrong shape (date, E.164 after removing spaces, parentheses, dots and dashes, email, ZIP);
    `memberOfPointer` reads `/member` and `/data/attributes/member`.
  - `steps/forms/regions.ts`: countries from libphonenumber's region list named by
    `Intl.DisplayNames` in the user's language (no country list is written out), and the 56
    `US_JURISDICTIONS` in English, with the Spanish names that differ.
  - `components/form-field.tsx` and `select-field.tsx`: the `*` of a required field sits beside
    its label, not in it, so the label is the field's name alone; the select gains a placeholder
    and an error.
  - `EnteredValuesStep`: the verification is created once (`ensureVerification`), the values
    entered without the empty ones, then submitted; a 400 or 422 marks the fields its pointers
    name (or says some details were refused); a 409 reads the session; a resumed attempt with
    `inputs-received` offers "Send for checking".
  - `SilentStep`: polls the session until the server has created and decided, or skipped, the
    attempt.
  - `entryErrorMessageKey`: a 400 or 422 on a screen where the user typed is "This was not
    accepted. Check what you entered and try again.", never the photo message; the code and
    wallet steps use it. Its five unit cases were written with the GREEN (the component cases
    were the RED).

  ```
  $ (cd apps/flow && pnpm exec vitest run --coverage.enabled=false)
   Test Files  61 passed (61)
        Tests  908 passed (908)
  $ (cd apps/flow && pnpm test)
  All files          |   96.46 |     89.9 |   97.18 |   96.49 |
   src/steps/forms   |     100 |    89.74 |     100 |     100 |
  $ (cd apps/flow && pnpm typecheck && pnpm exec eslint src)   # clean
  ```

  Commits: `fb2b50e8` (test), `993d9670` (feat).

## 2. The e2e provider bindings (C63, V23)

- **RED** (`cdccc796`): `e2e/src/env.test.ts` asserts `sms`, `database`, `aamva` and `evmRpc` are bound to `sandbox` for sandbox environments and empty for production, no provider names a network adapter, the Twilio credentials and RPC URLs are empty (a shell value does not leak through `childEnvironment`), and the C44 kinds stay unbound. The old test listed AAMVA among the unbound kinds; AAMVA left that list (V23).

  ```
  $ (cd e2e && pnpm exec vitest run src/env.test.ts --coverage.enabled=false)
       × binds the 5A providers to their sandbox for sandbox environments only (C63, V23)
       × binds no network provider and carries no provider credential, whatever the shell says (C63)
  AssertionError: SMS: expected undefined to be 'sandbox'
  AssertionError: OPENVERIFY_TWILIO_ACCOUNT_SID: expected undefined to be ''
        Tests  2 failed | 14 passed (16)
  ```
- **GREEN** (`f098be7e`): `generateE2eEnv` binds the four kinds and empties the credentials.

  ```
        Tests  16 passed (16)
  ```

## 3. The skip hook and `completed_at` (C50.7, C54.1, C59.5)

- **db RED** (`a8641984`) and **GREEN** (`c6a546ff`): a verification moved `initiated` or `submitted` to `skipped` gets `completed_at`.

  ```
  $ (cd packages/db && pnpm exec vitest run src/repositories/verifications-v3.test.ts --coverage.enabled=false)
       × ends processing of a initiated verification the server skips, stamping completed_at
       × ends processing of a submitted verification the server skips, stamping completed_at
  -   "completedAt": 2026-10-23T12:00:00.000Z,
  +   "completedAt": null,
        Tests  2 failed | 7 passed (9)
  (GREEN)
        Tests  19 passed (19)    # with verifications.test.ts
  ```
- **Stub** (`20f989a2`): `TypeEvaluation.skip?` and `DecidedStatus` gains `skipped`, unused.
- **RED** (`dad8ddbd`): through the recording `document` job of `jobs/type-hooks.test.ts`, an evaluation with `skip: true` and passing checks must end `skipped` with its checks, `completed_at`, `verification.skipped` before the decision hook's event, the decision hooks, `afterCommit` and the settlement. The second case (a verification another job decided first is left as it is) passed at once: it pins the existing conditional update.

  ```
  $ (cd apps/api && pnpm exec vitest run src/jobs/type-hooks.test.ts --coverage.enabled=false)
       × moves the verification submitted to skipped with its checks and verification.skipped, runs the type and decision hooks, then settles
  -   "verificationStatus": "skipped",
  +   "verificationStatus": "passed",
        Tests  1 failed | 4 passed (5)
  ```
- **GREEN** (`681b2cd1`): `processVerification` takes `skip` as the status; `ProcessVerificationResult.verificationStatus` widens to `DecidedStatus`.

  ```
        Tests  5 passed (5)
  ```
- **Refactor** (`cbb432ef`): the AAMVA job returns `skip: aamvaSkipsVerification(...)` and loses its own skip transaction.

  ```
  $ (cd apps/api && pnpm exec vitest run src/jobs/process-aamva.test.ts src/jobs/silent-aamva.test.ts src/jobs/type-hooks.test.ts src/jobs/database-contract.test.ts --coverage.enabled=false)
   Test Files  4 passed (4)
        Tests  42 passed (42)
  $ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs/aamva-race.integration.test.ts)
        Tests  4 passed (4)
  ```

## 4. A deterministic leak search (the `CA` collision)

- **RED** (`3d89abdc`): the dashboard case's AAMVA verification gets the fixed id `ver_01M5MYNQF59Z6NRCAFSWWNYM7Z`, whose letters hold `CA`, the AAMVA state the test searches for. The search then fails on every run instead of when a random id happens to hold it.

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/attributes/database-exits.test.ts --coverage.enabled=false)
       × aamva: shown to a reviewer with pii:view, masked for a viewer
  AssertionError: expected '{"type":"verification/aamva","id":"ve…' not to contain 'CA'
        Tests  1 failed | 11 passed (12)
  ```
- **GREEN** (`6a808f3d`): `expectNoValue` searches each value as a JSON string (`"CA"`), which a masked member would be if it leaked.

  ```
        Tests  12 passed (12)
  ```

## 5. The inputs route's refusals are 422s with pointers (C52.3, C54.2)

- **RED** (`663e5dfc`):

  ```
  $ (cd apps/api && pnpm exec vitest run src/routes/flow/inputs.test.ts --coverage.enabled=false)
       × refuses a name over 200 characters with a pointer to it, not a route-level 400
       × refuses an issuing authority outside the US jurisdictions with a pointer to it, not a route-level 400
  AssertionError: expected 400 to be 422
        Tests  2 failed | 18 passed (20)
  ```

  The third new case (a body that is no object keeps the 400) passed at once and pins it.
- **GREEN** (`9102e528`): `attachValidation: true`; the handler rethrows the validation error only for a body that is not a JSON object.

  ```
  $ (cd apps/api && pnpm exec vitest run src/routes/flow/inputs.test.ts src/routes/flow/verification-mutations.contract.test.ts --coverage.enabled=false)
        Tests  52 passed (52)
  $ (cd apps/api && pnpm exec vitest run src/openapi.test.ts --coverage.enabled=false)
        Tests  13 passed (13)      # the snapshot is unchanged
  ```

## 6. The budget's own limit name (C55.7)

- **RED** (`256dcf89`): the contracts test lists `otp-sms-max-per-hour` among `OTP_LIMIT_NAMES` with `{ budgetShare: 1, windowSeconds: 3600 }`, and the limits test expects the last rule of an SMS send to be named `otp-sms-max-per-hour`.

  ```
  $ (cd packages/contracts && pnpm exec vitest run src/phase5-flow-bodies.test.ts --coverage.enabled=false)
       × name their own limits outside the C12 policies (a C12 amendment)
  $ (cd apps/api && pnpm exec vitest run src/services/otp/limits.test.ts --coverage.enabled=false)
       × counts an SMS send per address, inquiry, destination, prefix, country and budget, in that order
  ```
- **GREEN** (`802a7dfd`). The route test that refuses the budget by rule name (`routes/flow/otp.test.ts`) failed after the change (`expected 200 to be 429`), because its controllable limiter keys on `otp-sms-country-hour|<env>|budget`; it now names the new rule, in the GREEN commit.

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/otp src/routes/flow/otp.test.ts --coverage.enabled=false)
        Tests  122 passed (122)
  $ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/otp/limits.integration.test.ts)
        Tests  9 passed (9)
  ```

## 7. The golden crypto wallet fixture (C52.8, C57.1)

- **RED** (`9dd82a71`): a contract test runs the validity evaluator on the fixture's address and compares its status, metadata and thresholds with the fixture's.

  ```
  $ (cd apps/api && pnpm exec vitest run src/jobs/crypto-wallet-contract.test.ts --coverage.enabled=false)
       × shows the validity metadata and thresholds the evaluator writes for its address
  -     "address-type": "evm",
  -     "checksum": "absent",
  +     "checksum": "valid",
        Tests  1 failed | 2 passed (3)
  ```
- **GREEN** (`192fe2b9`): the fixture's metadata is `{ checksum: 'absent', 'address-type': 'evm' }`.

## 8. The e2e setup fetches the data files (C56)

- **Stub** (`4ea9da9b`) `FETCH_DATA_ARGS = []`; **RED** (`f89f28db`):

  ```
  $ (cd e2e && pnpm exec vitest run src/assets.test.ts --coverage.enabled=false)
       × fetches every file in data/manifest.json, as the CI e2e job does, so the worker reads the disposable list
        Tests  1 failed | 9 passed (10)
  ```
- **GREEN** (`a8e012fb`): `['scripts/fetch_data.py']`, run by the global setup after the models.

## 9. The CI SDK host-test floor

- **RED** (`946f5a8a`):

  ```
  $ bash infra/tests/ci-workflow.test.sh
  FAIL - android: the test-count floor fails with one test fewer than the floor (1175) (exit 0: SDK host tests: 1175 in 2 classes, 0 skipped, 0 failed; the floor is 928)
  FAIL - android: the test-count floor fails at the migration's earlier floor of 928 (exit 0: …)
  # 156 passed, 2 failed, 0 skipped
  ```
- **GREEN** (`794b7051`): `ci.yml` checks at least 1,176.

  ```
  # 158 passed, 0 failed, 0 skipped
  ```

## 10. Non-photo wording in the web flow (C64.1)

- **RED** (`784abf56`), **GREEN** (`4801b3dc`): a database verification being processed is titled "Checking your verification".

  ```
  $ (cd apps/flow && pnpm exec vitest run src/flow/flow-renderer.test.tsx --coverage.enabled=false)
       × says the details are being checked, not photos, while a database verification is processed
  TestingLibraryElementError: Unable to find role="heading" and name "Checking your verification"
        Tests  1 failed | 37 passed (38)
  (GREEN)
        Tests  909 passed (909)     # the whole flow suite
  ```
- **RED** (`31307274`), **GREEN** (`e56106a6`): the retry hints of a failed wallet attempt are not titled with photos.

  ```
       × says why the last wallet attempt failed without speaking of photos
  Error: expect(element).not.toBeInTheDocument()
    We could not use your last photos
  (GREEN)
        Tests  910 passed (910)
  ```

## 11. Android: the required database members (C52.3)

- **RED** (`8f73a652`):

  ```
  $ (cd android && ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorFormTest')
  23 tests completed, 1 failed
  expected: <Form(... required=[NAME_FIRST, NAME_LAST, BIRTHDATE, ADDRESS_COUNTRY_CODE] ...)> but was: <Form(... required=[BIRTHDATE] ...)>
  ```
- **GREEN** (`9854844c`): the union of the step's required fields and the three.

  ```
  $ (cd android && ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest)
  tests 1177 skipped 0 failed 0
  ```

## 12. `@openverify/node`: the sandbox SMS sink (C55.11)

- **Stub** (`000af6b0`): `sandboxSmsMessages.search` rejects; the existing "covers every resource group" case already fails on the new group.
- **RED** (`5792f176`):

  ```
  $ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
       × sandboxSmsMessages.search
  Error: sandboxSmsMessages.search is not built yet
        Tests  1 failed | 82 passed (83)
  ```
- **GREEN** (`3f33c715`):

  ```
  $ (cd packages/node && pnpm test)
        Tests  226 passed (226)
  All files          |   99.09 |    94.69 |     100 |   99.38 |
  ```

## 13. The four full-stack specs (C65.5)

Written on the built stack, so they pin behaviour rather than drive it. Each was run alone under the lock (`flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/<spec>.spec.ts'`). First runs and their corrections:

- `phone-otp` (`ec877035`): the first run failed only on the console check: Chromium logs the wrong code's 422 as `Failed to load resource: … 422`. The spec now expects exactly that one entry. Then `✓ (6.1s)`.
- `email-otp` (`e1ed79b8`): the first run expected `requirement: 'advisory'`; the API writes `not_required`. Then `✓ (4.7s)`.
- `crypto-wallet` (`2afc1af1`): the first run expected a check `type` member, which the resource does not carry; it asserts the `category` instead. Then `3 passed`.
- `database` (`e3dc2dd5`): `5 passed` on its first full run (a type error, a selfie capture in `included` has no `checks`, was fixed before it).
- The phone spec reads the sink through `@openverify/node` since `819bf93f`: `✓ (5.9s)`.

## 14. Final gates (all in the foreground, on `b574f535` and the documentation after it)

```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile    # Done in 90ms
$ pnpm format:check                                                 # passed, 32 s
$ pnpm turbo run lint typecheck --force
 Tasks:    24 successful, 24 total        Time: 2m16s
$ pnpm turbo run test --force
 Tasks:    12 successful, 12 total        Time: 8m02s
   api 3,327 · dashboard 1,946 · checks 2,223 · contracts 1,778 · flow 910 · db 770
   core 711 · node 226 · flow-spec 113 · e2e 82 · config 68 · ui 54   (12,208 tests)
$ pnpm turbo run test:integration --force
   api 102 (20 files) · db 52 (10 files)  Time: 1m33s
$ python3 scripts/fetch_models.py && python3 scripts/fetch_data.py   # every file present
$ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest -q)
1925 passed in 307.94s; Total coverage: 99.81%
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 2m 10s; SDK host tests 1177 in 61 classes, 0 skipped; demo 18; Kover lines 2925/2987 (97.92%)
$ pnpm --filter @openverify/api openapi:write && git diff --exit-code docs/api/openapi.json
(no diff; sha256 382a8676d25a3e9bd7ee21ffb4608ca04317e7009f35f3347509eab4f8013ce9)
$ flock /tmp/openverify-e2e.lock pnpm e2e                            # 7m32s wall
   flow (mocked) 38 passed (12.4s); full stack 60 passed (7.3m)
   crypto-wallet 3.2 + 3.2 + 3.0 s · database 3.3 + 1.3 + 1.2 + 3.4 + 1.2 s · email-otp 4.5 s · phone-otp 5.7 s
$ docker build -f infra/docker/apps.Dockerfile .                     # passed, 2m17s; the image carries data/disposable_email_blocklist.conf (sha256 e3bd7355…0f79)
$ docker build services/vision                                       # passed
$ for t in infra/tests/*.test.sh; do bash "$t"; done
   apps-image-context 12 · check-connected-results 11 · ci-workflow 158 · compose 278 · install-gitleaks 9 · pre-commit-hook 11 (all passed)
$ gitleaks git --redact .
1877 commits scanned. no leaks found
```
