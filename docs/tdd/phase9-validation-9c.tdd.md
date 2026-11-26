# Phase 9, Workflow 9C Stage 2: validation-9c

The last of 9C's three Stage 2 agents, run alone after `integration-9c` (`6b0f1a9e..43a3b876`) and
`docs-9c` (`24b58de3`, `08146e3d`). It settles what they left open, runs the plan's whole
Validation list on the final tree, and writes the plan's S9C-14 to S9C-16 and "### Handover to 9D".

Every command ran in the foreground after `source scripts/env.sh`, its output sent to a file and its
exit code read from the command itself (rule 8). Heavy calls went through `/tmp/openverify-heavy.sh`
with `OPENVERIFY_HEAVY_RESERVED=1`. Load averages are `/proc/loadavg`'s 1-minute figure before and
after each call (5- and 15-minute figures where the call printed them).

## What was left open, and how it was settled

| Item (from) | Settled |
| --- | --- |
| `docs/i18n/README.md` gave the copy fallback as default locale, then the language's built-in catalog, then English (docs-9c, TS-2) | Rewritten from `copyText` (`apps/flow/src/session/session-copy.ts`): the language's custom text, its built-in text, the default locale's custom text, its built-in text; no English step unless English is the default (`639b6d58`) |
| `docs/flows/preview-and-simulate.md` said the resolve route and simulate answer 501 (docs-9c; S4B-14's "9C's docs or 9D") | New sections for the resolve route, simulate (each step kind, the answer, the two known differences from a live inquiry) and the presets, and the console's tab (`639b6d58`) |
| `docs/flows/README.md` "What Workflow 9A did not build"; `docs/flows/engine.md` "`theme` (`null` until Workflow 9B)" (docs-9c) | Replaced by what 9B built; the session's `links`, `theme` and the handed-off phone's consent step documented in `engine.md`; prefill by input name in `steps.md` (`639b6d58`) |
| `docs/themes/README.md` "In the flow" still described `document.documentElement.style.setProperty`, changed by S9C-1 (found here) | Rewritten: the `:root:root:root` rule on the same-origin stylesheet, why, and the local engine rule of S9C-2 (`639b6d58`) |
| `docs/analytics/README.md` "Not built: the console ... waiting on an owner decision" (docs-9c) | Now says only the analytics CSV download is missing (`639b6d58`) |
| `apps/dashboard/next.config.ts`' comment "A full script CSP ... left for a later phase" (docs-9c) | Comment now points at `proxy.ts` and DS1 (`639b6d58`; a comment, no behaviour) |
| The analytics benchmark's "5-minute refresh" (found here: a repeated `--measure` timed an empty pass, `days: 0`) | Fixed test-first, below (`8059a4b2`, `9994adad`, `95059082`) |
| `consolePublicOrigin` unused; the bulk upload needing `report-templates:read`; raw row codes on the bulk job page; the settings index link (docs-9c) | Carried to 9D with owners (plan, Handover to 9D) |

`pnpm exec prettier --check --ignore-path=.gitignore` passes on the four doc pages that were
prettier-clean before (`docs/flows/engine.md`, `preview-and-simulate.md`, `docs/i18n/README.md`,
`docs/analytics/README.md`); `docs/themes/README.md`, `docs/flows/steps.md` and `docs/flows/README.md`
were not prettier-clean at `43a3b876` (checked from `git show HEAD:<file>`), so their existing style
was kept, as docs-9c did for the README. `.prettierignore` holds `**/*.md`.

## The defect: the analytics benchmark's refresh step on a repeated `--measure`

Found in step 14: `--measure` on the seed validation-9b left reported
`{"step":"refresh-5-minute","ms":15,"days":0}`. The step writes `updated_at = NOW + 60 s` on 48 hours
of inquiries, then runs a pass at `NOW + 5 min`. The `inquiries` trigger `openverify_set_updated_at`
(migration 0001) keeps a value an update sets only when it differs from the stored one; the first
`--measure` on a seed had already written that value, so this one got the wall clock
(`2026-11-07 11:41`, read in the container), outside the pass's window. The step therefore times an
empty pass on every `--measure` after the first on a seed; the figures recorded at 9B (63 ms, 58 ms)
came from first runs and stand.

- `8059a4b2` refactor: the write extracted as `touchRefreshWindow(db, environmentId)` with
  `ANALYTICS_BENCHMARK_TOUCHED_AT`, behaviour unchanged (`tsc --noEmit` exit 0).
- `9994adad` RED: `apps/api/src/analytics-benchmark-refresh.test.ts` (PGlite) touches twice.

  ```
  $ pnpm exec vitest run src/analytics-benchmark-refresh.test.ts --coverage.enabled=false
   × gives the touched inquiries the benchmark time on every run, a repeated --measure included
  AssertionError: expected '2026-11-07T11:48:19Z' to be '2026-11-01T10:01:00Z'
        Tests  1 failed (1)
  ```

  (the second assertion, after the second touch; `tsc --noEmit` and eslint exit 0).
- `95059082` GREEN: the rows are moved to `2026-10-28` first, then to the touched time, which always
  differs from what is stored.

  ```
  $ pnpm exec vitest run src/analytics-benchmark-refresh.test.ts src/package-scripts.test.ts --coverage.enabled=false
        Tests  7 passed (7)
  ```

  `--measure` again: `{"step":"refresh-5-minute","ms":55,"days":2}`.

After the fix, `pnpm format:check` (exit 0, 93 s), the API's forced lint and typecheck
(`--concurrency=1`, 4 GB heap; exit 0, 255 s, load 2.1 / 1.1) and the API unit gate (8 shards of
133, 151, 151, 155, 144, 129, 133 and 123 s at a load of 1.4 to 9.2, merge exit 0 in 31 s: 687 files,
9,376 tests, 94.36 / 84.98 / 96.64 / 94.52 %) ran again. The apps image, the e2e gate and the infra
tests ran on `639b6d58`; the later commits change only a script no image or spec runs and a test.

## The Validation list

Tree: `639b6d58` (integration-9c's `43a3b876` plus the doc fixes), then the API re-gate on `95059082`.

| Step | Call | Exit | Seconds | Load before / after | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 0 | 0 | 0.03 | up to date |
| 1 | `pnpm format:check` | 0 | 95 | 0.03 / 1.17 | all files formatted |
| 2 | `pnpm turbo run typecheck --force` (4 GB heap) | 0 | 122 | 1.36 / 5.57 | 17 of 17 |
| 2 | lint `--force --concurrency=1`, 4 GB heap, `@openverify/api` | 0 | 179 | 5.13 / 1.73 | 1 of 1 |
| 2 | the same, dashboard and contracts | 0 | 196 | 2.07 / 1.65 | 2 of 2 |
| 2 | the same, the other 14 packages | 0 | 293 | 1.52 / 1.66 | 14 of 14 |
| 3 | `python3 scripts/fetch_models.py`, `fetch_data.py` | 0, 0 | 0 | 1.53 | pinned files present |
| 4 | `pnpm --filter @openverify/watchlist build:variant-groups` | 0 | 6 | 1.53 / 1.49 | 156,706 groups kept |
| 5 | `pnpm turbo run test --force` watchlist, e2e, db | 0 | 341 | 1.16 / 1.63 | 3 of 3 |
| 5 | the same, dashboard (one call) | 0 | 349 | 1.50 / 7.77 | 561 files, 6,538 tests |
| 5 | the same, the other 12 packages (not api) | 0 | 145 | 6.58 / 14.15 | 12 of 12 |
| 5 | `pnpm --filter @openverify/js test` | 0 | 4 | 12.06 | 19 tests |
| 5 | API, 8 blob shards (each exits 1 on its partial coverage alone) | 1 x8 | 134, 150, 154, 153, 144, 131, 131, 122 | 11.09 to 7.14 / 8.95 to 8.52 | no failed test |
| 5 | API merge `--merge-reports --coverage` | 0 | 32 | 8.52 / 5.19 | 686 files, 9,375 tests, 94.36% |
| 6 | `benchmark:typecheck`, `benchmark:test` | 0, 0 | 41, 9 | 4.78 / 3.13 | 119 tests |
| 7 | `pnpm --filter @openverify/db test:integration` | 0 | 85 | 3.28 / 17.02 | 78 tests |
| 7 | `--project graph` | 0 | 32 | 15.66 / 10.83 | 13 tests; template 225,000 rows in 14.5 s |
| 7 | `--project api --shard=1/3`, `2/3`, `3/3` | 0, 0, 0 | 63, 158, 76 | 10.83 to 6.79 / 15.23 | 89, 99, 79 tests |
| 8 | `uv lock --check && ruff check && ruff format --check && mypy src tools` | 0 | 1 | 14.01 | clean |
| 8 | pytest files 1 to 58, `--cov-fail-under=0` | 0 | 245 | 12.88 / 2.17 | 1,471 passed |
| 8 | pytest files 59 to 103, `--cov-append` | 0 | 301 | 1.99 / 2.14 | 1,130 passed, 97.48% (gate 80%) |
| 9 | `:openverify-sdk:testAndroidHostTest --rerun` | 0 | 68 | 1.97 / 2.50 | 1,366 tests, none skipped (CI floor 1,366) |
| 9 | `testDebugUnitTest koverVerify` | 0 | 10 | 2.30 | |
| 9 | `assembleDebug :openverify-sdk:assemble lint` | 0 | 11 | 3.39 | |
| 10 | `openapi:write`, then `git diff --exit-code docs/api/openapi.json` | 0, 0 | 19 | 2.58 | sha256 `0ccb2cf2…edbded0021` |
| 10 | `workflow-docs:write`, then `git diff --exit-code docs/workflows` | 0, 0 | 2 | 2.58 | no diff |
| 11 | `flock … pnpm --filter @openverify/flow e2e` | 0 | 59 | 2.37 / 8.65 | 168 passed (163 Chromium, 5 Firefox theme-csp; WebKit skipped) |
| 11 | stack down and `turbo run build --filter=@openverify/e2e^...` | 0 | 0 | 8.04 | cached |
| 11 | `e2e:stack:up` | 0 | 85 | 7.39 / 4.84 | ready |
| 11 | `--project=chromium --shard=1/4` | 0 | 233 | 4.45 / 1.77 | 47 passed |
| 11 | `--shard=2/4` | 0 | 264 | 1.71 / 1.61 | 42 passed |
| 11 | `--shard=3/4` | 0 | 247 | 1.61 / 3.34 | 45 passed |
| 11 | `--shard=4/4` | 0 | 364 | 3.08 / 2.11 | 41 passed |
| 11 | `--project=console-sweep --no-deps` | 0 | 407 | 2.02 / 2.55 | 102 passed (97 axe pages, 5 CSP) |
| 11 | `e2e:stack:down` | 0 | 2 | 2.91 | stopped; no "not built yet" line in the stack logs |
| 12 | `docker build -t openverify/apps:dev -f infra/docker/apps.Dockerfile .` | 0 | 204 | 2.67 / 2.21 | |
| 12 | `docker build services/vision` | 0 | 13 | 2.03 | cached layers |
| 12 | `docker build -f infra/docker/code-runner.Dockerfile .` | 0 | 77 | 2.27 | |
| 13 | `apps-image-context`, `check-connected-results`, `ci-workflow`, `compose`, `flow-headers`, `flow-server` | 0 each | 0, 1, 6, 16, 3, 1 | 1.9 to 2.5 | 43, 11, 250, 541, 21 (live half on the tagged image), 38 |
| 13 | `gitleaks-config`, `install-gitleaks`, `pre-commit-hook`, `vision-container`, `code-runner` | 0 each | 11, 2, 3, 18, 17 | 2.2 to 2.5 | 10, 9, 11, 55, 55 |
| 14 | workflow benchmark `--runs=200 --clients=1,8,32` | 0 | 133 | 2.19 / 2.43 | below |
| 14 | analytics benchmark `--measure` (validation-9b's seed; no migration since) | 0 | 418 | 2.24 / 2.18 | below; the refresh step empty (the defect) |
| 14 | the same after the fix | 0 | 393 | 1.45 / 2.50 | below |
| 15 | `gitleaks git --redact .` | 0 | 8 | 1.93 | 5,822 commits, 85.7 MB, no leaks |

Unit tests per package (statements / branches): api 9,376 after the fix (94.36% / 84.98%);
dashboard 6,538 (95.58% / 88.53%); contracts 4,384 (99.11%); checks 3,826 (98.79%); db 2,172
(91.07%); workflow-engine 1,984 (98.02%); core 1,650 (99.21%); flow 1,510 (94.82%); watchlist 819
(98.63%); node 486 (98.44%); flow-spec 432 (96.27%); emrtd 318 (94.97%); config 290 (97.22%);
signals 192 (96.37%); e2e 131 (97.1%); ui 54 (100%); js 19 (100%). 34,181 in all; every package at or
above 80%.

The dashboard's whole test script fitted one call at this load (349 s); under the builders' load it
did not (786 to 903 s), which is why CI runs it as two shards (S9C-10).

## Benchmarks (reported, not gated; each under `flock /tmp/openverify-e2e.lock`)

Workflow engine (Phase 8 C117.11), 200 runs and 1,000 steps a row, load 2.19 before and 2.43 after:
effectful 16, 50 and 50 steps a second at 1, 8 and 32 clients (62.1, 20.1, 20.1 s); control-flow 93,
211 and 213 (10.8, 4.7, 4.7 s). Faster than 9B's (13, 38, 39; 69, 158, 165) at a similar load.

Analytics (C163.7), 1,000,000 inquiries on validation-9b's seed, after the fix (load 2.38 to 2.50):
build of 365 days 357,072 ms, no environment failed; the 5-minute refresh of 2 dirty days 55 ms; the
first pass after midnight, 30 open days, 28,085 ms; reads in ms, inquiries / funnel / verifications /
checks / cases / signals: 30 days 41 / 22 / 26 / 23 / 7 / 13; 90 days 37 / 29 / 45 / 48 / 11 / 56;
400 days 175 / 111 / 167 / 354 / 11 / 237. The run before the fix gave the same build and reads within
noise (380,010 ms; 400 days 159 / 107 / 170 / 373 / 12 / 241) and an empty refresh (15 ms, 0 days).
The container `openverify-analytics-benchmark` is stopped with this seed.

## Notes

- WebKit is downloaded here (`~/.cache/ms-playwright/webkit-2370`) but cannot start (host libraries
  missing); the flow config skips it (S9C-2). The three-engine line (C160.9) is proven in CI only, by
  the 9C push's e2e job. Firefox ran `theme-csp.spec.ts` here (5 passed).
- Three `opencode` processes were running throughout, each started 5 to 6 days ago and idle (under
  1% CPU): `opencode serve --service` (pid 839838), an `opencode` session (1381369) and a shell loop
  waiting on an old `validate-7b` run (1197923). They did not touch the tree (S4B-18 noted the same at
  9B); no other agent of this Workflow ran. `git status` shows only the owner's untracked note.
