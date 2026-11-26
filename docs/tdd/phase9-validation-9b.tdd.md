# Phase 9, Workflow 9B Stage 4: validation-9b

The last of 9B's three Stage 4 agents, run alone after `integration-9b` (`532843a2`) and `docs-9b`
(`9b129a89`, `474cbfaf`). It settles what they left open, runs the plan's whole Validation list on
the final tree, and writes the plan's S4B-15 to S4B-18 and "### Handover to 9C".

Every command ran in the foreground after `source scripts/env.sh`, its output sent to a file and its
exit code read from the command itself (rule 8). Load averages are `/proc/loadavg`'s 1, 5 and 15
minute figures, before and after each call.

## What was left open, and how it was settled

| Item (from)                                                                                                                               | Settled                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/flows/embedding.md` calls the publish checks of `embed-origins` and `redirect-uri` "carried" (docs-9b)                              | Rewritten from `services/publish/flow-v2.ts` `embeddingProblems` (`f7494687`)                                                                      |
| `docs/settings/roles.md` "A known gap": `require-mfa` audited in one environment (docs-9b)                                                | Built by integration-9b (S4B-12, `services/settings.ts`); the section now states the built rule, and `audit-log.md`'s link follows it (`f7494687`) |
| `docs/settings/sender-name.md`: refusing `\p{Cf}` and `=?` at save "proposed and not built" (docs-9b)                                     | Built by integration-9b (S4B-13, `mailSenderNameSchema`); rewritten (`f7494687`)                                                                   |
| Gaps 2, 4 to 8 and 9 to 19 of docs-9b                                                                                                     | Still true of the code and stated in the docs; carried in S4B-14                                                                                   |
| Export columns, bulk CSV, delivery search `links.next`, per-inquiry expiry rules have no doc page (docs-9b, api-exports, api-flow-expiry) | Carried with owners (S4B-18)                                                                                                                       |
| api-analytics' three gate failures (lint, users.test.ts, case-pull R008)                                                                  | Re-run on the final tree: all pass (steps 2, 5 and 7 below)                                                                                        |
| The analytics benchmark on the final tree (api-analytics, integration-9b)                                                                 | Run (step 14); the old seed needed a re-seed (S4B-17)                                                                                              |

No code defect was found, so no RED or GREEN commit was needed: the only fix is documentation, which
no test reads. `pnpm exec prettier --check --ignore-path=.gitignore` on the four pages exited 0
(`.prettierignore` holds `**/*.md`).

## The Validation list (final tree `f7494687`)

| Step | Call                                                                                                     | Exit          | Seconds                                | Load before / after         | Result                                                      |
| ---- | -------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| 1    | `pnpm install --frozen-lockfile`                                                                         | 0             | 1                                      | 0.73 / 0.73                 | lockfile up to date                                         |
| 1    | `pnpm format:check`                                                                                      | 0             | 109                                    | 0.73 / 1.36                 | all files formatted                                         |
| 2    | `pnpm turbo run typecheck --force`                                                                       | 0             | 171                                    | 1.71 / 5.18                 | 17 of 17                                                    |
| 2    | lint `--force --concurrency=1`, 4 GB heap, `@openverify/api`                                             | 0             | 220                                    | 4.77 / 1.41                 | 1 of 1                                                      |
| 2    | the same, dashboard and contracts                                                                        | 0             | 196                                    | 1.30 / 1.49                 | 2 of 2                                                      |
| 2    | the same, the other 14 packages                                                                          | 0             | 348                                    | 1.37 / 1.34                 | 14 of 14                                                    |
| 3    | `python3 scripts/fetch_models.py`, `fetch_data.py`                                                       | 0, 0          | 0, 0                                   | 1.39                        | pinned files present                                        |
| 4    | `pnpm --filter @openverify/watchlist build:variant-groups`                                               | 0             | 7                                      | 1.39 / 1.36                 | 156,706 groups kept                                         |
| 5    | `pnpm turbo run test --force` watchlist, e2e, db                                                         | 0             | 398                                    | 1.25 / 1.75                 | 3 of 3                                                      |
| 5    | the same, dashboard                                                                                      | 0             | 310                                    | 1.61 / 7.05                 | 1 of 1                                                      |
| 5    | the same, the other 12 packages (not api)                                                                | 0             | 183                                    | 6.56 / 15.16                | 12 of 12                                                    |
| 5    | `pnpm --filter @openverify/js test`                                                                      | 0             | 7                                      | 12.83 / 11.97               | 19 tests                                                    |
| 5    | API, 8 blob shards (each exits 1 on its partial coverage alone)                                          | 1 x8          | 156, 189, 192, 193, 172, 143, 156, 153 | 6.7 to 11.0 / 7.7 to 9.6    | no failed test                                              |
| 5    | API merge `--merge-reports --coverage`                                                                   | 0             | 34                                     | 8.76 / 5.38                 | 686 files, 9,372 tests, 94.36%                              |
| 6    | `benchmark:typecheck`, `benchmark:test`                                                                  | 0, 0          | 44, 11                                 | 4.95 / 3.07                 |                                                             |
| 7    | `pnpm --filter @openverify/db test:integration`                                                          | 0             | 92                                     | 2.83 / 13.08                | 78 tests                                                    |
| 7    | `--project graph`                                                                                        | 0             | 35                                     | 13.08 / 8.84                | 13 tests; template 225,000 rows in 15.9 s of 180 s          |
| 7    | `--project api --shard=1/3`, `2/3`, `3/3`                                                                | 0, 0, 0       | 89, 176, 110                           | 8.29 to 15.03               | 89, 99, 79 tests                                            |
| 8    | `uv lock --check && ruff check && ruff format --check && mypy src tools`                                 | 0             | 1                                      | 13.20                       | clean                                                       |
| 8    | pytest files 1 to 58, `--cov-fail-under=0`                                                               | 0             | 316                                    | 12.39 / 2.18                | 1,471 passed                                                |
| 8    | pytest files 59 to 103, `--cov-append`                                                                   | 0             | 393                                    | 2.01 / 1.26                 | 1,130 passed, 97.48% (gate 80%)                             |
| 9    | `:openverify-sdk:testAndroidHostTest` (then again with `--rerun`)                                        | 0, 0          | 17, 125                                | 1.16 / 3.03                 | 1,366 tests, none skipped (CI floor 1,366)                  |
| 9    | `testDebugUnitTest koverVerify`                                                                          | 0             | 16                                     | 2.79 / 3.50                 | up to date                                                  |
| 9    | `assembleDebug :openverify-sdk:assemble lint`                                                            | 0             | 17                                     | 3.50 / 4.19                 | up to date                                                  |
| 10   | `openapi:write`, then `git diff --exit-code docs/api/openapi.json`                                       | 0, 0          | 27                                     | 3.85 / 2.81                 | sha256 `761c243b…efbb72e`                                   |
| 10   | `workflow-docs:write`, then `git diff --exit-code docs/workflows`                                        | 0, 0          | 2                                      | 2.81 / 2.75                 | no diff                                                     |
| 11   | `flock … pnpm --filter @openverify/flow e2e`                                                             | 0             | 84                                     | 2.61 / 10.62                | 163 passed (Chromium; theme-csp 5)                          |
| 11   | stack down and `turbo run build --filter=@openverify/e2e^...`                                            | 0             | 1                                      | 8.98                        | cached                                                      |
| 11   | `e2e:stack:up`                                                                                           | 0             | 171                                    | 8.50 / 3.40                 | ready                                                       |
| 11   | shards 1/3, 2/3, 3/3                                                                                     | 0, 0, 0       | 297, 384, 408                          | 3.21 to 1.37 / 2.52 to 2.59 | 53, 51, 50 passed                                           |
| 11   | `e2e:stack:down`                                                                                         | 0             | 4                                      | 2.39                        | stopped; no "not built yet" line in the stack logs          |
| 12   | `docker build -t openverify/apps:dev -f infra/docker/apps.Dockerfile .`                                  | 0             | 212                                    | 2.36 / 2.78                 |                                                             |
| 12   | `docker build services/vision`                                                                           | 0             | 9                                      | 3.20 / 3.19                 | cached layers                                               |
| 12   | `docker build -f infra/docker/code-runner.Dockerfile .`                                                  | 0             | 58                                     | 3.19 / 2.36                 |                                                             |
| 13   | `apps-image-context`, `check-connected-results`, `ci-workflow`, `compose`, `flow-headers`, `flow-server` | 0 each        | 1, 0, 8, 21, 3, 1                      | 1.6 to 2.2                  | 43, 11, 237, 541, 21 (live, on the tagged image), 38 checks |
| 13   | `gitleaks-config`, `install-gitleaks`, `pre-commit-hook`, `vision-container`, `code-runner`              | 0 each        | 18, 3, 4, 23, 25                       | 2.3 to 2.9                  | 10, 9, 11, 55, 55 checks                                    |
| 14   | workflow benchmark `--runs=200 --clients=1,8,32`                                                         | 0             | 172                                    | 2.41 / 2.38                 | below                                                       |
| 14   | analytics benchmark `--seed` on the old container                                                        | 1             | 6                                      | 2.23                        | migration `0031` re-run (S4B-17)                            |
| 14   | `--teardown`; `--seed` three calls; `--measure`                                                          | 0; 0, 0, 0; 0 | 5; 470, 445, 492; 417                  | 1.18 to 1.76 / 1.33 to 2.43 | below                                                       |
| 15   | `gitleaks git --redact .`                                                                                | 0             | 7                                      | 2.13 / 2.44                 | 5,497 commits, 83.5 MB, no leaks                            |

Unit tests per package (statements): api 9,372 (94.36%, branches 84.98%); dashboard 5,595 (96.38%);
contracts 4,382 (99.11%); checks 3,826 (98.79%); db 2,172 (91.07%); workflow-engine 1,984 (98.02%);
core 1,650 (99.21%); flow 1,508 (95.11%); watchlist 819 (98.63%); node 486 (98.44%); flow-spec 432
(96.27%); emrtd 318 (94.97%); config 290 (97.22%); signals 192 (96.37%); e2e 125 (96.93%); ui 54
(100%); js 19 (100%). Every package is at or above 80%.

## Benchmarks (reported, not gated; each under `flock /tmp/openverify-e2e.lock`)

Workflow engine (Phase 8 C117.11), load 2.41 before and 2.38 after, 200 runs and 1,000 steps a row:
effectful 13, 38 and 39 steps a second at 1, 8 and 32 clients (78.9, 26.1, 25.9 s); control-flow 69,
158 and 165 (14.6, 6.3, 6.1 s).

Analytics (C163.7) on 1,000,000 inquiries, 2,000,000 attempts, 12,000,000 checks and 3,000,000 step
records over 365 days (`ANALYTICS_BENCHMARK_SIZE`), seeded on the final schema in 20 batches of
50,000 (55 to 88 s each, growing with the tables; load 1.2 to 1.8):

- build, the first pass over 365 days: 379,300 ms (load 2.53 2.18 1.95), no environment failed;
- the 5-minute refresh of 2 dirty days: 58 ms; the first pass after midnight, 30 open days
  recomputed: 29,377 ms (load 2.40 to 2.43);
- reads in ms, inquiries / funnel / verifications / checks / cases / signals (load 2.43 2.19 1.97):
  30 days 29 / 21 / 26 / 33 / 12 / 14; 90 days 40 / 29 / 55 / 53 / 6 / 39; 400 days 141 / 173 / 178
  / 262 / 18 / 333.

The container `openverify-analytics-benchmark` is stopped with this seed.

## Notes

- Firefox and WebKit are not installed here (only Chromium under `~/.cache/ms-playwright`), so
  `theme-csp.spec.ts` ran in Chromium only; the three-engine acceptance line is proven in CI only.
- `opencode` processes were running, idle, through the run (S4B-18).
