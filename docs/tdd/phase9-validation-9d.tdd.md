# Phase 9, Workflow 9D: validation-9d

The last agent of Workflow 9D and of Phase 9. It ran alone after `fix-api` (P-B of the orchestrator
decisions before 9D), with no other agent editing the tree. It ran the plan's whole Validation list on
the final tree, checked the Acceptance and drafted the PROGRESS entry that closes Phase 9.

Every command ran in the foreground after `source scripts/env.sh`. Each call's output went to a
file, and its exit code was read from the command itself (rule 8). Heavy calls went through
`/tmp/openverify-heavy.sh` with `OPENVERIFY_HEAVY_RESERVED=1`. Timings and the e2e calls ran under
`/tmp/openverify-e2e.lock`, one step per hold. Load averages are `/proc/loadavg`'s 1-minute figure
before and after each call.

## Tree

Validated tree: `cf34a038` (`fix-api`'s last commit). `git status --porcelain` showed only the owner's
untracked note (`31-Oct-openverify-session-state.txt`), before and after. The commit range is
`e56e4e9c..cf34a038`: 1,118 Phase 9 commits, 177 of them after 9C's `017d8e36`.

## Defects found

None in the code. No call of the Validation list failed for a reason in the repository, so this agent
made no RED or GREEN commit.

One call did not pass: `infra/tests/install-gitleaks.test.sh` (step 13). It downloads gitleaks'
pinned release from `github.com/gitleaks/gitleaks/releases/download/v8.30.1/`, and that host answered
HTTP 504 to every request from 08:59Z, while `github.com` and `api.github.com` answered 200 (curl,
checked several times). The six failed checks are the download and what follows from it. The
checksum and pin checks that need no download passed. This is an upstream outage, not a test result.
The test was not changed, skipped or weakened.

The host flapped for about an hour. Polls with the installer's own `curl` options got 200, then 504
again seconds later, with and without `scripts/env.sh`, and no proxy was set. The test ran nine times,
the last five each right after a poll got 200:
- 08:59Z, 09:36Z, 09:41Z, 09:45Z, and attempts 1 to 3 (09:50Z to 09:53Z): 3 passed, 6 failed.
- Attempt 4 (09:54Z): 8 passed, 1 failed.
- Attempt 5 (09:57Z): **9 passed, 0 failed, exit 0**.

Every failed check of the eight failed runs names `curl: (22) The requested URL returned error: 504`.
The code was the same in all nine runs. The 9D push's `infra` job runs the test again.

```
FAIL - mismatch is reported as a checksum failure (expected match for '*checksum*', got: install-gitleaks: downloading gitleaks_8.30.1_linux_x64.tar.gz curl: (22) The requested URL returned error: 504)
FAIL - pinned install succeeds (install-gitleaks: downloading gitleaks_8.30.1_linux_x64.tar.gz curl: (22) The requested URL returned error: 504 )
# 3 passed, 6 failed
$ curl -sS -I https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt
HTTP/2 504
```

## Routed item: `flow-bundle.spec.ts` under load

`fix-api` routed this item to validation-9d, with the change described but not proven by a test (plan,
"### fix-api" item 16). In this Validation run the spec passed in chromium shard 4 in 15.2 s, at a
load of 1.5 to 2.2. The list found no defect, so nothing was built. A fix would rest on a cause no test
has shown. The item stays carried: the auto-capture uploads the live video frame rather than the frame
the guidance judged (`apps/flow/src/selfie/use-guidance.ts`, `apps/flow/src/lib/capture-frame.ts`).

## The Validation list

| Step | Call | Exit | Seconds | Load before / after | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` (pnpm lock) | 0 | 1 | 0.52 / 0.52 | lockfile up to date |
| 1 | `pnpm format:check` | 0 | 99 | 0.48 / 1.58 | all files formatted |
| 2 | `pnpm turbo run typecheck --force` (4 GB heap) | 0 | 123 | 1.46 / 5.56 | 17 of 17 |
| 2 | lint `--force --concurrency=1`, 4 GB heap, `@openverify/api` | 0 | 182 | 5.03 / 1.68 | 1 of 1 |
| 2 | the same, dashboard and contracts | 0 | 203 | 1.75 / 1.68 | 2 of 2 |
| 2 | the same, the other 14 packages | 0 | 295 | 1.50 / 1.73 | 14 of 14 |
| 3 | `python3 scripts/fetch_models.py`, `fetch_data.py` | 0, 0 | 1, 0 | 1.46 | pinned files present |
| 4 | `pnpm --filter @openverify/watchlist build:variant-groups` | 0 | 6 | 1.46 / 1.42 | 156,706 groups kept |
| 5 | `pnpm turbo run test --force` watchlist, e2e, db | 0 | 346 | 1.20 / 1.69 | 3 of 3 |
| 5 | the same, dashboard (one call) | 0 | 362 | 1.43 / 7.22 | 579 files, 6,715 tests, 95.59% |
| 5 | the same, the other 12 packages (not api) | 0 | 146 | 5.62 / 13.49 | 12 of 12 |
| 5 | `pnpm --filter @openverify/js test` | 0 | 5 | 12.41 / 11.58 | 19 tests |
| 5 | API, 8 blob shards (each exits 1 on its partial coverage alone) | 1 x8 | 137, 151, 155, 156, 145, 133, 135, 126 | 8.29 to 8.13 / 9.13 to 10.13 | no failed test |
| 5 | API merge `--merge-reports --coverage` | 0 | 33 | 9.32 / 5.91 | 692 files, 9,428 tests, 94.39% |
| 6 | `benchmark:typecheck`, `benchmark:test` | 0, 0 | 42, 10 | 5.52 / 3.78 | 99% statements |
| 7 | `pnpm --filter @openverify/db test:integration` | 0 | 87 | 3.47 / 16.28 | 78 tests |
| 7 | `--project graph` | 0 | 33 | 14.98 / 10.24 | 13 tests; template 225,000 rows in 14.8 s |
| 7 | `--project api --shard=1/3`, `2/3`, `3/3` | 0, 0, 0 | 65, 165, 79 | 8.66 to 8.81 / 14.98 to 16.60 | 89, 99, 79 tests |
| 8 | `uv lock --check && ruff check && ruff format --check && mypy src tools` | 0 | 2 | 15.35 | clean |
| 8 | pytest files 1 to 58, `--cov-fail-under=0` | 0 | 248 | 12.99 / 2.06 | 1,471 passed |
| 8 | pytest files 59 to 103, `--cov-append` | 0 | 305 | 2.06 / 2.11 | 1,130 passed, 97.48% (gate 80%) |
| 9 | `:openverify-sdk:testAndroidHostTest --rerun` (Gradle lock) | 0 | 71 | 1.78 / 2.17 | 1,366 tests, none skipped (CI floor 1,366) |
| 9 | `testDebugUnitTest koverVerify` | 0 | 11 | 2.07 / 2.37 | |
| 9 | `assembleDebug :openverify-sdk:assemble lint` | 0 | 10 | 2.37 / 3.44 | |
| 10 | `openapi:write`, then `git diff --exit-code docs/api/openapi.json` | 0, 0 | 19 | 3.16 / 2.63 | sha256 `e229bd12…a175a852f` |
| 10 | `workflow-docs:write`, then `git diff --exit-code docs/workflows` | 0, 0 | 2 | 2.63 | no diff |
| 11 | `flock … pnpm --filter @openverify/flow e2e` | 0 | 111 | 2.22 / 9.42 | 328 passed (Chromium, and Firefox's theme-csp) |
| 11 | Docker WebKit, `theme-csp.spec.ts` (decision 3 before 9D) | 0 | 17 | 7.33 / 8.04 | 7 passed in WebKit; container removed |
| 11 | stack down and `turbo run build --filter=@openverify/e2e^...` | 0 | 1 | 7.39 / 6.88 | cached |
| 11 | `e2e:stack:up` | 0 | 90 | 6.33 / 3.69 | ready |
| 11 | `--project=chromium --shard=1/4` | 0 | 229 | 3.40 / 2.37 | 47 passed |
| 11 | `--shard=2/4` | 0 | 309 | 2.00 / 2.57 | 46 passed |
| 11 | `--shard=3/4` | 0 | 270 | 2.52 / 1.63 | 46 passed |
| 11 | `--shard=4/4` | 0 | 377 | 1.50 / 2.24 | 44 passed (`flow-bundle.spec.ts` 15.2 s) |
| 11 | `--project=console-sweep --no-deps` | 0 | 307 | 2.06 / 2.61 | 104 passed (`/graph/[id]` 11.1 s, `/error-probe` 0.9 s) |
| 11 | `e2e:stack:down` | 0 | 3 | 2.41 / 2.69 | stopped |
| 12 | `docker build -t openverify/apps:dev -f infra/docker/apps.Dockerfile .` | 0 | 147 | 2.88 / 4.07 | |
| 12 | `docker build services/vision` | 0 | 3 | 3.82 / 3.76 | cached layers |
| 12 | `docker build -f infra/docker/code-runner.Dockerfile .` | 0 | 39 | 3.76 / 3.03 | |
| 13 | `apps-image-context`, `check-connected-results`, `ci-workflow`, `compose`, `flow-headers`, `flow-server` | 0 each | 0, 0, 7, 14, 3, 1 | 2.5 to 2.8 | 43, 11, 250, 541, 21 (live half on the tagged image), 38 |
| 13 | `gitleaks-config`, `pre-commit-hook`, `vision-container`, `code-runner` | 0 each | 11, 2, 17, 15 | 2.4 to 3.0 | 10, 11, 55, 55 |
| 13 | `install-gitleaks` | 1 | 1 | 2.98 | 3 passed, 6 failed: the release host answered 504 (above) |
| 13 | `install-gitleaks`, after the host served the tarball (ninth run) | 0 | 1 | 0.1 | 9 passed |
| 14 | workflow benchmark `--runs=200 --clients=1,8,32` | 0 | 125 | 1.36 / 2.40 | below |
| 14 | analytics benchmark `--teardown` (seed taken before 0032) | 0 | 4 | 1.58 / 1.61 | container removed |
| 14 | `--seed`, three calls | 0, 0, 0 | 455, 425, 473 | 1.48 to 1.36 / 1.52 to 1.70 | 8, 6 and 6 of 20 batches |
| 14 | `--measure` | 0 | 407 | 1.57 / 2.16 | below |
| 15 | `gitleaks git --redact .` | 0 | 8 | 1.99 / 2.72 | 6,003 commits, 87.6 MB, no leaks |

Unit tests per package (statements): api 9,428 (94.39%, branches 85.03%); dashboard 6,715 (95.59%,
branches 88.42%); contracts 4,393 (99.11%); checks 3,826 (98.79%); db 2,178 (91.06%);
workflow-engine 1,984 (98.02%); core 1,655 (99.17%); flow 1,490 (94.75%); watchlist 820 (98.63%);
node 486 (98.44%); flow-spec 432 (96.27%); emrtd 318 (94.97%); config 290 (97.22%); signals 192
(96.37%); e2e 131 (97.1%); ui 55 (100%); js 19 (100%). That is 34,412 in all, with every package at
or above 80%.

The e2e gate in all: the mocked suite 328 tests, the Docker WebKit theme spec 7, and on one fresh stack
183 chromium tests (47/46/46/44) and the sweep's 104 (98 axe pages and 6 CSP tests). The stack and the
five calls took 1,582 s (26.4 min) at a load of 1.5 to 3.7. The longest shard took 377 s, under the
8-minute line, so the shards are not rebalanced.

## Benchmarks (reported, not gated; each under `flock /tmp/openverify-e2e.lock`)

Workflow engine (Phase 8 C117.11), 200 runs and 1,000 steps a row, load 1.36 before and 2.40 after:
- effectful: 19, 47 and 49 steps a second at 1, 8 and 32 clients (53.1, 21.2 and 20.5 s);
- control flow: 95, 205 and 208 steps a second (10.6, 4.9 and 4.8 s).

Analytics (C163.7), 1,000,000 inquiries, re-seeded after migration 0032 (S4B-17; three `--seed` calls,
each stopping on its own 420 s budget), load 2.16 to 2.18:
- the build of 365 days took 369,229 ms, and no environment failed;
- the 5-minute refresh of 2 dirty days took 55 ms;
- the first pass after midnight (30 open days) took 30,086 ms;
- the reads, in ms (inquiries / funnel / verifications / checks / cases / signals):
  - 30 days: 29 / 17 / 25 / 33 / 8 / 20;
  - 90 days: 38 / 28 / 47 / 51 / 9 / 51;
  - 400 days: 186 / 109 / 235 / 396 / 12 / 282.

The container `openverify-analytics-benchmark` is stopped with this seed.

## Notes

- WebKit ran locally only through the Docker browser server (`mcr.microsoft.com/playwright:v1.64.1-noble`,
  `run-server`, loopback only; `apps/flow/e2e/README.md`). The container was removed in the same call.
  The 9D push's `e2e` job is the CI proof of C160.9's three-engine line.
- The load figures of 8 to 16 during steps 5 and 7 came from the suites' own workers and the
  Testcontainers VM. `top` showed the CPUs 97% idle between calls. No other agent ran.
- Three `opencode` processes were running throughout, idle, as at 9B and 9C (pids 839838 and 1381369
  among them). They did not touch the tree.
