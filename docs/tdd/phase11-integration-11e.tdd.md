# Phase 11, Workflow 11E: integration-11e (C282, C273.5, C284.1; the Validation)

Agent: `integration-11e` (Stage 3, alone and last). Owned paths: `docs/PLAN.md`, `docs/adr/0010-*.md`, `THIRD_PARTY_LICENSES.md`, `docs/research/{persona-surface,phase5-nfc}.md`, `docs/plans/phase-6.plan.md` (the C88 note only), `docs/plans/phase-11.plan.md`, and from this stage `packages/docs-tools/package.json` and `src/index.ts`. Every command below ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown; load averages are `cat /proc/loadavg` beside the call. No secret, token, address or personal value appears here.

## 0. Start

- Base `aa00b57bb`, start `247f6af3c`; the Stage 2 agents' last commit `377cf724f` (docs-catalog checkpoint 4); 102 commits in `247f6af3c..377cf724f`.
- `gh run list --branch main --limit 5` (read once, no wait, rule 25): the newest run, 44785912432 on the 11D push, is "completed failure" in 5 s; `gh run view 44785912432 --json jobs` shows 19 jobs and 0 steps started in all of them. As for the four runs before it, no job ran, so no CI failure is this Workflow's first fix.
- `git diff --quiet 247f6af3c HEAD -- android` exits 0 at the start: nothing under `android/` changed in 11E.
- Baseline `pnpm release:check` (default) at `377cf724f`: exit 0, 0 errors, 86 owner items (0.69 2.80 3.96).

## 1. C282's record test and release:check's staleness (test first)

### Stub (`70f828a55`)

`packages/docs-tools/src/integration/` (new; integration-11e's): `records.ts` (`CORRECTED_RECORDS`, `checkCorrectedRecords`, answering `not-built`), `release-staleness.ts` (`staleAwareReleaseCheck`, answering the plain release check), `index.ts`; `src/index.ts` re-exports it (a shared file, now integration-11e's). `tsc --noEmit`, `eslint`, `prettier --check`: clean.

### RED (`69eaa9d01`), load 0.99 1.11 2.62

`src/integration/records.test.ts` (16 fixture cases, one per rule, and the real tree) and `src/integration/release-staleness.test.ts` (3 cases over a fake history, never the working tree's HEAD):

```
$ (cd packages/docs-tools && pnpm exec vitest run src/integration --coverage.enabled=false)
     × passes a tree that holds every correction
     × names every missing record
     × fails PLAN naming k6 other than as excluded
     ... (one per rule)
     × pass their record test
     × reports a row whose cited file changed after its review as an owner item
AssertionError: expected [] to include 'plan-k6'
AssertionError: expected 'not-built' to be 'built' // Object.is equality
AssertionError: expected [] to deeply equal [ ObjectContaining{…} ]
      Tests  18 failed | 2 passed (20)
```

### GREEN for the rules (`c58be9bc5`), load 0.64 0.94 2.44

`checkCorrectedRecords` holds: PLAN names k6 only beside "AGPL" (case-sensitive, so Phase 9's id K6 is not a hit); no "Helm (later)"; a "### Next release: Phase 11 deferrals (C286)" section naming C286's next-release items and the address key, beside the two earlier "Next release" sections; section 6 Phase 11 with "HTTP load test (vegeta", 11A-11G and Q1-Q12; section 2's Connect row with connect correction 2's behaviours; section 7's "threat-model rows added or changed"; section 9's Trivy row (2026-03-19) and DSAR tooling at C253; section 10's contracts; ADR 0010's rule 6 written and its status final; the KP11-51 row beside OpenCV's, with "pending the owner" and KP11-39 and no "allowed" or "granted"; the tslib rows at decision 46 and libpdfium's at decision 31 with no pending word; nodemailer and JUnit 4 at Q11; a release date in each C258.3 tool's row; the surface index's eight events and a dated confirmation; section 8's dated addendum; C88's dated note. `staleAwareReleaseCheck(history)` runs the release check with `checkSecurityWith(repo, {history})`; `src/cli.ts`'s `main()` passes `createGitEvidenceHistory(REPOSITORY_ROOT)` (a borrowed edit of contracts-11e's file; `main` is tested only with `--help`, so no test reads git).

The 19 fixture cases pass; the real tree fails for the documents' reason, 23 findings:

```
+   "plan-helm-later: \"Helm (later)\" stays: the chart is built (C282)",
+   "plan-next-release: no \"### Next release: Phase 11 deferrals (C286)\" section (C282)",
+   "plan-phase-11: section 6 Phase 11 does not read \"HTTP load test (vegeta ...\"",
+   "adr-rule-6: rule 6 is still a placeholder (decision 46)",
+   "licence-kp11-39: no row records FFmpeg, libquadmath and libgfortran inside opencv-python-headless as pending the owner (KP11-39; KP11-51)",
+   "licence-tslib: a tslib row waits on the owner, though Phase 5 decision 46 accepted 0BSD (C282, review H19)",
+   "licence-tool-date: gitleaks's row has no release date in its version (C282, C258.3)",
+   "surface-connect: the Connect section is not confirmed against the code with a date (C282)",
+   "nfc-addendum: section 8 has no dated addendum with connect correction 3's facts (missing 24 December 2025)",
+   "phase6-c88: C88 has no dated note that Phase 11 defers report sharing (connect correction 4; C286)",
   ... (23 in all)
      Tests  1 failed | 19 passed (20)
```

`pnpm release:check` through the CLI with the staleness wired: exit 0, 0 stale rows.

### The records, one commit each (GREEN for the real tree)

- `fea7686d8` `THIRD_PARTY_LICENSES.md` (KP11-51): the FFmpeg 8.1.1 (LGPL-2.1-or-later), libquadmath (LGPL-2.1-or-later) and libgfortran (GPL-3.0-or-later with the GCC Runtime Library Exception) row beside the OpenCV row, "pending the owner (KP11-39; Phase 3's open decision, `docs/plans/phase-3.plan.md:310`)", a record and not an exception row; the tslib rows at Phase 5 decision 46 and libpdfium's at decision 31 (both confirmed in Phase 5's "Owner-delegated decisions after Workflow 5B", `phase-5.plan.md:1264-1265`); JUnit 4 points at Q11; gitleaks 8.30.1 dated 2026-03-21 (read at `https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1` through `gh api`, 2026-11-20). `release:check`'s licence rule then lists FFmpeg's row as an owner item and no longer tslib's or libpdfium's.
- `56e1014ec` ADR 0010 final: rule 6 written, the status, three consequences and three alternatives added.
- `cdc2a2ff0` PLAN (decision 47).
- `30405428a` `persona-surface.md`: the Connect section confirmed against the code (EVENT_NAMES, `phase11a-common.test.ts`, the twelve `/api/v1/connect/*` paths of `docs/api/openapi.json`); nothing needed changing.
- `208bd3a70` `phase5-nfc.md` section 8's addendum; sources re-read 2026-11-20 (HAIP 1.0 Final, 24 December 2025; `draft-ietf-oauth-sd-jwt-vc-27`, 16 November 2026, IESG Evaluation; the Digital Credentials API Working Draft of 19 November 2026; the npm registry's metadata for the four packages).
- `68b6964d2` `phase-6.plan.md` C88's dated note, on the line after the paragraph, so `release:check`'s deferral parser keeps C88 one item.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/integration/records.test.ts --coverage.enabled=false)
      Tests  17 passed (17)
```

The re-renders after the records: `docs:security`, `docs:records`, `docs:selfhost`, `docs:compliance` and `docs:catalog` wrote their files with no diff (the surface index's confirmation line is prose the mapping does not render).

### The checklist and the notes (`31d005111`, borrowed edits of docs-release's files)

- `docs/release/checklist.md`: B07 `done` (every docs-tree document exists with no draft left, each generated page fresh, every record test green in the docs-tools suite); LIC-TSLIB and LIC-PDFIUM `done` (the rows cite Phase 5 decisions 46 and 31); B08, B13, B16 and KP11-39 keep their states with updated "who" and evidence. 10 done, 89 open, 47 owner, 4 ci-pending.
- `pnpm --filter @openverify/docs-tools docs:release` re-rendered `docs/release/notes.md` (the FFmpeg row's disclosure added; tslib's and libpdfium's dropped). `pnpm release:check`: exit 0, 0 errors, 80 owner items.
- The docs-tools suite after these: 405 tests in 50 files, 97.58% statements, 23 s (load 0.93 -> 2.27); `src/integration` 99.31%.

## 2. C273.5: the review confirmed on the final tree

docs-security's review (`fc8cb31ee`, against `7d813b436`, 2026-11-20). `git diff --name-only 7d813b436 HEAD` lists 41 files; the ones the threat model or a checklist cites: `THIRD_PARTY_LICENSES.md` (B11-I3's evidence; MASVS-CODE-3 names it in its notes, not as evidence), ADR 0010 (B13-T5), `docs/connect/consent.md` (B13-R2, B13-I6) and `docs/self-hosting/hardening-checklist.md` (operator rows). Each still says what its row claims (ADR 0010's rule 1 is unchanged; section 6 of the licence file is unchanged; `consent.md` says a copy already made belongs to its controller and that withdrawal recalls nothing; the hardening checklist is a fresh render). The staleness check (C274.6, now in `pnpm release:check`) reports no stale row. Review commit for PROGRESS: `fc8cb31ee`.

## 3. Stage 2 amendments in the plan (`bda2c016d`)

One subsection per Stage 2 agent, from its contract deviations, appended after Stage 1a's.

## 4. A Validation failure fixed test-first: the committed route table

Validation step 5, the other packages in one forced turbo call: `@openverify/docs-tools#test` failed (load 5.17 -> 40.21, 133 s):

```
 FAIL  src/catalog/index.test.ts [ src/catalog/index.test.ts ]
Error: the route table collector failed (status null):
 ❯ collect src/catalog/route-table.ts:126:11
 ❯ routeTableFor src/catalog/route-table.ts:145:17
      Tests  402 passed (402)
```

Status null with no stderr: the child that builds the API met its 50 s guard; alone it takes 8-10 s. Not retried (rule 6); made cheaper, test-first:

- Stub `2b43c2440` (`ROUTE_TABLE_PATH`, `serializeRouteTable`, `parseCommittedRouteTable`, `collectRouteTable`, `renderRouteTable`).
- RED `eedb03616` (`src/catalog/route-table.test.ts`, load 2.63 11.93 8.98):

```
     × round-trips through its committed form, which holds no list of plain values
     × is what the catalog reads, from any repository that holds it
     × reads the collector's table
     × throws when the collector fails or prints something else
AssertionError: expected null to deeply equal { routes: [ { …(4) }, …(3) ], …(1) }
Error: not built
      Tests  4 failed | 2 passed (6)
```

- GREEN `10bd9a225`: the catalog reads the committed table; the real-tree test then failed for the missing file (`× is committed and holds a route for every operation openapi.json documents`).
- Stub `370d57679` (`CliDeps.routes`); RED `8eb7d73bd` (the CLI test `writes the route table through the injected collector for routes`: `expected 2 to be +0`); GREEN `2adcacf97`: the CLI's `routes` command, `docs:catalog` and `docs:all` run it first; `docs:catalog` wrote `docs/api/route-table.json` (4,159 lines; prettier clean) in 18 s and every catalog page re-rendered with no diff.
- The docs-tools suite: 412 tests in 51 files, 97.56% statements, 22 s (load 1.15 -> 3.06). The step's re-run passed (15 of 15 packages, 220 s, 2.66 -> 14.95).

## 5. The Validation as run

Every call in the foreground within 10 minutes; heavy calls with `OPENVERIFY_HEAVY_RESERVED=1` through `/tmp/openverify-heavy.sh`; "rc" is the command's own exit code; load is the 1-minute average before and after. Gradle lock waits 0.003-0.004 s on every call.

| Step | Call | rc | s | Load |
|---|---|---|---|---|
| 1 | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | 0 | 0.63->0.63 |
| 1 | `pnpm format:check` | 0 | 119 | 0.63->1.09 |
| 2 | `pnpm turbo run typecheck --force` (20 tasks) | 0 | 173 | 1.08->4.87 |
| 2 | lint `--force --concurrency=1 --filter=@openverify/api` (4 GB heap) | 0 | 250 | 4.87->1.62 |
| 2 | lint dashboard and contracts | 0 | 224 | 1.49->1.41 |
| 2 | lint the other 17 packages | 0 | 369 | 1.41->1.90 |
| 3 | `fetch_models.py && fetch_data.py && fetch_fixtures.py --only person_a_id` | 0 | 2 | 1.75->1.69 |
| 4 | `build:variant-groups` (`29d05838...3bfb`) | 0 | 6 | 1.69->1.63 |
| 5 | db (2,392 at 90.0%) | 0 | 176 | 1.50->9.42 |
| 5 | watchlist and e2e (840, 155) | 0 | 294 | 8.67->1.12 |
| 5 | dashboard shard 1/2, 2/2 (blob; a lone shard exits 1 by design) | 1, 1 | 263, 242 | 0.94->8.35, 7.68->6.84 |
| 5 | dashboard merge, the 80% gate (7,235 in 622 files, 95.62%) | 0 | 6 | 6.37->5.94 |
| 5 | the other 15 packages, first call (section 4) | 1 | 133 | 5.17->40.21 |
| 5 | the other 15 packages again (core 2,008; checks 3,857; contracts 4,905; workflow-engine 2,042; flow 1,678; node 508; flow-spec 527; config 451; emrtd 338; signals 192; ui 58; react 55; demo-web 18; js 19; docs-tools 412) | 0 | 220 | 2.66->14.95 |
| 5 | `pnpm --filter @openverify/js test` (19) | 0 | 5 | 13.75->12.73 |
| 6 | API shards 1-8/8 (blob; exit 1 by design) | 1 each | 205, 247, 198, 210, 209, 182, 210, 198 | 7.0-12.7 |
| 6 | API merge, the 80% gate (10,963 in 868 files, 93.42%) | 0 | 46 | 7.45->4.06 |
| 7 | benchmark:typecheck; benchmark:test (133) | 0, 0 | 64, 12 | 3.74->2.79 |
| 8 | integration db (110) | 0 | 140 | 2.79->20.16 |
| 8 | integration graph (13; template 23.0 s) | 0 | 52 | 20.16->9.76 |
| 8 | integration api 1/3, 2/3, 3/3 (121, 139, 196) | 0, 0, 0 | 136, 193, 145 | 9.69->19.09 |
| 9 | vision `uv lock --check`, ruff, format, mypy | 0 | 2 | 19.09->17.64 |
| 9 | vision pytest parts 1-3 (877, 863, 982 = 2,722; 97.45%) | 0, 0, 0 | 165, 187, 306 | 17.64->1.53 |
| 9 | security/python pytest (196), ruff, format, mypy | 0 each | 3, 0, 0, 0 | 1.41->1.38 |
| 10 (1) | host tests ui, flow, rest with `--rerun` (532, 427, 1,773 = 2,732; 0 skipped) | 0, 0, 0 | 164, 46, 103 | 1.73->3.16 |
| 10 (2) | screenshotTest verify with `--rerun` (97) | 0 | 68 | 2.88->2.78 |
| 10 (3) | koverVerify checkKotlinAbi | 0 | 13 | 3.09->3.13 |
| 10 (4) | testDebugUnitTest assembleDebug; the four test tasks with `--rerun` (demo 97 and 9, nfc 116, face 51) | 0, 0 | 25, 64 | 2.06->4.33 |
| 10 (5) | release AARs, APK and bundle | 0 | 14 | 4.33->5.08 |
| 10 (6) | `:openverify-sdk:assemble` | 0 | 11 | 5.08->4.92 |
| 10 (7) | lint | 0 | 15 | 4.76->4.45 |
| 10 (8) | device-test compile (`checkSmokeTestReferences` ran) | 0 | 22 | 4.45->5.03 |
| 10 (9) | bundletool; 98 release-check tests; elf, consumer rules, size | 0 each | 0, 1, 13 | 4.62->4.09 |
| 10 (10) | `publishAllPublicationsToStagingRepository`; `-p consumer-check build` | 0, 0 | 13, 12 | 4.09->3.78 |
| 10 (11) | `-PopenverifyDemoArtifacts=` sdk,nfc; sdk,face; sdk,nfc,face | 0 each | 23, 26, 23 | 3.78->2.86 |
| 10b | skipped: no lockfile or verification metadata changed | | | |
| 11 | cyclonedxBom (188, 195, 190 components) | 0 | 8 | 2.71->2.84 |
| 12 | openapi:write, then `git diff --exit-code docs/api/openapi.json` | 0, 0 | 23 | 2.61->2.00 |
| 12 | workflow-docs:write, then `git diff --exit-code docs/workflows` | 0, 0 | 2 | 2.00->2.00 |
| 12 (added) | `docs:all`, then `git diff --exit-code docs` | 0, 0 | 16 | 1.84->1.65 |
| 13 | mocked flow suite (349) | 0 | 128 | 1.52->9.18 |
| 13 | stack down and `turbo run build --filter=@openverify/e2e^...` | 0 | 31 | 8.44->6.02 |
| 13 | `e2e:stack:up`, first: Next.js 16.4.2's `SecurityFatalError` stopped `next build` (KP11-42's class; no upgrade) | 1 | 101 | 5.54->3.02 |
| 13 | stack down; `e2e:stack:up` again | 0, 0 | 1, 110 | 2.56->2.57 |
| 13 | chromium shards 1-4/4 (50, 52, 47, 49 passed) | 0 each | 296, 362, 289, 428 | 1.40->2.54 |
| 13 | console sweep (109) | 0 | 320 | 1.70->3.41 |
| 13 | `:openverify-sdk:stackTest` (3 of 3: flow, NFC, Connect) | 0 | 58 | 3.14->2.66 |
| 13 | stack down | 0 | 4 | 2.52->2.52 |
| 13 | WebKit theme-csp: skipped, `apps/flow` unchanged | | | |
| 14 | images: api (`sha256:3f3a7a90`), dashboard (`8f90c62f`), flow (`73cfae47`), flow-noguidance (`301b70ea`), code-runner (`96ad9d9e`), vision (`f1ab18a3`) | 0 each | 235, 205, 40, 35, 43, 3 | 2.32->1.73 |
| 15 | 34 infra scripts (images.test.sh as 9 subcommands), the 3 chart contracts, the chart files' unittest (15): 2,999 checks, 13 skipped | 0 each | 0-60 each | 0.49->2.92 |
| 16 | benchmarks: skipped, 11E's diff touches nothing they measure | | | |
| 17 | load/'s gate (242 at 96.62%) | 0 | 9 | 0.65->0.70 |
| 18 | `fetch_asvs.py --verify-ids && fetch_masvs.py --verify-ids` | 0 | 0 | 0.70->0.70 |
| 19 | supply-chain.sh osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii, allowlist | 0 each | 2, 35, 5, 1, 4, 20, 6, 0 | 0.64->2.35 |
| 20 | chart-checks lint, unittest, kubeconform, trivy | 0 each | 2, 9, 3, 5 | 2.16->1.83 |
| 21 | kind and ZAP: skipped (no chart or image change; ZAP is 11F's) | | | |
| 22 | `pnpm release:check` (0 errors, 80 owner items, no stale row) | 0 | 4 | 1.69->1.64 |
| 23 | `gitleaks git --redact .` (7,910 commits, no leaks) | 0 | 11 | 1.64->1.54 |
| 23 | PII filter over the tree (0 kept of 1,205) and history (0 of 1,641) | 0, 0 | 6, 10 | 1.42->2.97 |
| 24 | literal `grep -rln` of the draft marker: four files quote it in prose, none a stub (amended, Stage 3 amendment 7) | 0 | 0 | |
| 24 | anchored grep `^Draft: written...` (nothing, exit 1); `draftsRemaining` 0, `missingFromTree` 0 | 1 (pass) | 1 | |
| 25 | device suites: skipped, nothing under `android/` changed | | | |
| after the fix | `pnpm format:check`; docs-tools typecheck and lint `--force` | 0, 0 | 129, 19 | 2.19->2.57 |

Two calls before the fix of section 4 ran a docs-tools input that changed after them: the forced typecheck and lint (docs-tools has no dependents, so its own typecheck and lint ran again) and format:check (ran again). Neither earlier step's result for another package depends on docs-tools.
