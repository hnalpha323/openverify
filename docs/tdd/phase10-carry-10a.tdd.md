# Phase 10, Workflow 10A: carry-10a (the known items KP10-1 to KP10-3, K9-7, R002, R004, R008)

Agent `carry-10a` (10A decision D1, the plan's "Orchestrator decisions before Workflow 10A" item 3), beside
Stage 1b to Stage 3 after Stage 1a (`04cfac9c`). Every item test-first: RED seen failing for the reason
its detail gives, then GREEN. Commands ran after `source scripts/env.sh`; outputs are abbreviated.
Times are wall seconds with the lock wait and `cat /proc/loadavg` beside them.

## KP10-1: the 2.4.11 toast check on a slow runner, and the e2e job's traces

**Cause, as reproduced.** `ToastProvider` moves the stack clear of the focus on the animation frame
after `focusin` (`apps/dashboard/src/components/toasts.tsx`), and React commits that move a task later;
`coveredWhileTabbing` judged the page straight after the key press. On a loaded machine the judgement
lands before the move. Reproduced locally at load 4 to 7, with the test unchanged: the original test
failed too in the RED run ("stop 1, Tab 1: div under p"), as CI's did at stop 55. No real cover was
found: every reported stop cleared once the page settled (GREEN below), so `toasts.tsx` is unchanged.

**RED** (`2ef994f6`): two new tests in `e2e/tests/ui-a11y-focus.spec.ts`:

- the toast pass again with every animation frame 120 ms late (an init script that delays
  `requestAnimationFrame` in order and keeps `cancelAnimationFrame` working), as on a loaded runner;
- the check's own control on a `setContent` page: an overlay that covers the only field and moves
  clear a frame (plus 200 ms) after `focusin` is no cover, and one that stays is.

```
flock -E 75 -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/ui-a11y-focus.spec.ts; rc=$?; pnpm --filter @openverify/e2e e2e:stack:down; exit $rc"
  ✓  1 … tabbing through the console’s main pages … (19.1s)
  ✘  2 … with a toast on screen, no focused control is covered (C171.3) (7.1s)
       + "/settings with a toast, stop 1, Tab 1: div under p",
  ✘  3 … with a toast on screen on a slow runner (every frame late) … (KP10-1) (8.5s)
       + "/settings with a toast, stop 1, Tab 1: div under p",
       + "/settings with a toast, stop 7, Tab 1: a under div",
       + "/settings with a toast, stop 8, Tab 1: a under div",
       + "/settings with a toast, stop 9, Tab 1: button under p",
  ✘  4 the 2.4.11 check judges the settled page … (KP10-1) (335ms)
       + "moves clear, Tab 1: input#field under div#cover",
  ✓  5 3.3.8 …
  3 failed, 2 passed (46.8s)            exit 1; 183 s in all, lock wait 0 s, load 4.41 -> 7.55
```

**GREEN** (`5ff100d2`): `coveredFocus` (`e2e/tests/support/ui-a11y.ts`) judges the settled page: two
animation frames after the press, then at each frame until nothing covers the focus or
`SETTLE_BOUND_MS` (1,000 ms of the page's clock, provisional, ours) has passed. A cover that lasts
past the bound is still reported; no stop, page or timeout changed. `ui-a11y-preview.spec.ts`, which
uses the same check, ran with it.

```
… playwright test --project=chromium tests/ui-a11y-focus.spec.ts tests/ui-a11y-preview.spec.ts …
  ✓  1 … main pages … (33.2s)
  ✓  2 … with a toast on screen … (8.7s)
  ✓  3 … on a slow runner (every frame late) … (21.8s)
  ✓  4 the 2.4.11 check judges the settled page … (1.5s)
  ✓  5 3.3.8 … (461ms)
  ✓  6 ui-a11y-preview … (26.0s)
  6 passed (1.6m)                       exit 0; 262 s in all, lock wait 0 s, load 7.35 -> 11.99
```

The main-pages test went from 19 s to 33 s (two frames per stop over 480 stops), inside its 90 s.

**Traces.** RED `19a0861d`: `infra/tests/ci-workflow.test.sh` checks that the e2e job's upload of
`e2e/.artifacts` sets `include-hidden-files: true` and runs on `!cancelled()`:

```
bash infra/tests/ci-workflow.test.sh
FAIL - e2e: the upload includes hidden files, so e2e/.artifacts (a dot-directory) is uploaded (KP10-1) ([None])
# 251 passed, 1 failed, 0 skipped        exit 1
```

GREEN `d0972f6c`: `include-hidden-files: true` on that step (the token comment and `retention-days: 14`
stay). `# 252 passed, 0 failed, 0 skipped`, exit 0, actionlint 1.7.12 clean. Whether this was CI's cause
is confirmed or refuted by the 10A push's e2e artifact (the orchestrator records which).

## KP10-2: the gitleaks installer and one 5xx

**RED** (`50474ef2`): `infra/tests/install-gitleaks.test.sh` gains offline checks. A fake `curl`
first on PATH answers each call from a plan (a status or `net`), exits 22 on 400+ under `-f` as curl
does, and serves a synthetic release (a tarball holding a stand-in `gitleaks` script and its
checksums file, through `GITLEAKS_VERSION=0.0.1` and `GITLEAKS_SHA256`). Checks: two 504s then the
release installs, one call per answer; a connection failure, a 502 and a 500 are retried; an outage
stops after 5 attempts naming the status and installs nothing; a 404 fails at once, unretried; every
call keeps `--proto =https --tlsv1.2` with a connect timeout and a time limit; a mismatched pin still
fails closed after a retry; a cache directory is filled by a verified download, serves an install
with the host down and no download, and a tampered cached copy is discarded and never installed.
The two network checks are unchanged.

```
bash infra/tests/install-gitleaks.test.sh
FAIL - offline: the install survives HTTP 504s from the release host (KP10-2) (exit 22: … curl: (22) The requested URL returned error: 504 )
FAIL - offline: the retries are bounded (5 attempts) (1 attempts)
FAIL - offline: every download is HTTPS only, TLS 1.2+, with a connect timeout and a time limit (-fsSL --proto =https --tlsv1.2 -o …)
FAIL - offline: a cached release installs with the host down and no download (exit 22, …)
…
# 16 passed, 15 failed                   exit 1
```

**GREEN** (`3f8cfd58`): `download()` retries a 5xx, a timeout or a connection failure (curl's own
exit) up to 5 attempts, doubling a 2 s delay (`GITLEAKS_RETRY_DELAY_SECONDS`, 0 in the test), each
attempt `--connect-timeout 20 --max-time 60`; any 4xx fails at once ("not retried"). `verify()` holds
the two unchanged checks. `GITLEAKS_CACHE_DIR`, when set, is read first and verified both ways; a copy
that fails is reported, removed and replaced by a verified download; a verified download fills it.

```
bash infra/tests/install-gitleaks.test.sh
# 31 passed, 0 failed                    exit 0 (network half included: pinned 8.30.1 installed)
```

`--retry-all-errors` (the item's example) was not used: it retries a 4xx, which the item forbids.

**CI cache.** RED `e004e49e` (6 checks: both jobs restore an `actions/cache` of
`${{ runner.temp }}/gitleaks-cache` before the install, keyed on
`hashFiles('infra/scripts/install-gitleaks.sh')`, which holds the version and the pinned SHA-256, and
pass `GITLEAKS_CACHE_DIR`): `# 252 passed, 6 failed`, exit 1. GREEN `a46386d2`, the same
`actions/cache@55cc8345… # v6.1.0` pin the other caches use: `# 258 passed, 0 failed`, exit 0.

## KP10-3: the web selfie uploads the frame the guidance judged

**Stub** `5dd21008`: `HeldFrame`, `SampledFrame` and the sampler's `createPhotoCanvas` option
(types only), so the RED tests compile.

**RED** (`0ec2efe3`): `lib/sample-frame.test.ts` (6), `selfie/use-guidance.test.tsx` (2),
`steps/selfie-capture-step.test.tsx` (3; the manual-shutter case passes before and after):

```
pnpm --filter @openverify/flow exec vitest run src/selfie/use-guidance.test.tsx src/steps/selfie-capture-step.test.tsx src/lib/sample-frame.test.ts --coverage.enabled=false
 × draws the same camera frame at full resolution, unmirrored, in the call that samples it   expected +0 to be 1280
 × encodes the copy as captureFrame does when taken, then clears it: it is taken once
 × a later sample replaces the copy: the earlier frame is never taken for it                expected undefined to be null
 × release clears the copy without encoding it, and leaves a newer copy alone
 × reuses one photo canvas for every frame, resizing it only when the camera size changes
 × still samples the guidance frame, with no copy, when the photo canvas cannot be drawn
 × hands over the copy of the very frame whose faces completed the hold                     expected undefined to be defined
 × releases the last frame’s copy when the prompt’s guidance stops
 × uploads, on an auto-capture, the copy of the frame whose faces were held, never the camera’s later frame   expected [] to have a length of 1 (the live frame was uploaded)
 × never uploads a later frame for a judged frame that is gone: it asks for another try
 Tests  10 failed | 41 passed (51)       exit 1
```

**GREEN** (`f0861d50`):

- `createFrameSampler` draws the video at full resolution, unmirrored, into one reused photo canvas
  (resized only when the camera size changes) in the same synchronous call that draws the guidance
  frame, and answers `{data, width, height, held}`.
- `held.take()` encodes it with `encodeCanvas` (JPEG 0.92, `captureFrame`'s encoding, now shared from
  `lib/capture-frame.ts`), clears the canvas and is `null` after; a later sample or `release()`
  replaces or clears it.
- `useGuidance` hands `onAutoCapture(state, held)` the copy of the frame whose faces completed the
  hold, and releases the last copy when the prompt's guidance stops.
- `takePhoto` takes that copy before anything awaits; the manual shutter, or a sampler that holds no
  copy (a canvas without a 2D context), takes the live frame as before; a copy that is gone sets
  `frameFailed` ("We could not take the photo. Try again.") and never uploads a later frame.

```
pnpm --filter @openverify/flow exec vitest run src/selfie src/steps/selfie-capture-step.test.tsx src/lib --coverage.enabled=false
 Test Files  10 passed (10)   Tests  139 passed (139)              exit 0
(cd apps/flow && pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratch>/coverage-flow)
 Test Files  125 passed (125)   Tests  1501 passed (1501)   All files 94.81 | 88.08 | 95.64 | 95.1   exit 0
   224 s, load 7.13 -> 26.75
flock -E 75 -w 240 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
  328 passed (3.1m)                                                 exit 0; lock wait 0 s, load 23.61 -> 22.61
flock -E 75 -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "… e2e:stack:up && … playwright test --project=chromium tests/flow-bundle.spec.ts tests/selfie-repeat.spec.ts tests/selfie-static-replay.spec.ts tests/selfie-review.spec.ts; …"
  ✓ flow-bundle (15.9s)  ✓ selfie-repeat (24.6s)  ✓ selfie-review (19.4s)  ✓ selfie-static-replay (35.7s)
  4 passed (1.7m)                                                   exit 0; stack up 150 s, 259 s in all, lock wait 0 s, load 16.58 -> 8.05
```

For 10B's port (C204): the rule to copy is "the photo of an auto-capture is the judged frame's own
full-resolution copy, drawn in the same call as the guidance sample; the manual shutter takes the
live frame; a copy is taken once and nothing is kept after it".

## K9-7: the workflow draft page's modules

No contract change was needed: `GET /workflows` already takes `filter[kind]=module`
(`listWorkflowsQuerySchema`) and each workflow carries `kind`, `status` and its
`latest-published-version`, exactly what the check accepts (`loadCheckContext`: a `module` workflow
with a published version, else `module_unknown`).

**RED** `f531f791` (and the guards `b1b8a3ae`), `app/workflows/[id]/draft/page.test.tsx`:

```
(cd apps/dashboard && pnpm exec vitest run "src/app/workflows/[id]/draft/page.test.tsx" --coverage.enabled=false)
 × offers each published module workflow of the environment, read as filter[kind]=module
   TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name `/Module: Synthetic address module/`
 Tests  1 failed | 10 passed (11)          exit 1
```

The guards (no read for a module's own draft, `module_nested`; for an account or case action,
`module_refused_for_trigger`; for a reader without `workflows:write`) pass before and after.

**GREEN** `dba6d24f`: the page reads `api.workflows.listAll({ filter: { kind: 'module' } })` (at most
200, provisional), keeps the unarchived ones with a published version, and passes them as `modules`;
none for a module draft, a `trigger-account` or `trigger-case` definition, or a reader who cannot
edit. `Tests 13 passed (13)`, exit 0.

Existing test changed (rule 12): the `beforeEach` serves an empty `GET /workflows`, and the
"asks for nothing else" test's allowed reads gain `GET /workflows`, the read this item adds.

## R002: the flow's theme-asset read

**RED** `7eaf30fa`, `routes/server/theme-assets.test.ts` (PGlite through `createTestApi`):

```
(cd apps/api && pnpm exec vitest run src/routes/server/theme-assets.test.ts --coverage.enabled=false)
 × answers another theme set’s asset of the same environment as it answers an unknown one: 404, nothing apart
   AssertionError: tsa_01M6YK8Z3B78AF56XF80Y14KK0: expected 200 to be 404
 × serves no asset to a session that renders the built-in theme
   AssertionError: expected 200 to be 404
 Tests  2 failed | 20 passed (22)          exit 1
```

**GREEN** `c319f4d7`: `readFlowThemeAsset` (`services/themes/assets.ts`) resolves the session's theme
with `resolveThemeForSession` (the inquiry's set, its version's, the environment's default) and
serves only its logo's and uploaded font's `asset-id`; anything else throws the unknown asset's
`NotFoundError` (the same problem but for the id; the test compares them). The route, its schema,
OpenAPI and the headers are unchanged. `Tests 37 passed (37)` with `phase9a-theme-plumbing.test.ts`.

Existing test changed (rule 12): "is the flow's with a session of the same environment, cached
privately for an hour" now opens its session on an inquiry whose theme set names the font it reads;
its assertions are unchanged. `uploadWithVision` moved to file scope, unchanged.

## R004: the served review status

Shape: `servedReviewStatus(locale, catalog, sha256, declared = LOCALE_REVIEW_STATUS)` in
`packages/flow-spec/src/locale-review-status.ts` (exported through `index.ts`'s existing
`export *`, so `index.ts` is untouched). A `reviewed` or `partially-reviewed` record may carry
`keySha256`, the per-key digests of the catalog as reviewed (as Android's `review-status.json`
does); it counts as the snapshot only when `catalogSha256(keySha256)` is the record's
`catalogSha256`; otherwise every key is unreviewed (fail closed). Nothing is marked reviewed.

Stubs `828e7a22` (flow-spec), `554fafb6` (api), `56d8ca51` (dashboard), each answering the declared
status as the readers did.

```
RED 2f2ee108  pnpm --filter @openverify/flow-spec exec vitest run src/locale-review-status.test.ts --coverage.enabled=false
 × serves it partially reviewed, naming the key, once its catalog changed one message
   AssertionError: expected { status: 'reviewed', …(4) } to deeply equal { status: 'partially-reviewed', …(5) }
 × fails closed without the snapshot, or with one that is not the catalog its record names
 Tests  2 failed | 15 passed (17)          exit 1
GREEN 48f00c1f                              Tests  17 passed (17)   exit 0

RED 2d22da6d  (cd apps/api && pnpm exec vitest run src/services/templates/locale-review.test.ts --coverage.enabled=false)
 × serves a review whose catalog then changed one message as partially reviewed, naming it
   AssertionError: expected { status: 'reviewed', …(4) } to match object { status: 'partially-reviewed', …(1) }
 Tests  1 failed | 2 passed (3)            exit 1
GREEN 2876171b: servedLocaleReviewStatus (services/templates/locale-review.ts) reads the exported
  catalog (contracts/fixtures/i18n/<locale>.json, once) for a reviewed record; flow-v2.ts's
  unreviewedLocales and operations.ts's unreviewed_locale_enabled use it.   Tests 3 passed (3)

RED c0dfe4e6  (cd apps/dashboard && pnpm exec vitest run src/components/translations/copy-key-catalog.test.ts --coverage.enabled=false)
 × shows a reviewed locale whose exported catalog changed one message as partially reviewed (R004)
   AssertionError: expected { status: 'reviewed', …(4) } to match object { status: 'partially-reviewed', …(1) }
 Tests  1 failed | 5 passed (6)            exit 1
GREEN 08a8d36d: localeReviewStatuses() serves servedReviewStatus over the five exported catalogs
  (imported as JSON in the server-only module), and the flow builder's copy panel
  (app/templates/[id]/flow/page.tsx) takes it instead of LOCALE_REVIEW_STATUS.   Tests 47 passed (47)
```

The console's first RED commit (`bdc05946`) read the fixture with `readFileSync(new URL(...))`, which
jsdom refuses ("The URL must be of scheme file"): it failed, but not for its reason. `c0dfe4e6`
imports the JSON instead; that RED was then seen failing for its own reason against the stub (the
stub's file written back from `HEAD` for that one run, the GREEN file kept aside and put back).

## R008: the analytics benchmark's refresh step

**RED** `8fda1347`, `src/analytics-benchmark-refresh.test.ts` (PGlite):

```
(cd apps/api && pnpm exec vitest run src/analytics-benchmark-refresh.test.ts --coverage.enabled=false)
 × touches a row of every source dirtyDays reads in the window: verifications, checks and cases too (R008)
   AssertionError: verifications: expected '2026-11-08T22:48:02Z' to be '2026-11-01T10:01:00Z'
 Tests  1 failed | 1 passed (2)            exit 1
```

**GREEN** `f2a2c91e`: `touchRefreshWindow` writes `ANALYTICS_BENCHMARK_TOUCHED_TABLES` (`inquiries`,
`verifications`, `verification_checks`, `cases`), each row created in the 48-hour window, first to
`2026-10-28` and then to `ANALYTICS_BENCHMARK_TOUCHED_AT` (S9C-14). `Tests 8 passed (8)` with
`package-scripts.test.ts`. No rollup, suppression or budget changed.

**Measured** (reported, not gated), `flock -E 75 -w 240 /tmp/openverify-e2e.lock pnpm --filter
@openverify/api analytics:benchmark --measure` on validation-9d's seed (taken after 0032; no later
migration), lock wait 0 s, load 5.05 at the start, exit 0, about 640 s wall:

| Step | validation-9d (before, load 2.16-2.18) | carry-10a (after, load 5.7-10.5) |
|---|---|---|
| build, 365 days | 369,229 ms | 581,829 ms |
| refresh-5-minute, 2 days | 55 ms (inquiries only) | 1,992 ms (inquiries, their verifications and checks) |
| refresh-after-midnight, 30 days | 30,086 ms | 36,606 ms |
| reads at 400 days (inq / funnel / ver / checks / cases / signals) | 186 / 109 / 235 / 396 / 12 / 282 | 204 / 242 / 272 / 380 / 17 / 332 |

The refresh now times the verification and check branches (about 22,000 verifications and 132,000
checks touched). The seed holds no cases, so the cases branch still scans an empty set (a seed
change, recorded as a follow-up). The higher build time is the machine's load (three times
validation-9d's). The container was started by `--measure` and left running: stopping it was refused
by the session's permission check (follow-up).

## Final gates (rule 24: what carry-10a touched), beside other agents

Each call in the foreground after `source scripts/env.sh`; exit codes read from the command.

| Call | Exit | Wall s | Load (start / end) | Result |
|---|---|---|---|---|
| forced typecheck, api, dashboard, flow, flow-spec, e2e (`--concurrency=2`, heavy slot) | 0 | 232 | 5.73 / 9.62 | 5 of 5 |
| forced lint `--concurrency=1`, 4 GB heap: api / dashboard / flow, flow-spec, e2e | 0, 0, 0 | 370, 215, 102 | 5.66 to 9.83 | 1, 1, 3 tasks |
| flow unit, coverage | 0 | 224 | 7.13 / 26.75 | 1,501 tests, 94.81% statements |
| flow-spec unit, coverage | 0 | 8 | 7.17 | 454 tests, 96.27% |
| e2e unit, coverage | 0 | 8 | 7.17 | 131 tests, 97.1% |
| dashboard: shards 1/2 and 2/2 (blob), then the merge | 1, 1, **0** | 260, 303, 10 | 7.26 to 12.38 | merge: 579 files, 6,721 tests, 95.58% (a lone shard exits 1 on partial coverage) |
| api: 12 blob shards, then the merge | 1 each (partial coverage), merge **1** | 130-290 each, merge 118 | 12.0 to 28.5 | 696 files, 9,468 passed, 4 failed, 94.39% statements |
| integration: db / graph / api 1-3 of 3 | 0, 0, 0, 0, 0 | 195, 47, 161, 367, 248 | 23.7 to 51.3 | 78; 13 (template 23.6 s); 93, 104, 88 |
| mocked flow suite (e2e lock) | 0 | 192 | 23.61 / 22.61 | 328 passed |
| `bash infra/tests/ci-workflow.test.sh` | 0 | 7 | | 258 passed (actionlint 1.7.12 clean) |
| `bash infra/tests/install-gitleaks.test.sh` | 0 | 4 | | 31 passed (offline 22, network 9) |
| `bash infra/tests/pre-commit-hook.test.sh` | 0 | 2 | | 11 passed |
| `pnpm format:check` | 0 | 182 | | all formatted |

**The API merge's 4 failures** are all in `src/services/templates/consent-texts.android.test.ts`,
api-android-10a's RED commit `5bb4fdaf` (C200.4), committed beside this run; its GREEN `07c626af`
landed during the gate, and the file then passed alone (`Tests 4 passed (4)`, exit 0). No failure is
in carry-10a's paths; the merge is reported as it exited, 1.

**Own full-stack specs.** The one-call form (`timeout 520`) ran out at load 33 to 42: the stack took
403 s to come up, then `flow-bundle` (42.0 s) and both `theme-sets` tests passed before the timeout
(exit 124); that stack was taken down by its own call. Then, in rule 7's separate calls on one fresh
stack (up in 151 s, load 37 to 25), each spec under the e2e lock with a 0 s wait:

```
ui-a11y-focus.spec.ts       5 passed (1.9m)   main pages 54.6 s, toast 16.2 s, slow runner 35.2 s, control 1.8 s, 3.3.8 1.1 s
flow-bundle.spec.ts         1 passed (48.1s)
theme-sets.spec.ts          2 passed (5.7s)    the logo through the flow's asset read (R002)
ui-workflow-editor.spec.ts  4 passed (28.7s)   the draft page with its module read (K9-7)
ui-themes-copy.spec.ts      2 passed (32.0s)   the translations page (R004)
ui-a11y-preview.spec.ts     1 passed (23.5s)
stack down                  exit 0
```

The selfie specs (`selfie-repeat`, `selfie-review`, `selfie-static-replay`) passed with `flow-bundle`
in the KP10-3 call above. The stack builds `next build` of the dashboard, so the JSON import of the
exported catalogs (R004) builds.
