# Phase 11: the orchestrator's slices between Workflows

## The web packages' pack test under load (after Workflow 11C, 2026-11-16)

The full validation of the 11C tree (`4758c01d5`, `validate-full.sh`, every package's tests at once under turbo) failed one file, and only
that one:

```
@openverify/react:test:  FAIL  scripts/pack-real.test.ts > @openverify/node
@openverify/react:test: Error: Hook timed out in 60000ms.
@openverify/react:test:  ❯ scripts/pack-real.test.ts:169:3
@openverify/react:test:       Tests  53 passed | 2 skipped (55)
@openverify/react:test:    Duration  218.11s
 Tasks:    18 successful, 19 total
Failed:    @openverify/react#test
```

The hook builds `@openverify/contracts` for real (TypeScript's declaration emit in a child process, type check off), which is what the
file proves: each publishable package is built fresh, packed by the release tool, and the Node client's tarball runs. Alone, at load 2 on
12 cores, the whole file passes in 27 s (4 of 4) and the contracts' emit takes about 14 s. In the all-packages run the file took 214 s,
and that hook passed the shared 60 s guard from `createVitestConfig()`.

Unlike the 9C OpenAPI hook (`phase9-orchestrator.tdd.md`, where the slow work was not needed and was removed), here the work is the
test. The repository's convention for hooks that build or start something heavy is a per-hook bound (`worker-exports.test.ts` 120 s,
`blind-index-rebuild.integration.test.ts` 180 s). The six build hooks of `pack-real.test.ts` now take `BUILD_HOOK_TIMEOUT_MS = 240_000`,
with the measurements in a comment; the `mkdtemp` hook keeps the shared guard, and a hang still fails.

**RED:** the all-packages run above (`/tmp/validate-11c/test.log`, rc 1, 2,102 s).

**GREEN:** the file alone, then the same all-packages call:

```
$ (cd packages/sdk-react && pnpm exec vitest run scripts/pack-real.test.ts --coverage.enabled=false)
      Tests  4 passed (4)
   Duration  26.97s
$ pnpm exec prettier --check packages/sdk-react/scripts/pack-real.test.ts; pnpm --filter @openverify/react lint; pnpm --filter @openverify/react typecheck
All matched files use Prettier code style!   (eslint and tsc: exit 0)
$ pnpm turbo run test --force --continue        # /tmp/validate-11c/test-rerun.log, 2,123 s
@openverify/react:test:  Test Files  4 passed (4)
@openverify/react:test:       Tests  55 passed (55)
@openverify/react:test:    Duration  338.44s
@openverify/api:test:       Tests  10886 passed (10886)    (94.16% statements)
@openverify/dashboard:test: Tests  7235 passed (7235)      (95.62% statements)
@openverify/db:test:        Tests  2357 passed (2357)      (89.88% statements)
 Tasks:    18 successful, 19 total
Failed:    @openverify/flow#test
```

The react file took 338 s in the second all-packages run, so the 60 s guard could not have held there either.

### KP11-44: a flow screen test met its 60 s guard in the second all-packages run (recorded, carried to 11F)

The second run failed one different test, which 11C did not touch (last changed `8f1195719`, 2026-11-05):

```
@openverify/flow:test:  FAIL  src/screens/screen-catalogue.test.tsx > the component catalogue (C148.2) > collects every kind into one submission
@openverify/flow:test: Error: Test timed out in 60000ms.
@openverify/flow:test:       Tests  1 failed | 1677 passed (1678)
@openverify/flow:test:    Duration  492.56s (141 workers spawned, ~5.46 s startup each)
```

Alone it takes 2.3 s (the file 8.9 s, 4 of 4). It types about 90 characters with `userEvent` (a timer between keystrokes) and
passed in the first all-packages run on the same flow code (1,678 passed). The cause under load is not established, so it is not
patched here (rule 6: deterministic, never retried into green). It joins the failures-under-load class of KP11-24, KP11-25, KP11-33,
KP11-34 and KP11-38, carried to 11F (fix-clients, with KP11-25).

Between the two all-packages runs only `pack-real.test.ts` changed, so every package's suite passed on this tree at least once in
the all-at-once form: the first run all but react, the second all but this one flow case.

## validate-full after Workflow 11D (2026-11-20): two guards under load and the stack row (recorded, nothing patched)

`bash validate-full.sh /tmp/validate-11d` on `baf7e3229`, alone on the machine, with load/'s gate as its own row. Every row rc 0
but `test` and `stack-test`.

### KP11-66 and KP11-67: two cases met the shared 60 s guard in the all-packages run (recorded, carried to 11F)

```
@openverify/dashboard:test:  FAIL  src/components/operators/role-form.test.tsx > RoleForm > shows the API's refusal, such as a name already taken
@openverify/dashboard:test: Error: Test timed out in 60000ms.
@openverify/dashboard:test:  Test Files  1 failed | 621 passed (622)
@openverify/api:test:  FAIL  src/watchlists/rekey-batch.test.ts > the re-key’s batch size (C270.2) > leaves every derived column identical for each candidate size
@openverify/api:test: Error: Test timed out in 60000ms.
@openverify/api:test:       Tests  1 failed | 10962 passed (10963)
```

In that run the role-form file took 222 s (its other cases 17-58 s each) and the rekey-batch file 135 s. Alone, after
validate-full ended (load 1.6), measured once and not counted as a pass:

```
pnpm --filter @openverify/api exec vitest run src/watchlists/rekey-batch.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  25.84s
pnpm --filter @openverify/dashboard exec vitest run src/components/operators/role-form.test.tsx --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  11.92s
```

The cause under load is not established, so neither is patched (rule 6: never retried into green). KP11-66 (role-form, last
changed `e0bb01944`, 2026-11-07) joins KP11-25 and KP11-44 with 11F's fix-clients; KP11-67 (rekey-batch, nine re-keys of 1,200
entries, last changed `7915372b0` in fix-11d) is 11F's, the same class.

### stack-test: the dashboard build stopped by Next.js's security notice (KP11-42) and one bucket-init exit (KP11-68)

Three starts of the reusable stack; `:openverify-sdk:stackTest` ran in none of them:

1. validate-full's row (92 s): `next build` for the dashboard ended with `Error [SecurityFatalError]: Your version of Next.js is
   affected by a known security vulnerability.` (Next.js 16.4.2), as in fix-11d's Validation.
2. Once more (19 s): `docker compose wait objectstore-init` exited 1 at +14.5 s, before the build. Started by hand under the e2e
   lock straight after, every service was healthy in 6 s and `objectstore-init` printed `bucket openverify-files ready
   (versioning Enabled)`, exit 0. Cause not established: KP11-68, 11F.
3. Once more (101 s): the same SecurityFatalError.

Nothing was upgraded (rule 3); the notice joins 11G's dependency review with KP11-42. osv and pnpm-audit passed in the same run.
The `e2e` row (1,980 s) and `image-dashboard` (214 s) built the dashboard without the stop. android/ is unchanged since `d44e537db`,
and fix-11d's Validation ran stackTest 3 of 3 on this tree.

## validate-full after Workflow 11E (2026-11-20): KP11-67 again and the stack row (recorded, nothing patched)

`bash validate-full.sh /tmp/validate-11e` on `778dfd414`, alone on the machine, with 11E's four new rows (`docs-render`,
`release-check`, `verify-ids`, `docs-drafts`), each rc 0. Every row rc 0 but `test` and `stack-test`.

### KP11-67: the re-key case met the shared 60 s guard in the all-packages run again (recorded, carried to 11F)

```
@openverify/api:test:  ❯ src/watchlists/rekey-batch.test.ts (4 tests | 1 failed) 168268ms
@openverify/api:test:      × leaves every derived column identical for each candidate size 79532ms
@openverify/api:test:  FAIL  src/watchlists/rekey-batch.test.ts > the re-key’s batch size (C270.2) > leaves every derived column identical for each candidate size
@openverify/api:test: Error: Test timed out in 60000ms.
@openverify/api:test:  Test Files  1 failed | 867 passed (868)
@openverify/api:test:       Tests  1 failed | 10962 passed (10963)
```

Every other package passed (dashboard 622 of 622 files; KP11-66 was not met). The file is unchanged since `7915372b0`
(fix-11d). Alone, after validate-full ended (load 2.6), measured once and not counted as a pass:

```
pnpm --filter @openverify/api exec vitest run src/watchlists/rekey-batch.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  24.34s
```

Twice now under the all-packages load (135 s and 168 s for the file), never alone. The cause is not established, so nothing is
patched (rule 6); KP11-67 stays 11F's fix-server item with this run added to its evidence.

### stack-test: the dashboard build stopped by Next.js's security notice (KP11-42)

validate-full's row (95 s): `next build` for the dashboard ended with `Error [SecurityFatalError]: Your version of Next.js is
affected by a known security vulnerability.` (Next.js 16.4.2), as after 11D; `:openverify-sdk:stackTest` did not run. Not
retried and nothing upgraded (rule 3): the notice stays with 11G's dependency review under KP11-42. The `e2e` row (2,116 s) and
`image-dashboard` (150 s) built the dashboard without the stop, and osv and pnpm-audit passed in the same run. android/ is
unchanged since `f7610de7e` (11E changed nothing under it).

## validate-full after Workflow 11F (2026-11-21): one guard under load in the integration row and the stack row (recorded, nothing patched)

`bash validate-full.sh /tmp/validate-11f` on `2002ecc05`, alone on the machine. Every row rc 0 but `integration` and `stack-test`. The `test`
row (2,674 s, every package at once) passed: API 10,992, dashboard 7,384, db 2,395 (KP11-66 and KP11-67 not met this time).

### KP11-102: seed:load's inquiries case met the shared 60 s guard in the all-packages integration run (recorded, carried)

```
@openverify/api:test:integration:  ❯  api  src/seed/load-seed.integration.test.ts (6 tests | 2 failed) 198422ms
@openverify/api:test:integration:  FAIL   api  src/seed/load-seed.integration.test.ts > seed:load at the small scale (C268.3) > creates the accounts, then the inquiries in their statuses
@openverify/api:test:integration: Error: Test timed out in 60000ms.
@openverify/api:test:integration:  FAIL   api  src/seed/load-seed.integration.test.ts > seed:load at the small scale (C268.3) > writes the keyed lists, the keyed transactions and the connection, then verifies
@openverify/api:test:integration: LoadStepError: the record lists 0 inquiries and the database holds 1674: finish every part of --step inquiries
@openverify/api:test:integration:       Tests  2 failed | 467 passed (469)
```

The second failure follows from the first: the inquiries step was cut off by the guard, so the record lists none of the 1,674 rows it wrote.
db 110 of 110 passed in the same row. The file is unchanged since `18e29b3e5` (11D), and fix-records' 11F Validation passed it in its own
call. Alone, after validate-full ended (load 3.3), measured once and not counted as a pass:

```
pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/seed/load-seed.integration.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  35.41s
```

The cause under load is not established, so nothing is patched (rule 6): KP11-102, the class of KP11-67, carried with 11G's deferred items.

### stack-test: the dashboard build stopped by Next.js's security notice (KP11-42)

validate-full's row (93 s): `next build` for the dashboard ended with `Error [SecurityFatalError]`, as after 11D and 11E; `:openverify-sdk:stackTest`
did not run. Not retried and nothing upgraded: KP11-42 is 11G contracts-11g's dependency review. The `e2e` row (2,005 s) and `image-dashboard`
(143 s) built the dashboard without the stop, and fix-records' Validation ran stackTest 3 of 3 on this tree.

### The device suites after 11F: 22 of 22 on the unlocked Pixel 9 (11F's nine open device proofs closed)

fix-records' step 22 ran with the phone dozing behind its keyguard (SDK 7 of 14, the demo smoke not run). With the owner at the phone
(2026-11-21, "the phone is on, plugged in and on wireless debugging screen") the orchestrator kept the screen on while plugged in
(`adb shell svc power stayon true`) and ran the four connected tasks on `2002ecc05`'s tree, one call each under the device lock, after
validate-full ended (`isKeyguardShowing=false` and load 1.0-3.9 at each start):

```
:openverify-sdk:connectedAndroidDeviceTest       47 s
:openverify-nfc:connectedDebugAndroidTest        39 s
:openverify-face:connectedDebugAndroidTest      318 s
:demo-app:connectedMinifiedSmokeAndroidTest      29 s
(cd android && bash ../infra/scripts/check-connected-results.sh . openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4)
dev.openverify.demo.smoke.MinifiedSmokeTest: 2 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.camera.CameraXCaptureCameraTest: 1 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.camera.CameraXFramePipelineTest: 3 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.nfc.NfcTapLifecycleDeviceTest: 1 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.ui.CaptureScreenLayoutDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
connected tests: 22 passed
== check rc=0
```

Each Gradle call exited 1 ("There were failing tests") with every test passing in the instrumentation's XML: KP10-31 (AGP ends every
connected task as failed on a serial with a colon), not a finding. SDK 14 of 14, demo smoke 2 of 2, nfc 2 of 2, face 4 of 4.

## validate-full after Workflow 11G (2026-11-22): KP11-67 again and one integration file under load (recorded, nothing patched)

`bash validate-full.sh /tmp/validate-11g` on `abb3bf251`, alone on the machine. Every row rc 0 but `test` and `integration`. `stack-test`
passed (152 s): with Next.js 16.4.5 (11G's dependency review) the dashboard build no longer stops on the security notice.

### KP11-67: the re-key case met the shared 60 s guard in the all-packages run (recorded)

```
@openverify/api:test:  ❯ src/watchlists/rekey-batch.test.ts (4 tests | 1 failed) 131440ms
@openverify/api:test:  FAIL  src/watchlists/rekey-batch.test.ts > the re-key’s batch size (C270.2) > leaves every derived column identical for each candidate size
@openverify/api:test: Error: Test timed out in 60000ms.
@openverify/api:test:       Tests  1 failed | 11008 passed (11009)
```

Alone after validate-full (load 4.1): `Test Files 1 passed (1)`, `Tests 4 passed (4)`, `Duration 21.69s`. Third time under load, never alone;
cause not established; carried (rule 6).

### KP11-103: worker.integration.test.ts timed out in the all-packages integration run (recorded, carried)

```
@openverify/api:test:integration:  ❯  api  src/worker.integration.test.ts (7 tests | 6 failed) 554843ms
@openverify/api:test:integration:  FAIL   api  src/worker.integration.test.ts [ src/worker.integration.test.ts ]
@openverify/api:test:integration: Error: Hook timed out in 180000ms.
@openverify/api:test:integration: Error: Test timed out in 60000ms.
@openverify/api:test:integration: Error: connect ECONNREFUSED 127.0.0.1:33554
@openverify/api:test:integration:       Tests  6 failed | 463 passed (469)
```

db 110 of 110 passed in the same row, and integration-11g's Validation passed the file in its own call (integration 579). Alone after
validate-full (load 4.6), measured once and not counted as a pass:

```
pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/worker.integration.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  25.35s
```

The cause under load (a 180 s hook guard, then refused connections to the file's container port) is not established, so nothing is patched
(rule 6): KP11-103, carried to the next release with the failures under load.
