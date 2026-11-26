# Phase 10, Workflow 10D Stage 4: fix-records

Agent: fix-records (Claude Code, claude-fable-5-2), 2026-11-11, alone after fix-sdk and fix-server and before validation-10d.
Paths: `docs/` (never `docs/PROGRESS.md`), `.github/workflows/`, `infra/`, `android/scripts/` (untouched), the root `README.md`.
Items: the known item KP10-33, the review's MEDIUM findings A006, A004 and A005, the followups of android-a11y-audit, fix-sdk and fix-server addressed to the records, the plan's "Workflow 10D review amendments", and the CI job table.
No dependency, route schema, fixture, public Kotlin signature, ABI dump or Android source changed. No push, no dispatch, no adb.

| Item | Commits | Result |
|---|---|---|
| KP10-33 (1) gitleaks before the contract | RED `fc5e3632e`, GREEN `861d983e3` | fixed |
| A006 device-test minimums | RED `2288a2750`, GREEN `97c014d29` | fixed |
| A005 floors 2,677 and 81 | RED `4af1ac5b0`, GREEN `e58dbbb36` | fixed, on a count measured here |
| A004 android job timeout | RED `dc139b615`, GREEN `98c6db02a` | timeout 60, no split |
| KP10-33 (2), followups in the docs | `de704a388` | done |
| KP10-33 (3) the plan's Validation block | `e5272f8a0` | done |
| KP10-33 (4) `@openverify/node` | none | closed on a grep, below |
| KP10-33 (5) CLAUDE.md, the root README | `6baa65ed0`; CLAUDE.md's lines in the handoff | done; CLAUDE.md is the orchestrator's |
| The review amendments and the CI table | `151939632` | written |
| K10A-1 | none | not done: needs `android/openverify-sdk` and `docs/` in one change; carried |

Every command ran from the repository after `source scripts/env.sh`; outputs are abbreviated. Load is `cat /proc/loadavg`'s first three figures.

## 1. KP10-33 (1): the infra job ran the contract before it installed gitleaks

**As read in the code.** `ci.yml`'s infra job ran `bash infra/tests/ci-workflow.test.sh` two steps before the gitleaks cache and install, and the contract's release section skipped its staged-repository secret scan when gitleaks or openssl was missing. On a runner the scan never ran and the job was green.

**RED** (`fc5e3632e`): a check that the install step comes before the contract's step, and a stub `skip_unless_ci` (it only skipped) with two checks of the rule under `CI=true` and outside CI.

```
$ bash infra/tests/ci-workflow.test.sh
FAIL - infra: installs the pinned gitleaks before the CI workflow contract, whose release section scans with it (KP10-33) (install at step 10, the contract at step 8)
FAIL - a missing tool that CI installs is a failure under CI=true, not a skip (KP10-33) (skip - probe)
# 371 passed, 2 failed, 0 skipped        (exit 1)
```

**GREEN** (`861d983e3`): the cache and install steps moved above the contract in `ci.yml`; `skip_unless_ci` fails under `CI=true`.

```
$ bash infra/tests/ci-workflow.test.sh
# 373 passed, 0 failed, 0 skipped        (exit 0)
```

A run with `CI=true` and a PATH of symlinks that holds no gitleaks ended exit 1 with `FAIL - release: gitleaks or openssl not installed: the staged repository's secret scan was not run (required in CI)`. Two other checks failed in that run only because the cut-down PATH lacked tools their step scripts call; they pass on the full PATH.

## 2. A006: one passing device test was "the suite"

**Confirmed in the code.** `infra/scripts/check-connected-results.sh` failed only on zero tests, a failure, an error or a skip. A run of one class printed `connected tests: 1 passed`.

**RED** (`2288a2750`): fourteen new cases in `infra/tests/check-connected-results.test.sh`, and in `infra/tests/ci-workflow.test.sh` a count of the `@Test` methods in the device-test sources (14 and 2) with a check that each workflow's results line passes exactly those minimums.

```
$ bash infra/tests/check-connected-results.test.sh
FAIL - a suite that shrank to one passing test fails the check (exit 0: ... connected tests: 3 passed)
FAIL - one test fewer than a module's minimum fails the check (exit 0: ...)
FAIL - a module with a minimum and no results fails the check (exit 0: ...)
FAIL - another module's results do not count towards a minimum (exit 0: ...)
FAIL - the argument 'openverify-sdk' is refused with the usage (exit 0: ...)      (and four more arguments)
# 14 passed, 11 failed
$ bash infra/tests/ci-workflow.test.sh
FAIL - android-instrumented: the results check holds each module to its minimum (openverify-sdk=14 demo-app=2; A006) (['bash ../infra/scripts/check-connected-results.sh .'])
FAIL - release: devices: the results check holds each module to the minimum ci.yml's emulator step holds (A006)
ok   - the device-test sources hold the SDK's 14 tests and the demo's 2 (the minimums both workflows pass)
# 374 passed, 2 failed, 0 skipped
```

**GREEN** (`97c014d29`): the script takes `<module>=<minimum>` arguments (a module is the directory that holds `build/outputs/androidTest-results`); both workflows pass `openverify-sdk=14 demo-app=2`.

```
$ bash infra/tests/check-connected-results.test.sh      # 25 passed, 0 failed
$ bash infra/tests/ci-workflow.test.sh                  # 376 passed, 0 failed, 0 skipped
```

Also run on the result files fix-sdk's phone run left under `android/*/build/outputs/androidTest-results/connected/` (reading files; no adb):

```
$ (cd android && bash ../infra/scripts/check-connected-results.sh . openverify-sdk=14 demo-app=2)
connected tests: 16 passed                                                         (exit 0)
$ (cd android && bash ../infra/scripts/check-connected-results.sh . openverify-sdk=15 demo-app=2)
connected tests did not all pass: openverify-sdk: 14 connected tests ran, at least 15 expected
```

No emulator has run the new line.

## 3. A005: the floors

**RED** (`4af1ac5b0`): the floor cases of `ci-workflow.test.sh` moved to 2,677 and 81.

```
FAIL - android: the test-count floor fails with one test fewer than 10D's floor (2676) (exit 0: SDK host tests: 2676 in 2 classes, 0 skipped, 0 failed; the floor is 2602)
FAIL - android: the test-count floor fails at the 2651 the 10D audit reached, before the fixers' tests (...)
FAIL - android: the test-count floor fails at Workflow 10C's earlier floor of 2602 (...)
FAIL - android: the demo's floor fails with one debug-variant test fewer, Workflow 10C's 80 (...)
# 374 passed, 4 failed, 0 skipped
```

**The count, measured here before the floor was written** (each call under the Gradle lock, lock wait 0 s, `--rerun`, counted from the JUnit XML by the floor step's own logic):

```
$ (cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest -PhostTestGroup=ui --rerun)
exit 0 in 138 s, load 0.31 -> 2.94      524 tests in 61 classes, 0 skipped, 0 failed
... -PhostTestGroup=flow --rerun        exit 0 in 41 s, load 2.70 -> 2.70      414 tests in 35 classes, 0 skipped, 0 failed
... -PhostTestGroup=rest --rerun        exit 0 in 92 s, load 2.70 -> 2.36      1739 tests in 173 classes, 0 skipped, 0 failed
$ (cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :demo-app:testDebugUnitTest --rerun)
exit 0 in 36 s, load 2.36 -> 3.48       testDebugUnitTest: 81 tests in 12 classes; testMinifiedSmokeUnitTest: 8 tests in 3 classes; 0 skipped, 0 failed
```

524 + 414 + 1,739 = 2,677.

**GREEN** (`e58dbbb36`): `ci.yml`'s floor step reads 2677 and the demo's 81 and 8.

```
$ bash infra/tests/ci-workflow.test.sh                  # 378 passed, 0 failed, 0 skipped
```

## 4. A004: the android job's timeout

**Confirmed from the runs** (section 6): 21.8 minutes of 45 on the 10B push, the last whole run; 27.7 minutes spent on the 10C push when it failed with four steps not reached; 10D added 75 host tests and 113 goldens. The whole job is unmeasured, so by the 10D decisions (item 15) nothing is split. A raise is local and keeps a slow runner from cancelling the job and its report upload.

**RED** (`dc139b615`): `FAIL - android: the job's timeout keeps its 27.7 measured minutes and the unmeasured steps after them out of the last 25% (at least 60) (45)`; 378 passed, 1 failed.
**GREEN** (`98c6db02a`): `timeout-minutes: 60` with the reason beside it; 379 passed, 0 failed, 0 skipped.

## 5. Records

- **`@openverify/node` (KP10-33 (4)), closed.**

  ```
  $ grep -rnE 'client-unable|client_unable|clientUnable|sandbox-chip|sandbox_chip|sandboxChip|read_failed' packages/node/src
  (no output; exit 1)
  ```

  `packages/node/package.json`'s scripts are `build`, `lint`, `typecheck` and `test`: no generation script exists.
- **Docs** (`de704a388`): `docs/android/nfc.md` and `docs/checks/nfc.md` (the generated fixture set; KP10-39's replace-on-upload sentence), `docs/android/device-integrity.md` (the run-time notice rule; the probes on the phone), `docs/android/capture.md` (the scrolling capture screen; the barcode guide; the analysis size one phone gave), `docs/android/release-and-support.md` (14 and 2 device tests, where they ran and did not, KP10-31's cause, how `minifiedSmoke` differs from `release`), `docs/accessibility/android-audit-2026-11-11.md` (gap K9 fixed; the inventory untouched).
- **The tests that read those files**, after the edits:

  ```
  $ pnpm --filter @openverify/dashboard exec vitest run src/accessibility-statement-records.test.ts --coverage.enabled=false
  Test Files  1 passed (1)   Tests  5 passed (5)                                      (exit 0)
  $ (cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest \
      --tests 'dev.openverify.sdk.ui.a11y.A11yInventoryTest' --tests 'dev.openverify.sdk.ui.a11y.A11yTimingTest' --tests 'dev.openverify.sdk.docs.*')
  exit 0 in 32 s, lock wait 0 s: 25 tests in 5 classes, 0 skipped, 0 failed
  ```

- **The plan** (`e5272f8a0`, `151939632`): the Validation block, then "## Workflow 10D review amendments" at the end, in its own commit.
- **Not changed:** `e2e/README.md`'s Shards bullet (no shard count changed; validation-10d rewrites its measurement), `THIRD_PARTY_LICENSES.md` (10D added no dependency), `android/scripts/`.

## 6. The CI runs, read only

```
$ gh run list --workflow ci.yml --branch main --limit 8 --json databaseId,headSha,status,conclusion,createdAt
42937477615 67244eb78 completed failure 2026-11-11T01:14:27Z     (the 10C push; the newest run)
42762952128 f71b0f6d8 completed failure 2026-11-10T05:34:14Z     (the 10B push)
42603210118 7d985a77d completed failure 2026-11-09T10:44:16Z     (the 10A push)
$ gh run view <id> --json jobs      # minutes from startedAt to completedAt
```

| Job | 42937477615 | 42762952128 | 42603210118 | Timeout |
|---|---|---|---|---|
| lint | 10.3 | 8.2 | 9.6 | 30 |
| node | 10.1 | 14.6 | 13.8 | 25 |
| unit-api 1, 2, 3 | 21.7, 17.7, 16.7 | 22.1, 17.6, 15.3 | 16.3, 20.9, 16.1 | 40 |
| unit-api-coverage | never started | 0.7 | 0.6 | 20 |
| unit-dashboard 1, 2 | 6.1, 11.7 | 8.3, 6.7 | 10.3, 10.8 | 20 |
| unit-dashboard-coverage | 0.7 | 0.7 | 0.7 | 20 |
| unit-db | 12.7 | 9.5 | 12.7 | 25 |
| format | 2.0 | 1.5 | 1.9 | 10 |
| integration | 16.1 | 15.3 | 14.9 | 30 |
| infra | 2.0 | 1.7 | 1.8 | 10 |
| vision | 7.6 | 9.3 | 9.2 | 30 |
| android | failed at 27.7 (steps: 18.4, 8.4) | 21.8 (steps: 16.2, 4.5) | failed at 1.2 | 45 then, 60 now |
| android-instrumented | skipped | failed at 9.7 (emulator step 8.9) | skipped | 60 |
| e2e | 33.9 (Playwright step 31.4) | 40.0 (37.3) | 40.6 | 80 |
| secrets | 0.4 | 0.3 | 0.4 | 10 |
| Billed, each job rounded up | 206 | 212 | 189 | |

No job is above 75% of its timeout by a measured time (the highest is unit-dashboard's second shard, 11.7 of 20). The table against the 25% rule, the per-push estimate (about 225 to 240 minutes, an estimate) and what a first run must show are in the plan's review amendments, fix-records item 8. Nothing here says a run proves anything about these commits: none exists for them.

## 7. Final gates (at `151939632`, alone on the machine)

```
$ pnpm format:check                                   exit 0 in 97 s, load 0.39 -> 1.63   "All matched files use Prettier code style!"
$ bash infra/tests/ci-workflow.test.sh                exit 0 in 9 s    # 379 passed, 0 failed, 0 skipped   (actionlint on both workflows and the remote tag check included)
$ bash infra/tests/check-connected-results.test.sh    exit 0 in 1 s    # 25 passed, 0 failed
```

Not run, because their subjects did not change: the other nine `infra/tests/*.test.sh`, the Android gate's call (9) (`android/scripts/` untouched), the e2e gate (nothing the e2e job runs changed). The Android gate's call (1) ran whole in section 3 as the floor's measurement. validation-10d runs the whole Validation list.
