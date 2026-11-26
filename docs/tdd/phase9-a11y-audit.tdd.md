# Phase 9, Workflow 9D Stage 1: `a11y-audit` (C171)

Evidence for C171 end to end: the inventory, the WCAG-EM method, the cross product, the own tests, the defects fixed, the manual checklist and the statement. Every timing is taken under `/tmp/openverify-e2e.lock` with `cat /proc/loadavg` beside it. `a11y-audit` runs alone.

## Precondition

`docs/PROGRESS.md:20` records "Workflow 9C done (the console)", with 9B (line 90) and 9A (line 186) before it; `git log e56e4e9c..HEAD` holds 946 Phase 9 commits; HEAD `47461ca7` (the orchestrator's 9D decisions).

## Baseline before any change

```
$ cat /proc/loadavg   # 0.51 0.58 0.52
$ flock -E 75 -w 240 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
  168 passed (59.1s)                      # exit 0, 63 s wall; projects chromium and firefox
$ cat /proc/loadavg   # 6.33 2.31 1.13
```

## Slices

| # | Slice | Commits |
|---|---|---|
| 1 | Evidence inventory (`docs/accessibility/audit-2026-11-07.md`) | `bd131a32` |
| 2 | The method (WCAG-EM's five steps), then the seed and the console draw | `19760201`, `7cc1c9d8` |
| 3 | The matrix generator: stub, RED, GREEN | `e0636caf`, `59151b88`, `67c718a6` |
| 4 | The CI matrix over the state catalog (`step-matrix.spec.ts`; the embedded gap closed) | `69c258d6` |
| 5 | D1 and D2: the dark runs draw the dark palette; screens with no session keep `style-variant` | `50bcebf1` (RED), `39f53eeb` (e2e RED), `e12637b6` (GREEN), `2ba04e8d` |
| 6 | The full cross product and its results | `5f9a2d75` |
| 7 | The flow's own tests on every step type and the aria snapshots; D4 the checkbox | `5c7c4b37` (RED), `5c94aa01` (RED), `a177e50c` (GREEN), `83ce618f` (refactor) |
| 8 | D5: the flow builder by a single pointer | `271ae673` (RED), `7153b835` (GREEN) |
| 9 | The console's own tests on the full stack; D6 the toast over the focus | `3843efaa` (e2e RED), `1deb659c` (RED), `4de0f1da` (GREEN), `4bfae41c` |
| 10 | The manual checklist, the engines, the results | `ff5ab762` |
| 11 | The statement and its records test | `de11457a` (RED), `c0e81afe` (GREEN) |
| 12 | D7: a screen's fallback text names its language (3.1.2) | `d4b60ed0` (stub), `0b727412` (RED), `f0f101b1` (GREEN), `c26dfa24` |

(`67c718a6`'s message says 41 states; the catalog holds 39, as the unit test and every run count.)

## Slice 3: the matrix generator

```
$ pnpm exec vitest run src/a11y-matrix.test.ts --coverage.enabled=false     # RED, on the stub
     × holds exactly one arrival per client step type, and unique ids
     × holds the error, retry and final states beside the arrivals (C171.1)
     × asks for the cross product only when the variable is exactly 1
     × is every locale, scheme, mode and width once: 84 configurations
     × adds one run at 768 px and one embedded run per client step type, on its arrival
     × is what runs without the switch, each run titled once
AssertionError: expected [] to have a length of 84 but got +0
      Tests  6 failed | 3 passed (9)          # tsc -p e2e and tsc: exit 0
$ pnpm exec vitest run src/a11y-matrix.test.ts --coverage.enabled=false     # GREEN
      Tests  9 passed (9)
```

## Slice 4: the CI matrix

```
$ flock ... pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts --project=chromium e2e/step-matrix.spec.ts
Running 188 tests using 6 workers
  2 failed  (selfie:retry: a hint name the schema refuses; aamva:silent: its heading)   186 passed (1.2m)
# recipes corrected; the two re-run: 8 passed (7.5s)
$ flock ... pnpm --filter @openverify/flow e2e      # load 3.22 -> 13.53
  307 passed (1.8m)                                # 108 s wall; 168 in 59.1 s before
```

## Slice 5: D1 and D2 (dark)

A probe in the embedded `ar-XB` dark run showed `prefers-color-scheme: dark` matching and the body's background `rgb(249, 250, 251)`, the light canvas: with no theme set, only `style-variant=dark` draws the built-in dark palette.

```
$ pnpm exec vitest run src/page-variant.test.tsx      # RED
     × draws the session-ended screen in the dark palette the page asked for
Error: expect(element).toHaveAttribute("data-openverify-variant", "dark")
      Tests  1 failed | 1 passed (2)
$ ... e2e/step-matrix.spec.ts (the dark runs with style-variant=dark and the attribute check)   # e2e RED
  8 failed: session:expired, session:link-expired, session:redacted, session:ended (ar and ar-XB, dark)   180 passed (1.5m)
$ pnpm exec vitest run src/page-variant.test.tsx src/app-parameters.test.tsx src/phase9a-theme-slot.test.tsx src/theme   # GREEN
      Tests  32 passed (32)
$ ... e2e/step-matrix.spec.ts
  188 passed (1.1m)
$ ... e2e/rtl.spec.ts e2e/screens.spec.ts e2e/server-position.spec.ts   # their dark runs now dark
  12 passed (10.9s)
```

## Slice 6: the full cross product

`OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1 flock -E 75 -w 240 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts --project=chromium e2e/step-matrix.spec.ts --shard=<i>/4`, one foreground call each:

| Pass | Shard | Runs | Exit | Seconds | Load before → after |
|---|---|---|---|---|---|
| first (void: dark drew light) | 1/4 | 819 | 0 | 302 | 9.69 → 8.68 |
| first | 2/4 | 819 | 0 | 292 | 7.99 → 9.28 |
| first | 3/4 | 819 | 0 | 345 | 8.54 → 4.98 |
| first | 4/4 | 819 | 0 | 251 | 4.58 → 10.00 |
| **valid** | 1/4 | 819 | 0 | 304 | 2.77 → 9.28 |
| valid | 2/4 | 819 | 0 | 291 | 9.28 → 9.57 |
| valid | 3/4 | 819 | 0 | 344 | 8.81 → 5.09 |
| valid | 4/4 | 819 | 0 | 254 | 4.68 → 11.21 |
| after D4 | `-g "consent:arrival \("` | 84 | 0 | 34 | 0.46 → 3.76 |

Valid pass: 3,276 runs, 1,193 s, 0 violations, no exception.

## Slice 7: the flow's own tests

```
$ ... e2e/wcag-steps.spec.ts --update-snapshots=none      # RED: no snapshots yet
  16 failed   Error: expect(locator).toMatchAriaSnapshot(expected) failed
$ ... --update-snapshots=missing                         # snapshots written, then reviewed and trimmed
  1 failed (a consent step: Error: 2.5.8: controls under 24 by 24 CSS px, { height: 20, name: checkbox, width: 20 })   15 passed
# mutation check: nfc.aria.yml's heading changed -> toMatchAriaSnapshot failed; restored
$ (packages/ui) pnpm exec vitest run src/checkbox.test.tsx      # RED
     × draws its box at 24 by 24 CSS px (2.5.8)       Tests  1 failed | 5 passed (6)
# GREEN: size-6
      Tests  6 passed (6)
$ ... e2e/wcag-steps.spec.ts e2e/wcag-own.spec.ts e2e/consent.spec.ts
  24 passed (9.0s)
```

## Slice 8: D5, the builder by a single pointer

```
$ pnpm exec vitest run src/components/flow-builder/flow-builder.test.tsx      # RED
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Actions for the selected step"
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Tidy up"
      Tests  2 failed | 13 passed (15)
$ pnpm exec vitest run src/components/flow-builder      # GREEN (the connect test reads the saved flow)
      Tests  59 passed (59)
```

## Slice 9: the console's own tests and D6

On the reusable stack (started in 99 s, load 1.0 → 3.7):

```
$ ... playwright test tests/ui-a11y-focus.spec.ts --project=chromium      # e2e RED
  + "/settings with a toast, Tab 1: div under p",
  + "/settings with a toast, Tab 55: input#_R_2kmclumbrb_-control under div",
  1 failed   2 passed (23.5s)
# probe: Tab 1 a focusable scroll region (overflow-x-auto) whose bottom end is under the toast; Tab 55 a field scrolled to the bottom edge, its centre under the toast's role=status
$ pnpm exec vitest run src/components/toasts.test.tsx      # RED
AssertionError: expected undefined to be 'bottom'      Tests  1 failed | 6 passed (7)
# GREEN: placementClearOf
      Tests  7 passed (7)   # then 8 with the branch test
$ ... tests/ui-a11y-builder.spec.ts   1 passed (8.9s)      (after one fix of the spec's own assumption about the outline's aria-selected)
$ ... tests/ui-a11y-preview.spec.ts   1 passed (12.0s)
$ ... tests/ui-a11y-analytics.spec.ts 1 passed (17.6s)
# fresh stack (89 s) with D6:
$ ... tests/ui-a11y-focus.spec.ts     3 passed (24.0s): 15.4 s, 5.9 s, 0.3 s
```

## Slice 11: the statement

```
$ pnpm exec vitest run src/accessibility-statement-records.test.ts      # RED
Error: ENOENT: no such file or directory, open '.../docs/accessibility/statement.md'
      Tests  1 failed | 3 passed (4)
# GREEN
      Tests  4 passed (4)
```

## Final gates (alone, in the foreground; exit codes read from the commands)

| Gate | Exit | Seconds | Result | Load |
|---|---|---|---|---|
| `pnpm --filter @openverify/flow typecheck` | 0 | 33 | | |
| `pnpm --filter @openverify/flow lint` | 0 | 50 | | |
| `pnpm --filter @openverify/flow test` | 0 | 91 | 123 files, 1,521 tests; statements 94.82%, branches 88.21% | |
| `pnpm --filter @openverify/ui typecheck`, `lint`, `test` | 0, 0, 0 | 2, 6, 4 | 8 files, 55 tests; statements 100%, branches 97.72% | |
| `pnpm --filter @openverify/dashboard typecheck` | 0 | 50 | | 2.98 |
| `pnpm --filter @openverify/dashboard lint` (heavy slot) | 0 | 153 | | |
| `pnpm --filter @openverify/dashboard test` (heavy slot, one call) | 0 | 365 | 562 files, 6,546 tests; statements 95.63%, branches 88.54% | 1.54 → 7.77 |
| `pnpm format:check` | 0 | 101 | | |
| `pnpm turbo run typecheck --force` (heavy slot) | 0 | 129 | 17 of 17 | 2.32 → 5.98 |
| forced lint, `--concurrency=1`, 4 GB heap: `--filter=@openverify/api` | 0 | 186 | 1 of 1 | 5.30 → 1.89 |
| … `--filter=@openverify/dashboard --filter=@openverify/contracts` | 0 | 202 | 2 of 2 | 1.89 → 1.49 |
| … the other 14 packages | 0 | 301 | 14 of 14 | 1.49 → 1.62 |
| e2e gate: `pnpm --filter @openverify/flow e2e` | 0 | 111 | 323 passed (1.8m): Chromium 318, Firefox 5 (`theme-csp`), WebKit not started | 1.37 → 9.88 |
| e2e gate: fresh stack (down and build; up) | 0, 0 | 133 (up) | | 8.60 → 4.02 |
| e2e gate: `--project=chromium --shard=1/4` | 0 | 232 | 47 passed (3.8m) | 3.85 → 1.70 |
| `--shard=2/4` | 0 | 291 | 45 passed (4.8m) | 1.89 → 2.29 |
| `--shard=3/4` | 0 | 274 | 45 passed (4.6m) | 2.11 → 2.82 |
| `--shard=4/4` | 0 | 390 | 44 passed (6.5m) | 2.60 → 1.40 |
| `--project=console-sweep --no-deps` (last, same stack) | 0 | 433 | 102 passed (7.2m) | 1.29 → 2.41 |
| `e2e:stack:down` | 0 | | | |

The six `ui-a11y` tests ran in the shards (181 chromium tests in all, 175 at the 9C close). About 31 minutes for the e2e gate with the mocked suite and the stack start.

## Slice 12: D7 (3.1.2) and the gates again on the final tree

```
$ pnpm exec vitest run src/screens/screen-copy-language.test.tsx src/session/session-copy.test.ts   # RED
AssertionError: About you: expected null to be 'en'
AssertionError: expected null to be 'fr'
      Tests  2 failed | 9 passed (11)
$ pnpm exec vitest run src/screens src/session src/flow src/preview      # GREEN
      Tests  373 passed (373)
$ ... e2e/wcag-own.spec.ts      7 passed (7.8s)
$ OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1 ... e2e/step-matrix.spec.ts -g "screen:(arrival|conditional|errors) \("
  252 passed (2.8m)        # 172 s, load 2.38 -> 9.85
```

| Gate (after D7) | Exit | Seconds | Result | Load |
|---|---|---|---|---|
| `pnpm --filter @openverify/flow typecheck`, `lint`, `test` | 0, 0, 0 | 40, 59, 117 | 124 files, 1,525 tests; statements 94.82%, branches 88.19% | |
| `pnpm --filter @openverify/flow e2e` | 0 | 153 | 324 passed (2.5m) | 6.49 -> 12.98 |
| `pnpm format:check` | 0 | 116 | | |
| fresh stack (down and build; up) | 0, 0 | 108 (up) | | 2.63 -> 4.01 |
| `--project=chromium --shard=1/4` | 0 | 257 | 47 passed (4.3m) | 3.12 -> 2.41 |
| `--shard=2/4` | 0 | 402 | 45 passed (6.7m) | 2.41 -> 3.42 |
| `--shard=3/4` | 0 | 363 | 45 passed (6.0m) | 3.42 -> 2.66 |
| `--shard=4/4` | 0 | 489 | 44 passed (8.1m) | 2.66 -> 2.80 |
| `--project=console-sweep --no-deps` (last, same stack) | **1** | 638 | **101 passed, 1 failed**: `/graph/[id] passes axe` hit the test's 180 s limit (3.6m) | 2.80 -> 2.98 |
| `e2e:stack:down` | 0 | | | |

**The failed sweep test.** The page the sweep opened is a graph query's result (`/graph/grphq_…`, made by `ui-graph-csp`): "718 accounts and 1282 shared values", the search stopped at its 2,000-node limit, and one unpaged table lists every account with every account it shares a value with. The trace's axe call (`Evaluate`) took 147 s on that DOM (the trace is 260 MB). In the first gate, on code that differs only in `apps/flow`, the same test passed in 2.3 min (138 s of its 180 s); each stack starts empty (teardown removes the volumes), so one full pass alone builds that graph. It is a test near its limit on a page whose size grows with the suite, not something this Workflow's console changes touch. It was not retried into a pass: the page needs paging (or the sweep a smaller query), which is `fix-console`'s (`components/graph/graph-table.tsx`) and `fix-api`'s (`e2e/tests/support/console-pages.ts`), recorded in the report. A single table of 718 rows, each with up to hundreds of links, is also a burden for a screen-reader user, so the audit lists it for the manual pass (M3).
