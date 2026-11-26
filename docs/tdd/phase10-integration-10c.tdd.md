# Phase 10, Workflow 10C Stage 3: integration-10c

**How this file was written.** integration-10c (run alone, last) made 27 commits and was then cut off by a usage limit ("You've reached your Fable limit", 22:13:24 UTC on 2026-11-10) while it ran its Validation list. It never wrote this file. The orchestrator assembled it afterwards from the agent's transcript, its commits and its validation logs (`scratchpad/val/`). Nothing here is from memory or inference: where the transcript shows no run or no output, the text says "no evidence in the transcript". The agent's thinking blocks are empty in the transcript, and it wrote only three short lines of prose, so its reasons are given only where a command, a code comment or a commit message states them.

Base: `4e2a0c32` (the 10C start). First commit `098ededb6` (20:13:37 UTC), last commit `b8bde96c3` (21:19:36 UTC). Every command ran after `source scripts/env.sh`; exit codes were read from the command (`echo rc=$?`), never a pipe. Commits went through a path-scoped helper under `/tmp/openverify-git.lock`. Times below are UTC, from the transcript.

## 1. Both NFC routes drop the frozen 501; a fifth client-unable reason, `read_failed`; the OpenAPI snapshot regenerated (api-nfc's followup, nfc-sdk's finding at the challenge cap; C221.10, C207.9)

Commits: RED `098ededb6`, RED `dddd49852`, GREEN `0a33b1f17`.

RED `098ededb6` (`apps/api/src/routes/nfc-routes.test.ts`: both routes document exactly 200, 400, 401, 404, 409, 410, 422, 429):

```
pnpm --filter @openverify/api exec vitest run src/routes/nfc-routes.test.ts --coverage.enabled=false
× lists both routes under the flow API, the sandbox one documented as sandbox-only 1244ms
AssertionError: expected [ '200', '400', '401', '404', …(4) ] to deeply equal [ '200', '400', '401', '404', …(4) ]
Tests  1 failed | 7 passed (8)   rc=1
```

RED `dddd49852` (`packages/contracts/src/phase10c-contracts.test.ts`):

```
pnpm --filter @openverify/contracts exec vitest run src/phase10c-contracts.test.ts --coverage.enabled=false
× names the five self-reported reasons, read_failed for a read that was tried and did not finish 12ms
Tests  1 failed | 14 passed (15)   rc=1
```

GREEN `0a33b1f17`: `CLIENT_UNABLE_REASONS` gains `read_failed` ("the client can read chips, but its reads of this one did not finish", sent when the person takes another way after the step's chip challenges are spent); `routes/flow/client-unable.ts` declares `problemResponses(400, 401, 404, 409, 410, 422, 429)` and `routes/flow/sandbox-chip.ts` the same list without 501.

```
pnpm --filter @openverify/contracts exec vitest run src/phase10c-contracts.test.ts --coverage.enabled=false     rc=0
pnpm --filter @openverify/api exec vitest run src/routes/nfc-routes.test.ts src/services/client-unable.test.ts --coverage.enabled=false
Test Files  2 passed (2)   Tests  25 passed (25)   Duration 17.70s   rc=0
pnpm --filter @openverify/api openapi:write     rc=0
docs/api/openapi.json | 17 ++++++-----------   (6 insertions, 11 deletions)
sha256 cd54e6168dfe49d4c638a74a2562c744107b27f73f7e8cc24ffeac8dbee071a0
prettier --check on the three source files: All matched files use Prettier code style!
```

`@openverify/node` and `contracts/fixtures/api/*`: the agent listed `packages/node/src` and grepped it for `clientUnable`, `client-unable` and `sandboxChip` (no file matched). It ran no regeneration and committed nothing under `packages/node` or `contracts/fixtures/api`; it recorded no conclusion. No evidence in the transcript beyond that grep.

## 2. The two host CPU budgets hold when every core is busy (demo-app's, docs-android's and release-checks' finding in carry-10c's tests; rule 6; KP10-21, KP10-22)

Commit: `5b7989d10` (fix; no separate RED commit, the RED is the existing tests under load).

RED (the tests as carry-10c left them, beside 36 busy loops on a 12-core host; load 10.61 at the start, 37.67 at the end):

```
36 x sh -c 'while :; do :; done' &; sleep 20
(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --rerun --tests 'dev.openverify.sdk.signals.ContextDeviceProbeCostTest' --tests 'dev.openverify.sdk.camera.BarcodeSideCostTest' -i)
probes over 3000 files in 24000 regions, 300 threads, 400 mounts: cold 467.7 ms, median of 9 44.8 ms CPU (budget 45 ms)
document guidance CPU ms a frame (median of 11): 640x480 19.4, 1280x960 83.7
BarcodeSideCostTest > the document guidance still fits its interval on a barcode side's frame() FAILED
    org.opentest4j.AssertionFailedError: a barcode side's frame takes 83.7175 ms of the 125.0 ms between sampled frames ==> expected: <true> but was: <false>
copy CPU ms (median of 11): frame 1280x960 0.994; guide crop 1670x1053 of 1856x1392 1.456
BUILD FAILED in 2m 45s   rc=1
```

The probe test passed by 0.2 ms (44.8 against 45).

GREEN: a new test helper `testing/CpuCost.kt` measures each cost as a pair, a fixed reference workload (a loop over 4 MiB of fixed bytes) then the work, back to back on one thread, and gives the median of the pairs' ratios. Both tests assert the ratio; the milliseconds are still printed and no assertion reads them. Calibration with placeholder budgets of 1000.0, the same Gradle call run beside 0 and beside 36 busy loops (`withload.sh <n>`, 15 s of warm-up):

```
n=0  rc=0  load 8.83
  probes ...: cold 285.1 ms, median of 9 24.7 ms CPU, 0.88 times the reference's 28.2 ms
  document guidance a frame (median of 11): 640x480 9.8 ms CPU, 0.40 times the reference's 24.4 ms, 1280x960 39.3 ms CPU, 1.59 times the reference's 24.7 ms
  copy CPU ms (median of 11): frame 1280x960 1.013; guide crop 1670x1053 of 1856x1392 1.225; as multiples of the reference 0.0352 and 0.0494
n=36 rc=0  load 36.20
  probes ...: cold 446.2 ms, median of 9 42.6 ms CPU, 0.90 times the reference's 47.2 ms
  document guidance a frame (median of 11): 640x480 20.9 ms CPU, 0.48 times the reference's 43.5 ms, 1280x960 86.3 ms CPU, 1.91 times the reference's 45.1 ms
  copy CPU ms (median of 11): frame 1280x960 0.919; guide crop 1670x1053 of 1856x1392 1.483; as multiples of the reference 0.0203 and 0.0299
```

Budgets set from that, both marked "Provisional" in the code:
- `BarcodeSideCostTest.INTERVAL_BUDGET = 2.55`: half the 125 ms between two sampled frames, in units of the reference (62.5 ms over the reference's 24.5 ms on a quiet host).
- `ContextDeviceProbeCostTest.BUDGET = 1.8`: twice the measured 0.88 to 0.90, and (the code comment) under two thirds of the 2.8 times the collection took while it scanned the maps and the mounts twice, so a return to two passes fails.

With the budgets in place, again beside 36 busy loops (load 38.99; the same run as section 3's RED):

```
probes ...: cold 412.7 ms, median of 9 44.1 ms CPU, 0.94 times the reference's 46.8 ms (budget 1.8 times)
document guidance a frame (median of 11): 640x480 20.2 ms CPU, 0.44 times the reference's 46.0 ms, 1280x960 80.7 ms CPU, 1.76 times the reference's 45.8 ms
copy CPU ms (median of 11): frame 1280x960 1.003; guide crop 1670x1053 of 1856x1392 1.217; as multiples of the reference 0.0214 and 0.0273
```

Neither cost test is among that run's failures (the two failures are section 3's). Both also ran in the `rest` group of section 13 (rc=0 at load 2.19).

## 3. At the challenge cap "use another way" reports `read_failed` (nfc-sdk's contractDeviation 1; C207.9)

Commits: RED `5ceb214b0`, GREEN `5ed713c2d`.

RED (`model/NfcWireModelTest`, and a new `NfcStepControllerTest` case that spends nine challenges and then sends `NfcEvent.UseAnotherWay`); beside 36 busy loops, with section 2's cost tests in the same call:

```
(cd android && withload.sh 36 flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --rerun --tests '...ContextDeviceProbeCostTest' --tests '...BarcodeSideCostTest' --tests 'dev.openverify.sdk.model.NfcWireModelTest' --tests 'dev.openverify.sdk.nfc.NfcStepControllerTest' -i)
NfcWireModelTest > the request bodies encode as the contract names their members, the default scenario sent as match() FAILED
    org.opentest4j.AssertionFailedError: expected: <[nfc_unavailable, reader_not_installed, nfc_disabled_declined, platform_unsupported]> but was: <[nfc_unavailable, reader_not_installed, nfc_disabled_declined, platform_unsupported, read_failed]>
NfcStepControllerTest > another way after the challenges are spent reports a read that failed, never a phone without NFC() FAILED
    org.opentest4j.AssertionFailedError: expected: <[read_failed]> but was: <[nfc_unavailable]>
BUILD FAILED in 4m 24s   rc=1   (load 38.99)
```

GREEN `5ed713c2d`: `ClientUnableReason.READ_FAILED("read_failed")` in `model/Nfc.kt`; `NfcStepController` maps the spent-challenges state to it (the old comment "The closed list has no 'could not read' reason; the nearest is that this phone cannot" goes); `docs/android/nfc.md`, `docs/android/privacy.md` and `docs/checks/nfc.md` name the fifth reason.

```
(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.docs.*' --tests 'dev.openverify.sdk.model.NfcWireModelTest' --tests 'dev.openverify.sdk.nfc.*' --tests 'dev.openverify.sdk.privacy.*')
SizesPageTest > the sizes page shows exactly the baseline's configurations and ABIs, each figure to a tenth of a megabyte() FAILED
    org.opentest4j.AssertionFailedError at SizesPageTest.kt:32
BUILD FAILED in 2m 34s   rc=1   (load 4.39)
```

The only failure is `SizesPageTest`, which is not about this change (section 12 fixes it); the two RED tests of this section are not among the failures. The agent's output file for this call (`and2.txt`, not printed in the transcript) reads `203 tests completed, 1 failed`. The agent committed `5ed713c2d`, `4b587331e` and `847925eff` after this run, with that one failure open. The first call in the transcript that holds `NfcStepControllerTest` and exits 0 is section 11's (`dev.openverify.sdk.nfc.*`, rc=0); `NfcWireModelTest` is next in a call that exits 0 in section 13's `rest` group.

## 4. The host tests' declared inputs name every file the scans and the docs tests read; the wire table test tolerates no unbuilt NFC call (privacy-checks' and docs-android's findings; C213.5)

Commits: `4b587331e` (chore, build file), `847925eff` (test).

- `4b587331e`: `testAndroidHostTest`'s `sourcesTheTestsRead` inputs gain `build.gradle.kts`, `gradle.lockfile`, `README.md`, `../settings.gradle.kts`, `../size-baseline.json`, `../openverify-nfc/build.gradle.kts`, `../openverify-nfc/src/main`, `../demo-app/build.gradle.kts`, `../demo-app/src/main/AndroidManifest.xml`, `docs/android/privacy.md`, `docs/android/sizes.md` and `docs/android/failure-reasons.md`. RED: no evidence in the transcript (a build-file change with no test of its own).
- `847925eff`: `WireDataSafetyTableTest` loses its `flow_api_not_built` tolerance (the `NotImplementedError` catch and `NFC_METHODS`); the case is now `every call reaches its route, the NFC calls included`. RED: no evidence in the transcript (the change removes a tolerance; nfc-sdk had built the encoders).

Run: the call of section 3's GREEN (`dev.openverify.sdk.docs.*` and `privacy.*` are in it). `WireDataSafetyTableTest` is not among its failures; `SizesPageTest` is. After section 12, `--tests 'dev.openverify.sdk.docs.*'` alone: `BUILD SUCCESSFUL in 26s`, rc=0.

## 5. The e2e stack names the generated faces for the sandbox test chip; `.env.example` names the variable, unset (api-nfc's followup; C208.1)

Commits: stub `86477afa1`, RED `521e62182`, GREEN `60aa3fcb4`.

Stub `86477afa1`: `SANDBOX_CHIP_FACES_DIR` in `e2e/src/paths.ts` (`fixtures/generated/selfie`).

RED `521e62182`:

```
(cd e2e && pnpm exec tsc --noEmit -p .)     tsc=0
(cd e2e && pnpm exec vitest run src/env.test.ts --coverage.enabled=false)
× names the generated fixture faces for the sandbox test chip, whatever the shell says (C208.1) 9ms
AssertionError: expected undefined to be '/home/mhnoor/persona-opensource/fixtu…' // Object.is equality
Tests  1 failed | 25 passed (26)   rc=1

bash infra/tests/compose.test.sh --static-only
FAIL - .env.example names OPENVERIFY_SANDBOX_CHIP_FACES, commented out
# 535 passed, 1 failed   rc=1
```

The new static checks: `api`, `worker` and `migrate` receive no `OPENVERIFY_SANDBOX_CHIP_FACES`; `.env.example` names it commented out and never sets it.

GREEN `60aa3fcb4`: `generateE2eEnv` sets `OPENVERIFY_SANDBOX_CHIP_FACES: SANDBOX_CHIP_FACES_DIR`; `.env.example` gains a commented `# OPENVERIFY_SANDBOX_CHIP_FACES=` with the reason (no image holds a face, compose passes none, unset the scenario answers 422 `sandbox_chip_scenario_unavailable`).

```
(cd e2e && pnpm exec vitest run src/env.test.ts --coverage.enabled=false)     rc=0
bash infra/tests/compose.test.sh --static-only     # 536 passed, 0 failed   rc=0
```

The Utopia anchor: the agent read that `seed:dev` installs it (`apps/api/src/seed/dev-seed.ts:643`) and that the e2e stack runs the seed (`e2e/setup/stack.ts:269`); it changed nothing for it. The `match` test of section 7 passing on the stack is the evidence that the anchor is held there.

## 6. The 10C flow fixture: `e2e/src/android-nfc-flow.ts`, `e2e/fixtures/android-10c/flow.json` (C224.3, C224.4, rule 27)

Commits: stub `ae4a6b52b`, RED `fe78a7a8f`, GREEN `cb5e21764`.

Stub: `androidNfcFlowFixture()` returns `description: 'not-built'`. `tsc --noEmit` rc=0 and eslint clean before the commit (`lint-ok`).

RED `fe78a7a8f` (`e2e/src/android-nfc-flow.test.ts`, assert-only):

```
(cd e2e && pnpm exec vitest run src/android-nfc-flow.test.ts --coverage.enabled=false)
× is the committed file, beside the 10A one 10ms
× is a flow-spec 2 flow: consent with both integrity notices, a one-sided ID, a selfie, the chip, and a document on its exhausted edge 2ms
× names the generated inputs from the repository root and the holder they share 2ms
Tests  3 failed (3)   rc=1
```

GREEN `cb5e21764`: the builder (the default template's consent with `notice.play-integrity` added, the Utopia TD3 passport page as a one-sided government ID, a selfie, the `nfc` step, a proof-of-address document on the chip step's `exhausted` edge, a completion; every check at its registry default; the generated inputs named by path from the repository root).

```
UPDATE_CONTRACT_FIXTURES=1 pnpm exec vitest run src/android-nfc-flow.test.ts --coverage.enabled=false     Tests 3 passed (3)   rc=0
pnpm exec prettier --write fixtures/android-10c/flow.json
pnpm exec vitest run src/android-nfc-flow.test.ts src/android-flow.test.ts --coverage.enabled=false     rc=0   (10A's fixture test with it)
tsc --noEmit rc=0, eslint ok;   18077 fixtures/android-10c/flow.json (bytes, before the change below)
```

One change after the first spec runs (section 7): the fixture holds `selfie_liveness_detection` advisory (`{ enabled: true, required: false }`), because the clients here upload stills, which liveness answers `not_applicable` with `capture_not_live`. The fixture test asserts it; the file was rewritten with `UPDATE_CONTRACT_FIXTURES=1` (rc=0) and prettier.

## 7. The 10C full-stack spec (C224.3): `e2e/tests/flow-nfc-android.spec.ts`

Commit: `72f1e66d1` (458 lines, three tests, header line "Budget: 90 s per test.").

An API-driven client with the Android `User-Agent` (`OpenVerify-Android/0.1.0`) and `OpenVerify-Flow-Spec: 2` on every request drives `fixtures/android-10c/flow.json`: `match`, `face-mismatch`, and a client that reports `nfc_unavailable` and lands on the document fallback with the inquiry in `needs_review`.

**Was it run against a stack? Yes, four times, on a reusable stack the agent started itself.** Stack: `e2e:stack:down` then `pnpm turbo run build --filter=@openverify/e2e^...` (5 tasks, 23.8 s, rc=0), then `flock -E 75 -w 120 /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:up`: rc=0 in 108 s (load 3.98).

Its RED is not a failing-first commit: the spec was written whole and its first two runs failed on the spec's own expectations. Command for every run:

```
flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/flow-nfc-android.spec.ts'
```

Run 1 (rc=1):

```
✘  1 › match: the sandbox test chip is offered to the SDK only, read after its challenge, and passes every required NFC check; the inquiry completes (C207.2, C208, C224.3) (6.3s)
✓  2 › face-mismatch: a test chip carrying another person’s face fails the selfie comparison, while its integrity holds (C208.1, C62.4) (7.0s)
✓  3 › nfc_unavailable: a client-unable report takes the chip step’s fallback to the document, and the inquiry lands in needs_review (C207.9, C224.3) (6.8s)
    Expected path: not "prefillMrz"
    Received value: {"birthDate": "880321", "documentNumber": "UP7316408", "expiryDate": "330913"}
    > 379 |   expect(browser.step).not.toHaveProperty('prefillMrz');
1 failed, 2 passed (25.3s)
```

The spec had asked the same session again with a browser's headers and expected neither SDK-only member. The members follow the session's stored client, so the assertion was dropped, with a comment that a session no SDK ever used is covered by api-nfc's `flow-views/nfc-session.contract.test.ts`.

Run 2 (rc=1, load 2.46):

```
✘  1 › match: ... (7.0s)
    Expected: "completed"
    Received: "needs_review"
    > 390 |   expect(inquiry.status).toBe('completed');
1 failed, 2 passed (26.1s)
```

Cause, read from the stack's database and the server API: the selfie verification was `needs_review` with `selfie_liveness_detection not_applicable required ['capture_not_live']` (an uploaded still). Fix: section 6's advisory liveness in the 10C fixture only.

Run 3 (rc=0, load 2.73):

```
✓  1 › match: ... (8.0s)
✓  2 › face-mismatch: ... (6.8s)
✓  3 › nfc_unavailable: ... (7.7s)
3 passed (25.3s)
```

Then the spec was tightened (the ID and the selfie must settle `passed`, not `passed` or `needs_review`), with prettier, `tsc --noEmit` and eslint clean.

Run 4, the committed spec (rc=0): `3 passed (25.3s)`.

Each test took 6.8 to 8.0 s against the 90 s budget. The spec was not run again after this: the Validation's e2e gate (the four chromium shards) was never reached, so which shard holds it and its time inside a shard have no evidence in the transcript.

## 8. The 10C NFC flow in `:openverify-sdk:stackTest` (C224.4): `stack/AndroidNfcFlowStackTest.kt`

Commit: `d3cae87a8` (the class, 262 lines, tagged `StackTests` beside 10A's `AndroidFlowStackTest`; `build.gradle.kts` sets the system properties `openverify.e2e.androidNfcFlow` to `e2e/fixtures/android-10c/flow.json` and `openverify.e2e.repositoryRoot`).

RED: no evidence in the transcript. The class was written whole. Before its first run the agent probed the stack's server API and found the read it had written did not exist (`/api/v1/verifications?filter[inquiry-id]=...`: `HTTP Error 404: Not Found`), and changed the test to read the inquiry's `verifications` relationship and each verification by id.

**Was it run against a stack? Yes, once, on the same stack as section 7, and it passed.** With the e2e lock outside and the Gradle lock inside (rule 7):

```
flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:stackTest --tests "dev.openverify.sdk.stack.AndroidNfcFlowStackTest"'
BUILD SUCCESSFUL in 1m 4s   rc=0
build/test-results/stackTest/TEST-dev.openverify.sdk.stack.AndroidNfcFlowStackTest.xml:
testsuite name="dev.openverify.sdk.stack.AndroidNfcFlowStackTest" tests="1" skipped="0" failures="0" errors="0" timestamp="2026-11-10T20:48:08.085Z" time="16.854"
```

One test, 16.9 s, none skipped. The agent read the result XML to confirm the test really executed. The run was filtered to the new class: `AndroidFlowStackTest` (10A) was not in it, and the whole `stackTest` task (both classes, after the console sweep) was never run by the agent. Then `e2e:stack:down`: rc=0.

## 9. The console labels a verification read from a sandbox test chip (contracts-10c's and api-nfc's followup; C208.4, Stage 1a amendment 9; a borrowed edit in `apps/dashboard`)

Commits: stub `2d4d00781`, RED `6c7df95e0`, GREEN `2659b646a`.

Stub: `SANDBOX_CHIP_LABEL = 'Test chip (sandbox)'` and `SANDBOX_CHIP_NOTE` in `lib/government-id-nfc-words.ts`; `sandboxChip: null` in the evidence model. `tsc --noEmit` rc=0.

RED `6c7df95e0`:

```
(cd apps/dashboard && pnpm exec vitest run src/lib/government-id-nfc-evidence.test.ts src/components/evidence/government-id-nfc.test.tsx --coverage.enabled=false)
× names the sandbox test chip’s scenario, and nothing for any other chip (C208.4) 9ms
× labels a verification read from a sandbox test chip, with its scenario and what it does not prove (C208.4) 313ms
Tests  2 failed | 45 passed (47)   rc=1
```

GREEN `2659b646a`: `sandboxChipOf` reads the verification's `sandbox-chip` attribute (`SANDBOX_CHIP_LABEL_MEMBER`) and accepts only a member of `SANDBOX_CHIP_SCENARIOS`; the evidence component shows the label first, with the scenario and the note ("The server built this chip for a sandbox inquiry; no document was read. It shows that the flow and the server’s checks work, and says nothing about a chip reader or a real document.").

```
(cd apps/dashboard && pnpm exec tsc --noEmit -p .)     tsc=0
pnpm exec vitest run src/lib/government-id-nfc-evidence.test.ts src/components/evidence/ src/lib/government-id-nfc-words.test.ts --coverage.enabled=false
Tests  295 passed (295)   rc=0
eslint on the three source files: no output
```

## 10. `androidx.activity` is an `api` dependency of the SDK, held at scope compile in the staged POM (release-checks' finding; C214.4)

Commits: RED `c176eae8c`, GREEN `01464231e`.

RED (`android/scripts/tests/test_check_staged_repository.py`: the Android target's POM must give `androidx.activity` at scope `compile`, for a POM with it at `runtime` and for one without it):

```
python3 -I -m unittest discover -s android/scripts/tests
  File ".../test_check_staged_repository.py", line 223, in test_androidx_activity_is_an_api_dependency_of_the_android_target
    self.assert_one("androidx.activity", "compile", "public signature")
AssertionError: 1 != 0 : []
Ran 83 tests in 0.588s
FAILED (failures=2)
```

GREEN `01464231e`: `check-staged-repository.py` reports `androidx.activity is not at scope compile in the POM ... it is in a public signature (C214.4)`; `:openverify-sdk` declares `api(libs.androidx.activity.compose)` (because `OpenVerifyInquiry.Contract` extends `ActivityResultContract`); `android/consumer-check/build.gradle.kts` loses its own `implementation(libs.androidx.activity.compose)` line.

```
python3 -I -m unittest discover -s android/scripts/tests     Ran 83 tests in 0.573s   OK
(cd android && flock ... ./gradlew --no-daemon publishAllPublicationsToStagingRepository)     BUILD SUCCESSFUL in 2m 1s   rc=0   (103 actionable tasks: 32 executed, 71 up-to-date)
python3 -I scripts/check-staged-repository.py     check-staged-repository: passed
(cd android && flock ... ./gradlew --no-daemon -p consumer-check build)     BUILD SUCCESSFUL in 2m 11s   rc=0   (47 actionable tasks: 15 executed, 32 up-to-date)
(cd android && flock ... ./gradlew --no-daemon resolveAndLockAll --write-locks)     BUILD SUCCESSFUL in 18s   rc=0
git status --porcelain android, git diff --stat -- '*.lockfile': only the three edited files; no lockfile moved
```

So the consumer check compiles against the staged SDK without declaring `androidx.activity` (warm Gradle home, its committed lockfile and verification metadata unchanged). Not done: release-checks asked for the consumer check's lockfile and verification metadata to be refreshed from a fresh `GRADLE_USER_HOME` after this change; the agent ran no fresh-home pass, and the Validation's cold pass (step 8) was never reached. No Gradle lock wait was measured for these calls (no evidence in the transcript).

## 11. The fake flow server walks an `nfc` step as the engine does (nfc-sdk's finding in `flow/FakeFlowServer.kt`; test support only)

Commits: RED `bf2fa64b7`, GREEN `19942f767`.

First `FakeFlowServer.verificationTypeOf` gained `"nfc" -> VerificationType.GOVERNMENT_ID_NFC`. RED `bf2fa64b7` (a `NfcStepControllerTest` case with no scripted position: after `NfcEvent.UseAnotherWay` the attempt is `CANCELED` and the flow leaves the chip step):

```
(cd android && flock ... ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.nfc.*' --tests 'dev.openverify.sdk.flow.*' --tests 'dev.openverify.sdk.ui.steps.NfcStep*')
NfcStepControllerTest > after the report the server's own walk takes the step's fallback, with no position scripted() FAILED
    org.opentest4j.AssertionFailedError at NfcStepControllerTest.kt:690
518 tests completed, 1 failed   BUILD FAILED in 1m 7s   rc=1
```

GREEN took four runs, and the RED test's assertions were changed on the way (the committed test is not byte-identical to the RED commit's):

1. `FakeFlowApi.reportClientUnable` marks the verification `CANCELED`. Run over `nfc.*`, `flow.*`, `ui.*`, `privacy.*`: `1062 tests completed, 1 failed`, `BUILD FAILED in 2m 15s`, rc=1; the failure message: `the flow showed Nfc(step=NfcStep(id=chip, maxAttempts=null, fallbackAvailable=true, ...), view=CannotRead(reason=READER_NOT_INSTALLED, fallback=true, sandbox=false, busy=false)) ==> expected: <true> but was: <false>`.
2. The test now advances virtual time by 10 s and asserts the served position (`"done"`) and that the state is no longer `FlowState.Nfc`. Compile error: `NfcStepControllerTest.kt:708:51 Unresolved reference 'position' on receiver of type 'FakeFlowServer.Position'`, `BUILD FAILED in 30s`.
3. Accessor fixed (`server.served.last().stepId`). `48 tests completed, 1 failed`, `BUILD FAILED in 32s`: `expected: <done> but was: <chip>`. The fake's walk still waited for the step's attempts to be used up.
4. `FakeFlowServer`'s walk leaves through the fallback when `exhausted(step)` or a client-unable report names the latest attempt ("a client-unable report leaves through `exhausted` whatever attempts remain", C207.9).

```
(cd android && flock ... ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.nfc.*' --tests 'dev.openverify.sdk.flow.*' --tests 'dev.openverify.sdk.ui.*' --tests 'dev.openverify.sdk.privacy.*')
BUILD SUCCESSFUL in 2m 4s   rc=0
```

## 12. The size baseline re-measured at the Workflow's end, and the sizes page with it (release-checks' and demo-app's followup; C216.2, C216.3)

Commit: `75367eda2` (`android/size-baseline.json`, `docs/android/sizes.md`). RED: `SizesPageTest`'s failure in section 3 (`the sizes page shows exactly the baseline's configurations and ABIs, each figure to a tenth of a megabyte() FAILED`, `SizesPageTest.kt:32`), seen before the re-measure.

```
python3 -I scripts/fetch_bundletool.py     bundletool 1.18.3: present .../android/build/bundletool/bundletool-all-1.18.3.jar (Apache-2.0)
(cd android && flock ... ./gradlew --no-daemon :demo-app:assembleRelease :demo-app:bundleRelease)     rc=0   153 s   load 9.85
python3 -I scripts/check-size.py     check-size: passed (no figure grew by more than 10% over the baseline)
python3 -I scripts/check-size.py --write-baseline     rc=0
(cd android && flock ... ./gradlew --no-daemon -PopenverifyDemoArtifacts=sdk,nfc :demo-app:bundleRelease)     rc=0   137 s   load 7.84
python3 -I scripts/check-size.py --configuration sdk,nfc --write-baseline     rc=0
```

Measured with `bundletool-all-1.18.3.jar` over `demo-app-release.aab` (bytes):

| Configuration | ABI | Download | Install | Download before (the diff's old line) |
|---|---|---|---|---|
| `sdk` | `arm64-v8a` | 3,377,103 | 7,070,770 | 3,376,937 |
| `sdk` | `armeabi-v7a` | 3,289,560 | 6,554,682 | 3,289,394 |
| `sdk` | `x86` | 3,445,891 | 7,193,626 | 3,445,725 |
| `sdk` | `x86_64` | 3,420,392 | 7,173,158 | 3,420,226 |
| `sdk,nfc` | `arm64-v8a` | 3,377,202 | 7,070,770 | 3,377,057 |
| `sdk,nfc` | `armeabi-v7a` | 3,289,659 | 6,554,682 | 3,289,514 |
| `sdk,nfc` | `x86` | 3,445,990 | 7,193,626 | 3,445,845 |
| `sdk,nfc` | `x86_64` | 3,420,491 | 7,173,158 | 3,420,346 |

The baseline's diff is 8 lines changed, all download figures (`git diff --stat`: 8 insertions, 8 deletions); the install figures did not move. `sdk,nfc` is 99 bytes of download above `sdk` on every ABI and the same install figure.

`docs/android/sizes.md`, both tables rewritten from the baseline (megabytes of 10^6 bytes, to a tenth): `arm64-v8a` 3.4 MB and 7.1 MB, `armeabi-v7a` 3.3 and 6.6, `x86` 3.4 and 7.2, `x86_64` 3.4 and 7.2 (they had read 3.3 and 6.9, 3.2 and 6.4, 3.4 and 7.0, 3.3 and 7.0). The page's sentence about `openverify-nfc` now says it "adds 99 bytes to the download and nothing to the install figure" (it had said 13 bytes).

GREEN:

```
(cd android && flock ... ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.docs.*')     BUILD SUCCESSFUL in 26s   rc=0
```

## 13. Android gate numbers the agent measured

The Validation's eight-call Android gate and its cold pass were never run (the last section). What the transcript holds:

| Call | Exit | Time | Load | Result |
|---|---|---|---|---|
| `:openverify-sdk:testAndroidHostTest -PhostTestGroup=ui --rerun` | 0 | 101 s | 2.92 | 476 tests, 0 skipped, 0 failed |
| `:openverify-sdk:testAndroidHostTest -PhostTestGroup=flow --rerun` | 0 | 44 s | 2.92 | 401 tests, 0 skipped, 0 failed |
| `:openverify-sdk:testAndroidHostTest -PhostTestGroup=rest --rerun` | 0 | 94 s | 2.19 | 1,725 tests, 0 skipped, 0 failed |
| `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 153 s | 9.85 | then `check-size.py` passed |
| `-PopenverifyDemoArtifacts=sdk,nfc :demo-app:bundleRelease` | 0 | 137 s | 7.84 | |
| `publishAllPublicationsToStagingRepository` | 0 | `BUILD SUCCESSFUL in 2m 1s` | not printed | `check-staged-repository: passed` |
| `-p consumer-check build` | 0 | `BUILD SUCCESSFUL in 2m 11s` | not printed | |
| `resolveAndLockAll --write-locks` | 0 | `BUILD SUCCESSFUL in 18s` | not printed | no lockfile moved |
| `:openverify-sdk:stackTest --tests ...AndroidNfcFlowStackTest` (on the stack) | 0 | `BUILD SUCCESSFUL in 1m 4s` | not printed | 1 test, 16.854 s |

Every call ran with `--no-daemon` under `flock -E 75 -w 240 /tmp/openverify-gradle.lock`. Lock waits: no evidence in the transcript (the agent ran alone and printed no wait). The three host groups ran at 21:12:52 to 21:16:52 UTC on the tree at `75367eda2`; the counts were read from `build/test-results/testAndroidHostTest/*.xml` after each group.

**The SDK floor, 2,602.** Measured: 476 + 401 + 1,725 = 2,602, none skipped. The arithmetic the agent wrote into `ci.yml` and `infra/tests/ci-workflow.test.sh`:

```
2,321  Workflow 10B's floor
+  40  carry-10c
+  25  contracts-10c            = 2,386 at Stage 1a's close
+ 113  nfc-sdk
-   1  the stub pin nfc-sdk removed
+  90  privacy-checks
+  12  docs-android             = 2,600 at the Stage 2 gates
+   2  integration-10c          = 2,602
```

The agent's own 2 are not named in the transcript. The two host tests its commits add are `NfcStepControllerTest`'s "another way after the challenges are spent reports a read that failed, never a phone without NFC" (`5ceb214b0`) and "after the report the server's own walk takes the step's fallback, with no position scripted" (`bf2fa64b7`). `AndroidNfcFlowStackTest` is tagged `StackTests` and runs in `stackTest`.

**The demo's floor, 80 + 8.** 80 tests on the debug variant (`testDebugUnitTest`) and the smoke test's 8 host twins on `minifiedSmoke` (`testMinifiedSmokeUnitTest`), each held separately. The figures are demo-app's (`ci.yml` cites `docs/tdd/phase10-demo-app.tdd.md`); the agent ran no demo host test in the transcript, so its own measurement of them: no evidence in the transcript.

**`infra/tests/ci-workflow.test.sh`:** 366 checks, `# 366 passed, 0 failed, 0 skipped` (section 14).

## 14. CI: `ci.yml`'s 10C steps and floors, held by `infra/tests/ci-workflow.test.sh` (C220.1, C219.6, C215, C216; written and held, no run claimed: rule 28)

Commits: RED `cdcea5e86`, GREEN `629c4d82b`.

RED `cdcea5e86` (`bash infra/tests/ci-workflow.test.sh`, rc=1, 26 failures):

```
FAIL - android: the test-count floor fails with one test fewer than 10C's floor (2601) (exit 0: SDK host tests: 2601 in 2 classes, 0 skipped, 0 failed ...)
FAIL - android: the test-count floor fails at Workflow 10B's earlier floor of 2321 (exit 0: SDK host tests: 2321 in 2 classes, 0 skipped, 0 failed; ...)
FAIL - android: fetches the pinned bundletool with python3 -I (C214.7)
FAIL - android: the bundletool fetch runs from the repository root, before the first Gradle step
FAIL - android: runs the release checks' own unit tests (python3 -I -m unittest discover -s scripts/tests)
FAIL - android: the screenshot, ABI and bundle step also builds the minified release APK (:demo-app:assembleRelease)
FAIL - android: runs the 16 KB checks (check-elf-alignment.py) with python3 -I after the release build
FAIL - android: runs the consumer-rules check (check-consumer-rules.py) with python3 -I after the release build
FAIL - android: runs the size check (check-size.py) with python3 -I after the release build
FAIL - android: the per-push size check measures the SDK-only configuration (sdk,nfc is the release workflow's)
FAIL - android: runs ./gradlew -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest (the sdk,nfc merged manifest against its allowlist, C215. ...
FAIL - android: the sdk,nfc manifest step runs last of the checks, after the size check read the default bundle
FAIL - android: one step checks the demo's host test results (the demo's floor)
FAIL - android: the demo's floor runs in bash, after the Gradle step and before the sdk,nfc step reruns the demo's tests
FAIL - android: the demo's floor passes with 80 debug-variant tests and the 8 smoke twins (exit None: no demo floor step)
FAIL - android: the demo's floor passes above both floors (exit None: no demo floor step)
FAIL - android: the demo's floor fails with one debug-variant test fewer (79) (exit None: no demo floor step)
FAIL - android: the demo's floor fails with one smoke twin fewer (7) (exit None: no demo floor step)
FAIL - android: the demo's floor fails at the 18 tests the demo had before 10C (exit None: no demo floor step)
FAIL - android: the demo's floor fails when the smoke twins did not run (exit None: no demo floor step)
FAIL - android: the demo's floor fails when the debug variant's tests did not run (exit None: no demo floor step)
FAIL - android: the demo's floor fails when a demo test was skipped (exit None: no demo floor step)
FAIL - android: the demo's floor fails when a demo test failed (exit None: no demo floor step)
FAIL - android-instrumented: runs ./gradlew :demo-app:connectedMinifiedSmokeAndroidTest (the R8-minified demo's smoke test)
FAIL - android-instrumented: the smoke test runs after the SDK's device tests and before check-connected-results.sh
FAIL - android-instrumented: a failed smoke test prints its JUnit XML and fails the step
# 340 passed, 26 failed, 0 skipped
```

GREEN `629c4d82b` (`.github/workflows/ci.yml`, 65 insertions, 8 deletions). In the `android` job, in order:
- `Fetch bundletool (pinned by SHA-256)`: `python3 -I scripts/fetch_bundletool.py` from the repository root, before any Gradle step;
- `The release checks' own tests`: `python3 -I -m unittest discover -s scripts/tests`;
- the first Gradle step, unchanged;
- the second Gradle step also builds `:demo-app:assembleRelease` beside `:demo-app:bundleRelease`;
- `python3 -I scripts/check-elf-alignment.py`, `python3 -I scripts/check-consumer-rules.py`, `python3 -I scripts/check-size.py` (the SDK-only configuration);
- the SDK host-test floor at 2602 (step name, argument and the comment with the arithmetic);
- `Demo host test floor (at least 80 on debug and 8 smoke twins, none skipped)`, reading `demo-app/build/test-results/testDebugUnitTest=80` and `testMinifiedSmokeUnitTest=8`;
- last, `./gradlew -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest` (the `sdk,nfc` merged manifest against `manifest-allowlist/sdk-nfc.json`).

In `android-instrumented`, the emulator script gains `./gradlew :demo-app:connectedMinifiedSmokeAndroidTest --stacktrace || { ...print the JUnit XML and logcat...; exit 1; }` after the SDK's device tests and before `check-connected-results.sh`. No emulator setting (API level, options, timeouts) was changed. The `e2e` job is untouched: its failure-trace upload with `include-hidden-files: true` (KP10-1) stands as it was.

```
bash infra/tests/ci-workflow.test.sh     # 366 passed, 0 failed, 0 skipped   rc=0
pnpm exec prettier --check .github/workflows/ci.yml     All matched files use Prettier code style!
which actionlint     /home/mhnoor/.local/bin/actionlint   (actionlint is installed on this host)
```

No CI run exists for any of this, and none is claimed: the steps are written and held by the contract test only.

**The base push's CI, read with `gh` (read-only) at 21:17 UTC.** `gh run view 42762952128`: head `f71b0f6d`, completed, failure. Every job succeeded except `android-instrumented (emulator)` (failure, 9.7 min; its emulator step 8.9 min). Job times in minutes: node 14.6, lint 8.2, unit-api shards 22.1, 17.6 and 15.3, integration 15.3, e2e 40.0, secrets 0.3, vision 9.3, unit-dashboard 6.7 and 8.3, format 1.5, android 21.8, unit-db 9.5, infra 1.7, the two coverage merges 0.7 each. `gh run list --limit 3`: 42762952128 is the latest run; no run of a later commit exists. The agent wrote no job-time table, no split decision and no per-push minutes estimate from these figures (the last section).

## 15. PLAN section 6 says what Workflow 10C built (C222)

Commit: `b8bde96c3` (`docs/PLAN.md`, 5 insertions, 3 deletions; docs only, no test). The Phase 10 list now has four bullets in place of the two lines for `openverify-nfc` and `demo-app`: NFC in the SDK behind the public `ChipReader` seam with `client-unable`; `openverify-nfc` holding the NFC permission and no reader until Workflow 10E, with the sandbox test chip ("It proves the flow and the server's checks, never a reader"); shipping (consumer rules, the 16 KB checks, sizes against the baseline, the staged repository and consumer check, `android-release.yml`); the demo. The instrumented-tests line gains:

> Since 2026-11-10 the owner has no Actions minutes, so no run can be counted on: a device-only behaviour is proved by a host test of its logic and its device test kept and compiled, and is listed as "unproved on a device" in `docs/PROGRESS.md` until a device run exists (Phase 10 plan, the 10C decisions item 3). "Done" for Phase 10 stays CI-green (decision 72) and waits on those minutes.

RED and run: no evidence in the transcript (prose). Before the commit the agent grepped `docs/checks/nfc.md` and found `trust:sandbox-utopia` already documented there (line 166).

## Validation steps completed

Run alone on the tree at `b8bde96c3` (`git status --porcelain` showed only the untracked `31-Oct-openverify-session-state.txt`), each step one foreground call through a wrapper that wrote the output to `scratchpad/val/<step>.txt` and a line to `val/_log.txt` (exit code, seconds, the load average after the step). 21:19:49 to 22:13:24 UTC.

| Step | Command | rc | Seconds | Load (1, 5, 15 min) | Result |
|---|---|---|---|---|---|
| 01-install | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | 0 | 0.49 2.22 3.87 | "Lockfile is up to date"; `pnpm-workspace.yaml` unchanged |
| 01-format | `pnpm format:check` | 0 | 104 | 1.26 2.02 3.63 | "All matched files use Prettier code style!" |
| 02-typecheck | `bash /tmp/openverify-heavy.sh pnpm turbo run typecheck --force` | 0 | 137 | 5.34 4.65 4.46 | 17 tasks, 0 cached |
| 02-lint-api | `pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api` (heavy slot, `NODE_OPTIONS=--max-old-space-size=4096`) | 0 | 195 | 1.77 3.23 3.94 | 1 task |
| 02-lint-dash | the same with `--filter=@openverify/dashboard --filter=@openverify/contracts` | 0 | 214 | 1.72 2.39 3.45 | 2 tasks |
| 02-lint-rest | the same with the three packages excluded | 0 | 309 | 1.89 2.03 2.97 | 14 tasks |
| 03-fetch-models | `python3 scripts/fetch_models.py` | 0 | 1 | 1.89 2.03 2.97 | every model "present" |
| 03-fetch-data | `python3 scripts/fetch_data.py` | 0 | 0 | 1.89 2.03 2.97 | every file "present" |
| 03-variant-groups | `pnpm --filter @openverify/watchlist build:variant-groups` | 0 | 6 | 1.82 2.01 2.96 | sha256 `29d05838…3bfb` |
| 03-bundletool | `python3 -I scripts/fetch_bundletool.py` | 0 | 0 | 1.82 2.01 2.96 | bundletool 1.18.3 present |
| 04-test-wed | `pnpm turbo run test --force` for watchlist, e2e, db (heavy slot) | 0 | 375 | 2.03 4.88 4.46 | watchlist 820 tests in 69 files (98.63% statements); e2e 138 in 20 (96.58%); db 2,211 in 155 (91.1%) |
| 04-test-dash | `pnpm turbo run test --force --filter=@openverify/dashboard` (heavy slot) | 0 | 399 | 7.37 6.87 5.52 | 6,760 tests in 581 files (95.59%) |
| 04-test-rest | `pnpm turbo run test --force` for the other 12 | 0 | 169 | 15.39 14.59 9.03 | contracts 4,461 (99.12%), checks 3,849 (98.79%), workflow-engine 1,990 (98%), core 1,659 (99.18%), flow 1,533 (94.86%), flow-spec 486 (96.46%), node 486 (98.44%), emrtd 318 (94.97%), config 290 (97.22%), signals 192 (96.37%), ui 58 (100%), js 19 (100%) |
| 04-test-js | `pnpm --filter @openverify/js test` | 0 | 5 | 14.56 14.43 9.01 | 19 tests in 4 files (100%) |
| 04-api-1 | `pnpm exec vitest run --coverage --coverage.reportsDirectory=$D/coverage-1 --shard=1/8 --reporter=blob --outputFile=$D/blobs/blob-1-8.json` (heavy slot) | 1 | 155 | 8.55 11.99 8.96 | blob written; partial coverage 37.61% statements |
| 04-api-2 | the same, shard 2/8 | 1 | 179 | 7.54 10.20 8.81 | blob written; 42.63% |
| 04-api-3 | shard 3/8 | 1 | 160 | 7.47 9.24 8.67 | blob written; 45.64% |
| 04-api-4 | shard 4/8 | 1 | 165 | 7.51 8.70 8.55 | blob written; 38.72% |
| 04-api-5 | shard 5/8 | 1 | 153 | 8.08 8.69 8.58 | blob written; 41.61% |
| 04-api-6 | shard 6/8 | 1 | 153 | 8.13 8.50 8.51 | blob written; 38.17% |
| 04-api-7 | shard 7/8 | 1 | 144 | 8.91 9.13 8.76 | blob written; 35.24% |
| 04-api-8 | shard 8/8 | 1 | 136 | 8.72 9.13 8.82 | blob written; 37.42% |

About the API shards' rc=1: it is the per-shard coverage threshold, expected before the merge and not a test failure as far as the files show. Each shard file ends with the coverage summary and four lines of the form `ERROR: Coverage for lines (37.94%) does not meet global threshold (80%)` (shard 1's figures: lines 37.94%, functions 36.02%, statements 37.61%, branches 27.03%), and none holds an `AssertionError`, a `FAIL` line or the word "failed". The limit of that evidence: the blob reporter prints no test results, so the count of API tests, their pass or fail and the merged coverage would come only from the merge (`vitest --merge-reports`), which the agent never ran. The eight blobs (13.3 to 13.8 MB each) and the eight coverage folders were left in `/tmp/ov-10c-api-1706027/`. integration-10b's merged figure for the same step was one call of 36 s.

The cut came right after shard 8 returned (22:13:24 UTC). Nothing was running.

## Not completed by the agent (cut off by a usage limit)

The orchestrator's full local validation, run after the cut-off on the committed tree, covers every row of the Validation list below; the numbers of that run are the orchestrator's, not this file's.

From the task list:

- **The base push's CI again (C219.7): partly.** The agent read run 42762952128's job conclusions and times with `gh` (section 14) and saw that only `android-instrumented` failed and that no later run exists. It did not read the failing job's log in the transcript and recorded nothing about it.
- **The 10C full-stack specs: done** (section 7), but run only by themselves; not run inside the four chromium shards.
- **`stackTest` extended: done** (section 8), but run only with the new class filtered in; the whole task, with 10A's class, after the console sweep, was not run.
- **The defects the Stage 2 reports name: partly.** Handled: the 501 and `read_failed` (1, 3), the CPU budgets (2), the declared inputs and the wire table tolerance (4), the faces variable (5), the console label (9), `androidx.activity` (10), the fake flow server (11), the size baseline and page (12). Not handled, with what the transcript shows:
  - privacy-checks' two judgment calls on `submitProtection()` (`DocumentStep`'s choose-file and take-photo buttons, `OtpStep`'s continue after the limit): no evidence in the transcript; neither file was touched;
  - `model/WireEnums.kt:35`'s fixed message and its `ExceptionMessageScanTest` allowlist line: no evidence in the transcript; not touched;
  - privacy-checks' canary and scan entries for the MRZ, CAN and DG1 review: no evidence in the transcript;
  - carry-10c's hook to hide the barcode guide on frames whose `barcodeRead` is `NONE`, and the 640 px copy for the document gates on a barcode side: not built; no evidence in the transcript;
  - the barcode device test's requirement on the CI emulator (carry-10c's contractDeviation 2): no decision in the transcript; no emulator setting changed in `ci.yml`;
  - an activity-level test that the installed `chipReader` and `NfcPlatform` reach the NFC screens through `OpenVerifyInquiryActivity`: not written;
  - whether a chip kind uploaded twice to one verification is replaced: the agent read `apps/api/src/services/chip-challenges/chip-files.ts` (`latestChipFile` takes the last file of a kind; `loadChipFiles` reads "the latest of each kind") and wrote nothing down; no test added;
  - the docs against the code (docs-android's dependent statements, C217.6): one spot-check grep over `docs/android`, the READMEs and `docs/checks/nfc.md` (section 15's and 12's edits came from it); no statement-by-statement check in the transcript;
  - `flow-requests.android.test.ts` over `index.json`, re-run once every NFC fixture had landed: never run by itself. It is an `apps/api` unit test, so one of the eight shards executed it, but the merge that reports results never ran;
  - the consumer check's lockfile and verification metadata refreshed from a fresh `GRADLE_USER_HOME` after the `androidx.activity` change: not done (section 10);
  - gitleaks installed in the `infra` job before `ci-workflow.test.sh` (release-checks' followup): not handled; `ci.yml`'s `infra` job still runs `bash infra/tests/ci-workflow.test.sh` before its "Install gitleaks" step, and the skip was not made a failure;
  - the consent and notice export order (`i18n:export`, `generateLocaleStrings`, `exportConsentTexts`, the digests): none of these commands was run; the agent changed no consent or notice text or key;
  - `OPENVERIFY_SANDBOX_CHIP_FACES` and `trust:sandbox-utopia` in the docs: the variable is now in `.env.example` and the e2e environment (5); the docs already named both (`docs/android/nfc.md` and `docs/checks/nfc.md`, commit `8ee5c7ecd`); `trust:sandbox-utopia` was not added to `CLAUDE.md`'s command list.
- **CI in `ci.yml`: partly.** The steps and both floors are written and held (14). Not done: the job times set against each job's timeout with Phase 8 F08's 25% rule, the per-push minutes estimate, and the `e2e` job against its 60-minute `globalTimeout` (R006). The agent read the base run's times (the `e2e` job took 40.0 min, `android` 21.8 min) and wrote no estimate. KP10-1's trace upload is kept (untouched).
- **The OpenAPI snapshot: done** (`0a33b1f17`). **`@openverify/node` and `contracts/fixtures/api/*`: no regeneration run and no commit** (section 1). `ContractFixturesTest`'s list and `flow-spec-members.json`: no evidence in the transcript.
- **The PLAN corrections of C222: done for section 6** (`b8bde96c3`). Whether sections 3 and 9 of `docs/PLAN.md` needed a 10C correction: no evidence in the transcript.
- **The plan amendments: not written.** `docs/plans/phase-10.plan.md` has no "## Workflow 10C Stage 2 amendments" and no "## Workflow 10C Stage 3 amendments (integration-10c)" section (`grep -n '^## Workflow 10C'` gives only the Workflow section at line 730 and the Stage 1a amendments at line 1433), and the agent made no commit to that file (`git log 4e2a0c32..HEAD -- docs/plans/phase-10.plan.md` lists only contracts-10c's `97d1476e4`). So none of the Stage 2 reports' contractDeviations is recorded in the plan as a binding decision, and neither are this agent's own: `read_failed` as the fifth reason, the reference-workload CPU budgets, liveness advisory in the 10C fixture, the demo's floor, the `sdk,nfc` manifest call, `check-consumer-rules.py` in gate call (7), and any change to the Validation order.
- **This TDD file: not written by the agent.** Three of its commits point at it (`CpuCost.kt`, the two cost tests, `ci.yml`'s floor comment). The orchestrator wrote it (see the header).
- **The draft of the Phase 10C entry for `docs/PROGRESS.md`: not written.** No handoff was produced at all, so there is no "Unproved on a device" section with the reports' "device proof open" lines word for word, no known-item outcomes (KP10-21, KP10-22 with their RED and GREEN commits; the deferred items under "Carried forward"), no owner items P1 to P5, no CI estimate.
- **The handoff's list headed "UNPROVED ON A DEVICE": not written.** The only statements of the kind the agent wrote are section 15's quoted PLAN sentence, `629c4d82b`'s "written and held, no run claimed", and `ci.yml`'s comment on the three static checks ("nothing is loaded or run on a device here").
- **The measurements list** (each new spec's duration inside a shard, the shard times, the mocked and full-stack totals, each split Gradle call with its wait and load, test counts per Android module, coverage, the golden count and size): only what sections 7, 8, 12, 13 and 16 hold.

From the Validation list:

- **1** (`pnpm install --frozen-lockfile`, `pnpm format:check`): done, rc 0 and 0.
- **2** (forced typecheck, forced lint in CI's form): done, rc 0 for all four calls.
- **3** (`fetch_models.py`, `fetch_data.py`, `build:variant-groups`, `fetch_bundletool.py`): done, rc 0 for all four.
- **4** (`pnpm test`): partly. The three calls outside the API and `@openverify/js` passed (rc 0). The API's eight shards ran and wrote their blobs; **the merge was not run**, so the API's test count, its result and its coverage against the 80% gate are not established by the agent.
- **5** (`benchmark:typecheck`, `benchmark:test`): not run.
- **6** (`pnpm test:integration` as five calls): not run.
- **7** (the vision suite: `uv lock --check`, ruff, format, mypy, pytest in two calls): not run.
- **8** (the Android gate's calls (1) to (8), then CI's Android calls from a fresh `GRADLE_USER_HOME` with dependency verification on): not run as a gate. Call (1)'s three `-PhostTestGroup` calls with `--rerun` were run once before the Validation, at `75367eda2` (section 13); the screenshots, `koverVerify`, `checkKotlinAbi`, `testDebugUnitTest assembleDebug`, `:openverify-sdk:assemble`, `lint`, `assembleAndroidDeviceTest`, gate calls (7) and (8) as such, and the whole cold pass were not run. With no CI run to count on, the cold pass was the only proof that a cold runner resolves what 10C added; the agent did not give it.
- **9** (`openapi:write` then `git diff --exit-code docs/api/openapi.json`; `workflow-docs:write` then the diff): not run as a validation step. `openapi:write` was last run for `0a33b1f17`, before the later commits.
- **10** (the e2e gate: the mocked flow suite, a fresh stack, the four chromium shards, the console sweep, `stackTest` after the sweep, the stack down): not run.
- **10b** (WebKit's `theme-csp` through Docker): not run.
- **11** (the three `docker build` calls): not run.
- **12** (each `infra/tests/*.test.sh` as its own call): not run as a validation step. `ci-workflow.test.sh` (366 passed) and `compose.test.sh --static-only` (536 passed) were run for their slices; the live halves and the other scripts were not.
- **13** (`gitleaks git --redact .`): not run. (The pre-commit hook's scan shows in the first commit's output: "no leaks found".)
- **The two CI-form lines** (the one-call Android gate and its added step): held through `ci-workflow.test.sh` only; not run locally, and no split-call sum was recorded for them.

## Closed by the orchestrator after the cut-off (2026-11-10)

Everything below was run by the orchestrator, alone in the repository, after the Workflow ended.

### The full local validation at `b8bde96c3`

`bash validate-full.sh /tmp/validate-10c` (the orchestrator's script; the Android rows use a fresh `GRADLE_USER_HOME` with verification on). All 25 rows exited 0:

```
install rc=0 0s
models rc=0 1s
data rc=0 0s
variant-groups rc=0 8s
format rc=0 122s
lint rc=0 318s
typecheck rc=0 138s
test rc=0 2035s
benchmark-typecheck rc=0 45s
benchmark-test rc=0 11s
integration rc=0 467s
vision rc=0 573s
android rc=0 596s
android-10a rc=0 282s
android-10c rc=0 76s
openapi rc=0 21s
e2e rc=0 1819s
stack-test rc=0 154s
image rc=0 285s
image-vision rc=0 31s
image-code-runner rc=0 88s
workflow-benchmark rc=0 146s
benchmark rc=0 61s
infra rc=0 81s
gitleaks rc=0 9s
done
```

`android-10c` is the row added for this Workflow: `python3 -I scripts/fetch_bundletool.py`, the release checks' tests, `check-elf-alignment.py`, `check-consumer-rules.py`, `check-size.py`, the floors (SDK 2,602, demo 80 + 8, none skipped) and `./gradlew -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest`. `infra.log` holds no FAILED line.

### The device tests on a Pixel 9 (Android 17, API 37, arm64-v8a), over wireless adb

RED, the suite as the agents left it (`./gradlew :openverify-sdk:connectedAndroidDeviceTest`): 9 tests, 5 failures.

```
FAIL CameraXCaptureCameraTest takesAnUprightJpegAfterThePreviewStarts
FAIL CameraXFramePipelineTest theForcedTwoUseCaseFallbackGivesNoFramesAndStillTakesThePhoto
FAIL CameraXFramePipelineTest theBarcodeSideIsReadAtLeast1280WideAndItsCopyIsMeasuredAgainstAFullResolutionCrop
FAIL CameraXFramePipelineTest threeUseCasesBindTogetherAndFramesArriveAtTheSampledRate
     java.lang.RuntimeException: java.util.concurrent.ExecutionException: java.lang.RuntimeException: java.lang.NoSuchMethodException: android.hardware.input.InputManager.getInstance []
     	at androidx.test.espresso.Espresso.onIdle(Espresso.java:18)
FAIL IntegrityProbesDeviceTest theProbesAnswerWithinTheBoundAndTheCiEmulatorReportsItself
     java.lang.AssertionError: the CI emulator reported no emulator indicator
I openverify-probes: probes total 188.2 ms (bound 500 ms, target 50 ms)
```

The four camera failures are Espresso 3.5.0 on Android 16 or later; the fifth is the test asserting an emulator on a phone.

With Espresso 3.7.0 on the device-test classpath (`4fbd294fa`): 9 tests, 1 failure (the emulator assertion), and for the first time on any device:

```
I OpenVerifyCameraTest: barcode analysis 1280x960 rotation 90: 0.5618721 ms a copy; guide crop 3672x2315 of 4080x3072: 2.323287166666667 ms
I openverify-probes: probes total 94.9 ms (bound 500 ms, target 50 ms)
I openverify-probes: probes read build: 0.0 ms in 1 call(s)
I openverify-probes: probes read files: 0.7 ms in 21 call(s)
I openverify-probes: probes read mounts: 2.4 ms in 1 call(s)
I openverify-probes: probes read maps: 43.7 ms in 1 call(s)
I openverify-probes: probes read threads: 7.1 ms in 1 call(s)
I openverify-probes: probes read classes: 0.4 ms in 2 call(s)
I openverify-probes: probes read stack: 0.1 ms in 1 call(s)
I openverify-probes: probes rules and first use, outside the reads: 40.5 ms
I openverify-probes: probes sizes: 780 mapped paths, 63 threads, 188 mounts
```

The device kind. RED in `infra/tests/ci-workflow.test.sh` (`a04c3239e`):

```
FAIL - android-instrumented: the SDK's device tests are told the device is an emulator
FAIL - release: devices: the SDK's device tests are told the device is an emulator
# 366 passed, 2 failed, 0 skipped
```

GREEN (`801b06001`: both workflows pass `-Pandroid.testInstrumentationRunnerArguments.openverifyDeviceKind=emulator`; the test asserts per kind): `# 368 passed, 0 failed, 0 skipped`. On the Pixel as a phone:

```
9 tests 0 failures 0 skipped
I OpenVerifyCameraTest: barcode analysis 1280x960 rotation 90: 0.5798935666666666 ms a copy; guide crop 3672x2315 of 4080x3072: 2.3920246333333335 ms
I openverify-probes: probes total 98.0 ms (bound 500 ms, target 50 ms)
```

and `adb shell am instrument -r -w ... dev.openverify.sdk.test/androidx.test.runner.AndroidJUnitRunner` ends `OK (9 tests)`. The same phone told it is an emulator (`-P...openverifyDeviceKind=emulator`, the class alone): 1 test, 1 failure, `java.lang.AssertionError: the emulator reported no emulator indicator`, which is the assertion working.

Open (KP10-31): in each passing phone run the Gradle task itself exited failed, "There were failing tests", while its HTML report reads "9 tests 0 failures 0 skipped ... 100% successful" and `test-result-exit-code.txt` holds 1. Cause not found.

### The dependency change from a cold Gradle home

`GRADLE_USER_HOME=/tmp/validate-10c/gradle-home-2 ./gradlew --no-daemon :openverify-sdk:assembleAndroidDeviceTest lint`: `BUILD SUCCESSFUL in 5m 38s`, no verification failure. Every `infra/tests/*.test.sh` green; `pnpm format:check`: "All matched files use Prettier code style!".

### The demo's minifiedSmoke device test on the Pixel 9 (KP10-32, not fixed)

`./gradlew :demo-app:connectedMinifiedSmokeAndroidTest`: 0 tests, the task failed.

```
E AndroidRuntime: FATAL EXCEPTION: main
E AndroidRuntime: Process: dev.openverify.demo, PID: 19816
E AndroidRuntime: java.lang.NoClassDefFoundError: Failed resolution of: Landroidx/tracing/Trace;
E AndroidRuntime: 	at androidx.test.runner.AndroidJUnitRunner.onCreate(r8-map-id-1403c44b6b64b36d28536631248dea7f3e2901ed2e79916348aaf75cf8766f3c:26)
```

With `-keep class androidx.tracing.** { *; }` tried in `smoke-proguard-rules.pro` (not committed): 0 tests again,

```
E AndroidRuntime: java.lang.NoClassDefFoundError: Failed resolution of: Lkotlin/LazyKt;
E AndroidRuntime: 	at androidx.test.platform.io.TestDirCalculator.<init>(...)
E AndroidRuntime: 	at androidx.test.runner.AndroidJUnitRunner.registerTestStorage(...)
```

The runner shares its libraries with the minified app, and R8 removes what the app does not call. The trial rule was reverted; the fix is 10D's (KP10-32).

