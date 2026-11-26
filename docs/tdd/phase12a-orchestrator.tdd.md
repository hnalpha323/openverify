# Phase 12A, Workflow 12A: the orchestrator's Stage 3 step (TDD evidence)

Orchestrator: Claude Code session d1064829 (claude-opus-5-5), after Workflow 12A (`wf_abe8b23f-87c`, 5/5 agents, base `4ea2493bf`, last agent commit `18fda7d25`). Host: WSL2, every command run after `source scripts/env.sh`, the suites under `flock /tmp/openverify-heavy.lock`. Nothing was pushed or dispatched; the docker project `openverify-test` was not touched; no real data was read.

## The calibrated document blur default

integration-12a's handover (`docs/tdd/phase12a-integration-12a.tdd.md`, `docs/calibration/blur-phase12a.md`) asked Stage 3 to set `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection` to `min-document-blur-score` 67.1 and `min-document-tenengrad` 8583.33.

### RED

`packages/core/src/check-config.test.ts` ("take the C36 calibration ...") first expected both keys:

```text
$ pnpm --filter @openverify/core exec vitest run src/check-config.test.ts
-   "min-document-blur-score": 67.1,
-   "min-document-tenengrad": 8583.33,
+   "min-document-blur-score": 96.56,
    "min-document-width-px": 616,
 ❯ src/check-config.test.ts:366:67
 Test Files  1 failed (1)
      Tests  1 failed | 53 passed (54)
```

### Decision: the blur score only; tenengrad stays template-only

With both keys applied, `pnpm --filter @openverify/checks calibration:report` re-rendered `docs/calibration/government-id-phase3.md` with:

```text
| id_blur_detection | `min-document-tenengrad` | below | 8583.33 | 12, 8288.718-16754.063 | ... | catches blurred, fails 1 genuine | ... | The current default fails 1 genuine card(s). |
```

Phase 3 kept `min-document-tenengrad` template-only because one synthetic design does not establish the scale of this contrast-dependent measure. Phase 12A calibrates on one synthetic design again (the Quebec-format SPECIMEN), the blur score alone separates its legible and blurred captures (margin 1.339), and a second blur gate would add a way for a real card to fail on blur, which is the live test's failure. So the test was narrowed to the blur score, with tenengrad still absent, and the code follows:

```text
$ pnpm --filter @openverify/core exec vitest run src/check-config.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  54 passed (54)
```

`packages/core/src/check-config.ts`: `id_blur_detection` is `{ 'min-document-blur-score': 67.1, 'min-document-width-px': 616 }`; the doc comment says why tenengrad has no default and where 67.1 comes from.

### What moved with it

- `pnpm --filter @openverify/checks calibration:report`: `docs/calibration/government-id-phase3.md`'s current value 96.56 -> 67.1 ("catches blurred, margin 52.092" on the Phase 3 measurements; the measurements and proposals are unchanged).
- `pnpm --filter @openverify/docs-tools docs:all`: `docs/checks/catalog.md`'s `id_blur_detection` row.
- `docs/checks/government-id.md` (hand-written): the `min-document-blur-score` setting (67.1, the 1,000 px text-box measure), the tenengrad note, the C9 legibility keys, and the calibrated-defaults table row.
- Four tests that pin the default, each failing on exactly that value in the first gate run below and updated to 67.1: `packages/checks/src/calibration/report.test.ts` (three: the report's `current`, `atCurrent.margin` 47.1, the rendered "catches blurred, margin 47.1"), `packages/checks/src/government-id/context.test.ts` (the merged config), `apps/api/src/jobs/process-verification.test.ts` (the stored provenance thresholds).

### Gates

First run (before the test updates):

```text
$ pnpm turbo run test lint typecheck --force --filter=@openverify/core --filter=@openverify/checks --filter=@openverify/contracts --filter=@openverify/docs-tools
@openverify/checks:test:  × proposes a lower bound between the genuine cards and the variants below them
@openverify/checks:test:  × judges the current default: what it catches, the genuine cards it fails and its margin
@openverify/checks:test:  × has the thresholds, the pHash distances, the variants and the AAMVA images
@openverify/checks:test:  × merges the template config over the defaults
```

After the checks updates:

```text
$ pnpm turbo run test lint typecheck --force --filter=@openverify/core --filter=@openverify/checks --filter=@openverify/contracts --filter=@openverify/docs-tools --filter=@openverify/api --filter=@openverify/dashboard
@openverify/docs-tools:test:  Tests  444 passed (444)    97.74 / 86.48 / 98.57 / 97.75
@openverify/checks:test:      Tests  3938 passed (3938)  98.76 / 91.45 / 99.35 / 98.75
@openverify/core:test:        Tests  2013 passed (2013)  99.24 / 94.5 / 99.73 / 99.21
@openverify/contracts:test:   Tests  4906 passed (4906)
@openverify/dashboard:test:   Tests  7386 passed (7386)
@openverify/api:test:         Tests  1 failed | 11045 passed (11046)   (process-verification.test.ts provenance: 96.56 expected, 67.1 received)
$ pnpm --filter @openverify/api exec vitest run src/jobs/process-verification.test.ts --coverage.enabled=false   # after the update
 Test Files  1 passed (1)
      Tests  61 passed (61)
```

Lint and typecheck passed for all six packages. The whole repository is validated next by `validate-full.sh` (`/tmp/validate-12a`).

## release:check's 64th owner item

`pnpm release:check` reports 64 owner items against 63 at Workflow 11G's close. The new one is `security/stale-evidence: v5.0.0-2.1.2: docs/checks/catalog.md changed after reviewed_commit e345d9507` (C274.6): Workflow 12A re-rendered the catalog. The row is reviewed again in its own commit after this one, so its `reviewed_commit` follows the last change to its evidence.

## Left open (recorded, not changed)

- **Handwriting false positive.** C10 gates the confidence drop at a stroke excess of 0.1, but vision-12a measured clean print at 0.12 to 0.24 per line, so a clean line can still score above 0.383 (0.6 x 0.156 + 0.4 x 0.97 = 0.48), and integration-12a saw it under glare. The check is beta and advisory in the default template; moving the gate needs the C36 handwriting rerun.
- **Stage wording.** `docs/calibration/blur-phase12a.md` says `id_blur_detection` "stays beta", while the registry and catalog list it as `ga`; the stage is unchanged here.
- **Q12A-1 to Q12A-3** (plan): the defaults hold (a missing field goes to review on the first attempt; a printed-only Quebec card goes to review for its number format; the real barcode's AAMVA variant is decided by the owner's retest).

## validate-full on `bdf1612ac` (`/tmp/validate-12a`)

45 of 47 rows green (format, lint, typecheck, vision, android, android-10a, android-10c, e2e, stack-test, the five images, infra, supply chain, kind 1.35 and 1.37, gitleaks, pii-history among them). Two rows red:

### `test` (2874 s, every package at once): one defect, three timeouts under load

- **Defect: the Android flow fixtures were stale.** checks-12a turned on `missing-fields-outcome: review` for `id_extracted_properties_detection` in seed:dev's default template, and the e2e fixture builders derive from it, but the committed `e2e/fixtures/android-10a/flow.json`, `android-10c/flow.json` and `android-11a/flow.json` were not regenerated (integration-12a ran the e2e Playwright suite, not this package's unit tests).

  RED (alone, load about 4):

  ```text
  $ (e2e) pnpm exec vitest run src/android-flow.test.ts src/android-nfc-flow.test.ts src/android-connect-flow.test.ts --coverage.enabled=false
   FAIL  src/android-connect-flow.test.ts > the 11A client-side redemption fixture > is the committed file, in a folder of its own beside the 10A and 10C ones
   FAIL  src/android-flow.test.ts > the 10A flow fixture > is the committed file
   FAIL  src/android-nfc-flow.test.ts > the 10C flow fixture > is the committed file, beside the 10A one
        Tests  3 failed | 6 passed (9)
  ```

  Each diff is only the `config: { "missing-fields-outcome": "review" }` block. GREEN: the builders' own write switch, then Prettier:

  ```text
  $ (e2e) UPDATE_CONTRACT_FIXTURES=1 pnpm exec vitest run src/android-flow.test.ts src/android-nfc-flow.test.ts src/android-connect-flow.test.ts --coverage.enabled=false
        Tests  9 passed (9)
  $ pnpm exec prettier --write e2e/fixtures/android-10a/flow.json e2e/fixtures/android-10c/flow.json e2e/fixtures/android-11a/flow.json
  $ (e2e) pnpm exec vitest run
   Test Files  24 passed (24)
        Tests  161 passed (161)    96.87 / 88.83 / 95.45 / 97.28
  ```

  The SDK's `stackTest` (`AndroidNfcFlowStackTest`, `AndroidConnectFlowStackTest`) reads these files, so the validate-full `stack-test` row was run again on the regenerated fixtures (below).

- **Timeouts under load, recorded and not retried into green (rule 6):** each met a 60 s guard in the all-packages run and none touches a 12A path (`git diff --stat 4ea2493bf HEAD` over them is empty):
  - `apps/flow/src/screens/screen-catalogue.test.tsx` "collects every kind into one submission" (60.1 s): KP11-44, open.
  - `apps/api/src/watchlists/rekey-batch.test.ts` "leaves every derived column identical for each candidate size" (75.7 s): KP11-67, CPU-bound, mechanism traced in `docs/tdd/phase11-fix-server.tdd.md`.
  - `packages/watchlist/src/match/shortcuts.test.ts` "create matches at tolerant with no shortcut on" (60.4 s): the class Phase 7 split for load (PROGRESS, Validation 7), met again.

### `integration` (865 s)

- `apps/api/src/seed/load-seed.integration.test.ts` "creates the accounts, then the inquiries in their statuses" met the 60 s guard, and the next case failed on the cut-off step's record ("the record lists 0 inquiries and the database holds 1674"): **KP11-102**, the same pair as validate-11f, cause not established, not patched or retried. The rest of api integration and db passed (78 of 79 files).

The `stack-test` row again, on the regenerated fixtures:

```text
$ flock /tmp/openverify-e2e.lock bash -c 'pnpm --filter @openverify/e2e e2e:stack:up && (cd android && ./gradlew --no-daemon :openverify-sdk:stackTest); ...; pnpm --filter @openverify/e2e e2e:stack:down'
> Task :openverify-sdk:stackTest
BUILD SUCCESSFUL in 54s
[e2e:stack] stopped      # rc 0
```
