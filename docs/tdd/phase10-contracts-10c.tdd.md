# Phase 10, Workflow 10C Stage 1a: contracts-10c

Evidence for Stage 1a of Workflow 10C (NFC in the SDK, shipping and the demo). Base `f71b0f6d`, decisions `4e2a0c32`. contracts-10c ran alone but for carry-10c, which worked in the capture pipeline and the integrity probes. Every command below was run on 2026-11-10; outputs are abbreviated. The drift and the frozen names are in `docs/research/phase10-inventory.md` section 10 and in the plan's "## Workflow 10C Stage 1a amendments (contracts-10c)".

## 1. The base and its CI

```
$ git log -1 --format=%H -S "Phase 10, Workflow 10B done" -- docs/PROGRESS.md
f71b0f6d89fb428117d61e503a872f4ad3a6999c
$ git merge-base --is-ancestor f71b0f6d... origin/main; echo $?
0
$ gh run view 42762952128 --json jobs,conclusion,headSha
conclusion failure, headSha f71b0f6d..., 17 jobs success, 1 failure: android-instrumented (emulator)
$ gh run view 42762952128 --log-failed
java.lang.AssertionError: the barcode side is read at 1,280 px when the camera has it: 640x480, largest (1856, 1392)
java.lang.AssertionError: the probes took 520.0 ms, over the 500 ms bound
```

Both failures are carry-10c's known items (KP10-21, KP10-22). contracts-10c fixed neither and had no CI fix of its own. No later run exists and none is waited for (rule 28).

## 2. C207.2: a challenge before any upload (a confirmation, not a RED)

`apps/api/src/services/chip-challenges/challenge-before-upload.integration.test.ts` describes what Phase 5 built, so it passed on its first run; it is a regression test for the SDK's "I'm ready" sequence.

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/chip-challenges/challenge-before-upload.integration.test.ts
 Test Files  1 passed (1)   Tests  2 passed (2)   Duration 24.78s     (load 6.5)
```

Commit `8b18e1c0`.

## 3. Spike (d)

In a scratch worktree (`/tmp/ov-spike-d`, removed with `git worktree remove --force` and `git worktree prune`):

```
$ ./gradlew --no-daemon --dependency-verification off --write-locks -Dmaven.repo.local=/tmp/ov-spike-d/m2 \
    :openverify-sdk:publishToMavenLocal :openverify-nfc:publishToMavenLocal
rc=0, 246 s, load 18.0, no Gradle lock wait
dev/openverify/openverify-sdk/0.1.0/           (root: .module, .pom, sources, javadoc, metadata jar)
dev/openverify/openverify-sdk-android/0.1.0/   (.aar 3.0 MB, sources, javadoc 1.2 MB / 446 entries, .pom, .module)
dev/openverify/openverify-nfc/0.1.0/           (.aar, sources, javadoc, .pom, .module)
dev/openverify/openverify-sdk-iosarm64/, -iossimulatorarm64/   (published by default; disabled in the build)
POM: <artifactId>okhttp-android</artifactId> <scope>compile</scope>
```

Outcome: `com.vanniktech.maven.publish` 0.37.0 with Dokka 2.2.0, neither fallback.

## 4. (N), test-first

Each slice is a stub commit (the names, so the RED compiles and typechecks), a RED commit and a GREEN commit.

| Slice | Stub | RED | GREEN |
|---|---|---|---|
| The SDK's wire models, `FlowApi` signatures, `FlowState.Nfc`, the hooks, `NfcPlatform` | `8d844c53` | `b8da4f0e` | `cc75c635` |
| The nfc client view, client-unable, sandbox-chip, problems, policy, acknowledgement | `a92909a3` | `43a2492b` | `eed5a1f7` |
| The API's frozen routes and hooks | `4855cd96` | `7952cb70` | `f113efd6` |
| The request fixtures' index entries | | | `b2e60278` |
| `openverify-nfc`'s manifest | | `2ac502e7` | `321f2dae` |
| The web dispatch | `0fa7d241` | `b9c4d838` | `1cb0b423` |
| Migration 0034 | `606ba624` | `a28d412f` | `cfd77310` |
| The `sandbox-chip` attribute | `b269b5bb` | `2be7f86e` | `3b2a946f` |

### 4.1 flow-spec and contracts

RED (`43a2492b`), against the stubs:

```
$ pnpm --filter @openverify/flow-spec exec vitest run src/v2/client-view-nfc.test.ts --coverage.enabled=false
 × takes the three new members, each optional, and nothing else
 × holds prefillMrz to the MRZ’s key fields and marks it PII          (expected never, received object)
 × says whether the step has an exhausted edge, from the flow alone
 × is an acknowledgement kind of its own, after the Phase 9 kinds
 × has its step-record note codes: the report, its reason and the platform   (expected '' to be 'client-unable')
 Tests  5 failed | 4 passed (9)
$ pnpm --filter @openverify/contracts exec vitest run src/phase10c-contracts.test.ts src/fixtures.test.ts src/rate-limits.test.ts --coverage.enabled=false
 Tests  27 failed | 633 passed (660)     (the goldens missing, the lists without 10C's members, the stubs refusing everything)
```

The ninth flow-spec test ("reads a client-unable exit as any fallback") describes `flowOutcome`'s existing rule and passed from the start; it is there to hold the rule the engine's hook rests on.

GREEN (`eed5a1f7`): `flow-spec` 479 passed; `contracts` 4,461 passed. Two things the first GREEN run found and fixed before the commit: the session goldens needed the v1 projection's `transitions`, and the Active Authentication response's cap test used a length that is exactly the 1 KiB maximum. gitleaks refused the first commit over the fixture's base64 Active Authentication response (rule `generic-api-key`); the value was reworded to zero bytes, nothing was allowlisted.

`d0ab7c6a` (fix): the two session goldens held a complete v1 flow, which `migrate.test.ts` reads as a stored v1 flow needing a migration golden. A spec-2 session serves a projection (the placeholder after the current step), so the goldens now hold that.

### 4.2 The API

RED (`7952cb70`), run before the routes were registered and the hooks placed:

```
$ pnpm exec vitest run src/routes/nfc-routes.test.ts --coverage.enabled=false
 × is frozen at 501 under session authentication          (expected 404 to be 501)
 × counts per inquiry under flow-sandbox-chip, 10 an hour, beside flow-session   (expected [] to deeply equal [ 'inq_…' ])
 × lists both routes under the flow API, the sandbox one documented as sandbox-only
 Tests  7 failed (7)
$ pnpm exec vitest run src/flow-engine/client-unable-hooks.test.ts --coverage.enabled=false     (exits.ts with the stub case)
 Tests  6 failed | 12 passed (18)     (the hook never asked; the step never left; 'pending' where 'needs_review' and 'completed' were expected)
```

GREEN (`f113efd6`): `nfc-routes.test.ts`, `client-unable-hooks.test.ts` and `verification-mutations.contract.test.ts` 59 passed. Between RED and GREEN the route tests changed once: C52.1's contract test requires every mutation of a verification to run the preconditions, so the stubs call `requireFlowVerification` before their 501, and the route tests seed a consented session with an `initiated` NFC verification. The production case was added then too (the sandbox route answers the 404 of an unknown route).

The lint gate later refused the stubs' underscore parameters and one unused binding in a test; `f18a6879` and `3c8713ef` fixed them with no behaviour change.

### 4.3 The SDK

RED (`b8da4f0e`):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests ...NfcStepHooksTest --tests ...NfcWireModelTest --tests ...StepRegistryTest --tests ...ContractFixturesTest ...
NfcStepHooksTest > the registry runs an nfc step in the coordinator ... FAILED   (expected: <Run> but was: <Shown(state=Unsupported(reason=step nfc))>)
NfcStepHooksTest > closing an NFC screen cancels, and the events name the nfc step() FAILED   (expected: <nfc> but was: <null>)
NfcStepHooksTest > an accepted chip submit is a submission ... FAILED   (expected: <1> but was: <0>)
NfcWireModelTest > an nfc client view decodes as NfcStep ... FAILED   (was: <UnsupportedStep(id=chip, type=nfc)>)
StepRegistryTest > consent and every verification step run in the coordinator (C193_4)(String) > [12] nfc FAILED
183 tests completed, 10 failed
```

Two of the ten were not the intended reason and were fixed before GREEN: the sandbox-chip fixture did not decode (`FileKind` needs its serializer named in `Nfc.kt`; fixed in `eed5a1f7`, where the fixture landed), and the test's session token was not token-shaped.

GREEN (`cc75c635`): the three host-test groups, 450 + 402 + 1,532, none skipped, none failed; `:openverify-sdk:assemble` (the iOS klibs) and `checkKotlinAbi` exit 0. The ABI is unchanged by (N): every new declaration is internal.

### 4.4 Migration 0034

RED (`a28d412f`): `migration-0034.test.ts` 4 failed, 2 passed (`expected -1 to be 34`; the CHECK's definition empty; `setChipChallengeSandboxScenario` answered false). GREEN (`cfd77310`): 6 passed; the db package's whole script 2,211 passed at 91.1% lines; `migration-0034.integration.test.ts` on Postgres 17, 2 passed. Generated by `drizzle-kit generate --name phase10c`, with a header comment and no hand edit.

PGlite migration time, under the e2e lock, a fresh PGlite each time, load 0.9: up to 0033 4,885, 4,080 and 4,138 ms; up to 0034 4,212, 4,263 and 4,187 ms.

### 4.5 The web flow

RED (`b9c4d838`): `expected { kind: 'unsupported', … } to deeply equal { kind: 'nfc', … }`, twice. GREEN (`1cb0b423`): the flow package's 1,521 unit tests pass.

### 4.6 OpenAPI

`pnpm --filter @openverify/api openapi:write` twice; the second run changed nothing. `docs/api/openapi.json` sha256 `6fcab21c…e94b` (`e51656a6`, then `3b2a946f` for the `sandbox-chip` attribute).

## 5. (D)

`scripts/fetch_bundletool.py`: RED `ec970e67` (the module does not exist: 1 error), GREEN `4c33f008` (11 passed; `ruff check`, `ruff format --check` and `mypy src tools` clean).

The build changes (`a5b12811`) were made in a scratch worktree (`/tmp/ov-10c-d`), with a fresh `GRADLE_USER_HOME` (`/tmp/ov-10c-gh`), then copied into the main tree under the Gradle lock in one step, and the worktree removed:

```
$ GRADLE_USER_HOME=/tmp/ov-10c-gh ./gradlew --no-daemon resolveAndLockAll --write-locks --write-verification-metadata sha256
rc=0, 136 s (cold: the Gradle distribution and every build-script file downloaded)
$ ... --write-verification-metadata sha256 testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease      rc=0, 222 s
$ ... --write-verification-metadata sha256 :openverify-sdk:assemble lint :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest
rc=1: :demo-app:minifyMinifiedSmokeAndroidTestWithR8: Missing class com.google.errorprone.annotations.CanIgnoreReturnValue ...
   -> android/demo-app/test-proguard-rules.pro (two -dontwarn lines for compile-time annotations); rerun rc=0, 62 s
$ ... :openverify-sdk:testAndroidHostTest -PhostTestGroup=flow checkKotlinAbi publishAllPublicationsToStagingRepository :openverify-sdk:screenshotTest
rc=1: checkKotlinAbi: "Library unique name" <openverify-android:openverify-sdk> -> <dev.openverify:openverify-sdk>
   -> ./gradlew updateKotlinAbi (its own build), then rerun rc=0, 142 s
verification-metadata.xml: +367 lines, 53 components
```

Two build-script findings on the way: the KMP plugin's `consumerKeepRules` is a property, not a block; and a task predicate that read the publication was refused by the configuration cache, so the iOS publish tasks are skipped by name.

No Kover exclusion was added. Robolectric's `android-all` and the Kotlin/Native toolchain stay outside Gradle's resolution, as before.

## 6. Gates as run

Loads are from `/proc/loadavg` at the end of each call. No Gradle call waited for its lock.

| Gate | Result |
|---|---|
| `pnpm turbo run typecheck --force` | exit 0, 17 tasks, 125 s, load 6.0 |
| lint, forced, `--concurrency=1`, 4 GB heap: api | exit 0, 183 s, load 1.1 |
| lint: dashboard and contracts | exit 0, 208 s, load 1.6 |
| lint: the other 14 packages | exit 0, 304 s, load 1.5 |
| `pnpm format:check`; `prettier --check --ignore-path=.gitignore` on the `apps/api/src/services/` files written here | exit 0 (102 s); clean |
| API unit suite, 8 blob shards and a merge | merge exit 0: 9,599 tests in 718 files, 94.39% statements; shards 142 to 180 s at load 7.1 to 9.1, merge 32 s |
| unit: watchlist, e2e, db | exit 0, 355 s, load 1.7 (db 2,211 tests) |
| unit: dashboard | exit 0, 369 s, load 7.2: 6,755 tests, 95.58% |
| unit: the other 12 packages, then `@openverify/js` | exit 0, 175 s, load 13.5: contracts 4,461, checks 3,849, workflow-engine 1,990, core 1,659, flow 1,521, node 486, flow-spec 479, emrtd 318, config 290, signals 192, ui 58, js 19 |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` | exit 0 |
| `openapi:write` twice | exit 0; the second run changed nothing |
| `bash infra/tests/ci-workflow.test.sh` | exit 0: 266 passed |
| Android (1): `-PhostTestGroup=ui`, `flow`, `rest` | exit 0: 450 + 402 + 1,534 = 2,386 tests, none skipped; 182, 47 and 78 s at load 2.3 to 3.0 |
| Android (2): `screenshotTest -Proborazzi.test.verify=true` | exit 0, 52 s; 59 goldens |
| Android (3): `koverVerify checkKotlinAbi` | exit 0, 133 s, load 2.8 |
| Android (4): `testDebugUnitTest assembleDebug`; `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0, 81 s; exit 0, 153 s (load 8 to 10) |
| Android (5): `:openverify-sdk:assemble`; `lint` | exit 0, 43 s; exit 0, 162 s |
| Android (6): `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | exit 0, 185 s, load 10.8 (the first build of the minified device-test APK) |
| Android (7): `fetch_bundletool.py`, `check-elf-alignment.py`, `check-size.py` | exit 0 each; the two checks are stubs that print `not-built`, so this call proves nothing yet |
| Android (8): `publishAllPublicationsToStagingRepository`; `-p consumer-check build` | exit 0, 38 s; exit 0, 6 s (the consumer check is a skeleton) |

| `pnpm install --frozen-lockfile` | exit 0; the lockfile is up to date |
| integration: `@openverify/db` | exit 0, 141 s, load 18.4: 83 tests |
| integration: api `--project graph` | exit 0, 58 s, load 9.6: 13 tests |
| integration: api `--project api --shard=1/3`, `2/3`, `3/3` | exit 0 each: 97, 103 and 90 tests in 88, 182 and 83 s at load 9.0 to 17.2 |
| the mocked flow suite | exit 0, 124 s, load 15.1: 328 passed (after the fix below) |
| the stack: down and build; up | exit 0, 24 s; exit 0, 117 s |
| chromium shards 1 to 4, each under the e2e lock on the reusable stack | exit 0 each: 51, 45, 46 and 47 tests in 259, 324, 298 and 359 s at load 1.8 to 3.2 |
| the console sweep, on the used stack | exit 0, 302 s, load 2.5: 104 passed |
| `:openverify-sdk:stackTest`, the e2e lock outside and the Gradle lock inside | exit 0, 34 s: 1 test |
| the stack down | exit 0 |

The host-test count rose from 2,321 to 2,386 with carry-10c's tests; the CI floor is integration-10c's to raise. The integration counts rose by this Stage's files: db 81 to 83 (`migration-0034.integration.test.ts`), api 288 to 290 (`challenge-before-upload.integration.test.ts`).

**A test that failed under load, fixed.** The first run of the mocked flow suite (load 14.6) failed one test, `e2e/crypto-wallet.spec.ts:134` ("pastes a signature"): `expect(message).toHaveValue('')` against the server's message. The spec read the mock's recorded challenge straight after the click, before the request had arrived, so it compared with an empty string. It is a Phase 5 spec that Stage 1a did not touch; the same suite passed on the next run. The read now waits for the recorded challenge (`expect.poll`), commit `4c39dced`; the suite then passed again at load 15.1 (328 passed).

## 7. Checkpoints

- **Checkpoint 1, (N):** `97d1476e`, "Workflow 10C contracts-10c checkpoint 1 (N)".
- **Checkpoint 2, (D):** `1e344fb7`, "Workflow 10C contracts-10c checkpoint 2 (D)".
- **Checkpoint 3:** the commit whose subject holds "Workflow 10C contracts-10c checkpoint 3": the integration and e2e gates of section 6, run after checkpoint 2.

`git log --grep "Workflow 10C contracts-10c checkpoint"` names all three.

## 8. What Stage 1a did not do

Recorded so that nobody reads the gates above as the whole Validation:

- The vision suite was run only for the new test file (`tests/test_fetch_bundletool.py`, 11 passed), with ruff and mypy; nothing else in `services/vision` changed.
- CI's one-call Android gate was not run from a second fresh `GRADLE_USER_HOME`. What was run: the metadata-writing passes of section 5 from a cold home, and then, from that same home with verification on, in the main tree, `testDebugUnitTest assembleDebug :openverify-sdk:assemble checkKotlinAbi :demo-app:bundleRelease :demo-app:assembleAndroidTest :openverify-sdk:assembleAndroidDeviceTest publishAllPublicationsToStagingRepository` (exit 0, 35 s, most tasks up to date). integration-10c's Validation runs CI's calls from a fresh home.
- Docker WebKit's theme-csp was not run; no flow style or CSP file changed.
- No device test was run (rule 28): this Stage added no device test and no device-only behaviour.
- The console's "Test chip (sandbox)" label (amendment 9) and the real consumer check, ELF and size checks (amendment 24) are other agents'.
