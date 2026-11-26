# Phase 11, Workflow 11G: records-11g

Stage 2 part `records-11g` (Q1, Q5, Q8, Q10, Q11, Q12 granted; P2 granted, record check only; DEVICE-PROOFS from the orchestrator's record, 11G decisions item 20). Q6 and Q7 are pending (counsel): nothing changes for them. Start `4b3a06a0f`; Stage 1a's last commit `37e4f8922` (contracts-11g). Every command ran after `source scripts/env.sh`; output abbreviated.

## 1. Q1 granted: the reporting line (C276.4)

PROGRESS records `**Q1:** granted (2026-11-21 ...)` (`docs/PROGRESS.md:41`); `SECURITY.md:7` and `docs/security/vulnerability-policy.md` still said "(Q1, pending)".

RED: `packages/docs-tools/src/records/vulnerability-policy.test.ts`, "the reporting channel follows Q1 as PROGRESS records it" (five cases: a granted Q1 still called pending fails, a granted Q1 without "private until" fails, the granted wording passes, a declined Q1 promising a public channel fails, the policy page under the same rule).

```
$ (cd packages/docs-tools && pnpm exec vitest run src/records/vulnerability-policy.test.ts --coverage.enabled=false)
     × fails a SECURITY.md that still calls Q1 pending once PROGRESS records it granted
     × fails a SECURITY.md under a granted Q1 that does not say the repository is private until the release
     × fails a SECURITY.md under a declined Q1 that promises a public channel
     × holds the vulnerability policy page to the same rule
      Tests  4 failed | 7 passed (11)        rc=1 (no rule reads Q1's state yet)
$ pnpm --filter @openverify/docs-tools typecheck     rc=0
```

RED commit `1fa1d3d7a`.

GREEN: `q1Findings` in `packages/docs-tools/src/records/vulnerability-policy.ts` reads Q1 through `ownerStates` (`src/release/progress.ts`) and holds both pages (granted: never "Q1 ... pending", and "private until"; declined: never "opens with the public release", and "stays private"). `SECURITY.md:7` and the policy's reporting paragraph now say Q1 is granted (2026-11-21), the repository stays private until the public release and nothing has been enabled (the visibility and the reporting setting are the owner's release steps, HARD LIMITS (2)); the policy's "How a fix ships" step 3 says publication, keyless signing and attestations are granted but happen only at the owner's approved dispatch, and nothing has been published or signed.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/records/ --coverage.enabled=false)
      Tests  61 passed (61)                  rc=0
$ pnpm --filter @openverify/docs-tools docs:records && pnpm --filter @openverify/docs-tools docs:release
                                             rc=0, rc=0; no generated file changed (the notes cite neither page's Q1 line)
$ (cd packages/docs-tools && pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/claude-1000/cov-dt-q1)
 Test Files  51 passed (51)
      Tests  433 passed (433)
All files          |   97.62 |    86.25 |   98.33 |   97.63 |      rc=0, 22.5 s, load 3.66
$ eslint (the two files) rc=0; tsc --noEmit rc=0
```

Checkpoint 1 `8dfc8358c` (gate: the docs-tools suite, its lint and typecheck; nothing else was reached).

## 2. Q5 granted: uv 0.13.7 everywhere uv is pinned

contracts-11g recorded uv 0.13.7 (2026-11-03; `THIRD_PARTY_LICENSES.md` section 1's uv row: image index `sha256:96f40d39…b490`, linux x86_64 asset SHA-256 `c5221ff4…6d83`), to apply on or before 2026-11-25. Applied on 2026-11-21.

RED (two contract tests):
- `infra/tests/ci-workflow.test.sh`: every setup-uv step (three) installs the vision Dockerfile's `UV_IMAGE` tag, which is the ledger's uv row, and passes setup-uv's `checksum` input equal to the row's asset SHA-256.
- `infra/tests/images.test.sh`: `UV_PIN` is 0.13.7 by its index digest (static's `ARG UV_IMAGE` check), and the pins subcommand now also holds the vision Dockerfile's `UV_IMAGE` to `UV_PIN` and the ledger's row to it.

```
$ bash infra/tests/images.test.sh pins     rc=1
FAIL - pins: services/vision/Dockerfile: UV_IMAGE is the pinned uv (expected '…uv:0.13.7@sha256:96f40d39…', got '…uv:0.13.3@sha256:bee0a2a4…')
# 27 passed, 1 failed
$ bash infra/tests/images.test.sh static   rc=1
FAIL - vision: ARG UV_IMAGE defaults to the pinned digest (expected '…0.13.7…', got '…0.13.3…')
# 148 passed, 1 failed
$ bash infra/tests/ci-workflow.test.sh     rc=1
FAIL - supply-chain: setup-uv installs the uv THIRD_PARTY_LICENSES.md records (Q5) (0.13.3)
FAIL - supply-chain: setup-uv checks the asset against the recorded SHA-256 (`checksum`)
FAIL - vision: … (0.13.3)   FAIL - vision: … (`checksum`)
FAIL - e2e: … (0.13.3)      FAIL - e2e: … (`checksum`)
# 538 passed, 6 failed, 0 skipped
```

RED commit `d9e396472`.

GREEN: `.github/workflows/ci.yml`'s three `astral-sh/setup-uv` steps (supply-chain, vision, e2e) `version: '0.13.7'` with `checksum: c5221ff4…6d83` (setup-uv v10.3.0's input, so the asset is checked against the ledger's SHA-256, not only astral's manifest; the action's commit is unchanged); `services/vision/Dockerfile:18` `ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d39…b490`; `services/vision/pyproject.toml`'s `uv_build>=0.13.3,<0.14.0` admits 0.13.7, so it is unchanged; `THIRD_PARTY_LICENSES.md:23` (the exclude-newer line) records the re-check and the uv row records the three `checksum` inputs; ADR 0010 §5's release-age bullet records the owner's rule (Q5: the 14 days cover toolchain binaries, base images and Actions). `release.yml` and `android-release.yml` use no uv. The host's uv is not replaced (the CLAUDE.md line is proposed in the report's followups).

Every `uv.lock` re-checked with uv 0.13.7 taken from its pinned image (`docker create` of `ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d39…`, `/uv` copied to the scratchpad, SHA-256 prefix `92a78f0a49090f86`), run read-only in the pinned `python:3.12-slim@sha256:5e2bdb1b…` (the uv image has no interpreter, so `uv lock` alone stops at "Failed to discover managed Python installations"):

```
$ docker run --rm -u <uid>:<gid> --tmpfs /tmp:mode=1777 -e UV_CACHE_DIR=/tmp/uvc -e UV_PROJECT_ENVIRONMENT=/tmp/venv -e UV_PYTHON_DOWNLOADS=never \
    -v <scratch>/uv:/usr/local/bin/uv:ro -v $PWD/<dir>:/work:ro -w /work python:3.12-slim@sha256:5e2bdb1b… uv lock --check
services/vision     rc=0  Resolved 61 packages   uv.lock sha256 deead3a40d3cc26d before and after
load                rc=0  Resolved 22 packages   391f2c6827fed1da before and after
security/pip-audit  rc=0  Resolved 30 packages   4d588f7260408285 before and after
security/python     rc=0  Resolved 17 packages   ddfd4d94e86785c4 before and after
```
No version moved and `exclude-newer-span = "P14D"` stays in each (the files are byte-identical).

```
$ bash infra/tests/images.test.sh pins      rc=0  # 28 passed, 0 failed
$ bash infra/tests/images.test.sh static    rc=0  # 149 passed, 0 failed
$ flock /tmp/openverify-e2e.lock docker build -q --build-context repo=. -t openverify/vision:11c-local services/vision
                                            rc=0  34 s (lock wait 0.003 s; load 2.10 2.32 3.16)
$ flock /tmp/openverify-e2e.lock bash infra/tests/images.test.sh vision    rc=0  # 28 passed, 0 failed
$ bash infra/tests/ci-workflow.test.sh      rc=1  # 544 passed, 1 failed, 0 skipped
FAIL - infra/tests/codeql-workflow.test.sh runs in a CI job or is named local-only with its reason
      (codeql-11g's new, still uncommitted infra/tests/codeql-workflow.test.sh and its own ci-workflow.test.sh edit; not records-11g's; every uv check passes)
$ bash infra/scripts/supply-chain.sh zizmor  rc=0 (findings below medium only)
$ (cd packages/config && pnpm exec vitest run src/release-11g-pins.test.ts src/supply-chain-pins.test.ts --coverage.enabled=false)   59 passed, rc=0
$ (cd packages/docs-tools && pnpm exec vitest run src/integration --coverage.enabled=false)   20 passed, rc=0
$ pnpm --filter @openverify/docs-tools docs:release   rc=0, no change
```
The vision suite, security/python's checks and `load/`'s gate (run by the host's uv, which Q5 does not replace) are in the last checkpoint's gate.

Checkpoint 2 `741d99a03`.

## 3. Q8 granted: the vendor-named migration page (C280)

RED: `packages/docs-tools/src/switches.test.ts`: the switches are `{ vendorNaming: true, publishWired: false }` (publishWired is publish-11g's borrowed edit), `vendorNaming` is on exactly when PROGRESS records Q8 granted (`ownerStates`), and `migrationPagePath()` is `docs/migration/from-persona.md`.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/switches.test.ts --coverage.enabled=false)
     × turn vendor naming on and keep publishWired off
     × name the vendor exactly when PROGRESS records Q8 granted (C289, C280.6)
     × select the vendor-named migration page while vendor naming is on
      Tests  3 failed | 3 passed (6)        rc=1 (the switch is still off)
$ (cd packages/docs-tools && pnpm exec tsc --noEmit)   rc=0
```

RED commit `6059ea48e`.

GREEN: `DOCS_SWITCHES.vendorNaming` is `true` (`packages/docs-tools/src/switches.ts`, its header rewritten for the grant). `pnpm --filter @openverify/docs-tools docs:catalog` then wrote `docs/migration/from-persona.md` (title "Migrating from" the source vendor, the not-affiliated line first, identifiers quoted as behaviour, no logo, no copied text, C280.4/C280.7), `docs/checks/catalog.md` (the "Source API name" column, C279.2) and `docs/connect/mapping.md` (its link now points at the vendor-named page). The generator no longer writes the neutral `docs/migration/from-hosted-api.md` (`migrationPagePath()` selects the vendor-named one), so it was removed with `git rm` (C280.5: the page lives at one path by the switch; a neutral page left behind would still say "Q8 pending").

The switch-off assertions of 11E's tests changed with the decision (rule 12; contractDeviations): `src/vendor-name.test.ts` (the vendor-named page is exempt under the committed switch; new case: a link to `from-persona.md` is a path, not naming, only while the switch is on); `src/vendor-name.ts` (that path token is allowed while the switch is on, and the message names the rule that applies); `src/catalog/check-catalog.test.ts` (the committed page is the area's render with the vendor-name column, and the switched-off render has none); `src/catalog/mapping.test.ts` (the neutral page is rendered in memory as the decline outcome; the committed page is the vendor-named one, equal to a fresh render, with the not-affiliated line, and the neutral file is gone); `src/catalog/index.test.ts` (the area renders the vendor-named page); `src/docs-tree.ts` and `src/docs-tree.test.ts` (the manifest's migration entry is `migrationPagePath()`, a named borrowed edit). Borrowed edit: `docs/release/checklist.md` B07's evidence cell names `docs/migration/from-persona.md` in place of the removed file (state and date unchanged; without it `release:check` errors `checklist-evidence`).

```
$ pnpm --filter @openverify/docs-tools docs:catalog     rc=0  (routes: 1 files written; catalog: 4 files written)
$ pnpm --filter @openverify/docs-tools docs:release     rc=0  (notes unchanged)
$ pnpm --filter @openverify/docs-tools docs:all         rc=0  (no further diff)
$ (cd packages/docs-tools && pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/claude-1000/cov-dt-q8)
 Test Files  51 passed (51)
      Tests  436 passed (436)
All files          |   97.69 |    86.26 |   98.54 |    97.7 |      rc=0
$ (cd packages/docs-tools && pnpm exec tsc --noEmit && pnpm exec eslint .)   rc=0, rc=0
$ pnpm release:check      rc=0; release:check (default): 0 errors, 81 owner items
```
The six `security/stale-evidence` owner items (ASVS v5.0.0-13.4.1, 13.4.2, 15.1.1, 15.1.2, 15.2.1, 15.2.3) come from this Workflow's test edits (records-11g's `images.test.sh` and `vulnerability-policy.test.ts`, publish-11g's `release-workflow.test.sh`); records-11g re-reviews its four after its last `images.test.sh` change (section 8).

Checkpoint 3 `bda7a8baf`.

## 4. Q10 granted: the UN list's opt-in unlocked (C254.1; KP11-31)

The three hooks 11B left unwired (plan `:1897`; inventory §7.8): the switch in the dashboard admin route context; `optInSources` at the reconcile callers; `environmentMayScreenSource` on the screening path. Each is a named borrowed edit outside `apps/api/src/watchlists/un-opt-in.ts`.

Stub commit (names the RED tests need, no behaviour): `watchlistReconcileOptIn(db, allowed)` in `un-opt-in.ts` (returns `{}`); `DashboardAdminOptions.watchlistUnOptInAllowed` (`routes/dashboard/admin.ts`, not yet passed on); `WatchlistSettings.unOptInAllowed` (`config.ts`, optional, not yet set); `reconcileWatchlistSourcesAtStart`'s fourth parameter (`worker.ts`, unused); `DevSeedOptions.watchlistUnOptInAllowed` (`seed/dev-seed.ts`, unused); `ScreeningKit.environmentSettings` (`jobs/reports/screening.ts`, the environment's settings, not yet read); the dashboard harness's `watchlistUnOptInAllowed` option (`routes/dashboard/dashboard.test-support.ts`). `tsc --noEmit` and eslint on the files: rc=0.

Stub commit `fcf6c023d`.

RED (eight test files, the hooks' callers first; each compiles and typechecks, `tsc --noEmit` rc=0, eslint rc=0):
- `apps/api/src/watchlists/un-opt-in.test.ts`: `watchlistReconcileOptIn(db, false)` is `{}` whatever a setting holds; `(db, true)` names `un-sc` for an opted-in environment, and `[]` for none.
- `apps/api/src/routes/dashboard/watchlist-opt-in.test.ts`: through the dashboard harness with `watchlistUnOptInAllowed: true` (hook 1): 403 `step_up_required` without a recent second factor, nothing stored; a stepped-up admin opts in (200, stored, one `watchlist-source.opt-in-accepted` audit row) and withdraws (204, `null` stored, one `.opt-in-withdrawn` row); other terms answer 422.
- `apps/api/src/container.test.ts` (hook 2, the API's ready reconcile): `watchlistReconcileOptIn` observed by a partial mock; called with the config's switch, and its `optInSources` reach the reconcile.
- `apps/api/src/worker-startup.test.ts` (hook 2, the worker's start): the opted-in sources reach the reconcile while allowed; none while not.
- `apps/api/src/watchlists/cli.test.ts` (hook 2, `watchlists:sync`): an opted-in environment keeps `un-sc` enabled while `settings.unOptInAllowed`, disabled once not.
- `apps/api/src/jobs/repeatable/watchlists.test.ts` (hook 2, the refresh tick): the same over its own PGlite.
- `apps/api/src/seed/dev-seed.test.ts` (hook 2, `seed:dev`): the seed opts no environment in, keeps another environment's opt-in while allowed (8 of 8 enabled; 7 when not); `devSeedSettingsFromEnv` reads the switch.
- `apps/api/src/jobs/report-types/matching-reports.test.ts` (hook 3, the screening path): an enabled `un-sc` row is never screened for an environment that did not opt in, nor while the install does not allow it; it is for one that did.

```
$ (cd apps/api && pnpm exec vitest run <the eight files> --coverage.enabled=false)    rc=1, 41 s
     × is nothing while the install does not allow the opt-in, whatever a setting holds
     × names no source while the install allows it but no environment opted in
     × keeps un-sc enabled for an environment that opted in, only while the install allows it
     × reconciles un-sc enabled for an environment that opted in while the install allows it, and not otherwise
     × passes the opted-in sources while the install allows the opt-in
     × answers 403 step_up_required without a recent second factor, storing nothing   (got 409 watchlist_source_locked)
     × records a stepped-up admin's acknowledgement, audited, and withdraws it, audited (got 409)
     × still refuses the acknowledgement of other terms                               (got 409)
     × reads the UN opt-in switch as every process does (C254.1, Q10 granted)
     × opts no environment in to the UN list, and keeps another environment's opt-in while the install allows it
     × passes the opted-in sources to the reconcile while the install allows the UN opt-in (Q10)  (0 calls)
     × asks for no opt-in source while the install does not allow it                  (0 calls)
     × never screens un-sc for an environment that did not opt in, though its row is enabled
     × never screens un-sc while the install does not allow the opt-in, whatever the settings hold
```

RED commit `afeecd8f5`.

GREEN (the three hooks; borrowed edits named in the report):
- `watchlistReconcileOptIn(db, allowed)` (`un-opt-in.ts`): `{ optInSources: await optedInWatchlistSources(db, true) }` while allowed, `{}` otherwise (the database is not read and the options stay Phase 6's byte for byte, so the existing `toHaveBeenCalledWith(db, { disabled })` assertions hold).
- Hook 1: `routes/dashboard/admin.ts` registers `watchlistOptInRoutes` with `watchlistUnOptInAllowed: options.watchlistUnOptInAllowed`; `container.ts` passes `config.watchlistUnOptInAllowed` in the dashboard's `admin` options.
- Hook 2, every reconcile caller spreads the helper's member: `container.ts` (ready), `worker.ts` (`reconcileWatchlistSourcesAtStart(db, disabled, logger, config.watchlistUnOptInAllowed)`), `watchlists/cli.ts` (`reconciled`, with `cli-runtime.ts` handing `{ ...config.watchlists, unOptInAllowed }`), `jobs/repeatable/watchlists.ts` (the refresh tick; the worker hands `reports.watchlists` with `unOptInAllowed`), `seed/dev-seed.ts` (`devSeedSettingsFromEnv` reads the switch, refusing a value other than true or false, and `scripts/seed-dev.ts` passes it; the seed opts no environment in). The load seed (`seed/load/steps.ts`) names no opt-in: the load stack never opts in (Q10 rows of 11D).
- Hook 3: `jobs/reports/screening.ts`'s `screenableSources` refuses an opt-in source (`list_unavailable`) unless `environmentMayScreenSource(source, the report environment's settings, deps.watchlists.unOptInAllowed)`; the settings are read once a run through `ScreeningKit.environmentSettings` (default `getEnvironment`), only when an opt-in source is selected.
- The screening test's fixture `accepted-by` was not a valid ULID (`watchlistOptInSchema` refused it), so it now uses `newId('usr')`.

```
$ (cd apps/api && pnpm exec vitest run <the eight files> src/watchlists/reconcile-opt-in.test.ts src/jobs/reports/ --coverage.enabled=false)
 Test Files  17 passed (17)
      Tests  210 passed (210)     rc=0
$ (cd apps/api && pnpm exec tsc --noEmit)   rc=0; eslint and prettier on the eleven files rc=0
$ pnpm --filter @openverify/watchlist benchmark:typecheck   rc=0
$ pnpm --filter @openverify/watchlist benchmark:test        14 files, 133 tests, rc=0 (screening.ts, config.ts and worker.ts are rule 16's)
```

Hooks GREEN commit `5086a6f6e`.

### 4b. The documented default flipped to true (Q10 granted; 11G decisions item 18)

RED, the existing assertions changed as rule 12 allows (the owner decision changes the behaviour they check): `apps/api/src/config-phase11b.test.ts` (the 11B defaults expect `watchlistUnOptInAllowed` true; an install may lock it with `false`), `apps/api/src/config-registry.test.ts` (the entry's default `'true'`), `apps/api/src/watchlists/un-opt-in.test.ts` (true in `config.ts`, `.env.example` and compose; the e2e env names no value), `packages/contracts/src/phase11b-data.test.ts` (`WATCHLIST_UN_OPT_IN_SWITCH.default` true), `infra/tests/compose.test.sh` (`.env.example` true, compose `:-true`), `infra/tests/chart-skeleton.test.sh` and `deploy/helm/openverify/tests/c263-components_test.yaml` (the chart's API and worker ConfigMaps render `'true'`), `apps/api/src/watchlists/manifest.test.ts` (the manifest's `un-sc` terms note and `docs/reports/README.md` no longer say "cannot be enabled in this release"; the note names the environment admin's acknowledgement and the switch). New full-stack spec `e2e/tests/un-opt-in.spec.ts`: a seeded admin's opt-in reaches the checks on the stack (422 for other terms, 403 `step_up_required` without a step-up; nothing stored), never 409. Its RED was not run on a stack (minutes a start); the unit REDs above hold the same switch, and its GREEN run is section 4c.

```
$ (cd apps/api && pnpm exec vitest run src/config-phase11b.test.ts src/config-registry.test.ts src/watchlists/manifest.test.ts src/watchlists/un-opt-in.test.ts --coverage.enabled=false)
      Tests  6 failed | 69 passed (75)   rc=1
$ (cd packages/contracts && pnpm exec vitest run src/phase11b-data.test.ts --coverage.enabled=false)
      Tests  1 failed | 16 passed (17)   rc=1
$ bash infra/tests/compose.test.sh --static-only    # 610 passed, 2 failed   rc=1
$ bash infra/tests/chart-skeleton.test.sh            # 50 passed, 1 failed, 0 skipped   rc=1
$ (cd deploy/helm/openverify && helm unittest .)     Tests: 2 failed, 197 passed, 199 total   rc=1
$ pnpm --filter @openverify/e2e typecheck   rc=0; eslint on the spec rc=0
```

RED commit `2d81e1531`.

GREEN: `WATCHLIST_UN_OPT_IN_SWITCH.default` true (`packages/contracts/src/watchlist-sources.ts`, which `config.ts` reads; borrowed), the `config-registry.ts` entry (`'true'`, its description; borrowed), `.env.example` `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED=true` with its comment, `infra/docker-compose.yml` `:-true` (borrowed), the chart's `install.watchlistUnOptInAllowed: true` (`values.yaml`; `_config.tpl` already renders the value), the manifest's `un-sc` terms note (`watchlists/sources.json`, borrowed) and `docs/reports/README.md` (borrowed), `docs:selfhost`'s `docs/self-hosting/configuration.md` (generated from the registry), `docs/self-hosting/first-run.md`, `docs/compliance/licensed-data.md`, ADR 0010 §4's install-switch line, and the header comments of `un-opt-in.ts`, `routes/dashboard/watchlist-opt-in.ts` and `watchlists/reconcile.ts`. Images still bake no value (`images.test.sh`'s refusal at the api case is unchanged), no seed opts an environment in (section 4's seed test), the load stack sets none (`load-compose.test.sh:91`, unchanged). Not changed (frozen): the opt-in route's OpenAPI `description` still says the refusal "is its default in this release" (`docs/api/openapi.json`; the exact change is in the report's contractDeviations).

### 4c. Q10's gate

```
$ (cd apps/api && pnpm exec vitest run src/config-phase11b.test.ts src/config-registry.test.ts src/watchlists/ src/routes/dashboard/watchlist-opt-in.test.ts src/routes/dashboard/watchlist-sources.test.ts src/container.test.ts --coverage.enabled=false)
      Tests  243 passed (243)   rc=0
$ (cd packages/contracts && bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/claude-1000/cov-contracts)
 Test Files  121 passed (121)
      Tests  4905 passed (4905)
All files          |   98.97 |     92.3 |   98.23 |   98.98 |   rc=0, 25 s, load 5.40
$ bash infra/tests/compose.test.sh --static-only     # 612 passed, 0 failed
$ bash infra/tests/chart-skeleton.test.sh             # 51 passed, 0 failed, 0 skipped
$ bash deploy/helm/openverify/ci/chart-checks.sh unittest    Tests: 199 passed, 199 total   rc=0
$ bash deploy/helm/openverify/ci/chart-checks.sh lint        1 chart(s) linted, 0 chart(s) failed   rc=0
$ pnpm --filter @openverify/docs-tools docs:selfhost && pnpm --filter @openverify/docs-tools docs:all   rc=0 (configuration.md's row only)
$ (cd packages/docs-tools && pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/claude-1000/cov-dt-q10)
      Tests  442 passed (442); All files 97.74 %   rc=0
$ pnpm release:check     release:check (default): 0 errors, 83 owner items   rc=0
$ flock -E 75 -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/un-opt-in.spec.ts; rc=$?; pnpm --filter @openverify/e2e e2e:stack:down; exit $rc"
  ✓  1 [chromium] › tests/un-opt-in.spec.ts:22:1 › the UN opt-in reaches its checks on the stack, not the lock (C254.1, Q10 granted) (190ms)
  1 passed (2.7s)            rc=0, 136 s in all (load 3.23 before, 4.72 after); no Next.js stop
```
The API's whole suite, its integration calls and the forced lint and typecheck are the last checkpoint's gate (section 8).

Checkpoint 4 `ff59774fb`.

## 5. Q11 granted: MIT-0 (nodemailer) and EPL-1.0 (JUnit 4, test scope) accepted

`security/check-sbom-licences.py` reads each row's words (`_OWNER`: "owner to confirm", "pending owner decision"), so the decision is made in the rows, never in the check (no hard-coded label; nothing to fix there). The API image's `dev.openverify.licence-status` label is set by hand in `infra/docker/api.Dockerfile`.

RED: `infra/tests/images.test.sh` (static: the API Dockerfile's label is `decided`; live: the built API image's label is `decided`, vision alone stays `pending-owner`, F004/KP11-39); `security/tests/test_check_sbom_licences.py`'s real-ledger case (nodemailer in `image:api` passes as a recorded decision, and the report is `pass` with no `pending-owner` label; rule 12, the owner's decision changes what it checks; JUnit 4's case is unchanged: EPL-1.0 is test tooling and fails `tooling-shipped` in any runtime SBOM).

```
$ bash infra/tests/images.test.sh static     rc=1
FAIL - api: licence-status is decided
# 148 passed, 1 failed
$ (cd security/python && uv run pytest -q ../tests/test_check_sbom_licences.py -k real_ledger)    rc=1
FAILED ../tests/test_check_sbom_licences.py::test_the_real_ledger_passes_nodemailer_in_the_api_image_as_q11_decided_it
1 failed, 13 passed, 98 deselected
```

RED commit `1d0fd1649`.

GREEN: `THIRD_PARTY_LICENSES.md` nodemailer (runtime, MIT-0) and JUnit 4 (section 5, EPL-1.0, test scope only, beside EPL-2.0 under the test-only exception) read "Accepted (Phase 11 Q11, granted 2026-11-21 ...)", no longer "owner to confirm"; `infra/docker/api.Dockerfile`'s label is `dev.openverify.licence-status="decided"` (and its header comment); ADR 0010 §4's owner-dependent bullet names nodemailer as decided and KP11-39 as the open one. Vision stays `pending-owner` (KP11-39, F004). No mailer is replaced (Q11 granted). `docs:release` re-rendered `docs/release/notes.md` (a named borrowed edit: the two "owner to confirm" licence lines go).

```
$ bash infra/tests/images.test.sh static          # 149 passed, 0 failed    rc=0
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir .
============================= 258 passed in 3.33s ==============================   (96.53 %)   rc=0
$ uv run --project security/python --frozen ruff check … && ruff format --check …    rc=0, rc=0 (11 files already formatted)
$ flock /tmp/openverify-e2e.lock docker build -q -f infra/docker/api.Dockerfile -t openverify/api:11c-local .
                                                   rc=0, 146 s (lock wait 0.003 s; load 3.63 3.87 4.01)
$ flock /tmp/openverify-e2e.lock bash infra/tests/images.test.sh api
ok   - api: label dev.openverify.licence-status
# 58 passed, 0 failed                              rc=0, 48 s
$ pnpm --filter @openverify/docs-tools docs:release   rc=0 (notes: the nodemailer and JUnit 4 "owner to confirm" lines removed)
$ (cd packages/docs-tools && pnpm exec vitest run src/release src/integration --coverage.enabled=false)   102 passed, rc=0
$ pnpm release:check     0 errors, 83 owner items; licence-row now 2 (KP11-39's row and Locust's)
```

Checkpoint 5 `367a060bc`.

## 6. Q12 granted (after 11D's Stage 1a): recorded only

RED: `security/tests/test_check_sbom_licences.py`, the real-ledger group: the Locust row names Q12 and "granted", reads no "pending" (`release:check`'s licence-row rule lists a row that does) and says it waits for the next release, and `load/uv.lock` holds no Locust.

```
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . -k locust security/tests/test_check_sbom_licences.py
>       assert "Q12" in text and "granted" in text
====================== 1 failed, 112 deselected ======================   rc=1
```

RED commit (Q12) in `git log --grep 'records-11g Q12 RED'`.

GREEN: the Locust row (`THIRD_PARTY_LICENSES.md`, "Not adopted" table) and the `load/` paragraph of section 2 record the grant (2026-11-21, after 11D's Stage 1a, ZPL-2.1 as unmodified dev tooling in `load/` only) and that it changes nothing in this release; `load/` is unchanged (vegeta and the httpx driver; 11D's report stands); `docs:release` drops the notes' "Locust 2.46.7: pending" line (a named borrowed edit). `docs/PLAN.md:155` still says "not adopted while Q12 is pending" (the orchestrator's file; its line is proposed in the report's followups).

```
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir .
============================= 259 passed in 3.08s ==============================  (96.53 %)  rc=0
$ pnpm --filter @openverify/docs-tools docs:release     rc=0 (- "Locust 2.46.7: pending.")
$ (cd packages/docs-tools && pnpm exec vitest run src/release src/integration --coverage.enabled=false)   102 passed, rc=0
$ pnpm release:check     0 errors, 82 owner items; licence-row 1 (KP11-39's row)
```

Checkpoint 6 `e30677aa2`.

## 7. P2 granted (Phase 10, 2026-11-08): the record checked; DEVICE-PROOFS from the orchestrator's record

P2 opens no part (11G decisions item 3): 11C already stages the guidance flow image as the release's. Checked, nothing recorded twice:
- `docs/release/checklist.md:13` "Shipped flow image: `guidance`"; `P10-P2` (`:72`) `done`, decided 2026-11-08; `EIGEN-VISION` (`:85`) stays `owner` (the owner confirms the vision wheel under P2's narrow grant).
- `THIRD_PARTY_LICENSES.md`: onnxruntime-web 1.30.0 (`:177`, MIT, the flow's in-browser YuNet guidance) and section 6's three Eigen rows (openverify-face's AAR, the flow's WASM, the vision wheel 1.31.0), each "granted narrowly" under Phase 10 P2 with Phase 4 decision 11; Android's openverify-face is 10E's under the same grant (PROGRESS's 10E entry), unchanged.
- `.github/workflows/release.yml`: builds `openverify/flow:$VERSION` (guidance) and `openverify/flow:$VERSION-noguidance` (`OPENVERIFY_FLOW_FACE_GUIDANCE=off`); the publish loop pushes the guidance image under the plain `openverify-flow:<version>` tag and the variant under `-noguidance`. No edit was needed, so none was borrowed from publish-11g.
- `docs/release/notes.md:180` and `:185`: "Phase 10 P2: granted narrowly" and "The flow image shipped carries `onnxruntime-web` (on-device face guidance) while Phase 10 P2 stays granted narrowly".
- `pnpm release:check` (default): no `flow-image` or `p2-dependency` finding (the rules of `release-check.ts:64-130` read PROGRESS's Phase 10 row and the checklist's facts line, never edited).
- KP11-9 (ONNX Runtime 1.31.1 and the vision wheel): PROGRESS records no answer (the owner's, on the release gate's list), so no pin moves (rule 3).

DEVICE-PROOFS (11G decisions item 20): the checklist line (a named borrowed edit of integration-11g's file) now cites `docs/tdd/phase11-orchestrator.tdd.md` ("The device suites after 11F: 22 of 22 on the unlocked Pixel 9", `2002ecc05`'s tree, SDK 14, demo smoke 2, nfc 2, face 4 from the XML) beside fix-records' file: 11F's nine device proofs are closed. Its state stays `open`, because the line also holds the Phase 10 close's "Unproved on a device or an emulator" lines that need an emulator, NFC off, a colon-free serial, a real chip or a person (KP10-59, KP10-58, KP10-17). `docs:release` re-rendered the notes' line.

```
$ pnpm --filter @openverify/docs-tools docs:release    rc=0 (the DEVICE-PROOFS line)
$ (cd packages/docs-tools && pnpm exec vitest run src/release --coverage.enabled=false)    82 passed, rc=0
$ pnpm release:check      0 errors, 82 owner items, rc=0
```

Checkpoint 7 `e345d9507`.

## 8. The ASVS rows whose evidence this part changed (C274.6)

`release:check`'s `security/stale-evidence` listed ten rows whose cited evidence records-11g changed: v5.0.0-2.1.2 (`docs/checks/catalog.md`, Q8's column), 7.1.1 (`docs/self-hosting/configuration.md`, Q10's row), 12.3.1 and 16.3.4 (`apps/api/src/config-phase11b.test.ts`, Q10's default), 13.3.2 (`infra/tests/compose.test.sh`, Q10), 13.4.1, 13.4.2 and 15.2.3 (`infra/tests/images.test.sh`, Q5's `UV_PIN` and Q11's label), 15.1.1 (`docs/security/vulnerability-policy.md` and its record test, Q1) and 15.1.2 (`security/tests/test_check_sbom_licences.py`, Q11 and Q12). Each was read again against the changed evidence and holds at its status (none of the changes weakens what the row claims: the catalog gained a column, the configuration row a default, the tests a stricter expectation, the policy Q1's state); each now has `reviewed_at` 2026-11-21 and `reviewed_commit` `e345d9507` (a named borrowed edit of docs-security's CSV). `docs:security` re-rendered `docs/security/asvs-summary.md`.

```
$ pnpm --filter @openverify/docs-tools docs:security && pnpm --filter @openverify/docs-tools docs:all   rc=0, rc=0
$ (cd packages/docs-tools && pnpm exec vitest run src/security --coverage.enabled=false)    50 passed, rc=0
$ pnpm release:check      0 errors, 72 owner items (no security/stale-evidence item left)
```

ADR 0010 §4's Q1-Q4 bullet (`c5f9973b4`): the four grants of 2026-11-21 recorded, and that granting them wires the publish job and publishes nothing; nothing is pushed, signed or attested until the owner's release step and an approved dispatch with `dry-run` false.

## 9. The last checkpoint's gate (the full gate of the area, on the final tree, 2026-11-21)

Every call in the foreground; heavy calls through `/tmp/openverify-heavy.sh`; loads from `/proc/loadavg` (1, 5, 15 minutes), other Stage 2 parts running beside.

| Call | rc | Time | Load | Result |
|---|---|---|---|---|
| `pnpm format:check` | 0 | 120 s | 2.1 | all files formatted |
| forced typecheck: `pnpm turbo run typecheck --force --filter=@openverify/api --filter=@openverify/contracts --filter=@openverify/docs-tools --filter=@openverify/e2e` | 0 | 101 s | 2.98 | 4 of 4 |
| forced lint, API: `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api` | 0 | 241 s | 3.12 | 1 of 1 |
| forced lint, contracts, docs-tools, e2e (same form) | 0 | 101 s | 2.58 | 3 of 3 |
| API, 12 blob shards (`--shard=<k>/12 --reporter=blob`, each its own coverage directory) | 1 each (a lone shard's partial coverage; no test failed) | 122-165 s | 8.4-10.2 | blobs 1-12 |
| API merge (`--merge-reports … --coverage`) | 0 | 45 s | 5.57 | **11,008 tests in 872 files, 93.43 % lines** (10,992 at 11F's close plus records-11g's 16) |
| integration db | 0 | 93 s | 15.57 | 110 |
| integration graph | 0 | 34 s | 11.29 | 13 |
| integration api 1/3, 2/3, 3/3 | 0, 0, 0 | 117, 181, 124 s | 17.49, 10.36, 16.47 | 121, 139, 196 |
| `pnpm turbo run test --force` contracts, docs-tools, e2e | 0 | 50 s | 15.40 | 4,905 (98.97 %), 442 (97.74 %), 161 (97.28 %) |
| `benchmark:typecheck` and `benchmark:test` (rule 16) | 0 | 89 s | | 133 |
| vision: `uv run ruff check && ruff format --check && mypy src tools` | 0 | 1 s | | clean |
| vision pytest, three parts by sorted file (1-38, 39-76 with `--cov-append`, 77-113 with the gate) | 0, 0, 0 | 168, 201, 361 s | 2.15, 3.08, 2.36 | 880 + 874 + 971 = **2,725 at 97.46 %** |
| `load/`'s gate (`uv sync --frozen`, ruff, format, mypy, pytest) | 0 | 11 s | | 242 at 96.62 % |
| security/python: pytest, ruff, format, `mypy --strict` (ci.yml's paths) | 0 | 4 s | | 259 at 96.53 % |
| `images.test.sh static`, `pins`, `override` | 0, 0, 0 | | | 149, 28, 33 |
| `images.test.sh vision` (built at Q5) and `api` (built at Q11), each under the e2e lock | 0, 0 | build 34 s and check 28 passed; build 146 s and check 48 s | 2.10, 3.63 | 28, 58 |
| `ci-workflow.test.sh` | 0 | | | 548 passed, 0 skipped (actionlint on PATH) |
| `compose.test.sh --static-only`, `chart-skeleton.test.sh`, `load-compose.test.sh --static-only` | 0, 0, 0 | | | 612; 51; 103 (1 skipped) |
| `chart-checks.sh lint`, `unittest` (Helm 4 and 3), `kubeconform`, `trivy` | 0 each | 3, 10, 4, 8 s | | 199 + 199 unittest cases |
| `supply-chain.sh` osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii, allowlist | 0 each | 3, 44, 4, 1, 5, 24, 9, 0 s | | pii: 0 kept of 1,205 matched |
| own full-stack spec (rule 21's one call, section 4c) | 0 | 136 s | 3.23-4.72 | 1 of 1 |
| `pnpm release:check` (default) | 0 | | | 0 errors, 72 owner items (checklist-state 56, version 6, medium-advisory 5, owner-state 3: Q6, Q7, P4; licence-row 1: KP11-39; staged-run 1) |
| `gitleaks git --redact .` | 0 | 15 s | | 8,093 commits, no leaks |
| `gitleaks dir --redact --config security/gitleaks-pii.toml .` | 1 (1,205 raw matches) | 7 s | | the project's gate is the filtered run: `supply-chain.sh pii` keeps 0 of the same 1,205 (as fix-records' 0 of 1,205) |

Not run, by the rules: the e2e gate and the Android gate (integration-11g's; no commit of this part reached `android/`); kind (integration-11g's Validation 17b, since the chart's values changed); DAST. No KP11-38 or other under-load failure met in these runs. `git status --porcelain` is empty for this part's paths.
