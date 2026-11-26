# TDD evidence: Phase 5, Workflow 5B Stage 4, `integration-5b`

The integration of Workflow 5B (plan "Stage 4: `integration-5b`"): the defects found when the Stage 2 and 3 work met (most of them by running vision's real analysis over the generated sets), the missing hook and route-schema notes the builders reported, the three 5B full-stack specs, vision's isolation and the images, the CI changes, the docs, the plan amendments and the full validation. Commands ran from the repository root after `source scripts/env.sh` unless a section says otherwise; outputs are abbreviated to the lines that matter. Commits are `6a02af5e..72937dda` (37), each path-scoped.

## 0. Starting state (`c3b4d4fa`)

Every Stage 1 to 3 agent reported `done` with no blocker. Their reports were read in full from the run's journal (the task text that carried them was cut off after the `emrtd` report).

## 1. A real-analysis harness (scratch, not committed)

To see the Stage 2 and 3 work meet on real inputs, a scratch script ran vision's `document_analysis.analyze_document` in process with the real PP-OCRv6 models over the generated sets, and a second judged each analysis with `evaluateDocument` exactly as `jobs/types/document.ts` does (the sidecar's `inquiry_fields` as the inquiry reference, the five classes accepted, `now` the sidecar's `read_on`):

```
$ (cd services/vision && uv run --frozen python <scratch>/analyse.py fixtures/generated/poa <out> <47 main-set files>)
refused en/utility-bill/password-protected.pdf 422 pdf_encrypted        real 0m44.574s
$ (cd services/vision && uv run --frozen python <scratch>/analyse.py fixtures/generated/poa-held-out <out> <59 files>)   real 0m52.265s
$ (cd packages/checks && tsx <scratch>/judge.ts …)   48 lines differ from the sidecars
```

The differences that were defects, each traced to its cause:

- every US addressee read `MERIDALE, UT 00041` as street 2 `MERIDALE` and city `UT` (the document's `blockAddress` split the postal line at its comma before `addressFromLines` saw it);
- the English and Spanish tax documents failed `name_not_found`: the walk up from the postal line ran through a `Label: value` line (`Employer identification number: …`, `Pagador: …`), so the block's top line was no name;
- both leases took the landlord's address above the labelled tenant, and neither read its term written as a clause, so recency answered `input_missing` and expiry `feature_absent`;
- every Spanish address comparison failed: `Calle del Puerto 27, 2B` read `2B` as the house number (the matching library).

The rest are not defects: fabrication reasons are what a failure "must include" (the sidecars' semantics), `null` is left open by C60.6, vision measures a copy-move score of 0.0 on the generated 14×21 px patch (a stated limit), and the Spanish lease names its tenant in a prose clause (a stated limit).

## 2. The NFC outcomes row (C51.2)

- **RED** (`6a02af5e`, `test(checks)`): a passed expiry within 30 grace days carries `expired_within_grace_period`, which its row must list.

  ```
  $ pnpm --filter @openverify/checks exec vitest run src/nfc/evaluate.test.ts --coverage.enabled=false
  AssertionError: id_nfc_expired_detection passed expired_within_grace_period: expected [] to include 'expired_within_grace_period'
        Tests  1 failed | 9 passed (10)
  ```

  The first draft computed the expiry from `Date.now()`, while `nfcInput`'s clock is fixed on 2026-10-23, and failed for that reason (`reasons: []`); it was corrected to `261001` before the commit.
- **GREEN** (`7844fe5c`): `src/nfc` 8 files, 82 passed; the API's NFC reasons contract 14 passed. A refactor (`6683b79e`) corrected that contract's stale comment.

## 3. The self-test at worker start (C62.9, api-nfc's missing hook)

- **RED** (`e0452045`): `startWorkers` runs the memoised `nfcSelfTest` once, with the worker logger, before any job (a `vi.mock` wraps the real function with a spy).

  ```
  $ pnpm --filter @openverify/api exec vitest run src/worker.test.ts --coverage.enabled=false
  AssertionError: expected [] to deeply equal [ [ { entries: [], …(3) } ] ]
        Tests  1 failed | 34 passed (35)
  ```
- **GREEN** (`034714c0`): `startWorkers` (which `main()` calls) runs `nfcSelfTest(logger)` first. 35 passed. It sits in `startWorkers` rather than after it in `main()`, as api-nfc suggested, because `startWorkers` is the part tested with fakes.

## 4. Units after a comma (C58.4)

- **RED** (`ec781072`): `Calle del Molino 27, 2B` equals the same door on its own line and `Calle del Molino, 27, 2B`; another door is `none`; no door on one side is `partial`; a comma before the number is no unit.

  ```
  $ pnpm --filter @openverify/checks exec vitest run src/matching/addresses.test.ts --coverage.enabled=false
  AssertionError: expected 'none' to be 'full' // Object.is equality
        Tests  1 failed | 32 passed (33)
  ```
- **GREEN** (`a3264a91`): `readAddress` reads a line's comma parts in order; a part holding only unit ids, once the street has its number, is the unit. The line is capped at the address limit before it is split.

  ```
  $ pnpm --filter @openverify/checks exec vitest run src/matching src/database src/document src/business --coverage.enabled=false
   Test Files  39 passed (39)      Tests  975 passed (975)
  ```
- **Pin** (`f8d4871e`, written after the code): a street line of 100 KB of doors after commas compares within 200 ms.

## 5. The addressee block and lease terms (C60.5)

- **RED** (`2a46800a`), four cases on our own synthetic lines: a term that begins and ends on dates in English, Spanish and French; the premises after a labelled tenant with the landlord's address above, in English and Spanish; a US town kept with its state across a comma, in a block and on one labelled line; a field line above the name ending the block, in English and Spanish.

  ```
  $ pnpm --filter @openverify/checks exec vitest run src/document/extract.test.ts --coverage.enabled=false
  × reads a term that begins on one date and ends on another, in each covered language
  × reads the premises printed after the labelled tenant, not the landlord's address above
  × keeps a US town with its state when a comma stands between them
  × ends the addressee block at a field line above its name (Label: value)
  AssertionError: expected null to deeply equal { readings: [ '2026-03-01' ] }
  AssertionError: expected { street1: '9 Quay Street', …(5) } to deeply equal { street1: '14 LANTERN ROW', …(5) }
  AssertionError: expected null to be 'QUINN VALEMONT' // Object.is equality
        Tests  4 failed | 35 passed (39)
  ```
- **GREEN** (`60750835`): `blockParts` rejoins the postal part with the town before it; the upward walk stops at a `PREFIX_LABEL` line; `addresseeBlocks` returns every candidate and `chosenBlock` takes a named block, else the nearest block below the labelled holder on its page, else the first; the English, Spanish and French lexicons gain the clause phrases of a lease's start and end (German had them). The first GREEN draft failed lint twice (an optional chain, then a needless `??`), fixed before the commit.

  ```
  $ pnpm --filter @openverify/checks exec vitest run src/document --coverage.enabled=false
   Test Files  13 passed (13)      Tests  450 passed (450)
  $ pnpm --filter @openverify/checks test
   Test Files  148 passed (148)    Tests  2899 passed (2899)    All files | 98.72 | 90.91 | 99.3 | 98.7
  ```
- **On the real analyses again:** the main set's remaining differences are only the non-defects of section 1; the held-out classification is unchanged (48 of 59, the same answer for each file before and after).

## 6. The guarded routes' timeout (C60.2, api-document and vision-document notes)

- **Stub** (`ada51855`): `DEFAULT_GUARDED_VISION_TIMEOUT_MS` (45,000) and the option `guardedTimeoutMs`, unwired.
- **RED** (`f09426d5`): with `timeoutMs: 50` and a vision that answers after 300 ms, an ordinary embedding times out while the chip embedding, the analysis, the render and the conversion wait; `guardedTimeoutMs: 50` times the analysis out; `guardedTimeoutMs: 0` is refused.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/vision/index.test.ts --coverage.enabled=false
  AssertionError: promise rejected "VisionUnavailableError: Vision service ti… { …(3) }" instead of resolving
  AssertionError: expected function to throw an error, but it didn't
        Tests  2 failed | 55 passed (57)
  ```
- **GREEN** (`01d48e4e`): `send` takes its timeout; the PNG routes, the analysis and `subject: 'chip'` use the guarded one. `src/vision` 3 files, 128 passed.

## 7. The decision event's files (C54.1, api-document's note)

- **RED** (`0dbb4034`): the document decision's `verification.passed` names the preview it wrote. The first draft read the payload's untyped union and failed lint (seven `no-unsafe-*` errors), so it was narrowed by `data.type` before the commit.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/jobs/process-document.test.ts --coverage.enabled=false
  AssertionError: expected [ 'file_01M5PBF497086051S323RS1FAW' ] to include 'file_01M5PBF4ABMEFVZDX52TJF9PFV'
        Tests  1 failed | 31 passed (32)
  ```
- **GREEN** (`aa6db3c5`): `verificationEvent()` lists the verification's files in the decision transaction.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/jobs src/services --coverage.enabled=false
   Test Files  98 passed (98)      Tests  970 passed (970)
  ```

## 8. The golden 5B verifications (C52.8, api-nfc's note, extended to all four)

`verification-document`, `-database-business`, `-business-website` and `-government-id-nfc.json` were written in 5A Stage 1a with guessed check metadata (an object of fabrication components, a resolution `address-family`, an NFC `hash-algorithm` of `sha-256`, an anchor source `sandbox`).

- **RED** (`1a793425`, `apps/api/src/jobs/phase5b-golden-fixtures.test.ts`): each fixture's checks equal its evaluators' results on a stated input (vision's golden bill with the holder prefilled; the sandbox register's answer for an ordinary number; the sandbox domain age of `new.example`; a genuine Utopia chip from `@openverify/emrtd/testing` with faces at a cosine of 0.71), mapped as the contracts map stored checks, and its attributes are the hooks'.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/jobs/phase5b-golden-fixtures.test.ts --coverage.enabled=false
  AssertionError: expected [ { …(9) }, { …(9) }, { …(9) }, …(4) ] to deeply equal [ { …(9) }, { …(9) }, { …(9) }, …(4) ]
  AssertionError: expected { status: 'passed', …(8) } to match object { status: 'passed', …(5) }
  …
        Tests  7 failed (7)
  ```
- **GREEN** (`e5ddc7b8`): a scratch generator mirroring the test's inputs rewrote the four fixtures' checks and attributes, keeping their ids, timestamps and relationships.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/jobs/phase5b-golden-fixtures.test.ts --coverage.enabled=false
        Tests  7 passed (7)
  $ pnpm --filter @openverify/contracts exec vitest run src/fixtures.test.ts --coverage.enabled=false     Tests 146 passed
  $ pnpm --filter @openverify/node exec vitest run --coverage.enabled=false                              Tests 226 passed
  $ pnpm --filter @openverify/dashboard exec vitest run src/components src/lib src/app/verifications --coverage.enabled=false
  × lists the members of a nested object that is not personal data       Tests 1 failed | 1328 passed
  $ (cd android && ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.ContractFixturesTest')
  80 tests, 0 failures, 0 errors, 0 skipped
  ```

  The dashboard's generic-evidence case expected the guessed anchor source `sandbox`; the job stores the enabled source's id, so its expectation is now `openverify-sandbox` (the one existing assertion changed; `src/components/evidence` 38 passed).

## 9. The OpenAPI snapshot (C52.4)

- **RED** (`f5374a2e`): the committed snapshot's description of `GET /dashboard/files/{id}/content` says the raw chip files answer 404.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/openapi.test.ts --coverage.enabled=false
  × matches the committed snapshot (pnpm --filter @openverify/api openapi:write)      Tests 1 failed | 12 passed (13)
  ```
- **GREEN** (`6d858ced`): the route's description; `openapi:write` reproduces the snapshot with no diff. sha256 `e4d28491…7667` before, `fa612f93…c538` after.

## 10. The e2e fixture paths (C65.2, C65.3)

- **Stub** (`2c485afc`), **RED** (`d1b88e8b`): `poaFixture`, `NFC_FIXTURES` and `generatedInputs()`.

  ```
  $ pnpm --filter @openverify/e2e exec vitest run src/paths.test.ts --coverage.enabled=false
  AssertionError: expected 'en/utility-bill/happy.pdf' to be '/home/…/fixtures/generated/poa/en/utility-bill/happy.pdf'
  AssertionError: expected [] to deeply equal ArrayContaining{…}
        Tests  2 failed | 5 passed (7)
  ```
- **GREEN** (`7818e1cf`): the paths, and `e2e/setup/stack.ts` regenerates the fixtures when any file a spec reads is missing (it had listed the ID and the clips only). 7 passed.

## 11. The sandbox domain ages (C61.6, found by the KYB spec)

The first run of the three new specs (section 12) failed one case: `new.example` came back 2 days old. The sandbox counted its 3 days back from its own clock call, a moment after the job's `now`, and the check floors the elapsed days.

- **RED** (`f06ac19a`): the ages are counted from the start of the UTC day (the existing case's expected instants change with the behaviour), and a job whose clock was read a second earlier sees three whole days.

  ```
  $ pnpm --filter @openverify/api exec vitest run src/providers/domain-age/sandbox.test.ts --coverage.enabled=false
  AssertionError: expected { outcome: 'registered', …(2) } to deeply equal { outcome: 'registered', …(2) }
  AssertionError: expected 2 to be 3 // Object.is equality
        Tests  2 failed | 3 passed (5)
  ```
- **GREEN** (`5848ac25`): `registeredAt` counts from midnight UTC. `providers/domain-age`, `jobs/types` and the golden fixtures: 14 files, 120 passed.

## 12. The three 5B full-stack specs (C65.5)

`e2e/tests/document-poa.spec.ts`, `kyb.spec.ts`, `nfc-chip.spec.ts` and `tests/support/phase5b.ts` (`b78be6b9`). They drive built behaviour, so nine of their ten tests passed on their first run; the tenth (`new.example`'s age) failed for the defect of section 11 and passed after its fix.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/document-poa.spec.ts tests/kyb.spec.ts tests/nfc-chip.spec.ts'
  ✘   9 … tests/kyb.spec.ts:218:1 › a domain registered 3 days ago fails the advisory domain age check …
    -     "age-days": 3,
    +     "age-days": 2,
  1 failed, 9 passed (1.1m)
# after section 11:
  10 passed (1.1m)
```

Durations (development machine, from the validation run): document-poa 6.9 s, kyb 11.1 s, nfc-chip 8.5 s.

## 13. Vision's isolation and the images (C60.2, C60.3, C56)

- **RED** (`4f78ebd3`, `infra/tests/vision-container.test.sh`):

  ```
  $ bash infra/tests/vision-container.test.sh --static-only
  FAIL - the vision network is internal (no route out)
  FAIL - vision is on the vision network only (expected '["vision"]', got '["default"]')
  FAIL - api shares the vision network and keeps the default one
  FAIL - vision runs as uid 10001 (expected '10001:10001', got '')
  FAIL - vision's root filesystem is read-only
  …
  # 14 passed, 10 failed
  ```
- **GREEN** (`1a984f27`, `infra/docker-compose.yml`): static 24 passed; live 40 passed in 41 s; `compose.test.sh` still 300 passed.
- **Refinement** (`64c10757`, written after the GREEN): a positive control, the probe reaching the running vision on their network. Its first run found the hardened vision unhealthy, for a reason outside the hardening:

  ```
  vision-1  | service_token
  vision-1  |   Value error, must be at least 32 characters [type=value_error, input_value='change-me-vision-service-token', input_type=str]
  ```

  The test now passes a throwaway token: 42 passed in 9.7 s, the test project removed with its volumes.
- **The placeholder** (`fe26afb2` RED: `compose.test.sh` 300 passed, 1 failed; `784f2e40` GREEN: 301 passed): `.env.example`'s vision token is at least 32 characters.
- **The apps image** (`617173b4` RED: `apps-image-context.test.sh` 13 passed, 1 failed "the apps image checks the disposable list against its pin"; `46d214bf` GREEN: 14 passed): the Dockerfile checks the list's SHA-256 as it checks YuNet's.

## 14. CI (`.github/workflows/ci.yml`)

- **RED** (`b812d618`, `infra/tests/ci-workflow.test.sh`):

  ```
  $ bash infra/tests/ci-workflow.test.sh
  FAIL - vision: runs the C60 document benchmark (tools/benchmark_document.py)
  FAIL - vision: the job's timeout leaves room for the suite and the benchmarks (at least 30 minutes) (20)
  FAIL - vision: caches the federal forms (fixtures/generated/federal-forms)
  FAIL - e2e: caches the federal forms (fixtures/generated/federal-forms)
  FAIL - android: the test-count floor fails with one test fewer than the floor (1255) (… the floor is 1176)
  FAIL - e2e: the Playwright globalTimeout is at least 45 minutes (40)
  FAIL - e2e: the job's timeout exceeds the globalTimeout by at least 20 minutes (install, setup, mocked suite) (45 vs 40)
  # 158 passed, 16 failed, 0 skipped
  ```
- **GREEN** (`580cd34b`): 174 passed, `actionlint` clean.

The suite timing behind the timeouts, measured alone before the change:

```
$ flock /tmp/openverify-e2e.lock … pnpm --filter @openverify/flow e2e        68 passed (17.1s)       elapsed 18s
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test --shard=1/2    35 passed (2.1m)   elapsed 125s
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test --shard=2/2    35 passed (6.3m)   elapsed 381s
```

CI's e2e job took 21 minutes before 5B (run 40031834521): 9.3 to install Chromium, 9.8 for the tests.

## 15. A test that failed only under load (C58.7)

Validation step 3's third part ran every package but the API and the dashboard at once through turbo, as CI's `node` job does:

```
$ pnpm turbo run test --force --filter='!@openverify/api' --filter='!@openverify/dashboard'
@openverify/checks:test:  FAIL  src/document/classify.test.ts > classifyDocument > classifies four pages of 600 long near-matching lines within two seconds (C58.7)
@openverify/checks:test: AssertionError: expected 5417.062902 to be less than 2000
@openverify/checks:test:  FAIL  src/document/extract.test.ts > … > extracts four full pages within two seconds (C58.7)
@openverify/checks:test: AssertionError: expected 2696.8187850000013 to be less than 2000
 Tasks:    8 successful, 11 total
Failed:    @openverify/checks#test
```

Alone the same cases pass. Measured outside Vitest (no coverage), the classification of four pages took 445, 408 and 403 ms of wall time and 540, 551 and 508 ms of CPU time alone, and 1,043, 1,029 and 1,091 ms of wall time but 849, 762 and 814 ms of CPU time with 14 busy processes on the 12 CPUs; the extraction 252, 205 and 191 ms wall alone, 485, 469 and 374 ms wall loaded, with CPU time of 222 to 508 ms. The bound is on the work a capped input costs, so the fix (`72937dda`) measures the CPU time of the test's own process (`cpuMilliseconds`, `process.cpuUsage()`; Vitest runs each file in a forked process) with the same 2-second bound, for the three document timing cases. The same parallel run then passed (section 16, step 3).

## 16. Validation (the plan's list, in order, in the foreground)

1. `pnpm install --frozen-lockfile && pnpm format:check`: "Lockfile is up to date"; "All matched files use Prettier code style!" (35 s).
2. `pnpm turbo run lint typecheck --force`: `Tasks: 26 successful, 26 total` (2 min 16 s).
3. `pnpm test`, in three turbo parts with `--force` (one call cannot hold it):
   - API: 254 files, 3,802 tests passed; coverage 96.94% statements, 89.34% branches, 98.63% functions, 96.95% lines (5 min 48 s);
   - dashboard: 183 files, 1,946 tests; 98.56% statements (1 min 28 s);
   - every other package at once: `Tasks: 11 successful, 11 total` (2 min 20 s): checks 2,900 (98.72%), config 71 (100%), contracts 1,804 (99.85%), core 711 (100%), db 844 (98.72%), e2e 85 (96.84%), emrtd 307 (94.95%), flow 1,006 (96.34%), flow-spec 113 (100%), node 226 (99.09%), ui 54 (100%).
4. `pnpm test:integration`: API 24 files, 122 tests; db 11 files, 57 tests (1 min 42 s).
5. `python3 scripts/fetch_models.py && python3 scripts/fetch_data.py`: every file present with its pin.
6. Vision: `ruff check` "All checks passed!"; `ruff format --check` "195 files already formatted"; `mypy src tools` "no issues found in 78 source files"; `pytest` in two halves sharing one coverage file: 1,237 passed (2 min 24 s), then 1,219 passed with `--cov-append` (5 min 49 s): "Required test coverage of 80% reached. Total coverage: 97.26%".
7. Android: `./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint`: BUILD SUCCESSFUL (1 min 7 s); 1,256 SDK host tests in 70 classes run in this build, 0 skipped, 0 failed; 18 demo tests.
8. `pnpm --filter @openverify/api openapi:write` then `git diff --exit-code docs/api/openapi.json`: no diff.
9. `pnpm e2e` in three parts, each under `flock /tmp/openverify-e2e.lock`: the dependency build and the mocked flow suite, 68 passed (16.9 s); the full stack, shard 1 of 2, 35 passed (2.1 min, 128 s with its setup); shard 2 of 2, 35 passed (6.4 min, 383 s).
10. `docker build -f infra/docker/apps.Dockerfile .` ("models/face_detection_yunet_2026may.onnx: OK", "data/disposable_email_blocklist.conf: OK"; 2 min 10 s) and `docker build services/vision`: both built.
11. `for t in infra/tests/*.test.sh; do bash "$t"; done`: apps-image-context 14, check-connected-results 11, ci-workflow 174 (0 skipped), compose 326 (live part included), install-gitleaks 9, pre-commit-hook 11, vision-container 42; 0 failed; no container left in the `openverify` or `openverify-vision-isolation` projects.
12. `gitleaks git --redact .`: 2,206 commits scanned, no leaks found.

The document benchmark, alone on the development machine: `uv run python tools/benchmark_document.py --runs 10`: median 1.61 s (min 1.57, max 1.63) within the 4.00 s budget; guarded child 286 ms, box OCR 1,309 ms, other 10 ms; 2,652 OCR characters.
